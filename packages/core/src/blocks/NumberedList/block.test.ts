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

import { Paragraph } from "../Paragraph/block"
import { NumberedList } from "./block"

type NumberedListStorage = {
  slashMenuItems?: (editor: Editor) => Array<{
    key: string
    title: string
    aliases?: string[]
    group?: string
  }>
  sideMenu?: { draggable: boolean }
  clipboardRenderDOM?: (args: { node: ProseMirrorNode }) => unknown
  toRuneBlock?: (node: ProseMirrorNode) => {
    type: string
    id: string
    depth: number
    text: string
    start: number | null
  }
  fromInput?: (args: {
    schema: Editor["schema"]
    input: {
      type: string
      text?: string
      start?: number | null
      id?: string | null
      depth?: number | null
    }
      defaults: {
        attrs: Record<string, unknown>
        depth: number
        marks: readonly unknown[]
      content?: ProseMirrorNode[] | null
        preserveContent?: boolean
      }
  }) => ProseMirrorNode | null
}

function makeEditor(content?: object) {
  return new Editor({
    element: document.createElement("div"),
    extensions: [Document, NumberedList, Text],
    content: content as never,
  })
}

function storage(editor: Editor) {
  return editor.extensionManager.extensions.find((e) => e.name === "numberedList")
    ?.storage as NumberedListStorage
}

describe("NumberedList block", () => {
  it("turns typed 5. into a numberedList starting at 5", async () => {
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: [Document, Paragraph, NumberedList, Text],
      content: "<p>5.</p>",
    })

    editor.commands.setTextSelection(3)
    await triggerInputRule(editor, 1, 3, " ")

    expect(editor.state.doc.firstChild?.type.name).toBe("numberedList")
    expect(editor.state.doc.firstChild?.attrs.start).toBe(5)

    editor.destroy()
  })

  it("registers the slash item, draggable side-menu, and input rule hooks", () => {
    const editor = makeEditor()
    const s = storage(editor)

    const items = s.slashMenuItems?.(editor)
    expect(items).toHaveLength(1)
    expect(items?.[0]).toMatchObject({
      key: "numberedList",
      title: "Numbered list",
      aliases: ["ol", "numbered", "1."],
      group: "Basic blocks",
    })
    expect(s.sideMenu).toEqual({ draggable: true })

    const ext = editor.extensionManager.extensions.find((e) => e.name === "numberedList--input-rule")
    expect(ext).toBeDefined()

    editor.destroy()
  })

  it("parses raw <ol start> onto the first li and keeps renderHTML start nullable", () => {
    const editor = makeEditor({
      type: "doc",
    })

    editor.commands.setContent('<ol start="5"><li>five</li><li>six</li></ol>')

    expect(editor.state.doc.firstChild?.type.name).toBe("numberedList")
    expect(editor.state.doc.firstChild?.attrs.start).toBe(5)
    expect(editor.state.doc.lastChild?.attrs.start).toBeNull()

    const html = editor.getHTML()
    expect(html).toContain('data-start="5"')

    editor.commands.setContent({
      type: "doc",
      content: [{ type: "numberedList", content: [{ type: "text", text: "one" }] }],
    } as never)
    expect(editor.getHTML()).not.toContain("data-start")

    editor.destroy()
  })

  it("uses the correct DOM wrappers and bare clipboard HTML", () => {
    const editor = makeEditor({
      type: "doc",
      content: [{ type: "numberedList", attrs: { start: 3 }, content: [{ type: "text", text: "three" }] }],
    })

    const outer = editor.view.dom.querySelector<HTMLElement>(".rune-block")
    expect(outer).not.toBeNull()
    expect(outer!.classList.contains("rune-numbered-list")).toBe(true)

    const inner = outer!.firstElementChild as HTMLElement
    expect(inner.classList.contains("rune-block-content")).toBe(true)
    expect(inner.children).toHaveLength(1)
    expect((inner.firstElementChild as HTMLElement).tagName).toBe("P")

    const clip = storage(editor).clipboardRenderDOM?.({
      node: editor.schema.nodes.numberedList!.create({ start: 3 }),
    })
    expect(clip).toEqual(["ol", { start: "3" }, ["li", {}, 0]])

    const clipDefault = storage(editor).clipboardRenderDOM?.({
      node: editor.schema.nodes.numberedList!.create({ start: null }),
    })
    expect(clipDefault).toEqual(["ol", {}, ["li", {}, 0]])

    const clipStartOne = storage(editor).clipboardRenderDOM?.({
      node: editor.schema.nodes.numberedList!.create({ start: 1 }),
    })
    expect(clipStartOne).toEqual(["ol", {}, ["li", {}, 0]])

    editor.destroy()
  })

  it("exposes schema parseDOM specificity and preserved content construction", () => {
    const editor = makeEditor()
    const ext = editor.extensionManager.extensions.find((e) => e.name === "numberedList") as {
      config?: { parseHTML?: () => Array<{ tag: string; getAttrs?: (el: HTMLElement) => Record<string, unknown> }> }
    }
    const rules = ext.config?.parseHTML?.()
    const li = document.createElement("li")
    li.setAttribute("data-start", "5")
    li.setAttribute("data-rune-paste-depth", "2")
    expect(rules).toHaveLength(2)
    expect(rules?.[1]).toMatchObject({ tag: "ol > li" })
    expect(rules?.[1]?.getAttrs?.(li)).toMatchObject({ start: 5, depth: 2 })

    const s = storage(editor)
    const node = s.fromInput?.({
      schema: editor.schema,
      input: { type: "numberedList", id: "num-1", text: "n", start: 3, depth: 4 },
      defaults: {
        attrs: { id: "existing", depth: 1 },
        depth: 2,
        marks: [],
        preserveContent: true,
        content: [editor.schema.text("keep")],
      },
    })
    expect(node?.attrs.id).toBe("num-1")
    expect(node?.attrs.depth).toBe(4)
    expect(node?.attrs.start).toBe(3)
    expect(node?.textContent).toBe("keep")

    const rune = s.toRuneBlock?.(node!)
    expect(rune).toMatchObject({ type: "numberedList", start: 3, text: "keep" })

    editor.destroy()
  })

  it("parses flat li data-start and data-rune-paste-depth", () => {
    const editor = makeEditor({
      type: "doc",
    })

    editor.commands.setContent(
      "<ol><li data-start=\"5\" data-rune-paste-depth=\"2\">x</li><li data-rune-paste-depth=\"2\">y</li></ol>",
    )

    expect(editor.state.doc.child(0)?.attrs.start).toBe(5)
    expect(editor.state.doc.child(0)?.attrs.depth).toBe(2)
    expect(editor.state.doc.child(1)?.attrs.start).toBeNull()
    expect(editor.state.doc.child(1)?.attrs.depth).toBe(2)

    editor.destroy()
  })
})

async function triggerInputRule(editor: Editor, from: number, to: number, text: string) {
  const handled = editor.view.someProp("handleTextInput", (fn) =>
    fn(editor.view, to, to, text, null as never),
  )
  if (handled) return
  editor.view.dispatch(editor.state.tr.setMeta("applyInputRules", { from: to, text }))
  await new Promise((r) => setTimeout(r, 0))
}
