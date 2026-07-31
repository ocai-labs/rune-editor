// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { afterEach, describe, expect, it, vi } from "vitest"
import { getDocument } from "../../api"
import { createTestEditor } from "../../test-utils/createTestEditor"
import { gestureKey } from "../shared/gesture-state"
import { availableContentWidth, widthPercentFromPixels } from "./geometry"

function rect(width: number): DOMRect {
  return {
    x: 0,
    y: 0,
    top: 0,
    right: width,
    bottom: 100,
    left: 0,
    width,
    height: 100,
    toJSON: () => ({}),
  } as DOMRect
}

function stubBlockSizing(
  block: HTMLElement,
  frame: HTMLElement,
  blockWidth = 500,
  frameWidth = 500,
) {
  Object.defineProperty(block, "clientWidth", {
    configurable: true,
    value: blockWidth,
  })
  block.getBoundingClientRect = () => rect(blockWidth)
  frame.getBoundingClientRect = () => rect(frameWidth)
  vi.spyOn(window, "getComputedStyle").mockImplementation((el) => {
    if (el === block) {
      return {
        paddingInlineStart: "0px",
        paddingInlineEnd: "0px",
        paddingLeft: "0px",
        paddingRight: "0px",
      } as CSSStyleDeclaration
    }
    return {
      paddingInlineStart: "0px",
      paddingInlineEnd: "0px",
      paddingLeft: "0px",
      paddingRight: "0px",
    } as CSSStyleDeclaration
  })
}

function dispatchMouse(
  target: EventTarget,
  type: string,
  clientX: number,
  init?: MouseEventInit,
) {
  target.dispatchEvent(
    new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      // Primary button held — what a real in-flight drag reports. The
      // gesture's lost-mouseup defense cancels on (buttons & 1) === 0 moves.
      buttons: 1,
      clientX,
      clientY: 20,
      ...init,
    }),
  )
}

function createResizeTestEditor(
  opts?: Parameters<typeof createTestEditor>[0],
) {
  const editor = createTestEditor(opts)
  document.body.appendChild(editor.view.dom)
  return editor
}

describe("BlockResize", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.replaceChildren()
  })

  it("computes available content width by subtracting block inline padding", () => {
    const block = document.createElement("div")
    Object.defineProperty(block, "clientWidth", {
      configurable: true,
      value: 640,
    })
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      paddingInlineStart: "40px",
      paddingInlineEnd: "12px",
      paddingLeft: "40px",
      paddingRight: "12px",
    } as CSSStyleDeclaration)

    expect(availableContentWidth(block)).toBe(588)
    expect(widthPercentFromPixels(294, 588)).toBe(50)
  })

  it("commits one contentWidth attr on right-edge resize mouseup", () => {
    const editor = createResizeTestEditor({
      content: {
        type: "doc",
        content: [
          {
            type: "image",
            attrs: {
              id: "img-resize",
              src: "https://example.com/a.png",
              alt: "A",
            },
          },
        ],
      } as never,
    })
    const block = editor.view.dom.querySelector<HTMLElement>(
      '.rune-block[data-id="img-resize"]',
    )!
    const frame = block.querySelector<HTMLElement>(":scope > .rune-block-content")!
    const handle = block.querySelector<HTMLElement>(".rune-resize-handle--end")!
    stubBlockSizing(block, frame, 500, 500)

    dispatchMouse(handle, "mousedown", 500)
    expect(gestureKey.getState(editor.state)?.activeGesture).toBe("resize")

    dispatchMouse(document, "mousemove", 300)
    expect(frame.style.width).toBe("60%")

    dispatchMouse(document, "mouseup", 300)

    expect(getDocument(editor)[0]).toMatchObject({
      type: "image",
      id: "img-resize",
      contentWidth: 60,
    })
    expect(gestureKey.getState(editor.state)?.activeGesture).toBeNull()
  })

  it("ignores a non-primary mouseup mid-resize (right release must not commit)", () => {
    const editor = createResizeTestEditor({
      content: {
        type: "doc",
        content: [
          {
            type: "image",
            attrs: {
              id: "img-rightup",
              src: "https://example.com/a.png",
              alt: "A",
            },
          },
        ],
      } as never,
    })
    const block = editor.view.dom.querySelector<HTMLElement>(
      '.rune-block[data-id="img-rightup"]',
    )!
    const frame = block.querySelector<HTMLElement>(":scope > .rune-block-content")!
    const handle = block.querySelector<HTMLElement>(".rune-resize-handle--end")!
    stubBlockSizing(block, frame, 500, 500)

    dispatchMouse(handle, "mousedown", 500)
    dispatchMouse(document, "mousemove", 300)
    expect(frame.style.width).toBe("60%")

    // Right-button release while the primary is still held — the gesture
    // must stay live and nothing may commit.
    dispatchMouse(document, "mouseup", 300, { button: 2, buttons: 1 })
    expect(gestureKey.getState(editor.state)?.activeGesture).toBe("resize")
    expect(getDocument(editor)[0]).not.toMatchObject({ contentWidth: 60 })

    // The primary release still commits normally.
    dispatchMouse(document, "mouseup", 300, { button: 0, buttons: 0 })
    expect(getDocument(editor)[0]).toMatchObject({
      type: "image",
      id: "img-rightup",
      contentWidth: 60,
    })
    expect(gestureKey.getState(editor.state)?.activeGesture).toBeNull()
  })

  it("reverses delta for the left-edge handle", () => {
    const editor = createResizeTestEditor({
      content: {
        type: "doc",
        content: [
          {
            type: "image",
            attrs: {
              id: "img-left-resize",
              src: "https://example.com/a.png",
              alt: "A",
            },
          },
        ],
      } as never,
    })
    const block = editor.view.dom.querySelector<HTMLElement>(
      '.rune-block[data-id="img-left-resize"]',
    )!
    const frame = block.querySelector<HTMLElement>(":scope > .rune-block-content")!
    const handle = block.querySelector<HTMLElement>(".rune-resize-handle--start")!
    stubBlockSizing(block, frame, 500, 250)

    dispatchMouse(handle, "mousedown", 200)
    dispatchMouse(document, "mousemove", 100)
    dispatchMouse(document, "mouseup", 100)

    expect(getDocument(editor)[0]).toMatchObject({
      type: "image",
      id: "img-left-resize",
      contentWidth: 70,
    })
  })

  it("cancels resize on Escape without committing", () => {
    const editor = createResizeTestEditor({
      content: {
        type: "doc",
        content: [
          {
            type: "video",
            attrs: {
              id: "vid-cancel",
              sourceType: "asset",
              src: "https://cdn.example.com/demo.mp4",
            },
          },
        ],
      } as never,
    })
    const block = editor.view.dom.querySelector<HTMLElement>(
      '.rune-block[data-id="vid-cancel"]',
    )!
    const frame = block.querySelector<HTMLElement>(":scope > .rune-block-content")!
    const handle = block.querySelector<HTMLElement>(".rune-resize-handle--end")!
    stubBlockSizing(block, frame, 500, 500)

    dispatchMouse(handle, "mousedown", 500)
    dispatchMouse(document, "mousemove", 250)
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    )

    const blockAfterCancel = getDocument(editor)[0]!
    expect(blockAfterCancel).toMatchObject({
      type: "video",
      id: "vid-cancel",
    })
    expect(blockAfterCancel).not.toHaveProperty("contentWidth")
    expect(frame.style.width).toBe("")
  })

  it("does not resize while read-only", () => {
    const editor = createResizeTestEditor({
      content: {
        type: "doc",
        content: [
          {
            type: "image",
            attrs: {
              id: "img-readonly",
              src: "https://example.com/a.png",
              alt: "A",
            },
          },
        ],
      } as never,
    })
    const block = editor.view.dom.querySelector<HTMLElement>(
      '.rune-block[data-id="img-readonly"]',
    )!
    const frame = block.querySelector<HTMLElement>(":scope > .rune-block-content")!
    const handle = block.querySelector<HTMLElement>(".rune-resize-handle--end")!
    stubBlockSizing(block, frame, 500, 500)

    editor.setEditable(false)
    dispatchMouse(handle, "mousedown", 500)
    dispatchMouse(document, "mousemove", 250)
    dispatchMouse(document, "mouseup", 250)

    const blockAfterReadOnlyDrag = getDocument(editor)[0]!
    expect(blockAfterReadOnlyDrag).toMatchObject({
      type: "image",
      id: "img-readonly",
    })
    expect(blockAfterReadOnlyDrag).not.toHaveProperty("contentWidth")
  })

  it("keeps resize handle mousedown out of block-drag padding pickup", () => {
    const editor = createResizeTestEditor({
      content: {
        type: "doc",
        content: [
          {
            type: "image",
            attrs: {
              id: "img-coexist",
              src: "https://example.com/a.png",
              alt: "A",
            },
          },
        ],
      } as never,
    })
    const block = editor.view.dom.querySelector<HTMLElement>(
      '.rune-block[data-id="img-coexist"]',
    )!
    const frame = block.querySelector<HTMLElement>(":scope > .rune-block-content")!
    const handle = block.querySelector<HTMLElement>(".rune-resize-handle--end")!
    stubBlockSizing(block, frame, 500, 500)

    dispatchMouse(handle, "mousedown", 500)
    dispatchMouse(document, "mousemove", 450)
    dispatchMouse(document, "mouseup", 450)

    expect(getDocument(editor)[0]).toMatchObject({
      id: "img-coexist",
      contentWidth: 90,
    })
  })

  it("ignores non-primary-button mousedown on a resize handle", () => {
    const editor = createResizeTestEditor({
      content: {
        type: "doc",
        content: [
          {
            type: "image",
            attrs: {
              id: "img-right-button",
              src: "https://example.com/a.png",
              alt: "A",
            },
          },
        ],
      } as never,
    })
    const block = editor.view.dom.querySelector<HTMLElement>(
      '.rune-block[data-id="img-right-button"]',
    )!
    const frame = block.querySelector<HTMLElement>(":scope > .rune-block-content")!
    const handle = block.querySelector<HTMLElement>(".rune-resize-handle--end")!
    stubBlockSizing(block, frame, 500, 500)

    // A non-primary press now propagates past the resize handler into PM's
    // own mousedown handler, which calls posAtCoords → elementFromPoint —
    // missing in jsdom. Stub it; null makes PM bail (coords outside the
    // zero-rect view) exactly like a click outside the editor.
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: () => null,
    })

    const rightDown = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      button: 2,
      buttons: 2,
      clientX: 500,
      clientY: 20,
    })
    handle.dispatchEvent(rightDown)

    // No gesture claim, native behavior preserved (no preventDefault).
    expect(gestureKey.getState(editor.state)?.activeGesture ?? null).toBeNull()
    expect(rightDown.defaultPrevented).toBe(false)

    // Subsequent moves/up must not resize or commit.
    dispatchMouse(document, "mousemove", 300)
    dispatchMouse(document, "mouseup", 300)
    expect(frame.style.width).toBe("")
    expect(getDocument(editor)[0]).not.toHaveProperty("contentWidth")

    delete (document as { elementFromPoint?: unknown }).elementFromPoint
  })

  it("cancels resize on window blur without committing", () => {
    const editor = createResizeTestEditor({
      content: {
        type: "doc",
        content: [
          {
            type: "image",
            attrs: {
              id: "img-blur",
              src: "https://example.com/a.png",
              alt: "A",
            },
          },
        ],
      } as never,
    })
    const block = editor.view.dom.querySelector<HTMLElement>(
      '.rune-block[data-id="img-blur"]',
    )!
    const frame = block.querySelector<HTMLElement>(":scope > .rune-block-content")!
    const handle = block.querySelector<HTMLElement>(".rune-resize-handle--end")!
    stubBlockSizing(block, frame, 500, 500)

    dispatchMouse(handle, "mousedown", 500)
    dispatchMouse(document, "mousemove", 400)
    expect(frame.style.width).toBe("80%")

    window.dispatchEvent(new Event("blur"))

    expect(frame.style.width).toBe("")
    expect(gestureKey.getState(editor.state)?.activeGesture ?? null).toBeNull()
    expect(getDocument(editor)[0]).not.toHaveProperty("contentWidth")

    // A post-blur stray move (mouseup was eaten by the focus shift) must not
    // resurrect the gesture or resize anything.
    dispatchMouse(document, "mousemove", 300, { buttons: 0 })
    expect(frame.style.width).toBe("")
  })

  it("cancels resize when a mousemove reports the primary button released", () => {
    const editor = createResizeTestEditor({
      content: {
        type: "doc",
        content: [
          {
            type: "image",
            attrs: {
              id: "img-lost-up",
              src: "https://example.com/a.png",
              alt: "A",
            },
          },
        ],
      } as never,
    })
    const block = editor.view.dom.querySelector<HTMLElement>(
      '.rune-block[data-id="img-lost-up"]',
    )!
    const frame = block.querySelector<HTMLElement>(":scope > .rune-block-content")!
    const handle = block.querySelector<HTMLElement>(".rune-resize-handle--end")!
    stubBlockSizing(block, frame, 500, 500)

    dispatchMouse(handle, "mousedown", 500)
    dispatchMouse(document, "mousemove", 450)
    expect(frame.style.width).toBe("90%")

    // Lost mouseup: the next move arrives with no buttons pressed.
    dispatchMouse(document, "mousemove", 300, { buttons: 0 })

    expect(frame.style.width).toBe("")
    expect(gestureKey.getState(editor.state)?.activeGesture ?? null).toBeNull()
    expect(getDocument(editor)[0]).not.toHaveProperty("contentWidth")
  })
})
