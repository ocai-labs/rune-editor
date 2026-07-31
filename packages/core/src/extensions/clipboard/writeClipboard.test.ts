// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, expect, it } from "vitest"
import { Editor, Extension } from "@tiptap/core"
import { Plugin, TextSelection } from "@tiptap/pm/state"
import { createRuneKit as kit } from "../../kit"
import { writeClipboard } from "./writeClipboard"
import { buildClipboardSerializer } from "./serializer"

function makeEditor(content: unknown = "<p>aaa</p><p>bbb</p><p>ccc</p>") {
  // Capture editor reference inside the plugin closure via a getter
  // — Extension.create's addProseMirrorPlugins runs during editor
  // construction, so the editor variable below isn't yet assigned.
  let editorRef: Editor | null = null
  const SerializerExt = Extension.create({
    name: "clipboard-serializer-test",
    addProseMirrorPlugins() {
      return [
        new Plugin({
          props: { clipboardSerializer: buildClipboardSerializer(this.editor) },
        }),
      ]
    },
  })
  const editor = new Editor({
    extensions: [...kit(), SerializerExt],
    content: content as never,
    element: document.createElement("div"),
  })
  editorRef = editor
  return editorRef
}

// jsdom doesn't ship ClipboardEvent / DataTransfer. Mint a minimal mock
// that satisfies the surface writeClipboard reads: clipboardData with
// clearData / setData / getData / types, and a preventDefault that flips
// defaultPrevented.
function makeEvent(): ClipboardEvent {
  const store = new Map<string, string>()
  const data = {
    get types() {
      return Array.from(store.keys())
    },
    clearData: () => store.clear(),
    setData: (mime: string, value: string) => {
      store.set(mime, value)
    },
    getData: (mime: string) => store.get(mime) ?? "",
  } as unknown as DataTransfer
  let defaultPrevented = false
  const ev = {
    type: "copy",
    clipboardData: data,
    get defaultPrevented() {
      return defaultPrevented
    },
    preventDefault: () => {
      defaultPrevented = true
    },
  }
  return ev as unknown as ClipboardEvent
}

describe("writeClipboard", () => {
  it("returns false on empty selection (no setData)", () => {
    const editor = makeEditor()
    const event = makeEvent()
    const result = writeClipboard(editor.view as any, event, false)
    expect(result).toBe(false)
    expect(event.clipboardData!.types.length).toBe(0)
    editor.destroy()
  })

  it("on full selection: sets text/html, text/plain, application/x-rune-doc", () => {
    const editor = makeEditor()
    editor.commands.selectAll()
    const event = makeEvent()
    const result = writeClipboard(editor.view as any, event, false)
    expect(result).toBe(true)
    const data = event.clipboardData!
    // PM may decorate the first/last node with `data-pm-slice` for slice
    // openness — middle nodes are clean. Check for a chrome-free middle <p>.
    expect(data.getData("text/html")).toContain("<p>bbb</p>")
    expect(data.getData("text/html")).not.toContain("rune-block")
    expect(data.getData("text/html")).not.toContain("data-id")
    expect(data.getData("text/plain").length).toBeGreaterThan(0)
    const json = JSON.parse(data.getData("application/x-rune-doc"))
    expect(json.content.length).toBe(3)
    editor.destroy()
  })

  it("uses math renderText for live-selection text/plain clipboard data", () => {
    const editor = makeEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "inline " },
            { type: "inlineMath", attrs: { latex: "x^2" } },
          ],
        },
      ],
    })
    editor.commands.selectAll()
    const event = makeEvent()

    const result = writeClipboard(editor.view as any, event, false)

    expect(result).toBe(true)
    expect(event.clipboardData!.getData("text/plain")).toContain("$x^2$")
    editor.destroy()
  })

  it("on cut: dispatches deleteSelection AFTER setData (slice not empty)", () => {
    const editor = makeEditor()
    editor.commands.selectAll()
    const event = makeEvent()
    const beforeSize = editor.state.doc.content.size
    const result = writeClipboard(editor.view as any, event, true)
    expect(result).toBe(true)
    expect(event.clipboardData!.getData("application/x-rune-doc")).not.toBe("")
    const json = JSON.parse(event.clipboardData!.getData("application/x-rune-doc"))
    expect(json.content.length).toBe(3)
    expect(editor.state.doc.content.size).toBeLessThan(beforeSize)
    editor.destroy()
  })

  it("calls event.preventDefault on success", () => {
    const editor = makeEditor()
    editor.commands.selectAll()
    const event = makeEvent()
    writeClipboard(editor.view as any, event, false)
    expect(event.defaultPrevented).toBe(true)
    editor.destroy()
  })
})

// FIX 2 — a Cmd-X cut that empties a column's ENTIRE content must remove the
// column (≥2 survive) / unwrap the layout (<2), exactly like the Delete key
// does (#392 parity), instead of the bare tr.delete that left an empty column +
// E2 reseed. The cut clipboard payload must still carry the cut content. Both
// paths route through `applyMbsDelete`.
