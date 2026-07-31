// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { Extension } from "@tiptap/core"
import { TextSelection } from "@tiptap/pm/state"
import {
  nearestBodyBlock,
  surfaceChildrenAt,
} from "../../schema/bodySurface"

/**
 * Symmetric Backspace at the boundary of two empty textblocks.
 *
 * Scenario: user has an empty heading, presses Enter (the indent
 * extension lets that fall through to PM `splitBlock`, which produces
 * `[heading, paragraph]` — both empty), then presses Backspace at the
 * start of the new paragraph.
 *
 * PM's default Backspace collapses the pair by *deleting the previous
 * block* (the empty heading), leaving only the paragraph — so the user
 * loses the heading they intentionally created. We want the inverse:
 * delete the *current* empty block and move the cursor back into the
 * (still-empty) previous block. The previous block dies only on a
 * second Backspace.
 *
 * Scope is deliberately narrow: both blocks must be empty textblocks and
 * adjacent siblings on the same body surface. Built-in Rune blocks live at
 * the root; the surface-aware resolution also prevents plugin blocks from
 * reaching across a structural boundary. Atom blocks (divider) and same-depth indent
 * moves are left
 * to their own handlers (Divider's `preserveDividerOnBackspace`, the
 * Indent extension's outdent path).
 */
export const EmptyBlockBackspace = Extension.create({
  name: "emptyBlockBackspace",

  // Lower than Indent (1000) so depth>0 outdent wins, higher than the
  // default 100 so we run before PM's joinBackward fallback.
  priority: 500,

  addKeyboardShortcuts() {
    return {
      Backspace: () => {
        const editor = this.editor
        const { state } = editor
        const { selection } = state
        if (!selection.empty) return false

        const $from = state.selection.$from
        if ($from.depth < 1) return false
        if ($from.parentOffset !== 0) return false

        const nearest = nearestBodyBlock(editor, $from)
        if (!nearest) return false
        const current = nearest.node
        if (current.content.size !== 0) return false

        // `prev` must resolve on the same surface as `current`. The first block
        // on a plugin surface has no previous sibling here, so we never cross
        // a structural boundary.
        if (nearest.indexInSurface === 0) return false
        const surface = surfaceChildrenAt(state.doc, nearest.pos)
        if (!surface) return false
        const prev = surface.node.child(nearest.indexInSurface - 1)
        if (!prev.isTextblock) return false
        if (prev.content.size !== 0) return false

        const currentStart = nearest.pos
        const currentEnd = nearest.pos + current.nodeSize
        const prevEnd = currentStart - 1

        const tr = state.tr.delete(currentStart, currentEnd)
        tr.setSelection(TextSelection.create(tr.doc, prevEnd))
        editor.view.dispatch(tr.scrollIntoView())
        return true
      },
    }
  },
})
