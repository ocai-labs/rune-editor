// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { EditorState, Transaction } from "@tiptap/pm/state"
import { TextSelection } from "@tiptap/pm/state"
import type { DropTarget } from "./types"
import { MultiBlockSelection } from "../block-selection/MultiBlockSelection"

export interface ReorderSource {
  from: number
  to: number
  selectionMode: "text" | "mbs"
  textSelectionRestorePos?: number
}

export interface MoveSliceDest {
  /** PM position to insert at, against the pre-move document. */
  insertPos: number
}

export interface MoveSliceOpts {
  /** Desired depth of the first depth-bearing block in the moved slice. */
  newDepthAttr?: number
}

export interface MoveSliceResult {
  insertPos: number
  blockCount: number
}

export function removeMoveSource(
  tr: Transaction,
  source: { from: number; to: number },
): void {
  tr.delete(source.from, source.to)
}

function rebaseSliceDepth(
  tr: Transaction,
  insertPos: number,
  rangeSize: number,
  newDepthAttr: number | undefined,
): void {
  if (newDepthAttr === undefined) return
  const sliceEnd = insertPos + rangeSize
  let delta: number | null = null
  tr.doc.nodesBetween(insertPos, sliceEnd, (node, nodePos) => {
    if (nodePos < insertPos || nodePos >= sliceEnd) return false
    if (node.attrs.depth === undefined) return false
    const current = typeof node.attrs.depth === "number" ? node.attrs.depth : 0
    if (delta === null) delta = newDepthAttr - current
    const next = Math.max(0, current + delta)
    if (next !== current) {
      tr.setNodeMarkup(nodePos, null, { ...node.attrs, depth: next })
    }
    return false
  })
}

/** Shared document-mutation core for drag reorder and `moveBlocks`. */
export function executeMoveSlice(
  tr: Transaction,
  source: { from: number; to: number },
  dest: MoveSliceDest,
  opts: MoveSliceOpts = {},
): MoveSliceResult | null {
  if (dest.insertPos >= source.from && dest.insertPos <= source.to) return null

  const slice = tr.doc.slice(source.from, source.to)
  if (slice.openStart !== 0 || slice.openEnd !== 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `executeMoveSlice: from/to must sit on block boundaries (got openStart=${slice.openStart}, openEnd=${slice.openEnd}); skipping move`,
    )
    return null
  }

  const blockCount = slice.content.childCount
  const rangeSize = source.to - source.from
  const mapFrom = tr.mapping.maps.length
  removeMoveSource(tr, source)
  const adjustedInsertPos = tr.mapping.slice(mapFrom).map(dest.insertPos, -1)
  tr.insert(adjustedInsertPos, slice.content)
  rebaseSliceDepth(tr, adjustedInsertPos, rangeSize, opts.newDepthAttr)
  return { insertPos: adjustedInsertPos, blockCount }
}

export function restoreMbs(
  tr: Transaction,
  insertPos: number,
  blockCount: number,
): void {
  const lo = tr.doc.resolve(insertPos).index(0)
  tr.setSelection(MultiBlockSelection.create(tr.doc, lo, lo + blockCount - 1))
}

export function executeReorder(
  state: EditorState,
  source: ReorderSource,
  target: DropTarget,
): Transaction | null {
  const tr = state.tr
  const result = executeMoveSlice(
    tr,
    { from: source.from, to: source.to },
    { insertPos: target.insertPos },
    { newDepthAttr: target.newDepthAttr },
  )
  if (!result) return null

  if (source.selectionMode === "mbs") {
    restoreMbs(tr, result.insertPos, result.blockCount)
  } else {
    const restorePos =
      source.textSelectionRestorePos == null
        ? result.insertPos + 1
        : result.insertPos + (source.textSelectionRestorePos - source.from)
    tr.setSelection(TextSelection.create(tr.doc, restorePos))
  }
  return tr
}

export function executeDepthOnlyChange(
  state: EditorState,
  source: ReorderSource,
  newDepthAttr: number,
): Transaction | null {
  let delta: number | null = null
  const targets: Array<{
    pos: number
    current: number
    attrs: Record<string, unknown>
  }> = []

  state.doc.nodesBetween(source.from, source.to, (node, nodePos) => {
    if (nodePos < source.from || nodePos >= source.to) return false
    if (node.attrs.depth === undefined) return false
    const current = typeof node.attrs.depth === "number" ? node.attrs.depth : 0
    if (delta === null) delta = newDepthAttr - current
    targets.push({ pos: nodePos, current, attrs: node.attrs as Record<string, unknown> })
    return false
  })

  if (delta === null || delta === 0) return null
  const tr = state.tr
  for (const target of targets) {
    const next = Math.max(0, target.current + delta)
    if (next !== target.current) {
      tr.setNodeMarkup(target.pos, null, { ...target.attrs, depth: next })
    }
  }
  if (tr.steps.length === 0) return null

  if (source.selectionMode === "mbs") {
    let blockCount = 0
    tr.doc.nodesBetween(source.from, source.to, (_node, nodePos) => {
      if (nodePos >= source.from && nodePos < source.to) blockCount++
      return false
    })
    restoreMbs(tr, source.from, blockCount)
  } else {
    tr.setSelection(
      TextSelection.create(
        tr.doc,
        source.textSelectionRestorePos ?? source.from + 1,
      ),
    )
  }
  return tr
}
