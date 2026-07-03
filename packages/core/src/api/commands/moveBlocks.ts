// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import {
  resolveBodyBlockById,
  resolveColumnById,
  surfaceChildrenAt,
  surfaceChildrenInRange,
  depthSubtreeRange,
} from "../../schema/bodySurface"
import type { EmptiedSourceColumn } from "../../extensions/block-drag/reorder"
import type { MoveBlocksTarget } from "../types"

export type { EmptiedSourceColumn }

export interface ResolvedMove {
  from: number
  to: number
  insertPos: number
  /** Absolute pos of the destination surface, or `-1` for the root. */
  destSurfacePos: number
  /**
   * Whether EITHER endpoint (source or destination) sits on a non-root
   * surface — i.e. a column interior is involved on either side. Drives the
   * selection mode: ONLY a pure root→root move keeps the MBS restoration
   * (Phase-0 behavior, characterized); any move touching a column uses a text
   * caret, because executeReorder's MBS restore computes a root-level
   * `.index(0)` that is wrong for a column interior (MBS inside columns is
   * Phase 2 — out of scope here). NB: a same-surface INTRA-column move is not
   * "cross-surface" yet still must use the text caret, which is why this is a
   * non-root test on either endpoint, not a source≠dest test.
   */
  nonRootSurface: boolean
  /**
   * F2: when the source range covers ALL the children of its source column
   * AND the destination is NOT that same column (a true move-out, not an
   * intra-column reorder), the source column must be removed in the same
   * transaction — `null` otherwise. Carries the enclosing layout + the column
   * being emptied so the move core can either delete the column node (≥2
   * columns survive) or unwrap the layout (<2 survive, "content stays put").
   */
  emptiedSourceColumn: EmptiedSourceColumn | null
}

/**
 * A contiguous run of sibling body blocks on a single surface, resolved from
 * stable block ids. Shared source contract of `moveBlocks` and
 * `wrapIntoColumns`.
 */
export interface ContiguousSourceRun {
  from: number
  to: number
  /** Absolute pos of the surface the run lives on, or `-1` for the root. */
  surfacePos: number
  /**
   * Number of top-level (surface-local) blocks in the run. Usually
   * `ids.length`, but can exceed it: the run's TAIL is widened over its
   * depth subtree (see `resolveContiguousSourceRun`), so a parent id whose
   * deeper-depth children weren't explicitly listed still reports their
   * count here — callers comparing against a surface's total child count
   * (F2's emptied-source-column check) need the ACTUAL moved count.
   */
  count: number
}

/**
 * Resolve `ids` (recursively — root or column children) to a CONTIGUOUS run
 * of siblings on a SINGLE surface. A non-contiguous selection, an unknown id,
 * or a selection spanning two surfaces returns `null`.
 *
 * The run's tail is widened over the depth subtree of EVERY requested id —
 * live-Notion research confirmed a moved (or deleted) parent always carries
 * its deeper-depth following siblings, never orphaning them at the source
 * (see `deleteBlocks.ts`'s `resolveDeleteRanges`, which widens each anchor
 * the same way). Widening only the LAST id is not enough: when the ids are a
 * parent plus a proper PREFIX of its children (`['parent', 'childA']` with
 * `childB` following), the parent's subtree extends past the tail id and
 * `childB` would be stranded at the source as an orphan.
 */
export function resolveContiguousSourceRun(
  doc: ProseMirrorNode,
  ids: string[],
): ContiguousSourceRun | null {
  const resolvedSources = ids.map((id) => resolveBodyBlockById(doc, id))
  if (resolvedSources.length === 0 || resolvedSources.some((s) => s == null)) {
    return null
  }
  const sources = resolvedSources.map((s) => s!)

  // Single-surface contract for the source: all sources share one surface.
  const sourceSurfacePos = sources[0]!.surfacePos
  if (sources.some((s) => s.surfacePos !== sourceSurfacePos)) return null

  // Contiguity: sorted surface-local indices must be consecutive.
  const sortedByIndex = [...sources].sort(
    (a, b) => a.indexInSurface - b.indexInSurface,
  )
  for (let i = 1; i < sortedByIndex.length; i++) {
    if (sortedByIndex[i]!.indexInSurface !== sortedByIndex[i - 1]!.indexInSurface + 1) {
      return null
    }
  }

  const first = sortedByIndex[0]!
  const last = sortedByIndex[sortedByIndex.length - 1]!
  let to = last.pos + last.node.nodeSize
  for (const source of sortedByIndex) {
    const { to: subtreeTo } = depthSubtreeRange(doc, source.pos)
    to = Math.max(to, subtreeTo)
  }
  // Recount the surface's ACTUAL children in the (possibly widened) range —
  // `sources.length` alone would undercount when the tail widen swept in
  // depth-children not present in `ids`.
  const count = surfaceChildrenInRange(doc, { from: first.pos, to }).length

  return {
    from: first.pos,
    to,
    surfacePos: sourceSurfacePos,
    count,
  }
}

/**
 * COL-1 no-nesting check, shared across every path that can land a run inside
 * a column: does the run `[from, to)` contain a `columnLayout` among its
 * surface children? Used by `resolveMove` (column destinations), by
 * `resolveWrapIntoColumns` (the destination is a column interior by
 * construction), and by the block-drag gesture's `draggedContainsLayout` gate
 * — one predicate so the command contract and the drag UI can never disagree.
 */
export function runContainsColumnLayout(
  doc: ProseMirrorNode,
  run: { from: number; to: number },
): boolean {
  return surfaceChildrenInRange(doc, run).some(
    (node) => node.type.name === "columnLayout",
  )
}

/**
 * Resolve a `moveBlocks` source range + destination boundary.
 *
 * Source: see `resolveContiguousSourceRun`.
 *
 * Target: a sibling target (`{ id, side }`) resolves relative to a block on
 * any surface; a column target (`{ columnId, index | at:"end" }`) resolves to
 * a boundary inside the named column.
 */
export function resolveMove(
  doc: ProseMirrorNode,
  ids: string[],
  target: MoveBlocksTarget,
): ResolvedMove | null {
  const run = resolveContiguousSourceRun(doc, ids)
  if (!run) return null

  const dest = resolveDestination(doc, target)
  if (dest === null) return null

  // COL-1 no-nesting guard: a run containing a `columnLayout` may never land
  // on a NON-ROOT surface (a column interior). Same invariant insertBlocks
  // (`insertWouldNestColumnLayout`), wrapIntoColumns, the slash item, and
  // transformPasted enforce — refusing here makes it a COMMAND contract
  // (return false, doc untouched) instead of leaning on ColumnsNormalization's
  // flatten safety-net, which was designed as a catch-all, not an API.
  if (dest.surfacePos !== -1 && runContainsColumnLayout(doc, run)) return null

  // F2: detect a move that fully empties its source column. Shared with the
  // cross-surface block-drag gesture (`block-drag/gesture.ts`) via
  // `resolveEmptiedSourceColumnForMove` so the command path and the drag path
  // compute the SAME payload from the same inputs.
  const emptiedSourceColumn = resolveEmptiedSourceColumnForMove(
    doc,
    run.surfacePos,
    dest.surfacePos,
    run.count,
  )

  return {
    from: run.from,
    to: run.to,
    insertPos: dest.insertPos,
    destSurfacePos: dest.surfacePos,
    nonRootSurface: run.surfacePos !== -1 || dest.surfacePos !== -1,
    emptiedSourceColumn,
  }
}

/** The number of body-block children of the column at `columnPos`. */
function sourceColumnChildCount(doc: ProseMirrorNode, columnPos: number): number {
  const column = doc.nodeAt(columnPos)
  return column && column.type.name === "column" ? column.childCount : -1
}

/**
 * F2 detection, shared between the `moveBlocks` command and the cross-surface
 * block-drag gesture (`extensions/block-drag/gesture.ts`). Returns the emptied-
 * source-column payload — or `null` — from the SAME inputs both call sites have
 * at hand: the pre-move doc, the source surface pos, the resolved destination
 * surface pos, and how many top-level blocks are moving.
 *
 * A move empties its source column when ALL of the following hold:
 *   - the source lives on a column surface (`sourceSurfacePos !== -1`),
 *   - the destination is NOT that same column (an intra-column reorder keeps the
 *     column non-empty), and
 *   - the moved run covers EVERY child of that column (`movedBlockCount` equals
 *     the column's child count).
 *
 * Carries the enclosing layout + the column being emptied so the move core can
 * either delete the column node (≥2 columns survive) or unwrap the layout
 * (<2 survive — "content stays put"). Exported so the drag drop and the command
 * agree byte-for-byte on the F2 payload.
 */
export function resolveEmptiedSourceColumnForMove(
  doc: ProseMirrorNode,
  sourceSurfacePos: number,
  destSurfacePos: number,
  movedBlockCount: number,
): EmptiedSourceColumn | null {
  if (
    sourceSurfacePos !== -1 &&
    destSurfacePos !== sourceSurfacePos &&
    movedBlockCount === sourceColumnChildCount(doc, sourceSurfacePos)
  ) {
    return resolveEmptiedSourceColumn(doc, sourceSurfacePos)
  }
  return null
}

/**
 * Resolve the F2 emptied-source-column payload: walk up from the column to its
 * enclosing `columnLayout`, count the columns that survive the removal, and
 * pick the lone survivor when exactly one remains.
 */
function resolveEmptiedSourceColumn(
  doc: ProseMirrorNode,
  columnPos: number,
): EmptiedSourceColumn | null {
  const $col = doc.resolve(columnPos)
  // The column's parent is the columnLayout; its pos is one level up.
  const layoutDepth = $col.depth // column sits at layoutDepth; layout is depth-1 parent
  const layoutNode = $col.node(layoutDepth) // the columnLayout
  if (!layoutNode || layoutNode.type.name !== "columnLayout") return null
  const layoutPos = $col.before(layoutDepth)

  let remaining = 0
  let survivor: ProseMirrorNode | null = null
  layoutNode.forEach((child, _offset, index) => {
    if (child.type.name !== "column") return
    // Skip the column being emptied (identified by its surface pos).
    const childPos = layoutPos + 1 + offsetOfChild(layoutNode, index)
    if (childPos === columnPos) return
    remaining += 1
    if (!survivor) survivor = child
  })

  return {
    columnPos,
    layoutPos,
    layoutNode,
    remainingColumnCount: remaining,
    survivor: remaining === 1 ? survivor : null,
  }
}

/** Absolute content offset (within the parent) of the child at `index`. */
function offsetOfChild(parent: ProseMirrorNode, index: number): number {
  let offset = 0
  for (let i = 0; i < index; i++) offset += parent.child(i).nodeSize
  return offset
}

/**
 * Resolve a move destination to an absolute insert boundary + the surface it
 * lands on. Returns `null` for an unknown target.
 */
function resolveDestination(
  doc: ProseMirrorNode,
  target: MoveBlocksTarget,
): { insertPos: number; surfacePos: number } | null {
  if ("columnId" in target) {
    const column = resolveColumnById(doc, target.columnId)
    if (!column) return null
    const contentStart = column.pos + 1
    if ("at" in target) {
      return {
        insertPos: contentStart + column.node.content.size,
        surfacePos: column.pos,
      }
    }
    const index = Math.max(0, Math.min(target.index, column.node.childCount))
    let offset = contentStart
    for (let i = 0; i < index; i++) offset += column.node.child(i).nodeSize
    return { insertPos: offset, surfacePos: column.pos }
  }

  // Sibling target: resolve the block (any surface), then place before/after.
  const targetBlock = resolveBodyBlockById(doc, target.id)
  if (!targetBlock) return null
  const surface = surfaceChildrenAt(doc, targetBlock.pos)
  const surfacePos = surface ? surface.pos : -1
  const insertPos =
    target.side === "before"
      ? targetBlock.pos
      : targetBlock.pos + targetBlock.node.nodeSize
  return { insertPos, surfacePos }
}
