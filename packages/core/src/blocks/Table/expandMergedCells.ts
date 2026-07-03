// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Rewrite pasted HTML so that every <table> contains only 1×1 cells.
// Input:  <tr><td colspan="2">X</td></tr><tr><td>A</td><td>B</td></tr>
// Output: <tr><td>X</td><td></td></tr><tr><td>A</td><td>B</td></tr>
//
// Cells with rowspan > 1 expand downward: the origin keeps its content and
// attrs (with colspan/rowspan stripped), and the "absorbed" positions become
// empty cells matching the receiving row's tag preference (<td> or <th>).
// The grid is rectangularized to max observed width so PM's table schema
// accepts it without fixTables intervention.
//
// This runs in transformPastedHTML before ProseMirror parses the paste.
// Used by TableMergedCellsGuard.

type Origin = { row: number; col: number; cell: HTMLElement }

// Generous for any legitimate spreadsheet merge, but bounded so a hostile
// clipboard span (e.g. `rowspan="99999999"`) can't force an unbounded
// number of occupied-cell allocations in expandTable's scan loop.
const MAX_SPAN = 1000

export function expandMergedCells(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  for (const table of Array.from(doc.querySelectorAll('table'))) {
    expandTable(table as HTMLTableElement)
  }
  return doc.body.innerHTML
}

function expandTable(table: HTMLTableElement): void {
  const rowSelector =
    ':scope > tbody > tr, :scope > thead > tr, :scope > tfoot > tr, :scope > tr'
  const rows = Array.from(table.querySelectorAll(rowSelector)) as HTMLElement[]
  if (rows.length === 0) return

  const occupied = new Map<number, Set<number>>()
  const origins: Origin[] = []
  const rowTag: Array<'td' | 'th'> = []
  let maxWidth = 0

  for (let r = 0; r < rows.length; r++) {
    const rowEl = rows[r]
    if (!rowEl) continue
    const cells = (Array.from(rowEl.children) as HTMLElement[]).filter(
      (el) => el.tagName === 'TD' || el.tagName === 'TH',
    )
    rowTag[r] = cells.some((c) => c.tagName === 'TH') ? 'th' : 'td'

    let cursor = 0
    for (const cell of cells) {
      while (isOccupied(occupied, r, cursor)) cursor++
      const colspan = clampSpan(cell.getAttribute('colspan'))
      const rowspan = clampSpan(cell.getAttribute('rowspan'))
      origins.push({ row: r, col: cursor, cell })
      for (let dr = 0; dr < rowspan; dr++) {
        for (let dc = 0; dc < colspan; dc++) {
          if (dr === 0 && dc === 0) continue
          markOccupied(occupied, r + dr, cursor + dc)
        }
      }
      cursor += colspan
    }
    maxWidth = Math.max(maxWidth, cursor)
  }

  // Some rowspans may extend past the last <tr> (malformed source).
  // We don't invent extra rows — those spans are just truncated.

  const originAt = new Map<string, Origin>()
  for (const o of origins) originAt.set(`${o.row},${o.col}`, o)

  const ownerDoc = table.ownerDocument
  for (let r = 0; r < rows.length; r++) {
    const oldRow = rows[r]
    if (!oldRow) continue
    const newRow = ownerDoc.createElement('tr')
    for (const attr of Array.from(oldRow.attributes)) {
      newRow.setAttribute(attr.name, attr.value)
    }
    const cellTag = rowTag[r] ?? 'td'
    for (let c = 0; c < maxWidth; c++) {
      const origin = originAt.get(`${r},${c}`)
      if (origin) {
        const fresh = origin.cell.cloneNode(true) as HTMLElement
        fresh.removeAttribute('colspan')
        fresh.removeAttribute('rowspan')
        newRow.appendChild(fresh)
      } else {
        newRow.appendChild(ownerDoc.createElement(cellTag))
      }
    }
    oldRow.replaceWith(newRow)
  }
}

function clampSpan(raw: string | null): number {
  if (!raw) return 1
  const n = parseInt(raw, 10)
  if (!Number.isFinite(n) || n <= 0) return 1
  return Math.min(n, MAX_SPAN)
}

function isOccupied(map: Map<number, Set<number>>, r: number, c: number): boolean {
  return map.get(r)?.has(c) ?? false
}

function markOccupied(map: Map<number, Set<number>>, r: number, c: number): void {
  let set = map.get(r)
  if (!set) {
    set = new Set()
    map.set(r, set)
  }
  set.add(c)
}
