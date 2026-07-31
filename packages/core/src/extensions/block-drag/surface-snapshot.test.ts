// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { surfaceBlockSnapshot, snapshotBlocks } from "./block-drag-geometry"
import { createTestEditor } from "../../test-utils/createTestEditor"
import type { EditorView } from "@tiptap/pm/view"

// snapshotBlocks delegates to surfaceBlockSnapshot for the root surface.
//
// jsdom returns zero-size rects, so block rects are mocked via nodeDOM (same
// idiom as block-drag-geometry.test.ts). The pure index/order/min-max math is
// what we assert; the live rect path is covered by Task 3 Playwright e2e.

let container: HTMLDivElement

beforeEach(() => {
  container = document.createElement("div")
  container.className = "rune-editor"
  document.body.appendChild(container)
})

afterEach(() => {
  container.remove()
})

function rectAt(top: number, left: number, width: number, height: number): DOMRect {
  return {
    top,
    bottom: top + height,
    left,
    right: left + width,
    width,
    height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect
}

function mkEditor() {
  const editor = createTestEditor({ element: container })
  editor.commands.setContent([
    { type: "paragraph", attrs: { id: "before" }, content: [{ type: "text", text: "before" }] },
    { type: "paragraph", attrs: { id: "after" }, content: [{ type: "text", text: "after" }] },
  ])
  return editor
}

/** Mock each top-level block's rect by absolute pos. */
function mockRects(editor: ReturnType<typeof mkEditor>, rectsByPos: Map<number, DOMRect>) {
  const originalNodeDOM = editor.view.nodeDOM.bind(editor.view)
  editor.view.nodeDOM = ((pos: number) => {
    const rect = rectsByPos.get(pos)
    if (!rect) return originalNodeDOM(pos)
    const el = document.createElement("p")
    el.getBoundingClientRect = () => rect
    return el
  }) as EditorView["nodeDOM"]
}

describe("surfaceBlockSnapshot", () => {

  it("delegation: snapshotBlocks === surfaceBlockSnapshot(-1)", () => {
    const editor = mkEditor()
    const rects = new Map<number, DOMRect>()
    editor.state.doc.forEach((_node, p) => rects.set(p, rectAt(p * 30, 10, 100, 20)))
    mockRects(editor, rects)

    const viaPublic = snapshotBlocks(editor.view, editor)
    const viaSurface = surfaceBlockSnapshot(editor.view, -1, editor)
    expect(viaPublic).toEqual(viaSurface)
  })
})
