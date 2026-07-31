// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, it, expect } from "vitest"
import { Editor } from "@tiptap/core"
import Document from "@tiptap/extension-document"
import Text from "@tiptap/extension-text"
import { Divider } from "../../blocks"
import { createBlockSpec } from "../../schema"
import { createTestEditor } from "../../test-utils/createTestEditor"
import { isDraggable, draggableAncestorPosFor } from "./block-registry"

const Para = createBlockSpec({
  type: "paragraph",
  content: "inline*",
  parseDOM: [{ tag: "p" }],
  renderDOM: ({ HTMLAttributes }) => ["p", HTMLAttributes, 0],
  sideMenu: { draggable: true },
})

const Heading = createBlockSpec({
  type: "heading",
  content: "inline*",
  parseDOM: [{ tag: "h2" }],
  renderDOM: ({ HTMLAttributes }) => ["h2", HTMLAttributes, 0],
  sideMenu: { draggable: true },
})

const NonDraggable = createBlockSpec({
  type: "nonDraggable",
  content: "",
  parseDOM: [{ tag: "aside" }],
  renderDOM: ({ HTMLAttributes }) => [
    "aside",
    { ...HTMLAttributes, class: "rune-block" },
  ],
})

function mkEditor() {
  return new Editor({
    extensions: [Document, Text, Para, Heading, NonDraggable],
    content: "<p>a</p>",
  })
}

describe("isDraggable", () => {
  it("returns true for registered draggable blocks", () => {
    const editor = mkEditor()
    expect(isDraggable("paragraph", editor)).toBe(true)
    expect(isDraggable("heading", editor)).toBe(true)
    editor.destroy()
  })

  it("returns false for registered non-draggable blocks", () => {
    const editor = mkEditor()
    expect(isDraggable("nonDraggable", editor)).toBe(false)
    editor.destroy()
  })

  it("returns true for the built-in Divider when registered", () => {
    const editor = new Editor({
      extensions: [Document, Text, Divider],
      content: "<hr>",
    })
    expect(isDraggable("divider", editor)).toBe(true)
    editor.destroy()
  })

  it("returns false for unregistered types", () => {
    const editor = mkEditor()
    expect(isDraggable("doc", editor)).toBe(false)
    expect(isDraggable("unknown", editor)).toBe(false)
    editor.destroy()
  })
})

describe("draggableAncestorPosFor", () => {
  it("resolves the top-level paragraph pos when cursor is in text", () => {
    const editor = mkEditor()
    expect(draggableAncestorPosFor(editor.view, 1, editor)).toBe(0)
    editor.destroy()
  })

  it("returns null when no draggable ancestor exists", () => {
    const editor = new Editor({
      extensions: [Document, Text, NonDraggable],
      content: "<aside></aside>",
    })
    expect(draggableAncestorPosFor(editor.view, 0, editor)).toBeNull()
    expect(draggableAncestorPosFor(editor.view, 1, editor)).toBeNull()
    editor.destroy()
  })

  it("resolves the built-in Divider at the top-level boundary before the atom", () => {
    const editor = new Editor({
      extensions: [Document, Text, Divider],
      content: "<hr>",
    })
    expect(draggableAncestorPosFor(editor.view, 0, editor)).toBe(0)
    editor.destroy()
  })

  it("resolves the built-in Divider at the top-level boundary after the atom", () => {
    const editor = new Editor({
      extensions: [Document, Text, Divider],
      content: "<hr>",
    })
    expect(draggableAncestorPosFor(editor.view, 1, editor)).toBe(0)
    editor.destroy()
  })

})
