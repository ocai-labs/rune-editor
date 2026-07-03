// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { CommandProps } from "@tiptap/core"
import type { Node as ProseMirrorNode, Schema } from "@tiptap/pm/model"
import type { Transaction } from "@tiptap/pm/state"
import { Selection } from "@tiptap/pm/state"
import { resolveBodyBlockById, surfaceChildrenInRange } from "../../schema/bodySurface"
import { removeMoveSource } from "../../extensions/block-drag/reorder"
import type { EmptiedSourceColumn } from "../../extensions/block-drag/reorder"
import {
  resolveContiguousSourceRun,
  resolveEmptiedSourceColumnForMove,
  runContainsColumnLayout,
  type ContiguousSourceRun,
} from "./moveBlocks"
import { MAX_COLUMNS } from "../../blocks/Columns/block"
import { normalizeColumnWidth } from "../../blocks/Columns/normalization"
import { RATIO_DECIMALS } from "../../blocks/Columns/resize"
import type { WrapIntoColumnsTarget } from "../types"

// Task 7 (F6) — drag-to-create columns, the command primitive. Two target
// shapes (see `WrapIntoColumnsTarget`):
//
//   { id, side }       wrap a ROOT target block + the dragged run into a NEW
//                      2-column layout, both columns `width: 1`. Drop side =
//                      dragged-block side: `side: "left"` puts the dragged run
//                      in the LEFT column.
//   { layoutId, index } insert a NEW column at that boundary of an existing
//                      layout (new width = MEAN of the existing column widths
//                      — an exactly equal 1/(n+1) share under the ratio
//                      model); the dragged run becomes its children. Refused
//                      at the 5-column schema cap.
//
// No-nesting guards mirror `insertWouldNestColumnLayout` (insertBlocks): the
// destination is a column interior by construction, so a dragged run that
// contains a `columnLayout` — or a wrap target inside a column / a layout —
// is refused outright.
//
// One transaction, `addToHistory: true` (the default) — wrap/add + the F2
// emptied-source-column removal undo as ONE step.

export type ResolvedWrapIntoColumns =
  | {
      kind: "wrap"
      run: ContiguousSourceRun
      targetPos: number
      /**
       * End of the target's flat-depth SUBTREE (exclusive): the target plus
       * its consecutive following root siblings with depth > the target's.
       * The whole span moves into the target column — wrapping the target
       * alone would orphan its indented children at root.
       */
      targetTo: number
      targetId: string
      side: "left" | "right"
      emptiedSourceColumn: EmptiedSourceColumn | null
    }
  | {
      kind: "addColumn"
      run: ContiguousSourceRun
      layoutPos: number
      layoutNode: ProseMirrorNode
      index: number
      /**
       * The run lives in a column of the TARGET layout itself. Handled as an
       * atomic layout rebuild: `removeMoveSource`'s F2 path would unwrap a
       * 2-column layout whose column the run empties — wrong while we are
       * ADDING a column to that same layout.
       */
      sourceInsideLayout: boolean
      emptiedSourceColumn: EmptiedSourceColumn | null
    }

/**
 * Re-base a run of body blocks onto a fresh column surface: the first
 * depth-bearing block lands at depth 0 and the same delta shifts the rest
 * (clamped to >= 0) — the node-construction analog of the move core's
 * `rebaseSliceDepth`.
 */
function rebaseDepthToZero(nodes: ProseMirrorNode[]): ProseMirrorNode[] {
  let delta: number | null = null
  return nodes.map((node) => {
    if (typeof node.attrs.depth !== "number") return node
    if (delta === null) delta = 0 - node.attrs.depth
    const next = Math.max(0, node.attrs.depth + delta)
    if (next === node.attrs.depth) return node
    return node.type.create({ ...node.attrs, depth: next }, node.content, node.marks)
  })
}

/**
 * Mean of the given columns' widths (F6's equal-share rule), rounded to
 * RATIO_DECIMALS so command-created widths match the precision
 * `resizeColumnPair` commits (`1.1667`, not `1.1666666666666667`). Callers
 * pass the columns that SURVIVE the move — averaging in a column the move
 * empties (and drops) would skew the new column's share.
 */
function meanColumnWidth(columns: readonly ProseMirrorNode[]): number {
  if (columns.length === 0) return 1
  let sum = 0
  for (const column of columns) {
    sum += normalizeColumnWidth(column.attrs.width)
  }
  const factor = 10 ** RATIO_DECIMALS
  return Math.round((sum / columns.length) * factor) / factor
}

/** A node's children as an array (`columnLayout` → its `column`s). */
function childrenOf(node: ProseMirrorNode): ProseMirrorNode[] {
  const out: ProseMirrorNode[] = []
  node.forEach((child) => out.push(child))
  return out
}

export function resolveWrapIntoColumns(
  doc: ProseMirrorNode,
  ids: string[],
  target: WrapIntoColumnsTarget,
): ResolvedWrapIntoColumns | null {
  const run = resolveContiguousSourceRun(doc, ids)
  if (!run) return null

  // No-nesting: the dragged run lands inside a column either way. (Shared
  // COL-1 predicate — same check resolveMove runs for column destinations.)
  if (runContainsColumnLayout(doc, run)) return null

  if ("id" in target) {
    const tb = resolveBodyBlockById(doc, target.id)
    if (!tb) return null
    // Wrap target must be a ROOT block: a target inside a column would nest
    // the new layout (forbidden), and a layout target is the add-column shape.
    if (tb.surfacePos !== -1) return null
    if (tb.node.type.name === "columnLayout") return null

    // Widen the target to its flat-depth subtree: consecutive FOLLOWING root
    // siblings with depth > the target's depth are its children and must move
    // into the target column with it (the dragged-run side is already
    // subtree-widened by the gesture; the target side is widened here).
    let targetTo = tb.pos + tb.node.nodeSize
    for (let i = tb.indexInSurface + 1; i < doc.childCount; i++) {
      const sibling = doc.child(i)
      const sibDepth =
        typeof sibling.attrs.depth === "number" ? sibling.attrs.depth : 0
      if (sibDepth <= tb.depth) break
      targetTo += sibling.nodeSize
    }

    // Self/overlap no-op: the dragged run includes the target, or lies inside
    // the target's subtree (dragging a child onto its own parent's edge) —
    // the run cannot be both the moved content and part of the wrap target.
    // Column-sourced runs (surfacePos !== -1) can't overlap a root subtree
    // span: layouts are depth-0, so the run's containing layout is never a
    // subtree member.
    if (run.surfacePos === -1 && run.from < targetTo && run.to > tb.pos) {
      return null
    }

    return {
      kind: "wrap",
      run,
      targetPos: tb.pos,
      targetTo,
      targetId: target.id,
      side: target.side,
      // F2: the destination is a NEW column (never the source column), so any
      // dest != sourceSurfacePos satisfies the shared helper's compare.
      emptiedSourceColumn: resolveEmptiedSourceColumnForMove(
        doc,
        run.surfacePos,
        -1,
        run.count,
      ),
    }
  }

  const lb = resolveBodyBlockById(doc, target.layoutId)
  if (!lb || lb.node.type.name !== "columnLayout") return null
  if (lb.node.childCount >= MAX_COLUMNS) return null
  // The dragged run IS (or contains) the layout itself.
  if (lb.pos >= run.from && lb.pos < run.to) return null

  const index = Math.max(0, Math.min(target.index, lb.node.childCount))
  const sourceInsideLayout =
    run.surfacePos !== -1 &&
    run.surfacePos > lb.pos &&
    run.surfacePos < lb.pos + lb.node.nodeSize

  return {
    kind: "addColumn",
    run,
    layoutPos: lb.pos,
    layoutNode: lb.node,
    index,
    sourceInsideLayout,
    emptiedSourceColumn: sourceInsideLayout
      ? null
      : resolveEmptiedSourceColumnForMove(doc, run.surfacePos, -1, run.count),
  }
}

function applyWrap(
  tr: Transaction,
  schema: Schema,
  r: Extract<ResolvedWrapIntoColumns, { kind: "wrap" }>,
): boolean {
  const columnType = schema.nodes.column
  const layoutType = schema.nodes.columnLayout
  if (!columnType || !layoutType) return false

  // Capture the run BEFORE removal (tr.doc is still the resolution doc).
  const runNodes = surfaceChildrenInRange(tr.doc, r.run)
  if (runNodes.length === 0) return false

  // Chain-safety (task #17): `r.targetPos`/`r.targetTo` are resolved against
  // `state.doc`, which under `editor.chain()` IS the live `tr.doc` — so they
  // must map through only the steps THIS call adds below, not the whole
  // `tr.mapping` (which would double-count prior-chain steps).
  const mapFrom = tr.mapping.maps.length

  // Move-core removal half: deletes [from,to), or — F2 — removes the emptied
  // source column / unwraps its layout ("content stays put").
  removeMoveSource(tr, { from: r.run.from, to: r.run.to }, r.emptiedSourceColumn)

  // Post-removal identity recheck. The tr has ALREADY mutated above, and in
  // Tiptap v3 a single-command call dispatches the shared tr even when the
  // command returns false — without `preventDispatch` (which CommandManager
  // honors, both single-command and chain paths) a recheck failure would ship
  // the run's deletion with no layout created: silent data loss. Unreachable
  // today via resolveWrapIntoColumns (the target is a root block outside the
  // run, which no removal/unwrap path can displace), but the hardening is
  // required posture — same as moveBlocks' throwaway-tr probe.
  const mappedTargetPos = tr.mapping.slice(mapFrom).map(r.targetPos, -1)
  const mappedTargetTo = tr.mapping.slice(mapFrom).map(r.targetTo, -1)
  const targetNode = tr.doc.nodeAt(mappedTargetPos)
  if (!targetNode || targetNode.attrs.id !== r.targetId) {
    tr.setMeta("preventDispatch", true)
    return false
  }

  // The target's whole flat-depth subtree (resolved as [targetPos, targetTo)
  // pre-removal; the run never overlaps it — resolveWrapIntoColumns refuses
  // that — so the span maps coherently through the removal above).
  const targetNodes = surfaceChildrenInRange(tr.doc, {
    from: mappedTargetPos,
    to: mappedTargetTo,
  })

  const colDragged = columnType.create(
    { id: null, width: 1 },
    rebaseDepthToZero(runNodes),
  )
  const colTarget = columnType.create(
    { id: null, width: 1 },
    rebaseDepthToZero(targetNodes),
  )
  // Drop side = dragged-block side (Notion-verified).
  const cols = r.side === "left" ? [colDragged, colTarget] : [colTarget, colDragged]
  const layout = layoutType.create(null, cols)
  tr.replaceWith(mappedTargetPos, mappedTargetTo, layout)

  // Caret into the first dragged block (column-touching moves land a text
  // caret — same rule as moveBlocks).
  const draggedColPos =
    r.side === "left" ? mappedTargetPos + 1 : mappedTargetPos + 1 + cols[0]!.nodeSize
  tr.setSelection(Selection.near(tr.doc.resolve(draggedColPos + 2)))
  return true
}

function applyAddColumnExternal(
  tr: Transaction,
  schema: Schema,
  r: Extract<ResolvedWrapIntoColumns, { kind: "addColumn" }>,
): boolean {
  const columnType = schema.nodes.column
  if (!columnType) return false

  const runNodes = surfaceChildrenInRange(tr.doc, r.run)
  if (runNodes.length === 0) return false

  // Chain-safety (task #17): see the matching note in `applyWrap` — `r.layoutPos`
  // is resolved against `state.doc` (== live `tr.doc` under `editor.chain()`),
  // so it maps through only this call's own steps.
  const mapFrom = tr.mapping.maps.length

  removeMoveSource(tr, { from: r.run.from, to: r.run.to }, r.emptiedSourceColumn)

  // Post-removal type + identity recheck (symmetric with applyWrap's). See
  // the comment there: the tr has already mutated, so a failure must set
  // `preventDispatch` or Tiptap's shared-tr dispatch ships the deletion alone.
  // Unreachable today via resolveWrapIntoColumns.
  const mappedLayoutPos = tr.mapping.slice(mapFrom).map(r.layoutPos, -1)
  const layoutNow = tr.doc.nodeAt(mappedLayoutPos)
  if (
    !layoutNow ||
    layoutNow.type.name !== "columnLayout" ||
    layoutNow.attrs.id !== r.layoutNode.attrs.id
  ) {
    tr.setMeta("preventDispatch", true)
    return false
  }

  const newCol = columnType.create(
    // External source: every original column survives the move.
    { id: null, width: meanColumnWidth(childrenOf(r.layoutNode)) },
    rebaseDepthToZero(runNodes),
  )
  const index = Math.min(r.index, layoutNow.childCount)
  let boundary = mappedLayoutPos + 1
  for (let i = 0; i < index; i++) boundary += layoutNow.child(i).nodeSize
  tr.insert(boundary, newCol)
  tr.setSelection(Selection.near(tr.doc.resolve(boundary + 2)))
  return true
}

/**
 * Add-column where the run lives in a column of the TARGET layout itself:
 * rebuild the layout's column list in ONE replace — original columns minus the
 * moved blocks (an emptied column drops out entirely), with the new column
 * spliced in at the requested boundary. `removeMoveSource` cannot be used
 * here: its F2 path would unwrap a 2-column layout whose column the run
 * empties, dissolving the very layout we are adding a column to.
 */
function applyAddColumnInternal(
  tr: Transaction,
  schema: Schema,
  r: Extract<ResolvedWrapIntoColumns, { kind: "addColumn" }>,
): boolean {
  const columnType = schema.nodes.column
  if (!columnType) return false

  const layoutNode = r.layoutNode
  const movedNodes: ProseMirrorNode[] = []
  // One entry per ORIGINAL column (the boundary index addresses original
  // column slots); `null` marks a column the move emptied.
  const entries: Array<ProseMirrorNode | null> = []
  let colPos = r.layoutPos + 1
  layoutNode.forEach((column) => {
    const kept: ProseMirrorNode[] = []
    let childPos = colPos + 1
    column.forEach((child) => {
      if (childPos >= r.run.from && childPos < r.run.to) movedNodes.push(child)
      else kept.push(child)
      childPos += child.nodeSize
    })
    if (kept.length === column.childCount) entries.push(column)
    else if (kept.length === 0) entries.push(null)
    else entries.push(columnType.create(column.attrs, kept))
    colPos += column.nodeSize
  })
  if (movedNodes.length === 0) return false

  // Equal share among the columns that SURVIVE the move: a column the run
  // empties is dropped (its `entries` slot is null), so averaging it in would
  // skew the new column's width against the remaining ones.
  const survivors = entries.filter((e): e is ProseMirrorNode => e !== null)
  const newCol = columnType.create(
    { id: null, width: meanColumnWidth(survivors) },
    rebaseDepthToZero(movedNodes),
  )
  const assembled: ProseMirrorNode[] = []
  for (let i = 0; i <= entries.length; i++) {
    if (i === r.index) assembled.push(newCol)
    if (i < entries.length && entries[i]) assembled.push(entries[i]!)
  }

  tr.replaceWith(
    r.layoutPos,
    r.layoutPos + layoutNode.nodeSize,
    layoutNode.type.create(layoutNode.attrs, assembled),
  )

  let newColPos = r.layoutPos + 1
  for (const n of assembled) {
    if (n === newCol) break
    newColPos += n.nodeSize
  }
  tr.setSelection(Selection.near(tr.doc.resolve(newColPos + 2)))
  return true
}

/**
 * Apply a resolved wrap/add-column to `tr`. Mutates the tr; returns `false`
 * on a defensive post-removal mismatch (caller should not dispatch).
 */
export function applyWrapIntoColumns(
  tr: Transaction,
  schema: Schema,
  resolved: ResolvedWrapIntoColumns,
): boolean {
  if (resolved.kind === "wrap") return applyWrap(tr, schema, resolved)
  return resolved.sourceInsideLayout
    ? applyAddColumnInternal(tr, schema, resolved)
    : applyAddColumnExternal(tr, schema, resolved)
}

export function wrapIntoColumnsImpl(ids: string[], target: WrapIntoColumnsTarget) {
  return ({ state, dispatch }: CommandProps): boolean => {
    const resolved = resolveWrapIntoColumns(state.doc, ids, target)
    if (!resolved) return false
    if (!dispatch) return true
    const tr = state.tr
    if (!applyWrapIntoColumns(tr, state.schema, resolved)) return false
    dispatch(tr)
    return true
  }
}
