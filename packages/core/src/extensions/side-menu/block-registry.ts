// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { Editor } from "@tiptap/core"
import type { EditorView } from "@tiptap/pm/view"
import { getBlockSpecs } from "../../schema"
import { surfaceChildrenAt } from "../../schema/bodySurface"

/**
 * Is this node type registered as draggable? Flat-schema MVP: a single
 * per-type predicate, no depth / resolved-pos threading.
 */
export function isDraggable(nodeType: string, editor: Editor): boolean {
  return getBlockSpecs(editor)[nodeType]?.sideMenu?.draggable === true
}

/**
 * Walk up from a PM position; deepest draggable ancestor wins. For atom blocks
 * at depth 0 (for example divider), fall back to the adjacent sibling. The
 * deepest-first rule also keeps plugin-provided structural blocks unambiguous.
 */
export function draggableAncestorPosFor(
  view: EditorView,
  pos: number,
  editor: Editor,
): number | null {
  try {
    const $pos = view.state.doc.resolve(pos)
    // A draggable atom at a nested boundary may not be on the ancestor chain.
    // Consult adjacent atoms first so the innermost draggable still wins.
    if ($pos.depth >= 1) {
      const surface = surfaceChildrenAt(view.state.doc, pos)
      if (surface && surface.pos !== -1 && surface.pos === $pos.before($pos.depth)) {
        const after = $pos.nodeAfter
        if (after?.isAtom && isDraggable(after.type.name, editor)) {
          return pos
        }
        const before = $pos.nodeBefore
        if (before?.isAtom && isDraggable(before.type.name, editor)) {
          return pos - before.nodeSize
        }
      }
    }
    for (let d = $pos.depth; d >= 1; d--) {
      const node = $pos.node(d)
      if (!isDraggable(node.type.name, editor)) continue
      return $pos.before(d)
    }
    if ($pos.nodeAfter && isDraggable($pos.nodeAfter.type.name, editor)) {
      return pos
    }
    if ($pos.nodeBefore && isDraggable($pos.nodeBefore.type.name, editor)) {
      return pos - $pos.nodeBefore.nodeSize
    }
    return null
  } catch {
    return null
  }
}
