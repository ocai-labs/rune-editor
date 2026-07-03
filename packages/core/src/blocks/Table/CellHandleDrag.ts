// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Drag-to-reorder for table columns and rows.
//
// Gesture ownership rules:
//  1. Mousedown does NOT claim the gesture; refuse if activeGesture is non-null.
//  2. Pointer movement >4px from mousedown promotes to cell-drag (claimGesture()
//     + create indicator + register cancel handlers + blur view.dom).
//  3. Cleanup releases via claim.release() — race-safe (no-op if already stolen).
//  4. Below-threshold mouseup → click-select via CellHandlePills' click path.
//  5. Lost-primary watchdog: mousemove with buttons:0 → abort (GS-2).
//  6. Only primary mouseup (button:0) commits; other buttons ignored (GS-2).
//  7. Doc-mutating commit gates on claim.canCommit (owned && view.editable, AV-2).
//
// Why we blur view.dom on claim (and refocus on every claimed cleanup): every
// browser mousemove inside contenteditable=true mutates the native DOM
// selection toward whichever cell the cursor sits in; PM's DOMObserver then
// flushes that change as a TextSelection update, silently overwriting the
// pill-driven CellSelection mid-drag. Symptom: pills chase the cursor across
// cells. Blurring removes the DOM selection altogether so the observer has
// nothing to flush; PM's CellSelection in state survives untouched, the
// source column stays painted, and on drop/cancel view.focus() puts the user
// back where they were.
//
// DOM ownership:
//  - Drop indicator: mounted in .rune-table-frame (inherits editor cascade).
//  - Drag preview:   portaled to document.body with position:fixed and the
//    .rune-editor class so cascade still applies but stacking context is the
//    viewport root — this keeps the preview above any in-page chrome.
// All listeners attach to view.dom.ownerDocument.
import { Extension } from "@tiptap/core"
import { Plugin, PluginKey, type Selection } from "@tiptap/pm/state"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import type { EditorView } from "@tiptap/pm/view"
import { CellSelection } from "@tiptap/pm/tables"
import { gestureKey, claimGesture, isPrimaryRelease, primaryLost } from "../../extensions/shared/gesture-state"
import type { GestureClaim } from "../../extensions/shared/gesture-state"
import { registerDragCancelHandlers } from "../../extensions/shared/drag-utils"
import { PILL_ORIGIN_META } from "./CellHandlePills"
import { resolveTableFromFrame } from "./utilities/resolveTableFromFrame"
import { isTableHeaderRow, isTableHeaderColumn } from "./TableCommands"

const DRAG_THRESHOLD_PX = 4
type Orientation = "col" | "row"

export const CellHandleDrag = Extension.create({
  name: "cellHandleDrag",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("rune-cell-handle-drag"),
        view(view) { return setupDrag(view) },
      }),
    ]
  },
})

function setupDrag(view: EditorView) {
  // Resolve once. Editor may be hosted in an iframe; chrome listeners must
  // attach to the editor's owner document, not the host page's `document`.
  const ownerDoc = view.dom.ownerDocument

  let downX = 0, downY = 0
  let pillEl: HTMLElement | null = null
  let frameEl: HTMLElement | null = null
  // Capture scrollEl alongside frameEl so teardown can still reach it after
  // frameEl has been cleared.
  let scrollEl: HTMLElement | null = null
  let resolved: ReturnType<typeof resolveTableFromFrame> = null
  let activeClaim: GestureClaim | null = null
  let preview: HTMLElement | null = null
  let indicator: HTMLElement | null = null
  let cancelCleanup: (() => void) | null = null
  let scrollListener: (() => void) | null = null
  let geom: ReturnType<typeof snapshotGeom> | null = null
  let orientation: Orientation = "col"
  let fromIdx = 0
  let targetIdx = 0
  let lastPointer = { x: 0, y: 0 }
  // Pre-drag CellSelection captured at claim time; restored on every
  // cancel path (Escape / pointercancel / blur / drop-on-source). PM's
  // DOMObserver flushes browser-side selection mutations into PM state
  // throughout the drag (view.dom.blur in claim narrows the window but
  // does not eliminate it — DOMObserver flush can still run on focus
  // restore and on the post-cleanup view.focus()). Memory:
  // project_pm_dom_observer_overrides_custom_selection.md ("reclaim
  // must restore selection AND anchor"). Capturing the original
  // CellSelection (and its pill origin) lets cleanup re-dispatch it
  // explicitly, surviving any intermediate observer-driven overrides.
  let preDragSelection: Selection | null = null
  let preDragOrigin: "col" | "row" | null = null

  const teardownDom = () => {
    preview?.remove(); preview = null
    indicator?.remove(); indicator = null
    if (scrollListener && scrollEl) {
      scrollEl.removeEventListener("scroll", scrollListener)
    }
    scrollListener = null
    scrollEl = null
    view.dom.classList.remove("rune-dragging")
  }

  // CANCEL CONTRACT: this plugin must NEVER dispatch a selection-mutating
  // transaction during a drag (only the final moveSlice on a successful drop).
  // The cancel paths (Escape, pointercancel, blur, drop-on-source) rely on
  // the pre-drag selection being intact.
  // NOTE: teardownDom() runs BEFORE clearing frameEl/scrollEl so teardown can
  // still reach the scroll element.
  const finalizeAndClear = () => {
    activeClaim?.release(); activeClaim = null
    cancelCleanup?.(); cancelCleanup = null
    ownerDoc.removeEventListener("mousemove", onMouseMove)
    ownerDoc.removeEventListener("mouseup", onMouseUp)
    // Tear down DOM (which uses scrollEl) BEFORE clearing scrollEl/frameEl.
    teardownDom()
    pillEl = null
    frameEl = null
    resolved = null
    geom = null
    // preDragSelection / preDragOrigin are NOT reset here — callers
    // (cancel handlers, onMouseUp) read them after finalizeAndClear()
    // to restore the pre-drag CellSelection. They get cleared at the
    // end of each terminal handler.
  }

  const clearPreDragCapture = () => {
    preDragSelection = null
    preDragOrigin = null
  }

  const reclaimSelection = () => {
    const captured = preDragSelection
    const capturedOrigin = preDragOrigin
    if (!captured) return
    try {
      const tr = view.state.tr.setSelection(
        captured.map(view.state.doc, view.state.tr.mapping),
      )
      if (capturedOrigin) tr.setMeta(PILL_ORIGIN_META, capturedOrigin)
      view.dispatch(tr)
    } catch { /* selection no longer valid (rare: tree changed) */ }
  }

  const claim = () => {
    if (!frameEl || !pillEl || !resolved) return
    const tableEl = pillEl.closest("table") as HTMLTableElement | null
    if (!tableEl) return

    // Capture pre-drag selection BEFORE dispatching anything (which can
    // mutate PM state) so cancel paths have a fixed reference to restore.
    // Origin is read off the pill class — that's the only reliable
    // signal at this point since the pills plugin's own state may have
    // already cleared on a sub-threshold mousemove that triggered an
    // observer flush.
    preDragSelection = view.state.selection
    preDragOrigin = pillEl.classList.contains("rune-col-pill") ? "col" : "row"

    // claimGesture refuses if another gesture already owns the registry or
    // the view is destroyed. A null return means the caller must run full
    // local cleanup and stop — no armed listeners survive (GS-6).
    const newClaim = claimGesture(view, "cell-drag")
    if (!newClaim) {
      // Clear the pre-drag capture we just set — claim failed, no drag.
      clearPreDragCapture()
      // finalizeAndClear handles listener removal and field reset. activeClaim
      // is still null here (we haven't assigned newClaim yet), so its
      // claim?.release() is a no-op — safe to call as the shared disarm path.
      finalizeAndClear()
      return
    }
    activeClaim = newClaim
    view.dom.classList.add("rune-dragging")
    // See header §"Why we blur view.dom on claim". Removes the DOM selection
    // so PM's DOMObserver can't flush mousemove caret jumps into TextSelection.
    try { (view.dom as HTMLElement).blur() } catch { /* jsdom edge cases */ }

    geom = snapshotGeom(tableEl, frameEl)
    indicator = createIndicator(view, frameEl)
    preview = createPreview(view, frameEl, tableEl, orientation, fromIdx)
    cancelCleanup = registerDragCancelHandlers(() => {
      finalizeAndClear()
      // Reclaim BEFORE view.focus(): focus restore can trigger PM's
      // DOMObserver to flush the (now-empty) browser selection as a
      // collapsed TextSelection, clobbering whatever selection PM
      // currently holds. Re-dispatch the captured CellSelection with
      // the original PILL_ORIGIN_META so CellHandlePills' state-apply
      // restores `origin` (which drives the pill is-active class).
      reclaimSelection()
      clearPreDragCapture()
      try { view.focus() } catch { /* destroyed */ }
      // Swallow the post-mouseup synthetic click that the browser
      // dispatches on whichever element the cursor is over. Without
      // this, PM's cell-click handler would re-collapse the just-
      // reclaimed CellSelection into a TextSelection at that cell.
      // Capture-phase + scoped to clicks inside view.dom + one-shot.
      armPostDragClickSwallow(view, ownerDoc)
    })
    // Paint preview + indicator on the same frame as claim() so the user
    // sees the drag chrome immediately. Without this, onMouseMove returns
    // early on the move that triggered claim (activeClaim=null → claim() →
    // return), and only the *next* mousemove actually positions them — so
    // for one frame the preview sits at its CSS-static fallback (top-left
    // of viewport) and the indicator sits at frame (0,0).
    targetIdx = orientation === "col"
      ? colIndexAtX(geom, lastPointer.x)
      : rowIndexAtY(geom, lastPointer.y)
    positionPreview(preview, orientation, lastPointer.x, lastPointer.y, geom, frameEl)
    showIndicator(indicator, orientation, targetIdx, fromIdx, geom)

    scrollEl = frameEl.closest(".rune-table-scroll") as HTMLElement | null
    if (scrollEl) {
      scrollListener = () => {
        if (preview && geom && frameEl) positionPreview(preview, orientation, lastPointer.x, lastPointer.y, geom, frameEl)
        if (indicator && geom) showIndicator(indicator, orientation, targetIdx, fromIdx, geom)
      }
      scrollEl.addEventListener("scroll", scrollListener)
    }
  }

  const onMouseDown = (e: MouseEvent) => {
    if (!view.editable) return
    if (e.button !== 0) return
    const target = e.target as HTMLElement | null
    if (!target) return
    const pill = target.closest<HTMLElement>(".rune-col-pill, .rune-row-pill")
    if (!pill) {
      // Not our gesture — defer to whoever else handles non-pill mousedowns.
      return
    }
    // Pill mousedowns are our entry point. CellHandlePills has already called
    // preventDefault on this event (to suppress PM's default caret placement);
    // that's expected — do NOT use defaultPrevented as a bail signal here.
    if (gestureKey.getState(view.state)?.activeGesture != null) return

    const frame = pill.closest<HTMLElement>(".rune-table-frame")
    if (!frame) return
    const ctx = resolveTableFromFrame(view, frame)
    if (!ctx) return

    orientation = pill.classList.contains("rune-col-pill") ? "col" : "row"
    const idx = orientation === "col" ? Number(pill.dataset.col) : Number(pill.dataset.row)
    if (!Number.isFinite(idx) || idx < 0) return

    pillEl = pill
    frameEl = frame
    resolved = ctx
    fromIdx = idx
    targetIdx = idx
    downX = e.clientX
    downY = e.clientY
    // Seed lastPointer at mousedown so the first claim() (which fires from
    // onMouseMove with up-to-date coords) doesn't read a stale (0,0) if it
    // somehow runs before onMouseMove updates lastPointer.
    lastPointer = { x: e.clientX, y: e.clientY }
    activeClaim = null

    ownerDoc.addEventListener("mousemove", onMouseMove)
    ownerDoc.addEventListener("mouseup", onMouseUp)
  }

  const onMouseMove = (e: MouseEvent) => {
    lastPointer = { x: e.clientX, y: e.clientY }
    // Lost-primary watchdog (GS-2): covers both the pre-claim 4px window and
    // post-claim moves. Primary button no longer held → abort, never commit.
    if (primaryLost(e)) {
      if (activeClaim) {
        // Claimed drag: full abort path — restore pre-drag selection.
        finalizeAndClear()
        reclaimSelection()
        clearPreDragCapture()
        try { view.focus() } catch { /* destroyed */ }
      } else {
        // Pre-claim window: just remove listeners and reset state.
        ownerDoc.removeEventListener("mousemove", onMouseMove)
        ownerDoc.removeEventListener("mouseup", onMouseUp)
        pillEl = null; frameEl = null; resolved = null
      }
      return
    }
    if (!activeClaim) {
      // Pre-claim window: every browser mousemove inside contenteditable
      // extends the native DOM selection toward the cursor. PM's
      // DOMObserver flushes that as a TextSelection, clobbering the
      // pre-drag CellSelection. removeAllRanges sweeps any partial range
      // that crept in (works inside contenteditable where CSS
      // user-select:none does nothing — see memory
      // project_user_select_contenteditable.md). NOT calling
      // preventDefault here: in Playwright synthetic mousemoves it
      // appears to interact with the threshold-cross path and
      // intermittently suppresses claim(). The reclaim on cancel paths
      // (below) is the authoritative restore — this is best-effort
      // suppression of the in-flight clobber.
      ownerDoc.getSelection()?.removeAllRanges()
      if (Math.hypot(e.clientX - downX, e.clientY - downY) >= DRAG_THRESHOLD_PX) claim()
      return
    }
    if (!preview || !indicator || !geom || !frameEl) return
    positionPreview(preview, orientation, e.clientX, e.clientY, geom, frameEl)
    targetIdx = orientation === "col"
      ? colIndexAtX(geom, e.clientX)
      : rowIndexAtY(geom, e.clientY)
    showIndicator(indicator, orientation, targetIdx, fromIdx, geom)
  }

  const onMouseUp = (e: MouseEvent) => {
    // Only the primary button release ends a gesture (GS-2).
    if (!isPrimaryRelease(e)) return
    if (!activeClaim) {
      // Below-threshold: let CellHandlePills' click handler dispatch the selection.
      // Do NOT release (we never claimed).
      ownerDoc.removeEventListener("mousemove", onMouseMove)
      ownerDoc.removeEventListener("mouseup", onMouseUp)
      pillEl = null; frameEl = null; resolved = null
      return
    }
    const moved = targetIdx !== fromIdx && resolved != null && targetIdx >= 0
      && targetIdx < (orientation === "col" ? resolved.map.width : resolved.map.height)
    const ctxAtDrop = resolved
    // Capture canCommit BEFORE finalizeAndClear() releases the claim (AV-2).
    const okToCommit = activeClaim.canCommit
    finalizeAndClear()
    if (moved && ctxAtDrop && okToCommit) {
      moveSlice(view, ctxAtDrop.tableStart, orientation, fromIdx, targetIdx)
    } else {
      // Drop-on-source, non-move, or editable flipped off (AV-2): same
      // selection-restore contract as the cancel paths. Without this, the
      // post-mouseup synthetic click + observer flush can collapse the
      // pre-drag CellSelection into a TextSelection at the cursor's cell.
      reclaimSelection()
    }
    clearPreDragCapture()
    // Always refocus on a claimed drag's exit — claim() blurred view.dom and
    // cancel paths now share this responsibility via the cancel callback.
    try { view.focus() } catch { /* destroyed */ }
    // Same synthetic-click swallow as the cancel paths — even when the
    // drag dropped (moved or on-source), the click that follows mouseup
    // would re-clobber the just-restored or just-moved selection.
    armPostDragClickSwallow(view, ownerDoc)
  }

  view.dom.addEventListener("mousedown", onMouseDown)

  return {
    destroy() {
      view.dom.removeEventListener("mousedown", onMouseDown)
      finalizeAndClear()
    },
  }
}

// ---------------------------------------------------------------------------
// Post-drag synthetic-click suppression (issue #203 ask 1)
// ---------------------------------------------------------------------------

// Browsers fire a synthetic `click` on the element under the cursor at
// mouseup, regardless of how the gesture ended (drop on neighbour, drop
// on source, Escape, pointercancel, blur). PM's cell-click handler
// would then collapse the just-reclaimed CellSelection into a
// TextSelection at that cell. The `reclaimSelection()` above re-
// dispatches the pre-drag selection BEFORE this swallow arms — so even
// if the click somehow slipped through, the in-state selection is
// already correct; the swallow just prevents the click from running PM's
// default cell-click → caret-set handler. Capture-phase + scoped to
// view.dom so we don't suppress link/button activation outside the
// editor; one-shot (self-removes on first fire) and capped at 250ms so a
// never-fired click can't leave the listener live.
function armPostDragClickSwallow(view: EditorView, doc: Document): void {
  const onClick = (e: MouseEvent) => {
    doc.removeEventListener("click", onClick, true)
    if (e.target instanceof Node && view.dom.contains(e.target)) {
      e.preventDefault()
      e.stopPropagation()
    }
  }
  doc.addEventListener("click", onClick, true)
  setTimeout(() => doc.removeEventListener("click", onClick, true), 250)
}

// ---------------------------------------------------------------------------
// Indicator — frame-mounted (position: absolute in frame coords)
// ---------------------------------------------------------------------------

function createIndicator(view: EditorView, frame: HTMLElement): HTMLElement {
  const doc = view.dom.ownerDocument
  const el = doc.createElement("div")
  el.className = "rune-table-drop-indicator"
  el.setAttribute("contenteditable", "false")
  el.style.display = "none"
  frame.appendChild(el)
  return el
}

// ---------------------------------------------------------------------------
// Preview — body-portaled with position:fixed (see header comment for why)
// ---------------------------------------------------------------------------

// 2×3 dot grip — same SVG as CellHandlePills, inlined so the preview has zero
// coupling to pill rendering.
const PREVIEW_GRIP_PATH =
  "M6.25 4a1.25 1.25 0 1 0 2.5 0 1.25 1.25 0 0 0-2.5 0m5 0a1.25 1.25 0 1 0 2.5 0 1.25 1.25 0 0 0-2.5 0m1.25 7.25a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5M6.25 10a1.25 1.25 0 1 0 2.5 0 1.25 1.25 0 0 0-2.5 0m6.25 7.25a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5M6.25 16a1.25 1.25 0 1 0 2.5 0 1.25 1.25 0 0 0-2.5 0"

// Floating preview: clones each cell from the dragged column/row with its
// live width / height / padding / colors copied inline so the preview matches
// the source's geometry exactly. Stacks them on the same axis inside a real
// `<table>` (border-collapse: collapse + table-layout: fixed) so adjacent
// cell borders collapse the same way the source does — without a real table
// the clone stack ends up (rows-1)px taller than the source. Overlays an
// accent border + grip badge on top.
//
// Ported from rune-v1 src/editor/blocks/table/CellHandleDrag.ts; rune-v1's
// design is what the user signed off on.
function createPreview(
  view: EditorView,
  _frame: HTMLElement,
  sourceTable: HTMLTableElement,
  orientation: Orientation,
  idx: number,
): HTMLElement {
  const doc = view.dom.ownerDocument
  const isCol = orientation === "col"
  const editorDom = view.dom as HTMLElement
  const accent = getComputedStyle(editorDom).getPropertyValue("--editor-accent").trim() || "oklch(60.495% 0.147223 257.563)"
  const border = getComputedStyle(editorDom).getPropertyValue("--rune-table-border").trim() || "#e5e7eb"

  const wrapper = doc.createElement("div")
  // .rune-editor on the wrapper keeps the editor's CSS variables + descendant
  // selectors live even though the wrapper lives at document.body.
  wrapper.className = "rune-editor rune-table-drag-preview"
  wrapper.setAttribute("contenteditable", "false")

  const previewTable = doc.createElement("table")
  previewTable.className = Array.from(sourceTable.classList).join(" ")
  previewTable.style.borderCollapse = "collapse"
  previewTable.style.tableLayout = "fixed"

  // Clone the source's <colgroup> so the preview reproduces column widths
  // exactly. With `table-layout: fixed`, browsers size cells from the col
  // widths — measuring each cell with getBoundingClientRect (rune-v1's
  // approach) drops fractional pixels and disagrees with the source whenever
  // border-collapse half-borders shift things by 1px. For col-drag we keep
  // only the col at `idx`; for row-drag we keep them all.
  const sourceColgroup = sourceTable.querySelector("colgroup")
  if (sourceColgroup) {
    const clonedColgroup = sourceColgroup.cloneNode(true) as HTMLElement
    if (isCol) {
      const cols = Array.from(clonedColgroup.children)
      cols.forEach((col, i) => { if (i !== idx) col.remove() })
    }
    previewTable.appendChild(clonedColgroup)
  }

  const previewBody = doc.createElement("tbody")
  previewTable.appendChild(previewBody)

  const sourceRows = Array.from(sourceTable.querySelectorAll<HTMLTableRowElement>("tbody > tr"))
  const sourceCells: HTMLElement[] = isCol
    ? (sourceRows
        .map((r) => cellAtVisualCol(r, idx))
        .filter(Boolean) as HTMLElement[])
    : sourceRows[idx]
      ? (Array.from(sourceRows[idx]!.children) as HTMLElement[])
      : []

  let sharedRow: HTMLTableRowElement | null = null
  if (!isCol) {
    sharedRow = doc.createElement("tr")
    previewBody.appendChild(sharedRow)
  }

  for (const cell of sourceCells) {
    const clone = cell.cloneNode(true) as HTMLElement
    // Strip rune-specific chrome that would render at absurd offsets in the
    // detached preview wrapper (pill widgets, columnResize handles), and any
    // selection accents that would look like a stuck selection on the float.
    clone.querySelectorAll(".rune-col-pill, .rune-row-pill, .column-resize-handle").forEach((n) => n.remove())
    clone.querySelectorAll(".selectedCell, .cursorCell").forEach((n) => {
      n.classList.remove(
        "selectedCell", "cursorCell",
        "sel-edge-top", "sel-edge-right", "sel-edge-bottom", "sel-edge-left",
      )
    })
    clone.querySelectorAll<HTMLElement>("[contenteditable]").forEach((n) => n.removeAttribute("contenteditable"))
    clone.querySelectorAll<HTMLElement>("[data-id]").forEach((n) => n.removeAttribute("data-id"))

    // Width comes from the cloned <colgroup> via table-layout:fixed (above);
    // setting an inline `width` here would override that and lose the source's
    // exact column widths. Height is set explicitly so each cell row matches
    // the source's row height (table-layout:fixed only fixes col widths).
    const cs = getComputedStyle(cell)
    const rect = cell.getBoundingClientRect()
    clone.style.cssText = `
      height: ${rect.height}px;
      background: ${cs.backgroundColor};
      border: 1px solid ${border};
      padding: ${cs.padding};
      box-sizing: border-box;
      overflow: hidden;
      color: ${cs.color};
      font: ${cs.font};
      text-align: ${cs.textAlign};
      vertical-align: ${cs.verticalAlign};
      font-weight: ${cs.fontWeight};
    `
    if (isCol) {
      const tr = doc.createElement("tr")
      tr.appendChild(clone)
      previewBody.appendChild(tr)
    } else {
      sharedRow!.appendChild(clone)
    }
  }
  wrapper.appendChild(previewTable)

  // Accent-border overlay sized to the preview's content box.
  const overlay = doc.createElement("div")
  overlay.style.cssText = `
    position: absolute;
    inset: 0;
    border: 2px solid ${accent};
    border-radius: 2px;
    pointer-events: none;
  `
  wrapper.appendChild(overlay)

  // Grip badge — anchored to the leading edge of the dragged axis.
  const grip = doc.createElement("div")
  grip.className = "rune-table-drag-preview-grip"
  grip.style.background = accent
  grip.style.borderColor = accent
  grip.innerHTML = `<svg viewBox="0 0 20 20" aria-hidden="true"${isCol ? ' style="transform:rotate(90deg)"' : ""}><path d="${PREVIEW_GRIP_PATH}"/></svg>`
  if (isCol) {
    grip.style.width = "22px"
    grip.style.height = "14px"
    grip.style.top = "-9px"
    grip.style.left = "50%"
    grip.style.translate = "-50% 0"
  } else {
    grip.style.width = "14px"
    grip.style.height = "22px"
    grip.style.left = "-9px"
    grip.style.top = "50%"
    grip.style.translate = "0 -50%"
  }
  wrapper.appendChild(grip)

  doc.body.appendChild(wrapper)
  return wrapper
}

// Rune rejects colspan/rowspan > 1 at parse time (TableMergedCellsGuard
// + nodes.ts attr coercion), so visual column index = DOM child index.
function cellAtVisualCol(row: HTMLTableRowElement, visualIdx: number): HTMLElement | null {
  return (row.children[visualIdx] as HTMLElement | undefined) ?? null
}

// ---------------------------------------------------------------------------
// Geometry snapshot — in FRAME coordinates (subtract frame.getBoundingClientRect)
// ---------------------------------------------------------------------------

function snapshotGeom(tableEl: HTMLTableElement, frame: HTMLElement) {
  const frameRect = frame.getBoundingClientRect()
  const rows = Array.from(tableEl.querySelectorAll("tr"))
  const firstRow = rows[0]
  const firstCells = firstRow ? Array.from(firstRow.querySelectorAll("td, th")) : []
  const colLefts: number[] = []
  const colRights: number[] = []
  for (const cell of firstCells) {
    const r = cell.getBoundingClientRect()
    colLefts.push(r.left - frameRect.left)
    colRights.push(r.right - frameRect.left)
  }
  const rowTops: number[] = []
  const rowBottoms: number[] = []
  for (const row of rows) {
    const r = row.getBoundingClientRect()
    rowTops.push(r.top - frameRect.top)
    rowBottoms.push(r.bottom - frameRect.top)
  }
  const tableR = tableEl.getBoundingClientRect()
  return {
    tableTop: tableR.top - frameRect.top,
    tableBottom: tableR.bottom - frameRect.top,
    tableLeft: tableR.left - frameRect.left,
    tableRight: tableR.right - frameRect.left,
    colLefts, colRights, rowTops, rowBottoms,
    frameLeft: frameRect.left, frameTop: frameRect.top,
  }
}

// ---------------------------------------------------------------------------
// Drop target resolution
// ---------------------------------------------------------------------------

function colIndexAtX(geom: ReturnType<typeof snapshotGeom>, clientX: number): number {
  const x = clientX - geom.frameLeft
  for (let i = 0; i < geom.colRights.length; i++) {
    if (x < geom.colRights[i]!) return i
  }
  return Math.max(0, geom.colRights.length - 1)
}

function rowIndexAtY(geom: ReturnType<typeof snapshotGeom>, clientY: number): number {
  const y = clientY - geom.frameTop
  for (let i = 0; i < geom.rowBottoms.length; i++) {
    if (y < geom.rowBottoms[i]!) return i
  }
  return Math.max(0, geom.rowBottoms.length - 1)
}

// ---------------------------------------------------------------------------
// Indicator positioning — in frame coordinates via transform
// ---------------------------------------------------------------------------

function showIndicator(
  indicator: HTMLElement,
  orientation: Orientation,
  targetIdx: number,
  fromIdx: number,
  geom: ReturnType<typeof snapshotGeom>,
) {
  // moveSlice splices the source out before inserting at targetIdx. For
  // forward drags (fromIdx < targetIdx) that means the moved slice ends up
  // AFTER the target column/row, so the visual indicator must sit on the
  // target's far edge to match the actual final position. Backward and
  // same-index drags land before the target, so they use the near edge.
  const after = fromIdx < targetIdx
  indicator.style.display = "block"
  if (orientation === "col") {
    const lastIdx = geom.colRights.length - 1
    const edgeX = targetIdx >= geom.colLefts.length
      ? geom.colRights[lastIdx] ?? geom.tableRight
      : after
        ? geom.colRights[targetIdx] ?? geom.tableRight
        : geom.colLefts[targetIdx] ?? geom.tableLeft
    indicator.style.width = "var(--rune-sel-border-width)"
    indicator.style.height = `${geom.tableBottom - geom.tableTop}px`
    indicator.style.transform = `translate(${edgeX - 1}px, ${geom.tableTop}px)`
  } else {
    const lastIdx = geom.rowBottoms.length - 1
    const edgeY = targetIdx >= geom.rowTops.length
      ? geom.rowBottoms[lastIdx] ?? geom.tableBottom
      : after
        ? geom.rowBottoms[targetIdx] ?? geom.tableBottom
        : geom.rowTops[targetIdx] ?? geom.tableTop
    indicator.style.height = "var(--rune-sel-border-width)"
    indicator.style.width = `${geom.tableRight - geom.tableLeft}px`
    indicator.style.transform = `translate(${geom.tableLeft}px, ${edgeY - 1}px)`
  }
}

// ---------------------------------------------------------------------------
// Preview positioning — viewport coords (preview is position:fixed under body)
// ---------------------------------------------------------------------------

function positionPreview(
  preview: HTMLElement,
  orientation: Orientation,
  clientX: number,
  clientY: number,
  geom: ReturnType<typeof snapshotGeom>,
  frame: HTMLElement,
) {
  // Re-read frame rect each call so the perpendicular-axis anchor (table top
  // for col-drag, table left for row-drag) tracks the table when the page or
  // table-scroll element scrolls under the cursor.
  const frameRect = frame.getBoundingClientRect()
  const r = preview.getBoundingClientRect()
  if (orientation === "col") {
    const tableTopVp = frameRect.top + geom.tableTop
    preview.style.transform = `translate(${clientX - r.width / 2}px, ${tableTopVp}px)`
  } else {
    const tableLeftVp = frameRect.left + geom.tableLeft
    preview.style.transform = `translate(${tableLeftVp}px, ${clientY - r.height / 2}px)`
  }
}

// ---------------------------------------------------------------------------
// moveSlice — reorder the table node and restore CellSelection at new index.
// tableStart is passed fresh at drop time (not snapshotted at drag start) so
// the lookup is resilient to intervening doc edits.
// ---------------------------------------------------------------------------

function moveSlice(
  view: EditorView,
  tableStart: number,
  orientation: Orientation,
  fromIdx: number,
  toIdx: number,
) {
  if (fromIdx === toIdx) return
  const { state } = view
  let tableNode
  let tableBefore = -1
  try {
    const $pos = state.doc.resolve(tableStart)
    if ($pos.parent.type.spec.tableRole !== "table") return
    tableNode = $pos.parent
    tableBefore = tableStart - 1
  } catch { return }

  // Header row/col are not stored as table-level flags — they're inferred
  // from "row 0 / col 0 cells are all tableHeader" (see TableCommands
  // toggleHeaderRow/Column). We snapshot that BEFORE the splice so the
  // header status stays positional across the move: cells dragged out of
  // the header row/col become tableCell, cells dragged in become
  // tableHeader. Without this, th/td would travel with the moved slice
  // and the header tint + bold would land at the new column/row.
  // Reuse the canonical helpers from TableCommands so drag and the
  // toggle command share one definition of "header row / col".
  const headerRow = isTableHeaderRow(tableNode, 0)
  const headerCol = isTableHeaderColumn(tableNode, 0)
  const tableCellType = state.schema.nodes["tableCell"]
  const tableHeaderType = state.schema.nodes["tableHeader"]
  if (!tableCellType || !tableHeaderType) return
  const retypeCell = (cell: ProseMirrorNode, r: number, c: number): ProseMirrorNode => {
    const wantHeader = (r === 0 && headerRow) || (c === 0 && headerCol)
    const wantType = wantHeader ? tableHeaderType : tableCellType
    if (cell.type === wantType) return cell
    return wantType.create(cell.attrs, cell.content, cell.marks)
  }

  let newTable
  if (orientation === "col") {
    // Guard: bail if fromIdx is out of range (belt-and-suspenders for merged cells).
    for (let i = 0; i < tableNode.childCount; i++) {
      if (fromIdx >= tableNode.child(i).childCount) return
    }
    const newRows = []
    for (let i = 0; i < tableNode.childCount; i++) {
      const rowNode = tableNode.child(i)
      const cells = []
      for (let j = 0; j < rowNode.childCount; j++) cells.push(rowNode.child(j))
      const moved = cells.splice(fromIdx, 1)[0]
      if (!moved) return
      cells.splice(toIdx, 0, moved)
      const retyped = cells.map((cell, c) => retypeCell(cell, i, c))
      newRows.push(rowNode.type.create(rowNode.attrs, retyped))
    }
    newTable = tableNode.type.create(tableNode.attrs, newRows)
  } else {
    if (fromIdx >= tableNode.childCount) return
    const rows = []
    for (let i = 0; i < tableNode.childCount; i++) rows.push(tableNode.child(i))
    const moved = rows.splice(fromIdx, 1)[0]
    if (!moved) return
    rows.splice(toIdx, 0, moved)
    const retypedRows = rows.map((rowNode, r) => {
      const cells = []
      for (let c = 0; c < rowNode.childCount; c++) cells.push(retypeCell(rowNode.child(c), r, c))
      return rowNode.type.create(rowNode.attrs, cells)
    })
    newTable = tableNode.type.create(tableNode.attrs, retypedRows)
  }

  const tr = state.tr.replaceWith(tableBefore, tableBefore + tableNode.nodeSize, newTable)

  // Restore CellSelection covering the moved slice at its new position.
  try {
    const newDoc = tr.doc
    const $tableStart = newDoc.resolve(tableStart)
    const newTableNode = $tableStart.parent
    if (newTableNode.type.spec.tableRole === "table") {
      const cellPositions: number[] = []
      let rowOffset = 0
      for (let r = 0; r < newTableNode.childCount; r++) {
        const rowNode = newTableNode.child(r)
        if (orientation === "col") {
          let off = 0
          for (let i = 0; i < toIdx; i++) off += rowNode.child(i).nodeSize
          cellPositions.push(tableStart + rowOffset + 1 + off)
        } else if (r === toIdx) {
          let off = 0
          for (let c = 0; c < rowNode.childCount; c++) {
            cellPositions.push(tableStart + rowOffset + 1 + off)
            off += rowNode.child(c).nodeSize
          }
          break
        }
        rowOffset += rowNode.nodeSize
      }
      if (cellPositions.length > 0) {
        const $a = newDoc.resolve(cellPositions[0]!)
        const $h = newDoc.resolve(cellPositions[cellPositions.length - 1]!)
        tr.setSelection(new CellSelection($a, $h)).setMeta(PILL_ORIGIN_META, orientation)
      }
    }
  } catch { /* best effort */ }

  view.dispatch(tr)
}
