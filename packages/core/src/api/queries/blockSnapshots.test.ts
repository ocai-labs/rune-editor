// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, expect, it } from "vitest"
import { Editor } from "@tiptap/core"
import { createBlockSpec, createRuneKit } from "../../index"
import {
  getBlockOutline,
  getBlockSnapshot,
} from "./blockSnapshots"

function makeEditor(content: unknown, extensions = createRuneKit({ suggestionMenus: false })) {
  return new Editor({
    element: document.createElement("div"),
    extensions,
    content: content as never,
  })
}

describe("block snapshots", () => {
  it("returns ordered block outline with trimmed, collapsed, capped previews", () => {
    const long = "word ".repeat(40)
    const editor = makeEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { id: "a", depth: 0 },
          content: [{ type: "text", text: "  Alpha   beta  " }],
        },
        {
          type: "heading",
          attrs: { id: "b", depth: 1, level: 2 },
          content: [{ type: "text", text: long }],
        },
      ],
    })

    const outline = getBlockOutline(editor)

    expect(outline[0]).toEqual({
      id: "a",
      type: "paragraph",
      depth: 0,
      index: 0,
      preview: "Alpha beta",
    })
    expect(outline[1]?.id).toBe("b")
    expect(outline[1]?.type).toBe("heading")
    expect(outline[1]?.depth).toBe(1)
    expect(outline[1]?.index).toBe(1)
    expect(Array.from(outline[1]?.preview ?? "")).toHaveLength(120)

    editor.destroy()
  })

  it("returns block-local markdown and text for a built-in block", () => {
    const editor = makeEditor({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { id: "h", depth: 0, level: 3 },
          content: [{ type: "text", text: "Heading text" }],
        },
      ],
    })

    const result = getBlockSnapshot(editor, "h")

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.block).toMatchObject({
        id: "h",
        type: "heading",
        depth: 0,
        level: 3,
        text: "Heading text",
      })
      expect(result.data.markdown).toBe("### Heading text")
      expect(result.data.text).toBe("Heading text")
    }

    editor.destroy()
  })

  it("returns empty markdown and PM text for plugin blocks without toMarkdown", () => {
    const PlainPlugin = createBlockSpec({
      type: "plainPlugin",
      content: "inline*",
      parseDOM: [{ tag: "p[data-plain-plugin]" }],
      renderDOM: ({ HTMLAttributes }) => [
        "p",
        { ...HTMLAttributes, "data-plain-plugin": "true" },
        0,
      ],
      toRuneBlock: (node) => ({
        type: "plainPlugin",
        id: String(node.attrs.id ?? ""),
        depth: Number(node.attrs.depth ?? 0),
        text: node.textContent,
      }),
      fromInput: ({ schema, input, defaults }) => {
        const type = schema.nodes.plainPlugin
        if (!type) return null
        const text = typeof (input as unknown as { text?: unknown }).text === "string"
          ? (input as unknown as { text: string }).text
          : ""
        return type.create(
          { id: input.id ?? null, depth: input.depth ?? defaults.depth },
          text ? schema.text(text) : undefined,
        )
      },
    })
    const editor = makeEditor(
      {
        type: "doc",
        content: [
          {
            type: "plainPlugin",
            attrs: { id: "plugin", depth: 0 },
            content: [{ type: "text", text: "Plugin text" }],
          },
        ],
      },
      createRuneKit({
        suggestionMenus: false,
        plugins: [{ id: "plain-plugin", blockExtensions: [PlainPlugin] }],
      }),
    )

    const result = getBlockSnapshot(editor, "plugin")

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.block).toEqual({
        type: "plainPlugin",
        id: "plugin",
        depth: 0,
        text: "Plugin text",
      })
      expect(result.data.markdown).toBe("")
      expect(result.data.text).toBe("Plugin text")
    }

    editor.destroy()
  })

  it("returns unsupported for plugin blocks without toRuneBlock", () => {
    const UnprojectablePlugin = createBlockSpec({
      type: "unprojectablePlugin",
      content: "inline*",
      parseDOM: [{ tag: "p[data-unprojectable-plugin]" }],
      renderDOM: ({ HTMLAttributes }) => [
        "p",
        { ...HTMLAttributes, "data-unprojectable-plugin": "true" },
        0,
      ],
      fromInput: ({ schema, input, defaults }) => {
        const type = schema.nodes.unprojectablePlugin
        if (!type) return null
        const text = typeof (input as unknown as { text?: unknown }).text === "string"
          ? (input as unknown as { text: string }).text
          : ""
        return type.create(
          { id: input.id ?? null, depth: input.depth ?? defaults.depth },
          text ? schema.text(text) : undefined,
        )
      },
    })
    const editor = makeEditor(
      {
        type: "doc",
        content: [
          {
            type: "unprojectablePlugin",
            attrs: { id: "plugin", depth: 0 },
            content: [{ type: "text", text: "Plugin text" }],
          },
        ],
      },
      createRuneKit({
        suggestionMenus: false,
        plugins: [{ id: "unprojectable-plugin", blockExtensions: [UnprojectablePlugin] }],
      }),
    )

    const result = getBlockSnapshot(editor, "plugin")

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe("unsupported")
    }

    editor.destroy()
  })

  it("returns not-found for missing block ids", () => {
    const editor = makeEditor({ type: "doc", content: [] })
    const result = getBlockSnapshot(editor, "missing")

    expect(result).toEqual({
      ok: false,
      error: {
        code: "not-found",
        message: 'Block "missing" was not found.',
      },
    })

    editor.destroy()
  })
})
