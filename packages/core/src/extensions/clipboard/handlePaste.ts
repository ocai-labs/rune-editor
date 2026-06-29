// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { Editor } from "@tiptap/core"
import type { EditorView } from "@tiptap/pm/view"
import { Slice, DOMParser as PMDOMParser } from "@tiptap/pm/model"
import { isInTable } from "@tiptap/pm/tables"
import { isMarkdown } from "./isMarkdown"
import { markdownToHtml } from "./markdownToHtml"
import { transformPastedHTML } from "./transformPastedHTML"

/**
 * Tiptap/PM `handlePaste` prop. Inspects clipboardData MIMEs and
 * intercepts two paths explicitly; everything else is left to PM's
 * default flow, which then calls our `transformPastedHTML` and/or
 * `clipboardTextParser` props.
 *
 * 1. `application/x-rune-doc` — the internal lossless round-trip path.
 * 2. Markdown text — when the clipboard carries NO rich `text/html` and
 *    the `text/plain` looks like Markdown (decision b: HTML always wins,
 *    so Notion / Google Docs keep their existing HTML path untouched).
 *
 * Malformed rune-doc (third-party app sharing the MIME, or schema
 * version mismatch from older rune) falls through to HTML/text rather
 * than silently failing the paste.
 */
export function handlePaste(view: EditorView, event: ClipboardEvent, editor: Editor): boolean {
  const data = event.clipboardData
  if (!data) return false

  if (data.types.includes("application/x-rune-doc")) {
    // Inside a table, defer to prosemirror-tables' own `handlePaste`
    // (the `tableEditing` plugin, registered AFTER us in the handlePaste
    // chain). Our plugin runs first, so a blanket `replaceSelection` here
    // would short-circuit pm-tables' cell-aware paste and CORRUPT the
    // grid: a CellSelection slice is `tableRow`/cell nodes with
    // openStart/openEnd = 1, and dropping that into a target cell via
    // replaceSelection multiplies columns and scrambles rows (only the
    // first copied row lands). Returning false lets pm-tables receive the
    // HTML-parsed slice and run clipCells/insertCells — tiling the copied
    // rectangle correctly from the target cell. The rune-doc lossless path
    // is irrelevant in-cell anyway: cells hold `tableParagraph`, not body
    // blocks, so there are no id/depth attrs to preserve.
    if (isInTable(view.state)) return false

    // slice param (PM's HTML-parsed result) is discarded on the rune-doc
    // branch: we trust our own JSON over PM's HTML round-trip, which is
    // lossy for BlockId / depth attrs even though renderDOM emits them.
    try {
      const json = data.getData("application/x-rune-doc")
      const pmSlice = Slice.fromJSON(view.state.schema, JSON.parse(json))
      event.preventDefault()
      view.dispatch(view.state.tr.replaceSelection(pmSlice))
      return true
    } catch {
      return false
    }
  }

  // Markdown text path. Gated to pure plain text (no HTML on the
  // clipboard), outside tables (defer to pm-tables / default), and
  // outside code blocks (paste must stay literal there). We render
  // Markdown → HTML and run it through the SAME `transformPastedHTML` +
  // DOMParser pipeline PM uses for HTML paste, so list flattening, table
  // expansion, code-language parsing and every inline mark are reused.
  if (
    !data.types.includes("text/html") &&
    !isInTable(view.state) &&
    !isInCodeBlock(view)
  ) {
    const text = data.getData("text/plain")
    if (text && isMarkdown(text)) {
      const html = transformPastedHTML(markdownToHtml(text), view, editor)
      const dom = new DOMParser().parseFromString(html, "text/html")
      const slice = PMDOMParser.fromSchema(view.state.schema).parseSlice(dom.body, {
        preserveWhitespace: true,
      })
      event.preventDefault()
      view.dispatch(view.state.tr.replaceSelection(slice))
      return true
    }
  }

  return false
}

/**
 * True when the selection head sits anywhere inside a code-like block.
 * Gates on `type.spec.code` (propagated from a block's `meta.code` by
 * createBlockSpec) rather than the `"codeBlock"` name, matching the
 * ancestor check kit.ts uses to suppress Markdown shortcuts — so any
 * future block declaring `meta.code: true` is covered too.
 */
function isInCodeBlock(view: EditorView): boolean {
  const { $from } = view.state.selection
  for (let depth = $from.depth; depth >= 0; depth--) {
    if ($from.node(depth).type.spec.code) return true
  }
  return false
}
