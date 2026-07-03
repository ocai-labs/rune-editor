// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Regression for finding #1: the cross-surface contentWidth rescale must measure
// the destination width against the surface the run ACTUALLY lands on. When a
// drag empties the source column of a 2-column layout, the layout UNWRAPS and
// the moved run lands at ROOT — not the (dissolved) destination column. Reading
// the dest width off the column would size media for a half-width column while
// it renders at full root width.

import { describe, it, expect } from "vitest"
import type { Node as PMNode } from "@tiptap/pm/model"
import type { Transaction } from "@tiptap/pm/state"
import { createTestEditor } from "../../test-utils/createTestEditor"
import { executeReorder } from "./reorder"
import type { EmptiedSourceColumn } from "./reorder"
import { resolveEmptiedSourceColumnForMove } from "../../api/commands/moveBlocks"
import { rescaleMovedContentWidths } from "./contentWidthRescale"
import {
  buildCrossSurfaceRescale,
  landingSurfaceForRescale,
  surfaceContainerPx,
  surfaceElementPx,
} from "./gesture"
import type { DropTarget } from "./types"

function posOf(doc: PMNode, id: string): { pos: number; size: number } {
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

function columnPos(doc: PMNode, id: string): number {
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

function imageContentWidth(doc: PMNode, id: string): number | null | undefined {
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

// jsdom never lays out, so `clientWidth` is 0 everywhere; stub it on the
// element under measurement to simulate a laid-out surface.
function mockClientWidth(el: HTMLElement, value: number) {
  Object.defineProperty(el, "clientWidth", { value, configurable: true })
}

// 2-col layout: col A holds ONLY a resized image (moving it empties A); col B
// holds a paragraph. Equal column widths (400px each), root 800px.
function build2ColMediaInA() {
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
                  type: "image",
                  attrs: {
                    id: "img",
                    src: "https://e/a.png",
                    alt: "A",
                    contentWidth: 50,
                  },
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

describe("landingSurfaceForRescale", () => {
  const emptied = (remainingColumnCount: number): EmptiedSourceColumn =>
    ({ remainingColumnCount }) as unknown as EmptiedSourceColumn

  it("is the destination surface for a plain cross-surface move (no emptied column)", () => {
    expect(landingSurfaceForRescale(7, null)).toBe(7)
    expect(landingSurfaceForRescale(-1, null)).toBe(-1)
  })

  it("is the destination surface when the emptied column deletes but the layout survives (>=2 remain)", () => {
    expect(landingSurfaceForRescale(7, emptied(2))).toBe(7)
    expect(landingSurfaceForRescale(7, emptied(3))).toBe(7)
  })

  it("is ROOT (-1) when the emptied column unwraps the layout (<2 remain)", () => {
    expect(landingSurfaceForRescale(7, emptied(1))).toBe(-1)
    expect(landingSurfaceForRescale(7, emptied(0))).toBe(-1)
  })
})

describe("buildCrossSurfaceRescale — F2 unwrap-into-survivor", () => {
  it("measures the destination against ROOT and preserves the media's pixel width", () => {
    const editor = build2ColMediaInA()
    const doc0 = editor.state.doc
    const { pos: imgPos, size: imgSize } = posOf(doc0, "img")
    const colApos = columnPos(doc0, "cA")
    const colBpos = columnPos(doc0, "cB")

    const imgDom = editor.view.nodeDOM(imgPos) as HTMLElement
    const colBDom = editor.view.nodeDOM(colBpos) as HTMLElement
    mockClientWidth(imgDom, 400) // source block (col A) width
    mockClientWidth(colBDom, 400) // dest column width (equal → trips old guard)
    mockClientWidth(editor.view.dom, 800) // true landing (root) width

    const emptied = resolveEmptiedSourceColumnForMove(doc0, colApos, colBpos, 1)
    expect(emptied?.remainingColumnCount).toBe(1) // <2 → unwrap to root

    const onMoved = buildCrossSurfaceRescale(
      editor.view,
      { from: imgPos, to: imgPos + imgSize },
      colApos, // sourceSurfacePos
      colBpos, // currentSurfacePos (the dropped-on column)
      emptied,
    )
    // Old behavior measured dest against col B (== src 400) → guard skipped the
    // rescale. Measuring against root (800 ≠ 400) builds the hook.
    expect(onMoved).toBeTypeOf("function")

    const target: DropTarget = {
      insertPos: colBpos + 1, // interior to surviving column B
      indicatorLeft: 0,
      edgeY: 0,
    }
    const tr = executeReorder(
      editor.view.state,
      { from: imgPos, to: imgPos + imgSize, selectionMode: "text" },
      target,
      {
        destSurfacePos: colBpos,
        emptiedSourceColumn: emptied,
        forceTextCaret: true,
        onMoved,
      },
    )
    expect(tr).not.toBeNull()
    editor.view.dispatch(tr!)

    // Layout dissolved: image is now a ROOT child…
    const root0 = editor.state.doc.child(0)
    expect(root0.type.name).toBe("image")
    expect(root0.attrs.id).toBe("img")
    // …and its width was rescaled 50% × 400/800 = 25% so the pixel width
    // (200px) is preserved on the 800px root instead of doubling to 400px.
    expect(imageContentWidth(editor.state.doc, "img")).toBe(25)
  })

  it("documents the pre-fix bug: measuring dest against the destination column leaves the width wrong", () => {
    const editor = build2ColMediaInA()
    const doc0 = editor.state.doc
    const { pos: imgPos, size: imgSize } = posOf(doc0, "img")
    const colApos = columnPos(doc0, "cA")
    const colBpos = columnPos(doc0, "cB")

    const imgDom = editor.view.nodeDOM(imgPos) as HTMLElement
    const colBDom = editor.view.nodeDOM(colBpos) as HTMLElement
    mockClientWidth(imgDom, 400)
    mockClientWidth(colBDom, 400)
    mockClientWidth(editor.view.dom, 800)

    const emptied = resolveEmptiedSourceColumnForMove(doc0, colApos, colBpos, 1)

    // The OLD gesture measured destPx against currentSurfacePos (col B).
    const srcPx = surfaceContainerPx(editor.view, imgPos)!
    const oldDestPx = surfaceElementPx(editor.view, colBpos)!
    expect(srcPx).toBe(400)
    expect(oldDestPx).toBe(400) // equal → guard suppresses the rescale
    const movedRangeSize = imgSize
    const oldOnMoved =
      srcPx !== oldDestPx
        ? (tr: Transaction, result: { insertPos: number }) =>
            rescaleMovedContentWidths(tr, result.insertPos, movedRangeSize, srcPx, oldDestPx)
        : undefined
    expect(oldOnMoved).toBeUndefined()

    const target: DropTarget = { insertPos: colBpos + 1, indicatorLeft: 0, edgeY: 0 }
    const tr = executeReorder(
      editor.view.state,
      { from: imgPos, to: imgPos + imgSize, selectionMode: "text" },
      target,
      { destSurfacePos: colBpos, emptiedSourceColumn: emptied, forceTextCaret: true, onMoved: oldOnMoved },
    )!
    editor.view.dispatch(tr)

    // Image at root but width UNCHANGED at 50% → renders at 400px, double the
    // original 200px. This is the defect the fix corrects.
    expect(editor.state.doc.child(0).attrs.id).toBe("img")
    expect(imageContentWidth(editor.state.doc, "img")).toBe(50)
  })

  it("returns undefined for a same-surface move (frozen root→root contract)", () => {
    const editor = build2ColMediaInA()
    const { pos: imgPos, size: imgSize } = posOf(editor.state.doc, "img")
    mockClientWidth(editor.view.nodeDOM(imgPos) as HTMLElement, 400)
    const onMoved = buildCrossSurfaceRescale(
      editor.view,
      { from: imgPos, to: imgPos + imgSize },
      -1, // sourceSurfacePos
      -1, // currentSurfacePos (same)
      null,
    )
    expect(onMoved).toBeUndefined()
  })
})
