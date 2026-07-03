// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { TableMap } from "@tiptap/pm/tables"
import type { Node as PMNode } from "@tiptap/pm/model"
import type { EditorView } from "@tiptap/pm/view"

export interface ResolvedTable {
  tableNode: PMNode
  /** Position right before the table node (i.e., `<…>|<table>…`). */
  tablePos: number
  /** First position inside the table node (i.e., `<table>|<row>…`).
   *  Equal to `tablePos + 1`. Use this where prosemirror-tables APIs
   *  (`addColumn`, `addRow`, etc.) expect "tableStart". */
  tableStart: number
  map: TableMap
}

/**
 * Resolve the live PM doc context for a `.rune-table-frame` DOM element.
 *
 * Designed for plugin views that mount chrome inside a table NodeView and
 * later need a fresh table doc position when the user clicks. NEVER
 * cache the return value across PM transactions; resolve fresh on every
 * event. The helper exists precisely to make that cheap.
 *
 * Implementation note: we anchor `posAtDOM` to the inner `<tbody>` (the
 * NodeView's contentDOM) rather than to the frame wrapper itself. PM's
 * `posAtDOM(contentDOM, 0)` is well-defined: it returns the position
 * before contentDOM's first child node — i.e., `tableStart`. Anchoring
 * to a non-content wrapper (`.rune-table-frame`) is spec-ambiguous and
 * may return a position outside the table on some PM versions.
 *
 * Returns null if:
 *   - the frame element is no longer attached to the editor's DOM
 *   - the frame doesn't contain a `<tbody>` (e.g., during initial mount)
 *   - posAtDOM throws (jsdom edge cases)
 *   - the resolved position is not inside a table-role node
 */
export function resolveTableFromFrame(
  view: EditorView,
  frameEl: HTMLElement,
): ResolvedTable | null {
  if (!view.dom.contains(frameEl)) return null
  const tbody = frameEl.querySelector("tbody")
  if (!tbody) return null

  let tableStart: number
  try {
    tableStart = view.posAtDOM(tbody, 0)
  } catch {
    return null
  }
  if (tableStart < 0) return null

  const $p = view.state.doc.resolve(tableStart)
  const tableNode = $p.parent
  if (tableNode.type.spec.tableRole !== "table") return null

  const tablePos = tableStart - 1
  const map = TableMap.get(tableNode)
  return { tableNode, tablePos, tableStart, map }
}
