// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { JSONContent } from "@tiptap/core"
import type { BlockContent, PhrasingContent } from "mdast"
import { createBlockSpec, readBlockInputText, inlineContentFromText } from "../../schema"
import type { RuneBlockBase } from "../../types"
import { insertOrUpdateBlockForSlashMenu } from "../../extensions/suggestion-menus"

// Notion ships a 💡 as the default callout emoji; mirror it so a fresh
// callout looks identical out of the box. Stored as a per-block `icon`
// prop (data-rune-callout-icon) so it round-trips through getHTML and can
// later be changed via updateBlock without touching the schema.
const DEFAULT_CALLOUT_ICON = "💡"

const normalizeIcon = (value: unknown): string =>
  typeof value === "string" && value.length > 0 ? value : DEFAULT_CALLOUT_ICON

/**
 * Obsidian callout marker on a blockquote's first line: `[!TYPE]`, an
 * optional fold suffix (`-`/`+` — that form belongs to Toggle, we decline
 * it), an optional title (rune stores it as the icon), and — in the
 * hand-typed single-paragraph form — the body after a soft line break.
 */
const CALLOUT_MARKER = /^\[!([A-Za-z]+)\]([+-]?)[^\S\n]*([^\n]*)(?:\n([\s\S]*))?$/

export interface RuneCalloutBlock extends RuneBlockBase {
  type: "callout"
  icon: string
  text: string
}

export const Callout = createBlockSpec({
  type: "callout",
  content: "inline*",
  schemaContext: {
    input: {
      examples: [{ type: "callout", icon: "💡", text: "Callout text" }],
    },
  },
  props: {
    icon: {
      default: DEFAULT_CALLOUT_ICON,
      parseHTML: (el) => normalizeIcon(el.getAttribute("data-rune-callout-icon")),
      renderHTML: (a) => ({ "data-rune-callout-icon": normalizeIcon(a.icon) }),
    },
  },
  markdown: {
    // `> [!NOTE] <icon>` + body — Obsidian's native callout form (PRD §6.1).
    // The marker rides an mdast `html` node: as a text node remark-stringify
    // escapes the bracket (`\[!NOTE]`), which Obsidian would not recognize;
    // html nodes pass through verbatim (probed 2026-07-29). The default icon
    // is omitted so unstyled callouts stay clean.
    toMdast(blockJson, ctx) {
      const icon = normalizeIcon(blockJson.attrs?.icon)
      const marker = icon === DEFAULT_CALLOUT_ICON ? "[!NOTE]" : `[!NOTE] ${icon}`
      const children: BlockContent[] = [{ type: "html", value: marker }]
      const body = ctx.inlineToMdast(blockJson.content ?? [])
      if (body.length > 0) children.push({ type: "paragraph", children: body })
      return { type: "blockquote", children }
    },
    // Promoter: claim blockquotes whose first line is a `[!TYPE]` marker —
    // both the serialized two-paragraph form and the hand-typed
    // single-paragraph form (`> [!note]\n> body` arrives as one text node
    // with a soft `\n`). Any TYPE keyword maps to callout; the title slot
    // becomes the icon. Fold-suffixed markers (`[!TYPE]-`) are Toggle's —
    // decline so they fall through (builtin blockquote until Toggle's
    // contract lands). Plain blockquotes: first text has no marker → null.
    fromMdast(node, ctx) {
      if (node.type !== "blockquote") return null
      const [head, ...rest] = node.children
      if (head?.type !== "paragraph") return null
      const [first, ...headRest] = head.children
      if (first?.type !== "text") return null
      const match = CALLOUT_MARKER.exec(first.value)
      if (!match || match[2]) return null
      const icon = (match[3] ?? "").trim()
      const bodyPhrasing: PhrasingContent[] = []
      if (match[4]) bodyPhrasing.push({ type: "text", value: match[4] })
      bodyPhrasing.push(...headRest)
      const inline = ctx.inlineToPM(bodyPhrasing)
      for (const sibling of rest) {
        if (sibling.type !== "paragraph") continue
        if (inline.length > 0) inline.push({ type: "hardBreak" })
        inline.push(...ctx.inlineToPM(sibling.children))
      }
      const out: JSONContent = { type: "callout" }
      if (icon) out.attrs = { icon }
      if (inline.length > 0) out.content = inline
      return out
    },
  },
  toRuneBlock: (node) => ({
    type: "callout",
    id: typeof node.attrs.id === "string" ? node.attrs.id : "",
    depth: typeof node.attrs.depth === "number" ? node.attrs.depth : 0,
    icon: normalizeIcon(node.attrs.icon),
    text: node.textContent,
  }),
  fromInput: ({ schema, input, defaults }) => {
    const t = schema.nodes["callout"]
    if (!t) return null
    const text = readBlockInputText(input)
    const attrs = {
      ...defaults.attrs,
      id: input.id ?? null,
      depth: input.depth ?? defaults.depth,
      icon: normalizeIcon((input as { icon?: unknown }).icon),
    }
    const content =
      defaults.preserveContent && defaults.content && t.validContent(defaults.content)
        ? defaults.content
        : text
          ? inlineContentFromText(schema, text)
          : undefined
    return t.create(attrs, content, defaults.marks)
  },
  parseDOM: [
    // Round-trip rune's own getHTML output: the outer `.rune-block` carries
    // data-rune-callout-icon (from the prop renderHTML). contentElement
    // points PM at the inner `.rune-callout-content` so the inline text is
    // taken from THERE — not from the emoji span sibling, which would
    // otherwise be slurped into the content.
    {
      tag: "div[data-rune-callout-icon]",
      priority: 60,
      contentElement: (node: globalThis.Node) => {
        const el = node as HTMLElement
        return (
          el.querySelector(":scope > .rune-block-content > .rune-callout-content") ?? el
        )
      },
    },
    // External clipboard / generic semantic callout: the <aside> emitted by
    // clipboardRenderDOM. Body text lives in the [data-rune-callout-body]
    // span; the leading emoji span is excluded via contentElement.
    {
      tag: "aside[data-rune-callout]",
      priority: 55,
      contentElement: (node: globalThis.Node) => {
        const el = node as HTMLElement
        return el.querySelector(":scope > [data-rune-callout-body]") ?? el
      },
    },
  ],
  renderDOM: ({ node, HTMLAttributes }) => {
    const icon = normalizeIcon(node.attrs.icon)
    const outer = HTMLAttributes
    const contentAttrs: Record<string, string> = {
      class: "rune-block-content",
      role: "note",
    }
    return [
      "div",
      { ...outer, class: "rune-block rune-callout" },
      [
        "div",
        contentAttrs,
        [
          "span",
          {
            class: "rune-callout-icon",
            contenteditable: "false",
            "aria-hidden": "true",
          },
          icon,
        ],
        ["div", { class: "rune-callout-content" }, 0],
      ],
    ]
  },
  toMarkdown({ prefix, serializeInline, node }) {
    return { line: `${prefix}> ${normalizeIcon(node.attrs.icon)} ${serializeInline(node)}` }
  },
  clipboardRenderDOM: ({ node }) => {
    const icon = normalizeIcon(node.attrs.icon)
    // Chrome-free, semantic <aside> for external paste — no .rune-block /
    // data-id / data-depth. Emoji rides as a leading non-editable span so
    // TextEdit / Notion / GitHub show "💡 text"; the body span carries the
    // inline content for a clean round-trip back into rune. NBSP keeps the
    // emoji glued to the first word.
    return [
      "aside",
      { "data-rune-callout": "", "data-rune-callout-icon": icon },
      ["span", { "data-rune-callout-emoji": "", "aria-hidden": "true" }, `${icon} `],
      ["span", { "data-rune-callout-body": "" }, 0],
    ]
  },
  sideMenu: { draggable: true },
  slashMenuItems: () => {
    const block = { type: "callout" }
    return [
      {
        key: "callout",
        title: "Callout",
        aliases: ["callout", "note", "info", "tip", "aside"],
        group: "Basic blocks",
        block,
        onItemClick: (ctx) => insertOrUpdateBlockForSlashMenu(ctx, block),
      },
    ]
  },
})
