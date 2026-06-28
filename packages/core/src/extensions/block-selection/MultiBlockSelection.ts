// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { Slice, Fragment } from "@tiptap/pm/model"
import type { Node, ResolvedPos } from "@tiptap/pm/model"
import { Selection } from "@tiptap/pm/state"
import type { Mappable } from "@tiptap/pm/transform"
import { firstSelectableIndex } from "./selectable"

// Custom PM Selection covering a contiguous range of sibling blocks that share
// one parent ("surface"). Positions sit on block boundaries (not inside a
// block). N=1 works too — one selection type for every "some blocks are
// selected" UI.
//
// Anchor/head are absolute PM positions resolving at the SAME depth, both as
// direct-child boundaries of the same parent node. In today's flat schema that
// parent is always the doc and the depth is always 0, so `surface === doc` and
// `$anchor.index($anchor.depth)` reduces to the old top-level index — identical
// behavior by construction. The columns work (Phase 1) will let the shared
// surface be a `column` node instead, with zero changes to the consumers.
export class MultiBlockSelection extends Selection {
  override visible = false

  constructor($anchor: ResolvedPos, $head: ResolvedPos) {
    // Invariant: both boundaries are sibling boundaries of ONE shared parent —
    // i.e. resolved at the same depth (so `surface` is unambiguous). Flat docs
    // satisfy this trivially (both at depth 0). We warn rather than throw to
    // match the file's existing non-throwing style; callers construct via the
    // `create` factory which guarantees it.
    if ($anchor.depth !== $head.depth) {
      // eslint-disable-next-line no-console
      console.warn(
        `MultiBlockSelection: anchor.depth (${$anchor.depth}) !== head.depth (${$head.depth}); ` +
          "boundaries are not siblings of one shared surface",
      )
    }
    super($anchor, $head)
  }

  // The shared parent node both boundaries are direct children of. In a flat
  // doc this is the doc root (depth 0). Re-expressing the index getters against
  // this — rather than `this.$anchor.doc` — is the whole surface generalization.
  // (No `$` prefix: PM convention reserves that for ResolvedPos; this is a Node.)
  get surface(): Node {
    return this.$anchor.node(this.$anchor.depth)
  }

  /** Index of the surface child whose boundary `pos` sits on (within the surface). */
  private indexAtBoundary(pos: number): number {
    return this.$anchor.doc.resolve(pos).index(this.$anchor.depth)
  }

  // anchorBlockIndex / headBlockIndex are indices into the surface's children
  // (0..N-1). Anchor index is the *block* the anchor sits immediately before OR
  // immediately after, whichever direction the caller intends.
  //   isForward = head >= anchor => anchor sits just BEFORE block[anchorIdx],
  //                                  head sits just AFTER  block[headIdx].
  //   isForward = false        => anchor sits just AFTER  block[anchorIdx],
  //                                  head sits just BEFORE block[headIdx].
  // Either way, the covered range is [min(anchorIdx, headIdx) .. max(...)].
  //
  // `surface` defaults to the doc root (`$pos.depth === 0`), reproducing the
  // historical top-level behavior; callers pass no surface today. A non-root
  // surface (a resolved position whose node is the shared parent) lets the same
  // factory build a sibling-range selection inside e.g. a column.
  static create(
    doc: Node,
    anchorBlockIndex: number,
    headBlockIndex: number,
    surface?: ResolvedPos,
  ): MultiBlockSelection {
    // Base offset + parent node of the surface. For the root surface this is
    // `0` and `doc`, so `beforeLo`/`afterHi` match the old top-level positions.
    const parent = surface ? surface.parent : doc
    const surfaceStart = surface ? surface.start() : 0

    // SINGLE enforcement point for `selectable: false`. The leading run of
    // non-selectable blocks on this surface (the in-document title is index 0 on
    // the root surface) is never block-selectable, so clamp BOTH boundaries past
    // it — no MBS built here can cover it. Every MBS originates in this factory
    // (Escape, drag-extend, marquee, setBlockSelection, arrow movement, …), so
    // doing it here closes the contract for all of them, present and future,
    // rather than at each call site (which is how the title slipped into the
    // Escape and drag-extend paths). No-op when the surface has no leading
    // non-selectable block (every `column` surface; a title-less doc) — so the
    // columns path and historical behavior are unchanged. Skipped when the
    // surface has NO selectable block at all (a transient title-only doc, which
    // normalizeTitle does not let persist) so we never clamp past the last index.
    const minSelectable = firstSelectableIndex(parent)
    if (minSelectable > 0 && minSelectable <= parent.childCount - 1) {
      anchorBlockIndex = Math.max(minSelectable, anchorBlockIndex)
      headBlockIndex = Math.max(minSelectable, headBlockIndex)
    }

    const forward = headBlockIndex >= anchorBlockIndex
    const loIdx = Math.min(anchorBlockIndex, headBlockIndex)
    const hiIdx = Math.max(anchorBlockIndex, headBlockIndex)

    let beforeLo = surfaceStart
    for (let i = 0; i < loIdx; i++) beforeLo += parent.child(i).nodeSize
    let afterHi = surfaceStart
    for (let i = 0; i <= hiIdx; i++) afterHi += parent.child(i).nodeSize

    const $anchor = doc.resolve(forward ? beforeLo : afterHi)
    const $head = doc.resolve(forward ? afterHi : beforeLo)
    return new MultiBlockSelection($anchor, $head)
  }

  get blockIndices(): [number, number] {
    const fromIdx = this.indexAtBoundary(this.from)
    const toIdx = this.indexAtBoundary(this.to) - 1 // `to` is after last block
    return [fromIdx, toIdx]
  }

  get blockNodes(): readonly Node[] {
    const [lo, hi] = this.blockIndices
    const surface = this.surface
    const nodes: Node[] = []
    for (let i = lo; i <= hi; i++) {
      nodes.push(surface.child(i))
    }
    return nodes
  }

  get isForward(): boolean {
    return this.head >= this.anchor
  }

  // Absolute position at the END of the FIRST selected block's text content, on
  // the MBS's OWN surface (root or a column). The canonical place to drop a
  // caret when collapsing an MBS back to text — used by both the Enter key
  // (keymap) and the public `clearBlockSelection` command, so the surface-local
  // math lives once on the type that owns the concept (a root-index walk landed
  // the caret on the wrong block for a column-local MBS).
  get firstBlockTextEnd(): number {
    const surface = this.surface
    const [lo] = this.blockIndices
    const surfaceStart =
      surface === this.$anchor.doc ? 0 : this.$anchor.start(this.$anchor.depth)
    let blockStart = surfaceStart
    for (let i = 0; i < lo; i++) blockStart += surface.child(i).nodeSize
    return blockStart + 1 + surface.child(lo).content.size
  }

  // Whether a point hit — resolved on its OWN surface as (surfacePos,
  // indexInSurface), with `surfacePos === -1` ≡ root — lands on a block this
  // selection covers. THE single MBS-cover comparison shared by the three
  // pairwise gesture yields (drag-extend mousedown · marquee mousedown ·
  // block-drag padding mousedown), which must stay in lockstep:
  //   - hit on the SELECTION'S OWN surface → direct index compare;
  //   - ROOT selection + in-column hit → the column's enclosing root block
  //     (the layout) is the covered candidate;
  //   - any other surface mismatch → not covered. A column-local selection
  //     never covers a root hit (its indices are column-local — comparing them
  //     against root indices is the false-match bug this guards), and never a
  //     hit in a DIFFERENT column (no cross-surface cover).
  coversSurfaceBlock(surfacePos: number, indexInSurface: number): boolean {
    const doc = this.$anchor.doc
    const selSurfacePos =
      this.$anchor.depth === 0 ? -1 : this.$anchor.before(this.$anchor.depth)
    let idxOnSelSurface: number | null
    if (selSurfacePos === surfacePos) {
      idxOnSelSurface = indexInSurface
    } else if (selSurfacePos === -1 && surfacePos !== -1) {
      idxOnSelSurface = doc.resolve(surfacePos).index(0)
    } else {
      idxOnSelSurface = null
    }
    if (idxOnSelSurface == null) return false
    const [lo, hi] = this.blockIndices
    return idxOnSelSurface >= lo && idxOnSelSurface <= hi
  }

  eq(other: Selection): boolean {
    if (!(other instanceof MultiBlockSelection)) return false
    return this.anchor === other.anchor && this.head === other.head
  }

  map(doc: Node, mapping: Mappable): Selection {
    const anchorResult = mapping.mapResult(this.anchor)
    const headResult = mapping.mapResult(this.head)
    if (anchorResult.deleted || headResult.deleted) {
      // One boundary was inside a deleted range — collapse to a text selection.
      const survivingPos = anchorResult.deleted ? headResult.pos : anchorResult.pos
      return Selection.near(doc.resolve(survivingPos))
    }
    return new MultiBlockSelection(doc.resolve(anchorResult.pos), doc.resolve(headResult.pos))
  }

  override content(): Slice {
    return new Slice(Fragment.from(this.blockNodes as Node[]), 0, 0)
  }

  override getBookmark(): MultiBlockBookmark {
    return new MultiBlockBookmark(this.anchor, this.head, false, false)
  }

  override toJSON(): { type: "multi-block"; anchor: number; head: number } {
    return { type: "multi-block", anchor: this.anchor, head: this.head }
  }

  // replace / replaceWith use PM Selection defaults (they work against
  // this.from/this.to, which sit at block boundaries). That keeps the M2
  // paste code path a straight dispatch of tr.replaceRangeWith(...) at
  // selection.from..selection.to, no custom override needed here.

  static override fromJSON(doc: Node, json: { type: "multi-block"; anchor: number; head: number }): MultiBlockSelection {
    return new MultiBlockSelection(doc.resolve(json.anchor), doc.resolve(json.head))
  }
}

class MultiBlockBookmark {
  constructor(
    private readonly anchor: number,
    private readonly head: number,
    // Each tracks whether a prior `map` call observed that boundary inside a
    // deleted range. Kept per-side so `resolve` can collapse near the
    // surviving boundary — mirroring `MultiBlockSelection.map`, which picks
    // `headResult.pos` when only the anchor was deleted and vice versa.
    private readonly anchorDeleted: boolean,
    private readonly headDeleted: boolean,
  ) {}

  map(mapping: Mappable): MultiBlockBookmark {
    const anchorResult = mapping.mapResult(this.anchor)
    const headResult = mapping.mapResult(this.head)
    return new MultiBlockBookmark(
      anchorResult.pos,
      headResult.pos,
      this.anchorDeleted || anchorResult.deleted,
      this.headDeleted || headResult.deleted,
    )
  }

  resolve(doc: Node): Selection {
    const $anchor = doc.resolve(Math.min(this.anchor, doc.content.size))
    const $head = doc.resolve(Math.min(this.head, doc.content.size))
    // Conservative fallback: if either boundary was deleted during mapping,
    // OR the two boundaries no longer resolve to sibling boundaries of the
    // SAME parent surface (same depth AND same parent node), don't resurrect
    // an MBS over whatever incidentally survived. Collapse near the surviving
    // boundary — same shape as `MultiBlockSelection.map`'s deleted branch.
    // In a flat doc both boundaries resolve at depth 0 with `parent === doc`,
    // so this reduces to the historical `depth !== 0` guard.
    const sameSurface =
      $anchor.depth === $head.depth && $anchor.node($anchor.depth) === $head.node($head.depth)
    if (this.anchorDeleted || this.headDeleted || !sameSurface) {
      // When only one boundary was inside a deleted range, collapse near
      // the surviving one — mirrors `MultiBlockSelection.map`'s pick. For
      // the depth-only fallback (mapping landed off-boundary without a
      // tracked deletion) and the both-deleted case, default to $head to
      // preserve the existing behavior.
      const $surviving = !this.anchorDeleted && this.headDeleted ? $anchor : $head
      return Selection.near($surviving)
    }
    return new MultiBlockSelection($anchor, $head)
  }
}

Selection.jsonID("multi-block", MultiBlockSelection)
