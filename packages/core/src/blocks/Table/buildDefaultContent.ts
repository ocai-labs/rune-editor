// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { Editor } from "@tiptap/core"
import type { Schema, Node as ProseMirrorNode } from "@tiptap/pm/model"
import { Fragment } from "@tiptap/pm/model"
import type { RuneTableRow } from "./block"

export interface BuildDefaultTableContentOptions {
  withHeaderRow?: boolean
  /** Per-cell `colwidth` in px for every column of the fresh table.
   *  When omitted, falls back to `DEFAULT_COL_WIDTH`. Callers that want
   *  the table to fit the current editor column should derive this via
   *  `computeFitColWidth(editor, cols)`. */
  colWidth?: number
}

function positiveInt(value: number, fallback: number) {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : fallback
}

export const DEFAULT_TABLE_ROWS = 3
export const DEFAULT_TABLE_COLS = 3

// Initial column width for fresh tables when no fit-to-editor
// measurement is available (no editor / no measurable block-content,
// e.g. SSR or pre-mount construction). Mirrors Notion's default so
// a non-measured fresh table still looks correct.
const DEFAULT_COL_WIDTH = 235

// Floor below which we don't shrink columns even when the editor is
// extremely narrow. Mirrors `min-width: 35px` declared on .rune-table
// td/th in table.css and the `RESIZE_MIN_WIDTH` PM column-resizing
// uses — keeping these three values aligned avoids a layout fight
// where the cells assert a larger min than the inline colwidth.
// Exported so `fitTableToWidth` can share the same floor.
export const MIN_COL_WIDTH = 35

/** Derive the per-column width to use for a fresh `cols`-column table
 *  so the table fits the editor's current content column.
 *
 *  Measures `.rune-block-content` directly — that's the layout context
 *  the new table will live in, AFTER `.rune-block`'s `padding-inline`
 *  chrome has already eaten its share. An earlier revision measured
 *  `editor.view.dom.clientWidth` (the `.ProseMirror` element) and the
 *  per-cell colwidth then summed to a few px MORE than the table's
 *  actual available width — the MBS overlay on `.rune-table-frame`
 *  missed the overflow on the right. Measuring block-content removes
 *  that coupling to the padding declaration in editor-chrome.css.
 *
 *  Returns `undefined` when no editor is available, when no
 *  `.rune-block-content` has rendered yet (empty doc / SSR / jsdom), when
 *  the editor was never mounted (a headless editor, e.g.
 *  `createHeadlessEditor` — `editor.view` there is a stub Proxy that THROWS
 *  on any property outside a small whitelist, `dom` not among them, rather
 *  than being `undefined`; caught below), or when the measurement is zero —
 *  caller should fall back to the spec's default. The returned value is
 *  floor-divided and clamped to `MIN_COL_WIDTH` so very narrow editors still
 *  produce a usable (if overflowing) table rather than zero-width cells. */
export function computeFitColWidth(editor: Editor | undefined, cols: number): number | undefined {
  if (!editor || cols <= 0) return undefined
  let dom: HTMLElement | undefined
  try {
    dom = editor.view?.dom as HTMLElement | undefined
  } catch {
    return undefined
  }
  if (!dom) return undefined
  // Prefer a real `.rune-block-content` width — that is the layout
  // context the new table will live in. Falls back to the
  // `.ProseMirror` clientWidth for the degenerate empty-doc case where
  // no block has rendered yet (the doc still has at least one node
  // most of the time, so this fallback is mostly defensive).
  const blockContent = dom.querySelector<HTMLElement>(".rune-block-content")
  const width = blockContent?.clientWidth ?? dom.clientWidth
  if (width <= 0) return undefined
  return Math.max(MIN_COL_WIDTH, Math.floor(width / cols))
}

/** Build the content fragment for a fresh `rows × cols` table.
 *  By default row 0 is `tableHeader+` and rows 1..N are `tableCell+`.
 *  Pass `withHeaderRow: false` to create a body-only table where every
 *  row uses `tableCell`. Each cell contains a fresh empty
 *  `tableParagraph`. */
export function buildDefaultTableContent(
  schema: Schema,
  rows: number,
  cols: number,
  options: BuildDefaultTableContentOptions = {},
): Fragment {
  const { tableRow, tableCell, tableHeader, tableParagraph } = schema.nodes
  if (!tableRow || !tableCell || !tableHeader || !tableParagraph) {
    throw new Error(
      "buildDefaultTableContent: schema is missing one of " +
        "tableRow / tableCell / tableHeader / tableParagraph",
    )
  }
  const rowCount = positiveInt(rows, 1)
  const colCount = positiveInt(cols, 1)
  const withHeaderRow = options.withHeaderRow ?? true
  const colWidth = options.colWidth && options.colWidth > 0
    ? Math.max(MIN_COL_WIDTH, Math.floor(options.colWidth))
    : DEFAULT_COL_WIDTH
  const cellAttrs = { colwidth: [colWidth] }
  const allRows: ProseMirrorNode[] = [
    tableRow.create(
      null,
      Fragment.from(
        Array.from({ length: colCount }, () =>
          (withHeaderRow ? tableHeader : tableCell).create(
            cellAttrs,
            tableParagraph.create(),
          ),
        ),
      ),
    ),
  ]
  for (let r = 1; r < rowCount; r++) {
    const bodyCells = Array.from({ length: colCount }, () =>
      tableCell.create(cellAttrs, tableParagraph.create()),
    )
    allRows.push(tableRow.create(null, Fragment.from(bodyCells)))
  }
  return Fragment.from(allRows)
}

/** A populated row's `cells`, defensively read AND shape-coerced. Recognizes
 *  the canonical `{ cells: [...] }` row, plus the two shapes a model reliably
 *  emits when it deviates: a row that IS the cell array (`["a","b"]` — no
 *  `cells` wrapper). A malformed reply may also drop `cells` or pass a non-array
 *  (or the whole row may be null) — treat any of those as an empty row so the
 *  table still builds rather than throwing out of `fromInput` (whose contract is
 *  to build a node or let the caller reject, never to crash the insert command —
 *  it has no try/catch). */
function rowCellsOf(row: unknown): unknown[] {
  if (Array.isArray(row)) return row
  const cells = (row as { cells?: unknown } | null | undefined)?.cells
  return Array.isArray(cells) ? cells : []
}

/** Coerce a populated-row cell's text to a string for `schema.text`. Accepts
 *  the canonical `{ text }`, the common deviations `"a"` (a bare string cell)
 *  and `{ content }` (the key a model guesses when `text` doesn't stick), and a
 *  primitive (number/boolean/bigint) so `{ text: 42 }` still renders "42";
 *  anything else (null/object) becomes "" (a blank cell). Never returns a
 *  non-string — `schema.text` would otherwise build a TextNode whose `nodeSize`
 *  is `text.length` (= `undefined` for a number), corrupting every position
 *  mapped after the cell. */
function cellText(cell: unknown): string {
  if (typeof cell === "string") return cell
  if (
    typeof cell === "number" ||
    typeof cell === "boolean" ||
    typeof cell === "bigint"
  ) {
    return String(cell)
  }
  const value =
    (cell as { text?: unknown; content?: unknown } | null | undefined)?.text ??
    (cell as { content?: unknown } | null | undefined)?.content
  if (typeof value === "string") return value
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value)
  }
  return ""
}

/** Column count for a populated-rows input — the widest row once cells are
 *  read via the shape-coercing {@link rowCellsOf} (so an array-of-arrays row
 *  counts its own length, not a missing `.cells`). At least 1. */
export function tableColCount(rows: readonly unknown[]): number {
  return Math.max(1, ...rows.map((row) => rowCellsOf(row).length))
}

/** Whether a populated-rows input yields ANY non-empty cell text once coerced.
 *  `fromInput` uses this to tell a recoverable populated reply from one whose
 *  content it couldn't map (see {@link tableInputCarriesText}). */
export function tableInputRecoversText(rows: readonly unknown[]): boolean {
  return rows.some((row) =>
    rowCellsOf(row).some((cell) => cellText(cell).trim().length > 0),
  )
}

/** Deep-scan a raw table input for any non-empty string (or finite number)
 *  value, regardless of which key carries it. `fromInput` uses this to
 *  distinguish "the agent sent cell content under a shape we can't map" (reject
 *  for a correction signal) from "the agent asked for genuinely empty cells"
 *  (build the empty table). Booleans are excluded — `isHeader: true` is
 *  structure, not content. */
export function tableInputCarriesText(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0
  if (typeof value === "number" || typeof value === "bigint") {
    return Number.isFinite(Number(value))
  }
  if (Array.isArray(value)) return value.some(tableInputCarriesText)
  if (value && typeof value === "object") {
    return Object.values(value).some(tableInputCarriesText)
  }
  return false
}

/** Parse a pipe/newline "markdown" table a model put in the flat `text` field
 *  into populated rows. Tables aren't text blocks, but agents do reach for
 *  `text` — recover the grid rather than drop it. Requires at least one `|`: a
 *  plain prose string is NOT a table (the caller rejects it for a correction
 *  signal instead of building a 1×1 table from a sentence). A separator row
 *  (`|---|---|`) immediately after the first row promotes that row to a header.
 *  Returns null when the text has no pipe. */
export function parseFlatTableText(text: string): RuneTableRow[] | null {
  if (!text.includes("|")) return null
  const isSeparator = (line: string) => /^[\s|:-]+$/.test(line) && line.includes("-")
  const splitCells = (line: string): RuneTableCellLike[] => {
    let s = line
    if (s.startsWith("|")) s = s.slice(1)
    if (s.endsWith("|")) s = s.slice(0, -1)
    return s.split("|").map((cell) => ({ text: cell.trim() }))
  }
  const rows: RuneTableRow[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.length === 0) continue
    if (isSeparator(line)) {
      // A separator that follows exactly the first row marks it as the header.
      if (rows.length === 1) rows[0]!.isHeader = true
      continue
    }
    rows.push({ cells: splitCells(line), isHeader: false })
  }
  return rows.length > 0 ? rows : null
}

type RuneTableCellLike = { text: string }

/** Build a table content fragment from POPULATED rows (`RuneTableRow[]`) — the
 *  data shape `toRuneBlock` emits and the markdown/agent insert path supplies.
 *  Symmetric to {@link buildDefaultTableContent} (same colwidth handling) but
 *  fills each cell's `tableParagraph` with the row's text. Rows are normalized
 *  to a rectangle (`colCount` = the widest row); short rows pad with empty
 *  cells, so a ragged model reply still yields a valid `tableRow+` table.
 *  Missing/non-array `cells` or a null row degrade to an all-empty row, and a
 *  non-string cell `text` is coerced — the function never throws on shape.
 *  `isHeader` per row picks `tableHeader` vs `tableCell`. */
export function buildTableContentFromRows(
  schema: Schema,
  rows: RuneTableRow[],
  options: BuildDefaultTableContentOptions = {},
): Fragment {
  const { tableRow, tableCell, tableHeader, tableParagraph } = schema.nodes
  if (!tableRow || !tableCell || !tableHeader || !tableParagraph) {
    throw new Error(
      "buildTableContentFromRows: schema is missing one of " +
        "tableRow / tableCell / tableHeader / tableParagraph",
    )
  }
  const colCount = Math.max(1, ...rows.map((row) => rowCellsOf(row).length))
  const colWidth = options.colWidth && options.colWidth > 0
    ? Math.max(MIN_COL_WIDTH, Math.floor(options.colWidth))
    : DEFAULT_COL_WIDTH
  const cellAttrs = { colwidth: [colWidth] }
  const allRows = rows.map((row) => {
    const rowCells = rowCellsOf(row)
    const isHeader = Boolean(
      (row as { isHeader?: unknown } | null | undefined)?.isHeader,
    )
    const cells = Array.from({ length: colCount }, (_unused, i) => {
      // schema.text("") throws — leave an empty paragraph for blank/missing cells.
      const text = cellText(rowCells[i])
      const para = text
        ? tableParagraph.create(null, schema.text(text))
        : tableParagraph.create()
      return (isHeader ? tableHeader : tableCell).create(cellAttrs, para)
    })
    return tableRow.create(null, Fragment.from(cells))
  })
  return Fragment.from(allRows)
}
