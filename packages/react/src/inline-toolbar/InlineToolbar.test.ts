// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// readActive — drives the InlineToolbar's color trigger glyph + chip and the
// ColorMenu's active swatch ring. Regression coverage for #87: prior
// implementation used $pos.marks() at selection.from, which at a boundary
// defaults to the LEFT-side text node and missed a just-applied mark when
// the selection didn't start at the textblock's first position.

import { describe, expect, it } from "vitest"
import { Editor } from "@tiptap/core"
import { createRuneKit } from "@ocai/rune-core"
import { readActive, readCurrentTextSelectionBlock } from "./InlineToolbar"

const setup = (html: string) => {
  return new Editor({
    element: document.createElement("div"),
    extensions: createRuneKit(),
    content: html,
  })
}

describe("readActive", () => {
  it("reflects an applied text color when selection starts at textblock pos 1", () => {
    const editor = setup("<p>hello world</p>")
    editor.commands.setTextSelection({ from: 1, to: 6 }) // "hello"
    editor.commands.setRuneTextColor("red")
    expect(readActive(editor).textColor).toBe("red")
    editor.destroy()
  })

  it("reflects an applied text color when selection starts mid-text (#87)", () => {
    const editor = setup("<p>hello world</p>")
    editor.commands.setTextSelection({ from: 7, to: 12 }) // "world"
    editor.commands.setRuneTextColor("red")
    expect(readActive(editor).textColor).toBe("red")
    editor.destroy()
  })

  it("reflects an applied background color when selection starts mid-text (#87)", () => {
    const editor = setup("<p>hello world</p>")
    editor.commands.setTextSelection({ from: 7, to: 12 })
    editor.commands.setRuneBackgroundColor("blue")
    expect(readActive(editor).backgroundColor).toBe("blue")
    editor.destroy()
  })

  it("reflects both text and background color when applied together (#87)", () => {
    const editor = setup("<p>hello world</p>")
    editor.commands.setTextSelection({ from: 7, to: 12 })
    editor.commands.setRuneTextColor("red")
    editor.commands.setRuneBackgroundColor("blue")
    const a = readActive(editor)
    expect(a.textColor).toBe("red")
    expect(a.backgroundColor).toBe("blue")
    editor.destroy()
  })

  it("returns null colors on unmarked selection", () => {
    const editor = setup("<p>hello world</p>")
    editor.commands.setTextSelection({ from: 1, to: 6 })
    const a = readActive(editor)
    expect(a.textColor).toBeNull()
    expect(a.backgroundColor).toBeNull()
    editor.destroy()
  })

  it("returns null after unset clears the mark", () => {
    const editor = setup("<p>hello world</p>")
    editor.commands.setTextSelection({ from: 7, to: 12 })
    editor.commands.setRuneTextColor("red")
    editor.commands.unsetRuneTextColor()
    expect(readActive(editor).textColor).toBeNull()
    editor.destroy()
  })

  it("reads the LEADING run's color when the selection spans mixed colors", () => {
    // <p><span red>hello</span><span blue> world</span></p>
    const editor = setup("<p>hello world</p>")
    editor.commands.setTextSelection({ from: 1, to: 6 })
    editor.commands.setRuneTextColor("red")
    editor.commands.setTextSelection({ from: 6, to: 12 })
    editor.commands.setRuneTextColor("blue")
    // Now select across both runs — leading run is red.
    editor.commands.setTextSelection({ from: 1, to: 12 })
    expect(readActive(editor).textColor).toBe("red")
    editor.destroy()
  })

  it("reflects bold/italic/underline/strike/code/link active state", () => {
    const editor = setup("<p>hello</p>")
    editor.commands.setTextSelection({ from: 1, to: 6 })
    editor.commands.toggleBold()
    editor.commands.toggleItalic()
    const a = readActive(editor)
    expect(a.isBold).toBe(true)
    expect(a.isItalic).toBe(true)
    expect(a.isUnderline).toBe(false)
    expect(a.isStrike).toBe(false)
    expect(a.isCode).toBe(false)
    expect(a.isLink).toBe(false)
    editor.destroy()
  })
})

describe("readCurrentTextSelectionBlock", () => {
  it("resolves the root paragraph a selection sits in", () => {
    const editor = setup("<p>hello world</p>")
    editor.commands.setTextSelection({ from: 1, to: 6 })
    const block = readCurrentTextSelectionBlock(editor)
    expect(block?.type).toBe("paragraph")
    editor.destroy()
  })

  it("resolves the COLUMN CHILD, not the columnLayout, for a selection inside a column (data-loss regression)", () => {
    // Before the fix, `$from.node(1)` reported the whole columnLayout for an
    // in-column caret — the ••• menu's Delete/Duplicate/Color/Turn-into then
    // targeted the layout instead of the paragraph, and Delete wiped both
    // columns. Mirrors the SM-3 fix already applied to
    // SuggestionMenuController (nearestBodyBlock skips the structural
    // `column` node and lands on the body block inside it).
    const editor = setup("<p>placeholder</p>")
    editor.commands.setContent({
      type: "doc",
      content: [
        {
          type: "columnLayout",
          attrs: { id: "cl1", depth: 0 },
          content: [
            {
              type: "column",
              attrs: { id: "colL", width: 1 },
              content: [
                {
                  type: "paragraph",
                  attrs: { id: "L0" },
                  content: [{ type: "text", text: "left text" }],
                },
              ],
            },
            {
              type: "column",
              attrs: { id: "colR", width: 1 },
              content: [
                {
                  type: "paragraph",
                  attrs: { id: "R0" },
                  content: [{ type: "text", text: "right text" }],
                },
              ],
            },
          ],
        },
      ],
    })
    let from = -1
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === "left text") {
        from = pos
        return false
      }
      return true
    })
    editor.commands.setTextSelection({ from, to: from + "left".length })
    const block = readCurrentTextSelectionBlock(editor)
    expect(block?.id).toBe("L0")
    expect(block?.type).toBe("paragraph")
    editor.destroy()
  })
})
