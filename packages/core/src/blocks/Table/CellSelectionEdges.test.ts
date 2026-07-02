// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, it, expect } from "vitest"
import { Paragraph } from "../Paragraph/block"
import { CellSelection } from "prosemirror-tables"
import Document from "@tiptap/extension-document"
import Text from "@tiptap/extension-text"
import { Table } from "./block"
import { GestureStatePlugin, gestureKey } from "../../extensions/shared/gesture-state"
import { createTestEditor } from "../../test-utils/createTestEditor"

function makeEditor() {
  return createTestEditor({
    element: document.createElement("div"),
    extensions: [
      Document, Text, Paragraph,
      Table,
      GestureStatePlugin,
    ],
  })
}

describe("CellSelectionEdges", () => {
  it("does not decorate cells when there is no CellSelection", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 2 })
    expect(editor.view.dom.querySelectorAll(".sel-edge-top, .sel-edge-right, .sel-edge-bottom, .sel-edge-left").length).toBe(0)
    // cursorCell is expected — insertTable places the caret in the first cell
  })

  it("annotates outer borders of a CellSelection rectangle", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 2 })
    let firstCellPos = -1
    let secondCellPos = -1
    editor.state.doc.descendants((node, pos) => {
      const role = node.type.spec.tableRole
      if (role === "cell" || role === "header_cell") {
        if (firstCellPos === -1) firstCellPos = pos
        else if (secondCellPos === -1) secondCellPos = pos
      }
    })
    const tr = editor.state.tr.setSelection(
      new CellSelection(
        editor.state.doc.resolve(firstCellPos),
        editor.state.doc.resolve(secondCellPos),
      ),
    )
    editor.view.dispatch(tr)
    expect(editor.view.dom.querySelectorAll(".sel-edge-top").length).toBeGreaterThan(0)
    expect(editor.view.dom.querySelectorAll(".sel-edge-right").length).toBeGreaterThan(0)
    expect(editor.view.dom.querySelectorAll(".sel-edge-bottom").length).toBeGreaterThan(0)
    expect(editor.view.dom.querySelectorAll(".sel-edge-left").length).toBeGreaterThan(0)
  })
})

describe("CellSelectionEdges — cursorCell on caret", () => {
  it("emits cursorCell on the cell containing an empty TextSelection caret", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 2 })
    editor.commands.focus()
    const cells = editor.view.dom.querySelectorAll("td, th")
    const cursorCells = editor.view.dom.querySelectorAll(".cursorCell")
    expect(cursorCells.length).toBe(1)
    expect(cells[0]!.classList.contains("cursorCell")).toBe(true)
  })

  it("does NOT emit cursorCell when TextSelection is non-empty", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 2 })
    editor.commands.focus()
    editor.commands.insertContent("hello")
    const $head = editor.state.selection.$head
    editor.commands.setTextSelection({ from: $head.pos - 5, to: $head.pos })
    expect(editor.view.dom.querySelectorAll(".cursorCell").length).toBe(0)
  })

  it("does not emit cursorCell when caret is outside any table", () => {
    const editor = makeEditor()
    editor.commands.insertContent({ type: "paragraph", content: [{ type: "text", text: "hi" }] })
    editor.commands.focus()
    expect(editor.view.dom.querySelectorAll(".cursorCell").length).toBe(0)
  })

  it("does NOT emit cursorCell while a cell-drag is active (issue #203)", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 2 })
    editor.commands.focus()
    expect(editor.view.dom.querySelectorAll(".cursorCell").length).toBe(1)
    editor.view.dispatch(editor.state.tr.setMeta(gestureKey, { activeGesture: "cell-drag" }))
    expect(editor.view.dom.querySelectorAll(".cursorCell").length).toBe(0)
    editor.view.dispatch(editor.state.tr.setMeta(gestureKey, { activeGesture: null }))
    expect(editor.view.dom.querySelectorAll(".cursorCell").length).toBe(1)
  })

  it("CellSelection regression — sel-edge-* classes still emitted (no cursorCell)", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 2 })
    let firstCellPos = -1
    let lastCellPos = -1
    editor.state.doc.descendants((node, pos) => {
      const role = node.type.spec.tableRole
      if (role === "cell" || role === "header_cell") {
        if (firstCellPos === -1) firstCellPos = pos
        lastCellPos = pos
      }
    })
    const $a = editor.state.doc.resolve(firstCellPos)
    const $h = editor.state.doc.resolve(lastCellPos)
    editor.view.dispatch(editor.state.tr.setSelection(new CellSelection($a, $h)))
    expect(editor.view.dom.querySelectorAll(".sel-edge-top, .sel-edge-right, .sel-edge-bottom, .sel-edge-left").length).toBeGreaterThan(0)
    expect(editor.view.dom.querySelectorAll(".cursorCell").length).toBe(0)
  })
})
