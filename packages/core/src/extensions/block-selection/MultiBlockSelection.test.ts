// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, it, expect } from "vitest"
import { Editor } from "@tiptap/core"
import Document from "@tiptap/extension-document"
import Text from "@tiptap/extension-text"
import { History } from "@tiptap/extension-history"
import { NodeSelection, Selection, TextSelection } from "@tiptap/pm/state"
import { Paragraph, Heading } from "../../blocks"
import { BlockId } from "../block-id"
import { BlockSelection } from "./index"
import { MultiBlockSelection } from "./MultiBlockSelection"
import { getCrossBlockTextRange } from "./test-utils"
import { createTestEditor } from "../../test-utils/createTestEditor"

function makeEditor(content?: unknown) {
  const element = document.createElement("div")
  document.body.appendChild(element)
  return new Editor({
    element,
    extensions: [Document, Text, Paragraph, Heading, History, BlockId, BlockSelection],
    content: (content ?? {
      type: "doc",
      content: Array.from({ length: 6 }, (_, i) => ({
        type: "paragraph",
        content: [{ type: "text", text: `Block ${i + 1}` }],
      })),
    }) as never,
  })
}

describe("MultiBlockSelection — create + getters", () => {
  it("N=1: anchor before block, head after block, isForward=true", () => {
    const editor = makeEditor()
    const doc = editor.state.doc
    const sel = MultiBlockSelection.create(doc, 0, 0)
    expect(sel.blockIndices).toEqual([0, 0])
    expect(sel.blockNodes).toHaveLength(1)
    expect(sel.blockNodes[0]?.textContent).toBe("Block 1")
    expect(sel.isForward).toBe(true)
    expect(sel.anchor).toBeLessThan(sel.head)
    editor.destroy()
  })

  it("N=3 forward: indices [1,3], three nodes, isForward=true", () => {
    const editor = makeEditor()
    const sel = MultiBlockSelection.create(editor.state.doc, 1, 3)
    expect(sel.blockIndices).toEqual([1, 3])
    expect(sel.blockNodes.map((n) => n.textContent)).toEqual(["Block 2", "Block 3", "Block 4"])
    expect(sel.isForward).toBe(true)
    editor.destroy()
  })

  it("N=3 backward (anchor > head in doc order): indices [1,3], isForward=false", () => {
    const editor = makeEditor()
    const sel = MultiBlockSelection.create(editor.state.doc, 3, 1)
    expect(sel.blockIndices).toEqual([1, 3])
    expect(sel.isForward).toBe(false)
    editor.destroy()
  })

  it("N=all: entire 6-block doc", () => {
    const editor = makeEditor()
    const sel = MultiBlockSelection.create(editor.state.doc, 0, 5)
    expect(sel.blockIndices).toEqual([0, 5])
    expect(sel.blockNodes).toHaveLength(6)
    editor.destroy()
  })

  // `create` is documented as the single enforcement point for block-selection
  // index bounds (the `minSelectable` lower clamp lives here) — but only the
  // lower bound is actually clamped. A caller passing `hi >= childCount`
  // (an off-by-one from a caller, or a stale index after a doc shrink) walks
  // straight into `parent.child(hi)` at the `afterHi` loop and throws.
  it("BUG regression: hi >= childCount is clamped, not a RangeError", () => {
    const editor = makeEditor() // 6 blocks, valid indices 0..5
    let sel: MultiBlockSelection | undefined
    expect(() => {
      sel = MultiBlockSelection.create(editor.state.doc, 0, 6)
    }).not.toThrow()
    expect(sel!.blockIndices).toEqual([0, 5])
    editor.destroy()
  })

  it("BUG regression: both indices beyond childCount clamp to the last block", () => {
    const editor = makeEditor() // 6 blocks, valid indices 0..5
    let sel: MultiBlockSelection | undefined
    expect(() => {
      sel = MultiBlockSelection.create(editor.state.doc, 9, 12)
    }).not.toThrow()
    expect(sel!.blockIndices).toEqual([5, 5])
    editor.destroy()
  })
})

describe("MultiBlockSelection — eq / map / content / toJSON", () => {
  it("eq returns true for equal ranges, false otherwise", () => {
    const editor = makeEditor()
    const doc = editor.state.doc
    const a = MultiBlockSelection.create(doc, 1, 3)
    const b = MultiBlockSelection.create(doc, 1, 3)
    const c = MultiBlockSelection.create(doc, 1, 4)
    expect(a.eq(b)).toBe(true)
    expect(a.eq(c)).toBe(false)
    editor.destroy()
  })

  it("map through an insert BEFORE the range keeps the range", () => {
    const editor = makeEditor()
    const doc = editor.state.doc
    const sel = MultiBlockSelection.create(doc, 2, 4) // blocks 3..5
    // Insert a new paragraph at position 0 (before block 1).
    const paragraphType = editor.schema.nodes.paragraph
    if (!paragraphType) throw new Error("paragraph node type missing")
    const tr = editor.state.tr.insert(
      0,
      paragraphType.create(null, editor.schema.text("New")),
    )
    const mapped = sel.map(tr.doc, tr.mapping) as MultiBlockSelection
    expect(mapped).toBeInstanceOf(MultiBlockSelection)
    expect(mapped.blockNodes.map((n) => n.textContent)).toEqual(["Block 3", "Block 4", "Block 5"])
    editor.destroy()
  })

  it("map through a transaction that deletes a boundary collapses to TextSelection", () => {
    const editor = makeEditor()
    const doc = editor.state.doc
    const sel = MultiBlockSelection.create(doc, 1, 2) // blocks 2..3
    // Delete block 2 entirely (the anchor boundary).
    const from = 0 + doc.child(0).nodeSize // before block 2
    const to = from + doc.child(1).nodeSize // after block 2
    const tr = editor.state.tr.delete(from, to)
    const mapped = sel.map(tr.doc, tr.mapping)
    expect(mapped).not.toBeInstanceOf(MultiBlockSelection)
    editor.destroy()
  })

  it("content() returns a Slice with openStart=openEnd=0 and N children", () => {
    const editor = makeEditor()
    const sel = MultiBlockSelection.create(editor.state.doc, 1, 3)
    const slice = sel.content()
    expect(slice.openStart).toBe(0)
    expect(slice.openEnd).toBe(0)
    expect(slice.content.childCount).toBe(3)
    editor.destroy()
  })

  it("toJSON round-trips via Selection.fromJSON with type='multi-block'", () => {
    const editor = makeEditor()
    const doc = editor.state.doc
    const sel = MultiBlockSelection.create(doc, 1, 3)
    const json = sel.toJSON() as { type: string; anchor: number; head: number }
    expect(json.type).toBe("multi-block")
    const restored = Selection.fromJSON(doc, json)
    expect(restored).toBeInstanceOf(MultiBlockSelection)
    expect(restored.eq(sel)).toBe(true)
    editor.destroy()
  })
})

describe("MultiBlockSelection — getBookmark (history round-trip)", () => {
  it("history undo restores MultiBlockSelection class with same blockIndices", () => {
    const editor = makeEditor()
    // Set MBS over blocks 1..2 (indices), then run a history-tracked tr that
    // mutates the doc AND collapses the selection to a TextSelection. Undo
    // should restore the MBS — that is the bookmark round-trip path.
    const sel = MultiBlockSelection.create(editor.state.doc, 1, 2)
    editor.view.dispatch(editor.state.tr.setSelection(sel))
    expect(editor.state.selection).toBeInstanceOf(MultiBlockSelection)
    expect((editor.state.selection as MultiBlockSelection).blockIndices).toEqual([1, 2])

    const paragraphType = editor.schema.nodes.paragraph
    if (!paragraphType) throw new Error("paragraph node type missing")
    // Append a block at the end + collapse to a TextSelection. The collapse
    // is what would happen organically for any MBS-mutating command.
    const tr = editor.state.tr.insert(
      editor.state.doc.content.size,
      paragraphType.create(null, editor.schema.text("New")),
    )
    tr.setSelection(Selection.atStart(tr.doc))
    editor.view.dispatch(tr)
    expect(editor.state.selection).not.toBeInstanceOf(MultiBlockSelection)

    editor.commands.undo()
    expect(editor.state.selection).toBeInstanceOf(MultiBlockSelection)
    expect((editor.state.selection as MultiBlockSelection).blockIndices).toEqual([1, 2])
    editor.destroy()
  })

  it("history redo+undo round-trips MultiBlockSelection", () => {
    const editor = makeEditor()
    const sel = MultiBlockSelection.create(editor.state.doc, 0, 1)
    editor.view.dispatch(editor.state.tr.setSelection(sel))
    const paragraphType = editor.schema.nodes.paragraph
    if (!paragraphType) throw new Error("paragraph node type missing")
    const tr = editor.state.tr.insert(
      editor.state.doc.content.size,
      paragraphType.create(null, editor.schema.text("X")),
    )
    tr.setSelection(Selection.atStart(tr.doc))
    editor.view.dispatch(tr)
    editor.commands.undo()
    expect(editor.state.selection).toBeInstanceOf(MultiBlockSelection)
    expect((editor.state.selection as MultiBlockSelection).blockIndices).toEqual([0, 1])
    editor.commands.redo()
    expect(editor.state.doc.lastChild?.textContent).toBe("X")
    // After redo, selection is the one stored on the redo step (TextSelection
    // at start). Re-undoing must restore the MBS class again.
    editor.commands.undo()
    expect(editor.state.selection).toBeInstanceOf(MultiBlockSelection)
    expect((editor.state.selection as MultiBlockSelection).blockIndices).toEqual([0, 1])
    editor.destroy()
  })

  it("bookmark maps across an upstream insertion (anchor block shifts down)", () => {
    const editor = makeEditor()
    const sel = MultiBlockSelection.create(editor.state.doc, 2, 3) // blocks 3..4
    const bookmark = sel.getBookmark()
    const paragraphType = editor.schema.nodes.paragraph
    if (!paragraphType) throw new Error("paragraph node type missing")
    // Insert a new paragraph at position 0 (before block 1) — shifts the
    // covered blocks down by one in the new doc.
    const tr = editor.state.tr.insert(
      0,
      paragraphType.create(null, editor.schema.text("New")),
    )
    const mapped = bookmark.map(tr.mapping)
    const restored = mapped.resolve(tr.doc)
    expect(restored).toBeInstanceOf(MultiBlockSelection)
    const blockIndices = (restored as MultiBlockSelection).blockIndices
    expect(blockIndices).toEqual([3, 4])
    expect((restored as MultiBlockSelection).blockNodes.map((n) => n.textContent)).toEqual([
      "Block 3",
      "Block 4",
    ])
    editor.destroy()
  })

  it("bookmark falls back near $head when only the anchor boundary is deleted", () => {
    const editor = makeEditor()
    const sel = MultiBlockSelection.create(editor.state.doc, 1, 2) // blocks 2..3
    const bookmark = sel.getBookmark()
    // Delete block 2 entirely — that's the anchor-side boundary block.
    const doc = editor.state.doc
    const from = doc.child(0).nodeSize // before block 2
    const to = from + doc.child(1).nodeSize // after block 2
    const tr = editor.state.tr.delete(from, to)
    const mapped = bookmark.map(tr.mapping)
    const restored = mapped.resolve(tr.doc)
    // Same conservative shape MultiBlockSelection.map uses for deleted
    // ranges: collapse, don't pretend the original range survived.
    expect(restored).not.toBeInstanceOf(MultiBlockSelection)
    // Cursor lands near the surviving head side (former block 3, now
    // adjacent to block 4 after the deletion). map() uses headResult.pos
    // here; resolve() must do the same.
    expect(restored.$head.parent.textContent).toBe("Block 4")
    editor.destroy()
  })

  it("bookmark falls back near $anchor when only the head boundary is deleted", () => {
    const editor = makeEditor()
    const sel = MultiBlockSelection.create(editor.state.doc, 1, 2) // blocks 2..3
    const bookmark = sel.getBookmark()
    // Delete blocks 3 + 4 (indices 2..3) so the head boundary at pos
    // before(3) sits strictly inside the deleted range and mapResult
    // marks it deleted regardless of association bias.
    const doc = editor.state.doc
    const from = doc.child(0).nodeSize + doc.child(1).nodeSize // before block 3
    const to = from + doc.child(2).nodeSize + doc.child(3).nodeSize // after block 4
    const tr = editor.state.tr.delete(from, to)
    const mapped = bookmark.map(tr.mapping)
    const restored = mapped.resolve(tr.doc)
    expect(restored).not.toBeInstanceOf(MultiBlockSelection)
    // Without per-side tracking, this collapses to $head's mapped pos —
    // landing on block 5 (the first survivor after the gap). With
    // per-side tracking it lands on block 2 (the surviving anchor side),
    // matching MultiBlockSelection.map's pick of the surviving boundary.
    expect(restored.$head.parent.textContent).toBe("Block 2")
    editor.destroy()
  })

  it("bookmark with both boundaries deleted collapses near $head (matches map)", () => {
    const editor = makeEditor()
    const sel = MultiBlockSelection.create(editor.state.doc, 1, 2) // blocks 2..3
    const bookmark = sel.getBookmark()
    // Delete the entire selected range — both boundaries are inside the
    // deleted range. MultiBlockSelection.map uses headResult.pos when
    // anchorResult.deleted is true; the bookmark must agree.
    const doc = editor.state.doc
    const from = doc.child(0).nodeSize // before block 2
    const to = from + doc.child(1).nodeSize + doc.child(2).nodeSize // after block 3
    const tr = editor.state.tr.delete(from, to)
    const mapped = bookmark.map(tr.mapping)
    const restored = mapped.resolve(tr.doc)
    expect(restored).not.toBeInstanceOf(MultiBlockSelection)
    // Both boundaries collapse to the same mapped pos at the deletion
    // point — Selection.near picks the nearest surviving block (block 4).
    expect(restored.$head.parent.textContent).toBe("Block 4")
    editor.destroy()
  })
})

describe("MultiBlockSelection — coversSurfaceBlock (shared gesture-yield cover test)", () => {
  it("root MBS covers root hits by index (historical behavior)", () => {
    const editor = createTestEditor({ kit: { suggestionMenus: false } })
    editor.commands.setContent([
      { type: "paragraph", content: [{ type: "text", text: "root-1" }] },
      { type: "paragraph", content: [{ type: "text", text: "root-2" }] },
    ])
    const sel = MultiBlockSelection.create(editor.state.doc, 0, 0) // r1
    expect(sel.coversSurfaceBlock(-1, 0)).toBe(true)
    expect(sel.coversSurfaceBlock(-1, 1)).toBe(false)
  })
})

describe("getCrossBlockTextRange", () => {
  it("returns null for a TextSelection inside a single block", () => {
    const editor = makeEditor({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "hello world" }] },
        { type: "paragraph", content: [{ type: "text", text: "second" }] },
      ],
    })
    // Place TextSelection inside block 0 (between "hello" and " world").
    const doc = editor.state.doc
    const block0Start = 1 // inside paragraph 0
    const sel = TextSelection.create(doc, block0Start + 1, block0Start + 4)
    editor.view.dispatch(editor.state.tr.setSelection(sel))
    expect(getCrossBlockTextRange(editor.state.selection)).toBeNull()
    editor.destroy()
  })

  it("returns { fromIdx: 0, toIdx: 1 } for a TextSelection spanning blocks 0 and 1", () => {
    const editor = makeEditor({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "alpha" }] },
        { type: "paragraph", content: [{ type: "text", text: "bravo" }] },
        { type: "paragraph", content: [{ type: "text", text: "charlie" }] },
      ],
    })
    const doc = editor.state.doc
    // Anchor inside block 0 ("alp|ha"), head inside block 1 ("br|avo").
    const anchor = 1 + 3 // pos 4 inside block 0
    const block1Start = doc.child(0).nodeSize + 1
    const head = block1Start + 2
    const sel = TextSelection.create(doc, anchor, head)
    editor.view.dispatch(editor.state.tr.setSelection(sel))
    expect(getCrossBlockTextRange(editor.state.selection)).toEqual({ fromIdx: 0, toIdx: 1 })
    editor.destroy()
  })

  it("returns { fromIdx: 0, toIdx: 2 } for a TextSelection spanning blocks 0..2", () => {
    const editor = makeEditor({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "alpha" }] },
        { type: "paragraph", content: [{ type: "text", text: "bravo" }] },
        { type: "paragraph", content: [{ type: "text", text: "charlie" }] },
      ],
    })
    const doc = editor.state.doc
    const anchor = 1 + 2 // inside block 0
    const block2Start = doc.child(0).nodeSize + doc.child(1).nodeSize + 1
    const head = block2Start + 3 // inside block 2
    const sel = TextSelection.create(doc, anchor, head)
    editor.view.dispatch(editor.state.tr.setSelection(sel))
    expect(getCrossBlockTextRange(editor.state.selection)).toEqual({ fromIdx: 0, toIdx: 2 })
    editor.destroy()
  })

  it("returns null for a non-TextSelection (e.g. NodeSelection)", () => {
    const editor = makeEditor({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "alpha" }] },
        { type: "paragraph", content: [{ type: "text", text: "bravo" }] },
      ],
    })
    const doc = editor.state.doc
    // NodeSelection on block 0.
    const nodeSel = NodeSelection.create(doc, 0)
    editor.view.dispatch(editor.state.tr.setSelection(nodeSel))
    expect(getCrossBlockTextRange(editor.state.selection)).toBeNull()
    editor.destroy()
  })
})
