// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { Editor } from "@tiptap/core"
import type {
  Node as ProseMirrorNode,
  NodeType,
  ResolvedPos,
} from "@tiptap/pm/model"

import { getBlockSpecs } from "./blocks/registry"
import {
  topLevelBlockIndexById,
  topLevelBlockPosById,
} from "./topLevelBlocks"

/** The document is Rune's only body-block surface. */
export interface ResolvedBodyBlock {
  id: string
  pos: number
  node: ProseMirrorNode
  /** Always `-1`, the root-document sentinel. */
  surfacePos: number
  indexInSurface: number
  depth: number
}

export interface NearestBodyBlock {
  node: ProseMirrorNode
  pos: number
  indexInSurface: number
}

export interface BodyBlockInRange {
  id: string
  pos: number
  node: ProseMirrorNode
}

export interface BodySurfaceBlock {
  node: ProseMirrorNode
  pos: number
  index: number
}

export interface BodySurface {
  surfacePos: number
  children: BodySurfaceBlock[]
}

export interface ResolvedSurface {
  node: ProseMirrorNode
  start: number
  pos: number
}

export interface SurfaceBlockTextBounds {
  node: ProseMirrorNode
  indexInSurface: number
  from: number
  to: number
  surface: ResolvedSurface
}

function depthOf(node: ProseMirrorNode): number {
  return (node.attrs.depth as number | undefined) ?? 0
}

/** Factory-built body blocks carry Rune's shared `depth` attribute. */
export function isBodyBlockNode(node: ProseMirrorNode): boolean {
  const attrs = node.type.spec.attrs
  return attrs != null && "depth" in attrs
}

const admitsBodyBlocksCache = new WeakMap<NodeType, boolean>()

function typeAdmitsBodyBlocks(type: NodeType): boolean {
  const cached = admitsBodyBlocksCache.get(type)
  if (cached !== undefined) return cached
  let admits = false
  for (const name in type.schema.nodes) {
    const child = type.schema.nodes[name]!
    const attrs = child.spec.attrs
    if (attrs != null && "depth" in attrs && type.contentMatch.matchType(child)) {
      admits = true
      break
    }
  }
  admitsBodyBlocksCache.set(type, admits)
  return admits
}

/** True for structural nodes that directly admit Rune body blocks. */
export function isStructuralBlockContainer(node: ProseMirrorNode): boolean {
  return !isBodyBlockNode(node) && typeAdmitsBodyBlocks(node.type)
}

export function resolveBodyBlockById(
  doc: ProseMirrorNode,
  id: string,
): ResolvedBodyBlock | null {
  const pos = topLevelBlockPosById(doc, id)
  if (pos === -1) return null
  const indexInSurface = topLevelBlockIndexById(doc, id)
  if (indexInSurface === -1) return null
  const node = doc.child(indexInSurface)
  return {
    id,
    pos,
    node,
    surfacePos: -1,
    indexInSurface,
    depth: depthOf(node),
  }
}

export function forEachBodyBlock(
  doc: ProseMirrorNode,
  fn: (block: {
    node: ProseMirrorNode
    pos: number
    index: number
    surfacePos: number
  }) => void,
): void {
  let pos = 0
  doc.forEach((node, _offset, index) => {
    if (isBodyBlockNode(node)) fn({ node, pos, index, surfacePos: -1 })
    pos += node.nodeSize
  })
}

export function forEachBodySurface(
  doc: ProseMirrorNode,
  fn: (surface: BodySurface) => void,
): void {
  const children: BodySurfaceBlock[] = []
  forEachBodyBlock(doc, ({ node, pos, index }) => {
    children.push({ node, pos, index })
  })
  if (children.length > 0) fn({ surfacePos: -1, children })
}

/** Resolve the nearest registered root body block around a document position. */
export function nearestBodyBlock(
  editor: Editor,
  $pos: ResolvedPos,
): NearestBodyBlock | null {
  const specs = getBlockSpecs(editor)
  for (let depth = $pos.depth; depth >= 1; depth--) {
    const node = $pos.node(depth)
    if (node.type.name in specs) {
      const pos = $pos.before(depth)
      const rootIndex = $pos.index(0)
      const rootNode = $pos.node(1)
      if (!(rootNode.type.name in specs)) return null
      return { node: rootNode, pos: $pos.before(1), indexInSurface: rootIndex }
    }
  }
  return null
}

export function bodyBlocksInRange(
  doc: ProseMirrorNode,
  from: number,
  to: number,
): BodyBlockInRange[] {
  const out: BodyBlockInRange[] = []
  let pos = 0
  doc.forEach((node) => {
    const end = pos + node.nodeSize
    if (end > from && pos < to) {
      const id = node.attrs.id as string | undefined
      if (id) out.push({ id, pos, node })
    }
    pos = end
  })
  return out
}

export function surfaceBlockTextBoundsAtPos(
  doc: ProseMirrorNode,
  pos: number,
): SurfaceBlockTextBounds | null {
  if (pos < 0 || pos > doc.content.size) return null
  let offset = 0
  let found: SurfaceBlockTextBounds | null = null
  doc.forEach((node, _childOffset, index) => {
    if (found) return
    const from = offset + 1
    const to = from + node.content.size
    if (pos >= from && pos <= to) {
      found = {
        node,
        indexInSurface: index,
        from,
        to,
        surface: { node: doc, start: 0, pos: -1 },
      }
    }
    offset += node.nodeSize
  })
  return found
}

export function surfaceChildrenAt(
  doc: ProseMirrorNode,
  pos: number,
): ResolvedSurface | null {
  if (pos < 0 || pos > doc.content.size) return null
  return { node: doc, start: 0, pos: -1 }
}

export function surfaceChildrenInRange(
  doc: ProseMirrorNode,
  range: { from: number; to: number },
): ProseMirrorNode[] {
  const nodes: ProseMirrorNode[] = []
  let pos = 0
  doc.forEach((node) => {
    if (pos >= range.from && pos < range.to) nodes.push(node)
    pos += node.nodeSize
  })
  return nodes
}

/** Return the following root siblings that belong to a block's depth subtree. */
export function depthSubtreeRange(
  doc: ProseMirrorNode,
  pos: number,
): { from: number; to: number; isEmpty: boolean } {
  const node = doc.nodeAt(pos)
  if (!node) return { from: pos, to: pos, isEmpty: true }
  const parentDepth = depthOf(node)
  const from = pos + node.nodeSize
  let offset = 0
  let selfIndex = -1
  for (let i = 0; i < doc.childCount; i++) {
    if (offset === pos) {
      selfIndex = i
      break
    }
    offset += doc.child(i).nodeSize
  }
  if (selfIndex === -1) return { from, to: from, isEmpty: true }

  let widened = 0
  for (let i = selfIndex + 1; i < doc.childCount; i++) {
    const sibling = doc.child(i)
    if (depthOf(sibling) <= parentDepth) break
    widened += sibling.nodeSize
  }
  const to = from + widened
  return { from, to, isEmpty: from === to }
}
