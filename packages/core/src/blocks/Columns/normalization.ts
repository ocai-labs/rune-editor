// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { Extension } from "@tiptap/core"
import { Plugin, PluginKey } from "@tiptap/pm/state"
import type { EditorState, Transaction } from "@tiptap/pm/state"
import { Fragment, Slice } from "@tiptap/pm/model"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import { nanoid } from "nanoid"
import {
  computeIdPatches,
  computeAnchoredPositions,
  type StructuralIdConfig,
} from "../../extensions/shared/structural-id"
import { INTERNAL_NORMALIZATION_META } from "../../extensions/internal-meta"
import { normalizeDepthAt } from "../../api/depth"

// Columns document normalization. Single appendTransaction pass shipped
// through columnLayout's `extensions: [...]` array (PinColumnWidths
// template) — ZERO kit.ts special-casing. Mirrors block-id's
// view()+appendTransaction shape so seed content (built via
// EditorState.create, no transaction) is normalized too.
//
// EDITABLE GATE: both the view() seed pass and appendTransaction are gated
// on the editor being editable (view.editable / editor.isEditable) — mirrors
// TitleBoundary's guard (blocks/Title/boundary.ts). A read-only editor must
// display a malformed doc verbatim rather than silently rewriting it on
// mount; a host that persists getDocument() would otherwise capture
// structure the user never wrote. Flipping `editable` back on does NOT
// itself re-run normalization (Tiptap's setEditable/setOptions calls
// view.updateState with the SAME state — no transaction, so
// appendTransaction never fires); normalization resumes on the NEXT
// doc-changing transaction after the flip, same as TitleBoundary.
//
// Task 2 rules (both pure):
//   1. id backfill — every `column` node gets a `col_<nanoid(8)>` id via
//      the shared structural-id helper (second consumer after block-id).
//   2. width clamp — a stored `width` that is non-positive, missing, NaN,
//      or not a number is rewritten to 1. (The render-time guard in
//      nodes.ts backstops the frame before this tr applies.)
//
// Task 3 rules (each pure + unit-tested), folded into the SAME pass:
//   3. no-nesting safety net — a `columnLayout` whose ancestor chain
//      includes a `column` is flattened to its body-block descendants at
//      the column level (the `transformPasted` editorProp below is the
//      first line of defense; this is the catch-all for programmatic
//      paths — setContent / collab — that bypass paste).
//   4. unwrap — a `columnLayout` with fewer than 2 `column` children
//      dissolves: the surviving column's children splice to the layout's
//      ROOT position (depths preserved, then clamped by normalizeDepthAt);
//      zero columns ⇒ the layout is removed entirely.
//   5. E2 — a `column` with zero children gets one empty `paragraph`
//      (depth 0). A column must always hold ≥1 body block — the
//      per-surface analog of deleteBlocks' trailing-paragraph invariant.
//
// RULE ORDERING (load-bearing): no-nesting → unwrap → E2 → id → width.
//   * no-nesting first: flattening a nested layout can turn its parent
//     column into a single-child or empty column; later rules must see
//     the flattened shape.
//   * unwrap before E2: a layout about to dissolve must not first have its
//     soon-to-be-orphaned columns padded with empty paragraphs, and a
//     dissolved layout exposes its surviving column's children directly —
//     no column to E2 anymore.
//   * E2 before id/width: paragraphs inserted into a now-non-empty column
//     never need an id (paragraphs carry block-ids via block-id, not this
//     pass) but the column they sit in still needs its id/width clamp on
//     the SAME tr, so structural shape settles before the markup passes.
//
// POSITION MATH: the structural rules (no-nesting, unwrap, E2) mutate node
// boundaries, so positions captured against `state.doc` go stale. Each
// structural rule therefore recomputes its targets from the CURRENT
// `tr.doc` and applies ONE mutation per iteration, looping until that rule
// finds nothing more — never sharing a stale position across a structural
// step (Phase-0 pitfall 1). The markup passes (id/width) run last and
// re-check the node type at each mapped pos before mutating.
//
// All mutations fold into one transaction tagged INTERNAL_NORMALIZATION_META
// + addToHistory=false, so undo never reveals an un-normalized intermediate
// and consumers can distinguish housekeeping from user edits. The selection
// rides through `tr.mapping` automatically — an MBS spanning a dissolved
// layout collapses via MultiBlockSelection.map's deleted-boundary fallback.

const COLUMN_NORMALIZE_META = "rune/column-normalize"

/**
 * Pure width normalizer. Non-positive, missing, NaN, or non-number → 1;
 * a valid positive number passes through. Exported for unit testing and
 * reuse by Task 3 / resize.
 */
export function normalizeColumnWidth(width: unknown): number {
  return typeof width === "number" && Number.isFinite(width) && width > 0
    ? width
    : 1
}

// Shared-helper config: the `column` node, attr `id`, generator
// col_<nanoid(8)>, plus COLUMN_NORMALIZE_META tagged on the output tr (an
// output signal; looping is prevented by patch-convergence, not this meta).
const ID_CONFIG: StructuralIdConfig = {
  attrName: "id",
  nodePredicate: (node) => node.type.name === "column",
  generateId: () => `col_${nanoid(8)}`,
  extraMeta: [COLUMN_NORMALIZE_META],
}

type WidthPatch = { pos: number; width: number }

/** Pure: collect stored widths that need clamping. */
function computeWidthPatches(doc: ProseMirrorNode): WidthPatch[] {
  const patches: WidthPatch[] = []
  doc.descendants((node, pos) => {
    if (node.type.name !== "column") return true
    const next = normalizeColumnWidth(node.attrs.width)
    if (next !== node.attrs.width) patches.push({ pos, width: next })
    return true
  })
  return patches
}

// --- Task 3 pure rule functions -------------------------------------------

/**
 * Pure (Step 3, no-nesting safety net). Find the FIRST `columnLayout` whose
 * ancestor chain includes a `column` (a nested layout). Returns its position
 * + the layout node, or null when none. We return one at a time because
 * flattening shifts every later position; the caller re-scans the mutated
 * doc. Innermost-first is unnecessary — flattening the outermost-found
 * nested layout splices its children up one level, and re-scanning catches
 * any still-nested layout on the next pass.
 */
export function firstNestedLayout(
  doc: ProseMirrorNode,
): { pos: number; node: ProseMirrorNode } | null {
  let found: { pos: number; node: ProseMirrorNode } | null = null
  doc.descendants((node, pos, parent) => {
    if (found) return false
    // A columnLayout is "nested" when its immediate parent is a `column`.
    // (Layouts at root sit directly under `doc`; the only structural node
    // that can hold body blocks in v1 is `column`, so an immediate-parent
    // check is sufficient and matches the schema we forbid.)
    if (node.type.name === "columnLayout" && parent?.type.name === "column") {
      found = { pos, node }
      return false
    }
    return true
  })
  return found
}

/**
 * Pure (Step 2, unwrap). Find the FIRST `columnLayout` (at any surface) with
 * fewer than 2 `column` children. Returns its position, the layout node, and
 * the surviving column (or null when the layout has zero columns). One at a
 * time — dissolving shifts later positions; caller re-scans.
 */
export function firstLayoutToUnwrap(doc: ProseMirrorNode): {
  pos: number
  node: ProseMirrorNode
  survivor: ProseMirrorNode | null
} | null {
  let found: {
    pos: number
    node: ProseMirrorNode
    survivor: ProseMirrorNode | null
  } | null = null
  doc.descendants((node, pos) => {
    if (found) return false
    if (node.type.name !== "columnLayout") return true
    let columnCount = 0
    let survivor: ProseMirrorNode | null = null
    node.forEach((child) => {
      if (child.type.name === "column") {
        columnCount += 1
        if (!survivor) survivor = child
      }
    })
    if (columnCount < 2) {
      found = { pos, node, survivor: columnCount === 1 ? survivor : null }
    }
    // Don't descend into a layout we're about to dissolve.
    return found ? false : true
  })
  return found
}

/**
 * Pure (Step 1, E2). Find the FIRST `column` with zero children. One at a
 * time — inserting a paragraph shifts later positions; caller re-scans.
 */
export function firstEmptyColumn(
  doc: ProseMirrorNode,
): { pos: number } | null {
  let found: { pos: number } | null = null
  doc.descendants((node, pos) => {
    if (found) return false
    if (node.type.name === "column" && node.childCount === 0) {
      found = { pos }
      return false
    }
    return true
  })
  return found
}

/**
 * Pure (Step 3, paste guard). Recursively flatten any `columnLayout` that
 * sits INSIDE a `column` within `fragment`, replacing it with its body-block
 * descendants. A top-level layout (not inside a column) is left intact —
 * pasting a whole layout at root is legal. Mirrors TableMergedCellsGuard's
 * reject-at-paste intent: malformed nesting is rectified before it lands.
 */
export function flattenNestedLayouts(
  fragment: Fragment,
  insideColumn = false,
): Fragment {
  const out: ProseMirrorNode[] = []
  fragment.forEach((child) => {
    if (insideColumn && child.type.name === "columnLayout") {
      // Flatten: drop the layout + its columns, lift each column's body
      // blocks to this level (recursing in case of deeper nesting).
      child.forEach((column) => {
        if (column.type.name !== "column") return
        const lifted = flattenNestedLayouts(column.content, true)
        lifted.forEach((node) => out.push(node))
      })
      return
    }
    // Descend: a `column` makes its children "inside a column"; any other
    // node clears the flag (a nested layout under root is legal).
    const childInsideColumn = child.type.name === "column"
    const newContent = flattenNestedLayouts(child.content, childInsideColumn)
    out.push(child.copy(newContent))
  })
  return Fragment.fromArray(out)
}

/**
 * Pure helper: collect a column node's body-block children as a flat array.
 * Used by the unwrap rule (splice survivor children to root) and by the move
 * core's F2 emptied-source-column removal, so the "lift a column's children
 * out" operation lives in exactly one place.
 */
export function columnChildren(column: ProseMirrorNode): ProseMirrorNode[] {
  const out: ProseMirrorNode[] = []
  column.forEach((child) => out.push(child))
  return out
}

/**
 * Unwrap a single `columnLayout` node IN PLACE on a passed-in transaction:
 * replace `[layoutPos, layoutPos + layoutNode.nodeSize)` with the surviving
 * column's children (depths preserved), or delete the layout outright when
 * there is no survivor. This is the exact operation normalization's unwrap
 * rule performs; the F2 move core calls it directly for the 2→1 column case
 * (PM's schema fitting refuses to delete a single `column` out of a
 * `column{2,5}` layout — it backfills an empty column to keep minCount — so
 * the move core cannot rely on `tr.delete(column)` then a later normalization
 * pass; it must dissolve at the layout level itself).
 *
 * `survivor` is the column whose children survive (or `null` to remove the
 * layout). Returns the mapping-relevant span that was replaced is implicit on
 * the tr; callers map subsequent positions through `tr.mapping`.
 */
export function unwrapLayoutInTr(
  tr: Transaction,
  layoutPos: number,
  layoutNode: ProseMirrorNode,
  survivor: ProseMirrorNode | null,
): void {
  const from = layoutPos
  const to = layoutPos + layoutNode.nodeSize
  if (survivor) {
    tr.replaceWith(from, to, columnChildren(survivor))
  } else {
    tr.delete(from, to)
  }
}

// --- Single-pass normalization ---------------------------------------------

/**
 * Build the single normalization tr for a state. Returns null when nothing
 * needs fixing. Folds, in order: no-nesting → unwrap → E2 → id → width
 * (rationale in the module header). Each structural rule recomputes from the
 * CURRENT `tr.doc` and loops until stable, so folded position shifts never
 * corrupt a later mutation.
 *
 * `anchorCtx` (present only from appendTransaction, absent for the mount seed)
 * carries the incoming `oldState` + `transactions` so the id pass can anchor
 * a column id to the pre-existing column that carried it — mirroring BlockId
 * (extensions/block-id.ts). Without it, `computeIdPatches` falls back to
 * first-in-doc-order and a copy pasted ABOVE its original steals the
 * original's column id. The mount seed (initial load / setContent) has no
 * meaningful oldState to anchor against, so it passes none — identical to
 * BlockId's view() pass.
 */
function normalizeColumns(
  state: EditorState,
  anchorCtx?: { oldState: EditorState; transactions: readonly Transaction[] },
): Transaction | null {
  const tr = state.tr
  let changed = false
  const schema = state.schema
  const paragraphType = schema.nodes.paragraph

  // (3) no-nesting safety net — flatten nested layouts one at a time.
  for (let guard = 0; guard < 100; guard++) {
    const nested = firstNestedLayout(tr.doc)
    if (!nested) break
    // Replace the layout node with its columns' body-block children.
    const lifted: ProseMirrorNode[] = []
    nested.node.forEach((column) => {
      if (column.type.name !== "column") return
      column.forEach((bodyBlock) => lifted.push(bodyBlock))
    })
    const from = nested.pos
    const to = nested.pos + nested.node.nodeSize
    tr.replaceWith(from, to, lifted)
    changed = true
  }

  // (2) unwrap — dissolve sub-2-column layouts one at a time.
  for (let guard = 0; guard < 100; guard++) {
    const target = firstLayoutToUnwrap(tr.doc)
    if (!target) break
    const node = tr.doc.nodeAt(target.pos)
    if (!node || node.type.name !== "columnLayout") break
    // Splice the surviving column's children to the layout's ROOT position (or
    // remove the layout when there is no survivor). Depths are already
    // surface-local (0-based within the column); root insertion keeps them,
    // then normalizeDepthAt clamps each against its new root predecessor
    // (handled by the depth pass below — but we clamp here so the same tr lands
    // sane depths immediately). Shared with the F2 move core via
    // `unwrapLayoutInTr`.
    unwrapLayoutInTr(tr, target.pos, node, target.survivor)
    changed = true
  }

  // After unwrap, clamp the depths of any block now sitting at root whose
  // stored depth exceeds what its new predecessor allows. We only touch root
  // children (the surface the unwrap splices into); column-internal depth is
  // Task 5's surface-local concern. We pass spec=undefined (follow-prev) for
  // every root block: this plugin has no editor/getBlockSpecs access, and the
  // only blocks that lose their numeric/structural cap this way (columnLayout,
  // CodeBlock, Divider, Table — all maxDepth 0) always store depth 0, where
  // follow-prev yields min(0, cap)=0 — a no-op. Spliced column children are
  // follow-prev/structural, which follow-prev clamps identically.
  if (changed) {
    tr.doc.forEach((rootBlock, offset) => {
      if (rootBlock.attrs.depth === undefined) return
      const current =
        typeof rootBlock.attrs.depth === "number" ? rootBlock.attrs.depth : 0
      const next = normalizeDepthAt(tr.doc, offset, current, undefined)
      if (next !== current) {
        tr.setNodeMarkup(offset, undefined, { ...rootBlock.attrs, depth: next })
      }
    })
  }

  // (1) E2 — give every empty column one empty paragraph.
  if (paragraphType) {
    for (let guard = 0; guard < 100; guard++) {
      const empty = firstEmptyColumn(tr.doc)
      if (!empty) break
      const node = tr.doc.nodeAt(empty.pos)
      if (!node || node.type.name !== "column" || node.childCount !== 0) break
      // Insert at the column's content start (pos + 1).
      tr.insert(empty.pos + 1, paragraphType.create({ depth: 0 }))
      changed = true
    }
  }

  // (id) backfill — recompute against the (possibly mutated) tr.doc. We scan
  // tr.doc directly (not state.apply(tr), which would re-run plugin
  // appendTransactions and risk recursing into this pass). computeIdPatches
  // reads only `.doc`, so a minimal { doc } shim is a faithful reuse of the
  // shared helper without building a full EditorState.
  //
  // Anchoring: survivor columns (present in oldState, carried their id into
  // newState) must keep their id so a colliding copy pasted ABOVE the original
  // is the one regenerated — never the original. computeAnchoredPositions
  // returns positions in `state.doc` (== newState.doc, the doc BEFORE this
  // pass's structural steps). The structural rules above (no-nesting, unwrap,
  // E2) may have shifted node boundaries by adding steps to `tr`, so each
  // anchor must be mapped through `tr.mapping` — which at this point holds
  // EXACTLY those structural steps (the tr starts empty; id/width are the only
  // passes still to run and they haven't mapped yet) — to land in tr.doc
  // coordinates. In the common paste-above case no structural step fires, so
  // tr.mapping is identity and the map is a no-op; the mapping only bites when
  // a malformed paste (e.g. an empty column padded by E2) shifts the survivor.
  // Bias +1 matches computeAnchoredPositions' own bias: it tracks a column
  // past content inserted exactly at its start boundary rather than latching
  // onto the inserted copy.
  let anchored: ReadonlySet<number> | undefined
  if (anchorCtx) {
    const rawAnchors = computeAnchoredPositions(
      anchorCtx.oldState,
      state,
      anchorCtx.transactions,
      ID_CONFIG,
    )
    if (rawAnchors.size) {
      const mapped = new Set<number>()
      for (const pos of rawAnchors) mapped.add(tr.mapping.map(pos, 1))
      anchored = mapped
    }
  }
  const idPatches = computeIdPatches(
    { doc: tr.doc } as EditorState,
    ID_CONFIG,
    anchored,
  )
  for (const { pos, id } of idPatches) {
    const node = tr.doc.nodeAt(pos)
    if (!node || node.type.name !== "column") continue
    if (node.attrs.id === id) continue
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, id })
    changed = true
  }

  // (width) clamp — recompute against the mutated tr.doc.
  const widthPatches = computeWidthPatches(tr.doc)
  for (const { pos, width } of widthPatches) {
    const node = tr.doc.nodeAt(pos)
    if (!node || node.type.name !== "column") continue
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, width })
    changed = true
  }

  if (!changed || !tr.docChanged) return null

  tr.setMeta(COLUMN_NORMALIZE_META, true)
  tr.setMeta(INTERNAL_NORMALIZATION_META, true)
  tr.setMeta("addToHistory", false)
  return tr
}

/**
 * Flatten any `columnLayout` nested inside a `column` within a pasted slice.
 * First line of defense for the no-nesting rule (the appendTransaction safety
 * net above catches non-paste paths). Pure transform on the slice content.
 */
function transformPastedSlice(slice: Slice): Slice {
  const flattened = flattenNestedLayouts(slice.content, false)
  if (flattened.eq(slice.content)) return slice
  return new Slice(flattened, slice.openStart, slice.openEnd)
}

export const ColumnsNormalization = Extension.create({
  name: "columnsNormalization",

  addProseMirrorPlugins() {
    const editor = this.editor
    return [
      new Plugin({
        key: new PluginKey("rune-columns-normalization"),
        props: {
          // No-nesting, line 1: rectify a pasted slice that carries a
          // columnLayout INSIDE a column before PM inserts it. The
          // appendTransaction below is the catch-all for programmatic paths.
          transformPasted: (slice) => transformPastedSlice(slice),
        },
        // Seed-content pass (no transaction fires appendTransaction).
        view: (view) => {
          // A read-only editor must not author structure. Skip the mount seed
          // (otherwise displaying a malformed / legacy / hand-authored doc —
          // a 1-column layout, a nested layout, an empty column, a missing
          // col id/width — read-only would silently rewrite it, and a host
          // that later persists getDocument() would capture the injected
          // structure). Mirrors TitleBoundary's guard (boundary.ts). Once the
          // editor becomes editable, this pass no longer applies (view()
          // fires once, at mount) — the appendTransaction guard below picks
          // normalization back up on the next doc-changing transaction.
          if (view.editable) {
            const tr = normalizeColumns(view.state)
            if (tr) view.dispatch(tr)
          }
          return {}
        },
        appendTransaction: (transactions, oldState, newState) => {
          if (!editor.isEditable) return null
          const docChanged = transactions.some((tr) => tr.docChanged)
          if (!docChanged) return null
          return normalizeColumns(newState, { oldState, transactions })
        },
      }),
    ]
  },
})

/** @internal */
export const __internals = {
  normalizeColumns,
  computeWidthPatches,
  firstNestedLayout,
  firstLayoutToUnwrap,
  firstEmptyColumn,
  flattenNestedLayouts,
}
