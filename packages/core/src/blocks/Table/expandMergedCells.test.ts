// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, it, expect } from 'vitest'
import { expandMergedCells } from './expandMergedCells'

// Read back a table's grid shape (cells per row) and span attrs.
function shape(html: string): { rows: number[]; allOne: boolean } {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const table = doc.querySelector('table')
  if (!table) return { rows: [], allOne: true }
  const rows = Array.from(
    table.querySelectorAll(
      ':scope > tbody > tr, :scope > thead > tr, :scope > tfoot > tr, :scope > tr',
    ),
  )
  const counts = rows.map(
    (r) => r.querySelectorAll(':scope > td, :scope > th').length,
  )
  const cells = Array.from(table.querySelectorAll('td, th'))
  const allOne = cells.every(
    (c) =>
      (c.getAttribute('colspan') ?? null) === null &&
      (c.getAttribute('rowspan') ?? null) === null,
  )
  return { rows: counts, allOne }
}

describe('expandMergedCells', () => {
  it('leaves HTML without tables untouched', () => {
    const input = '<p>hello <strong>world</strong></p>'
    expect(expandMergedCells(input)).toBe(input)
  })

  it('leaves a 2x2 1x1 table untouched in shape', () => {
    const html = '<table><tbody><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></tbody></table>'
    const out = expandMergedCells(html)
    expect(shape(out)).toEqual({ rows: [2, 2], allOne: true })
    expect(out).toContain('A')
    expect(out).toContain('D')
  })

  it('expands colspan=2 to two cells (second is empty)', () => {
    const html = '<table><tbody><tr><td colspan="2">X</td></tr><tr><td>A</td><td>B</td></tr></tbody></table>'
    const { rows, allOne } = shape(expandMergedCells(html))
    expect(rows).toEqual([2, 2])
    expect(allOne).toBe(true)
  })

  it('expands rowspan=2 to two rows (second is empty at that column)', () => {
    const html = '<table><tbody><tr><td rowspan="2">X</td><td>B</td></tr><tr><td>C</td></tr></tbody></table>'
    expect(shape(expandMergedCells(html))).toEqual({ rows: [2, 2], allOne: true })
  })

  it('expands combined colspan=2 + rowspan=2 (2x2 block in a 3x3 grid)', () => {
    const html = `<table><tbody>
      <tr><td colspan="2" rowspan="2">X</td><td>B</td></tr>
      <tr><td>C</td></tr>
      <tr><td>D</td><td>E</td><td>F</td></tr>
    </tbody></table>`
    expect(shape(expandMergedCells(html))).toEqual({ rows: [3, 3, 3], allOne: true })
  })

  it('preserves the receiving row tag: <th> row stays <th>, <td> row stays <td>', () => {
    const html = '<table><tbody><tr><th colspan="2">H</th></tr><tr><td>A</td><td>B</td></tr></tbody></table>'
    const doc = new DOMParser().parseFromString(expandMergedCells(html), 'text/html')
    const r0 = doc.querySelectorAll('tr')[0]?.children
    expect(r0?.[0]?.tagName).toBe('TH')
    expect(r0?.[1]?.tagName).toBe('TH') // filler inherits row tag
    const r1 = doc.querySelectorAll('tr')[1]?.children
    expect(r1?.[0]?.tagName).toBe('TD')
  })

  it('handles tables with no <tbody> wrapper (bare <tr> children)', () => {
    const html = '<table><tr><td colspan="2">X</td></tr><tr><td>A</td><td>B</td></tr></table>'
    expect(shape(expandMergedCells(html))).toEqual({ rows: [2, 2], allOne: true })
  })

  it('expands colspan inside <tfoot>', () => {
    const html = '<table><tfoot><tr><td colspan="2">F</td></tr></tfoot></table>'
    expect(shape(expandMergedCells(html))).toEqual({ rows: [2], allOne: true })
  })

  it('expands colspan inside <thead>', () => {
    const html = '<table><thead><tr><th colspan="3">title</th></tr></thead><tbody><tr><td>A</td><td>B</td><td>C</td></tr></tbody></table>'
    expect(shape(expandMergedCells(html))).toEqual({ rows: [3, 3], allOne: true })
  })

  it('clamps colspan="0" to 1 (some sources emit 0 as "rest of row")', () => {
    const html = '<table><tbody><tr><td colspan="0">X</td><td>B</td></tr></tbody></table>'
    // With clampSpan treating 0 as 1, the origin cell occupies column 0 only;
    // the row width = 2 (B at column 1), so no filler is added.
    expect(shape(expandMergedCells(html))).toEqual({ rows: [2], allOne: true })
  })

  it('clamps negative / non-numeric rowspan to 1', () => {
    const html = '<table><tbody><tr><td rowspan="-1">X</td></tr><tr><td rowspan="abc">Y</td></tr></tbody></table>'
    expect(shape(expandMergedCells(html))).toEqual({ rows: [1, 1], allOne: true })
  })

  it('truncates rowspan that extends past the last <tr> (malformed source)', () => {
    const html = '<table><tbody><tr><td rowspan="5">X</td><td>B</td></tr><tr><td>C</td></tr></tbody></table>'
    // Source claims X spans 5 rows, but only 2 rows exist. Per the docstring,
    // those spans are truncated — no extra rows invented. Result: 2 rows, both 2 wide.
    expect(shape(expandMergedCells(html))).toEqual({ rows: [2, 2], allOne: true })
  })

  it('preserves row-level attributes (class, style, data-*)', () => {
    const html = '<table><tbody><tr class="hdr" data-x="y"><td colspan="2">X</td></tr></tbody></table>'
    const out = expandMergedCells(html)
    expect(out).toContain('class="hdr"')
    expect(out).toContain('data-x="y"')
  })

  it('processes multiple tables in one fragment independently', () => {
    const html =
      '<table><tbody><tr><td colspan="2">X</td></tr></tbody></table>' +
      '<p>between</p>' +
      '<table><tbody><tr><td rowspan="2">Y</td><td>B</td></tr><tr><td>C</td></tr></tbody></table>'
    const doc = new DOMParser().parseFromString(expandMergedCells(html), 'text/html')
    const tables = doc.querySelectorAll('table')
    expect(tables.length).toBe(2)
    // First table: 1 row, 2 cells (from colspan=2 expansion).
    expect(tables[0]?.querySelectorAll('tr').length).toBe(1)
    expect(tables[0]?.querySelectorAll('td').length).toBe(2)
    // Second table: 2 rows, 2 wide.
    expect(tables[1]?.querySelectorAll('tr').length).toBe(2)
    expect(tables[1]?.querySelectorAll('td').length).toBe(4)
    expect(doc.querySelector('p')?.textContent).toBe('between')
  })

  it('does not throw on a zero-row table and returns zero rows', () => {
    const html = '<table></table>'
    expect(() => expandMergedCells(html)).not.toThrow()
    expect(shape(expandMergedCells(html))).toEqual({ rows: [], allOne: true })
  })

  it('caps a hostile colspan to MAX_SPAN instead of allocating unbounded cells', () => {
    // Regression for a paste-bomb DoS: `<td colspan="99999999">` used to make
    // expandTable allocate one Set entry per (row, col) pair up to the raw
    // span, throwing `RangeError: Set maximum size exceeded` after several
    // seconds of blocked main-thread work. It must now be clamped.
    const html =
      '<table><tbody><tr><td colspan="99999999">X</td><td>B</td></tr></tbody></table>'
    let out = ''
    expect(() => {
      out = expandMergedCells(html)
    }).not.toThrow()
    const { rows, allOne } = shape(out)
    // Origin cell occupies columns [0, 1000); B lands at column 1000, so the
    // row is 1001 wide, not 99999999 + 1.
    expect(rows).toEqual([1001])
    expect(allOne).toBe(true)
  }, 2000)

  it('caps a hostile rowspan to MAX_SPAN instead of allocating unbounded cells', () => {
    const html = '<table><tbody><tr><td rowspan="99999999">X</td></tr></tbody></table>'
    expect(() => expandMergedCells(html)).not.toThrow()
    // Source only has 1 <tr>; expandTable never invents rows, so the capped
    // rowspan is truncated to the single existing row regardless.
    expect(shape(expandMergedCells(html))).toEqual({ rows: [1], allOne: true })
  }, 2000)

  it('caps combined colspan+rowspan without throwing or timing out', () => {
    const html =
      '<table><tbody><tr><td colspan="99999999" rowspan="99999999">X</td></tr></tbody></table>'
    expect(() => expandMergedCells(html)).not.toThrow()
    expect(shape(expandMergedCells(html))).toEqual({ rows: [1000], allOne: true })
  }, 2000)

  it('still fully expands a legitimate small span (invariant: merged cells expand, never clamp to 1)', () => {
    const html = '<table><tbody><tr><td rowspan="3">X</td><td>B</td></tr><tr><td>C</td></tr><tr><td>D</td></tr></tbody></table>'
    expect(shape(expandMergedCells(html))).toEqual({ rows: [2, 2, 2], allOne: true })
  })
})
