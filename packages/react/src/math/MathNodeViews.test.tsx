// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import type { Editor } from "@tiptap/react"
import type { Content } from "@tiptap/core"
import { mathControllerKey } from "@ocai/rune-core"
import { RuneEditor } from "../RuneEditor"
import { mockEditorCoords } from "../test-utils/mockEditorCoords"

const mathTextbox = { name: "Equation (LaTeX)" }

function renderEditor(content: Content, onReady?: (editor: Editor) => void) {
  let editor: Editor | null = null
  render(
    <RuneEditor
      content={content}
      onReady={(ed) => {
        mockEditorCoords(ed)
        editor = ed
        onReady?.(ed)
      }}
    />,
  )
  return waitFor(() => expect(editor).not.toBeNull()).then(() => editor!)
}

describe("math NodeViews", () => {
  it("renders inline math through the React KaTeX NodeView", async () => {
    await renderEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { id: "p1" },
          content: [
            { type: "text", text: "Inline " },
            { type: "inlineMath", attrs: { latex: "x^2" } },
          ],
        },
      ],
    })

    expect(await screen.findByLabelText("Inline math: x^2")).toBeInTheDocument()
    // KaTeX is lazy-loaded on first math mount — wait for the chunk to
    // resolve and the rendered `.katex` output to replace the placeholder.
    await waitFor(() =>
      expect(document.querySelectorAll(".katex").length).toBeGreaterThanOrEqual(1),
    )
  })

  it("opens from MathController intent, commits edits, and consumes the intent", async () => {
    const editor = await renderEditor({
      type: "doc",
      content: [{ type: "paragraph", attrs: { id: "p1" } }],
    })

    act(() => {
      editor.commands.focus("start")
      editor.commands.insertInlineMath({ latex: "" })
    })

    const textarea = await screen.findByRole("textbox", mathTextbox)
    expect(mathControllerKey.getState(editor.state)?.openTarget).toBeNull()

    fireEvent.change(textarea, { target: { value: "E=mc^2" } })
    fireEvent.keyDown(textarea, { key: "Enter" })

    await waitFor(() =>
      expect(
        screen.queryByRole("textbox", mathTextbox),
      ).not.toBeInTheDocument(),
    )
    expect(editor.getJSON()).toMatchObject({
      content: [
        {
          content: [{ type: "inlineMath", attrs: { latex: "E=mc^2" } }],
        },
      ],
    })
  })

  it("does not open the popover without MathController intent", async () => {
    await renderEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { id: "p1" },
          content: [{ type: "inlineMath", attrs: { latex: "a+b" } }],
        },
      ],
    })

    expect(await screen.findByLabelText("Inline math: a+b")).toBeInTheDocument()
    expect(screen.queryByRole("textbox", mathTextbox)).not.toBeInTheDocument()
  })

  it("gates click-to-edit while readonly", async () => {
    const editor = await renderEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { id: "p1" },
          content: [{ type: "inlineMath", attrs: { latex: "x" } }],
        },
      ],
    })

    act(() => {
      editor.setEditable(false)
    })
    fireEvent.mouseDown(await screen.findByLabelText("Inline math: x"))

    expect(screen.queryByRole("textbox", mathTextbox)).not.toBeInTheDocument()
  })

  it("previews edits in the NodeView without writing the ProseMirror doc before commit", async () => {
    const editor = await renderEditor({
      type: "doc",
      content: [{ type: "paragraph", attrs: { id: "p1" } }],
    })

    act(() => {
      editor.commands.focus("start")
      editor.commands.insertInlineMath({ latex: "" })
    })

    const textarea = await screen.findByRole("textbox", mathTextbox)
    fireEvent.change(textarea, { target: { value: "x^2" } })

    expect(await screen.findByLabelText("Inline math: x^2")).toBeInTheDocument()
    expect(editor.getJSON()).toMatchObject({
      content: [
        {
          content: [{ type: "inlineMath", attrs: { latex: "" } }],
        },
      ],
    })
  })

  it("clicking the edited math while the popover is open closes without reopening", async () => {
    await renderEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { id: "p1" },
          content: [{ type: "inlineMath", attrs: { latex: "x" } }],
        },
      ],
    })

    const math = await screen.findByLabelText("Inline math: x")
    fireEvent.mouseDown(math)
    expect(await screen.findByRole("textbox", mathTextbox)).toBeInTheDocument()

    fireEvent.pointerDown(math)
    fireEvent.mouseDown(math)

    await waitFor(() =>
      expect(
        screen.queryByRole("textbox", mathTextbox),
      ).not.toBeInTheDocument(),
    )
  })

  it("restores the original text when a wrap session is dismissed via click outside", async () => {
    const editor = await renderEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { id: "p1" },
          content: [{ type: "text", text: "E=mc^2 is useful" }],
        },
      ],
    })

    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 7 })
      editor.commands.wrapSelectionAsInlineMath()
    })

    const textarea = await screen.findByRole("textbox", mathTextbox)
    expect(textarea).toHaveValue("E=mc^2")

    fireEvent.pointerDown(document.body)

    await waitFor(() =>
      expect(
        screen.queryByRole("textbox", mathTextbox),
      ).not.toBeInTheDocument(),
    )
    expect(JSON.stringify(editor.getJSON())).not.toContain("inlineMath")
    expect(editor.getText()).toBe("E=mc^2 is useful")
  })

  it("restores the original text when a wrap session textarea is cleared and dismissed", async () => {
    const editor = await renderEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { id: "p1" },
          content: [{ type: "text", text: "E=mc^2 is useful" }],
        },
      ],
    })

    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 7 })
      editor.commands.wrapSelectionAsInlineMath()
    })

    const textarea = await screen.findByRole("textbox", mathTextbox)
    fireEvent.change(textarea, { target: { value: "" } })
    fireEvent.keyDown(textarea, { key: "Escape" })

    await waitFor(() =>
      expect(
        screen.queryByRole("textbox", mathTextbox),
      ).not.toBeInTheDocument(),
    )
    expect(JSON.stringify(editor.getJSON())).not.toContain("inlineMath")
    expect(editor.getText()).toBe("E=mc^2 is useful")
  })

  it("cancels a just-inserted empty math node without making undo restore it", async () => {
    const editor = await renderEditor({
      type: "doc",
      content: [{ type: "paragraph", attrs: { id: "p1" } }],
    })

    act(() => {
      editor.commands.focus("start")
      editor.commands.insertInlineMath({ latex: "" })
    })

    const textarea = await screen.findByRole("textbox", mathTextbox)
    fireEvent.keyDown(textarea, { key: "Escape" })

    await waitFor(() =>
      expect(
        screen.queryByRole("textbox", mathTextbox),
      ).not.toBeInTheDocument(),
    )
    expect(JSON.stringify(editor.getJSON())).not.toContain("inlineMath")

    act(() => {
      const commands = editor.commands as unknown as { undo: () => boolean }
      commands.undo()
    })
    expect(JSON.stringify(editor.getJSON())).not.toContain("inlineMath")
  })
})
