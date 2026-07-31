// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, it, expect } from "vitest"
import { NodeSelection, TextSelection } from "@tiptap/pm/state"
import { createTestEditor } from "../../test-utils/createTestEditor"
import { serializeBlocksForClipboard } from "../../extensions/clipboard/serializeBlocks"
import { getCalloutEmojiPopoverBlockId } from "./emoji-popover-plugin"

function fresh() {
  const el = document.createElement("div")
  document.body.appendChild(el)
  return createTestEditor({ element: el })
}

/** A single top-level callout at doc pos 0. */
function withCallout(icon = "🔥", text = "hi", id = "c1") {
  const editor = fresh()
  editor.commands.setContent([
    { type: "callout", attrs: { id, icon }, content: [{ type: "text", text }] },
  ])
  return editor
}

describe("Callout — schema", () => {
  it("renders the icon chrome + inline body and round-trips its own getHTML", () => {
    const editor = withCallout("🔥", "hello")
    const html = editor.getHTML()
    expect(html).toContain('data-rune-callout-icon="🔥"')
    expect(html).toContain('class="rune-callout-content"')
    expect(html).toContain("hello")

    editor.commands.setContent(html)
    const again = editor.getHTML()
    expect(again).toContain('data-rune-callout-icon="🔥"')
    expect(again).toContain("hello")
  })

  it("falls back to the default 💡 icon when the attr is empty/absent", () => {
    const editor = fresh()
    editor.commands.setContent(
      '<div class="rune-block rune-callout" data-rune-callout-icon=""><div class="rune-block-content"><span class="rune-callout-icon">x</span><div class="rune-callout-content">body</div></div></div>',
    )
    expect(editor.getHTML()).toContain('data-rune-callout-icon="💡"')
  })

  it("parses an external <aside> callout without slurping the leading emoji", () => {
    const editor = fresh()
    editor.commands.setContent(
      '<aside data-rune-callout="" data-rune-callout-icon="🔥">' +
        '<span data-rune-callout-emoji="" aria-hidden="true">🔥 </span>' +
        '<span data-rune-callout-body="">body text</span>' +
        "</aside>",
    )
    const out = editor.getHTML()
    expect(out).toContain("rune-callout")
    expect(out).toContain('data-rune-callout-icon="🔥"')
    // The emoji span must NOT be pulled into the inline content.
    expect(editor.state.doc.firstChild?.type.name).toBe("callout")
    expect(editor.state.doc.firstChild?.textContent).toBe("body text")
  })

  it("serializes a chrome-free <aside> for the clipboard", () => {
    const editor = withCallout("🔥", "note body")
    editor.view.dispatch(
      editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 0)),
    )
    const { html } = serializeBlocksForClipboard(editor.view)
    expect(html).toContain("<aside")
    expect(html).toContain("data-rune-callout")
    expect(html).toContain("🔥")
    expect(html).toContain("note body")
    // No editor chrome leaks into external paste.
    expect(html).not.toContain("rune-block")
    expect(html).not.toContain("data-id")
    expect(html).not.toContain("data-depth")
  })
})

describe("Callout — emoji popover plugin", () => {
  it("opens the popover when the icon chrome is clicked, and preventDefaults", () => {
    const editor = withCallout("🔥", "hi", "c1")
    const icon = editor.view.dom.querySelector<HTMLElement>(".rune-callout-icon")
    expect(icon).not.toBeNull()

    const event = new MouseEvent("click", { bubbles: true, cancelable: true })
    icon!.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(getCalloutEmojiPopoverBlockId(editor)).toBe("c1")
  })

  it("does not open in read-only mode", () => {
    const editor = withCallout("🔥", "hi", "c1")
    editor.setEditable(false)
    const icon = editor.view.dom.querySelector<HTMLElement>(".rune-callout-icon")
    const event = new MouseEvent("click", { bubbles: true, cancelable: true })
    icon!.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
    expect(getCalloutEmojiPopoverBlockId(editor)).toBeNull()
  })

  it("setCalloutIcon swaps the emoji without disturbing the inline content", () => {
    const editor = withCallout("🔥", "keep me", "c1")
    expect(editor.commands.setCalloutIcon("c1", "🎯")).toBe(true)

    expect(editor.state.doc.firstChild?.attrs.icon).toBe("🎯")
    expect(editor.state.doc.firstChild?.textContent).toBe("keep me")
    expect(editor.getHTML()).toContain('data-rune-callout-icon="🎯"')
  })

  it("setCalloutIcon ignores an empty icon (keeps the current one)", () => {
    const editor = withCallout("🔥", "hi", "c1")
    editor.commands.setCalloutIcon("c1", "")
    expect(editor.state.doc.firstChild?.attrs.icon).toBe("🔥")
  })

  it("closes on selection move and via the close command", () => {
    const editor = withCallout("🔥", "hi", "c1")
    expect(editor.commands.openCalloutEmojiPopover("c1")).toBe(true)
    expect(getCalloutEmojiPopoverBlockId(editor)).toBe("c1")

    // Moving the selection into the body dismisses the picker.
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2)),
    )
    expect(getCalloutEmojiPopoverBlockId(editor)).toBeNull()

    editor.commands.openCalloutEmojiPopover("c1")
    expect(getCalloutEmojiPopoverBlockId(editor)).toBe("c1")
    expect(editor.commands.closeCalloutEmojiPopover()).toBe(true)
    expect(getCalloutEmojiPopoverBlockId(editor)).toBeNull()
  })
})
