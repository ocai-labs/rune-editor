// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, expect, it } from "vitest"
import { Editor } from "@tiptap/core"
import { TextSelection } from "@tiptap/pm/state"
import { createRuneKit as kit } from "../../kit"
import { handlePaste } from "./handlePaste"

function makeEditor(content = "<p>seed</p>") {
  return new Editor({
    extensions: kit(),
    content,
    element: document.createElement("div"),
  })
}

// jsdom doesn't ship ClipboardEvent / DataTransfer. Mint a minimal mock.
function makePasteEvent(mimes: Record<string, string>): ClipboardEvent {
  const store = new Map<string, string>(Object.entries(mimes))
  const data = {
    get types() { return Array.from(store.keys()) },
    getData: (mime: string) => store.get(mime) ?? "",
    setData: (mime: string, value: string) => { store.set(mime, value) },
    clearData: () => store.clear(),
  } as unknown as DataTransfer
  let defaultPrevented = false
  const ev = {
    type: "paste",
    clipboardData: data,
    get defaultPrevented() { return defaultPrevented },
    preventDefault: () => { defaultPrevented = true },
  }
  return ev as unknown as ClipboardEvent
}

describe("handlePaste", () => {
  it("returns false when clipboard has no rune-doc MIME", () => {
    const editor = makeEditor()
    const event = makePasteEvent({ "text/html": "<p>x</p>" })
    expect(handlePaste(editor.view as any, event, editor)).toBe(false)
    editor.destroy()
  })

  it("on rune-doc: parses, dispatches replaceSelection, returns true", () => {
    const editor = makeEditor()
    editor.commands.selectAll()
    const sourceSlice = editor.state.selection.content()
    const json = JSON.stringify(sourceSlice.toJSON())
    const event = makePasteEvent({ "application/x-rune-doc": json })
    expect(handlePaste(editor.view as any, event, editor)).toBe(true)
    expect(event.defaultPrevented).toBe(true)
    editor.destroy()
  })

  it("on malformed rune-doc: returns false (fall through to HTML/text)", () => {
    const editor = makeEditor()
    const event = makePasteEvent({ "application/x-rune-doc": "{not valid json" })
    expect(handlePaste(editor.view as any, event, editor)).toBe(false)
    expect(event.defaultPrevented).toBe(false)
    editor.destroy()
  })

  it("on rune-doc with valid JSON but invalid Slice schema: returns false", () => {
    const editor = makeEditor()
    const event = makePasteEvent({
      "application/x-rune-doc": JSON.stringify({ content: [{ type: "nonexistent_block" }] }),
    })
    expect(handlePaste(editor.view as any, event, editor)).toBe(false)
    editor.destroy()
  })

  it("defers to prosemirror-tables when the caret is inside a table (returns false)", () => {
    // Regression: rune's handlePaste runs BEFORE pm-tables' cell-aware
    // handler. A blanket replaceSelection of a copied CellSelection slice
    // (tableRow/cell nodes, openStart/openEnd = 1) corrupts the grid —
    // columns multiply, only the first copied row lands. Inside a table we
    // must yield so pm-tables' clipCells/insertCells handles the paste.
    const editor = makeEditor(
      "<table><tr><td><p>a</p></td><td><p>b</p></td></tr></table>",
    )
    // Put the caret inside the first cell's paragraph.
    let cellPos = -1
    editor.state.doc.descendants((node, pos) => {
      if (cellPos === -1 && node.type.name === "tableCell") cellPos = pos
    })
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.near(editor.state.doc.resolve(cellPos + 2)),
      ),
    )

    // A real internal copy always carries the rune-doc MIME; without the
    // in-table guard this would be intercepted and replaceSelection'd.
    const event = makePasteEvent({
      "application/x-rune-doc": JSON.stringify(
        editor.state.selection.content().toJSON(),
      ),
    })
    expect(handlePaste(editor.view as any, event, editor)).toBe(false)
    expect(event.defaultPrevented).toBe(false)
    editor.destroy()
  })
})

describe("handlePaste — markdown text path", () => {
  function findBlocks(editor: Editor, typeName: string) {
    const out: import("@tiptap/pm/model").Node[] = []
    editor.state.doc.descendants((node) => {
      if (node.type.name === typeName) out.push(node)
    })
    return out
  }

  it("intercepts pure plain-text Markdown and emits real blocks", () => {
    const editor = makeEditor()
    editor.commands.selectAll()
    const md = "# Heading\n\nsome **bold** text\n\n- a\n- b\n"
    const event = makePasteEvent({ "text/plain": md })

    expect(handlePaste(editor.view as any, event, editor)).toBe(true)
    expect(event.defaultPrevented).toBe(true)

    const headings = findBlocks(editor, "heading")
    expect(headings.some((h) => h.textContent === "Heading")).toBe(true)
    // The literal "# Heading" line must NOT survive as a paragraph.
    expect(findBlocks(editor, "paragraph").some((p) => p.textContent.startsWith("# "))).toBe(false)
    expect(findBlocks(editor, "bulletList").map((n) => n.textContent)).toEqual(
      expect.arrayContaining(["a", "b"]),
    )
    editor.destroy()
  })

  it("maps Markdown `#` to Heading level 2, not <h1>/paragraph (decision a)", () => {
    const editor = makeEditor()
    editor.commands.selectAll()
    const event = makePasteEvent({ "text/plain": "# Title\n\nbody\n" })

    expect(handlePaste(editor.view as any, event, editor)).toBe(true)
    const heading = findBlocks(editor, "heading").find((h) => h.textContent === "Title")
    expect(heading?.attrs.level).toBe(2)
    editor.destroy()
  })

  it("parses a fenced code block with its language", () => {
    const editor = makeEditor()
    editor.commands.selectAll()
    const event = makePasteEvent({ "text/plain": "```js\nconst a = 1\n```\n" })

    expect(handlePaste(editor.view as any, event, editor)).toBe(true)
    const code = findBlocks(editor, "codeBlock")
    expect(code.length).toBe(1)
    expect(code[0]?.textContent).toContain("const a = 1")
    editor.destroy()
  })

  it("parses a GFM table into a table block", () => {
    const editor = makeEditor()
    editor.commands.selectAll()
    const event = makePasteEvent({ "text/plain": "| a | b |\n| - | - |\n| 1 | 2 |\n" })

    expect(handlePaste(editor.view as any, event, editor)).toBe(true)
    expect(findBlocks(editor, "table").length).toBe(1)
    editor.destroy()
  })

  it("defers to the HTML path when text/html is also present (decision b)", () => {
    const editor = makeEditor()
    const event = makePasteEvent({ "text/html": "<p>x</p>", "text/plain": "# markdown\n\nbody\n" })
    expect(handlePaste(editor.view as any, event, editor)).toBe(false)
    expect(event.defaultPrevented).toBe(false)
    editor.destroy()
  })

  it("leaves non-Markdown plain text to the default text parser", () => {
    const editor = makeEditor()
    const event = makePasteEvent({ "text/plain": "just a line\nanother line" })
    expect(handlePaste(editor.view as any, event, editor)).toBe(false)
    expect(event.defaultPrevented).toBe(false)
    editor.destroy()
  })

  it("keeps paste literal inside a code block", () => {
    const editor = makeEditor("<pre><code>x</code></pre>")
    let codePos = -1
    editor.state.doc.descendants((node, pos) => {
      if (codePos === -1 && node.type.name === "codeBlock") codePos = pos
    })
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(codePos + 1))),
    )
    const event = makePasteEvent({ "text/plain": "# heading\n\nbody\n" })
    expect(handlePaste(editor.view as any, event, editor)).toBe(false)
    expect(event.defaultPrevented).toBe(false)
    editor.destroy()
  })
})

describe("handlePaste — VS Code editor paste", () => {
  function findBlocks(editor: Editor, typeName: string) {
    const out: import("@tiptap/pm/model").Node[] = []
    editor.state.doc.descendants((node) => {
      if (node.type.name === typeName) out.push(node)
    })
    return out
  }

  // The defining property of every VS Code paste: a syntax-highlight
  // `text/html` snapshot rides along. It must NEVER be the thing that lands.
  const vscodeHtml = '<div style="color:#569cd6">const</div>'

  it("routes `markdown` mode to real blocks even though text/html is present", () => {
    const editor = makeEditor()
    editor.commands.selectAll()
    const event = makePasteEvent({
      "vscode-editor-data": JSON.stringify({ mode: "markdown" }),
      "text/plain": "# Heading\n\nsome **bold** text\n",
      "text/html": vscodeHtml,
    })

    expect(handlePaste(editor.view as any, event, editor)).toBe(true)
    expect(event.defaultPrevented).toBe(true)
    expect(findBlocks(editor, "heading").some((h) => h.textContent === "Heading")).toBe(true)
    // The literal "# Heading" line must NOT survive as a paragraph, and the
    // highlight HTML's "const" must not leak in.
    expect(findBlocks(editor, "paragraph").some((p) => p.textContent.startsWith("# "))).toBe(false)
    expect(editor.state.doc.textContent).not.toContain("const")
    editor.destroy()
  })

  it("routes a code language to a code block carrying that language", () => {
    const editor = makeEditor()
    editor.commands.selectAll()
    const event = makePasteEvent({
      "vscode-editor-data": JSON.stringify({ mode: "typescript" }),
      "text/plain": "const a = 1\nconst b = 2",
      "text/html": vscodeHtml,
    })

    expect(handlePaste(editor.view as any, event, editor)).toBe(true)
    const code = findBlocks(editor, "codeBlock")
    expect(code.length).toBe(1)
    expect(code[0]?.attrs.language).toBe("typescript")
    expect(code[0]?.textContent).toContain("const a = 1")
    // Not parsed as Markdown, not left as highlighted HTML paragraphs.
    expect(findBlocks(editor, "heading").length).toBe(0)
    editor.destroy()
  })

  it("routes `plaintext` mode to one paragraph per line", () => {
    const editor = makeEditor()
    editor.commands.selectAll()
    const event = makePasteEvent({
      "vscode-editor-data": JSON.stringify({ mode: "plaintext" }),
      "text/plain": "line one\nline two",
      "text/html": vscodeHtml,
    })

    expect(handlePaste(editor.view as any, event, editor)).toBe(true)
    const paras = findBlocks(editor, "paragraph").map((p) => p.textContent)
    expect(paras).toEqual(expect.arrayContaining(["line one", "line two"]))
    expect(findBlocks(editor, "codeBlock").length).toBe(0)
    editor.destroy()
  })

  it("falls back to paragraphs when vscode-editor-data is unparseable", () => {
    const editor = makeEditor()
    editor.commands.selectAll()
    const event = makePasteEvent({
      "vscode-editor-data": "{not json",
      "text/plain": "just some text",
      "text/html": vscodeHtml,
    })

    expect(handlePaste(editor.view as any, event, editor)).toBe(true)
    expect(editor.state.doc.textContent).not.toContain("const")
    expect(findBlocks(editor, "paragraph").some((p) => p.textContent === "just some text")).toBe(true)
    editor.destroy()
  })

  it("inserts raw text literally when pasted inside a code block", () => {
    const editor = makeEditor("<pre><code>x</code></pre>")
    let codePos = -1
    editor.state.doc.descendants((node, pos) => {
      if (codePos === -1 && node.type.name === "codeBlock") codePos = pos
    })
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(codePos + 1))),
    )
    const event = makePasteEvent({
      "vscode-editor-data": JSON.stringify({ mode: "markdown" }),
      "text/plain": "# not a heading here",
      "text/html": vscodeHtml,
    })

    expect(handlePaste(editor.view as any, event, editor)).toBe(true)
    expect(findBlocks(editor, "codeBlock").length).toBe(1)
    expect(findBlocks(editor, "heading").length).toBe(0)
    expect(editor.state.doc.textContent).toContain("# not a heading here")
    editor.destroy()
  })

  it("defers to prosemirror-tables when the caret is inside a table", () => {
    const editor = makeEditor("<table><tr><td><p>a</p></td><td><p>b</p></td></tr></table>")
    let cellPos = -1
    editor.state.doc.descendants((node, pos) => {
      if (cellPos === -1 && node.type.name === "tableCell") cellPos = pos
    })
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(cellPos + 2))),
    )
    const event = makePasteEvent({
      "vscode-editor-data": JSON.stringify({ mode: "typescript" }),
      "text/plain": "const a = 1",
      "text/html": vscodeHtml,
    })
    expect(handlePaste(editor.view as any, event, editor)).toBe(false)
    expect(event.defaultPrevented).toBe(false)
    editor.destroy()
  })
})
