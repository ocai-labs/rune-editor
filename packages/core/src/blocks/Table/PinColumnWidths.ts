// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { Extension } from "@tiptap/core"
import { Plugin, PluginKey } from "@tiptap/pm/state"
import type { EditorView } from "@tiptap/pm/view"
import { TableMap } from "@tiptap/pm/tables"
import { INTERNAL_NORMALIZATION_META } from "../../extensions/internal-meta"

// Return contract:
//   true  → done for this attempt; no retry needed (success, no-op, or
//           structural miss that retrying won't fix).
//   false → transient zero-width measurement detected; caller should
//           retry once on the next animation frame.
// Only the "any width measured 0" case returns false. Structural misses
// (no <tr>, posAtDOM resolves to -1, no enclosing table node) return
// true — they're either stable shapes a retry won't recover or signals
// that the DOM/PM doc are out of sync in a way that will resolve via
// regular plugin updates, not via re-running the pin pass.
function pinAllColumnWidths(view: EditorView, tableDom: HTMLTableElement) {
  const firstRow = tableDom.querySelector("tr")
  if (!firstRow) return true

  const widths: number[] = []
  firstRow.querySelectorAll<HTMLElement>("th, td").forEach((cell) => {
    widths.push(Math.round(cell.getBoundingClientRect().width))
  })

  const domPos = view.posAtDOM(tableDom, 0)
  if (domPos < 0) return true

  const $pos = view.state.doc.resolve(domPos)
  let tableNode = null
  let tableStart = 0
  for (let depth = $pos.depth; depth >= 0; depth -= 1) {
    if ($pos.node(depth).type.name === "table") {
      tableNode = $pos.node(depth)
      tableStart = $pos.before(depth) + 1
      break
    }
  }
  if (!tableNode) return true

  const map = TableMap.get(tableNode)
  const tr = view.state.tr
  const seen = new Set<number>()
  let needsRetry = false

  for (let row = 0; row < map.height; row += 1) {
    for (let col = 0; col < map.width; col += 1) {
      const relPos = map.map[row * map.width + col]
      if (relPos === undefined) continue
      if (seen.has(relPos)) continue
      seen.add(relPos)

      const cellNode = tableNode.nodeAt(relPos)
      if (!cellNode) continue

      const colspan = cellNode.attrs.colspan ?? 1
      const existing = cellNode.attrs.colwidth as number[] | null
      const hasAll =
        Array.isArray(existing) &&
        existing.length === colspan &&
        existing.every((w) => typeof w === "number" && w > 0)
      if (hasAll) continue

      const colwidth: number[] = []
      for (let i = 0; i < colspan; i += 1) {
        const width = widths[col + i] ?? 0
        colwidth.push(width)
        if (width === 0) needsRetry = true
      }

      tr.setNodeMarkup(tableStart + relPos, undefined, {
        ...cellNode.attrs,
        colwidth,
      })
    }
  }

  if (needsRetry) return false
  if (!tr.docChanged) return true
  tr.setMeta("addToHistory", false)
  tr.setMeta(INTERNAL_NORMALIZATION_META, true)
  view.dispatch(tr)
  return true
}

type PinScheduleState = {
  destroyed: boolean
  frameIds: number[]
}

function schedulePin(view: EditorView, attempts: number, state: PinScheduleState) {
  let frameId = 0
  const run = () => {
    if (state.destroyed) return
    state.frameIds = state.frameIds.filter((id) => id !== frameId)
    let pinned = true
    view.dom.querySelectorAll<HTMLTableElement>("table").forEach((tableDom) => {
      if (!pinAllColumnWidths(view, tableDom)) pinned = false
    })
    if (!pinned && attempts < 1 && !state.destroyed) schedulePin(view, attempts + 1, state)
  }
  frameId = requestAnimationFrame(run)
  state.frameIds.push(frameId)
  return {
    destroy() {
      state.destroyed = true
      state.frameIds.forEach((id) => cancelAnimationFrame(id))
      state.frameIds = []
    },
  }
}

export const PinColumnWidths = Extension.create({
  name: "pinColumnWidths",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("rune-pin-column-widths"),
        view(view) {
          const state: PinScheduleState = { destroyed: false, frameIds: [] }
          const scheduled = schedulePin(view, 0, state)
          return {
            destroy() {
              scheduled.destroy()
            },
          }
        },
      }),
    ]
  },
})

/** @internal */
export const __internals = { pinAllColumnWidths }
