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
// The exporter's inter-ordered-list-run separator (markdown.ts's
// ORDERED_SEPARATOR): a standalone HTML comment, alone in its own block, that
// `exportMarkdown` splices between two adjacent numbered-list runs so
// CommonMark doesn't merge them into one continuously-numbered list (always
// at a columnLayout boundary — see AV-1 in markdown.ts). markdown-it already
// tokenizes the two runs as separate `ordered_list_open`/`_close` pairs
// regardless (the comment interrupts list continuation at the block-grammar
// level); the ONLY job left here is to make the comment ITSELF vanish rather
// than survive as a literal-text node — left alone, that text would land
// between the two `<ol>`s and get wrapped into a spurious paragraph on parse.
// Scoped to the exact standalone form (`html_block`, trimmed content ===
// "<!-- -->"): a comment mixed into running text is a DIFFERENT token type
// (`html_inline`) and is untouched by this branch, unaffected by this special
// case.
const ORDERED_RUN_SEPARATOR = "<!-- -->"

// Neutralize every raw-HTML token to the mark-contract whitelist. Only these
// two token types carry model-supplied raw HTML; code fences / inline code are
// separate token types markdown-it already escapes, and markdown-produced
// elements (`<strong>`, `<a href>`, …) never pass through here.
md.renderer.rules.html_inline = (tokens, idx) => sanitizeRawHtml(tokens[idx]!.content)
md.renderer.rules.html_block = (tokens, idx) => {
  const raw = tokens[idx]!.content
  if (raw.trim() === ORDERED_RUN_SEPARATOR) return ""
  return sanitizeRawHtml(raw)
}

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
 * `serializeTableMarkdown` (blocks/Table/markdown.ts) synthesizes a
 * single-space-per-cell header row (`|   |   |`) for a header-less table —
 * GFM pipe-table syntax has no way to express "no header" — so on re-parse
 * markdown-it turns that phantom row into a real `<thead><tr><th>`. Left
 * alone, PM would read that back as an actual header row the original doc
 * never had, permanently failing the round-trip guard for every header-less
 * table. Drop any `<thead>` whose every `<th>` is empty, but only when the
 * table still has at least one `<tbody>` row to fall back to: an all-empty
 * table (empty header AND no body rows) has no signal to distinguish
 * "synthetic" from "genuinely empty header", so it is left alone and
 * degrades to header-less on re-parse — a rare case that was already
 * uneditable before this fix.
 */
function dropSyntheticEmptyTableHeader(doc: Document) {
  for (const thead of Array.from(doc.querySelectorAll("table > thead"))) {
    const ths = Array.from(thead.querySelectorAll("th"))
    if (ths.length === 0) continue
    const allEmpty = ths.every((th) => (th.textContent ?? "").trim() === "")
    if (!allEmpty) continue
    const hasBodyRow = thead.parentElement?.querySelector("tbody tr") != null
    if (!hasBodyRow) continue
    thead.remove()
  }
}

/**
 * markdown-it renders table-cell content BARE — `<td>line1<br>line2</td>`,
 * never `<p>`-wrapped (verified: the table-cell context is the one place
 * its renderer skips the paragraph wrapper it uses everywhere else). Left
 * alone, PM's DOMParser would auto-wrap the WHOLE cell into a single
 * `tableParagraph`, with any `<br>` surviving inside it as a `hardBreak` —
 * one paragraph, not the STACKED-tableParagraph shape `serializeTableMarkdown`
 * (blocks/Table/markdown.ts) uses to represent a multi-line cell on export
 * (`parts.join("<br>")` across sibling tableParagraphs). Explicitly split
 * each td/th's DIRECT children at every `<br>` into its own `<p>` group,
 * dropping the `<br>`s, so `tableParagraph`'s parseDOM rule (`tag: "p"`,
 * parent td/th) claims each line individually and the cell round-trips to
 * N sibling tableParagraphs, matching the export shape.
 *
 * A cell with NO `<br>` among its direct children is a no-op — a single
 * bare-text cell still auto-wraps into one tableParagraph as before.
 * Leading/trailing/consecutive `<br>`s produce empty groups, kept as an
 * empty `<p>` (an empty tableParagraph — the round-trip shape for a
 * genuinely blank line, mirroring `cellPara("")` in the round-trip tests).
 *
 * Only DIRECT-child `<br>`s split — one nested inside a mark
 * (`<strong>bold<br>text</strong>`) is untouched here; that shape converges
 * post-parse via `TableCellNormalization` (blocks/Table/normalization.ts),
 * the PM-level safety net for every path (not just this AI-parse path).
 */
function splitCellLineBreaks(doc: Document): void {
  for (const cell of Array.from(doc.querySelectorAll("td, th"))) {
    const children = Array.from(cell.childNodes)
    if (!children.some((n) => n.nodeType === 1 && (n as Element).tagName === "BR")) continue

    const groups: ChildNode[][] = [[]]
    for (const child of children) {
      if (child.nodeType === 1 && (child as Element).tagName === "BR") {
        groups.push([])
      } else {
        groups[groups.length - 1]!.push(child)
      }
    }

    while (cell.firstChild) cell.removeChild(cell.firstChild)
    for (const group of groups) {
      const p = doc.createElement("p")
      for (const node of group) p.appendChild(node)
      cell.appendChild(p)
    }
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
 * NOTE: `exportMarkdown` emits a standalone HTML-comment separator
 * (`<!-- -->`, alone in its own block) between two adjacent numbered-list
 * runs at a columnLayout boundary, to stop CommonMark from merging them into
 * one continuously-numbered list. This parser consumes that standalone form
 * silently (no node produced), so the two runs on either side survive
 * unmerged with their own `start`. It does NOT reconstruct the columnLayout
 * itself, though — a multi-column EXPORTED doc still flattens to root-level
 * blocks here, same as every other consumer of the flattened markdown. A
 * `<!-- -->` embedded inline in ordinary text is a different token path
 * (html_inline) and round-trips as before.
 */
export function parseAiMarkdown(
  markdown: string,
  schema: Schema,
  parseHTML: ParseHTML = browserParseHTML,
): JSONContent {
  const dom = parseHTML(aiMarkdownToHtml(markdown))
  // normalizeInlineContainers runs first thing inside transformPastedHTMLDoc.
  transformPastedHTMLDoc(dom, collectKnownBlockTags(schema))
  normalizeCodeBlocks(dom)
  unwrapLoneImageParagraphs(dom)
  dropSyntheticEmptyTableHeader(dom)
  splitCellLineBreaks(dom)
  // Default whitespace handling (NOT preserveWhitespace: true, unlike the paste
  // import): markdown-it's block padding must collapse — the block serializers
  // emit single trimmed lines, so preserving it would re-introduce the newline
  // artifacts normalizeInlineContainers just removed. codeBlock keeps its own
  // `preserveWhitespace: "full"` parseDOM rule, so fenced bodies stay literal.
  const doc = PMDOMParser.fromSchema(schema).parse(dom.body)
  return doc.toJSON() as JSONContent
}
