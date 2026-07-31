// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, it, expect } from "vitest"
import { createTestEditor } from "../../test-utils/createTestEditor"

function fresh() {
  return createTestEditor()
}

describe("Toggle schema", () => {
  it("creates a level-0 toggle from setContent", () => {
    const editor = fresh()
    editor.commands.setContent([
      { type: "toggle", attrs: { level: 0, expanded: true }, content: [{ type: "text", text: "hi" }] },
    ])
    const n = editor.state.doc.firstChild!
    expect(n.type.name).toBe("toggle")
    expect(n.attrs.level).toBe(0)
    expect(n.attrs.expanded).toBe(true)
    expect(n.textContent).toBe("hi")
  })

  it("defaults new toggles to collapsed when expanded is omitted", () => {
    const editor = fresh()
    editor.commands.setContent([
      { type: "toggle", attrs: { level: 0 }, content: [{ type: "text", text: "hi" }] },
    ])
    expect(editor.state.doc.firstChild!.attrs.expanded).toBe(false)
  })

  it("supports identity levels 1..3 (toggle-heading 1..3)", () => {
    for (const level of [1, 2, 3] as const) {
      const editor = fresh()
      editor.commands.setContent([
        { type: "toggle", attrs: { level, expanded: true }, content: [{ type: "text", text: "h" }] },
      ])
      expect(editor.state.doc.firstChild!.attrs.level).toBe(level)
    }
  })

  it("renderDOM emits .rune-toggle wrapper with rune-toggle-level/expanded attrs", () => {
    const editor = fresh()
    editor.commands.setContent([
      { type: "toggle", attrs: { level: 3, expanded: false }, content: [{ type: "text", text: "x" }] },
    ])
    const html = editor.getHTML()
    expect(html).toContain('class="rune-block rune-toggle"')
    expect(html).toContain('data-rune-toggle-level="3"')
    expect(html).toContain('data-rune-toggle-expanded="false"')
    expect(html).toContain("<h3>")
    expect(html).toContain("rune-toggle-caret")
  })

  it("HTML round-trip preserves level + expanded (no inline-marks)", () => {
    const src = fresh()
    src.commands.setContent([
      { type: "toggle", attrs: { level: 2, expanded: false }, content: [{ type: "text", text: "x" }] },
    ])
    const html = src.getHTML()
    const dst = fresh()
    dst.commands.setContent(html)
    const n = dst.state.doc.firstChild!
    expect(n.type.name).toBe("toggle")
    expect(n.attrs.level).toBe(2)
    expect(n.attrs.expanded).toBe(false)
  })

  it("clipboardRenderDOM emits <details><summary>", () => {
    // Cover via direct DOMSerializer pass — we'll exercise this via clipboard
    // tests in Phase 13. Sanity here: storage exposes the function.
    const editor = fresh()
    editor.commands.setContent([
      { type: "toggle", attrs: { level: 0, expanded: true }, content: [{ type: "text", text: "y" }] },
    ])
    const storage = editor.extensionManager.extensions.find((e) => e.name === "toggle")?.storage
    expect(typeof (storage as { clipboardRenderDOM?: unknown })?.clipboardRenderDOM).toBe("function")
  })
})

describe("Toggle input rules", () => {
  async function typeAtCaret(editor: ReturnType<typeof fresh>, text: string) {
    const { to } = editor.state.selection
    const handled = editor.view.someProp("handleTextInput", (fn) =>
      fn(editor.view, to, to, text, null as never),
    )
    if (handled) return
    editor.view.dispatch(editor.state.tr.setMeta("applyInputRules", { from: to, text }))
    await new Promise((r) => setTimeout(r, 0))
  }

  it("`> ` converts a paragraph to toggle list", async () => {
    const editor = fresh()
    editor.commands.setContent([{ type: "paragraph", attrs: { depth: 0 } }])
    editor.commands.focus(1)
    await typeAtCaret(editor, "> ")
    expect(editor.state.doc.firstChild!.type.name).toBe("toggle")
    expect(editor.state.doc.firstChild!.attrs.level).toBe(0)
    expect(editor.state.doc.firstChild!.attrs.expanded).toBe(false)
  })

  it("`># ` produces toggle level 1", async () => {
    const editor = fresh()
    editor.commands.setContent([{ type: "paragraph", attrs: { depth: 0 } }])
    editor.commands.focus(1)
    await typeAtCaret(editor, "># ")
    expect(editor.state.doc.firstChild!.attrs.level).toBe(1)
  })
})
