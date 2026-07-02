// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { EditorState, Transaction } from "@tiptap/pm/state"
import { TextSelection } from "@tiptap/pm/state"
import type { Node as ProseMirrorNode, ResolvedPos } from "@tiptap/pm/model"
import type { DropTarget } from "./types"
import { MultiBlockSelection } from "../block-selection/MultiBlockSelection"
import { surfaceChildrenAt } from "../../schema/bodySurface"
import { unwrapLayoutInTr } from "../../blocks/Columns/normalization"

export interface ReorderSource {
  from: number
  to: number
  selectionMode: "text" | "mbs"
  textSelectionRestorePos?: number
}

/**
 * F2 payload: the source `column` a move fully empties, plus its enclosing
 * `columnLayout`. All positions are against the PRE-move document. The move
 * core uses it to decide between deleting the column node (≥2 columns survive)
 * and unwrapping the layout (<2 survive — "content stays put"). Produced by
 * `resolveMove`; consumed by `executeMoveSlice` / `removeMoveSource`.
 */
export interface EmptiedSourceColumn {
  /** Absolute pos of the emptied `column` node. */
  columnPos: number
  /** Absolute pos of the enclosing `columnLayout` node. */
  layoutPos: number
  /** The enclosing `columnLayout` node. */
  layoutNode: ProseMirrorNode
  /** How many `column` children remain after this column is removed. */
  remainingColumnCount: number
  /** The lone surviving column when `remainingColumnCount === 1`, else null. */
  survivor: ProseMirrorNode | null
}

/**
 * The ONE move-execution core (F1). Both drag-drop (`executeReorder`) and the
 * `moveBlocks` command (`api/commands/index.ts`) route through this; it owns
 * the slice → delete → mapped insert → surface-local depth re-base path, plus
 * F2's emptied-source-column removal. Selection restore is the CALLER's job
 * (drag and command restore against different surfaces / modes), so this core
 * mutates only the document and leaves the tr's selection untouched.
 *
 * It MUTATES the passed-in `tr` (callers control tr creation / chaining) and
 * returns the mapped insert boundary + the moved block count, which the caller
 * needs to compute the post-move selection. Returns `null` for a drop-on-self
 * no-op (insert boundary lands inside the moved range) — the caller should not
 * dispatch.
 */
export interface MoveSliceDest {
  /** PM position to insert at, against the PRE-move document. */
  insertPos: number
  /** Absolute pos of the destination surface, or `-1` for the doc root. */
  surfacePos: number
}

export interface MoveSliceOpts {
  /**
   * Depth attribute the first depth-bearing block in the inserted slice should
   * end up at. The delta from that first block is applied to every block in
   * the slice (clamped to >= 0). Absent = no depth changes.
   */
  newDepthAttr?: number
  /**
   * F2: when set, the move fully empties this source column and it must be
   * removed in the same tr. The core deletes the column node when ≥2 columns
   * survive, or unwraps the layout (splice survivor children to root) when <2
   * survive — PM's `column{2,5}` fitting refuses a bare 2→1 column delete, so
   * the 2→1 case dissolves at the layout level here.
   */
  emptiedSourceColumn?: EmptiedSourceColumn | null
}

export interface MoveSliceResult {
  /** The mapped insert boundary (post-delete) the slice was inserted at. */
  insertPos: number
  /** Number of top-level blocks moved (slice child count). */
  blockCount: number
}

/**
 * Step 1 of the move core, isolated: remove the source from `tr`. A normal
 * move deletes just `[from,to)`; an F2 emptied-source-column move removes the
 * whole column (delete the column node when ≥2 survive, else unwrap the layout
 * — PM's `column{2,5}` fitting refuses a bare 2→1 column delete). Exported so
 * the `moveBlocks` command can replay the EXACT same removal on a throwaway
 * probe state to compute the destination's mapped insert pos (depth neighbor).
 */
export function removeMoveSource(
  tr: Transaction,
  source: { from: number; to: number },
  emptiedSourceColumn?: EmptiedSourceColumn | null,
): void {
  if (emptiedSourceColumn) {
    const ec = emptiedSourceColumn
    if (ec.remainingColumnCount >= 2) {
      const colNode = tr.doc.nodeAt(ec.columnPos)
      if (colNode && colNode.type.name === "column") {
        tr.delete(ec.columnPos, ec.columnPos + colNode.nodeSize)
        return
      }
    } else {
      const layoutNode = tr.doc.nodeAt(ec.layoutPos)
      if (layoutNode && layoutNode.type.name === "columnLayout") {
        unwrapLayoutInTr(tr, ec.layoutPos, layoutNode, ec.survivor)
        return
      }
    }
  }
  tr.delete(source.from, source.to)
}

/**
 * Surface-local depth re-base of a just-inserted slice. Computes the delta from
 * the first depth-bearing block in `[insertPos, insertPos + rangeSize)` to
 * `newDepthAttr` and applies it to every block in that span (clamped to >= 0).
 * No-op when `newDepthAttr` is undefined. See `DropTarget` JSDoc.
 *
 * The walk must descend THROUGH the ancestor containers of the moved span: on a
 * drop INSIDE a `column`, `nodesBetween` visits the enclosing columnLayout /
 * column first, whose own pos is `< insertPos`. A bare `nodePos < insertPos →
 * false` guard cut off descent there, so a block dropped inside a column kept
 * its old (root-surface) depth — the same "walk misses column children" bug the
 * cross-surface contentWidth rescale hit. Ancestors are descended but never
 * re-based (their pos is before the run); root drops have no such ancestors, so
 * the walk is unchanged there.
 */
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
    // Ancestor container spanning the moved run: descend, never re-base.
    if (nodePos < insertPos) return true
    if (nodePos >= sliceEnd) return false
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

export function executeMoveSlice(
  tr: Transaction,
  source: { from: number; to: number },
  dest: MoveSliceDest,
  opts: MoveSliceOpts = {},
): MoveSliceResult | null {
  // Drop-on-self guard: closed interval. Dropping at source.from or source.to
  // or anywhere in between is a no-op.
  if (dest.insertPos >= source.from && dest.insertPos <= source.to) return null

  const slice = tr.doc.slice(source.from, source.to)
  // Block-boundary invariant. from/to MUST sit on top-level boundaries. A
  // non-clean slice means the caller passed positions inside a textblock —
  // caller bug. The old hard throw is retired per F1; we warn (matching this
  // package's non-throwing `console.warn` convention, e.g. MultiBlockSelection)
  // and return null so the cause is visible without crashing the editor.
  if (slice.openStart !== 0 || slice.openEnd !== 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `executeMoveSlice: from/to must sit on block boundaries (got openStart=${slice.openStart}, openEnd=${slice.openEnd}); skipping move`,
    )
    return null
  }

  const blockCount = slice.content.childCount
  const rangeSize = source.to - source.from

  // F2 special case — move INTO the column that is about to be unwrapped. When
  // the move both empties the source column AND drops the layout below 2 columns
  // (unwrap), and the destination is interior to that SAME layout (i.e. into the
  // surviving column), a plain remove-then-insert is wrong: `removeMoveSource`
  // dissolves the whole layout with a single `replaceWith` over [layoutPos,
  // layoutEnd], and an interior `dest.insertPos` maps onto that replacement
  // boundary — collapsing the slice to the FRONT of the spliced content
  // regardless of the requested index. Handle it atomically instead: splice the
  // surviving column's children to root WITH the moved slice already inserted at
  // the requested boundary, in one replace. (The emptied source column is inside
  // the same layout, so it is dropped by the replace; nothing else moves.)
  const ec = opts.emptiedSourceColumn
  if (
    ec &&
    ec.remainingColumnCount < 2 &&
    ec.survivor &&
    dest.insertPos > ec.layoutPos &&
    dest.insertPos < ec.layoutPos + ec.layoutNode.nodeSize
  ) {
    const survSurface = surfaceChildrenAt(tr.doc, dest.insertPos)
    if (survSurface && survSurface.pos !== -1) {
      const finalChildren: ProseMirrorNode[] = []
      let movedStartOffset = 0
      let off = survSurface.start
      survSurface.node.forEach((child) => {
        if (off < dest.insertPos) {
          finalChildren.push(child)
          movedStartOffset += child.nodeSize
        }
        off += child.nodeSize
      })
      slice.content.forEach((n) => finalChildren.push(n))
      let off2 = survSurface.start
      survSurface.node.forEach((child) => {
        if (off2 >= dest.insertPos) finalChildren.push(child)
        off2 += child.nodeSize
      })
      tr.replaceWith(
        ec.layoutPos,
        ec.layoutPos + ec.layoutNode.nodeSize,
        finalChildren,
      )
      const adjustedInsertPos = ec.layoutPos + movedStartOffset
      rebaseSliceDepth(tr, adjustedInsertPos, rangeSize, opts.newDepthAttr)
      return { insertPos: adjustedInsertPos, blockCount }
    }
  }

  // 1. Remove the source. For a normal move we delete just [from,to). For an
  //    F2 emptied-source-column move we remove the COLUMN instead (delete the
  //    column node when ≥2 survive, else unwrap the layout — "content stays
  //    put"). The moved slice was captured above, so dissolving the column does
  //    not lose it; we re-insert it at the (mapped) destination next.
  removeMoveSource(tr, source, opts.emptiedSourceColumn)

  // 2. Map the insert boundary THROUGH the delete step rather than subtracting
  //    rangeSize manually. For a flat root move the two are identical; they
  //    DIVERGE when the delete empties a `block+` surface (PM backfills) or
  //    when an F2 removal dissolved a whole column/layout. `tr.mapping.map`
  //    tracks the real shift.
  const adjustedInsertPos = tr.mapping.map(dest.insertPos, -1)
  tr.insert(adjustedInsertPos, slice.content)

  // 3. Surface-local depth re-base of the inserted slice.
  rebaseSliceDepth(tr, adjustedInsertPos, rangeSize, opts.newDepthAttr)

  return { insertPos: adjustedInsertPos, blockCount }
}

/**
 * Resolve the destination surface (`column` node or doc root) at a boundary
 * position in the POST-move document, returning the ResolvedPos whose `parent`
 * is that surface — the `surface?` argument `MultiBlockSelection.create` wants
 * to build a sibling-range selection on the right surface (kills the old
 * root-only `.index(0)`). For the root surface returns `undefined` (create's
 * default = the doc root, which reproduces the historical behavior).
 */
function surfaceResolvedPos(
  doc: import("@tiptap/pm/model").Node,
  insertPos: number,
): { $surface: ResolvedPos | undefined; surfaceStart: number } {
  const surface = surfaceChildrenAt(doc, insertPos)
  if (!surface || surface.pos === -1) {
    return { $surface: undefined, surfaceStart: 0 }
  }
  // A position at the surface's content start resolves INTO the surface; its
  // parent is the surface node, at the depth MultiBlockSelection expects.
  return { $surface: doc.resolve(surface.start), surfaceStart: surface.start }
}

/**
 * Restore an MBS over the just-moved blocks, against the DESTINATION surface.
 * Replaces the old root-only `.index(0)` with a surface-aware index: the slice
 * landed at `insertPos` on whatever surface contains it (root or a column), so
 * the lo/hi indices are computed within THAT surface and the selection is built
 * with the surface ResolvedPos.
 */
export function restoreMbs(tr: Transaction, insertPos: number, blockCount: number): void {
  const { $surface, surfaceStart } = surfaceResolvedPos(tr.doc, insertPos)
  // Index of the first moved block within its surface.
  const surfaceDepth = $surface ? $surface.depth : 0
  const lo = tr.doc.resolve(Math.max(insertPos, surfaceStart)).index(surfaceDepth)
  const hi = lo + blockCount - 1
  tr.setSelection(MultiBlockSelection.create(tr.doc, lo, hi, $surface))
}

/**
 * Cross-surface drop options (Task 3). All OPTIONAL — omitting them reproduces
 * the pre-Phase-2 root↔root drag byte-for-byte (same tr steps, same selection),
 * which the frozen drag regression suite relies on.
 */
export interface ReorderDestOpts {
  /**
   * Absolute pos of the destination surface, or `-1` (the default) for the doc
   * root. Threaded to `executeMoveSlice` for F2's interior-to-surviving-column
   * special case; the post-move selection surface is still resolved from the
   * mapped insert pos regardless.
   */
  destSurfacePos?: number
  /** F2 payload (see `resolveEmptiedSourceColumnForMove`). */
  emptiedSourceColumn?: EmptiedSourceColumn | null
  /**
   * Selection-restore override. The drag gesture mirrors the `moveBlocks`
   * command's rule: a pure root→root move restores an MBS (when the source was
   * an MBS); ANY move touching a column interior (source OR dest non-root) lands
   * a TEXT CARET instead (MBS-inside-columns paint/keyboard is Task 5). When
   * `forceTextCaret` is true the MBS branch is suppressed even for an mbs-mode
   * source. Default false = legacy behavior (mode decides).
   */
  forceTextCaret?: boolean
  /**
   * Post-move hook (Task G), invoked with the SAME `tr` after the slice landed
   * and before selection restore, so any edits it makes undo as one step. The
   * drag gesture uses it to rescale moved media blocks' `contentWidth` into the
   * destination surface's container (pixel-preserving cross-surface resize).
   *
   * OPTIONAL and only ever passed by the drag gesture for a cross-surface drop
   * with measurable container widths — omitting it (the default, and what the
   * `moveBlocks` command / block-selection commands do) reproduces the frozen
   * root→root tr-step contract byte-for-byte. A hook that adds no steps also
   * keeps the contract; the gesture skips it entirely when there is nothing to
   * rescale.
   */
  onMoved?: (tr: Transaction, result: MoveSliceResult) => void
}

export function executeReorder(
  state: EditorState,
  source: ReorderSource,
  target: DropTarget,
  destOpts: ReorderDestOpts = {},
): Transaction | null {
  const tr = state.tr
  const result = executeMoveSlice(
    tr,
    { from: source.from, to: source.to },
    // Default surfacePos: -1 (root) — byte-identical to the pre-Task-3 drag.
    // The gesture passes the live destination surface for cross-surface drops;
    // the post-move selection surface is resolved from the mapped insert pos
    // regardless (see restoreMbs).
    { insertPos: target.insertPos, surfacePos: destOpts.destSurfacePos ?? -1 },
    {
      newDepthAttr: target.newDepthAttr,
      emptiedSourceColumn: destOpts.emptiedSourceColumn ?? null,
    },
  )
  if (!result) return null

  // Post-move hook (Task G): runs on the same `tr`, before selection restore,
  // so its edits (contentWidth rescale) share the move's undo step. Position-
  // neutral (setNodeAttribute only), so selection restore below is unaffected.
  // Undefined for same-surface drags and non-gesture callers → no extra steps.
  destOpts.onMoved?.(tr, result)

  // Selection restoration (caller's responsibility — surface-aware).
  // `forceTextCaret` lands a caret for any column-touching move (Task 5 owns
  // column MBS paint/keyboard); the MBS branch stays the root↔root path.
  if (source.selectionMode === "mbs" && !destOpts.forceTextCaret) {
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
    // No delete/insert here — the blocks stay at `source.from`. Restore the MBS
    // against the source's own surface (depth-only changes never cross
    // surfaces), replacing the old root-only `.index(0)`.
    let blockCount = 0
    tr.doc.nodesBetween(source.from, source.to, (_node, nodePos) => {
      if (nodePos >= source.from && nodePos < source.to) blockCount++
      return false
    })
    restoreMbs(tr, source.from, blockCount)
  } else {
    const restorePos =
      source.textSelectionRestorePos == null
        ? source.from + 1
        : source.textSelectionRestorePos
    tr.setSelection(TextSelection.create(tr.doc, restorePos))
  }

  return tr
}
