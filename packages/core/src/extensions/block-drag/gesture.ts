// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { Editor } from "@tiptap/core"
import { NodeSelection } from "@tiptap/pm/state"
import type { EditorView } from "@tiptap/pm/view"
import { columnResizingPluginKey } from "prosemirror-tables"
import { blockDragKey } from "./BlockDrag"
import { MultiBlockSelection } from "../block-selection/MultiBlockSelection"
import { getBlockSelectionApi } from "../block-selection/plugin"
import type { GripGestureSnapshot } from "../block-selection/plugin"
import { sideMenuKey } from "../side-menu/SideMenu"
import { claimGesture, isPrimaryRelease, primaryLost } from "../shared/gesture-state"
import type { GestureClaim } from "../shared/gesture-state"
import { isDraggable } from "../side-menu/block-registry"
import { surfaceBlockSnapshot, slotAtY, refreshSnapshotRects, effectivePrevIndex } from "./block-drag-geometry"
import { executeReorder, executeDepthOnlyChange } from "./reorder"
import {
  resolveEmptiedSourceColumnForMove,
  runContainsColumnLayout,
} from "../../api/commands/moveBlocks"
import { createPreview, updatePreviewPosition, destroyPreview } from "./preview"
import {
  createIndicator,
  positionIndicator,
  positionIndicatorVertical,
  hideIndicator,
} from "./indicator"
import { chooseDropDepth, dropIndicatorLeftForDepth } from "./drop-depth"
import {
  hitBlockIndexAtY,
  inVerticalArmBand,
  resolveLayoutZone,
  resolveWrapZone,
} from "./edge-zone"
import {
  getEditorVar,
  resolveCssLengthToPx,
  registerDragCancelHandlers,
  headIndexAtY,
  onEditorWrapperMouseDown,
  surfaceFromPoint,
} from "../shared"
import { surfaceChildrenAt, surfaceChildrenInRange } from "../../schema/bodySurface"
import type { BlocksSnapshot, DropTarget } from "./types"
import { getBlockSpecs, structuralIndentTypes } from "../../schema"

const DRAG_THRESHOLD = 5
const SIDE_MENU_GRIP_OFFSET_VAR = "--rune-side-menu-grip-offset"
const INDENT_STEP_VAR = "--rune-block-indent-step"
const FALLBACK_INDENT_STEP = "1.875rem"
// F6 — width of the drag-to-create-columns edge zone (content edge OUTWARD).
const COL_DROPZONE_VAR = "--rune-col-dropzone"
const FALLBACK_COL_DROPZONE = "40px"

/**
 * F6 — an ARMED edge zone. Mouseup routes to `editor.commands.wrapIntoColumns`
 * instead of the move core; the indicator renders as a vertical bar meanwhile.
 */
type ZoneTarget =
  | { kind: "wrap"; targetPos: number; side: "left" | "right" }
  | { kind: "addColumn"; layoutPos: number; index: number }

export function getPaddingThresholdCursor(
  editorRoot: HTMLElement,
  firstSourceRect: DOMRect,
  sourceDepth: number = 0,
): { clientX: number; clientY: number } {
  const rawGripOffset = getEditorVar(editorRoot, SIDE_MENU_GRIP_OFFSET_VAR, "0px")
  const gripOffset = resolveCssLengthToPx(rawGripOffset, editorRoot)
  // Grip's real X follows the block's depth (see side-menu.css). Synthetic
  // cursor for padding-drag must do the same or preview anchors off by N steps.
  const indentStepPx =
    sourceDepth > 0
      ? resolveCssLengthToPx(getEditorVar(editorRoot, INDENT_STEP_VAR, FALLBACK_INDENT_STEP), editorRoot)
      : 0
  return {
    clientX: firstSourceRect.left + sourceDepth * indentStepPx + gripOffset,
    clientY: firstSourceRect.top + Math.min(18, firstSourceRect.height / 2),
  }
}

/**
 * The source band within a snapshot: lo = first index whose pos >= range.from,
 * hi = last index whose pos < range.to. Returns `{ lo: -1, hi: -1 }` when none
 * of the snapshot's blocks fall in the range — which is exactly the case for a
 * FOREIGN surface (the moved blocks don't live there), making `slotAtY`'s
 * source-band skip and `updateTargetForSlot`'s band-hide branches inert.
 */
function computeFromIdx(
  snapshot: BlocksSnapshot,
  range: { from: number; to: number },
): { fromIdxLo: number; fromIdxHi: number } {
  let fromIdxLo = -1
  let fromIdxHi = -1
  for (let i = 0; i < snapshot.blocks.length; i++) {
    const b = snapshot.blocks[i]!
    if (b.pos >= range.from && b.pos < range.to) {
      if (fromIdxLo === -1) fromIdxLo = i
      fromIdxHi = i
    }
  }
  return { fromIdxLo, fromIdxHi }
}

/**
 * Stable block ids of every source-surface child in `[from, to)` — what the
 * F6 drop hands to `wrapIntoColumns` (block commands address by id). Returns
 * `[]` when any block in the run is still id-less (BlockId backfills within a
 * tick; a same-tick drop just no-ops rather than move a partial run).
 */
function collectRunIds(
  doc: import("@tiptap/pm/model").Node,
  range: { from: number; to: number },
): string[] {
  const ids: string[] = []
  for (const child of surfaceChildrenInRange(doc, range)) {
    if (typeof child.attrs.id === "string" && child.attrs.id) ids.push(child.attrs.id)
    else return []
  }
  return ids
}

/** Handle returned by `setupBlockDrag` — lets the owning plugin view abort a
 *  live gesture from outside the gesture's own event handlers (the mid-drag
 *  doc-change hook in BlockDrag.ts) and tear everything down on destroy. */
export interface BlockDragGestureHandle {
  /** Abort any LIVE gesture (pending or active) via the full cleanup path.
   *  No-op when no gesture is in flight. */
  cancel: () => void
  /** Remove the entry listeners and abort any live gesture. */
  destroy: () => void
}

export function setupBlockDrag(view: EditorView, editor: Editor): BlockDragGestureHandle {
  const structuralIndentTypeSet = structuralIndentTypes(editor)

  let pending: {
    range: { from: number; to: number }
    // The actually gripped block's top-level pos. Distinct from
    // `range.from` because the in-MBS pickup widens `range` to the
    // whole selection — the gripped block can sit anywhere inside.
    // applyGripClick needs the real one for anchor / dropdown id.
    blockPos: number
    selectionMode: "text" | "mbs"
    startX: number
    startY: number
    shiftKey: boolean
    // Snapshot of selection / anchor at mousedown time. Forwarded to
    // applyGripClick on a no-drag release so the toggle / shift-extend
    // decision uses what the user *saw* when they pressed the grip,
    // not what the DOM happens to look like at mouseup (PM's
    // DOMObserver can override MBS during the press→release window —
    // and during idle pauses too, via React-induced focus shuffles
    // around the side-menu widget).
    snapshot: GripGestureSnapshot | null
    // Set when the drag was initiated from padding (not grip). Used at
    // threshold-cross to synthesize a grip-anchored cursor position.
    entry?: "padding"
  } | null = null

  let active: {
    range: { from: number; to: number }
    selectionMode: "text" | "mbs"
    snapshot: BlocksSnapshot
    preview: HTMLElement
    indicator: HTMLElement
    fromIdxLo: number
    fromIdxHi: number
    // Cross-surface drag (Task 3). The SOURCE surface (where the moved blocks
    // live, captured at threshold) and the surface the cursor is CURRENTLY over.
    // `surfacePos === -1` ≡ the doc root. When they match, the snapshot is the
    // source surface and `fromIdxLo/Hi` mark the live source band; when they
    // differ the snapshot is re-taken against the foreign surface and the band
    // is set to -1/-1 (no source band there — see onMouseMove).
    sourceSurfacePos: number
    currentSurfacePos: number
    lastTarget: DropTarget | null
    // F6 — drag-to-create columns. `zonePx` is the `--rune-col-dropzone`
    // token resolved at threshold; `draggedContainsLayout` gates nesting
    // (computed once — the dragged range is immutable for the gesture);
    // `zoneTarget` is the currently ARMED zone (vertical indicator shown,
    // mouseup routes to wrapIntoColumns) or null.
    zonePx: number
    draggedContainsLayout: boolean
    zoneTarget: ZoneTarget | null
    grab: { dx: number; dy: number }
    lastCursor: { clientX: number; clientY: number }
    // For padding-drag: offset between real threshold cursor and synthetic
    // grip-anchored cursor. Applied to every updatePreviewPosition call so the
    // preview tracks 1:1 from source with grip-like anchoring. Zero for grip-drag.
    cursorAdjust: { dx: number; dy: number }
    editorRoot: HTMLElement
    onScroll: () => void
  } | null = null

  // Escape / pointercancel / window-blur cancellation covers the WHOLE
  // gesture, PENDING stage included: registered at mousedown, released by
  // cleanup(). Registering only at threshold-cross left a hole — an alt-tab
  // during pending swallows the mouseup, and the next mousemove past the
  // threshold would start a phantom drag with no button held (#297).
  let unregisterCancel: (() => void) | null = null

  // Shared gesture claim, set at threshold-cross (when active arms), released
  // in cleanup(). One claim covers both grip and padding entry — both share
  // the same active closure. null when no drag is in the ACTIVE stage.
  let claim: GestureClaim | null = null

  // Lazily resolved on first use: at plugin.view() time the PM dom may not
  // yet be mounted inside its .rune-editor ancestor (React renders async).
  const getEditorRoot = (): HTMLElement | null =>
    view.dom.closest(".rune-editor") as HTMLElement | null

  const positionIndicatorAndTarget = (
    targetIdx: number,
    insertPos: number,
    edgeY: number,
    cursorX: number,
  ): DropTarget => {
    const prevIdx = effectivePrevIndex(targetIdx, {
      lo: active!.fromIdxLo,
      hi: active!.fromIdxHi,
    })
    const prev = prevIdx >= 0 ? active!.snapshot.blocks[prevIdx] : null
    const prevIsStructural = prev != null && structuralIndentTypeSet.has(prev.type)
    const dropDepth = chooseDropDepth({
      cursorX,
      minLeft: active!.snapshot.minLeft,
      indentStepPx: active!.snapshot.indentStepPx,
      previousDepth: prev ? prev.depth : null,
      previousIsStructural: prevIsStructural,
    })
    const left = dropIndicatorLeftForDepth({
      minLeft: active!.snapshot.minLeft,
      indentStepPx: active!.snapshot.indentStepPx,
      depth: dropDepth,
    })
    const width = active!.snapshot.maxRight - left
    positionIndicator(active!.indicator, left, edgeY, width)
    return { insertPos, indicatorLeft: left, edgeY, newDepthAttr: dropDepth }
  }

  const updateTargetForSlot = (
    targetIdx: number,
    insertPos: number,
    edgeY: number,
    cursorX: number,
  ) => {
    if (!active) return
    // Source-band logic is only meaningful on the SOURCE surface, where the
    // moved blocks actually live (fromIdxLo/Hi >= 0). On a FOREIGN surface the
    // band is set to -1/-1 (computeFromIdx) and these branches must be inert —
    // otherwise `targetIdx === fromIdxHi + 1` (= 0 when fromIdxHi is -1) would
    // spuriously treat slot 0 as the source boundary and hide the indicator.
    const hasSourceBand = active.fromIdxLo >= 0
    const onBoundary =
      hasSourceBand &&
      (targetIdx === active.fromIdxLo || targetIdx === active.fromIdxHi + 1)
    const strictlyInsideBand =
      hasSourceBand &&
      !onBoundary &&
      targetIdx >= active.fromIdxLo &&
      targetIdx <= active.fromIdxHi

    if (strictlyInsideBand) {
      hideIndicator(active.indicator)
      active.lastTarget = null
      return
    }

    const candidate = positionIndicatorAndTarget(targetIdx, insertPos, edgeY, cursorX)
    const sourceDepth = active.snapshot.blocks[active.fromIdxLo]?.depth ?? 0
    if (onBoundary && candidate.newDepthAttr === sourceDepth) {
      hideIndicator(active.indicator)
      active.lastTarget = null
      return
    }

    active.lastTarget = candidate
  }

  // F6 — drag-to-create columns. Runs AFTER slot computation on every frame
  // (mousemove and capture-scroll alike): hit-test the root block the cursor
  // is vertically over, then resolve its edge zone from the LIVE DOM rects.
  // An armed zone overrides the horizontal slot indicator with a vertical bar
  // (full block height for a wrap, full layout height for an add-column) and
  // is consumed by mouseup BEFORE the move-core path. Zones exist only on the
  // ROOT surface: a pointer inside a column rect resolves to that column
  // surface (cross-surface drop), so an in-column block's edges can never arm
  // — wrapping inside a column would nest layouts.
  const updateZoneForCursor = (clientX: number, clientY: number) => {
    if (!active) return
    active.zoneTarget = null
    // Immutable per-gesture gate: a run containing a columnLayout can never
    // arm any zone (no nesting) — bail before the per-frame nodeDOM /
    // querySelector / rect reads. The resolvers keep their own check as
    // defense in depth.
    if (active.draggedContainsLayout) return
    if (active.currentSurfacePos !== -1) return
    const idx = hitBlockIndexAtY(active.snapshot.blocks, clientY)
    if (idx === -1) return
    const b = active.snapshot.blocks[idx]!
    // Vertical arm band: only the row's middle half arms (see the helper's
    // JSDoc — row edges are slot-boundary / reorder territory).
    if (!inVerticalArmBand(b.top, b.bottom, clientY)) return
    // Self guard: the hovered block belongs to the dragged run.
    const isSource =
      active.sourceSurfacePos === -1 &&
      b.pos >= active.range.from &&
      b.pos < active.range.to
    const dom = view.nodeDOM(b.pos) as HTMLElement | null
    if (!dom) return

    if (b.type === "columnLayout") {
      const columnRects = Array.from(
        dom.querySelectorAll<HTMLElement>(":scope > [data-rune-column]"),
      ).map((el) => {
        const rect = el.getBoundingClientRect()
        return { left: rect.left, right: rect.right }
      })
      const zone = resolveLayoutZone({
        cursorX: clientX,
        zonePx: active.zonePx,
        columnRects,
        isSource,
        draggedContainsLayout: active.draggedContainsLayout,
      })
      if (!zone) return
      positionIndicatorVertical(active.indicator, zone.x, b.top, b.bottom - b.top)
      active.zoneTarget = { kind: "addColumn", layoutPos: b.pos, index: zone.index }
      active.lastTarget = null
      return
    }

    // Wrap zone — keyed on the block's CONTENT edge (the `.rune-block-content`
    // box), extending OUTWARD. Same fallback semantics as `indicatorLeftFor`:
    // when no DIRECT content box exists, key on the block's own rect — React
    // NodeViews nest the wrapper one renderer level deeper (Audio), and some
    // render no content box at all (Equation, TableOfContents); without the
    // fallback those blocks could never arm a wrap zone. Minimal jsdom
    // fixtures (bare nodes without rune wrappers) stay inert regardless: their
    // all-zero rects hit the degenerate-rect guard in `edgeZoneAt`.
    const content = dom.querySelector<HTMLElement>(":scope > .rune-block-content")
    const rect = (content ?? dom).getBoundingClientRect()
    const side = resolveWrapZone({
      cursorX: clientX,
      zonePx: active.zonePx,
      contentRect: { left: rect.left, right: rect.right },
      isSource,
      draggedContainsLayout: active.draggedContainsLayout,
    })
    if (!side) return
    positionIndicatorVertical(
      active.indicator,
      side === "left" ? rect.left : rect.right,
      b.top,
      b.bottom - b.top,
    )
    active.zoneTarget = { kind: "wrap", targetPos: b.pos, side }
    active.lastTarget = null
  }

  // Cross-surface drag (Task 3): on every move/scroll, hit-test which surface
  // the cursor is geometrically OVER (rect-based, gap-ambiguity-free — see
  // surfaceFromPoint). If it changed since the last frame, RE-SNAPSHOT that
  // surface and re-derive the source band:
  //
  //   - Back over the SOURCE surface → the moved blocks live there, so
  //     `computeFromIdx` re-marks the live source band (slot math skips it,
  //     updateTargetForSlot hides the indicator inside it).
  //   - Over a FOREIGN surface (root↔column or column↔column) → there is no
  //     source band; computeFromIdx returns {-1,-1}, which makes slotAtY's
  //     band-skip and updateTargetForSlot's band-hide branches inert. The drop
  //     can land at ANY slot of the foreign surface.
  //
  // Returns true when a re-snapshot occurred (the caller then re-runs slot
  // computation against the fresh, rect-current snapshot).
  const maybeReSnapshotSurface = (clientX: number, clientY: number): boolean => {
    if (!active) return false
    const surf = surfaceFromPoint(view, clientX, clientY)
    if (surf.surfacePos === active.currentSurfacePos) return false
    // COL-1 no-nesting gate: a run containing a `columnLayout` may never be
    // offered a COLUMN drop slot — without this, dragging a layout's grip
    // over another layout's column swapped to that column surface and
    // executeReorder committed a nested move (then flattened by
    // ColumnsNormalization, destroying the dragged layout). Keep treating the
    // cursor as root-surface instead; resolveMove enforces the same invariant
    // command-side (pinned in api/commands/columnTargets.test.ts,
    // "moveBlocks — no-nesting guard (COL-1)").
    if (surf.surfacePos !== -1 && active.draggedContainsLayout) return false
    const snapshot = surfaceBlockSnapshot(view, surf.surfacePos, editor)
    active.snapshot = snapshot
    active.currentSurfacePos = surf.surfacePos
    const { fromIdxLo, fromIdxHi } = computeFromIdx(snapshot, active.range)
    active.fromIdxLo = fromIdxLo
    active.fromIdxHi = fromIdxHi
    return true
  }

  const cleanup = () => {
    unregisterCancel?.()
    unregisterCancel = null
    if (active) {
      destroyPreview(active.preview)
      active.indicator.remove()
      document.removeEventListener("scroll", active.onScroll, true)
      // Release via the shared claim (race-safe, idempotent, destroyed-view-safe).
      claim?.release()
      claim = null
      view.dispatch(view.state.tr.setMeta(blockDragKey, { draggingRange: null }))
      // Cleanup must NOT roll back selection on either path: in mbs mode
      // executeReorder restored the selection on the moved range; in text
      // mode the caret is already where the user expects.
      active = null
    }
    pending = null
    document.removeEventListener("mousemove", onMouseMove)
    document.removeEventListener("mouseup", onMouseUp)
  }

  const onMouseMove = (e: MouseEvent) => {
    // Lost-mouseup defense: this listener only exists while a gesture is live,
    // so a move without the primary button held means the mouseup was swallowed
    // (alt-tab, OS dialog, focus steal). Cancel instead of phantom-dragging.
    if (primaryLost(e)) {
      cleanup()
      return
    }

    // Suppress native text-selection while dragging. The browser starts a
    // selection-extension session on mousedown that continues across moves;
    // user-select:none and contenteditable=false toggled mid-gesture do not
    // stop it. preventDefault on the move event + clearing ranges does. (#48)
    if (active) {
      e.preventDefault()
      const sel = window.getSelection()
      if (sel && sel.rangeCount > 0) sel.removeAllRanges()
    }

    if (!active && pending) {
      const dx = e.clientX - pending.startX
      const dy = e.clientY - pending.startY
      if (dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return

      const range = pending.range
      const editorRoot = getEditorRoot()
      if (!editorRoot) {
        cleanup()
        return
      }

      // Walk the SOURCE surface's children (root OR a column — Task 3),
      // collecting DOMs of every block whose pos falls in [range.from,
      // range.to); MBS drags yield multiple, single-block drags yield one.
      // `view.nodeDOM(pos)` resolves a column child's DOM just as it does a root
      // block's; only the iteration must scope to the source surface so a column
      // drag finds its blocks (a bare `doc.forEach` is root-level and would miss
      // them, aborting the drag).
      const sourceSurface = surfaceChildrenAt(view.state.doc, range.from)
      const sourceDoms: HTMLElement[] = []
      if (sourceSurface) {
        let pos = sourceSurface.start
        sourceSurface.node.forEach((node) => {
          if (pos >= range.from && pos < range.to) {
            const dom = view.nodeDOM(pos) as HTMLElement | null
            if (dom) sourceDoms.push(dom)
          }
          pos += node.nodeSize
        })
      }
      if (sourceDoms.length === 0) {
        cleanup()
        return
      }

      // Claim the central gesture registry via the shared protocol. Returns null
      // if another gesture already owns it (refuse-at-entry, GS-6 model) — the
      // full local cleanup() runs and no armed listeners survive.
      claim = claimGesture(view, "block-drag")
      if (!claim) {
        cleanup()
        return
      }
      view.dispatch(view.state.tr.setMeta(sideMenuKey, { hoveredPos: null }))
      view.dispatch(view.state.tr.setMeta(blockDragKey, { draggingRange: range }))

      // Cross-surface drag (Task 3): the moved blocks live on the SOURCE
      // surface (root, or a `column`). Captured once at threshold from the
      // gripped range's start; the snapshot, ghost decorations, and source DOMs
      // are all scoped to it. `surfaceChildrenAt(...).pos` is `-1` for root or
      // the containing `column`'s pos.
      const sourceSurfacePos =
        surfaceChildrenAt(view.state.doc, range.from)?.pos ?? -1
      const snapshot = surfaceBlockSnapshot(view, sourceSurfacePos, editor)
      // Compute fromIdxLo / fromIdxHi from the snapshot: lo = first index
      // whose pos >= range.from, hi = last index whose pos < range.to.
      const { fromIdxLo, fromIdxHi } = computeFromIdx(snapshot, range)
      // Threshold-time grab + first-frame positioning. createPreview
      // computes grab = thresholdCursor − sources[0] rect.topLeft and places
      // the preview at the first source's rect — so the first rendered frame
      // sits exactly on the (first) source.
      //
      // Padding-drag uses a synthetic threshold cursor positioned where the
      // grip would be, so the preview anchors with cursor at the same offset
      // from the block as grip-drag (cursor near preview's left-middle)
      // regardless of where in the padding the user clicked. cursorAdjust
      // re-aligns subsequent real-cursor positions to this synthetic origin
      // so the preview tracks 1:1 from source position with no visible jump
      // at threshold cross.
      const firstSourceRect = sourceDoms[0]!.getBoundingClientRect()
      const firstSourceDepth = parseInt(sourceDoms[0]!.dataset.depth ?? "", 10) || 0
      // Synthetic cursor at where side-menu grip would sit. Mirrors the
      // editor-scoped side-menu grip offset token in side-menu.css.
      // Vertical: grip top is `var(--block-pad-top)` and height 1.5em
      // (~18px center) — capped at `h/2` so a short block still feels
      // grip-anchored rather than placing the cursor below its own bottom.
      // Depth feeds the same depth*step shift the CSS gives the grip.
      const thresholdCursor = pending.entry === "padding"
        ? getPaddingThresholdCursor(editorRoot, firstSourceRect, firstSourceDepth)
        : { clientX: e.clientX, clientY: e.clientY }
      const cursorAdjust = {
        dx: e.clientX - thresholdCursor.clientX,
        dy: e.clientY - thresholdCursor.clientY,
      }

      const { preview, grab } = createPreview(editorRoot, sourceDoms, thresholdCursor)

      const indicator = createIndicator(view.dom)

      // F6 — resolve the edge-zone width token once per gesture (the shared
      // parameterized editor-var reader; the indicator lives on document.body
      // so cascade lookup can't apply), and pin the no-nesting gate: a run
      // containing a columnLayout can never arm a zone.
      const zonePx = resolveCssLengthToPx(
        getEditorVar(editorRoot, COL_DROPZONE_VAR, FALLBACK_COL_DROPZONE),
        editorRoot,
      )
      const draggedContainsLayout = runContainsColumnLayout(view.state.doc, range)

      const onScroll = () => {
        if (!active) return
        // 0. Content shifted under a stationary cursor may now sit over a
        //    different surface (e.g. an inner column scrolled past the cursor).
        //    Re-snapshot if so; a fresh snapshot is already rect-current.
        if (!maybeReSnapshotSurface(active.lastCursor.clientX, active.lastCursor.clientY)) {
          // 1. Pull every block's rect into the current viewport frame so
          //    cursor (clientX/Y) and snapshot share coordinates again.
          refreshSnapshotRects(view, active.snapshot)
        }

        // 2. Re-evaluate slot at the LAST cursor position. On a wheel-only
        //    scroll the cursor itself didn't move, but the content under it
        //    did — the indicator must follow the new edge. Skip the slot math
        //    when the current surface has no draggable blocks (e.g. cursor over
        //    a column whose sole child is non-draggable) — slotAtY([]) would
        //    drive the trailing branch into blocks[-1].
        if (active.snapshot.blocks.length === 0) {
          hideIndicator(active.indicator)
          active.lastTarget = null
          active.zoneTarget = null
        } else {
          const targetIdx = slotAtY(active.snapshot.blocks, active.lastCursor.clientY, {
            lo: active.fromIdxLo,
            hi: active.fromIdxHi,
          })

          let insertPos: number
          let edgeY: number
          if (targetIdx >= active.snapshot.blocks.length) {
            const last = active.snapshot.blocks[active.snapshot.blocks.length - 1]!
            insertPos = last.pos + last.nodeSize
            edgeY = last.bottom
          } else {
            const b = active.snapshot.blocks[targetIdx]!
            insertPos = b.pos
            edgeY = b.top
          }

          updateTargetForSlot(targetIdx, insertPos, edgeY, active.lastCursor.clientX)
          // F6: re-arm/disarm the edge zone against the scrolled content.
          updateZoneForCursor(active.lastCursor.clientX, active.lastCursor.clientY)
        }

        // 3. Preview position math is CB-local (already scroll-source-agnostic
        //    via viewportToCBLocal) — just re-track the cursor against current
        //    CB geometry.
        const adjusted = {
          clientX: active.lastCursor.clientX - active.cursorAdjust.dx,
          clientY: active.lastCursor.clientY - active.cursorAdjust.dy,
        }
        updatePreviewPosition(active.preview, active.editorRoot, adjusted, active.grab)
      }
      document.addEventListener("scroll", onScroll, { capture: true, passive: true })

      active = {
        range,
        selectionMode: pending.selectionMode,
        snapshot,
        preview,
        indicator,
        fromIdxLo,
        fromIdxHi,
        sourceSurfacePos,
        currentSurfacePos: sourceSurfacePos,
        lastTarget: null,
        zonePx,
        draggedContainsLayout,
        zoneTarget: null,
        grab,
        lastCursor: { clientX: e.clientX, clientY: e.clientY },
        cursorAdjust,
        editorRoot,
        onScroll,
      }
      pending = null
    }

    if (!active) return

    active.lastCursor = { clientX: e.clientX, clientY: e.clientY }
    const adjusted = {
      clientX: e.clientX - active.cursorAdjust.dx,
      clientY: e.clientY - active.cursorAdjust.dy,
    }
    updatePreviewPosition(active.preview, active.editorRoot, adjusted, active.grab)

    // Cross-surface drag: if the cursor crossed into a different surface, swap
    // the active snapshot (+ source band) before computing the drop slot. A
    // fresh snapshot is already in current viewport coords; on a non-cross
    // frame the snapshot is kept current by the capture-scroll listener
    // (refreshSnapshotRects), so cursor and snapshot share a frame either way.
    maybeReSnapshotSurface(e.clientX, e.clientY)

    // Empty current surface (e.g. cursor over a column with no draggable child):
    // no drop slot — hide the indicator rather than index blocks[-1].
    if (active.snapshot.blocks.length === 0) {
      hideIndicator(active.indicator)
      active.lastTarget = null
      active.zoneTarget = null
      return
    }

    const targetIdx = slotAtY(active.snapshot.blocks, e.clientY, {
      lo: active.fromIdxLo,
      hi: active.fromIdxHi,
    })

    let insertPos: number
    let edgeY: number
    if (targetIdx >= active.snapshot.blocks.length) {
      const last = active.snapshot.blocks[active.snapshot.blocks.length - 1]!
      insertPos = last.pos + last.nodeSize
      edgeY = last.bottom
    } else {
      const b = active.snapshot.blocks[targetIdx]!
      insertPos = b.pos
      edgeY = b.top
    }

    updateTargetForSlot(targetIdx, insertPos, edgeY, e.clientX)
    // F6: zone detection runs AFTER slot computation — an armed zone overrides
    // the horizontal indicator with the vertical bar.
    updateZoneForCursor(e.clientX, e.clientY)
  }

  const onMouseUp = (e: MouseEvent) => {
    // A non-primary release mid-gesture (e.g. right-click while the left
    // button is still down) must not commit the drop / grip click. The
    // gesture ends on the PRIMARY release — or via the buttons:0 mousemove
    // defense if that release was swallowed.
    if (!isPrimaryRelease(e)) return
    // Capture the gesture's decision state, then tear down FIRST. The drop
    // dispatch below is itself a docChanged transaction, and the mid-drag
    // doc-change abort hook (BlockDrag.ts view.update → cancel) fires for
    // any docChanged tr while a gesture is live — cleanup-before-dispatch
    // keeps the gesture's own drop from re-entering the cancel path.
    // cleanup() only dispatches meta transactions (doc unchanged), so the
    // captured positions stay valid for the dispatches below.
    // AV-2: capture canCommit BEFORE cleanup() nulls the claim — commit gates
    // on this so setEditable(false) mid-gesture blocks doc mutation.
    const canCommit = claim?.canCommit ?? false
    const act = active
    const pend = pending
    cleanup()

    // AV-2: if setEditable(false) was called mid-gesture, `canCommit` is false.
    // Gate every doc-mutating act branch here; the non-mutating click-collapse
    // branch (!act && pend) is intentionally left past this guard.
    if (act && !canCommit) return

    if (act && act.zoneTarget) {
      // F6: an armed edge zone routes to the wrapIntoColumns command instead
      // of the move core. Commands address by stable id; the command re-runs
      // every guard (contiguity, no-nesting, self, 5-col cap) and composes the
      // F2 emptied-source-column removal in its single transaction.
      const zt = act.zoneTarget
      const doc = view.state.doc
      const draggedIds = collectRunIds(doc, act.range)
      if (draggedIds.length > 0) {
        if (zt.kind === "wrap") {
          const targetId = doc.nodeAt(zt.targetPos)?.attrs.id
          if (typeof targetId === "string" && targetId) {
            editor.commands.wrapIntoColumns(draggedIds, {
              id: targetId,
              side: zt.side,
            })
          }
        } else {
          const layoutId = doc.nodeAt(zt.layoutPos)?.attrs.id
          if (typeof layoutId === "string" && layoutId) {
            editor.commands.wrapIntoColumns(draggedIds, {
              layoutId,
              index: zt.index,
            })
          }
        }
      }
      return
    }
    if (act && act.lastTarget) {
      // The in-place depth-only nudge path fires ONLY when the drop lands on the
      // source's own boundary AND on the SAME surface (the moved blocks never
      // left their surface). A cross-surface drop — even one whose mapped
      // insertPos numerically equals range.from/to — is a real relocation, not a
      // depth nudge, so it must route through the move core.
      const onSourceSurface = act.currentSurfacePos === act.sourceSurfacePos
      const onSourceBoundary =
        onSourceSurface &&
        (act.lastTarget.insertPos === act.range.from ||
          act.lastTarget.insertPos === act.range.to)
      const source = {
        from: act.range.from,
        to: act.range.to,
        selectionMode: act.selectionMode,
      } as const
      if (onSourceBoundary) {
        const tr = executeDepthOnlyChange(
          view.state,
          source,
          act.lastTarget.newDepthAttr ?? 0,
        )
        if (tr) view.dispatch(tr)
      } else {
        // F2: compute the emptied-source-column payload via the SHARED helper
        // (identical to the moveBlocks command). `movedBlockCount` always counts
        // ALL source-surface children in [range.from, range.to) via
        // surfaceChildrenInRange — NOT the snapshot band width, which omits
        // non-draggable blocks and would diverge from resolveMove's
        // `column.childCount` compare (a fully-emptying move that includes a
        // non-draggable child would then fail to trigger F2).
        const movedBlockCount = surfaceChildrenInRange(view.state.doc, act.range)
          .length
        const emptiedSourceColumn = resolveEmptiedSourceColumnForMove(
          view.state.doc,
          act.sourceSurfacePos,
          act.currentSurfacePos,
          movedBlockCount,
        )
        // Selection rule (mirrors the moveBlocks command): a pure root→root
        // move keeps the MBS; ANY move touching a column interior (source OR
        // dest non-root) lands a text caret — column MBS paint/keyboard is
        // Task 5, out of scope here.
        const forceTextCaret =
          act.sourceSurfacePos !== -1 || act.currentSurfacePos !== -1
        const tr = executeReorder(view.state, source, act.lastTarget, {
          destSurfacePos: act.currentSurfacePos,
          emptiedSourceColumn,
          forceTextCaret,
        })
        if (tr) view.dispatch(tr)
      }
    } else if (!act && pend && pend.snapshot) {
      // Released within DRAG_THRESHOLD — this gesture was a click, not
      // a drag. Hand off to block-selection to commit the MBS. We are
      // the single arbiter of click-vs-drag for the grip; selection
      // never registers its own DOM listener.
      //
      // Forward `range` so plain-click MBS spans the same chain the
      // drag path would pick up (list / toggle subtree). The plugin
      // ignores `range` for the in-MBS toggle branch.
      getBlockSelectionApi(view)?.applyGripClick({
        blockPos: pend.blockPos,
        range: pend.range,
        shiftKey: pend.shiftKey,
        snapshot: pend.snapshot,
      })
    }
  }

  const onMouseDown = (e: MouseEvent) => {
    // Primary button only — and gated FIRST, before any preventDefault or
    // state change, so a right-press keeps the browser's context-menu path
    // (and a middle-press its paste/scroll path) fully intact.
    if (e.button !== 0) return
    if (!view.editable) return
    const target = e.target
    if (!(target instanceof Element)) return
    const grip = target.closest(".rune-side-menu-grip")
    if (!grip) return

    const state = sideMenuKey.getState(view.state)
    const blockPos = state?.hoveredPos
    if (blockPos == null) return

    const node = view.state.doc.nodeAt(blockPos)
    if (!node) return
    if (!isDraggable(node.type.name, editor)) return

    const sourceDom = view.nodeDOM(blockPos) as HTMLElement | null
    if (!sourceDom) return

    // Keep the editor focused on the existing DOM range. Letting the browser
    // run its default focus path here can flush a stray TextSelection over the
    // visible MBS before mouseup hands the snapshot to applyGripClick.
    e.preventDefault()

    // MBS-aware pickup. Half-open membership (from <= blockPos < to): MBS
    // `to` is the position AFTER the last block, never inside it — closed
    // would falsely include the block immediately after the selection.
    const sel = view.state.selection
    const snapshot = getBlockSelectionApi(view)?.snapshotForGripDown() ?? null
    const inMbs =
      sel instanceof MultiBlockSelection &&
      blockPos >= sel.from &&
      blockPos < sel.to

    let range: { from: number; to: number }
    let selectionMode: "text" | "mbs"

    if (inMbs) {
      range = { from: sel.from, to: sel.to }
      selectionMode = "mbs"
    } else {
      // Out-of-MBS grip while an MBS is active: eagerly replace with a
      // NodeSelection on the gripped block so the MBS visual disappears at
      // the moment of commit (Notion behavior). cleanup() no longer rolls
      // selection back, so the user sees a clean transition. Only dispatch
      // when an MBS actually exists — avoid clobbering a TextSelection.
      if (sel instanceof MultiBlockSelection && !e.shiftKey) {
        view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, blockPos)))
      }
      const specs = getBlockSpecs(editor)
      const hook = specs[node.type.name]?.dragSourceRange
      const resolved = hook
        ? hook({ node, pos: blockPos, doc: view.state.doc, editor })
        : { from: blockPos, to: blockPos + node.nodeSize }
      range = resolved
      selectionMode = "text"
    }

    pending = {
      range,
      blockPos,
      selectionMode,
      startX: e.clientX,
      startY: e.clientY,
      shiftKey: e.shiftKey,
      snapshot,
    }
    document.addEventListener("mousemove", onMouseMove)
    document.addEventListener("mouseup", onMouseUp)
    unregisterCancel?.()
    unregisterCancel = registerDragCancelHandlers(cleanup)
  }

  const onPaddingMouseDown = (e: MouseEvent) => {
    // Primary button only (same gate as the grip handler above, and as the
    // neighboring marquee / drag-extend entries) — placed before the
    // preventDefault below so right-click context menus stay native.
    if (e.button !== 0) return
    // Readonly rule: gesture entries gate on view.editable (same as the grip
    // handler above). An MBS can survive a host's setEditable(false), and
    // neither the threshold-cross nor the drop re-checks editability — an
    // ungated padding press would let the drop mutate a read-only document.
    if (!view.editable) return
    const target = e.target
    if (!(target instanceof Element)) return
    if (target.closest(".rune-side-menu-grip")) return
    if (target.closest(".rune-resize-handle")) return
    // Column-resize boundary handles: same situation as `.rune-resize-handle`
    // above — with an MBS covering the layout, a handle press satisfies every
    // padding-drag precondition (not grip, not in block-content, MBS covers
    // the block) and would arm a competing padding-drag for the same
    // mousedown. The handle owns its gesture (Columns/resize.ts).
    if (target.closest(".rune-col-resize-handle")) return
    if (target.closest(".rune-block-content")) return

    // Column-resize handles render with `pointer-events: none` so the cell
    // underneath gets text-cursor interactions (table.css). For the rightmost
    // column's handle in fit-width mode, the handle's `right: -2px` overhang
    // lands ON the `.rune-block` 2px `padding-inline` chrome — outside any
    // `.rune-block-content`. With MBS active over that table, the click
    // would otherwise satisfy this handler's preconditions (not grip, not in
    // block-content, MBS covers the block) and arm a padding-drag. The
    // canonical "cursor is in a resize hot zone" signal is columnResizing's
    // own `activeHandle` — same gate the table pin plugin uses, kept in
    // step with upstream activation rules.
    const resizeState = columnResizingPluginKey.getState(view.state) as
      | { activeHandle: number; dragging: unknown }
      | undefined
    if (resizeState && resizeState.activeHandle !== -1) return

    const sel = view.state.selection
    if (!(sel instanceof MultiBlockSelection)) return

    // Surface-aware MBS-cover gate, shared with the drag-extend / marquee
    // mousedown yields (`coversSurfaceBlock`, lockstep): the active MBS's
    // blockIndices may be COLUMN-local (Task 5), so resolve the press on ITS
    // OWN surface before comparing — a bare root-index compare falsely
    // claimed a padding press beside unrelated root blocks for a column MBS.
    const pointSurface = surfaceFromPoint(view, e.clientX, e.clientY)
    const headIdx = headIndexAtY(view, e.clientX, e.clientY, {
      strict: true,
      surface: pointSurface.surfacePos === -1 ? undefined : pointSurface,
    })
    if (headIdx == null) return
    if (!sel.coversSurfaceBlock(pointSurface.surfacePos, headIdx)) return

    // Same DOMObserver-cascade defense as the grip handler above: a padding
    // click on an MBS-covered block bubbles to view.dom's mousedown, where
    // PM would otherwise place a caret and DOMObserver would flush a
    // TextSelection over the active MBS before the gesture decides
    // click-vs-drag. preventDefault stops that path.
    e.preventDefault()

    pending = {
      range: { from: sel.from, to: sel.to },
      blockPos: sel.from,
      selectionMode: "mbs",
      startX: e.clientX,
      startY: e.clientY,
      shiftKey: e.shiftKey,
      snapshot: null,
      entry: "padding",
    }
    document.addEventListener("mousemove", onMouseMove)
    document.addEventListener("mouseup", onMouseUp)
    unregisterCancel?.()
    unregisterCancel = registerDragCancelHandlers(cleanup)
  }

  const offPadding = onEditorWrapperMouseDown(view, onPaddingMouseDown)

  view.dom.addEventListener("mousedown", onMouseDown)

  return {
    cancel: () => {
      // Guarded so the gesture's own drop is re-entry-safe: onMouseUp runs
      // cleanup() BEFORE dispatching the drop tr, so by the time that
      // docChanged tr reaches the plugin's update hook, nothing is live.
      if (pending || active) cleanup()
    },
    destroy: () => {
      view.dom.removeEventListener("mousedown", onMouseDown)
      offPadding()
      cleanup()
    },
  }
}
