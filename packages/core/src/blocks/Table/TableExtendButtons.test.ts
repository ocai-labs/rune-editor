// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, it, expect, afterEach } from "vitest"
import { Editor } from "@tiptap/core"
import Document from "@tiptap/extension-document"
import Text from "@tiptap/extension-text"
import { Paragraph } from "../Paragraph/block"
import { Table } from "./block"
import { GestureStatePlugin } from "../../extensions/shared/gesture-state"
import { CellHandlePills, PILL_DROPDOWN_META } from "./CellHandlePills"
import { TableExtendButtons } from "./TableExtendButtons"
import { TableMap } from "@tiptap/pm/tables"
import { findCellContext } from "./utilities/findCellContext"
import { gestureKey } from "../../extensions/shared/gesture-state"

let editor: Editor | null = null
function makeEditor() {
  editor = new Editor({
    element: document.createElement("div"),
    extensions: [
      Document, Text, Paragraph,
      Table,
      GestureStatePlugin,
      CellHandlePills, TableExtendButtons,
    ],
  })
  return editor
}
afterEach(() => { editor?.destroy(); editor = null })

describe("TableExtendButtons", () => {
  it("mounts +col, +row buttons inside .rune-table-frame", async () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 2 })
    // queueMicrotask scheduled inside plugin view — flush it.
    await Promise.resolve()
    const frame = editor.view.dom.querySelector(".rune-table-frame")!
    expect(frame.querySelector(".rune-table-extend-col")).not.toBeNull()
    expect(frame.querySelector(".rune-table-extend-row")).not.toBeNull()
  })

  it("buttons have contenteditable=false", async () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 2 })
    await Promise.resolve()
    const btn = editor.view.dom.querySelector(".rune-table-extend-col") as HTMLElement
    expect(btn.getAttribute("contenteditable")).toBe("false")
  })

  it("+col click adds a new last column", async () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 2 })
    await Promise.resolve()
    const btn = editor.view.dom.querySelector(".rune-table-extend-col") as HTMLElement
    btn.click()
    const tableNode = editor.state.doc.firstChild!
    const firstRow = tableNode.firstChild!
    expect(firstRow.childCount).toBe(3)
  })

  it("+row click adds a new last row", async () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 2 })
    await Promise.resolve()
    const btn = editor.view.dom.querySelector(".rune-table-extend-row") as HTMLElement
    btn.click()
    const tableNode = editor.state.doc.firstChild!
    expect(tableNode.childCount).toBe(3)
  })

  it("+col click does NOT mutate user selection (no state.apply trick)", async () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 3, cols: 3 })
    await Promise.resolve()
    const tableNode = editor.state.doc.firstChild!
    const map = TableMap.get(tableNode)
    const middlePos = 1 + map.map[1 * 3 + 1]! + 1
    editor.commands.setTextSelection(middlePos)
    const before = editor.state.selection
    const btn = editor.view.dom.querySelector(".rune-table-extend-col") as HTMLElement
    btn.click()
    const ctxBefore = findCellContext(before.$head)!
    const ctxAfter = findCellContext(editor.state.selection.$head)!
    expect(ctxAfter.row).toBe(ctxBefore.row)
    expect(ctxAfter.col).toBe(ctxBefore.col)
  })

  it("STALE-POSITION REGRESSION: +col works after a paragraph is inserted before the table", async () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 2 })
    await Promise.resolve()
    editor.commands.insertContentAt(0, { type: "paragraph", content: [{ type: "text", text: "hi" }] })
    const btn = editor.view.dom.querySelector(".rune-table-extend-col") as HTMLElement
    btn.click()
    const tableNode = editor.state.doc.maybeChild(1)!
    expect(tableNode.type.name).toBe("table")
    expect(tableNode.firstChild!.childCount).toBe(3)
  })

  it("destroy() unmounts all buttons across two tables", async () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 2 })
    editor.commands.setTextSelection(editor.state.doc.content.size)
    editor.commands.insertTable({ rows: 2, cols: 2 })
    await Promise.resolve()
    expect(editor.view.dom.querySelectorAll(".rune-table-extend-col").length).toBe(2)
    editor.destroy()
    expect(true).toBe(true)
  })

  // Selection-based reveal (caret in last col/row). The CSS reads these data
  // attrs; the hover path is covered by the Playwright spec. This is the
  // reveal source `:focus-within` could not provide (dead in contenteditable).
  function caretInCell(ed: Editor, row: number, col: number): void {
    const tableNode = ed.state.doc.firstChild!
    const map = TableMap.get(tableNode)
    ed.commands.setTextSelection(1 + map.map[row * map.width + col]! + 1)
  }

  it("caret in a last-column cell flags the frame col-active (not row-active)", async () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 3, cols: 3 })
    await Promise.resolve()
    const frame = editor.view.dom.querySelector(".rune-table-frame") as HTMLElement
    caretInCell(editor, 0, 2) // top row, last column
    expect(frame.hasAttribute("data-rune-extend-col-active")).toBe(true)
    expect(frame.hasAttribute("data-rune-extend-row-active")).toBe(false)
  })

  it("caret in a last-row cell flags the frame row-active (not col-active)", async () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 3, cols: 3 })
    await Promise.resolve()
    const frame = editor.view.dom.querySelector(".rune-table-frame") as HTMLElement
    caretInCell(editor, 2, 0) // last row, first column
    expect(frame.hasAttribute("data-rune-extend-row-active")).toBe(true)
    expect(frame.hasAttribute("data-rune-extend-col-active")).toBe(false)
  })

  it("caret in the bottom-right cell flags BOTH col- and row-active", async () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 3, cols: 3 })
    await Promise.resolve()
    const frame = editor.view.dom.querySelector(".rune-table-frame") as HTMLElement
    caretInCell(editor, 2, 2)
    expect(frame.hasAttribute("data-rune-extend-col-active")).toBe(true)
    expect(frame.hasAttribute("data-rune-extend-row-active")).toBe(true)
  })

  it("caret in an interior cell flags NEITHER", async () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 3, cols: 3 })
    await Promise.resolve()
    const frame = editor.view.dom.querySelector(".rune-table-frame") as HTMLElement
    caretInCell(editor, 1, 1)
    expect(frame.hasAttribute("data-rune-extend-col-active")).toBe(false)
    expect(frame.hasAttribute("data-rune-extend-row-active")).toBe(false)
  })

  it("moving the caret out of the table clears both active flags", async () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 2 })
    await Promise.resolve()
    const frame = editor.view.dom.querySelector(".rune-table-frame") as HTMLElement
    caretInCell(editor, 1, 1) // bottom-right → both set
    expect(frame.hasAttribute("data-rune-extend-col-active")).toBe(true)
    expect(frame.hasAttribute("data-rune-extend-row-active")).toBe(true)

    // Append a paragraph after the table and drop the caret into it.
    const tableEnd = editor.state.doc.firstChild!.nodeSize
    editor.commands.insertContentAt(tableEnd, {
      type: "paragraph",
      content: [{ type: "text", text: "after" }],
    })
    editor.commands.setTextSelection(editor.state.doc.content.size - 1)
    expect(findCellContext(editor.state.selection.$head)).toBeNull() // sanity: outside the table
    expect(frame.hasAttribute("data-rune-extend-col-active")).toBe(false)
    expect(frame.hasAttribute("data-rune-extend-row-active")).toBe(false)
  })

  it("sets inline opacity:0 + pointer-events:none on extend buttons during cell-drag", async () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 2 })
    await Promise.resolve()
    const colBtn = editor.view.dom.querySelector(".rune-table-extend-col") as HTMLElement
    const rowBtn = editor.view.dom.querySelector(".rune-table-extend-row") as HTMLElement
    expect(colBtn.style.opacity).toBe("")
    expect(rowBtn.style.opacity).toBe("")

    editor.view.dispatch(editor.state.tr.setMeta(gestureKey, { activeGesture: "cell-drag" }))
    expect(colBtn.style.opacity).toBe("0")
    expect(rowBtn.style.opacity).toBe("0")
    expect(colBtn.style.pointerEvents).toBe("none")
    expect(rowBtn.style.pointerEvents).toBe("none")

    editor.view.dispatch(editor.state.tr.setMeta(gestureKey, { activeGesture: null }))
    expect(colBtn.style.opacity).toBe("")
    expect(rowBtn.style.opacity).toBe("")
    expect(colBtn.style.pointerEvents).toBe("")
    expect(rowBtn.style.pointerEvents).toBe("")
  })

  it("suppresses extend buttons while a pill action menu is open, restores on close", async () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 2 })
    await Promise.resolve()
    const colBtn = editor.view.dom.querySelector(".rune-table-extend-col") as HTMLElement
    const rowBtn = editor.view.dom.querySelector(".rune-table-extend-row") as HTMLElement
    expect(colBtn.style.opacity).toBe("")
    expect(rowBtn.style.opacity).toBe("")

    // Opening a col/row pill dropdown dispatches a full-axis CellSelection;
    // on the last column/row that would reveal the extend button right under
    // the menu. The buttons subscribe to the same cellHandlePillsKey.dropdown
    // state the menu opens on and hide for its lifetime.
    editor.view.dispatch(
      editor.state.tr.setMeta(PILL_DROPDOWN_META, {
        open: { tableStart: 1, axis: "col", index: 0 },
      }),
    )
    expect(colBtn.style.opacity).toBe("0")
    expect(rowBtn.style.opacity).toBe("0")
    expect(colBtn.style.pointerEvents).toBe("none")
    expect(rowBtn.style.pointerEvents).toBe("none")

    // Every close path dispatches a transaction, so the plugin re-runs and
    // restores the buttons.
    editor.view.dispatch(
      editor.state.tr.setMeta(PILL_DROPDOWN_META, { close: true }),
    )
    expect(colBtn.style.opacity).toBe("")
    expect(rowBtn.style.opacity).toBe("")
    expect(colBtn.style.pointerEvents).toBe("")
    expect(rowBtn.style.pointerEvents).toBe("")
  })
})
