// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { Editor, JSONContent } from "@tiptap/core"
import type { EditorView } from "@tiptap/pm/view"
import { Slice, Fragment, type Node as PMNode, type Schema } from "@tiptap/pm/model"
import { isInTable } from "@tiptap/pm/tables"
import { isMarkdown } from "./isMarkdown"
import { clipboardTextParser } from "./clipboardTextParser"
import { markPastedImagesInDoc } from "../../blocks/Image/transformPastedImageHTML"
import { collectMarkdownContracts, parseMarkdown } from "../../markdown"

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
 * Markdown → PM slice through the STORAGE codec — the same `parseMarkdown` that
 * reads a `.md` file off disk. Shared by the plain-text Markdown branch and VS
 * Code's `markdown` mode so the two never drift.
 *
 * This used to render Markdown → HTML with markdown-it and hand the result to
 * PM's `parseSlice`, which made pasting a second, divergent implementation of
 * "Markdown → document". Measured over 1,118 real files, the two agreed on only
 * 14.8% of them: the HTML detour turned soft wraps into `hardBreak`s, tore a
 * paragraph apart around an inline image, degraded raw HTML instead of keeping
 * its bytes, and left a stray `code` mark plus a trailing newline inside every
 * fenced block. One implementation makes those disagreements unrepresentable
 * rather than merely fixed.
 */
function markdownToSlice(view: EditorView, editor: Editor, text: string): Slice {
  const schema = view.state.schema
  const contracts = collectMarkdownContracts(editor.extensionManager.extensions)
  const { doc, frontmatter } = parseMarkdown(text, { contracts })
  const json = markPastedImagesInDoc(withFrontmatter(doc, frontmatter, schema), view, editor)
  return openBoundarySlice(schema.nodeFromJSON(json))
}

/**
 * Frontmatter comes back carved off, because on the FILE path the caller owns
 * it (rune converts, zyler owns the file). A paste has no file to hand it to,
 * so carving it here would silently swallow the top of whatever was copied —
 * put it back as body content instead, keeping its bytes, visible and
 * deletable.
 *
 * Byte-faithful modulo the two normalizations `parseMarkdown` declares at its
 * entry (BOM dropped, CRLF → LF; PRD D14): the fences it strips are exactly the
 * `---` lines this re-adds.
 */
function withFrontmatter(
  doc: JSONContent,
  frontmatter: string | null,
  schema: Schema,
): JSONContent {
  if (frontmatter === null) return doc
  const source = `---\n${frontmatter}\n---`
  // A kit built without RawBlock still must not lose the text — and must not
  // throw out of `nodeFromJSON` mid-paste either. Degrade to a paragraph, which
  // every kit has.
  const carrier: JSONContent = schema.nodes["rawBlock"]
    ? { type: "rawBlock", attrs: { source, origin: "markdown" } }
    : { type: "paragraph", content: [{ type: "text", text: source }] }
  return { ...doc, content: [carrier, ...(doc.content ?? [])] }
}

/**
 * Blocks are top-level siblings here, so slice openness is a one-level
 * question — but the test is block IDENTITY, not `isTextblock`.
 *
 * In this schema a container is still a textblock: `callout` and `toggle` hold
 * `inline*` and express containment through `depth`, exactly like `paragraph`
 * and `heading`. So `isTextblock` matches nearly every block, and opening on it
 * dissolves a leading callout — `replaceSelection` merges its inline content
 * into the target paragraph and the callout node disappears. `Slice.maxOpen` is
 * wrong here for the same reason, and more aggressively.
 *
 * `paragraph` is the one block with no identity to lose, which makes it the
 * right and only thing to open: pasting a sentence into the middle of a
 * paragraph merges inline, while a heading, callout, code block or divider at
 * the boundary arrives as itself.
 */
function openBoundarySlice(doc: PMNode): Slice {
  const opens = (node: PMNode | null | undefined) => (node?.type.name === "paragraph" ? 1 : 0)
  return new Slice(doc.content, opens(doc.firstChild), opens(doc.lastChild))
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
