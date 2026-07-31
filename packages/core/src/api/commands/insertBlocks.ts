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

  // `{id, side}` resolves to a root block boundary.
  const resolved = resolveBodyBlockById(doc, at.id)
  if (!resolved) return -1
  return at.side === "before"
    ? resolved.pos
    : resolved.pos + resolved.node.nodeSize
}

/**
 * Whether a numeric position sits exactly on a root block boundary.
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

export function createNodeFromBlockInput(
  editor: Editor,
  schema: Schema,
  input: RuneBlockInput,
  defaults: CreateNodeFromInputDefaults = { depth: 0 },
): ProseMirrorNode | null {
  // Shape gate at the shared chokepoint: a malformed entry — null, a non-object,
  // or one with no string `type` — can arrive from a model reply. Return null
  // (the caller then refuses)
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
