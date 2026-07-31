// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// packages/core/src/blocks/Toggle/clipboard.test.ts
import { describe, it, expect } from "vitest"
import { NodeSelection } from "@tiptap/pm/state"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import { createTestEditor } from "../../test-utils/createTestEditor"
import { serializeBlocksForClipboard } from "../../extensions/clipboard/serializeBlocks"
import { expandCollapsedToggles } from "./expandSlice"
import { MultiBlockSelection } from "../../extensions/block-selection/MultiBlockSelection"
import { surfaceChildrenAt } from "../../schema/bodySurface"

function fresh() {
  const el = document.createElement("div")
  document.body.appendChild(el)
  return createTestEditor({ element: el })
}

describe("expandCollapsedToggles", () => {
  it("interleaves hidden body immediately after a collapsed toggle", () => {
    const editor = fresh()
    editor.commands.setContent([
      { type: "toggle", attrs: { level: 0, expanded: false }, content: [{ type: "text", text: "t" }] },
      { type: "paragraph", attrs: { depth: 1 }, content: [{ type: "text", text: "hidden" }] },
      { type: "paragraph", attrs: { depth: 0 }, content: [{ type: "text", text: "sibling" }] },
    ])
    // Wait one microtask so BlockId can fill the toggle's id; the
    // expansion matches by id and a null id is skipped.
    return Promise.resolve().then(() => {
      // MBS across all 3 top-level blocks (indices 0..2).
      editor.view.dispatch(
        editor.state.tr.setSelection(
          MultiBlockSelection.create(editor.state.doc, 0, 2),
        ),
      )
      const slice = editor.state.selection.content()
      const expanded = expandCollapsedToggles(slice, editor.state.doc)
      expect(expanded.content.childCount).toBe(3)
      expect(expanded.content.child(0).type.name).toBe("toggle")
      expect(expanded.content.child(1).textContent).toBe("hidden")
      expect(expanded.content.child(2).textContent).toBe("sibling")
    })
  })

  it("does NOT expand an expanded toggle", () => {
    const editor = fresh()
    editor.commands.setContent([
      { type: "toggle", attrs: { level: 0, expanded: true }, content: [{ type: "text", text: "t" }] },
      { type: "paragraph", attrs: { depth: 1 }, content: [{ type: "text", text: "shown" }] },
    ])
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 0)))
    const slice = editor.state.selection.content()
    const expanded = expandCollapsedToggles(slice, editor.state.doc)
    expect(expanded.content.childCount).toBe(1)
  })

  it("recursively expands nested collapsed toggles", () => {
    const editor = fresh()
    editor.commands.setContent([
      { type: "toggle", attrs: { level: 0, expanded: false }, content: [{ type: "text", text: "out" }] },
      { type: "toggle", attrs: { depth: 1, level: 0, expanded: false }, content: [{ type: "text", text: "in" }] },
      { type: "paragraph", attrs: { depth: 2 }, content: [{ type: "text", text: "deep" }] },
    ])
    return Promise.resolve().then(() => {
      editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 0)))
      const slice = editor.state.selection.content()
      const expanded = expandCollapsedToggles(slice, editor.state.doc)
      // outer toggle pulls in inner toggle; inner toggle pulls in deep paragraph.
      expect(expanded.content.childCount).toBe(3)
      expect(expanded.content.child(0).textContent).toBe("out")
      expect(expanded.content.child(1).textContent).toBe("in")
      expect(expanded.content.child(2).textContent).toBe("deep")
    })
  })

  it("end-to-end: serializeBlocksForClipboard interleaves body in html output", () => {
    const editor = fresh()
    editor.commands.setContent([
      { type: "toggle", attrs: { level: 0, expanded: false }, content: [{ type: "text", text: "title" }] },
      { type: "paragraph", attrs: { depth: 1 }, content: [{ type: "text", text: "hidden body" }] },
      { type: "paragraph", attrs: { depth: 0 }, content: [{ type: "text", text: "after" }] },
    ])
    return Promise.resolve().then(() => {
      // MBS across all 3 top-level blocks (indices 0..2).
      editor.view.dispatch(
        editor.state.tr.setSelection(MultiBlockSelection.create(editor.state.doc, 0, 2)),
      )
      const { html } = serializeBlocksForClipboard(editor.view)
      // hidden body must appear before "after" in the HTML stream.
      const hiddenIdx = html.indexOf("hidden body")
      const afterIdx = html.indexOf("after")
      expect(hiddenIdx).toBeGreaterThan(-1)
      expect(afterIdx).toBeGreaterThan(hiddenIdx)
    })
  })
})
