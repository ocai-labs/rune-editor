// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, expect, it } from "vitest"
import { Editor } from "@tiptap/core"
import Document from "@tiptap/extension-document"
import Text from "@tiptap/extension-text"
import { Paragraph } from "../../blocks/Paragraph/block"
import { Table } from "../../blocks/Table/block"
import { TextStyleWithColorAttrs } from "./TextStyleWithColorAttrs"
import { BackgroundColor, TextColor } from "."

const setup = () =>
  new Editor({
    element: document.createElement("div"),
    extensions: [Document, Paragraph, Text, TextStyleWithColorAttrs, BackgroundColor],
  })

const setupWithTable = () =>
  new Editor({
    element: document.createElement("div"),
    extensions: [
      Document,
      Paragraph,
      Text,
      Table,
      TextStyleWithColorAttrs,
      TextColor,
      BackgroundColor,
    ],
  })

function firstTableParagraphPos(editor: Editor) {
  let found = -1
  editor.state.doc.descendants((node, pos) => {
    if (found === -1 && node.type.name === "tableParagraph") found = pos
    return true
  })
  return found
}

describe("BackgroundColor", () => {
  it("registers `runeBackgroundColor` extension", () => {
    const editor = setup()
    const ext = editor.extensionManager.extensions.find(
      (e) => e.name === "runeBackgroundColor",
    )
    expect(ext).toBeDefined()
    editor.destroy()
  })

  it("setRuneBackgroundColor('yellow') writes the mark attr", () => {
    const editor = setup()
    editor.commands.setContent("<p>hello</p>")
    editor.commands.setTextSelection({ from: 1, to: 6 })
    editor.commands.setRuneBackgroundColor("yellow")
    const text = editor.state.doc.firstChild!.firstChild!
    const mark = text.marks.find((m) => m.type.name === "textStyle")
    expect(mark?.attrs.backgroundColor).toBe("yellow")
    editor.destroy()
  })

  it("setRuneBackgroundColor('default') coalesces to null", () => {
    const editor = setup()
    editor.commands.setContent("<p>hello</p>")
    editor.commands.setTextSelection({ from: 1, to: 6 })
    editor.commands.setRuneBackgroundColor("yellow")
    editor.commands.setRuneBackgroundColor("default")
    const text = editor.state.doc.firstChild!.firstChild!
    const mark = text.marks.find((m) => m.type.name === "textStyle")
    if (mark) expect(mark.attrs.backgroundColor).toBeNull()
    else expect(mark).toBeUndefined()
    editor.destroy()
  })

  it("unsetRuneBackgroundColor removes the mark when no other attrs remain", () => {
    const editor = setup()
    editor.commands.setContent("<p>hello</p>")
    editor.commands.setTextSelection({ from: 1, to: 6 })
    editor.commands.setRuneBackgroundColor("yellow")
    editor.commands.unsetRuneBackgroundColor()
    const text = editor.state.doc.firstChild!.firstChild!
    const mark = text.marks.find((m) => m.type.name === "textStyle")
    expect(mark).toBeUndefined()
    editor.destroy()
  })

  it("renders <span data-background-color='yellow'>", () => {
    const editor = setup()
    editor.commands.setContent("<p>hello</p>")
    editor.commands.setTextSelection({ from: 1, to: 6 })
    editor.commands.setRuneBackgroundColor("yellow")
    expect(editor.getHTML()).toContain('data-background-color="yellow"')
    editor.destroy()
  })

  it("parses a bare <mark> as the yellow highlight anchor (D4)", () => {
    const editor = setup()
    editor.commands.setContent("<p><mark>hi</mark></p>")
    const text = editor.state.doc.firstChild!.firstChild!
    const mark = text.marks.find((m) => m.type.name === "textStyle")
    expect(mark?.attrs.backgroundColor).toBe("yellow")
    editor.destroy()
  })

  it("parses <mark data-color='blue'> as the named palette background (D4)", () => {
    const editor = setup()
    editor.commands.setContent('<p><mark data-color="blue">hi</mark></p>')
    const text = editor.state.doc.firstChild!.firstChild!
    const mark = text.marks.find((m) => m.type.name === "textStyle")
    expect(mark?.attrs.backgroundColor).toBe("blue")
    editor.destroy()
  })

  it("parses inline style='background-color: <hex>' via nearestColorName", () => {
    const editor = setup()
    // #504425 is the M4a yellow background hex (color-palette.css).
    editor.commands.setContent(
      '<p><span style="background-color:#504425">hi</span></p>',
    )
    const text = editor.state.doc.firstChild!.firstChild!
    const mark = text.marks.find((m) => m.type.name === "textStyle")
    expect(mark?.attrs.backgroundColor).toBe("yellow")
    editor.destroy()
  })

  it("stacks with TextColor — both attrs on a single textStyle mark (setMark merges)", () => {
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: [
        Document,
        Paragraph,
        Text,
        TextStyleWithColorAttrs,
        TextColor,
        BackgroundColor,
      ],
    })
    editor.commands.setContent("<p>hello</p>")
    editor.commands.setTextSelection({ from: 1, to: 6 })

    editor.commands.setRuneTextColor("blue")
    // Lock the setMark-merge assumption explicitly: the second setMark
    // must NOT clobber attrs the first set. Spec/plan rely on this; if
    // a Tiptap bump changes setMark to a replace, we want the failing
    // test to point straight at this line, not at a downstream regex.
    editor.commands.setRuneBackgroundColor("yellow")
    const text = editor.state.doc.firstChild!.firstChild!
    const mark = text.marks.find((m) => m.type.name === "textStyle")
    expect(mark?.attrs.textColor).toBe("blue")
    expect(mark?.attrs.backgroundColor).toBe("yellow")

    // Single span — both attrs present, no nesting. Stay loose on inner
    // text content (PM occasionally wraps differently across versions);
    // the load-bearing claims are "both attrs there" + "no nested span".
    const html = editor.getHTML()
    expect(html).toContain('data-text-color="blue"')
    expect(html).toContain('data-background-color="yellow"')
    expect(html).not.toMatch(/<span[^>]*>\s*<span/)  // no nested spans
    editor.destroy()
  })

  it("applies text and background colors inside tableParagraph content", () => {
    const editor = setupWithTable()
    editor.commands.insertTable({ rows: 2, cols: 2 })
    const pos = firstTableParagraphPos(editor)
    expect(pos).toBeGreaterThanOrEqual(0)
    editor.commands.insertContentAt(pos + 1, "hello")
    editor.commands.setTextSelection({ from: pos + 1, to: pos + 6 })

    editor.commands.setRuneTextColor("red")
    editor.commands.setRuneBackgroundColor("yellow")

    const textStyleAttrs: Record<string, unknown>[] = []
    editor.state.doc.descendants((node) => {
      if (textStyleAttrs.length === 0 && node.isText) {
        const attrs = node.marks.find((mark) => mark.type.name === "textStyle")?.attrs
        if (attrs) textStyleAttrs.push(attrs)
      }
      return true
    })
    expect(textStyleAttrs[0]?.textColor).toBe("red")
    expect(textStyleAttrs[0]?.backgroundColor).toBe("yellow")

    const html = editor.getHTML()
    expect(html).toContain("<table")
    expect(html).toContain('data-text-color="red"')
    expect(html).toContain('data-background-color="yellow"')
    editor.destroy()
  })
})
