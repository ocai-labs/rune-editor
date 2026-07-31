// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, it, expect } from "vitest"
import { TextSelection } from "@tiptap/pm/state"
import { createTestEditor } from "../../test-utils/createTestEditor"
import { toggleBodyKey } from "./plugin"

if (typeof document.elementFromPoint !== "function") {
  ;(document as unknown as { elementFromPoint: (x: number, y: number) => Element | null }).elementFromPoint = () => null
}

function fresh() {
  const el = document.createElement("div")
  document.body.appendChild(el)
  const editor = createTestEditor({ element: el })
  return { editor, el }
}

describe("ToggleBodyPlugin — caret click", () => {
  it("clicking .rune-toggle-caret flips expanded without entering undo", () => {
    const el = document.createElement("div")
    document.body.appendChild(el)
    // Load initial content via the editor constructor so it doesn't enter
    // the undo history (Tiptap marks the initial doc as the base state).
    const editor = createTestEditor({
      element: el,
      content: {
        type: "doc",
        content: [
          { type: "toggle", attrs: { level: 0, expanded: true }, content: [{ type: "text", text: "t" }] },
          { type: "paragraph", attrs: { depth: 1 }, content: [{ type: "text", text: "c" }] },
        ],
      },
    })

    const caret = editor.view.dom.querySelector(".rune-toggle-caret") as HTMLElement
    caret.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
    expect(editor.state.doc.firstChild!.attrs.expanded).toBe(false)

    // Undo must not bounce expanded — the click was addToHistory:false.
    editor.commands.undo()
    expect(editor.state.doc.firstChild!.attrs.expanded).toBe(false)
  })
})

describe("ToggleBodyPlugin — visibility decorations", () => {
  it("hides body blocks of a collapsed toggle", () => {
    const { editor } = fresh()
    editor.commands.setContent([
      { type: "toggle", attrs: { level: 0, expanded: false }, content: [{ type: "text", text: "t" }] },
      { type: "paragraph", attrs: { depth: 1 }, content: [{ type: "text", text: "hidden" }] },
      { type: "paragraph", attrs: { depth: 0 }, content: [{ type: "text", text: "after" }] },
    ])
    const hidden = editor.view.dom.querySelectorAll("[data-rune-hidden='1']")
    expect(hidden.length).toBe(1)
    expect((hidden[0] as HTMLElement).textContent).toContain("hidden")
  })

  it("does not hide when expanded", () => {
    const { editor } = fresh()
    editor.commands.setContent([
      { type: "toggle", attrs: { level: 0, expanded: true }, content: [{ type: "text", text: "t" }] },
      { type: "paragraph", attrs: { depth: 1 }, content: [{ type: "text", text: "shown" }] },
    ])
    const hidden = editor.view.dom.querySelectorAll("[data-rune-hidden='1']")
    expect(hidden.length).toBe(0)
  })

  it("flipping expanded -> false hides body, flipping back shows it", () => {
    const { editor } = fresh()
    editor.commands.setContent([
      { type: "toggle", attrs: { level: 0, expanded: true }, content: [{ type: "text", text: "t" }] },
      { type: "paragraph", attrs: { depth: 1 }, content: [{ type: "text", text: "child" }] },
    ])
    editor.view.dispatch(
      editor.state.tr.setNodeAttribute(0, "expanded", false).setMeta("addToHistory", false),
    )
    expect(editor.view.dom.querySelectorAll("[data-rune-hidden='1']").length).toBe(1)

    editor.view.dispatch(
      editor.state.tr.setNodeAttribute(0, "expanded", true).setMeta("addToHistory", false),
    )
    expect(editor.view.dom.querySelectorAll("[data-rune-hidden='1']").length).toBe(0)
  })
})

describe("ToggleBodyPlugin — empty widget", () => {
  it("renders empty placeholder when expanded toggle has no body", () => {
    const el = document.createElement("div")
    document.body.appendChild(el)
    const editor = createTestEditor({ element: el })
    editor.commands.setContent([
      { type: "toggle", attrs: { level: 0, expanded: true }, content: [{ type: "text", text: "t" }] },
    ])
    const widget = editor.view.dom.querySelector(".rune-toggle-empty")
    expect(widget).not.toBeNull()
    expect(widget?.textContent).toBe("Empty toggle. Click to add a block.")
  })

  it("hides empty widget when body is non-empty", () => {
    const el = document.createElement("div")
    document.body.appendChild(el)
    const editor = createTestEditor({ element: el })
    editor.commands.setContent([
      { type: "toggle", attrs: { level: 0, expanded: true }, content: [{ type: "text", text: "t" }] },
      { type: "paragraph", attrs: { depth: 1 }, content: [{ type: "text", text: "c" }] },
    ])
    expect(editor.view.dom.querySelector(".rune-toggle-empty")).toBeNull()
  })

  it("marks expanded direct body blocks for visual indentation", () => {
    const el = document.createElement("div")
    document.body.appendChild(el)
    const editor = createTestEditor({ element: el })
    editor.commands.setContent([
      { type: "toggle", attrs: { level: 0, expanded: true }, content: [{ type: "text", text: "t" }] },
      { type: "paragraph", attrs: { depth: 1 }, content: [{ type: "text", text: "direct" }] },
      { type: "paragraph", attrs: { depth: 2 }, content: [{ type: "text", text: "nested" }] },
    ])

    const marked = Array.from(
      editor.view.dom.querySelectorAll("[data-rune-toggle-body='1']"),
    )
    expect(marked).toHaveLength(1)
    expect(marked[0]?.textContent).toContain("direct")
  })

  it("hides empty widget when collapsed even if empty", () => {
    const el = document.createElement("div")
    document.body.appendChild(el)
    const editor = createTestEditor({ element: el })
    editor.commands.setContent([
      { type: "toggle", attrs: { level: 0, expanded: false }, content: [{ type: "text", text: "t" }] },
    ])
    expect(editor.view.dom.querySelector(".rune-toggle-empty")).toBeNull()
  })

  it("clicking the empty widget inserts a depth+1 paragraph after the toggle", () => {
    const el = document.createElement("div")
    document.body.appendChild(el)
    const editor = createTestEditor({ element: el })
    editor.commands.setContent([
      { type: "toggle", attrs: { level: 0, expanded: true }, content: [{ type: "text", text: "t" }] },
    ])
    const w = editor.view.dom.querySelector(".rune-toggle-empty") as HTMLElement
    w.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }))
    const after = editor.state.doc.child(1)
    expect(after.type.name).toBe("paragraph")
    expect(after.attrs.depth).toBe(1)
  })
})

describe("ToggleBodyPlugin — title placeholder", () => {
  // Why this is toggle-owned and not the generic Placeholder extension:
  // generic Placeholder is selection+focus gated (renders only on the
  // textblock currently containing the caret). For toggle titles users
  // expect the placeholder to behave like the empty-body widget — always
  // visible whenever the title is empty — regardless of focus or where
  // the caret is. Toggle plugin emits its own placeholder decoration so
  // it isn't subject to that gating.
  it("renders a title placeholder on EVERY empty toggle title, regardless of focus or caret position", () => {
    const el = document.createElement("div")
    document.body.appendChild(el)
    const editor = createTestEditor({ element: el })
    editor.commands.setContent([
      // Empty toggle title #1 (also no body).
      { type: "toggle", attrs: { level: 0, expanded: true } },
      // Empty toggle title #2 with body — title is still empty.
      { type: "toggle", attrs: { level: 0, expanded: true } },
      { type: "paragraph", attrs: { depth: 1 }, content: [{ type: "text", text: "body" }] },
      // Filled toggle title — must NOT get a placeholder.
      { type: "toggle", attrs: { level: 0, expanded: true }, content: [{ type: "text", text: "filled" }] },
    ])

    // Park caret somewhere unrelated (the body paragraph) so we prove the
    // placeholder isn't selection-anchored.
    let bodyPos = 0
    editor.state.doc.descendants((n, p) => {
      if (n.isTextblock && n.textContent === "body") bodyPos = p + 1
    })
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, bodyPos)),
    )

    const placeholders = Array.from(
      editor.view.dom.querySelectorAll(".rune-toggle .rune-placeholder-text"),
    )
    expect(placeholders).toHaveLength(2)
    expect(placeholders[0]?.textContent).toBe("Toggle")
    expect(placeholders[1]?.textContent).toBe("Toggle")

    // is-empty + data-placeholder attrs land on the toggle blocks.
    const empties = Array.from(
      editor.view.dom.querySelectorAll(".rune-toggle.is-empty"),
    )
    expect(empties).toHaveLength(2)
  })

  it("does not render a title placeholder once the title has text", () => {
    const el = document.createElement("div")
    document.body.appendChild(el)
    const editor = createTestEditor({ element: el })
    editor.commands.setContent([
      { type: "toggle", attrs: { level: 0, expanded: true }, content: [{ type: "text", text: "x" }] },
    ])
    expect(editor.view.dom.querySelector(".rune-toggle .rune-placeholder-text")).toBeNull()
  })
})

describe("ToggleBodyPlugin — key nav", () => {
  function setup() {
    const el = document.createElement("div")
    document.body.appendChild(el)
    const editor = createTestEditor({ element: el })
    editor.commands.setContent([
      { type: "toggle", attrs: { level: 0, expanded: false }, content: [{ type: "text", text: "title" }] },
      { type: "paragraph", attrs: { depth: 1 }, content: [{ type: "text", text: "hidden" }] },
      { type: "paragraph", attrs: { depth: 0 }, content: [{ type: "text", text: "after" }] },
    ])
    return editor
  }

  it("ArrowDown at end of collapsed toggle title lands at the next visible block, not hidden", () => {
    const editor = setup()
    // place caret at end of toggle title (pos 6: 'title' is 5 chars, +1 for open tag = pos 6).
    // Adaptation: editor.commands.focus(N) calls scrollIntoView which uses getClientRects
    // unavailable in jsdom. Use view.dispatch with setSelection directly — same semantic:
    // caret is at end of title text.
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 6)))
    const ev = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })
    editor.view.dom.dispatchEvent(ev)
    // Caret should be inside the "after" paragraph, not "hidden".
    const $pos = editor.state.selection.$from
    expect($pos.parent.textContent).toBe("after")
  })

  it("Backspace at start of block after collapsed toggle jumps to end of title", () => {
    const editor = setup()
    // Caret at start of "after" paragraph (last block).
    // Adaptation: same jsdom getClientRects issue — use view.dispatch directly.
    const lastBlockPos = editor.state.doc.content.size - editor.state.doc.lastChild!.nodeSize + 1
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, lastBlockPos)))
    const ev = new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true })
    editor.view.dom.dispatchEvent(ev)
    const $pos = editor.state.selection.$from
    expect($pos.parent.type.name).toBe("toggle")
    expect($pos.parentOffset).toBe($pos.parent.textContent.length)
  })
})

describe("ToggleBodyPlugin — ArrowUp into collapsed toggle title", () => {
  // S3: only ArrowUp coverage in the Toggle test suite — verified by grep.

  it("block after a collapsed toggle — ArrowUp lands at end of title", () => {
    const el = document.createElement("div")
    document.body.appendChild(el)
    const editor = createTestEditor({ element: el })
    editor.commands.setContent([
      { type: "toggle", attrs: { level: 0, expanded: false }, content: [{ type: "text", text: "title" }] },
      { type: "paragraph", attrs: { depth: 1 }, content: [{ type: "text", text: "hidden" }] },
      { type: "paragraph", attrs: { depth: 0 }, content: [{ type: "text", text: "after" }] },
    ])
    let afterStart = -1
    editor.state.doc.descendants((n, pos) => {
      if (n.isTextblock && n.textContent === "after") { afterStart = pos + 1; return false }
      return true
    })
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, afterStart)))
    editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }))
    const sel = editor.state.selection
    expect(sel.$from.parent.type.name).toBe("toggle")
    expect(sel.$from.parentOffset).toBe(sel.$from.parent.content.size)
  })

  it("empty toggle title — ArrowUp from block below lands at offset 0 (title content.size == 0)", () => {
    const el = document.createElement("div")
    document.body.appendChild(el)
    const editor = createTestEditor({ element: el })
    editor.commands.setContent([
      { type: "toggle", attrs: { level: 0, expanded: false } }, // empty title
      { type: "paragraph", attrs: { depth: 1 }, content: [{ type: "text", text: "h" }] },
      { type: "paragraph", attrs: { depth: 0 }, content: [{ type: "text", text: "x" }] },
    ])
    let xStart = -1
    editor.state.doc.descendants((n, pos) => {
      if (n.isTextblock && n.textContent === "x") { xStart = pos + 1; return false }
      return true
    })
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, xStart)))
    editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }))
    const sel = editor.state.selection
    expect(sel.$from.parent.type.name).toBe("toggle")
    expect(sel.$from.parentOffset).toBe(0) // empty title: offset 0 == end
  })
})

describe("ToggleBodyPlugin — Backspace empty-title edge", () => {
  it("Backspace from block after a collapsed toggle with empty title lands at title offset 0", () => {
    // S4 edge: titleEndPos = owner.pos+1+content.size = owner.pos+1 when empty;
    // must still resolve without throw and place caret at the only valid offset (0).
    const el = document.createElement("div")
    document.body.appendChild(el)
    const editor = createTestEditor({ element: el })
    editor.commands.setContent([
      { type: "toggle", attrs: { level: 0, expanded: false } }, // empty title
      { type: "paragraph", attrs: { depth: 1 }, content: [{ type: "text", text: "hidden" }] },
      { type: "paragraph", attrs: { depth: 0 }, content: [{ type: "text", text: "after" }] },
    ])
    let afterStart = -1
    editor.state.doc.descendants((n, pos) => {
      if (n.isTextblock && n.textContent === "after") { afterStart = pos + 1; return false }
      return true
    })
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, afterStart)))
    editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }))
    const sel = editor.state.selection
    expect(sel.$from.parent.type.name).toBe("toggle")
    expect(sel.$from.parentOffset).toBe(0) // empty title: content.size == 0
  })
})

describe("ToggleBodyPlugin — Enter at title end", () => {
  it("inserts a depth+1 paragraph when body is empty", () => {
    const el = document.createElement("div")
    document.body.appendChild(el)
    const editor = createTestEditor({ element: el })
    editor.commands.setContent([
      { type: "toggle", attrs: { level: 0, expanded: true }, content: [{ type: "text", text: "t" }] },
    ])
    // Adaptation: editor.commands.focus(N) triggers scrollIntoView → getClientRects which is
    // unavailable in jsdom. Use view.dispatch with TextSelection directly — same semantic:
    // caret at end of "t" in the toggle title.
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2)))
    editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }))
    expect(editor.state.doc.child(1).type.name).toBe("paragraph")
    expect(editor.state.doc.child(1).attrs.depth).toBe(1)
  })

  it("does NOT override Enter when body is non-empty (default PM Enter behavior wins)", () => {
    const el = document.createElement("div")
    document.body.appendChild(el)
    const editor = createTestEditor({ element: el })
    editor.commands.setContent([
      { type: "toggle", attrs: { level: 0, expanded: true }, content: [{ type: "text", text: "t" }] },
      { type: "paragraph", attrs: { depth: 1 }, content: [{ type: "text", text: "c" }] },
    ])
    // Adaptation: same jsdom getClientRects fix.
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2)))
    const before = editor.state.doc.childCount
    editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }))
    // PM default split-block creates a new paragraph at same depth (0) right after the toggle.
    expect(editor.state.doc.childCount).toBe(before + 1)
  })

  it("nested toggle (depth 1) — Enter inserts a depth+1=2 paragraph, caret lands inside it", () => {
    // S5 edge: inner toggle at depth 1, Enter should produce a depth-2 paragraph.
    const el = document.createElement("div")
    document.body.appendChild(el)
    const editor = createTestEditor({ element: el })
    editor.commands.setContent([
      { type: "toggle", attrs: { level: 0, expanded: true }, content: [{ type: "text", text: "outer" }] },
      { type: "toggle", attrs: { depth: 1, expanded: true }, content: [{ type: "text", text: "inner" }] },
    ])
    let innerTitleEnd = -1
    editor.state.doc.descendants((n, pos) => {
      if (n.type.name === "toggle" && n.textContent === "inner") {
        innerTitleEnd = pos + 1 + n.content.size
        return false
      }
      return true
    })
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, innerTitleEnd)))
    editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }))
    const $pos = editor.state.selection.$from
    expect($pos.parent.type.name).toBe("paragraph")
    expect($pos.parent.attrs.depth).toBe(2)
  })
})
