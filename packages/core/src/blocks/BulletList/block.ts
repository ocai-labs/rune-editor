// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { createBlockExtension, createBlockSpec, readBlockInputText, inlineContentFromText } from "../../schema"
import { insertOrUpdateBlockForSlashMenu } from "../../extensions/suggestion-menus"
import type { RuneBlockBase } from "../../types"
import { listChainDragRange } from "../list-shared/dragChainRange"
import { parseListDepth } from "../list-shared/parseDepth"

export interface RuneBulletListBlock extends RuneBlockBase {
  type: "bulletList"
  text: string
}

export const BulletList = createBlockSpec({
  type: "bulletList",
  content: "inline*",
  indent: { mode: "structural" },
  schemaContext: {
    input: {
      examples: [{ type: "bulletList", text: "Example item" }],
    },
  },
  toRuneBlock: (node) => ({
    type: "bulletList",
    id: typeof node.attrs.id === "string" ? node.attrs.id : "",
    depth: typeof node.attrs.depth === "number" ? node.attrs.depth : 0,
    text: node.textContent,
  }),
  fromInput: ({ schema, input, defaults }) => {
    const t = schema.nodes["bulletList"]
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
    // Round-trip rune's own getHTML output: renderDOM emits the outer
    // `.rune-bullet-list` div carrying id/depth (data-id/data-depth, read
    // by the factory's shared attr parseHTML off this same matched
    // element). contentElement points PM at the inner <p> so the shared
    // inline content is taken from THERE — without it, PM would walk the
    // outer div's children and let the Paragraph rule claim the inner <p>
    // as a sibling node, degrading the block to a plain paragraph.
    {
      tag: "div.rune-block.rune-bullet-list",
      priority: 60,
      contentElement: (node: globalThis.Node) => {
        const el = node as HTMLElement
        return el.querySelector(":scope > .rune-block-content > p") ?? el
      },
    },
    {
      tag: "ul > li",
      priority: 51,
      getAttrs: (el) => {
        const element = el as HTMLElement
        const depth = parseListDepth(element)
        if (depth > 0) element.setAttribute("data-depth", String(depth))
        return { depth }
      },
    },
  ],
  renderDOM: ({ HTMLAttributes }) => {
    const outer = HTMLAttributes
    const contentAttrs: Record<string, string> = { class: "rune-block-content" }
    return [
      "div",
      { ...outer, class: "rune-block rune-bullet-list" },
      [
        "div",
        contentAttrs,
        ["p", {}, 0],
      ],
    ]
  },
  toMarkdown({ prefix, serializeInline, node }) {
    return { line: `${prefix}- ${serializeInline(node)}`, spacing: "list-item" }
  },
  clipboardRenderDOM: () => ["ul", {}, ["li", {}, 0]],
  slashMenuItems: () => {
    const block = { type: "bulletList" }
    return [
      {
        key: "bulletList",
        title: "Bulleted list",
        aliases: ["ul", "bullet", "list", "•"],
        group: "Basic blocks",
        block,
        onItemClick: (ctx) => insertOrUpdateBlockForSlashMenu(ctx, block),
      },
    ]
  },
  dragSourceRange: ({ node, pos, doc, editor }) =>
    listChainDragRange({ node, pos, doc, editor }),
  sideMenu: { draggable: true },
  extensions: [
    createBlockExtension({
      key: "input-rule",
      inputRules: [{ find: /^[-*]\s$/, replace: () => ({ type: "bulletList" }) }],
    }),
  ],
})
