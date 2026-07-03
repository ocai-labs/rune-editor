// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { RawCommands } from "@tiptap/core"
import { Selection, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state"
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
        const [lo] = sel.blockIndices
        // Surface-aware: a column-local MBS delete uses the non-root branch of
        // setSelectionAfterDelete (the root-index walk is meaningless on a
        // column surface; column normalization backfills the E2 paragraph and
        // remaps the selection). `lo` is surface-local in both cases.
        const rootSurface = sel.surface === state.doc
        // Widen over any collapsed toggle's hidden body — otherwise deleting
        // just the (visible) toggle title orphans its body as loose blocks.
        const { to } = expandRangeOverToggleBodies(state.doc, sel.from, sel.to, {
          collapsedOnly: true,
        })
        // F2/delete parity (Notion): when the (widened) range covers a
        // column's ENTIRE content, the delete must remove the column itself
        // in the SAME transaction — a 3-column layout becomes 2 columns; a
        // 2-column layout unwraps to flat root blocks. A bare `tr.delete`
        // over a column's whole content can never drop the layout below its
        // `column{2,MAX}` floor (PM backfills an empty column instead), so
        // this reuses the F2 move machinery (`resolveEmptiedSourceColumn` +
        // `removeMoveSource`) — the same payload shape a move-out computes —
        // rather than leaning on E2's reseed, which stays the safety net for
        // non-command paths only (paste / setContent / collab).
        let emptiedSourceColumn: EmptiedSourceColumn | null = null
        if (!rootSurface && sel.surface.type.name === "column") {
          const columnPos = sel.$anchor.before(sel.$anchor.depth)
          const columnNode = sel.surface
          if (sel.from === columnPos + 1 && to === columnPos + columnNode.nodeSize - 1) {
            emptiedSourceColumn = resolveEmptiedSourceColumn(state.doc, columnPos)
          }
        }
        if (emptiedSourceColumn) {
          removeMoveSource(tr, { from: sel.from, to }, emptiedSourceColumn)
        } else {
          tr.delete(sel.from, to)
        }
        setSelectionAfterDelete(tr, state.schema, lo, rootSurface)
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
