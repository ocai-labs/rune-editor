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
import { MultiBlockSelection } from "../block-selection/MultiBlockSelection"
import { surfaceChildrenAt } from "../../schema/bodySurface"

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

/** Build a `<column>`-local MBS over `columnId`'s entire content. */
function selectWholeColumn(editor: Editor, columnId: string) {
  const doc = editor.state.doc
  let columnPos = -1
  doc.descendants((node, pos) => {
    if (node.type.name === "column" && node.attrs.id === columnId) columnPos = pos
    return columnPos === -1
  })
  const surface = surfaceChildrenAt(doc, columnPos + 1)!
  const $surface = doc.resolve(surface.start)
  const last = surface.node.childCount - 1
  editor.view.dispatch(
    editor.state.tr.setSelection(MultiBlockSelection.create(doc, 0, last, $surface)),
  )
}

function columnDoc(columns: Array<{ id: string; text: string }>) {
  return {
    type: "doc",
    content: [
      { type: "paragraph", attrs: { id: "r1", depth: 0 }, content: [{ type: "text", text: "root-1" }] },
      {
        type: "columnLayout",
        attrs: { id: "lay", depth: 0 },
        content: columns.map((c) => ({
          type: "column",
          attrs: { id: c.id, width: 1 },
          content: [
            { type: "paragraph", attrs: { id: `${c.id}_p`, depth: 0 }, content: [{ type: "text", text: c.text }] },
          ],
        })),
      },
      { type: "paragraph", attrs: { id: "r2", depth: 0 }, content: [{ type: "text", text: "root-2" }] },
    ],
  }
}

describe("writeClipboard — cut empties a column (F2 parity)", () => {
  it("3-col: cutting a column's whole content removes that column; clipboard carries it", () => {
    const editor = makeEditor(
      columnDoc([
        { id: "col_a", text: "A1" },
        { id: "col_b", text: "B1" },
        { id: "col_c", text: "C1" },
      ]),
    )
    // Move the real selection to a caret first so MBS isn't fighting stale state.
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1)))
    selectWholeColumn(editor, "col_c")
    const event = makeEvent()

    const ok = writeClipboard(editor.view as any, event, true)
    expect(ok).toBe(true)

    // The emptied column is GONE — layout persists with two columns (no empty
    // col_c, no E2 reseed).
    const layoutJson = editor.state.doc.child(1)
    expect(layoutJson.type.name).toBe("columnLayout")
    expect(layoutJson.childCount).toBe(2)
    // Clipboard still carries the cut block's content.
    const rune = JSON.parse(event.clipboardData!.getData("application/x-rune-doc"))
    expect(JSON.stringify(rune)).toContain("C1")
    expect(event.clipboardData!.getData("text/plain")).toContain("C1")
    editor.destroy()
  })

  it("2-col: cutting a column's whole content unwraps the layout; clipboard carries it", () => {
    const editor = makeEditor(
      columnDoc([
        { id: "col_a", text: "A1" },
        { id: "col_b", text: "B1" },
      ]),
    )
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1)))
    selectWholeColumn(editor, "col_b") // empty the RIGHT column → survivor col_a
    const event = makeEvent()

    const ok = writeClipboard(editor.view as any, event, true)
    expect(ok).toBe(true)

    // Layout dissolved: no columnLayout remains; survivor content is at root.
    let hasLayout = false
    editor.state.doc.forEach((n) => {
      if (n.type.name === "columnLayout") hasLayout = true
    })
    expect(hasLayout).toBe(false)
    expect(editor.state.doc.textContent).toContain("A1")
    // Clipboard carries the cut (RIGHT column) content.
    const rune = JSON.parse(event.clipboardData!.getData("application/x-rune-doc"))
    expect(JSON.stringify(rune)).toContain("B1")
    editor.destroy()
  })
})
