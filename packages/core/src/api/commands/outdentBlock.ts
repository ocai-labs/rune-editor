// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { Editor } from "@tiptap/core"
import type { EditorState } from "@tiptap/pm/state"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import { surfaceChildrenAt } from "../../schema"
import { collectBlockTargets, type BlockTarget } from "./collectBlockTargets"

function planOutdent(block: BlockTarget): { changed: boolean; newDepth: number } {
  const currentDepth = (block.node.attrs.depth as number | undefined) ?? 0
  if (currentDepth <= 0) return { changed: false, newDepth: 0 }
  return { changed: true, newDepth: currentDepth - 1 }
}

/**
 * In Rune's flat tree, outdenting a block ends its old parent's child run at
 * that point. Every following sibling/deeper block up to the old parent
 * boundary must move with it; otherwise the first unchanged block either
 * becomes an accidental child of the moved block or is left with depth that
 * Markdown cannot own.
 */
function outdentSuffixPositions(
  doc: ProseMirrorNode,
  target: BlockTarget,
): Array<{ pos: number; node: ProseMirrorNode }> {
  const targetDepth = (target.node.attrs.depth as number | undefined) ?? 0
  if (targetDepth <= 0) return []
  const surface = surfaceChildrenAt(doc, target.pos)
  if (!surface) return []

  const positions: Array<{ pos: number; node: ProseMirrorNode }> = []
  let offset = surface.start
  let collecting = false
  let finished = false
  surface.node.forEach((node) => {
    const pos = offset
    offset += node.nodeSize
    if (finished || pos < target.pos) return
    if (pos === target.pos) collecting = true
    if (!collecting) return
    const depth = (node.attrs.depth as number | undefined) ?? 0
    if (depth < targetDepth) {
      finished = true
      return
    }
    positions.push({ pos, node })
  })
  return positions
}

export function outdentBlockImpl(
  id: string | undefined,
): (args: { editor: Editor; state: EditorState; dispatch: ((tr: any) => void) | undefined }) => boolean {
  return ({ editor, state, dispatch }) => {
    const targets = collectBlockTargets(editor, state.selection, id)
    if (targets.length === 0) return false
    const plans = targets.map((t) => ({ target: t, plan: planOutdent(t) }))
    const anyChanged = plans.some((p) => p.plan.changed)
    if (!anyChanged) return false
    if (!dispatch) return true

    // Merge suffixes against the pre-transaction document. Overlapping MBS
    // targets decrement a block once, never once per selected target.
    const affected = new Map<number, ProseMirrorNode>()
    for (const { target, plan } of plans) {
      if (!plan.changed) continue
      for (const block of outdentSuffixPositions(state.doc, target)) {
        affected.set(block.pos, block.node)
      }
    }
    const tr = state.tr
    for (const [pos, node] of affected) {
      const depth = (node.attrs.depth as number | undefined) ?? 0
      tr.setNodeAttribute(pos, "depth", Math.max(0, depth - 1))
    }
    dispatch(tr)
    return true
  }
}
