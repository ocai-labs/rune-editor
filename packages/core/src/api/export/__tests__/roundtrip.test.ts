// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The Tier 0 gate: serialize (exportMarkdown) → scoped parse (parseAiMarkdown)
// must be structurally identical to the original doc content. This is THE
// contract that makes the `apply_edits` quote-don't-compute path safe — if the
// round-trip holds, a whole-block re-parse is equivalent to a surgical splice.
// See internal design notes.

import { describe, it, expect } from "vitest"
import type { JSONContent } from "@tiptap/core"
import { createTestEditor } from "../../../test-utils/createTestEditor"
import { exportMarkdown } from "../markdown"
import { parseAiMarkdown } from "../../../extensions/clipboard/aiMarkdown"

// ── structural canonicalization ────────────────────────────────────────────
// Compare only what markdown can represent: block type/order/depth, the
// props markdown carries (level, language, checked, start…), text, and marks
// with attrs. Block `id`s never survive a parse, so strip them; a null/absent
// attr and an omitted one are the same thing (default), so drop nulls; marks
// are sorted by type so nesting-order canonicalization on both sides matches.

type Attrs = Record<string, unknown>

function canonAttrs(attrs?: Attrs): Attrs | undefined {
  if (!attrs) return undefined
  const out: Attrs = {}
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "id") continue
    if (v === null || v === undefined) continue
    out[k] = v
  }
  return Object.keys(out).length > 0 ? out : undefined
}

interface CanonMark {
  type: string
  attrs?: Attrs
}

function canonMarks(marks?: Array<{ type: string; attrs?: Attrs }>): CanonMark[] | undefined {
  if (!marks || marks.length === 0) return undefined
  return marks
    .map((m) => {
      const attrs = canonAttrs(m.attrs)
      return attrs ? { type: m.type, attrs } : { type: m.type }
    })
    .sort((a, b) => a.type.localeCompare(b.type))
}

function canon(node: JSONContent): JSONContent {
  const out: JSONContent = { type: node.type }
  const attrs = canonAttrs(node.attrs)
  if (attrs) out.attrs = attrs
  if (typeof node.text === "string") out.text = node.text
  const marks = canonMarks(node.marks as CanonMark[] | undefined)
  if (marks) out.marks = marks as JSONContent["marks"]
  if (Array.isArray(node.content)) out.content = node.content.map(canon)
  return out
}

function roundTrip(content: JSONContent[]) {
  const editor = createTestEditor({ content: { type: "doc", content } })
  const markdown = exportMarkdown(editor)
  const parsed = parseAiMarkdown(markdown, editor.schema)
  const original = editor.state.doc.toJSON() as JSONContent
  return { markdown, parsed, original }
}

function expectRoundTrip(content: JSONContent[], label = ""): string {
  const { markdown, parsed, original } = roundTrip(content)
  const got = canon(parsed)
  const want = canon(original)
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    // eslint-disable-next-line no-console
    console.error(`[roundtrip ${label}] markdown was: ${JSON.stringify(markdown)}`)
  }
  expect(got).toEqual(want)
  return markdown
}

// Convenience builders.
const para = (content: JSONContent[]): JSONContent => ({
  type: "paragraph",
  attrs: { id: "b", depth: 0 },
  content,
})
const text = (t: string, marks?: JSONContent["marks"]): JSONContent =>
  marks ? { type: "text", text: t, marks } : { type: "text", text: t }

// Table sub-structure builders. tableCell/tableHeader/tableParagraph carry no
// id/depth (blocks/Table/nodes.ts — they're not page-body blocks).
const tableCellNode = (t: string, header = false): JSONContent => ({
  type: header ? "tableHeader" : "tableCell",
  content: [{ type: "tableParagraph", content: t === "" ? undefined : [text(t)] }],
})
const tableRow = (cells: string[], header = false): JSONContent => ({
  type: "tableRow",
  content: cells.map((c) => tableCellNode(c, header)),
})
// Build a row from pre-built cell nodes directly (bypassing the one-cell-
// per-string convenience above), so a row can mix stacked/embedded-break
// cells with plain ones.
const tableRowOf = (cells: JSONContent[]): JSONContent => ({
  type: "tableRow",
  content: cells,
})
// A cell with N SIBLING tableParagraphs, one per line — the canonical
// multi-line-cell shape `serializeTableMarkdown` reads/writes
// (`parts.join("<br>")` across siblings). An empty-string line is an empty
// tableParagraph (a genuinely blank line), same convention as
// `tableCellNode`'s empty-string handling above.
const tableCellStacked = (lines: string[], header = false): JSONContent => ({
  type: header ? "tableHeader" : "tableCell",
  content: lines.map((t) => ({ type: "tableParagraph", content: t === "" ? undefined : [text(t)] })),
})
// A cell with ONE tableParagraph whose lines are joined by embedded
// `hardBreak` nodes instead of split into siblings — the non-canonical
// shape TableCellNormalization (blocks/Table/normalization.ts) converges to
// the stacked shape above (reachable via setContent / AI edits / collab,
// never through the keyboard — TableCommands' Shift/Mod-Enter override
// always splits instead).
const tableCellEmbeddedBreak = (lines: string[], header = false): JSONContent => ({
  type: header ? "tableHeader" : "tableCell",
  content: [
    {
      type: "tableParagraph",
      content: lines.flatMap((t, i) => (i === 0 ? [text(t)] : [{ type: "hardBreak" }, text(t)])),
    },
  ],
})
const table = (id: string, rows: JSONContent[]): JSONContent => ({
  type: "table",
  attrs: { id, depth: 0 },
  content: rows,
})

describe("exportMarkdown → parseAiMarkdown round-trip", () => {
  describe("inline styling matrix", () => {
    it("inline code", () => {
      expectRoundTrip([para([text("call "), text("fn()", [{ type: "code" }])])], "code")
    })

    it("code + color (the headline case: code mark + textStyle mark on same text)", () => {
      const md = expectRoundTrip(
        [
          para([
            text("fn()", [
              { type: "code" },
              { type: "textStyle", attrs: { textColor: "blue" } },
            ]),
          ]),
        ],
        "code+color",
      )
      // Sanity: the span must sit OUTSIDE the backticks in the dialect.
      expect(md).toContain('<span data-text-color="blue">`fn()`</span>')
    })

    it("bold / italic / strike", () => {
      expectRoundTrip(
        [
          para([
            text("b", [{ type: "bold" }]),
            text(" "),
            text("i", [{ type: "italic" }]),
            text(" "),
            text("s", [{ type: "strike" }]),
          ]),
        ],
        "bis",
      )
    })

    it("links", () => {
      expectRoundTrip(
        [para([text("click", [{ type: "link", attrs: { href: "https://example.com" } }])])],
        "link",
      )
    })

    it("nested marks (link ⊃ bold ⊃ colored text)", () => {
      expectRoundTrip(
        [
          para([
            text("deep", [
              { type: "link", attrs: { href: "https://example.com" } },
              { type: "bold" },
              { type: "textStyle", attrs: { textColor: "blue" } },
            ]),
          ]),
        ],
        "nested",
      )
    })

    it("color-only span (same text, only textStyle differs)", () => {
      expectRoundTrip(
        [
          para([
            text("plain "),
            text("colored", [{ type: "textStyle", attrs: { textColor: "red" } }]),
          ]),
        ],
        "color-only",
      )
    })

    it("background-color span", () => {
      expectRoundTrip(
        [para([text("hi", [{ type: "textStyle", attrs: { backgroundColor: "yellow" } }])])],
        "bg-color",
      )
    })

    it("underline", () => {
      expectRoundTrip([para([text("under", [{ type: "underline" }])])], "underline")
    })

    it("wikiLink without alias", () => {
      expectRoundTrip(
        [para([text("My Page", [{ type: "wikiLink", attrs: { target: "My Page" } }])])],
        "wiki-noalias",
      )
    })

    it("wikiLink with alias", () => {
      expectRoundTrip(
        [para([text("Display", [{ type: "wikiLink", attrs: { target: "Target" } }])])],
        "wiki-alias",
      )
    })

    // internalRef's page/block-kind mentions round-trip through the
    // Notion-mention-style `<mention-page id="…">`/`<mention-block id="…">`
    // shape (markInlineContract.ts). `canon`/`expectRoundTrip` compare
    // attr-for-attr (including `alias`), so these pin identity, not just
    // "some mark survived".
    describe("internalRef mention round-trip", () => {
      it("page, alias: false", () => {
        const md = expectRoundTrip(
          [para([text("Some Page", [{ type: "internalRef", attrs: { kind: "page", target: "Some Page" } }])])],
          "mention-page-noalias",
        )
        expect(md).toContain('<mention-page id="Some Page">Some Page</mention-page>')
        expect(md).not.toContain("alias=")
      })

      it("page, alias: true", () => {
        const md = expectRoundTrip(
          [para([text("Display", [{ type: "internalRef", attrs: { kind: "page", target: "Target", alias: true } }])])],
          "mention-page-alias",
        )
        expect(md).toContain('<mention-page id="Target" alias="true">Display</mention-page>')
      })

      it("block (target is an opaque host-composed string, e.g. zyler's `<noteId>#<blockId>`)", () => {
        const md = expectRoundTrip(
          [para([text("Block ref", [{ type: "internalRef", attrs: { kind: "block", target: "note-1#block-2" } }])])],
          "mention-block",
        )
        expect(md).toContain('<mention-block id="note-1#block-2">Block ref</mention-block>')
      })

      it("label with special characters (quotes, angle bracket, ampersand, pipe, [[)", () => {
        expectRoundTrip(
          [
            para([
              text('a "quoted" <tag> & pipe | [[wiki]]', [
                { type: "internalRef", attrs: { kind: "page", target: "Target" } },
              ]),
            ]),
          ],
          "mention-label-special-chars",
        )
      })

      it("target containing a double quote", () => {
        const md = expectRoundTrip(
          [para([text("ref", [{ type: "internalRef", attrs: { kind: "page", target: 'a "quoted" target' } }])])],
          "mention-target-quote",
        )
        expect(md).toContain('id="a &quot;quoted&quot; target"')
      })

      it("coexists with a [[wikiLink]] in the same paragraph", () => {
        expectRoundTrip(
          [
            para([
              text("See "),
              text("Some Page", [{ type: "internalRef", attrs: { kind: "page", target: "Some Page" } }]),
              text(" and "),
              text("Other Page", [{ type: "wikiLink", attrs: { target: "Other Page" } }]),
              text("."),
            ]),
          ],
          "mention-and-wikilink",
        )
      })

      // Pins the ACTUAL nesting behavior: internalRef and textStyle are both
      // `html`-metadata contract entries (the outermost wrapWithMarks stage,
      // serializeInline.ts), applied in schema-rank order — internalRef is
      // registered after color/textStyle in kit.ts, so it wraps OUTSIDE the
      // color span, which wraps OUTSIDE bold. Pinned exactly, not just
      // "some mark survived", since this ordering is what makes the
      // round-trip hold at all.
      it("stacks with bold and a color span (bold middle, color inside mention)", () => {
        const md = expectRoundTrip(
          [
            para([
              text("x", [
                { type: "bold" },
                { type: "textStyle", attrs: { textColor: "blue" } },
                { type: "internalRef", attrs: { kind: "page", target: "Target" } },
              ]),
            ]),
          ],
          "mention-bold-color",
        )
        expect(md).toContain(
          '<mention-page id="Target"><span data-text-color="blue">**x**</span></mention-page>',
        )
      })
    })

    it("inlineMath", () => {
      expectRoundTrip(
        [
          para([
            text("energy is "),
            { type: "inlineMath", attrs: { latex: "E = mc^2" } },
          ]),
        ],
        "math",
      )
    })

    // #21 — hardBreak used to be silently dropped on export ("line1line2"),
    // corrupting the read surface and refusing apply_edits. A regular
    // paragraph's hardBreak round-trips as-is (embedded, NOT split) — a
    // `<br>` mid `<p>` is directly valid tableParagraph-style inline
    // content for `paragraph` too, so no cell-splitter-style normalization
    // is needed here; that machinery is table-cell-specific (see the
    // "table round-trip" describe below).
    it("a hardBreak inside a regular paragraph (#21)", () => {
      const md = expectRoundTrip(
        [para([text("line1"), { type: "hardBreak" }, text("line2")])],
        "hardbreak-paragraph",
      )
      expect(md).toContain("line1<br>line2")
      expect(md).not.toContain("line1line2")
    })
  })

  // `code` content is verbatim on re-parse, so every OTHER mark's syntax must
  // wrap OUTSIDE the backticks or it can never round-trip (bold inside backticks
  // is literal `**x**` text). Before the code-innermost fix these all serialized
  // as `` `**x**` `` / `` `[x](url)` `` and failed the structural compare.
  describe("code wraps innermost among markdown marks (A1)", () => {
    it("code + bold", () => {
      const md = expectRoundTrip(
        [para([text("x", [{ type: "code" }, { type: "bold" }])])],
        "code+bold",
      )
      expect(md).toContain("**`x`**")
    })

    it("code + italic", () => {
      const md = expectRoundTrip(
        [para([text("x", [{ type: "code" }, { type: "italic" }])])],
        "code+italic",
      )
      expect(md).toContain("*`x`*")
    })

    it("code + strike", () => {
      const md = expectRoundTrip(
        [para([text("x", [{ type: "code" }, { type: "strike" }])])],
        "code+strike",
      )
      expect(md).toContain("~~`x`~~")
    })

    // NOTE: code + link is NOT a round-trip case — the schema's
    // `Code.extend({ excludes: "link wikiLink internalRef" })` forbids the two
    // marks coexisting, so a code span inside link text drops the link mark on
    // re-parse. Its serialization order (code innermost → `[`x`](url)`) is
    // pinned in serializeInline.test.ts instead.

    it("code + bold + color (html outermost, bold middle, code innermost)", () => {
      const md = expectRoundTrip(
        [
          para([
            text("x", [
              { type: "code" },
              { type: "bold" },
              { type: "textStyle", attrs: { textColor: "blue" } },
            ]),
          ]),
        ],
        "code+bold+color",
      )
      expect(md).toContain('<span data-text-color="blue">**`x`**</span>')
    })

    it("a paragraph mixing a plain code span AND a bold+code span", () => {
      const md = expectRoundTrip(
        [
          para([
            text("plain "),
            text("a", [{ type: "code" }]),
            text(" and "),
            text("b", [{ type: "code" }, { type: "bold" }]),
          ]),
        ],
        "mixed-code",
      )
      expect(md).toContain("`a`")
      expect(md).toContain("**`b`**")
    })
  })

  describe("adversarial literals in plain text", () => {
    const plain = (t: string, label: string) => expectRoundTrip([para([text(t)])], label)

    it("*not italic*", () => plain("*not italic*", "asterisks"))
    it("_under_", () => plain("_under_", "underscores"))
    it("backtick in text", () => plain("a`b`c", "backtick"))
    it("[brackets]", () => plain("[brackets] and [[wiki-ish]]", "brackets"))
    it("<angle> and < 3", () => plain("<angle> and < 3 and </p>", "angle"))
    it("R&D and &amp;-looking text", () => plain("R&D and &amp; and Q&A", "amp"))
    it("$5 and $6", () => plain("$5 and $6", "dollars"))
    it("paragraph starting with '# '", () => plain("# not a heading", "hash"))
    it("paragraph starting with '1. '", () => plain("1. not a list", "ol"))
    it("paragraph starting with '- '", () => plain("- not a bullet", "ul"))
    it("paragraph starting with '> '", () => plain("> not a quote", "quote"))

    // A bare URL/email in unlinked plain text must NOT acquire a `link` mark on
    // re-parse — the dialect only ever emits explicit `[text](href)` links, so
    // auto-linkification would silently mutate unedited text under the
    // whole-block re-parse editing model (the exact failure round-trip guards).
    it("bare URL as plain (unlinked) text", () =>
      plain("see https://example.com now", "bare-url"))
    it("bare email as plain (unlinked) text", () =>
      plain("contact foo@example.com please", "bare-email"))
  })

  describe("block-level sweep", () => {
    it("headings at every level (axis-shift symmetry)", () => {
      expectRoundTrip(
        [2, 3, 4, 5].map((level, i) => ({
          type: "heading",
          attrs: { id: `h${i}`, depth: 0, level },
          content: [text(`H level ${level}`)],
        })),
        "headings",
      )
    })

    it("bullet list incl. nesting", () => {
      expectRoundTrip(
        [
          { type: "bulletList", attrs: { id: "a", depth: 0 }, content: [text("parent")] },
          { type: "bulletList", attrs: { id: "b", depth: 1 }, content: [text("child")] },
          { type: "bulletList", attrs: { id: "c", depth: 0 }, content: [text("sibling")] },
        ],
        "bullets",
      )
    })

    it("numbered list", () => {
      expectRoundTrip(
        [
          { type: "numberedList", attrs: { id: "a", depth: 0 }, content: [text("first")] },
          { type: "numberedList", attrs: { id: "b", depth: 0 }, content: [text("second")] },
          { type: "numberedList", attrs: { id: "c", depth: 0 }, content: [text("third")] },
        ],
        "numbered",
      )
    })

    it("task list (checked + unchecked)", () => {
      expectRoundTrip(
        [
          { type: "taskList", attrs: { id: "a", depth: 0, checked: true }, content: [text("done")] },
          { type: "taskList", attrs: { id: "b", depth: 0, checked: false }, content: [text("todo")] },
        ],
        "tasks",
      )
    })

    it("quote", () => {
      expectRoundTrip(
        [{ type: "blockquote", attrs: { id: "a", depth: 0 }, content: [text("a wise quote")] }],
        "quote",
      )
    })

    it("code block (fenced content stays literal — no escaping inside)", () => {
      const md = expectRoundTrip(
        [
          {
            type: "codeBlock",
            attrs: { id: "a", depth: 0, language: "js" },
            content: [text("const x = *not italic*\nif (a < b) return `x`")],
          },
        ],
        "codeblock",
      )
      // The fence body must carry the literal markdown, unescaped.
      expect(md).toContain("const x = *not italic*")
    })

    it("a doc mixing all of the above", () => {
      expectRoundTrip(
        [
          { type: "heading", attrs: { id: "h", depth: 0, level: 2 }, content: [text("Title")] },
          para([
            text("intro with "),
            text("bold", [{ type: "bold" }]),
            text(" and "),
            text("code", [{ type: "code" }]),
            text(" and a "),
            text("link", [{ type: "link", attrs: { href: "https://x.dev" } }]),
            text("."),
          ]),
          { type: "bulletList", attrs: { id: "u1", depth: 0 }, content: [text("one")] },
          { type: "bulletList", attrs: { id: "u2", depth: 1 }, content: [text("nested")] },
          { type: "numberedList", attrs: { id: "o1", depth: 0 }, content: [text("step 1")] },
          { type: "numberedList", attrs: { id: "o2", depth: 0 }, content: [text("step 2")] },
          { type: "blockquote", attrs: { id: "q", depth: 0 }, content: [text("quote")] },
          {
            type: "codeBlock",
            attrs: { id: "c", depth: 0, language: "ts" },
            content: [text("const a = 1")],
          },
          para([
            text("colored", [{ type: "textStyle", attrs: { textColor: "blue" } }]),
            text(" and "),
            text("Wiki", [{ type: "wikiLink", attrs: { target: "Some Page" } }]),
          ]),
        ],
        "mixed",
      )
    })
  })

  // `exportMarkdown` splices a standalone HTML-comment separator
  // (`<!-- -->`, its own paragraph — markdown.ts's ORDERED_SEPARATOR) between
  // two adjacent numbered-list runs so CommonMark doesn't merge them into one
  // continuously-numbered list. The only place that ever fires is a
  // columnLayout boundary (collectBlockInfos' three splice sites are all
  // column-adjacency cases), and columnLayout itself is a known-lossy type on
  // this parse path — it flattens to root-level blocks and is never
  // reconstructed, same as toggle/callout — so this doesn't fit
  // `expectRoundTrip`'s compare-to-original-doc harness above. Instead this
  // pins the actual contract: real `exportMarkdown` output re-parses with the
  // separator producing NO node, and the two runs on either side keep their
  // own `start` rather than merging into one continuous count.
  describe("ordered-list run separator (AV-1) — parseAiMarkdown consumes it", () => {
    function columns(cols: JSONContent[][]): JSONContent {
      return {
        type: "columnLayout",
        attrs: { id: "cl1", depth: 0 },
        content: cols.map((children, i) => ({
          type: "column",
          attrs: { id: `col-${i}`, width: 1 },
          content: children,
        })),
      }
    }
    const numbered = (t: string, attrs?: Attrs): JSONContent => ({
      type: "numberedList",
      attrs: { id: t, depth: 0, ...attrs },
      content: [text(t)],
    })

    it("two column-adjacent runs (second start non-1) re-parse as two independent runs", () => {
      const editor = createTestEditor({
        content: {
          type: "doc",
          content: [
            columns([
              [numbered("a"), numbered("b")],
              [numbered("c", { start: 5 })],
            ]),
          ],
        },
      })

      const markdown = exportMarkdown(editor)
      expect(markdown).toBe("1. a\n2. b\n\n<!-- -->\n\n5. c\n")

      const parsed = parseAiMarkdown(markdown, editor.schema)
      const items = (parsed.content ?? []).map(canon)
      expect(items).toEqual([numbered("a"), numbered("b"), numbered("c", { start: 5 })].map(canon))
    })
  })

  // `serializeTableMarkdown` synthesizes a `|   |   |` header for a
  // header-less table (GFM pipe tables can't omit one). Without
  // `dropSyntheticEmptyTableHeader`, that phantom row re-parses into a real
  // header the original doc never had — permanently failing this round-trip
  // for every header-less table, which made `apply_edits` refuse them.
  describe("table round-trip", () => {
    it("header-less 2×2 (the regression: synthetic phantom header must not survive re-parse)", () => {
      expectRoundTrip(
        [table("t", [tableRow(["A1", "B1"]), tableRow(["A2", "B2"])])],
        "table-headerless-2x2",
      )
    })

    it("single-row header-less table", () => {
      expectRoundTrip([table("t", [tableRow(["A1", "B1"])])], "table-headerless-1row")
    })

    it("with-header table round-trips unchanged (thead NOT dropped)", () => {
      expectRoundTrip(
        [table("t", [tableRow(["Name", "Age"], true), tableRow(["Alice", "30"])])],
        "table-with-header",
      )
    })

    it("header with some empty and some non-empty cells is preserved (not all-empty)", () => {
      expectRoundTrip(
        [table("t", [tableRow(["", "Age"], true), tableRow(["Alice", "30"])])],
        "table-header-partial-empty",
      )
    })

    it("header-only table with no body rows keeps its (empty) header (tbody-tr guard)", () => {
      expectRoundTrip([table("t", [tableRow(["", ""], true)])], "table-header-only-empty")
    })

    // #21 — in-cell line breaks. A multi-line cell's canonical shape is
    // STACKED tableParagraph siblings (serializeTableMarkdown joins them
    // with "<br>" on export); markdown-it never wraps table-cell content in
    // <p> (verified live — see aiMarkdown.ts's splitCellLineBreaks
    // docstring), so the parse side must explicitly re-split on <br>.
    describe("in-cell line breaks", () => {
      it("a stacked two-line cell (two tableParagraph siblings) round-trips via <br>", () => {
        const md = expectRoundTrip(
          [table("t", [tableRowOf([tableCellStacked(["line1", "line2"])])])],
          "table-cell-stacked",
        )
        expect(md).toContain("line1<br>line2")
      })

      it("a cell with an embedded hardBreak canonicalizes to stacked paragraphs and round-trips", () => {
        // The ORIGINAL doc here is the non-canonical shape (one
        // tableParagraph, hardBreak embedded) — TableCellNormalization
        // converges it to stacked siblings on mount (before
        // `editor.state.doc.toJSON()` is even read), so this also pins the
        // normalization pass, not just the parse-side splitter.
        expectRoundTrip(
          [table("t", [tableRowOf([tableCellEmbeddedBreak(["line1", "line2"])])])],
          "table-cell-embedded-hardbreak",
        )
      })

      it("leading and trailing blank lines in a cell survive as empty tableParagraphs", () => {
        expectRoundTrip(
          [table("t", [tableRowOf([tableCellStacked(["", "mid", ""])])])],
          "table-cell-blank-edges",
        )
      })

      it("a consecutive (mid-cell) blank line survives as an empty tableParagraph", () => {
        expectRoundTrip(
          [table("t", [tableRowOf([tableCellStacked(["a", "", "b"])])])],
          "table-cell-blank-middle",
        )
      })
    })
  })
})

// ── sanitizer (parse-only; hostile input must be neutralized) ───────────────

function nodesOfType(doc: JSONContent, type: string): JSONContent[] {
  const out: JSONContent[] = []
  const walk = (n: JSONContent) => {
    if (n.type === type) out.push(n)
    n.content?.forEach(walk)
  }
  walk(doc)
  return out
}

function allText(doc: JSONContent): string {
  let s = ""
  const walk = (n: JSONContent) => {
    if (typeof n.text === "string") s += n.text
    n.content?.forEach(walk)
  }
  walk(doc)
  return s
}

function allMarkTypes(doc: JSONContent): Set<string> {
  const set = new Set<string>()
  const walk = (n: JSONContent) => {
    for (const m of (n.marks ?? []) as Array<{ type: string }>) set.add(m.type)
    n.content?.forEach(walk)
  }
  walk(doc)
  return set
}

describe("parseAiMarkdown — raw-HTML sanitizer", () => {
  function schema() {
    const editor = createTestEditor({})
    return editor.schema
  }

  it("neutralizes <script> to literal text", () => {
    const doc = parseAiMarkdown("before <script>alert(1)</script> after", schema())
    expect(nodesOfType(doc, "script")).toHaveLength(0)
    // The script never becomes an element; its payload survives as literal text.
    expect(allText(doc)).toContain("alert(1)")
    expect(allText(doc)).toContain("script")
  })

  it("neutralizes <img onerror=…> (no image node, no live tag)", () => {
    const doc = parseAiMarkdown('x <img src=x onerror="alert(1)"> y', schema())
    expect(nodesOfType(doc, "image")).toHaveLength(0)
    expect(allText(doc)).toContain("onerror")
    expect(allText(doc)).toContain("img")
  })

  it("neutralizes <span style=…> (no textStyle mark, text preserved)", () => {
    const doc = parseAiMarkdown('a <span style="color:red">x</span> b', schema())
    expect(allMarkTypes(doc).has("textStyle")).toBe(false)
    expect(allText(doc)).toContain("x")
    expect(allText(doc)).toContain("style")
  })

  it("neutralizes a color span carrying an event handler", () => {
    const doc = parseAiMarkdown(
      'a <span data-text-color="blue" onclick="steal()">x</span> b',
      schema(),
    )
    // The whole opening tag is rejected because of the onclick attr — no
    // textStyle mark is produced, and the handler survives only as inert text.
    expect(allMarkTypes(doc).has("textStyle")).toBe(false)
    expect(allText(doc)).toContain("onclick")
    expect(allText(doc)).toContain("x")
  })

  it("still admits the whitelisted color span + underline", () => {
    const doc = parseAiMarkdown(
      'a <span data-text-color="blue">x</span> <u>y</u>',
      schema(),
    )
    const marks = allMarkTypes(doc)
    expect(marks.has("textStyle")).toBe(true)
    expect(marks.has("underline")).toBe(true)
  })
})

// A hand-authored (not model-round-tripped) mention that doesn't match the
// dialect's exact shape must fail closed: no internalRef mark, text
// preserved, same "declared lossy passthrough" contract as any other
// unrecognized raw HTML the sanitizer neutralizes or admits inertly.
describe("parseAiMarkdown — internalRef mention parse safety", () => {
  function schema() {
    const editor = createTestEditor({})
    return editor.schema
  }

  it("produces the mark for a well-formed page mention (sanity check)", () => {
    const doc = parseAiMarkdown('<mention-page id="Target">Display</mention-page>', schema())
    expect(allMarkTypes(doc).has("internalRef")).toBe(true)
    expect(allText(doc)).toBe("Display")
  })

  it("a mention with no id attribute produces no mark", () => {
    const doc = parseAiMarkdown("<mention-page>Display</mention-page>", schema())
    expect(allMarkTypes(doc).has("internalRef")).toBe(false)
    expect(allText(doc)).toContain("Display")
  })

  it("a mention with an empty id attribute produces no mark", () => {
    const doc = parseAiMarkdown('<mention-page id="">Display</mention-page>', schema())
    expect(allMarkTypes(doc).has("internalRef")).toBe(false)
    expect(allText(doc)).toContain("Display")
  })

  it("an unknown mention-* tag name produces no mark (neutralized to literal text)", () => {
    const doc = parseAiMarkdown('<mention-foo id="Target">Display</mention-foo>', schema())
    expect(allMarkTypes(doc).has("internalRef")).toBe(false)
    expect(allText(doc)).toContain("Display")
    expect(allText(doc)).toContain("mention-foo")
  })
})
