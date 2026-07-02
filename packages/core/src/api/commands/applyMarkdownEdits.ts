// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Tier 1 of the rune-ai markdown-diff refactor — the "quote, don't compute"
// write primitive. The AI layer wraps this in an `apply_edits` tool; this file
// is the headless core engine. See the plan's "Tier 1 — apply_edits" section
// (internal design notes).
//
// The model quotes existing styling-aware rune-markdown (`oldStr`) and supplies
// replacement markdown (`newStr`); we locate the quote against the SAME walk the
// read tools serialize (provenance chunks), string-replace inside the chunk,
// re-parse the whole chunk, and splice the result back — one transaction per
// call (one undo step). No PM-offset math ever crosses the API boundary; the
// round-trip contract (Tier 0's property test) is what makes a whole-block
// re-parse equivalent to a surgical splice.

import type { Editor } from "@tiptap/core"
import { Node as PMNode, type Schema } from "@tiptap/pm/model"
import type { Transaction } from "@tiptap/pm/state"
import { resolveBodyBlockById } from "../../schema/bodySurface"
import { parseAiMarkdown } from "../../extensions/clipboard/aiMarkdown"
import { markInlineContract } from "../export/markInlineContract"
import { exportMarkdownWithChunks } from "../export/markdown"
import {
  runeCommandError,
  runeCommandOk,
  type RuneCommandResult,
} from "../result"

const INDENT = "    "

/** One markdown find/replace. `oldStr` is a verbatim quote of what the read
 * tools show; `newStr` is replacement markdown in the same dialect. */
export interface RuneMarkdownEdit {
  /** Styling-aware rune-markdown to locate (verbatim quote of the read surface). */
  oldStr: string
  /** Replacement markdown, same dialect. May be structural (a list, a table). */
  newStr: string
  /** Optional scope: restrict the search to this block's chunk (disambiguates
   * a duplicate `oldStr`; on failure the error echoes this block's text). */
  blockId?: string
}

export interface ApplyMarkdownEditsOptions {
  edits: RuneMarkdownEdit[]
  /**
   * Chunks whose block type is listed are invisible to the search (the AI
   * layer passes the agent-hidden types, e.g. the document title). A `blockId`
   * scoped to an excluded block still resolves to no match.
   */
  excludeBlockTypes?: readonly string[]
}

export interface ApplyMarkdownEditsData {
  /** Ids of the blocks an edit landed on, deduped, in edit order. Structural
   * swaps report only the inherited (first) block's id; sibling blocks the swap
   * produced get fresh ids from BlockId's appendTransaction, unknown here. */
  changedBlockIds: string[]
}

/**
 * Apply a batch of markdown find/replace edits in ONE transaction (one undo
 * step). Edits are processed in order against the EVOLVING document, so a later
 * edit may quote text an earlier edit produced. The batch is atomic: if any
 * edit fails to locate, is ambiguous, or would destroy un-representable inline
 * state, NOTHING is dispatched and the failing edit's error is returned (its
 * `details.editIndex` names which edit).
 *
 * Does NOT stamp `AGENT_WRITE_META` — the AI tool layer's `runTool` wrapper
 * stamps whatever the tool dispatches.
 */
export function applyMarkdownEdits(
  editor: Editor,
  options: ApplyMarkdownEditsOptions,
): RuneCommandResult<ApplyMarkdownEditsData> {
  if (editor.isDestroyed) {
    return runeCommandError("editor-destroyed", "Editor is destroyed.")
  }
  if (!editor.isEditable) {
    return runeCommandError("not-editable", "Editor is not editable.")
  }

  const { edits, excludeBlockTypes } = options
  if (!Array.isArray(edits) || edits.length === 0) {
    return runeCommandError("invalid-input", "`edits` must be a non-empty array.")
  }

  const exclude = new Set(excludeBlockTypes ?? [])
  const tr = editor.state.tr
  const changed: string[] = []

  for (let index = 0; index < edits.length; index++) {
    const result = applyOneEdit(editor, tr, edits[index]!, exclude, index)
    if (!result.ok) return { ok: false, error: result.error }
    changed.push(result.data.blockId)
  }

  editor.view.dispatch(tr)
  return runeCommandOk({ changedBlockIds: [...new Set(changed)] })
}

// ── one edit ────────────────────────────────────────────────────────────────

/** A candidate chunk resolved to its live node + the indent-stripped haystack. */
interface Candidate {
  blockId: string
  node: PMNode
  /** Absolute pos of the block node in `tr.doc`. */
  pos: number
  /** Chunk text with the leading `INDENT.repeat(indent)` prefix stripped. */
  stripped: string
}

function applyOneEdit(
  editor: Editor,
  tr: Transaction,
  edit: RuneMarkdownEdit,
  exclude: Set<string>,
  index: number,
): RuneCommandResult<{ blockId: string }> {
  const { oldStr, newStr, blockId } = edit
  if (typeof oldStr !== "string" || typeof newStr !== "string") {
    return runeCommandError(
      "invalid-input",
      `Edit ${index}: oldStr and newStr must be strings.`,
      { editIndex: index },
    )
  }

  const schema = editor.schema
  // Provenance from the EVOLVING doc — earlier edits in the batch have already
  // mutated tr.doc, so numbered indices / positions reflect them.
  const { chunks } = exportMarkdownWithChunks(editor, tr.doc)

  const candidates: Candidate[] = []
  // The scoped block's current text, captured even if the block is excluded, so
  // a no-match under a blockId can still echo what the model should requote.
  let scopedBlockText: string | null = null
  for (const chunk of chunks) {
    if (chunk.blockId === null) continue // `<!-- -->` separators never parse.
    if (blockId !== undefined && chunk.blockId !== blockId) continue
    const resolved = resolveBodyBlockById(tr.doc, chunk.blockId)
    if (!resolved) continue
    const stripped = stripIndent(chunk.text, chunk.indent)
    if (blockId !== undefined && chunk.blockId === blockId) scopedBlockText = stripped
    if (exclude.has(resolved.node.type.name)) continue
    candidates.push({
      blockId: chunk.blockId,
      node: resolved.node,
      pos: resolved.pos,
      stripped,
    })
  }

  // Normalization ladder: the first tier that yields a UNIQUE match wins. Looser
  // tiers only ever add matches, so once a tier has any match the decision is
  // final — >1 there is genuine ambiguity no looser tier can resolve.
  for (const tier of TIERS) {
    const normNeedle = normalizeWithMap(oldStr, tier).norm
    if (normNeedle.length === 0) continue

    const matches: Array<{ cand: Candidate; from: number; to: number }> = []
    for (const cand of candidates) {
      const { norm, map } = normalizeWithMap(cand.stripped, tier)
      let cursor = 0
      for (;;) {
        const at = norm.indexOf(normNeedle, cursor)
        if (at === -1) break
        matches.push({ cand, from: map[at]!, to: map[at + normNeedle.length]! })
        cursor = at + normNeedle.length
      }
    }

    if (matches.length === 0) continue
    if (matches.length > 1) {
      const blockIds = [...new Set(matches.map((m) => m.cand.blockId))]
      return runeCommandError(
        "ambiguous-match",
        `Edit ${index}: oldStr matches ${matches.length} locations across ${blockIds.length} block(s); pass a blockId or quote more context.`,
        { editIndex: index, oldStr, blockIds },
      )
    }
    return applyMatch(schema, tr, matches[0]!, newStr, index)
  }

  return runeCommandError(
    "no-match",
    blockId !== undefined
      ? `Edit ${index}: oldStr was not found in block ${blockId}.`
      : `Edit ${index}: oldStr was not found; quote within a single block or pass blockId.`,
    blockId !== undefined
      ? { editIndex: index, oldStr, blockId, blockText: scopedBlockText }
      : { editIndex: index, oldStr },
  )
}

function applyMatch(
  schema: Schema,
  tr: Transaction,
  match: { cand: Candidate; from: number; to: number },
  newStr: string,
  index: number,
): RuneCommandResult<{ blockId: string }> {
  const { cand } = match
  const { node, pos, stripped, blockId } = cand

  // Pre-flight lossless guard: the UNEDITED chunk must round-trip back to the
  // live block's content. If it doesn't, the block carries inline state the
  // dialect can't represent (an internalRef mark, an undeclared plugin mark,
  // consecutive spaces inside inline code) — refuse rather than destroy it.
  const uneditedBlocks = parseBlocks(stripped, schema)
  const uneditedBlock = uneditedBlocks[0]
  const roundTrips =
    uneditedBlocks.length === 1 &&
    uneditedBlock!.type.name === node.type.name &&
    uneditedBlock!.content.eq(node.content)
  if (!roundTrips) {
    const badMark = findUnrepresentableMark(node)
    return runeCommandError(
      "not-editable-lossless",
      badMark
        ? `Block ${blockId} carries a "${badMark}" mark that rune-markdown cannot represent; this edit would destroy it.`
        : `Block ${blockId} carries content not representable in markdown; this edit would destroy it.`,
      { editIndex: index, blockId },
    )
  }

  // String-replace on the verbatim (indent-stripped) chunk, then re-parse whole.
  const editedStripped =
    stripped.slice(0, match.from) + newStr + stripped.slice(match.to)

  // Clear, don't delete: when the replace empties the WHOLE (indent-stripped)
  // chunk — oldStr consumed all of it and newStr is empty/whitespace — keep the
  // block node (its type, id, depth, and non-markdown attrs like `checked` /
  // block color / heading level) and swap in empty inline content. Removing the
  // block itself is delete_blocks' job. A PARTIAL empty (newStr is "" but a
  // markdown prefix like `- ` or `# ` survives) is not empty here and falls
  // through to the normal re-parse below, which reproduces the block from its
  // surviving syntax.
  if (editedStripped.trim() === "") {
    const cleared = node.type.create(node.attrs, null, node.marks)
    tr.replaceWith(pos, pos + node.nodeSize, cleared)
    return runeCommandOk({ blockId })
  }

  const resultBlocks = parseBlocks(editedStripped, schema)
  if (resultBlocks.length === 0) {
    return runeCommandError(
      "invalid-input",
      `Edit ${index}: newStr produced no block content.`,
      { editIndex: index, blockId },
    )
  }

  if (
    resultBlocks.length === 1 &&
    resultBlocks[0]!.type.name === node.type.name
  ) {
    // Same type in, same type out: preserve the node (id, depth, non-markdown
    // props like block color / checked) and swap only its inline content. Props
    // the markdown CAN represent (heading level, todo `[x]`) may have changed
    // via a prefix edit — detect that as a delta between the edited and unedited
    // re-parse (a fresh parse defaults every non-markdown prop, so a straight
    // copy would clobber block color; the delta copies only what the edit moved).
    const editedBlock = resultBlocks[0]!
    const mergedAttrs: Record<string, unknown> = { ...node.attrs }
    for (const key of Object.keys(editedBlock.attrs)) {
      if (key === "id" || key === "depth") continue
      if (!attrEq(editedBlock.attrs[key], uneditedBlock!.attrs[key])) {
        mergedAttrs[key] = editedBlock.attrs[key]
      }
    }
    const newNode = node.type.create(mergedAttrs, editedBlock.content, node.marks)
    tr.replaceWith(pos, pos + node.nodeSize, newNode)
  } else {
    // Different type or multiple blocks → structural swap. The first result
    // inherits the original id; the rest get null so BlockId's appendTransaction
    // fills them. Every result's depth is the ORIGINAL node's depth plus its own
    // parse-relative depth (re-parse ran on the indent-stripped text). We use the
    // node's real depth, NOT the chunk's render indent — under a toggle heading
    // the child renders flattened (indent 0) while its real depth is deeper, and
    // the render indent would silently reset it.
    const baseDepth = numAttr(node.attrs.depth)
    const swapped = resultBlocks.map((block, i) => {
      const attrs: Record<string, unknown> = {
        ...block.attrs,
        depth: baseDepth + numAttr(block.attrs.depth),
        id: i === 0 ? blockId : null,
      }
      return block.type.create(attrs, block.content, block.marks)
    })
    tr.replaceWith(pos, pos + node.nodeSize, swapped)
  }

  return runeCommandOk({ blockId })
}

// ── helpers ───────────────────────────────────────────────────────────────

/** Parse a markdown fragment into its top-level rune blocks (as PM nodes). */
function parseBlocks(markdown: string, schema: Schema): PMNode[] {
  const json = parseAiMarkdown(markdown, schema)
  const doc = PMNode.fromJSON(schema, json)
  const blocks: PMNode[] = []
  doc.content.forEach((child) => blocks.push(child))
  return blocks
}

/** Strip the leading `INDENT.repeat(indent)` prefix a chunk carries (4-space
 * runs re-parse as a markdown code block). No-op when the prefix is absent. */
function stripIndent(text: string, indent: number): string {
  const prefix = INDENT.repeat(indent)
  return text.startsWith(prefix) ? text.slice(prefix.length) : text
}

/** The name of the first inline mark on `node` with no markdown contract (e.g.
 * `internalRef`), or null. Used only to NAME the lossless-guard refusal; the
 * guard decision itself is the structural round-trip compare. */
function findUnrepresentableMark(node: PMNode): string | null {
  let found: string | null = null
  node.descendants((child) => {
    if (found) return false
    for (const mark of child.marks) {
      if (!(mark.type.name in markInlineContract)) {
        found = mark.type.name
        return false
      }
    }
    return true
  })
  return found
}

function numAttr(value: unknown): number {
  return typeof value === "number" ? value : 0
}

/** Deep-equal for attribute values (JSON-shaped: primitives, arrays, objects). */
function attrEq(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b)
}

// ── normalization ladder ─────────────────────────────────────────────────

interface TierOpts {
  collapseWs: boolean
  smartQuotes: boolean
  caseFold: boolean
  trim: boolean
}

// Cumulative loosening: each tier adds one relaxation on top of the previous.
// 1 exact · 2 collapse whitespace runs (JS \s, so NBSP & other Unicode spaces
// fold here too) · 3 + smart quotes · 4 + trim & case-fold (last resort).
const TIERS: readonly TierOpts[] = [
  { collapseWs: false, smartQuotes: false, caseFold: false, trim: false },
  { collapseWs: true, smartQuotes: false, caseFold: false, trim: false },
  { collapseWs: true, smartQuotes: true, caseFold: false, trim: false },
  { collapseWs: true, smartQuotes: true, caseFold: true, trim: true },
]

function foldSmartQuote(ch: string): string {
  switch (ch) {
    case "“": // “
    case "”": // ”
    case "„": // „
    case "‟": // ‟
      return '"'
    case "‘": // ‘
    case "’": // ’
    case "‚": // ‚
    case "‛": // ‛
      return "'"
    default:
      return ch
  }
}

/**
 * Normalize `s` under a tier, returning the normalized string plus an index map
 * back to the ORIGINAL string. `map[i]` is the original index of normalized
 * char `i`; `map[norm.length]` is a tail sentinel (= original length, or the
 * source index just past the last kept char after a trim) so a match's
 * exclusive end maps back too. The replacement always splices the verbatim
 * original substring `original.slice(map[from], map[to])`.
 */
function normalizeWithMap(
  s: string,
  opts: TierOpts,
): { norm: string; map: number[] } {
  const chars: string[] = []
  const map: number[] = []
  let lastWasCollapsedSpace = false
  for (let i = 0; i < s.length; i++) {
    let ch = s[i]!
    if (opts.collapseWs && /\s/.test(ch)) {
      if (lastWasCollapsedSpace) continue // fold the run into one space
      chars.push(" ")
      map.push(i)
      lastWasCollapsedSpace = true
      continue
    }
    lastWasCollapsedSpace = false
    if (opts.smartQuotes) ch = foldSmartQuote(ch)
    if (opts.caseFold) ch = ch.toLowerCase()
    // toLowerCase can widen a char (rare); map every output char to source `i`.
    for (const c of ch) {
      chars.push(c)
      map.push(i)
    }
  }
  map.push(s.length) // tail sentinel

  if (!opts.trim) return { norm: chars.join(""), map }

  let start = 0
  let end = chars.length
  while (start < end && /\s/.test(chars[start]!)) start++
  while (end > start && /\s/.test(chars[end - 1]!)) end--
  return {
    norm: chars.slice(start, end).join(""),
    // Keep [start, end] inclusive of the endpoint so map[trimmedLen] stays a
    // valid tail sentinel.
    map: map.slice(start, end + 1),
  }
}
