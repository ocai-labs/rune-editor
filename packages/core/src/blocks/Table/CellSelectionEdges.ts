// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { Extension } from "@tiptap/core"
import { Decoration, DecorationSet } from "@tiptap/pm/view"
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state"
import { CellSelection, TableMap } from "@tiptap/pm/tables"
import { findCellContext } from "./utilities/findCellContext"
import { gestureKey } from "../../extensions/shared/gesture-state"

const edgesKey = new PluginKey("rune-cell-selection-edges")

export const CellSelectionEdges = Extension.create({
  name: "cellSelectionEdges",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: edgesKey,
        props: {
          decorations(state) {
            const { selection, doc } = state

            // CellSelection: paint perimeter borders on the selection rectangle.
            if (selection instanceof CellSelection) {
              const tableDepth = selection.$anchorCell.depth - 1
              const table = selection.$anchorCell.node(tableDepth)
              const tableStart = selection.$anchorCell.start(tableDepth)
              const map = TableMap.get(table)
              const anchorPos = selection.$anchorCell.pos - tableStart
              const headPos = selection.$headCell.pos - tableStart
              const rect = map.rectBetween(anchorPos, headPos)

              const decos: Decoration[] = []
              const seen = new Set<number>()
              for (let row = rect.top; row < rect.bottom; row++) {
                for (let col = rect.left; col < rect.right; col++) {
                  const cellPos = map.map[row * map.width + col]
                  if (cellPos == null) continue
                  if (seen.has(cellPos)) continue
                  seen.add(cellPos)
                  const cellNode = table.nodeAt(cellPos)
                  if (!cellNode) continue
                  const classes: string[] = []
                  if (row === rect.top) classes.push("sel-edge-top")
                  if (row === rect.bottom - 1) classes.push("sel-edge-bottom")
                  if (col === rect.left) classes.push("sel-edge-left")
                  if (col === rect.right - 1) classes.push("sel-edge-right")
                  if (!classes.length) continue
                  const from = tableStart + cellPos
                  decos.push(
                    Decoration.node(from, from + cellNode.nodeSize, {
                      class: classes.join(" "),
                    }),
                  )
                }
              }
              return DecorationSet.create(doc, decos)
            }

            // TextSelection caret in a cell: emit cursorCell on that cell.
            // The .cursorCell::after CSS rule (table.css:134-137) paints all
            // 4 sides + radius. cursorCell is Rune-defined (not from
            // prosemirror-tables); this is its sole emitter.
            //
            // Suppressed during a cell-drag (column/row reorder): without this
            // gate, a stray TextSelection that races a drag — or the synthetic
            // post-mouseup click before its handlers run — paints a blue ring
            // on whichever cell the cursor is over, even though the user's
            // intent is to drop the moved slice elsewhere. Issue #203 ask 2.
            if (gestureKey.getState(state)?.activeGesture === "cell-drag") return null
            if (selection instanceof TextSelection && selection.empty) {
              const ctx = findCellContext(selection.$head)
              if (!ctx) return null
              const cellNode = ctx.table.nodeAt(ctx.cellPosInTable)
              if (!cellNode) return null
              const from = ctx.tableStart + ctx.cellPosInTable
              return DecorationSet.create(doc, [
                Decoration.node(from, from + cellNode.nodeSize, { class: "cursorCell" }),
              ])
            }

            return null
          },
        },
      }),
    ]
  },
})
