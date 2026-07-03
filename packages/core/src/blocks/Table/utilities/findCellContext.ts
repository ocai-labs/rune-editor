// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { Node as ProseMirrorNode, ResolvedPos } from "@tiptap/pm/model"
import { TableMap } from "@tiptap/pm/tables"

export function findCellBefore($pos: ResolvedPos): ResolvedPos | null {
  for (let d = $pos.depth; d > 0; d--) {
    const role = $pos.node(d).type.spec.tableRole
    if (role === "cell" || role === "header_cell") {
      return $pos.doc.resolve($pos.before(d))
    }
  }
  return null
}

export interface CellContext {
  table: ProseMirrorNode
  tableStart: number
  map: TableMap
  row: number
  col: number
  /** Cell's offset inside the table node (i.e., `cellPos - tableStart`).
   *  Use `table.nodeAt(cellPosInTable)` to read the cell node, or
   *  `tableStart + cellPosInTable` for the absolute doc position. */
  cellPosInTable: number
}

export function findCellContext($pos: ResolvedPos): CellContext | null {
  let cellDepth = -1
  let tableDepth = -1
  for (let d = $pos.depth; d > 0; d--) {
    const role = $pos.node(d).type.spec.tableRole
    if ((role === "cell" || role === "header_cell") && cellDepth < 0) {
      cellDepth = d
    }
    if (role === "table") {
      tableDepth = d
      break
    }
  }
  if (cellDepth < 0 || tableDepth < 0) return null

  const table = $pos.node(tableDepth)
  const tableStart = $pos.before(tableDepth) + 1
  const map = TableMap.get(table)
  const cellPos = $pos.before(cellDepth) - tableStart
  const idx = map.map.indexOf(cellPos)
  if (idx < 0) return null

  return {
    table,
    tableStart,
    map,
    col: idx % map.width,
    row: Math.floor(idx / map.width),
    cellPosInTable: cellPos,
  }
}
