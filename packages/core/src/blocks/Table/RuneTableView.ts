// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import type { NodeView, EditorView, ViewMutationRecord } from "@tiptap/pm/view"

function getColumnWidths(node: ProseMirrorNode) {
  const widths: number[] = []
  const firstRow = node.firstChild
  if (!firstRow) return widths

  firstRow.forEach((cell) => {
    const width = Array.isArray(cell.attrs.colwidth) ? cell.attrs.colwidth[0] : null
    widths.push(typeof width === "number" ? width : 0)
  })
  return widths
}

export function updateRuneTableColumns(table: HTMLTableElement, node: ProseMirrorNode, cellMinWidth: number) {
  const colgroup = table.querySelector("colgroup") ?? table.insertBefore(table.ownerDocument.createElement("colgroup"), table.firstChild)
  const widths = getColumnWidths(node)
  let totalWidth = 0
  let fixedWidth = true

  while (colgroup.childElementCount < widths.length) {
    colgroup.appendChild(table.ownerDocument.createElement("col"))
  }

  for (let index = 0; index < widths.length; index += 1) {
    const col = colgroup.children.item(index)
    if (!col) continue
    const htmlCol = col as HTMLTableColElement
    const width = widths[index]
    const effectiveWidth = width || cellMinWidth
    totalWidth += effectiveWidth
    if (width) {
      htmlCol.style.width = `${width}px`
      htmlCol.style.minWidth = ""
    } else {
      fixedWidth = false
      htmlCol.style.width = ""
      htmlCol.style.minWidth = `${cellMinWidth}px`
    }
  }

  while (colgroup.childElementCount > widths.length) {
    colgroup.removeChild(colgroup.lastElementChild!)
  }

  if (fixedWidth) {
    table.style.width = `${totalWidth}px`
    table.style.minWidth = ""
  } else {
    table.style.width = ""
    table.style.minWidth = `${totalWidth}px`
  }
}

export function isRuneTableChromeEventTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  if (
    target.closest(
      ".rune-table, .rune-col-pill, .rune-row-pill, .rune-table-extend-col, .rune-table-extend-row, .column-resize-handle",
    )
  ) {
    return false
  }
  return target.closest(".rune-table-frame, .rune-table-chrome-padding, .rune-table-content, .rune-table-scroll") !== null
}

export class RuneTableView implements NodeView {
  dom: HTMLDivElement
  contentDOM: HTMLTableSectionElement
  private table: HTMLTableElement
  private cellMinWidth: number

  constructor(private node: ProseMirrorNode, cellMinWidth: number, view: EditorView) {
    this.cellMinWidth = cellMinWidth
    const doc = view.dom.ownerDocument

    this.dom = doc.createElement("div")
    this.dom.classList.add("rune-block")
    this.dom.dataset.blockType = "table"

    const content = doc.createElement("div")
    content.classList.add("rune-block-content")

    const scroll = doc.createElement("div")
    scroll.classList.add("rune-table-scroll")

    const contentTrack = doc.createElement("div")
    contentTrack.classList.add("rune-table-content")

    const chromePadding = doc.createElement("div")
    chromePadding.classList.add("rune-table-chrome-padding")

    const frame = doc.createElement("div")
    frame.classList.add("rune-table-frame")

    this.table = doc.createElement("table")
    this.table.classList.add("rune-table")
    this.contentDOM = doc.createElement("tbody")

    this.table.append(doc.createElement("colgroup"), this.contentDOM)
    frame.append(this.table)
    chromePadding.append(frame)
    contentTrack.append(chromePadding)
    scroll.append(contentTrack)
    content.append(scroll)
    this.dom.append(content)

    this.syncAttrs(node)
    updateRuneTableColumns(this.table, node, cellMinWidth)
  }

  private syncAttrs(node: ProseMirrorNode) {
    // Match the factory render contract: only emit data-id / data-depth when
    // they carry meaningful values. Empty id or depth=0 must not pollute the
    // DOM with empty / zero attrs (other blocks' renderDOM follows this rule;
    // see BLOCK_ATTRIBUTES handling in createSpec.ts).
    //
    // TODO(M8.x table coloring): when `table` joins BLOCK_COLOR_TYPES, also
    // sync `data-text-color` / `data-background-color` here. The columnResizing
    // plugin instantiates Views as `(node, cellMinWidth, view)` — there is no
    // HTMLAttributes channel, so color attrs must be read from `node.attrs`.
    const id = node.attrs.id
    if (typeof id === "string" && id.length > 0) this.dom.setAttribute("data-id", id)
    else this.dom.removeAttribute("data-id")

    // `data-depth` and `--rune-block-depth` MUST move together. Factory
    // renderDOM achieves this via mergeBlockHTMLAttributes; this NodeView
    // owns its DOM and so re-implements the same pair. Dropping the
    // setProperty line silently breaks visual indent — see the draggable-
    // blocks contract test in schema/blocks/depth-style-merge.test.ts.
    const depth = node.attrs.depth
    if (typeof depth === "number" && depth > 0) {
      this.dom.setAttribute("data-depth", String(depth))
      this.dom.style.setProperty("--rune-block-depth", String(depth))
    } else {
      this.dom.removeAttribute("data-depth")
      this.dom.style.removeProperty("--rune-block-depth")
    }
  }

  update(node: ProseMirrorNode) {
    if (node.type !== this.node.type) return false
    this.node = node
    this.syncAttrs(node)
    updateRuneTableColumns(this.table, node, this.cellMinWidth)
    return true
  }

  ignoreMutation(mutation: ViewMutationRecord) {
    return !this.contentDOM.contains(mutation.target) && mutation.target !== this.contentDOM
  }

  stopEvent(event: Event) {
    if (!isRuneTableChromeEventTarget(event.target)) return false
    if (event.type === "mousedown") event.preventDefault()
    return true
  }
}
