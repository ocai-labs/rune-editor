// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { createBlockSpec, createBlockExtension, readBlockInputText, inlineContentFromText } from "../../schema"
import { nearestBodyBlock } from "../../schema/bodySurface"
import { insertOrUpdateBlockForSlashMenu } from "../../extensions/suggestion-menus"
import type { RuneBlockBase } from "../../types"

export interface RuneBlockquoteBlock extends RuneBlockBase {
  type: "blockquote"
  text: string
}

export const Blockquote = createBlockSpec({
  type: "blockquote",
  content: "inline*",
  schemaContext: {
    input: {
      examples: [{ type: "blockquote", text: "Example quote" }],
    },
  },
  toRuneBlock: (node) => ({
    type: "blockquote",
    id: typeof node.attrs.id === "string" ? node.attrs.id : "",
    depth: typeof node.attrs.depth === "number" ? node.attrs.depth : 0,
    text: node.textContent,
  }),
  fromInput: ({ schema, input, defaults }) => {
    const t = schema.nodes["blockquote"]
    if (!t) return null
    const text = readBlockInputText(input)
    const attrs = {
      ...defaults.attrs,
      id: input.id ?? null,
      depth: input.depth ?? defaults.depth,
    }
    const content =
      defaults.preserveContent && defaults.content && t.validContent(defaults.content)
        ? defaults.content
        : text ? inlineContentFromText(schema, text) : undefined
    return t.create(attrs, content, defaults.marks)
  },
  parseDOM: [{ tag: "blockquote" }],
  renderDOM: ({ HTMLAttributes }) => {
    const outer = HTMLAttributes
    const contentAttrs: Record<string, string> = { class: "rune-block-content" }
    return [
      "div",
      { ...outer, class: "rune-block" },
      ["div", contentAttrs, ["blockquote", {}, 0]],
    ]
  },
  toMarkdown({ prefix, serializeInline, node }) {
    return { line: `${prefix}> ${serializeInline(node)}` }
  },
  clipboardRenderDOM: () => ["blockquote", 0],
  slashMenuItems: () => {
    const block = { type: "blockquote" }
    return [
      {
        key: "blockquote",
        title: "Quote",
        aliases: ["quote", "blockquote", ">"],
        group: "Basic blocks",
        block,
        onItemClick: (ctx) => insertOrUpdateBlockForSlashMenu(ctx, block),
      },
    ]
  },
  sideMenu: { draggable: true },
  extensions: [
    createBlockExtension({
      key: "input-rule",
      inputRules: [{ find: /^>\s$/, replace: () => ({ type: "blockquote" }) }],
    }),
    createBlockExtension({
      key: "blockquote-keys",
      priority: 1100,
      keyboardShortcuts: {
        Enter: ({ editor }) => {
          const { state } = editor
          const { $from } = state.selection
          if ($from.depth < 1) return false
          const block = nearestBodyBlock(editor, $from)?.node
          if (block?.type.name !== "blockquote") return false
          if (block.content.size > 0) return false
          const depth = (block.attrs.depth as number | undefined) ?? 0
          if (depth > 0) return false
          const id = block.attrs.id as string | undefined
          if (!id) return false
          return editor.commands.updateBlock(id, { type: "paragraph" })
        },
      },
    }),
  ],
})
