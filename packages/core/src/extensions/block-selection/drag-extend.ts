// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { Node as ProseMirrorNode, ResolvedPos } from "@tiptap/pm/model"
import { Plugin, PluginKey } from "@tiptap/pm/state"
import { MultiBlockSelection } from "./MultiBlockSelection"
import { isMarqueeEligibleTarget } from "./marquee"
import { blockSelectionKey } from "./plugin"
import {
  headIndexAtY,
  nearestScrollOwner,
  onEditorWrapperMouseDown,
  registerDragCancelHandlers,
  scrollViewport,
  domObserverOf,
  createSelectStartGuard,
  surfaceFromPoint,
} from "../shared"
import type { SurfaceRef } from "../shared"
import { surfaceChildrenAt } from "../../schema/bodySurface"
import { claimGesture, isPrimaryRelease, primaryLost } from "../shared/gesture-state"
import type { GestureClaim } from "../shared/gesture-state"

// Stateless plugin key — kept solely as the plugin's identifier (so it
// shows up by name in PM devtools / `state.plugins` introspection). The
// reclaim hook reads the active gesture from a closure variable in
// `view()`, not from plugin state. Re-entry into appendTransaction is
// prevented by the `selection instanceof MultiBlockSelection` early-return,
// not by tagging meta on the appended transaction.
const dragExtendKey = new PluginKey("rune-block-selection-drag-extend")

// `anchorIdx` is surface-local (an index within `anchorSurfacePos`). For text
// mode the surface is whatever the caret block lives on; text mode never
// dispatches an MBS (#103 removed the cross-block auto-promote), so block mode
// is the only consumer of these fields. Re-dispatch dedup lives in
// `sameAsActive` (reading `activeGesture`), not a per-`pending` last-index.
type Pending =
  | { mode: "text"; anchorIdx: number; anchorSurfacePos: number }
  | { mode: "block"; anchorIdx: number; anchorSurfacePos: number }

// F5 drag-extend granularity: the MBS the gesture is currently driving, with the
// surface it lives on. `surfacePos === -1` ⇒ root (the layout participates as one
// block — the boundary-cross / root-anchored case). Otherwise a column's pos and
// the indices are column-local. NEVER a cross-surface pair (anchor + head on
// different surfaces): a boundary cross re-anchors to root granularity instead.
type GestureMbs = { surfacePos: number; anchorIdx: number; headIdx: number }

export function blockSelectionDragExtendPlugin(): Plugin {
  // Plugin-scoped gesture handle. set when a gesture starts/extends, cleared
  // on mouseup/cancel. appendTransaction reads this to reclaim MBS if a
  // stray selection-update transaction (DOMObserver flush from Chrome's
  // native drag-text-selection) overrides our MBS mid-gesture. Surface-aware
  // (`surfacePos === -1` ⇒ root) so the reclaim re-asserts a column-local MBS
  // for an in-column gesture, not a root one.
  let activeGesture: GestureMbs | null = null

  // Resolve a column surface's children + a ResolvedPos for
  // `MultiBlockSelection.create`. Returns null for the root (caller uses the
  // root branch) or if the pos no longer resolves (mid-mutation safety).
  const resolveColumnSurface = (
    doc: ProseMirrorNode,
    surfacePos: number,
  ): { childCount: number; surfaceArg: ResolvedPos } | null => {
    const surface = surfaceChildrenAt(doc, surfacePos + 1)
    if (!surface || surface.pos !== surfacePos) return null
    return { childCount: surface.node.childCount, surfaceArg: doc.resolve(surface.start) }
  }

  return new Plugin({
    key: dragExtendKey,
    appendTransaction(_trs, _oldState, newState) {
      // Text-mode drags intentionally bypass this hook — `activeGesture` is
      // only assigned inside `dispatchMbs`, which only fires for block-mode
      // entries (#41-B padding / empty-area mousedown) after #103 removed
      // the cross-block text-drag auto-promote. So the early-return below
      // is a structural no-op for text-mode gestures, not a bug.
      if (!activeGesture) return null
      // Already an MBS that matches our gesture? Nothing to reclaim.
      if (newState.selection instanceof MultiBlockSelection) return null
      // Re-assert MBS at the gesture's current anchor/head. This is the
      // canonical defense against PM's DOMObserver flushing a TextSelection
      // from Chrome's native drag-text-selection mid-gesture (#41) — the
      // bug from `project_pm_dom_observer_overrides_custom_selection.md`.
      const { surfacePos, anchorIdx, headIdx } = activeGesture
      const doc = newState.doc
      if (surfacePos === -1) {
        if (anchorIdx >= doc.childCount || headIdx >= doc.childCount) return null
        const anchorId = (doc.child(anchorIdx).attrs.id as string | null) ?? null
        return newState.tr
          .setSelection(MultiBlockSelection.create(doc, anchorIdx, headIdx))
          .setMeta(blockSelectionKey, { setAnchor: anchorId })
      }
      const col = resolveColumnSurface(doc, surfacePos)
      if (!col) return null
      if (anchorIdx >= col.childCount || headIdx >= col.childCount) return null
      const anchorId = (col.surfaceArg.parent.child(anchorIdx).attrs.id as string | null) ?? null
      return newState.tr
        .setSelection(MultiBlockSelection.create(doc, anchorIdx, headIdx, col.surfaceArg))
        .setMeta(blockSelectionKey, { setAnchor: anchorId })
    },
    view(view) {
      let pending: Pending | null = null
      let unregisterCancel: (() => void) | null = null
      let rafId: number | null = null
      let lastCursor: { x: number; y: number } | null = null
      let scrollOwner: HTMLElement | Window | null = null
      // Gesture registry claim handle (GS-3). Set at first MBS dispatch
      // (promotion); null until then and after clear(). Replaces the old
      // `claimedRegistry` boolean — the handle owns idempotency + race-safe
      // release. The closure-level `activeGesture` anchor/head variable
      // (appendTransaction reclaim) is UNRELATED and unchanged.
      let claim: GestureClaim | null = null
      const selectStartGuard = createSelectStartGuard()

      const clear = () => {
        // End the guard FIRST so any flushed mutation lands AFTER pending is
        // cleared and the listeners below stop processing.
        selectStartGuard.end()
        // Race-safe registry release via shared protocol handle (GS-3).
        // Idempotent and ownership-guarded — only clears if the registry still
        // reads "drag-extend"; a thief's entry is never stomped.
        claim?.release()
        claim = null
        // Stop reclaiming on stray transactions — gesture is over.
        activeGesture = null
        pending = null
        if (unregisterCancel) unregisterCancel()
        unregisterCancel = null
        document.removeEventListener("mousemove", onMove)
        document.removeEventListener("mouseup", onUp)
        document.removeEventListener("mousedown", onSecondMouseDown, true)
        if (rafId != null) {
          window.cancelAnimationFrame(rafId)
          rafId = null
        }
        lastCursor = null
        scrollOwner = null
      }

      // Dispatch an MBS, defending against Chrome's native drag-text-selection
      // logic clobbering us via the DOMObserver flush after dispatch:
      //
      //   1. domObserver.stop()  — unsubscribe from MutationObserver/selectionchange
      //   2. removeAllRanges()   — clear any native text-selection range Chrome started
      //   3. view.dispatch(tr)   — install the MBS
      //   4. domObserver.start() — re-subscribe (PM also restarts internally)
      //
      // We do this on EVERY MBS dispatch — between mousemoves Chrome can
      // build a new native range that selectionchange would otherwise turn
      // into a TextSelection override.
      const dispatchMbs = (mbs: GestureMbs) => {
        const { surfacePos, anchorIdx, headIdx } = mbs
        const doc = view.state.doc
        // Bounds guard: an undo (or any transaction) during the drag can
        // shrink the doc/surface to fewer children than our cached gesture
        // indices. appendTransaction has the same guard; mirror it here so a
        // mid-drag dispatch can't crash on a stale index.
        let surfaceArg: ResolvedPos | undefined
        let anchorId: string | null
        if (surfacePos === -1) {
          const N = doc.childCount
          if (anchorIdx < 0 || headIdx < 0 || anchorIdx >= N || headIdx >= N) return
          anchorId = (doc.child(anchorIdx).attrs.id as string | null) ?? null
        } else {
          const col = resolveColumnSurface(doc, surfacePos)
          if (!col) return
          if (anchorIdx < 0 || headIdx < 0 || anchorIdx >= col.childCount || headIdx >= col.childCount) return
          surfaceArg = col.surfaceArg
          anchorId = (col.surfaceArg.parent.child(anchorIdx).attrs.id as string | null) ?? null
        }
        // Claim the central registry at this promotion point (the gesture is
        // now driving an MBS). Only claim once — if `claim` is already set
        // (re-dispatch during an active gesture), skip. If this is the first
        // dispatch and claimGesture returns null, another gesture owns the
        // registry: run full clear() (GS-6 — no listeners survive a refusal).
        // NOTE: in block/padding mode this `dispatchMbs` runs at mousedown, so
        // block-mode promotion == mousedown (text mode claims only on a
        // cross-block move). The pairwise yields to marquee and block-drag run
        // BEFORE this, so a bare padding click can't reach here while another
        // gesture competes. When the Step-4 follow-up removes those pairwise
        // yields, re-audit this path — without them a click would briefly lock
        // the registry for its duration.
        if (!claim) {
          claim = claimGesture(view, "drag-extend")
          if (!claim) {
            // Refused — another gesture owns the registry. Full cleanup (GS-6).
            clear()
            return
          }
        }
        // Update the gesture handle so appendTransaction's reclaim hook
        // re-asserts THIS surface + anchor/head pair if a stray transaction
        // overrides.
        activeGesture = { surfacePos, anchorIdx, headIdx }
        const tr = view.state.tr
          .setSelection(MultiBlockSelection.create(doc, anchorIdx, headIdx, surfaceArg))
          .setMeta(blockSelectionKey, { setAnchor: anchorId })
        domObserverOf(view).stop()
        window.getSelection()?.removeAllRanges()
        view.dispatch(tr)
        domObserverOf(view).start()
      }

      // Dedupe guard: skip a re-dispatch when the candidate MBS is identical to
      // the one already driving the gesture (same surface AND same anchor/head).
      // Replaces the old `headIdx !== lastHeadIdx` check — insufficient now that
      // a boundary cross can change BOTH the surface and the anchor index while
      // the head index stays numerically equal.
      const sameAsActive = (mbs: GestureMbs): boolean =>
        activeGesture != null &&
        activeGesture.surfacePos === mbs.surfacePos &&
        activeGesture.anchorIdx === mbs.anchorIdx &&
        activeGesture.headIdx === mbs.headIdx

      // F5 head resolution for a block-mode drag. Decides the granularity from
      // the anchor's surface (captured at promotion) vs the head's surface at
      // the cursor:
      //   - anchor in a column AND head in the SAME column → COLUMN-LOCAL MBS
      //     (Notion-aligned in-column case): head index resolved within the
      //     column, dispatched with the column surface.
      //   - anchor at root AND head at root → ROOT MBS, byte-identical to the
      //     pre-Phase-2 path (`headIndexAtY` root, surfacePos -1).
      //   - ANY boundary cross (head's surface != anchor's surface, either
      //     direction) → RE-ANCHOR at ROOT granularity: the anchor's root-level
      //     ancestor index (the `columnLayout` itself when the anchor is in a
      //     column) and the head's ROOT index. NEVER a cross-surface pair.
      // Returns null when no head resolves under the cursor (caller leaves the
      // selection unchanged / lets autoscroll continue).
      const computeBlockMbs = (
        anchorSurfacePos: number,
        anchorIdx: number,
        x: number,
        y: number,
      ): GestureMbs | null => {
        const doc = view.state.doc
        const headSurface: SurfaceRef = surfaceFromPoint(view, x, y)

        // Same-surface column case → column-local indices.
        if (anchorSurfacePos !== -1 && headSurface.surfacePos === anchorSurfacePos) {
          const headIdx = headIndexAtY(view, x, y, { surface: { surfacePos: anchorSurfacePos } })
          if (headIdx == null) return null
          return { surfacePos: anchorSurfacePos, anchorIdx, headIdx }
        }

        // Same-surface root case → byte-identical root path.
        if (anchorSurfacePos === -1 && headSurface.surfacePos === -1) {
          const headIdx = headIndexAtY(view, x, y)
          if (headIdx == null) return null
          return { surfacePos: -1, anchorIdx, headIdx }
        }

        // Boundary cross → re-anchor at root granularity. The anchor's root
        // ancestor index: for an in-column anchor it is the layout's root index
        // (`doc.resolve(columnPos).index(0)`); for a root anchor it is itself.
        const anchorRootIdx =
          anchorSurfacePos === -1 ? anchorIdx : doc.resolve(anchorSurfacePos).index(0)
        const headRootIdx = headIndexAtY(view, x, y)
        if (headRootIdx == null) return null
        return { surfacePos: -1, anchorIdx: anchorRootIdx, headIdx: headRootIdx }
      }

      const updateAutoScroll = () => {
        if (!pending || !lastCursor || !scrollOwner) return
        const rect =
          scrollOwner === window
            ? { top: 0, bottom: window.innerHeight }
            : (scrollOwner as HTMLElement).getBoundingClientRect()
        const band = 40
        const fromTop = lastCursor.y - rect.top
        const fromBottom = rect.bottom - lastCursor.y
        let dy = 0
        if (fromTop < band) dy = -Math.ceil(((band - fromTop) / band) ** 2 * 18)
        if (fromBottom < band) dy = Math.ceil(((band - fromBottom) / band) ** 2 * 18)

        if (dy === 0) {
          if (rafId != null) {
            window.cancelAnimationFrame(rafId)
            rafId = null
          }
          return
        }

        if (rafId != null) return

        const tick = () => {
          if (!pending || !lastCursor || !scrollOwner) {
            rafId = null
            return
          }
          // Recompute dy each tick so it tracks cursor movement
          const r =
            scrollOwner === window
              ? { top: 0, bottom: window.innerHeight }
              : (scrollOwner as HTMLElement).getBoundingClientRect()
          const ft = lastCursor.y - r.top
          const fb = r.bottom - lastCursor.y
          let d = 0
          if (ft < band) d = -Math.ceil(((band - ft) / band) ** 2 * 18)
          if (fb < band) d = Math.ceil(((band - fb) / band) ** 2 * 18)
          if (d === 0) {
            rafId = null
            return
          }
          scrollViewport(scrollOwner, d)
          if (pending.mode === "block") {
            const mbs = computeBlockMbs(pending.anchorSurfacePos, pending.anchorIdx, lastCursor.x, lastCursor.y)
            if (mbs && !sameAsActive(mbs)) dispatchMbs(mbs)
          }
          rafId = window.requestAnimationFrame(tick)
        }

        rafId = window.requestAnimationFrame(tick)
      }

      const onMove = (e: MouseEvent) => {
        if (!pending) return
        // Lost-mouseup defense (GS-2 / #297): primary button no longer held
        // (alt-tab, OS dialog eating the event, matching blur missed).
        // Keeping the gesture alive would chase the cursor with no button down
        // and keep suppressing native text selection; treat as cancel.
        if (primaryLost(e)) {
          clear()
          return
        }
        // Editable flip (GS-3 / AV-2 selection-only contract): if the editor
        // became read-only mid-gesture, end the gesture early and leave the
        // current selection in place (do not clear it — AV-3 is out of scope).
        if (!view.editable) {
          clear()
          return
        }
        lastCursor = { x: e.clientX, y: e.clientY }

        // While in block mode, suppress native text-selection on every move:
        // user-select:none and contenteditable=false toggled mid-gesture do
        // not stop the browser's mousedown-initiated selection-extension
        // session — preventDefault on the move event + clearing ranges does.
        // (Same approach as block-drag/gesture.ts onMouseMove.)
        if (pending.mode === "block") {
          e.preventDefault()
          const sel = window.getSelection()
          if (sel && sel.rangeCount > 0) sel.removeAllRanges()
        }

        if (pending.mode === "text") {
          // Text mode is browser-native ::selection only — it never dispatches
          // an MBS (#103). Nothing to compute here; just keep auto-scroll alive.
          updateAutoScroll()
          return
        }

        // Block mode (entered via padding/empty-area mousedown, #41-B) drives
        // MBS dispatch. F5: computeBlockMbs picks the granularity — column-local
        // while head stays in the anchor's column, ROOT (layout as one block)
        // the moment the head crosses the column boundary, never cross-surface.
        const mbs = computeBlockMbs(pending.anchorSurfacePos, pending.anchorIdx, e.clientX, e.clientY)
        if (mbs == null) {
          updateAutoScroll()
          return
        }
        if (!sameAsActive(mbs)) dispatchMbs(mbs)
        updateAutoScroll()
      }

      const onUp = (e: MouseEvent) => {
        // GS-2: only the primary button release ends the gesture. Right/middle
        // releases (context menu, aux button) must fall through so the browser
        // default still fires over the live selection.
        if (!isPrimaryRelease(e)) return
        clear()
      }
      const onSecondMouseDown = () => clear()

      const onMouseDown = (e: MouseEvent) => {
        // Primary button only — right/middle press keeps native behavior.
        // isPrimaryRelease is a *release* predicate (mouseup); for mousedown
        // entry gates the plain literal is the house convention (matches all
        // six other mousedown entry gates in the gesture files).
        if (e.button !== 0) return
        if (!view.editable) return
        const target = e.target
        if (!(target instanceof Element)) return
        if (target.closest(".rune-side-menu-grip")) return
        // Yield to column-resize on its boundary handles. Entry B promotes
        // AT MOUSEDOWN (dispatchMbs below claims the registry immediately),
        // while column-resize claims only at its movement threshold — so
        // without this yield a handle press inside the layout's vertical
        // padding band would lock the registry as "drag-extend" before the
        // resize can ever start (columns Phase 1 pitfalls 3/4).
        if (target.closest(".rune-col-resize-handle")) return

        // Marquee owns editor-padding drags (outside any block) when the
        // host has registered a marquee zone (via `setMarqueeZone` /
        // `<RuneMarqueeZone>`). Yield so we don't also dispatch a
        // competing block-mode MBS for the same mousedown. Without a
        // zone, isMarqueeEligibleTarget returns false and entry B owns
        // padding clicks/drags. (DOM-only check — drag-extend's listener
        // is on `.rune-editor`, so marquee's currentTarget gate doesn't
        // apply here; the primary-button gate already ran at the top.)
        if (isMarqueeEligibleTarget(view, e.target)) return

        const blockContent = target.closest(".rune-block-content")

        // In-block horizontal whitespace stays PM-owned, but the vertical
        // rhythm padding around the content remains an explicit MBS entry.
        if (!blockContent) {
          const block = target.closest(".rune-block") as HTMLElement | null
          const content = block?.querySelector(".rune-block-content") as HTMLElement | null
          if (content) {
            const r = content.getBoundingClientRect()
            if (e.clientY >= r.top && e.clientY <= r.bottom) return
          }
        }

        // Capture the ANCHOR's surface at promotion (F5). For a block-mode
        // press inside a column, the anchor surface is that column, and the
        // anchor index is surface-local — so an in-column drag that stays in
        // the column produces a column-local MBS. The root path keeps a -1
        // surface and a root index, byte-identical to pre-Phase-2.
        const anchorSurface: SurfaceRef = surfaceFromPoint(view, e.clientX, e.clientY)
        const anchorSurfacePos = anchorSurface.surfacePos
        const headIdx = headIndexAtY(view, e.clientX, e.clientY, {
          strict: true,
          surface: anchorSurfacePos === -1 ? undefined : anchorSurface,
        })
        if (headIdx == null) return

        // Yield to block-drag's wrapper listener, which claims this same
        // mousedown when it lands inside an active MBS. The cover test is
        // surface-aware (`coversSurfaceBlock`) — the active selection's
        // `blockIndices` live on its OWN surface, so the point hit (surface +
        // surface-local index) is mapped onto that surface; for a root MBS
        // with an in-column press, the layout's root index is the candidate.
        // Shared with the marquee / padding-mousedown yields (lockstep).
        if (!blockContent) {
          const sel = view.state.selection
          if (
            sel instanceof MultiBlockSelection &&
            sel.coversSurfaceBlock(anchorSurfacePos, headIdx)
          ) {
            return
          }
        }

        pending = blockContent
          ? { mode: "text", anchorIdx: headIdx, anchorSurfacePos }
          : { mode: "block", anchorIdx: headIdx, anchorSurfacePos }

        if (!blockContent) {
          // Empty-area entry — MBS is the live selection from the start, so
          // arm the guard before the first dispatch. The initial MBS is a
          // single-block selection on the anchor's own surface.
          selectStartGuard.begin()
          dispatchMbs({ surfacePos: anchorSurfacePos, anchorIdx: headIdx, headIdx })
          // GS-6: if claim was refused inside dispatchMbs, clear() was called
          // (pending → null). No listeners should survive a refusal.
          if (!pending) return
        }

        scrollOwner = nearestScrollOwner(view.dom as HTMLElement)
        unregisterCancel = registerDragCancelHandlers(clear)
        document.addEventListener("mousemove", onMove)
        document.addEventListener("mouseup", onUp)
        document.addEventListener("mousedown", onSecondMouseDown, true)
      }

      const offWrapper = onEditorWrapperMouseDown(view, onMouseDown)

      return {
        destroy() {
          offWrapper()
          clear()
        },
      }
    },
  })
}
