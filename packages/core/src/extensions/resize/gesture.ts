// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { Editor } from "@tiptap/core"
import type { EditorView } from "@tiptap/pm/view"
import { resolveBodyBlockById } from "../../schema/bodySurface"
import { getBlockSpecs } from "../../schema/blocks/registry"
import { registerDragCancelHandlers } from "../shared/drag-utils"
import {
  claimGesture,
  isPrimaryRelease,
  primaryLost,
  type GestureClaim,
} from "../shared/gesture-state"
import { availableContentWidth, widthPercentFromPixels } from "./geometry"
import { resizeKey } from "./state"

type ResizeSide = "start" | "end"

interface ActiveResize {
  blockId: string
  frame: HTMLElement
  media: HTMLElement | null
  handle: HTMLElement
  side: ResizeSide
  startX: number
  startWidth: number
  startPct: number
  containerWidth: number
  lastPct: number
  previousFrameWidth: string
  previousMediaPointerEvents: string
  previousBodyUserSelect: string
}

export function setupResizeGesture(view: EditorView, editor: Editor): () => void {
  let active: ActiveResize | null = null
  let claim: GestureClaim | null = null
  let unregisterCancel: (() => void) | null = null
  const doc = view.dom.ownerDocument

  const cleanup = (commit: boolean) => {
    if (!active) return
    const current = active
    const currentClaim = claim
    active = null
    claim = null

    doc.removeEventListener("mousemove", onMouseMove)
    doc.removeEventListener("mouseup", onMouseUp)
    unregisterCancel?.()
    unregisterCancel = null

    current.handle.removeAttribute("data-rune-resize-active")
    if (current.media) {
      current.media.style.pointerEvents = current.previousMediaPointerEvents
    }
    doc.body.style.userSelect = current.previousBodyUserSelect

    // Column-aware resolve: the block may live inside a `column` surface, where
    // the root-only `topLevelBlockPosById` returns -1 and the `pos >= 0` gate
    // below would drop the commit to the abort branch (preview snaps back). The
    // mousedown path already handles columns deliberately (see the media-lookup
    // comment above); the commit must match.
    const pos = resolveBodyBlockById(view.state.doc, current.blockId)?.pos ?? -1
    if (commit && currentClaim?.canCommit && pos >= 0 && current.lastPct !== current.startPct) {
      // No-flicker commit: setNodeAttribute + clear resizeKey + clear gestureKey
      // in ONE transaction. releaseInto() is ownership-guarded — it adds the
      // gestureKey clear only when the registry still reads "resize" (no thief),
      // and marks the claim released so the caller need not call release() after.
      const tr = currentClaim.releaseInto(
        view.state.tr
          .setNodeAttribute(pos, "contentWidth", current.lastPct)
          .setMeta(resizeKey, { activeBlockId: null, dragWidth: null }),
      )
      view.dispatch(tr)
      return
    }

    // Abort path: restore preview frame width.
    current.frame.style.width = current.previousFrameWidth
    // Clear resize's own visual state (never stomp a thief's gestureKey entry).
    view.dispatch(
      view.state.tr.setMeta(resizeKey, { activeBlockId: null, dragWidth: null }),
    )
    currentClaim?.release()
  }

  const onMouseMove = (e: MouseEvent) => {
    if (!active) return
    // Lost-mouseup defense (GS-2 / contract §2): primary button no longer
    // held (alt-tab, OS dialog, browser chrome) → abort, never commit.
    if (primaryLost(e)) {
      cleanup(false)
      return
    }
    // AV-2 mid-gesture editable guard (contract §2): if the editor became
    // non-editable during the drag, treat it like a lost primary → abort.
    if (!view.editable) {
      cleanup(false)
      return
    }
    e.preventDefault()
    const deltaX = e.clientX - active.startX
    const nextPx =
      active.side === "end"
        ? active.startWidth + deltaX
        : active.startWidth - deltaX
    const nextPct = widthPercentFromPixels(nextPx, active.containerWidth)
    active.lastPct = nextPct
    active.frame.style.width = `${nextPct}%`
  }

  const onMouseUp = (e: MouseEvent) => {
    if (!active) return
    // Only the primary release ends the gesture — a right/middle release
    // mid-drag must not commit (contract §3).
    if (!isPrimaryRelease(e)) return
    e.preventDefault()
    // AV-2 commit gate: if the editor became non-editable after the last
    // mousemove guard (race window between move and up), abort here too.
    cleanup(view.editable)
  }

  const onMouseDown = (e: MouseEvent) => {
    // Primary button only. Right/middle press on a resize handle must keep
    // its native behavior (context menu, autoscroll) — not claim the gesture.
    // Must run before preventDefault/claim so non-primary buttons pass through.
    if (e.button !== 0) return
    const target = e.target
    if (!(target instanceof Element)) return
    const handle = target.closest<HTMLElement>(".rune-resize-handle")
    if (!handle) return
    if (!view.dom.contains(handle)) return

    e.preventDefault()
    e.stopPropagation()

    if (!view.editable || !editor.isEditable) return

    // Resolve handle → block → frame → blockId FIRST so a degenerate DOM
    // path never requires a claim-then-release round trip.
    const block = handle.closest<HTMLElement>(".rune-block[data-id]")
    const frame = handle.closest<HTMLElement>(".rune-block-content")
    if (!block || !frame) return

    const blockId = block.getAttribute("data-id")
    if (!blockId) return

    // Claim the central gesture registry (contract §1). claimGesture() refuses
    // (returns null) if another gesture already owns it or the view is
    // destroyed. A null return means we must not arm any listeners.
    // Resize has no movement threshold — grabbing the handle IS the claim point.
    const newClaim = claimGesture(view, "resize")
    if (newClaim === null) return

    const side = handle.classList.contains("rune-resize-handle--start")
      ? "start"
      : "end"
    const containerWidth = availableContentWidth(block)
    const startWidth = frame.getBoundingClientRect().width
    const startPct = widthPercentFromPixels(startWidth, containerWidth)
    // The media element (pointer-events suppressed mid-drag so the iframe/
    // img can't swallow mousemove) is located via the spec-declared
    // resizeMediaSelector set — core carries no media DOM list. The frame
    // is THIS block's own `.rune-block-content`, so trying each declared
    // selector is unambiguous regardless of surface (works inside columns,
    // where id→pos resolution against root children would miss). `media`
    // stays null-tolerant throughout, so no match degrades to an
    // unsuppressed drag, not a broken gesture.
    let media: HTMLElement | null = null
    for (const meta of Object.values(getBlockSpecs(editor))) {
      if (!meta.resizeMediaSelector) continue
      media = frame.querySelector<HTMLElement>(meta.resizeMediaSelector)
      if (media) break
    }

    active = {
      blockId,
      frame,
      media,
      handle,
      side,
      startX: e.clientX,
      startWidth,
      startPct,
      containerWidth,
      lastPct: startPct,
      previousFrameWidth: frame.style.width,
      previousMediaPointerEvents: media?.style.pointerEvents ?? "",
      previousBodyUserSelect: doc.body.style.userSelect,
    }
    claim = newClaim

    handle.setAttribute("data-rune-resize-active", "")
    if (media) media.style.pointerEvents = "none"
    doc.body.style.userSelect = "none"

    // resizeKey preview meta: separate dispatch from the gestureKey claim
    // (claimGesture already dispatched the gestureKey tr). This is the
    // "resizeKey rides its own tr" path described in the task spec.
    view.dispatch(
      view.state.tr.setMeta(resizeKey, { activeBlockId: blockId, dragWidth: startPct }),
    )

    doc.addEventListener("mousemove", onMouseMove)
    doc.addEventListener("mouseup", onMouseUp)
    // Escape, pointercancel, and window blur all revert (cleanup(false)) —
    // the revert semantics the hand-rolled Escape handler had (the shared
    // helper doesn't preventDefault the keydown, matching the other
    // adopters). Unregistered in cleanup(), in lockstep with mousemove/mouseup.
    unregisterCancel = registerDragCancelHandlers(() => cleanup(false))
  }

  doc.addEventListener("mousedown", onMouseDown, { capture: true })

  return () => {
    doc.removeEventListener("mousedown", onMouseDown, { capture: true })
    cleanup(false)
  }
}
