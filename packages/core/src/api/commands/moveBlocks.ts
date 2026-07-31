// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import {
  depthSubtreeRange,
  resolveBodyBlockById,
  surfaceChildrenInRange,
} from "../../schema/bodySurface"
import type { MoveBlocksTarget } from "../types"

export interface ResolvedMove {
  from: number
  to: number
  insertPos: number
}

export interface ContiguousSourceRun {
  from: number
  to: number
  count: number
}

/** Resolve root block ids to one contiguous run, widening over depth subtrees. */
export function resolveContiguousSourceRun(
  doc: ProseMirrorNode,
  ids: string[],
): ContiguousSourceRun | null {
  const resolvedSources = ids.map((id) => resolveBodyBlockById(doc, id))
  if (resolvedSources.length === 0 || resolvedSources.some((source) => source == null)) {
    return null
  }
  const sources = resolvedSources.map((source) => source!)
  const sortedByIndex = [...sources].sort(
    (a, b) => a.indexInSurface - b.indexInSurface,
  )
  for (let i = 1; i < sortedByIndex.length; i++) {
    if (sortedByIndex[i]!.indexInSurface !== sortedByIndex[i - 1]!.indexInSurface + 1) {
      return null
    }
  }

  const first = sortedByIndex[0]!
  const last = sortedByIndex[sortedByIndex.length - 1]!
  let to = last.pos + last.node.nodeSize
  for (const source of sortedByIndex) {
    to = Math.max(to, depthSubtreeRange(doc, source.pos).to)
  }
  return {
    from: first.pos,
    to,
    count: surfaceChildrenInRange(doc, { from: first.pos, to }).length,
  }
}

export function resolveMove(
  doc: ProseMirrorNode,
  ids: string[],
  target: MoveBlocksTarget,
): ResolvedMove | null {
  const run = resolveContiguousSourceRun(doc, ids)
  if (!run) return null
  const targetBlock = resolveBodyBlockById(doc, target.id)
  if (!targetBlock) return null
  return {
    from: run.from,
    to: run.to,
    insertPos:
      target.side === "before"
        ? targetBlock.pos
        : targetBlock.pos + targetBlock.node.nodeSize,
  }
}
