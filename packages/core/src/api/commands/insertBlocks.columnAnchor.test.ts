// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, expect, it } from "vitest"
import type { Editor } from "@tiptap/core"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import { createTestEditor } from "../../test-utils/createTestEditor"
import { getDocument } from "../queries"
import type { RuneColumnsBlock } from "../../blocks/Columns/block"

// insertBlocks — in-column {id, side} anchors and numeric column-surface
// boundaries (complements `columnTargets.test.ts`, which covers the explicit
// `{columnId, index}` form). Before this fix `resolveInsertPos` resolved both
// paths through the ROOT-only helpers, so an anchor id / boundary pos living
// inside a `column` returned -1 and the command refused the insert.
//
// The fixture is built straight from the schema so ids are known up front.
//   paragraph "root-1"  (id r1)
//   columnLayout (id lay)
//     column col_a: paragraph "A1" (a1)
//     column col_b: paragraph "B1" (b1)
//   paragraph "root-2"  (id r2)

interface Fixture {
  editor: Editor
  colA: string
  colB: string
}

function makeFixture(): Fixture {
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
      col("col_b", para("b1", "B1")),
    ]),
    para("r2", "root-2"),
  ])
  editor.view.dispatch(
    editor.state.tr.replaceWith(0, editor.state.doc.content.size, doc.content),
  )
  return { editor, colA: "col_a", colB: "col_b" }
}

/** Project the layout block and read a column's child ids in order. */
function columnChildIds(editor: Editor, columnId: string): string[] {
  const layout = getDocument(editor).find(
    (b): b is RuneColumnsBlock => b.type === "columnLayout",
  )
  if (!layout) return []
  const column = layout.columns.find((c) => c.id === columnId)
  return column ? column.children.map((c) => c.id) : []
}

/** Absolute pos of a named `column` node (its "before" pos). */
function columnPos(editor: Editor, columnId: string): number {
  let p = -1
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "column" && node.attrs.id === columnId) p = pos
    return true
  })
  return p
}

/** The `depth` attr of a block by id. */
function depthOf(editor: Editor, id: string): number {
  let d = -1
  editor.state.doc.descendants((node) => {
    if (node.attrs.id === id) d = node.attrs.depth as number
    return true
  })
  return d
}

describe("insertBlocks — {id, side} anchor inside a column", () => {
  it("inserts INSIDE the column right after an in-column anchor (side: after)", () => {
    const { editor, colA } = makeFixture()
    const ok = editor.commands.insertBlocks(
      [{ type: "paragraph", id: "ins", text: "inserted" } as never],
      { at: { id: "a1", side: "after" } },
    )
    expect(ok).toBe(true)
    expect(columnChildIds(editor, colA)).toEqual(["a1", "ins"])
    // Depth follows the same convention as the root path: clamped to the
    // column-local predecessor (a1 @ depth 0) + 1 window → floor 0 here.
    expect(depthOf(editor, "ins")).toBe(0)
  })

  it("inserts INSIDE the column right before an in-column anchor (side: before)", () => {
    const { editor, colA } = makeFixture()
    const ok = editor.commands.insertBlocks(
      [{ type: "paragraph", id: "ins", text: "inserted" } as never],
      { at: { id: "a1", side: "before" } },
    )
    expect(ok).toBe(true)
    expect(columnChildIds(editor, colA)).toEqual(["ins", "a1"])
  })

  it("rejects a columnLayout input targeted at an in-column anchor (no nesting)", () => {
    const { editor, colA } = makeFixture()
    const before = editor.state.doc.toJSON()
    const layoutInput = {
      type: "columnLayout",
      columns: [
        { id: "x", width: 1, children: [] },
        { id: "y", width: 1, children: [] },
      ],
    } as never
    const ok = editor.commands.insertBlocks([layoutInput], {
      at: { id: "a1", side: "after" },
    })
    expect(ok).toBe(false)
    expect(editor.state.doc.toJSON()).toEqual(before)
    expect(columnChildIds(editor, colA)).toEqual(["a1"])
  })

  it("leaves root-anchor behavior unchanged (side: after at root)", () => {
    const { editor } = makeFixture()
    const ok = editor.commands.insertBlocks(
      [{ type: "paragraph", id: "ins", text: "inserted" } as never],
      { at: { id: "r1", side: "after" } },
    )
    expect(ok).toBe(true)
    expect(getDocument(editor).map((b) => b.id)).toEqual([
      "r1",
      "ins",
      "lay",
      "r2",
    ])
  })
})

describe("insertBlocks — numeric boundary inside a column surface", () => {
  it("accepts a column content-start boundary and inserts there", () => {
    const { editor, colA } = makeFixture()
    const contentStart = columnPos(editor, colA) + 1 // past the column open token
    const ok = editor.commands.insertBlocks(
      [{ type: "paragraph", id: "ins", text: "inserted" } as never],
      { at: contentStart },
    )
    expect(ok).toBe(true)
    expect(columnChildIds(editor, colA)).toEqual(["ins", "a1"])
  })

  it("accepts the boundary AFTER a column's last child (column tail)", () => {
    const { editor, colA } = makeFixture()
    const contentStart = columnPos(editor, colA) + 1
    const a1Size = editor.state.doc.nodeAt(contentStart)!.nodeSize
    const ok = editor.commands.insertBlocks(
      [{ type: "paragraph", id: "ins", text: "inserted" } as never],
      { at: contentStart + a1Size },
    )
    expect(ok).toBe(true)
    expect(columnChildIds(editor, colA)).toEqual(["a1", "ins"])
  })

  it("rejects a numeric position INSIDE a column textblock (mid-text)", () => {
    const { editor, colA } = makeFixture()
    const contentStart = columnPos(editor, colA) + 1
    const before = editor.state.doc.toJSON()
    // contentStart + 2 sits between 'A' and '1' of paragraph a1 — inside the
    // textblock, not a block boundary.
    const ok = editor.commands.insertBlocks(
      [{ type: "paragraph", id: "ins", text: "inserted" } as never],
      { at: contentStart + 2 },
    )
    expect(ok).toBe(false)
    expect(editor.state.doc.toJSON()).toEqual(before)
    expect(columnChildIds(editor, colA)).toEqual(["a1"])
  })

  it("rejects a columnLayout at a numeric in-column boundary (no nesting)", () => {
    const { editor, colA } = makeFixture()
    const contentStart = columnPos(editor, colA) + 1
    const before = editor.state.doc.toJSON()
    const layoutInput = {
      type: "columnLayout",
      columns: [
        { id: "x", width: 1, children: [] },
        { id: "y", width: 1, children: [] },
      ],
    } as never
    const ok = editor.commands.insertBlocks([layoutInput], { at: contentStart })
    expect(ok).toBe(false)
    expect(editor.state.doc.toJSON()).toEqual(before)
    expect(columnChildIds(editor, colA)).toEqual(["a1"])
  })

  it("still accepts a numeric ROOT boundary (existing behavior)", () => {
    const { editor } = makeFixture()
    // Boundary before the root columnLayout: r1 is the first root child.
    const r1Size = editor.state.doc.child(0).nodeSize
    const ok = editor.commands.insertBlocks(
      [{ type: "paragraph", id: "ins", text: "inserted" } as never],
      { at: r1Size },
    )
    expect(ok).toBe(true)
    expect(getDocument(editor).map((b) => b.id)).toEqual([
      "r1",
      "ins",
      "lay",
      "r2",
    ])
  })
})
