// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The central inline codec — ALL nine marks map here, never per-block
// (markdown-storage PRD §6.2). Five ride native markdown syntax (bold /
// italic / strike / code / link). The other four use the forms the D4
// Obsidian field test settled (2026-07-29):
//
//   textStyle bg     ==text==                      (backgroundColor: yellow —
//                                                   the HIGHLIGHT_COLOR_NAME
//                                                   anchor; Obsidian-native)
//                    <mark data-color="blue">…     (the other 8 palette names;
//                                                   Obsidian degrades to its
//                                                   default yellow — visible)
//   textStyle fg     <span data-text-color="…">…   (no markdown/Obsidian form
//                                                   exists; invisible there,
//                                                   data preserved)
//   underline        <u>…</u>
//   internalRef      <mention-page id="…" alias="true">…</mention-page>
//                    <mention-block id="…">…</mention-block>
//   wikiLink         [[target]] / [[target|display]]  (Obsidian-native)
//
// Raw HTML rides mdast inline `html` nodes — one node per tag — because a
// text node would get bracket/angle-escaped by remark-stringify. On parse,
// micromark hands tags back as individual inline html nodes; `openMark`
// whitelists them and the matcher applies the enclosed span. Anything NOT
// whitelisted (a bare <span>, an unmatched </u>, unknown tags) degrades to
// literal text — declared-lossy, never a crash, never silently dropped.
//
// `==` is a promoter over plain text (remark has no highlight grammar), with
// Obsidian-style flanking: the opener must touch non-space on its right, the
// closer non-space on its left, neither may sit in a longer `=` run, and a
// span never crosses a line break. Prose like `a == b == c` therefore stays
// literal, while literally-typed `==x==` DOES promote — same reading Obsidian
// gives the same bytes. A background run whose text edges would break
// flanking (leading/trailing space or `=`) falls back to the `<mark>` form.
import type { JSONContent } from "@tiptap/core"
import type { PhrasingContent } from "mdast"
import { HIGHLIGHT_COLOR_NAME, normalizeAttrValue } from "../shared/color-tokens"
import { escapeHtmlAttr, unescapeHtmlAttr } from "./htmlAttr"
import { stringifyMdast } from "./pipeline"

export type Mark = { type: string; attrs?: Record<string, unknown> }

// ─── shared helpers ─────────────────────────────────────────────────────────

export function mdastText(node: unknown): string {
  const n = node as { value?: unknown; children?: unknown }
  if (typeof n.value === "string") return n.value
  if (Array.isArray(n.children)) return n.children.map(mdastText).join("")
  return ""
}

/**
 * Append a mark to a stack, keeping the stack canonical: at most one mark of
 * any given type.
 *
 * `textStyle` merges its two channels — `==<span data-text-color>` layers must
 * collapse into the single two-channel mark PM stores. Every other type is
 * idempotent: nesting the same delimiter twice (`_a _b_ c_`, or the `****`
 * an ambiguous serialization re-parses into) is a source-level quirk, not two
 * marks. PM would drop the duplicate the moment the doc is applied, so
 * producing one here keeps parse output equal to what the editor holds — and
 * keeps `duplicateMarks` (the health invariant the gate asserts) at zero.
 */
function addMark(marks: Mark[], extra: Mark): Mark[] {
  const existing = marks.find((mark) => mark.type === extra.type)
  if (!existing) return [...marks, extra]
  if (extra.type !== "textStyle") return marks
  return marks.map((mark) =>
    mark === existing
      ? { type: "textStyle", attrs: { ...existing.attrs, ...extra.attrs } }
      : mark,
  )
}

// ─── mdast → PM ─────────────────────────────────────────────────────────────

const WIKI_LINK = /\[\[([^[\]|\n]+?)(?:\|([^[\]\n]+?))?\]\]/g

/**
 * `<br>` is a CLAIMED tag — the one HTML form rune has to own rather than
 * degrade, because a GFM table row cannot span physical lines.
 *
 * The editor lets Shift+Enter put a hard break inside a table cell, so that
 * break needs a markdown spelling that survives a row. The native backslash form
 * does not: `| line1\` ends the row, and the continuation becomes a second row.
 * `<br>` is what every renderer that matters — GitHub, Obsidian, any HTML
 * pipeline — reads as a break inside a cell.
 *
 * Reading is uniform (all three spellings, anywhere, become `hardBreak`), so a
 * `<br>` in an Obsidian note stops showing up as four literal characters in the
 * editor. WRITING is context-dependent: only table cells emit `<br>`, everywhere
 * else keeps native markdown. Rewriting every paragraph break to HTML would put
 * tags into files that never had them.
 */
const BR_TAG = /^<br\s*\/?>$/i

/** Whitelisted open tag → the mark it carries (null = not ours). */
function openMark(value: string): { tag: string; mark: Mark } | null {
  const v = value.trim()
  if (v === "<u>") return { tag: "u", mark: { type: "underline" } }
  const markTag = /^<mark(?:\s+data-color="([^"]*)")?\s*>$/.exec(v)
  if (markTag) {
    const named = normalizeAttrValue(markTag[1] ?? null, "background")
    const backgroundColor =
      named && named !== "default" ? named : HIGHLIGHT_COLOR_NAME
    return { tag: "mark", mark: { type: "textStyle", attrs: { backgroundColor } } }
  }
  const span = /^<span((?:\s+data-(?:text|background)-color="[^"]*")+)\s*>$/.exec(v)
  if (span) {
    const attrs: Record<string, unknown> = {}
    const text = /data-text-color="([^"]*)"/.exec(span[1]!)
    const background = /data-background-color="([^"]*)"/.exec(span[1]!)
    if (text) attrs.textColor = text[1]
    if (background) attrs.backgroundColor = background[1]
    return { tag: "span", mark: { type: "textStyle", attrs } }
  }
  const mention = /^<(mention-page|mention-block)\s+id="([^"]*)"(\s+alias="true")?\s*>$/.exec(v)
  if (mention && mention[2]) {
    return {
      tag: mention[1]!,
      mark: {
        type: "internalRef",
        attrs: {
          kind: mention[1] === "mention-page" ? "page" : "block",
          target: unescapeHtmlAttr(mention[2]),
          ...(mention[3] ? { alias: true } : {}),
        },
      },
    }
  }
  return null
}

interface HighlightSpan {
  openIndex: number
  closeNode: number
  closeIndex: number
}

/** Find the closer for a `==` opened at work[openNode] just before `from`:
 *  the next `==` whose left neighbor is non-space/non-`=` content, not in a
 *  longer `=` run, before any line break or mdast `break` node. */
function findHighlightClose(
  work: readonly PhrasingContent[],
  openNode: number,
  from: number,
): { closeNode: number; closeIndex: number } | null {
  let prev = ""
  for (let j = openNode; j < work.length; j++) {
    const n = work[j]!
    if (n.type === "break") return null
    if (n.type !== "text") {
      prev = "x" // any inline node presents non-space content to the closer
      continue
    }
    const v = n.value
    for (let m = j === openNode ? from : 0; m < v.length; m++) {
      const ch = v[m]!
      if (ch === "\n") return null
      if (ch === "=" && v[m + 1] === "=" && v[m + 2] !== "=" && prev && !/[\s=]/.test(prev)) {
        return { closeNode: j, closeIndex: m }
      }
      prev = ch
    }
  }
  return null
}

/** First flanking-valid `==…==` span opening inside the text node work[i]. */
function findHighlight(work: readonly PhrasingContent[], i: number): HighlightSpan | null {
  const first = work[i]!
  if (first.type !== "text") return null
  const v = first.value
  for (let k = v.indexOf("=="); k !== -1; k = v.indexOf("==", k + 1)) {
    if (v[k - 1] === "=" || v[k + 2] === "=") continue // longer `=` run
    const after = work[i + 1]
    const next =
      k + 2 < v.length
        ? v[k + 2]!
        : after
          ? after.type === "text"
            ? (after.value[0] ?? null)
            : "x"
          : null
    if (next == null || /\s/.test(next)) continue // opener must touch content
    const close = findHighlightClose(work, i, k + 2)
    if (close) return { openIndex: k, ...close }
  }
  return null
}

/**
 * `slice` recovers a node's exact source bytes; see `makeSlicer` in convert.ts.
 * It is needed wherever mdast's `value` is not the source — a tag whose opening
 * spans lines loses its continuation indentation to CommonMark long before the
 * codec runs, and a footnote reference has no `value` at all. Threaded rather
 * than module-scoped so the walker stays pure and reentrant.
 */
export type SliceSource = (node: PhrasingContent) => string | null

const NO_SLICE: SliceSource = () => null

export function inlineToPM(
  nodes: PhrasingContent[],
  marks: Mark[] = [],
  slice: SliceSource = NO_SLICE,
): JSONContent[] {
  const out: JSONContent[] = []
  const withMarks = (text: string, extra?: Mark): void => {
    if (!text) return
    const all = extra ? addMark(marks, extra) : marks
    // A soft line break arrives as "\n" inside a text value and STAYS there.
    //
    // It used to be split into a `hardBreak`, on the belief that PM inline text
    // must not carry newlines. It may — nothing in the schema forbids it, and
    // the editor renders paragraphs at `white-space: normal` (rune ships no
    // ProseMirror base stylesheet), where a newline collapses to a space. That
    // is exactly what a soft wrap means in Markdown.
    //
    // Splitting was the largest fidelity defect measured: a soft wrap is a
    // SPACE, a hard break is a LINE BREAK, so every wrapped paragraph came back
    // rendering differently than its author wrote it — and, being symmetric,
    // it passed the structural gate every time (§3.9 C5).
    //
    // The write side already keeps the two apart and needed no change: a text
    // node holding "\n" serializes as a bare newline, while a `hardBreak` node
    // serializes as `\` + newline (`leafToMdast`'s `break`). Real hard breaks
    // are therefore still real hard breaks.
    out.push({ type: "text", text, ...(all.length ? { marks: all } : {}) })
  }
  /** Text segments get a wikiLink scan — `[[…]]` is plain text to remark. */
  const pushText = (value: string): void => {
    let last = 0
    WIKI_LINK.lastIndex = 0
    for (let m = WIKI_LINK.exec(value); m; m = WIKI_LINK.exec(value)) {
      withMarks(value.slice(last, m.index))
      out.push({
        type: "text",
        text: m[2] ?? m[1]!,
        marks: [...marks, { type: "wikiLink", attrs: { target: m[1]! } }],
      })
      last = m.index + m[0].length
    }
    withMarks(value.slice(last))
  }

  // Mutable working copy: promoting a `==…==` span consumes a PREFIX of the
  // closing text node, so the remainder is written back in place and the
  // scan resumes on it.
  const work = [...nodes]
  let i = 0
  while (i < work.length) {
    const node = work[i]!
    if (node.type === "html" && BR_TAG.test(node.value.trim())) {
      out.push({ type: "hardBreak" })
      i++
      continue
    }
    if (node.type === "html") {
      const open = openMark(node.value)
      if (open) {
        // Find the matching close tag, counting same-tag nesting.
        const close = `</${open.tag}>`
        let depth = 1
        let j = i + 1
        for (; j < work.length; j++) {
          const candidate = work[j]!
          if (candidate.type !== "html") continue
          if (candidate.value.trim() === close) {
            depth--
            if (depth === 0) break
          } else if (openMark(candidate.value)?.tag === open.tag) {
            depth++
          }
        }
        if (j < work.length) {
          out.push(...inlineToPM(work.slice(i + 1, j), addMark(marks, open.mark), slice))
          i = j + 1
          continue
        }
        // Unmatched open tag: fall through to the literal default below.
      }
    }
    if (node.type === "text") {
      const hl = findHighlight(work, i)
      if (hl) {
        const pre = node.value.slice(0, hl.openIndex)
        if (pre) pushText(pre)
        const middle: PhrasingContent[] = []
        if (hl.closeNode === i) {
          middle.push({ type: "text", value: node.value.slice(hl.openIndex + 2, hl.closeIndex) })
        } else {
          const head = node.value.slice(hl.openIndex + 2)
          if (head) middle.push({ type: "text", value: head })
          middle.push(...work.slice(i + 1, hl.closeNode))
          const closer = work[hl.closeNode]! as { value: string }
          const tail = closer.value.slice(0, hl.closeIndex)
          if (tail) middle.push({ type: "text", value: tail })
        }
        out.push(
          ...inlineToPM(
            middle,
            addMark(marks, {
              type: "textStyle",
              attrs: { backgroundColor: HIGHLIGHT_COLOR_NAME },
            }),
            slice,
          ),
        )
        const closer = work[hl.closeNode]! as { value: string }
        const rest = closer.value.slice(hl.closeIndex + 2)
        if (rest) {
          work[hl.closeNode] = { type: "text", value: rest }
          i = hl.closeNode
        } else {
          i = hl.closeNode + 1
        }
        continue
      }
    }
    switch (node.type) {
      case "text":
        pushText(node.value)
        break
      case "strong":
        out.push(...inlineToPM(node.children, addMark(marks, { type: "bold" }), slice))
        break
      case "emphasis":
        out.push(...inlineToPM(node.children, addMark(marks, { type: "italic" }), slice))
        break
      case "delete":
        out.push(...inlineToPM(node.children, addMark(marks, { type: "strike" }), slice))
        break
      case "inlineCode":
        withMarks(node.value, { type: "code" })
        break
      case "link":
        out.push(
          ...inlineToPM(
            node.children,
            addMark(marks, {
              type: "link",
              attrs: {
                href: node.url,
                ...(typeof node.title === "string" ? { title: node.title } : {}),
              },
            }),
            slice,
          ),
        )
        break
      case "break":
        out.push({ type: "hardBreak" })
        break
      case "image":
        // An image sitting ALONGSIDE other inline content. A paragraph whose
        // only child is an image never reaches here — `emitBlock` promotes that
        // to a first-class `image` block before calling in — so this is the
        // shape rune's flat schema has no node for: it owns an image BLOCK and
        // no inline image.
        //
        // It used to degrade to `node.alt`, which threw the URL away. Measured
        // across 800 external files: 327 image URLs lost in 80 files — 73% of
        // every file that contains an image, because a README badge row is
        // exactly this shape (`![build](https://img.shields.io/…)`). The loss
        // was invisible to the structural gate: alt text went in, alt text came
        // back, and the two agreed.
        //
        // The raw carrier already means "source rune cannot represent", so the
        // bytes are kept instead. Reconstruction is needed as well as the slice
        // because the common case is inside a list item, where slicing is
        // refused (the offsets still carry the container's indentation).
        out.push({
          type: "rawInline",
          attrs: { source: slice(node) ?? imageSource(node) },
          ...(marks.length ? { marks } : {}),
        })
        break
      case "inlineMath":
        // Both sides of this mapping already existed and were never connected:
        // mdast has `inlineMath`, and rune has an `inlineMath` atom whose input
        // rule is `$$latex$$` (inlines/InlineMath/node.ts). Flattening it to
        // `node.value` dropped the delimiters, so a formula read from a file
        // became prose permanently — and the write side had no case for the PM
        // node at all, so a formula the USER typed was deleted outright on save.
        out.push({
          type: "inlineMath",
          attrs: { latex: node.value },
          ...(marks.length ? { marks } : {}),
        })
        break
      case "html":
        // A2 — the last resort for inline source. Everything rune actually reads
        // has already been taken above: `<br>` at the top of the loop, the paired
        // mark carriers (`<u>`, `<mark data-color>`, colour spans) by `openMark`,
        // and `==…==` by the highlight promoter. What is left is an unrecognised
        // tag, a stray closer, a comment, or a multi-line MDX component — source
        // with no rune meaning, which used to degrade to text and pick up a `\<`
        // escape on every save.
        //
        // The surrounding `marks` ride along: this node can sit inside a bold or
        // italic run, and the run must not be split by it.
        //
        // The SLICE is preferred over `value` — they differ when the tag's
        // opening spans lines, because CommonMark strips the leading whitespace
        // of a paragraph's continuation lines before mdast is built, so `value`
        // never held the indentation. `value` is the fallback for a caller that
        // supplied no source, which then behaves exactly as it did before.
        out.push({
          type: "rawInline",
          attrs: { source: slice(node) ?? node.value },
          ...(marks.length ? { marks } : {}),
        })
        break
      default: {
        // B2b — anything with no rune mapping. `mdastText` returns "" for a node
        // that has no text children, and `footnoteReference` is exactly that
        // shape, so `[^1]` used to VANISH: content loss, not a downgrade.
        //
        // The raw carrier covers it when the source is recoverable. Falling back
        // to `mdastText` keeps the previous behaviour for a caller with no source
        // — still better than nothing, since most `default:` nodes do have text.
        const source = slice(node)
        if (source) {
          out.push({
            type: "rawInline",
            attrs: { source },
            ...(marks.length ? { marks } : {}),
          })
          break
        }
        withMarks(mdastText(node))
      }
    }
    i++
  }
  return settleBoundarySoftWraps(mergeAdjacentText(out))
}

/**
 * `![alt](url "title")` rebuilt from the node, for the positions where a source
 * slice is refused — which is every image inside a list item or a blockquote,
 * i.e. most of them.
 *
 * The URL is wrapped in `<>` only when it contains whitespace or parentheses,
 * matching what CommonMark requires and what `mdast-util-to-markdown` itself
 * emits, so a plain URL stays byte-identical to how it was written.
 */
function imageSource(node: { url: string; alt?: string | null; title?: string | null }): string {
  // At prefixed positions the source slice includes list/quote indentation and
  // cannot be reused. Let the same mdast writer used by the document codec
  // rebuild the token so decoded `]`, quotes and backslashes are escaped back
  // into valid Markdown. Hand-assembling the string kept the URL for one save
  // but produced an invalid token that degraded to text on the next parse.
  return stringifyMdast({
    type: "root",
    children: [
      {
        type: "paragraph",
        children: [
          {
            type: "image",
            url: node.url,
            alt: node.alt ?? "",
            title: node.title ?? null,
          },
        ],
      },
    ],
  }).replace(/\n$/, "")
}

/**
 * Collapses the one soft-wrap position the writer cannot reproduce.
 *
 * Keeping `\n` inside text values makes soft wraps round-trip — but only where
 * `mdast-util-to-markdown` can put a newline back. Measured across every
 * position a newline can occupy:
 *
 *   inside a text value             `alpha\nbravo`            → preserved
 *   starting one, after a sibling   `<u>a</u>\nbravo`         → preserved
 *   ending the LAST text value      `alpha\n`                 → preserved
 *   ending one, BEFORE a sibling    `alpha\n` + `<u>bravo</u>`→ becomes a space
 *
 * Only the last shape loses it, and the writer is right to: a newline there
 * would have to be emitted between two inline constructs, where it is not a
 * soft wrap any more. Rendering is unaffected — a soft wrap and a space are the
 * same space — so the reader adopts the writer's answer instead of producing a
 * document the writer would immediately change. Without this the two disagree
 * and every such paragraph reports a structural difference across one save.
 */
function settleBoundarySoftWraps(nodes: JSONContent[]): JSONContent[] {
  let patched: JSONContent[] | null = null
  for (let index = 0; index < nodes.length - 1; index += 1) {
    const node = nodes[index]!
    if (node.type !== "text" || !node.text?.endsWith("\n")) continue
    patched ??= [...nodes]
    patched[index] = { ...node, text: `${node.text.slice(0, -1)} ` }
  }
  return patched ?? nodes
}

/**
 * Joins neighbouring text nodes that carry the same marks.
 *
 * The walker emits one node per mdast child, so `*a*` split across two mdast
 * nodes (or `_a _b_ c_`, whose duplicate emphasis `addMark` collapses) arrives
 * as several PM nodes with identical marks. ProseMirror stores that as ONE text
 * node — adjacent same-mark text is not a representable distinction — so
 * emitting several here would make the parse output differ from the document
 * the editor actually holds, and a save/reopen comparison would report a change
 * that never happened. Canonicalizing on the way out is the fix; teaching the
 * comparator to ignore it would only hide it.
 */
function mergeAdjacentText(nodes: JSONContent[]): JSONContent[] {
  const out: JSONContent[] = []
  for (const node of nodes) {
    const prev = out.at(-1)
    if (
      prev &&
      prev.type === "text" &&
      node.type === "text" &&
      JSON.stringify(prev.marks ?? null) === JSON.stringify(node.marks ?? null)
    ) {
      out[out.length - 1] = { ...prev, text: `${prev.text ?? ""}${node.text ?? ""}` }
      continue
    }
    out.push(node)
  }
  return out
}

// ─── PM → mdast ─────────────────────────────────────────────────────────────

/** The highlight channel of a run's textStyle mark, or null when it carries
 *  none. Marks-only, so the serialize layers key on it the same way they key
 *  on every other mark. A node without marks (a hard break) yields null and
 *  therefore ends the run, which is what `highlightDelimitable` needs. */
const backgroundColorOfMarks = (marks: Mark[]): string | null => {
  const bg = marks.find((mark) => mark.type === "textStyle")?.attrs?.backgroundColor
  return typeof bg === "string" ? bg : null
}

/** Can this run body sit directly between `==` delimiters? Text edges must
 *  satisfy Obsidian flanking (non-space, non-`=`), and hard breaks cannot
 *  live inside a highlight. Non-text edges (strong, html, code) always
 *  stringify to a non-space char. */
function highlightDelimitable(body: PhrasingContent[]): boolean {
  if (body.some((n) => n.type === "break")) return false
  const edge = (n: PhrasingContent, side: "first" | "last"): string => {
    if (n.type !== "text") return "x"
    return (side === "first" ? n.value[0] : n.value[n.value.length - 1]) ?? ""
  }
  const first = edge(body[0]!, "first")
  const last = edge(body[body.length - 1]!, "last")
  return !!first && !!last && !/[\s=]/.test(first) && !/[\s=]/.test(last)
}

function wrapHighlightRun(bg: string, body: PhrasingContent[]): PhrasingContent[] {
  if (body.length === 0) return []
  if (bg === HIGHLIGHT_COLOR_NAME && highlightDelimitable(body)) {
    return [{ type: "html", value: "==" }, ...body, { type: "html", value: "==" }]
  }
  const open =
    bg === HIGHLIGHT_COLOR_NAME ? "<mark>" : `<mark data-color="${escapeHtmlAttr(bg)}">`
  return [{ type: "html", value: open }, ...body, { type: "html", value: "</mark>" }]
}

/**
 * Every mark is a RUN property, so serialization groups before it wraps.
 *
 * Per-node wrapping cannot express a shared mark: `_You **can** combine them_`
 * is three PM runs that all carry italic, and wrapping each on its own emits
 * `*You *`, `***can***`, `* combine them*`. Those delimiters abut, remark
 * escapes the seams, and the result re-parses with a DUPLICATED bold — the
 * same class of damage as `**a****b**`, whose escape count then doubles on
 * every save. `wrapHighlightRun` already avoided this for `==`; the fix is to
 * apply its shape to every layer instead of only that one.
 *
 * LAYERS is ordered OUTERMOST first, and that order is the contract:
 *
 *   ==highlight== ▸ <mention> ▸ <span color> ▸ <u> ▸ [link] ▸ ** ▸ * ▸ ~~ ▸ `code`
 *
 * Raw HTML outside, native syntax in the middle, verbatim innermost — the rule
 * `api/export/serializeInline.ts` documents. Verbatim has to be innermost
 * because its content re-parses as a literal sub-grammar: `` `**x**` `` is a
 * code span holding four asterisks, never bold+code, so any other mark's
 * syntax has to sit outside the backticks to survive.
 */
type SerializeLayer = {
  /** Grouping key for this layer, or null when the node is outside it. */
  key: (marks: Mark[]) => string | null
  wrap: (key: string, body: PhrasingContent[], marks: Mark[]) => PhrasingContent[]
}

const tagPair = (open: string, close: string, body: PhrasingContent[]): PhrasingContent[] => [
  { type: "html", value: open },
  ...body,
  { type: "html", value: close },
]

const markOf = (marks: Mark[], type: string): Mark | undefined =>
  marks.find((mark) => mark.type === type)

const LAYERS: readonly SerializeLayer[] = [
  {
    key: (marks) => backgroundColorOfMarks(marks),
    wrap: (key, body) => wrapHighlightRun(key, body),
  },
  {
    key: (marks) => {
      const ref = markOf(marks, "internalRef")
      const kind = ref?.attrs?.kind
      const target = ref?.attrs?.target
      if (kind !== "page" && kind !== "block") return null
      if (typeof target !== "string" || !target) return null
      return `${kind} ${target} ${ref?.attrs?.alias === true}`
    },
    wrap: (key, body) => {
      const [kind, target, alias] = key.split(" ")
      const tag = kind === "page" ? "mention-page" : "mention-block"
      const aliasAttr = alias === "true" ? ` alias="true"` : ""
      return tagPair(`<${tag} id="${escapeHtmlAttr(target!)}"${aliasAttr}>`, `</${tag}>`, body)
    },
  },
  {
    key: (marks) => {
      const color = markOf(marks, "textStyle")?.attrs?.textColor
      return typeof color === "string" ? color : null
    },
    wrap: (key, body) =>
      tagPair(`<span data-text-color="${escapeHtmlAttr(key)}">`, "</span>", body),
  },
  {
    key: (marks) => (markOf(marks, "underline") ? "u" : null),
    wrap: (_key, body) => tagPair("<u>", "</u>", body),
  },
  {
    key: (marks) => {
      const link = markOf(marks, "link")
      const href = link?.attrs?.href
      if (href === undefined) return null
      const title = typeof link?.attrs?.title === "string" ? link.attrs.title : null
      return JSON.stringify([String(href), title])
    },
    wrap: (key, body) => {
      const [url, title] = JSON.parse(key) as [string, string | null]
      return [{ type: "link", url, title, children: body }]
    },
  },
  {
    key: (marks) => (markOf(marks, "bold") ? "b" : null),
    wrap: (_key, body) => [{ type: "strong", children: body }],
  },
  {
    key: (marks) => (markOf(marks, "italic") ? "i" : null),
    wrap: (_key, body) => [{ type: "emphasis", children: body }],
  },
  {
    key: (marks) => (markOf(marks, "strike") ? "s" : null),
    wrap: (_key, body) => [{ type: "delete", children: body }],
  },
]

/**
 * How a hard break is spelled on the way out.
 *
 * `native` is the backslash-newline markdown form — correct everywhere a block
 * may span physical lines. `br` is the `<br>` tag, required inside a GFM table
 * cell, where a physical newline would end the row instead (see `BR_TAG`).
 */
export type HardBreakForm = "native" | "br"

/** The innermost step: one PM inline node, with every wrapping mark already
 *  applied by the layers above. */
function leafToMdast(node: JSONContent, hardBreak: HardBreakForm): PhrasingContent[] {
  if (node.type === "hardBreak") {
    return hardBreak === "br" ? [{ type: "html", value: "<br>" }] : [{ type: "break" }]
  }
  if (node.type === "rawInline") {
    // Straight back out as raw source — no escaping, which is the whole point of
    // the carrier. Emitting an `html` node also means a hardBreak sitting just
    // before one is caught by `nativeBreaksThatMustBeTags`, which is required:
    // the native `\` form degrades next to raw html.
    return [{ type: "html", value: String(node.attrs?.source ?? "") }]
  }
  if (node.type === "inlineMath") {
    // `mdast-util-math` follows `singleDollarTextMath: false` and writes `$$…$$`,
    // which the same pipeline reads back as `inlineMath` — measured, so no
    // delimiter option is needed here. The roundtrip suite pins that behaviour so
    // a future change to MATH_OPTIONS cannot quietly break it.
    return [{ type: "inlineMath", value: String(node.attrs?.latex ?? "") }]
  }
  if (node.type !== "text" || typeof node.text !== "string") return []
  const marks = (node.marks ?? []) as Mark[]

  // wikiLink is a verbatim sub-grammar whose token REPLACES the text, emitted
  // as inline html so remark-stringify leaves the brackets alone.
  const wiki = markOf(marks, "wikiLink")
  if (wiki) {
    const target = String(wiki.attrs?.target ?? "")
    return [
      {
        type: "html",
        value: target === node.text ? `[[${target}]]` : `[[${target}|${node.text}]]`,
      },
    ]
  }
  if (markOf(marks, "code")) return [{ type: "inlineCode", value: node.text }]
  return [{ type: "text", value: node.text }]
}

/**
 * Wraps the widest run first, so a mark shared by several runs becomes their
 * common wrapper instead of repeating on each.
 *
 * A fixed layer order cannot do this. `_You **can** combine them_` is three
 * runs that all carry italic and only the middle one bold; with bold pinned
 * outside italic, the bold layer splits the sequence into three and italic then
 * wraps each piece separately — `*You *`, `***can***`, `* combine them*`. Those
 * delimiters abut, remark escapes the seams into `&#x20;` + `****`, and the
 * file re-parses with a duplicated bold. Choosing italic first (its run spans
 * all three) yields `*You **can** combine them*`, byte-identical to the source.
 *
 * `LAYERS` still decides the nesting of EQUAL-length runs, which is what keeps
 * output deterministic and keeps raw HTML outside / verbatim innermost. PM
 * marks carry no order, so some canonical choice has to be made here; only the
 * mark SET is meaningful, and comparison normalizes for it.
 */
/**
 * A `break` immediately followed by a raw `html` sibling has no native spelling.
 * `mdast-util-to-markdown` writes `\` + SPACE there instead of `\` + newline, and
 * `\ ` is a literal backslash in CommonMark — so the break is gone on the next
 * read and a stray `\` is left in the text.
 *
 * The successor set was measured, not guessed: `html` is the ONLY type that does
 * this. `text`, `inlineCode`, `strong`, `emphasis`, `delete`, `link`, `image`,
 * `inlineMath` and a second `break` all keep the native form, and an html node
 * NESTED inside a wrapper is safe too because the wrapper's own delimiter comes
 * between them.
 *
 * This is the same shape as the trailing-break rule in `inlineToMdast`, and takes
 * the same resolution: losslessness beats the style default, so exactly these
 * breaks take `<br>`. Applied at every level of the recursion, since a wrapper
 * spreads its `tagPair` into the parent's sibling list — which is precisely how
 * a break ends up adjacent to `<u>` / `<mark>` / a colour span in the first place.
 */
function nativeBreaksThatMustBeTags(nodes: PhrasingContent[]): PhrasingContent[] {
  let patched: PhrasingContent[] | null = null
  for (let index = 0; index < nodes.length - 1; index += 1) {
    if (nodes[index]!.type !== "break" || nodes[index + 1]!.type !== "html") continue
    patched ??= [...nodes]
    patched[index] = { type: "html", value: "<br>" }
  }
  return patched ?? nodes
}

function groupRuns(
  nodes: JSONContent[],
  available: readonly number[],
  hardBreak: HardBreakForm,
): PhrasingContent[] {
  const keyAt = (nodeIndex: number, layerIndex: number) =>
    LAYERS[layerIndex]!.key((nodes[nodeIndex]!.marks ?? []) as Mark[])

  const out: PhrasingContent[] = []
  let index = 0
  while (index < nodes.length) {
    let chosen = -1
    let chosenEnd = index
    for (const layerIndex of available) {
      const key = keyAt(index, layerIndex)
      if (key === null) continue
      let end = index + 1
      while (end < nodes.length && keyAt(end, layerIndex) === key) end += 1
      // Strictly wider wins; ties fall to the earlier layer, i.e. the outer one.
      if (end > chosenEnd) {
        chosen = layerIndex
        chosenEnd = end
      }
    }

    if (chosen === -1) {
      out.push(...leafToMdast(nodes[index]!, hardBreak))
      index += 1
      continue
    }

    const body = groupRuns(
      nodes.slice(index, chosenEnd),
      available.filter((layerIndex) => layerIndex !== chosen),
      hardBreak,
    )
    // An empty body would leave a stray delimiter pair behind.
    if (body.length > 0) {
      out.push(...LAYERS[chosen]!.wrap(keyAt(index, chosen)!, body, []))
    }
    index = chosenEnd
  }
  return nativeBreaksThatMustBeTags(out)
}

const ALL_LAYERS = LAYERS.map((_layer, index) => index)

export function inlineToMdast(
  nodes: JSONContent[],
  hardBreak: HardBreakForm = "native",
): PhrasingContent[] {
  // A TRAILING hard break has no native spelling. `a\` at the end of a block is
  // a literal backslash, not a break, so it re-parses as text and the escape
  // doubles on every save (`a\` → `a\\` → `a\\\\`). `<br>` is the only lossless
  // form, so the trailing run takes it regardless of the requested style — the
  // same reason table cells do, generalized.
  let split = nodes.length
  while (split > 0 && nodes[split - 1]!.type === "hardBreak") split -= 1
  if (split === nodes.length) return groupRuns(nodes, ALL_LAYERS, hardBreak)
  return [
    ...groupRuns(nodes.slice(0, split), ALL_LAYERS, hardBreak),
    ...nodes.slice(split).flatMap((node) => leafToMdast(node, "br")),
  ]
}
