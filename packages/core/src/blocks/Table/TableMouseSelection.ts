// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { Extension } from "@tiptap/core"
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state"
import { CellSelection } from "@tiptap/pm/tables"
import { findCellBefore, findCellContext } from "./utilities/findCellContext"
import { claimGesture, isPrimaryRelease, primaryLost, type GestureClaim } from "../../extensions/shared/gesture-state"
import { registerDragCancelHandlers } from "../../extensions/shared"

// Table-scoped pointer gesture: drives intra-cell text selection and
// cross-cell CellSelection from raw DOM mouse events.
//
// This is a verbatim port of V1 ForceCellSelection's `view(view)`
// mouse-handler block, with two intentional changes:
//   1. The `appendTransaction` global-coercion branch is dropped — Enter
//      and programmatic flows must not be silently rewritten.
//   2. A same-table guard is added inside onMouseMove before dispatching
//      a cross-cell CellSelection (V1 doesn't enforce this).
//
// IMPORTANT — `findCellContext` only walks ancestors looking for a
// position whose ancestor chain contains a `tableRole === 'cell'` node.
// That ancestor only exists when the ResolvedPos is *inside* a cell.
// `findCellBefore` returns a position at row depth (just before the cell)
// — its ancestors are row → table → doc, no cell. Passing that to
// `findCellContext` returns null and silently kills the gesture. Always
// pass `view.state.doc.resolve(<docPos>)` from `posAtCoords`, never the
// output of `findCellBefore`.
export const TableMouseSelection = Extension.create({
  name: "tableMouseSelection",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("rune-table-mouse-selection"),

        view(view) {
          let startCellPos: number | null = null
          let startDocPos: number | null = null
          let manual = false
          let destroyed = false
          // GS-2/GS-6: Shared gesture claim handle. null = not yet claimed (or
          // already released). Populated at the promotion point (first real
          // cross-cell move). A null return from claimGesture() means another
          // gesture owns the registry — full local cleanup is required.
          let claim: GestureClaim | null = null
          // RC-3: Escape / pointercancel / window-blur cancellation. Registered
          // at the promotion point (when the gesture claims the registry), released
          // in cleanup() so every teardown path stays in lockstep.
          let unregisterCancel: (() => void) | null = null
          // Scope move/up to the editor's own document, not the top-level
          // window, so multiple editors on the same page don't cross-fire.
          const doc = view.dom.ownerDocument

          // Full local cleanup — runs on: claim refusal (GS-6), lost-mouseup
          // watchdog (GS-2b), editable-flip abort, and normal mouseup/destroy.
          // Listeners are permanent (registered once at plugin-view setup);
          // cleanup resets armed state, not the listeners themselves.
          const cleanup = () => {
            unregisterCancel?.()
            unregisterCancel = null
            claim?.release()
            claim = null
            // Gate on startCellPos — only remove rune-dragging if this plugin
            // added it. This handler is registered capture=true and fires
            // BEFORE block-drag's bubble mouseup. Unconditionally removing the
            // class triggers a synchronous PM MutationObserver flush while
            // removeAllRanges() left the DOM selection empty, which lets PM
            // stomp the live MultiBlockSelection with a TextSelection.
            if (startCellPos !== null) {
              view.dom.classList.remove("rune-dragging")
            }
            startCellPos = null
            startDocPos = null
            manual = false
          }

          const cellPosAtCoords = (x: number, y: number) => {
            const hit = view.posAtCoords({ left: x, top: y })
            if (!hit) return null
            const $p = view.state.doc.resolve(hit.pos)
            return { docPos: hit.pos, cellPos: findCellBefore($p)?.pos ?? null }
          }

          const onMouseDown = (e: MouseEvent) => {
            if (e.button !== 0) return
            if (!view.editable) return
            // Pill mousedowns are owned by the cell-handle pill widgets
            // (selection promotion / reorder). Capturing startCellPos here
            // would let onMouseMove dispatch a cross-cell CellSelection the
            // moment the drag pointer entered a neighbour cell.
            // Grip mousedowns are owned by block-drag/gesture.ts — bail so
            // TableMouseSelection never participates in a grip-initiated drag.
            const pillTarget = e.target as HTMLElement | null
            if (pillTarget?.closest(".rune-col-pill, .rune-row-pill, .rune-side-menu-grip")) {
              startCellPos = null
              startDocPos = null
              manual = false
              return
            }
            // Don't start a selection drag when the user grabs the
            // column-resize handle — let prosemirror-tables own that
            // gesture. The plugin's `.resize-cursor` class on the PM root
            // is the activation signal; the handle DOM is too narrow to
            // hit-test reliably (5px hit zone, 6px element).
            if (view.dom.classList.contains("resize-cursor")) {
              startCellPos = null
              startDocPos = null
              manual = false
              return
            }
            const at = cellPosAtCoords(e.clientX, e.clientY)
            if (!at) {
              startCellPos = null
              startDocPos = null
              manual = false
              return
            }
            startCellPos = at.cellPos
            startDocPos = at.docPos
            manual = false

            const sel = view.state.selection
            // Fast exit: if the click is not inside a cell and there is no
            // active CellSelection, this plugin has no work to do on this
            // mousedown. The only two dispatch branches below both require
            // either `at.cellPos !== null` (for intra-cell text drag) or
            // `sel instanceof CellSelection` (for dismiss). Clearing state
            // here prevents stale startDocPos from leaking into onMouseMove.
            if (at.cellPos === null && !(sel instanceof CellSelection)) {
              startCellPos = null
              startDocPos = null
              manual = false
              return
            }
            // Dismiss an active CellSelection in one transaction when the
            // press lands outside any cell. Without this, the browser's
            // default mousedown collapses the DOM selection to the nearest
            // text node — often inside the CellSelection's anchor cell —
            // producing a "selection shrinks then disappears" two-step.
            if (sel instanceof CellSelection && at.cellPos === null) {
              e.preventDefault()
              view.dispatch(
                view.state.tr.setSelection(
                  TextSelection.create(view.state.doc, at.docPos),
                ),
              )
              view.focus()
              return
            }

            const insideSelection =
              !sel.empty && at.docPos >= sel.from && at.docPos <= sel.to
            if (startCellPos !== null && insideSelection) {
              // Take over the interaction — block the browser's drag-prep
              // (which would otherwise swallow mousemove events and
              // collapse the cursor to the mouseup position).
              e.preventDefault()
              manual = true
              view.dispatch(
                view.state.tr.setSelection(
                  TextSelection.create(view.state.doc, at.docPos),
                ),
              )
              view.focus()
            }
          }

          const onMouseMove = (e: MouseEvent) => {
            if (destroyed) return
            if (startCellPos === null || startDocPos === null) return
            // GS-2b: lost-mouseup watchdog — primary button was released
            // outside the window (OS dialog, alt-tab, browser chrome). Run
            // full cleanup so no armed listeners linger (GS-6 semantics).
            if (primaryLost(e)) {
              cleanup()
              return
            }
            // AV-2 / editable-flip abort: view became read-only mid-gesture.
            // End the drag but leave the already-dispatched selection intact
            // (selection-only gesture; no doc mutation to roll back).
            if (!view.editable) {
              cleanup()
              return
            }
            const at = cellPosAtCoords(e.clientX, e.clientY)
            if (!at || at.cellPos === null) return

            // Mark the editor as dragging on first real mousemove (not on
            // mousedown — otherwise a plain click would toggle it for the
            // whole click-and-hold). CSS uses this to hide the column-
            // resize handle so it doesn't flash under the cursor as the
            // selection sweeps across cell boundaries.
            view.dom.classList.add("rune-dragging")
            // Promotion point: a real table-cell sweep is underway. Claim the
            // central registry so other gestures refuse and hover suppresses.
            // GS-6: if claim is refused (another gesture owns the registry),
            // run full local cleanup and stop — no armed listeners survive.
            if (claim === null) {
              claim = claimGesture(view, "table-select")
              if (claim === null) {
                cleanup()
                return
              }
              // RC-3: register Escape / pointercancel / window-blur cancellation
              // at the promotion point. cleanup() releases these in lockstep.
              unregisterCancel?.()
              unregisterCancel = registerDragCancelHandlers(cleanup)
            }

            if (at.cellPos !== startCellPos) {
              // Same-table guard (absent from V1 — cross-table drag is
              // broken there). Both calls pass the *doc position*
              // (inside-cell) into `findCellContext`; passing the cell-
              // before pos returns null and silently kills the gesture.
              const startCtx = findCellContext(view.state.doc.resolve(startDocPos))
              const headCtx = findCellContext(view.state.doc.resolve(at.docPos))
              if (!startCtx || !headCtx) return
              if (startCtx.tableStart !== headCtx.tableStart) return

              const $a = view.state.doc.resolve(startCellPos)
              const $b = view.state.doc.resolve(at.cellPos)
              view.dispatch(
                view.state.tr.setSelection(new CellSelection($a, $b)),
              )
            } else if (manual && at.docPos !== startDocPos) {
              view.dispatch(
                view.state.tr.setSelection(
                  TextSelection.create(
                    view.state.doc,
                    startDocPos,
                    at.docPos,
                  ),
                ),
              )
            }
          }

          const onMouseUp = (e: MouseEvent) => {
            // GS-2: only the primary button release ends a gesture. A right-
            // click or middle-click mouseup during a table-cell drag must not
            // prematurely release the registry or clear the armed state.
            if (!isPrimaryRelease(e)) return
            // cleanup() handles: rune-dragging removal (gated on startCellPos
            // so we only remove what we added), registry release, and state
            // reset.
            cleanup()
          }

          view.dom.addEventListener("mousedown", onMouseDown, true)
          doc.addEventListener("mousemove", onMouseMove)
          doc.addEventListener("mouseup", onMouseUp, true)

          return {
            destroy() {
              destroyed = true
              cleanup()
              view.dom.removeEventListener("mousedown", onMouseDown, true)
              doc.removeEventListener("mousemove", onMouseMove)
              doc.removeEventListener("mouseup", onMouseUp, true)
            },
          }
        },
      }),
    ]
  },
})
