// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Editor } from "@tiptap/core"
import Document from "@tiptap/extension-document"
import Text from "@tiptap/extension-text"
import { Paragraph } from "../../blocks"
import { createTestEditor } from "../../test-utils/createTestEditor"
import { headIndexAtY } from "./head-index"

let container: HTMLDivElement

beforeEach(() => {
  container = document.createElement("div")
  container.className = "rune-editor"
  document.body.appendChild(container)
})

afterEach(() => {
  container.remove()
})

describe("headIndexAtY", () => {
  it("uses posAtCoords when cursor sits over editor content", () => {
    const editor = new Editor({
      element: container,
      extensions: [Document, Text, Paragraph],
      content: "<p>A</p><p>B</p>",
    })
    ;(editor.view.posAtCoords as unknown as (coords: { left: number; top: number }) => { pos: number; inside: number } | null) =
      ({ top }) => (top < 60 ? { pos: 2, inside: 0 } : { pos: editor.state.doc.child(0).nodeSize + 2, inside: editor.state.doc.child(0).nodeSize })

    expect(headIndexAtY(editor.view, 20, 20)).toBe(0)
    expect(headIndexAtY(editor.view, 20, 80)).toBe(1)
    editor.destroy()
  })

  it("falls back to bounding-rect scan when posAtCoords returns null", () => {
    const editor = new Editor({
      element: container,
      extensions: [Document, Text, Paragraph],
      content: "<p>A</p><p>B</p>",
    })
    ;(editor.view.posAtCoords as unknown as (coords: { left: number; top: number }) => { pos: number; inside: number } | null) =
      () => null

    const ps = container.querySelectorAll(".rune-block")
    ;(ps[0] as HTMLElement).getBoundingClientRect = () =>
      ({ top: 0, bottom: 20, left: 0, right: 100, width: 100, height: 20, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    ;(ps[1] as HTMLElement).getBoundingClientRect = () =>
      ({ top: 40, bottom: 60, left: 0, right: 100, width: 100, height: 20, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect

    expect(headIndexAtY(editor.view, 0, 10)).toBe(0)   // inside B0
    expect(headIndexAtY(editor.view, 0, 50)).toBe(1)   // inside B1
    expect(headIndexAtY(editor.view, 0, -10)).toBe(0)  // above all → clamp first
    expect(headIndexAtY(editor.view, 0, 999)).toBe(1)  // below all → clamp last
    editor.destroy()
  })
})

describe("headIndexAtY — atom inside-preference", () => {
  // `posAtCoords` on an atom leaf block (image/video/divider) returns a CARET
  // position: pointing at the atom's right half resolves `pos` to the boundary
  // AFTER the node, so a bare `$pos.index(0)` reads the NEXT block's index.
  // `hit.inside` names the node the point is physically within — these pin
  // that headIndexAtY prefers it when that node is an atom child of the
  // surface (mirrors SideMenu.ts's pos-based correction; see head-index.ts).
  it("a right-half hit over an atom returns the ATOM's index, not the next block's", () => {
    const editor = createTestEditor({ element: container })
    editor.commands.setContent([
      { type: "paragraph", content: [{ type: "text", text: "before" }] },
      { type: "image", attrs: { id: "img1", depth: 0, src: "https://cdn.example/a.png" } },
      { type: "paragraph", content: [{ type: "text", text: "after" }] },
    ])
    const imgPos = editor.state.doc.child(0).nodeSize
    const afterImg = imgPos + editor.state.doc.child(1).nodeSize
    expect(editor.state.doc.nodeAt(imgPos)?.type.name).toBe("image")
    ;(editor.view.posAtCoords as unknown as (coords: { left: number; top: number }) => { pos: number; inside: number } | null) =
      () => ({ pos: afterImg, inside: imgPos })

    expect(headIndexAtY(editor.view, 50, 50)).toBe(1)
  })

  it("strict: a right-half hit over a LAST-child atom is not rejected as void-below", () => {
    // When the atom is the doc's last child, the right-half caret resolution is
    // `doc.content.size` — exactly the strict-mode "void below last block"
    // rejection. But the pointer is physically ON the atom (`inside` names it),
    // so the inside-preference must win over the void rejection.
    const editor = createTestEditor({ element: container })
    editor.commands.setContent([
      { type: "paragraph", content: [{ type: "text", text: "before" }] },
      { type: "image", attrs: { id: "img1", depth: 0, src: "https://cdn.example/a.png" } },
    ])
    const imgPos = editor.state.doc.child(0).nodeSize
    ;(editor.view.posAtCoords as unknown as (coords: { left: number; top: number }) => { pos: number; inside: number } | null) =
      () => ({ pos: editor.state.doc.content.size, inside: imgPos })

    expect(headIndexAtY(editor.view, 50, 50, { strict: true })).toBe(1)
    expect(headIndexAtY(editor.view, 50, 50)).toBe(1)
  })

  it("a hit inside a textblock keeps the caret-pos read (inside names a non-atom)", () => {
    const editor = createTestEditor({ element: container })
    editor.commands.setContent([
      { type: "paragraph", content: [{ type: "text", text: "A" }] },
      { type: "paragraph", content: [{ type: "text", text: "B" }] },
    ])
    const p1Pos = editor.state.doc.child(0).nodeSize
    ;(editor.view.posAtCoords as unknown as (coords: { left: number; top: number }) => { pos: number; inside: number } | null) =
      () => ({ pos: p1Pos + 1, inside: p1Pos })

    expect(headIndexAtY(editor.view, 50, 50)).toBe(1)
    expect(headIndexAtY(editor.view, 50, 50, { strict: true })).toBe(1)
  })
})

describe("headIndexAtY — strict mode", () => {
  it("returns null when cursor is below all blocks", () => {
    const editor = new Editor({
      element: container,
      extensions: [Document, Text, Paragraph],
      content: "<p>A</p><p>B</p>",
    })
    ;(editor.view.posAtCoords as unknown as (coords: { left: number; top: number }) => { pos: number; inside: number } | null) =
      () => null

    const ps = container.querySelectorAll(".rune-block")
    ;(ps[0] as HTMLElement).getBoundingClientRect = () =>
      ({ top: 0, bottom: 20, left: 0, right: 100, width: 100, height: 20, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    ;(ps[1] as HTMLElement).getBoundingClientRect = () =>
      ({ top: 40, bottom: 60, left: 0, right: 100, width: 100, height: 20, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect

    expect(headIndexAtY(editor.view, 0, 999, { strict: true })).toBeNull()
    expect(headIndexAtY(editor.view, 0, -50, { strict: true })).toBeNull()
    expect(headIndexAtY(editor.view, 0, 30, { strict: true })).toBeNull()  // gap between blocks
    // Inside a block still resolves.
    expect(headIndexAtY(editor.view, 0, 10, { strict: true })).toBe(0)
    expect(headIndexAtY(editor.view, 0, 50, { strict: true })).toBe(1)

    editor.destroy()
  })

  it("returns null in strict mode when posAtCoords resolves to doc.content.size below last block", () => {
    // Real-browser case: clicking in the editor's bottom padding (still inside
    // .ProseMirror) lets `posAtCoords` resolve to `doc.content.size` instead of
    // returning null. The fast path used to clamp this to lastIdx, silently
    // bypassing strict mode and producing a non-null result for void-below
    // clicks.
    const editor = new Editor({
      element: container,
      extensions: [Document, Text, Paragraph],
      content: "<p>A</p><p>B</p>",
    })
    ;(editor.view.posAtCoords as unknown as (coords: { left: number; top: number }) => { pos: number; inside: number } | null) =
      () => ({ pos: editor.state.doc.content.size, inside: -1 })

    const ps = container.querySelectorAll(".rune-block")
    ;(ps[0] as HTMLElement).getBoundingClientRect = () =>
      ({ top: 0, bottom: 20, left: 0, right: 100, width: 100, height: 20, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    ;(ps[1] as HTMLElement).getBoundingClientRect = () =>
      ({ top: 40, bottom: 60, left: 0, right: 100, width: 100, height: 20, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect

    expect(headIndexAtY(editor.view, 0, 999, { strict: true })).toBeNull()
    // Non-strict still clamps to lastIdx so dragging past the bottom keeps tracking.
    expect(headIndexAtY(editor.view, 0, 999)).toBe(1)
    editor.destroy()
  })
})
