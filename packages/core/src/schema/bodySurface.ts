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
  topLevelBlockPosById,
  topLevelBlockIndexById,
} from "./topLevelBlocks"

/**
 * The body-surface resolver layer. This is the single seam Phase 1
 * (`columnLayout > column`) will re-implement recursively. In Phase 0 the
 * document is flat — every body block is a direct child of `<doc>` — so each
 * function here resolves against the ROOT surface only and is behavior-
 * equivalent by construction. It delegates to `topLevelBlocks.ts` where the
 * walk is identical; those helpers stay root-only (spec §Block Resolution).
 *
 * "Surface" = the parent node whose direct children are sibling body blocks.
 * Today that is always `<doc>`; `surfacePos === -1` is the sentinel for the
 * root surface. Phase 1 returns the containing column node's position there.
 */

/** A body block resolved on its surface. `surfacePos === -1` ≡ root surface. */
export interface ResolvedBodyBlock {
  /** The block's `id` attr. */
  id: string
  /** Absolute PM position of the block (the position before it). */
  pos: number
  /** The block node. */
  node: ProseMirrorNode
  /**
   * Absolute PM position of the surface this block lives on, or `-1` for the
   * root surface (the doc). Phase 1 returns the column node's pos here.
   */
  surfacePos: number
  /** The block's index among its surface's children. */
  indexInSurface: number
  /** The block's `depth` attr. */
  depth: number
}

/** The body block nearest a resolved position, from `nearestBodyBlock`. */
export interface NearestBodyBlock {
  /** The nearest ancestor body block node. */
  node: ProseMirrorNode
  /** Absolute PM position of that block (the position before it). */
  pos: number
  /** Its index among its surface's children. */
  indexInSurface: number
}

/** A body block overlapping a boundary range, from `bodyBlocksInRange`. */
export interface BodyBlockInRange {
  /** The block's `id` attr. */
  id: string
  /** Absolute PM position of the block. */
  pos: number
  /** The block node. */
  node: ProseMirrorNode
}

function depthOf(node: ProseMirrorNode): number {
  return (node.attrs.depth as number | undefined) ?? 0
}

/**
 * Whether a node is a registered body block, decided NODE-LOCALLY (no
 * editor / registry handle — these resolvers only receive `doc`).
 *
 * The factory (`createBlockSpec`) gives every body block the shared `depth`
 * attribute; structural nodes hand-rolled with `Node.create` (the `column`
 * precedent, and any future structural layer) do not declare `depth`. So
 * "has a `depth` attr in its type spec" is exactly the body-block marker
 * that survives without the `__runeBlockSpec` editor-storage lookup.
 *
 * This is the same discriminator the registry marker encodes, just read
 * from the schema instead of editor storage — so a future second layout
 * block (also built via the factory) is classified correctly with zero
 * resolver edits.
 */
export function isBodyBlockNode(node: ProseMirrorNode): boolean {
  const attrs = node.type.spec.attrs
  return attrs != null && "depth" in attrs
}

/**
 * A structural (non-body) node that holds body-block children — e.g.
 * `column`. We descend through such a node to reach its body blocks, but we
 * never emit the structural node itself as a block.
 *
 * Generic by construction: it asks the node TYPE, not the type name and not
 * the current children. The check is intrinsic — "not a body block, but its
 * content expression admits body blocks" — so a column that is transiently
 * EMPTY (mid-normalization-round, before E2 reseeds its paragraph) still
 * classifies as a surface; the old child-scan went blind there, which also
 * made `surfaceAt` misreport an empty column's interior as the ROOT surface.
 *
 * Checked via `contentMatch` against the schema's node types — NOT a
 * substring test of the content string ("block" is a substring of
 * "codeBlock"). Cached per NodeType (schema types are immutable).
 */
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

export function isStructuralBlockContainer(node: ProseMirrorNode): boolean {
  if (isBodyBlockNode(node)) return false
  return typeAdmitsBodyBlocks(node.type)
}

/**
 * Resolve a body block by its `id`. Returns its surface-relative placement, or
 * `null` when no body block carries that id.
 *
 * Phase 0: searches the root surface only, delegating the id→pos / id→index
 * walks to `topLevelBlocks.ts`.
 */
export function resolveBodyBlockById(
  doc: ProseMirrorNode,
  id: string,
): ResolvedBodyBlock | null {
  // Fast path: the root surface (unchanged Phase-0 walk). Covers root blocks
  // including the `columnLayout` itself.
  const rootPos = topLevelBlockPosById(doc, id)
  if (rootPos !== -1) {
    const indexInSurface = topLevelBlockIndexById(doc, id)
    const node = doc.child(indexInSurface)
    return {
      id,
      pos: rootPos,
      node,
      surfacePos: -1,
      indexInSurface,
      depth: depthOf(node),
    }
  }

  // Nested surfaces: walk every body block; when it has a structural
  // block-bearing layer (e.g. `column`), search that surface for `id`.
  let found: ResolvedBodyBlock | null = null
  walkBodySurfaces(doc, (visit) => {
    if (found) return
    if (visit.node.attrs.id === id) {
      found = {
        id,
        pos: visit.pos,
        node: visit.node,
        surfacePos: visit.surfacePos,
        indexInSurface: visit.indexInSurface,
        depth: depthOf(visit.node),
      }
    }
  })
  return found
}

/** A body block visited by `walkBodySurfaces`, with full surface context. */
interface SurfaceVisit {
  node: ProseMirrorNode
  /** Absolute PM position of the block. */
  pos: number
  /** Index within its surface (0-based, surface-local). */
  indexInSurface: number
  /** Absolute pos of the containing surface node, or `-1` for the root. */
  surfacePos: number
}

/**
 * The single recursive traversal that backs every body-surface resolver.
 *
 * Generic rule (no `columnLayout` / `column` name checks):
 *   1. For each child of a surface, if it is a body block, VISIT it.
 *   2. A visited body block is ALSO recursed into when it contains a
 *      structural block-bearing layer — i.e. its children are structural
 *      nodes (no body-block marker) that themselves hold body blocks. We
 *      step through that structural layer to its body-block children and
 *      visit those (recursing again on each).
 *   3. The structural nodes themselves (e.g. `column`) are never visited.
 *
 * This is the two-level descend the plan pins: visiting `columnLayout` (a
 * body block) AND descending INTO it, through each `column` (structural),
 * to visit the columns' body-block children. A future layout block built
 * the same way works unchanged because the rule keys off the node shape,
 * not the type name.
 *
 * Visits are emitted in strict document order. `surfacePos` for a child is
 * the absolute pos of the structural surface node it lives on; root-surface
 * blocks report `surfacePos === -1`.
 */
function walkBodySurfaces(
  doc: ProseMirrorNode,
  fn: (visit: SurfaceVisit) => void,
): void {
  // Walk one surface's children. `surfaceNode` is the parent whose children
  // are the body blocks; `surfaceStart` is the absolute pos of its first
  // child; `surfacePos` is the parent's own pos (or -1 for the doc root).
  const walkSurface = (
    surfaceNode: ProseMirrorNode,
    surfaceStart: number,
    surfacePos: number,
  ): void => {
    let childOffset = surfaceStart
    surfaceNode.forEach((node, _offset, index) => {
      const pos = childOffset
      childOffset += node.nodeSize
      if (!isBodyBlockNode(node)) return
      fn({ node, pos, indexInSurface: index, surfacePos })

      // Descend through any structural block-bearing layer this body block
      // wraps (e.g. each `column` of a `columnLayout`).
      let structuralOffset = pos + 1 // step past the body block's open token
      node.forEach((structural) => {
        const structuralPos = structuralOffset
        structuralOffset += structural.nodeSize
        if (isStructuralBlockContainer(structural)) {
          // The structural node's children are the nested surface's blocks.
          walkSurface(structural, structuralPos + 1, structuralPos)
        }
      })
    })
  }
  walkSurface(doc, 0, -1)
}

/**
 * Visit each body block on its surface, in document order. The root blocks
 * are visited, AND nested body blocks reached through a structural layer
 * (a `columnLayout`'s `column` children). The structural nodes themselves
 * are never emitted; the layout IS (it is a body block). `index` is the
 * block's index within ITS surface (surface-local).
 */
export function forEachBodyBlock(
  doc: ProseMirrorNode,
  fn: (block: {
    node: ProseMirrorNode
    pos: number
    index: number
    /** Absolute pos of the containing structural surface (`-1` ≡ root). */
    surfacePos: number
  }) => void,
): void {
  walkBodySurfaces(doc, ({ node, pos, indexInSurface, surfacePos }) => {
    fn({ node, pos, index: indexInSurface, surfacePos })
  })
}

/**
 * Walk up from `$pos` to the nearest ancestor that is a registered body block,
 * returning it with its surface-relative index, or `null` when there is none
 * (e.g. a position at doc depth 0).
 *
 * "Is a body block" is decided via the `__runeBlockSpec` registry
 * (`getBlockSpecs`), NOT via `depth === 1` — that registry check is the part
 * that survives nesting. A caret inside a `table`'s cell, for instance,
 * resolves to the `table` block (a registered body block) and skips the
 * `tableRow` / `tableCell` wrappers, which are not registered.
 *
 * In a flat doc this is equivalent to `$pos.node(1)` / `$pos.before(1)` /
 * `$pos.index(0)` for a caret inside a paragraph.
 */
export function nearestBodyBlock(
  editor: Editor,
  $pos: ResolvedPos,
): NearestBodyBlock | null {
  const specs = getBlockSpecs(editor)
  for (let depth = $pos.depth; depth >= 1; depth--) {
    const node = $pos.node(depth)
    if (node.type.name in specs) {
      return {
        node,
        pos: $pos.before(depth),
        indexInSurface: $pos.index(depth - 1),
      }
    }
  }
  return null
}

/**
 * The body blocks a `[from, to)` boundary range overlaps. This is the
 * `MultiBlockSelection` branch of `collectTargets` (indent/outdent), extracted:
 * a block is included when its span `[offset, offset + nodeSize)` overlaps the
 * range — i.e. `offsetEnd > from` and `offset < to`. Blocks without an `id` are
 * skipped (they cannot be a command target).
 *
 * Phase 0: iterates the root surface only.
 */
export function bodyBlocksInRange(
  doc: ProseMirrorNode,
  from: number,
  to: number,
): BodyBlockInRange[] {
  // Single-surface contract: the endpoints must share a parent surface.
  // Resolve both and require the same surface node (same pos). A cross-
  // surface range (e.g. root → inside a column) returns empty.
  const fromSurface = surfaceAt(doc, from)
  const toSurface = surfaceAt(doc, to)
  if (!fromSurface || !toSurface) return []
  if (fromSurface.pos !== toSurface.pos) return []

  const out: BodyBlockInRange[] = []
  let offset = fromSurface.start
  fromSurface.node.forEach((node) => {
    const blockPos = offset
    offset += node.nodeSize
    const offsetEnd = blockPos + node.nodeSize
    if (offsetEnd <= from) return
    if (blockPos >= to) return
    const id = node.attrs.id as string | undefined
    if (id) out.push({ id, pos: blockPos, node })
  })
  return out
}

/**
 * The body block whose CONTENT a boundary/caret position sits inside, resolved
 * on its own surface. For a root caret this is the root block; for an in-column
 * caret it is the COLUMN CHILD (NOT the whole `columnLayout`). Returns the
 * surface-local index, the absolute text-content bounds `[from, to)`, and the
 * containing surface so callers can build a surface-local `MultiBlockSelection`.
 *
 * `topLevelBlockTextBoundsAtPos` (root-only) reports the whole layout's bounds
 * for an in-column caret — this is the surface-aware replacement keymap stage-1
 * / Escape use to scope to the column child.
 */
export interface SurfaceBlockTextBounds {
  /** The body block node containing `pos` (e.g. the column child paragraph). */
  node: ProseMirrorNode
  /** The block's index among its surface's children (surface-local). */
  indexInSurface: number
  /** Absolute start of the block's text content. */
  from: number
  /** Absolute end of the block's text content. */
  to: number
  /** The surface the block lives on (`pos === -1` ≡ root). */
  surface: ResolvedSurface
}

export function surfaceBlockTextBoundsAtPos(
  doc: ProseMirrorNode,
  pos: number,
): SurfaceBlockTextBounds | null {
  const surface = surfaceAt(doc, pos)
  if (!surface) return null
  let offset = surface.start
  let index = 0
  let found: SurfaceBlockTextBounds | null = null
  surface.node.forEach((node) => {
    if (found) return
    const blockStart = offset
    offset += node.nodeSize
    const from = blockStart + 1
    const to = from + node.content.size
    if (pos >= from && pos <= to) {
      found = { node, indexInSurface: index, from, to, surface }
    }
    index += 1
  })
  return found
}

/** A resolved body-block surface: its node, content-start, and own pos. */
export interface ResolvedSurface {
  /** The surface node whose direct children are body blocks. */
  node: ProseMirrorNode
  /** Absolute pos of the surface's first child. */
  start: number
  /** The surface node's own pos, or `-1` for the doc root. */
  pos: number
}

/**
 * The body-block surface a boundary position sits on: the doc root, or a
 * structural block-bearing node (a `column`). Returns the surface node, the
 * absolute pos of its first child, and the surface's own pos (`-1` for the
 * doc root) so two positions can be compared for "same surface".
 *
 * A boundary pos resolves to a parent whose direct children are body blocks.
 * For the root that parent is the doc. For a column child it is the `column`.
 *
 * Exported as the surface basis for `normalizeDepthAt`'s predecessor scan and
 * the indent/outdent follow-prev cap, so depth math is computed against the
 * block's own surface (column-local), never the root.
 */
export function surfaceChildrenAt(
  doc: ProseMirrorNode,
  pos: number,
): ResolvedSurface | null {
  return surfaceAt(doc, pos)
}

/**
 * The children of `range.from`'s surface whose START pos falls in
 * `[from, to)`, in order — the shared surface-agnostic walk behind the
 * block-drag gesture's run queries and `wrapIntoColumns`' run capture.
 *
 * Start-based membership, deliberately DISTINCT from `bodyBlocksInRange`'s
 * overlap semantics: a boundary range produced by the move/drag machinery
 * covers whole surface children, and a child is "in the run" iff it begins
 * inside the range. Returns `[]` when `from` resolves to no surface.
 */
export function surfaceChildrenInRange(
  doc: ProseMirrorNode,
  range: { from: number; to: number },
): ProseMirrorNode[] {
  const surface = surfaceAt(doc, range.from)
  if (!surface) return []
  const nodes: ProseMirrorNode[] = []
  let off = surface.start
  surface.node.forEach((child) => {
    if (off >= range.from && off < range.to) nodes.push(child)
    off += child.nodeSize
  })
  return nodes
}

/**
 * Resolve a `column` node by its (`col_`-prefixed) id. Read-only, generic:
 * scans the doc for a `column` whose `id` attr matches, returning its position
 * + node, or `null`. The column-target commands (`insertBlocks` /
 * `moveBlocks`) use this to address a column surface by stable id.
 */
export function resolveColumnById(
  doc: ProseMirrorNode,
  columnId: string,
): { pos: number; node: ProseMirrorNode } | null {
  let found: { pos: number; node: ProseMirrorNode } | null = null
  doc.descendants((node, pos) => {
    if (found) return false
    if (node.type.name === "column" && node.attrs.id === columnId) {
      found = { pos, node }
      return false
    }
    return true
  })
  return found
}

function surfaceAt(
  doc: ProseMirrorNode,
  pos: number,
): { node: ProseMirrorNode; start: number; pos: number } | null {
  if (pos < 0 || pos > doc.content.size) return null
  const $pos = doc.resolve(pos)
  // Walk up to the nearest ancestor whose direct children are body blocks.
  // The doc root always qualifies (depth 0). A `column` qualifies too.
  for (let depth = $pos.depth; depth >= 0; depth--) {
    const node = $pos.node(depth)
    if (depth === 0 || isStructuralBlockContainer(node)) {
      return {
        node,
        start: depth === 0 ? 0 : $pos.before(depth) + 1,
        pos: depth === 0 ? -1 : $pos.before(depth),
      }
    }
  }
  return null
}
