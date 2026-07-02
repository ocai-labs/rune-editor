// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Editor } from "@tiptap/core"
import Document from "@tiptap/extension-document"
import Text from "@tiptap/extension-text"
import { createBlockSpec } from "../../schema"
import { createTestEditor } from "../../test-utils/createTestEditor"
import { MultiBlockSelection } from "../block-selection/MultiBlockSelection"
import { executeReorder, executeDepthOnlyChange, executeMoveSlice } from "./reorder"
import { rescaleMovedContentWidths } from "./contentWidthRescale"

const Para = createBlockSpec({
  type: "paragraph",
  content: "inline*",
  parseDOM: [{ tag: "p" }],
  renderDOM: ({ HTMLAttributes }) => ["p", HTMLAttributes, 0],
})

let container: HTMLDivElement

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
})

afterEach(() => {
  container.remove()
})

function mk(content: string) {
  return new Editor({ element: container, extensions: [Document, Text, Para], content })
}

describe("executeReorder", () => {
  it("moves second paragraph before first (single-block, text mode)", () => {
    const editor = mk("<p>A</p><p>B</p>")
    const sourcePos = editor.state.doc.child(0).nodeSize
    const sourceSize = editor.state.doc.child(1).nodeSize
    const tr = executeReorder(
      editor.state,
      { from: sourcePos, to: sourcePos + sourceSize, selectionMode: "text" },
      { insertPos: 0, indicatorLeft: 0, edgeY: 0 },
    )!
    editor.view.dispatch(tr)
    expect(editor.state.doc.child(0).textContent).toBe("B")
    expect(editor.state.doc.child(1).textContent).toBe("A")
    expect(editor.state.selection.constructor.name).toBe("TextSelection")
    editor.destroy()
  })

  it("moves first paragraph to end (single-block, text mode)", () => {
    const editor = mk("<p>A</p><p>B</p><p>C</p>")
    const size = editor.state.doc.child(0).nodeSize
    const tr = executeReorder(
      editor.state,
      { from: 0, to: size, selectionMode: "text" },
      { insertPos: editor.state.doc.content.size, indicatorLeft: 0, edgeY: 0 },
    )!
    editor.view.dispatch(tr)
    expect(editor.state.doc.child(0).textContent).toBe("B")
    expect(editor.state.doc.child(1).textContent).toBe("C")
    expect(editor.state.doc.child(2).textContent).toBe("A")
    editor.destroy()
  })

  it("returns null when insertPos === source.from (drop-on-self start)", () => {
    const editor = mk("<p>A</p><p>B</p>")
    const size = editor.state.doc.child(0).nodeSize
    const tr = executeReorder(
      editor.state,
      { from: 0, to: size, selectionMode: "text" },
      { insertPos: 0, indicatorLeft: 0, edgeY: 0 },
    )
    expect(tr).toBeNull()
    editor.destroy()
  })

  it("returns null when insertPos === source.to (drop-on-self end)", () => {
    const editor = mk("<p>A</p><p>B</p>")
    const size = editor.state.doc.child(0).nodeSize
    const tr = executeReorder(
      editor.state,
      { from: 0, to: size, selectionMode: "text" },
      { insertPos: size, indicatorLeft: 0, edgeY: 0 },
    )
    expect(tr).toBeNull()
    editor.destroy()
  })

  it("moves a 2-block range (mbs mode); selection becomes MultiBlockSelection", async () => {
    const { MultiBlockSelection } = await import("../block-selection/MultiBlockSelection")
    const editor = mk("<p>A</p><p>B</p><p>C</p><p>D</p>")
    // Move blocks B+C (indices 1,2) below D (index 3).
    const fromPos = editor.state.doc.child(0).nodeSize
    const toPos = fromPos + editor.state.doc.child(1).nodeSize + editor.state.doc.child(2).nodeSize
    const insertPos = editor.state.doc.content.size
    const tr = executeReorder(
      editor.state,
      { from: fromPos, to: toPos, selectionMode: "mbs" },
      { insertPos, indicatorLeft: 0, edgeY: 0 },
    )!
    editor.view.dispatch(tr)
    expect(editor.state.doc.child(0).textContent).toBe("A")
    expect(editor.state.doc.child(1).textContent).toBe("D")
    expect(editor.state.doc.child(2).textContent).toBe("B")
    expect(editor.state.doc.child(3).textContent).toBe("C")
    expect(editor.state.selection).toBeInstanceOf(MultiBlockSelection)
    expect((editor.state.selection as InstanceType<typeof MultiBlockSelection>).blockIndices).toEqual([2, 3])
    editor.destroy()
  })

  it("moves a 3-block range to doc start (mbs mode)", async () => {
    const { MultiBlockSelection } = await import("../block-selection/MultiBlockSelection")
    const editor = mk("<p>A</p><p>B</p><p>C</p><p>D</p><p>E</p>")
    // Move C+D+E (indices 2..4) to start.
    const child0 = editor.state.doc.child(0).nodeSize
    const child1 = editor.state.doc.child(1).nodeSize
    const fromPos = child0 + child1
    const toPos = editor.state.doc.content.size
    const tr = executeReorder(
      editor.state,
      { from: fromPos, to: toPos, selectionMode: "mbs" },
      { insertPos: 0, indicatorLeft: 0, edgeY: 0 },
    )!
    editor.view.dispatch(tr)
    expect(editor.state.doc.child(0).textContent).toBe("C")
    expect(editor.state.doc.child(1).textContent).toBe("D")
    expect(editor.state.doc.child(2).textContent).toBe("E")
    expect(editor.state.doc.child(3).textContent).toBe("A")
    expect(editor.state.doc.child(4).textContent).toBe("B")
    expect(editor.state.selection).toBeInstanceOf(MultiBlockSelection)
    expect((editor.state.selection as InstanceType<typeof MultiBlockSelection>).blockIndices).toEqual([0, 2])
    editor.destroy()
  })

  it("MBS-of-1 round-trip: selection stays MultiBlockSelection of size 1", async () => {
    const { MultiBlockSelection } = await import("../block-selection/MultiBlockSelection")
    const editor = mk("<p>A</p><p>B</p><p>C</p>")
    const fromPos = editor.state.doc.child(0).nodeSize
    const toPos = fromPos + editor.state.doc.child(1).nodeSize
    const tr = executeReorder(
      editor.state,
      { from: fromPos, to: toPos, selectionMode: "mbs" },
      { insertPos: editor.state.doc.content.size, indicatorLeft: 0, edgeY: 0 },
    )!
    editor.view.dispatch(tr)
    expect(editor.state.doc.child(2).textContent).toBe("B")
    expect(editor.state.selection).toBeInstanceOf(MultiBlockSelection)
    expect((editor.state.selection as InstanceType<typeof MultiBlockSelection>).blockIndices).toEqual([2, 2])
    editor.destroy()
  })

  it("applies newDepthAttr when selectionMode === 'text'", () => {
    const editor = mk("<p>A</p><p>B</p>")
    const sourceSize = editor.state.doc.child(0).nodeSize
    const tr = executeReorder(
      editor.state,
      { from: 0, to: sourceSize, selectionMode: "text" },
      { insertPos: editor.state.doc.content.size, indicatorLeft: 0, edgeY: 0, newDepthAttr: 2 },
    )!
    editor.view.dispatch(tr)
    expect(editor.state.doc.child(1).textContent).toBe("A")
    expect(editor.state.doc.child(1).attrs.depth).toBe(2)
    editor.destroy()
  })

  it("shifts depth attr of every block in the moved slice by the same delta (text mode)", () => {
    const editor = createTestEditor({
      content: {
        type: "doc",
        content: [
          { type: "numberedList", attrs: { depth: 0 }, content: [{ type: "text", text: "one" }] },
          { type: "numberedList", attrs: { depth: 1 }, content: [{ type: "text", text: "two" }] },
          { type: "numberedList", attrs: { depth: 2 }, content: [{ type: "text", text: "three" }] },
        ],
      },
    })
    const doc = editor.state.doc
    const sourceFrom = doc.firstChild!.nodeSize
    const sourceTo = sourceFrom + doc.child(1).nodeSize + doc.child(2).nodeSize
    const tr = executeReorder(
      editor.state,
      { from: sourceFrom, to: sourceTo, selectionMode: "text" },
      { insertPos: 0, indicatorLeft: 0, edgeY: 0, newDepthAttr: 0 },
    )!
    editor.view.dispatch(tr)
    const after = editor.state.doc
    expect(after.child(0).attrs.depth).toBe(0)
    expect(after.child(1).attrs.depth).toBe(1)
    expect(after.child(2).attrs.depth).toBe(0)
  })

  it("shifts depth attr in mbs mode (regression: previously dormant)", () => {
    const editor = createTestEditor({
      content: {
        type: "doc",
        content: [
          { type: "numberedList", attrs: { depth: 0 }, content: [{ type: "text", text: "one" }] },
          { type: "numberedList", attrs: { depth: 1 }, content: [{ type: "text", text: "two" }] },
          { type: "numberedList", attrs: { depth: 2 }, content: [{ type: "text", text: "three" }] },
        ],
      },
    })
    const doc = editor.state.doc
    const sourceFrom = doc.firstChild!.nodeSize
    const sourceTo = sourceFrom + doc.child(1).nodeSize + doc.child(2).nodeSize
    const tr = executeReorder(
      editor.state,
      { from: sourceFrom, to: sourceTo, selectionMode: "mbs" },
      { insertPos: 0, indicatorLeft: 0, edgeY: 0, newDepthAttr: 0 },
    )!
    editor.view.dispatch(tr)
    const after = editor.state.doc
    expect(after.child(0).attrs.depth).toBe(0)
    expect(after.child(1).attrs.depth).toBe(1)
  })

  it("applies depth delta in mbs mode without relying on list normalization", () => {
    const editor = new Editor({
      element: container,
      extensions: [Document, Text, Para],
      content: {
        type: "doc",
        content: [
          { type: "paragraph", attrs: { depth: 0 }, content: [{ type: "text", text: "one" }] },
          { type: "paragraph", attrs: { depth: 1 }, content: [{ type: "text", text: "two" }] },
          { type: "paragraph", attrs: { depth: 2 }, content: [{ type: "text", text: "three" }] },
        ],
      },
    })
    const doc = editor.state.doc
    const sourceFrom = doc.firstChild!.nodeSize
    const sourceTo = sourceFrom + doc.child(1).nodeSize + doc.child(2).nodeSize
    const tr = executeReorder(
      editor.state,
      { from: sourceFrom, to: sourceTo, selectionMode: "mbs" },
      { insertPos: 0, indicatorLeft: 0, edgeY: 0, newDepthAttr: 0 },
    )!
    editor.view.dispatch(tr)
    const after = editor.state.doc
    expect(after.child(0).attrs.depth).toBe(0)
    expect(after.child(1).attrs.depth).toBe(1)
    expect(after.child(2).attrs.depth).toBe(0)
    editor.destroy()
  })

  it("clamps to depth >= 0 when delta would produce a negative depth", () => {
    // Malformed slice on purpose: a depth-2 first block followed by a depth-0
    // block (couldn't happen via dragSourceRange's "strictly greater" walk,
    // but the executor must defend in case a non-list slice gets a positive
    // newDepthAttr applied — clamp is the defensive guard).
    // Slice = [d=2, d=0], newDepthAttr=0 → delta = -2.
    //   Block 1: 2 + (-2) = 0
    //   Block 2: 0 + (-2) = -2 → clamp to 0
    const editor = createTestEditor({
      content: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "anchor" }] },
          { type: "numberedList", attrs: { depth: 2 }, content: [{ type: "text", text: "deep" }] },
          { type: "numberedList", attrs: { depth: 0 }, content: [{ type: "text", text: "shallow" }] },
        ],
      },
    })
    const doc = editor.state.doc
    const sourceFrom = doc.firstChild!.nodeSize
    const sourceTo = sourceFrom + doc.child(1).nodeSize + doc.child(2).nodeSize
    const tr = executeReorder(
      editor.state,
      { from: sourceFrom, to: sourceTo, selectionMode: "text" },
      { insertPos: 0, indicatorLeft: 0, edgeY: 0, newDepthAttr: 0 },
    )!
    editor.view.dispatch(tr)
    expect(editor.state.doc.child(0).attrs.depth).toBe(0)
    expect(editor.state.doc.child(1).attrs.depth).toBe(0)
  })

  it("non-list block dragged between list items adopts the preceding list's depth", () => {
    // Scenario: user has 1.one(d=0), a.two(d=1), a.three(d=1), plus a tail paragraph.
    // Dragging the paragraph between a.two and a.three should land it at d=1 so
    // the schema emits data-depth="1" + --rune-block-depth=1 → CSS in
    // editor-chrome.css indents it to match the d=1 list visually.
    //
    // This is the "non-list block inside a list context" path the user asked
    // about. The architecture supports it via the universal depth attr on
    // every block (createSpec injects) + the CSS rule that keys off any
    // [data-depth] element (not just lists).
    const editor = createTestEditor({
      content: {
        type: "doc",
        content: [
          { type: "numberedList", attrs: { depth: 0 }, content: [{ type: "text", text: "one" }] },
          { type: "numberedList", attrs: { depth: 1 }, content: [{ type: "text", text: "two" }] },
          { type: "numberedList", attrs: { depth: 1 }, content: [{ type: "text", text: "three" }] },
          { type: "paragraph", content: [{ type: "text", text: "extra" }] },
        ],
      },
    })
    const doc = editor.state.doc
    const paraPos = doc.firstChild!.nodeSize + doc.child(1).nodeSize + doc.child(2).nodeSize
    const para = doc.child(3)
    // Insert between "two" (index 1) and "three" (index 2).
    const insertPos = doc.firstChild!.nodeSize + doc.child(1).nodeSize
    const tr = executeReorder(
      editor.state,
      { from: paraPos, to: paraPos + para.nodeSize, selectionMode: "text" },
      { insertPos, indicatorLeft: 0, edgeY: 0, newDepthAttr: 1 },
    )!
    editor.view.dispatch(tr)
    const after = editor.state.doc
    // After: [one(d=0), two(d=1), paragraph(d=1, "extra"), three(d=1)]
    expect(after.child(2).type.name).toBe("paragraph")
    expect(after.child(2).attrs.depth).toBe(1)
    expect(after.child(2).textContent).toBe("extra")
    // Sanity: the surrounding list blocks were not perturbed.
    expect(after.child(0).attrs.depth).toBe(0)
    expect(after.child(1).attrs.depth).toBe(1)
    expect(after.child(3).attrs.depth).toBe(1)
  })

  it("text mode: restores caret by mapping the original position when moving block down", () => {
    const editor = mk("<p>AAAA</p><p>BBBB</p><p>CCCC</p>")
    // Caret inside block B after the second character.
    const posBeforeB = editor.state.doc.child(0).nodeSize
    const caret = posBeforeB + 1 + 2
    editor.commands.setTextSelection(caret)

    const bSize = editor.state.doc.child(1).nodeSize
    const from = posBeforeB
    const to = from + bSize
    const insertPos = editor.state.doc.content.size

    const tr = executeReorder(
      editor.state,
      {
        from,
        to,
        selectionMode: "text",
        textSelectionRestorePos: caret,
      },
      { insertPos, indicatorLeft: 0, edgeY: 0 },
    )!

    editor.view.dispatch(tr)
    expect(editor.state.doc.child(0).textContent).toBe("AAAA")
    expect(editor.state.doc.child(1).textContent).toBe("CCCC")
    expect(editor.state.doc.child(2).textContent).toBe("BBBB")
    expect(editor.state.selection.from).toBeGreaterThan(from)
    expect(editor.state.selection.empty).toBe(true)
    editor.destroy()
  })

  it("text mode without textSelectionRestorePos keeps drag behavior (caret at moved block start)", () => {
    const editor = mk("<p>A</p><p>B</p>")
    const from = 0
    const to = editor.state.doc.child(0).nodeSize
    const tr = executeReorder(
      editor.state,
      { from, to, selectionMode: "text" },
      { insertPos: editor.state.doc.content.size, indicatorLeft: 0, edgeY: 0 },
    )!
    editor.view.dispatch(tr)
    expect(editor.state.doc.child(1).textContent).toBe("A")
    expect(editor.state.selection.from).toBe(editor.state.doc.child(0).nodeSize + 1)
    editor.destroy()
  })

  it("returns null (no throw) when from/to are not on block boundaries (F1: dev-assert, not throw)", () => {
    const editor = mk("<p>ABC</p><p>D</p>")
    // pos 1 sits inside the first paragraph's text; to=editor.state.doc.content.size
    // ends outside the last block. The resulting slice has openStart=1. The old
    // hard throw was retired in F1 (the move core now dev-warns and returns null
    // so a caller bug surfaces without crashing prod).
    const docEnd = editor.state.doc.content.size
    const tr = executeReorder(
      editor.state,
      { from: 1, to: docEnd, selectionMode: "text" },
      { insertPos: 0, indicatorLeft: 0, edgeY: 0 },
    )
    expect(tr).toBeNull()
    editor.destroy()
  })
})

describe("executeReorder onMoved hook (Task G)", () => {
  // Two root images; the first carries a user resize (contentWidth 50). Moving
  // it to the end is a stand-in for a cross-surface drop — the hook rescales
  // regardless of surface, keyed purely on the px args the gesture measures.
  function twoImages() {
    return createTestEditor({
      content: {
        type: "doc",
        content: [
          {
            type: "image",
            attrs: { id: "im1", src: "https://e/a.png", alt: "A", contentWidth: 50 },
          },
          { type: "image", attrs: { id: "im2", src: "https://e/b.png", alt: "B" } },
        ],
      },
    })
  }

  function findImage(editor: ReturnType<typeof twoImages>, id: string) {
    let found: import("@tiptap/pm/model").Node | null = null
    editor.state.doc.descendants((node) => {
      if (node.type.name === "image" && node.attrs.id === id) {
        found = node
        return false
      }
      return true
    })
    return found as import("@tiptap/pm/model").Node | null
  }

  it("rescales the moved block's contentWidth in the SAME tr (one undo step)", () => {
    const editor = twoImages()
    const size = editor.state.doc.child(0).nodeSize
    const insertPos = editor.state.doc.content.size
    // srcPx=600, destPx=300 → 50% of 600px = 300px = 100% of 300px.
    const tr = executeReorder(
      editor.state,
      { from: 0, to: size, selectionMode: "text" },
      { insertPos, indicatorLeft: 0, edgeY: 0 },
      {
        onMoved: (t, result) =>
          rescaleMovedContentWidths(t, result.insertPos, size, 600, 300),
      },
    )!
    editor.view.dispatch(tr)
    // im1 moved to the end and its contentWidth was rescaled to preserve pixels.
    expect(editor.state.doc.child(1).attrs.id).toBe("im1")
    expect(findImage(editor, "im1")!.attrs.contentWidth).toBe(100)
    // One undo step reverts BOTH the move and the rescale.
    editor.commands.undo()
    expect(editor.state.doc.child(0).attrs.id).toBe("im1")
    expect(findImage(editor, "im1")!.attrs.contentWidth).toBe(50)
  })

  it("omitting onMoved leaves contentWidth untouched (frozen root→root contract)", () => {
    const editor = twoImages()
    const size = editor.state.doc.child(0).nodeSize
    const insertPos = editor.state.doc.content.size
    const tr = executeReorder(
      editor.state,
      { from: 0, to: size, selectionMode: "text" },
      { insertPos, indicatorLeft: 0, edgeY: 0 },
    )!
    // A plain move is exactly delete + insert — no attr steps added.
    expect(tr.steps).toHaveLength(2)
    editor.view.dispatch(tr)
    expect(editor.state.doc.child(1).attrs.id).toBe("im1")
    expect(findImage(editor, "im1")!.attrs.contentWidth).toBe(50)
  })

  it("passes the MoveSliceResult (insertPos + blockCount) to onMoved", () => {
    const editor = createTestEditor({
      content: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "A" }] },
          { type: "paragraph", content: [{ type: "text", text: "B" }] },
          { type: "paragraph", content: [{ type: "text", text: "C" }] },
        ],
      },
    })
    // Move B+C (indices 1,2) to the front.
    const from = editor.state.doc.child(0).nodeSize
    const to = from + editor.state.doc.child(1).nodeSize + editor.state.doc.child(2).nodeSize
    let seen: { insertPos: number; blockCount: number } | null = null
    const tr = executeReorder(
      editor.state,
      { from, to, selectionMode: "mbs" },
      { insertPos: 0, indicatorLeft: 0, edgeY: 0 },
      { onMoved: (_t, result) => (seen = result) },
    )!
    editor.view.dispatch(tr)
    expect(seen).not.toBeNull()
    expect(seen!.blockCount).toBe(2)
    expect(seen!.insertPos).toBe(0)
  })

  it("does not fire onMoved for a drop-on-self no-op", () => {
    const editor = twoImages()
    let fired = false
    const tr = executeReorder(
      editor.state,
      { from: 0, to: editor.state.doc.child(0).nodeSize, selectionMode: "text" },
      { insertPos: 0, indicatorLeft: 0, edgeY: 0 },
      { onMoved: () => (fired = true) },
    )
    expect(tr).toBeNull()
    expect(fired).toBe(false)
  })
})

describe("executeMoveSlice depth rebase into a column (Task G follow-up)", () => {
  // Same `nodesBetween` ancestor-cutoff shape as rescaleMovedContentWidths:
  // when the slice drops INSIDE a column, rebaseSliceDepth's walk visits the
  // enclosing columnLayout/column (pos < insertPos) first — a bare
  // `nodePos < insertPos → false` guard would stop descent before reaching the
  // moved block, leaving its depth un-rebased. Inspect `tr.doc` pre-dispatch so
  // no normalization appendTransaction can mask the raw rebase result.
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
  function depthOf(doc: import("@tiptap/pm/model").Node, id: string): number | undefined {
    let d: number | undefined
    doc.descendants((node) => {
      if (node.attrs?.id === id) {
        d = node.attrs.depth as number
        return false
      }
      return true
    })
    return d
  }

  it("rebases a depth-carrying block dropped inside a column to newDepthAttr", () => {
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
                  { type: "paragraph", attrs: { id: "L0" }, content: [{ type: "text", text: "left" }] },
                ],
              },
              {
                type: "column",
                attrs: { id: "cR", width: 1 },
                content: [
                  { type: "paragraph", attrs: { id: "R0" }, content: [{ type: "text", text: "right" }] },
                ],
              },
            ],
          },
          { type: "numberedList", attrs: { id: "nl", depth: 2 }, content: [{ type: "text", text: "item" }] },
        ],
      },
    })
    const list = posOf(editor.state.doc, "nl")
    const l0 = posOf(editor.state.doc, "L0")
    const colL = posOf(editor.state.doc, "cL")
    // Drop the depth-2 list into column L (before L0), rebasing to depth 0.
    const tr = editor.state.tr
    const result = executeMoveSlice(
      tr,
      { from: list.pos, to: list.pos + list.size },
      { insertPos: l0.pos, surfacePos: colL.pos },
      { newDepthAttr: 0 },
    )
    expect(result).not.toBeNull()
    // The moved list now sits inside column L and its depth was rebased 2 → 0.
    expect(depthOf(tr.doc, "nl")).toBe(0)
  })
})

describe("executeDepthOnlyChange", () => {
  it("single-block source shifts depth in place without delete/insert", () => {
    const editor = mk(`<p data-depth="2">three</p>`)
    const to = editor.state.doc.child(0).nodeSize

    const tr = executeDepthOnlyChange(
      editor.state,
      { from: 0, to, selectionMode: "text" },
      1,
    )

    expect(tr).not.toBeNull()
    editor.view.dispatch(tr!)

    expect(editor.state.doc.childCount).toBe(1)
    expect(editor.state.doc.child(0).attrs.depth).toBe(1)
    expect(editor.state.doc.child(0).textContent).toBe("three")
    editor.destroy()
  })

  it("returns null when delta is 0", () => {
    const editor = mk(`<p data-depth="2">three</p>`)
    const tr = executeDepthOnlyChange(
      editor.state,
      { from: 0, to: editor.state.doc.child(0).nodeSize, selectionMode: "text" },
      2,
    )

    expect(tr).toBeNull()
    editor.destroy()
  })

  it("multi-block source applies the same delta to every depth-bearing block in range", () => {
    const editor = mk(
      `<p data-depth="1">a</p>` +
      `<p data-depth="2">b</p>` +
      `<p data-depth="1">c</p>`,
    )
    const c0 = editor.state.doc.child(0).nodeSize
    const c1 = editor.state.doc.child(1).nodeSize
    const c2 = editor.state.doc.child(2).nodeSize

    const tr = executeDepthOnlyChange(
      editor.state,
      { from: 0, to: c0 + c1 + c2, selectionMode: "mbs" },
      2,
    )

    expect(tr).not.toBeNull()
    editor.view.dispatch(tr!)

    expect(editor.state.doc.child(0).attrs.depth).toBe(2)
    expect(editor.state.doc.child(1).attrs.depth).toBe(3)
    expect(editor.state.doc.child(2).attrs.depth).toBe(2)
    expect(editor.state.selection).toBeInstanceOf(MultiBlockSelection)
    expect((editor.state.selection as MultiBlockSelection).blockIndices).toEqual([0, 2])
    editor.destroy()
  })

  it("clamps depth to >= 0 when delta would drive a block negative", () => {
    const editor = mk(
      `<p data-depth="1">a</p>` +
      `<p data-depth="0">b</p>`,
    )
    const c0 = editor.state.doc.child(0).nodeSize
    const c1 = editor.state.doc.child(1).nodeSize

    const tr = executeDepthOnlyChange(
      editor.state,
      { from: 0, to: c0 + c1, selectionMode: "mbs" },
      0,
    )

    expect(tr).not.toBeNull()
    editor.view.dispatch(tr!)

    expect(editor.state.doc.child(0).attrs.depth).toBe(0)
    expect(editor.state.doc.child(1).attrs.depth).toBe(0)
    editor.destroy()
  })
})
