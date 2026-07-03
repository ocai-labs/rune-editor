// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { Extension } from "@tiptap/core"
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import { Decoration, DecorationSet } from "@tiptap/pm/view"
import type { EditorView } from "@tiptap/pm/view"
import { CellSelection, TableMap } from "@tiptap/pm/tables"
import { findCellContext } from "./utilities/findCellContext"
import { resolveTableFromFrame } from "./utilities/resolveTableFromFrame"
import { gestureKey } from "../../extensions/shared/gesture-state"

// Notion-style 2×3 dot grip. Exact SVG path cloned from the reference implementation
// (dots at (7.5,4)(12.5,4)(7.5,10)(12.5,10)(7.5,16)(12.5,16), r=1.25). The
// row orientation renders as-is; col is the same shape rotated 90deg.
const GRIP_PATH =
  "M6.25 4a1.25 1.25 0 1 0 2.5 0 1.25 1.25 0 0 0-2.5 0m5 0a1.25 1.25 0 1 0 2.5 0 1.25 1.25 0 0 0-2.5 0m1.25 7.25a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5M6.25 10a1.25 1.25 0 1 0 2.5 0 1.25 1.25 0 0 0-2.5 0m6.25 7.25a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5M6.25 16a1.25 1.25 0 1 0 2.5 0 1.25 1.25 0 0 0-2.5 0"

function gripSvg(orientation: "col" | "row"): string {
  const rotate = orientation === "col" ? ' style="transform:rotate(90deg)"' : ""
  return `<svg viewBox="0 0 20 20" aria-hidden="true"${rotate}><path d="${GRIP_PATH}"/></svg>`
}

function createGrip(orientation: "col" | "row", ownerDocument: Document): HTMLElement {
  const btn = ownerDocument.createElement("button")
  btn.type = "button"
  btn.tabIndex = -1
  btn.className = `rune-${orientation}-pill-grip`
  btn.setAttribute(
    "aria-label",
    orientation === "col" ? "Column options" : "Row options",
  )
  // The pill is the user-facing menu trigger. Radix's invisible anchor
  // button inside TableMenu is aria-hidden, so the accessibility contract
  // lives here.
  btn.setAttribute("aria-haspopup", "menu")
  btn.innerHTML = gripSvg(orientation)
  return btn
}

// Notion-style cell handle pills. The whole selection (range or single cell)
// gets exactly one pair of pills — they live in the table's top-row / left-col
// gutter, not on the selected cells themselves:
//   - Col pill: row 0, same column as the selection's top-left anchor.
//   - Row pill: col 0, same row as the selection's top-left anchor.
// Clicking a pill promotes the selection to a full column / full row; the
// originating pill paints its grip with the accent background (is-active)
// until the selection is modified by any non-pill interaction.
export const PILL_ORIGIN_META = "cellHandlePills/origin"
// PILL_DROPDOWN_META carries open/close intent for the action menu that
// hangs off pill clicks. Open payload is the dropdown anchor descriptor;
// close is a sentinel. State lives on cellHandlePillsKey so the React
// dropdown component can subscribe via cellHandlePillsKey.getState(state).
export const PILL_DROPDOWN_META = "cellHandlePills/dropdown"

export type PillDropdownState = {
  tableStart: number
  axis: "col" | "row"
  index: number
}

type PillState = {
  origin: "col" | "row" | null
  dropdown: PillDropdownState | null
}

// Exported (was file-private) so rune-react / consumers can read dropdown
// state with cellHandlePillsKey.getState(state). Re-exported from blocks/Table/index.ts
// and packages/core/src/index.ts.
export const cellHandlePillsKey = new PluginKey<PillState>("rune-cell-handle-pills")

export const CellHandlePills = Extension.create({
  name: "cellHandlePills",

  addProseMirrorPlugins() {
    const editor = this.editor
    return [
      new Plugin<PillState>({
        key: cellHandlePillsKey,

        // Tracks *how* the current selection was produced so the active
        // (blue) state is tied to pill-click origin, not to the selection
        // merely happening to span a full axis (e.g., the user dragging
        // A1..A3 manually). Any transaction that changes the selection
        // without the pill-origin meta clears the flag.
        state: {
          init(): PillState {
            return { origin: null, dropdown: null }
          },
          apply(tr, prev): PillState {
            const originMeta = tr.getMeta(PILL_ORIGIN_META) as
              | "col"
              | "row"
              | null
              | undefined
            const dropMeta = tr.getMeta(PILL_DROPDOWN_META) as
              | { open: PillDropdownState }
              | { close: true }
              | undefined

            // origin: same semantics as before — set if origin meta is
            // present; cleared if any selection-changing tr arrives without
            // origin meta; otherwise sticky.
            let origin: PillState["origin"]
            if (originMeta !== undefined) origin = originMeta
            else if (tr.selectionSet) origin = null
            else origin = prev.origin

            // dropdown lifecycle:
            //   1. explicit open meta wins;
            //   2. explicit close meta wins next;
            //   3. otherwise: auto-close ONLY when the selection moved
            //      WITHOUT a doc edit and WITHOUT origin meta. A
            //      doc-change'd tr (programmatic insert, undo, etc.) is
            //      not "user moved selection elsewhere" — it's incidental,
            //      and the remap step below should decide.
            //   4. otherwise sticky (carry forward).
            // NOTE: must check getMeta(...) === undefined explicitly —
            // `!PILL_ORIGIN_META` would test the string constant for
            // truthiness (always true).
            let dropdown: PillState["dropdown"]
            if (dropMeta && "open" in dropMeta) dropdown = dropMeta.open
            else if (dropMeta && "close" in dropMeta) dropdown = null
            // A cell-drag gesture claim closes the dropdown. Without this,
            // dragging the anchor pill leaves `dropdown` stuck open for the
            // whole drag (the menu DOM disappears only because the pill
            // widget is suppressed), and TableActionsDropdown's capture-
            // phase Escape listener — gated on this state — swallows the
            // Escape that should cancel the drag.
            else if (
              (tr.getMeta(gestureKey) as { activeGesture?: string } | undefined)
                ?.activeGesture === "cell-drag"
            ) dropdown = null
            else if (
              tr.selectionSet &&
              !tr.docChanged &&
              tr.getMeta(PILL_ORIGIN_META) === undefined
            ) dropdown = null
            else dropdown = prev.dropdown

            // Doc-change remap: if the dropdown is still alive AND the doc
            // changed, remap tableStart through tr.mapping. If the new
            // position no longer resolves to a `table` node, the table got
            // deleted — clear the dropdown.
            if (dropdown && tr.docChanged) {
              const mapped = tr.mapping.map(dropdown.tableStart)
              const node = tr.doc.nodeAt(mapped - 1)
              if (node && node.type.name === "table") {
                dropdown = { ...dropdown, tableStart: mapped }
              } else {
                dropdown = null
              }
            }

            return { origin, dropdown }
          },
        },

        props: {
          decorations(state) {
            if (!editor.isEditable) return null
            // During a pill-initiated cell-drag, the floating preview is the
            // only handle affordance — emitting source pills here would render
            // them under the preview at the focused cell. Mirrors the same
            // suppression in CellSelectionEdges (cursorCell ring during drag).
            if (gestureKey.getState(state)?.activeGesture === "cell-drag") {
              return null
            }
            const { selection, doc } = state

            const anchor = selectionAnchor(selection)
            if (!anchor) return null
            const { table, tableStart, row, col } = anchor
            const map = TableMap.get(table)

            const active = activeAxes(selection, map, col, row)

            const decos: Decoration[] = []
            // Suppress the opposite-axis pill only when exactly one axis is
            // fully selected — clicking the other would narrow the
            // selection (false affordance). When both axes are fully
            // selected (entire table) or neither is, both pills render.
            const hideCol = active.row && !active.col
            const hideRow = active.col && !active.row
            // Widget keys are stable in (tableStart, col/row); the is-active
            // class is mutated in-place by the plugin's view lifecycle below,
            // so flipping origin doesn't destroy and recreate the pill DOM.
            // It must still be baked in at creation time: when the widget is
            // destroyed and recreated under an unchanged (origin, tableStart)
            // — e.g. a cancelled pill drag — the view-layer sync short-
            // circuits and would leave the fresh DOM without the class.
            // The factory only emits pills for the anchor table, so "this
            // pill's frame is the active frame" holds by construction.
            const origin = cellHandlePillsKey.getState(state)?.origin ?? null
            const colHostPos = map.map[0 * map.width + col] ?? 0
            const colHostNode = !hideCol ? table.nodeAt(colHostPos) : null
            if (colHostNode) {
              decos.push(
                Decoration.widget(
                  tableStart + colHostPos + 1,
                  (view) => {
                    const ownerDoc = view.dom.ownerDocument
                    const el = ownerDoc.createElement("div")
                    el.className = "rune-col-pill"
                    if (origin === "col") el.classList.add("is-active")
                    el.dataset.col = String(col)
                    el.appendChild(createGrip("col", ownerDoc))
                    return el
                  },
                  { side: -1, key: `col-pill-${tableStart}-${col}` },
                ),
              )
            }

            const rowHostPos = map.map[row * map.width + 0] ?? 0
            const rowHostNode = !hideRow ? table.nodeAt(rowHostPos) : null
            if (rowHostNode) {
              decos.push(
                Decoration.widget(
                  tableStart + rowHostPos + 1,
                  (view) => {
                    const ownerDoc = view.dom.ownerDocument
                    const el = ownerDoc.createElement("div")
                    el.className = "rune-row-pill"
                    if (origin === "row") el.classList.add("is-active")
                    el.dataset.row = String(row)
                    el.appendChild(createGrip("row", ownerDoc))
                    return el
                  },
                  { side: -1, key: `row-pill-${tableStart}-${row}` },
                ),
              )
            }

            return DecorationSet.create(doc, decos)
          },

          // Block PM's default caret placement / cell-select on pill press.
          // The actual full-axis selection is dispatched on click.
          //
          // NOTE: returning `true` only skips PM's OWN mousedown handler —
          // prosemirror-view's runCustomHandler never calls preventDefault
          // for you, so the BROWSER's native caret-placement / selection
          // session still starts here. That's masked in tables: the click
          // handler below immediately dispatches a CellSelection, and
          // CellHandleDrag sweeps stray ranges pre-claim. Do NOT copy this
          // as a "returning true prevents default" pattern — it doesn't
          // (that mistake caused the column-resize caret ping-pong bug;
          // see Columns/resize.ts, which preventDefaults explicitly).
          handleDOMEvents: {
            mousedown(_view, event) {
              const target = event.target as HTMLElement | null
              if (!target) return false
              if (target.closest(".rune-col-pill, .rune-row-pill")) {
                return true
              }
              return false
            },

            // Click handler dispatches the full-axis CellSelection using
            // resolveTableFromFrame for a position-fresh table lookup —
            // never stale dataset.tableStart.
            click(view, event) {
              const target = event.target as HTMLElement | null
              if (!target) return false
              const colPill = target.closest(".rune-col-pill") as HTMLElement | null
              if (colPill) {
                selectFullColumn(view, colPill)
                return true
              }
              const rowPill = target.closest(".rune-row-pill") as HTMLElement | null
              if (rowPill) {
                selectFullRow(view, rowPill)
                return true
              }
              return false
            },
          },
        },

        // Toggle is-active on the existing pill DOM after each transaction
        // instead of re-keying the widget. The decorations factory only
        // runs when (tableStart, col/row) changes, so a pill click no
        // longer destroys+recreates the widget element — it just flips a
        // class on the same node.
        view(editorView) {
          let lastOrigin: "col" | "row" | null | undefined = undefined
          let lastTableStart: number | null | undefined = undefined
          let lastFrame: Element | null | undefined = undefined
          const sync = () => {
            const state = editorView.state
            const origin = cellHandlePillsKey.getState(state)?.origin ?? null
            const dom = editorView.dom

            // Identify the "active" table by tableStart. We short-circuit on
            // (origin, tableStart) — both must change to warrant DOM work.
            // Checking origin alone is insufficient: clicking the same-axis
            // pill on a second table produces the same origin but a
            // different table, and the previous table's pill would keep its
            // is-active class.
            const anchor = selectionAnchor(state.selection)
            const tableStart = anchor?.tableStart ?? null
            if (
              origin === lastOrigin &&
              tableStart === lastTableStart &&
              (lastFrame === null || (lastFrame && dom.contains(lastFrame)))
            ) {
              return
            }

            let activeFrame: Element | null = null
            if (anchor) {
              try {
                const tableDOM = editorView.nodeDOM(anchor.tableStart - 1) as HTMLElement | null
                // tableDOM is the .rune-block; descend to its .rune-table-frame.
                activeFrame = tableDOM?.querySelector(".rune-table-frame") ?? null
              } catch {
                // Fall back to frame-matching via resolveTableFromFrame
                activeFrame = null
              }
              // If nodeDOM lookup failed, scan all frames to find matching
              // tableStart. This is O(N) and should only run on initial
              // mount or when nodeDOM is unavailable; the (origin,
              // tableStart) short-circuit above keeps it off the hot path.
              if (!activeFrame) {
                dom.querySelectorAll<HTMLElement>(".rune-table-frame").forEach((frame) => {
                  const ctx = resolveTableFromFrame(editorView, frame)
                  if (ctx && ctx.tableStart === anchor.tableStart) {
                    activeFrame = frame
                  }
                })
              }
            }

            lastOrigin = origin
            lastTableStart = tableStart
            lastFrame = activeFrame

            dom.querySelectorAll(".rune-col-pill").forEach((pill) => {
              const frame = pill.closest(".rune-table-frame")
              ;(pill as HTMLElement).classList.toggle(
                "is-active",
                origin === "col" && frame !== null && frame === activeFrame,
              )
            })
            dom.querySelectorAll(".rune-row-pill").forEach((pill) => {
              const frame = pill.closest(".rune-table-frame")
              ;(pill as HTMLElement).classList.toggle(
                "is-active",
                origin === "row" && frame !== null && frame === activeFrame,
              )
            })
          }
          // Initial sync runs after PM finishes mounting decorations.
          queueMicrotask(sync)
          return { update: sync }
        },
      }),
    ]
  },
})

export function selectFullColumn(view: EditorView, pill: HTMLElement) {
  const frame = pill.closest(".rune-table-frame") as HTMLElement | null
  if (!frame) return
  const ctx = resolveTableFromFrame(view, frame)
  if (!ctx) return
  const col = Number(pill.dataset.col)
  if (!Number.isFinite(col) || col < 0 || col >= ctx.map.width) return

  const topCellStart = ctx.tableStart + (ctx.map.map[0 * ctx.map.width + col] ?? 0)
  const bottomCellStart = ctx.tableStart + (ctx.map.map[(ctx.map.height - 1) * ctx.map.width + col] ?? 0)
  const selection = new CellSelection(
    view.state.doc.resolve(topCellStart),
    view.state.doc.resolve(bottomCellStart),
  )

  // Re-click toggle: if the dropdown is already open for this exact
  // (tableStart, axis, index), close it. Otherwise (re)open at this
  // anchor. The CellSelection is dispatched in both branches so the
  // active grip stays accent-coloured even on close.
  const prev = cellHandlePillsKey.getState(view.state)?.dropdown
  const sameAnchor =
    prev && prev.tableStart === ctx.tableStart && prev.axis === "col" && prev.index === col
  const dropMeta = sameAnchor
    ? { close: true as const }
    : { open: { tableStart: ctx.tableStart, axis: "col" as const, index: col } }

  view.dispatch(
    view.state.tr
      .setSelection(selection)
      .setMeta(PILL_ORIGIN_META, "col")
      .setMeta(PILL_DROPDOWN_META, dropMeta),
  )
  view.focus()
}

export function selectFullRow(view: EditorView, pill: HTMLElement) {
  const frame = pill.closest(".rune-table-frame") as HTMLElement | null
  if (!frame) return
  const ctx = resolveTableFromFrame(view, frame)
  if (!ctx) return
  const row = Number(pill.dataset.row)
  if (!Number.isFinite(row) || row < 0 || row >= ctx.map.height) return

  const leftCellStart  = ctx.tableStart + (ctx.map.map[row * ctx.map.width + 0] ?? 0)
  const rightCellStart = ctx.tableStart + (ctx.map.map[row * ctx.map.width + (ctx.map.width - 1)] ?? 0)
  const selection = new CellSelection(
    view.state.doc.resolve(leftCellStart),
    view.state.doc.resolve(rightCellStart),
  )

  const prev = cellHandlePillsKey.getState(view.state)?.dropdown
  const sameAnchor =
    prev && prev.tableStart === ctx.tableStart && prev.axis === "row" && prev.index === row
  const dropMeta = sameAnchor
    ? { close: true as const }
    : { open: { tableStart: ctx.tableStart, axis: "row" as const, index: row } }

  view.dispatch(
    view.state.tr
      .setSelection(selection)
      .setMeta(PILL_ORIGIN_META, "row")
      .setMeta(PILL_DROPDOWN_META, dropMeta),
  )
  view.focus()
}

// A pill is "active" when the current CellSelection covers the full extent
// of its axis (full height for col pill, full width for row pill) and the
// pill's column/row falls inside the selection rect.
function activeAxes(
  selection: unknown,
  map: TableMap,
  col: number,
  row: number,
): { col: boolean; row: boolean } {
  if (!(selection instanceof CellSelection)) return { col: false, row: false }
  const tableDepth = selection.$anchorCell.depth - 1
  const tableStart = selection.$anchorCell.start(tableDepth)
  const rect = map.rectBetween(
    selection.$anchorCell.pos - tableStart,
    selection.$headCell.pos - tableStart,
  )
  return {
    col:
      rect.top === 0 &&
      rect.bottom === map.height &&
      col >= rect.left &&
      col < rect.right,
    row:
      rect.left === 0 &&
      rect.right === map.width &&
      row >= rect.top &&
      row < rect.bottom,
  }
}

type Anchor = {
  table: ProseMirrorNode
  tableStart: number
  row: number
  col: number
}

function selectionAnchor(selection: unknown): Anchor | null {
  if (selection instanceof CellSelection) {
    const tableDepth = selection.$anchorCell.depth - 1
    const table = selection.$anchorCell.node(tableDepth)
    const tableStart = selection.$anchorCell.start(tableDepth)
    const map = TableMap.get(table)
    const rect = map.rectBetween(
      selection.$anchorCell.pos - tableStart,
      selection.$headCell.pos - tableStart,
    )
    return { table, tableStart, row: rect.top, col: rect.left }
  }
  if (selection instanceof TextSelection && selection.empty) {
    const ctx = findCellContext(selection.$head)
    if (!ctx) return null
    return { table: ctx.table, tableStart: ctx.tableStart, row: ctx.row, col: ctx.col }
  }
  return null
}
