// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { Selection, TextSelection } from "@tiptap/pm/state"
import type { Node as ProseMirrorNode, Schema } from "@tiptap/pm/model"
import {
  topLevelBlockEndPos,
  topLevelBlockStartPos,
  topLevelBlockTextBounds,
} from "../../schema/topLevelBlocks"
import { resolveBodyBlockById, depthSubtreeRange } from "../../schema/bodySurface"
import {
  firstSelectableIndex,
  isBlockSelectable,
} from "../../extensions/block-selection/selectable"
import { expandRangeOverToggleBodies } from "../../blocks/Toggle/range"
import type { DeleteBlocksTarget } from "../types"

export interface DeleteRange {
  /**
   * The block's index within ITS surface. For root-surface deletes this is the
   * root child index (drives `setSelectionAfterDelete`); for column-child
   * deletes it is the column-local index and selection falls back to a mapped
   * `Selection.near` (the index is meaningless at root).
   */
  fromIndex: number
  toIndex: number
  from: number
  to: number
  /** Whether the deleted range sits on the root surface. */
  rootSurface: boolean
}

export function resolveDeleteRanges(
  doc: ProseMirrorNode,
  target: DeleteBlocksTarget,
): DeleteRange[] {
  // Recursive resolution: a column child is deletable by id like a root block.
  if (Array.isArray(target)) {
    const resolved = [...new Set(target)].map((id) => resolveBodyBlockById(doc, id))
    if (resolved.length === 0 || resolved.some((r) => r == null)) return []
    const ranges = resolved
      .map((r) => r!)
      .sort((a, b) => a.pos - b.pos)
      .map((r) => {
        const from = r.pos
        const rawTo = r.pos + r.node.nodeSize
        // Widen over a collapsed toggle's hidden body — deleteBlocks(["togId"])
        // must take the hidden body with it, not orphan it as loose blocks.
        const { to: toggleTo } = expandRangeOverToggleBodies(doc, from, rawTo, {
          collapsedOnly: true,
        })
        // Widen over the block's DEPTH SUBTREE — live-Notion research
        // confirmed a parent delete always carries every following block
        // whose `depth` > the parent's, unconditionally (no promotion, no
        // orphaning), matching the drag-reorder / wrapIntoColumns precedent.
        // This is a strict superset of the toggle widen ABOVE for a
        // single-anchor call like this one (same walk, minus the collapsed
        // gate) — max() is still taken rather than dropping the toggle call,
        // so the two stay independently correct if that ever changes.
        const { to: depthTo } = depthSubtreeRange(doc, from)
        return {
          fromIndex: r.indexInSurface,
          toIndex: r.indexInSurface,
          from,
          to: Math.max(toggleTo, depthTo),
          rootSurface: r.surfacePos === -1,
        }
      })
    // A recursive id list can name a container (columnLayout) AND one of its
    // descendants (exactly what findBlocks hands out). The descendant's range
    // is fully contained in the container's; deleting both against pre-tr
    // positions would re-delete through stale offsets and eat into the next
    // block. Keep outermost ranges only. Widening runs BEFORE this filter, so
    // it also catches a collapsed toggle's hidden body passed explicitly
    // alongside its own toggle id — the toggle's widened range already
    // contains it.
    return ranges.filter(
      (r) => !ranges.some((q) => q !== r && q.from <= r.from && r.to <= q.to),
    )
  }

  const from = resolveBodyBlockById(doc, target.from)
  const to = resolveBodyBlockById(doc, target.to)
  if (!from || !to) return []
  // Single-surface contract: a cross-surface range is rejected.
  if (from.surfacePos !== to.surfacePos) return []
  const lo = Math.min(from.pos, to.pos)
  const hi = Math.max(from.pos, to.pos)
  const hiNode = doc.nodeAt(hi)
  if (!hiNode) return []
  // Widen over a collapsed toggle's hidden body — same rationale as the id-list
  // branch above; a range delete ending on a collapsed toggle must not orphan it.
  // Scans the WHOLE range (not just the tail), so an intermediate collapsed
  // toggle whose body extends past `hi` (target.to lands mid-body) is still
  // caught — depthSubtreeRange below, anchored only at `hi`, cannot see that.
  const { to: toggleTo } = expandRangeOverToggleBodies(doc, lo, hi + hiNode.nodeSize, {
    collapsedOnly: true,
  })
  // Widen over the TAIL block's depth subtree — a range delete ending on a
  // generic (non-toggle) parent must carry its following deeper-depth
  // children too. See the id-list branch above for the live-Notion citation.
  const { to: depthTo } = depthSubtreeRange(doc, hi)
  return [
    {
      fromIndex: Math.min(from.indexInSurface, to.indexInSurface),
      toIndex: Math.max(from.indexInSurface, to.indexInSurface),
      from: lo,
      to: Math.max(toggleTo, depthTo),
      rootSurface: from.surfacePos === -1,
    },
  ]
}

export function setSelectionAfterDelete(
  tr: import("@tiptap/pm/state").Transaction,
  schema: Schema,
  firstDeletedIndex: number,
  rootSurface = true,
): void {
  // Column-child (non-root) deletes: the root-index walk below is meaningless
  // for a column surface. This branch only runs for a PARTIAL column delete —
  // the emptied-column case is handled by the caller (deleteBlockSelection /
  // cut) via removeMoveSource + an explicit caret landing, so post-#392 no
  // command path leaves an empty column here. A partial delete leaves the
  // column populated (no reseed needed): land a safe caret near the first
  // deleted position (mapped through this tr). E2's empty-column reseed remains
  // the safety net for non-command arrivals only (paste / setContent / collab).
  if (!rootSurface) {
    const near = Selection.near(tr.doc.resolve(Math.min(tr.selection.from, tr.doc.content.size)))
    tr.setSelection(near)
    return
  }
  const paragraph = schema.nodes.paragraph
  if (tr.doc.childCount === 0) {
    if (!paragraph) return
    tr.insert(0, paragraph.create())
    tr.setSelection(TextSelection.create(tr.doc, 1))
    return
  }

  // Deleting all body blocks can leave a doc that is non-empty yet has no
  // editable body — only a leading non-selectable block (the in-document
  // title) survives. The schema (`block+`) accepts a title-only doc, but the
  // user needs a line to type into, so re-seed one empty body paragraph after
  // the title (Notion keeps an empty line under the title). `firstSelectableIndex`
  // is `doc.childCount` exactly when nothing on the root surface is selectable.
  const firstSelectable = firstSelectableIndex(tr.doc)
  if (firstSelectable >= tr.doc.childCount) {
    if (!paragraph) return
    const at = tr.doc.content.size
    tr.insert(at, paragraph.create())
    tr.setSelection(TextSelection.create(tr.doc, at + 1))
    return
  }

  // Land the caret at the START of the new first block when the deletion began
  // at the start of the selectable region — either index 0 (no title) or the
  // first body block sitting right after a leading non-selectable title. The
  // title is excluded from block ops and isn't where the user was editing, so
  // parking the caret in it (the default "end of previous block" below) would
  // be wrong.
  const prevIndex = Math.min(firstDeletedIndex - 1, tr.doc.childCount - 1)
  if (firstDeletedIndex === 0 || (prevIndex >= 0 && !isBlockSelectable(tr.doc.child(prevIndex)))) {
    const landIndex = Math.min(firstDeletedIndex, tr.doc.childCount - 1)
    tr.setSelection(
      Selection.near(tr.doc.resolve(topLevelBlockStartPos(tr.doc, landIndex)), 1),
    )
    return
  }

  const node = tr.doc.child(prevIndex)
  if (!node.isTextblock) {
    tr.setSelection(Selection.near(tr.doc.resolve(topLevelBlockEndPos(tr.doc, prevIndex)), -1))
    return
  }

  const bounds = topLevelBlockTextBounds(tr.doc, prevIndex)
  tr.setSelection(TextSelection.create(tr.doc, bounds.to))
}
