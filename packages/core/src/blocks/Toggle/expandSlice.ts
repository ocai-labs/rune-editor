// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// packages/core/src/blocks/Toggle/expandSlice.ts
import { Slice, Fragment } from "@tiptap/pm/model"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import { toggleBodyRange, togglePosById } from "./range"

/**
 * Walk `slice.content` and, for each collapsed toggle, splice its
 * hidden body from the source doc immediately after it. Recursively
 * applies — a collapsed toggle inside a body's run is also expanded.
 *
 * Toggle identity is matched by `attrs.id`. BlockId guarantees ids on
 * every block at the time the user copies (it fills on every doc
 * change). Toggles created in the slice itself with null ids — which
 * shouldn't happen at copy time but is theoretically possible for
 * synthetic slices — are skipped (no expansion).
 *
 * Returns a fresh Slice with `openStart`/`openEnd` both zero. Selections
 * that produce a non-zero open boundary (rare for block-level MBS copy
 * but possible for partial text inside a toggle title) preserve the
 * original openStart; we never widen openEnd because all appended
 * children are full nodes.
 */
export function expandCollapsedToggles(
  slice: Slice,
  doc: ProseMirrorNode,
): Slice {
  if (slice.content.childCount === 0) return slice

  const expanded = expandFragment(slice.content, doc, new Set())
  if (expanded === slice.content) return slice
  return new Slice(expanded, slice.openStart, 0)
}

function expandFragment(
  frag: Fragment,
  doc: ProseMirrorNode,
  expandedIds: Set<string>,
): Fragment {
  // Collect the ids of all nodes already in this fragment so we never
  // duplicate a body block that was already included in the selection.
  const presentIds = new Set<string>()
  frag.forEach((child) => {
    const id = child.attrs?.id
    if (typeof id === "string" && id) presentIds.add(id)
  })

  const out: ProseMirrorNode[] = []
  let changed = false
  frag.forEach((child) => {
    out.push(child)
    if (child.type.name === "toggle" && child.attrs.expanded === false) {
      const id = child.attrs.id
      if (typeof id !== "string" || !id) return
      // Skip ids we've already expanded to prevent infinite recursion
      // when the same collapsed toggle node is encountered again.
      if (expandedIds.has(id)) return
      // Resolve the toggle on ANY surface (root OR inside a `column`), not just
      // the root — a collapsed toggle living in a column must still pull in its
      // hidden body. The old root-only `doc.forEach` returned nothing for an
      // in-column toggle, silently dropping the body on copy.
      const togglePos = togglePosById(doc, id)
      if (togglePos === -1) return
      const body = toggleBodyRange(doc, togglePos)
      if (body.isEmpty) return
      // The body blocks are the toggle's own siblings, so their parent is the
      // toggle's surface (its parent node). For a root toggle this is `doc`, so
      // the guard below is byte-identical to the old `parent !== doc`.
      const surface = doc.resolve(togglePos).parent
      expandedIds.add(id)
      doc.nodesBetween(body.from, body.to, (n, _p, parent) => {
        // Descend through plugin-provided structural layers to reach the
        // toggle's surface, but collect only that surface's own children.
        if (parent !== surface) return
        // Skip body nodes already present in the slice to avoid duplicates
        // when the selection already covers the hidden body blocks.
        const nId = n.attrs?.id
        if (typeof nId === "string" && nId && presentIds.has(nId)) return false
        out.push(n)
        changed = true
        return false
      })
    }
  })
  if (!changed) return frag
  // Recursively expand any collapsed toggles we just spliced in (they
  // may themselves have collapsed-toggle children in the doc). Pass the
  // same expandedIds set so already-processed toggles aren't re-expanded.
  const fragment = Fragment.fromArray(out)
  return expandFragment(fragment, doc, expandedIds)
}
