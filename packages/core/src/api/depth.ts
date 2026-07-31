// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { Editor } from "@tiptap/core"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import type { IndentConfig } from "../schema/blocks/createSpec"
import { getBlockSpecs } from "../schema/blocks/registry"
import { surfaceChildrenAt } from "../schema/bodySurface"
import { isBlockSelectable } from "../extensions/block-selection/selectable"

export interface MarkdownDepthBlock {
  type: string
  depth: number
}

/** Built-in/plugin block kinds whose deeper sibling run has real Markdown
 * structure: structural list items and storage contracts such as Toggle. */
export function markdownDepthOwnerTypes(editor: Editor): ReadonlySet<string> {
  const owners = new Set<string>()
  for (const [type, spec] of Object.entries(getBlockSpecs(editor))) {
    if (spec.indent?.mode === "structural" || spec.markdown?.absorbsDeeperRun === true) {
      owners.add(type)
    }
  }
  return owners
}

/**
 * Block kinds that cannot carry a depth at all, because a container would
 * destroy their bytes rather than merely indent them (`markdown.flattensDepth`).
 *
 * Distinct from `indent.maxDepth: 0`, which several blocks declare for the
 * weaker reason that indenting them is meaningless — a fenced code block under
 * a list item still round-trips perfectly. The codec enforces this set when
 * serializing; the drag path uses it to stop offering a slot the save would
 * silently undo.
 */
export function depthFlatteningTypes(editor: Editor): ReadonlySet<string> {
  const flattening = new Set<string>()
  for (const [type, spec] of Object.entries(getBlockSpecs(editor))) {
    if (spec.markdown?.flattensDepth === true) flattening.add(type)
  }
  return flattening
}

/** Maximum Markdown-persistable depth at the end of a flat block sequence.
 * A direct owner may open one child level. A non-owner already inside an
 * owner's body may be followed only at that same child level; it can never
 * become a new indentation parent. */
export function maxPersistableDepthAfter(
  blocks: readonly MarkdownDepthBlock[],
  ownerTypes: ReadonlySet<string>,
): number {
  const previous = blocks.at(-1)
  if (!previous) return 0
  if (ownerTypes.has(previous.type)) return Math.max(0, previous.depth + 1)
  if (previous.depth <= 0) return 0

  for (let index = blocks.length - 2; index >= 0; index -= 1) {
    const candidate = blocks[index]!
    if (candidate.depth >= previous.depth) continue
    if (candidate.depth !== previous.depth - 1) return 0
    return ownerTypes.has(candidate.type) ? previous.depth : 0
  }
  return 0
}

/** Maximum Markdown-persistable depth for a block at a surface boundary. */
export function maxPersistableDepthAt(
  doc: ProseMirrorNode,
  pos: number,
  ownerTypes: ReadonlySet<string>,
): number {
  const surface = surfaceChildrenAt(doc, pos)
  if (!surface) return 0
  const previous: MarkdownDepthBlock[] = []
  let offset = surface.start
  surface.node.forEach((child) => {
    const childStart = offset
    offset += child.nodeSize
    if (childStart >= pos) return
    if (!isBlockSelectable(child)) return
    previous.push({
      type: child.type.name,
      depth: (child.attrs.depth as number | undefined) ?? 0,
    })
  })
  return maxPersistableDepthAfter(previous, ownerTypes)
}

/**
 * Clamp a requested `depth` to what is legal for a block living at `pos` on
 * its surface, given that block's `IndentConfig`. This is the single primitive
 * the write commands (`insertBlocks`, `moveBlocks`, `updateBlock`) and the
 * indent/drag/markdown depth rules share.
 *
 * The rules it encodes (all extracted, not invented):
 * - Floor at 0. Negative depths are illegal everywhere (matches the `Math.max(0, …)`
 *   clamps in `reorder.ts`'s drag re-base and `markdown.ts`'s depth offset).
 * - Every positive depth must be owned by Markdown structure. A list item or a
 *   contract with `absorbsDeeperRun` may own direct children; ordinary blocks
 *   may continue at that child level but may not open another level.
 * - `mode: "numeric"` additionally caps at `maxDepth`. `maxDepth: 0` forces
 *   depth 0 (non-indentable blocks: CodeBlock, Divider, Table).
 * - Structural's same-kind-predecessor gate remains a Tab-time rule; placement
 *   still uses the shared Markdown-owner cap.
 *
 * `pos` is the destination boundary position (where the block will live);
 * `spec` is the block's `IndentConfig` (or `undefined` to default to follow-prev).
 */
export function normalizeDepthAt(
  doc: ProseMirrorNode,
  pos: number,
  requestedDepth: number,
  spec: IndentConfig | undefined,
  ownerTypes: ReadonlySet<string>,
): number {
  const floored = Math.max(0, requestedDepth)
  const markdownCap = maxPersistableDepthAt(doc, pos, ownerTypes)

  if (spec?.mode === "numeric") {
    return Math.min(floored, Math.max(0, spec.maxDepth), markdownCap)
  }

  return Math.min(floored, markdownCap)
}
