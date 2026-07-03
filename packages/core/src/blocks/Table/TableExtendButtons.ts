// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { Extension } from "@tiptap/core"
import { Plugin, PluginKey, TextSelection, type EditorState } from "@tiptap/pm/state"
import type { EditorView } from "@tiptap/pm/view"
import { addColumn, addRow, CellSelection, TableMap, type TableRect } from "@tiptap/pm/tables"
import { resolveTableFromFrame } from "./utilities/resolveTableFromFrame"
import { findCellContext } from "./utilities/findCellContext"
import { PLUS_SVG } from "../../extensions/side-menu/svg"
import { gestureKey } from "../../extensions/shared/gesture-state"

const extendButtonsKey = new PluginKey("rune-table-extend-buttons")

interface ButtonGroup {
  col: HTMLButtonElement
  row: HTMLButtonElement
  unmount: () => void
}

interface ActiveEdges {
  /** tableStart of the table the selection is in — matches
   *  `resolveTableFromFrame().tableStart`, so syncActive can pick the
   *  one frame the selection belongs to. */
  tableStart: number
  /** Selection touches the last column → reveal +col. */
  col: boolean
  /** Selection touches the last row → reveal +row. */
  row: boolean
}

/**
 * Which extend buttons a (non-hover) selection should reveal.
 *
 * The CSS reveal also keys off `:hover` of the last column / last row, but
 * `:focus-within` cannot stand in for "the caret is in the last cell": in a
 * single-contenteditable editor the focused element is always the
 * `.ProseMirror` root — an *ancestor* of every cell — so `td:focus-within`
 * is never true for a caret. We derive the same intent from the PM selection
 * here, and the plugin marks the owning frame with data attributes the CSS
 * reads (see table.css extend-button reveal block).
 *
 * Returns null when the selection isn't inside a table (caret elsewhere, or a
 * non-text / non-cell selection) — the caller clears the attrs in that case.
 */
function activeEdgesForSelection(state: EditorState): ActiveEdges | null {
  const { selection } = state

  // A multi-cell selection reveals +col/+row if its rectangle reaches the
  // table's right / bottom edge. Mirrors CellSelectionEdges' derivation.
  if (selection instanceof CellSelection) {
    const tableDepth = selection.$anchorCell.depth - 1
    const table = selection.$anchorCell.node(tableDepth)
    const tableStart = selection.$anchorCell.start(tableDepth)
    const map = TableMap.get(table)
    const rect = map.rectBetween(
      selection.$anchorCell.pos - tableStart,
      selection.$headCell.pos - tableStart,
    )
    return { tableStart, col: rect.right >= map.width, row: rect.bottom >= map.height }
  }

  // A caret in a cell reveals the button for the edge that cell sits on.
  if (selection instanceof TextSelection && selection.empty) {
    const ctx = findCellContext(selection.$head)
    if (!ctx) return null
    return {
      tableStart: ctx.tableStart,
      col: ctx.col === ctx.map.width - 1,
      row: ctx.row === ctx.map.height - 1,
    }
  }

  return null
}

function makeButton(
  doc: Document,
  cls: string,
  ariaLabel: string,
  onClick: () => void,
): HTMLButtonElement {
  const btn = doc.createElement("button")
  btn.type = "button"
  btn.className = cls
  btn.setAttribute("aria-label", ariaLabel)
  btn.setAttribute("contenteditable", "false")
  btn.innerHTML = PLUS_SVG
  btn.addEventListener("mousedown", (e) => e.preventDefault())
  btn.addEventListener("click", (e) => {
    e.preventDefault()
    onClick()
  })
  return btn
}

function mountGroup(view: EditorView, frame: HTMLElement): ButtonGroup {
  const doc = view.dom.ownerDocument

  // addColumn / addRow only use { map, tableStart, table } at runtime;
  // the Rect fields (left/top/right/bottom) are part of the TableRect type
  // signature but are not accessed by these low-level helpers.
  const makeRect = (map: TableMap, tableStart: number, table: Parameters<typeof addColumn>[1]["table"]): TableRect =>
    ({ map, tableStart, table, left: 0, top: 0, right: map.width, bottom: map.height })

  const colBtn = makeButton(doc, "rune-table-extend-col", "Add column", () => {
    const ctx = resolveTableFromFrame(view, frame)
    if (!ctx) return
    const tr = view.state.tr
    addColumn(tr, makeRect(ctx.map, ctx.tableStart, ctx.tableNode), ctx.map.width)
    view.dispatch(tr.scrollIntoView())
  })

  const rowBtn = makeButton(doc, "rune-table-extend-row", "Add row", () => {
    const ctx = resolveTableFromFrame(view, frame)
    if (!ctx) return
    const tr = view.state.tr
    addRow(tr, makeRect(ctx.map, ctx.tableStart, ctx.tableNode), ctx.map.height)
    view.dispatch(tr.scrollIntoView())
  })

  frame.appendChild(colBtn)
  frame.appendChild(rowBtn)

  return {
    col: colBtn,
    row: rowBtn,
    unmount() {
      colBtn.remove()
      rowBtn.remove()
    },
  }
}

export const TableExtendButtons = Extension.create({
  name: "tableExtendButtons",

  addProseMirrorPlugins() {
    const editor = this.editor
    return [
      new Plugin({
        key: extendButtonsKey,
        view(editorView) {
          const groups = new Map<HTMLElement, ButtonGroup>()

          const sync = () => {
            if (!editor.isEditable) {
              for (const group of groups.values()) group.unmount()
              groups.clear()
              return
            }
            const frames = editorView.dom.querySelectorAll<HTMLElement>(
              '[data-block-type="table"] .rune-table-frame',
            )
            const live = new Set<HTMLElement>(frames)
            for (const frame of frames) {
              if (!groups.has(frame)) {
                groups.set(frame, mountGroup(editorView, frame))
              }
            }
            for (const [frame, group] of groups) {
              if (!live.has(frame)) {
                group.unmount()
                groups.delete(frame)
              }
            }
          }

          // Suppress the +col / +row buttons during a cell-drag. We set
          // inline opacity directly because the reveal trigger above uses
          // `:has(...:hover)` with specificity (0,5,2) — a class- or
          // attribute-based override would need `!important` to win, which
          // is exactly the smell we removed by moving the decision to Core.
          // Inline style wins regardless of selector specificity. Also
          // disable pointer-events so the invisible button doesn't catch
          // clicks while it fades out.
          const syncGesture = () => {
            const dragging = gestureKey.getState(editorView.state)?.activeGesture === "cell-drag"
            for (const group of groups.values()) {
              for (const btn of [group.col, group.row]) {
                btn.style.opacity = dragging ? "0" : ""
                btn.style.pointerEvents = dragging ? "none" : ""
              }
            }
          }

          // Selection-based reveal. Mark the frame the selection lives in
          // with data-rune-extend-{col,row}-active so the CSS can reveal the
          // button for a caret/cell-selection on the last column/row — the
          // case `:focus-within` can't express (see activeEdgesForSelection).
          // Unlike syncGesture this writes attributes, not inline style: the
          // attrs only ADD a reveal selector, they don't need to out-specify
          // anything. Runs on every selection change via update().
          const syncActive = () => {
            const active = activeEdgesForSelection(editorView.state)
            for (const frame of groups.keys()) {
              let col = false
              let row = false
              if (active) {
                const ctx = resolveTableFromFrame(editorView, frame)
                if (ctx && ctx.tableStart === active.tableStart) {
                  col = active.col
                  row = active.row
                }
              }
              frame.toggleAttribute("data-rune-extend-col-active", col)
              frame.toggleAttribute("data-rune-extend-row-active", row)
            }
          }

          queueMicrotask(() => {
            sync()
            syncGesture()
            syncActive()
          })

          // setEditable() doesn't dispatch a transaction (PM `view.setProps`
          // only) so the plugin's update() hook won't fire on a readonly flip.
          // Subscribe to Tiptap's 'update' event to re-sync (unmount on
          // editable=false, remount on true).
          const onEditableMaybeChanged = () => sync()
          editor.on("update", onEditableMaybeChanged)

          return {
            update() {
              sync()
              syncGesture()
              syncActive()
            },
            destroy() {
              editor.off("update", onEditableMaybeChanged)
              for (const group of groups.values()) group.unmount()
              groups.clear()
            },
          }
        },
      }),
    ]
  },
})
