// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { Transaction } from "@tiptap/pm/state"
import {
  MAX_CONTENT_WIDTH,
  MIN_CONTENT_WIDTH,
} from "../../blocks/media/contentWidth"

/**
 * Rescale a media block's `contentWidth` percentage so the user's chosen PIXEL
 * width survives a move to a surface of a DIFFERENT container width (root ↔
 * column, column ↔ column).
 *
 * `contentWidth` is stored as a % of the block's own surface container: the
 * user picked `oldPct%` of `srcPx` pixels = `oldPct/100 * srcPx` px. On a
 * `destPx`-wide surface that same pixel width is `oldPct * srcPx / destPx`% —
 * the returned value, rounded and clamped to `[MIN_CONTENT_WIDTH,
 * MAX_CONTENT_WIDTH]` so it stays a valid stored percentage.
 *
 * View-layer only: this is used by the drag gesture on a cross-surface drop.
 * Storage stays %, and the headless `moveBlocks` command keeps pure %
 * semantics (it never calls this).
 *
 * Pure — no DOM. When `srcPx`/`destPx` are unmeasurable (non-finite, or
 * `destPx <= 0`) it returns the clamped original as defense in depth; the
 * gesture already gates on measurability and never passes such values.
 */
export function rescaleContentWidthPct(
  oldPct: number,
  srcPx: number,
  destPx: number,
): number {
  const raw =
    Number.isFinite(oldPct) &&
    Number.isFinite(srcPx) &&
    Number.isFinite(destPx) &&
    srcPx > 0 &&
    destPx > 0
      ? (oldPct * srcPx) / destPx
      : oldPct
  return Math.max(
    MIN_CONTENT_WIDTH,
    Math.min(MAX_CONTENT_WIDTH, Math.round(raw)),
  )
}

/**
 * Apply {@link rescaleContentWidthPct} to every just-moved block in
 * `[insertPos, insertPos + rangeSize)` that carries a non-null `contentWidth`,
 * mutating `tr` in place. Used as the drag gesture's `executeReorder` `onMoved`
 * hook on a cross-surface drop; `srcPx`/`destPx` are the source/destination
 * surface container widths measured on the DOM before dispatch.
 *
 * Applies only to the moved blocks — the direct children the slice landed as —
 * NOT their descendants (`return false` past an applied block). But it MUST
 * descend THROUGH the ancestor containers of the moved span: when the drop
 * lands inside a `column`, `nodesBetween` visits the enclosing `columnLayout`
 * and `column` first, and their own pos is `< insertPos`. Returning `false`
 * there (as a bare `nodePos < insertPos` guard would) cuts off descent before
 * ever reaching the moved block sitting inside the column — the "walk misses
 * column children" bug. So an ancestor (`nodePos < insertPos`, necessarily a
 * container spanning `insertPos`) is descended into WITHOUT being applied; the
 * moved run itself never contains a `columnLayout` (no run with a layout can
 * cross into a column), so there is no nested media below a moved block to
 * reach. A block whose rescaled percent equals its current one adds no step
 * (keeps same-ratio moves step-free). Root drops have no such ancestors, so the
 * walk is unchanged there.
 */
export function rescaleMovedContentWidths(
  tr: Transaction,
  insertPos: number,
  rangeSize: number,
  srcPx: number,
  destPx: number,
): void {
  const sliceEnd = insertPos + rangeSize
  tr.doc.nodesBetween(insertPos, sliceEnd, (node, nodePos) => {
    // Ancestor container of the moved span (a columnLayout / column the slice
    // dropped inside): descend, but never apply — its pos is before the run.
    if (nodePos < insertPos) return true
    if (nodePos >= sliceEnd) return false
    const cw = node.attrs.contentWidth
    if (typeof cw === "number") {
      const next = rescaleContentWidthPct(cw, srcPx, destPx)
      if (next !== cw) tr.setNodeAttribute(nodePos, "contentWidth", next)
    }
    return false
  })
}
