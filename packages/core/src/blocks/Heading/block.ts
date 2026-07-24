// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { createBlockSpec, createBlockExtension, readBlockInputText, inlineContentFromText } from "../../schema"
import type { RuneBlockBase } from "../../types"
import { insertOrUpdateBlockForSlashMenu } from "../../extensions/suggestion-menus"

// Heading outline contract: the page template reserves <h1> for the
// document title, so body headings start at <h2>. UI exposes four
// options (labelled H1 / H2 / H3 / H4) that map to internal levels
// 2 / 3 / 4 / 5 and render as <h2> / <h3> / <h4> / <h5>. Storing the
// real tag number as the attribute keeps the doc's outline correct for
// SEO / accessibility tooling that walks HTML headings directly. UI H4
// shares CSS with UI H3 — the new level adds outline depth without a
// new visual rhythm step.
const LEVELS = [2, 3, 4, 5] as const
export type HeadingLevel = (typeof LEVELS)[number]

const isHeadingLevel = (n: unknown): n is HeadingLevel =>
  (LEVELS as readonly number[]).includes(n as number)

export const Heading = createBlockSpec({
  type: "heading",
  content: "inline*",
  supports: { textColor: true, backgroundColor: true },
  schemaContext: {
    input: {
      // Surfaced to agents via get_editor_context. The 2–5 range is the single
      // most common author error (a model reasons "H1 → level 1", which the
      // schema rejects because h1 is the page title), so state it explicitly.
      description:
        "Body headings use level 2–5; level 1 is reserved for the page title " +
        "(the UI's 'Heading 1' = level 2). Always include a level.",
      examples: [{ type: "heading", level: 2, text: "Example heading" }],
    },
  },
  toRuneBlock: (node) => {
    const level = node.attrs.level
    return {
      type: "heading",
      id: typeof node.attrs.id === "string" ? node.attrs.id : "",
      depth: typeof node.attrs.depth === "number" ? node.attrs.depth : 0,
      level: isHeadingLevel(level) ? level : 2,
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
      default: 2 as HeadingLevel,
      parseHTML: (el) => {
        const n = Number.parseInt(el.tagName.slice(1), 10)
        return isHeadingLevel(n) ? n : 2
      },
      // level is expressed by the tag name in renderDOM, not as an
      // attribute — return {} so Tiptap doesn't serialise a redundant
      // `level="2"` onto the element.
      renderHTML: () => ({}),
    },
  },
  parseDOM: LEVELS.map((level) => ({
    tag: `h${level}`,
    attrs: { level },
  })),
  renderDOM: ({ node, HTMLAttributes }) => {
    const level = node.attrs.level as HeadingLevel
    // Block-level color attrs ride on the inner wrapper (.rune-block-content)
    // so the colored pill hugs the content rectangle and the rhythm gutter
    // stays untinted. Outer .rune-block keeps data-id / data-depth only.
    // See spec §4.
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
      ["div", contentAttrs, [`h${level}`, {}, 0]],
    ]
  },
  toMarkdown({ prefix, serializeInline, node }) {
    const level = typeof node.attrs.level === "number" ? node.attrs.level : 2
    return { line: `${prefix}${"#".repeat(level - 1)} ${serializeInline(node)}` }
  },
  clipboardRenderDOM: ({ node }) => {
    const level = node.attrs.level as HeadingLevel
    return [`h${level}`, {}, 0]
  },
  slashMenuItems: () =>
    LEVELS.map((level, i) => {
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
      // UI heading N = internal level N+1 (<h1> is reserved for the title).
      shortcutActions: {
        blockHeading1: ({ editor }) =>
          editor.commands.setNode("heading", { level: 2 }),
        blockHeading2: ({ editor }) =>
          editor.commands.setNode("heading", { level: 3 }),
        blockHeading3: ({ editor }) =>
          editor.commands.setNode("heading", { level: 4 }),
        blockHeading4: ({ editor }) =>
          editor.commands.setNode("heading", { level: 5 }),
      },
      inputRules: [
        {
          find: /^#\s$/,
          replace: () => ({ type: "heading", props: { level: 2 } }),
        },
        {
          find: /^##\s$/,
          replace: () => ({ type: "heading", props: { level: 3 } }),
        },
        {
          find: /^###\s$/,
          replace: () => ({ type: "heading", props: { level: 4 } }),
        },
        {
          find: /^####\s$/,
          replace: () => ({ type: "heading", props: { level: 5 } }),
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
