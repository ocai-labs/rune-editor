// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { Node } from "@tiptap/pm/model"

// The single definition of "this block participates in block selection",
// shared by every block-selection entry point (selectAllBlocks, the Cmd+A
// keymap staging, and the marquee intersection walk) so the exclusion rule
// lives in exactly one place.
//
// A block opts OUT by declaring `meta: { selectable: false }` in its spec —
// the factory (createSpec.ts) flows that to the PM node spec's `selectable`
// flag. Today only the in-document page title does this: Notion never sweeps
// the title into a block selection, and excluding it makes "select-all +
// Delete" preserve the title.
//
// `selectable: false` is a ProseMirror NodeSpec flag that only blocks
// NodeSelection (whole-node selection); it does NOT affect TextSelection /
// caret editing, so title text editing is unaffected.

/** Whether a node participates in block selection. `false` ⇒ excluded. */
export function isBlockSelectable(node: Node): boolean {
  return node.type.spec.selectable !== false
}

/**
 * Index of the first ROOT child that participates in block selection,
 * skipping a leading run of non-selectable blocks (the title, always at
 * index 0). Returns `doc.childCount` when nothing on the root surface is
 * selectable. Written as a general leading-skip even though the title is
 * the only such block today.
 */
export function firstSelectableIndex(doc: Node): number {
  let i = 0
  while (i < doc.childCount && !isBlockSelectable(doc.child(i))) i++
  return i
}
