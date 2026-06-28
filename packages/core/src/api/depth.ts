// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import type { IndentConfig } from "../schema/blocks/createSpec"
import { surfaceChildrenAt } from "../schema/bodySurface"
import { isBlockSelectable } from "../extensions/block-selection/selectable"

/**
 * The depth at which `pos` sits, as the depth of the immediately preceding
 * sibling ON THE SAME SURFACE, or `-1` when there is no preceding sibling.
 * Extracted from `indentBlock.ts`'s `immediatelyPrevDepth` (the follow-prev
 * cap basis): the last sibling on `pos`'s surface whose start offset is
 * strictly before `pos`.
 *
 * Phase 1: the surface is resolved from `pos` — the doc root for a root
 * boundary, the containing `column` for a position inside a column — so the
 * predecessor scan is surface-local, never crossing a structural boundary.
 */
function immediatelyPrevDepth(doc: ProseMirrorNode, pos: number): number {
  const surface = surfaceChildrenAt(doc, pos)
  if (!surface) return -1
  let prevDepth = -1
  let offset = surface.start
  surface.node.forEach((child) => {
    const childStart = offset
    offset += child.nodeSize
    if (childStart >= pos) return
    // A non-selectable block (the in-document title) is never an indent anchor:
    // body blocks must not nest under it. Skipping it leaves the first body
    // block with no preceding sibling, so its follow-prev cap stays 0 (Tab is a
    // no-op there) — the same as a title-less doc's lone first block.
    if (!isBlockSelectable(child)) return
    prevDepth = (child.attrs.depth as number | undefined) ?? 0
  })
  return prevDepth
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
 * - `mode: "numeric"` — cap at the configured `maxDepth` (same as `planIndent`:
 *   Tab succeeds only while `depth < maxDepth`). `maxDepth: 0` forces depth 0
 *   (non-indentable blocks: CodeBlock, Divider, Table).
 * - `mode: "follow-prev"` / `mode: "structural"` / absent — cap at
 *   `immediatelyPrevDepth + 1` (the follow-prev cap from `indentBlock.ts:53-63`;
 *   no preceding sibling ⇒ cap 0). Structural's same-kind-predecessor gate is a
 *   Tab-time guard, not a destination clamp, so for placement it caps the same
 *   way; absent spec defaults to follow-prev per `BlockSpecConfig.indent` JSDoc.
 *
 * `pos` is the destination boundary position (where the block will live);
 * `spec` is the block's `IndentConfig` (or `undefined` to default to follow-prev).
 */
export function normalizeDepthAt(
  doc: ProseMirrorNode,
  pos: number,
  requestedDepth: number,
  spec: IndentConfig | undefined,
): number {
  const floored = Math.max(0, requestedDepth)

  if (spec?.mode === "numeric") {
    return Math.min(floored, Math.max(0, spec.maxDepth))
  }

  // follow-prev | structural | absent: cap at the preceding sibling's depth + 1.
  const cap = immediatelyPrevDepth(doc, pos) + 1
  return Math.min(floored, Math.max(0, cap))
}
