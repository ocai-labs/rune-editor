// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, expect, it } from "vitest"
import { Editor } from "@tiptap/core"
import Document from "@tiptap/extension-document"
import Text from "@tiptap/extension-text"
import {
  createBlockSpec,
  createRuneKit,
  findBlocks,
  getBlockById,
  getDocument,
} from "../../index"

function makeEditor(content: unknown) {
  const element = document.createElement("div")
  document.body.appendChild(element)
  const editor = new Editor({
    element,
    extensions: createRuneKit({ suggestionMenus: false }),
    content: content as never,
  })
  return {
    editor,
    destroy: () => {
      editor.destroy()
      element.remove()
    },
  }
}

describe("Block API queries", () => {
  it("returns built-in blocks in document order with populated id and depth", () => {
    const { editor, destroy } = makeEditor({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { id: "heading-1", depth: 0, level: 3 },
          content: [{ type: "text", text: "Heading" }],
        },
        {
          type: "paragraph",
          attrs: { id: "paragraph-1", depth: 1 },
          content: [{ type: "text", text: "Body" }],
        },
        { type: "divider", attrs: { id: "divider-1", depth: 1 } },
      ],
    })

    expect(getDocument(editor)).toEqual([
      { type: "heading", id: "heading-1", depth: 0, level: 3, text: "Heading" },
      { type: "paragraph", id: "paragraph-1", depth: 1, text: "Body" },
      { type: "divider", id: "divider-1", depth: 1 },
    ])
    destroy()
  })

  it("finds blocks by id and predicate", () => {
    const { editor, destroy } = makeEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { id: "first", depth: 0 },
          content: [{ type: "text", text: "One" }],
        },
        {
          type: "heading",
          attrs: { id: "second", depth: 2, level: 4 },
          content: [{ type: "text", text: "Two" }],
        },
      ],
    })

    expect(getBlockById(editor, "second")).toEqual({
      type: "heading",
      id: "second",
      depth: 2,
      level: 4,
      text: "Two",
    })
    expect(getBlockById(editor, "missing")).toBeNull()
    expect(findBlocks(editor, (block) => block.depth > 0)).toEqual([
      { type: "heading", id: "second", depth: 2, level: 4, text: "Two" },
    ])
    destroy()
  })

  it("includes blocks declared via createBlockSpec.toRuneBlock", () => {
    const Custom = createBlockSpec({
      type: "custom-projection",
      content: "inline*",
      parseDOM: [{ tag: "custom-projection" }],
      renderDOM: ({ HTMLAttributes }) => ["span", HTMLAttributes, 0],
      toRuneBlock: (node) => ({
        type: "custom-projection",
        id: typeof node.attrs.id === "string" ? node.attrs.id : "",
        depth: typeof node.attrs.depth === "number" ? node.attrs.depth : 0,
        label: node.textContent,
      }),
    })
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: [Document, Text, Custom],
      content: {
        type: "doc",
        content: [
          {
            type: "custom-projection",
            attrs: { id: "custom-id", depth: 2 },
            content: [{ type: "text", text: "x" }],
          },
        ],
      },
    })
    const blocks = getDocument(editor) as Array<{
      type: string
      id: string
      depth: number
      label?: string
    }>
    expect(blocks).toEqual([
      { type: "custom-projection", id: "custom-id", depth: 2, label: "x" },
    ])
    expect(getBlockById(editor, "custom-id") as unknown).toEqual(blocks[0])
    expect(findBlocks(editor, (block) => block.depth === 2) as unknown).toEqual(blocks)
    editor.destroy()
  })

  it("lets a container block recurse into children via ctx.projectChild", () => {
    // The registered body block whose projection the wrapper recurses into.
    const Leaf = createBlockSpec({
      type: "leaf-block",
      content: "inline*",
      parseDOM: [{ tag: "leaf-block" }],
      renderDOM: ({ HTMLAttributes }) => ["p", HTMLAttributes, 0],
      toRuneBlock: (node) => ({
        type: "leaf-block",
        id: typeof node.attrs.id === "string" ? node.attrs.id : "",
        depth: typeof node.attrs.depth === "number" ? node.attrs.depth : 0,
        text: node.textContent,
      }),
    })

    // A structural wrapper that contains real registered body blocks. Its
    // projection recurses into each child via ctx.projectChild.
    const Wrapper = createBlockSpec({
      type: "wrapper-block",
      // Body blocks all share group "block" (the factory sets it); the
      // wrapper accepts one-or-more of them.
      content: "block+",
      parseDOM: [{ tag: "wrapper-block" }],
      renderDOM: ({ HTMLAttributes }) => ["div", HTMLAttributes, 0],
      toRuneBlock: (node, ctx) => {
        const children: unknown[] = []
        node.forEach((child) => {
          // getDocument/blockFromNode always supplies ctx; container
          // blocks only run through that production path.
          const projected = ctx!.projectChild(child)
          if (projected) children.push(projected)
        })
        return {
          type: "wrapper-block",
          id: typeof node.attrs.id === "string" ? node.attrs.id : "",
          depth: typeof node.attrs.depth === "number" ? node.attrs.depth : 0,
          children,
        }
      },
    })

    const editor = new Editor({
      element: document.createElement("div"),
      extensions: [Document, Text, Leaf, Wrapper],
      content: {
        type: "doc",
        content: [
          {
            type: "wrapper-block",
            attrs: { id: "wrap-1", depth: 0 },
            content: [
              {
                type: "leaf-block",
                attrs: { id: "leaf-1", depth: 0 },
                content: [{ type: "text", text: "a" }],
              },
              {
                type: "leaf-block",
                attrs: { id: "leaf-2", depth: 0 },
                content: [{ type: "text", text: "b" }],
              },
            ],
          },
        ],
      },
    })

    const blocks = getDocument(editor)
    // Each child projection must equal the child's own toRuneBlock output
    // (i.e. the same thing getDocument would produce for that child top-level).
    expect(blocks).toEqual([
      {
        type: "wrapper-block",
        id: "wrap-1",
        depth: 0,
        children: [
          { type: "leaf-block", id: "leaf-1", depth: 0, text: "a" },
          { type: "leaf-block", id: "leaf-2", depth: 0, text: "b" },
        ],
      },
    ])
    editor.destroy()
  })
})
