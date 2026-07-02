// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { GHOST_CLASS } from "./BlockDrag"
import { findContainingBlock, viewportToCBLocal } from "./cb"

/**
 * Build the inner DOM chain: shallow-clone every ancestor between
 * `sources[0].parentElement` and `editorRoot` (EXCLUSIVE of editorRoot
 * — the preview already sits inside the real .rune-editor). The
 * innermost shell (the source's direct parent, e.g. `.ProseMirror`)
 * holds deep clones of every source in `sources` order; outer shells
 * wrap around it. cloneNode(false) carries each ancestor's class /
 * data-* / inline style (so e.g. an ordered-list <ol>'s
 * `--rune-ol-offset` CSS var rides along automatically — no per-block
 * special case).
 *
 * All sources MUST share the same `parentElement`; the caller
 * (`createPreview`) verifies this before invoking.
 *
 * Do not "simplify" by dropping the .ProseMirror shell and putting
 * the source clones directly under .rune-block-drag-preview. Multiple
 * earlier attempts at that compression have produced a visible
 * horizontal preview shift: the source's `.rune-editor .ProseMirror`
 * scoped CSS (notably the editor's horizontal padding) stops matching
 * once the .ProseMirror ancestor is gone, so preview content lands
 * inset differently from the source. The shell is load-bearing — it
 * is what makes the "zero per-block CSS" contract physically work.
 * If a horizontal shift reappears in this code path, that is the
 * canary; investigate which ancestor's scoped styles stopped matching
 * before adjusting layer count. See design spec
 * `internal design notes`
 * for the full alternatives analysis.
 */
function buildAncestorChain(
  sources: readonly HTMLElement[],
  editorRoot: HTMLElement,
): HTMLElement {
  // All sources must share parentElement (verified by caller before this
  // function is reached).
  const parent = sources[0]!.parentElement
  if (!parent) throw new Error("createPreview: source has no parent")

  const chain: HTMLElement[] = []
  for (
    let el: HTMLElement | null = parent;
    el && el !== editorRoot;
    el = el.parentElement
  ) {
    chain.push(el)
  }
  // chain[0] = source's direct parent (e.g. .ProseMirror)
  // chain[last] = direct child of editorRoot

  // Edge case: source's parent IS editorRoot (chain empty). Wrap the clones
  // in an unscoped div so the caller still has one element to append.
  if (chain.length === 0) {
    const wrap = document.createElement("div")
    for (const src of sources) {
      const clone = src.cloneNode(true) as HTMLElement
      clone.classList.remove(GHOST_CLASS)
      wrap.appendChild(clone)
    }
    return wrap
  }

  // Innermost shell (chain[0]) holds the source clones in order.
  let inner = chain[0]!.cloneNode(false) as HTMLElement
  inner.removeAttribute("contenteditable")
  for (const src of sources) {
    const clone = src.cloneNode(true) as HTMLElement
    clone.classList.remove(GHOST_CLASS)
    inner.appendChild(clone)
  }

  // Wrap each outer ancestor around the previous result. After the loop,
  // `inner` is the outermost shell (direct child of editorRoot in the
  // original DOM) — which is what the caller appends to .rune-block-drag-preview.
  for (let i = 1; i < chain.length; i++) {
    const shell = chain[i]!.cloneNode(false) as HTMLElement
    shell.removeAttribute("contenteditable")
    shell.appendChild(inner)
    inner = shell
  }
  return inner
}

export interface CreatePreviewResult {
  preview: HTMLElement
  grab: { dx: number; dy: number }
}

/**
 * Create the drag preview at threshold-cross. Mounts inside `editorRoot`,
 * positions at `sources[0]`'s rect (CB-local coords), and locks `grab` from
 * the threshold-time cursor and the first source's rect — so on the first
 * frame `cursor − grab = sources[0] rect` and the preview spawns exactly on
 * the first dragged block. `mousemove` thereafter calls
 * `updatePreviewPosition` to track the cursor.
 *
 * Width is set inline via `sources[0].offsetWidth` (CB-local layout px,
 * NOT `getBoundingClientRect().width` which is post-transform and would
 * double-scale under a scaled CB).
 *
 * Throws if `sources` is empty or if any source has a different
 * `parentElement` than `sources[0]` (flat schema invariant — all dragged
 * blocks must be siblings).
 */
export function createPreview(
  editorRoot: HTMLElement,
  sources: readonly HTMLElement[],
  thresholdCursor: { clientX: number; clientY: number },
): CreatePreviewResult {
  if (sources.length === 0) {
    throw new Error("createPreview: sources must contain at least one element")
  }
  const firstParent = sources[0]!.parentElement
  if (!sources.every((s) => s.parentElement === firstParent)) {
    throw new Error(
      "createPreview: all sources must share the same parentElement (flat schema invariant)",
    )
  }

  const wrapper = document.createElement("div")
  wrapper.className = "rune-block-drag-preview"
  wrapper.setAttribute("contenteditable", "false")

  wrapper.appendChild(buildAncestorChain(sources, editorRoot))
  editorRoot.appendChild(wrapper)

  const first = sources[0]!
  const r = first.getBoundingClientRect()

  const cb = findContainingBlock(editorRoot)
  const { x: leftLocal, y: topLocal } = viewportToCBLocal(cb, r.left, r.top)
  const { x: cursorLocalX, y: cursorLocalY } = viewportToCBLocal(
    cb,
    thresholdCursor.clientX,
    thresholdCursor.clientY,
  )
  // Grab is the cursor's offset from the source in CB-local coordinates.
  // Must be CB-local (not viewport) so that updatePreviewPosition produces
  // `cursor_local - grab = source_local` for any transform scale, keeping
  // the preview aligned with where the user clicked even as it tracks the mouse.
  const grab = {
    dx: cursorLocalX - leftLocal,
    dy: cursorLocalY - topLocal,
  }

  wrapper.style.left = `${leftLocal}px`
  wrapper.style.top = `${topLocal}px`
  wrapper.style.width = `${first.offsetWidth}px`

  return { preview: wrapper, grab }
}

/**
 * Reposition the preview to track the cursor: `cursor − grab` in CB-local
 * coords. Re-walks the CB on each call (cheap — getComputedStyle on ~5
 * ancestors is sub-1ms per frame; YAGNI on caching).
 */
export function updatePreviewPosition(
  preview: HTMLElement,
  editorRoot: HTMLElement,
  cursor: { clientX: number; clientY: number },
  grab: { dx: number; dy: number },
): void {
  const cb = findContainingBlock(editorRoot)
  const { x: cursorLocalX, y: cursorLocalY } = viewportToCBLocal(
    cb,
    cursor.clientX,
    cursor.clientY,
  )
  preview.style.left = `${cursorLocalX - grab.dx}px`
  preview.style.top = `${cursorLocalY - grab.dy}px`
}

export function destroyPreview(preview: HTMLElement): void {
  preview.remove()
}
