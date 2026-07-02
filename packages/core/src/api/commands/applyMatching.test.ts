// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, it, expect } from "vitest"
import type { Editor, JSONContent } from "@tiptap/core"
import type { Node as PMNode } from "@tiptap/pm/model"
import { undo } from "@tiptap/pm/history"
import { createTestEditor } from "../../test-utils/createTestEditor"
import type { RuneCommandResult } from "../result"
import { applyMatching, type ApplyMatchingData } from "./applyMatching"

// ── fixtures / helpers ─────────────────────────────────────────────────────

function editorWith(content: JSONContent[]): Editor {
  return createTestEditor({ content: { type: "doc", content } })
}

const text = (t: string, marks?: JSONContent["marks"]): JSONContent =>
  marks ? { type: "text", text: t, marks } : { type: "text", text: t }

const para = (id: string, content: JSONContent[], attrs?: Record<string, unknown>): JSONContent => ({
  type: "paragraph",
  attrs: { id, depth: 0, ...attrs },
  content,
})

/** A single-row table; each entry of `cells` is one cell's inline content
 * (wrapped in the cell's lone `tableParagraph`). The table carries `id`; its
 * sub-structure (rows/cells/paragraphs) has none. */
const tableRow1 = (id: string, cells: JSONContent[][]): JSONContent => ({
  type: "table",
  attrs: { id, depth: 0 },
  content: [
    {
      type: "tableRow",
      content: cells.map((content) => ({
        type: "tableCell",
        content: [{ type: "tableParagraph", content }],
      })),
    },
  ],
})

/** A two-column layout, each column holding one paragraph (id + inline content). */
const twoColumns = (
  layoutId: string,
  a: { id: string; content: JSONContent[] },
  b: { id: string; content: JSONContent[] },
): JSONContent => ({
  type: "columnLayout",
  attrs: { id: layoutId, depth: 0 },
  content: [
    { type: "column", attrs: { id: "col_a", width: 1 }, content: [para(a.id, a.content)] },
    { type: "column", attrs: { id: "col_b", width: 1 }, content: [para(b.id, b.content)] },
  ],
})

function findBlock(editor: Editor, id: string): PMNode | null {
  let out: PMNode | null = null
  editor.state.doc.descendants((node) => {
    if (out) return false
    if (node.attrs && node.attrs.id === id) {
      out = node
      return false
    }
    return true
  })
  return out
}

/** Sorted mark-type names on the (first) text run whose text is exactly `t`. */
function marksOnText(node: PMNode, t: string): string[] {
  let names: string[] = []
  node.descendants((child) => {
    if (child.isText && child.text === t) names = child.marks.map((m) => m.type.name).sort()
  })
  return names
}

function markAttrOnText(node: PMNode, t: string, markName: string, attr: string): unknown {
  let value: unknown
  node.descendants((child) => {
    if (child.isText && child.text === t) {
      const mark = child.marks.find((m) => m.type.name === markName)
      if (mark) value = mark.attrs[attr]
    }
  })
  return value
}

function expectOk(res: RuneCommandResult<ApplyMatchingData>): ApplyMatchingData {
  if (!res.ok) throw new Error(`expected ok, got error ${JSON.stringify(res.error)}`)
  return res.data
}

function expectErr(res: RuneCommandResult<ApplyMatchingData>): { code: string; message: string } {
  if (res.ok) throw new Error(`expected error, got ok ${JSON.stringify(res.data)}`)
  return res.error
}

const code = { type: "code" }
const colored = (name: string) => ({ type: "textStyle", attrs: { textColor: name } })

// ── inline-kind: completeness ────────────────────────────────────────────────

describe("applyMatching — inline completeness (the headline case)", () => {
  it("recolors EVERY code span across blocks (incl. a block with two) in one undo step", () => {
    // N=4 code spans across M=3 blocks; p2 carries TWO.
    const editor = editorWith([
      para("p1", [text("call "), text("alpha", [code])]),
      para("p2", [text("beta", [code]), text(" and "), text("gamma", [code])]),
      para("p3", [text("delta", [code])]),
    ])
    const res = applyMatching(editor, {
      where: { mark: "code" },
      set: { mark: { type: "textStyle", attrs: { textColor: "blue" } } },
    })
    const data = expectOk(res)
    expect(data.count).toBe(4)
    expect([...data.changedBlockIds].sort()).toEqual(["p1", "p2", "p3"])

    for (const [id, word] of [["p1", "alpha"], ["p2", "beta"], ["p2", "gamma"], ["p3", "delta"]] as const) {
      expect(marksOnText(findBlock(editor, id)!, word)).toEqual(["code", "textStyle"])
      expect(markAttrOnText(findBlock(editor, id)!, word, "textStyle", "textColor")).toBe("blue")
    }
    // Uncoded text untouched.
    expect(marksOnText(findBlock(editor, "p1")!, "call ")).toEqual([])

    // ONE undo reverts ALL of it → a single transaction.
    undo(editor.state, editor.view.dispatch)
    expect(marksOnText(findBlock(editor, "p1")!, "alpha")).toEqual(["code"])
    expect(marksOnText(findBlock(editor, "p3")!, "delta")).toEqual(["code"])
  })

  it("merges two adjacent matching spans in a block into one applied range", () => {
    // Two back-to-back code runs that stay DISTINCT PM nodes (different mark
    // sets — one also italic) yet both pass `mark: "code"` → one merged range,
    // count 1. (Identical mark sets would collapse into a single text node.)
    const editor = editorWith([
      para("p", [text("foo", [code]), text("bar", [code, { type: "italic" }])]),
    ])
    const data = expectOk(
      applyMatching(editor, { where: { mark: "code" }, set: { mark: { type: "bold" } } }),
    )
    expect(data.count).toBe(1)
    expect(marksOnText(findBlock(editor, "p")!, "foo")).toEqual(["bold", "code"])
    expect(marksOnText(findBlock(editor, "p")!, "bar")).toEqual(["bold", "code", "italic"])
  })
})

// ── inline-kind: per-node merge regression ───────────────────────────────────

describe("applyMatching — per-node attr merge", () => {
  it("keeps a pre-existing backgroundColor when adding textColor over a range", () => {
    // The classic smear bug: a naive range-wide addMark would wipe the mid-range
    // node's own backgroundColor. Two code spans, one already yellow-bg.
    const editor = editorWith([
      para("p", [
        text("aa", [code, { type: "textStyle", attrs: { backgroundColor: "yellow" } }]),
        text("bb", [code]),
      ]),
    ])
    expectOk(
      applyMatching(editor, {
        where: { mark: "code" },
        set: { mark: { type: "textStyle", attrs: { textColor: "blue" } } },
      }),
    )
    const block = findBlock(editor, "p")!
    // "aa" keeps its yellow background AND gains blue text.
    expect(markAttrOnText(block, "aa", "textStyle", "backgroundColor")).toBe("yellow")
    expect(markAttrOnText(block, "aa", "textStyle", "textColor")).toBe("blue")
    // "bb" only gains blue text.
    expect(markAttrOnText(block, "bb", "textStyle", "textColor")).toBe("blue")
    expect(markAttrOnText(block, "bb", "textStyle", "backgroundColor")).toBeFalsy()
  })

  it("keeps DIFFERENT existing backgroundColors when one range spans two nodes", () => {
    // The bidirectional smear guard: two adjacent code spans coalesce into ONE
    // range, but each carries a DIFFERENT backgroundColor. Adding textColor:blue
    // must merge per node — neither node's background may leak onto the other.
    const editor = editorWith([
      para("p", [
        text("aa", [code, { type: "textStyle", attrs: { backgroundColor: "yellow" } }]),
        text("bb", [code, { type: "textStyle", attrs: { backgroundColor: "red" } }]),
      ]),
    ])
    const data = expectOk(
      applyMatching(editor, {
        where: { mark: "code" },
        set: { mark: { type: "textStyle", attrs: { textColor: "blue" } } },
      }),
    )
    // One merged range spanning both nodes.
    expect(data.count).toBe(1)
    const block = findBlock(editor, "p")!
    expect(markAttrOnText(block, "aa", "textStyle", "backgroundColor")).toBe("yellow")
    expect(markAttrOnText(block, "aa", "textStyle", "textColor")).toBe("blue")
    expect(markAttrOnText(block, "bb", "textStyle", "backgroundColor")).toBe("red")
    expect(markAttrOnText(block, "bb", "textStyle", "textColor")).toBe("blue")
  })
})

// ── inline-kind: unset ───────────────────────────────────────────────────────

describe("applyMatching — unset", () => {
  it("removes only the named mark, leaving others intact", () => {
    const editor = editorWith([
      para("p", [text("x", [{ type: "bold" }, { type: "italic" }])]),
    ])
    const data = expectOk(
      applyMatching(editor, { where: { blockType: "paragraph" }, set: { unset: ["bold"] } }),
    )
    expect(data.count).toBe(1)
    expect(marksOnText(findBlock(editor, "p")!, "x")).toEqual(["italic"])
  })
})

// ── inline-kind: hasTextColor ────────────────────────────────────────────────

describe("applyMatching — hasTextColor predicate", () => {
  it('matches a specific named colour ("red") and bolds it', () => {
    const editor = editorWith([
      para("p", [text("hot", [colored("red")]), text(" cold", [colored("blue")])]),
    ])
    const data = expectOk(
      applyMatching(editor, { where: { hasTextColor: "red" }, set: { mark: { type: "bold" } } }),
    )
    expect(data.count).toBe(1)
    expect(marksOnText(findBlock(editor, "p")!, "hot")).toEqual(["bold", "textStyle"])
    expect(marksOnText(findBlock(editor, "p")!, " cold")).toEqual(["textStyle"])
  })

  it('"any" matches every text-coloured run regardless of name', () => {
    const editor = editorWith([
      para("p", [text("r", [colored("red")]), text(" plain "), text("b", [colored("blue")])]),
    ])
    const data = expectOk(
      applyMatching(editor, { where: { hasTextColor: "any" }, set: { mark: { type: "bold" } } }),
    )
    expect(data.count).toBe(2)
    expect(marksOnText(findBlock(editor, "p")!, "r")).toEqual(["bold", "textStyle"])
    expect(marksOnText(findBlock(editor, "p")!, "b")).toEqual(["bold", "textStyle"])
    expect(marksOnText(findBlock(editor, "p")!, " plain ")).toEqual([])
  })
})

// ── inline-kind: textMatches ─────────────────────────────────────────────────

describe("applyMatching — textMatches", () => {
  it("matches a literal substring across blocks", () => {
    const editor = editorWith([
      para("p1", [text("TODO: buy milk")]),
      para("p2", [text("TODO: walk dog")]),
    ])
    const data = expectOk(
      applyMatching(editor, { where: { textMatches: "TODO" }, set: { mark: { type: "bold" } } }),
    )
    expect(data.count).toBe(2)
    expect(marksOnText(findBlock(editor, "p1")!, "TODO")).toEqual(["bold"])
    expect(marksOnText(findBlock(editor, "p2")!, "TODO")).toEqual(["bold"])
  })

  it("matches a /regex/i and colours every occurrence", () => {
    const editor = editorWith([para("p", [text("Cat cat CAT dog")])])
    const data = expectOk(
      applyMatching(editor, {
        where: { textMatches: "/cat/gi" },
        set: { mark: { type: "textStyle", attrs: { textColor: "green" } } },
      }),
    )
    expect(data.count).toBe(3)
    // The three "cat" occurrences each carry the colour; "dog" does not.
    expect(markAttrOnText(findBlock(editor, "p")!, "Cat", "textStyle", "textColor")).toBe("green")
  })

  it("intersects textMatches with a mark predicate (only matched code substrings)", () => {
    const editor = editorWith([
      para("p", [text("run "), text("foo", [code]), text(" foo")]),
    ])
    // "foo" appears twice, but only the code-marked one should match.
    const data = expectOk(
      applyMatching(editor, {
        where: { mark: "code", textMatches: "foo" },
        set: { mark: { type: "bold" } },
      }),
    )
    expect(data.count).toBe(1)
    expect(marksOnText(findBlock(editor, "p")!, "foo")).toEqual(["bold", "code"])
    expect(marksOnText(findBlock(editor, "p")!, " foo")).toEqual([])
  })

  it("rejects an invalid regex as invalid-input", () => {
    const editor = editorWith([para("p", [text("x")])])
    const err = expectErr(
      applyMatching(editor, { where: { textMatches: "/(/" }, set: { mark: { type: "bold" } } }),
    )
    expect(err.code).toBe("invalid-input")
  })

  it("rejects an invalid regex FLAG as invalid-input, not a silent literal miss", () => {
    // "/foo/I" must fail loudly in `new RegExp` — a lowercase-only flags
    // capture would fall through to a literal search for the string "/foo/I"
    // and return count 0, which reads as a successful "no matches".
    const editor = editorWith([para("p", [text("foo")])])
    const err = expectErr(
      applyMatching(editor, { where: { textMatches: "/foo/I" }, set: { mark: { type: "bold" } } }),
    )
    expect(err.code).toBe("invalid-input")
  })
})

// ── inline-kind: blockType intersection ──────────────────────────────────────

describe("applyMatching — blockType intersection", () => {
  it("touches only code spans inside headings when blockType restricts", () => {
    const editor = editorWith([
      { type: "heading", attrs: { id: "h", depth: 0, level: 2 }, content: [text("H "), text("k", [code])] },
      para("p", [text("k2", [code])]),
    ])
    const data = expectOk(
      applyMatching(editor, {
        where: { mark: "code", blockType: "heading" },
        set: { mark: { type: "bold" } },
      }),
    )
    expect(data.count).toBe(1)
    expect(data.changedBlockIds).toEqual(["h"])
    expect(marksOnText(findBlock(editor, "h")!, "k")).toEqual(["bold", "code"])
    // Paragraph code span untouched.
    expect(marksOnText(findBlock(editor, "p")!, "k2")).toEqual(["code"])
  })
})

// ── inline-kind: table-cell text (Tier 2 completeness gap) ───────────────────

describe("applyMatching — table-cell text", () => {
  it("recolors a code span inside a table cell alongside a paragraph's (count 2)", () => {
    // The gap: forEachBodyBlock yields the `table` body block without
    // descending; computeInlineRanges on the table saw only its rows (no text),
    // so cell code spans were silently skipped and `count` under-reported.
    const editor = editorWith([
      para("p", [text("call "), text("alpha", [code])]),
      tableRow1("t", [[text("beta", [code])]]),
    ])
    const data = expectOk(
      applyMatching(editor, {
        where: { mark: "code" },
        set: { mark: { type: "textStyle", attrs: { textColor: "blue" } } },
      }),
    )
    expect(data.count).toBe(2)
    expect([...data.changedBlockIds].sort()).toEqual(["p", "t"])
    expect(markAttrOnText(findBlock(editor, "p")!, "alpha", "textStyle", "textColor")).toBe("blue")
    // The cell span is coloured, and its block id is the TABLE's.
    expect(marksOnText(findBlock(editor, "t")!, "beta")).toEqual(["code", "textStyle"])
    expect(markAttrOnText(findBlock(editor, "t")!, "beta", "textStyle", "textColor")).toBe("blue")
    // ONE undo reverts both → single transaction.
    undo(editor.state, editor.view.dispatch)
    expect(marksOnText(findBlock(editor, "t")!, "beta")).toEqual(["code"])
    expect(marksOnText(findBlock(editor, "p")!, "alpha")).toEqual(["code"])
  })

  it("matches a textMatches literal inside a table cell", () => {
    const editor = editorWith([
      para("p", [text("TODO here")]),
      tableRow1("t", [[text("keep")], [text("TODO in cell")]]),
    ])
    const data = expectOk(
      applyMatching(editor, { where: { textMatches: "TODO" }, set: { mark: { type: "bold" } } }),
    )
    expect(data.count).toBe(2)
    expect([...data.changedBlockIds].sort()).toEqual(["p", "t"])
    expect(marksOnText(findBlock(editor, "t")!, "TODO")).toEqual(["bold"])
    expect(marksOnText(findBlock(editor, "t")!, "keep")).toEqual([])
  })

  it('blockType:"table" touches only table-cell code, not a paragraph\'s', () => {
    const editor = editorWith([
      para("p", [text("k1", [code])]),
      tableRow1("t", [[text("k2", [code])]]),
    ])
    const data = expectOk(
      applyMatching(editor, {
        where: { mark: "code", blockType: "table" },
        set: { mark: { type: "bold" } },
      }),
    )
    expect(data.count).toBe(1)
    expect(data.changedBlockIds).toEqual(["t"])
    expect(marksOnText(findBlock(editor, "t")!, "k2")).toEqual(["bold", "code"])
    // The paragraph's code span is a different block type → untouched.
    expect(marksOnText(findBlock(editor, "p")!, "k1")).toEqual(["code"])
  })

  it('excludeBlockTypes:["table"] skips table-cell text', () => {
    const editor = editorWith([
      para("p", [text("k1", [code])]),
      tableRow1("t", [[text("k2", [code])]]),
    ])
    const data = expectOk(
      applyMatching(editor, {
        where: { mark: "code" },
        set: { mark: { type: "bold" } },
        excludeBlockTypes: ["table"],
      }),
    )
    expect(data.count).toBe(1)
    expect(data.changedBlockIds).toEqual(["p"])
    expect(marksOnText(findBlock(editor, "t")!, "k2")).toEqual(["code"])
  })

  it("unset removes a mark inside a table cell (shared enumeration)", () => {
    const editor = editorWith([
      tableRow1("t", [[text("x", [{ type: "bold" }, { type: "italic" }])]]),
    ])
    const data = expectOk(
      applyMatching(editor, { where: { blockType: "table" }, set: { unset: ["bold"] } }),
    )
    expect(data.count).toBe(1)
    expect(data.changedBlockIds).toEqual(["t"])
    expect(marksOnText(findBlock(editor, "t")!, "x")).toEqual(["italic"])
  })
})

// ── inline-kind: column no-double-application (regression) ────────────────────

describe("applyMatching — columns (no double application)", () => {
  it("applies EXACTLY once to a column child's text, layout id absent", () => {
    // forEachBodyBlock visits the columnLayout AND each column child. The
    // subtree enumeration must stop at the structural `column` so the child's
    // paragraph is enumerated once (as its own body block) — a double-applied
    // mark would hide as an idempotent addMark, so we assert count and ids.
    const editor = editorWith([
      twoColumns("lay", { id: "a1", content: [text("alpha", [code])] }, { id: "b1", content: [text("beta")] }),
    ])
    const data = expectOk(
      applyMatching(editor, {
        where: { mark: "code" },
        set: { mark: { type: "textStyle", attrs: { textColor: "blue" } } },
      }),
    )
    expect(data.count).toBe(1)
    expect(data.changedBlockIds).toEqual(["a1"])
    expect(data.changedBlockIds).not.toContain("lay")
    expect(markAttrOnText(findBlock(editor, "a1")!, "alpha", "textStyle", "textColor")).toBe("blue")
    // Exactly one application → ONE undo fully reverts.
    undo(editor.state, editor.view.dispatch)
    expect(marksOnText(findBlock(editor, "a1")!, "alpha")).toEqual(["code"])
  })
})

// ── block-kind ───────────────────────────────────────────────────────────────

describe("applyMatching — block-kind blockColor", () => {
  it("colours every matching block, counting ONLY declared-support blocks", () => {
    // paragraph + heading support background colour; image does not have inline
    // text so it can't match a text predicate anyway — use blockType instead.
    const editor = editorWith([
      para("p1", [text("one")]),
      para("p2", [text("two")]),
    ])
    const data = expectOk(
      applyMatching(editor, {
        where: { blockType: "paragraph" },
        set: { blockColor: { kind: "background", name: "blue" } },
      }),
    )
    expect(data.count).toBe(2)
    expect(findBlock(editor, "p1")!.attrs.backgroundColor).toBe("blue")
    expect(findBlock(editor, "p2")!.attrs.backgroundColor).toBe("blue")
  })

  it("excludes a matched-by-where block that does not declare the colour axis", () => {
    // A code block has inline text (so it matches the text predicate) but
    // declares NO colour support. It matches `where` yet is NOT counted.
    const editor = editorWith([
      para("p", [text("x")]),
      { type: "codeBlock", attrs: { id: "c", depth: 0, language: "text" }, content: [text("x")] },
    ])
    const data = expectOk(
      applyMatching(editor, {
        // blockType absent → all blocks are candidates; only colour-supporting
        // ones count.
        where: { textMatches: "x" },
        set: { blockColor: { kind: "text", name: "red" } },
      }),
    )
    // Both contain "x", but only the paragraph supports text colour → count 1.
    expect(data.count).toBe(1)
    expect(data.changedBlockIds).toEqual(["p"])
    expect(findBlock(editor, "p")!.attrs.textColor).toBe("red")
  })
})

describe("applyMatching — block-kind turnInto", () => {
  it("turns every matching paragraph into a heading (level 2)", () => {
    const editor = editorWith([
      para("p1", [text("Alpha")]),
      para("p2", [text("Beta")]),
      { type: "bulletList", attrs: { id: "b", depth: 0 }, content: [text("keep")] },
    ])
    const data = expectOk(
      applyMatching(editor, {
        where: { blockType: "paragraph" },
        set: { turnInto: { type: "heading", props: { level: 2 } } },
      }),
    )
    expect(data.count).toBe(2)
    expect([...data.changedBlockIds].sort()).toEqual(["p1", "p2"])
    expect(findBlock(editor, "p1")!.type.name).toBe("heading")
    expect(findBlock(editor, "p2")!.type.name).toBe("heading")
    expect(findBlock(editor, "p1")!.attrs.level).toBe(2)
    // The bullet list was not a paragraph → untouched.
    expect(findBlock(editor, "b")!.type.name).toBe("bulletList")
  })

  it("reverts a bulk turnInto with ONE undo (single transaction, block-kind)", () => {
    const editor = editorWith([
      para("p1", [text("Alpha")]),
      para("p2", [text("Beta")]),
    ])
    expectOk(
      applyMatching(editor, {
        where: { blockType: "paragraph" },
        set: { turnInto: { type: "heading", props: { level: 2 } } },
      }),
    )
    expect(findBlock(editor, "p1")!.type.name).toBe("heading")
    expect(findBlock(editor, "p2")!.type.name).toBe("heading")
    undo(editor.state, editor.view.dispatch)
    expect(findBlock(editor, "p1")!.type.name).toBe("paragraph")
    expect(findBlock(editor, "p2")!.type.name).toBe("paragraph")
  })
})

// ── validation ───────────────────────────────────────────────────────────────

describe("applyMatching — validation", () => {
  it("rejects mixed set kinds (inline + block) as invalid-input", () => {
    const editor = editorWith([para("p", [text("x", [code])])])
    const err = expectErr(
      applyMatching(editor, {
        where: { mark: "code" },
        set: { mark: { type: "bold" }, blockColor: { kind: "text", name: "red" } },
      }),
    )
    expect(err.code).toBe("invalid-input")
  })

  it("rejects an empty where as invalid-input", () => {
    const editor = editorWith([para("p", [text("x")])])
    const err = expectErr(applyMatching(editor, { where: {}, set: { mark: { type: "bold" } } }))
    expect(err.code).toBe("invalid-input")
  })

  it("rejects an empty set as invalid-input", () => {
    const editor = editorWith([para("p", [text("x")])])
    const err = expectErr(applyMatching(editor, { where: { blockType: "paragraph" }, set: {} }))
    expect(err.code).toBe("invalid-input")
  })

  it("treats an empty unset array as an empty set (invalid-input)", () => {
    const editor = editorWith([para("p", [text("x")])])
    const err = expectErr(applyMatching(editor, { where: { blockType: "paragraph" }, set: { unset: [] } }))
    expect(err.code).toBe("invalid-input")
  })

  it("reports unsupported for an unknown where.mark", () => {
    const editor = editorWith([para("p", [text("x")])])
    const err = expectErr(applyMatching(editor, { where: { mark: "nope" }, set: { mark: { type: "bold" } } }))
    expect(err.code).toBe("unsupported")
  })

  it("reports unsupported for an unknown set.mark.type", () => {
    const editor = editorWith([para("p", [text("x", [code])])])
    const err = expectErr(applyMatching(editor, { where: { mark: "code" }, set: { mark: { type: "nope" } } }))
    expect(err.code).toBe("unsupported")
  })

  it("reports unsupported for an unknown blockType", () => {
    const editor = editorWith([para("p", [text("x")])])
    const err = expectErr(applyMatching(editor, { where: { blockType: "nope" }, set: { mark: { type: "bold" } } }))
    expect(err.code).toBe("unsupported")
  })

  it("reports unsupported for an unknown turnInto.type", () => {
    const editor = editorWith([para("p", [text("x")])])
    const err = expectErr(
      applyMatching(editor, { where: { blockType: "paragraph" }, set: { turnInto: { type: "nope" } } }),
    )
    expect(err.code).toBe("unsupported")
  })

  it("reports invalid-input for an unknown blockColor name", () => {
    const editor = editorWith([para("p", [text("x")])])
    const err = expectErr(
      applyMatching(editor, {
        where: { blockType: "paragraph" },
        set: { blockColor: { kind: "text", name: "chartreuse" } },
      }),
    )
    expect(err.code).toBe("invalid-input")
  })
})

// ── scope / gates ────────────────────────────────────────────────────────────

describe("applyMatching — scope and gates", () => {
  it("excludeBlockTypes hides a block from the scan", () => {
    const editor = editorWith([
      { type: "heading", attrs: { id: "h", depth: 0, level: 2 }, content: [text("secret", [code])] },
      para("p", [text("shown", [code])]),
    ])
    const data = expectOk(
      applyMatching(editor, {
        where: { mark: "code" },
        set: { mark: { type: "bold" } },
        excludeBlockTypes: ["heading"],
      }),
    )
    expect(data.count).toBe(1)
    expect(data.changedBlockIds).toEqual(["p"])
    // The excluded heading's code span is untouched.
    expect(marksOnText(findBlock(editor, "h")!, "secret")).toEqual(["code"])
  })

  it("zero matches → ok with count 0, doc unchanged, nothing dispatched", () => {
    const editor = editorWith([para("p", [text("plain")])])
    const before = editor.state.doc.toJSON()
    const data = expectOk(applyMatching(editor, { where: { mark: "code" }, set: { mark: { type: "bold" } } }))
    expect(data.count).toBe(0)
    expect(data.changedBlockIds).toEqual([])
    expect(editor.state.doc.toJSON()).toEqual(before)
    // No history entry was created (nothing dispatched): undo is a no-op.
    undo(editor.state, editor.view.dispatch)
    expect(editor.state.doc.toJSON()).toEqual(before)
  })

  it("rejects a read-only editor", () => {
    const editor = editorWith([para("p", [text("x", [code])])])
    editor.setEditable(false)
    const err = expectErr(applyMatching(editor, { where: { mark: "code" }, set: { mark: { type: "bold" } } }))
    expect(err.code).toBe("not-editable")
  })
})
