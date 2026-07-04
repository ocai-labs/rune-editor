// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { RawCommands } from "@tiptap/core"
import { Selection, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import { nanoid } from "nanoid"
import { MultiBlockSelection } from "./MultiBlockSelection"
import { firstSelectableIndex } from "./selectable"
import { blockSelectionKey, type BlockSelectionPluginMeta } from "./plugin"
import { setSelectionAfterDelete } from "../../api/commands/deleteBlocks"
import { resolveEmptiedSourceColumn } from "../../api/commands/moveBlocks"
import { executeReorder, removeMoveSource, type EmptiedSourceColumn } from "../block-drag/reorder"
import {
  resolveBodyBlockById,
  surfaceBlockTextBoundsAtPos,
  surfaceChildrenAt,
  surfaceChildrenInRange,
} from "../../schema/bodySurface"
import { expandRangeOverToggleBodies } from "../../blocks/Toggle/range"

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    blockSelection: {
      setBlockSelection: (args: { from: string | number; to: string | number }) => ReturnType
      selectAllBlocks: () => ReturnType
      clearBlockSelection: () => ReturnType
      deleteBlockSelection: () => ReturnType
      duplicateBlocks: () => ReturnType
      moveBlockUp: () => ReturnType
      moveBlockDown: () => ReturnType
    }
  }
}

/**
 * Resolve a `setBlockSelection` endpoint to its `(surfacePos, index)` placement.
 * A numeric ref keeps the historical ROOT semantics (surface = doc, `surfacePos
 * === -1`); a string id resolves surface-aware so an in-column block addresses
 * ITS column surface — the old root-only `topLevelBlockIndexById` returned -1 for
 * an in-column id, no-opping the command. `null` when an id doesn't resolve.
 */
function resolveEndpoint(
  doc: import("@tiptap/pm/model").Node,
  ref: string | number,
): { surfacePos: number; index: number } | null {
  if (typeof ref === "number") return { surfacePos: -1, index: ref }
  const resolved = resolveBodyBlockById(doc, ref)
  if (!resolved) return null
  return { surfacePos: resolved.surfacePos, index: resolved.indexInSurface }
}

function moveSelectedBlocks(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  direction: -1 | 1,
): boolean {
  const sel = state.selection

  if (sel instanceof MultiBlockSelection) {
    // Surface-local move: `sel.blockIndices` are indices on the MBS's OWN
    // surface (root or a column), so both the edge clamps and the insert
    // position must be computed against that surface. Feeding column-local
    // indices into the root-indexed topLevelBlock*Pos helpers teleported a
    // column block to the top/bottom of the DOCUMENT. The root path is
    // arithmetic-identical (surface = doc, surfaceStart = 0).
    const surface = sel.surface
    const surfaceN = surface.childCount
    const [lo, hi] = sel.blockIndices
    // Clamp at the surface's edges (column top/bottom mirror doc top/bottom):
    // consumed no-op, exactly like the root clamps. The TOP edge is the first
    // SELECTABLE index, not 0 — so a body block never moves above a leading
    // non-selectable run (the in-document title). (An MBS can't cover the title
    // itself: MultiBlockSelection.create clamps it out.)
    const minIdx = firstSelectableIndex(surface)
    if (direction === -1 && lo <= minIdx) return true
    if (direction === 1 && hi === surfaceN - 1) return true

    // Absolute pos of the surface's first child (0 for the root surface).
    const surfaceStart = sel.$anchor.start(sel.$anchor.depth)
    const posOfChild = (idx: number): number => {
      let p = surfaceStart
      for (let i = 0; i < idx; i++) p += surface.child(i).nodeSize
      return p
    }
    // Up: insert before the previous sibling. Down: insert after the next
    // sibling (= the boundary before sibling hi+2; idx may equal surfaceN,
    // which posOfChild resolves to the surface content's end).
    const insertPos = direction === -1 ? posOfChild(lo - 1) : posOfChild(hi + 2)

    if (!dispatch) return true
    const tr = executeReorder(
      state,
      { from: sel.from, to: sel.to, selectionMode: "mbs" },
      { insertPos, indicatorLeft: 0, edgeY: 0 },
    )
    if (tr) dispatch(tr)
    return true
  }

  if (!(sel instanceof TextSelection)) return false
  // Surface-aware caret branch: resolve the caret's containing block on its
  // OWN surface (root or a column), mirroring the MBS branch above. The old
  // root-only `$pos.index(0)` resolved an in-column caret to the enclosing
  // columnLayout and reordered the WHOLE layout. Clamps and the insert
  // position are computed against the block's surface, so an in-column
  // Mod-ArrowUp/Down moves the block WITHIN its column.
  const bounds = surfaceBlockTextBoundsAtPos(state.doc, sel.from)
  if (!bounds) return false
  const { surface, indexInSurface: index } = bounds
  // The first selectable index on this surface — a leading non-selectable run
  // (the in-document title) is neither movable itself nor a slot a body block
  // may move above. `index < minIdx` ⇒ the caret is IN the title: consumed no-op
  // so Mod-ArrowDown can't push the title below the body.
  const minIdx = firstSelectableIndex(surface.node)
  if (index < minIdx) return true
  if (direction === -1 && index === minIdx) return true
  if (direction === 1 && index === surface.node.childCount - 1) return true

  const blockFrom = bounds.from - 1
  const blockTo = blockFrom + bounds.node.nodeSize
  // Absolute pos of the surface child at `idx` (0 for the root surface's first
  // child); idx may equal childCount, which resolves to the content's end.
  const posOfSurfaceChild = (idx: number): number => {
    let p = surface.start
    for (let i = 0; i < idx; i++) p += surface.node.child(i).nodeSize
    return p
  }
  // Up: insert before the previous sibling. Down: insert after the next
  // sibling (= the boundary before sibling index+2).
  const insertPos =
    direction === -1 ? posOfSurfaceChild(index - 1) : posOfSurfaceChild(index + 2)

  if (!dispatch) return true
  const tr = executeReorder(
    state,
    {
      from: blockFrom,
      to: blockTo,
      selectionMode: "text",
      textSelectionRestorePos: sel.from,
    },
    { insertPos, indicatorLeft: 0, edgeY: 0 },
  )
  if (tr) dispatch(tr)
  return true
}

/**
 * F2 emptied-column detection for an MBS delete/cut: when the (widened) range
 * `[sel.from, to)` covers a `column` surface's ENTIRE content, return the
 * emptied-source-column payload so the caller removes the column in the same
 * transaction (delete the column node when ≥2 survive; unwrap the layout when
 * <2 do). `null` for a root MBS, a partial column delete, or a non-column
 * surface. Shared by `deleteBlockSelection` and the Cmd-X cut branch so both
 * agree on the removal.
 */
function resolveEmptiedColumnForMbs(
  doc: ProseMirrorNode,
  sel: MultiBlockSelection,
  to: number,
): EmptiedSourceColumn | null {
  if (sel.surface === doc || sel.surface.type.name !== "column") return null
  const columnPos = sel.$anchor.before(sel.$anchor.depth)
  const columnNode = sel.surface
  if (sel.from === columnPos + 1 && to === columnPos + columnNode.nodeSize - 1) {
    return resolveEmptiedSourceColumn(doc, columnPos)
  }
  return null
}

interface EmptiedColumnLanding {
  /** Stable id of the surviving block to land the caret in (`null` = fallback). */
  id: string | null
  /** Which end of that block's text to land on. */
  edge: "start" | "end"
}

/**
 * Where the caret lands after a delete/cut empties a column (Notion parity).
 * Resolved as a stable block ID against the PRE-removal doc so the caller can
 * re-find it in the POST-removal doc — position mapping through the
 * column/layout `replaceWith` overshoots interior positions to the replacement
 * end (into the FOLLOWING root block), which is the caret-overshoot bug this
 * avoids.
 *
 *   - ≥2 survivors (the emptied `column` node is deleted, the layout persists):
 *     the nearest surviving column — the NEXT column's first block if one
 *     follows the emptied column, else the PREVIOUS column's last block.
 *   - <2 survivors (the layout unwraps, survivor children splice to root): the
 *     END of the survivor's LAST block. For an emptied RIGHT column this is the
 *     block nearest the removed column; an emptied LEFT column lands at the end
 *     too (observed Notion behavior) rather than the survivor's first block.
 */
function resolveEmptiedColumnLanding(ec: EmptiedSourceColumn): EmptiedColumnLanding {
  if (ec.remainingColumnCount < 2) {
    const last = ec.survivor?.lastChild ?? null
    return { id: last ? (last.attrs.id as string | null) : null, edge: "end" }
  }
  const { layoutNode, layoutPos, columnPos } = ec
  let emptiedIdx = -1
  layoutNode.forEach((child, offset, i) => {
    if (layoutPos + 1 + offset === columnPos) emptiedIdx = i
  })
  if (emptiedIdx !== -1) {
    const next = layoutNode.maybeChild(emptiedIdx + 1)
    if (next && next.type.name === "column" && next.firstChild) {
      return { id: next.firstChild.attrs.id as string | null, edge: "start" }
    }
    const prev = emptiedIdx > 0 ? layoutNode.child(emptiedIdx - 1) : null
    if (prev && prev.type.name === "column" && prev.lastChild) {
      return { id: prev.lastChild.attrs.id as string | null, edge: "end" }
    }
  }
  return { id: null, edge: "end" }
}

/** Land the caret at the resolved emptied-column landing block in `tr.doc`. */
function setCaretAtEmptiedColumnLanding(tr: Transaction, landing: EmptiedColumnLanding): void {
  if (landing.id) {
    let foundPos = -1
    tr.doc.descendants((n, p) => {
      if (foundPos !== -1) return false
      if (n.attrs?.id === landing.id) {
        foundPos = p
        return false
      }
      return true
    })
    const node = foundPos === -1 ? null : tr.doc.nodeAt(foundPos)
    if (node) {
      if (node.isTextblock) {
        const at = landing.edge === "start" ? foundPos + 1 : foundPos + 1 + node.content.size
        tr.setSelection(TextSelection.create(tr.doc, at))
      } else {
        const at = landing.edge === "start" ? foundPos : foundPos + node.nodeSize
        tr.setSelection(Selection.near(tr.doc.resolve(at), landing.edge === "start" ? 1 : -1))
      }
      return
    }
  }
  // Fallback (a landing block that vanished — should not happen): the pre-fix
  // mapped-near behavior, safe if imprecise.
  tr.setSelection(Selection.near(tr.doc.resolve(Math.min(tr.selection.from, tr.doc.content.size))))
}

/**
 * Delete an MBS's blocks over the pre-widened range `[sel.from, to)`, applying
 * #392 F2 parity + the emptied-column caret landing. Shared by
 * `deleteBlockSelection` (Delete / command) and the Cmd-X cut branch so a cut
 * that empties a column removes it exactly like a delete does, landing the
 * caret in the same surviving block. The CALLER computes `to` (delete/cut widen
 * differently — see call sites) and dispatches the `tr` with its own meta.
 */
export function applyMbsDelete(
  tr: Transaction,
  state: EditorState,
  sel: MultiBlockSelection,
  to: number,
): void {
  const emptied = resolveEmptiedColumnForMbs(state.doc, sel, to)
  if (emptied) {
    // Resolve the landing block BEFORE the removal (positions are pre-removal),
    // remove the column, then re-find the landing block by its stable id.
    const landing = resolveEmptiedColumnLanding(emptied)
    removeMoveSource(tr, { from: sel.from, to }, emptied)
    setCaretAtEmptiedColumnLanding(tr, landing)
    return
  }
  const [lo] = sel.blockIndices
  const rootSurface = sel.surface === state.doc
  tr.delete(sel.from, to)
  setSelectionAfterDelete(tr, state.schema, lo, rootSurface)
}

export function blockSelectionCommands(): Partial<RawCommands> {
  return {
    setBlockSelection:
      ({ from, to }) =>
      ({ tr, state, dispatch }) => {
        const fromRef = resolveEndpoint(state.doc, from)
        const toRef = resolveEndpoint(state.doc, to)
        if (!fromRef || !toRef) return false
        // Both endpoints must live on the SAME surface — a cross-surface MBS
        // (root ↔ inside a column, or two different columns) is not a thing.
        if (fromRef.surfacePos !== toRef.surfacePos) return false
        const surfaceNode =
          fromRef.surfacePos === -1
            ? state.doc
            : state.doc.nodeAt(fromRef.surfacePos)
        if (!surfaceNode) return false
        const N = surfaceNode.childCount
        if (
          fromRef.index < 0 ||
          toRef.index < 0 ||
          fromRef.index >= N ||
          toRef.index >= N
        )
          return false
        if (dispatch) {
          // Surface ResolvedPos for a column surface (mirrors block-drag's
          // restoreMbs); undefined for the root reproduces the historical call.
          const $surface =
            fromRef.surfacePos === -1
              ? undefined
              : state.doc.resolve(fromRef.surfacePos + 1)
          const anchorId = surfaceNode.child(fromRef.index).attrs.id as string | null
          const meta: BlockSelectionPluginMeta = { setAnchor: anchorId }
          tr.setSelection(
            MultiBlockSelection.create(state.doc, fromRef.index, toRef.index, $surface),
          )
          tr.setMeta(blockSelectionKey, meta)
          dispatch(tr)
        }
        return true
      },
    selectAllBlocks:
      () =>
      ({ tr, state, dispatch }) => {
        const N = state.doc.childCount
        if (N === 0) return false
        // Skip a leading run of non-selectable root blocks (the title, always
        // at index 0). If nothing on the root surface is selectable, there's
        // no block selection to make.
        const lo = firstSelectableIndex(state.doc)
        if (lo >= N) return false
        if (dispatch) {
          const firstId = state.doc.child(lo).attrs.id as string | null
          const meta: BlockSelectionPluginMeta = { setAnchor: firstId }
          tr.setSelection(MultiBlockSelection.create(state.doc, lo, N - 1))
          tr.setMeta(blockSelectionKey, meta)
          dispatch(tr)
        }
        return true
      },
    clearBlockSelection:
      () =>
      ({ tr, state, dispatch }) => {
        const sel = state.selection
        if (!(sel instanceof MultiBlockSelection)) return false
        if (dispatch) {
          // Surface-aware collapse to a caret at the end of the first selected
          // block's text (column-local or root). The old root-only
          // topLevelBlockTextBounds(doc, lo) landed the caret on the wrong ROOT
          // block for a column-local MBS — same fix as the Enter key.
          //
          // `firstBlockTextEnd` assumes a TEXTBLOCK first block; a divider or
          // columnLayout first block makes it a non-text position, and a raw
          // TextSelection.create there builds a dead caret (PM warns, doesn't
          // throw) instead of failing loudly. Selection.near finds the nearest
          // valid cursor position instead — same guard as the Enter keymap.
          tr.setSelection(Selection.near(state.doc.resolve(sel.firstBlockTextEnd), 1))
          dispatch(tr)
        }
        return true
      },
    deleteBlockSelection:
      () =>
      ({ tr, state, dispatch }) => {
        const sel = state.selection
        if (!(sel instanceof MultiBlockSelection)) return false
        if (!dispatch) return true
        // Widen over any collapsed toggle's hidden body — otherwise deleting
        // just the (visible) toggle title orphans its body as loose blocks.
        // `applyMbsDelete` then applies #392 F2 parity: when the widened range
        // covers a column's ENTIRE content it removes the column (≥2 survive)
        // or unwraps the layout (<2), landing the caret in the nearest
        // surviving column instead of overshooting into the following root
        // block. Shared with the Cmd-X cut branch so cut and delete land
        // identically.
        const { to } = expandRangeOverToggleBodies(state.doc, sel.from, sel.to, {
          collapsedOnly: true,
        })
        applyMbsDelete(tr, state, sel, to)
        dispatch(tr)
        return true
      },
    duplicateBlocks:
      () =>
      ({ tr, state, dispatch }) => {
        const sel = state.selection
        if (sel instanceof MultiBlockSelection) {
          if (!dispatch) return true
          const [lo] = sel.blockIndices
          // Widen over EVERY toggle's owned body in the selection — collapsed
          // OR expanded. Reparenting corrupts an expanded toggle's body too:
          // inserting the clone at the (unwidened) sel.to boundary lands it
          // BETWEEN the toggle and its body, and toggleBodyRange reassigns
          // the body to the clone on the next read either way.
          const widened = expandRangeOverToggleBodies(state.doc, sel.from, sel.to, {
            collapsedOnly: false,
          })
          // Surface-aware: gathers the widened range's nodes on the MBS's OWN
          // surface (root OR a column). The old `sel.blockNodes` stopped at
          // the visible selection boundary, leaving a toggle's hidden body
          // (higher surface index, un-selected) out of the clone set.
          const surfaceNodes = surfaceChildrenInRange(state.doc, {
            from: sel.from,
            to: widened.to,
          })
          // Pre-stamp duplicates with fresh ids. If we left collisions for
          // BlockId's appendTransaction to clean up, its setNodeMarkup steps
          // would land at our newLo's positionBefore — DEL_SIDE on that
          // boundary collapses MultiBlockSelection.map back to a TextSelection
          // via Selection.near. Stamping here keeps BlockId out of the way
          // and the post-dispatch MBS intact.
          const nodes = surfaceNodes.map((src) =>
            src.type.create({ ...src.attrs, id: nanoid(8) }, src.content, src.marks),
          )
          const insertAt = widened.to
          tr.insert(insertAt, nodes)
          // The copies occupy the next `nodes.length` slots in the SAME
          // surface, right after the widened original run. Resolve that
          // surface in the mapped doc so the restored MBS targets the
          // copies, not root blocks at those indices.
          const surface = surfaceChildrenAt(tr.doc, insertAt)
          const $surface =
            surface && surface.pos !== -1 ? tr.doc.resolve(surface.start) : undefined
          const newLo = lo + nodes.length
          const newHi = newLo + nodes.length - 1
          tr.setSelection(MultiBlockSelection.create(tr.doc, newLo, newHi, $surface))
          dispatch(tr)
          return true
        }
        if (sel instanceof TextSelection) {
          if (!dispatch) return true
          // Surface-aware caret branch (mirrors the MBS branch above): the old
          // root-only `$pos.index(0)` resolved an in-column caret to the
          // enclosing columnLayout and duplicated the WHOLE layout. Resolve
          // the caret's containing block on its own surface — the duplicate
          // lands right after it, inside the same column.
          const bounds = surfaceBlockTextBoundsAtPos(state.doc, sel.from)
          if (!bounds) return false
          const blockFrom = bounds.from - 1
          const blockTo = blockFrom + bounds.node.nodeSize
          const offsetInBlock = sel.from - bounds.from
          // Widen the same way as the MBS branch: a toggle under the caret
          // (collapsed or expanded) must duplicate together with its body,
          // never split from it.
          const widened = expandRangeOverToggleBodies(state.doc, blockFrom, blockTo, {
            collapsedOnly: false,
          })
          const surfaceNodes = surfaceChildrenInRange(state.doc, {
            from: blockFrom,
            to: widened.to,
          })
          // Fresh-stamp every clone (mirrors the MBS branch) — duplicating a
          // toggle's body alongside it means more than one node can collide
          // with its original now, not just the single-node case BlockId's
          // backfill used to handle alone.
          const nodes = surfaceNodes.map((src) =>
            src.type.create({ ...src.attrs, id: nanoid(8) }, src.content, src.marks),
          )
          const insertAt = widened.to
          tr.insert(insertAt, nodes)
          // Caret in the duplicate of the caret's own block — always the
          // FIRST node in `nodes` (surfaceChildrenInRange preserves document
          // order) — at the same intra-block offset.
          const newCaret = insertAt + 1 + offsetInBlock
          tr.setSelection(TextSelection.create(tr.doc, newCaret))
          dispatch(tr)
          return true
        }
        return false
      },
    moveBlockUp:
      () =>
      ({ state, dispatch }) =>
        moveSelectedBlocks(state, dispatch, -1),
    moveBlockDown:
      () =>
      ({ state, dispatch }) =>
        moveSelectedBlocks(state, dispatch, +1),
  }
}
