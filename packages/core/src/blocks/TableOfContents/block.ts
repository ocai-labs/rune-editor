// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { createBlockSpec } from "../../schema"
import type { RuneBlockBase } from "../../types"
import { insertOrUpdateBlockForSlashMenu } from "../../extensions/suggestion-menus"

/**
 * Table of contents — atom block, no editable content. The PM-rendered
 * DOM is a semantic empty shell (`.rune-block > .rune-block-content[data-rune-toc]`).
 * The live render — heading list, indent, click-to-scroll, empty-state
 * — lives in @ocai/rune-react's React NodeView, which subscribes to
 * `editor.on("update")` and reads headings from the shared
 * `extractHeadings` helper.
 *
 * Color attrs ride on the inner `.rune-block-content` wrapper, same
 * convention as Heading: the outer `.rune-block` keeps `data-id` /
 * `data-depth` only so the side-menu gutter stays untinted while the
 * colored pill hugs the content rectangle. See Heading/block.ts §
 * "Block-level color attrs ride on the inner wrapper".
 */
export const TableOfContents = createBlockSpec({
  type: "tableOfContents",
  content: "",
  schemaContext: {
    input: {
      examples: [{ type: "tableOfContents" }],
    },
  },
  toRuneBlock: (node) => ({
    type: "tableOfContents",
    id: typeof node.attrs.id === "string" ? node.attrs.id : "",
    depth: typeof node.attrs.depth === "number" ? node.attrs.depth : 0,
  }),
  fromInput: ({ schema, input, defaults }) => {
    const t = schema.nodes["tableOfContents"]
    if (!t) return null
    return t.create({
      ...defaults.attrs,
      id: input.id ?? null,
      depth: input.depth ?? defaults.depth,
    })
  },
  toMarkdown() {
    return null
  },
  markdown: {
    // D5 (2026-07-29): an EMPTY ```toc fence — the convention several
    // Obsidian TOC plugins render, and a visible (if plain) code block in
    // vanilla Obsidian. The block's content is derived from headings at
    // render time, so the fence carries position only. Promotion requires
    // an empty body: an external file's real ```toc code stays a codeBlock.
    toMdast() {
      return { type: "code", lang: "toc", value: "" }
    },
    fromMdast(node) {
      return node.type === "code" && node.lang === "toc" && !node.value.trim()
        ? { type: "tableOfContents" }
        : null
    },
  },
  parseDOM: [{ tag: "div[data-rune-toc]" }],
  renderDOM: ({ HTMLAttributes }) => {
    const outer = HTMLAttributes
    const contentAttrs: Record<string, string> = {
      class: "rune-block-content",
      "data-rune-toc": "",
    }
    return ["div", { ...outer, class: "rune-block" }, ["div", contentAttrs]]
  },
  // External paste targets get the bare semantic marker — no chrome,
  // no data-id/depth. Re-pastes into a rune editor re-attach the
  // NodeView and re-derive entries from the destination doc.
  clipboardRenderDOM: () => ["div", { "data-rune-toc": "" }],
  slashMenuItems: () => {
    const block = { type: "tableOfContents" }
    return [
      {
        key: "tableOfContents",
        title: "Table of contents",
        aliases: ["toc", "table of contents", "outline"],
        group: "Basic blocks",
        block,
        onItemClick: (ctx) => insertOrUpdateBlockForSlashMenu(ctx, block),
      },
    ]
  },
  sideMenu: { draggable: true },
})

export interface RuneTableOfContentsBlock extends RuneBlockBase {
  type: "tableOfContents"
}
