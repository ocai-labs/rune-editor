// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { Editor } from "@tiptap/core"
import type { EditorView } from "@tiptap/pm/view"
import { Slice, Fragment, DOMParser as PMDOMParser, type Schema } from "@tiptap/pm/model"
import { isInTable } from "@tiptap/pm/tables"
import { isMarkdown } from "./isMarkdown"
import { markdownToHtml } from "./markdownToHtml"
import { collectKnownBlockTags } from "./knownBlockTags"
import { transformPastedHTMLDoc } from "./transformPastedHTML"
import { clipboardTextParser } from "./clipboardTextParser"
import { transformPastedImageHTML } from "../../blocks/Image/transformPastedImageHTML"

/**
 * Tiptap/PM `handlePaste` prop. Inspects clipboardData MIMEs and
 * intercepts three paths explicitly; everything else is left to PM's
 * default flow, which then calls our `transformPastedHTML` and/or
 * `clipboardTextParser` props.
 *
 * 1. `application/x-rune-doc` — the internal lossless round-trip path.
 * 2. `vscode-editor-data` — content copied out of VS Code. Its `text/html`
 *    is a syntax-highlight snapshot (pure chrome), so we own the paste and
 *    route by the source language instead of letting that HTML through.
 * 3. Markdown text — when the clipboard carries NO rich `text/html` and
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

  // VS Code editor paste. Handled BEFORE the Markdown gate below: VS Code
  // always co-publishes a `text/html` highlight snapshot, so the
  // `!text/html` Markdown branch would skip it and PM would paste the
  // rainbow-colored spans verbatim.
  if (data.types.includes("vscode-editor-data")) {
    return handleVSCodePaste(view, event, editor)
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
      event.preventDefault()
      view.dispatch(view.state.tr.replaceSelection(markdownToSlice(view, editor, text)))
      return true
    }
  }

  return false
}

/**
 * VS Code writes `vscode-editor-data` (a JSON blob whose `mode` is the
 * source language) alongside a syntax-highlighted `text/html` that is pure
 * chrome. Pasting that HTML verbatim drops Markdown `#`/`**` in as styled
 * literal text and snaps the highlight colors to our palette — never what
 * the user wants. So we own the whole VS Code paste and route by language:
 *
 *   - `markdown`          → the same Markdown → blocks path as a plain-text
 *                           md paste (trusting VS Code's own `mode`, so no
 *                           `isMarkdown` heuristic is needed).
 *   - any other language  → a code block carrying that language.
 *   - plaintext / unknown → one paragraph per line (default text shape).
 *
 * Inside a table we defer to pm-tables (return false). Inside a code block
 * we insert the raw text literally, ignoring the language routing.
 */
function handleVSCodePaste(view: EditorView, event: ClipboardEvent, editor: Editor): boolean {
  const data = event.clipboardData
  if (!data) return false
  if (isInTable(view.state)) return false

  const text = data.getData("text/plain")
  if (!text) return false

  event.preventDefault()

  // In a code block the source stays literal — the language routing and the
  // highlight HTML are both irrelevant.
  if (isInCodeBlock(view)) {
    view.dispatch(view.state.tr.insertText(text))
    return true
  }

  const schema = view.state.schema
  const lang = readVSCodeLanguage(data)

  const slice =
    lang === "markdown"
      ? markdownToSlice(view, editor, text)
      : lang && lang !== "plaintext" && schema.nodes["codeBlock"]
        ? codeBlockSlice(schema, text, lang)
        : clipboardTextParser(text, view.state.selection.$from)

  view.dispatch(view.state.tr.replaceSelection(slice))
  return true
}

/** Reads the source language (`mode`) out of VS Code's clipboard metadata. */
function readVSCodeLanguage(data: DataTransfer): string | null {
  try {
    const meta = JSON.parse(data.getData("vscode-editor-data")) as { mode?: unknown }
    return typeof meta.mode === "string" ? meta.mode : null
  } catch {
    return null
  }
}

/**
 * Markdown → PM slice via the SAME schema-only transform core the headless
 * `markdownToDoc` import path uses, plus the live-view image step (paste can
 * upload). Shared by the plain-text Markdown branch and VS Code's `markdown`
 * mode so the two never drift.
 */
function markdownToSlice(view: EditorView, editor: Editor, text: string): Slice {
  const dom = new DOMParser().parseFromString(markdownToHtml(text), "text/html")
  transformPastedHTMLDoc(dom, collectKnownBlockTags(view.state.schema), (d) =>
    transformPastedImageHTML(d, view, editor),
  )
  return PMDOMParser.fromSchema(view.state.schema).parseSlice(dom.body, {
    preserveWhitespace: true,
  })
}

/** A single closed code block node carrying `language`, wrapped as a slice. */
function codeBlockSlice(schema: Schema, text: string, language: string): Slice {
  const node = schema.nodes["codeBlock"]!.create({ language }, schema.text(text))
  return new Slice(Fragment.from(node), 0, 0)
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
