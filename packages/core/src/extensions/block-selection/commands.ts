// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { RawCommands } from "@tiptap/core"
import { TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state"
import { nanoid } from "nanoid"
import { MultiBlockSelection } from "./MultiBlockSelection"
import { firstSelectableIndex } from "./selectable"
import { blockSelectionKey, type BlockSelectionPluginMeta } from "./plugin"
import { topLevelBlockIndexById } from "../../schema/topLevelBlocks"
import { setSelectionAfterDelete } from "../../api/commands/deleteBlocks"
import { executeReorder } from "../block-drag/reorder"
import {
  surfaceBlockTextBoundsAtPos,
  surfaceChildrenAt,
} from "../../schema/bodySurface"

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

function resolveIndex(doc: import("@tiptap/pm/model").Node, ref: string | number): number {
  if (typeof ref === "number") return ref
  return topLevelBlockIndexById(doc, ref)
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
        const fromIdx = resolveIndex(state.doc, from)
        const toIdx = resolveIndex(state.doc, to)
        const N = state.doc.childCount
        if (fromIdx < 0 || toIdx < 0 || fromIdx >= N || toIdx >= N) return false
        if (dispatch) {
          const anchorId = state.doc.child(fromIdx).attrs.id as string | null
          const meta: BlockSelectionPluginMeta = { setAnchor: anchorId }
          tr.setSelection(MultiBlockSelection.create(state.doc, fromIdx, toIdx))
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
          tr.setSelection(TextSelection.create(state.doc, sel.firstBlockTextEnd))
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
        tr.delete(sel.from, sel.to)
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
          const [lo, hi] = sel.blockIndices
          // Pre-stamp duplicates with fresh ids. If we left collisions for
          // BlockId's appendTransaction to clean up, its setNodeMarkup steps
          // would land at our newLo's positionBefore — DEL_SIDE on that
          // boundary collapses MultiBlockSelection.map back to a TextSelection
          // via Selection.near. Stamping here keeps BlockId out of the way
          // and the post-dispatch MBS intact.
          //
          // Surface-aware: `sel.blockNodes` are the selected nodes on the MBS's
          // OWN surface (root OR a column). The old `state.doc.child(i)` by
          // surface-LOCAL index cloned the wrong ROOT block for a column-local
          // MBS and grafted it into the column.
          const nodes = sel.blockNodes.map((src) =>
            src.type.create({ ...src.attrs, id: nanoid(8) }, src.content, src.marks),
          )
          const insertAt = sel.to
          tr.insert(insertAt, nodes)
          // The copies occupy the next (hi-lo+1) slots in the SAME surface.
          // Resolve that surface in the mapped doc so the restored MBS targets
          // the copies, not root blocks at those indices.
          const surface = surfaceChildrenAt(tr.doc, insertAt)
          const $surface =
            surface && surface.pos !== -1 ? tr.doc.resolve(surface.start) : undefined
          const newLo = hi + 1
          const newHi = hi + 1 + (hi - lo)
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
          // lands right after it, inside the same column. The copy keeps the
          // source id; BlockId's backfill re-stamps the collision (a caret
          // restore is immune to the MBS-collapse hazard the MBS branch
          // pre-stamps for).
          const bounds = surfaceBlockTextBoundsAtPos(state.doc, sel.from)
          if (!bounds) return false
          const block = bounds.node
          const insertAt = bounds.from - 1 + block.nodeSize
          const offsetInBlock = sel.from - bounds.from
          tr.insert(insertAt, block)
          // Caret in the duplicate at the same intra-block offset.
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
