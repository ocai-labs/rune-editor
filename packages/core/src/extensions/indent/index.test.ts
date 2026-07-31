// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, expect, it } from "vitest"
import { Editor } from "@tiptap/core"
import Document from "@tiptap/extension-document"
import Text from "@tiptap/extension-text"
import { TextSelection } from "@tiptap/pm/state"
import { createBlockSpec } from "../../schema/blocks/createSpec"
import { BlockCommands } from "../../api/commands"
import { Toggle } from "../../blocks/Toggle/block"
import { Indent } from "./index"

const Paragraph = createBlockSpec({
  type: "paragraph",
  content: "inline*",
  parseDOM: [{ tag: "p" }],
  renderDOM: ({ HTMLAttributes }) => ["p", HTMLAttributes, 0],
})

const Bullet = createBlockSpec({
  type: "bulletList",
  content: "inline*",
  parseDOM: [{ tag: "ul > li" }],
  renderDOM: ({ HTMLAttributes }) => ["div", HTMLAttributes, ["p", {}, 0]],
  indent: { mode: "structural" },
})

const Heading = createBlockSpec({
  type: "heading",
  content: "inline*",
  props: { level: { default: 1 } },
  parseDOM: [{ tag: "h1" }],
  renderDOM: ({ HTMLAttributes }) => ["h1", HTMLAttributes, 0],
})

function makeEditor(content: Record<string, unknown>) {
  const editor = new Editor({
    extensions: [Document, Text, Paragraph, Heading, Bullet, Toggle, BlockCommands, Indent],
    content: content as never,
  })
  return { editor, destroy: () => editor.destroy() }
}

function setCaret(editor: Editor, pos: number) {
  const tr = editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos))
  editor.view.dispatch(tr)
}

function getHandler(editor: Editor, key: string): () => boolean {
  const ext = editor.extensionManager.extensions.find((e) => e.name === "indent")
  if (!ext) throw new Error("Indent extension not found")
  const ctx = { editor, type: ext, options: ext.options }
  const handler = (ext as any).config.addKeyboardShortcuts.call(ctx)[key] as (() => boolean) | undefined
  if (!handler) throw new Error(`Shortcut ${key} not found`)
  return handler.bind(ctx)
}

function doc(blocks: { type: string; depth?: number; text?: string; id?: string }[]) {
  return {
    type: "doc",
    content: blocks.map((b, i) => ({
      type: b.type,
      attrs: { id: b.id ?? `b${i}`, depth: b.depth ?? 0 },
      content: b.text != null ? [{ type: "text", text: b.text }] : [],
    })),
  }
}

function depthOf(editor: Editor, index: number): number {
  return (editor.state.doc.child(index).attrs.depth as number) ?? 0
}

function textPosInBlock(editor: Editor, index: number, offset = 1): number {
  let pos = 0
  for (let i = 0; i < index; i += 1) pos += editor.state.doc.child(i).nodeSize
  return pos + 1 + offset
}

function blockType(editor: Editor, index: number): string {
  return editor.state.doc.child(index).type.name
}

describe("Indent extension — Tab", () => {
  it("4.1 Tab on lone paragraph d=0 → no-op, returns true (follow-prev cap=0, focus capture)", () => {
    const { editor, destroy } = makeEditor(doc([
      { type: "paragraph", text: "hi" },
    ]))
    setCaret(editor, 2)
    expect(getHandler(editor, "Tab")()).toBe(true)
    expect(depthOf(editor, 0)).toBe(0)
    destroy()
  })

  it("4.2 Tab on lone paragraph d=1 → no-op, returns true (follow-prev cap=0 → consume keystroke)", () => {
    const { editor, destroy } = makeEditor(doc([
      { type: "paragraph", text: "hi", depth: 1 },
    ]))
    setCaret(editor, 2)
    expect(getHandler(editor, "Tab")()).toBe(true)
    expect(depthOf(editor, 0)).toBe(1)
    destroy()
  })

  it("4.3 Tab on bullet first-of-run → no-op, returns true (focus capture)", () => {
    const { editor, destroy } = makeEditor(doc([
      { type: "bulletList", text: "one" },
    ]))
    setCaret(editor, 2)
    expect(getHandler(editor, "Tab")()).toBe(true)
    expect(depthOf(editor, 0)).toBe(0)
    destroy()
  })

  it("4.4 Tab on bullet middle-of-run → d+=1, returns true", () => {
    const { editor, destroy } = makeEditor(doc([
      { type: "bulletList", text: "one" },
      { type: "bulletList", text: "two" },
    ]))
    setCaret(editor, 6)
    expect(getHandler(editor, "Tab")()).toBe(true)
    expect(depthOf(editor, 1)).toBe(1)
    destroy()
  })

  it("4.4a Tab on paragraph after bulletList d=1 → d=1 (follow-prev capability)", () => {
    const { editor, destroy } = makeEditor(doc([
      { type: "bulletList", text: "anchor" },
      { type: "bulletList", text: "child", depth: 1 },
      { type: "paragraph", text: "para" },
    ]))
    setCaret(editor, textPosInBlock(editor, 2))
    expect(getHandler(editor, "Tab")()).toBe(true)
    expect(depthOf(editor, 2)).toBe(1)
    destroy()
  })

  it("4.4b Tab on paragraph already at follow-prev cap (prev.depth+1) → no-op, returns true", () => {
    // prev = bulletList d=1 → cap = 2; paragraph seeded at d=2 → already at cap.
    const { editor, destroy } = makeEditor(doc([
      { type: "bulletList", text: "anchor" },
      { type: "bulletList", text: "child", depth: 1 },
      { type: "paragraph", text: "para", depth: 2 },
    ]))
    setCaret(editor, textPosInBlock(editor, 2))
    expect(getHandler(editor, "Tab")()).toBe(true)
    expect(depthOf(editor, 2)).toBe(2)
    destroy()
  })

  it("does not indent a paragraph or heading under an ordinary paragraph", () => {
    const { editor, destroy } = makeEditor(doc([
      { type: "paragraph", text: "plain" },
      { type: "paragraph", text: "paragraph" },
      { type: "heading", text: "heading" },
    ]))

    setCaret(editor, textPosInBlock(editor, 1))
    expect(getHandler(editor, "Tab")()).toBe(true)
    expect(depthOf(editor, 1)).toBe(0)

    setCaret(editor, textPosInBlock(editor, 2))
    expect(getHandler(editor, "Tab")()).toBe(true)
    expect(depthOf(editor, 2)).toBe(0)
    destroy()
  })

  it("indents a paragraph directly under Toggle but not under that paragraph", () => {
    const { editor, destroy } = makeEditor(doc([
      { type: "toggle", text: "details" },
      { type: "paragraph", text: "first child" },
      { type: "paragraph", depth: 1, text: "second child" },
    ]))

    setCaret(editor, textPosInBlock(editor, 1))
    expect(getHandler(editor, "Tab")()).toBe(true)
    expect(depthOf(editor, 1)).toBe(1)

    setCaret(editor, textPosInBlock(editor, 2))
    expect(getHandler(editor, "Tab")()).toBe(true)
    expect(depthOf(editor, 2)).toBe(1)
    destroy()
  })
})

describe("Indent extension — Shift-Tab", () => {
  it("4.5 Shift-Tab on paragraph d=1 → d=0, returns true", () => {
    const { editor, destroy } = makeEditor(doc([
      { type: "paragraph", text: "hi", depth: 1 },
    ]))
    setCaret(editor, 2)
    expect(getHandler(editor, "Shift-Tab")()).toBe(true)
    expect(depthOf(editor, 0)).toBe(0)
    destroy()
  })

  it("4.6 Shift-Tab on paragraph d=0 → no-op, returns false", () => {
    const { editor, destroy } = makeEditor(doc([
      { type: "paragraph", text: "hi" },
    ]))
    setCaret(editor, 2)
    expect(getHandler(editor, "Shift-Tab")()).toBe(false)
    expect(depthOf(editor, 0)).toBe(0)
    destroy()
  })

  it("outdents the remaining owner-body suffix so no orphan depth remains", () => {
    const { editor, destroy } = makeEditor(doc([
      { type: "toggle", text: "details" },
      { type: "paragraph", depth: 1, text: "first" },
      { type: "paragraph", depth: 1, text: "second" },
      { type: "paragraph", text: "outside" },
    ]))
    setCaret(editor, textPosInBlock(editor, 1))

    expect(getHandler(editor, "Shift-Tab")()).toBe(true)
    expect([0, 1, 2, 3].map((index) => depthOf(editor, index))).toEqual([0, 0, 0, 0])
    destroy()
  })
})

describe("Indent extension — Enter", () => {
  it("4.7 Enter on empty paragraph d=1 → outdent to d=0, returns true", () => {
    const { editor, destroy } = makeEditor(doc([
      { type: "paragraph", depth: 1 },
    ]))
    setCaret(editor, 1)
    expect(getHandler(editor, "Enter")()).toBe(true)
    expect(depthOf(editor, 0)).toBe(0)
    destroy()
  })

  it("4.8 Enter on empty paragraph d=0 → returns false (default split runs)", () => {
    const { editor, destroy } = makeEditor(doc([
      { type: "paragraph" },
    ]))
    setCaret(editor, 1)
    expect(getHandler(editor, "Enter")()).toBe(false)
    destroy()
  })

  it("4.9 Enter on non-empty block → returns false (let PM default run)", () => {
    const { editor, destroy } = makeEditor(doc([
      { type: "paragraph", text: "hi" },
    ]))
    setCaret(editor, 2)
    expect(getHandler(editor, "Enter")()).toBe(false)
    destroy()
  })

  it("4.11 Enter on non-empty bullet → splits as same-kind sibling, returns true (#188)", () => {
    const { editor, destroy } = makeEditor(doc([
      { type: "bulletList", text: "alpha" },
    ]))
    // Caret at end of "alpha" — content positions: 0=before block, 1=before
    // text, 2..6=inside text. End-of-block content = 6.
    setCaret(editor, 6)
    expect(getHandler(editor, "Enter")()).toBe(true)
    expect(editor.state.doc.childCount).toBe(2)
    expect(blockType(editor, 0)).toBe("bulletList")
    expect(blockType(editor, 1)).toBe("bulletList")
    expect(editor.state.doc.child(0).textContent).toBe("alpha")
    expect(editor.state.doc.child(1).textContent).toBe("")
    expect(depthOf(editor, 1)).toBe(0)
    destroy()
  })

  it("4.11b Enter mid-text on bullet → splits content between two bullets", () => {
    const { editor, destroy } = makeEditor(doc([
      { type: "bulletList", text: "alphabeta" },
    ]))
    // Caret between "alpha" and "beta" → position 6 (1 [block start] + 5 [chars])
    setCaret(editor, 6)
    expect(getHandler(editor, "Enter")()).toBe(true)
    expect(editor.state.doc.childCount).toBe(2)
    expect(editor.state.doc.child(0).textContent).toBe("alpha")
    expect(editor.state.doc.child(1).textContent).toBe("beta")
    expect(blockType(editor, 1)).toBe("bulletList")
    destroy()
  })

  it("4.11c Enter on non-empty bullet preserves depth on the new sibling", () => {
    const { editor, destroy } = makeEditor(doc([
      { type: "bulletList", text: "first" },
      { type: "bulletList", text: "second", depth: 1 },
    ]))
    // End of "second" — find pos: doc=0, b0(7)=block+text, b1 starts at 7
    // b1 content: 7=before, 8=before text, 9..14=inside, 14=end of text
    setCaret(editor, 14)
    expect(getHandler(editor, "Enter")()).toBe(true)
    expect(editor.state.doc.childCount).toBe(3)
    expect(blockType(editor, 2)).toBe("bulletList")
    expect(depthOf(editor, 2)).toBe(1)
    destroy()
  })
})

describe("Indent extension — Backspace", () => {
  it("4.12 Backspace at start of paragraph d=1 → outdent to d=0, returns true", () => {
    const { editor, destroy } = makeEditor(doc([
      { type: "paragraph", text: "hi", depth: 1 },
    ]))
    setCaret(editor, 1)
    expect(getHandler(editor, "Backspace")()).toBe(true)
    expect(depthOf(editor, 0)).toBe(0)
    destroy()
  })

  it("4.13 Backspace at start of paragraph d=0 → returns false", () => {
    const { editor, destroy } = makeEditor(doc([
      { type: "paragraph", text: "hi" },
    ]))
    setCaret(editor, 1)
    expect(getHandler(editor, "Backspace")()).toBe(false)
    destroy()
  })

  it("4.14 Backspace not at block start → returns false", () => {
    const { editor, destroy } = makeEditor(doc([
      { type: "paragraph", text: "hi", depth: 1 },
    ]))
    setCaret(editor, 2)
    expect(getHandler(editor, "Backspace")()).toBe(false)
    destroy()
  })
})

describe("Indent extension — focus capture", () => {
  it("4.15 Tab on structural first-of-run repeated 5x → all return true (focus capture)", () => {
    const { editor, destroy } = makeEditor(doc([
      { type: "bulletList", text: "one" },
    ]))
    setCaret(editor, 2)
    for (let i = 0; i < 5; i++) {
      expect(getHandler(editor, "Tab")()).toBe(true)
      expect(depthOf(editor, 0)).toBe(0)
    }
    destroy()
  })
})
