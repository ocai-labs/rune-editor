// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { createBlockSpec, createBlockExtension, readBlockInputText, inlineContentFromText } from "../../schema"
import type { RuneBlockBase } from "../../types"
import { insertOrUpdateBlockForSlashMenu } from "../../extensions/suggestion-menus"

// Heading identity contract: the page title is host-owned and does not occupy
// the ProseMirror schema. A markdown HN is therefore Heading level N and
// renders as <hN>, without an offset or a synthetic level 7. The UI keeps its
// Notion-shaped H1–H4 creation surface while storage accepts H1–H6 so external
// markdown round-trips without rewriting its outline.
const UI_LEVELS = [1, 2, 3, 4] as const
const LEVELS = [1, 2, 3, 4, 5, 6] as const
export type HeadingLevel = (typeof LEVELS)[number]

const isHeadingLevel = (n: unknown): n is HeadingLevel =>
  (LEVELS as readonly number[]).includes(n as number)

export const Heading = createBlockSpec({
  type: "heading",
  content: "inline*",
  schemaContext: {
    input: {
      description:
        "Heading level is identical to markdown and HTML: level 1 is #/<h1>, " +
        "through level 6 as ######/<h6>. The UI offers levels 1–4; levels 5–6 " +
        "remain accepted for external markdown fidelity. Always include a level.",
      examples: [{ type: "heading", level: 1, text: "Example heading" }],
    },
  },
  toRuneBlock: (node) => {
    const level = node.attrs.level
    return {
      type: "heading",
      id: typeof node.attrs.id === "string" ? node.attrs.id : "",
      depth: typeof node.attrs.depth === "number" ? node.attrs.depth : 0,
      level: isHeadingLevel(level) ? level : 1,
      text: node.textContent,
    }
  },
  fromInput: ({ schema, input, defaults }) => {
    const t = schema.nodes["heading"]
    if (!t) return null
    const level = input.level
    if (!isHeadingLevel(level)) return null
    const text = readBlockInputText(input)
    const attrs = {
      ...defaults.attrs,
      id: input.id ?? null,
      depth: input.depth ?? defaults.depth,
      level,
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
  props: {
    level: {
      default: 1 as HeadingLevel,
      parseHTML: (el) => {
        const n = Number.parseInt(el.tagName.slice(1), 10)
        return isHeadingLevel(n) ? n : 1
      },
      // level is expressed by the tag name in renderDOM, not as an
      // attribute — return {} so Tiptap doesn't serialise a redundant
      // `level="2"` onto the element.
      renderHTML: () => ({}),
    },
  },
  parseDOM: LEVELS.map((level) => ({ tag: `h${level}`, attrs: { level } })),
  renderDOM: ({ node, HTMLAttributes }) => {
    const level = isHeadingLevel(node.attrs.level) ? node.attrs.level : 1
    // Block-level color attrs ride on the inner wrapper (.rune-block-content)
    // so the colored pill hugs the content rectangle and the rhythm gutter
    // stays untinted. Outer .rune-block keeps data-id / data-depth only.
    // See spec §4.
    const outer = HTMLAttributes
    const contentAttrs: Record<string, string> = { class: "rune-block-content" }
    return [
      "div",
      { ...outer, class: "rune-block" },
      [
        "div",
        contentAttrs,
        [`h${level}`, {}, 0],
      ],
    ]
  },
  toMarkdown({ prefix, serializeInline, node }) {
    const level = isHeadingLevel(node.attrs.level) ? node.attrs.level : 1
    return { line: `${prefix}${"#".repeat(level)} ${serializeInline(node)}` }
  },
  clipboardRenderDOM: ({ node }) => {
    const level = isHeadingLevel(node.attrs.level) ? node.attrs.level : 1
    return [`h${level}`, {}, 0]
  },
  slashMenuItems: () =>
    UI_LEVELS.map((level, i) => {
      const block = { type: "heading", props: { level } }
      return {
        key: `heading_${i + 1}`,
        title: `Heading ${i + 1}`,
        // `heading${n}` covers the no-space spelling (`/heading1`) so it
        // matches alongside the spaced title (`/heading 1`); `h${n}` and
        // `#`-repeats keep the short forms.
        aliases: [`h${i + 1}`, `heading${i + 1}`, "#".repeat(i + 1)],
        group: "Basic blocks",
        block,
        onItemClick: (ctx) => insertOrUpdateBlockForSlashMenu(ctx, block),
      }
    }),
  sideMenu: { draggable: true },
  extensions: [
    createBlockExtension({
      key: "extras",
      shortcutActions: {
        blockHeading1: ({ editor }) =>
          editor.commands.setNode("heading", { level: 1 }),
        blockHeading2: ({ editor }) =>
          editor.commands.setNode("heading", { level: 2 }),
        blockHeading3: ({ editor }) =>
          editor.commands.setNode("heading", { level: 3 }),
        blockHeading4: ({ editor }) =>
          editor.commands.setNode("heading", { level: 4 }),
      },
      inputRules: [
        {
          find: /^#\s$/,
          replace: () => ({ type: "heading", props: { level: 1 } }),
        },
        {
          find: /^##\s$/,
          replace: () => ({ type: "heading", props: { level: 2 } }),
        },
        {
          find: /^###\s$/,
          replace: () => ({ type: "heading", props: { level: 3 } }),
        },
        {
          find: /^####\s$/,
          replace: () => ({ type: "heading", props: { level: 4 } }),
        },
      ],
    }),
  ],
})

// Public shape of a heading in the block API (editor.document). Lives
// next to the block so adding a new block is a single-directory change.
export interface RuneHeadingBlock extends RuneBlockBase {
  type: "heading"
  level: HeadingLevel
  text: string
}
