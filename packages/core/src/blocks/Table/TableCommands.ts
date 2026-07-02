// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { Extension, type CommandProps } from "@tiptap/core"
import type { ColorName } from "../../shared/color-tokens"
import {
  CellSelection,
  TableMap,
  fixTables,
  addColumn,
  addRow,
  addColumnAfter as pmAddColumnAfter,
  addColumnBefore as pmAddColumnBefore,
  deleteColumn as pmDeleteColumn,
  addRowAfter as pmAddRowAfter,
  addRowBefore as pmAddRowBefore,
  deleteRow as pmDeleteRow,
  deleteTable as pmDeleteTable,
  goToNextCell,
} from "prosemirror-tables"
import { TextSelection, type Transaction } from "@tiptap/pm/state"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import { buildDefaultTableContent, computeFitColWidth, MIN_COL_WIDTH, DEFAULT_TABLE_ROWS, DEFAULT_TABLE_COLS } from "./buildDefaultContent"
import { deleteTableWhenAllCellsSelected } from "./utilities/deleteTableWhenAllCellsSelected"
import { findCellBefore, findCellContext } from "./utilities/findCellContext"

export interface InsertTableOptions {
  rows?: number
  cols?: number
  withHeaderRow?: boolean
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    /**
     * Rune table commands.
     *
     * @remarks Addressing: commands that operate inside a table use
     * ProseMirror positions and table row / column / cell indexes. This
     * is intentionally separate from block-id addressed top-level block
     * CRUD commands.
     */
    tableCommands: {
      insertTable: (options?: InsertTableOptions) => ReturnType
      addTableColumnBefore: () => ReturnType
      addTableColumnAfter: () => ReturnType
      deleteTableColumn: () => ReturnType
      addTableRowBefore: () => ReturnType
      addTableRowAfter: () => ReturnType
      deleteTableRow: () => ReturnType
      deleteTable: () => ReturnType
      duplicateTableColumn: () => ReturnType
      duplicateTableRow: () => ReturnType
      clearTableColumn: () => ReturnType
      clearTableRow: () => ReturnType
      fitTableToWidth: (pos?: number) => ReturnType
      goToNextTableCell: () => ReturnType
      goToPreviousTableCell: () => ReturnType
      setTableCellSelection: (args: { anchorCell: number; headCell?: number }) => ReturnType
      fixTable: () => ReturnType
      /**
       * Cell-color commands (M8.4e-e). `tableStart` is the table's
       * **content** start — i.e., `tablePos + 1`, where `tablePos` is the
       * position of the `<table>` node itself. The pill-dropdown plugin
       * stores it this way (see `PillDropdownState.tableStart` in
       * `CellHandlePills.ts`), and these commands index cells as
       * `tableStart + map.map[…]`. Passing the table's node position
       * instead of `pos + 1` will silently off-by-one. `name === "default"`
       * is stored as `null` (matches `storedColor` in
       * `extensions/color/createColorExtension.ts`).
       *
       * @remarks Addressing: PM table content start + axis index, not
       * Rune block id.
       */
      setTableColumnTextColor: (args: { tableStart: number; colIndex: number; name: ColorName | "default" | null }) => ReturnType
      setTableColumnBackgroundColor: (args: { tableStart: number; colIndex: number; name: ColorName | "default" | null }) => ReturnType
      setTableRowTextColor: (args: { tableStart: number; rowIndex: number; name: ColorName | "default" | null }) => ReturnType
      setTableRowBackgroundColor: (args: { tableStart: number; rowIndex: number; name: ColorName | "default" | null }) => ReturnType
      /**
       * @remarks Addressing: PM table content start + row index, not Rune
       * block id.
       */
      toggleTableHeaderRow: (args: { tableStart: number; rowIndex: number }) => ReturnType
      /**
       * @remarks Addressing: PM table content start + column index, not
       * Rune block id.
       */
      toggleTableHeaderColumn: (args: { tableStart: number; colIndex: number }) => ReturnType
    }
  }
}

type TableCommandProps = CommandProps
type PMTableCommand = (state: TableCommandProps["state"], dispatch?: TableCommandProps["dispatch"], view?: TableCommandProps["view"]) => boolean

function currentTableInfo(state: TableCommandProps["state"]) {
  const { $from } = state.selection
  for (let depth = $from.depth; depth >= 0; depth--) {
    const node = $from.node(depth)
    if (node.type.name === "table") {
      return { pos: $from.before(depth), node }
    }
  }
  return null
}

function selectionIsInLastCell(state: TableCommandProps["state"], table: NonNullable<ReturnType<typeof currentTableInfo>>["node"]) {
  const { $from } = state.selection
  let cellDepth = -1
  for (let depth = $from.depth; depth >= 0; depth--) {
    const name = $from.node(depth).type.name
    if (name === "tableCell" || name === "tableHeader") {
      cellDepth = depth
      break
    }
  }
  if (cellDepth === -1) return false

  const rowDepth = cellDepth - 1
  const rowIndex = $from.index(rowDepth - 1)
  const cellIndex = $from.index(rowDepth)
  const row = $from.node(rowDepth)
  return table.type.name === "table" && row.type.name === "tableRow" && rowIndex === table.childCount - 1 && cellIndex === row.childCount - 1
}

function currentCellPos(state: TableCommandProps["state"]) {
  const { $from } = state.selection
  for (let depth = $from.depth; depth >= 0; depth--) {
    const name = $from.node(depth).type.name
    if (name === "tableCell" || name === "tableHeader") return $from.before(depth)
  }
  return null
}

function positiveInt(value: number | undefined, fallback: number) {
  return value !== undefined && Number.isFinite(value) ? Math.max(1, Math.floor(value)) : fallback
}

/** Returns `true` iff every cell in row `rowIndex` of `table` is a
 *  `tableHeader`. Used by the header-row switch in TableActionsDropdown
 *  and by `toggleTableHeaderRow` to decide the toggle direction.
 *  Out-of-bounds → `false`. */
export function isTableHeaderRow(table: ProseMirrorNode, rowIndex: number): boolean {
  if (table.type.name !== "table") return false
  const map = TableMap.get(table)
  if (rowIndex < 0 || rowIndex >= map.height) return false
  for (let c = 0; c < map.width; c++) {
    const offset = map.map[rowIndex * map.width + c]!
    const cell = table.nodeAt(offset)
    if (!cell || cell.type.name !== "tableHeader") return false
  }
  return true
}

/** Symmetric to `isTableHeaderRow` for columns. */
export function isTableHeaderColumn(table: ProseMirrorNode, colIndex: number): boolean {
  if (table.type.name !== "table") return false
  const map = TableMap.get(table)
  if (colIndex < 0 || colIndex >= map.width) return false
  for (let r = 0; r < map.height; r++) {
    const offset = map.map[r * map.width + colIndex]!
    const cell = table.nodeAt(offset)
    if (!cell || cell.type.name !== "tableHeader") return false
  }
  return true
}

export const TableCommands = Extension.create({
  name: "tableCommands",
  // Run before tableEditing so delete shortcuts can win for full-cell selections.
  // Run before generic Tab handlers (Indent) and prosemirror-tables keymaps.
  priority: 10_000,

  addCommands() {
    return {
      insertTable:
        (options: InsertTableOptions = {}) =>
        ({ editor, state, dispatch }: TableCommandProps) => {
          const schema = state.schema
          const table = schema.nodes.table
          if (!table) return false
          const rows = positiveInt(options.rows, DEFAULT_TABLE_ROWS)
          const cols = positiveInt(options.cols, DEFAULT_TABLE_COLS)
          const colWidth = computeFitColWidth(editor, cols)
          const content = buildDefaultTableContent(schema, rows, cols, { withHeaderRow: options.withHeaderRow, colWidth })
          const node = table.create({ id: null, depth: 0 }, content)
          if (!dispatch) return true
          const tr = state.tr
          const offset = tr.selection.from + 1
          tr.replaceSelectionWith(node).scrollIntoView()
          tr.setSelection(TextSelection.near(tr.doc.resolve(offset)))
          dispatch(tr)
          return true
        },
      duplicateTableColumn:
        () =>
        ({ state, dispatch }: TableCommandProps) =>
          duplicateAxis("col", state, dispatch),
      duplicateTableRow:
        () =>
        ({ state, dispatch }: TableCommandProps) =>
          duplicateAxis("row", state, dispatch),
      clearTableColumn:
        () =>
        ({ state, dispatch }: TableCommandProps) =>
          clearAxis("col", state, dispatch),
      clearTableRow:
        () =>
        ({ state, dispatch }: TableCommandProps) =>
          clearAxis("row", state, dispatch),
      setTableColumnTextColor:
        (args: { tableStart: number; colIndex: number; name: ColorName | "default" | null }) =>
        ({ state, dispatch }: TableCommandProps) =>
          setCellAxisAttr("col", "textColor", { tableStart: args.tableStart, index: args.colIndex, name: args.name }, state, dispatch),
      setTableColumnBackgroundColor:
        (args: { tableStart: number; colIndex: number; name: ColorName | "default" | null }) =>
        ({ state, dispatch }: TableCommandProps) =>
          setCellAxisAttr("col", "backgroundColor", { tableStart: args.tableStart, index: args.colIndex, name: args.name }, state, dispatch),
      setTableRowTextColor:
        (args: { tableStart: number; rowIndex: number; name: ColorName | "default" | null }) =>
        ({ state, dispatch }: TableCommandProps) =>
          setCellAxisAttr("row", "textColor", { tableStart: args.tableStart, index: args.rowIndex, name: args.name }, state, dispatch),
      setTableRowBackgroundColor:
        (args: { tableStart: number; rowIndex: number; name: ColorName | "default" | null }) =>
        ({ state, dispatch }: TableCommandProps) =>
          setCellAxisAttr("row", "backgroundColor", { tableStart: args.tableStart, index: args.rowIndex, name: args.name }, state, dispatch),
      toggleTableHeaderRow:
        (args: { tableStart: number; rowIndex: number }) =>
        ({ state, dispatch }: TableCommandProps) =>
          toggleHeaderAxis("row", { tableStart: args.tableStart, index: args.rowIndex }, state, dispatch),
      toggleTableHeaderColumn:
        (args: { tableStart: number; colIndex: number }) =>
        ({ state, dispatch }: TableCommandProps) =>
          toggleHeaderAxis("col", { tableStart: args.tableStart, index: args.colIndex }, state, dispatch),
      fitTableToWidth:
        (pos?: number) =>
        ({ editor, state, dispatch }: TableCommandProps) => {
          // Resolve the target table position. If `pos` is given (caller
          // path: side-menu grip dropdown), use it directly; otherwise
          // walk up from the current selection.
          let tablePos = pos ?? -1
          if (tablePos < 0) {
            const info = currentTableInfo(state)
            if (!info) return false
            tablePos = info.pos
          }
          const node = state.doc.nodeAt(tablePos)
          if (!node || node.type.name !== "table") return false

          // One-shot rewrite: measure the table's specific
          // `.rune-block-content` width AT CLICK TIME and write absolute
          // pixel `colwidth` to every cell so the col-sum equals the
          // measured layout width. From this point on the table is a
          // normal fixed-width table — window resizes and device
          // changes leave the user's chosen widths intact.
          //
          // Notion does the same thing: their "Fit to width" is not a
          // sticky mode. A persistent `fitWidth=true` would silently
          // mutate the user's column widths every time the viewport
          // changed, which is exactly the bug this rewrite fixes.
          const tableDom = editor.view.nodeDOM(tablePos) as HTMLElement | null
          const blockContent = tableDom?.querySelector(
            ":scope > .rune-block-content",
          ) as HTMLElement | null
          const measured = blockContent?.clientWidth ?? 0
          if (measured <= 0) return false

          const map = TableMap.get(node)
          if (map.width <= 0) return false
          const perCol = Math.max(MIN_COL_WIDTH, Math.floor(measured / map.width))

          if (!dispatch) return true
          const tableStart = tablePos + 1
          const tr = state.tr
          const seen = new Set<number>()
          for (let row = 0; row < map.height; row += 1) {
            for (let col = 0; col < map.width; col += 1) {
              const relPos = map.map[row * map.width + col]
              if (relPos === undefined || seen.has(relPos)) continue
              seen.add(relPos)
              const cellNode = node.nodeAt(relPos)
              if (!cellNode) continue
              // Merged cells are rejected at the schema level (the architecture notes
              // invariant #7) so colspan is always 1 in practice, but
              // honor the attr defensively if upstream changes it.
              const colspan = (cellNode.attrs.colspan as number | undefined) ?? 1
              const colwidth = Array.from({ length: colspan }, () => perCol)
              tr.setNodeMarkup(tableStart + relPos, undefined, {
                ...cellNode.attrs,
                colwidth,
              })
            }
          }
          dispatch(tr)
          return true
        },
      addTableColumnBefore:
        () =>
        ({ state, dispatch }: TableCommandProps) =>
          (pmAddColumnBefore as PMTableCommand)(state, dispatch),
      addTableColumnAfter:
        () =>
        ({ state, dispatch }: TableCommandProps) =>
          (pmAddColumnAfter as PMTableCommand)(state, dispatch),
      deleteTableColumn:
        () =>
        ({ state, dispatch }: TableCommandProps) =>
          (pmDeleteColumn as PMTableCommand)(state, dispatch),
      addTableRowBefore:
        () =>
        ({ state, dispatch }: TableCommandProps) =>
          (pmAddRowBefore as PMTableCommand)(state, dispatch),
      addTableRowAfter:
        () =>
        ({ state, dispatch }: TableCommandProps) =>
          (pmAddRowAfter as PMTableCommand)(state, dispatch),
      deleteTableRow:
        () =>
        ({ state, dispatch }: TableCommandProps) =>
          (pmDeleteRow as PMTableCommand)(state, dispatch),
      deleteTable:
        () =>
        ({ state, dispatch }: TableCommandProps) =>
          (pmDeleteTable as PMTableCommand)(state, dispatch),
      goToNextTableCell:
        () =>
        ({ state, dispatch, view }: TableCommandProps) =>
          goToNextCell(1)(state, dispatch, view),
      goToPreviousTableCell:
        () =>
        ({ state, dispatch, view }: TableCommandProps) =>
          goToNextCell(-1)(state, dispatch, view),
      setTableCellSelection:
        ({ anchorCell, headCell }: { anchorCell: number; headCell?: number }) =>
        ({ state, dispatch }: TableCommandProps) => {
          if (!dispatch) return true
          dispatch(state.tr.setSelection(CellSelection.create(state.doc, anchorCell, headCell ?? anchorCell)))
          return true
        },
      fixTable: () => ({ state, dispatch }: TableCommandProps) => {
        const tr = fixTables(state)
        if (!tr) return false
        if (dispatch) dispatch(tr)
        return true
      },
    }
  },

  addKeyboardShortcuts() {
    return {
      Backspace: () => deleteTableWhenAllCellsSelected({ editor: this.editor }),
      "Mod-Backspace": () => deleteTableWhenAllCellsSelected({ editor: this.editor }),
      Delete: () => deleteTableWhenAllCellsSelected({ editor: this.editor }),
      "Mod-Delete": () => deleteTableWhenAllCellsSelected({ editor: this.editor }),
      Tab: () => {
        const tableInfo = currentTableInfo(this.editor.state)
        if (!tableInfo) return false

        if (!selectionIsInLastCell(this.editor.state, tableInfo.node) && this.editor.commands.goToNextTableCell()) return true

        const cellPos = currentCellPos(this.editor.state)
        if (cellPos === null) return false

        const stateWithCellSelection = this.editor.state.apply(
          this.editor.state.tr.setSelection(CellSelection.create(this.editor.state.doc, cellPos)),
        )
        const dispatch = (tr: Transaction) => this.editor.view.dispatch(tr)
        if (!(pmAddRowAfter as PMTableCommand)(stateWithCellSelection, dispatch, this.editor.view)) return false

        const refreshedTableInfo = currentTableInfo(this.editor.state)
        if (!refreshedTableInfo) return false

        const table = refreshedTableInfo.node
        if (!table) return false

        let pos = -1
        let rowIndex = 0
        table.forEach((row, rowPos) => {
          if (pos !== -1 || row.type.name !== "tableRow" || rowIndex !== table.childCount - 1) {
            rowIndex += 1
            return
          }
          row.descendants((node, nodePos) => {
            if (node.type.name === "tableParagraph" && pos === -1) {
              pos = refreshedTableInfo.pos + 1 + rowPos + 1 + nodePos + 1
              return false
            }
            return true
          })
          rowIndex += 1
        })
        if (pos === -1) return false

        this.editor.commands.setTextSelection(pos)
        return true
      },
      "Shift-Tab": () => this.editor.commands.goToPreviousTableCell(),
      Enter: () => {
        const { state } = this.editor
        const { selection } = state
        // Multi-cell CellSelection → fall through to default / pm-tables.
        if ((selection as { $anchorCell?: unknown }).$anchorCell) return false
        // Defensive guard for table-touching but invalid TextSelections.
        // Without ForceCellSelection's appendTransaction coercion these
        // selections survive — Enter MUST swallow them (return true, no
        // mutation) rather than fall through. The fallback chain
        // (default Enter / splitBlock) on a TextSelection that crosses
        // a `defining: true` cell boundary produces undefined behavior;
        // returning false here would silently corrupt the doc.
        if (!selection.empty) {
          const anchorCell = findCellBefore(selection.$anchor)
          const headCell = findCellBefore(selection.$head)
          // Exactly one endpoint inside a cell — invalid table-touching range.
          if (!anchorCell !== !headCell) return true
          // Both endpoints inside cells, but different cells — invalid.
          if (anchorCell && headCell && anchorCell.pos !== headCell.pos) return true
        }
        const ctx = findCellContext(selection.$head)
        if (!ctx) return false // selection entirely outside any table — fall through
        const nextRow = ctx.row + 1
        if (nextRow >= ctx.map.height) return true // last-row consume
        const nextCellRelPos = ctx.map.map[nextRow * ctx.map.width + ctx.col]
        if (nextCellRelPos === undefined) return true
        const absPos = ctx.tableStart + nextCellRelPos + 1
        const $next = state.doc.resolve(absPos)
        const textPos = $next.nodeAfter ? absPos + 1 : absPos
        const tr = state.tr
          .setSelection(TextSelection.create(state.doc, textPos))
          .scrollIntoView()
        this.editor.view.dispatch(tr)
        return true
      },
    }
  },
})

// ────────────────────────────────────────────────────────────────────────
// duplicate / clear helpers — run their own state-mutating logic so the
// command bodies above can stay one-liner adapters.
//
// Hard precondition: the selection must be a CellSelection whose rect
// matches exactly one full column or one full row of the active table.
// Whole-table CellSelections (Cmd+A inside a table), partial drags, and
// anything that's not a single full axis return false (no-op). See
// 2026-05-06-m8-4e-d-table-pill-dropdown.md §"Precondition guard (hard)".
// ────────────────────────────────────────────────────────────────────────

type AxisContext = {
  table: ProseMirrorNode
  tableStart: number
  map: TableMap
  /** column index for axis="col", row index for axis="row" */
  index: number
}

function fullAxisFromSelection(
  axis: "col" | "row",
  state: TableCommandProps["state"],
): AxisContext | null {
  const sel = state.selection
  if (!(sel instanceof CellSelection)) return null
  // $anchorCell is a ResolvedPos pointing AT a cell node. Its parent at
  // depth-1 is the row, and the table is at depth-2. The convention used
  // elsewhere in this codebase (CellHandlePills.activeAxes,
  // selectionAnchor) is `depth - 1`, but those operate on a head/anchor
  // resolved INSIDE the cell content (depth = 3), so depth-1=2 = row,
  // and node(-1 from cell-content) gives the row's parent = table.
  // For our case where $anchorCell.depth comes from doc.resolve(beforeCell)
  // — i.e., at the row level (depth=2) — we need depth-1=1 = table.
  const tableDepth = sel.$anchorCell.depth - 1
  const table = sel.$anchorCell.node(tableDepth)
  const tableStart = sel.$anchorCell.start(tableDepth)
  if (table.type.name !== "table") return null
  const map = TableMap.get(table)
  const rect = map.rectBetween(
    sel.$anchorCell.pos - tableStart,
    sel.$headCell.pos - tableStart,
  )
  if (axis === "col") {
    if (rect.top !== 0 || rect.bottom !== map.height) return null
    if (rect.left + 1 !== rect.right) return null
    return { table, tableStart, map, index: rect.left }
  }
  if (rect.left !== 0 || rect.right !== map.width) return null
  if (rect.top + 1 !== rect.bottom) return null
  return { table, tableStart, map, index: rect.top }
}


function duplicateAxis(
  axis: "col" | "row",
  state: TableCommandProps["state"],
  dispatch?: TableCommandProps["dispatch"],
): boolean {
  const ctx = fullAxisFromSelection(axis, state)
  if (!ctx) return false
  if (!dispatch) return true

  const { table, tableStart, map, index } = ctx
  const sources: ProseMirrorNode[] = []
  if (axis === "col") {
    for (let r = 0; r < map.height; r++) {
      const cellOffset = map.map[r * map.width + index]!
      const cell = table.nodeAt(cellOffset)
      if (!cell) return false
      sources.push(cell)
    }
  } else {
    for (let c = 0; c < map.width; c++) {
      const cellOffset = map.map[index * map.width + c]!
      const cell = table.nodeAt(cellOffset)
      if (!cell) return false
      sources.push(cell)
    }
  }

  const tr = state.tr
  // Insert a blank axis after the source. addColumn / addRow only read
  // { map, tableStart, table } from the rect; the geometric fields are
  // signature-only.
  const rect = {
    map,
    tableStart,
    table,
    left: 0,
    top: 0,
    right: map.width,
    bottom: map.height,
  }
  if (axis === "col") {
    addColumn(tr, rect, index + 1)
  } else {
    addRow(tr, rect, index + 1)
  }

  // Now overwrite the freshly-inserted axis cells with copies of the
  // source cells. After addColumn/addRow, the table's structure is in
  // tr.doc; refetch the new map. The new column/row sits at index+1.
  const newTable = tr.doc.nodeAt(tableStart - 1)
  if (!newTable || newTable.type.name !== "table") return false
  const newMap = TableMap.get(newTable)
  // Snapshot all target absolute positions BEFORE any replacement, then
  // walk back-to-front so earlier replacements don't invalidate later
  // positions. (`newMap.map` was captured right after addRow/addColumn
  // and is consistent with the freshly-inserted blank axis; mutating
  // that axis's cell contents in-place from highest pos down keeps the
  // remaining positions valid.)
  const targets: { abs: number; src: ProseMirrorNode }[] = []
  for (let i = 0; i < sources.length; i++) {
    const src = sources[i]!
    const targetOffset =
      axis === "col"
        ? newMap.map[i * newMap.width + (index + 1)]!
        : newMap.map[(index + 1) * newMap.width + i]!
    targets.push({ abs: tableStart + targetOffset, src })
  }
  targets.sort((a, b) => b.abs - a.abs)
  for (const { abs, src } of targets) {
    const blankCell = tr.doc.nodeAt(abs)
    if (!blankCell) return false
    const from = abs + 1
    const to = abs + blankCell.nodeSize - 1
    tr.replaceWith(from, to, src.content)
  }

  dispatch(tr)
  return true
}

function clearAxis(
  axis: "col" | "row",
  state: TableCommandProps["state"],
  dispatch?: TableCommandProps["dispatch"],
): boolean {
  const ctx = fullAxisFromSelection(axis, state)
  if (!ctx) return false
  if (!dispatch) return true

  const { table, tableStart, map, index } = ctx
  const tableParagraph = state.schema.nodes.tableParagraph
  if (!tableParagraph) return false
  const empty = tableParagraph.create()

  const tr = state.tr
  // Walk cells back-to-front so earlier replacements don't shift later
  // positions. Build a list of cell positions first, sort descending.
  const cellPositions: number[] = []
  if (axis === "col") {
    for (let r = 0; r < map.height; r++) {
      cellPositions.push(tableStart + map.map[r * map.width + index]!)
    }
  } else {
    for (let c = 0; c < map.width; c++) {
      cellPositions.push(tableStart + map.map[index * map.width + c]!)
    }
  }
  cellPositions.sort((a, b) => b - a)
  for (const cellPos of cellPositions) {
    const cell = table.nodeAt(cellPos - tableStart)
    if (!cell) continue
    const from = cellPos + 1
    const to = cellPos + cell.nodeSize - 1
    tr.replaceWith(from, to, empty)
  }

  dispatch(tr)
  return true
}

// Apply a single block-attr (textColor or backgroundColor) to every cell
// along one axis (column or row) of a single table. Used by the four
// pill-dropdown color commands. Walks via TableMap — same primitive used
// by clearAxis above; do not hand-roll an alternative walker (it would
// bypass the merged-cell guard's invariants).
function setCellAxisAttr(
  axis: "col" | "row",
  attr: "textColor" | "backgroundColor",
  args: { tableStart: number; index: number; name: ColorName | "default" | null },
  state: TableCommandProps["state"],
  dispatch?: TableCommandProps["dispatch"],
): boolean {
  const tableNodePos = args.tableStart - 1
  if (tableNodePos < 0 || tableNodePos >= state.doc.content.size) return false
  const table = state.doc.nodeAt(tableNodePos)
  if (!table || table.type.name !== "table") return false
  const map = TableMap.get(table)

  // Bounds check — reject indices outside the table.
  if (axis === "col" && (args.index < 0 || args.index >= map.width)) return false
  if (axis === "row" && (args.index < 0 || args.index >= map.height)) return false

  if (!dispatch) return true

  const value = args.name === "default" ? null : args.name
  const tr = state.tr

  // Collect absolute cell positions, then walk back-to-front so earlier
  // setNodeAttribute calls don't shift later positions. (setNodeAttribute
  // is size-preserving so this is defensive — but mirroring clearAxis's
  // pattern keeps the codebase uniform.)
  const cellPositions: number[] = []
  if (axis === "col") {
    for (let r = 0; r < map.height; r++) {
      cellPositions.push(args.tableStart + map.map[r * map.width + args.index]!)
    }
  } else {
    for (let c = 0; c < map.width; c++) {
      cellPositions.push(args.tableStart + map.map[args.index * map.width + c]!)
    }
  }
  cellPositions.sort((a, b) => b - a)
  for (const cellPos of cellPositions) {
    tr.setNodeAttribute(cellPos, attr, value)
  }

  dispatch(tr)
  return true
}

/** Flip every cell in row `rowIndex` (resp. col `colIndex`) of the table
 *  at `tableStart - 1` between `tableCell` and `tableHeader`. The new
 *  type is decided once: if every cell is already `tableHeader`, target
 *  is `tableCell`; otherwise `tableHeader` (so a mixed axis normalises
 *  to all-header on first call). Forward iteration is safe —
 *  `setNodeMarkup` is size-preserving (same arity, same content type),
 *  so later positions don't shift. attrs and marks are copied verbatim,
 *  which preserves colwidth / textColor / backgroundColor and any inline
 *  content. Caller already enforced `index === 0`. */
function toggleHeaderAxis(
  axis: "col" | "row",
  args: { tableStart: number; index: number },
  state: TableCommandProps["state"],
  dispatch?: TableCommandProps["dispatch"],
): boolean {
  if (args.index !== 0) return false

  const tableNodePos = args.tableStart - 1
  if (tableNodePos < 0 || tableNodePos >= state.doc.content.size) return false
  const table = state.doc.nodeAt(tableNodePos)
  if (!table || table.type.name !== "table") return false

  const map = TableMap.get(table)
  if (axis === "col" && (args.index < 0 || args.index >= map.width)) return false
  if (axis === "row" && (args.index < 0 || args.index >= map.height)) return false

  const tableCellType = state.schema.nodes["tableCell"]
  const tableHeaderType = state.schema.nodes["tableHeader"]
  if (!tableCellType || !tableHeaderType) return false

  // Decide direction once. allHeader = the axis is already fully header.
  const cellOffsets: number[] = []
  if (axis === "col") {
    for (let r = 0; r < map.height; r++) cellOffsets.push(map.map[r * map.width + args.index]!)
  } else {
    for (let c = 0; c < map.width; c++) cellOffsets.push(map.map[args.index * map.width + c]!)
  }

  let allHeader = true
  for (const offset of cellOffsets) {
    const cell = table.nodeAt(offset)
    if (!cell || cell.type.name !== "tableHeader") {
      allHeader = false
      break
    }
  }
  const targetType = allHeader ? tableCellType : tableHeaderType

  if (!dispatch) return true

  const tr = state.tr
  // Forward iteration: setNodeMarkup is size-preserving so subsequent
  // positions are stable. (clearAxis walks back-to-front because it uses
  // replaceWith, which can change size.)
  for (const offset of cellOffsets) {
    const cellPos = args.tableStart + offset
    const cell = state.doc.nodeAt(cellPos)
    if (!cell) continue
    if (cell.type === targetType) continue
    tr.setNodeMarkup(cellPos, targetType, cell.attrs, cell.marks)
  }

  dispatch(tr)
  return true
}
