// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, it, expect } from "vitest"
import { createTestEditor } from "../../test-utils/createTestEditor"
import {
  MAX_CONTENT_WIDTH,
  MIN_CONTENT_WIDTH,
} from "../../blocks/media/contentWidth"
import {
  rescaleContentWidthPct,
  rescaleMovedContentWidths,
} from "./contentWidthRescale"
import { surfaceElementPx } from "./gesture"

describe("rescaleContentWidthPct", () => {
  it("is the identity when srcPx === destPx", () => {
    expect(rescaleContentWidthPct(50, 600, 600)).toBe(50)
    expect(rescaleContentWidthPct(37, 812, 812)).toBe(37)
  })

  it("shrinks the % when the destination surface is narrower (same pixels)", () => {
    // 50% of 600px = 300px; on a 300px surface that is 100%.
    expect(rescaleContentWidthPct(50, 600, 300)).toBe(100)
    // 40% of 600px = 240px; on a 480px surface that is 50%.
    expect(rescaleContentWidthPct(40, 600, 480)).toBe(50)
  })

  it("grows the % when the destination surface is wider (same pixels)", () => {
    // 100% of 300px = 300px; on a 600px surface that is 50%.
    expect(rescaleContentWidthPct(100, 300, 600)).toBe(50)
  })

  it("rounds to the nearest integer percent", () => {
    // 33% of 500px = 165px; on 700px = 23.57% → 24.
    expect(rescaleContentWidthPct(33, 500, 700)).toBe(24)
    // 45% of 610px = 274.5px; on 500px = 54.9% → 55.
    expect(rescaleContentWidthPct(45, 610, 500)).toBe(55)
  })

  it("clamps up to MIN_CONTENT_WIDTH when the pixel share is tiny on the dest", () => {
    // 10% of 300px = 30px; on 900px = 3.33% → below MIN, clamp to 10.
    expect(rescaleContentWidthPct(10, 300, 900)).toBe(MIN_CONTENT_WIDTH)
  })

  it("clamps down to MAX_CONTENT_WIDTH when the pixels overflow the dest", () => {
    // 80% of 900px = 720px; on 300px = 240% → above MAX, clamp to 100.
    expect(rescaleContentWidthPct(80, 900, 300)).toBe(MAX_CONTENT_WIDTH)
  })

  it("returns the clamped original for unmeasurable widths (defense in depth)", () => {
    expect(rescaleContentWidthPct(50, 0, 600)).toBe(50)
    expect(rescaleContentWidthPct(50, 600, 0)).toBe(50)
    expect(rescaleContentWidthPct(50, Number.NaN, 600)).toBe(50)
    expect(rescaleContentWidthPct(50, 600, Number.NaN)).toBe(50)
  })
})

describe("rescaleMovedContentWidths", () => {
  function imageContentWidth(
    doc: import("@tiptap/pm/model").Node,
    id: string,
  ): number | null | undefined {
    let cw: number | null | undefined
    doc.descendants((node) => {
      if (node.type.name === "image" && node.attrs.id === id) {
        cw = node.attrs.contentWidth as number | null
        return false
      }
      return true
    })
    return cw
  }

  function posOf(
    doc: import("@tiptap/pm/model").Node,
    id: string,
  ): { pos: number; size: number } {
    let out = { pos: -1, size: 0 }
    doc.descendants((node, pos) => {
      if (node.attrs?.id === id) {
        out = { pos, size: node.nodeSize }
        return false
      }
      return true
    })
    return out
  }

  it("rescales a media block that now lives INSIDE a column (insertPos interior to it)", () => {
    // Regression: `nodesBetween(insertPos, sliceEnd)` visits the ancestor
    // columnLayout/column FIRST, whose own pos is < insertPos. A bare
    // `nodePos < insertPos → false` guard returned false there and cut off
    // descent, so a block dropped inside a column was never reached and never
    // rescaled. The walk must descend THROUGH those ancestors.
    const editor = createTestEditor({
      content: {
        type: "doc",
        content: [
          {
            type: "columnLayout",
            attrs: { id: "cl", depth: 0 },
            content: [
              {
                type: "column",
                attrs: { id: "cL", width: 1 },
                content: [
                  {
                    type: "image",
                    attrs: {
                      id: "img-col",
                      src: "https://e/a.png",
                      alt: "A",
                      contentWidth: 50,
                    },
                  },
                ],
              },
              {
                type: "column",
                attrs: { id: "cR", width: 1 },
                content: [
                  {
                    type: "paragraph",
                    attrs: { id: "R0" },
                    content: [{ type: "text", text: "right" }],
                  },
                ],
              },
            ],
          },
        ],
      },
    })
    const { pos: imgPos, size: imgSize } = posOf(editor.state.doc, "img-col")
    expect(imgPos).toBeGreaterThan(0)
    const tr = editor.state.tr
    // srcPx=600, destPx=400 → 50% of 600px = 300px = 75% of 400px (mid-range,
    // proves an actual rescale rather than a clamp).
    rescaleMovedContentWidths(tr, imgPos, imgSize, 600, 400)
    expect(imageContentWidth(tr.doc, "img-col")).toBe(75)
  })

  it("rescales a top-level (root) moved media block", () => {
    const editor = createTestEditor({
      content: {
        type: "doc",
        content: [
          {
            type: "image",
            attrs: { id: "img-root", src: "https://e/a.png", alt: "A", contentWidth: 50 },
          },
        ],
      },
    })
    const { pos, size } = posOf(editor.state.doc, "img-root")
    const tr = editor.state.tr
    rescaleMovedContentWidths(tr, pos, size, 600, 300)
    expect(imageContentWidth(tr.doc, "img-root")).toBe(100)
  })

  it("leaves a media block OUTSIDE the moved span untouched", () => {
    const editor = createTestEditor({
      content: {
        type: "doc",
        content: [
          {
            type: "image",
            attrs: { id: "img-a", src: "https://e/a.png", alt: "A", contentWidth: 50 },
          },
          {
            type: "image",
            attrs: { id: "img-b", src: "https://e/b.png", alt: "B", contentWidth: 50 },
          },
        ],
      },
    })
    const a = posOf(editor.state.doc, "img-a")
    const tr = editor.state.tr
    // Span covers only img-a.
    rescaleMovedContentWidths(tr, a.pos, a.size, 600, 300)
    expect(imageContentWidth(tr.doc, "img-a")).toBe(100)
    expect(imageContentWidth(tr.doc, "img-b")).toBe(50)
  })
})

describe("surfaceElementPx (Task G destination measurement)", () => {
  // Measures the destination surface's OWN element so an EMPTY column still
  // measures — the resident-block basis (`snapshot.blocks[0]`) silently
  // skipped the rescale when the destination column had no blocks.
  function columnEditor() {
    return createTestEditor({
      content: {
        type: "doc",
        content: [
          {
            type: "columnLayout",
            attrs: { id: "cl", depth: 0 },
            content: [
              {
                type: "column",
                attrs: { id: "cA", width: 1 },
                content: [
                  {
                    type: "paragraph",
                    attrs: { id: "A0" },
                    content: [{ type: "text", text: "left" }],
                  },
                ],
              },
              {
                type: "column",
                attrs: { id: "cB", width: 1 },
                content: [
                  {
                    type: "paragraph",
                    attrs: { id: "B0" },
                    content: [{ type: "text", text: "right" }],
                  },
                ],
              },
            ],
          },
        ],
      },
    })
  }

  function columnPos(doc: import("@tiptap/pm/model").Node, id: string): number {
    let out = -1
    doc.descendants((node, pos) => {
      if (node.type.name === "column" && node.attrs.id === id) {
        out = pos
        return false
      }
      return true
    })
    return out
  }

  // jsdom never lays out, so `clientWidth` is 0 everywhere; stub it on the
  // one element under measurement to simulate a laid-out surface.
  function mockClientWidth(el: HTMLElement, value: number) {
    Object.defineProperty(el, "clientWidth", { value, configurable: true })
  }

  it("measures a column surface via its own element", () => {
    const editor = columnEditor()
    const colPos = columnPos(editor.state.doc, "cA")
    expect(colPos).toBeGreaterThan(-1)
    const colDom = editor.view.nodeDOM(colPos) as HTMLElement
    mockClientWidth(colDom, 400)
    expect(surfaceElementPx(editor.view, colPos)).toBe(400)
  })

  it("measures the root surface via the editor content element", () => {
    const editor = columnEditor()
    mockClientWidth(editor.view.dom, 800)
    expect(surfaceElementPx(editor.view, -1)).toBe(800)
  })

  it("returns null for an unlaid-out surface (degenerate width)", () => {
    const editor = columnEditor()
    const colPos = columnPos(editor.state.doc, "cA")
    expect(surfaceElementPx(editor.view, colPos)).toBe(null)
  })
})
