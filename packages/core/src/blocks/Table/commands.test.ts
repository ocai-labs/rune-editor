// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { afterEach, describe, it, expect, vi } from "vitest"
import { Editor } from "@tiptap/core"
import Document from "@tiptap/extension-document"
import Text from "@tiptap/extension-text"
import { CellSelection } from "@tiptap/pm/tables"
import { isTableHeaderRow, isTableHeaderColumn } from "./TableCommands"
import { TextSelection } from "@tiptap/pm/state"
import { Paragraph } from "../Paragraph/block"
import { Table } from "./block"
import { deleteTableWhenAllCellsSelected } from "./utilities/deleteTableWhenAllCellsSelected"
import { BlockTextColor, BlockBackgroundColor } from "../../extensions/color"
import { BLOCK_COLOR_TYPES } from "../../kit"

const editors = new Set<Editor>()

afterEach(() => {
  for (const editor of editors) {
    if (!editor.isDestroyed) editor.destroy()
  }
  editors.clear()
})

function makeEditor() {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: [
      Document,
      Text,
      Paragraph,
      Table,
    ],
  })
  editors.add(editor)
  return editor
}

function firstTableParagraphPos(editor: Editor) {
  let pos = -1
  editor.state.doc.descendants((node, nodePos) => {
    if (pos !== -1) return false
    if (node.type.name === "tableParagraph") {
      pos = nodePos + 1
      return false
    }
    return true
  })
  return pos
}

function lastTableParagraphPosInFirstTable(editor: Editor) {
  const table = editor.state.doc.firstChild
  if (!table || table.type.name !== "table") return -1

  let pos = -1
  table.descendants((node, nodePos) => {
    if (node.type.name === "tableParagraph") pos = 1 + nodePos + 1
    return true
  })
  return pos
}

function cellPositions(editor: Editor) {
  const positions: number[] = []
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "tableCell" || node.type.name === "tableHeader") positions.push(pos)
    return true
  })
  return positions
}

describe("Table commands", () => {
  it("insertTable() creates a default 3x3 table", () => {
    const editor = makeEditor()
    editor.commands.insertTable()
    const table = editor.state.doc.firstChild!
    expect(table.type.name).toBe("table")
    expect(table.childCount).toBe(3)
    expect(table.firstChild!.childCount).toBe(3)
    expect(table.firstChild!.firstChild!.type.name).toBe("tableHeader")
    expect(table.lastChild!.firstChild!.type.name).toBe("tableCell")
    expect(table.firstChild!.firstChild!.firstChild!.type.name).toBe("tableParagraph")
    editor.destroy()
  })

  it("insertTable({ rows: 4, cols: 2, withHeaderRow: false }) creates body-only table", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 4, cols: 2, withHeaderRow: false })
    const table = editor.state.doc.firstChild!
    expect(table.childCount).toBe(4)
    table.forEach((row) => {
      expect(row.childCount).toBe(2)
      row.forEach((cell) => expect(cell.type.name).toBe("tableCell"))
    })
    editor.destroy()
  })

  it("add/delete row and column commands update shape", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 2 })
    editor.commands.setTextSelection(firstTableParagraphPos(editor))
    expect(editor.commands.addTableRowAfter()).toBe(true)
    expect(editor.state.doc.firstChild!.childCount).toBe(3)
    expect(editor.commands.deleteTableRow()).toBe(true)
    expect(editor.state.doc.firstChild!.childCount).toBe(2)
    expect(editor.commands.addTableColumnAfter()).toBe(true)
    expect(editor.state.doc.firstChild!.firstChild!.childCount).toBe(3)
    expect(editor.commands.deleteTableColumn()).toBe(true)
    expect(editor.state.doc.firstChild!.firstChild!.childCount).toBe(2)
    editor.destroy()
  })

  it("deleteTable removes the whole table", () => {
    const editor = makeEditor()
    editor.commands.insertTable()
    editor.commands.setTextSelection(firstTableParagraphPos(editor))
    expect(editor.commands.deleteTable()).toBe(true)
    expect(editor.state.doc.firstChild?.type.name).not.toBe("table")
    editor.destroy()
  })

  it("Backspace keyboard shortcut deletes the table when all cells are selected", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 2 })
    const [first, , , last] = cellPositions(editor)
    expect(first).toBeDefined()
    expect(last).toBeDefined()

    expect(editor.commands.setTableCellSelection({ anchorCell: first!, headCell: last! })).toBe(true)

    expect(editor.commands.keyboardShortcut("Backspace")).toBe(true)
    expect(editor.state.doc.firstChild?.type.name).not.toBe("table")
    editor.destroy()
  })

  it("Delete keyboard shortcut deletes the table when all cells are selected", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 2 })
    const [first, , , last] = cellPositions(editor)
    expect(first).toBeDefined()
    expect(last).toBeDefined()

    expect(editor.commands.setTableCellSelection({ anchorCell: first!, headCell: last! })).toBe(true)

    expect(editor.commands.keyboardShortcut("Delete")).toBe(true)
    expect(editor.state.doc.firstChild?.type.name).not.toBe("table")
    editor.destroy()
  })

  it("Backspace keyboard shortcut deletes the table when all cells are selected in reverse order", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 2 })
    const [first, , , last] = cellPositions(editor)
    expect(first).toBeDefined()
    expect(last).toBeDefined()

    expect(editor.commands.setTableCellSelection({ anchorCell: last!, headCell: first! })).toBe(true)

    expect(editor.commands.keyboardShortcut("Backspace")).toBe(true)
    expect(editor.state.doc.firstChild?.type.name).not.toBe("table")
    editor.destroy()
  })

  it("Delete keyboard shortcut deletes a 1x2 table when both cells are selected", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 1, cols: 2, withHeaderRow: false })
    const [first, last] = cellPositions(editor)
    expect(first).toBeDefined()
    expect(last).toBeDefined()

    expect(editor.commands.setTableCellSelection({ anchorCell: first!, headCell: last! })).toBe(true)

    expect(editor.commands.keyboardShortcut("Delete")).toBe(true)
    expect(editor.state.doc.firstChild?.type.name).not.toBe("table")
    editor.destroy()
  })

  it("utility deleteTableWhenAllCellsSelected returns false for one selected cell", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 2 })
    const [first] = cellPositions(editor)
    expect(first).toBeDefined()

    expect(editor.commands.setTableCellSelection({ anchorCell: first! })).toBe(true)

    expect(deleteTableWhenAllCellsSelected({ editor })).toBe(false)
    expect(editor.state.doc.firstChild?.type.name).toBe("table")
    editor.destroy()
  })

  it("Delete keyboard shortcut keeps the table when only one cell is selected", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 2 })
    const [first] = cellPositions(editor)
    expect(first).toBeDefined()

    expect(editor.commands.setTableCellSelection({ anchorCell: first! })).toBe(true)

    editor.commands.keyboardShortcut("Delete")
    expect(editor.state.doc.firstChild?.type.name).toBe("table")
    editor.destroy()
  })

  it("goToNextTableCell and goToPreviousTableCell move the selection", () => {
    const editor = makeEditor()
    editor.commands.insertTable()
    editor.commands.setTextSelection(firstTableParagraphPos(editor))
    expect(editor.commands.goToNextTableCell()).toBe(true)
    const after = editor.state.selection.from
    expect(editor.commands.goToPreviousTableCell()).toBe(true)
    expect(editor.state.selection.from).toBeLessThan(after)
    editor.destroy()
  })

  it("Tab at final cell adds a row and advances", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 1, cols: 1, withHeaderRow: false })
    editor.commands.setTextSelection(firstTableParagraphPos(editor))
    const before = editor.state.selection.from
    expect(editor.commands.keyboardShortcut("Tab")).toBe(true)
    expect(editor.state.doc.firstChild!.childCount).toBe(2)

    const $from = editor.state.doc.resolve(editor.state.selection.from)
    expect(editor.state.selection.from).toBeGreaterThanOrEqual(before)
    expect($from.parent.type.name).toBe("tableParagraph")
    expect($from.node($from.depth - 1).type.name).toBe("tableCell")
    expect($from.node($from.depth - 2).eq(editor.state.doc.firstChild!.lastChild!)).toBe(true)
    editor.destroy()
  })

  it("Tab at final cell only grows the current table", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 1, cols: 1, withHeaderRow: false })
    editor.commands.insertTable({ rows: 1, cols: 1, withHeaderRow: false })
    editor.commands.setTextSelection(lastTableParagraphPosInFirstTable(editor))

    expect(editor.commands.keyboardShortcut("Tab")).toBe(true)
    expect(editor.state.doc.firstChild!.childCount).toBe(2)
    expect(editor.state.doc.childCount).toBe(2)

    const $from = editor.state.doc.resolve(editor.state.selection.from)
    expect($from.node($from.depth - 1).type.name).toBe("tableCell")
    expect($from.node($from.depth - 2).eq(editor.state.doc.firstChild!.lastChild!)).toBe(true)
    expect($from.node($from.depth - 3).type.name).toBe("table")
    expect($from.node($from.depth - 3).eq(editor.state.doc.firstChild!)).toBe(true)
    editor.destroy()
  })

  it("Tab at the final cell of the default 2x3 table adds a row", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 3 })

    let lastParagraphPos = -1
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "tableParagraph") lastParagraphPos = pos + 1
      return true
    })

    expect(lastParagraphPos).toBeGreaterThan(-1)
    editor.commands.setTextSelection(lastParagraphPos)
    editor.commands.insertContent("last")

    expect(editor.commands.keyboardShortcut("Tab")).toBe(true)
    expect(editor.state.doc.firstChild!.childCount).toBe(3)

    const $from = editor.state.doc.resolve(editor.state.selection.from)
    expect($from.parent.type.name).toBe("tableParagraph")
    expect($from.node($from.depth - 1).type.name).toBe("tableCell")
    expect($from.node($from.depth - 2).type.name).toBe("tableRow")
    expect($from.node($from.depth - 3).type.name).toBe("table")
    expect($from.node($from.depth - 3).eq(editor.state.doc.firstChild!)).toBe(true)
    editor.destroy()
  })

  it("does not register merged-cell commands", () => {
    const editor = makeEditor()
    expect("mergeCells" in editor.commands).toBe(false)
    expect("splitCell" in editor.commands).toBe(false)
    expect("mergeOrSplit" in editor.commands).toBe(false)
    editor.destroy()
  })

  it("fitTableToWidth writes pixel colwidths summing to the measured block-content width", () => {
    // One-shot, NOT sticky: the command measures the table's specific
    // `.rune-block-content` clientWidth at call time and writes absolute
    // pixel `colwidth` into every cell. No fitWidth attr anywhere — the
    // table behaves like any other fixed-width table after this.
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 3, withHeaderRow: false })

    // Resolve the table pos and stub its NodeView's `.rune-block-content`
    // clientWidth so jsdom (which returns 0) reports a usable measurement.
    let tablePos = -1
    editor.state.doc.descendants((node, pos) => {
      if (tablePos !== -1) return false
      if (node.type.name === "table") {
        tablePos = pos
        return false
      }
      return true
    })
    expect(tablePos).toBeGreaterThan(-1)
    const tableDom = editor.view.nodeDOM(tablePos) as HTMLElement
    // jsdom returns 0 for clientWidth; spy on querySelector to hand back
    // a synthetic block-content node with a controlled width.
    vi.spyOn(tableDom, "querySelector").mockImplementation((selector: string) => {
      if (selector === ":scope > .rune-block-content") {
        return { clientWidth: 600 } as unknown as HTMLElement
      }
      return null
    })

    expect(editor.commands.fitTableToWidth(tablePos)).toBe(true)

    // 600 / 3 = 200 px per col, written into every cell across both rows.
    const newTable = editor.state.doc.nodeAt(tablePos)!
    newTable.forEach((row) => {
      expect(row.childCount).toBe(3)
      row.forEach((cell) => {
        expect(cell.attrs.colwidth).toEqual([200])
      })
    })
    // And — load-bearing — no fitWidth attr survives on the table.
    expect("fitWidth" in newTable.attrs).toBe(false)
    editor.destroy()
  })

  it("fitTableToWidth bails when the block-content width is unmeasurable (SSR / pre-mount)", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 3 })
    let tablePos = -1
    editor.state.doc.descendants((node, pos) => {
      if (tablePos !== -1) return false
      if (node.type.name === "table") {
        tablePos = pos
        return false
      }
      return true
    })
    const tableDom = editor.view.nodeDOM(tablePos) as HTMLElement
    vi.spyOn(tableDom, "querySelector").mockImplementation(() => null)
    expect(editor.commands.fitTableToWidth(tablePos)).toBe(false)
    editor.destroy()
  })
})

// Invoke ONLY the TableCommands extension's own keyboard shortcut for `key`.
// We don't want Tiptap's default baseKeymap (Enter→splitBlock) to mask the
// handler's own return value — assertions here pin TableCommands' contract,
// not the full editor chain. Real-keymap behavior is covered by e2e (Task 9).
// Shift-Enter and Mod-Enter ARE bound by TableCommands (#21 — a hardBreak
// must never land in a cell; both always split the tableParagraph instead,
// matching Enter's own semantics) — see "Shift/Mod-Enter in cell" below.
function pressKeyDown(
  editor: Editor,
  key: string,
  opts: { shiftKey?: boolean; modKey?: boolean } = {},
): boolean {
  const lookup = opts.modKey ? `Mod-${key}` : opts.shiftKey ? `Shift-${key}` : key
  const ext = editor.extensionManager.extensions.find((e) => e.name === "tableCommands")
  if (!ext) throw new Error("tableCommands extension not found")
  const shortcuts = (ext.config.addKeyboardShortcuts as (() => Record<string, () => boolean>) | undefined)?.call({
    editor,
    type: ext,
    options: ext.options,
    storage: ext.storage,
    parent: undefined,
  } as unknown as ThisParameterType<NonNullable<typeof ext.config.addKeyboardShortcuts>>)
  const handler = shortcuts?.[lookup]
  if (!handler) return false
  return handler()
}

function moveToFirstParagraphAtRow(editor: Editor, row: number): void {
  let firstCellOfRow: number | null = null
  let rowIdx = 0
  editor.state.doc.descendants((node, p) => {
    if (node.type.name === "tableRow") {
      if (rowIdx === row) firstCellOfRow = p
      rowIdx += 1
    }
  })
  if (firstCellOfRow == null) throw new Error(`no row ${row}`)
  let pos = -1
  editor.state.doc.descendants((node, p) => {
    if (pos !== -1) return false
    if (p < firstCellOfRow!) return true
    if (node.type.name === "tableParagraph") {
      pos = p + 1
      return false
    }
    return true
  })
  editor.commands.setTextSelection(pos)
}

describe("TableCommands — Enter in cell", () => {
  it("Enter inside a cell moves caret to next-row same-column", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 3, cols: 2 })
    moveToFirstParagraphAtRow(editor, 0)
    const handled = pressKeyDown(editor, "Enter")
    expect(handled).toBe(true)
    const $head = editor.state.selection.$head
    let inRow = -1
    let rowCount = 0
    editor.state.doc.descendants((node, p) => {
      if (node.type.name === "tableRow") {
        if (p <= $head.pos && $head.pos <= p + node.nodeSize) inRow = rowCount
        rowCount += 1
      }
    })
    expect(inRow).toBe(1)
    editor.destroy()
  })

  it("Enter on last row is consumed and produces no doc change", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 2 })
    moveToFirstParagraphAtRow(editor, 1)
    const docBefore = editor.state.doc
    const handled = pressKeyDown(editor, "Enter")
    expect(handled).toBe(true)
    expect(editor.state.doc.eq(docBefore)).toBe(true)
    editor.destroy()
  })

  it("Enter outside any table returns false (handler falls through)", () => {
    const editor = makeEditor()
    const handled = pressKeyDown(editor, "Enter")
    expect(handled).toBe(false)
    editor.destroy()
  })

  it("Shift+Enter inside a cell splits the tableParagraph (never inserts a hardBreak)", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 2 })
    moveToFirstParagraphAtRow(editor, 0)
    editor.commands.insertContent("ab")
    // Caret at the START of "ab" — splitting here yields an empty "before"
    // paragraph and "ab" as the "after" paragraph.
    editor.commands.setTextSelection(firstTableParagraphPos(editor))
    const before = cellPositions(editor).length
    const handled = pressKeyDown(editor, "Enter", { shiftKey: true })
    expect(handled).toBe(true)
    // Split the cell's ONE tableParagraph into two — no hardBreak, cell
    // count (table shape) unchanged.
    expect(cellPositions(editor).length).toBe(before)
    let hardBreaks = 0
    let paraTexts: string[] = []
    editor.state.doc.descendants((node) => {
      if (node.type.name === "hardBreak") hardBreaks += 1
      if (node.type.name === "tableParagraph") paraTexts.push(node.textContent)
      return true
    })
    expect(hardBreaks).toBe(0)
    expect(paraTexts[0]).toBe("")
    expect(paraTexts[1]).toBe("ab")
    editor.destroy()
  })

  it("Mod+Enter inside a cell also splits the tableParagraph (never inserts a hardBreak)", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 2 })
    moveToFirstParagraphAtRow(editor, 0)
    editor.commands.insertContent("ab")
    editor.commands.setTextSelection(firstTableParagraphPos(editor))
    const handled = pressKeyDown(editor, "Enter", { modKey: true })
    expect(handled).toBe(true)
    let hardBreaks = 0
    editor.state.doc.descendants((node) => {
      if (node.type.name === "hardBreak") hardBreaks += 1
      return true
    })
    expect(hardBreaks).toBe(0)
    editor.destroy()
  })

  it("Shift+Enter outside any cell returns false (handler falls through)", () => {
    const editor = makeEditor()
    const handled = pressKeyDown(editor, "Enter", { shiftKey: true })
    expect(handled).toBe(false)
    editor.destroy()
  })

  it("non-collapsed in-cell selection: Enter collapses + moves to next row", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 3, cols: 2 })
    moveToFirstParagraphAtRow(editor, 0)
    editor.commands.insertContent("abcd")
    const $head = editor.state.selection.$head
    const para = $head.parent
    const start = $head.start()
    const end = start + para.content.size
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, start, end)))
    const handled = pressKeyDown(editor, "Enter")
    expect(handled).toBe(true)
    expect(editor.state.selection.empty).toBe(true)
    editor.destroy()
  })

  it("multi-cell CellSelection: Enter falls through (handler returns false)", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 2 })
    let firstCell = -1
    let secondCell = -1
    editor.state.doc.descendants((node, p) => {
      const role = node.type.spec.tableRole
      if (role === "cell" || role === "header_cell") {
        if (firstCell === -1) firstCell = p
        else if (secondCell === -1) secondCell = p
      }
    })
    const $a = editor.state.doc.resolve(firstCell)
    const $b = editor.state.doc.resolve(secondCell)
    editor.view.dispatch(editor.state.tr.setSelection(new CellSelection($a, $b)))
    const docBefore = editor.state.doc
    const handled = pressKeyDown(editor, "Enter")
    expect(handled).toBe(false)
    expect(editor.state.doc.eq(docBefore)).toBe(true)
    editor.destroy()
  })
})

function makeIntegrationEditor() {
  return new Editor({
    element: document.createElement("div"),
    extensions: [
      Document,
      Text,
      Paragraph,
      Table,
    ],
  })
}

describe("TableCommands + TableMouseSelection — integration (no cross-channel coupling)", () => {
  it("Enter still moves to next-row same-column when TableMouseSelection is loaded", () => {
    const editor = makeIntegrationEditor()
    editor.commands.insertTable({ rows: 3, cols: 2 })
    moveToFirstParagraphAtRow(editor, 0)
    const handled = pressKeyDown(editor, "Enter")
    expect(handled).toBe(true)
    const $head = editor.state.selection.$head
    let inRow = -1
    let rowCount = 0
    editor.state.doc.descendants((node, p) => {
      if (node.type.name === "tableRow") {
        if (p <= $head.pos && $head.pos <= p + node.nodeSize) inRow = rowCount
        rowCount += 1
      }
    })
    expect(inRow).toBe(1)
    editor.destroy()
  })

  it("multi-cell CellSelection + Enter: handler returns false, doc unchanged", () => {
    const editor = makeIntegrationEditor()
    editor.commands.insertTable({ rows: 2, cols: 2 })
    let firstCell = -1
    let secondCell = -1
    editor.state.doc.descendants((node, p) => {
      const role = node.type.spec.tableRole
      if (role === "cell" || role === "header_cell") {
        if (firstCell === -1) firstCell = p
        else if (secondCell === -1) secondCell = p
      }
    })
    editor.view.dispatch(
      editor.state.tr.setSelection(
        new CellSelection(editor.state.doc.resolve(firstCell), editor.state.doc.resolve(secondCell)),
      ),
    )
    const docBefore = editor.state.doc
    const handled = pressKeyDown(editor, "Enter")
    expect(handled).toBe(false)
    expect(editor.state.doc.eq(docBefore)).toBe(true)
    editor.destroy()
  })

  it("programmatic cross-cell TextSelection is NOT coerced (no global normalizer in c1)", () => {
    const editor = makeIntegrationEditor()
    editor.commands.insertTable({ rows: 2, cols: 2 })
    let a = -1
    let b = -1
    editor.state.doc.descendants((node, p) => {
      if (node.type.name === "tableParagraph") {
        if (a === -1) a = p + 1
        else if (b === -1) b = p + 1
      }
    })
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, a, b)))
    expect(editor.state.selection).toBeInstanceOf(TextSelection)
    editor.destroy()
  })

  it("outside-table ↔ inside-table TextSelection is not coerced", () => {
    const editor = makeIntegrationEditor()
    editor.commands.insertContent("hello")
    editor.commands.insertTable({ rows: 2, cols: 2 })
    const outside = 1
    let insideCell = -1
    editor.state.doc.descendants((node, p) => {
      if (insideCell === -1 && node.type.name === "tableParagraph") insideCell = p + 1
    })
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, outside, insideCell)))
    expect(editor.state.selection).toBeInstanceOf(TextSelection)
    editor.destroy()
  })

  it("same-table cross-cell TextSelection + Enter: handler swallows (returns true, doc unchanged)", () => {
    const editor = makeIntegrationEditor()
    editor.commands.insertTable({ rows: 2, cols: 2 })
    let a = -1
    let b = -1
    editor.state.doc.descendants((node, p) => {
      if (node.type.name === "tableParagraph") {
        if (a === -1) a = p + 1
        else if (b === -1) b = p + 1
      }
    })
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, a, b)))
    const docBefore = editor.state.doc
    const handled = pressKeyDown(editor, "Enter")
    expect(handled).toBe(true)
    expect(editor.state.doc.eq(docBefore)).toBe(true)
    editor.destroy()
  })

  it("outside-table ↔ inside-cell TextSelection + Enter: handler swallows (returns true, doc unchanged)", () => {
    // PM's view layer clamps any TextSelection whose endpoints straddle a
    // tableCell (isolating: true) boundary back into the leading textblock,
    // so we can't drive this through editor.view.dispatch in jsdom. The
    // defensive guard exists precisely for these clamp-resistant programmatic
    // ranges (e.g., a future MBS-style normalizer dispatching across tables,
    // or any extension calling tr.setSelection without going through view).
    // Probe the handler by invoking the addKeyboardShortcuts() Enter
    // function directly with a synthetic editor whose state.selection has
    // exactly one endpoint inside a cell.
    const editor = makeIntegrationEditor()
    editor.commands.insertContent("hello")
    editor.commands.insertTable({ rows: 2, cols: 2 })
    const outside = 1
    let insideCell = -1
    editor.state.doc.descendants((node, p) => {
      if (insideCell === -1 && node.type.name === "tableParagraph") insideCell = p + 1
    })
    const $a = editor.state.doc.resolve(outside)
    const $b = editor.state.doc.resolve(insideCell)
    const crossSel = new TextSelection($a, $b)
    const ext = editor.extensionManager.extensions.find((e) => e.name === "tableCommands")
    if (!ext) throw new Error("tableCommands extension not found")
    const dispatched: unknown[] = []
    const fakeState = { ...editor.state, selection: crossSel, tr: editor.state.tr }
    Object.setPrototypeOf(fakeState, Object.getPrototypeOf(editor.state))
    const fakeEditor = {
      state: fakeState,
      view: { dispatch: (tr: unknown) => dispatched.push(tr) },
    }
    const shortcuts = (
      ext.config.addKeyboardShortcuts as () => Record<string, () => boolean>
    ).call({
      editor: fakeEditor,
      type: ext,
      options: ext.options,
      storage: ext.storage,
      parent: undefined,
    } as unknown as ThisParameterType<NonNullable<typeof ext.config.addKeyboardShortcuts>>)
    expect(shortcuts.Enter!()).toBe(true)
    expect(dispatched).toHaveLength(0)
    editor.destroy()
  })

  it("entirely-outside TextSelection + Enter: handler falls through (returns false)", () => {
    const editor = makeIntegrationEditor()
    editor.commands.insertContent("hello world")
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 6)))
    const handled = pressKeyDown(editor, "Enter")
    expect(handled).toBe(false)
    editor.destroy()
  })
})

// Helpers for axis selection in duplicate/clear tests.
import { TableMap } from "@tiptap/pm/tables"

function selectFullColumnAt(editor: Editor, col: number): boolean {
  const tableNode = editor.state.doc.firstChild!
  const map = TableMap.get(tableNode)
  const tableStart = 1 // table is doc.firstChild → starts at pos 1
  const top = tableStart + map.map[0 * map.width + col]!
  const bottom = tableStart + map.map[(map.height - 1) * map.width + col]!
  return editor.commands.setTableCellSelection({ anchorCell: top, headCell: bottom })
}

function selectFullRowAt(editor: Editor, row: number): boolean {
  const tableNode = editor.state.doc.firstChild!
  const map = TableMap.get(tableNode)
  const tableStart = 1
  const left = tableStart + map.map[row * map.width + 0]!
  const right = tableStart + map.map[row * map.width + (map.width - 1)]!
  return editor.commands.setTableCellSelection({ anchorCell: left, headCell: right })
}

describe("duplicateTableColumn / duplicateTableRow / clearTableColumn / clearTableRow", () => {
  it("duplicateTableColumn copies the source column's cell content into a new column to its right", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 2 })
    // Type into cell (0, 0) — first header cell.
    editor.commands.setTextSelection(firstTableParagraphPos(editor))
    editor.commands.insertContent("hello")
    expect(selectFullColumnAt(editor, 0)).toBe(true)
    expect(editor.commands.duplicateTableColumn()).toBe(true)
    const table = editor.state.doc.firstChild!
    expect(table.firstChild!.childCount).toBe(3) // 2 + 1 inserted
    // Original column (col 0) and duplicated column (col 1) both have "hello"
    expect(table.firstChild!.child(0).textContent).toBe("hello")
    expect(table.firstChild!.child(1).textContent).toBe("hello")
    editor.destroy()
  })

  it("duplicateTableRow copies the source row's cells into a new row below", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: false })
    editor.commands.setTextSelection(firstTableParagraphPos(editor))
    editor.commands.insertContent("hi")
    expect(selectFullRowAt(editor, 0)).toBe(true)
    expect(editor.commands.duplicateTableRow()).toBe(true)
    const table = editor.state.doc.firstChild!
    expect(table.childCount).toBe(3) // 2 + 1 inserted
    expect(table.child(0).child(0).textContent).toBe("hi")
    expect(table.child(1).child(0).textContent).toBe("hi")
    editor.destroy()
  })

  it("clearTableColumn empties every cell in the selected column", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: false })
    editor.commands.setTextSelection(firstTableParagraphPos(editor))
    editor.commands.insertContent("keep")
    // Move to second cell and add text we want cleared.
    const cells = cellPositions(editor)
    editor.commands.setTextSelection(cells[2]! + 2)
    editor.commands.insertContent("gone")
    expect(selectFullColumnAt(editor, 0)).toBe(true)
    expect(editor.commands.clearTableColumn()).toBe(true)
    const table = editor.state.doc.firstChild!
    expect(table.child(0).child(0).textContent).toBe("")
    expect(table.child(1).child(0).textContent).toBe("")
    editor.destroy()
  })

  it("clearTableRow empties every cell in the selected row", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: false })
    editor.commands.setTextSelection(firstTableParagraphPos(editor))
    editor.commands.insertContent("a")
    expect(selectFullRowAt(editor, 0)).toBe(true)
    expect(editor.commands.clearTableRow()).toBe(true)
    const table = editor.state.doc.firstChild!
    expect(table.child(0).child(0).textContent).toBe("")
    expect(table.child(0).child(1).textContent).toBe("")
    editor.destroy()
  })

  it("duplicate/clear return false on non-CellSelection", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 2 })
    editor.commands.setTextSelection(firstTableParagraphPos(editor))
    expect(editor.commands.duplicateTableColumn()).toBe(false)
    expect(editor.commands.duplicateTableRow()).toBe(false)
    expect(editor.commands.clearTableColumn()).toBe(false)
    expect(editor.commands.clearTableRow()).toBe(false)
    editor.destroy()
  })

  it("duplicateTableColumn rejects whole-table CellSelection (not single full column)", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 2 })
    const [first, , , last] = cellPositions(editor)
    expect(editor.commands.setTableCellSelection({ anchorCell: first!, headCell: last! })).toBe(true)
    expect(editor.commands.duplicateTableColumn()).toBe(false)
    expect(editor.commands.duplicateTableRow()).toBe(false)
    editor.destroy()
  })
})

// ─── Cell-color command tests (Task 3 — M8.4e-e) ────────────────────────────
// Uses a separate setupWithColors() helper so the existing makeEditor() tests
// are untouched. The color extensions MUST be registered here — without them,
// cell.attrs.backgroundColor is `undefined`, not `null`, and assertions would
// pass for the wrong reason.

function setupWithColors() {
  return new Editor({
    element: document.createElement("div"),
    extensions: [
      Document,
      Text,
      Paragraph,
      Table,
      BlockTextColor.configure({ types: [...BLOCK_COLOR_TYPES] }),
      BlockBackgroundColor.configure({ types: [...BLOCK_COLOR_TYPES] }),
    ],
  })
}

describe("TableCommands — cell color (column)", () => {
  it("setTableColumnBackgroundColor colors every cell in a column", () => {
    const editor = setupWithColors()
    editor.commands.insertTable({ rows: 2, cols: 3, withHeaderRow: false })

    // Locate the table and capture its tableStart (start-of-content position).
    let tableStart = -1
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "table") {
        tableStart = pos + 1
        return false
      }
      return true
    })
    expect(tableStart).toBeGreaterThan(0)

    expect(
      editor.commands.setTableColumnBackgroundColor({
        tableStart, colIndex: 1, name: "blue",
      }),
    ).toBe(true)

    // All cells in column 1 should carry backgroundColor="blue"; cells in
    // columns 0 and 2 should remain null.
    const colorsByCol: Array<Array<unknown>> = [[], [], []]
    editor.state.doc.descendants((node) => {
      if (node.type.name !== "tableRow") return true
      node.forEach((cell, _offset, cellIndex) => {
        colorsByCol[cellIndex]!.push(cell.attrs.backgroundColor)
      })
      return false
    })
    expect(colorsByCol[0]!.every((c) => c === null)).toBe(true)
    expect(colorsByCol[1]!.every((c) => c === "blue")).toBe(true)
    expect(colorsByCol[2]!.every((c) => c === null)).toBe(true)

    editor.destroy()
  })

  it("setTableColumnTextColor with name 'default' stores null", () => {
    const editor = setupWithColors()
    editor.commands.insertTable({ rows: 1, cols: 2, withHeaderRow: false })
    let tableStart = -1
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "table") { tableStart = pos + 1; return false }
      return true
    })
    editor.commands.setTableColumnTextColor({ tableStart, colIndex: 0, name: "red" })
    editor.commands.setTableColumnTextColor({ tableStart, colIndex: 0, name: "default" })

    let cellTextColor: unknown = "unset"
    editor.state.doc.descendants((node) => {
      if (node.type.name === "tableCell" && cellTextColor === "unset") {
        cellTextColor = node.attrs.textColor
        return false
      }
      return true
    })
    expect(cellTextColor).toBeNull()

    editor.destroy()
  })

  it("setTableColumnBackgroundColor returns false for an invalid tableStart", () => {
    const editor = setupWithColors()
    editor.commands.insertTable({ rows: 1, cols: 1 })
    expect(
      editor.commands.setTableColumnBackgroundColor({
        tableStart: 999_999, colIndex: 0, name: "blue",
      }),
    ).toBe(false)
    editor.destroy()
  })
})

describe("TableCommands — cell color (row)", () => {
  it("setTableRowBackgroundColor colors every cell in a row", () => {
    const editor = setupWithColors()
    editor.commands.insertTable({ rows: 3, cols: 2, withHeaderRow: false })
    let tableStart = -1
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "table") { tableStart = pos + 1; return false }
      return true
    })
    expect(
      editor.commands.setTableRowBackgroundColor({
        tableStart, rowIndex: 1, name: "green",
      }),
    ).toBe(true)

    const colorsByRow: Array<Array<unknown>> = [[], [], []]
    let rowIdx = 0
    editor.state.doc.descendants((node) => {
      if (node.type.name !== "tableRow") return true
      node.forEach((cell) => colorsByRow[rowIdx]!.push(cell.attrs.backgroundColor))
      rowIdx++
      return false
    })
    expect(colorsByRow[0]!.every((c) => c === null)).toBe(true)
    expect(colorsByRow[1]!.every((c) => c === "green")).toBe(true)
    expect(colorsByRow[2]!.every((c) => c === null)).toBe(true)

    editor.destroy()
  })

  it("setTableRowTextColor colors every cell in a row", () => {
    const editor = setupWithColors()
    editor.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: false })
    let tableStart = -1
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "table") { tableStart = pos + 1; return false }
      return true
    })
    editor.commands.setTableRowTextColor({ tableStart, rowIndex: 0, name: "purple" })

    const colorsByRow: Array<Array<unknown>> = [[], []]
    let rowIdx = 0
    editor.state.doc.descendants((node) => {
      if (node.type.name !== "tableRow") return true
      node.forEach((cell) => colorsByRow[rowIdx]!.push(cell.attrs.textColor))
      rowIdx++
      return false
    })
    expect(colorsByRow[0]!.every((c) => c === "purple")).toBe(true)
    expect(colorsByRow[1]!.every((c) => c === null)).toBe(true)

    editor.destroy()
  })
})

describe("Table header helpers", () => {
  it("isTableHeaderRow: true when every cell in the row is tableHeader", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 3 })
    const table = editor.state.doc.firstChild!
    expect(isTableHeaderRow(table, 0)).toBe(true)
    expect(isTableHeaderRow(table, 1)).toBe(false)
  })

  it("isTableHeaderRow: false when row is mixed cell/header", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 3 })
    // Flip the first cell of row 0 to tableCell, leave the rest as header.
    const table0 = editor.state.doc.firstChild!
    const map = TableMap.get(table0)
    const tableNodePos = 0 // doc position of the table node
    const tableStart = tableNodePos + 1
    const firstCellPos = tableStart + map.map[0]!
    const tr = editor.state.tr
    const cellNode = editor.state.doc.nodeAt(firstCellPos)!
    tr.setNodeMarkup(firstCellPos, editor.schema.nodes.tableCell!, cellNode.attrs, cellNode.marks)
    editor.view.dispatch(tr)
    const table1 = editor.state.doc.firstChild!
    expect(isTableHeaderRow(table1, 0)).toBe(false)
  })

  it("isTableHeaderColumn: true when every cell in column 0 is tableHeader", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 3 })
    const table = editor.state.doc.firstChild!
    // Default content has only row 0 as header, so col 0 has [header, cell] — not all-header.
    expect(isTableHeaderColumn(table, 0)).toBe(false)
  })

  it("isTableHeaderRow / Column: out-of-bounds index returns false", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 3 })
    const table = editor.state.doc.firstChild!
    expect(isTableHeaderRow(table, -1)).toBe(false)
    expect(isTableHeaderRow(table, 99)).toBe(false)
    expect(isTableHeaderColumn(table, -1)).toBe(false)
    expect(isTableHeaderColumn(table, 99)).toBe(false)
  })
})

describe("toggleTableHeaderRow", () => {
  it("flips row 0 from tableHeader to tableCell on first call, back on second", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 3 })
    const tableNodePos = 0
    const tableStart = tableNodePos + 1

    // After insertTable: row 0 is all-header.
    expect(isTableHeaderRow(editor.state.doc.firstChild!, 0)).toBe(true)

    // First toggle → all-cell.
    expect(editor.commands.toggleTableHeaderRow({ tableStart, rowIndex: 0 })).toBe(true)
    expect(isTableHeaderRow(editor.state.doc.firstChild!, 0)).toBe(false)
    const row0After = editor.state.doc.firstChild!.firstChild!
    for (let i = 0; i < row0After.childCount; i++) {
      expect(row0After.child(i).type.name).toBe("tableCell")
    }

    // Second toggle → all-header.
    editor.commands.toggleTableHeaderRow({ tableStart, rowIndex: 0 })
    expect(isTableHeaderRow(editor.state.doc.firstChild!, 0)).toBe(true)
  })

  it("preserves colwidth, textColor, backgroundColor, and inline content across toggles", () => {
    const editor = setupWithColors()
    editor.commands.insertTable({ rows: 2, cols: 3 })
    const tableStart = 1

    // Type something into the first header cell.
    const firstCellPos = firstTableParagraphPos(editor)
    editor.commands.setTextSelection(firstCellPos)
    editor.commands.insertContent("Hello")

    // Apply a row-0 background colour via the existing color command.
    editor.commands.setTableRowBackgroundColor({ tableStart, rowIndex: 0, name: "blue" })

    // Snapshot row 0 attrs + text BEFORE.
    const before = readRow0(editor)

    // Toggle off → on.
    editor.commands.toggleTableHeaderRow({ tableStart, rowIndex: 0 })
    editor.commands.toggleTableHeaderRow({ tableStart, rowIndex: 0 })

    const after = readRow0(editor)
    expect(after).toEqual(before)
  })

  it("after toggling header off, cells retain backgroundColor (renders as colored td)", () => {
    const editor = setupWithColors()
    editor.commands.insertTable({ rows: 2, cols: 3 })
    const tableStart = 1
    editor.commands.setTableRowBackgroundColor({ tableStart, rowIndex: 0, name: "red" })

    editor.commands.toggleTableHeaderRow({ tableStart, rowIndex: 0 })

    const row0 = editor.state.doc.firstChild!.firstChild!
    for (let i = 0; i < row0.childCount; i++) {
      const cell = row0.child(i)
      expect(cell.type.name).toBe("tableCell")
      expect(cell.attrs.backgroundColor).toBe("red")
    }
  })

  it("normalises a mixed row to all-header on first toggle, then to all-cell on second", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 3 })
    const tableStart = 1

    // Make row 0 mixed: flip the first cell to tableCell, leave others as header.
    {
      const map = TableMap.get(editor.state.doc.firstChild!)
      const firstCellPos = tableStart + map.map[0]!
      const tr = editor.state.tr
      const cellNode = editor.state.doc.nodeAt(firstCellPos)!
      tr.setNodeMarkup(firstCellPos, editor.schema.nodes.tableCell!, cellNode.attrs, cellNode.marks)
      editor.view.dispatch(tr)
    }
    expect(isTableHeaderRow(editor.state.doc.firstChild!, 0)).toBe(false)

    // First toggle → all-header (normalises the mixed row).
    editor.commands.toggleTableHeaderRow({ tableStart, rowIndex: 0 })
    expect(isTableHeaderRow(editor.state.doc.firstChild!, 0)).toBe(true)

    // Second toggle → all-cell.
    editor.commands.toggleTableHeaderRow({ tableStart, rowIndex: 0 })
    const row0 = editor.state.doc.firstChild!.firstChild!
    for (let i = 0; i < row0.childCount; i++) {
      expect(row0.child(i).type.name).toBe("tableCell")
    }
  })

  it("rejects rowIndex !== 0 (returns false, no-op)", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 3, cols: 2 })
    const tableStart = 1
    const docBefore = editor.state.doc.toJSON()

    expect(editor.commands.toggleTableHeaderRow({ tableStart, rowIndex: 1 })).toBe(false)
    expect(editor.commands.toggleTableHeaderRow({ tableStart, rowIndex: 2 })).toBe(false)
    expect(editor.commands.toggleTableHeaderRow({ tableStart, rowIndex: -1 })).toBe(false)
    expect(editor.state.doc.toJSON()).toEqual(docBefore)
  })

  it("rejects when tableStart does not point at a table", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 2 })
    expect(editor.commands.toggleTableHeaderRow({ tableStart: 999, rowIndex: 0 })).toBe(false)
  })
})

function readRow0(editor: Editor) {
  const row = editor.state.doc.firstChild!.firstChild!
  const cells: Array<{ type: string; attrs: Record<string, unknown>; text: string }> = []
  for (let i = 0; i < row.childCount; i++) {
    const cell = row.child(i)
    cells.push({
      type: cell.type.name,
      attrs: { ...cell.attrs },
      text: cell.textContent,
    })
  }
  return cells
}

describe("toggleTableHeaderColumn", () => {
  it("flips col 0 to all-header on first call (default insertTable has mixed col 0)", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 3, cols: 2 })
    const tableStart = 1

    // Default: col 0 is [header, cell, cell] — mixed.
    expect(isTableHeaderColumn(editor.state.doc.firstChild!, 0)).toBe(false)

    // First toggle → all-header.
    expect(editor.commands.toggleTableHeaderColumn({ tableStart, colIndex: 0 })).toBe(true)
    expect(isTableHeaderColumn(editor.state.doc.firstChild!, 0)).toBe(true)

    // Second toggle → all-cell.
    editor.commands.toggleTableHeaderColumn({ tableStart, colIndex: 0 })
    const table = editor.state.doc.firstChild!
    for (let r = 0; r < table.childCount; r++) {
      expect(table.child(r).firstChild!.type.name).toBe("tableCell")
    }
  })

  it("preserves attrs and content on col 0 cells", () => {
    const editor = setupWithColors()
    editor.commands.insertTable({ rows: 3, cols: 2 })
    const tableStart = 1

    editor.commands.setTableColumnBackgroundColor({ tableStart, colIndex: 0, name: "green" })

    editor.commands.toggleTableHeaderColumn({ tableStart, colIndex: 0 })
    editor.commands.toggleTableHeaderColumn({ tableStart, colIndex: 0 })

    const table = editor.state.doc.firstChild!
    for (let r = 0; r < table.childCount; r++) {
      const firstCell = table.child(r).firstChild!
      expect(firstCell.attrs.backgroundColor).toBe("green")
    }
  })

  it("rejects colIndex !== 0", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 3 })
    const tableStart = 1
    const docBefore = editor.state.doc.toJSON()

    expect(editor.commands.toggleTableHeaderColumn({ tableStart, colIndex: 1 })).toBe(false)
    expect(editor.commands.toggleTableHeaderColumn({ tableStart, colIndex: 2 })).toBe(false)
    expect(editor.commands.toggleTableHeaderColumn({ tableStart, colIndex: -1 })).toBe(false)
    expect(editor.state.doc.toJSON()).toEqual(docBefore)
  })
})
