// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { Editor } from "@tiptap/core"
import { InputRule } from "@tiptap/core"
import type { EditorState, Transaction } from "@tiptap/pm/state"
import { TextSelection } from "@tiptap/pm/state"
import type { DeclarativeInputRule } from "./types"

// Implementation helpers for createBlockSpec and any node extension that
// participates in the shared declarative input-rule framework.

/**
 * Execute the declarative `replace` payload from an input rule. Auto-detects
 * the target node shape and chooses the right PM mutation:
 *
 * - **Inline atom** (`isInline && isAtom`, e.g. `inlineMath`): replace just
 *   the matched text range with the node — the containing block stays.
 * - **Block textblock** (e.g. `heading`): delete trigger text, then
 *   `setBlockType` on the wrapper in place.
 * - **Block atom** (e.g. `divider`): replace the whole
 *   containing block with the atom, append a tail paragraph if it would
 *   otherwise become its surface's last child, drop the selection there.
 *
 * Returns the staged Transaction (caller dispatches), or null if the target
 * type is unknown.
 *
 * Range semantics: `from`/`to` cover the matched trigger text inside the
 * containing block. For block-atom replacement, we resolve the containing
 * TEXTBLOCK via `$pos.before/after($pos.depth)` — depth-relative, NOT a
 * hard-coded depth 1: plugin blocks may add structural ancestors, and a
 * replacement at the wrong depth would destroy their container.
 */
export function replaceWithNode(
  state: EditorState,
  range: { from: number; to: number },
  target: { type: string; props?: Record<string, unknown> },
): Transaction | null {
  const nodeType = state.schema.nodes[target.type]
  if (!nodeType) return null

  if (nodeType.isInline && nodeType.isAtom) {
    // Inline atom (e.g. inlineMath). Replace just the matched run; the
    // containing paragraph/heading/list-item stays. PM places the cursor
    // immediately after the inserted node.
    const node = nodeType.create((target.props ?? null) as Record<string, unknown> | null)
    return state.tr.replaceWith(range.from, range.to, node)
  }

  if (!nodeType.isAtom) {
    // Block textblock target (e.g. heading). setBlockType only changes the
    // wrapper; the trigger text ("## ") still lives inside as text — delete
    // it first.
    //
    // setBlockType replaces the node's attrs wholesale with the ones passed,
    // filling type defaults for the rest. Passing only `target.props` would
    // therefore drop the block's structural attrs — most visibly `depth`,
    // resetting indentation to 0 (typing `[]` on an indented line to make a
    // to-do snapped it back to the margin). Merge the existing block's attrs
    // under the rule's props so indent / color / id survive; PM's computeAttrs
    // reads only the keys the target type declares, so attrs the new type
    // lacks are harmlessly ignored.
    const existingAttrs = state.doc.resolve(range.from).parent.attrs
    const attrs = { ...existingAttrs, ...(target.props ?? {}) }
    const tr = state.tr.delete(range.from, range.to)
    tr.setBlockType(range.from, range.from, nodeType, attrs as Record<string, unknown>)
    // Caret: tr.delete leaves selection at range.from; setBlockType doesn't
    // move it; so the caret lands at the start of the new (empty) block
    // automatically. No explicit setSelection needed.
    return tr
  }

  // Block atom branch (e.g. divider). Replace the containing TEXTBLOCK
  // with the atom — depth-relative ($pos.depth is the textblock the trigger
  // text sits in), so a trigger inside a column replaces just that column
  // child, never the whole layout. Then guard: if the new atom is the last
  // child of its SURFACE (doc at root, the column inside a layout), append
  // an empty paragraph so the caret has somewhere to land on that surface.
  const $pos = state.doc.resolve(range.from)
  const blockDepth = $pos.depth
  // Guard: the containing textblock's PARENT must actually admit the atom.
  // Inside a tableCell (tableParagraph), the atom is invalid content — a
  // blind replaceWith would make PM's fitter eject it to the doc root and
  // delete the cell's text. Schema-level check, no node-name special case:
  // if the parent can't host the node, the rule no-ops (typed text stays).
  const parent = $pos.node(blockDepth - 1)
  const index = $pos.index(blockDepth - 1)
  if (!parent.canReplaceWith(index, index + 1, nodeType)) return null
  const blockStart = $pos.before(blockDepth)
  const blockEnd = $pos.after(blockDepth)
  const node = nodeType.create((target.props ?? null) as Record<string, unknown> | null)
  const tr = state.tr.replaceWith(blockStart, blockEnd, node)

  const after = blockStart + node.nodeSize
  // Surface end, mapped through the replace (the replace is strictly inside
  // the surface, so the mapping is exact). At root this equals the old
  // `tr.doc.content.size` check.
  const surfaceEnd = tr.mapping.map($pos.end(blockDepth - 1), 1)
  // Rune always registers paragraph in `kit.ts`; the optional-chain on
  // paragraphType is a defensive no-op for hypothetical custom kits that
  // omit it (in that case the atom ends up as the surface's last child and
  // the caret has nowhere natural to land — accept that degradation).
  const paragraphType = state.schema.nodes.paragraph
  if (after >= surfaceEnd && paragraphType) {
    tr.insert(after, paragraphType.create())
  }
  // +1 to step inside the trailing paragraph (past its opening token).
  tr.setSelection(TextSelection.near(tr.doc.resolve(after + 1)))
  return tr
}

/**
 * Compile declarative input rules into Tiptap `InputRule` instances. The
 * `replace` callback returns the target node spec; the executor
 * (`replaceWithNode`) picks the right PM mutation based on whether the node
 * is an inline atom, block textblock, or block atom.
 *
 * Used by `createBlockSpec` (for block-level rules declared via
 * `createBlockExtension({ inputRules })`) and directly by `Node.create`
 * extensions that need the same declarative shape — e.g. inline-atom rules
 * like InlineMath's `$$…$$`.
 */
export function compileDeclarativeInputRules(
  rules: DeclarativeInputRule[],
  editor: Editor,
): InputRule[] {
  return rules.map(
    (rule) =>
      new InputRule({
        find: rule.find,
        handler: ({ state, range, match }) => {
          const target = rule.replace({ match, editor })
          if (target === false) return null
          const tr = replaceWithNode(state, range, target)
          if (!tr) return null
          // Mutations are on state.tr (same tr Tiptap will dispatch).
          // Return void per InputRule.handler contract.
        },
      }),
  )
}
