// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, expect, it } from "vitest"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import { TextSelection } from "@tiptap/pm/state"
import { createTestEditor } from "../../test-utils/createTestEditor"
import { getDocument } from "../../api/queries"
import { MultiBlockSelection } from "./MultiBlockSelection"
import { surfaceChildrenAt } from "../../schema/bodySurface"
import type { RuneColumnsBlock } from "../../blocks/Columns/block"

// Task 4 review regression: MBS commands must operate on the MBS's OWN surface.
// A column-local MBS has surface-LOCAL block indices; commands that walked root
// `doc.child(i)` (duplicateBlocks, the React dropdown's readMbs) acted on the
// wrong ROOT block. These pin duplicateBlocks at the command level — the same
// surface-awareness the dropdown's turn-into / color path relies on.

function layoutOf(editor: ReturnType<typeof createTestEditor>): RuneColumnsBlock | undefined {
  return getDocument(editor).find(
    (b): b is RuneColumnsBlock => b.type === "columnLayout",
  )
}

function columnChildIds(
  editor: ReturnType<typeof createTestEditor>,
  columnId: string,
): string[] {
  const column = layoutOf(editor)?.columns.find((c) => c.id === columnId)
  return column ? column.children.map((c) => c.id) : []
}

/**
 * Fixture: paragraph r1 · columnLayout[ col_a[a1] · col_b[b1, b2] ] · r2.
 * col_b has two children so duplicating one keeps the column populated and the
 * surface-local index (1) differs from any root index — exposing the root-walk
 * bug if present.
 */
function fixture() {
  const editor = createTestEditor({ kit: { suggestionMenus: false } })
  const s = editor.schema
  const para = (id: string, t: string) =>
    s.nodes.paragraph!.create({ id, depth: 0 }, s.text(t))
  const col = (id: string, ...children: ProseMirrorNode[]) =>
    s.nodes.column!.create({ id, width: 1 }, children)
  const doc = s.nodes.doc!.create(null, [
    para("r1", "root-1"),
    s.nodes.columnLayout!.create({ id: "lay", depth: 0 }, [
      col("col_a", para("a1", "A1")),
      col("col_b", para("b1", "B1"), para("b2", "B2")),
    ]),
    para("r2", "root-2"),
  ])
  editor.view.dispatch(
    editor.state.tr.replaceWith(0, editor.state.doc.content.size, doc.content),
  )
  return editor
}

/**
 * Fixture: paragraph r1 · columnLayout[ col_a[a1] · col_b[b1] · col_c[c1] ] · r2.
 * Three single-child columns — selecting the LAST column's entire content
 * exercises the F2/delete parity ≥2-survivor path (delete the column node,
 * layout stays put at 2 columns), as opposed to `fixture()`'s 2-column layout
 * which exercises the <2-survivor unwrap path.
 *
 * Seeded via the `content` option (mirrors `reorder.test.ts`'s `twoImages`)
 * rather than a post-construction `replaceWith` dispatch: this test exercises
 * `undo()`, and a seed `replaceWith` sits in the SAME history group as the
 * delete under test (both fire synchronously, no real time between them),
 * so one undo would revert past the seed too. `content` builds the initial
 * doc via `EditorState.create` — no transaction, nothing to undo into.
 */
function fixture3Col() {
  return createTestEditor({
    kit: { suggestionMenus: false },
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { id: "r1", depth: 0 },
          content: [{ type: "text", text: "root-1" }],
        },
        {
          type: "columnLayout",
          attrs: { id: "lay3", depth: 0 },
          content: [
            {
              type: "column",
              attrs: { id: "col_a", width: 1 },
              content: [
                {
                  type: "paragraph",
                  attrs: { id: "a1", depth: 0 },
                  content: [{ type: "text", text: "A1" }],
                },
              ],
            },
            {
              type: "column",
              attrs: { id: "col_b", width: 1 },
              content: [
                {
                  type: "paragraph",
                  attrs: { id: "b1", depth: 0 },
                  content: [{ type: "text", text: "B1" }],
                },
              ],
            },
            {
              type: "column",
              attrs: { id: "col_c", width: 1 },
              content: [
                {
                  type: "paragraph",
                  attrs: { id: "c1", depth: 0 },
                  content: [{ type: "text", text: "C1" }],
                },
              ],
            },
          ],
        },
        {
          type: "paragraph",
          attrs: { id: "r2", depth: 0 },
          content: [{ type: "text", text: "root-2" }],
        },
      ],
    },
  })
}

/** Select exactly the column child `childId` as a column-local single-block MBS. */
function selectColumnChild(
  editor: ReturnType<typeof createTestEditor>,
  childId: string,
) {
  const doc = editor.state.doc
  let blockPos = -1
  doc.descendants((node, pos) => {
    if (node.attrs?.id === childId) blockPos = pos
    return blockPos === -1
  })
  const surface = surfaceChildrenAt(doc, blockPos)!
  let idx = 0
  let off = surface.start
  surface.node.forEach((child, _o, i) => {
    if (off === blockPos) idx = i
    off += child.nodeSize
  })
  const $surface = doc.resolve(surface.start)
  editor.view.dispatch(
    editor.state.tr.setSelection(MultiBlockSelection.create(doc, idx, idx, $surface)),
  )
}

describe("duplicateBlocks — column-local MBS (surface-aware)", () => {
  it("duplicates the COLUMN child into the column, not a root block", () => {
    const editor = fixture()
    selectColumnChild(editor, "b1") // col_b index 0
    editor.commands.duplicateBlocks()

    // col_b now holds b1, its duplicate, then b2 — all inside the column.
    const ids = columnChildIds(editor, "col_b")
    expect(ids.length).toBe(3)
    expect(ids[0]).toBe("b1")
    expect(ids[2]).toBe("b2")
    // The duplicate is a fresh id, NOT a root block id.
    expect(ids[1]).not.toBe("b1")
    expect(["r1", "r2", "a1", "b2"]).not.toContain(ids[1])
    // Root + col_a untouched.
    expect(getDocument(editor).map((b) => b.id)).toEqual(["r1", "lay", "r2"])
    expect(columnChildIds(editor, "col_a")).toEqual(["a1"])
  })

  it("restores the MBS over the duplicate on the column surface", () => {
    const editor = fixture()
    selectColumnChild(editor, "b2") // col_b index 1
    editor.commands.duplicateBlocks()

    const sel = editor.state.selection
    expect(sel).toBeInstanceOf(MultiBlockSelection)
    const mbs = sel as MultiBlockSelection
    // The restored selection sits on the column surface (a column node), not doc.
    expect(mbs.surface.type.name).toBe("column")
    // col_b: b1, b2, <dup of b2>.
    const ids = columnChildIds(editor, "col_b")
    expect(ids.slice(0, 2)).toEqual(["b1", "b2"])
    expect(ids.length).toBe(3)
  })
})

/** Select a contiguous run of column children [loId..hiId] as a column MBS. */
function selectColumnRange(
  editor: ReturnType<typeof createTestEditor>,
  loId: string,
  hiId: string,
) {
  const doc = editor.state.doc
  const posOf = (id: string) => {
    let p = -1
    doc.descendants((node, pos) => {
      if (node.attrs?.id === id) p = pos
      return p === -1
    })
    return p
  }
  const loPos = posOf(loId)
  const surface = surfaceChildrenAt(doc, loPos)!
  const indexOf = (blockPos: number) => {
    let idx = 0
    let off = surface.start
    surface.node.forEach((child, _o, i) => {
      if (off === blockPos) idx = i
      off += child.nodeSize
    })
    return idx
  }
  const $surface = doc.resolve(surface.start)
  editor.view.dispatch(
    editor.state.tr.setSelection(
      MultiBlockSelection.create(doc, indexOf(loPos), indexOf(posOf(hiId)), $surface),
    ),
  )
}

describe("MBS command sanity — column-local MBS (cut/copy/delete)", () => {
  it("copy: MBS.content() slice is the COLUMN's selected blocks, not root blocks", () => {
    const editor = fixture()
    selectColumnRange(editor, "b1", "b2") // both col_b children
    const slice = (editor.state.selection as MultiBlockSelection).content()
    const texts: string[] = []
    slice.content.forEach((n) => texts.push(n.textContent))
    expect(texts).toEqual(["B1", "B2"])
  })

  it("delete: removing a column's blocks (partial) leaves the column populated", () => {
    const editor = fixture()
    selectColumnRange(editor, "b1", "b1") // just b1
    editor.commands.deleteBlockSelection()
    expect(columnChildIds(editor, "col_b")).toEqual(["b2"])
    // Root + col_a untouched; layout intact.
    expect(getDocument(editor).map((b) => b.id)).toEqual(["r1", "lay", "r2"])
  })

  it("delete: emptying the RIGHT column (all its blocks) unwraps the layout, matching F2 move-out (Notion parity)", () => {
    const editor = fixture()
    selectColumnRange(editor, "b1", "b2") // all of col_b (the RIGHT column)
    editor.commands.deleteBlockSelection()
    // Delete now matches F2's move-out contract: emptying col_b's only
    // sibling column (col_a) drops the layout below 2 columns, so it
    // unwraps — col_a's children splice to root. E2's reseed is no longer
    // reachable via this command; it remains the safety net for non-command
    // paths (paste / setContent / collab).
    const doc = getDocument(editor)
    expect(doc.map((b) => b.type)).not.toContain("columnLayout")
    expect(doc.map((b) => b.id)).toEqual(["r1", "a1", "r2"])
    // FIX 1 — the caret lands in the SURVIVING column content (a1), NOT the
    // following root block (r2) it used to overshoot into via replaceWith's
    // interior-position remap. Survivor col_a's last block for an emptied RIGHT
    // column is a1.
    expect(editor.state.selection).toBeInstanceOf(TextSelection)
    expect(caretInsideBlock(editor, "a1")).toBe(true)
  })

  it("delete: emptying the LEFT column of a 2-col layout lands the caret in the survivor's LAST block (not its first)", () => {
    // Survivor (col_b) has TWO children — the discriminating case the single-
    // child fixtures can't expose. Emptying col_a (LEFT) unwraps to r1·b1·b2·r2;
    // the caret must NOT overshoot to r2 AND must NOT land at the survivor's
    // first block (b1): Notion parity lands it at the survivor's end (b2).
    const editor = fixture()
    selectColumnRange(editor, "a1", "a1") // all of col_a (the LEFT column)
    editor.commands.deleteBlockSelection()

    const doc = getDocument(editor)
    expect(doc.map((b) => b.type)).not.toContain("columnLayout")
    expect(doc.map((b) => b.id)).toEqual(["r1", "b1", "b2", "r2"])
    expect(editor.state.selection).toBeInstanceOf(TextSelection)
    expect(caretInsideBlock(editor, "b2")).toBe(true)
    expect(caretInsideBlock(editor, "b1")).toBe(false)
    expect(caretInsideBlock(editor, "r2")).toBe(false)
  })

  it("delete: emptying the LAST of 3 columns removes just that column; layout survives at 2 columns", () => {
    const editor = fixture3Col()
    selectColumnRange(editor, "c1", "c1") // all of col_c
    editor.commands.deleteBlockSelection()

    const layout = layoutOf(editor)
    expect(layout).toBeDefined()
    expect(layout!.columns.map((c) => c.id)).toEqual(["col_a", "col_b"])
    // Other columns' content untouched.
    expect(columnChildIds(editor, "col_a")).toEqual(["a1"])
    expect(columnChildIds(editor, "col_b")).toEqual(["b1"])
    expect(getDocument(editor).map((b) => b.id)).toEqual(["r1", "lay3", "r2"])
    // FIX 1 — the emptied column is LAST (no next column), so the caret lands in
    // the PREVIOUS column's last block (b1), not the overshot root block r2.
    expect(editor.state.selection).toBeInstanceOf(TextSelection)
    expect(caretInsideBlock(editor, "b1")).toBe(true)
    expect(caretInsideBlock(editor, "r2")).toBe(false)

    // One undo restores everything.
    editor.commands.undo()
    const restored = layoutOf(editor)
    expect(restored!.columns.map((c) => c.id)).toEqual(["col_a", "col_b", "col_c"])
    expect(columnChildIds(editor, "col_c")).toEqual(["c1"])
  })

  it("delete: emptying the FIRST of 3 columns lands the caret in the NEXT column's first block", () => {
    const editor = fixture3Col()
    selectColumnRange(editor, "a1", "a1") // all of col_a (first column)
    editor.commands.deleteBlockSelection()

    const layout = layoutOf(editor)
    expect(layout!.columns.map((c) => c.id)).toEqual(["col_b", "col_c"])
    // Next column after the emptied one is col_b → caret in its first block b1.
    expect(editor.state.selection).toBeInstanceOf(TextSelection)
    expect(caretInsideBlock(editor, "b1")).toBe(true)
  })

  it("delete: emptying the MIDDLE of 3 columns lands the caret in the NEXT column's first block", () => {
    const editor = fixture3Col()
    selectColumnRange(editor, "b1", "b1") // all of col_b (middle column)
    editor.commands.deleteBlockSelection()

    const layout = layoutOf(editor)
    expect(layout!.columns.map((c) => c.id)).toEqual(["col_a", "col_c"])
    // Next column after the emptied one is col_c → caret in its first block c1.
    expect(editor.state.selection).toBeInstanceOf(TextSelection)
    expect(caretInsideBlock(editor, "c1")).toBe(true)
  })

  it("delete: emptied-column caret landing holds with NO trailing root content (no overshoot target)", () => {
    // Layout is the LAST root block — the pre-fix overshoot had nowhere to go
    // (it landed on a reseeded paragraph / doc end). 3-col, emptying the LAST
    // column, must still land in the previous column's last block.
    const editor = createTestEditor({
      kit: { suggestionMenus: false },
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { id: "r1", depth: 0 },
            content: [{ type: "text", text: "root-1" }],
          },
          {
            type: "columnLayout",
            attrs: { id: "lay3", depth: 0 },
            content: ["col_a", "col_b", "col_c"].map((cid, i) => ({
              type: "column",
              attrs: { id: cid, width: 1 },
              content: [
                {
                  type: "paragraph",
                  attrs: { id: `${cid}_p`, depth: 0 },
                  content: [{ type: "text", text: `C${i}` }],
                },
              ],
            })),
          },
        ],
      },
    })
    selectColumnRange(editor, "col_c_p", "col_c_p")
    editor.commands.deleteBlockSelection()
    expect(layoutOf(editor)!.columns.map((c) => c.id)).toEqual(["col_a", "col_b"])
    expect(editor.state.selection).toBeInstanceOf(TextSelection)
    expect(caretInsideBlock(editor, "col_b_p")).toBe(true)
  })

  it("delete: 2-col unwrap caret landing holds with NO trailing root content", () => {
    // r1 · layout[col_a[a1] · col_b[b1,b2]] — no r2. Empty col_b (RIGHT) →
    // survivor col_a[a1] unwraps; caret in a1 (survivor last), never past it.
    const editor = createTestEditor({
      kit: { suggestionMenus: false },
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { id: "r1", depth: 0 },
            content: [{ type: "text", text: "root-1" }],
          },
          {
            type: "columnLayout",
            attrs: { id: "lay", depth: 0 },
            content: [
              {
                type: "column",
                attrs: { id: "col_a", width: 1 },
                content: [
                  { type: "paragraph", attrs: { id: "a1", depth: 0 }, content: [{ type: "text", text: "A1" }] },
                ],
              },
              {
                type: "column",
                attrs: { id: "col_b", width: 1 },
                content: [
                  { type: "paragraph", attrs: { id: "b1", depth: 0 }, content: [{ type: "text", text: "B1" }] },
                  { type: "paragraph", attrs: { id: "b2", depth: 0 }, content: [{ type: "text", text: "B2" }] },
                ],
              },
            ],
          },
        ],
      },
    })
    selectColumnRange(editor, "b1", "b2")
    editor.commands.deleteBlockSelection()
    expect(getDocument(editor).map((b) => b.id)).toEqual(["r1", "a1"])
    expect(editor.state.selection).toBeInstanceOf(TextSelection)
    expect(caretInsideBlock(editor, "a1")).toBe(true)
  })

  it("moveBlockUp: column MBS moves the block WITHIN its column; root order unchanged", () => {
    const editor = fixture()
    selectColumnChild(editor, "b2") // col_b index 1
    const ok = editor.commands.moveBlockUp()
    expect(ok).toBe(true)
    // Reordered inside col_b only — NOT teleported to the top of the document.
    expect(columnChildIds(editor, "col_b")).toEqual(["b2", "b1"])
    expect(getDocument(editor).map((b) => b.id)).toEqual(["r1", "lay", "r2"])
    expect(columnChildIds(editor, "col_a")).toEqual(["a1"])
    // MBS preserved on the column surface at its new index.
    const sel = editor.state.selection as MultiBlockSelection
    expect(sel).toBeInstanceOf(MultiBlockSelection)
    expect(sel.surface.type.name).toBe("column")
    expect(sel.blockIndices).toEqual([0, 0])
  })

  it("moveBlockDown: column MBS moves the block WITHIN its column; root order unchanged", () => {
    const editor = fixture()
    selectColumnChild(editor, "b1") // col_b index 0
    const ok = editor.commands.moveBlockDown()
    expect(ok).toBe(true)
    expect(columnChildIds(editor, "col_b")).toEqual(["b2", "b1"])
    expect(getDocument(editor).map((b) => b.id)).toEqual(["r1", "lay", "r2"])
    const sel = editor.state.selection as MultiBlockSelection
    expect(sel).toBeInstanceOf(MultiBlockSelection)
    expect(sel.surface.type.name).toBe("column")
    expect(sel.blockIndices).toEqual([1, 1])
  })

  it("column-top clamp: moveBlockUp on the column's first block is a consumed no-op", () => {
    const editor = fixture()
    selectColumnChild(editor, "b1") // col_b index 0 — at the column's top edge
    const before = editor.state.doc.toJSON()
    expect(editor.commands.moveBlockUp()).toBe(true)
    expect(editor.state.doc.toJSON()).toEqual(before)
    expect((editor.state.selection as MultiBlockSelection).blockIndices).toEqual([0, 0])
  })

  it("column-bottom clamp: moveBlockDown on the column's last block is a consumed no-op", () => {
    const editor = fixture()
    selectColumnChild(editor, "b2") // col_b index 1 — at the column's bottom edge
    const before = editor.state.doc.toJSON()
    expect(editor.commands.moveBlockDown()).toBe(true)
    expect(editor.state.doc.toJSON()).toEqual(before)
    expect((editor.state.selection as MultiBlockSelection).blockIndices).toEqual([1, 1])
  })

  it("clearBlockSelection: column MBS collapses to a caret INSIDE the column child, not a root block", () => {
    const editor = fixture()
    selectColumnChild(editor, "b1") // col_b index 0
    editor.commands.clearBlockSelection()

    const sel = editor.state.selection
    expect(sel).toBeInstanceOf(TextSelection)
    // The caret must resolve inside b1 (the column child), i.e. its nearest
    // textblock ancestor is b1 — NOT a root block. Walk up from the caret.
    const $pos = sel.$from
    let landedInB1 = false
    for (let d = $pos.depth; d >= 1; d--) {
      if ($pos.node(d).attrs?.id === "b1") landedInB1 = true
    }
    expect(landedInB1).toBe(true)
  })
})

/** Absolute pos of the block with `id` (the position before the node). */
function posOfBlock(editor: ReturnType<typeof createTestEditor>, id: string): number {
  let p = -1
  editor.state.doc.descendants((node, pos) => {
    if (node.attrs?.id === id) p = pos
    return p === -1
  })
  if (p < 0) throw new Error(`block ${id} not found`)
  return p
}

/** Place a caret `offset` chars into the text of block `id`. */
function caretIn(
  editor: ReturnType<typeof createTestEditor>,
  id: string,
  offset = 0,
) {
  const pos = posOfBlock(editor, id) + 1 + offset
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)),
  )
}

/** Whether the current caret sits inside the block with `id`. */
function caretInsideBlock(
  editor: ReturnType<typeof createTestEditor>,
  id: string,
): boolean {
  const $pos = editor.state.selection.$from
  for (let d = $pos.depth; d >= 1; d--) {
    if ($pos.node(d).attrs?.id === id) return true
  }
  return false
}

// BS-2 regression: the caret (TextSelection) branches of moveBlockUp/Down and
// duplicateBlocks were root-only (`$pos.index(0)`): with the caret in a column
// child, Mod-ArrowUp/Down reordered the WHOLE columnLayout and Mod-D duplicated
// the entire layout — while the MBS branches of the same commands are already
// column-local (pinned above). The caret branches must resolve the caret's
// containing block on its OWN surface.
describe("caret (TextSelection) commands — caret inside a column child (surface-aware)", () => {
  it("moveBlockDown: caret in b1 moves b1 WITHIN col_b, not the whole layout", () => {
    const editor = fixture()
    caretIn(editor, "b1", 1)
    const ok = editor.commands.moveBlockDown()
    expect(ok).toBe(true)
    expect(columnChildIds(editor, "col_b")).toEqual(["b2", "b1"])
    // Root order untouched — the layout did NOT move.
    expect(getDocument(editor).map((b) => b.id)).toEqual(["r1", "lay", "r2"])
    expect(columnChildIds(editor, "col_a")).toEqual(["a1"])
    // Caret restored inside the moved block.
    expect(editor.state.selection.empty).toBe(true)
    expect(caretInsideBlock(editor, "b1")).toBe(true)
  })

  it("moveBlockUp: caret in b2 moves b2 WITHIN col_b, not the whole layout", () => {
    const editor = fixture()
    caretIn(editor, "b2", 1)
    const ok = editor.commands.moveBlockUp()
    expect(ok).toBe(true)
    expect(columnChildIds(editor, "col_b")).toEqual(["b2", "b1"])
    expect(getDocument(editor).map((b) => b.id)).toEqual(["r1", "lay", "r2"])
    expect(editor.state.selection.empty).toBe(true)
    expect(caretInsideBlock(editor, "b2")).toBe(true)
  })

  it("column-top clamp: caret in the column's first block → moveBlockUp is a consumed no-op", () => {
    const editor = fixture()
    caretIn(editor, "b1") // col_b index 0 — column top edge
    const before = editor.state.doc.toJSON()
    expect(editor.commands.moveBlockUp()).toBe(true)
    expect(editor.state.doc.toJSON()).toEqual(before)
  })

  it("column-bottom clamp: caret in the column's last block → moveBlockDown is a consumed no-op", () => {
    const editor = fixture()
    caretIn(editor, "b2") // col_b index 1 — column bottom edge
    const before = editor.state.doc.toJSON()
    expect(editor.commands.moveBlockDown()).toBe(true)
    expect(editor.state.doc.toJSON()).toEqual(before)
  })

  it("duplicateBlocks: caret in b1 duplicates the COLUMN child into the column, not the layout", () => {
    const editor = fixture()
    caretIn(editor, "b1", 1)
    const ok = editor.commands.duplicateBlocks()
    expect(ok).toBe(true)

    // col_b: b1, <duplicate of b1>, b2 — all inside the column.
    const column = layoutOf(editor)?.columns.find((c) => c.id === "col_b")
    expect(column).toBeDefined()
    const ids = column!.children.map((c) => c.id)
    expect(ids.length).toBe(3)
    expect(ids[0]).toBe("b1")
    expect(ids[2]).toBe("b2")
    // The duplicate exists with a regenerated id (backfill) — don't pin the id.
    expect(new Set(ids).size).toBe(3)
    // It is a content copy of b1.
    const texts = ids.map(
      (id) => editor.state.doc.nodeAt(posOfBlock(editor, id!))!.textContent,
    )
    expect(texts).toEqual(["B1", "B1", "B2"])
    // Root + col_a untouched — the layout was NOT duplicated.
    expect(getDocument(editor).map((b) => b.id)).toEqual(["r1", "lay", "r2"])
    expect(columnChildIds(editor, "col_a")).toEqual(["a1"])

    // Caret lands in the duplicate (col_b's middle child) at the same offset.
    const dupId = ids[1]!
    expect(caretInsideBlock(editor, dupId)).toBe(true)
    expect(editor.state.selection.from).toBe(posOfBlock(editor, dupId) + 1 + 1)
  })
})

// BS-3 regression: programmatic setBlockSelection resolved endpoint ids with the
// root-only topLevelBlockIndexById, so an in-column id yielded -1 and the command
// no-opped. Endpoints must resolve surface-aware, share ONE surface, and build a
// column-local MBS. Numeric refs keep the historical root semantics.
describe("setBlockSelection — in-column endpoint ids (surface-aware)", () => {
  it("selects a run of column children on the column surface", () => {
    const editor = fixture()
    const ok = editor.commands.setBlockSelection({ from: "b1", to: "b2" })
    expect(ok).toBe(true)
    const sel = editor.state.selection as MultiBlockSelection
    expect(sel).toBeInstanceOf(MultiBlockSelection)
    expect(sel.surface.type.name).toBe("column")
    // Both b1/b2 are col_b's children → surface-local indices [0, 1].
    expect(sel.blockIndices).toEqual([0, 1])
    // The selected nodes are the column's blocks, not root blocks.
    expect(sel.blockNodes.map((n) => n.textContent)).toEqual(["B1", "B2"])
  })

  it("selects a single column child (from === to)", () => {
    const editor = fixture()
    const ok = editor.commands.setBlockSelection({ from: "b2", to: "b2" })
    expect(ok).toBe(true)
    const sel = editor.state.selection as MultiBlockSelection
    expect(sel.surface.type.name).toBe("column")
    expect(sel.blockIndices).toEqual([1, 1])
  })

  it("returns false for endpoints on DIFFERENT surfaces (cross-column)", () => {
    const editor = fixture()
    // a1 lives in col_a, b1 in col_b — a cross-surface MBS is not a thing.
    expect(editor.commands.setBlockSelection({ from: "a1", to: "b1" })).toBe(false)
  })

  it("returns false for a root ↔ in-column pair", () => {
    const editor = fixture()
    expect(editor.commands.setBlockSelection({ from: "r1", to: "b1" })).toBe(false)
  })

  it("still resolves root ids on the root surface", () => {
    const editor = fixture()
    const ok = editor.commands.setBlockSelection({ from: "r1", to: "lay" })
    expect(ok).toBe(true)
    const sel = editor.state.selection as MultiBlockSelection
    // Root surface = the doc.
    expect(sel.surface.type.name).toBe("doc")
    expect(sel.blockIndices).toEqual([0, 1])
  })
})
