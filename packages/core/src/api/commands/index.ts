// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { Extension } from "@tiptap/core"
import { EditorState, Selection, TextSelection } from "@tiptap/pm/state"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import {
  executeMoveSlice,
  removeMoveSource,
  restoreMbs,
} from "../../extensions/block-drag/reorder"
import type {
  BlockUpdate,
  DeleteBlocksTarget,
  InsertBlocksOptions,
  MoveBlocksTarget,
  RuneBlockInput,
  TurnIntoBlockInput,
  TurnIntoTarget,
  WrapIntoColumnsTarget,
} from "../types"
import {
  createNodeFromBlockInput,
  insertWouldNestColumnLayout,
  resolveInsertPos,
} from "./insertBlocks"
import { resolveUpdate } from "./updateBlock"
import { getBlockSpecs } from "../../schema/blocks/registry"
import { normalizeDepthAt } from "../depth"
import { resolveDeleteRanges, setSelectionAfterDelete } from "./deleteBlocks"
import { resolveMove } from "./moveBlocks"
import { resolveWrapIntoColumns, wrapIntoColumnsImpl } from "./wrapIntoColumns"
import { indentBlockImpl } from "./indentBlock"
import { outdentBlockImpl } from "./outdentBlock"
import { splitListBlockImpl } from "./splitListBlock"
import {
  applyTurnIntoTr,
  resolveTurnIntoSources,
  type ApplyTurnIntoOptions,
} from "./turnInto"

function isNode(node: ProseMirrorNode | null): node is ProseMirrorNode {
  return node !== null
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    /**
     * Rune block commands.
     *
     * @remarks Addressing: top-level block commands target stable block
     * ids. `insertBlocks` also accepts a validated top-level boundary
     * position for the cases where there is no existing block to name.
     */
    blocks: {
      insertBlocks: (
        blocks: RuneBlockInput[],
        options?: InsertBlocksOptions,
      ) => ReturnType
      updateBlock: (id: string, partial: BlockUpdate) => ReturnType
      deleteBlocks: (idsOrRange: DeleteBlocksTarget) => ReturnType
      moveBlocks: (ids: string[], target: MoveBlocksTarget) => ReturnType
      /**
       * Drag-to-create columns (F6): wrap a root block + the moved run into a
       * new 2-column layout, or add a new column to an existing layout at a
       * boundary index. One transaction (one undo step); the F2
       * emptied-source-column removal composes.
       */
      wrapIntoColumns: (
        ids: string[],
        target: WrapIntoColumnsTarget,
      ) => ReturnType
      turnInto: (
        target: TurnIntoTarget,
        block: TurnIntoBlockInput,
        options?: ApplyTurnIntoOptions,
      ) => ReturnType
      indentBlock: (id?: string) => ReturnType
      outdentBlock: (id?: string) => ReturnType
      splitListBlock: () => ReturnType
    }
  }
}

export const BlockCommands = Extension.create({
  name: "blockCommands",

  addCommands() {
    return {
      insertBlocks:
        (blocks, options = {}) =>
        ({ editor, state, dispatch }) => {
          const pos = resolveInsertPos(state.doc, options.at)
          if (pos === -1 || blocks.length === 0) return false
          // No-nesting: refuse a columnLayout input whose destination sits
          // inside a column ({columnId} targets resolve into column content).
          if (insertWouldNestColumnLayout(state.doc, pos, blocks)) return false

          const nodes = blocks.map((block) =>
            createNodeFromBlockInput(editor, state.schema, block, {
              depth: options.depth ?? 0,
            }),
          )
          if (!nodes.every(isNode)) return false
          if (!dispatch) return true

          const tr = state.tr.insert(pos, nodes)
          const insertedSize = nodes.reduce((size, node) => size + (node?.nodeSize ?? 0), 0)
          // Depth hygiene: clamp each inserted block's depth to what is legal
          // at its destination (preceding sibling's depth + 1, or its block's
          // numeric maxDepth). Walk the freshly inserted range in tr.doc so
          // each block's "previous sibling" includes earlier inserted blocks.
          const specs = getBlockSpecs(editor)
          const insertedEnd = pos + insertedSize
          tr.doc.nodesBetween(pos, insertedEnd, (node, nodePos) => {
            // Ancestors that span the inserted range (the enclosing column /
            // columnLayout of a {columnId} target) start before `pos` —
            // descend through them; pruning here would skip every inserted
            // block inside the column and leave its depth unclamped.
            if (nodePos < pos) return true
            if (nodePos >= insertedEnd) return false
            if (node.attrs.depth === undefined) return false
            const current = typeof node.attrs.depth === "number" ? node.attrs.depth : 0
            const next = normalizeDepthAt(
              tr.doc,
              nodePos,
              current,
              specs[node.type.name]?.indent,
            )
            if (next !== current) {
              tr.setNodeMarkup(nodePos, null, { ...node.attrs, depth: next })
            }
            return false
          })
          const selectionPos = Math.min(pos + insertedSize, tr.doc.content.size)
          tr.setSelection(Selection.near(tr.doc.resolve(selectionPos), -1))
          dispatch(tr)
          return true
        },
      updateBlock:
        (id, partial) =>
        ({ state, dispatch, editor }) => {
          const resolved = resolveUpdate(editor, state.schema, state.doc, id, partial)
          if (!resolved) return false
          if (!dispatch) return true

          const current = state.doc.nodeAt(resolved.pos)
          if (!current) return false
          // Depth hygiene: only when the update EXPLICITLY sets a depth, clamp
          // it to what is legal at the block's (unchanged) position. Attr-only
          // updates that merely preserve the existing depth pass through
          // untouched — we never re-clamp a depth the caller didn't touch.
          let node = resolved.node
          const setsDepth = Object.prototype.hasOwnProperty.call(partial, "depth")
          if (setsDepth && typeof node.attrs.depth === "number") {
            const spec = getBlockSpecs(editor)[node.type.name]?.indent
            const clamped = normalizeDepthAt(
              state.doc,
              resolved.pos,
              node.attrs.depth,
              spec,
            )
            if (clamped !== node.attrs.depth) {
              node = node.type.create(
                { ...node.attrs, depth: clamped },
                node.content,
                node.marks,
              )
            }
          }
          const tr = state.tr.replaceWith(
            resolved.pos,
            resolved.pos + current.nodeSize,
            node,
          )
          dispatch(tr)
          return true
        },
      deleteBlocks:
        (idsOrRange) =>
        ({ state, dispatch }) => {
          const ranges = resolveDeleteRanges(state.doc, idsOrRange)
          if (ranges.length === 0) return false
          if (!dispatch) return true

          const tr = state.tr
          const firstDeletedIndex = Math.min(...ranges.map((range) => range.fromIndex))
          const rootSurface = ranges.every((range) => range.rootSurface)
          for (const range of [...ranges].sort((a, b) => b.from - a.from)) {
            tr.delete(range.from, range.to)
          }
          setSelectionAfterDelete(tr, state.schema, firstDeletedIndex, rootSurface)
          dispatch(tr)
          return true
        },
      moveBlocks:
        (ids, target) =>
        ({ editor, state, dispatch }) => {
          const resolved = resolveMove(state.doc, ids, target)
          if (!resolved) return false
          if (!dispatch) return true

          // D1: re-base depth at the destination, matching the drag path. The
          // first moved block's depth is clamped to what is legal at the
          // destination context (the depth of the preceding sibling once the
          // source has been removed, +1); the move core applies the resulting
          // delta to the rest of the moved slice.
          const firstMoved = state.doc.nodeAt(resolved.from)
          const firstDepth =
            firstMoved && typeof firstMoved.attrs.depth === "number"
              ? firstMoved.attrs.depth
              : 0
          // Compute the destination's preceding-sibling depth on a THROWAWAY
          // EditorState whose tr replays the SAME source removal the move core
          // will perform — for an F2 emptied-source-column move that is a whole
          // column/layout removal, not a [from,to) delete, so the probe must
          // mirror it or the mapped insert pos (and thus the depth neighbor)
          // drifts. NOTE: do NOT mutate `state.tr` here — under Tiptap's
          // chained CommandManager `state.tr` is the SHARED chain transaction,
          // and replaying these steps in the core would corrupt positions.
          const probe = EditorState.create({
            doc: state.doc,
            schema: state.schema,
          }).tr
          removeMoveSource(
            probe,
            { from: resolved.from, to: resolved.to },
            resolved.emptiedSourceColumn,
          )
          const mappedInsertPos = probe.mapping.map(resolved.insertPos, -1)
          const spec = getBlockSpecs(editor)[firstMoved?.type.name ?? ""]?.indent
          const newDepthAttr = normalizeDepthAt(
            probe.doc,
            mappedInsertPos,
            firstDepth,
            spec,
          )

          // Run the shared move core on the chain tr. Selection: only a pure
          // root→root move keeps the MBS restoration (Phase-0 behavior); any
          // move touching a column interior lands a text caret — MBS inside a
          // column is Task 5 (paint/keyboard), so a column move still uses a
          // caret here even though the core's restore is now surface-aware.
          const tr = state.tr
          const result = executeMoveSlice(
            tr,
            { from: resolved.from, to: resolved.to },
            { insertPos: resolved.insertPos, surfacePos: resolved.destSurfacePos },
            {
              newDepthAttr,
              emptiedSourceColumn: resolved.emptiedSourceColumn,
            },
          )
          // executeMoveSlice returns null for two cases:
          //   1. Drop-on-self: insert boundary lands inside [source.from,
          //      source.to]. This is a positionally no-op move — the block is
          //      already where the caller asked it to go (e.g. moving "c" after
          //      "b" when c is the immediate successor of b). An idempotent
          //      no-op IS a successful command: the doc is already in the
          //      requested state. PINNED by D1 in commands.test.ts —
          //      "D1: re-bases relative to the destination's preceding sibling,
          //      not the source" asserts true for exactly this scenario.
          //   2. Non-block-boundary slice (openStart/openEnd ≠ 0): caller bug.
          //      Still a no-op (no dispatch), and we return true to avoid a
          //      false "command rejected" signal for what was a logic error in
          //      the caller, not an invalid user request.
          // Both cases: return true (success, doc unchanged) — NOT false.
          // The only path that returns false is resolveMove returning null
          // above (unknown id, non-contiguous selection, no-nesting guard, etc.)
          // — those are genuine refusals.
          if (!result) return true

          if (resolved.nonRootSurface) {
            const restorePos = Math.min(result.insertPos + 1, tr.doc.content.size)
            tr.setSelection(TextSelection.create(tr.doc, restorePos))
          } else {
            // Pure root→root move: restore the MBS over the moved blocks. Shares
            // the surface-aware `restoreMbs` with the drag path (reduces to the
            // old root `.index(0)` here) so the two move callers can't drift.
            restoreMbs(tr, result.insertPos, result.blockCount)
          }
          dispatch(tr)
          return true
        },
      turnInto:
        (target, block, options) =>
        ({ editor, state, dispatch }) => {
          const sources = resolveTurnIntoSources(state.doc, target)
          if (sources.length === 0) return false

          const tr = state.tr
          const result = applyTurnIntoTr(
            editor,
            tr,
            sources,
            block,
            state.schema,
            options,
          )
          if (result.accepted === 0) return false
          if (!dispatch) return true

          dispatch(tr.scrollIntoView())
          return true
        },
      wrapIntoColumns: (ids, target) => (args) => wrapIntoColumnsImpl(ids, target)(args),
      indentBlock: (id) => (args) => indentBlockImpl(id)(args),
      outdentBlock: (id) => (args) => outdentBlockImpl(id)(args),
      splitListBlock: () => (args) => splitListBlockImpl()(args),
    }
  },
})

export {
  createNodeFromBlockInput,
  resolveInsertPos,
  resolveUpdate,
  resolveDeleteRanges,
  resolveMove,
  resolveWrapIntoColumns,
  resolveTurnIntoSources,
  applyTurnIntoTr,
}
export { applyMarkdownEdits } from "./applyMarkdownEdits"
export type {
  RuneMarkdownEdit,
  ApplyMarkdownEditsOptions,
  ApplyMarkdownEditsData,
} from "./applyMarkdownEdits"
export { applyMatching } from "./applyMatching"
export type {
  RuneMatchWhere,
  RuneMatchSet,
  ApplyMatchingOptions,
  ApplyMatchingData,
} from "./applyMatching"
