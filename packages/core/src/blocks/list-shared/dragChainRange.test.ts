// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, expect, it } from "vitest"
import { getBlockSpecs } from "../../schema"
import { createTestEditor } from "../../test-utils/createTestEditor"
import { listChainDragRange } from "./dragChainRange"

const blocksFromJson = (
  editor: ReturnType<typeof createTestEditor>,
  items: ReadonlyArray<{ type: string; depth: number; text: string }>,
) => {
  editor.commands.setContent({
    type: "doc",
    content: items.map((b) => ({
      type: b.type,
      attrs: { depth: b.depth },
      content: b.text ? [{ type: "text", text: b.text }] : undefined,
    })),
  })
}

describe("listChainDragRange", () => {
  it("returns the single-block range when no deeper siblings follow", () => {
    const editor = createTestEditor()
    blocksFromJson(editor, [
      { type: "numberedList", depth: 0, text: "one" },
      { type: "numberedList", depth: 0, text: "two" },
    ])
    const doc = editor.state.doc
    const first = doc.firstChild!
    const range = listChainDragRange({ node: first, pos: 0, doc, editor })
    expect(range.from).toBe(0)
    expect(range.to).toBe(first.nodeSize)
  })

  it("extends to include trailing strictly-deeper siblings", () => {
    const editor = createTestEditor()
    blocksFromJson(editor, [
      { type: "numberedList", depth: 0, text: "one" },
      { type: "numberedList", depth: 1, text: "two" },
      { type: "numberedList", depth: 2, text: "three" },
      { type: "numberedList", depth: 0, text: "four" },
    ])
    const doc = editor.state.doc
    const second = doc.child(1)
    const secondPos = doc.firstChild!.nodeSize
    const range = listChainDragRange({ node: second, pos: secondPos, doc, editor })
    expect(range.from).toBe(secondPos)
    expect(range.to).toBe(secondPos + second.nodeSize + doc.child(2).nodeSize)
  })

  it("stops at the first sibling whose depth equals self.depth", () => {
    const editor = createTestEditor()
    blocksFromJson(editor, [
      { type: "numberedList", depth: 1, text: "a" },
      { type: "numberedList", depth: 2, text: "b" },
      { type: "numberedList", depth: 1, text: "c" },
    ])
    const doc = editor.state.doc
    const first = doc.firstChild!
    const range = listChainDragRange({ node: first, pos: 0, doc, editor })
    expect(range.to).toBe(first.nodeSize + doc.child(1).nodeSize)
  })

  it("stops at a non-list sibling regardless of its depth attr", () => {
    const editor = createTestEditor()
    blocksFromJson(editor, [
      { type: "numberedList", depth: 0, text: "one" },
      { type: "paragraph", depth: 0, text: "para" },
    ])
    const doc = editor.state.doc
    const first = doc.firstChild!
    const range = listChainDragRange({ node: first, pos: 0, doc, editor })
    expect(range.to).toBe(first.nodeSize)
  })

  it("returns the single-block range when pos is not a top-level child boundary", () => {
    const editor = createTestEditor()
    blocksFromJson(editor, [
      { type: "numberedList", depth: 0, text: "one" },
      { type: "numberedList", depth: 1, text: "two" },
    ])
    const doc = editor.state.doc
    const first = doc.firstChild!
    const range = listChainDragRange({ node: first, pos: 1, doc, editor })
    expect(range.from).toBe(1)
    expect(range.to).toBe(1 + first.nodeSize)
  })

  it("extends across mixed structural list types", () => {
    const editor = createTestEditor()
    blocksFromJson(editor, [
      { type: "numberedList", depth: 0, text: "one" },
      { type: "bulletList", depth: 1, text: "two" },
      { type: "taskList", depth: 2, text: "three" },
      { type: "paragraph", depth: 3, text: "para" },
    ])
    const doc = editor.state.doc
    const first = doc.firstChild!
    const range = listChainDragRange({ node: first, pos: 0, doc, editor })
    expect(range.to).toBe(
      first.nodeSize + doc.child(1).nodeSize + doc.child(2).nodeSize,
    )
  })

  it("stops at the first shallower structural list sibling", () => {
    const editor = createTestEditor()
    blocksFromJson(editor, [
      { type: "numberedList", depth: 2, text: "one" },
      { type: "numberedList", depth: 3, text: "two" },
      { type: "numberedList", depth: 1, text: "three" },
    ])
    const doc = editor.state.doc
    const first = doc.firstChild!
    const range = listChainDragRange({ node: first, pos: 0, doc, editor })
    expect(range.to).toBe(first.nodeSize + doc.child(1).nodeSize)
  })

  it("falls back to the hardcoded structural set when called editor-less", () => {
    // Pins FALLBACK_STRUCTURAL_TYPES as a genuine dead-code safety net:
    // the production path always threads `editor`, but the fallback must
    // still classify the built-in list types so a non-editor caller
    // extends across a trailing deeper bullet sibling.
    const editor = createTestEditor()
    blocksFromJson(editor, [
      { type: "bulletList", depth: 0, text: "parent" },
      { type: "bulletList", depth: 1, text: "child" },
      { type: "bulletList", depth: 0, text: "sibling" },
    ])
    const doc = editor.state.doc
    const first = doc.firstChild!
    const range = listChainDragRange({ node: first, pos: 0, doc })
    expect(range.to).toBe(first.nodeSize + doc.child(1).nodeSize)
  })
})

describe.each(["numberedList", "bulletList", "taskList"] as const)(
  "%s dragSourceRange",
  (type) => {
    it("uses listChainDragRange to extend over trailing deeper siblings", () => {
      const editor = createTestEditor()
      blocksFromJson(editor, [
        { type, depth: 0, text: "parent" },
        { type, depth: 1, text: "child" },
        { type, depth: 0, text: "sibling" },
      ])
      const hook = getBlockSpecs(editor)[type]!.dragSourceRange!
      const doc = editor.state.doc
      const range = hook({ node: doc.firstChild!, pos: 0, doc })
      expect(range.to).toBe(doc.firstChild!.nodeSize + doc.child(1).nodeSize)
    })
  },
)
