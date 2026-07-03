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
import {
  CellHandlePills,
  PILL_ORIGIN_META,
  PILL_DROPDOWN_META,
  cellHandlePillsKey,
} from "./CellHandlePills"
import { CellSelection, TableMap } from "@tiptap/pm/tables"
import { gestureKey } from "../../extensions/shared/gesture-state"

let editor: Editor | null = null
function makeEditor() {
  editor = new Editor({
    element: document.createElement("div"),
    extensions: [
      Document, Text, Paragraph,
      Table,
      GestureStatePlugin,
      CellHandlePills,
    ],
  })
  return editor
}
afterEach(() => { editor?.destroy(); editor = null })

describe("CellHandlePills", () => {
  it("renders one column pill on the anchor column", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 3 })
    expect(editor.view.dom.querySelectorAll(".rune-col-pill").length).toBeGreaterThanOrEqual(1)
  })

  it("renders one row pill on the anchor row", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 3, cols: 2 })
    expect(editor.view.dom.querySelectorAll(".rune-row-pill").length).toBeGreaterThanOrEqual(1)
  })

  it("clicking a column pill produces a CellSelection spanning the column", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 3, cols: 3 })
    const pill = editor.view.dom.querySelector(".rune-col-pill") as HTMLElement
    pill.click()
    expect(editor.state.selection).toBeInstanceOf(CellSelection)
  })

  it("click sets pillOrigin meta on the dispatched transaction", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 2 })
    let saw = false
    const orig = editor.view.dispatch.bind(editor.view)
    editor.view.dispatch = (tr: any) => {
      if (tr.getMeta(PILL_ORIGIN_META)) saw = true
      orig(tr)
    }
    const pill = editor.view.dom.querySelector(".rune-row-pill") as HTMLElement
    pill.click()
    expect(saw).toBe(true)
  })

  it("STALE-POSITION REGRESSION: click works after content is inserted before the table", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 2 })
    // Insert a paragraph before the table to shift the table's document position.
    editor.commands.insertContentAt(0, { type: "paragraph", content: [{ type: "text", text: "hello" }] })
    // After the insertion the cursor is in the paragraph. Move it into the first
    // table cell so the pill decorations are rendered for the table.
    // The paragraph is doc[0] with nodeSize 7; the table starts at pos 7.
    // table(pos=7) → row(pos=8) → cell(pos=9) → content(pos=10)
    const paraNodeSize = editor.state.doc.firstChild!.nodeSize
    editor.commands.setTextSelection(paraNodeSize + 3) // into first cell content
    const pill = editor.view.dom.querySelector(".rune-col-pill") as HTMLElement
    if (!pill) throw new Error("Expected col pill to be rendered after setTextSelection into table cell")
    pill.click()
    expect(editor.state.selection).toBeInstanceOf(CellSelection)
    expect(editor.state.doc.firstChild!.type.name).toBe("paragraph")
    expect(editor.state.doc.maybeChild(1)?.type.name).toBe("table")
    // Strengthen: verify the selection resolves to the post-shift table, not a
    // stale position. The $anchorCell must live inside doc.maybeChild(1) (the
    // table — second top-level node after the inserted paragraph).
    const sel = editor.state.selection as CellSelection
    const anchorPos = sel.$anchorCell.pos
    const $anchor = editor.state.doc.resolve(anchorPos)
    // Walk up to find the table node.
    let tableNode: import("@tiptap/pm/model").Node | null = null
    for (let d = $anchor.depth; d >= 0; d--) {
      if ($anchor.node(d).type.name === "table") {
        tableNode = $anchor.node(d)
        break
      }
    }
    expect(tableNode).not.toBeNull()
    // The table found via $anchorCell must be the same node object as
    // doc.maybeChild(1) — proving the click resolved to the live (post-shift)
    // table and not a stale pre-insert position.
    expect(tableNode).toBe(editor.state.doc.maybeChild(1))
  })

  it("MULTI-TABLE: is-active toggled correctly when same-axis pill clicked on second table without intervening origin-clear", () => {
    const editor = makeEditor()
    // Insert two tables.
    editor.commands.insertTable({ rows: 2, cols: 2 })
    editor.commands.setTextSelection(editor.state.doc.content.size)
    editor.commands.insertTable({ rows: 3, cols: 3 })

    // Walk the doc to find both table positions.
    let table1Pos = -1, table2Pos = -1
    editor.state.doc.forEach((node, offset) => {
      if (node.type.name === "table") {
        if (table1Pos === -1) table1Pos = offset
        else if (table2Pos === -1) table2Pos = offset
      }
    })
    if (table1Pos === -1 || table2Pos === -1) throw new Error("Expected two tables in doc")

    // Helper: build a CellSelection for the first column of the table at
    // `tablePos` (position before the table node).
    function makeColSelection(tablePos: number) {
      const state = editor.state
      const tableNode = state.doc.nodeAt(tablePos)!
      const map = TableMap.get(tableNode)
      const tableStart = tablePos + 1
      // map.map[col + row*width] gives offset of the cell relative to tableStart.
      const topCellOffset = map.map[0] ?? 0
      const botCellOffset = map.map[(map.height - 1) * map.width + 0] ?? 0
      return new CellSelection(
        state.doc.resolve(tableStart + topCellOffset),
        state.doc.resolve(tableStart + botCellOffset),
      )
    }

    // Move cursor into table 1 so pills appear.
    editor.commands.setTextSelection(table1Pos + 4)
    const pill1 = editor.view.dom.querySelector<HTMLElement>(".rune-col-pill")
    if (!pill1) throw new Error("Expected col pill for table 1")

    // Dispatch origin="col" for table 1 (same as selectFullColumn would do).
    editor.view.dispatch(
      editor.state.tr
        .setSelection(makeColSelection(table1Pos))
        .setMeta(PILL_ORIGIN_META, "col"),
    )
    // pill1 should be is-active now.
    expect(pill1.classList.contains("is-active")).toBe(true)

    // Now, WITHOUT any intervening selection-clearing transaction, dispatch a
    // second CellSelection WITH PILL_ORIGIN_META="col" for table 2. This is
    // the bug scenario: origin stays "col", but the anchor table changes.
    // Without the lastFrame guard, sync() short-circuits (origin === lastOrigin)
    // and pill2 never gains is-active.
    editor.view.dispatch(
      editor.state.tr
        .setSelection(makeColSelection(table2Pos))
        .setMeta(PILL_ORIGIN_META, "col"),
    )

    // After the second dispatch the decorations now show pills for table 2
    // (anchor moved to table 2). pill1 is gone from the DOM; pill2 should exist.
    const pill2 = editor.view.dom.querySelector<HTMLElement>(".rune-col-pill")
    if (!pill2) throw new Error("Expected col pill for table 2 after second dispatch")
    // The active frame changed (table 2), but origin stayed "col". Without the
    // lastFrame guard, sync() short-circuits and pill2 never gains is-active.
    expect(pill2.classList.contains("is-active")).toBe(true)
  })

  it("does NOT render pills while a cell-drag gesture is active", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 2 })
    expect(editor.view.dom.querySelectorAll(".rune-col-pill, .rune-row-pill").length).toBeGreaterThan(0)
    editor.view.dispatch(editor.state.tr.setMeta(gestureKey, { activeGesture: "cell-drag" }))
    expect(editor.view.dom.querySelectorAll(".rune-col-pill, .rune-row-pill").length).toBe(0)
    editor.view.dispatch(editor.state.tr.setMeta(gestureKey, { activeGesture: null }))
    expect(editor.view.dom.querySelectorAll(".rune-col-pill, .rune-row-pill").length).toBeGreaterThan(0)
  })

  it("pill recreated after a cell-drag keeps is-active when origin survived (cancelled-drag restore)", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 2 })
    const pill = editor.view.dom.querySelector<HTMLElement>(".rune-col-pill")!
    pill.click()
    expect(pill.classList.contains("is-active")).toBe(true)
    // Drag claim suppresses the widget; origin stays sticky ("col").
    editor.view.dispatch(editor.state.tr.setMeta(gestureKey, { activeGesture: "cell-drag" }))
    expect(editor.view.dom.querySelector(".rune-col-pill")).toBeNull()
    // Drag ends (cancel path) with (origin, tableStart) unchanged — the
    // view-layer sync short-circuits, so the recreated widget must carry
    // is-active from the decoration factory itself.
    editor.view.dispatch(editor.state.tr.setMeta(gestureKey, { activeGesture: null }))
    const recreated = editor.view.dom.querySelector<HTMLElement>(".rune-col-pill")!
    expect(recreated.classList.contains("is-active")).toBe(true)
  })
})

describe("CellHandlePills — dropdown state", () => {
  it("first pill click sets dropdown { tableStart, axis: 'col', index } AND CellSelection", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 3 })
    const pill = editor.view.dom.querySelector<HTMLElement>(".rune-col-pill")!
    pill.click()
    const ps = cellHandlePillsKey.getState(editor.state)
    expect(ps?.dropdown).not.toBeNull()
    expect(ps?.dropdown?.axis).toBe("col")
    expect(ps?.dropdown?.index).toBe(Number(pill.dataset.col))
    expect(editor.state.selection).toBeInstanceOf(CellSelection)
  })

  it("re-clicking the same pill closes the dropdown but keeps the selection", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 3 })
    const pill = editor.view.dom.querySelector<HTMLElement>(".rune-col-pill")!
    pill.click()
    expect(cellHandlePillsKey.getState(editor.state)?.dropdown).not.toBeNull()
    pill.click()
    expect(cellHandlePillsKey.getState(editor.state)?.dropdown).toBeNull()
    expect(editor.state.selection).toBeInstanceOf(CellSelection)
  })

  it("clicking a different-axis pill re-opens dropdown at the new anchor", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 3, cols: 3 })
    const colPill = editor.view.dom.querySelector<HTMLElement>(".rune-col-pill")!
    colPill.click()
    const first = cellHandlePillsKey.getState(editor.state)?.dropdown
    expect(first?.axis).toBe("col")
    // Reset the selection so the suppressed cross-axis pill renders again
    // (full-col CellSelection hides .rune-row-pill via decorations()).
    editor.commands.setTextSelection(4)
    const rowPill = editor.view.dom.querySelector<HTMLElement>(".rune-row-pill")!
    rowPill.click()
    const second = cellHandlePillsKey.getState(editor.state)?.dropdown
    expect(second?.axis).toBe("row")
  })

  it("cell-drag gesture claim closes the dropdown", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 2 })
    const pill = editor.view.dom.querySelector<HTMLElement>(".rune-col-pill")!
    pill.click()
    expect(cellHandlePillsKey.getState(editor.state)?.dropdown).not.toBeNull()
    // Dragging the pill claims the gesture without moving the selection —
    // the dropdown must close, or its capture-phase Escape listener
    // (TableActionsDropdown) swallows the Escape meant for drag cancel.
    editor.view.dispatch(editor.state.tr.setMeta(gestureKey, { activeGesture: "cell-drag" }))
    expect(cellHandlePillsKey.getState(editor.state)?.dropdown).toBeNull()
  })

  it("selection change without PILL_ORIGIN_META auto-closes dropdown", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 2 })
    const pill = editor.view.dom.querySelector<HTMLElement>(".rune-col-pill")!
    pill.click()
    expect(cellHandlePillsKey.getState(editor.state)?.dropdown).not.toBeNull()
    // Move selection elsewhere — this transaction has no PILL_ORIGIN_META.
    editor.commands.setTextSelection(1)
    expect(cellHandlePillsKey.getState(editor.state)?.dropdown).toBeNull()
  })

  it("explicit close meta clears dropdown without touching selection", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 2 })
    const pill = editor.view.dom.querySelector<HTMLElement>(".rune-col-pill")!
    pill.click()
    const selBefore = editor.state.selection
    editor.view.dispatch(editor.state.tr.setMeta(PILL_DROPDOWN_META, { close: true }))
    expect(cellHandlePillsKey.getState(editor.state)?.dropdown).toBeNull()
    expect(editor.state.selection).toBe(selBefore)
  })

  it("doc-shift remaps tableStart; if remap lands outside any table, dropdown is cleared", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 2 })
    const pill = editor.view.dom.querySelector<HTMLElement>(".rune-col-pill")!
    pill.click()
    const before = cellHandlePillsKey.getState(editor.state)?.dropdown!
    // Insert a paragraph before the table to shift its position.
    editor.commands.insertContentAt(0, { type: "paragraph", content: [{ type: "text", text: "x" }] })
    const after = cellHandlePillsKey.getState(editor.state)?.dropdown
    expect(after).not.toBeNull()
    expect(after!.tableStart).toBeGreaterThan(before.tableStart)
  })
})
