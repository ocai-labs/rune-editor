// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { createBlockSpec, mergeBlockHTMLAttributes } from "../../schema"
import type { RuneBlockBase } from "../../types"
import { EquationBlockCommands } from "./extension"

/**
 * Equation — atom block, no content. Latex is stored as an attr and
 * rendered by the React NodeView (KaTeX display mode). PM-rendered
 * DOM is a semantic shell `.rune-block > .rune-equation-block` with
 * `data-type="equation-block"` + `data-latex="..."` so consumers that
 * read core's HTML without the React layer can still re-render.
 *
 * The outer `.rune-block` carries `--block-pad-top` as an inline CSS
 * variable (NOT a data attribute) — the side-menu gutter reads it via
 * `top: var(--block-pad-top)` in `side-menu.css`.
 */
export const Equation = createBlockSpec({
  type: "equationBlock",
  content: "",
  indent: { mode: "numeric", maxDepth: 0 },
  meta: { defining: false },
  props: {
    latex: { default: "", renderHTML: () => ({}) },
  },
  schemaContext: {
    input: {
      examples: [{ type: "equationBlock", latex: "x = 1" }],
    },
  },
  toRuneBlock: (node) => ({
    type: "equationBlock",
    id: typeof node.attrs.id === "string" ? node.attrs.id : "",
    depth: typeof node.attrs.depth === "number" ? node.attrs.depth : 0,
    latex: typeof node.attrs.latex === "string" ? node.attrs.latex : "",
  }),
  fromInput: ({ schema, input, defaults }) => {
    const t = schema.nodes["equationBlock"]
    if (!t) return null
    const latex = typeof input.latex === "string" ? input.latex : ""
    return t.create({
      ...defaults.attrs,
      id: input.id ?? null,
      depth: input.depth ?? defaults.depth,
      latex,
    })
  },
  parseDOM: [
    {
      tag: 'div[data-type="equation-block"]',
      getAttrs: (el) => ({
        latex: (el as HTMLElement).getAttribute("data-latex") ?? "",
      }),
    },
  ],
  renderDOM: ({ HTMLAttributes, node }) => {
    const outer = mergeBlockHTMLAttributes(HTMLAttributes, {
      styleVars: { "--block-pad-top": "var(--rune-media-pad-top)" },
    })
    return [
      "div",
      outer,
      [
        "div",
        {
          class: "rune-equation-block",
          "data-type": "equation-block",
          "data-latex": String(node.attrs.latex ?? ""),
        },
      ],
    ]
  },
  toMarkdown({ prefix, node }) {
    const latex = typeof node.attrs.latex === "string" ? node.attrs.latex : ""
    const indentedLatex = latex.split("\n").map((line) => `${prefix}${line}`).join("\n")
    return {
      line: `${prefix}$$\n${indentedLatex}\n${prefix}$$`,
      spacing: "isolated",
    }
  },
  clipboardRenderDOM: ({ node }) => [
    "p",
    {},
    `$$${String(node.attrs.latex ?? "")}$$`,
  ],
  slashMenuItems: () => {
    const block = { type: "equationBlock" as const, props: { latex: "" } }
    return [
      {
        key: "blockEquation",
        title: "Block Equation",
        aliases: ["block equation", "equation", "math", "latex", "katex", "tex", "formula"],
        group: "Basic blocks",
        block,
        onItemClick: ({ editor, range }) => {
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertEquationBlock({ latex: "" })
            .run()
        },
      },
    ]
  },
  sideMenu: { draggable: true },
  extensions: [EquationBlockCommands],
})

export interface RuneEquationBlock extends RuneBlockBase {
  type: "equationBlock"
  latex: string
}
