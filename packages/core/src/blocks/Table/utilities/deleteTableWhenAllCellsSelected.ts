// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { KeyboardShortcutCommand } from "@tiptap/core"
import { findParentNodeClosestToPos } from "@tiptap/core"
import { CellSelection } from "@tiptap/pm/tables"

function isCellSelection(value: unknown): value is CellSelection {
  return value instanceof CellSelection
}

export const deleteTableWhenAllCellsSelected: KeyboardShortcutCommand = ({ editor }) => {
  const { state } = editor
  if (!isCellSelection(state.selection)) return false

  const table = findParentNodeClosestToPos(state.selection.$anchorCell, (node) => node.type.name === "table")
  if (!table) return false

  let cellCount = 0
  let firstCellPos = -1
  let lastCellPos = -1
  table.node.descendants((node, nodePos) => {
    if (node.type.name === "tableCell" || node.type.name === "tableHeader") {
      cellCount += 1
      if (firstCellPos === -1) firstCellPos = table.pos + 1 + nodePos
      lastCellPos = table.pos + 1 + nodePos
    }
    return true
  })

  const anchorCellPos = state.selection.$anchorCell.pos
  const headCellPos = state.selection.$headCell.pos

  if (anchorCellPos === headCellPos) return false
  const allCellsSelected =
    state.selection.ranges.length === cellCount ||
    (anchorCellPos === firstCellPos && headCellPos === lastCellPos) ||
    (anchorCellPos === lastCellPos && headCellPos === firstCellPos)

  if (!allCellsSelected) return false
  return editor.commands.deleteTable()
}
