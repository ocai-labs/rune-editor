// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { Editor } from "@tiptap/core"
import type { EditorState, Transaction } from "@tiptap/pm/state"
import { AllSelection, TextSelection } from "@tiptap/pm/state"
import { nearestBodyBlock } from "../../schema/bodySurface"
import { isStructuralIndentType } from "../../schema"

/**
 * Split the current list block at the cursor, creating a new same-kind
 * sibling carrying the suffix content. Counterpart to PM's
 * `splitListItem` from `@tiptap/extension-list-item`, adapted for our
 * flat schema.
 *
 * Why this exists: PM's default `splitBlock` falls back to the schema's
 * default block (`paragraph`) when splitting at the end of a textblock,
 * so Enter on a non-empty bullet/numbered/task previously dropped the
 * user out of the list. Issue #188 + spec for behavior parity with v1
 * and Notion.
 *
 * Attr resets on the new sibling:
 * - `id`: null (BlockId's appendTransaction fills it)
 * - `depth`: preserved (Enter doesn't change depth)
 * - `numberedList.start`: null (ListNumbering plugin auto-continues)
 * - `taskList.checked`: false (don't propagate parent's checked state)
 *
 * No-ops (returns false) when the cursor isn't inside a list block.
 */
export function splitListBlockImpl(): (args: {
  editor: Editor
  state: EditorState
  dispatch: ((tr: Transaction) => void) | undefined
}) => boolean {
  return ({ editor, state, dispatch }) => {
    const { $from } = state.selection
    if ($from.depth < 1) return false

    const nearest = nearestBodyBlock(editor, $from)
    if (!nearest) return false
    const block = nearest.node
    if (!isStructuralIndentType(editor, block.type.name)) return false
    if (!$from.parent.isBlock) return false

    const newAttrs: Record<string, unknown> = {
      id: null,
      depth: (block.attrs.depth as number | undefined) ?? 0,
    }
    if (block.type.name === "numberedList") {
      newAttrs.start = null
    } else if (block.type.name === "taskList") {
      newAttrs.checked = false
    }

    if (!dispatch) return true

    const tr = state.tr
    // Chain-safety (task #17): `$from.pos` is resolved from `state.selection`,
    // which under `editor.chain()` IS the live `tr.doc` — so it must map
    // through only the steps THIS call adds below (the optional
    // `deleteSelection()`), not the whole `tr.mapping`.
    const mapFrom = tr.mapping.maps.length
    if (
      (state.selection instanceof TextSelection ||
        state.selection instanceof AllSelection) &&
      !state.selection.empty
    ) {
      tr.deleteSelection()
    }

    tr.split(tr.mapping.slice(mapFrom).map($from.pos), 1, [
      { type: block.type, attrs: newAttrs },
    ])
    dispatch(tr.scrollIntoView())
    return true
  }
}
