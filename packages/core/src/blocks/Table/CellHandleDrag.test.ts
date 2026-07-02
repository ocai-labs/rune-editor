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
import { GestureStatePlugin, gestureKey } from "../../extensions/shared/gesture-state"
import { CellHandlePills } from "./CellHandlePills"
import { CellHandleDrag } from "./CellHandleDrag"
import { CellSelection } from "prosemirror-tables"

let editor: Editor | null = null
function makeEditor() {
  editor = new Editor({
    element: document.createElement("div"),
    extensions: [
      Document, Text, Paragraph,
      Table,
      GestureStatePlugin,
      CellHandlePills, CellHandleDrag,
    ],
  })
  return editor
}
afterEach(() => { editor?.destroy(); editor = null })

function downOnPill(pill: HTMLElement, x: number, y: number) {
  pill.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: x, clientY: y }))
}
function moveTo(x: number, y: number, buttons = 1) {
  document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: x, clientY: y, buttons }))
}
function upAt(x: number, y: number) {
  document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: x, clientY: y }))
}
async function flushMicrotasks() { await Promise.resolve() }

/** Returns the text content of every first-row cell, left to right. */
function firstRowCellTexts(editor: Editor): string[] {
  const table = editor.state.doc.firstChild
  if (!table || table.type.name !== "table") return []
  const firstRow = table.firstChild
  if (!firstRow) return []
  const texts: string[] = []
  for (let i = 0; i < firstRow.childCount; i++) {
    texts.push(firstRow.child(i).textContent)
  }
  return texts
}

/**
 * Inserts `text` into the first tableParagraph of the nth first-row cell
 * (0-indexed). The cell may be tableHeader or tableCell.
 */
function writeFirstRowCell(editor: Editor, colIdx: number, text: string) {
  const table = editor.state.doc.firstChild
  if (!table || table.type.name !== "table") return
  const firstRow = table.firstChild
  if (!firstRow || colIdx >= firstRow.childCount) return
  // Walk to the tableParagraph inside the target cell.
  let cellOffset = 1 // skip table's opening token
  let rowOffset = 1 // skip row's opening token
  for (let c = 0; c < colIdx; c++) rowOffset += firstRow.child(c).nodeSize
  // Position of the tableParagraph inside the cell: +1 for cell open, +1 for paragraph open
  const paraPos = 1 + cellOffset + rowOffset + 1
  const { tr, schema } = editor.state
  const textNode = schema.text(text)
  editor.view.dispatch(tr.insert(paraPos, textNode))
}

describe("CellHandleDrag — gesture ownership", () => {
  it("mousedown alone does not claim cell-drag", async () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 2 })
    await flushMicrotasks()
    const pill = editor.view.dom.querySelector(".rune-col-pill") as HTMLElement
    downOnPill(pill, 0, 0)
    expect(gestureKey.getState(editor.state)?.activeGesture).toBeNull()
  })

  it("pointer movement >4px claims cell-drag", async () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 2 })
    await flushMicrotasks()
    const pill = editor.view.dom.querySelector(".rune-col-pill") as HTMLElement
    downOnPill(pill, 0, 0)
    moveTo(10, 0)
    expect(gestureKey.getState(editor.state)?.activeGesture).toBe("cell-drag")
    upAt(10, 0)
  })

  it("below-threshold mouseup falls through to click-select", async () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 2 })
    await flushMicrotasks()
    const pill = editor.view.dom.querySelector(".rune-col-pill") as HTMLElement
    downOnPill(pill, 0, 0)
    moveTo(2, 0)
    upAt(2, 0)
    pill.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }))
    expect(editor.state.selection).toBeInstanceOf(CellSelection)
    expect(gestureKey.getState(editor.state)?.activeGesture).toBeNull()
  })

  it("refuses when block-drag is active", async () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 2 })
    await flushMicrotasks()
    editor.view.dispatch(editor.state.tr.setMeta(gestureKey, { activeGesture: "block-drag" }))
    const pill = editor.view.dom.querySelector(".rune-col-pill") as HTMLElement
    downOnPill(pill, 0, 0)
    moveTo(20, 0)
    expect(gestureKey.getState(editor.state)?.activeGesture).toBe("block-drag")
    // After refusal, listeners must be disarmed — a further mousemove must not
    // mutate the selection or the registry (GS-6: no listeners survive a refused claim).
    const selBefore = editor.state.selection
    moveTo(60, 0)
    expect(gestureKey.getState(editor.state)?.activeGesture).toBe("block-drag")
    expect(editor.state.selection).toBe(selBefore)
  })

  it("Escape cancels in-flight drag", async () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 2 })
    await flushMicrotasks()
    const pill = editor.view.dom.querySelector(".rune-col-pill") as HTMLElement
    downOnPill(pill, 0, 0)
    moveTo(20, 0)
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    expect(gestureKey.getState(editor.state)?.activeGesture).toBeNull()
  })
})

describe("CellHandleDrag — GS-2/AV-2 probes", () => {
  it("GS-2a: mousemove with buttons:0 after promotion aborts: registry released", async () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 2 })
    await flushMicrotasks()
    const pill = editor.view.dom.querySelector(".rune-col-pill") as HTMLElement
    // Establish a CellSelection as the pre-drag state
    downOnPill(pill, 0, 0)
    // Promote past threshold
    moveTo(10, 0)
    expect(gestureKey.getState(editor.state)?.activeGesture).toBe("cell-drag")
    // Now fire a mousemove with buttons: 0 (primary lost — e.g. alt-tab away mid-drag)
    document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 20, clientY: 0, buttons: 0 }))
    // Registry must be released
    expect(gestureKey.getState(editor.state)?.activeGesture).toBeNull()
    // Subsequent mousemove should not re-arm (listeners gone)
    document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 50, clientY: 0, buttons: 1 }))
    expect(gestureKey.getState(editor.state)?.activeGesture).toBeNull()
  })

  it("GS-2b: non-primary mouseup (button:2) during drag keeps gesture alive; primary mouseup ends it", async () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 2 })
    await flushMicrotasks()
    const pill = editor.view.dom.querySelector(".rune-col-pill") as HTMLElement
    downOnPill(pill, 0, 0)
    // Promote past threshold
    moveTo(10, 0)
    expect(gestureKey.getState(editor.state)?.activeGesture).toBe("cell-drag")
    // Right-button mouseup should NOT end the gesture
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 2, clientX: 10, clientY: 0 }))
    expect(gestureKey.getState(editor.state)?.activeGesture).toBe("cell-drag")
    // Primary mouseup ends it
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0, clientX: 10, clientY: 0 }))
    expect(gestureKey.getState(editor.state)?.activeGesture).toBeNull()
  })

  it("AV-2: setEditable(false) before primary mouseup prevents moveSlice (doc unchanged), registry released", async () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 3 })
    await flushMicrotasks()
    // Give first-row cells distinct text so a column move is detectable even
    // when the before/after cell positions happen to be byte-identical (empty
    // cells are indistinguishable — a move would pass without this content).
    writeFirstRowCell(editor, 0, "A")
    writeFirstRowCell(editor, 1, "B")
    writeFirstRowCell(editor, 2, "C")
    // Confirm text was written as expected before the drag.
    expect(firstRowCellTexts(editor)).toEqual(["A", "B", "C"])

    const pills = editor.view.dom.querySelectorAll<HTMLElement>(".rune-col-pill")
    // Drag col 0 far right so targetIdx resolves to col 2 — a real move.
    const pill = pills[0] as HTMLElement
    downOnPill(pill, 0, 0)
    moveTo(80, 0)
    expect(gestureKey.getState(editor.state)?.activeGesture).toBe("cell-drag")
    // Flip editor to read-only mid-drag
    editor.setEditable(false)
    // Primary mouseup — moveSlice must NOT run
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0, clientX: 80, clientY: 0 }))
    // Registry must be released
    expect(gestureKey.getState(editor.state)?.activeGesture).toBeNull()
    // Doc unchanged: cell TEXT order must be identical (A B C, not B C A)
    expect(firstRowCellTexts(editor)).toEqual(["A", "B", "C"])
  })
})

describe("CellHandleDrag — DOM ownership", () => {
  it("drop indicator mounts in .rune-table-frame, not document.body", async () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 2 })
    await flushMicrotasks()
    const pill = editor.view.dom.querySelector(".rune-col-pill") as HTMLElement
    downOnPill(pill, 0, 0)
    moveTo(20, 0)
    const indicatorInFrame = editor.view.dom.querySelector(".rune-table-frame .rune-table-drop-indicator")
    const indicatorInBody = document.body.querySelector(":scope > .rune-table-drop-indicator")
    expect(indicatorInFrame).not.toBeNull()
    expect(indicatorInBody).toBeNull()
    upAt(20, 0)
  })

  it("drag preview portals to document.body with .rune-editor cascade and contains <table><tbody>", async () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 2 })
    await flushMicrotasks()
    const pill = editor.view.dom.querySelector(".rune-col-pill") as HTMLElement
    downOnPill(pill, 0, 0)
    moveTo(20, 0)
    const previewInBody = document.body.querySelector(":scope > .rune-table-drag-preview")
    const previewInFrame = editor.view.dom.querySelector(".rune-table-frame .rune-table-drag-preview")
    expect(previewInBody).not.toBeNull()
    expect(previewInFrame).toBeNull()
    expect(previewInBody!.classList.contains("rune-editor")).toBe(true)
    expect(previewInBody!.querySelector("table > tbody")).not.toBeNull()
    upAt(20, 0)
  })

  it("drag preview table keeps the source table class so table CSS still applies", async () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 2 })
    await flushMicrotasks()
    const pill = editor.view.dom.querySelector(".rune-col-pill") as HTMLElement
    downOnPill(pill, 0, 0)
    moveTo(20, 0)
    const sourceTable = editor.view.dom.querySelector(".rune-table-frame table") as HTMLTableElement
    const previewTable = document.body.querySelector(".rune-table-drag-preview table") as HTMLTableElement
    expect(previewTable).not.toBeNull()
    for (const className of sourceTable.classList) {
      expect(previewTable.classList.contains(className)).toBe(true)
    }
    expect(previewTable.classList.contains("rune-table")).toBe(true)
    upAt(20, 0)
  })

  it("drag preview clone strips pills, resize handles, contenteditable", async () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 2 })
    await flushMicrotasks()
    const pill = editor.view.dom.querySelector(".rune-col-pill") as HTMLElement
    downOnPill(pill, 0, 0)
    moveTo(20, 0)
    const preview = document.body.querySelector(":scope > .rune-table-drag-preview") as HTMLElement
    expect(preview).not.toBeNull()
    expect(preview.querySelectorAll(".rune-col-pill, .rune-row-pill").length).toBe(0)
    expect(preview.querySelectorAll(".column-resize-handle").length).toBe(0)
    expect(preview.querySelectorAll("[contenteditable]").length).toBe(0)
    expect(preview.querySelectorAll("[data-id]").length).toBe(0)
    upAt(20, 0)
  })

})
