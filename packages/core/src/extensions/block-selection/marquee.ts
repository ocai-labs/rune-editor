// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { Editor } from "@tiptap/core"
import type { ResolvedPos } from "@tiptap/pm/model"
import { Plugin } from "@tiptap/pm/state"
import type { EditorView } from "@tiptap/pm/view"
import {
  nearestScrollOwner,
  registerDragCancelHandlers,
  scrollViewport,
  domObserverOf,
  createSelectStartGuard,
  headIndexAtY,
  surfaceFromPoint,
} from "../shared"
import type { SurfaceRef } from "../shared"
import { surfaceChildrenAt } from "../../schema/bodySurface"
import { MultiBlockSelection } from "./MultiBlockSelection"
import { isBlockSelectable } from "./selectable"
import { blockSelectionKey } from "./plugin"
import { claimGesture, isPrimaryRelease, primaryLost } from "../shared/gesture-state"
import type { GestureClaim } from "../shared/gesture-state"

type Point = { x: number; y: number }
type Rect = { left: number; right: number; top: number; bottom: number }
type ScrollOrigin = { owner: HTMLElement | Window; x: number; y: number }

// Marquee zone registry — see setMarqueeZone() docs. Keyed by view (stable
// for the editor's lifetime). `.rune-editor` is the default zone, auto-
// installed by the plugin's view(); hosts can call setMarqueeZone() (or
// render <RuneMarqueeZone>) to replace it with a wider region (page
// gutters, title rows, area below the document). Calling
// setMarqueeZone(editor, null) reverts to the default; the host
// disposer does the same.
const zoneRegistry = new WeakMap<EditorView, HTMLElement>()
const zoneCleanups = new WeakMap<EditorView, () => void>()

// Set by the plugin's view() at editor init. setMarqueeZone() calls it to
// attach the same mousedown handler on the host-supplied zone element.
// Stored in a side table so the registry write in setMarqueeZone() can
// hand off into closure-private state without exposing the handler at
// module scope.
type ZoneAttacher = (el: HTMLElement) => () => void
const zoneAttachers = new WeakMap<EditorView, ZoneAttacher>()

// Calls to setMarqueeZone that arrive before the plugin's view() has
// registered its attacher are stashed here. view() replays the entry
// when it installs the attacher, so callers never have to coordinate
// with plugin-init timing. A null entry means "clear" — replayed as a
// no-op (no zone to install).
//
// The gap is reachable in real usage: React + Tiptap mount paths can
// hand a consumer a usable `editor` reference before the marquee
// plugin's view() has run (and consumers using `editor.registerPlugin`
// to install marquee dynamically hit it deterministically). Without
// pending-replay, those early calls used to silently no-op and force
// hosts into requestAnimationFrame timing workarounds.
const pendingZones = new WeakMap<EditorView, HTMLElement | null>()

const ZONE_ATTR = "data-rune-marquee-zone"

/**
 * The currently-active marquee zone for a view. By default this is the
 * `.rune-editor` wrapper (auto-installed by the plugin's view()); a host
 * may swap it to a wider element via setMarqueeZone(). Returns null only
 * if the editor has no `.rune-editor` ancestor and no host zone has been
 * registered.
 *
 * Exported so other plugins (side-menu) can widen their hover hit-zone
 * to match the marquee region — e.g. surface the grip when the cursor
 * is in a page gutter beside a block, not just inside the editor's own
 * padding (Notion-style).
 */
export function getMarqueeZone(view: EditorView): HTMLElement | null {
  return zoneRegistry.get(view) ?? null
}

// Internal: tear down whatever zone is currently effective for `view`
// (default or host). No-op if nothing is installed.
function teardownEffectiveZone(view: EditorView): void {
  const el = zoneRegistry.get(view)
  if (!el) return
  el.removeAttribute(ZONE_ATTR)
  zoneCleanups.get(view)?.()
  zoneRegistry.delete(view)
  zoneCleanups.delete(view)
}

/**
 * Terminal teardown for an editor's marquee state. Called by
 * `BlockSelection.onDestroy` when the editor itself is going away
 * (the canonical edit-surface lifetime end), NOT by the plugin view's
 * destroy() — PM destroys plugin views on every state.reconfigure
 * (e.g. `editor.registerPlugin(...)` from a host), and clearing the
 * registry there would wipe host `setMarqueeZone()` registrations that
 * are supposed to outlive plugin lifecycle events. Tying the registry
 * + ZONE_ATTR removal to editor.destroy keeps the "host wrapper has
 * data-rune-marquee-zone iff a live editor uses it" invariant intact
 * without leaking the attribute past editor end of life.
 *
 * Tiptap emits `destroy` (firing this hook) BEFORE running
 * EditorView.destroy(), so the plugin view's listener-only destroy()
 * later finds everything already cleared and no-ops cleanly.
 */
export function teardownMarqueeView(view: EditorView): void {
  teardownEffectiveZone(view)
  zoneAttachers.delete(view)
  pendingZones.delete(view)
}

// Internal: install `.rune-editor` (the nearest editor wrapper of
// view.dom) as the effective zone. Guarded: skips if a zone is already
// registered (host override took precedence), if the attacher hasn't
// been registered yet (view destroyed or pre-init), or if no
// `.rune-editor` wrapper is in the tree.
function installDefaultZone(view: EditorView): void {
  if (zoneRegistry.has(view)) return
  const attacher = zoneAttachers.get(view)
  if (!attacher) return
  const editorRoot = view.dom.closest(".rune-editor")
  if (!(editorRoot instanceof HTMLElement)) return
  editorRoot.setAttribute(ZONE_ATTR, "")
  zoneRegistry.set(view, editorRoot)
  zoneCleanups.set(view, attacher(editorRoot))
}

// Radix popper content portals to document.body by default, so the
// popper-wrapper selector rarely matches inside the zone — it's
// belt-and-suspenders for the disablePortal case. Hosts that render real
// UI chrome inside a wider marquee zone can mark it with
// data-rune-marquee-skip.
const CHROME_SELECTORS = [
  ".rune-side-menu-grip",
  "[data-radix-popper-content-wrapper]",
  "[data-rune-marquee-skip]",
  // Column-resize boundary handles (Columns/resize.ts). Marquee has no
  // movement threshold and would otherwise claim the registry on the first
  // move, before column-resize's threshold-cross — refuse-at-claim would
  // then kill the resize (columns Phase 1 pitfall 3). The handles live
  // inside a `.rune-block` today (also rejected below), but the explicit
  // entry keeps the yield true if the widget DOM ever moves.
  ".rune-col-resize-handle",
]

/**
 * Find the nearest registered-zone ancestor of `target` for the given view.
 * Returns null if no zone is registered or target lies outside it. Used as
 * the nested-isolation boundary so a parent editor's marquee doesn't react
 * to clicks inside a child editor's zone.
 */
function nearestZoneAncestor(view: EditorView, target: Element): HTMLElement | null {
  if (!zoneRegistry.has(view)) return null
  const attrEl = target.closest(`[${ZONE_ATTR}]`)
  return attrEl instanceof HTMLElement ? attrEl : null
}

/**
 * DOM-only eligibility check for marquee block selection. Marquee owns
 * editor-padding regions outside every block and, for host-registered
 * wider zones, page-shape siblings such as title / cover / controls
 * rows. PM owns everything inside any `.rune-block` (text, content,
 * internal horizontal whitespace beside short text — all of it).
 *
 * Re-exported so drag-extend entry B can yield for the same regions.
 * Returns false when no zone is resolvable for the view (no
 * `.rune-editor` ancestor and no host registration).
 */
export function isMarqueeEligibleTarget(view: EditorView, target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  const ownZone = getMarqueeZone(view)
  if (!ownZone) return false
  // Nested-zone isolation: parent must not claim child editors' zones.
  if (nearestZoneAncestor(view, target) !== ownZone) return false
  for (const sel of CHROME_SELECTORS) if (target.closest(sel)) return false
  // Inside any block → PM owns it (caret placement, text selection).
  if (target.closest(".rune-block")) return false
  const editorRoot = view.dom.closest(".rune-editor")
  if (!(editorRoot instanceof HTMLElement)) return false
  // Nested-editor isolation: if target sits inside a different
  // .rune-editor (a child editor mounted within outer chrome — comments,
  // popovers, etc.), the parent must not react. We only reject when
  // target IS inside some .rune-editor and it isn't ours; targets above
  // editorRoot in the tree (page gutters, layout wrappers between zone
  // and editor) have no .rune-editor ancestor and pass through.
  const targetEditor = target.closest(".rune-editor")
  if (targetEditor && targetEditor !== editorRoot) return false
  // The nearest-zone check above already proved target is inside this
  // view's effective zone. Host-registered zones intentionally include
  // page-shape siblings of `.rune-editor` (title, cover, icon rows,
  // controls). Real host chrome should opt out with
  // data-rune-marquee-skip, which is covered by CHROME_SELECTORS.
  return true
}

/**
 * Marquee-listener-side gate. Adds primary-button, readonly-editor, and
 * zone-bound currentTarget checks on top of `isMarqueeEligibleTarget`.
 * Returns false on non-editable editors (AGENTS readonly rule: gesture
 * entries must gate on view.editable) or when the listener's
 * currentTarget doesn't match the active zone.
 */
function shouldStartMarquee(view: EditorView, event: MouseEvent): boolean {
  if (event.button !== 0) return false
  if (!view.editable) return false
  if (event.currentTarget !== getMarqueeZone(view)) return false
  return isMarqueeEligibleTarget(view, event.target)
}

/**
 * Register a DOM element as a wider marquee block-selection zone for
 * this editor, overriding the default `.rune-editor` zone.
 *
 * The default zone (auto-installed) is `.rune-editor` itself — marquee
 * already fires from the editor's own padding without any host wiring.
 * Use this API only when you need a region LARGER than the editor: a
 * Notion-style page wrapper that covers title gutters and area below
 * the document, etc. The element should be a DOM ancestor of
 * `editor.view.dom` so event bubbling reaches the listener. Mark
 * toolbar-like chrome inside that zone with `data-rune-marquee-skip`
 * to keep it from starting marquee.
 *
 * Pass `null` to revert to the default `.rune-editor` zone. The
 * disposer returned for a host registration does the same — when the
 * host wrapper unmounts, marquee returns to the editor-padding default.
 *
 * The disposer is idempotent and safe to call from a useEffect cleanup
 * even after the editor is destroyed.
 */
export function setMarqueeZone(
  editor: Editor,
  element: HTMLElement | null,
): () => void {
  const view = editor.view
  // Tear down whatever's effective right now (default or host). A newer
  // call also supersedes any still-pending entry from an earlier call —
  // replay must only ever apply the latest intent.
  teardownEffectiveZone(view)
  pendingZones.delete(view)

  if (!element) {
    // Revert to default. Disposer is a no-op (caller asked for default;
    // there's nothing host-side to "undo").
    installDefaultZone(view)
    return () => {}
  }

  const attach = zoneAttachers.get(view)
  if (!attach) {
    // Plugin view() hasn't registered its attacher yet (or it's been
    // torn down). Stash for replay; view() will pick it up on install.
    pendingZones.set(view, element)
    return () => {
      if (pendingZones.get(view) === element) {
        pendingZones.delete(view)
        return
      }
      // Pending was replayed — tear down only if we're still active,
      // then revert to default.
      if (zoneRegistry.get(view) !== element) return
      teardownEffectiveZone(view)
      installDefaultZone(view)
    }
  }

  element.setAttribute(ZONE_ATTR, "")
  zoneRegistry.set(view, element)
  zoneCleanups.set(view, attach(element))
  return () => {
    if (zoneRegistry.get(view) !== element) return
    teardownEffectiveZone(view)
    installDefaultZone(view)
  }
}

function createOverlay(view: EditorView): HTMLElement {
  const el = document.createElement("div")
  el.className = "rune-marquee"
  const editor = view.dom.closest(".rune-editor") as HTMLElement | null
  if (editor) {
    const styles = getComputedStyle(editor)
    el.style.setProperty("--rune-marquee-fill", styles.getPropertyValue("--rune-marquee-fill"))
    el.style.setProperty("--rune-z-drag-ghost", styles.getPropertyValue("--rune-z-drag-ghost"))
  }
  document.body.appendChild(el)
  return el
}

function writeOverlayRect(el: HTMLElement, start: Point, current: Point) {
  const left = Math.min(start.x, current.x)
  const top = Math.min(start.y, current.y)
  const width = Math.abs(current.x - start.x)
  const height = Math.abs(current.y - start.y)
  el.style.left = `${left}px`
  el.style.top = `${top}px`
  el.style.width = `${width}px`
  el.style.height = `${height}px`
}

function marqueeRect(start: Point, current: Point): Rect {
  return {
    left: Math.min(start.x, current.x),
    right: Math.max(start.x, current.x),
    top: Math.min(start.y, current.y),
    bottom: Math.max(start.y, current.y),
  }
}

function captureMarqueeScrollOrigin(owner: HTMLElement | Window): ScrollOrigin {
  if (owner === window) return { owner, x: window.scrollX, y: window.scrollY }
  const element = owner as HTMLElement
  return { owner, x: element.scrollLeft, y: element.scrollTop }
}

function marqueeScrollDeltaFrom(origin: ScrollOrigin): { dx: number; dy: number } {
  if (origin.owner === window) {
    return {
      dx: window.scrollX - origin.x,
      dy: window.scrollY - origin.y,
    }
  }
  const owner = origin.owner as HTMLElement
  return { dx: owner.scrollLeft - origin.x, dy: owner.scrollTop - origin.y }
}

function intersects(a: Rect, b: Rect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

// A surface the marquee walks for intersection. The ROOT walk is byte-identical
// to the pre-Phase-2 code (its `childPos`/`childCount`/`childId` read `doc`
// directly, `surfaceArg` is undefined so `MultiBlockSelection.create` uses its
// root branch). A COLUMN walk reads the column node's children, with surface-
// local indices and a `surfaceArg` ResolvedPos (`.parent` === the column) so the
// dispatched MBS is column-local. F5: marquee crossing a column boundary never
// builds one of these — it stays on the root walk (the layout = one root block).
interface SurfaceWalk {
  /** Absolute pos of the surface node, or `-1` for the doc root. */
  surfacePos: number
  childCount: number
  /** Absolute PM pos of the surface child at surface-local `index`. */
  childPos: (index: number) => number
  /** `id` attr of the surface child at surface-local `index`, or null. */
  childId: (index: number) => string | null
  /** Surface arg for `MultiBlockSelection.create` (undefined ⇒ root). */
  surfaceArg: ResolvedPos | undefined
}

// Root surface: the doc's direct children. Identical math to the original
// `getBlockElement`/walk (linear nodeSize accumulation from pos 0).
function rootWalk(view: EditorView): SurfaceWalk {
  const doc = view.state.doc
  return {
    surfacePos: -1,
    childCount: doc.childCount,
    childPos: (index) => {
      let pos = 0
      for (let i = 0; i < index; i++) pos += doc.child(i).nodeSize
      return pos
    },
    childId: (index) => (doc.child(index).attrs.id as string | null) ?? null,
    surfaceArg: undefined,
  }
}

// Column surface: the children of the `column` node at `surfacePos`. Returns
// null if the pos no longer resolves to a surface (mid-mutation safety).
function columnWalk(view: EditorView, surfacePos: number): SurfaceWalk | null {
  const doc = view.state.doc
  const surface = surfaceChildrenAt(doc, surfacePos + 1)
  if (!surface || surface.pos !== surfacePos) return null
  const node = surface.node
  const surfaceArg = doc.resolve(surface.start)
  return {
    surfacePos,
    childCount: node.childCount,
    childPos: (index) => {
      let pos = surface.start
      for (let i = 0; i < index; i++) pos += node.child(i).nodeSize
      return pos
    },
    childId: (index) => (node.child(index).attrs.id as string | null) ?? null,
    surfaceArg,
  }
}

function getBlockElement(view: EditorView, walk: SurfaceWalk, index: number): HTMLElement | null {
  const dom = view.nodeDOM(walk.childPos(index))
  return dom instanceof HTMLElement ? dom : null
}

function intersectedBlockRange(view: EditorView, walk: SurfaceWalk, rect: Rect): [number, number] | null {
  let lo: number | null = null
  let hi: number | null = null
  for (let i = 0; i < walk.childCount; i++) {
    // Skip blocks that opt out of block selection (the title). Only the ROOT
    // surface (`surfacePos === -1`) can host such a block — the title lives at
    // doc index 0 and never inside a column — so the column walk is untouched.
    if (walk.surfacePos === -1 && !isBlockSelectable(view.state.doc.child(i))) continue
    const el = getBlockElement(view, walk, i)
    if (!el) continue
    const r = el.getBoundingClientRect()
    if (!intersects(rect, { left: r.left, right: r.right, top: r.top, bottom: r.bottom })) continue
    lo = lo == null ? i : Math.min(lo, i)
    hi = hi == null ? i : Math.max(hi, i)
  }
  return lo == null || hi == null ? null : [lo, hi]
}

function edgeClosestToStart(view: EditorView, walk: SurfaceWalk, range: [number, number], startY: number): number {
  const [lo, hi] = range
  const loEl = getBlockElement(view, walk, lo)
  const hiEl = getBlockElement(view, walk, hi)
  if (!loEl || !hiEl) return lo
  const loRect = loEl.getBoundingClientRect()
  const hiRect = hiEl.getBoundingClientRect()
  const loCenter = loRect.top + loRect.height / 2
  const hiCenter = hiRect.top + hiRect.height / 2
  return Math.abs(startY - hiCenter) < Math.abs(startY - loCenter) ? hi : lo
}

type Intent = { anchorIdx: number; headIdx: number; surfacePos: number }

function sameSelectionIntent(a: Intent | null, b: Intent): boolean {
  return !!a && a.anchorIdx === b.anchorIdx && a.headIdx === b.headIdx && a.surfacePos === b.surfacePos
}

function dispatchRange(
  view: EditorView,
  walk: SurfaceWalk,
  range: [number, number] | null,
  startY: number,
  lastIntent: Intent | null,
): Intent | null {
  if (!range) return lastIntent
  const anchorIdx = edgeClosestToStart(view, walk, range, startY)
  const [lo, hi] = range
  const headIdx = anchorIdx === lo ? hi : lo
  const intent: Intent = { anchorIdx, headIdx, surfacePos: walk.surfacePos }
  if (sameSelectionIntent(lastIntent, intent)) return lastIntent

  // `anchorId` and the dispatched MBS are both surface-local: for the root walk
  // `surfaceArg` is undefined (create's root branch) and childId reads the doc;
  // for a column walk both read the column's children.
  const anchorId = walk.childId(anchorIdx)
  // DOMObserver dance — same defense drag-extend's dispatchMbs uses:
  // stop the observer, clear any browser-native range Chrome built up
  // since the last move, dispatch our MBS, then restart. Without this
  // the residual native TextSelection bleeds through and visually
  // conflicts with MBS (#98 caret-clearing requirement).
  domObserverOf(view).stop()
  window.getSelection()?.removeAllRanges()
  view.dispatch(
    view.state.tr
      .setSelection(MultiBlockSelection.create(view.state.doc, anchorIdx, headIdx, walk.surfaceArg))
      .setMeta(blockSelectionKey, { setAnchor: anchorId }),
  )
  domObserverOf(view).start()
  return intent
}

// Resolve the marquee's containing surface from BOTH rect corners (start +
// current). Only when BOTH resolve to the SAME column do we walk that column's
// children — a column-local MBS (F5, Notion-aligned for the in-column case). The
// moment either corner is outside the column (root, or the other column) we fall
// back to the ROOT walk, which treats the whole `columnLayout` as one root
// block (F5's deliberate deviation: cross-boundary promotes to root granularity,
// NEVER a cross-surface MBS). Returns the root walk if the column walk can't be
// resolved (mid-mutation safety).
function walkForRect(view: EditorView, start: Point, current: Point): SurfaceWalk {
  const startSurface = surfaceFromPoint(view, start.x, start.y)
  const currentSurface = surfaceFromPoint(view, current.x, current.y)
  const isColumn = (s: SurfaceRef) => s.surfacePos !== -1
  if (
    isColumn(startSurface) &&
    startSurface.surfacePos === currentSurface.surfacePos
  ) {
    // NOTE (currently UNREACHABLE — keep, do not delete as "untested"): a
    // marquee can only START outside every `.rune-block` (isMarqueeEligibleTarget
    // rejects `.rune-block` descendants), and a `column`'s entire interior is
    // nested inside the `columnLayout`'s `.rune-block` wrapper — so the start
    // corner never resolves to a column and this branch never fires today. It is
    // implemented correct-by-construction so that IF marquee eligibility is ever
    // widened to let a sweep begin over a column, the F5 column-local rule is
    // already in place (it would then need its own e2e). The reachable column
    // path is the CROSSING case below, which correctly stays at root granularity.
    return columnWalk(view, startSurface.surfacePos) ?? rootWalk(view)
  }
  return rootWalk(view)
}

export function blockSelectionMarqueePlugin(): Plugin {
  return new Plugin({
    view(view) {
      // `start` is set on mousedown but the gesture is "armed", not yet
      // marquee-active. Cancel handlers (Escape / blur / pointercancel)
      // are registered at ARM time — a mouseup lost to an alt-tab while
      // armed must still clear, or the re-entry guard wedges every
      // future marquee and the stale onMove promotes from the old
      // anchor (#297). The first mousemove promotes the gesture:
      // creates the overlay and calls preventDefault. A pure click
      // (mouseup with no intervening mousemove) tears down without
      // ever calling preventDefault, so PM's caret placement and focus
      // on the original mousedown remain untouched.
      let start: Point | null = null
      let current: Point | null = null
      let overlay: HTMLElement | null = null
      let unregisterCancel: (() => void) | null = null
      let rafId: number | null = null
      let lastIntent: Intent | null = null
      let scrollOwner: HTMLElement | Window | null = null
      let scrollOrigin: ScrollOrigin | null = null
      // Shared gesture-claim handle. Set at promotion (first move past arm),
      // null before promotion and after clear(). The handle owns the registry
      // claim/release via the shared protocol (claimGesture / GestureClaim).
      // This is what makes SideMenu hover-suppression (which reads
      // isGestureActive) engage during a marquee sweep.
      let claim: GestureClaim | null = null
      const selectStartGuard = createSelectStartGuard()

      const clear = () => {
        const wasCommitted = lastIntent != null
        selectStartGuard.end()
        // Race-safe registry release via the shared handle (ownership-guarded,
        // idempotent, destroyed-view-safe — GestureClaim.release() semantics).
        claim?.release()
        claim = null
        start = null
        current = null
        lastIntent = null
        scrollOwner = null
        scrollOrigin = null
        overlay?.remove()
        overlay = null
        unregisterCancel?.()
        unregisterCancel = null
        document.removeEventListener("mousemove", onMove)
        document.removeEventListener("mouseup", onUp)
        document.removeEventListener("scroll", onScrollChange, { capture: true } as EventListenerOptions)
        if (rafId != null) {
          window.cancelAnimationFrame(rafId)
          rafId = null
        }
        // Drag-extend keeps PM focus implicitly because its mousedown
        // lands inside a block. Marquee's mousedown is on padding outside
        // any block, and the `removeAllRanges()` calls in onMove can leave
        // `document.activeElement` pointing away from `view.dom` in real
        // browsers -- Tiptap's MBS keymap (Backspace/Delete/Enter/etc.)
        // then never fires. Focus the DOM directly instead of calling
        // EditorView.focus(), which writes a hidden native DOM range for
        // the custom PM selection. Re-focus only when we actually committed
        // an MBS, so a pure click on padding still leaves PM where it was.
        // Memory: project_pm_no_blur_after_selection.md.
        if (wasCommitted) {
          ;(view.dom as HTMLElement).focus({ preventScroll: true })
          window.getSelection()?.removeAllRanges()
        }
      }

      const scrollDelta = (): number => {
        if (!current || !scrollOwner) return 0
        const rect =
          scrollOwner === window
            ? { top: 0, bottom: window.innerHeight }
            : (scrollOwner as HTMLElement).getBoundingClientRect()
        const band = 40
        const fromTop = current.y - rect.top
        const fromBottom = rect.bottom - current.y
        if (fromTop < band) return -Math.ceil(((band - fromTop) / band) ** 2 * 18)
        if (fromBottom < band) return Math.ceil(((band - fromBottom) / band) ** 2 * 18)
        return 0
      }

      const tick = () => {
        rafId = null
        if (!start || !current || !overlay) return

        const dy = scrollDelta()
        if (dy !== 0 && scrollOwner) scrollViewport(scrollOwner, dy)

        const originDelta = scrollOrigin ? marqueeScrollDeltaFrom(scrollOrigin) : { dx: 0, dy: 0 }
        const projectedStart: Point = { x: start.x - originDelta.dx, y: start.y - originDelta.dy }

        writeOverlayRect(overlay, projectedStart, current)
        // F5: pick the surface walk from BOTH rect corners. Fully inside one
        // column → column-local MBS; otherwise the root walk (layout as one
        // block). Recomputed every tick so the rule re-evaluates as the rect
        // grows across / back inside a column boundary.
        const walk = walkForRect(view, projectedStart, current)
        lastIntent = dispatchRange(
          view,
          walk,
          intersectedBlockRange(view, walk, marqueeRect(projectedStart, current)),
          projectedStart.y,
          lastIntent,
        )

        if (dy !== 0) schedule()
      }

      function schedule() {
        if (rafId != null) return
        rafId = window.requestAnimationFrame(tick)
      }

      const onMove = (event: MouseEvent) => {
        if (!start) return
        // Lost-mouseup defense (#297): if the primary button is no longer
        // held, the mouseup never reached us (alt-tab, OS dialog eating
        // the event — and the matching blur may have been missed too).
        // Promoting from the stale anchor would sweep the wrong blocks;
        // treat it as a cancel instead.
        if (primaryLost(event)) {
          clear()
          return
        }
        // Editable-flip abort (AV-2): if the editor became read-only mid-
        // gesture, end early via clear(). The already-dispatched selection
        // stays (no suppression — AV-3 is deliberately out of scope).
        if (!view.editable) {
          clear()
          return
        }
        current = { x: event.clientX, y: event.clientY }
        // Promote the armed gesture to an active marquee on the first
        // move. The original mousedown was deliberately left alone so
        // PM saw it; once we're sure this is a drag, claim subsequent
        // moves, arm the selectstart guard, and clear any native range
        // PM/Chrome may have started building from the original
        // mousedown so it can't bleed through under the MBS overlay.
        if (!overlay) {
          // GS-6: claim the central registry at promotion. If another gesture
          // already owns it, claimGesture returns null → run full clear() and
          // stop (no armed listeners must survive a refused claim).
          claim = claimGesture(view, "marquee")
          if (!claim) {
            clear()
            return
          }
          overlay = createOverlay(view)
          writeOverlayRect(overlay, start, current)
          selectStartGuard.begin()
          window.getSelection()?.removeAllRanges()
        }
        event.preventDefault()
        const sel = window.getSelection()
        if (sel && sel.rangeCount > 0) sel.removeAllRanges()
        schedule()
      }

      const onUp = (event: MouseEvent) => {
        // Only the primary release ends the gesture — a right/middle release
        // mid-sweep must not tear down the marquee (mirrors the entry gate).
        if (!isPrimaryRelease(event)) return
        clear()
      }

      const onScrollChange = () => {
        if (!start) return
        schedule()
      }

      const onMouseDown = (event: MouseEvent) => {
        // Re-entry guard: if a previous gesture is still armed (a stray
        // synthetic mousedown, or a mouseup that was lost to window
        // blur), don't clobber its state or stack duplicate listeners.
        if (start != null) return
        if (!shouldStartMarquee(view, event)) return
        // Yield to block-drag's padding handler when the padding click lands
        // on an MBS-covered block: that gesture owns padding-drag of an
        // existing selection. Mirrors drag-extend's identical yield
        // (drag-extend.ts onMouseDown). Without this, marquee promotes on the
        // first move and (now) claims the central registry before block-drag
        // reaches its 5px threshold — block-drag's refuse-at-entry then aborts
        // the reorder. Pairwise yield, kept in step with drag-extend via the
        // shared surface-aware cover test (`coversSurfaceBlock`): the active
        // MBS's blockIndices may be COLUMN-local (Task 5), so the point hit is
        // resolved on ITS OWN surface before comparing — a bare root-index
        // compare falsely matched a column MBS against unrelated root blocks.
        const sel = view.state.selection
        if (sel instanceof MultiBlockSelection) {
          const pointSurface = surfaceFromPoint(view, event.clientX, event.clientY)
          const headIdx = headIndexAtY(view, event.clientX, event.clientY, {
            strict: true,
            surface: pointSurface.surfacePos === -1 ? undefined : pointSurface,
          })
          if (headIdx != null && sel.coversSurfaceBlock(pointSurface.surfacePos, headIdx)) {
            return
          }
        }
        // Do NOT preventDefault here — a pure click on editor padding
        // must still let PM place the caret normally. The first move
        // (in onMove) is what claims the gesture.
        start = { x: event.clientX, y: event.clientY }
        current = start
        scrollOwner = nearestScrollOwner(getMarqueeZone(view) ?? (view.dom as HTMLElement))
        scrollOrigin = captureMarqueeScrollOrigin(scrollOwner)
        // Registered at ARM time, not promotion (#297): a window blur /
        // Escape / pointercancel during the armed stage must run clear()
        // too, or a lost mouseup leaves `start` set and the re-entry
        // guard swallows the next mousedown. clear() unregisters on
        // every exit path, so the promotion path never double-registers.
        unregisterCancel = registerDragCancelHandlers(clear)
        document.addEventListener("mousemove", onMove)
        document.addEventListener("mouseup", onUp)
        document.addEventListener("scroll", onScrollChange, { capture: true, passive: true })
      }

      // setMarqueeZone() handoff. Stash a closure that attaches the
      // mousedown handler on whichever element ends up being the
      // effective zone (default `.rune-editor` or a host override).
      const attacher: ZoneAttacher = (el) => {
        el.addEventListener("mousedown", onMouseDown)
        return () => el.removeEventListener("mousedown", onMouseDown)
      }
      zoneAttachers.set(view, attacher)

      // Re-attach to a persisted zone if one survived a previous plugin
      // view. PM destroys + re-inits ALL plugin views on every
      // state.reconfigure (e.g. host calling `editor.registerPlugin`
      // to install an unrelated decoration plugin), but zoneRegistry
      // carries the host's `setMarqueeZone` intent across that gap;
      // the listener is detached in the previous destroy() and the
      // ZONE_ATTR is left in place, so we just need to rewire the
      // mousedown. Skips pendingZones replay and installDefaultZone
      // because the registry entry already represents the active zone.
      const persisted = zoneRegistry.get(view)
      if (persisted) {
        zoneCleanups.set(view, attacher(persisted))
      } else {
        // First init for this view (no persisted registry entry).

        // Replay any setMarqueeZone call that arrived before the
        // attacher was ready. See pendingZones doc-comment above.
        if (pendingZones.has(view)) {
          const pending = pendingZones.get(view) ?? null
          pendingZones.delete(view)
          if (pending) {
            pending.setAttribute(ZONE_ATTR, "")
            zoneRegistry.set(view, pending)
            zoneCleanups.set(view, attacher(pending))
          }
        }

        // Install the default `.rune-editor` zone unless a host took
        // precedence via a (now-replayed) early setMarqueeZone call.
        //
        // Timing: in test / non-React mounts that pass `element` to
        // `new Editor`, view.dom is already inside `.rune-editor` and
        // the synchronous attempt succeeds. In `@tiptap/react`'s mount
        // path, `<EditorContent>` appends view.dom via useEffect AFTER
        // plugin view() runs — closest('.rune-editor') returns null
        // here. Retry once on the next animation frame so React's
        // commit has flushed by then. Mirrors the same pattern in
        // shared/wrapper-listener.ts. If `.rune-editor` is still
        // absent after the retry (non-Rune mount), marquee stays
        // inactive — the host can still call setMarqueeZone explicitly.
        installDefaultZone(view)
        if (!zoneRegistry.has(view)) {
          requestAnimationFrame(() => {
            if (!zoneAttachers.has(view)) return // view destroyed in the gap
            installDefaultZone(view)
          })
        }
      }

      return {
        destroy() {
          // Listener-only teardown. zoneRegistry + ZONE_ATTR are
          // intentionally left in place so they survive
          // state.reconfigure (PM destroys + re-inits all plugin views
          // on `editor.registerPlugin` etc.) — the new plugin view's
          // init re-attaches the listener via the persisted-registry
          // branch above. Final cleanup of registry + ZONE_ATTR is
          // bound to editor lifetime via `BlockSelection.onDestroy`,
          // which calls `teardownMarqueeView` before PM tears the view
          // down.
          zoneCleanups.get(view)?.()
          zoneCleanups.delete(view)
          zoneAttachers.delete(view)
          pendingZones.delete(view)
          clear()
        },
      }
    },
  })
}
