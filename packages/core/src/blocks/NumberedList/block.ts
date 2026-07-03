// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { createBlockExtension, createBlockSpec, readBlockInputText, inlineContentFromText } from "../../schema"
import type { RuneBlockBase } from "../../types"
import { insertOrUpdateBlockForSlashMenu } from "../../extensions/suggestion-menus"
import { listChainDragRange } from "../list-shared/dragChainRange"
import { parseListDepth } from "../list-shared/parseDepth"

export interface RuneNumberedListBlock extends RuneBlockBase {
  type: "numberedList"
  text: string
  start: number | null
}

function parseListStart(el: HTMLElement) {
  const direct = el.getAttribute("data-start")
  if (direct != null) {
    const parsed = Number.parseInt(direct, 10)
    return Number.isFinite(parsed) ? parsed : null
  }

  const parent = el.parentElement
  if (parent?.tagName === "OL") {
    const start = parent.getAttribute("start")
    const firstLi = parent.querySelector("li")
    if (start != null && firstLi === el) {
      const parsed = Number.parseInt(start, 10)
      return Number.isFinite(parsed) ? parsed : null
    }
  }

  return null
}

export const NumberedList = createBlockSpec({
  type: "numberedList",
  content: "inline*",
  supports: { textColor: true, backgroundColor: true },
  indent: { mode: "structural" },
  props: {
    start: {
      default: null as number | null,
      renderHTML: (attrs) => {
        const out: Record<string, string> = {}
        const start = attrs.start as number | null
        if (start != null) out["data-start"] = String(start)
        return out
      },
    },
  },
  schemaContext: {
    input: {
      examples: [{ type: "numberedList", text: "Example item" }],
    },
  },
  toRuneBlock: (node) => ({
    type: "numberedList",
    id: typeof node.attrs.id === "string" ? node.attrs.id : "",
    depth: typeof node.attrs.depth === "number" ? node.attrs.depth : 0,
    text: node.textContent,
    start: (node.attrs.start as number | null) ?? null,
  }),
  fromInput: ({ schema, input, defaults }) => {
    const t = schema.nodes["numberedList"]
    if (!t) return null
    const text = readBlockInputText(input)
    const attrs = {
      ...defaults.attrs,
      id: input.id ?? null,
      depth: input.depth ?? defaults.depth,
      start: input.start ?? null,
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
    // `.rune-numbered-list` div carrying id/depth AND data-start (the
    // `start` prop's renderHTML lands on the outer div, not the inner
    // <p>). contentElement points PM at the inner <p> so the shared
    // inline content is taken from THERE — without it, the Paragraph
    // rule would claim the inner <p> as a sibling node, degrading the
    // block to a plain paragraph and dropping `start` along with it.
    // `start` needs its own getAttrs because the prop declares no
    // parseHTML of its own (parseListStart already reads data-start
    // directly off the matched element, so it works unchanged here).
    {
      tag: "div.rune-block.rune-numbered-list",
      priority: 60,
      getAttrs: (el) => ({ start: parseListStart(el as HTMLElement) }),
      contentElement: (node: globalThis.Node) => {
        const el = node as HTMLElement
        return el.querySelector(":scope > .rune-block-content > p") ?? el
      },
    },
    {
      tag: "ol > li",
      priority: 51,
      getAttrs: (el) => {
        const element = el as HTMLElement
        const depth = parseListDepth(element)
        if (depth > 0) element.setAttribute("data-depth", String(depth))
        return { depth, start: parseListStart(element) }
      },
    },
  ],
  renderDOM: ({ HTMLAttributes }) => {
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
      { ...outer, class: "rune-block rune-numbered-list" },
      [
        "div",
        contentAttrs,
        ["p", {}, 0],
      ],
    ]
  },
  toMarkdown({ prefix, serializeInline, numberedIndex, node }) {
    const n = numberedIndex ?? 1
    return { line: `${prefix}${n}. ${serializeInline(node)}`, spacing: "list-item" }
  },
  clipboardRenderDOM: ({ node }) => {
    const start = node.attrs.start as number | null
    return start != null && start !== 1
      ? ["ol", { start: String(start) }, ["li", {}, 0]]
      : ["ol", {}, ["li", {}, 0]]
  },
  slashMenuItems: () => {
    const block = { type: "numberedList" }
    return [
      {
        key: "numberedList",
        title: "Numbered list",
        aliases: ["ol", "numbered", "1."],
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
      inputRules: [
        {
          find: /^(\d+)\.\s$/,
          replace: ({ match }) => ({
            type: "numberedList",
            props: { start: Number.parseInt(match[1] ?? "1", 10) },
          }),
        },
      ],
    }),
  ],
})
