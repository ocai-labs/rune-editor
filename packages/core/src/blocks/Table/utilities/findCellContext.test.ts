// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, it, expect, afterEach } from "vitest"
import { Editor } from "@tiptap/core"
import Document from "@tiptap/extension-document"
import Text from "@tiptap/extension-text"
import { Paragraph } from "../../Paragraph/block"
import { Table } from "../block"
import { TableMap } from "@tiptap/pm/tables"
import { findCellBefore, findCellContext } from "./findCellContext"

let editor: Editor | null = null
function makeEditor() {
  editor = new Editor({
    element: document.createElement("div"),
    extensions: [
      Document, Text, Paragraph,
      Table,
    ],
  })
  return editor
}
afterEach(() => { editor?.destroy(); editor = null })

describe("findCellBefore", () => {
  it("returns the cell-before position when $pos is inside a cell", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 2 })
    const $head = editor.state.selection.$head
    const $cell = findCellBefore($head)
    expect($cell).not.toBeNull()
    const cellNode = editor.state.doc.nodeAt($cell!.pos)
    expect(cellNode).not.toBeNull()
    const role = cellNode!.type.spec.tableRole
    // insertTable defaults to withHeaderRow: true, placing the caret in the
    // first (header) row — so the cell at $head is always a tableHeader.
    expect(role).toBe("header_cell")
  })

  it("returns null when not inside a cell", () => {
    const editor = makeEditor()
    const $head = editor.state.doc.resolve(0)
    expect(findCellBefore($head)).toBeNull()
  })
})

describe("findCellContext", () => {
  it("resolves table, tableStart, map, row, col for a position inside a cell", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 3, cols: 4 })
    const $head = editor.state.selection.$head
    const ctx = findCellContext($head)
    expect(ctx).not.toBeNull()
    expect(ctx!.table.type.name).toBe("table")
    expect(ctx!.map.height).toBe(3)
    expect(ctx!.map.width).toBe(4)
    expect(ctx!.row).toBe(0)
    expect(ctx!.col).toBe(0)
    expect(typeof ctx!.tableStart).toBe("number")
  })

  it("returns null when not inside a table", () => {
    const editor = makeEditor()
    const $head = editor.state.doc.resolve(0)
    expect(findCellContext($head)).toBeNull()
  })

  it("locates a non-zero (row, col) when caret is moved into the second row", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 3, cols: 2, withHeaderRow: false })
    let pos = -1
    let count = 0
    editor.state.doc.descendants((node, p) => {
      if (node.type.name === "tableParagraph") {
        if (count === 2) pos = p + 1
        count += 1
      }
    })
    expect(pos).toBeGreaterThan(0)
    editor.commands.setTextSelection(pos)
    const ctx = findCellContext(editor.state.selection.$head)
    expect(ctx!.row).toBe(1)
    expect(ctx!.col).toBe(0)
  })
})

describe("findCellContext — cellPosInTable", () => {
  it("returns cellPosInTable for a tableHeader (row 0, col 0)", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 3 })
    editor.commands.focus()
    const tableNode = editor.state.doc.firstChild!
    expect(tableNode.type.name).toBe("table")
    const map = TableMap.get(tableNode)
    // map.map[0] is the actual prosemirror offset of the first cell inside the table node.
    // It equals 1 (the opening tableRow tag occupies offset 0); this verifies the return value
    // matches what TableMap itself recorded rather than a hardcoded assumption.
    const expected = map.map[0]!
    const ctx = findCellContext(editor.state.selection.$head)
    expect(ctx).not.toBeNull()
    expect(ctx!.cellPosInTable).toBe(expected)
  })

  it("returns cellPosInTable for a tableCell in row 1, col 1", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 2 })
    const tableNode = editor.state.doc.firstChild!
    expect(tableNode.type.name).toBe("table")
    const map = TableMap.get(tableNode)
    const expected = map.map[1 * map.width + 1]!
    const tableStart = 1
    editor.commands.setTextSelection(tableStart + expected + 1)
    const ctx = findCellContext(editor.state.selection.$head)
    expect(ctx).not.toBeNull()
    expect(ctx!.cellPosInTable).toBe(expected)
  })

  it("uses cellPosInTable to nodeAt the right cell node", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 2 })
    editor.commands.focus()
    const ctx = findCellContext(editor.state.selection.$head)!
    const cellNode = ctx.table.nodeAt(ctx.cellPosInTable)
    expect(cellNode).not.toBeNull()
    expect(["tableCell", "tableHeader"]).toContain(cellNode!.type.name)
  })
})
