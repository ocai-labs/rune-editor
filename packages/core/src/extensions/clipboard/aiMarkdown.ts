// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The AI-edit parse path — the read-side inverse of the styling-aware markdown
// the export layer emits (see api/export/serializeInline.ts and
// internal design notes). It is
// SEPARATE from the paste path (`markdownToHtml` / `markdownToDoc`), which
// stays `html: false` on purpose (paste safety + the list flattener). This
// path runs `html: true` so the two raw-HTML constructs the dialect uses
// (`<u>` and `<span data-*-color>`) survive, and adds a strict sanitizer so
// nothing ELSE the (untrusted, model-supplied) markdown carries can be
// injected. Everything then funnels into the SAME `transformPastedHTMLDoc` →
// PM DOMParser core `markdownToDoc` uses, so read == write by construction.

/// <reference path="./markdown-it-task-lists.d.ts" />
import MarkdownIt from "markdown-it"
import taskLists from "markdown-it-task-lists"
import type { JSONContent } from "@tiptap/core"
import { DOMParser as PMDOMParser, type Schema } from "@tiptap/pm/model"
import { collectKnownBlockTags } from "./knownBlockTags"
import { transformPastedHTMLDoc } from "./transformPastedHTML"
import { shiftHeadings } from "./markdownToHtml"
import type { ParseHTML } from "./markdownToDoc"
import { sanitizeRawHtml } from "./aiMarkdownSanitizer"

// ── Dialect inline rules markdown-it's default preset can't read ───────────

// Minimal shape of markdown-it's inline-rule state — only the members these
// two rules touch. The full `StateInline` type isn't reachable through the ESM
// default import (`export =` namespace), and a rule typed against this subset
// is still assignable where markdown-it expects the full `RuleInline`.
interface InlineState {
  readonly src: string
  pos: number
  readonly posMax: number
  push(type: string, tag: string, nesting: number): { meta: Record<string, unknown> }
}
type InlineRule = (state: InlineState, silent: boolean) => boolean

/** `[[target]]` / `[[target|alias]]` → the `<a data-wikilink>` shape the
 * wikiLink mark's parseDOM accepts. Registered after `escape`, so a serializer-
 * escaped `\[\[` is consumed as literal brackets and never reaches here. */
const wikiLinkRule: InlineRule = (state, silent) => {
  const { src } = state
  const start = state.pos
  if (src.charCodeAt(start) !== 0x5b /* [ */) return false
  if (src.charCodeAt(start + 1) !== 0x5b) return false
  const close = src.indexOf("]]", start + 2)
  if (close === -1 || close + 2 > state.posMax) return false
  const rawInner = src.slice(start + 2, close)
  if (rawInner.length === 0 || /[[\]\n]/.test(rawInner)) return false
  const pipe = rawInner.indexOf("|")
  const target = (pipe === -1 ? rawInner : rawInner.slice(0, pipe)).trim()
  if (target === "") return false
  const alias = pipe === -1 ? "" : rawInner.slice(pipe + 1)
  const display = alias.length > 0 ? alias : target
  if (!silent) {
    const token = state.push("wikiLink", "", 0)
    token.meta = { target, display }
  }
  state.pos = close + 2
  return true
}

/** `$latex$` → the `<span data-type="inline-math">` shape the inlineMath node's
 * parseDOM accepts. Registered after `escape`, so a serializer-escaped `\$`
 * (which is how ALL literal dollars are emitted) is consumed as a literal. */
const inlineMathRule: InlineRule = (state, silent) => {
  const { src } = state
  const start = state.pos
  if (src.charCodeAt(start) !== 0x24 /* $ */) return false
  const close = src.indexOf("$", start + 1)
  if (close === -1 || close + 1 > state.posMax) return false
  const latex = src.slice(start + 1, close)
  if (latex.length === 0 || latex.includes("\n")) return false
  if (!silent) {
    const token = state.push("inlineMath", "", 0)
    token.meta = { latex }
  }
  state.pos = close + 1
  return true
}

// ── The scoped instance ────────────────────────────────────────────────────

// No `linkify` (unlike the paste path's `markdownToHtml`): the dialect always
// serializes links as explicit `[text](href)`, so auto-linking a bare URL/email
// would give unlinked plain text a spurious `link` mark on re-parse — a silent
// mutation of unedited text the round-trip contract exists to prevent.
const md = new MarkdownIt({ html: true }).use(taskLists)

md.inline.ruler.before("link", "runeWikiLink", wikiLinkRule)
md.inline.ruler.before("link", "runeInlineMath", inlineMathRule)

md.renderer.rules.wikiLink = (tokens, idx) => {
  const { target, display } = tokens[idx]!.meta as {
    target: string
    display: string
  }
  return `<a data-wikilink="${md.utils.escapeHtml(target)}">${md.utils.escapeHtml(display)}</a>`
}
md.renderer.rules.inlineMath = (tokens, idx) => {
  const { latex } = tokens[idx]!.meta as { latex: string }
  return `<span data-type="inline-math" data-latex="${md.utils.escapeHtml(latex)}"></span>`
}
// Neutralize every raw-HTML token to the mark-contract whitelist. Only these
// two token types carry model-supplied raw HTML; code fences / inline code are
// separate token types markdown-it already escapes, and markdown-produced
// elements (`<strong>`, `<a href>`, …) never pass through here.
md.renderer.rules.html_inline = (tokens, idx) => sanitizeRawHtml(tokens[idx]!.content)
md.renderer.rules.html_block = (tokens, idx) => sanitizeRawHtml(tokens[idx]!.content)

const browserParseHTML: ParseHTML = (html) =>
  new DOMParser().parseFromString(html, "text/html")

/** Render the styling-aware AI dialect to rune-pipeline HTML (sanitized raw
 * HTML + wikiLink/math shapes + the shared heading axis shift). */
function aiMarkdownToHtml(markdown: string): string {
  return shiftHeadings(md.render(markdown))
}

/**
 * markdown-it renders a standalone image as `<p><img></p>`; rune's `image` is a
 * BLOCK node, so PM's full-doc parse strands the emptied `<p>` above it. Unwrap
 * each lone-image paragraph to the bare `<img>`. Mirrors `markdownToDoc`'s
 * private helper — kept a small local copy rather than exporting from the paste
 * path (N=2 duplication, not shared-helper debt).
 */
function unwrapLoneImageParagraphs(doc: Document) {
  for (const p of Array.from(doc.body.querySelectorAll("p"))) {
    const img = p.children.length === 1 ? p.firstElementChild : null
    if (!img || img.tagName !== "IMG") continue
    if (p.textContent?.replace(/\s/g, "") !== "") continue
    p.replaceWith(img)
  }
}

/**
 * rune's `blockquote` and its list blocks hold `inline*` (flat schema — no
 * nested paragraph). markdown-it wraps their content in `<p>` (loose lists /
 * blockquotes) and pads it with newlines. Left alone, PM splits the inner
 * paragraph OUT of the block and the pad-newlines re-parse as stray hardBreaks.
 * Unwrap each `<p>` to its inline children and drop whitespace-only text nodes
 * directly under the container, so the block receives the clean inline run it
 * expects — the round-trip inverse of the block serializers' single-line output.
 */
function normalizeInlineContainers(doc: Document) {
  for (const el of Array.from(doc.querySelectorAll("blockquote, li"))) {
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === 3 /* text */) {
        if ((child.textContent ?? "").trim() === "") el.removeChild(child)
      } else if (child.nodeType === 1 && (child as Element).tagName === "P") {
        ;(child as Element).replaceWith(...Array.from(child.childNodes))
      }
    }
  }
}

/**
 * markdown-it renders a fenced/indented code block as `<pre><code
 * class="language-x">body\n</code></pre>` — with a trailing newline the fence
 * grammar always appends, and an inner `<code>` that rune's inline `code` mark
 * (`tag: "code"`) would bind to, smearing a spurious mark across the codeBlock
 * text. Rebuild each `<pre>` so the literal body is a bare text child (the code
 * mark has nothing to attach to) and an EMPTY `<code>` retains the language
 * class the codeBlock's `querySelector("code")` language parse relies on. Drop
 * exactly one trailing newline (the fence's, never the author's).
 */
function normalizeCodeBlocks(doc: Document) {
  for (const pre of Array.from(doc.querySelectorAll("pre"))) {
    const cls = pre.querySelector("code")?.getAttribute("class") ?? null
    let body = pre.textContent ?? ""
    if (body.endsWith("\n")) body = body.slice(0, -1)
    while (pre.firstChild) pre.removeChild(pre.firstChild)
    if (cls) {
      const holder = doc.createElement("code")
      holder.setAttribute("class", cls)
      pre.appendChild(holder)
    }
    pre.appendChild(doc.createTextNode(body))
  }
}

/**
 * Parse the styling-aware AI markdown dialect into a complete rune doc as
 * ProseMirror JSON. The read-side inverse of `exportMarkdown`, gated by the
 * round-trip property test (api/export/__tests__/roundtrip.test.ts).
 *
 * Same signature/return convention as `markdownToDoc`: editor-less (only a
 * `Schema`), editor-less-but-NOT-DOM-less (pass a `parseHTML` backed by a
 * headless DOM in Node/worker contexts; the default uses the global
 * `DOMParser`). Returns `{ type: "doc", content: [...] }`.
 *
 * NOTE: `exportMarkdown` emits an HTML-comment separator (`<!-- -->`) between
 * two adjacent numbered runs to stop CommonMark from merging them into one
 * list; that separator does NOT round-trip here (it neutralizes to a literal-
 * text paragraph). So a full multi-run/multi-column EXPORTED doc is not yet a
 * supported parse input — the editing model feeds per-block chunks, which have
 * no such separator.
 */
export function parseAiMarkdown(
  markdown: string,
  schema: Schema,
  parseHTML: ParseHTML = browserParseHTML,
): JSONContent {
  const dom = parseHTML(aiMarkdownToHtml(markdown))
  normalizeInlineContainers(dom)
  transformPastedHTMLDoc(dom, collectKnownBlockTags(schema))
  normalizeCodeBlocks(dom)
  unwrapLoneImageParagraphs(dom)
  // Default whitespace handling (NOT preserveWhitespace: true, unlike the paste
  // import): markdown-it's block padding must collapse — the block serializers
  // emit single trimmed lines, so preserving it would re-introduce the newline
  // artifacts normalizeInlineContainers just removed. codeBlock keeps its own
  // `preserveWhitespace: "full"` parseDOM rule, so fenced bodies stay literal.
  const doc = PMDOMParser.fromSchema(schema).parse(dom.body)
  return doc.toJSON() as JSONContent
}
