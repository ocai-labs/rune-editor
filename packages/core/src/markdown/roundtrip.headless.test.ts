// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// @vitest-environment node
//
// Roundtrip suite for the remark storage pipeline — the step-3 acceptance
// gate from the markdown-storage PRD. Two properties the OLD transport
// measurably fails (docs/2026-07-29-markdown-roundtrip-baseline.md):
//
//   1. CONVERGENCE: serialize(parse(md)) reaches a fixpoint after one
//      normalization pass — no per-save escaping spirals (G3).
//   2. IDENTITY: the baseline's "只差序列化细节" blocks survive PM→md→PM
//      with type + attrs + text intact.
//
// Runs in bare Node with NO DOM — not even linkedom. That absence is itself
// an assertion: the remark pipeline must never grow a DOM dependency (§5.3).
import { describe, expect, it } from "vitest"
import type { JSONContent } from "@tiptap/core"
import {
  countDuplicateMarks,
  normalizeDocForComparison,
  parseMarkdown,
  sameDocument,
  serializeMarkdown,
} from "./index"
// Reached directly, not through `parseMarkdown`: the bare-mdast path is only
// observable when the source is withheld, which the public entry never does.
import { mdastToPM } from "./convert"
import { parseToMdast } from "./pipeline"

const roundtrip = (md: string) => {
  const p1 = parseMarkdown(md)
  const md2 = serializeMarkdown(p1.doc, p1.frontmatter)
  const p2 = parseMarkdown(md2)
  const md3 = serializeMarkdown(p2.doc, p2.frontmatter)
  return { p1, md2, p2, md3 }
}

const blocks = (...content: JSONContent[]): JSONContent => ({ type: "doc", content })
const p = (text: string, attrs?: Record<string, unknown>): JSONContent => ({
  type: "paragraph",
  ...(attrs ? { attrs } : {}),
  content: [{ type: "text", text }],
})

/** PM→md→PM: the reparse of a seed's serialization. */
const reparse = (doc: JSONContent) => parseMarkdown(serializeMarkdown(doc)).doc

describe("comparison helpers (the gate's own contract)", () => {
  it("mark order is normalized away, because PM has none to preserve", () => {
    const one: JSONContent = { type: "doc", content: [{ type: "paragraph", content: [
      { type: "text", text: "x", marks: [{ type: "bold" }, { type: "italic" }] }] }] }
    const other: JSONContent = { type: "doc", content: [{ type: "paragraph", content: [
      { type: "text", text: "x", marks: [{ type: "italic" }, { type: "bold" }] }] }] }
    expect(sameDocument(one, other)).toBe(true)
  })

  it("attrs order is normalized, attrs VALUES are not", () => {
    const seed = (attrs: Record<string, unknown>): JSONContent => ({ type: "doc", content: [
      { type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "textStyle", attrs }] }] }] })
    expect(sameDocument(seed({ textColor: "red", backgroundColor: "yellow" }),
                        seed({ backgroundColor: "yellow", textColor: "red" }))).toBe(true)
    expect(sameDocument(seed({ textColor: "red" }), seed({ textColor: "blue" }))).toBe(false)
  })

  it("does NOT hide a lost mark, a changed attr, or reordered children", () => {
    const withMarks = (marks: Array<{ type: string; attrs?: Record<string, unknown> }>) =>
      ({ type: "doc", content: [
        { type: "paragraph", content: [{ type: "text", text: "x", marks }] }] }) as JSONContent
    expect(sameDocument(withMarks([{ type: "bold" }, { type: "italic" }]),
                        withMarks([{ type: "bold" }]))).toBe(false)
    expect(sameDocument(withMarks([{ type: "link", attrs: { href: "a" } }]),
                        withMarks([{ type: "link", attrs: { href: "b" } }]))).toBe(false)
    const kids = (texts: string[]): JSONContent => ({ type: "doc", content: [
      { type: "paragraph", content: texts.map((text) => ({ type: "text", text })) }] })
    expect(sameDocument(kids(["a", "b"]), kids(["b", "a"]))).toBe(false)
  })

  it("does NOT unify null, absent, or empty attrs", () => {
    // Casts are the point: these are the non-canonical shapes a codec might
    // emit, and the comparator must keep them distinct rather than tidy them up.
    const seed = (attrs: unknown) =>
      ({ type: "doc", content: [{ type: "heading", attrs }] }) as JSONContent
    expect(sameDocument(seed({ level: null }), seed({}))).toBe(false)
    expect(sameDocument(seed({ level: null }), seed({ level: "" }))).toBe(false)
  })

  it("duplicate marks are REPORTED, never normalized away", () => {
    const doubled: JSONContent = { type: "doc", content: [{ type: "paragraph", content: [
      { type: "text", text: "x", marks: [{ type: "bold" }, { type: "bold" }] }] }] }
    expect(countDuplicateMarks(doubled)).toBe(1)
    // normalization sorts them but keeps both, so the count still fires
    expect(countDuplicateMarks(normalizeDocForComparison(doubled))).toBe(1)
    expect(countDuplicateMarks({ type: "doc", content: [] })).toBe(0)
  })
})

describe("convergence (kills the old transport's divergence)", () => {
  const CORPUS = [
    "---",
    "title: Corpus",
    "---",
    "",
    "# Heading one",
    "",
    "#### Heading four",
    "",
    "Paragraph with **bold**, *italic*, ~~strike~~, `code`, and a [link](https://example.com).",
    "",
    "- bullet one",
    "- bullet two",
    "    - nested bullet",
    "",
    "3. starts at three",
    "4. continues",
    "",
    "- [ ] open task",
    "- [x] done task",
    "",
    "> quote line one",
    "> quote line two",
    "",
    "```ts",
    'const x = "a"',
    "```",
    "",
    "| a | b |",
    "| - | - |",
    "| 1 | 2 |",
    "",
    "$$",
    "E = mc^2",
    "$$",
    "",
    "![alt text](https://example.com/pic.png)",
    "",
    "---",
    "",
    "Last paragraph.",
    "",
  ].join("\n")

  it("reaches a fixpoint after one pass (md2 == md3 == md4)", () => {
    const { md2, md3 } = roundtrip(CORPUS)
    expect(md3).toBe(md2)
    const md4 = serializeMarkdown(parseMarkdown(md3).doc, parseMarkdown(md3).frontmatter)
    expect(md4).toBe(md3)
  })

  it("keeps block types stable across the trip", () => {
    const { p1, p2 } = roundtrip(CORPUS)
    const types = (d: JSONContent) => (d.content ?? []).map((b) => b.type)
    expect(types(p2.doc)).toEqual(types(p1.doc))
  })

  it("carries frontmatter through untouched", () => {
    const { p1, md2 } = roundtrip(CORPUS)
    expect(p1.frontmatter).toBe("title: Corpus")
    expect(md2.startsWith("---\ntitle: Corpus\n---\n")).toBe(true)
  })

  // `<br>` used to be one of the tags that degraded to literal text; it is now
  // CLAIMED (see the `<br>` contract below), so this asserts convergence on the
  // reading it gets today — a hard break — rather than on literal text.
  it("an inline <br> converges to a hard break without escape-spiralling", () => {
    const seed = "Text with a <br> in it.\n"
    const { md2, md3 } = roundtrip(seed)
    expect(md3).toBe(md2)
    expect(reparse(parseMarkdown(seed).doc)).toEqual(parseMarkdown(md2).doc)
  })
})

describe("block identity (baseline's 12 easy blocks)", () => {
  it("paragraph", () => {
    expect(reparse(blocks(p("plain paragraph")))).toEqual(blocks(p("plain paragraph")))
  })

  it("heading levels 1–6", () => {
    const doc = blocks(
      ...[1, 2, 3, 4, 5, 6].map((level) => ({
        type: "heading",
        attrs: { level },
        content: [{ type: "text", text: `H${level}` }],
      })),
    )
    expect(reparse(doc)).toEqual(doc)
  })

  it("divider", () => {
    expect(reparse(blocks({ type: "divider" }))).toEqual(blocks({ type: "divider" }))
  })

  it("blockquote — single line", () => {
    const doc = blocks({ type: "blockquote", content: [{ type: "text", text: "quoted" }] })
    expect(reparse(doc)).toEqual(doc)
  })

  it("blockquote — multi-line converges without <br> artifacts", () => {
    const doc = blocks({
      type: "blockquote",
      content: [
        { type: "text", text: "line one" },
        { type: "hardBreak" },
        { type: "text", text: "line two" },
      ],
    })
    const once = reparse(doc)
    expect(reparse(once)).toEqual(once) // stable from the first normalization
    expect(JSON.stringify(once)).not.toContain("<br")
  })

  it("codeBlock keeps language and adds NO trailing newline", () => {
    const doc = blocks({
      type: "codeBlock",
      attrs: { language: "ts" },
      content: [{ type: "text", text: 'const x = "a"' }],
    })
    expect(reparse(doc)).toEqual(doc)
  })

  it("nested bulletList keeps depth", () => {
    const doc = blocks(
      { type: "bulletList", content: [{ type: "text", text: "one" }] },
      { type: "bulletList", attrs: { depth: 1 }, content: [{ type: "text", text: "child" }] },
    )
    expect(reparse(doc)).toEqual(doc)
  })

  it("numberedList keeps start", () => {
    const doc = blocks({
      type: "numberedList",
      attrs: { start: 3 },
      content: [{ type: "text", text: "third" }],
    })
    expect(reparse(doc)).toEqual(doc)
  })

  it("taskList keeps checked and does NOT grow leading spaces", () => {
    const doc = blocks(
      { type: "taskList", attrs: { checked: true }, content: [{ type: "text", text: "done" }] },
      { type: "taskList", attrs: { checked: false }, content: [{ type: "text", text: "open" }] },
    )
    expect(reparse(doc)).toEqual(doc)
    expect(reparse(reparse(doc))).toEqual(doc)
  })

  it("plain table with header row", () => {
    const cell = (kind: string, text: string) => ({
      type: kind,
      content: [{ type: "tableParagraph", content: [{ type: "text", text }] }],
    })
    const doc = blocks({
      type: "table",
      content: [
        { type: "tableRow", content: [cell("tableHeader", "a"), cell("tableHeader", "b")] },
        { type: "tableRow", content: [cell("tableCell", "1"), cell("tableCell", "2")] },
      ],
    })
    expect(reparse(doc)).toEqual(doc)
  })

  it("image keeps src and alt", () => {
    const doc = blocks({
      type: "image",
      attrs: { src: "https://example.com/pic.png", alt: "alt text" },
    })
    expect(reparse(doc)).toEqual(doc)
  })

  it("equationBlock keeps latex", () => {
    const doc = blocks({ type: "equationBlock", attrs: { latex: "E = mc^2" } })
    expect(reparse(doc)).toEqual(doc)
  })

  // ── B1: inlineMath ────────────────────────────────────────────────────────
  // Both sides of this mapping already existed and were never connected. mdast
  // has `inlineMath`; rune has an `inlineMath` atom whose input rule is
  // `$$latex$$` (inlines/InlineMath/node.ts). The codec threw it into text
  // alongside `html`, so reading dropped the delimiters — and the WRITE side had
  // no case for the PM node at all, which is the severe half.

  it("B1 write side: a formula typed in the EDITOR is no longer deleted on save", () => {
    // The regression this guards is data loss, not a downgrade: before B1 this
    // serialized to "前面  后面" with the formula gone entirely.
    const doc = blocks({
      type: "paragraph",
      content: [
        { type: "text", text: "前面 " },
        { type: "inlineMath", attrs: { latex: "x^2" } },
        { type: "text", text: " 后面" },
      ],
    })
    expect(serializeMarkdown(doc)).toBe("前面 $$x^2$$ 后面\n")
    expect(reparse(doc)).toEqual(doc)
  })

  it("B1 read side: `$$…$$` in a file keeps its formula identity", () => {
    const doc = parseMarkdown("行内 $$x^2$$ 文字\n").doc
    expect(doc.content?.[0]?.content).toEqual([
      { type: "text", text: "行内 " },
      { type: "inlineMath", attrs: { latex: "x^2" } },
      { type: "text", text: " 文字" },
    ])
  })

  it("B1: marks survive around the atom", () => {
    const doc = blocks({
      type: "paragraph",
      content: [
        { type: "inlineMath", attrs: { latex: "E = mc^2" }, marks: [{ type: "bold" }] },
      ],
    })
    expect(serializeMarkdown(doc)).toBe("**$$E = mc^2$$**\n")
    expect(reparse(doc)).toEqual(doc)
  })

  it("B1: the written delimiter form must survive a re-read — pins MATH_OPTIONS", () => {
    // `mdast-util-math` follows `singleDollarTextMath: false` and writes `$$…$$`,
    // so no delimiter option is needed. This assertion passes for free today; it
    // exists so that changing MATH_OPTIONS cannot quietly reintroduce the F7-shaped
    // asymmetry (write a form the reader will not accept → decay every save).
    const doc = blocks({
      type: "paragraph",
      content: [{ type: "inlineMath", attrs: { latex: "x^2" } }],
    })
    const md = serializeMarkdown(doc)
    expect(md).toContain("$$x^2$$")
    expect(parseMarkdown(md).doc).toEqual(doc)
    expect(serializeMarkdown(parseMarkdown(md).doc)).toBe(md) // fixpoint
  })

  it("B1: a lone `$` stays prose — no inline math, no escape spiral", () => {
    const md = "价格是 $5 和 $6。\n"
    const doc = parseMarkdown(md).doc
    expect(JSON.stringify(doc)).not.toContain("inlineMath")
    expect(serializeMarkdown(doc)).toBe(md)
  })

  // ── A1: rawBlock ──────────────────────────────────────────────────────────
  // Block-level source with no PM representation. Before this, it degraded to a
  // paragraph of text whose embedded `\n` re-read as a hardBreak, so the file
  // needed two saves to settle AND had its bytes rewritten with `\<` escapes.

  it("A1: multi-line block HTML keeps its exact bytes and is a fixpoint", () => {
    const md = '<div align="center">\n  <img src="logo.png">\n</div>\n'
    const { doc } = parseMarkdown(md)
    expect(doc.content).toEqual([
      {
        type: "rawBlock",
        attrs: { source: '<div align="center">\n  <img src="logo.png">\n</div>', origin: "html" },
      },
    ])
    expect(serializeMarkdown(doc)).toBe(md) // byte-identical, first save
    expect(reparse(doc)).toEqual(doc)
  })

  it("A1: a block-level comment is preserved instead of gaining `\\<`", () => {
    const md = "<!-- a note -->\n"
    expect(serializeMarkdown(parseMarkdown(md).doc)).toBe(md)
  })

  it("A1: the fallback runs AFTER contracts, so first-class HTML still wins", () => {
    // The ordering is the whole guard against a fallback that eats nodes which
    // already have a home — media claims these in `emitBlock`'s contract loop,
    // before the `case "html"` that produces rawBlock.
    const video = parseMarkdown('<video src="a.mp4" controls></video>\n').doc
    expect(video.content?.[0]?.type).toBe("video")

    const audio = parseMarkdown('<audio src="a.mp3" controls></audio>\n').doc
    expect(audio.content?.[0]?.type).toBe("audio")

    // …and a document rune itself authored must never grow raw carriers.
    const authored = blocks(
      p("text"),
      { type: "video", attrs: { sourceType: "asset", src: "a.mp4", title: "" } },
    )
    expect(JSON.stringify(reparse(authored))).not.toContain("rawBlock")
  })

  it("A1 is NARROW on purpose: nested HTML is not claimed", () => {
    // remark strips the container indentation from a nested node's `value`, so
    // `value` is not the original bytes there — claiming it would silently
    // reformat the source. That case waits for the source-slice foundation.
    const doc = parseMarkdown("- item\n\n  <div>\n  x\n  </div>\n").doc
    expect(JSON.stringify(doc)).not.toContain("rawBlock")
  })

  // ── A2: rawInline ─────────────────────────────────────────────────────────

  it("A2: a paired unrecognised tag keeps its bytes, middle stays editable text", () => {
    const md = '前面 <span class="x">中间</span> 后面\n'
    const { doc } = parseMarkdown(md)
    expect(doc.content?.[0]?.content).toEqual([
      { type: "text", text: "前面 " },
      { type: "rawInline", attrs: { source: '<span class="x">' } },
      { type: "text", text: "中间" }, // ordinary text — this is why an atom, not a mark
      { type: "rawInline", attrs: { source: "</span>" } },
      { type: "text", text: " 后面" },
    ])
    expect(serializeMarkdown(doc)).toBe(md)
    expect(reparse(doc)).toEqual(doc)
  })

  it("A2: the shapes a mark could not represent at all", () => {
    for (const md of [
      "text <!-- inline note --> more\n",
      "before <custom-thing /> after\n",
      "dangling </div> here\n",
    ]) {
      expect(serializeMarkdown(parseMarkdown(md).doc)).toBe(md)
    }
  })

  it("A2: raw source inside a mark run does not split the run", () => {
    const md = "**bold with <span class=\"y\">tags</span> still bold**\n"
    const { doc } = parseMarkdown(md)
    const inline = doc.content?.[0]?.content ?? []
    // Every child carries bold, including the two atoms — otherwise the writer
    // would close and reopen `**` around them.
    expect(inline.every((n) => (n.marks ?? []).some((m) => m.type === "bold"))).toBe(true)
    expect(serializeMarkdown(doc)).toBe(md)
  })

  it("A2: claimed inline HTML still wins — the fallback is last", () => {
    const { doc } = parseMarkdown(
      'a <u>u</u> <mark data-color="blue">m</mark> ' +
        '<span data-text-color="red">c</span> b<br>c\n',
    )
    const inline = doc.content?.[0]?.content ?? []
    expect(JSON.stringify(inline)).not.toContain("rawInline")
    const kinds = inline.flatMap((n) => (n.marks ?? []).map((m) => m.type))
    expect(kinds).toContain("underline")
    expect(kinds).toContain("textStyle")
    expect(inline.some((n) => n.type === "hardBreak")).toBe(true)
  })

  it("A2 + slice: a multi-line MDX component keeps its indentation", () => {
    // CommonMark only opens an HTML block on a KNOWN tag name, so a custom
    // component whose opening tag spans lines lands INSIDE a paragraph — which is
    // why it needs the inline carrier rather than rawBlock.
    //
    // The indentation is the reason this needs the source slice. CommonMark
    // strips the leading whitespace of a paragraph's continuation lines before
    // mdast is built, so the node's `value` never held it — only `position` does.
    // Until the slice landed, this file came back as
    // `<CustomComponent\nprop={value}\n/>`.
    const md = "<CustomComponent\n  prop={value}\n/>\n"
    const { doc } = parseMarkdown(md)
    expect(JSON.stringify(doc)).toContain("rawInline")
    expect(serializeMarkdown(doc)).toBe(md)
    expect(reparse(doc)).toEqual(doc)
  })

  it("the slice is optional: a bare mdast caller degrades, never guesses", () => {
    // `mdastToPM` WITHOUT `source` must not invent bytes. It falls back to
    // `value`, which is exactly the pre-slice behaviour — the point is that it
    // does not produce a plausible-looking-but-wrong slice.
    //
    // Going through `parseMarkdown` would NOT test this: that path always
    // supplies the source, so it exercises the sliced branch and the assertion
    // would pass no matter what the bare path did.
    const md = "<CustomComponent\n  prop={value}\n/>\n"
    const bare = mdastToPM(parseToMdast(md))
    const sliced = parseMarkdown(md).doc

    // Both keep the construct as a carrier and neither loses its content …
    expect(JSON.stringify(bare)).toContain("rawInline")
    expect(JSON.stringify(bare)).toContain("prop={value}")
    // … but only the sliced one can reproduce the indentation, and the bare one
    // reports the stripped `value` rather than guessing at what was stripped.
    expect(JSON.stringify(bare)).not.toContain("  prop={value}")
    expect(JSON.stringify(sliced)).toContain("  prop={value}")
    expect(serializeMarkdown(sliced)).toBe(md)
  })

  it("the slice is refused where mdast offsets stop describing the bytes", () => {
    // The inline half of the `case \"html\"` rule. Inside a list item or a
    // blockquote the offsets still point at the ORIGINAL source, which carries
    // the container's prefix — and the writer adds its own on top. Claiming the
    // slice there doubled it on every save:
    //
    //   `- before <X\n  prop\n  />`  →  continuation lines indented FOUR spaces
    //   `> before <X\n> prop`        →  continuation lines gained `> > `
    //
    // Nested positions fall back to `value`, which CommonMark has already
    // stripped to exactly what the writer will re-prefix.
    for (const md of [
      "- before <CustomComponent\n  prop={value}\n  /> after\n",
      "> before <CustomComponent\n> prop={value}\n> /> after\n",
    ]) {
      expect(serializeMarkdown(parseMarkdown(md).doc)).toBe(md)
    }
  })

  it("a slice is refused rather than approximated when the offsets are unusable", () => {
    // NaN and a fractional offset both pass a bare `typeof === \"number\"` check
    // and are then silently coerced by `String.slice`, which is precisely the
    // plausible-looking-but-wrong slice the guard exists to prevent.
    const root = parseToMdast("<CustomComponent\n  prop={value}\n/>\n")
    const paragraph = root.children[0] as { children: { position?: unknown }[] }
    const html = paragraph.children[0]!
    html.position = { start: { offset: Number.NaN }, end: { offset: 12 } }

    const doc = mdastToPM({ root, source: "<CustomComponent\n  prop={value}\n/>\n" })
    // Degrades to `value`, exactly as a caller who passed no source would get.
    expect(JSON.stringify(doc)).toContain("prop={value}")
    expect(JSON.stringify(doc)).not.toContain("  prop={value}")
  })

  it("A2: single-line inline HTML IS byte-exact", () => {
    // The shape where `value` and the source bytes agree — no continuation lines,
    // so nothing was stripped.
    for (const md of [
      'a <span class="x">b</span> c\n',
      "a <Custom prop={v} /> b\n",
      "a <!-- note --> b\n",
    ]) {
      expect(serializeMarkdown(parseMarkdown(md).doc)).toBe(md)
    }
  })

  // ── B2b + A3: the last two carriers ───────────────────────────────────────

  it("B2b: a footnote keeps its `[^1]` marker instead of vanishing", () => {
    const md = "正文[^1]\n\n[^1]: 注解内容\n"
    const { doc } = parseMarkdown(md)
    // Both halves survive: the reference had no `value` at all, so nothing short
    // of the source slice could reproduce it.
    expect(JSON.stringify(doc)).toContain("[^1]")
    expect(serializeMarkdown(doc)).toBe(md)
    expect(reparse(doc)).toEqual(doc)
  })

  it("A3: a non-rectangular table is kept verbatim rather than reshaped", () => {
    // Both directions used to invent structure — a wider row grew a third column
    // in the HEADER, a narrower one gained an empty cell.
    for (const md of [
      "| a | b |\n| - | - |\n| 1 | 2 | 3 |\n",
      "| a | b |\n| - | - |\n| 1 |\n",
      "| a | b |\n| - | - |\n| 1 | 2 |\\n| 3 | 4 |\n",
    ]) {
      expect(serializeMarkdown(parseMarkdown(md).doc)).toBe(md)
    }
  })

  it("A3: a rectangular table is untouched by the predicate", () => {
    const md = "| a | b |\n| - | - |\n| 1 | 2 |\n"
    const { doc } = parseMarkdown(md)
    expect(doc.content?.[0]?.type).toBe("table") // NOT rawBlock
    expect(serializeMarkdown(doc)).toBe(md)
  })

  it("D13: a raw block with a stray depth still serializes flat", () => {
    // With no owner before it there is nothing to indent INTO, so this only ever
    // exercised D9's flattening — it is the weak half of the claim, kept because
    // it is the shape a hand-built document is most likely to have.
    const doc = blocks(
      { type: "rawBlock", attrs: { source: "<div>x</div>", origin: "html", depth: 1 } },
    )
    expect(serializeMarkdown(doc)).toBe("<div>x</div>\n")
  })

  it("D13: a raw block is not absorbed into a list owner's item", () => {
    // The half that actually mattered, and the one the old test's name claimed
    // without checking. Measured before the codec enforced it:
    //
    //   "- owner\n  <div>x</div>\n"      ← indented INTO the item
    //   → reparsed as a PARAGRAPH of literal text, so the next save wrote
    //     `\<div>x\</div>` — identity and bytes both gone.
    //
    // The block spec declares `maxDepth: 0` and `insertBlocks` honours it, but
    // the drag path derives drop depth from the destination alone, so a raw
    // block CAN arrive here holding a depth. The codec refuses it rather than
    // trusting upstream.
    const doc = blocks(
      { type: "bulletList", content: [{ type: "text", text: "owner" }] },
      {
        type: "rawBlock",
        attrs: { source: "<div>x</div>\n<span>y</span>", origin: "html", depth: 1 },
      },
    )
    const md = serializeMarkdown(doc)
    expect(md).toBe("- owner\n\n<div>x</div>\n<span>y</span>\n")
    // And it is still a raw block on the way back — not a paragraph of text.
    expect(parseMarkdown(md).doc.content?.[1]?.type).toBe("rawBlock")
  })

  it("D9 final: non-list depth flattens — markdown's expressiveness is the boundary", () => {
    const doc = blocks(p("root"), p("indented", { depth: 2 }))
    const md = serializeMarkdown(doc)
    expect(md).not.toContain("rune:depth") // no in-file markers, ever
    const out = parseMarkdown(md).doc
    expect(out).toEqual(blocks(p("root"), p("indented"))) // content intact, no codeBlock
    expect(serializeMarkdown(out)).toBe(md) // fixpoint immediately
  })

  it("list owners round-trip mixed paragraph and heading children", () => {
    const doc = blocks(
      { type: "bulletList", content: [{ type: "text", text: "owner" }] },
      p("paragraph child", { depth: 1 }),
      {
        type: "heading",
        attrs: { level: 3, depth: 1 },
        content: [{ type: "text", text: "heading child" }],
      },
      p("outside"),
    )
    expect(reparse(doc)).toEqual(doc)
  })

  it("ordinary blocks cannot own a deeper run", () => {
    const doc = blocks(
      p("plain owner candidate"),
      {
        type: "heading",
        attrs: { level: 2, depth: 1 },
        content: [{ type: "text", text: "must flatten" }],
      },
      p("also flatten", { depth: 2 }),
    )
    expect(reparse(doc)).toEqual(blocks(
      p("plain owner candidate"),
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "must flatten" }],
      },
      p("also flatten"),
    ))
  })
})

// A list item packs its block children onto consecutive lines. CommonMark's
// lazy continuation then reads the next plain-text line as part of the construct
// above it, so a block can be SWALLOWED — 18 corpus files lost a paragraph this
// way. `pipeline.ts` separates only the unsafe boundaries; these tests hold both
// halves of that: the unsafe ones gain a blank line, the tight ones do not.
describe("list item block boundaries (lazy continuation cannot swallow a block)", () => {
  const CONSTRUCTS: ReadonlyArray<readonly [string, string]> = [
    ["paragraph", "  intro"],
    ["heading", "  ## head"],
    ["bulletList", "  - nested"],
    ["numberedList", "  1. nested"],
    ["taskList", "  - [ ] nested"],
    ["blockquote", "  > quoted"],
    ["code", "  ```ts\n  const a = 1\n  ```"],
    ["table", "  | a | b |\n  | - | - |\n  | 1 | 2 |"],
    ["thematicBreak", "  ---"],
    ["math", "  $$\n  x^2\n  $$"],
    // `html` was excluded when this matrix was first measured, because back then
    // it failed for an unrelated reason (it degraded to literal text and gained
    // `\<` escapes) and would have masked everything else. A1/A2 removed that,
    // and html then turned out to be the ONLY construct still failing — 15 of the
    // 121 pairs, all of them involving it. `<video>` is the real-world shape:
    // outside CommonMark's block whitelist, so it is a type-7 block, and a type-7
    // block ends only at a blank line.
    ["html", '  <video src="https://x.com/a.mp4" controls></video>'],
  ]

  // The full matrix, not a sample: every pair was measured to pick the rule, so
  // every pair is what guards it.
  it("every left→right pair of block children survives one save", () => {
    for (const [leftName, left] of CONSTRUCTS) {
      for (const [rightName, right] of CONSTRUCTS) {
        const md = `- x\n\n${left}\n\n${right}\n`
        const { p1, md2, p2, md3 } = roundtrip(md)
        expect(sameDocument(p2.doc, p1.doc), `${leftName} → ${rightName}`).toBe(true)
        expect(md3, `${leftName} → ${rightName} fixpoint`).toBe(md2)
      }
    }
  })

  // The shapes the naive fix (`listItem.spread = true`) would have rewritten.
  // `spread` is an ITEM-level switch, so protecting one boundary with it
  // blank-lines every other boundary in the same item.
  for (const [name, md] of [
    ["a tight nested list", "- item\n  - nested\n"],
    ["tight sibling items", "- one\n- two\n"],
    ["a tight nested list with a following item", "- one\n  - a\n- two\n"],
    ["tight ordered items", "1. one\n2. two\n"],
    ["tight task items", "- [ ] a\n- [x] b\n"],
    ["three tight levels", "- a\n  - b\n    - c\n"],
    ["a paragraph before a nested list", "- item\n\n  intro\n  - nested\n"],
  ] as const) {
    it(`${name} stays byte-for-byte tight`, () => {
      expect(roundtrip(md).md2).toBe(md)
    })
  }

  it("only the unsafe boundary gains a blank line, not the whole item", () => {
    // `item`→`nested` is safe and must stay tight; `nested`→`tail` is not.
    const { md2, md3 } = roundtrip("- item\n  - nested\n\n  tail\n")
    expect(md2).toBe("- item\n  - nested\n\n  tail\n")
    expect(md3).toBe(md2)
  })

  it("a toggle inside a list absorbs its deeper body before boundary separation", () => {
    const doc = blocks(
      { type: "bulletList", content: [{ type: "text", text: "item" }] },
      {
        type: "toggle",
        attrs: { depth: 1 },
        content: [{ type: "text", text: "tog" }],
      },
      p("body", { depth: 2 }),
    )

    const md = serializeMarkdown(doc)
    expect(md).toBe("- item\n  > [!NOTE]- tog\n  >\n  > body\n")
    expect(parseMarkdown(md).doc).toEqual(doc)
  })

  it("F9: a media block inside a list item stays a block (the corpus shape)", () => {
    // Taken from `vscode/extensions/copilot/CHANGELOG.md`, where three of these
    // stopped being blocks. The writer packed the `<video>` onto the line after
    // the item's paragraph; CommonMark read it as a lazy continuation, so the
    // media contract — which claims at BLOCK level — never saw it again. The
    // bytes survived as inline source inside the item, and a second save turned
    // the boundary into `<br>` and drifted further.
    const md =
      '- Delegate from chat:\n\n  <video src="https://x.com/a.mp4" title="T" controls></video>\n\n*after*\n'
    const { p1, md2, p2, md3 } = roundtrip(md)
    const shape = (doc: JSONContent) =>
      (doc.content ?? []).map((b) => `${b.type}@${b.attrs?.depth ?? 0}`)
    expect(shape(p1.doc)).toEqual(["bulletList@0", "video@1", "paragraph@0"])
    expect(shape(p2.doc)).toEqual(shape(p1.doc))
    expect(md2).toBe(md)
    expect(md3).toBe(md2)
  })

  it("F9: an html block swallows whatever follows, not just a plain line", () => {
    // The asymmetry that made this need its own rule rather than membership in
    // the existing sets: a type-7 block runs to the next BLANK LINE, so with html
    // on the left EVERY right fails — including a heading and a fence, which no
    // other left-hand construct can swallow.
    for (const right of ["  ## head", "  ```ts\n  const a = 1\n  ```", "  ---"]) {
      const md = `- x\n\n  <video src="https://x.com/a.mp4" controls></video>\n\n${right}\n`
      const { p1, p2, md2, md3 } = roundtrip(md)
      expect(sameDocument(p2.doc, p1.doc), right).toBe(true)
      expect(md3, `${right} fixpoint`).toBe(md2)
    }
  })

  it("the swallowed paragraph comes back (the corpus shape)", () => {
    const md = "- item\n\n  - nested\n\n  tail\n"
    const { p1, md2, p2 } = roundtrip(md)
    const shape = (doc: JSONContent) =>
      (doc.content ?? []).map((b) => `${b.type}@${b.attrs?.depth ?? 0}`)
    expect(shape(p1.doc)).toEqual(["bulletList@0", "bulletList@1", "paragraph@1"])
    expect(shape(p2.doc)).toEqual(shape(p1.doc))
    expect(md2).toBe("- item\n  - nested\n\n  tail\n")
  })

  // Beyond the lazy-continuation family, two more boundaries were measured
  // unsafe and are covered by the same rule.
  it("two blockquotes in one item do not merge into one", () => {
    const md = "- x\n\n  > a\n\n  > b\n"
    const { p1, p2, md2, md3 } = roundtrip(md)
    expect(sameDocument(p2.doc, p1.doc)).toBe(true)
    expect(md3).toBe(md2)
    expect((p1.doc.content ?? []).filter((b) => b.type === "blockquote")).toHaveLength(2)
  })

  it("a rule under a paragraph stays a rule, not a setext underline", () => {
    const md = "- x\n\n  intro\n\n  ---\n"
    const { p1, p2, md2, md3 } = roundtrip(md)
    expect(sameDocument(p2.doc, p1.doc)).toBe(true)
    expect(md3).toBe(md2)
    expect((p1.doc.content ?? []).some((b) => b.type === "divider")).toBe(true)
  })
})

describe("step-4 contract pilot: callout claims [!TYPE] blockquotes", () => {
  it("default icon → bare [!NOTE], identity roundtrip", () => {
    const doc = blocks({ type: "callout", content: [{ type: "text", text: "callout body" }] })
    const md = serializeMarkdown(doc)
    expect(md).toContain("> [!NOTE]")
    expect(md).not.toContain("\\[") // marker must NOT be bracket-escaped
    expect(parseMarkdown(md).doc).toEqual(doc)
  })

  it("custom icon rides the title slot and survives", () => {
    const doc = blocks({
      type: "callout",
      attrs: { icon: "🔥" },
      content: [{ type: "text", text: "hot take" }],
    })
    const md = serializeMarkdown(doc)
    expect(md).toContain("[!NOTE] 🔥")
    expect(parseMarkdown(md).doc).toEqual(doc)
  })

  it("hand-typed Obsidian single-paragraph form parses to callout", () => {
    const { doc } = parseMarkdown("> [!note]\n> body line\n")
    expect(doc.content?.[0]?.type).toBe("callout")
    expect((doc.content?.[0]?.content ?? []).map((n) => n.text).join("")).toBe("body line")
  })

  it("plain blockquote is NOT claimed", () => {
    const { doc } = parseMarkdown("> just a quote\n")
    expect(doc.content?.[0]?.type).toBe("blockquote")
  })

  it("folded marker ([!TIP]-) is declined by callout — toggle claims it", () => {
    const { doc } = parseMarkdown("> [!TIP]- folded\n")
    expect(doc.content?.[0]?.type).toBe("toggle")
  })

  it("reaches fixpoint", () => {
    const doc = blocks({
      type: "callout",
      attrs: { icon: "🔥" },
      content: [{ type: "text", text: "hot take" }],
    })
    const md = serializeMarkdown(doc)
    expect(serializeMarkdown(parseMarkdown(md).doc)).toBe(md)
  })

  it("an indented callout flattens but keeps its identity", () => {
    const doc = blocks(p("root"), {
      type: "callout",
      attrs: { depth: 1 },
      content: [{ type: "text", text: "nested callout" }],
    })
    const out = parseMarkdown(serializeMarkdown(doc)).doc
    expect(out.content?.[1]?.type).toBe("callout")
    expect(out.content?.[1]?.attrs?.depth).toBeUndefined() // D9: flattened
  })
})

describe("step-4 contract: toggle absorbs its deeper-sibling run", () => {
  it("toggle + child + following sibling: identity, sibling NOT absorbed", () => {
    const doc = blocks(
      { type: "toggle", attrs: { expanded: true }, content: [{ type: "text", text: "toggle head" }] },
      p("hidden child", { depth: 1 }),
      p("sibling after"),
    )
    const md = serializeMarkdown(doc)
    expect(md).toContain("> [!NOTE]+ toggle head")
    expect(md).toContain("> hidden child")
    expect(md).not.toContain("> sibling after")
    expect(parseMarkdown(md).doc).toEqual(doc)
  })

  it("collapsed (default) emits the - suffix", () => {
    const doc = blocks(
      { type: "toggle", content: [{ type: "text", text: "closed" }] },
      p("body", { depth: 1 }),
    )
    const md = serializeMarkdown(doc)
    expect(md).toContain("> [!NOTE]- closed")
    expect(parseMarkdown(md).doc).toEqual(doc)
  })

  it("toggle heading carries level as title hashes", () => {
    const doc = blocks(
      { type: "toggle", attrs: { level: 1 }, content: [{ type: "text", text: "big section" }] },
      p("its child", { depth: 1 }),
    )
    const md = serializeMarkdown(doc)
    expect(md).toContain("> [!NOTE]- # big section")
    expect(parseMarkdown(md).doc).toEqual(doc)
  })

  it("a deeper non-list grandchild stays IN the toggle, its extra indent flattens (D9)", () => {
    const doc = blocks(
      { type: "toggle", content: [{ type: "text", text: "head" }] },
      p("child", { depth: 1 }),
      p("grandchild", { depth: 2 }),
    )
    const md = serializeMarkdown(doc)
    expect(md).not.toContain("rune:depth")
    // Containment (the semantic part of depth) survives via the callout
    // body; the paragraph-under-paragraph indent (no markdown syntax) does
    // not — the grandchild lands at child level inside the toggle.
    expect(parseMarkdown(md).doc).toEqual(
      blocks(
        { type: "toggle", content: [{ type: "text", text: "head" }] },
        p("child", { depth: 1 }),
        p("grandchild", { depth: 1 }),
      ),
    )
  })

  it("a list inside the toggle body round-trips", () => {
    const doc = blocks(
      { type: "toggle", content: [{ type: "text", text: "head" }] },
      { type: "bulletList", attrs: { depth: 1 }, content: [{ type: "text", text: "item" }] },
    )
    expect(parseMarkdown(serializeMarkdown(doc)).doc).toEqual(doc)
  })

  it("nested Toggle owners round-trip their paragraph child", () => {
    const doc = blocks(
      { type: "toggle", content: [{ type: "text", text: "outer" }] },
      {
        type: "toggle",
        attrs: { depth: 1, expanded: true },
        content: [{ type: "text", text: "inner" }],
      },
      p("inner child", { depth: 2 }),
      p("outside"),
    )
    expect(reparse(doc)).toEqual(doc)
  })

  it("hand-typed Obsidian folded callout parses to toggle", () => {
    const { doc } = parseMarkdown("> [!faq]- The question\n> The answer.\n")
    expect(doc.content?.[0]?.type).toBe("toggle")
    expect((doc.content?.[0]?.content ?? []).map((n) => n.text).join("")).toBe("The question")
    expect(doc.content?.[1]).toEqual(p("The answer.", { depth: 1 }))
  })

  it("reaches fixpoint", () => {
    const doc = blocks(
      { type: "toggle", attrs: { level: 3, expanded: true }, content: [{ type: "text", text: "t" }] },
      p("c", { depth: 1 }),
    )
    const md = serializeMarkdown(doc)
    expect(serializeMarkdown(parseMarkdown(md).doc)).toBe(md)
  })
})

describe("mark identity (baseline's 5 free marks)", () => {
  const markSeed = (marks: Array<{ type: string; attrs?: Record<string, unknown> }>) =>
    blocks({
      type: "paragraph",
      content: [
        { type: "text", text: "lead " },
        { type: "text", text: "marked", marks },
        { type: "text", text: " tail" },
      ],
    })

  for (const mark of [
    [{ type: "bold" }],
    [{ type: "italic" }],
    [{ type: "strike" }],
    [{ type: "code" }],
    [{ type: "link", attrs: { href: "https://example.com" } }],
  ] as const) {
    it(mark[0].type, () => {
      const doc = markSeed([...mark])
      expect(reparse(doc)).toEqual(doc)
    })
  }

  // Regression: the serializer used to skip strong/emphasis/delete whenever the
  // run also carried `code`, so `` **`x`** `` came back as a bare code span. The
  // editor deliberately allows the combination (kit.ts narrows Code's
  // `excludes` to the navigation marks only), and it was the single largest
  // source of structural loss on real external markdown — 113 of 186 failing
  // files in the 2026-07-30 corpus audit.
  for (const companion of [
    { type: "bold", syntax: "**`marked`**" },
    { type: "italic", syntax: "*`marked`*" },
    { type: "strike", syntax: "~~`marked`~~" },
  ] as const) {
    it(`${companion.type} survives on a code span (verbatim stays innermost)`, () => {
      const doc = markSeed([{ type: companion.type }, { type: "code" }])
      expect(serializeMarkdown(doc)).toContain(companion.syntax)
      expect(reparse(doc)).toEqual(doc)
    })
  }

  it("bold + italic + strike all survive together on a code span", () => {
    const doc = markSeed([
      { type: "bold" },
      { type: "italic" },
      { type: "strike" },
      { type: "code" },
    ])
    const out = reparse(doc)
    const marked = (out.content?.[0]?.content ?? []).find((n) => n.text === "marked")
    expect((marked?.marks ?? []).map((m) => m.type).sort()).toEqual([
      "bold",
      "code",
      "italic",
      "strike",
    ])
    expect(reparse(out)).toEqual(out)
  })

  it("a code span composes with bold AND the raw-HTML marks at once", () => {
    const doc = markSeed([
      { type: "bold" },
      { type: "code" },
      { type: "underline" },
      { type: "textStyle", attrs: { textColor: "red" } },
    ])
    const md = serializeMarkdown(doc)
    // The three stages, outside in: raw HTML, then native syntax, then verbatim.
    expect(md).toContain('<span data-text-color="red"><u>**`marked`**</u></span>')
    // Order-insensitive for the same reason as the underline+bold+link case
    // above: PM ranks marks on apply, so only the set survives the trip.
    const out = reparse(doc)
    const marked = (out.content?.[0]?.content ?? []).find((n) => n.text === "marked")
    expect((marked?.marks ?? []).map((m) => m.type).sort()).toEqual([
      "bold",
      "code",
      "textStyle",
      "underline",
    ])
    expect(reparse(out)).toEqual(out)
  })

  it("markdown syntax INSIDE a code span stays literal (not re-marked)", () => {
    const { doc } = parseMarkdown("a `**x**` b\n")
    const marked = (doc.content?.[0]?.content ?? []).find((n) => n.marks?.length)
    expect(marked?.text).toBe("**x**")
    expect((marked?.marks ?? []).map((m) => m.type)).toEqual(["code"])
  })

  it("a link title survives on the link mark", () => {
    const md = '[label](https://example.com "Tooltip")\n'
    const { p1, md2, p2 } = roundtrip(md)
    expect(p1.doc.content?.[0]?.content?.[0]?.marks).toEqual([
      { type: "link", attrs: { href: "https://example.com", title: "Tooltip" } },
    ])
    expect(md2).toBe(md)
    expect(p2.doc).toEqual(p1.doc)
  })

  // Regression: neighbouring runs that share a delimiter mark must emit ONE
  // wrapper. Two of them abut into `**a****b**`, which re-parses as literal
  // asterisks and then DOUBLES its escapes on every subsequent save — the
  // divergence class the old transport was replaced to kill. Assert the
  // fixpoint, not just deep-equal: this failure converges to nothing.
  it("a bold code span followed by bold text emits one strong, and converges", () => {
    const md = "**`format`** keeps asserting\n"
    const { p1, md2, p2, md3 } = roundtrip(md)
    expect(md2).toBe(md)
    expect(md3).toBe(md2)
    expect(p2.doc).toEqual(p1.doc)
    expect(md2).not.toContain("****")
  })

  it("adjacent runs sharing bold but differing inside stay one strong", () => {
    const doc = blocks({
      type: "paragraph",
      content: [
        { type: "text", text: "lead ", marks: [{ type: "bold" }] },
        { type: "text", text: "code", marks: [{ type: "bold" }, { type: "code" }] },
        { type: "text", text: " and ", marks: [{ type: "bold" }] },
        { type: "text", text: "em", marks: [{ type: "bold" }, { type: "italic" }] },
        { type: "text", text: " tail", marks: [{ type: "bold" }] },
      ],
    })
    const md = serializeMarkdown(doc)
    expect(md).not.toContain("****")
    expect(md).toContain("**lead `code` and *em* tail**")
    expect(serializeMarkdown(parseMarkdown(md).doc)).toBe(md)
  })

  // A mark shared by several runs must become their common wrapper. Wrapping
  // each run on its own abuts the delimiters, remark escapes the seams, and the
  // file re-parses with a DUPLICATED mark. `_a **b** c_` is the everyday shape;
  // the rest cover the other two native marks and the nesting combinations.
  for (const [name, md] of [
    ["bold inside italic", "*You **can** combine them*\n"],
    ["bold inside strike", "~~You **can** combine them~~\n"],
    ["italic inside bold", "**You *can* combine them**\n"],
    ["strike inside bold", "**You ~~can~~ combine them**\n"],
    ["code inside italic", "*You `can` combine them*\n"],
    ["two islands in one italic", "*a **b** c **d** e*\n"],
    ["italic inside strike inside bold", "**a ~~b *c* d~~ e**\n"],
    ["link spanning a bold island", "[a **b** c](https://example.com)\n"],
    ["highlight spanning a bold island", "==a **b** c==\n"],
  ] as const) {
    it(`${name} keeps one wrapper and round-trips byte-for-byte`, () => {
      const { p1, md2, p2, md3 } = roundtrip(md)
      expect(md2).toBe(md)
      expect(md3).toBe(md2)
      expect(p2.doc).toEqual(p1.doc)
      expect(md2).not.toContain("****")
      expect(md2).not.toContain("&#x20;")
    })
  }

  it("no parse produces a mark twice on one run", () => {
    // `_a _b_ c_` is CommonMark-ambiguous and used to yield [italic, italic];
    // `****x****` is what an abutting serialization re-parsed into. PM stores
    // one mark per type, so either shape must arrive already collapsed.
    for (const md of ["_You _can_ combine them_\n", "****x****\n", "**a****b**\n"]) {
      const { p1, p2 } = roundtrip(md)
      for (const doc of [p1.doc, p2.doc]) {
        const pending = [doc]
        while (pending.length > 0) {
          const node = pending.shift()!
          const types = (node.marks ?? []).map((mark) => mark.type)
          expect(new Set(types).size, `duplicate mark in ${md.trim()}`).toBe(types.length)
          pending.push(...(node.content ?? []))
        }
      }
    }
  })

  it("adjacent runs with identical marks arrive as one text node", () => {
    // The walker emits one node per mdast child; PM cannot represent adjacent
    // same-mark text as separate nodes, so the parse has to collapse them or a
    // save/reopen comparison reports a change that never happened.
    const { p1 } = roundtrip("_You _can_ combine them_\n")
    const runs = p1.doc.content?.[0]?.content ?? []
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({ text: "You can combine them" })
  })

  it("abutting nested wrappers merge at depth too", () => {
    const doc = blocks({
      type: "paragraph",
      content: [
        { type: "text", text: "a", marks: [{ type: "bold" }, { type: "italic" }] },
        { type: "text", text: "b", marks: [{ type: "bold" }, { type: "italic" }] },
      ],
    })
    const md = serializeMarkdown(doc)
    expect(md).not.toContain("****")
    expect(md).toContain("***ab***")
    expect(serializeMarkdown(parseMarkdown(md).doc)).toBe(md)
  })
})

describe("mark identity (the baseline's 4 LOST marks — raw-HTML vocabulary)", () => {
  const markSeed = (
    text: string,
    marks: Array<{ type: string; attrs?: Record<string, unknown> }>,
  ) =>
    blocks({
      type: "paragraph",
      content: [
        { type: "text", text: "lead " },
        { type: "text", text, marks },
        { type: "text", text: " tail" },
      ],
    })

  it("underline roundtrips via <u>", () => {
    const doc = markSeed("under", [{ type: "underline" }])
    expect(serializeMarkdown(doc)).toContain("<u>under</u>")
    expect(reparse(doc)).toEqual(doc)
  })

  it("textStyle keeps both color channels (== outside, span inside)", () => {
    const doc = markSeed("hot", [
      { type: "textStyle", attrs: { textColor: "red", backgroundColor: "yellow" } },
    ])
    const md = serializeMarkdown(doc)
    expect(md).toContain('==<span data-text-color="red">hot</span>==')
    expect(reparse(doc)).toEqual(doc)
  })

  it("inline text color and highlight still roundtrip without block colors", () => {
    const doc = markSeed("inline only", [
      { type: "textStyle", attrs: { textColor: "blue", backgroundColor: "yellow" } },
    ])
    const md = serializeMarkdown(doc)
    expect(md).toContain('==<span data-text-color="blue">inline only</span>==')
    expect(reparse(doc)).toEqual(doc)
  })

  it("internalRef page + alias roundtrips via <mention-page>", () => {
    const doc = markSeed("Ref", [
      { type: "internalRef", attrs: { kind: "page", target: "abc123", alias: true } },
    ])
    expect(serializeMarkdown(doc)).toContain('<mention-page id="abc123" alias="true">Ref</mention-page>')
    expect(reparse(doc)).toEqual(doc)
  })

  it("internalRef block roundtrips via <mention-block>", () => {
    const doc = markSeed("Blk", [
      { type: "internalRef", attrs: { kind: "block", target: "note#blk-1" } },
    ])
    expect(reparse(doc)).toEqual(doc)
  })

  it("wikiLink: [[target]] when display equals target", () => {
    const doc = markSeed("Some Page", [{ type: "wikiLink", attrs: { target: "Some Page" } }])
    expect(serializeMarkdown(doc)).toContain("[[Some Page]]")
    expect(serializeMarkdown(doc)).not.toContain("\\[")
    expect(reparse(doc)).toEqual(doc)
  })

  it("wikiLink: [[target|display]] when aliased", () => {
    const doc = markSeed("shown", [{ type: "wikiLink", attrs: { target: "Real Page" } }])
    expect(serializeMarkdown(doc)).toContain("[[Real Page|shown]]")
    expect(reparse(doc)).toEqual(doc)
  })

  it("hand-typed Obsidian wikilink in prose parses", () => {
    const { doc } = parseMarkdown("see [[Some Page|the alias]] here\n")
    const marked = (doc.content?.[0]?.content ?? []).find((n) =>
      (n.marks ?? []).some((m) => m.type === "wikiLink"),
    )
    expect(marked?.text).toBe("the alias")
    expect(marked?.marks?.[0]?.attrs?.target).toBe("Some Page")
  })

  it("underline composes with bold and link (order-insensitive: PM ranks marks on apply)", () => {
    const doc = markSeed("combo", [
      { type: "bold" },
      { type: "underline" },
      { type: "link", attrs: { href: "https://example.com" } },
    ])
    const out = reparse(doc)
    const marked = (out.content?.[0]?.content ?? []).find((n) => n.text === "combo")
    const types = (marked?.marks ?? []).map((m) => m.type).sort()
    expect(types).toEqual(["bold", "link", "underline"])
    expect(reparse(out)).toEqual(out) // and the parsed order is itself stable
  })

  it("an unmatched <u> is preserved verbatim, not claimed as a mark", () => {
    // Was "degrades to literal text" before A2. The INTENT is unchanged — an
    // opening tag with no partner must not become an underline mark and must not
    // crash — but the carrier is now a rawInline atom, so the source also
    // survives byte-for-byte instead of being escaped on the way out.
    const md = "broken <u> tag\n"
    const { doc } = parseMarkdown(md)
    const inline = doc.content?.[0]?.content ?? []
    expect(inline.flatMap((n) => n.marks ?? [])).toEqual([])
    expect(inline).toEqual([
      { type: "text", text: "broken " },
      { type: "rawInline", attrs: { source: "<u>" } },
      { type: "text", text: " tag" },
    ])
    expect(serializeMarkdown(doc)).toBe(md)
  })

  it("a bare <span> without color attrs is NOT claimed", () => {
    const { doc } = parseMarkdown("a <span>plain</span> span\n")
    const marks = (doc.content?.[0]?.content ?? []).flatMap((n) => n.marks ?? [])
    expect(marks.find((m) => m.type === "textStyle")).toBeUndefined()
  })

  it("kitchen-sink inline paragraph reaches fixpoint", () => {
    const doc = blocks({
      type: "paragraph",
      content: [
        { type: "text", text: "a " },
        { type: "text", text: "u", marks: [{ type: "underline" }] },
        { type: "text", text: " b " },
        { type: "text", text: "red", marks: [{ type: "textStyle", attrs: { textColor: "red" } }] },
        { type: "text", text: " c " },
        { type: "text", text: "W", marks: [{ type: "wikiLink", attrs: { target: "W" } }] },
        { type: "text", text: " d " },
        { type: "text", text: "hl", marks: [{ type: "textStyle", attrs: { backgroundColor: "yellow" } }] },
        { type: "text", text: " e" },
      ],
    })
    const md = serializeMarkdown(doc)
    expect(parseMarkdown(md).doc).toEqual(doc)
    expect(serializeMarkdown(parseMarkdown(md).doc)).toBe(md)
  })
})

// GFM autolinks in two passes. Parse time matches SOURCE bytes (micromark) and
// is real syntax. Transform time is a `findAndReplace` over the mdast — over
// DECODED text — and it is the one that corrupts a storage codec: a URL we
// escaped on the way out (`https\://…`) decodes back to a URL on the way in and
// gets claimed as a link. `pipeline.ts` drops the second pass; these tests hold
// that boundary from both sides.
describe("autolink: parse-time syntax kept, transform-time linkification dropped", () => {
  const linkMarks = (doc: JSONContent): string[] => {
    const found: string[] = []
    const walk = (node: JSONContent): void => {
      for (const mark of node.marks ?? []) {
        if (mark.type === "link") found.push(String(mark.attrs?.href ?? ""))
      }
      ;(node.content ?? []).forEach(walk)
    }
    walk(doc)
    return found
  }

  // The user-stated policy for unsupported HTML: it may degrade to text, but it
  // must not be rewritten or corrupted on a later save. Escaping alone did not
  // achieve that — round 2 used to re-link the escaped URL and emit
  // `[https://example.com">link</a](https://example.com">link</a)`.
  for (const [name, md] of [
    ["an anchor tag", '<a href="https://example.com">link</a>\n'],
    ["a shields.io badge", '<p align="center"><img src="https://img.shields.io/x.svg" /></p>\n'],
    ["a bare URL inside a div", '<div class="x">see https://example.com</div>\n'],
    ["a www host inside a span", '<span foo="bar">www.example.com</span>\n'],
  ] as const) {
    it(`${name} degrades to text and is never re-processed`, () => {
      const { p1, md2, p2, md3 } = roundtrip(md)
      expect(md3).toBe(md2)
      expect(sameDocument(p2.doc, p1.doc)).toBe(true)
      expect(linkMarks(p1.doc)).toEqual([])
      // The two shapes the second pass used to produce out of escaped text.
      expect(md2).not.toContain("](")
      expect(md2).not.toContain("<https://")
    })
  }

  it("real autolinks are untouched — they are syntax, not a render-time affordance", () => {
    for (const [md, href] of [
      ["<a@b.com>\n", "mailto:a@b.com"],
      ["<https://example.com>\n", "https://example.com"],
      ["mail a@b.com now\n", "mailto:a@b.com"], // GFM literal, whitespace prefix
      ["visit www.example.com now\n", "http://www.example.com"], // GFM www literal
    ] as const) {
      const { p1, md2, p2, md3 } = roundtrip(md)
      expect(linkMarks(p1.doc), md.trim()).toEqual([href])
      expect(linkMarks(p2.doc), md.trim()).toEqual([href])
      expect(md3).toBe(md2)
    }
  })

  // A prefix GFM's www rule declines (`"` is not one of ` `, `(`, `*`, `_`, `[`,
  // `]`, `~`). github.com's SECOND pass links it anyway; we deliberately do not,
  // because modelling it means writing `[www.example.com](http://www.example.com)`
  // into the user's file on the next save.
  it("a www host in a prefix GFM declines stays text instead of rewriting the file", () => {
    const md = 'quoted "www.example.com" here\n'
    const { p1, md2, md3 } = roundtrip(md)
    expect(linkMarks(p1.doc)).toEqual([])
    expect(md2).not.toContain("](")
    expect(md3).toBe(md2)
  })

  // `&lt;a@b.com&gt;` is claimed by GFM's PARSE-time email rule, whose prefix
  // check allows everything but `/` and atext — so the entity form really does
  // hold a link, exactly as github.com renders it. `<<a@b.com>>` is not damage:
  // outer angle brackets literal, inner pair a CommonMark autolink, same reading
  // in every reader, and stable from the first save.
  it("an entity-escaped address round-trips and converges", () => {
    for (const md of [
      "&lt;a@b.com&gt;\n",
      "**&lt;a@b.com&gt;** tail\n",
      "&lt;a@b.com&gt; and *&lt;c@d.com&gt;*\n",
      "&lt;https://example.com&gt;\n",
    ]) {
      const { p1, md2, p2, md3 } = roundtrip(md)
      expect(md3, md.trim()).toBe(md2)
      expect(sameDocument(p2.doc, p1.doc), md.trim()).toBe(true)
      expect(countDuplicateMarks(p1.doc), md.trim()).toBe(0)
    }
  })

  // The strip is matched by extension SHAPE (`enter.literalAutolink`). If remark
  // renames that token the guard stops firing silently — this is the assertion
  // that would go red.
  it("the transform pass is actually gone (guard against a silent remark rename)", () => {
    // `;` is not an allowed www prefix at parse time, so only the transform
    // could produce a link here.
    expect(linkMarks(parseMarkdown(";www.example.com\n").doc)).toEqual([])
  })
})

describe("textStyle background (D4: == anchors yellow, <mark data-color> the rest)", () => {
  const bgSeed = (text: string, backgroundColor: string, extra: Mark[] = []) =>
    blocks({
      type: "paragraph",
      content: [
        { type: "text", text: "lead " },
        { type: "text", text, marks: [{ type: "textStyle", attrs: { backgroundColor } }, ...extra] },
        { type: "text", text: " tail" },
      ],
    })
  type Mark = { type: string; attrs?: Record<string, unknown> }

  it("yellow background writes ==…== and roundtrips", () => {
    const doc = bgSeed("hi", "yellow")
    expect(serializeMarkdown(doc)).toContain("lead ==hi== tail")
    expect(reparse(doc)).toEqual(doc)
  })

  it("a non-yellow background writes <mark data-color> and roundtrips", () => {
    const doc = bgSeed("cool", "blue")
    expect(serializeMarkdown(doc)).toContain('<mark data-color="blue">cool</mark>')
    expect(reparse(doc)).toEqual(doc)
  })

  it("a bare <mark> reads as yellow and canonicalizes to ==", () => {
    const { doc } = parseMarkdown("a <mark>hot</mark> b\n")
    const marked = (doc.content?.[0]?.content ?? []).find((n) => n.text === "hot")
    expect(marked?.marks?.[0]?.attrs?.backgroundColor).toBe("yellow")
    expect(serializeMarkdown(doc)).toContain("a ==hot== b")
  })

  it("legacy <span data-background-color> still reads; writes forward as <mark>", () => {
    const { doc } = parseMarkdown('x <span data-background-color="blue">old</span> y\n')
    const marked = (doc.content?.[0]?.content ?? []).find((n) => n.text === "old")
    expect(marked?.marks?.[0]?.attrs?.backgroundColor).toBe("blue")
    expect(serializeMarkdown(doc)).toContain('<mark data-color="blue">old</mark>')
  })

  it("hand-typed ==**bold**== promotes across nodes and reaches fixpoint", () => {
    const { doc } = parseMarkdown("see ==**bold**== here\n")
    const marked = (doc.content?.[0]?.content ?? []).find((n) => n.text === "bold")
    const types = (marked?.marks ?? []).map((m) => m.type).sort()
    expect(types).toEqual(["bold", "textStyle"])
    const md = serializeMarkdown(doc)
    expect(md).toContain("==**bold**==")
    expect(parseMarkdown(md).doc).toEqual(doc)
  })

  it("a run of same-background nodes shares ONE pair (no ==a====b==)", () => {
    const doc = blocks({
      type: "paragraph",
      content: [
        { type: "text", text: "a", marks: [{ type: "textStyle", attrs: { backgroundColor: "yellow" } }] },
        {
          type: "text",
          text: "b",
          marks: [{ type: "textStyle", attrs: { backgroundColor: "yellow" } }, { type: "bold" }],
        },
      ],
    })
    const md = serializeMarkdown(doc)
    expect(md).toContain("==a**b**==")
    expect(md).not.toContain("====")
    expect(reparse(doc)).toEqual(doc)
  })

  it("flanking-unsafe edges fall back to <mark> (space would break ==)", () => {
    const doc = bgSeed(" padded ", "yellow")
    expect(serializeMarkdown(doc)).toContain("<mark> padded </mark>")
    expect(reparse(doc)).toEqual(doc)
  })

  it("prose `a == b == c` stays literal (flanking guard)", () => {
    const { doc } = parseMarkdown("a == b == c\n")
    const marks = (doc.content?.[0]?.content ?? []).flatMap((n) => n.marks ?? [])
    expect(marks).toEqual([])
    expect((doc.content?.[0]?.content ?? []).map((n) => n.text).join("")).toBe("a == b == c")
  })

  it("literally-typed ==x== promotes on read — the same reading Obsidian gives it", () => {
    const { doc } = parseMarkdown("typed ==real== here\n")
    const marked = (doc.content?.[0]?.content ?? []).find((n) => n.text === "real")
    expect(marked?.marks?.[0]?.type).toBe("textStyle")
  })
})

describe("media blocks (D5: embeds ride ![](), assets ride paired tags)", () => {
  const WATCH = "https://www.youtube.com/watch?v=abc12345678"
  const EMBED = "https://www.youtube.com/embed/abc12345678"
  const MP4 = "https://cdn.example.com/media/clip.mp4"
  const MP3 = "https://cdn.example.com/media/song.mp3"

  it("video embed writes ![title](sourceUrl) and roundtrips", () => {
    const doc = blocks({
      type: "video",
      attrs: {
        sourceType: "embed",
        embedUrl: EMBED,
        provider: "youtube",
        sourceUrl: WATCH,
        title: "Demo",
      },
    })
    expect(serializeMarkdown(doc)).toContain(`![Demo](${WATCH})`)
    expect(reparse(doc)).toEqual(doc)
  })

  it("hand-typed ![](youtube-url) promotes to a video embed with embedUrl recomputed", () => {
    const { doc } = parseMarkdown("![](https://youtu.be/abc12345678)\n")
    const video = doc.content?.[0]
    expect(video?.type).toBe("video")
    expect(video?.attrs?.provider).toBe("youtube")
    expect(video?.attrs?.embedUrl).toBe(EMBED)
  })

  it("video asset writes a paired <video controls> tag and roundtrips", () => {
    const doc = blocks({
      type: "video",
      attrs: { sourceType: "asset", src: MP4, sourceUrl: MP4, title: "Clip" },
    })
    expect(serializeMarkdown(doc)).toContain(
      `<video src="${MP4}" title="Clip" controls></video>`,
    )
    expect(reparse(doc)).toEqual(doc)
  })

  it("audio asset writes a paired <audio controls> tag and roundtrips", () => {
    const doc = blocks({
      type: "audio",
      attrs: { sourceType: "asset", src: MP3, sourceUrl: MP3 },
    })
    expect(serializeMarkdown(doc)).toContain(`<audio src="${MP3}" controls></audio>`)
    expect(reparse(doc)).toEqual(doc)
  })

  it("width/height survive the asset tag", () => {
    const doc = blocks({
      type: "video",
      attrs: { sourceType: "asset", src: MP4, sourceUrl: MP4, width: 640, height: 360 },
    })
    expect(serializeMarkdown(doc)).toContain('width="640" height="360" controls')
    expect(reparse(doc)).toEqual(doc)
  })

  it("![](file.mp4) / ![](file.mp3) promote by extension", () => {
    const { doc } = parseMarkdown(`![](${MP4})\n\n![](${MP3})\n`)
    expect(doc.content?.map((b) => b.type)).toEqual(["video", "audio"])
  })

  it("![](photo.png) and extension-less URLs stay images (Image owns the grammar)", () => {
    const { doc } = parseMarkdown(
      "![](https://cdn.example.com/photo.png)\n\n![](https://cdn.example.com/asset123)\n",
    )
    expect(doc.content?.map((b) => b.type)).toEqual(["image", "image"])
  })

  it("a <video> tag whose src is a provider URL normalizes forward to embed attrs", () => {
    const { doc } = parseMarkdown(`<video src="${WATCH}"></video>\n`)
    expect(doc.content?.[0]?.type).toBe("video")
    expect(doc.content?.[0]?.attrs?.sourceType).toBe("embed")
    expect(serializeMarkdown(doc)).toContain(`![](${WATCH})`)
  })

  it("a self-closing <video /> from external files is read generously", () => {
    const { doc } = parseMarkdown(`<video src="${MP4}" />\n`)
    expect(doc.content?.[0]?.type).toBe("video")
    expect(doc.content?.[0]?.attrs?.src).toBe(MP4)
  })

  it("a srcless <video> tag stays visible literal text, never claimed", () => {
    const { doc } = parseMarkdown("<video controls></video>\n")
    expect(doc.content?.[0]?.type).toBe("paragraph")
  })
})

// A soft wrap is a SPACE; a hard break is a LINE BREAK. Reading the first as
// the second was the largest fidelity defect measured (§3.9 C5) — and, being
// symmetric, it passed the structural gate on every one of the ~33% of files it
// touched. The newline now stays inside the text value, which is a shape PM
// permits and the editor renders correctly (paragraphs are `white-space:
// normal` — rune ships no ProseMirror base stylesheet).
describe("soft wrap vs hard break (C5)", () => {
  it("a soft-wrapped paragraph comes back byte-for-byte, as one text node", () => {
    const md = "This is a paragraph that the author\nsoft-wrapped across two lines.\n"
    const { p1, md2, md3 } = roundtrip(md)
    expect(p1.doc.content?.[0]?.content).toEqual([
      { type: "text", text: "This is a paragraph that the author\nsoft-wrapped across two lines." },
    ])
    expect(md2).toBe(md)
    expect(md3).toBe(md2)
  })

  it("a real hard break is still a hard break", () => {
    // The two must stay distinguishable, which is the whole reason the fix is
    // "stop splitting" rather than "join into a space".
    for (const md of ["before\\\nafter\n", "before  \nafter\n"]) {
      const { p1 } = roundtrip(md)
      expect(p1.doc.content?.[0]?.content).toEqual([
        { type: "text", text: "before" },
        { type: "hardBreak" },
        { type: "text", text: "after" },
      ])
    }
    // …and writes back in the native form.
    expect(roundtrip("before\\\nafter\n").md2).toBe("before\\\nafter\n")
  })

  it("settles the one position the writer cannot spell as a soft wrap", () => {
    // A newline ending a text value that has a following sibling has to become
    // a space — there it is no longer between two words. The reader adopts that
    // answer so the two agree in ONE save instead of disagreeing forever.
    const md = "alpha\n<u>bravo</u>\n"
    const { p1, md2, p2, md3 } = roundtrip(md)
    expect(p1.doc.content?.[0]?.content?.[0]).toEqual({ type: "text", text: "alpha " })
    expect(md2).toBe("alpha <u>bravo</u>\n")
    expect(sameDocument(p2.doc, p1.doc)).toBe(true)
    expect(md3).toBe(md2)
  })

  it("normalizes CRLF and a BOM rather than leaking them into the text (D14)", () => {
    // A CRLF file used to leave a BARE `\r` inside the document's prose: the
    // `\n` was consumed as a line break and the `\r` was not. It reached the
    // editor, was written back to the file, and was a fixpoint — so nothing
    // could see it.
    const { p1, md2 } = roundtrip("﻿# Title\r\n\r\nline one\r\nline two\r\n")
    expect(JSON.stringify(p1.doc)).not.toContain("\\r")
    expect(md2).toBe("# Title\n\nline one\nline two\n")
    expect(md2.charCodeAt(0)).not.toBe(0xfeff)
  })
})

// D6. Width rides Obsidian's native `![alt|300](src)`, which every other reader
// shows as alt text rather than breaking on. Alignment has no Markdown spelling
// at all, so a non-default one upgrades to `<img>` — declared on the Image
// block's own contract, which runs before the builtin mapping.
describe("image width and alignment (D6)", () => {
  it("carries width in the alt, and reads it back", () => {
    const { p1, md2 } = roundtrip("![alt|300](a.png)\n")
    expect(p1.doc.content?.[0]).toEqual({
      type: "image",
      attrs: { src: "a.png", alt: "alt", width: 300 },
    })
    expect(md2).toBe("![alt|300](a.png)\n")
  })

  it("only treats a TRAILING all-digit segment as a width", () => {
    // An alt that legitimately contains a pipe stays alt text.
    const { p1, md2 } = roundtrip("![a|b](x.png)\n")
    expect(p1.doc.content?.[0]?.attrs).toEqual({ src: "x.png", alt: "a|b" })
    expect(md2).toBe("![a|b](x.png)\n")
  })

  it("leaves a centered image as plain CommonMark", () => {
    // `center` is the default, so the common image never grows a tag.
    const doc = blocks({ type: "image", attrs: { src: "a.png", alt: "alt", align: "center" } })
    expect(serializeMarkdown(doc)).toBe("![alt](a.png)\n")
  })

  it("upgrades a left/right image to <img>, and reads it back", () => {
    for (const align of ["left", "right"] as const) {
      const doc = blocks({
        type: "image",
        attrs: { src: "a.png", alt: "alt", width: 300, align },
      })
      const md = serializeMarkdown(doc)
      expect(md).toBe(`<img src="a.png" alt="alt" width="300" align="${align}">\n`)
      expect(parseMarkdown(md).doc.content?.[0]).toEqual({
        type: "image",
        attrs: { src: "a.png", alt: "alt", align, width: 300 },
      })
    }
  })

  it("keeps a title when alignment uses the HTML image form", () => {
    const doc = blocks({
      type: "image",
      attrs: { src: "a.png", alt: "alt", title: 'q"uote', align: "left" },
    })
    const md = serializeMarkdown(doc)
    expect(md).toBe('<img src="a.png" alt="alt" title="q&quot;uote" align="left">\n')
    expect(parseMarkdown(md).doc).toEqual(doc)
  })

  it("does NOT claim a hand-written <img> that carries no alignment", () => {
    // Reading it as an image would rewrite the author's tag into `![]()` on the
    // next save. The raw carrier keeps their bytes instead.
    const md = '<img src="a.png" alt="x">\n'
    const { p1, md2 } = roundtrip(md)
    expect(p1.doc.content?.[0]?.type).toBe("rawBlock")
    expect(md2).toBe(md)
  })

  it("escapes attribute values that come from the document", () => {
    const doc = blocks({
      type: "image",
      attrs: { src: "a.png", alt: 'q"uote & <tag>', align: "left" },
    })
    const md = serializeMarkdown(doc)
    expect(md).toContain('alt="q&quot;uote &amp; &lt;tag&gt;"')
    expect(parseMarkdown(md).doc.content?.[0]?.attrs?.alt).toBe('q"uote & <tag>')
  })
})

// rune's flat schema owns an image BLOCK and no inline image node, so an image
// standing next to other inline content has nowhere to go. It used to degrade
// to its alt text, silently discarding the URL — 327 URLs across 80 of 800
// external files, because a README badge row is exactly this shape.
describe("inline images keep their URL (raw carrier)", () => {
  it("keeps an image that shares a line with text", () => {
    // The corpus shape: a list item whose continuation line is a screenshot.
    // The URL is what used to vanish — this is the assertion that matters.
    const md = "- The timestamp has hover with the exact time.\n  ![Timestamp](exact-time.png)\n"
    const { p1, md2, p2, md3 } = roundtrip(md)
    expect(JSON.stringify(p1.doc)).toContain("exact-time.png")

    // The wrap before the image lands in the one position the writer cannot
    // spell as a soft wrap, so it settles to a space and the item becomes one
    // line. Render-identical, and stable from the first save onward.
    expect(md2).toBe("- The timestamp has hover with the exact time. ![Timestamp](exact-time.png)\n")
    expect(sameDocument(p2.doc, p1.doc)).toBe(true)
    expect(md3).toBe(md2)
  })

  it("keeps a badge row — the measured corpus shape", () => {
    const md =
      "[![build](https://img.shields.io/badge/build-passing-green.svg)](https://ci.example.com) " +
      "![npm](https://img.shields.io/npm/v/monaco-editor)\n"
    const { p1, md2 } = roundtrip(md)
    expect(JSON.stringify(p1.doc)).toContain("img.shields.io/npm/v/monaco-editor")
    expect(md2).toBe(md)
  })

  it("still promotes a LONE image paragraph to a first-class image block", () => {
    // The carrier must not swallow the mapping that already existed.
    const { p1, md2 } = roundtrip("![alt](a.png)\n")
    expect(p1.doc.content?.[0]).toEqual({ type: "image", attrs: { src: "a.png", alt: "alt" } })
    expect(md2).toBe("![alt](a.png)\n")
  })

  it("rebuilds the source when no slice is available, including a title", () => {
    // Inside a list item the slice is refused, so the bytes are reconstructed.
    for (const md of [
      '- text ![alt](a.png "the title")\n',
      '- text ![alt](a.png "the \\"title\\"")\n',
      "- text ![a \\] b](a.png)\n",
      "- text ![](a.png)\n",
      "- text ![alt](<a b.png>)\n",
    ]) {
      const { p1, md2, p2, md3 } = roundtrip(md)
      expect(md2).toBe(md)
      expect(sameDocument(p2.doc, p1.doc)).toBe(true)
      expect(md3).toBe(md2)
    }
  })

  it("keeps a standalone image title in the image block", () => {
    const md = '![alt](a.png "Caption")\n'
    const { p1, md2, p2 } = roundtrip(md)
    expect(p1.doc.content?.[0]).toEqual({
      type: "image",
      attrs: { src: "a.png", alt: "alt", title: "Caption" },
    })
    expect(md2).toBe(md)
    expect(p2.doc).toEqual(p1.doc)
  })
})

// `<br>` is the one HTML tag rune CLAIMS rather than degrades, because the
// editor lets Shift+Enter put a hard break inside a table cell and a GFM row
// cannot span physical lines. Reading is uniform; writing picks the native
// backslash form wherever it is lossless and `<br>` where it is not.
describe("the <br> contract (hard breaks that markdown cannot spell natively)", () => {
  const cell = (...content: JSONContent[]): JSONContent => ({
    type: "tableCell",
    content: [{ type: "tableParagraph", content }],
  })
  const header = (text: string): JSONContent => ({
    type: "tableHeader",
    content: [{ type: "tableParagraph", content: [{ type: "text", text }] }],
  })

  it("a hard break the editor put in a cell round-trips (the reason this exists)", () => {
    const doc = blocks({
      type: "table",
      content: [
        { type: "tableRow", content: [header("a"), header("b")] },
        {
          type: "tableRow",
          content: [
            cell({ type: "text", text: "line1" }, { type: "hardBreak" }, { type: "text", text: "line2" }),
            cell({ type: "text", text: "c" }),
          ],
        },
      ],
    })
    const md = serializeMarkdown(doc)
    expect(md).toContain("| line1<br>line2 | c |")
    expect(parseMarkdown(md).doc).toEqual(doc)
    expect(serializeMarkdown(parseMarkdown(md).doc)).toBe(md)
  })

  for (const [name, md] of [
    ["<br>", "| a | b |\n| - | - |\n| line1<br>line2 | c |\n"],
    ["<br/>", "| a | b |\n| - | - |\n| line1<br/>line2 | c |\n"],
    ["<br />", "| a | b |\n| - | - |\n| line1<br />line2 | c |\n"],
    ["<BR>", "| a | b |\n| - | - |\n| line1<BR>line2 | c |\n"],
  ] as const) {
    it(`${name} in a cell reads as a hard break and canonicalizes to <br>`, () => {
      const { p1, md2, p2, md3 } = roundtrip(md)
      expect(sameDocument(p2.doc, p1.doc)).toBe(true)
      expect(md2).toContain("| line1<br>line2 | c |")
      expect(md3).toBe(md2)
    })
  }

  it("marks survive on both sides of a break in a cell", () => {
    const md = "| a | b |\n| - | - |\n| **bold**<br>*em* | c |\n"
    const { p1, md2, p2, md3 } = roundtrip(md)
    expect(md2).toBe(md)
    expect(md3).toBe(md2)
    expect(sameDocument(p2.doc, p1.doc)).toBe(true)
  })

  it("an ordinary paragraph keeps the NATIVE form — no tags pushed into prose", () => {
    const doc = blocks({
      type: "paragraph",
      content: [{ type: "text", text: "a" }, { type: "hardBreak" }, { type: "text", text: "b" }],
    })
    const md = serializeMarkdown(doc)
    expect(md).toBe("a\\\nb\n")
    expect(md).not.toContain("<br>")
    expect(parseMarkdown(md).doc).toEqual(doc)
  })

  // `a\` at the END of a block is a literal backslash, not a break, so the
  // native form would re-parse as text and the escape would double on every
  // save (`a\` → `a\\` → `a\\\\`). Trailing breaks therefore take `<br>` even
  // in prose — the lossless form wins over the stylistic default.
  for (const [name, md, written] of [
    ["one trailing break", "a<br>\n", "a<br>\n"],
    ["two trailing breaks", "a<br><br>\n", "a<br><br>\n"],
    // Only the TRAILING break needs the tag; the mid-paragraph one stays native.
    ["a break mid-paragraph and one trailing", "a<br>b<br>\n", "a\\\nb<br>\n"],
  ] as const) {
    it(`${name} survives instead of escape-spiralling`, () => {
      const { p1, md2, p2, md3 } = roundtrip(md)
      expect(md2).toBe(written)
      expect(md3).toBe(md2)
      expect(sameDocument(p2.doc, p1.doc)).toBe(true)
      expect(md2).not.toContain("\\\\")
    })
  }

  it("a real trailing backslash in text is still literal text, not a break", () => {
    const { p1 } = roundtrip("a\\\n")
    const runs = p1.doc.content?.[0]?.content ?? []
    expect(runs.every((node) => node.type !== "hardBreak")).toBe(true)
  })

  it("claiming <br> does not claim any other tag", () => {
    // Post-A2 the unrecognised tags are rawInline atoms rather than literal text.
    // The guard is the same one: nothing here may become a hardBreak, and the
    // source must come back out exactly as written.
    const md = "a <span foo>x</span> b\n"
    const { doc } = parseMarkdown(md)
    const inline = doc.content?.[0]?.content ?? []
    expect(inline.some((n) => n.type === "hardBreak")).toBe(false)
    expect(serializeMarkdown(doc)).toBe(md)
  })
})

describe("table column alignment (GFM `:--|:-:|--:` fidelity passthrough)", () => {
  const ALIGNED = "| L | C | R |\n|:--|:-:|--:|\n| a | b | c |\n"

  it("an external aligned table keeps left/center/right across saves", () => {
    const { p1, md2, md3 } = roundtrip(ALIGNED)
    expect(p1.doc.content?.[0]?.attrs?.columnAligns).toEqual(["left", "center", "right"])
    expect(md2).toContain(":-")
    expect(md2).toContain("-:")
    expect(md3).toBe(md2)
    expect(parseMarkdown(md2).doc).toEqual(p1.doc)
  })

  it("mixed aligned/unaligned columns survive; all-null stays attr-less", () => {
    const { doc } = parseMarkdown("| A | B |\n|---|--:|\n| 1 | 2 |\n")
    expect(doc.content?.[0]?.attrs?.columnAligns).toEqual([null, "right"])
    const plain = parseMarkdown("| A | B |\n|---|---|\n| 1 | 2 |\n").doc
    expect(plain.content?.[0]?.attrs?.columnAligns).toBeUndefined()
  })
})

describe("heading identity for external H5/H6 (UI stays H1–H4)", () => {
  it("##### and ###### keep their outline depth across saves", () => {
    const { md2, md3 } = roundtrip("##### Five\n\n###### Six\n")
    expect(md2).toContain("##### Five")
    expect(md2).toContain("###### Six")
    expect(md3).toBe(md2)
  })

  it("levels 5 and 6 are stored distinctly", () => {
    const { doc } = parseMarkdown("##### Five\n\n###### Six\n")
    expect(doc.content?.map((b) => [b.type, b.attrs?.level])).toEqual([
      ["heading", 5],
      ["heading", 6],
    ])
  })
})

describe("table of contents (D5: empty toc fence carries position only)", () => {
  it("writes an empty ```toc fence and roundtrips", () => {
    const doc = blocks({ type: "tableOfContents" })
    const md = serializeMarkdown(doc)
    expect(md).toContain("```toc")
    expect(reparse(doc)).toEqual(doc)
  })

  it("a ```toc fence WITH content stays a codeBlock (external files untouched)", () => {
    const { doc } = parseMarkdown("```toc\nreal code\n```\n")
    expect(doc.content?.[0]?.type).toBe("codeBlock")
    expect(doc.content?.[0]?.attrs?.language).toBe("toc")
  })
})
