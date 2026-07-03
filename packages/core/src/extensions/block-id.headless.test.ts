// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Regression coverage for BlockId's seed backfill (block-id.ts): a headless
// editor (`new Editor({ element: null, ... })`, the documented SSR path)
// never mounts an EditorView, so it never attaches ANY ProseMirror plugin
// and never emits Tiptap's "create" event — see the mechanism comment atop
// block-id.ts for why onBeforeCreate content pre-patching is what covers
// this instead. These assertions state the contract that must hold in both
// headless and mounted editors.

import { describe, it, expect } from "vitest"
import { Editor } from "@tiptap/core"
import Document from "@tiptap/extension-document"
import Text from "@tiptap/extension-text"
import { Paragraph } from "../blocks"
import { BlockId } from "./block-id"

function collectBlockIds(editor: Editor): Array<string | null> {
  const ids: Array<string | null> = []
  editor.state.doc.descendants((node) => {
    if (node.type.name === "paragraph") {
      ids.push((node.attrs.id as string | null) ?? null)
    }
    return true
  })
  return ids
}

function makeHeadlessEditor(content: unknown): Editor {
  return new Editor({
    element: null,
    extensions: [Document, Text, Paragraph, BlockId],
    content: content as never,
  })
}

function makeMountedEditor(content: unknown): Editor {
  return new Editor({
    element: document.createElement("div"),
    extensions: [Document, Text, Paragraph, BlockId],
    content: content as never,
  })
}

describe("BlockId headless seed backfill", () => {
  it("a headless (element: null) editor fills null ids on seed content", () => {
    const editor = makeHeadlessEditor({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "first" }] },
        { type: "paragraph", content: [{ type: "text", text: "second" }] },
      ],
    })
    const ids = collectBlockIds(editor)
    expect(ids).toHaveLength(2)
    expect(ids[0]).not.toBeNull()
    expect(ids[1]).not.toBeNull()
    editor.destroy()
  })

  it("a headless editor de-dupes colliding seed ids", () => {
    const editor = makeHeadlessEditor({
      type: "doc",
      content: [
        { type: "paragraph", attrs: { id: "dup00001" }, content: [{ type: "text", text: "a" }] },
        { type: "paragraph", attrs: { id: "dup00001" }, content: [{ type: "text", text: "b" }] },
      ],
    })
    const ids = collectBlockIds(editor) as string[]
    expect(new Set(ids).size).toBe(ids.length)
    editor.destroy()
  })

  it("CONTROL: the same duplicate-id seed content de-dupes in a MOUNTED editor", () => {
    const editor = makeMountedEditor({
      type: "doc",
      content: [
        { type: "paragraph", attrs: { id: "dup00001" }, content: [{ type: "text", text: "a" }] },
        { type: "paragraph", attrs: { id: "dup00001" }, content: [{ type: "text", text: "b" }] },
      ],
    })
    const ids = collectBlockIds(editor) as string[]
    expect(new Set(ids).size).toBe(ids.length)
    editor.destroy()
  })

  it("a headless editor fills ids on HTML STRING seed content", () => {
    const editor = makeHeadlessEditor("<p>first</p><p>second</p>")
    const ids = collectBlockIds(editor)
    expect(ids).toHaveLength(2)
    expect(ids[0]).not.toBeNull()
    expect(ids[1]).not.toBeNull()
    expect(ids[0]).not.toBe(ids[1])
    editor.destroy()
  })

  it("seed content that's already fully/uniquely id'd is left untouched (no rewrite)", () => {
    const content = {
      type: "doc",
      content: [
        { type: "paragraph", attrs: { id: "aaaaaaaa" }, content: [{ type: "text", text: "a" }] },
        { type: "paragraph", attrs: { id: "bbbbbbbb" }, content: [{ type: "text", text: "b" }] },
      ],
    }
    const editor = makeHeadlessEditor(content)
    // onBeforeCreate only reassigns `editor.options.content` when the
    // backfill produces patches. Already-unique seed content produces none,
    // so the option must still hold the exact object we passed in.
    expect(editor.options.content).toBe(content)
    const ids = collectBlockIds(editor)
    expect(ids).toEqual(["aaaaaaaa", "bbbbbbbb"])
    editor.destroy()
  })
})
