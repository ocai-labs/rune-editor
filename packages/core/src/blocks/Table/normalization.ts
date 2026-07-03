// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { Extension } from "@tiptap/core"
import { Plugin, PluginKey } from "@tiptap/pm/state"
import type { EditorState, Transaction } from "@tiptap/pm/state"
import type { Node as ProseMirrorNode, Schema } from "@tiptap/pm/model"
import { INTERNAL_NORMALIZATION_META } from "../../extensions/internal-meta"

// In-cell line-break canonicalization. `tableParagraph` (content `inline*`)
// CAN legally hold a `hardBreak` — the schema doesn't forbid it — but the
// canonical on-disk shape for a multi-line cell is STACKED tableParagraph
// siblings, one per line, matching how `serializeTableMarkdown`
// (blocks/Table/markdown.ts) represents a multi-line cell on export
// (`parts.join("<br>")` across sibling tableParagraphs, one `<br>` per
// paragraph boundary — see api/export/serializeInline.ts for the symmetric
// hardBreak→"<br>" case, now also handled). A `hardBreak` left EMBEDDED
// inside a single tableParagraph is a second, non-canonical way to spell
// the same "line break in this cell" fact, reachable via:
//   - live typing, until TableCommands' Shift-Enter/Mod-Enter override
//     (which always splits instead) short-circuits it — but the shortcut
//     doesn't stop a hardBreak from arriving some OTHER way;
//   - paste (a `<br>` mid-cell that the clipboard pipeline doesn't split);
//   - programmatic `setContent` / AI `insert_blocks` / `apply_edits` /
//     collab sync — none of which route through the paste pipeline or the
//     keyboard shortcut at all.
// This appendTransaction pass is the safety net for all of those: split
// every hardBreak-bearing tableParagraph into N sibling tableParagraphs
// (one per `<br>`-delimited run, preserving marks — the split is a pure
// Fragment partition, no mark data is touched), so the doc always
// converges on the same canonical shape the export layer expects,
// regardless of how the hardBreak got there.
//
// EDITABLE GATE: both the view() seed pass and appendTransaction are gated
// on the editor being editable (view.editable / editor.isEditable) —
// mirrors ColumnsNormalization's guard (blocks/Columns/normalization.ts),
// which itself mirrors TitleBoundary (blocks/Title/boundary.ts). A
// read-only editor must display a doc verbatim rather than silently
// rewriting it on mount. Flipping `editable` back on does NOT itself
// re-run normalization (Tiptap's setEditable/setOptions calls
// view.updateState with the SAME state — no transaction, so
// appendTransaction never fires); normalization resumes on the NEXT
// doc-changing transaction after the flip, same as ColumnsNormalization.
//
// TRANSACTION SHAPE mirrors TableMergedCellsGuard (blocks/Table/
// TableMergedCellsGuard.ts): a single `doc.descendants` scan collects
// patches, applied to ONE `state.tr`, tagged `addToHistory: false` +
// INTERNAL_NORMALIZATION_META so undo never reveals an un-normalized
// intermediate and consumers can distinguish housekeeping from user
// edits. Unlike ColumnsNormalization's structural rules (which can cascade
// — flattening a nested layout can produce a new empty column, etc.),
// splitting a tableParagraph never creates or removes ANOTHER
// hardBreak-bearing tableParagraph, so ONE scan + one tr converges in a
// single pass — no find-first/loop-until-stable needed. Patches are
// collected against `state.doc` and applied RIGHT-TO-LEFT (highest
// position first): each `tr.replaceWith` only shifts positions AFTER it,
// so processing later patches first means every earlier patch's captured
// position is still valid when its turn comes — no `tr.mapping` bookkeeping
// needed for the patches themselves. The selection rides through
// `tr.mapping` automatically (PM's `Transaction` re-resolves the current
// selection against every step by default), same as ColumnsNormalization.

const TABLE_CELL_NORMALIZE_META = "rune/table-cell-normalize"

interface CellSplitPatch {
  pos: number
  nodeSize: number
  replacement: ProseMirrorNode[]
}

/**
 * Pure: split a single `tableParagraph` node's content into sibling
 * `tableParagraph` nodes at every `hardBreak`, dropping the hardBreaks
 * themselves. Returns `null` when the node carries no hardBreak (the
 * overwhelmingly common case — no-op, no allocation). A run of children
 * between two hardBreaks (or at either edge) that is empty produces an
 * EMPTY tableParagraph — the canonical shape for a genuinely blank line,
 * matching `cellPara("")` in the round-trip fixtures.
 */
export function splitTableParagraphAtHardBreaks(
  schema: Schema,
  node: ProseMirrorNode,
): ProseMirrorNode[] | null {
  let hasHardBreak = false
  node.forEach((child) => {
    if (child.type.name === "hardBreak") hasHardBreak = true
  })
  if (!hasHardBreak) return null

  const paragraphType = schema.nodes.tableParagraph
  if (!paragraphType) return null

  const groups: ProseMirrorNode[][] = [[]]
  node.forEach((child) => {
    if (child.type.name === "hardBreak") groups.push([])
    else groups[groups.length - 1]!.push(child)
  })
  return groups.map((group) => paragraphType.create(null, group))
}

/** Pure: collect a split patch for every hardBreak-bearing `tableParagraph`
 * in `doc`, in document order. */
export function computeCellSplitPatches(doc: ProseMirrorNode): CellSplitPatch[] {
  const schema = doc.type.schema
  const patches: CellSplitPatch[] = []
  doc.descendants((node, pos) => {
    if (node.type.name !== "tableParagraph") return true
    const replacement = splitTableParagraphAtHardBreaks(schema, node)
    if (replacement) patches.push({ pos, nodeSize: node.nodeSize, replacement })
    // tableParagraph's content is inline* — nothing block-level to
    // recurse into, and no nested tableParagraph is schema-reachable.
    return false
  })
  return patches
}

/**
 * Build the single normalization tr for a state. Returns `null` when no
 * cell needs splitting.
 */
function normalizeTableCells(state: EditorState): Transaction | null {
  const patches = computeCellSplitPatches(state.doc)
  if (patches.length === 0) return null

  const tr = state.tr
  // Right-to-left: each replacement only shifts positions AFTER it, so
  // processing the highest position first keeps every earlier patch's
  // captured position valid.
  for (let i = patches.length - 1; i >= 0; i--) {
    const { pos, nodeSize, replacement } = patches[i]!
    tr.replaceWith(pos, pos + nodeSize, replacement)
  }

  tr.setMeta(TABLE_CELL_NORMALIZE_META, true)
  tr.setMeta(INTERNAL_NORMALIZATION_META, true)
  tr.setMeta("addToHistory", false)
  return tr
}

export const TableCellNormalization = Extension.create({
  name: "tableCellNormalization",

  addProseMirrorPlugins() {
    const editor = this.editor
    return [
      new Plugin({
        key: new PluginKey("rune-table-cell-normalization"),
        // Seed-content pass (no transaction fires appendTransaction).
        view: (view) => {
          // A read-only editor must not author structure. Skip the mount
          // seed (otherwise displaying a doc with an embedded in-cell
          // hardBreak read-only would silently rewrite it — a host that
          // later persists getDocument() would capture the injected
          // structure). Mirrors ColumnsNormalization's guard. Once the
          // editor becomes editable, this pass no longer applies (view()
          // fires once, at mount) — the appendTransaction guard below
          // picks normalization back up on the next doc-changing
          // transaction.
          if (view.editable) {
            const tr = normalizeTableCells(view.state)
            if (tr) view.dispatch(tr)
          }
          return {}
        },
        appendTransaction: (transactions, _oldState, newState) => {
          if (!editor.isEditable) return null
          const docChanged = transactions.some((tr) => tr.docChanged)
          if (!docChanged) return null
          return normalizeTableCells(newState)
        },
      }),
    ]
  },
})

/** @internal */
export const __internals = {
  normalizeTableCells,
  splitTableParagraphAtHardBreaks,
  computeCellSplitPatches,
}
