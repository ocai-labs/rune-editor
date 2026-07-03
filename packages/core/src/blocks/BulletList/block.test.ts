// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, expect, it } from "vitest"
import { Editor } from "@tiptap/core"
import Document from "@tiptap/extension-document"
import Text from "@tiptap/extension-text"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import { BulletList } from "./block"

function makeEditor(content?: object) {
  return new Editor({
    element: document.createElement("div"),
    extensions: [Document, Text, BulletList],
    content: content as never,
  })
}

function getBulletListExtension(editor: Editor) {
  const ext = editor.extensionManager.extensions.find((e) => e.name === "bulletList")
  expect(ext).toBeDefined()
  return ext!
}

type BulletListExtensionConfig = {
  config: { parseHTML?: () => Array<{ tag: string; getAttrs?: (el: HTMLElement) => Record<string, unknown> }> }
}

describe("BulletList block — schema + storage", () => {
  it("exposes the bullet slash item, draggable side-menu, and input-rule extension", () => {
    const editor = makeEditor()
    const ext = getBulletListExtension(editor)

    const items = (ext.storage as { slashMenuItems?: (editor: Editor) => Array<{ key: string; title: string; aliases: string[]; group: string }> }).slashMenuItems?.(editor)
    expect(items).toHaveLength(1)
    expect(items?.[0]).toMatchObject({
      key: "bulletList",
      title: "Bulleted list",
      aliases: ["ul", "bullet", "list", "•"],
      group: "Basic blocks",
    })

    expect((ext.storage as { sideMenu?: { draggable: boolean } }).sideMenu).toEqual({ draggable: true })
    expect(editor.extensionManager.extensions.some((e) => e.name === "bulletList--input-rule")).toBe(true)

    editor.destroy()
  })

  it("exposes the ul > li external-paste rule (after the round-trip div rule) that reads paste depth", () => {
    const editor = makeEditor()
    const ext = getBulletListExtension(editor) as BulletListExtensionConfig
    const rules = ext.config.parseHTML?.()
    const li = document.createElement("li")
    li.setAttribute("data-rune-paste-depth", "2")

    expect(rules).toHaveLength(2)
    expect(rules?.[1]).toMatchObject({ tag: "ul > li" })
    expect(rules?.[1]?.getAttrs?.(li)).toMatchObject({ depth: 2 })

    editor.destroy()
  })
})

describe("BulletList block — DOM + clipboard", () => {
  it("parseDOM round-trips <ul><li>alpha</li></ul> into one bulletList block", () => {
    const editor = makeEditor()

    editor.commands.setContent("<ul><li>alpha</li></ul>")

    expect(editor.state.doc.childCount).toBe(1)
    expect(editor.state.doc.firstChild?.type.name).toBe("bulletList")
    expect(editor.state.doc.firstChild?.textContent).toBe("alpha")

    editor.destroy()
  })

  it("parses data-rune-paste-depth and data-depth from ul li elements", () => {
    const editor = makeEditor()

    editor.commands.setContent(
      '<ul><li data-rune-paste-depth="2">nested</li><li data-depth="1">fallback</li></ul>',
    )

    expect(editor.state.doc.child(0)?.attrs.depth).toBe(2)
    expect(editor.state.doc.child(1)?.attrs.depth).toBe(1)

    editor.destroy()
  })

  it("renders .rune-block.rune-bullet-list > .rune-block-content > p", () => {
    const editor = makeEditor({
      type: "doc",
      content: [{ type: "bulletList", content: [{ type: "text", text: "alpha" }] }],
    })

    const outer = editor.view.dom.querySelector<HTMLElement>(".rune-block.rune-bullet-list")
    expect(outer).not.toBeNull()
    expect(outer!.firstElementChild?.classList.contains("rune-block-content")).toBe(true)

    const content = outer!.querySelector<HTMLElement>(".rune-block-content")
    expect(content).not.toBeNull()
    expect(content!.children).toHaveLength(1)
    expect(content!.firstElementChild?.tagName).toBe("P")
    expect(content!.firstElementChild?.textContent).toBe("alpha")

    editor.destroy()
  })

  it("clipboardRenderDOM emits ['ul', {}, ['li', {}, 0]]", () => {
    const editor = makeEditor()
    const ext = getBulletListExtension(editor)
    const node = editor.schema.nodes.bulletList!.create()
    const out = (ext.storage as { clipboardRenderDOM?: (args: { node: ProseMirrorNode }) => unknown }).clipboardRenderDOM?.({ node })

    expect(out).toEqual(["ul", {}, ["li", {}, 0]])

    editor.destroy()
  })
})

describe("BulletList block — model conversion", () => {
  it("round-trips fromInput and toRuneBlock with text, id, and depth", () => {
    const editor = makeEditor()
    const ext = getBulletListExtension(editor)
    const fromInput = (ext.storage as {
      fromInput?: (args: {
        schema: typeof editor.schema
        input: { type: string; id?: string; depth?: number; text?: string }
        defaults: { depth: number; attrs: Record<string, unknown>; preserveContent: boolean; content?: ProseMirrorNode; marks?: never }
      }) => ProseMirrorNode | null
    }).fromInput
    const toRuneBlock = (ext.storage as {
      toRuneBlock?: (node: ProseMirrorNode) => { type: "bulletList"; id: string; depth: number; text: string }
    }).toRuneBlock

    const node = fromInput?.({
      schema: editor.schema,
      input: { type: "bulletList", id: "bullet-id", depth: 2, text: "alpha" },
      defaults: { depth: 0, attrs: {}, preserveContent: false },
    })

    expect(node?.type.name).toBe("bulletList")
    expect(node?.attrs).toMatchObject({ id: "bullet-id", depth: 2 })
    expect(node?.textContent).toBe("alpha")
    expect(toRuneBlock?.(node!)).toEqual({ type: "bulletList", id: "bullet-id", depth: 2, text: "alpha" })

    editor.destroy()
  })
})
