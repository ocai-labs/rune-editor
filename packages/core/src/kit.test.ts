// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, expect, it } from "vitest"
import { Editor, Extension, Node } from "@tiptap/core"
import { createBlockSpec, createRuneKit, getBlockSpecs } from "./index"

const PluginBlock = createBlockSpec({
  type: "pluginBlock",
  content: "inline*",
  parseDOM: [{ tag: "p[data-plugin-block]", priority: 51 }],
  renderDOM: ({ HTMLAttributes }) => ["p", { ...HTMLAttributes, "data-plugin-block": "" }, 0],
  sideMenu: { draggable: true },
  toRuneBlock(node) {
    return {
      type: "pluginBlock",
      id: typeof node.attrs.id === "string" ? node.attrs.id : "",
      depth: typeof node.attrs.depth === "number" ? node.attrs.depth : 0,
      text: node.textContent,
    }
  },
})

const SupportExtension = Extension.create({
  name: "pluginSupport",
})

const RawPluginBlock = Node.create({
  name: "rawPluginBlock",
  group: "block",
  content: "inline*",
  parseHTML() {
    return [{ tag: "p[data-raw-plugin-block]" }]
  },
  renderHTML() {
    return ["p", { "data-raw-plugin-block": "" }, 0]
  },
})

describe("createRuneKit plugins", () => {
  it("registers plugin block extensions and support extensions", () => {
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: createRuneKit({
        plugins: [
          {
            id: "plugin-a",
            blockExtensions: [PluginBlock],
            extensions: [SupportExtension],
          },
        ],
      }),
    })

    expect(editor.schema.nodes.pluginBlock).toBeDefined()
    expect(editor.extensionManager.extensions.some((ext) => ext.name === "pluginSupport")).toBe(true)
    expect(getBlockSpecs(editor).pluginBlock).toBeDefined()

    const blockId = editor.extensionManager.extensions.find((ext) => ext.name === "blockId")!
    expect((blockId.options as { types: string[] }).types).toContain("pluginBlock")

    editor.destroy()
  })

  it("accepts configured factory-built plugin blocks", () => {
    const ConfiguredPlugin = PluginBlock.configure({})
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: createRuneKit({
        plugins: [{ id: "configured", blockExtensions: [ConfiguredPlugin] }],
      }),
    })

    expect(editor.schema.nodes.pluginBlock).toBeDefined()
    const blockId = editor.extensionManager.extensions.find((ext) => ext.name === "blockId")!
    expect((blockId.options as { types: string[] }).types).toContain("pluginBlock")

    editor.destroy()
  })

  it("rejects plugin block extensions that were not built with createBlockSpec", () => {
    expect(() =>
      createRuneKit({
        plugins: [{ id: "raw", blockExtensions: [RawPluginBlock] }],
      }),
    ).toThrow(
      "Rune plugin raw blockExtensions must be created with createBlockSpec: rawPluginBlock",
    )
  })

  it("throws on duplicate plugin ids", () => {
    expect(() =>
      createRuneKit({
        plugins: [
          { id: "dupe", extensions: [] },
          { id: "dupe", extensions: [] },
        ],
      }),
    ).toThrow("Duplicate Rune plugin id: dupe")
  })

  it("registers shared media feature extensions once", () => {
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: createRuneKit(),
    })

    // MediaImport is registered under name "imageImport" (legacy name).
    expect(
      editor.extensionManager.extensions.filter((ext) => ext.name === "imageImport"),
    ).toHaveLength(1)
    expect(
      editor.extensionManager.extensions.filter((ext) => ext.name === "mediaPopover"),
    ).toHaveLength(1)

    editor.destroy()
  })
})

describe("createRuneKit code mark (re-registered: low priority + narrowed excludes)", () => {
  function makeEditor() {
    return new Editor({
      element: document.createElement("div"),
      extensions: createRuneKit(),
    })
  }

  it("code coexists with formatting/colour marks but still excludes link/wikiLink/internalRef", () => {
    const editor = makeEditor()
    const m = editor.schema.marks

    // StarterKit's Code is `excludes: "_"` (excludes EVERY mark). Ours narrows
    // that to navigation/reference marks only, so a code span can now also be
    // bold/italic/strike/underline and carry an inline colour (textStyle) —
    // matching Notion. These are the marks code must now tolerate:
    expect(m.code!.excludes(m.bold!)).toBe(false)
    expect(m.code!.excludes(m.italic!)).toBe(false)
    expect(m.code!.excludes(m.strike!)).toBe(false)
    expect(m.code!.excludes(m.underline!)).toBe(false)
    expect(m.code!.excludes(m.textStyle!)).toBe(false)

    // Preserved guarantee: a verbatim code span still cannot ALSO be a
    // link / wikiLink / internalRef (these stay mutually exclusive).
    expect(m.code!.excludes(m.link!)).toBe(true)
    expect(m.code!.excludes(m.wikiLink!)).toBe(true)
    expect(m.code!.excludes(m.internalRef!)).toBe(true)

    editor.destroy()
  })

  it("applying bold then code leaves BOTH marks on the text (coexist end-to-end)", () => {
    const editor = makeEditor()
    editor.commands.setContent("<p>hello</p>")
    editor.commands.setTextSelection({ from: 1, to: 6 })
    editor.commands.setMark("bold")
    editor.commands.setMark("code")

    const names = new Set<string>()
    editor.state.doc.descendants((node) => {
      if (node.isText) node.marks.forEach((mk) => names.add(mk.type.name))
    })
    expect(names.has("bold")).toBe(true)
    expect(names.has("code")).toBe(true)

    editor.destroy()
  })
})
