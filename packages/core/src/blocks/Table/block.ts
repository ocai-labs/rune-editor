// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { createBlockSpec } from "../../schema"
import type { RuneBlockBase } from "../../types"
import { insertOrUpdateBlockForSlashMenu } from "../../extensions/suggestion-menus"
import {
  buildDefaultTableContent,
  buildTableContentFromRows,
  computeFitColWidth,
  parseFlatTableText,
  tableColCount,
  tableInputCarriesText,
  tableInputRecoversText,
  DEFAULT_TABLE_ROWS,
  DEFAULT_TABLE_COLS,
} from "./buildDefaultContent"
import { serializeTableMarkdown } from "./markdown"
import { TableRow, TableCell, TableHeader, TableParagraph } from "./nodes"
import { TableCommands } from "./TableCommands"
import { TableSupport } from "./TableSupport"
import { TableMergedCellsGuard } from "./TableMergedCellsGuard"
import { TableCellNormalization } from "./normalization"
import { CellSelectionEdges } from "./CellSelectionEdges"
import { TableMouseSelection } from "./TableMouseSelection"
import { PinColumnWidths } from "./PinColumnWidths"

export const Table = createBlockSpec({
  type: "table",
  content: "tableRow+",
  // No per-table fit-width attr. "Fit to width" is a one-shot pixel
  // rewrite of every cell's `colwidth` (see TableCommands.fitTableToWidth)
  // — once applied, the table is a normal fixed-width table whose
  // widths persist across window resizes / devices. This mirrors
  // Notion's behavior; a sticky `fitWidth=true` mode was rejected
  // because it would silently mutate the user's column widths every
  // time the viewport changed.
  props: {
    // GFM column alignment — a fidelity passthrough in the D10 spirit
    // ("能保真存回 ≠ 能在 UI 里编辑"): an external file's `|:--|:-:|--:|`
    // delimiter row survives the storage roundtrip even though the UI
    // offers no alignment control and cells render unaligned. null (the
    // authored-in-rune case) serializes as the plain `---` row. Marshals
    // to a comma-joined data attr ("left,,right" — empty slot = null) so
    // the editor's own HTML roundtrip keeps it too.
    columnAligns: {
      default: null as ("left" | "center" | "right" | null)[] | null,
      parseHTML: (el) => {
        const raw = el.getAttribute("data-column-aligns")
        if (!raw) return null
        const aligns = raw
          .split(",")
          .map((v) => (v === "left" || v === "center" || v === "right" ? v : null))
        return aligns.some((a) => a !== null) ? aligns : null
      },
      renderHTML: (attrs): Record<string, string> => {
        const aligns = attrs.columnAligns
        if (!Array.isArray(aligns) || !aligns.some((a: unknown) => a != null)) return {}
        return { "data-column-aligns": aligns.map((a: unknown) => a ?? "").join(",") }
      },
    },
  },
  parseDOM: [{ tag: "table" }],
  renderDOM: ({ HTMLAttributes }) => [
    "div",
    { ...HTMLAttributes, class: "rune-block", "data-block-type": "table" },
    [
      "div",
      { class: "rune-block-content" },
      [
        "div",
        { class: "rune-table-scroll" },
        [
          "div",
          { class: "rune-table-content" },
          [
            "div",
            { class: "rune-table-chrome-padding" },
            [
              "div",
              { class: "rune-table-frame" },
              ["table", { class: "rune-table" }, 0],
            ],
          ],
        ],
      ],
    ],
  ],
  toMarkdown({ prefix, node, serializeInline }) {
    const table = serializeTableMarkdown(node, serializeInline)
    return {
      line: table.split("\n").map((line) => `${prefix}${line}`).join("\n"),
      spacing: "isolated",
    }
  },
  // Clipboard text/html: emit <table> with rows directly inside.
  // No <colgroup> (column widths sacrificed for cross-editor paste
  // compatibility; the receiving HTML parser auto-wraps <tr> in
  // <tbody>). No data-id / data-depth / .rune-block — clean semantic
  // table only.
  clipboardRenderDOM: () => ["table", {}, 0],
  // Table sub-structure nodes + plugin-bearing support extensions.
  // Sub-structure nodes are NOT page-body blocks — no id/depth,
  // never in BlockId.types, skipped by side-menu / MBS / drag.
  // Table itself is registered in bodyBlocks (before TableOfContents)
  // so its slash-menu item sorts first when typing "ta".
  extensions: [
    TableRow,
    TableCell,
    TableHeader,
    TableParagraph,
    TableCommands,
    TableSupport,
    TableMergedCellsGuard,
    TableCellNormalization,
    CellSelectionEdges,
    TableMouseSelection,
    PinColumnWidths,
  ],
  supports: { fitToWidth: true },
  schemaContext: {
    input: {
      description:
        "`rows` is overloaded: an array of `{ cells: [{ text }], isHeader }` builds a POPULATED table (the round-trippable shape `toRuneBlock` emits — use this to author content); a NUMBER (with `cols`, `withHeaderRow`) drops a blank N×M grid.",
      examples: [
        // Populated — the primary, round-trippable shape an agent authors.
        {
          type: "table",
          rows: [
            { cells: [{ text: "Feature" }, { text: "Status" }], isHeader: true },
            { cells: [{ text: "Search" }, { text: "Shipped" }], isHeader: false },
          ],
        },
        // Dimensions sugar — blank grid (slash menu / tooling), kept as a
        // secondary example so it isn't the only advertised shape.
        { type: "table", rows: 2, cols: 2, withHeaderRow: true },
      ],
    },
  },
  blockActions: () => [
    {
      id: "fit-to-width",
      label: "Fit to width",
      icon: "fit-width",
      isVisible: ({ isSingleBlock, pos }) => isSingleBlock && pos >= 0,
      run: ({ editor, pos }) => editor.commands.fitTableToWidth(pos),
    },
  ],
  sideMenu: { draggable: true },
  // Tables aren't indentable. Same rationale as Divider: nested depth
  // on a multi-cell node has no defined visual meaning.
  indent: { mode: "numeric", maxDepth: 0 },
  meta: { isolating: true },
  slashMenuItems: () => {
    const block = { type: "table" }
    return [
      {
        key: "table",
        title: "Table",
        aliases: ["table"],
        group: "Basic blocks",
        block,
        onItemClick: (ctx) => insertOrUpdateBlockForSlashMenu(ctx, block),
      },
    ]
  },
  fromInput: ({ schema, input, defaults, editor }) => {
    const t = schema.nodes.table
    if (!t) return null
    const attrs = {
      ...defaults.attrs,
      id: input.id ?? null,
      depth: input.depth ?? defaults.depth,
    }
    // Input shapes this block accepts, in priority order:
    //   • POPULATED — `rows` is an array of `{ cells: [{ text }], isHeader }`
    //     (the shape `toRuneBlock` emits). `buildTableContentFromRows` also
    //     coerces the deviations a model reliably produces (bare-string cells,
    //     array-of-arrays rows, a `content` key instead of `text`).
    //   • FLAT TEXT — a model put a `|`/newline table in the `text` field.
    //   • DIMENSIONS sugar — `rows`/`cols` as numbers (+ `withHeaderRow`), used
    //     by the slash menu / e2e / playground to drop a blank N×M grid.
    const inputAny = input as {
      rows?: unknown
      cols?: unknown
      withHeaderRow?: unknown
      text?: unknown
    }
    if (defaults.preserveContent && defaults.content && t.validContent(defaults.content)) {
      return t.create(attrs, defaults.content, defaults.marks)
    }
    // POPULATED. Silent-loss guard: a populated attempt that recovered NO text
    // although the raw input carried some means the cells sat under a shape we
    // can't map. Reject (null) so `insertBlocks` surfaces
    // `explainBlockInputRejection`'s actionable signal instead of a blank table
    // reported as success. A genuinely all-empty populated request (no
    // text anywhere) still builds: that's a valid empty table, not a dropped one.
    if (Array.isArray(inputAny.rows) && inputAny.rows.length > 0) {
      if (!tableInputRecoversText(inputAny.rows) && tableInputCarriesText(inputAny.rows)) {
        return null
      }
      const colWidth = computeFitColWidth(editor, tableColCount(inputAny.rows))
      const content = buildTableContentFromRows(schema, inputAny.rows as RuneTableRow[], { colWidth })
      return t.create(attrs, content, defaults.marks)
    }
    // FLAT TEXT — only when `rows` isn't a (handled) array. Parse the pipe table;
    // if it yields cells, build a populated table. Text present but not a grid
    // (e.g. prose) → reject for a correction signal, not a silently blank table.
    if (
      !Array.isArray(inputAny.rows) &&
      typeof inputAny.text === "string" &&
      inputAny.text.trim().length > 0
    ) {
      const parsed = parseFlatTableText(inputAny.text)
      if (parsed && tableInputRecoversText(parsed)) {
        const colWidth = computeFitColWidth(editor, tableColCount(parsed))
        return t.create(attrs, buildTableContentFromRows(schema, parsed, { colWidth }), defaults.marks)
      }
      return null
    }
    // DIMENSIONS sugar / blank default.
    const rows = typeof inputAny.rows === "number"
      ? Math.max(1, inputAny.rows)
      : DEFAULT_TABLE_ROWS
    const cols = typeof inputAny.cols === "number"
      ? Math.max(1, inputAny.cols)
      : DEFAULT_TABLE_COLS
    const withHeaderRow = inputAny.withHeaderRow !== false
    // Fit the fresh table to the current editor block-content width
    // (the layout context where the table will live, measured directly
    // — NOT computed by subtracting hard-coded chrome). Returns
    // undefined when no editor is mounted or no measurable block-
    // content exists (SSR / pre-mount); `buildDefaultTableContent`
    // then falls back to the 235px-per-column legacy default.
    const colWidth = computeFitColWidth(editor, cols)
    const content = buildDefaultTableContent(schema, rows, cols, { withHeaderRow, colWidth })
    return t.create(attrs, content, defaults.marks)
  },
  toRuneBlock: (node) => {
    const rows: RuneTableRow[] = []
    node.forEach((rowNode) => {
      const cells: RuneTableCellContent[] = []
      let isHeader = false
      rowNode.forEach((cellNode) => {
        if (cellNode.type.name === "tableHeader") isHeader = true
        cells.push({ text: cellNode.textContent })
      })
      rows.push({ cells, isHeader })
    })
    return {
      type: "table",
      id: typeof node.attrs.id === "string" ? node.attrs.id : "",
      depth: typeof node.attrs.depth === "number" ? node.attrs.depth : 0,
      rows,
    }
  },
})

export interface RuneTableCellContent {
  text: string
}
export interface RuneTableRow {
  cells: RuneTableCellContent[]
  isHeader: boolean
}
export interface RuneTableBlock extends RuneBlockBase {
  type: "table"
  rows: RuneTableRow[]
}

// Re-exports so external consumers can configure custom kits without
// having to know the per-file layout.
export { TableRow, TableCell, TableHeader, TableParagraph } from "./nodes"
export { TableSupport } from "./TableSupport"
export { TableMergedCellsGuard } from "./TableMergedCellsGuard"
export { TableCellNormalization } from "./normalization"
export { TableCommands, isTableHeaderRow, isTableHeaderColumn, type InsertTableOptions } from "./TableCommands"
export { CellSelectionEdges } from "./CellSelectionEdges"
export { TableMouseSelection } from "./TableMouseSelection"
export { PinColumnWidths } from "./PinColumnWidths"
export { findCellBefore, findCellContext } from "./utilities/findCellContext"
export type { CellContext } from "./utilities/findCellContext"
export { resolveTableFromFrame, type ResolvedTable } from "./utilities/resolveTableFromFrame"
export {
  CellHandlePills,
  PILL_ORIGIN_META,
  PILL_DROPDOWN_META,
  cellHandlePillsKey,
  selectFullColumn,
  selectFullRow,
  type PillDropdownState,
} from "./CellHandlePills"
export { TableExtendButtons } from "./TableExtendButtons"
export { CellHandleDrag } from "./CellHandleDrag"
