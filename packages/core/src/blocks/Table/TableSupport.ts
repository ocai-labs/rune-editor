// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { Extension, callOrReturn, getExtensionField } from "@tiptap/core"
import { Plugin, PluginKey } from "@tiptap/pm/state"
import { columnResizing, tableEditing } from "@tiptap/pm/tables"
import { RuneTableView } from "./RuneTableView"

const RESIZE_MIN_WIDTH = 35
const DEFAULT_CELL_WIDTH = 120

// Readonly gate for prosemirror-tables' built-in mousedown handler.
// pm-tables' tableEditing() does not check view.editable — its
// mousedown handler installs a mousemove listener that produces a
// CellSelection on cross-cell drag even in readonly mode (see
// node_modules/prosemirror-tables/dist/index.js handleMouseDown$1).
// We intercept here and return true so tableEditing never sees the
// mousedown. Scope: only when the press target is inside a rune-table
// cell — outside cells we let the event pass so readonly users can
// still click links, open menus, etc.
//
// Must remain FIRST in addProseMirrorPlugins() below: PM's someProp
// walks handleDOMEvents handlers in plugin registration order and
// short-circuits on the first truthy return. If tableEditing's mousedown
// runs before this gate, the cell-drag listener is installed and the
// readonly suppression no longer applies.
const readonlyTableGate = new Plugin({
  key: new PluginKey("rune-readonly-table-gate"),
  props: {
    handleDOMEvents: {
      mousedown(view, event) {
        if (view.editable) return false
        const target = event.target as HTMLElement | null
        if (!target?.closest(".rune-table td, .rune-table th")) return false
        return true
      },
    },
  },
})

/** Glue between Rune's table block and prosemirror-tables.
 *
 * Owns the table plugins (column-resizing + tableEditing) and the
 * `tableRole` schema fallback for the table node. Keyboard shortcuts
 * live in TableCommands so command behavior stays in one place.
 *
 * Note: no pin-before-resize plugin. "Fit to width" is a one-shot
 * pixel rewrite (TableCommands.fitTableToWidth), so cells always carry
 * accurate `colwidth` attrs — there is no fit-width sticky mode whose
 * stale colwidths would snap at resize-drag start.
 */
export const TableSupport = Extension.create({
  name: "tableSupport",

  addProseMirrorPlugins() {
    return [
      readonlyTableGate,
      columnResizing({
        handleWidth: 5,
        cellMinWidth: RESIZE_MIN_WIDTH,
        defaultCellMinWidth: DEFAULT_CELL_WIDTH,
        lastColumnResizable: true,
        View: RuneTableView,
      }),
      tableEditing({ allowTableNodeSelection: false }),
    ]
  },

  extendNodeSchema(extension) {
    const context = {
      name: extension.name,
      options: extension.options,
      storage: extension.storage,
    }
    const declared = callOrReturn(getExtensionField(extension, "tableRole", context))
    // createBlockSpec does not forward unknown NodeConfig fields (like
    // tableRole) to the PM spec. The "table" node is the only rune block
    // spec that carries a tableRole; the others (row/cell/header) are plain
    // Node.create calls and do declare tableRole directly.
    const fallback = extension.name === "table" ? ("table" as const) : undefined
    return { tableRole: declared ?? fallback }
  },
})
