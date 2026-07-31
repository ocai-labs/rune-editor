// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, expect, it } from "vitest"
import { Editor } from "@tiptap/core"
import { createRuneKit as kit } from "../../kit"
import { buildClipboardSerializer } from "./serializer"

function withEditor<T>(fn: (editor: Editor) => T): T {
  const editor = new Editor({ extensions: kit(), element: document.createElement("div") })
  try { return fn(editor) } finally { editor.destroy() }
}

describe("buildClipboardSerializer", () => {
  it("paragraph serializes to bare <p> (no .rune-block wrapper)", () => {
    withEditor((editor) => {
      const ser = buildClipboardSerializer(editor)
      const node = editor.schema.nodes.paragraph!.create(null, editor.schema.text("hi"))
      const dom = ser.serializeNode(node) as HTMLElement
      expect(dom.outerHTML).toBe("<p>hi</p>")
    })
  })

  it("heading serializes to its identity HTML tag", () => {
    withEditor((editor) => {
      const ser = buildClipboardSerializer(editor)
      const node = editor.schema.nodes.heading!.create({ level: 1 }, editor.schema.text("T"))
      const dom = ser.serializeNode(node) as HTMLElement
      expect(dom.outerHTML).toBe("<h1>T</h1>")
    })
  })

  it("divider serializes to bare <hr> via clipboardRenderDOM", () => {
    withEditor((editor) => {
      const ser = buildClipboardSerializer(editor)
      const node = editor.schema.nodes.divider!.create()
      const dom = ser.serializeNode(node) as HTMLElement
      expect(dom.outerHTML).toBe("<hr>")
    })
  })

  it("marks serialize via schema default (bold → <strong>)", () => {
    withEditor((editor) => {
      const ser = buildClipboardSerializer(editor)
      const bold = editor.schema.marks.bold!.create()
      const text = editor.schema.text("x", [bold])
      const node = editor.schema.nodes.paragraph!.create(null, text)
      const dom = ser.serializeNode(node) as HTMLElement
      expect(dom.outerHTML).toBe("<p><strong>x</strong></p>")
    })
  })

  // Regression guard: the to-do `clipboardRenderDOM` must actually survive
  // ProseMirror's `renderSpec`. A bare content hole as a sibling of the
  // <input> threw "Content hole must be the only child of its parent node"
  // mid-serialize, crashing every Cmd-C / Copy-page over a range with a
  // checkbox. A shape-only `toEqual` assertion (block.test.ts) cannot catch
  // this — only running it through `serializeNode` does.
  it("checked to-do serializes through renderSpec without throwing", () => {
    withEditor((editor) => {
      const ser = buildClipboardSerializer(editor)
      const node = editor.schema.nodes.taskList!.create({ checked: true }, editor.schema.text("milk"))
      const dom = ser.serializeNode(node) as HTMLElement
      expect(dom.outerHTML).toBe(
        '<ul><li><input type="checkbox" disabled="" checked=""> <span>milk</span></li></ul>',
      )
    })
  })

  it("unchecked to-do serializes through renderSpec (no checked attr)", () => {
    withEditor((editor) => {
      const ser = buildClipboardSerializer(editor)
      const node = editor.schema.nodes.taskList!.create({ checked: false }, editor.schema.text("eggs"))
      const dom = ser.serializeNode(node) as HTMLElement
      expect(dom.outerHTML).toBe(
        '<ul><li><input type="checkbox" disabled=""> <span>eggs</span></li></ul>',
      )
    })
  })
})
