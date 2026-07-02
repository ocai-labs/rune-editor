// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { Editor } from "@tiptap/core"
import type { Schema, Node as ProseMirrorNode } from "@tiptap/pm/model"
import { getBlockSpecs } from "../../schema/blocks/registry"
import {
  resolveBodyBlockById,
  resolveColumnById,
  surfaceChildrenAt,
} from "../../schema/bodySurface"
import type { BlockInsertTarget, RuneBlockInput } from "../types"
// `RuneBlockInput` also backs the no-nesting insert guard below.

export interface CreateNodeFromInputDefaults {
  depth: number
  attrs?: Record<string, unknown>
  content?: ProseMirrorNode["content"]
  marks?: ProseMirrorNode["marks"]
  preserveContent?: boolean
}

export function resolveInsertPos(
  doc: ProseMirrorNode,
  at: BlockInsertTarget | undefined,
): number {
  if (at === undefined || at === "end") return doc.content.size

  if (typeof at === "number") {
    return numericBoundaryIsInsertable(doc, at) ? at : -1
  }

  // Column-surface target: resolve a boundary position INSIDE a named column.
  if ("columnId" in at) {
    return resolveColumnInsertPos(doc, at)
  }

  // `{id, side}` anchor: resolve on the anchor's OWN surface (root or a column)
  // so an in-column anchor inserts within its column, not at the root. Depth is
  // clamped surface-locally downstream (the command's `normalizeDepthAt` walk);
  // here we only pick the absolute boundary, mirroring the root convention —
  // before → the block's pos, after → past the block's whole node.
  const resolved = resolveBodyBlockById(doc, at.id)
  if (!resolved) return -1
  return at.side === "before"
    ? resolved.pos
    : resolved.pos + resolved.node.nodeSize
}

/**
 * Whether a numeric position sits exactly on a block boundary of ITS body
 * surface — the doc root OR a `column`'s content. `surfaceChildrenAt` resolves
 * the surface a position lives on, but it descends past a textblock, so a
 * mid-text caret still resolves to a surface; we additionally require `pos` to
 * equal one of that surface's child boundaries (its content start, a gap
 * between two children, or its content end). A column-content boundary is a
 * valid insert target; a position inside a textblock is not. Root boundaries
 * stay accepted, behavior-equivalent to the old `topLevelBlockIndexAtBoundaryPos`
 * gate.
 */
function numericBoundaryIsInsertable(doc: ProseMirrorNode, pos: number): boolean {
  const surface = surfaceChildrenAt(doc, pos)
  if (!surface) return false
  let boundary = surface.start
  if (pos === boundary) return true // surface content start (insert at head)
  for (let i = 0; i < surface.node.childCount; i++) {
    boundary += surface.node.child(i).nodeSize
    if (pos === boundary) return true // gap after child i, or content end
    if (pos < boundary) return false // interior of child i (mid-textblock)
  }
  return false
}

/**
 * The absolute boundary position for an insert inside a column. `index` places
 * the block before the column's i-th child (clamped to `[0, childCount]`);
 * `at: "end"` appends at the column's tail. Returns `-1` for an unknown column
 * id. The column's content starts at `columnPos + 1` (past the open token);
 * each child contributes its `nodeSize` to the running boundary offset.
 */
function resolveColumnInsertPos(
  doc: ProseMirrorNode,
  at: { columnId: string; index: number } | { columnId: string; at: "end" },
): number {
  const column = resolveColumnById(doc, at.columnId)
  if (!column) return -1
  const contentStart = column.pos + 1
  if ("at" in at) {
    return contentStart + column.node.content.size
  }
  const index = Math.max(0, Math.min(at.index, column.node.childCount))
  let offset = contentStart
  for (let i = 0; i < index; i++) {
    offset += column.node.child(i).nodeSize
  }
  return offset
}

/**
 * No-nesting insert guard (Columns Phase 1, Task 3 / Step 3).
 *
 * `columnLayout` may not live inside a `column` (nested layouts are forbidden
 * in v1 — see `blocks/Columns/normalization.ts`). This is the insert-time
 * analog of the `transformPasted` flatten + the appendTransaction safety net:
 * refuse the insert at the source so a nested layout never enters the doc.
 *
 * It rejects when BOTH hold:
 *   - one of the inserted blocks is a `columnLayout`, AND
 *   - the resolved insert boundary `pos` sits inside a `column`.
 *
 * This is a REACHABLE guard, not forward-defensive: `{columnId, index}`
 * targets (Task 5) resolve insert positions inside columns, and the
 * `insertBlocks` command calls this for every insert path. The slash-menu
 * `/columns` item also calls it directly before committing.
 */
export function insertWouldNestColumnLayout(
  doc: ProseMirrorNode,
  pos: number,
  // Only `type` is consumed — accept any input shape that carries it so
  // callers that haven't built a full RuneBlockInput yet (the columns slash
  // item probes BEFORE constructing the layout) can ask the question.
  blocks: ReadonlyArray<Pick<RuneBlockInput, "type">>,
): boolean {
  if (pos < 0) return false
  if (!blocks.some((block) => block.type === "columnLayout")) return false
  return resolvesInsideColumn(doc, pos)
}

/**
 * Whether the boundary position `pos` sits inside a `column` node (its
 * ancestor chain includes a `column`). `doc.resolve(pos)` walks the depth
 * stack; we check every ancestor so a future deeper structural surface still
 * trips the guard.
 */
function resolvesInsideColumn(doc: ProseMirrorNode, pos: number): boolean {
  if (pos < 0 || pos > doc.content.size) return false
  const $pos = doc.resolve(pos)
  for (let depth = $pos.depth; depth > 0; depth--) {
    if ($pos.node(depth).type.name === "column") return true
  }
  return false
}

export function createNodeFromBlockInput(
  editor: Editor,
  schema: Schema,
  input: RuneBlockInput,
  defaults: CreateNodeFromInputDefaults = { depth: 0 },
): ProseMirrorNode | null {
  // Shape gate at the shared chokepoint: a malformed entry — null, a non-object,
  // or one with no string `type` — can arrive from a model reply or from a
  // nested `children` / `columns` array. Return null (the caller then refuses)
  // rather than dereferencing `input.type` and throwing out of the insert
  // command, which has no try/catch.
  const candidate = input as unknown
  if (
    candidate === null ||
    typeof candidate !== "object" ||
    typeof (candidate as { type?: unknown }).type !== "string"
  ) {
    return null
  }
  const construct = getBlockSpecs(editor)[input.type]?.fromInput
  if (typeof construct !== "function") return null
  return construct({ schema, input, defaults, editor })
}
