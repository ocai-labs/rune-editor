// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { createBlockSpec, createBlockExtension, readBlockInputText, inlineContentFromText } from "../../schema"
import type { RuneBlockBase } from "../../types"
import { insertOrUpdateBlockForSlashMenu } from "../../extensions/suggestion-menus"

// Paragraph has no per-block props. parseDOM matches `<p>`; renderDOM
// wraps in `.rune-block > .rune-block-content > <p>` so future block-
// level color paints inside the rhythm padding (see spec
// internal design notes).
// Shared id / depth come from the factory.
export const Paragraph = createBlockSpec({
  type: "paragraph",
  content: "inline*",
  supports: { textColor: true, backgroundColor: true },
  schemaContext: {
    input: {
      examples: [{ type: "paragraph", text: "Example text" }],
    },
  },
  toRuneBlock: (node) => ({
    type: "paragraph",
    id: typeof node.attrs.id === "string" ? node.attrs.id : "",
    depth: typeof node.attrs.depth === "number" ? node.attrs.depth : 0,
    text: node.textContent,
  }),
  fromInput: ({ schema, input, defaults }) => {
    const t = schema.nodes["paragraph"]
    if (!t) return null
    const text = readBlockInputText(input)
    const attrs = {
      ...defaults.attrs,
      id: input.id ?? null,
      depth: input.depth ?? defaults.depth,
    }
    const content =
      defaults.preserveContent &&
      defaults.content &&
      t.validContent(defaults.content)
        ? defaults.content
        : text
          ? inlineContentFromText(schema, text)
          : undefined
    return t.create(attrs, content, defaults.marks)
  },
  parseDOM: [
    {
      tag: "p",
      // Reject <p> directly inside table cells — those belong to
      // `tableParagraph` (declared in blocks/Table/nodes.ts). Using
      // getAttrs makes the rule order-independent: paragraph and
      // tableParagraph have symmetric, mutually-exclusive parent checks.
      getAttrs: (el) => {
        const parent = (el as HTMLElement).parentElement
        if (parent && (parent.tagName === "TD" || parent.tagName === "TH")) {
          return false
        }
        return null
      },
    },
  ],
  renderDOM: ({ HTMLAttributes }) => {
    // Block-level color attrs ride on the M3b inner wrapper
    // (.rune-block-content) so the colored pill hugs the content rectangle
    // and the rhythm gutter stays untinted. Outer .rune-block keeps
    // data-id / data-depth only. See spec §4.
    const {
      "data-text-color": textColor,
      "data-background-color": bgColor,
      ...outer
    } = HTMLAttributes
    const contentAttrs: Record<string, string> = { class: "rune-block-content" }
    if (textColor) contentAttrs["data-text-color"] = textColor
    if (bgColor) contentAttrs["data-background-color"] = bgColor
    return [
      "div",
      { ...outer, class: "rune-block" },
      ["div", contentAttrs, ["p", {}, 0]],
    ]
  },
  toMarkdown({ prefix, serializeInline, node }) {
    return { line: `${prefix}${serializeInline(node)}` }
  },
  clipboardRenderDOM: () => ["p", 0],
  slashMenuItems: () => {
    const block = { type: "paragraph" }
    return [
      {
        key: "paragraph",
        title: "Paragraph",
        aliases: ["p", "text"],
        group: "Basic blocks",
        block,
        onItemClick: (ctx) => insertOrUpdateBlockForSlashMenu(ctx, block),
      },
    ]
  },
  sideMenu: { draggable: true },
  extensions: [
    createBlockExtension({
      key: "extras",
      keyboardShortcuts: {
        "Mod-Alt-0": ({ editor }) => editor.commands.setNode("paragraph"),
      },
    }),
  ],
})

// Public shape of a paragraph in the block API (editor.document). Lives
// next to the block so adding a new block is a single-directory change.
export interface RuneParagraphBlock extends RuneBlockBase {
  type: "paragraph"
  text: string
}
