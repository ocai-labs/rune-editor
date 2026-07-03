// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { Extension } from "@tiptap/core"
import { Plugin, PluginKey } from "@tiptap/pm/state"
import { nanoid } from "nanoid"
import { RUNE_BODY_BLOCK_ID_TYPES } from "../blocks/defaultBlocks"
import {
  computeIdPatches,
  buildBackfillTransaction,
  computeAnchoredPositions,
  type StructuralIdConfig,
} from "./shared/structural-id"

const BLOCK_ID_META = "rune/block-id-injected"

// BlockId is purely a runtime concern: it fills the `id` attribute
// that createBlockSpec declares on every rune block. Schema ownership
// moved into the factory — this extension does NOT add the attribute
// itself anymore, it just assigns values.
//
// Two run sites, same logic:
//
//   1. onCreate — walks the initial doc once. The initial EditorState
//      is built without any transaction, so appendTransaction never
//      fires for seed content. Without this pass every block loaded
//      from initialContent would stay id=null until the user typed.
//   2. appendTransaction — fills ids introduced by any doc-changing
//      transaction (new blocks from Enter, paste with id collisions,
//      setContent, etc.).
//
// Both emit transactions tagged with BLOCK_ID_META (so the plugin
// doesn't loop on its own output) and addToHistory=false (so undo
// never reveals an id-less intermediate state).
//
// Paste handling: when a block arrives via paste with an id that
// collides with an existing block in the doc, we generate a fresh id.
// This catches "duplicate block" (Cmd-D-style) and cross-document
// paste, both of which would otherwise produce two blocks pointing at
// the same id.

export const BlockId = Extension.create({
  name: "blockId",

  addOptions() {
    return {
      types: RUNE_BODY_BLOCK_ID_TYPES,
    }
  },

  addProseMirrorPlugins() {
    const types = new Set(this.options.types as string[])
    const pluginKey = new PluginKey("rune-block-id")

    // First consumer of the shared structural-id backfill. Same params as
    // the original inline logic: scan body-block id types, generate via
    // nanoid(8), and tag BLOCK_ID_META on the output tr (a signal kept for
    // parity; looping is prevented by patch-convergence, not this meta).
    const config: StructuralIdConfig = {
      attrName: "id",
      nodePredicate: (node) => types.has(node.type.name),
      generateId: () => nanoid(8),
      extraMeta: [BLOCK_ID_META],
    }

    return [
      new Plugin({
        key: pluginKey,
        // view() fires once right after the editor view is mounted.
        // The initial EditorState arrives via EditorState.create (no
        // transaction), so appendTransaction never sees seed content
        // — dispatch a one-time backfill here instead. Tagged
        // addToHistory=false so undo can't strand the doc in an
        // id-less state.
        view(view) {
          const patches = computeIdPatches(view.state, config)
          const tr = buildBackfillTransaction(view.state, patches, config)
          if (tr) view.dispatch(tr)
          return {}
        },
        appendTransaction: (transactions, oldState, newState) => {
          const docChanged = transactions.some((tr) => tr.docChanged)
          if (!docChanged) return null
          // Anchor ids to blocks that already existed in oldState so a copy
          // pasted ABOVE its original can't steal the original's id.
          const anchored = computeAnchoredPositions(
            oldState,
            newState,
            transactions,
            config,
          )
          const patches = computeIdPatches(newState, config, anchored)
          return buildBackfillTransaction(newState, patches, config)
        },
      }),
    ]
  },
})
