// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Tier 2 of the rune-ai markdown-diff refactor — the declarative bulk op. The
// AI layer wraps this in an `apply_matching` tool; this file is the headless
// core engine. See the plan's "Tier 2 — apply_matching" section
// (internal design notes).
//
// Where Tier 1 (`applyMarkdownEdits`) is quote-don't-compute for point edits,
// Tier 2 is "ALL X → Y" with completeness GUARANTEED BY THE ENGINE: the model
// declares a predicate (`where`) and a transform (`set`); we traverse the doc
// once, enumerate every matching inline range / block ourselves (exact ranges,
// no model guessing), and apply the transform in ONE transaction (one undo
// step). The model reads back a `count`; zero matches is a success, not an
// error.
//
// Apply path (plan decision C1, 2026-07-02): direct PM mark/attr application
// over the enumerated ranges — NEVER routed through Tier 1's serialize →
// re-parse cycle. Adding a mark to an exact range destroys nothing, so that
// machinery (and its lossless-refusal, which would let one internalRef-carrying
// block veto "recolor all code") is deliberately not inherited. Tier 2 shares
// Tier 1's error/metadata conventions but none of its engine.

import type { Editor } from "@tiptap/core"
import type { Attrs, MarkType, Node as PMNode } from "@tiptap/pm/model"
import {
  forEachBodyBlock,
  isBodyBlockNode,
  isStructuralBlockContainer,
} from "../../schema/bodySurface"
import { getBlockSpecs } from "../../schema/blocks/registry"
import { COLOR_NAMES } from "../../shared/color-tokens"
import type { TurnIntoBlockInput } from "../types"
import { addInlineMarkMerged } from "../inlineMark"
import { applyTurnIntoTr, canTurnInto } from "./turnInto"
import {
  runeCommandError,
  runeCommandOk,
  type RuneCommandResult,
} from "../result"

/** The `textStyle` mark and its colour axis — the same inline colour carrier
 * every other rune colour surface reads (`serializeInline`, the inline colour
 * extension). Named here so the `hasTextColor` predicate is unambiguous. */
const TEXT_STYLE_MARK = "textStyle"
const TEXT_COLOR_ATTR = "textColor"

/**
 * The predicate half. Every provided key must hold (AND). At least one key is
 * required — an empty `where` is rejected rather than sweeping the whole doc.
 */
export interface RuneMatchWhere {
  /** Inline ranges carrying this mark type (e.g. `"code"`). Validated against
   * `editor.schema.marks`. */
  mark?: string
  /** Restrict to blocks of this type (e.g. `"heading"`). Validated against the
   * registered body blocks. */
  blockType?: string
  /** A colour name, or `"any"` — the `textStyle.textColor` predicate. A pure
   * predicate: an unrecognised name simply matches nothing (count 0). */
  hasTextColor?: string
  /** A literal substring, or `"/pattern/flags"` for a JS regex. Restricts to
   * the matched SUBSTRINGS within the candidates. */
  textMatches?: string
}

/**
 * The transform half. The KIND of transform decides what is targeted: `mark` /
 * `unset` are INLINE-kind (act on ranges); `blockColor` / `turnInto` are
 * BLOCK-kind (act on whole blocks). Mixing kinds in one call is rejected — the
 * model issues two calls. An empty `set` is rejected.
 */
export interface RuneMatchSet {
  /** Add this mark over each matched range, merging attrs per node (so a
   * `textStyle {textColor}` add keeps a node's existing `backgroundColor`). */
  mark?: { type: string; attrs?: Record<string, unknown> }
  /** Remove each named mark (whole mark, not attr-surgery) over each range. */
  unset?: string[]
  /** Set a matched block's text/background colour. Only blocks whose spec
   * DECLARES the axis are counted as matches (see the JSDoc on `applyMatching`). */
  blockColor?: { kind: "text" | "background"; name: string }
  /** Convert each matched block to another type (pure type flip — no content).
   * Reuses the core `turnInto` command; only blocks that can convert count. */
  turnInto?: { type: string; props?: Record<string, unknown> }
}

export interface ApplyMatchingOptions {
  where: RuneMatchWhere
  set: RuneMatchSet
  /** Block types invisible to the scan (the AI layer passes the agent-hidden
   * types, e.g. the document title, so its text is never matched). */
  excludeBlockTypes?: readonly string[]
}

export interface ApplyMatchingData {
  /** Ids of the blocks the transform touched, in document order, deduped. */
  changedBlockIds: string[]
  /** Inline-kind: number of applied ranges. Block-kind: number of matched
   * blocks. Zero is a valid success (nothing dispatched). */
  count: number
}

/** An absolute inline range in the doc. */
interface Range {
  from: number
  to: number
}

/**
 * Apply a declarative bulk transform to every match of `where`, in ONE
 * transaction (one undo step). The engine — not the model — enumerates the
 * targets, so "all X → Y" is complete by construction.
 *
 * Targeting is driven by the `set` KIND:
 * - INLINE-kind (`mark` / `unset`): every text range satisfying the inline
 *   predicates (`mark` present; `hasTextColor` = named colour or `"any"`),
 *   within blocks satisfying `blockType`, restricted to `textMatches`
 *   substrings when given. Contiguous ranges merge; `count` = applied ranges.
 * - BLOCK-kind (`blockColor` / `turnInto`): every block satisfying `blockType`
 *   and (when an inline predicate is given) containing ≥1 matching range.
 *   `count` = matched blocks.
 *
 * BLOCK-kind eligibility gate (plan decision): a block-kind op only counts a
 * block it can actually apply to — `blockColor` requires the block spec to
 * DECLARE that colour axis (writing a raw attr onto a block that doesn't
 * support it would silently no-op — the established `setBlockColor` stance);
 * `turnInto` requires the source to be convertible (`canTurnInto`). A block that
 * matches `where` but fails the gate is simply NOT a match, so `count` never
 * overstates what changed. (If both block-kind keys are set, a block must pass
 * BOTH gates; `blockColor` is applied before `turnInto`.)
 *
 * KNOWN pre-existing issue: `turnInto` reuses the same core conversion
 * machinery as the `turn_into` tool, which has a documented level/text
 * edge-case (writeTools raw-cast / buildTextblock). Not fixed here — same
 * command, no better, no worse.
 *
 * Zero matches → success `{ changedBlockIds: [], count: 0 }`, nothing
 * dispatched. Gates (destroyed / not-editable) and validation run before any
 * mutation. Does NOT stamp `AGENT_WRITE_META` — the AI `runTool` wrapper does.
 */
export function applyMatching(
  editor: Editor,
  options: ApplyMatchingOptions,
): RuneCommandResult<ApplyMatchingData> {
  if (editor.isDestroyed) {
    return runeCommandError("editor-destroyed", "Editor is destroyed.")
  }
  if (!editor.isEditable) {
    return runeCommandError("not-editable", "Editor is not editable.")
  }

  const { where, set } = options
  const exclude = new Set(options.excludeBlockTypes ?? [])

  // ── validate `where` ──────────────────────────────────────────────────────
  const hasWhere =
    where != null &&
    (where.mark !== undefined ||
      where.blockType !== undefined ||
      where.hasTextColor !== undefined ||
      where.textMatches !== undefined)
  if (!hasWhere) {
    return runeCommandError(
      "invalid-input",
      "`where` must have at least one predicate (no doc-wide sweeps).",
    )
  }
  if (where.mark !== undefined && !editor.schema.marks[where.mark]) {
    return runeCommandError("unsupported", `Unknown mark "${where.mark}".`)
  }
  const specs = getBlockSpecs(editor)
  if (
    where.blockType !== undefined &&
    !isRegisteredBodyBlockType(specs, where.blockType)
  ) {
    return runeCommandError("unsupported", `Unknown block type "${where.blockType}".`)
  }

  // ── validate `set` + determine kind ───────────────────────────────────────
  const inlineKind =
    set?.mark !== undefined ||
    (Array.isArray(set?.unset) && set!.unset.length > 0)
  const blockKind = set?.blockColor !== undefined || set?.turnInto !== undefined
  if (inlineKind && blockKind) {
    return runeCommandError(
      "invalid-input",
      "`set` mixes inline (mark/unset) and block (blockColor/turnInto) transforms; issue two calls.",
    )
  }
  if (!inlineKind && !blockKind) {
    return runeCommandError("invalid-input", "`set` must specify a transform.")
  }

  // Compile textMatches once (invalid regex → invalid-input).
  let matcher: TextMatcher | null = null
  if (where.textMatches !== undefined) {
    const compiled = compileTextMatches(where.textMatches)
    if ("error" in compiled) {
      return runeCommandError(
        "invalid-input",
        `Invalid textMatches: ${compiled.error}`,
      )
    }
    matcher = compiled.matcher
  }

  const hasInlinePredicate =
    where.mark !== undefined ||
    where.hasTextColor !== undefined ||
    where.textMatches !== undefined

  if (inlineKind) {
    return applyInline(editor, where, set, exclude, matcher)
  }
  return applyBlock(editor, where, set, exclude, specs, matcher, hasInlinePredicate)
}

// ── inline-kind ──────────────────────────────────────────────────────────────

function applyInline(
  editor: Editor,
  where: RuneMatchWhere,
  set: RuneMatchSet,
  exclude: Set<string>,
  matcher: TextMatcher | null,
): RuneCommandResult<ApplyMatchingData> {
  const schema = editor.schema

  // Resolve + validate the set's mark types up front (no partial mutation).
  let addType: MarkType | null = null
  let addAttrs: Attrs | undefined
  if (set.mark) {
    const type = schema.marks[set.mark.type]
    if (!type) {
      return runeCommandError("unsupported", `Unknown mark "${set.mark.type}".`)
    }
    if (set.mark.attrs) {
      try {
        type.create(set.mark.attrs as Attrs)
      } catch (error) {
        return runeCommandError(
          "invalid-input",
          `Invalid attrs for mark "${set.mark.type}": ${(error as Error).message}`,
        )
      }
    }
    addType = type
    addAttrs = set.mark.attrs as Attrs | undefined
  }
  const unsetTypes: MarkType[] = []
  for (const name of set.unset ?? []) {
    const type = schema.marks[name]
    if (!type) return runeCommandError("unsupported", `Unknown mark "${name}".`)
    unsetTypes.push(type)
  }

  // Enumerate every matching range on the LIVE doc. `addMark` / `removeMark`
  // never shift positions, so ranges collected here stay valid as siblings are
  // applied to the shared tr below.
  const doc = editor.state.doc
  const perBlock: Array<{ id: string; ranges: Range[] }> = []
  let total = 0
  forEachBodyBlock(doc, ({ node, pos }) => {
    if (exclude.has(node.type.name)) return
    if (where.blockType !== undefined && node.type.name !== where.blockType) return
    // Enumerate ranges across ALL inline-bearing textblocks in this body block
    // (a table's cell paragraphs, not just its direct children). `addType` gates
    // out any textblock whose type disallows the mark being added.
    const ranges = computeBodyBlockRanges(node, pos, where, matcher, addType)
    if (ranges.length === 0) return
    const id = node.attrs.id as string | undefined
    if (id) perBlock.push({ id, ranges })
    total += ranges.length
  })

  if (total === 0) return runeCommandOk({ changedBlockIds: [], count: 0 })

  const tr = editor.state.tr
  for (const { ranges } of perBlock) {
    for (const range of ranges) {
      // Unset first, then add, so a set.mark of a just-unset type still lands.
      for (const type of unsetTypes) tr.removeMark(range.from, range.to, type)
      if (addType) {
        addInlineMarkMerged(tr, doc, range.from, range.to, addType, addAttrs)
      }
    }
  }
  editor.view.dispatch(tr)
  return runeCommandOk({
    changedBlockIds: perBlock.map((b) => b.id),
    count: total,
  })
}

// ── block-kind ───────────────────────────────────────────────────────────────

function applyBlock(
  editor: Editor,
  where: RuneMatchWhere,
  set: RuneMatchSet,
  exclude: Set<string>,
  specs: ReturnType<typeof getBlockSpecs>,
  matcher: TextMatcher | null,
  hasInlinePredicate: boolean,
): RuneCommandResult<ApplyMatchingData> {
  const schema = editor.schema

  // Validate the block-kind set up front.
  if (set.blockColor) {
    const { kind, name } = set.blockColor
    if (kind !== "text" && kind !== "background") {
      return runeCommandError("invalid-input", `Unknown colour kind "${kind}".`)
    }
    if (!(COLOR_NAMES as readonly string[]).includes(name)) {
      return runeCommandError(
        "invalid-input",
        `Unknown colour "${name}". Valid names: ${COLOR_NAMES.join(", ")}.`,
      )
    }
  }
  let turnTarget: TurnIntoBlockInput | null = null
  if (set.turnInto) {
    if (!isRegisteredBodyBlockType(specs, set.turnInto.type)) {
      return runeCommandError(
        "unsupported",
        `Unknown block type "${set.turnInto.type}".`,
      )
    }
    turnTarget = {
      type: set.turnInto.type,
      ...(set.turnInto.props ? { props: set.turnInto.props } : {}),
    }
  }

  const doc = editor.state.doc
  const matched: Array<{ pos: number; node: PMNode; id: string }> = []
  forEachBodyBlock(doc, ({ node, pos }) => {
    if (exclude.has(node.type.name)) return
    if (where.blockType !== undefined && node.type.name !== where.blockType) return
    if (hasInlinePredicate) {
      // Must CONTAIN at least one matching inline range — across ALL its
      // textblocks (a table qualifies when a cell matches). No mark is added
      // here, so no allowsMarkType gate.
      if (computeBodyBlockRanges(node, pos, where, matcher, null).length === 0) return
    }
    // Set-specific eligibility gate (see applyMatching JSDoc). A block that
    // fails the gate is not a match, so `count` never overstates.
    if (set.blockColor) {
      const supports = specs[node.type.name]?.supports
      const ok =
        set.blockColor.kind === "text" ? supports?.textColor : supports?.backgroundColor
      if (!ok) return
    }
    if (turnTarget && !canTurnInto(node, turnTarget, schema)) return
    const id = node.attrs.id as string | undefined
    if (id) matched.push({ pos, node, id })
  })

  if (matched.length === 0) return runeCommandOk({ changedBlockIds: [], count: 0 })

  const tr = editor.state.tr
  if (set.blockColor) {
    // Mirrors the color extension's `setBlockColor` command: set the axis attr;
    // `"default"` clears (stored as null). setNodeAttribute never shifts
    // positions, so the original positions stay valid.
    const attr = set.blockColor.kind === "text" ? TEXT_COLOR_ATTR : "backgroundColor"
    const stored = set.blockColor.name === "default" ? null : set.blockColor.name
    for (const { pos } of matched) tr.setNodeAttribute(pos, attr, stored)
  }
  if (turnTarget) {
    // applyTurnIntoTr maps every source.pos through tr.mapping, so it is safe
    // after the position-stable blockColor step above and across its own
    // multi-source size changes. keepDepth defaults true (a bulk type flip
    // preserves nesting).
    applyTurnIntoTr(
      editor,
      tr,
      matched.map(({ pos, node }) => ({ pos, node })),
      turnTarget,
      schema,
    )
  }
  editor.view.dispatch(tr)
  return runeCommandOk({
    changedBlockIds: matched.map((m) => m.id),
    count: matched.length,
  })
}

// ── inline range enumeration ─────────────────────────────────────────────────

/**
 * Every matching inline range within a body block, gathered across ALL its
 * inline-bearing textblocks — the fix for Tier 2's table-cell gap. A textblock
 * body block (paragraph / heading / callout) IS its own only candidate; a
 * container body block (a `table`) contributes each textblock in its subtree
 * (the cells' `tableParagraph`s).
 *
 * The descent STOPS at any nested body block or structural container (a
 * `column`): a `columnLayout`'s column children are enumerated as their OWN body
 * blocks by `forEachBodyBlock`, so re-collecting their textblocks here would
 * apply the transform twice (a double `addMark` hides as an idempotent no-op —
 * see the column regression test).
 *
 * `requireMarkType` (the mark a `mark`-set would add): a textblock whose type
 * disallows it is skipped whole — its ranges are neither counted nor written, so
 * a no-op add is never over-counted. `null` for unset-only / block-kind callers
 * (nothing is added, so nothing to gate).
 */
function computeBodyBlockRanges(
  block: PMNode,
  blockPos: number,
  where: RuneMatchWhere,
  matcher: TextMatcher | null,
  requireMarkType: MarkType | null,
): Range[] {
  const out: Range[] = []
  forEachInlineTextblock(block, blockPos, (textblock, pos) => {
    if (requireMarkType && !textblock.type.allowsMarkType(requireMarkType)) return
    for (const range of computeInlineRanges(textblock, pos, where, matcher)) {
      out.push(range)
    }
  })
  return out
}

/**
 * Visit each inline-bearing textblock inside a body block, in document order.
 * A textblock body block IS the sole candidate; otherwise descend the subtree,
 * halting at any nested body block or structural container so a column child's
 * textblock is never enumerated here (it is its own body block — see
 * `computeBodyBlockRanges`). `descendants` reports positions relative to
 * `block`'s content, so `blockPos + 1 + offset` is the textblock's absolute pos.
 */
function forEachInlineTextblock(
  block: PMNode,
  blockPos: number,
  fn: (textblock: PMNode, pos: number) => void,
): void {
  if (block.isTextblock) {
    fn(block, blockPos)
    return
  }
  const contentStart = blockPos + 1
  block.descendants((node, offset) => {
    if (isStructuralBlockContainer(node) || isBodyBlockNode(node)) return false
    if (node.isTextblock) {
      fn(node, contentStart + offset)
      return false // its children are inline; no deeper descent
    }
    return true
  })
}

/** Whether a text node satisfies the inline predicates (`mark`, `hasTextColor`). */
function textNodePasses(node: PMNode, where: RuneMatchWhere): boolean {
  if (where.mark !== undefined && !node.marks.some((m) => m.type.name === where.mark)) {
    return false
  }
  if (where.hasTextColor !== undefined) {
    const ts = node.marks.find((m) => m.type.name === TEXT_STYLE_MARK)
    const color = ts?.attrs[TEXT_COLOR_ATTR] as unknown
    if (where.hasTextColor === "any") {
      if (color == null || color === "") return false
    } else if (color !== where.hasTextColor) {
      return false
    }
  }
  return true
}

/** A direct inline child of a block: a text run, or a non-text leaf (a break). */
interface Cell {
  from: number
  to: number
  /** Text of a text node, or `null` for a non-text inline leaf. */
  text: string | null
  /** Whether this cell passes the mark/hasTextColor predicates. */
  pass: boolean
}

/**
 * Every matching inline range in a single TEXTBLOCK (`block`), merged. When
 * `matcher` is set, ranges are the pattern's matched substrings (restricted to
 * predicate-passing text when a mark/colour predicate is also given); otherwise
 * ranges are the maximal contiguous runs of predicate-passing text. Non-text
 * inline leaves (math, hard breaks) break contiguity — a match/run never spans
 * one, nor a textblock boundary (each textblock is passed here separately by
 * `forEachInlineTextblock`).
 */
function computeInlineRanges(
  block: PMNode,
  blockPos: number,
  where: RuneMatchWhere,
  matcher: TextMatcher | null,
): Range[] {
  const hasMarkOrColor = where.mark !== undefined || where.hasTextColor !== undefined
  const contentStart = blockPos + 1

  const cells: Cell[] = []
  let offset = 0
  block.forEach((child) => {
    const from = contentStart + offset
    offset += child.nodeSize
    if (child.isText) {
      cells.push({ from, to: from + child.nodeSize, text: child.text ?? "", pass: textNodePasses(child, where) })
    } else {
      cells.push({ from, to: from + child.nodeSize, text: null, pass: false })
    }
  })

  const raw: Range[] = []

  if (matcher) {
    // Walk contiguous runs of text cells; a non-text leaf splits runs.
    let i = 0
    while (i < cells.length) {
      if (cells[i]!.text === null) {
        i++
        continue
      }
      const parts: string[] = []
      const charAbs: number[] = []
      const charPass: boolean[] = []
      let j = i
      while (j < cells.length && cells[j]!.text !== null) {
        const cell = cells[j]!
        parts.push(cell.text!)
        for (let k = 0; k < cell.text!.length; k++) {
          charAbs.push(cell.from + k)
          charPass.push(cell.pass)
        }
        j++
      }
      const runText = parts.join("")
      for (const [a, b] of matcher.find(runText)) {
        // When a mark/colour predicate is also given, the whole match must sit
        // on predicate-passing text.
        if (hasMarkOrColor) {
          let ok = true
          for (let k = a; k < b; k++) {
            if (!charPass[k]) {
              ok = false
              break
            }
          }
          if (!ok) continue
        }
        raw.push({ from: charAbs[a]!, to: charAbs[b - 1]! + 1 })
      }
      i = j
    }
  } else {
    // No pattern: merge consecutive predicate-passing text cells.
    let cur: Range | null = null
    for (const cell of cells) {
      if (cell.text !== null && cell.pass) {
        if (cur && cur.to === cell.from) cur.to = cell.to
        else {
          if (cur) raw.push(cur)
          cur = { from: cell.from, to: cell.to }
        }
      } else if (cur) {
        raw.push(cur)
        cur = null
      }
    }
    if (cur) raw.push(cur)
  }

  return coalesce(raw)
}

/** Sort by `from` and merge overlapping / touching ranges. */
function coalesce(ranges: Range[]): Range[] {
  if (ranges.length <= 1) return ranges
  const sorted = [...ranges].sort((a, b) => a.from - b.from)
  const out: Range[] = [sorted[0]!]
  for (let i = 1; i < sorted.length; i++) {
    const prev = out[out.length - 1]!
    const cur = sorted[i]!
    if (cur.from <= prev.to) prev.to = Math.max(prev.to, cur.to)
    else out.push(cur)
  }
  return out
}

// ── textMatches ──────────────────────────────────────────────────────────────

interface TextMatcher {
  /** All match ranges `[start, end)` (offsets into the given string). */
  find(text: string): Array<[number, number]>
}

/**
 * Compile a `textMatches` spec: `"/pattern/flags"` → a JS regex (global forced),
 * anything else → a literal substring matcher. An empty pattern / invalid regex
 * → `{ error }`.
 */
function compileTextMatches(
  spec: string,
): { matcher: TextMatcher } | { error: string } {
  // Flags capture accepts ANY letters so a typo'd flag ("/foo/I") still enters
  // the regex branch and fails loudly in `new RegExp` (→ invalid-input) instead
  // of silently degrading to a literal search for the string "/foo/I" (count 0
  // reads as a successful "no matches" to the model).
  const re = /^\/(.*)\/([a-zA-Z]*)$/.exec(spec)
  if (re) {
    const pattern = re[1]!
    const flags = re[2]!
    if (pattern.length === 0) return { error: "empty regex pattern" }
    let compiled: RegExp
    try {
      compiled = new RegExp(pattern, flags.includes("g") ? flags : flags + "g")
    } catch (error) {
      return { error: (error as Error).message }
    }
    return {
      matcher: {
        find(text) {
          const out: Array<[number, number]> = []
          compiled.lastIndex = 0
          for (const m of text.matchAll(compiled)) {
            const start = m.index ?? 0
            const end = start + m[0].length
            if (end > start) out.push([start, end]) // skip zero-length matches
          }
          return out
        },
      },
    }
  }
  if (spec.length === 0) return { error: "empty textMatches" }
  return {
    matcher: {
      find(text) {
        const out: Array<[number, number]> = []
        let idx = 0
        for (;;) {
          const at = text.indexOf(spec, idx)
          if (at === -1) break
          out.push([at, at + spec.length])
          idx = at + spec.length
        }
        return out
      },
    },
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** Whether `type` names a registered body block (by node name or public
 * `type`). Body blocks are exactly the factory-built specs (`column` and other
 * hand-rolled structural nodes are absent), so this is also the "not a
 * structural node" gate. */
function isRegisteredBodyBlockType(
  specs: ReturnType<typeof getBlockSpecs>,
  type: string,
): boolean {
  if (type in specs) return true
  for (const name in specs) {
    if (specs[name]!.type === type) return true
  }
  return false
}
