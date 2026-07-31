// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { Editor } from "@tiptap/core"
import type { Node as ProseMirrorNode, Schema } from "@tiptap/pm/model"
import { Selection, type Transaction } from "@tiptap/pm/state"
import {
  resolveBodyBlockById,
  surfaceChildrenAt,
} from "../../schema/bodySurface"
import type { TurnIntoTarget, TurnIntoBlockInput } from "../types"
import { classifyKind, getAdapter } from "./turnIntoAdapters"

export interface TurnIntoSource {
  pos: number
  node: ProseMirrorNode
}

export function resolveTurnIntoSources(
  doc: ProseMirrorNode,
  target: TurnIntoTarget,
): TurnIntoSource[] {
  // Single id / id list: each block is resolved by the recursive resolver, so
  // a column child turns-into exactly like a root block (resolver-only path).
  if (typeof target === "string") {
    const resolved = resolveBodyBlockById(doc, target)
    return resolved ? [{ pos: resolved.pos, node: resolved.node }] : []
  }

  if (Array.isArray(target)) {
    const uniqueIds = [...new Set(target)]
    const sources = uniqueIds.map((id) => resolveBodyBlockById(doc, id))
    if (sources.length === 0 || sources.some((s) => s == null)) return []
    return sources
      .map((s) => ({ pos: s!.pos, node: s!.node }))
      .sort((a, b) => a.pos - b.pos)
  }

  // Range target: both endpoints must share a surface (single-surface
  // contract — cross-surface ranges are rejected). Walk that surface's blocks
  // between the two endpoints inclusive.
  const fromBlock = resolveBodyBlockById(doc, target.from)
  const toBlock = resolveBodyBlockById(doc, target.to)
  if (!fromBlock || !toBlock) return []
  if (fromBlock.surfacePos !== toBlock.surfacePos) return []

  const surface = surfaceChildrenAt(doc, fromBlock.pos)
  if (!surface) return []
  const lo = Math.min(fromBlock.pos, toBlock.pos)
  const hi = Math.max(fromBlock.pos, toBlock.pos)
  const sources: TurnIntoSource[] = []
  let offset = surface.start
  surface.node.forEach((node) => {
    const pos = offset
    offset += node.nodeSize
    if (pos < lo || pos > hi) return
    sources.push({ pos, node })
  })
  return sources
}

export function canTurnInto(
  sourceNode: ProseMirrorNode,
  target: TurnIntoBlockInput,
  schema: Schema,
): boolean {
  if (!schema.nodes[target.type]) return false
  // Container sources cannot convert: their structured content cannot be
  // absorbed by textblock or atom targets.
  if (classifyKind(sourceNode.type) === "container") return false
  return true
}

export interface ApplyTurnIntoOptions {
  keepDepth?: boolean
}

export interface ApplyTurnIntoResult {
  accepted: number
  rejected: number
}

/**
 * Chain-safety (task #17): `sources[].pos` must be valid against `tr.doc` AT
 * ENTRY — the `mapFrom` invariant. Under `editor.chain()`, `state.doc` IS the
 * live `tr.doc` (already reflecting prior chain steps), so a caller resolving
 * sources from `state.doc` satisfies this for free; positions must NOT be
 * pre-mapped through a mapping the caller built itself.
 */
export function applyTurnIntoTr(
  editor: Editor,
  tr: Transaction,
  sources: TurnIntoSource[],
  target: TurnIntoBlockInput,
  schema: Schema,
  options: ApplyTurnIntoOptions = {},
): ApplyTurnIntoResult {
  const keepDepth = options.keepDepth ?? true
  let accepted = 0
  let rejected = 0
  let firstAcceptedPos: number | null = null
  const mapFrom = tr.mapping.maps.length

  for (const source of sources) {
    const currentPos = tr.mapping.slice(mapFrom).map(source.pos)
    const currentNode = tr.doc.nodeAt(currentPos)
    if (!currentNode || currentNode.attrs.id !== source.node.attrs.id) {
      rejected++
      continue
    }

    if (!canTurnInto(currentNode, target, schema)) {
      rejected++
      continue
    }

    const targetType = schema.nodes[target.type]!
    const adapter = getAdapter(
      classifyKind(currentNode.type),
      classifyKind(targetType),
      currentNode.type.name,
      target.type,
    )
    const result = adapter(editor, currentNode, target, schema)
    if (!result) {
      rejected++
      continue
    }
    const sourceDepth =
      typeof source.node.attrs.depth === "number" ? source.node.attrs.depth : 0
    const attrs = {
      ...result.node.attrs,
      id: source.node.attrs.id,
      depth: keepDepth ? sourceDepth : 0,
    }

    if (result.attrsOnly) {
      for (const [key, value] of Object.entries(attrs)) {
        if (currentNode.attrs[key] !== value) {
          tr.setNodeAttribute(currentPos, key, value)
        }
      }
    } else {
      const node = targetType.create(attrs, result.node.content, result.node.marks)
      tr.replaceWith(currentPos, currentPos + currentNode.nodeSize, node)
    }

    result.postProcess?.(tr, currentPos)
    accepted++
    if (firstAcceptedPos === null) firstAcceptedPos = currentPos
  }

  if (firstAcceptedPos !== null) {
    tr.setSelection(Selection.near(tr.doc.resolve(firstAcceptedPos + 1)))
  }

  return { accepted, rejected }
}
