// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { EditorState } from "@tiptap/pm/state"
import {
  forEachBodyBlock,
  surfaceBlockTextBoundsAtPos,
} from "../../schema/bodySurface"
import type {
  PlaceholderConfig,
  PlaceholderHit,
  PlaceholderResolver,
  PlaceholderState,
} from "./types"

const hasOwn = (object: object, key: string) =>
  Object.prototype.hasOwnProperty.call(object, key)

/**
 * Resolves placeholders to render this tick.
 *
 * Two passes, deduped by block pos:
 *   1. Headings are always-on: every empty top-level `heading` block
 *      gets its per-type placeholder regardless of focus / caret
 *      position. Mirrors the toggle title (`ToggleBodyPlugin`) so
 *      writers scanning the outline still see each empty H-row
 *      labelled. No config knob — N=1 today; when a second always-on
 *      block type appears, lift to an option then.
 *   2. Focused empty block: existing behavior — per-type override
 *      first, then `default`. Skipped if the focused block was already
 *      painted by pass 1.
 */
export function resolvePlaceholder(
  state: EditorState,
  config: PlaceholderConfig | undefined,
  editorFocused: boolean,
  isEditable: boolean,
): PlaceholderHit[] {
  if (!isEditable) return []
  if (!config) return []

  const hits: PlaceholderHit[] = []
  const seen = new Set<number>()
  const { selection, doc } = state

  // Pass 1: always-on headings. The body-surface walker covers the flat
  // built-in schema and any plugin-provided body surface.
  const headingResolver = config.heading
  if (headingResolver !== undefined) {
    forEachBodyBlock(doc, ({ node, pos }) => {
      if (node.type.name !== "heading") return
      if (!node.isTextblock || node.content.size !== 0) return
      const text =
        typeof headingResolver === "function" ? headingResolver(node) : headingResolver
      if (!text) return
      seen.add(pos)
      hits.push({ pos, node, text, state: "per-type" })
    })
  }

  // Pass 2: focused empty block falls back to default / per-type.
  if (editorFocused) {
    // The caret's body block, resolved on its own surface — a caret in a
    // column paragraph resolves to that paragraph; deeper structure that is
    // not a surface (table cells) still resolves to the surface child (the
    // table). Null at a block boundary (e.g. a NodeSelection on a top-level
    // block), which skips this pass.
    const bounds = surfaceBlockTextBoundsAtPos(doc, selection.from)
    if (bounds) {
      const block = bounds.node
      const blockPos = bounds.from - 1
      if (block.isTextblock && block.content.size === 0 && !seen.has(blockPos)) {
        const blockType = block.type.name
        // Lookup is by runtime PM node name, which may be a downstream
        // block not in RuneBlockTypeName. Cast through unknown — keys
        // not present in the (now closed) typed config simply read back
        // as undefined, matching the previous index-signature behavior.
        let resolver = (config as Record<string, PlaceholderResolver | undefined>)[blockType]
        let resolverState: PlaceholderState = "per-type"

        // An explicit per-type `undefined` opts that block type out instead of
        // falling through to default. This lets consumers disable one shipped
        // default, e.g. `{ heading: undefined }`.
        if (resolver !== undefined || !hasOwn(config, blockType)) {
          if (!resolver) {
            // Code-like blocks (meta.code → NodeSpec.code) opt out of the default
            // placeholder. The shipped default — `'"/" for commands'` — would be
            // a false promise: kit.ts denies the slash trigger inside any block
            // whose `type.spec.code` is true. Per-type overrides still apply.
            if (!block.type.spec.code) {
              resolver = config.default
              resolverState = "default"
            }
          }
          if (resolver) {
            const text = typeof resolver === "function" ? resolver(block) : resolver
            if (text) {
              hits.push({ pos: blockPos, node: block, text, state: resolverState })
            }
          }
        }
      }
    }
  }

  return hits
}
