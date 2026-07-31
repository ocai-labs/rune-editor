// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { EditorState, Transaction } from "@tiptap/pm/state"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import { Mapping } from "@tiptap/pm/transform"
import { INTERNAL_NORMALIZATION_META } from "../internal-meta"

// Shared structural-id backfill, extracted from extensions/block-id.ts so
// multiple consumers can fill an id-style attribute on the nodes they own
// without each re-implementing the scan / collision / transaction dance.
//
// The logic is identical to block-id's original `computeIdPatches` /
// `buildBackfillTransaction`, lifted out and parameterized by:
//
//   - `attrName`      — which attr holds the id.
//   - `nodePredicate` — which nodes to scan/patch.
//   - `generateId`    — id factory.
//   - `extraMeta`     — optional extra meta keys to set true on the tr, each
//                       consumer's own tag. These are an output signal for
//                       any meta-aware consumer; they are NOT what stops the
//                       appendTransaction from looping. INTERNAL_NORMALIZATION_META
//                       + addToHistory=false are ALWAYS set.
//
// Loop termination is by convergence, not by a meta guard: once every matching
// node has a unique id, `computeIdPatches` returns [] and `buildBackfillTransaction`
// returns null, so no further tr is dispatched.
//
// Collision handling: a matching node whose id is null OR collides with an
// already-seen id of the same attr gets a freshly generated id. When the
// caller supplies `anchoredPositions` (nodes that carried their id in the old
// doc), those survivors keep their id and a colliding NEWLY inserted copy is
// the one regenerated — so pasting a copy ABOVE its original no longer steals
// the original's id. Without anchors, first-in-doc-order keeps the id. This is
// what catches duplicate-block (Cmd-D) and cross-document paste.

export interface StructuralIdConfig {
  attrName: string
  nodePredicate: (node: ProseMirrorNode) => boolean
  generateId: () => string
  /** Extra meta keys set `true` on the backfill tr (each consumer's own tag). */
  extraMeta?: readonly string[]
}

export type StructuralIdPatch = { pos: number; id: string }

export function computeIdPatches(
  state: EditorState,
  config: StructuralIdConfig,
  anchoredPositions?: ReadonlySet<number>,
): StructuralIdPatch[] {
  const { attrName, nodePredicate, generateId } = config
  const seen = new Set<string>()
  const claimed = new Set<number>()
  const patches: StructuralIdPatch[] = []

  // Pass 1 (only when survivor anchors are supplied): let each node that
  // carried its id in the OLD doc claim that id BEFORE doc-order assignment,
  // so a colliding freshly-inserted copy — not the pre-existing block — is
  // the one regenerated. First anchored occurrence per id wins (guards a
  // degenerate old doc that itself held a duplicate).
  if (anchoredPositions && anchoredPositions.size) {
    state.doc.descendants((node, pos) => {
      if (!nodePredicate(node)) return true
      if (!anchoredPositions.has(pos)) return true
      const id = node.attrs[attrName] as string | null
      if (id && !seen.has(id)) {
        seen.add(id)
        claimed.add(pos)
      }
      return true
    })
  }

  // Pass 2: doc-order assignment. A claimed survivor keeps its id untouched;
  // every other node with a null or already-seen id is regenerated. With no
  // anchors this is identical to the original single-pass behavior.
  state.doc.descendants((node, pos) => {
    if (!nodePredicate(node)) return true
    if (claimed.has(pos)) return true
    const existing = node.attrs[attrName] as string | null
    if (existing && !seen.has(existing)) {
      seen.add(existing)
      return true
    }
    // null OR collision → assign a fresh id
    const id = generateId()
    seen.add(id)
    patches.push({ pos, id })
    return true
  })

  return patches
}

/**
 * Positions in `newState.doc` that carry an id inherited from a node already
 * present in `oldState.doc` — the "survivors." A duplicate id must be
 * regenerated on the NEWLY inserted copy, never on the survivor. Feed the
 * result to `computeIdPatches` as `anchoredPositions`.
 *
 * Bias +1 when mapping a survivor's start position is required: pasting a copy
 * ABOVE the original inserts content exactly at the survivor's start boundary,
 * and only +1 tracks the node past that insertion instead of latching onto the
 * pasted copy. With no anchors, `computeIdPatches` falls back to
 * first-in-doc-order (correct for initial load / setContent, which have no
 * meaningful oldState to anchor against).
 */
export function computeAnchoredPositions(
  oldState: EditorState,
  newState: EditorState,
  transactions: readonly Transaction[],
  config: Pick<StructuralIdConfig, "attrName" | "nodePredicate">,
): Set<number> {
  const { attrName, nodePredicate } = config
  const mapping = new Mapping()
  for (const tr of transactions) mapping.appendMapping(tr.mapping)
  const anchored = new Set<number>()
  oldState.doc.descendants((node, oldPos) => {
    if (!nodePredicate(node)) return true
    const id = node.attrs[attrName] as string | null
    if (id == null) return true
    const newPos = mapping.map(oldPos, 1)
    const at = newState.doc.nodeAt(newPos)
    if (at && nodePredicate(at) && at.attrs[attrName] === id) anchored.add(newPos)
    return true
  })
  return anchored
}

export function buildBackfillTransaction(
  state: EditorState,
  patches: StructuralIdPatch[],
  config: StructuralIdConfig,
): Transaction | null {
  if (patches.length === 0) return null
  const { attrName, extraMeta } = config
  const tr = state.tr
  let applied = 0
  for (const { pos, id } of patches) {
    const node = tr.doc.nodeAt(pos)
    if (!node) continue
    try {
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, [attrName]: id })
      applied += 1
    } catch {
      // setNodeMarkup RE-CREATES the node and re-validates its content
      // expression. A schema-invalid structured node landed via Node.fromJSON,
      // which does NOT re-fit (setContent / collab), throws RangeError here
      // BEFORE the owning normalization pass can repair it. Skip it: structural
      // normalization fixes the shape in the same appendTransaction round, and
      // the backfill converges on the next. The failed call appends no
      // step, so the tr stays usable for the remaining patches.
      // Probed 2026-06-10: tr.setNodeAttribute (AttrStep) throws the
      // identical RangeError — replace's close() re-validates the joined
      // content — so swapping the step type is NOT an alternative fix.
    }
  }
  if (applied === 0) return null
  for (const key of extraMeta ?? []) tr.setMeta(key, true)
  tr.setMeta(INTERNAL_NORMALIZATION_META, true)
  tr.setMeta("addToHistory", false)
  return tr
}
