// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { Editor } from "@tiptap/core"
import type { Attrs, MarkType, Node as PMNode } from "@tiptap/pm/model"
import type { Transaction } from "@tiptap/pm/state"
import { resolveBodyBlockById } from "../schema/bodySurface"
import {
  runeCommandError,
  runeCommandOk,
  type RuneCommandResult,
} from "./result"

/** One body block resolved to its absolute span (the region marks address). */
interface BlockTextFrame {
  /** Absolute pos of the block node (the position before it). */
  from: number
  /** Absolute pos just after the block node. */
  to: number
  node: PMNode
}

function resolveBlockTextFrame(doc: PMNode, blockId: string): BlockTextFrame | null {
  // Recursive resolution — a column child is addressable by id like a root
  // block (same resolver every other id-addressed core command uses).
  const resolved = resolveBodyBlockById(doc, blockId)
  if (!resolved) return null
  // resolveBodyBlockById already resolved the node alongside its pos — reuse it
  // rather than re-descending the tree with doc.nodeAt(resolved.pos).
  const node = resolved.node
  return { from: resolved.pos, to: resolved.pos + node.nodeSize, node }
}

/**
 * Inverse of `selection.ts`'s private `textOffset`: map a block-local character
 * offset to an absolute PM position inside the block's text. Mirrors the read
 * model EXACTLY — the same `doc.textBetween(contentStart, pos, "\n", "\n")`
 * walk — so a position produced here round-trips with the offsets `get_block` /
 * `get_selection` hand the agent. Returns `null` when `offset` is past the
 * block's text length, so callers reject rather than silently clamp across the
 * block boundary (spec D3).
 */
function posAtTextOffset(
  doc: PMNode,
  frame: BlockTextFrame,
  offset: number,
): number | null {
  if (!Number.isInteger(offset) || offset < 0) return null
  const contentStart = frame.from + 1
  const contentEnd = frame.to - 1
  // Atom / empty block: only offset 0 is in bounds (the content start).
  if (contentEnd < contentStart) return offset === 0 ? contentStart : null
  if (offset === 0) return contentStart
  // Single linear walk. The old form recomputed `textBetween(contentStart, pos)`
  // every step — O(n²) in the block's text length, run twice per setInlineMark.
  // Within a textblock the read-model length is additive over single-position
  // slices (no inter-block separators inside one block), so accumulate it:
  // `textBetween(pos, pos+1, "\n", "\n")` is exactly the text the read model
  // attributes to that step (a char, or "\n" for an inline leaf), so the first
  // position whose accumulated prefix reaches `offset` is the one `textOffset`
  // would have emitted.
  let length = 0
  for (let pos = contentStart; pos < contentEnd; pos++) {
    length += doc.textBetween(pos, pos + 1, "\n", "\n").length
    if (length >= offset) return pos + 1
  }
  return null
}

/**
 * Resolver (spec gap #1): a block id + a block-local character offset → the
 * absolute PM position inside that block's text, or `null` when the block is
 * absent or the offset is out of bounds. The inverse of the read tools'
 * block-local offsets; exported so consumers can address text the same way the
 * agent reads it.
 */
export function posAtBlockOffset(
  doc: PMNode,
  blockId: string,
  offset: number,
): number | null {
  const frame = resolveBlockTextFrame(doc, blockId)
  if (!frame) return null
  return posAtTextOffset(doc, frame, offset)
}

export interface SetInlineMarkInput {
  blockId: string
  /** Block-local character offset, inclusive start (same units as get_block). */
  from: number
  /** Block-local character offset, exclusive end. */
  to: number
  /** Mark name; validated against `editor.schema.marks` (not a fixed enum). */
  mark: string
  /**
   * Mark attrs — e.g. `{ href }` for `link`, `{ textColor }` /
   * `{ backgroundColor }` for the `textStyle` colour mark. Validated by the
   * mark's own schema, not by this command. Ignored when `unset` is true.
   */
  attrs?: Record<string, unknown>
  /** Remove the mark over the range instead of applying it. */
  unset?: boolean
  /**
   * If provided, the command rejects (`invalid-input`) unless this equals the
   * live text of `[from, to)` — a stale-offset guard (spec D6). Optional.
   */
  expect?: string
}

export interface SetInlineMarkData {
  blockId: string
  mark: string
  from: number
  to: number
}

/**
 * Apply or remove an inline mark over a block-local character range in one
 * transaction (one undo step). A host-facing offset-addressed primitive (the
 * AI agent's retired `format_text` wrapper is gone — agents mark text via
 * `apply_edits`' markdown path); mirrors `replaceSelectionText`'s
 * result/gating shape.
 *
 * Mark VALIDITY is decided by `editor.schema.marks`, not a hardcoded list, so a
 * newly registered mark is supported with no change here (spec D2). The range
 * is addressed in the read tools' block-local char offsets (D1); absolute PM
 * positions never cross the API boundary.
 */
export function setInlineMark(
  editor: Editor,
  input: SetInlineMarkInput,
): RuneCommandResult<SetInlineMarkData> {
  if (editor.isDestroyed) {
    return runeCommandError("editor-destroyed", "Editor is destroyed.")
  }
  if (!editor.isEditable) {
    return runeCommandError("not-editable", "Editor is not editable.")
  }

  const { blockId, from, to, mark, attrs, unset, expect } = input
  const { doc } = editor.state

  const markType = editor.schema.marks[mark]
  if (!markType) {
    return runeCommandError("unsupported", `Unknown mark "${mark}".`)
  }

  const frame = resolveBlockTextFrame(doc, blockId)
  if (!frame) {
    return runeCommandError("not-found", `Block "${blockId}" was not found.`)
  }
  if (!frame.node.isTextblock) {
    // Capability mismatch (not a bad value) — the block exists but holds no
    // inline text. `unsupported`, matching replaceSelectionText's "only text
    // blocks" gate and set_block_color's "block can't be coloured".
    return runeCommandError(
      "unsupported",
      `Block "${blockId}" has no inline text to format.`,
    )
  }
  if (!frame.node.type.allowsMarkType(markType)) {
    // Latent today — every textblock in the schema allows every registered
    // mark — but a block that restricts marks would otherwise let addMark
    // silently skip every node while the command still reported success.
    return runeCommandError(
      "unsupported",
      `Block "${blockId}" (${frame.node.type.name}) does not allow the "${mark}" mark.`,
    )
  }

  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to <= from) {
    return runeCommandError(
      "invalid-input",
      "Range must be integer block-local offsets with 0 <= from < to.",
    )
  }

  const posFrom = posAtTextOffset(doc, frame, from)
  const posTo = posAtTextOffset(doc, frame, to)
  if (posFrom === null || posTo === null) {
    return runeCommandError(
      "invalid-input",
      `Range [${from}, ${to}) is out of the block's text bounds.`,
    )
  }

  if (expect !== undefined) {
    const actual = doc.textBetween(posFrom, posTo, "\n", "\n")
    if (actual !== expect) {
      return runeCommandError(
        "invalid-input",
        "`expect` does not match the range text; the offsets may be stale.",
        { expected: expect, actual },
      )
    }
  }

  // Validate the requested attrs once, up front, so malformed attrs reject as
  // invalid-input deterministically (with no partial mutation) regardless of
  // what the range contains.
  if (!unset && attrs) {
    try {
      markType.create(attrs as Attrs)
    } catch (error) {
      return runeCommandError(
        "invalid-input",
        `Invalid attrs for mark "${mark}": ${(error as Error).message}`,
      )
    }
  }

  const tr = editor.state.tr
  if (unset) {
    tr.removeMark(posFrom, posTo, markType)
  } else {
    addInlineMarkMerged(tr, doc, posFrom, posTo, markType, attrs as Attrs | undefined)
  }
  editor.view.dispatch(tr)

  return runeCommandOk({ blockId, mark, from, to })
}

/**
 * Add `markType` (with `attrs`) over `[from, to)`, merging PER NODE (mirrors
 * Tiptap's native `setMark`): each text node in the range keeps its OWN
 * same-type mark's untouched axis. Existing marks are read from `doc`; the
 * additions are written to `tr` (so the caller controls the transaction /
 * dispatch — one shared `tr` across many ranges is exactly what `applyMatching`
 * needs). `addMark` never shifts positions, so ranges computed from one `doc`
 * stay valid as sibling ranges are applied.
 *
 * Why not sample the mark once and `addMark` uniformly: `textStyle` excludes
 * itself, so `addToSet` REPLACES per node — a single-instance addMark would
 * SMEAR the range-start char's attrs across the whole range, wiping any run
 * that already carried a different axis (e.g. a mid-range `backgroundColor`).
 * This exact bug shipped once in `format_text`'s history; the per-node merge is
 * the fix, shared here so `setInlineMark` and `applyMatching` can't drift.
 */
export function addInlineMarkMerged(
  tr: Transaction,
  doc: PMNode,
  from: number,
  to: number,
  markType: MarkType,
  attrs?: Attrs,
): void {
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isInline) return
    const subFrom = Math.max(pos, from)
    const subTo = Math.min(pos + node.nodeSize, to)
    const own = markType.isInSet(node.marks)
    const mergedAttrs = { ...(own?.attrs ?? {}), ...(attrs ?? {}) }
    tr.addMark(subFrom, subTo, markType.create(mergedAttrs))
  })
}
