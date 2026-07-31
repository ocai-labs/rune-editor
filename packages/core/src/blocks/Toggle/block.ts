// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { JSONContent } from "@tiptap/core"
import type { PhrasingContent, RootContent } from "mdast"
import { createBlockSpec, createBlockExtension, readBlockInputText, inlineContentFromText } from "../../schema"
import type { RuneBlockBase } from "../../types"
import { insertOrUpdateBlockForSlashMenu } from "../../extensions/suggestion-menus"
import type { SuggestionCommitContext } from "../../extensions/suggestion-menus"
import { toggleBodyRange } from "./range"

// Toggle Heading caps at H3. Its level is now identical across UI, markdown,
// and HTML; 0 remains the non-heading Toggle list variant.
export type ToggleLevel = 0 | 1 | 2 | 3
const LEVELS: readonly ToggleLevel[] = [0, 1, 2, 3] as const

/**
 * Obsidian FOLDED callout marker — `[!TYPE]-` (collapsed) / `[!TYPE]+`
 * (expanded). The fold suffix is REQUIRED here: suffix-less markers are
 * Callout's (its promoter registers earlier and claims them first; this
 * regex would decline them anyway). Toggle-heading level rides the title
 * slot as leading hashes (`[!NOTE]- ## head` → UI toggle-H2), on the same
 * identity axis as the heading block (level = hashes).
 */
const TOGGLE_MARKER = /^\[!([A-Za-z]+)\]([+-])[^\S\n]*([^\n]*)(?:\n([\s\S]*))?$/

const isLevel = (n: unknown): n is ToggleLevel =>
  (LEVELS as readonly number[]).includes(n as number)

export interface RuneToggleBlock extends RuneBlockBase {
  type: "toggle"
  level: ToggleLevel
  expanded: boolean
  text: string
}

export const Toggle = createBlockSpec({
  type: "toggle",
  content: "inline*",
  schemaContext: {
    input: {
      examples: [{ type: "toggle", level: 0, text: "Toggle title" }],
    },
  },
  props: {
    level: {
      default: 0 as ToggleLevel,
      parseHTML: (el) => {
        const raw = el.getAttribute("data-rune-toggle-level")
        const n = raw == null ? NaN : Number.parseInt(raw, 10)
        return isLevel(n) ? n : 0
      },
      renderHTML: (a) => ({
        "data-rune-toggle-level": String(a.level ?? 0),
      }),
    },
    expanded: {
      default: false,
      parseHTML: (el) => el.getAttribute("data-rune-toggle-expanded") === "true",
      renderHTML: (a) => ({
        "data-rune-toggle-expanded": String(a.expanded === true),
      }),
    },
  },
  markdown: {
    // Toggle children are the run of deeper siblings in the flat schema —
    // the walker absorbs that run and hands it over as `children`.
    absorbsDeeperRun: true,
    // `> [!NOTE]- head` + body — Obsidian's folded callout (PRD §6.1).
    // The marker rides an INLINE mdast html node inside the head paragraph
    // (a text node would get bracket-escaped to `\[!NOTE]`), so the head's
    // own marks serialize normally right after it on the same line.
    toMdast(blockJson, ctx, children) {
      const level = isLevel(blockJson.attrs?.level) ? blockJson.attrs.level : 0
      const suffix = blockJson.attrs?.expanded === true ? "+" : "-"
      const hashes = level > 0 ? ` ${"#".repeat(level)}` : ""
      const title = ctx.inlineToMdast(blockJson.content ?? [])
      const head: PhrasingContent[] = [
        { type: "html", value: `[!NOTE]${suffix}${hashes}` },
        ...(title.length > 0 ? [{ type: "text", value: " " } as const, ...title] : []),
      ]
      return {
        type: "blockquote",
        children: [{ type: "paragraph", children: head }, ...((children ?? []) as never[])],
      }
    },
    // Promoter: claim fold-suffixed `[!TYPE]±` blockquotes. Head text (the
    // marker paragraph's remainder) becomes the toggle's inline content;
    // every remaining blockquote child converts through the full walker
    // (ctx.blocksToPM) and lands one depth level under the toggle.
    fromMdast(node, ctx) {
      if (node.type !== "blockquote") return null
      const [head, ...rest] = node.children
      if (head?.type !== "paragraph") return null
      const [first, ...headRest] = head.children
      if (first?.type !== "text") return null
      const match = TOGGLE_MARKER.exec(first.value)
      if (!match) return null
      let title = match[3] ?? ""
      let level: ToggleLevel = 0
      const h = /^(#{1,3})(?:[^\S\n]+|$)/.exec(title)
      if (h) {
        const parsed = h[1]!.length
        if (isLevel(parsed)) {
          level = parsed
          title = title.slice(h[0].length)
        }
      }
      const titlePhrasing: PhrasingContent[] = []
      if (title) titlePhrasing.push({ type: "text", value: title })
      titlePhrasing.push(...headRest)
      const bodyNodes: RootContent[] = []
      if (match[4]) bodyNodes.push({ type: "paragraph", children: [{ type: "text", value: match[4] }] })
      bodyNodes.push(...rest)
      const attrs: Record<string, unknown> = {}
      if (level !== 0) attrs.level = level
      if (match[2] === "+") attrs.expanded = true
      const toggle: JSONContent = { type: "toggle" }
      if (Object.keys(attrs).length > 0) toggle.attrs = attrs
      const inline = ctx.inlineToPM(titlePhrasing)
      if (inline.length > 0) toggle.content = inline
      const body = ctx.blocksToPM(bodyNodes).map((b) => ({
        ...b,
        attrs: { ...b.attrs, depth: (typeof b.attrs?.depth === "number" ? b.attrs.depth : 0) + 1 },
      }))
      return [toggle, ...body]
    },
  },
  toRuneBlock: (node) => ({
    type: "toggle",
    id: typeof node.attrs.id === "string" ? node.attrs.id : "",
    depth: typeof node.attrs.depth === "number" ? node.attrs.depth : 0,
    level: isLevel(node.attrs.level) ? node.attrs.level : 0,
    expanded: node.attrs.expanded === true,
    text: node.textContent,
  }),
  fromInput: ({ schema, input, defaults }) => {
    const t = schema.nodes["toggle"]
    if (!t) return null
    const level = input.level
    if (level !== undefined && !isLevel(level)) return null
    const text = readBlockInputText(input)
    const attrs = {
      ...defaults.attrs,
      id: input.id ?? null,
      depth: input.depth ?? defaults.depth,
      level: level ?? 0,
      expanded: input.expanded === true,
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
    // Round-trip: the rune-rendered `.rune-toggle` outer div emits
    // `data-rune-toggle-level` / `data-rune-toggle-expanded`. This
    // matches both `editor.getHTML()` output and any intra-rune
    // copy-paste path.
    {
      tag: "div[data-rune-toggle-level]",
      priority: 60,
      // level + expanded come from the shared attr parseHTML.
      // `getAttrs: null` keeps the default attr-extraction path; the
      // important part is `contentElement` — it points PM at the inner
      // title element (<p> or <hN>) inside `.rune-block-content` so the
      // shared inline content is taken from THAT element, not from the
      // outer wrapper. Without this, PM walks the outer div's children
      // and the Heading parser claims the inner <hN> as a sibling node,
      // leaving the toggle with zero inline content on HTML round-trip.
      contentElement: (node: globalThis.Node) => {
        const el = node as HTMLElement
        return (
          el.querySelector(
            ":scope > .rune-block-content > :is(p, h1, h2, h3)",
          ) ?? el
        )
      },
    },
    // Paste flattener: `transformToggleHTML` emits the title element
    // (`<p>` or `<hN>`) tagged with `data-rune-toggle-title="1"` plus
    // the same level/expanded attrs. Match it explicitly so a bare
    // `<h2 data-rune-toggle-title="1">` doesn't also get picked up by
    // the Heading parser (Heading has no `data-rune-toggle-title` rule
    // and a lower priority, but we make the intent explicit).
    {
      tag: "[data-rune-toggle-title]",
      priority: 70,
    },
  ],
  renderDOM: ({ node, HTMLAttributes }) => {
    const level = (node.attrs.level as ToggleLevel) ?? 0
    const expanded = node.attrs.expanded === true
    const outer = HTMLAttributes
    const contentAttrs: Record<string, string> = { class: "rune-block-content" }

    const titleTag = level === 0 ? "p" : `h${level}`
    return [
      "div",
      { ...outer, class: "rune-block rune-toggle" },
      [
        "div",
        contentAttrs,
        [
          "button",
          {
            type: "button",
            class: "rune-toggle-caret",
            contenteditable: "false",
            "aria-label": expanded ? "Collapse" : "Expand",
            "aria-expanded": expanded ? "true" : "false",
          },
          // Inline SVG so we don't depend on React for the icon. Plain CSS rotates via
          // [data-rune-toggle-expanded]. PM's DOMSerializer.renderSpec uses
          // `document.createElement` by default and ignores an `xmlns` attribute — to
          // build elements in the SVG namespace it requires the tag-name form
          // `"<namespace-uri> <localName>"`. Both <svg> AND <path> need the prefix
          // (the child does not inherit the parent's namespace).
          [
            "http://www.w3.org/2000/svg svg",
            {
              viewBox: "0 0 16 16",
              class: "rune-toggle-caret-icon",
              "aria-hidden": "true",
            },
            [
              "http://www.w3.org/2000/svg path",
              { d: "M2.835 3.25a.8.8 0 0 0-.69 1.203l5.164 8.854a.8.8 0 0 0 1.382 0l5.165-8.854a.8.8 0 0 0-.691-1.203z" },
            ],
          ],
        ],
        [titleTag, {}, 0],
      ],
    ]
  },
  toMarkdown({ prefix, serializeInline, node }) {
    const level = typeof node.attrs.level === "number" ? node.attrs.level : 0
    if (level > 0) {
      return { line: `${prefix}${"#".repeat(level)} ${serializeInline(node)}` }
    }
    return { line: `${prefix}- ${serializeInline(node)}`, spacing: "list-item" }
  },
  clipboardRenderDOM: ({ node }) => {
    const level = (node.attrs.level as ToggleLevel) ?? 0
    const titleTag = level === 0 ? "p" : `h${level}`
    return [
      "details",
      node.attrs.expanded === true ? { open: "" } : {},
      ["summary", {}, [titleTag, {}, 0]],
    ]
  },
  dragSourceRange: ({ node, pos, doc }) => {
    const body = toggleBodyRange(doc, pos)
    return { from: pos, to: pos + node.nodeSize + (body.to - body.from) }
  },
  sideMenu: { draggable: true },
  slashMenuItems: () => {
    const toggleBlock = { type: "toggle", props: { level: 0 } }
    return [
      {
        key: "toggle",
        title: "Toggle list",
        aliases: [">", "fold", "collapse", "toggle"],
        group: "Basic blocks",
        block: toggleBlock,
        onItemClick: (ctx) => insertOrUpdateBlockForSlashMenu(ctx, toggleBlock),
      },
      ...([1, 2, 3] as const).map((level, i) => {
        const block = { type: "toggle", props: { level } }
        return {
          key: `toggle_heading_${i + 1}`,
          title: `Toggle heading ${i + 1}`,
          aliases: [`>h${i + 1}`, ">" + "#".repeat(i + 1)],
          group: "Basic blocks",
          block,
          onItemClick: (ctx: SuggestionCommitContext) =>
            insertOrUpdateBlockForSlashMenu(ctx, block),
        }
      }),
    ]
  },
  extensions: [
    createBlockExtension({
      key: "input-rules",
      inputRules: [
        { find: /^>\s$/, replace: () => ({ type: "toggle", props: { level: 0 } }) },
        { find: /^>#\s$/, replace: () => ({ type: "toggle", props: { level: 1 } }) },
        { find: /^>##\s$/, replace: () => ({ type: "toggle", props: { level: 2 } }) },
        { find: /^>###\s$/, replace: () => ({ type: "toggle", props: { level: 3 } }) },
      ],
      shortcutActions: {
        blockToggle: ({ editor }) =>
          editor.commands.setNode("toggle", { level: 0, expanded: false }),
        toggleCollapse: ({ editor }) => {
          const { selection } = editor.state
          const $pos = selection.$from
          for (let d = $pos.depth; d >= 0; d--) {
            const n = $pos.node(d)
            if (n.type.name === "toggle") {
              const pos = d === 0 ? 0 : $pos.before(d)
              const next = !(n.attrs.expanded !== false)
              editor.view.dispatch(
                editor.state.tr.setNodeAttribute(pos, "expanded", next).setMeta("addToHistory", false),
              )
              return true
            }
          }
          return false
        },
      },
    }),
  ],
})

// Public toggle helpers stay document/slice-level. The DOM paste
// flattener in `flatten.ts` remains internal to the clipboard pipeline.
export { ToggleBodyPlugin, toggleBodyKey } from "./plugin"
export type { ToggleBodyOptions } from "./plugin"
export { findCollapsedToggleContaining, toggleBodyRange, expandRangeOverToggleBodies } from "./range"
export type { CollapsedToggleContainingResult } from "./range"
export { expandCollapsedToggles } from "./expandSlice"
