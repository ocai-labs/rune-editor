// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { Extension, createDocument } from "@tiptap/core"
import { EditorState, Plugin, PluginKey } from "@tiptap/pm/state"
import { nanoid } from "nanoid"
import { RUNE_BODY_BLOCK_ID_TYPES } from "../blocks/defaultBlocks"
import {
  computeIdPatches,
  buildBackfillTransaction,
  computeAnchoredPositions,
  type StructuralIdConfig,
} from "./shared/structural-id"

const BLOCK_ID_META = "rune/block-id-injected"

function buildIdConfig(types: ReadonlySet<string>): StructuralIdConfig {
  return {
    attrName: "id",
    nodePredicate: (node) => types.has(node.type.name),
    generateId: () => nanoid(8),
    extraMeta: [BLOCK_ID_META],
  }
}

// BlockId is purely a runtime concern: it fills the `id` attribute
// that createBlockSpec declares on every rune block. Schema ownership
// moved into the factory — this extension does NOT add the attribute
// itself anymore, it just assigns values.
//
// Two run sites, same logic:
//
//   1. onBeforeCreate — patches the seed CONTENT, before Tiptap's own
//      createDoc() parses it, instead of patching the doc/state after the
//      fact. This is the only synchronous, mount-independent seed point
//      Tiptap 3.22 offers: a headless editor (`element: null`, the
//      documented SSR path) never mounts an EditorView, so it never attaches
//      ANY ProseMirror plugin (`state.plugins` stays permanently empty —
//      plugins are wired in by `reconfigure()` inside `createView()`, itself
//      only reachable through `mount()`) and never emits "create" (also only
//      emitted from inside `mount()`) — so neither a plugin's view()/state
//      .init() nor the Tiptap onCreate() lifecycle hook ever runs for it.
//      Even a MOUNTED editor emits "create" asynchronously
//      (`window.setTimeout(..., 0)`), so onCreate can't be relied on to have
//      run by the time a caller synchronously reads editor.state right after
//      `new Editor(...)`. onBeforeCreate is the one hook Tiptap invokes
//      synchronously in both modes — before the schema has parsed the seed
//      content — so we parse a throwaway doc from that same content
//      ourselves (schema is already built by this point), run the identical
//      backfill against it, and — only if it produced patches — splice the
//      patched JSON back into `editor.options.content` so the real
//      createDoc() parses the corrected version next. Content that's already
//      fully/uniquely id'd yields no patches, so it's left untouched.
//   2. appendTransaction — fills ids introduced by any doc-changing
//      transaction (new blocks from Enter, paste with id collisions,
//      setContent, etc.).
//
// Both run the same computeIdPatches/buildBackfillTransaction pair (see
// ./shared/structural-id). The appendTransaction output is tagged with
// BLOCK_ID_META (so the plugin doesn't loop on its own output) and
// addToHistory=false (so undo never reveals an id-less intermediate state);
// the onBeforeCreate pass never dispatches a transaction onto a live editor
// at all, so those meta flags are moot there — it only reads `tr.doc` off a
// throwaway EditorState to get the patched JSON.
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

  onBeforeCreate() {
    const types = new Set(this.options.types as string[])
    const config = buildIdConfig(types)
    const { content, parseOptions, enableContentCheck } = this.editor.options
    let doc
    try {
      doc = createDocument(content, this.editor.schema, parseOptions, {
        errorOnInvalidContent: enableContentCheck,
      })
    } catch {
      // Invalid content: Tiptap's own createDoc() re-parses this exact
      // content right after we return and reports it the normal way
      // (contentError) — nothing here to backfill against.
      return
    }
    const throwaway = EditorState.create({ doc, schema: this.editor.schema })
    const patches = computeIdPatches(throwaway, config)
    const tr = buildBackfillTransaction(throwaway, patches, config)
    if (tr) this.editor.options.content = tr.doc.toJSON()
  },

  addProseMirrorPlugins() {
    const types = new Set(this.options.types as string[])
    const pluginKey = new PluginKey("rune-block-id")
    const config = buildIdConfig(types)

    return [
      new Plugin({
        key: pluginKey,
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
