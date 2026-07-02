// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { Editor } from "@tiptap/core"
import Document from "@tiptap/extension-document"
import Text from "@tiptap/extension-text"
import { createBlockSpec } from "../../schema"
import { CaretComfort } from "./index"
import { GestureStatePlugin, gestureKey } from "../shared/gesture-state"

const Para = createBlockSpec({
  type: "paragraph",
  content: "inline*",
  parseDOM: [{ tag: "p" }],
  renderDOM: ({ HTMLAttributes }) => ["p", HTMLAttributes, 0],
})

let container: HTMLDivElement
let scrollBySpy: ReturnType<typeof vi.fn>
let rafSpy: ReturnType<typeof vi.spyOn>

// Mock the browser DOM selection. We control whether it's collapsed,
// which node it's anchored to, and the bounding rect's bottom — that's
// all CaretComfort reads.
type MockSelection = {
  isCollapsed: boolean
  rangeCount: number
  startContainer: Node
  startOffset?: number
  rectBottom: number
}

function mockSelection(opts: MockSelection): void {
  const fakeRange = {
    startContainer: opts.startContainer,
    startOffset: opts.startOffset ?? 0,
    getBoundingClientRect: () => ({
      bottom: opts.rectBottom,
      top: opts.rectBottom - 20,
      left: 0,
      right: 0,
      width: 0,
      height: 20,
    }),
  }
  const fakeSelection = {
    isCollapsed: opts.isCollapsed,
    rangeCount: opts.rangeCount,
    getRangeAt: () => fakeRange,
  }
  ;(window as unknown as { getSelection: () => unknown }).getSelection = () =>
    fakeSelection
}

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  scrollBySpy = vi.fn()
  ;(window as unknown as { scrollBy: typeof window.scrollBy }).scrollBy =
    scrollBySpy as unknown as typeof window.scrollBy
  rafSpy = vi
    .spyOn(window, "requestAnimationFrame")
    .mockImplementation((cb: FrameRequestCallback) => {
      cb(0)
      return 0
    })
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 })
})

afterEach(() => {
  rafSpy.mockRestore()
  container.remove()
})

function makeEditor(html = "<p>hello world</p>"): Editor {
  return new Editor({
    element: container,
    extensions: [Document, Text, Para, GestureStatePlugin, CaretComfort],
    content: html,
  })
}

function dispatchMouseup(editor: Editor): void {
  editor.view.dom.dispatchEvent(
    new Event("mouseup", { bubbles: true, cancelable: true }),
  )
}

describe("CaretComfort", () => {
  it("skips scroll when a gesture is active", () => {
    const editor = makeEditor()
    editor.view.dispatch(
      editor.state.tr.setMeta(gestureKey, { activeGesture: "block-drag" }),
    )
    mockSelection({
      isCollapsed: true,
      rangeCount: 1,
      startContainer: editor.view.dom,
      rectBottom: 750,
    })

    dispatchMouseup(editor)
    expect(scrollBySpy).not.toHaveBeenCalled()
    editor.destroy()
  })

  it("skips scroll when the DOM selection is a range, not a caret", () => {
    const editor = makeEditor()
    mockSelection({
      isCollapsed: false,
      rangeCount: 1,
      startContainer: editor.view.dom,
      rectBottom: 750,
    })

    dispatchMouseup(editor)
    expect(scrollBySpy).not.toHaveBeenCalled()
    editor.destroy()
  })

  it("skips scroll when the selection is outside the editor DOM", () => {
    const editor = makeEditor()
    const outside = document.createElement("div")
    document.body.appendChild(outside)
    mockSelection({
      isCollapsed: true,
      rangeCount: 1,
      startContainer: outside,
      rectBottom: 750,
    })

    dispatchMouseup(editor)
    expect(scrollBySpy).not.toHaveBeenCalled()
    outside.remove()
    editor.destroy()
  })

  it("skips scroll when caret is comfortably above the viewport bottom", () => {
    const editor = makeEditor()
    mockSelection({
      isCollapsed: true,
      rangeCount: 1,
      startContainer: editor.view.dom,
      rectBottom: 200,
    })

    dispatchMouseup(editor)
    expect(scrollBySpy).not.toHaveBeenCalled()
    editor.destroy()
  })

  // Regression: the caret is BELOW the visible viewport — e.g. the
  // user scrolled the off-screen end-of-doc caret out of view, then clicked
  // a non-editable blank region (a wide table's right overflow, the
  // side-menu gutter widget) that does NOT move the caret. The stale caret
  // sits far below the fold, so distanceFromBottom goes negative and the
  // naive deficit (120 - (-N) = huge) yanked the viewport DOWN to chase it.
  // Comfort must never scroll downward to a caret the click never placed.
  it("skips scroll when the caret is below the visible viewport (off-screen)", () => {
    const editor = makeEditor()
    // innerHeight = 800; caret at 1500 → 700px below the fold.
    mockSelection({
      isCollapsed: true,
      rangeCount: 1,
      startContainer: editor.view.dom,
      rectBottom: 1500,
    })

    dispatchMouseup(editor)
    expect(scrollBySpy).not.toHaveBeenCalled()
    editor.destroy()
  })

  it("still scrolls when the caret sits exactly at the visible bottom edge", () => {
    const editor = makeEditor()
    // distanceFromBottom = 0 (visible, just touching the fold) → deficit 120.
    mockSelection({
      isCollapsed: true,
      rangeCount: 1,
      startContainer: editor.view.dom,
      rectBottom: 800,
    })

    dispatchMouseup(editor)
    expect(scrollBySpy).toHaveBeenCalledTimes(1)
    expect(scrollBySpy).toHaveBeenCalledWith(0, 120)
    editor.destroy()
  })

  it("scrolls by the deficit when caret is within 120px of the bottom", () => {
    const editor = makeEditor()
    // 800 - 750 = 50 → deficit = 120 - 50 = 70
    mockSelection({
      isCollapsed: true,
      rangeCount: 1,
      startContainer: editor.view.dom,
      rectBottom: 750,
    })

    dispatchMouseup(editor)
    expect(scrollBySpy).toHaveBeenCalledTimes(1)
    // scrollViewport uses the positional form for window. The smooth-scroll
    // payload that lived here previously was lost in the #171 fix because
    // scrollViewport is window/element agnostic — block-selection scrolls
    // the same way and was already snapping, so this matches.
    expect(scrollBySpy).toHaveBeenCalledWith(0, 70)
    editor.destroy()
  })

  it("scrolls after a keyboard-driven document update when the state selection is within 120px of the bottom", () => {
    const editor = makeEditor("<p></p>")
    vi.spyOn(editor.view, "coordsAtPos").mockReturnValue({
      top: 730,
      bottom: 750,
      left: 0,
      right: 0,
    })

    editor.view.dispatch(editor.state.tr.insertText("x").scrollIntoView())

    expect(scrollBySpy).toHaveBeenCalledTimes(1)
    expect(scrollBySpy).toHaveBeenCalledWith(0, 70)
    editor.destroy()
  })

  // jsdom's collapsed Range geometry differs from real Chromium/WebKit;
  // this test exercises the code path. The Playwright spec
  // the e2e suite (`empty caret block scrolls`)
  // is the authoritative real-DOM regression.
  it("falls back to ProseMirror coords when an empty caret range has a zero rect", () => {
    const editor = makeEditor("<p></p>")
    const posAtDOMSpy = vi.spyOn(editor.view, "posAtDOM").mockReturnValue(1)
    const coordsAtPosSpy = vi.spyOn(editor.view, "coordsAtPos").mockReturnValue({
      top: 730,
      bottom: 750,
      left: 0,
      right: 0,
    })
    // Empty textblock DOM selections can report a collapsed range at 0,0
    // even though ProseMirror knows the caret's visible coordinates.
    mockSelection({
      isCollapsed: true,
      rangeCount: 1,
      startContainer: editor.view.dom,
      startOffset: 0,
      rectBottom: 0,
    })

    dispatchMouseup(editor)

    expect(posAtDOMSpy).toHaveBeenCalledWith(editor.view.dom, 0)
    expect(coordsAtPosSpy).toHaveBeenCalledWith(1)
    expect(scrollBySpy).toHaveBeenCalledTimes(1)
    expect(scrollBySpy).toHaveBeenCalledWith(0, 70)
    editor.destroy()
  })

  // Regression: when an ancestor has its own scroll, window doesn't.
  // Mirrors the Zyler shape (.editor-workspace { overflow: auto }) — the
  // editor's nearest scroll owner is that panel, not window. CaretComfort
  // must target it via nearestScrollOwner / scrollViewport (used elsewhere
  // in the codebase, see block-selection/{drag-extend,marquee}.ts), not
  // window.scrollBy directly.
  it("scrolls the nearest scroll owner, not window, when an inner overflow:auto ancestor exists", () => {
    const scrollOwner = document.createElement("div")
    // jsdom doesn't expand the `overflow` shorthand into `overflowY` on
    // getComputedStyle, so set the longhand directly — matches the value
    // a real browser exposes after expanding `overflow: auto`, which is
    // what nearestScrollOwner reads.
    scrollOwner.style.cssText = "overflow-y: auto; height: 400px"
    document.body.appendChild(scrollOwner)
    // Move the editor mount into the scroll owner before makeEditor()
    // so view.dom's ancestor chain includes it.
    scrollOwner.appendChild(container)

    vi.spyOn(scrollOwner, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 400,
      left: 0,
      right: 800,
      width: 800,
      height: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect)

    const editor = makeEditor()
    // Caret inside the owner box, 20px from its visible bottom (380 of 400)
    // — comfortable against the window (innerHeight=800, ~420px of slack) but
    // riding the owner's edge. The buggy code reads window.innerHeight, sees
    // it as comfortable, and does nothing — leaving the user with no room
    // below the caret. After the fix, the scroll owner's bottom is the
    // reference and it scrolls the owner instead. (Kept within the owner's
    // visible region so the geometry is a real click position — a caret
    // below the owner's fold would be stale and is now correctly ignored,
    // see the off-screen regression above.)
    mockSelection({
      isCollapsed: true,
      rangeCount: 1,
      startContainer: editor.view.dom,
      rectBottom: 380,
    })

    dispatchMouseup(editor)

    expect(scrollBySpy).not.toHaveBeenCalled()
    expect(scrollOwner.scrollTop).toBeGreaterThan(0)

    editor.destroy()
    scrollOwner.remove()
  })

  // Regression: when the scroll owner extends *past* the visible viewport
  // (e.g. a tall editor panel inside a shorter window), comparing the
  // caret only against the owner's bottom misreads "comfortable" — the
  // popover that opens below the caret still clips at the window edge,
  // not the panel edge. The reference must be the effective visible
  // bottom: min(window.innerHeight, ownerRect.bottom).
  it("uses the visible viewport bottom (not owner.bottom) when the scroll owner extends past the window", () => {
    const scrollOwner = document.createElement("div")
    scrollOwner.style.cssText = "overflow-y: auto; height: 1200px"
    document.body.appendChild(scrollOwner)
    scrollOwner.appendChild(container)

    // Owner extends to y=1200 — well past the 800px window.
    vi.spyOn(scrollOwner, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 1200,
      left: 0,
      right: 800,
      width: 800,
      height: 1200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect)

    const editor = makeEditor()
    // Caret at y=750 — only 50px from the visible window bottom (800),
    // but 450px from the owner's bottom (1200). Reading owner.bottom
    // says "comfortable, no scroll needed" — but the slash menu opening
    // below the caret will be clipped at the 800px window edge.
    mockSelection({
      isCollapsed: true,
      rangeCount: 1,
      startContainer: editor.view.dom,
      rectBottom: 750,
    })

    dispatchMouseup(editor)

    // Visible bottom = min(800, 1200) = 800; deficit = 120 - (800-750) = 70.
    expect(scrollOwner.scrollTop).toBe(70)

    editor.destroy()
    scrollOwner.remove()
  })
})
