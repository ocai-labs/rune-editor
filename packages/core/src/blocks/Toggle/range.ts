// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { Node as ProseMirrorNode, ResolvedPos } from "@tiptap/pm/model"

/**
 * The depth at which the caret's containing BODY BLOCK sits. Body blocks are
 * textblocks (paragraph, heading, toggle title, …) that hold the caret
 * directly, so this is simply `$from.depth`. Named for intent: the toggle
 * keyboard branches operate on "the block the caret is in", at root depth 1
 * OR depth 3 inside a `column` — never hardcoded to 1.
 *
 * Pure node-tree math (`handleKeyDown(view)` has no editor — pitfall 2).
 */
export function caretBlockDepth($from: ResolvedPos): number {
  return $from.depth
}

/**
 * The absolute "before" position of the caret's containing body block, on its
 * OWN surface. Surface-local replacement for the root-only `$from.before(1)`.
 */
export function caretBlockBefore($from: ResolvedPos): number {
  return $from.before(caretBlockDepth($from))
}

/**
 * Start position (just inside) of the body block immediately preceding the
 * caret's block ON THE SAME SURFACE — the surface-local analog of
 * `topLevelBlockStartPos(doc, index-1) `. Returns `-1` when the caret's block
 * is the first child of its surface (no preceding sibling to land on).
 *
 * The surface is the caret block's parent (`$from.node(blockDepth-1)`); the
 * block's index on that surface is `$from.index(blockDepth-1)`. Walking back
 * one sibling, its "before" pos is `caretBlockBefore - prevSibling.nodeSize`,
 * and +1 steps inside it. Pure node-tree math — no editor/registry.
 */
export function surfacePrevBlockStart($from: ResolvedPos): number {
  const blockDepth = caretBlockDepth($from)
  if (blockDepth < 1) return -1
  const surfaceDepth = blockDepth - 1
  const index = $from.index(surfaceDepth)
  if (index <= 0) return -1
  const surface = $from.node(surfaceDepth)
  const prev = surface.child(index - 1)
  const blockBefore = $from.before(blockDepth)
  return blockBefore - prev.nodeSize + 1
}

/**
 * Resolve the position range of a toggle's "body" — the run of subsequent
 * sibling blocks ON THE TOGGLE'S OWN SURFACE whose `depth` attribute is
 * strictly greater than the toggle's own depth, terminating at the first
 * sibling whose `depth <= toggle.depth`, or at the surface's boundary (end
 * of the toggle's parent's children).
 *
 * "Surface" is the toggle's parent node. The walk is pure node-tree + depth-attr math
 * (`doc.resolve(togglePos).parent` + `$pos.index()`), NOT a registry/editor
 * lookup, so `handleKeyDown(view)` sites (which have no `editor`) keep
 * working unchanged.
 *
 * `togglePos` must be the position immediately before the toggle node (the
 * "before" position). Throws nothing — callers passing a bogus pos get an
 * empty range back.
 *
 * `from` is always `togglePos + toggle.nodeSize`. `to` is the position after
 * the last body block. `isEmpty` is `to === from`. Because surface-local
 * siblings are contiguous in the document, accumulating their `nodeSize`s
 * onto `from` yields the correct absolute `to`.
 *
 * Behaviour is independent of the toggle's `expanded` attr — this resolves
 * the OWNED range, not the VISIBLE range.
 */
export function toggleBodyRange(
  doc: ProseMirrorNode,
  togglePos: number,
): { from: number; to: number; isEmpty: boolean } {
  const toggle = doc.nodeAt(togglePos)
  if (!toggle || toggle.type.name !== "toggle") {
    return { from: togglePos, to: togglePos, isEmpty: true }
  }
  const parentDepth = (toggle.attrs.depth as number) ?? 0
  const from = togglePos + toggle.nodeSize

  // Resolve the toggle on its surface: its parent node is the surface
  // (`<doc>` at root, a `column` inside a layout), and `$pos.index()` is the
  // toggle's index among the surface's children. Walk forward over the
  // surface-local following siblings only.
  let surface: ProseMirrorNode
  let toggleIndex: number
  try {
    const $pos = doc.resolve(togglePos)
    surface = $pos.parent
    toggleIndex = $pos.index()
  } catch {
    return { from, to: from, isEmpty: true }
  }
  // Guard: the resolved child at this index must be the toggle itself.
  if (surface.maybeChild(toggleIndex) !== toggle) {
    return { from, to: from, isEmpty: true }
  }

  let offset = 0
  for (let i = toggleIndex + 1; i < surface.childCount; i++) {
    const child = surface.child(i)
    const childDepth = (child.attrs.depth as number) ?? 0
    if (childDepth <= parentDepth) break
    offset += child.nodeSize
  }

  const to = from + offset
  return { from, to, isEmpty: from === to }
}

/**
 * Widen a `[from, to)` boundary range so it never splits a toggle from its
 * hidden body. For every `toggle` node `nodesBetween(from, to)` finds inside
 * the ORIGINAL range — gated on `expanded === false` when `collapsedOnly` is
 * true — extend `to` to `max(to, toggleBodyRange(doc, togglePos).to)`.
 *
 * One pass, not a fixed point: `toggleBodyRange` already walks the toggle's
 * ENTIRE owned run (every following sibling whose `depth` > the toggle's own,
 * transitively covering a nested sub-toggle's own hidden body too — the walk
 * only stops at a sibling back at `depth <= parentDepth`). So a single toggle
 * hit yields its full boundary in one call; no need to re-scan the widened
 * span for newly-included toggles.
 *
 * Surface-local by construction, not by special-casing: `nodesBetween` also
 * steps into any structural node (`column`) that lies fully inside the
 * original range, but a toggle reached that way has its whole owned run
 * already bounded by that structural node's own extent — which is already
 * `<= to` — so it can never push `to` past the original range. Only a toggle
 * on the SAME surface as the range, sitting at the range's trailing edge,
 * can actually widen `to`.
 *
 * `from` passes through unchanged — a leaked body is a TRAILING problem
 * (a collapsed toggle's body always follows it), never a leading one.
 */
export function expandRangeOverToggleBodies(
  doc: ProseMirrorNode,
  from: number,
  to: number,
  { collapsedOnly = true }: { collapsedOnly?: boolean } = {},
): { from: number; to: number } {
  let widenedTo = to
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name !== "toggle") return true
    if (collapsedOnly && node.attrs.expanded !== false) return true
    const body = toggleBodyRange(doc, pos)
    if (body.to > widenedTo) widenedTo = body.to
    return true
  })
  return { from, to: widenedTo }
}

/**
 * Find the absolute position of a `toggle` node by its `id` attribute,
 * searching the whole document, including plugin-provided nested surfaces.
 * Returns `-1` when no toggle carries
 * that id.
 *
 * Pure node-tree walk — no editor / registry — so `handleDOMEvents` /
 * `handleKeyDown(view)` sites can resolve a toggle on any surface (pitfall
 * 2). Replaces the root-only `topLevelBlockPosById` for toggle lookups,
 * which silently returned `-1` for a toggle inside a column.
 */
export function togglePosById(doc: ProseMirrorNode, id: string): number {
  let found = -1
  doc.descendants((node, pos) => {
    if (found !== -1) return false
    if (node.type.name === "toggle" && node.attrs.id === id) {
      found = pos
      return false
    }
    return true
  })
  return found
}

export interface CollapsedToggleContainingResult {
  pos: number
  node: ProseMirrorNode
}

/**
 * Find the collapsed toggle (on ANY surface) whose body range contains
 * `pos`. Scans every toggle in the document — root or column-local — and
 * tests `pos` against each one's surface-local body range. The surface
 * locality is handled entirely by `toggleBodyRange`, so this stays a flat
 * descend over toggles.
 */
export function findCollapsedToggleContaining(
  doc: ProseMirrorNode,
  pos: number,
): CollapsedToggleContainingResult | null {
  let found: CollapsedToggleContainingResult | null = null

  doc.descendants((node, nodePos) => {
    if (found) return false
    if (node.type.name === "toggle" && node.attrs.expanded === false) {
      const body = toggleBodyRange(doc, nodePos)
      if (pos >= body.from && pos < body.to) {
        found = { pos: nodePos, node }
        return false
      }
    }
    return true
  })

  return found
}
