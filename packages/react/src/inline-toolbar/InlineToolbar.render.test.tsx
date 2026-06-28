// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { Editor } from "@tiptap/core"
import { EditorContent } from "@tiptap/react"
import { createRuneKit, TitleKit } from "@ocai/rune-core"
import { describe, expect, it, onTestFinished } from "vitest"
import { ComponentsContext, defaultComponents } from "../suggestion-menu/ComponentsContext"
import { InlineToolbar } from "./InlineToolbar"
import { reactMathNodeViews } from "../math/kitOptions"
import { mockEditorCoords } from "../test-utils/mockEditorCoords"

function createEditor(options: { reactMath?: boolean } = {}) {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: createRuneKit(
      options.reactMath ? { mathNodeViews: reactMathNodeViews() } : undefined,
    ),
  })
  mockEditorCoords(editor)
  onTestFinished(() => {
    if (!editor.isDestroyed) editor.destroy()
  })
  return editor
}

function setSelectionAroundText(editor: Editor, text: string) {
  let from: number | null = null
  editor.state.doc.descendants((node, pos) => {
    if (node.isText && node.text === text) {
      from = pos
      return false
    }
    return true
  })
  if (from === null) throw new Error(`missing text node: ${text}`)
  editor.commands.setTextSelection({ from, to: from + text.length })
}

describe("InlineToolbar", () => {
  it("keeps Turn into enabled for text selected in a body block", async () => {
    const editor = createEditor()
    editor.commands.setContent([
      { type: "paragraph", attrs: { id: "p1" }, content: [{ type: "text", text: "body" }] },
    ])
    setSelectionAroundText(editor, "body")

    render(
      <ComponentsContext.Provider value={defaultComponents}>
        <InlineToolbar editor={editor} />
      </ComponentsContext.Provider>,
    )

    expect(await screen.findByRole("button", { name: "Turn into" })).toBeEnabled()
  })

  it("hides the Turn into row for text selected inside a table cell", async () => {
    const editor = createEditor()
    editor.commands.setContent([
      {
        type: "table",
        attrs: { id: "t1", depth: 0 },
        content: [
          {
            type: "tableRow",
            content: [
              {
                type: "tableCell",
                content: [
                  {
                    type: "tableParagraph",
                    content: [{ type: "text", text: "cell" }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ])
    setSelectionAroundText(editor, "cell")

    render(
      <ComponentsContext.Provider value={defaultComponents}>
        <InlineToolbar editor={editor} />
      </ComponentsContext.Provider>,
    )

    // Tables have no conversion targets — the row is removed, not disabled
    // (a permanently-disabled control reads as broken, Notion hides it).
    // Wait for a sibling control so the negative assert isn't vacuous.
    await screen.findByRole("button", { name: "Color" })
    expect(screen.queryByRole("button", { name: "Turn into" })).toBeNull()
  })

  it("wraps selected text as inline math from the Math button", async () => {
    const editor = createEditor({ reactMath: true })
    editor.commands.setContent([
      {
        type: "paragraph",
        attrs: { id: "p1" },
        content: [{ type: "text", text: "E=mc^2" }],
      },
    ])
    setSelectionAroundText(editor, "E=mc^2")

    render(
      <ComponentsContext.Provider value={defaultComponents}>
        <EditorContent editor={editor} />
        <InlineToolbar editor={editor} />
      </ComponentsContext.Provider>,
    )

    fireEvent.mouseDown(await screen.findByRole("button", { name: "Math" }))

    await waitFor(() =>
      expect(editor.getJSON()).toMatchObject({
        content: [
          {
            content: [{ type: "inlineMath", attrs: { latex: "E=mc^2" } }],
          },
        ],
      }),
    )
    expect(await screen.findByRole("textbox", { name: "Equation (LaTeX)" })).toHaveValue("E=mc^2")
  })

  it("renders a host-provided extra section for the captured selection", async () => {
    const editor = createEditor()
    editor.commands.setContent([
      { type: "paragraph", attrs: { id: "p1" }, content: [{ type: "text", text: "body" }] },
    ])
    setSelectionAroundText(editor, "body")

    render(
      <ComponentsContext.Provider value={defaultComponents}>
        <InlineToolbar
          editor={editor}
          // Derive the label from the passed from/to so the test proves the
          // slot receives the actual captured selection range, not just that
          // it rendered.
          renderExtraSection={({ editor: e, from, to }) => (
            <button type="button">{`AI: ${e.state.doc.textBetween(from, to)}`}</button>
          )}
        />
      </ComponentsContext.Provider>,
    )

    expect(
      await screen.findByRole("button", { name: "AI: body" }),
    ).toBeInTheDocument()
  })

  it("omits the host extra section while the selection is collapsed", async () => {
    const editor = createEditor()
    editor.commands.setContent([
      { type: "paragraph", attrs: { id: "p1" }, content: [{ type: "text", text: "body" }] },
    ])
    // Collapsed caret → the toolbar stays closed, so neither its formatting
    // buttons nor the host section mount.
    editor.commands.setTextSelection({ from: 2, to: 2 })

    render(
      <ComponentsContext.Provider value={defaultComponents}>
        <InlineToolbar
          editor={editor}
          renderExtraSection={() => (
            <button type="button">extra-section</button>
          )}
        />
      </ComponentsContext.Provider>,
    )

    // Color is always present once the toolbar opens; asserting it's absent
    // confirms the toolbar is closed, keeping the section-absent check
    // non-vacuous.
    expect(screen.queryByRole("button", { name: "Color" })).toBeNull()
    expect(screen.queryByRole("button", { name: "extra-section" })).toBeNull()
  })

  it("stays closed for a selection wholly inside a marks-free block (the page title)", async () => {
    // TitleKit's title block is plain text (`marks: ""`), so a selection inside
    // it has nothing for the formatting toolbar to act on — the toolbar must not
    // open over it (no Color / Bold / Turn-into).
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: createRuneKit({ plugins: [TitleKit] }),
    })
    mockEditorCoords(editor)
    onTestFinished(() => {
      if (!editor.isDestroyed) editor.destroy()
    })
    editor.commands.setContent([
      { type: "title", content: [{ type: "text", text: "My title" }] },
      { type: "paragraph", attrs: { id: "p1" }, content: [{ type: "text", text: "body" }] },
    ])
    setSelectionAroundText(editor, "My title")

    render(
      <ComponentsContext.Provider value={defaultComponents}>
        <InlineToolbar editor={editor} />
      </ComponentsContext.Provider>,
    )

    // The selection IS a non-collapsed range (so a body selection of the same
    // shape WOULD open the toolbar) — the gate, not an empty caret, keeps it
    // shut. Color is always present once the toolbar opens, so its absence
    // confirms the toolbar never opened.
    expect(editor.state.selection.empty).toBe(false)
    expect(screen.queryByRole("button", { name: "Color" })).toBeNull()

    // A selection that extends from the title into the body still opens — its
    // body run is formattable. Anchor in the title, head in the body.
    const titlePos = 1
    act(() => {
      editor.commands.setTextSelection({ from: titlePos, to: editor.state.doc.content.size - 1 })
    })
    expect(await screen.findByRole("button", { name: "Color" })).toBeInTheDocument()
  })

  it("reflects mark transactions in the Bold button's pressed state", async () => {
    const editor = createEditor()
    editor.commands.setContent([
      { type: "paragraph", attrs: { id: "p1" }, content: [{ type: "text", text: "body" }] },
    ])
    setSelectionAroundText(editor, "body")

    render(
      <ComponentsContext.Provider value={defaultComponents}>
        <InlineToolbar editor={editor} />
      </ComponentsContext.Provider>,
    )

    const boldButton = await screen.findByRole("button", { name: "Bold" })
    expect(boldButton).toHaveAttribute("aria-pressed", "false")

    act(() => {
      editor.commands.toggleBold()
    })

    await waitFor(() =>
      expect(boldButton).toHaveAttribute("aria-pressed", "true"),
    )
  })
})
