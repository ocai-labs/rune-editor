// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { Extension } from "@tiptap/core"
import type { EditorState, Transaction } from "@tiptap/pm/state"
import { Plugin, PluginKey } from "@tiptap/pm/state"

import { INTERNAL_NORMALIZATION_META } from "../internal-meta"
import { computeListRuns, type ListRunInfo } from "../list-run-engine"

/**
 * Meta key for self-loop detection. Doubles as the plugin key — the
 * standard PM idiom for "is this transaction one I produced?".
 *
 * We deliberately do NOT key off INTERNAL_NORMALIZATION_META for the
 * self-loop guard. That meta is the codebase-wide "this tx was
 * internal housekeeping" signal, shared with BlockId / PinColumnWidths /
 * TableMergedCellsGuard. Other producers may set it `true` for their
 * own reasons; relying on its value shape would conflate signals.
 */
export const listNormalizationKey = new PluginKey("rune-list-normalization")

/**
 * Enforces doc-layer invariants for list run-level positional attrs.
 *
 * v1 invariants (numberedList only):
 *   - `start` is only meaningful on a run leader.
 *   - `start === 1` is the default index — clear it (matches the
 *     existing clipboardRenderDOM precedent).
 *
 * Why a separate extension instead of patching ListNumbering or
 * executeReorder: drag is one of many ways a doc can become dirty.
 * Paste, programmatic insert (`commands.insertBlocks`), undo/redo,
 * and external setContent all bypass the drag handler. Putting the
 * invariant at the appendTransaction layer covers every mutation
 * source uniformly — see spec internal design notes §3.
 *
 * Bullet support and manual markerStyle override are reserved hooks
 * (spec §8); not implemented in v1.
 */
export const ListNormalization = Extension.create({
  name: "listNormalization",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: listNormalizationKey,

        // appendTransaction does NOT fire for the initial EditorState
        // (EditorState.create bypasses the transaction pipeline). Mirror
        // BlockId's pattern: backfill once when the view mounts so any
        // pre-existing dirty doc (paste-on-create, programmatic seed,
        // hot-reload) is cleaned on first render.
        view(view) {
          const tr = buildNormalizationTransaction(view.state)
          if (tr) view.dispatch(tr)
          return {}
        },

        appendTransaction(transactions, _oldState, newState) {
          const docChanged = transactions.some((tr) => tr.docChanged)
          if (!docChanged) return null

          // Self-loop guard: skip when every input tx was ours. Mixed
          // rounds (e.g., user edit + BlockId's id-backfill) DO re-enter
          // because another extension's mutation could surface new
          // dirty data. Cheap when there's nothing to fix (we early
          // return below on no-op).
          if (transactions.every((tr) => tr.getMeta(listNormalizationKey) === true)) {
            return null
          }

          return buildNormalizationTransaction(newState)
        },
      }),
    ]
  },
})

function buildNormalizationTransaction(state: EditorState): Transaction | null {
  const info = computeListRuns(state.doc)
  const tr = state.tr
  let mutated = false

  state.doc.forEach((block, pos) => {
    if (block.type.name !== "numberedList") return
    const blockInfo = info.byPos.get(pos)
    if (!blockInfo) return

    const start = block.attrs.start
    if (start == null) return

    // Rule 1: `start === 1` is the default index. Stripping it makes the
    //         doc shape match what rendering already shows.
    // Rule 2: non-leader `start` is stale data — the counter, not the
    //         attr, decides mid-run indices. Clear it.
    const isLeader = blockInfo.isRunLeader === true
    if (start === 1 || !isLeader) {
      tr.setNodeMarkup(pos, null, { ...block.attrs, start: null })
      mutated = true
    }
  })

  if (!mutated) return null
  tr.setMeta(listNormalizationKey, true)
  tr.setMeta(INTERNAL_NORMALIZATION_META, true)
  tr.setMeta("addToHistory", false)
  return tr
}

export type { ListRunInfo }
