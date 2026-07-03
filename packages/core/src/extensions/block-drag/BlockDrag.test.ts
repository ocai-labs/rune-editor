// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Editor } from "@tiptap/core"
import Document from "@tiptap/extension-document"
import Text from "@tiptap/extension-text"
import { Plugin, type PluginKey } from "@tiptap/pm/state"
import { columnResizingPluginKey } from "@tiptap/pm/tables"
import { createBlockSpec } from "../../schema"
import { Divider } from "../../blocks"
import { BlockDrag, blockDragKey, GHOST_CLASS } from "./BlockDrag"
import { getPaddingThresholdCursor } from "./gesture"
import { createTestEditor } from "../../test-utils/createTestEditor"

const Para = createBlockSpec({
  type: "paragraph",
  content: "inline*",
  parseDOM: [{ tag: "p" }],
  renderDOM: ({ HTMLAttributes }) => ["p", HTMLAttributes, 0],
  sideMenu: { draggable: true },
})

let container: HTMLDivElement

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  // jsdom lacks elementFromPoint; PM's mousedown handler calls it via posAtCoords.
  if (typeof document.elementFromPoint !== "function") {
    ;(document as unknown as { elementFromPoint: (x: number, y: number) => Element | null }).elementFromPoint = () => null
  }
})

afterEach(() => {
  container.remove()
})

import { SideMenu, sideMenuKey } from "../side-menu/SideMenu"
import { GestureStatePlugin, gestureKey } from "../shared/gesture-state"
import { BlockSelection, blockSelectionKey } from "../block-selection"
import { MultiBlockSelection } from "../block-selection/MultiBlockSelection"
import { BlockId } from "../block-id"

describe("BlockDrag plugin shell", () => {
  it("starts with draggingRange null", () => {
    const editor = new Editor({
      element: container,
      extensions: [Document, Text, Para, BlockDrag],
      content: "<p>a</p>",
    })
    expect(blockDragKey.getState(editor.state)?.draggingRange).toBeNull()
    editor.destroy()
  })

  it("applies the ghost class to a single block when range covers one block", () => {
    const editor = new Editor({
      element: container,
      extensions: [Document, Text, Para, BlockDrag],
      content: "<p>hello</p>",
    })
    const size = editor.state.doc.child(0).nodeSize
    editor.view.dispatch(
      editor.state.tr.setMeta(blockDragKey, { draggingRange: { from: 0, to: size } }),
    )
    expect(container.querySelector("p")?.classList.contains(GHOST_CLASS)).toBe(true)
    editor.destroy()
  })

  it("applies the ghost class to every block in a multi-block range", () => {
    const editor = new Editor({
      element: container,
      extensions: [Document, Text, Para, BlockDrag],
      content: "<p>A</p><p>B</p><p>C</p>",
    })
    const a = editor.state.doc.child(0).nodeSize
    const b = editor.state.doc.child(1).nodeSize
    editor.view.dispatch(
      editor.state.tr.setMeta(blockDragKey, { draggingRange: { from: 0, to: a + b } }),
    )
    const ps = container.querySelectorAll("p")
    expect(ps[0]?.classList.contains(GHOST_CLASS)).toBe(true)
    expect(ps[1]?.classList.contains(GHOST_CLASS)).toBe(true)
    expect(ps[2]?.classList.contains(GHOST_CLASS)).toBe(false)
    editor.destroy()
  })

  it("removes the class when draggingRange reverts to null", () => {
    const editor = new Editor({
      element: container,
      extensions: [Document, Text, Para, BlockDrag],
      content: "<p>hello</p>",
    })
    const size = editor.state.doc.child(0).nodeSize
    editor.view.dispatch(
      editor.state.tr.setMeta(blockDragKey, { draggingRange: { from: 0, to: size } }),
    )
    editor.view.dispatch(
      editor.state.tr.setMeta(blockDragKey, { draggingRange: null }),
    )
    expect(container.querySelector("p")?.classList.contains(GHOST_CLASS)).toBe(false)
    editor.destroy()
  })
})

describe("BlockDrag gesture lifecycle", () => {
  it("grip mousedown + move past threshold + mouseup reorders doc", async () => {
    container.className = "rune-editor"
    const editor = new Editor({
      element: container,
      extensions: [Document, Text, Para, GestureStatePlugin, SideMenu, BlockDrag],
      content: "<p>A</p><p>B</p>",
    })

    editor.view.dispatch(editor.state.tr.setMeta(sideMenuKey, { hoveredPos: 0 }))
    const grip = container.querySelector(".rune-side-menu-grip") as HTMLButtonElement | null
    expect(grip).not.toBeNull()

    const ps = container.querySelectorAll("p")
    ;(ps[0] as HTMLElement).getBoundingClientRect = () =>
      ({ top: 0, bottom: 20, left: 0, right: 100, width: 100, height: 20, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    ;(ps[1] as HTMLElement).getBoundingClientRect = () =>
      ({ top: 40, bottom: 60, left: 0, right: 100, width: 100, height: 20, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect

    grip!.dispatchEvent(new MouseEvent("mousedown", { clientX: 0, clientY: 10, bubbles: true }))
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 0, clientY: 50, bubbles: true, buttons: 1 }))
    expect(container.querySelector(".rune-block-drag-preview")).not.toBeNull()
    document.dispatchEvent(new MouseEvent("mouseup", { clientX: 0, clientY: 50, bubbles: true }))

    await new Promise((r) => requestAnimationFrame(r))

    expect(editor.state.doc.child(0).textContent).toBe("B")
    expect(editor.state.doc.child(1).textContent).toBe("A")
    expect(gestureKey.getState(editor.state)?.activeGesture).toBeNull()
    editor.destroy()
  })

  it("mousedown→mouseup with no movement → applyGripClick fires (MBS set)", () => {
    container.className = "rune-editor"
    const editor = new Editor({
      element: container,
      extensions: [Document, Text, Para, BlockId, GestureStatePlugin, SideMenu, BlockDrag, BlockSelection],
      content: "<p>A</p><p>B</p>",
    })
    editor.view.dispatch(editor.state.tr.setMeta(sideMenuKey, { hoveredPos: 0 }))
    const grip = container.querySelector(".rune-side-menu-grip") as HTMLButtonElement
    grip.dispatchEvent(new MouseEvent("mousedown", { clientX: 0, clientY: 10, bubbles: true }))
    document.dispatchEvent(new MouseEvent("mouseup", { clientX: 0, clientY: 10, bubbles: true }))

    expect(editor.state.selection).toBeInstanceOf(MultiBlockSelection)
    expect((editor.state.selection as MultiBlockSelection).blockIndices).toEqual([0, 0])
    editor.destroy()
  })

  it("no-drag click on a block whose dragSourceRange extends → MBS spans the chain", () => {
    // Same dragSourceRange hook the drag path consumes — a click without
    // movement must select the same span, otherwise click MBS lies about
    // what the upcoming drag would move. (List chain / Toggle subtree
    // semantics, exercised here with a synthetic spec to keep the unit
    // self-contained — the real list/toggle specs are end-to-end-covered
    // by their own tests.)
    const ChainPara = createBlockSpec({
      type: "chainPara",
      content: "inline*",
      parseDOM: [{ tag: "p.chain" }],
      renderDOM: ({ HTMLAttributes }) => ["p", { ...HTMLAttributes, class: "chain" }, 0],
      sideMenu: { draggable: true },
      dragSourceRange: ({ node, pos, doc }) => {
        // Pull in the very next top-level sibling, if any. Mirrors what
        // listChainDragRange does for a head with one deeper child.
        let walked = 0
        for (let i = 0; i < doc.childCount; i++) {
          if (walked === pos) {
            const next = doc.maybeChild(i + 1)
            return next
              ? { from: pos, to: pos + node.nodeSize + next.nodeSize }
              : { from: pos, to: pos + node.nodeSize }
          }
          walked += doc.child(i).nodeSize
        }
        return { from: pos, to: pos + node.nodeSize }
      },
    })

    container.className = "rune-editor"
    const editor = new Editor({
      element: container,
      extensions: [
        Document,
        Text,
        ChainPara,
        BlockId.configure({ types: ["chainPara"] }),
        GestureStatePlugin,
        SideMenu,
        BlockDrag,
        BlockSelection,
      ],
      content: '<p class="chain">A</p><p class="chain">B</p><p class="chain">C</p>',
    })

    editor.view.dispatch(editor.state.tr.setMeta(sideMenuKey, { hoveredPos: 0 }))
    const grip = container.querySelector(".rune-side-menu-grip") as HTMLButtonElement
    expect(grip).not.toBeNull()

    grip.dispatchEvent(new MouseEvent("mousedown", { clientX: 0, clientY: 10, bubbles: true }))
    document.dispatchEvent(new MouseEvent("mouseup", { clientX: 0, clientY: 10, bubbles: true }))

    expect(editor.state.selection).toBeInstanceOf(MultiBlockSelection)
    // dragSourceRange said {0..A+B}: chain head + 1 sibling. Click MBS
    // must mirror — indices [0, 1], NOT [0, 0].
    expect((editor.state.selection as MultiBlockSelection).blockIndices).toEqual([0, 1])
    editor.destroy()
  })

  it("Divider grip mousedown→mouseup with no movement → applyGripClick fires (MBS set)", () => {
    container.className = "rune-editor"
    const editor = new Editor({
      element: container,
      extensions: [Document, Text, Divider, BlockId, GestureStatePlugin, SideMenu, BlockDrag, BlockSelection],
      content: "<hr>",
    })
    editor.view.dispatch(editor.state.tr.setMeta(sideMenuKey, { hoveredPos: 0 }))
    const grip = container.querySelector(".rune-side-menu-grip") as HTMLButtonElement
    expect(grip).not.toBeNull()

    grip.dispatchEvent(new MouseEvent("mousedown", { clientX: 0, clientY: 10, bubbles: true }))
    document.dispatchEvent(new MouseEvent("mouseup", { clientX: 0, clientY: 10, bubbles: true }))

    expect(editor.state.selection).toBeInstanceOf(MultiBlockSelection)
    expect((editor.state.selection as MultiBlockSelection).blockIndices).toEqual([0, 0])
    editor.destroy()
  })

  it("mousedown→cross threshold→mouseup does NOT set MBS (drag suppresses click)", async () => {
    container.className = "rune-editor"
    const editor = new Editor({
      element: container,
      extensions: [Document, Text, Para, BlockId, GestureStatePlugin, SideMenu, BlockDrag, BlockSelection],
      content: "<p>A</p><p>B</p>",
    })
    editor.view.dispatch(editor.state.tr.setMeta(sideMenuKey, { hoveredPos: 0 }))
    const grip = container.querySelector(".rune-side-menu-grip") as HTMLButtonElement

    const ps = container.querySelectorAll("p")
    ;(ps[0] as HTMLElement).getBoundingClientRect = () =>
      ({ top: 0, bottom: 20, left: 0, right: 100, width: 100, height: 20, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    ;(ps[1] as HTMLElement).getBoundingClientRect = () =>
      ({ top: 40, bottom: 60, left: 0, right: 100, width: 100, height: 20, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect

    grip.dispatchEvent(new MouseEvent("mousedown", { clientX: 0, clientY: 10, bubbles: true }))
    // Cross DRAG_THRESHOLD on the very first move so `active` arms.
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 0, clientY: 50, bubbles: true, buttons: 1 }))
    // Release back on the source slot (lastTarget=null) so executeReorder
    // doesn't run — we only care that applyGripClick did NOT fire.
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 0, clientY: 10, bubbles: true, buttons: 1 }))
    document.dispatchEvent(new MouseEvent("mouseup", { clientX: 0, clientY: 10, bubbles: true }))

    await new Promise((r) => requestAnimationFrame(r))

    expect(editor.state.selection).not.toBeInstanceOf(MultiBlockSelection)
    editor.destroy()
  })

  it("wrap zone arms via the block-rect fallback when no direct .rune-block-content exists", () => {
    // F6 fallback contract (mirrors `indicatorLeftFor`): the Para fixture
    // renders a bare <p> — no `.rune-block-content` child, like React
    // NodeView blocks whose wrapper nests one renderer level deeper (Audio)
    // or that render no content box at all (Equation, TableOfContents). The
    // zone must key on the block's own rect instead of staying unreachable.
    container.className = "rune-editor"
    const editor = new Editor({
      element: container,
      extensions: [Document, Text, Para, GestureStatePlugin, SideMenu, BlockDrag],
      content: "<p>A</p><p>B</p>",
    })
    editor.view.dispatch(editor.state.tr.setMeta(sideMenuKey, { hoveredPos: 0 }))
    const grip = container.querySelector(".rune-side-menu-grip") as HTMLButtonElement

    const ps = container.querySelectorAll("p")
    ;(ps[0] as HTMLElement).getBoundingClientRect = () =>
      ({ top: 0, bottom: 20, left: 100, right: 300, width: 200, height: 20, x: 100, y: 0, toJSON: () => ({}) }) as DOMRect
    ;(ps[1] as HTMLElement).getBoundingClientRect = () =>
      ({ top: 40, bottom: 60, left: 100, right: 300, width: 200, height: 20, x: 100, y: 40, toJSON: () => ({}) }) as DOMRect
    expect(container.querySelector(".rune-block-content")).toBeNull()

    grip.dispatchEvent(new MouseEvent("mousedown", { clientX: 100, clientY: 10, bubbles: true }))
    // Cross threshold landing 10px past B's RIGHT block edge (zone is 40px),
    // at B's vertical middle (inside the arm band). B is not in the dragged run.
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 310, clientY: 50, bubbles: true, buttons: 1 }))

    // The indicator renders the F6 VERTICAL bar at B's right edge, sized to
    // B's block rect — the fallback geometry.
    const indicator = document.querySelector(".rune-drag-indicator") as HTMLElement
    expect(indicator).not.toBeNull()
    expect(indicator.style.display).toBe("block")
    expect(indicator.style.width).toBe("2px")
    expect(indicator.style.left).toBe("299px") // rect.right (300) - 1
    expect(indicator.style.top).toBe("40px")
    expect(indicator.style.height).toBe("20px")

    // Abort (wrapIntoColumns isn't registered in this minimal editor).
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    editor.destroy()
  })

  it("Escape during drag aborts + cleans up", async () => {
    container.className = "rune-editor"
    const editor = new Editor({
      element: container,
      extensions: [Document, Text, Para, GestureStatePlugin, SideMenu, BlockDrag],
      content: "<p>A</p><p>B</p>",
    })
    editor.view.dispatch(editor.state.tr.setMeta(sideMenuKey, { hoveredPos: 0 }))
    const grip = container.querySelector(".rune-side-menu-grip") as HTMLButtonElement
    grip.dispatchEvent(new MouseEvent("mousedown", { clientX: 0, clientY: 10, bubbles: true }))
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 0, clientY: 50, bubbles: true, buttons: 1 }))
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))

    await new Promise((r) => requestAnimationFrame(r))

    expect(editor.state.doc.child(0).textContent).toBe("A")
    expect(editor.state.doc.child(1).textContent).toBe("B")
    expect(gestureKey.getState(editor.state)?.activeGesture).toBeNull()
    expect(document.querySelector(".rune-block-drag-preview")).toBeNull()
    editor.destroy()
  })
})

describe("BlockDrag trigger — MBS interactions", () => {
  it("grip on a block inside MBS picks up the whole range (selectionMode mbs)", async () => {
    container.className = "rune-editor"
    const editor = new Editor({
      element: container,
      extensions: [Document, Text, Para, BlockId, GestureStatePlugin, SideMenu, BlockDrag, BlockSelection],
      content: "<p>A</p><p>B</p><p>C</p><p>D</p>",
    })
    // Establish MBS over blocks 1..2 (B + C).
    editor.commands.setBlockSelection({ from: 1, to: 2 })
    expect(editor.state.selection).toBeInstanceOf(MultiBlockSelection)

    // Hover block B → grip exists for block B.
    const bPos = editor.state.doc.child(0).nodeSize
    editor.view.dispatch(editor.state.tr.setMeta(sideMenuKey, { hoveredPos: bPos }))
    const grip = container.querySelector(".rune-side-menu-grip") as HTMLButtonElement
    expect(grip).not.toBeNull()

    // Stub geometry for slotAtY to find a target above block A.
    const ps = container.querySelectorAll("p")
    ps.forEach((p, i) => {
      ;(p as HTMLElement).getBoundingClientRect = () =>
        ({ top: i * 30, bottom: i * 30 + 20, left: 0, right: 100, width: 100, height: 20, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    })

    grip.dispatchEvent(new MouseEvent("mousedown", { clientX: 0, clientY: 35, bubbles: true }))
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 0, clientY: 0, bubbles: true, buttons: 1 })) // cursor goes above A
    document.dispatchEvent(new MouseEvent("mouseup", { clientX: 0, clientY: 0, bubbles: true }))

    await new Promise((r) => requestAnimationFrame(r))

    // After drop: B + C should be at indices 0, 1.
    expect(editor.state.doc.child(0).textContent).toBe("B")
    expect(editor.state.doc.child(1).textContent).toBe("C")
    expect(editor.state.doc.child(2).textContent).toBe("A")
    expect(editor.state.doc.child(3).textContent).toBe("D")
    // MBS rebuilt over moved range.
    expect(editor.state.selection).toBeInstanceOf(MultiBlockSelection)
    expect((editor.state.selection as MultiBlockSelection).blockIndices).toEqual([0, 1])

    editor.destroy()
  })

  it("grip on a block OUTSIDE MBS clears MBS (eager NodeSelection)", async () => {
    container.className = "rune-editor"
    const editor = new Editor({
      element: container,
      extensions: [Document, Text, Para, BlockId, GestureStatePlugin, SideMenu, BlockDrag, BlockSelection],
      content: "<p>A</p><p>B</p><p>C</p><p>D</p>",
    })
    // MBS over blocks 0..1 (A + B).
    editor.commands.setBlockSelection({ from: 0, to: 1 })
    expect(editor.state.selection).toBeInstanceOf(MultiBlockSelection)

    // Grip on D (index 3, OUTSIDE MBS).
    let dPos = 0
    for (let i = 0; i < 3; i++) dPos += editor.state.doc.child(i).nodeSize
    editor.view.dispatch(editor.state.tr.setMeta(sideMenuKey, { hoveredPos: dPos }))
    const grip = container.querySelector(".rune-side-menu-grip") as HTMLButtonElement

    grip.dispatchEvent(new MouseEvent("mousedown", { clientX: 0, clientY: 0, bubbles: true }))

    // After mousedown: MBS gone, NodeSelection on D.
    expect(editor.state.selection).not.toBeInstanceOf(MultiBlockSelection)
    // Best signal we have for "selection lives on block D" without importing
    // NodeSelection: assert from/to equals block D's start/end.
    expect(editor.state.selection.from).toBe(dPos)

    document.dispatchEvent(new MouseEvent("mouseup", { clientX: 0, clientY: 0, bubbles: true }))
    editor.destroy()
  })

  it("shift-grip on a block outside MBS preserves anchor and extends on mouseup", () => {
    container.className = "rune-editor"
    const editor = new Editor({
      element: container,
      extensions: [Document, Text, Para, BlockId, GestureStatePlugin, SideMenu, BlockDrag, BlockSelection],
      content: "<p>A</p><p>B</p><p>C</p><p>D</p>",
    })

    editor.commands.setBlockSelection({ from: 1, to: 1 })
    const anchorId = editor.state.doc.child(1).attrs.id as string
    expect(blockSelectionKey.getState(editor.state)?.anchorBlockId).toBe(anchorId)

    let dPos = 0
    for (let i = 0; i < 3; i++) dPos += editor.state.doc.child(i).nodeSize
    editor.view.dispatch(editor.state.tr.setMeta(sideMenuKey, { hoveredPos: dPos }))
    const grip = container.querySelector(".rune-side-menu-grip") as HTMLButtonElement

    grip.dispatchEvent(
      new MouseEvent("mousedown", {
        clientX: 0,
        clientY: 0,
        bubbles: true,
        shiftKey: true,
      }),
    )
    document.dispatchEvent(
      new MouseEvent("mouseup", {
        clientX: 0,
        clientY: 0,
        bubbles: true,
      }),
    )

    expect(editor.state.selection).toBeInstanceOf(MultiBlockSelection)
    expect((editor.state.selection as MultiBlockSelection).blockIndices).toEqual([1, 3])
    expect(blockSelectionKey.getState(editor.state)?.anchorBlockId).toBe(anchorId)

    editor.destroy()
  })

  it("Divider grip inside MBS picks up the whole range", async () => {
    container.className = "rune-editor"
    const editor = new Editor({
      element: container,
      extensions: [Document, Text, Para, Divider, BlockId, GestureStatePlugin, SideMenu, BlockDrag, BlockSelection],
      content: "<p>A</p><hr><p>B</p>",
    })
    editor.commands.setBlockSelection({ from: 0, to: 1 })
    expect(editor.state.selection).toBeInstanceOf(MultiBlockSelection)

    const dividerPos = editor.state.doc.child(0).nodeSize
    editor.view.dispatch(editor.state.tr.setMeta(sideMenuKey, { hoveredPos: dividerPos }))
    const grip = container.querySelector(".rune-side-menu-grip") as HTMLButtonElement
    expect(grip).not.toBeNull()

    const blocks = Array.from(container.querySelectorAll(".ProseMirror > *"))
      .filter((block) => !block.classList.contains("rune-side-menu"))
    blocks.forEach((block, i) => {
      ;(block as HTMLElement).getBoundingClientRect = () =>
        ({ top: i * 30, bottom: i * 30 + 20, left: 0, right: 100, width: 100, height: 20, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    })

    grip.dispatchEvent(new MouseEvent("mousedown", { clientX: 0, clientY: 35, bubbles: true }))
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 0, clientY: 95, bubbles: true, buttons: 1 }))
    document.dispatchEvent(new MouseEvent("mouseup", { clientX: 0, clientY: 95, bubbles: true }))

    await new Promise((r) => requestAnimationFrame(r))

    expect(editor.state.doc.child(0).textContent).toBe("B")
    expect(editor.state.doc.child(1).type.name).toBe("paragraph")
    expect(editor.state.doc.child(1).textContent).toBe("A")
    expect(editor.state.doc.child(2).type.name).toBe("divider")
    expect(editor.state.selection).toBeInstanceOf(MultiBlockSelection)
    expect((editor.state.selection as MultiBlockSelection).blockIndices).toEqual([1, 2])

    editor.destroy()
  })

  it("padding mousedown on MBS-covered block + drag → reorders the MBS range", async () => {
    container.className = "rune-editor"
    const editor = new Editor({
      element: container,
      extensions: [Document, Text, Para, BlockId, GestureStatePlugin, SideMenu, BlockDrag, BlockSelection],
      content: "<p>A</p><p>B</p><p>C</p><p>D</p>",
    })
    // Establish MBS over blocks 0..1 (A + B).
    editor.commands.setBlockSelection({ from: 0, to: 1 })
    expect(editor.state.selection).toBeInstanceOf(MultiBlockSelection)

    // Stub posAtCoords to return null so the handler hits the bounding-rect
    // fallback (simulates a click in the page gutter outside .ProseMirror).
    ;(editor.view.posAtCoords as unknown as (coords: { left: number; top: number }) => { pos: number; inside: number } | null) =
      () => null

    const ps = container.querySelectorAll("p")
    ps.forEach((p, i) => {
      ;(p as HTMLElement).getBoundingClientRect = () =>
        ({ top: i * 30, bottom: i * 30 + 20, left: 0, right: 100, width: 100, height: 20, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    })

    // Padding mousedown at Y inside block A (MBS-covered). Target is the
    // .rune-editor wrapper (outside .rune-block-content) so the block-drag
    // padding handler claims the gesture.
    container.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: -10, clientY: 10 }))
    // Cross DRAG_THRESHOLD with a downward move past block D's midpoint so the
    // drop lands in slot 4 (after D). D is top=90/bottom=110, centre=100.
    document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: -10, clientY: 105, buttons: 1 }))
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: -10, clientY: 105 }))

    await new Promise((r) => requestAnimationFrame(r))

    // After drop: order is [C, D, A, B]; MBS rebuilt over moved range.
    expect(editor.state.doc.child(0).textContent).toBe("C")
    expect(editor.state.doc.child(1).textContent).toBe("D")
    expect(editor.state.doc.child(2).textContent).toBe("A")
    expect(editor.state.doc.child(3).textContent).toBe("B")
    expect(editor.state.selection).toBeInstanceOf(MultiBlockSelection)
    expect((editor.state.selection as MultiBlockSelection).blockIndices).toEqual([2, 3])

    editor.destroy()
  })

  it("padding mousedown is suppressed while column-resize handle is active", () => {
    // Repro for the fit-width-table block-drag false-positive: when MBS
    // covers a table and the cursor sits on the rightmost column's
    // `.column-resize-handle` (which has `pointer-events: none` and
    // overhangs the rightmost cell by 2px in fit-width mode), the click
    // target is the `.rune-block` padding chrome — NOT `.rune-block-content`.
    // Without the gate, onPaddingMouseDown's preconditions (not grip, not
    // in block-content, MBS active) would all be satisfied and arm a
    // block-drag pending. The columnResizing plugin's `activeHandle`
    // (set by its own mousemove while the cursor is in a handle hot zone)
    // is the canonical "user is resizing, defer" signal — same gate the
    // table pin plugin uses.
    container.className = "rune-editor"
    const editor = new Editor({
      element: container,
      extensions: [Document, Text, Para, BlockId, GestureStatePlugin, SideMenu, BlockDrag, BlockSelection],
      content: "<p>A</p><p>B</p><p>C</p><p>D</p>",
    })

    // Install a sentinel plugin under columnResizingPluginKey so the gate
    // reads a non-default state, without pulling the whole Table extension
    // graph into this unit test. Mirrors what prosemirror-tables would
    // expose at runtime when the cursor is hovering a handle hot zone.
    type ColumnResizeShape = { activeHandle: number; dragging: unknown }
    const fake = new Plugin<ColumnResizeShape>({
      key: columnResizingPluginKey as unknown as PluginKey<ColumnResizeShape>,
      state: {
        init: () => ({ activeHandle: 1, dragging: null }),
        apply: (_tr, s) => s,
      },
    })
    editor.view.updateState(editor.state.reconfigure({ plugins: [...editor.state.plugins, fake] }))

    editor.commands.setBlockSelection({ from: 0, to: 1 })

    ;(editor.view.posAtCoords as unknown as (coords: { left: number; top: number }) => { pos: number; inside: number } | null) =
      () => null
    const ps = container.querySelectorAll("p")
    ps.forEach((p, i) => {
      ;(p as HTMLElement).getBoundingClientRect = () =>
        ({ top: i * 30, bottom: i * 30 + 20, left: 0, right: 100, width: 100, height: 20, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    })

    container.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: -10, clientY: 10 }))
    document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: -10, clientY: 105, buttons: 1 }))
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: -10, clientY: 105 }))

    // Gate held: no reorder, no preview chrome.
    expect(editor.state.doc.child(0).textContent).toBe("A")
    expect(editor.state.doc.child(1).textContent).toBe("B")
    expect(document.querySelector(".rune-block-drag-preview")).toBeNull()

    editor.destroy()
  })

  it("padding mousedown on a read-only editor does NOT arm a drag (GS-5)", () => {
    // Readonly rule (AGENTS): every gesture ENTRY gates on `view.editable`.
    // The grip handler, drag-extend, marquee, and resize all do — this pins
    // the padding entry. Trigger: host calls editor.setEditable(false) while
    // an MBS is live (the selection survives the toggle); a padding press on
    // a covered block would otherwise arm pending, threshold-cross has no
    // editable check, and the drop would dispatch executeReorder — MUTATING
    // a read-only document.
    container.className = "rune-editor"
    const editor = new Editor({
      element: container,
      extensions: [Document, Text, Para, BlockId, GestureStatePlugin, SideMenu, BlockDrag, BlockSelection],
      content: "<p>A</p><p>B</p><p>C</p><p>D</p>",
    })
    editor.commands.setBlockSelection({ from: 0, to: 1 })
    editor.setEditable(false)
    // The MBS must survive the toggle for this trigger to be live at all.
    expect(editor.state.selection).toBeInstanceOf(MultiBlockSelection)

    ;(editor.view.posAtCoords as unknown as (coords: { left: number; top: number }) => { pos: number; inside: number } | null) =
      () => null
    const ps = container.querySelectorAll("p")
    ps.forEach((p, i) => {
      ;(p as HTMLElement).getBoundingClientRect = () =>
        ({ top: i * 30, bottom: i * 30 + 20, left: 0, right: 100, width: 100, height: 20, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    })

    // Same gesture as the reorder test above: padding press on covered block
    // A, cross threshold past D's midpoint, release at a valid drop slot.
    container.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: -10, clientY: 10 }))
    document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: -10, clientY: 105, buttons: 1 }))
    expect(document.querySelector(".rune-block-drag-preview")).toBeNull()
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: -10, clientY: 105 }))

    // Read-only doc untouched.
    expect(editor.state.doc.child(0).textContent).toBe("A")
    expect(editor.state.doc.child(1).textContent).toBe("B")
    expect(editor.state.doc.child(2).textContent).toBe("C")
    expect(editor.state.doc.child(3).textContent).toBe("D")

    editor.destroy()
  })

  it("padding mousedown on a block OUTSIDE MBS does NOT activate block-drag", () => {
    container.className = "rune-editor"
    const editor = new Editor({
      element: container,
      extensions: [Document, Text, Para, BlockId, GestureStatePlugin, SideMenu, BlockDrag, BlockSelection],
      content: "<p>A</p><p>B</p><p>C</p><p>D</p>",
    })
    editor.commands.setBlockSelection({ from: 0, to: 1 })

    ;(editor.view.posAtCoords as unknown as (coords: { left: number; top: number }) => { pos: number; inside: number } | null) =
      () => null
    const ps = container.querySelectorAll("p")
    ps.forEach((p, i) => {
      ;(p as HTMLElement).getBoundingClientRect = () =>
        ({ top: i * 30, bottom: i * 30 + 20, left: 0, right: 100, width: 100, height: 20, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    })

    // Padding mousedown at Y inside block C (NOT in MBS [0..1]).
    container.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: -10, clientY: 65 }))

    // No block-drag pending (drag-extend's entry B handled it instead).
    // Verify by sending a move + up and asserting the doc is NOT reordered.
    document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: -10, clientY: 95, buttons: 1 }))
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: -10, clientY: 95 }))

    expect(editor.state.doc.child(0).textContent).toBe("A")
    expect(editor.state.doc.child(1).textContent).toBe("B")
    expect(editor.state.doc.child(2).textContent).toBe("C")
    expect(editor.state.doc.child(3).textContent).toBe("D")

    editor.destroy()
  })

  it("padding-drag preview anchors at grip-like position, not at click location", async () => {
    container.className = "rune-editor"
    const editor = new Editor({
      element: container,
      extensions: [Document, Text, Para, BlockId, GestureStatePlugin, SideMenu, BlockDrag, BlockSelection],
      content: "<p>A</p><p>B</p><p>C</p><p>D</p>",
    })
    editor.commands.setBlockSelection({ from: 0, to: 1 })

    ;(editor.view.posAtCoords as unknown as (coords: { left: number; top: number }) => { pos: number; inside: number } | null) =
      () => null
    const ps = container.querySelectorAll("p")
    ps.forEach((p, i) => {
      ;(p as HTMLElement).getBoundingClientRect = () =>
        ({ top: i * 30, bottom: i * 30 + 20, left: 100, right: 300, width: 200, height: 20, x: 100, y: 0, toJSON: () => ({}) }) as DOMRect
    })

    // Click the bottom-right of block A's padding band (far from natural grip position).
    // Block A: left=100, right=300, top=0, bottom=20.
    const clickX = 290  // near right edge of block A
    const clickY = 18   // near bottom of block A
    container.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: clickX, clientY: clickY }))

    // Cross threshold with a small downward-right move.
    const moveX = clickX + 6  // 296
    const moveY = clickY + 6  // 24
    document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: moveX, clientY: moveY, buttons: 1 }))

    const preview = container.querySelector(".rune-block-drag-preview") as HTMLElement | null
    expect(preview).not.toBeNull()

    // Invariant: preview must be at block A's position, NOT chasing the (far off-center) click.
    //
    // Synthetic grip cursor for block A:
    //   clientX = firstSourceRect.left - 28 = 100 - 28 = 72
    //   clientY = firstSourceRect.top + Math.min(18, firstSourceRect.height / 2)
    //           = 0 + Math.min(18, 10) = 10
    //
    // grab = synthetic - sourceTopLeft = (72 - 100, 10 - 0) = (-28, 10)
    //
    // cursorAdjust = realThresholdCursor - synthetic = (296 - 72, 24 - 10) = (224, 14)
    //
    // adjusted cursor = realCursor - cursorAdjust = (296 - 224, 24 - 14) = (72, 10)
    //
    // preview position = adjusted - grab = (72 - (-28), 10 - 10) = (100, 0)
    // = exactly block A's top-left — preview spawns on the source block.
    expect(preview!.style.left).toBe("100px")
    expect(preview!.style.top).toBe("0px")

    // Cleanup.
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: moveX, clientY: moveY }))
    await new Promise((r) => requestAnimationFrame(r))
    editor.destroy()
  })

  it("reads padding drag grip offset from the editor CSS variable", () => {
    container.className = "rune-editor"
    container.style.setProperty("--rune-side-menu-grip-offset", "-40px")

    const cursor = getPaddingThresholdCursor(
      container,
      ({ top: 0, bottom: 20, left: 100, right: 300, width: 200, height: 20, x: 100, y: 0, toJSON: () => ({}) }) as DOMRect,
    )

    expect(cursor.clientX).toBe(60)
    expect(cursor.clientY).toBe(10)
  })

  it("resolves non-px padding drag grip offsets like CSS layout does", () => {
    document.documentElement.style.fontSize = "16px"
    container.className = "rune-editor"
    container.style.setProperty("--rune-side-menu-grip-offset", "-2rem")

    const cursor = getPaddingThresholdCursor(
      container,
      ({ top: 0, bottom: 20, left: 100, right: 300, width: 200, height: 20, x: 100, y: 0, toJSON: () => ({}) }) as DOMRect,
    )

    expect(cursor.clientX).toBe(68)
    expect(cursor.clientY).toBe(10)
  })

  it("shifts synthetic cursor right by sourceDepth * indent step", () => {
    container.className = "rune-editor"
    container.style.setProperty("--rune-side-menu-grip-offset", "-28px")
    container.style.setProperty("--rune-block-indent-step", "30px")

    const cursor = getPaddingThresholdCursor(
      container,
      ({ top: 0, bottom: 20, left: 100, right: 300, width: 200, height: 20, x: 100, y: 0, toJSON: () => ({}) }) as DOMRect,
      2,
    )

    // 100 (rect.left) + 2 * 30 (depth*step) + -28 (gripOffset) = 132
    expect(cursor.clientX).toBe(132)
    expect(cursor.clientY).toBe(10)
  })

  it("padding mousedown in the void below all blocks does NOT trigger reorder (strict)", () => {
    container.className = "rune-editor"
    const editor = new Editor({
      element: container,
      extensions: [Document, Text, Para, BlockId, GestureStatePlugin, SideMenu, BlockDrag, BlockSelection],
      content: "<p>A</p><p>B</p><p>C</p><p>D</p>",
    })
    // MBS covers the last block (D).
    editor.commands.setBlockSelection({ from: 2, to: 3 })

    ;(editor.view.posAtCoords as unknown as (coords: { left: number; top: number }) => { pos: number; inside: number } | null) =
      () => null
    const ps = container.querySelectorAll("p")
    ps.forEach((p, i) => {
      ;(p as HTMLElement).getBoundingClientRect = () =>
        ({ top: i * 30, bottom: i * 30 + 20, left: 0, right: 100, width: 100, height: 20, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    })

    // Y = 9999 is below every block.
    container.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: -10, clientY: 9999 }))
    document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: -10, clientY: 10000, buttons: 1 }))
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: -10, clientY: 10000 }))

    // Doc unchanged.
    expect(editor.state.doc.child(0).textContent).toBe("A")
    expect(editor.state.doc.child(1).textContent).toBe("B")
    expect(editor.state.doc.child(2).textContent).toBe("C")
    expect(editor.state.doc.child(3).textContent).toBe("D")

    editor.destroy()
  })
})

describe("BlockDrag gesture hardening — pending-stage cancel + buttons defense (#297)", () => {
  function makeEditor(content = "<p>A</p><p>B</p>") {
    container.className = "rune-editor"
    const editor = new Editor({
      element: container,
      extensions: [Document, Text, Para, BlockId, GestureStatePlugin, SideMenu, BlockDrag, BlockSelection],
      content,
    })
    editor.view.dispatch(editor.state.tr.setMeta(sideMenuKey, { hoveredPos: 0 }))
    const grip = container.querySelector(".rune-side-menu-grip") as HTMLButtonElement
    const ps = container.querySelectorAll("p")
    ps.forEach((p, i) => {
      ;(p as HTMLElement).getBoundingClientRect = () =>
        ({ top: i * 40, bottom: i * 40 + 20, left: 0, right: 100, width: 100, height: 20, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    })
    return { editor, grip }
  }

  it("window blur during PENDING stage cancels the gesture (no phantom drag)", () => {
    const { editor, grip } = makeEditor()
    grip.dispatchEvent(new MouseEvent("mousedown", { clientX: 0, clientY: 10, bubbles: true }))
    // Alt-tab steals focus while still under the 5px threshold — the
    // mouseup is swallowed. Cancel handlers must already be installed.
    window.dispatchEvent(new Event("blur"))
    // The user comes back and moves the mouse: even a buttons:1 move past
    // the threshold must be inert — the gesture's listeners are gone.
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 0, clientY: 50, bubbles: true, buttons: 1 }))
    expect(document.querySelector(".rune-block-drag-preview")).toBeNull()
    document.dispatchEvent(new MouseEvent("mouseup", { clientX: 0, clientY: 50, bubbles: true }))
    expect(editor.state.selection).not.toBeInstanceOf(MultiBlockSelection)
    expect(editor.state.doc.child(0).textContent).toBe("A")
    editor.destroy()
  })

  it("Escape during PENDING stage cancels the gesture", () => {
    const { editor, grip } = makeEditor()
    grip.dispatchEvent(new MouseEvent("mousedown", { clientX: 0, clientY: 10, bubbles: true }))
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 0, clientY: 50, bubbles: true, buttons: 1 }))
    expect(document.querySelector(".rune-block-drag-preview")).toBeNull()
    document.dispatchEvent(new MouseEvent("mouseup", { clientX: 0, clientY: 50, bubbles: true }))
    expect(editor.state.selection).not.toBeInstanceOf(MultiBlockSelection)
    editor.destroy()
  })

  it("mousemove with buttons:0 during PENDING cancels instead of starting a phantom drag", () => {
    const { editor, grip } = makeEditor()
    grip.dispatchEvent(new MouseEvent("mousedown", { clientX: 0, clientY: 10, bubbles: true }))
    // Lost mouseup: the browser delivers further moves with no button held.
    // Crossing the threshold this way must cancel, not arm the drag.
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 0, clientY: 50, bubbles: true, buttons: 0 }))
    expect(document.querySelector(".rune-block-drag-preview")).toBeNull()
    expect(gestureKey.getState(editor.state)?.activeGesture).toBeNull()
    // The gesture is fully torn down — a later "real" move does nothing.
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 0, clientY: 55, bubbles: true, buttons: 1 }))
    expect(document.querySelector(".rune-block-drag-preview")).toBeNull()
    editor.destroy()
  })

  it("mousemove with buttons:0 during ACTIVE drag aborts and cleans up", () => {
    const { editor, grip } = makeEditor()
    grip.dispatchEvent(new MouseEvent("mousedown", { clientX: 0, clientY: 10, bubbles: true }))
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 0, clientY: 50, bubbles: true, buttons: 1 }))
    expect(document.querySelector(".rune-block-drag-preview")).not.toBeNull()
    // Button vanished mid-drag (mouseup swallowed by an OS dialog).
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 0, clientY: 55, bubbles: true, buttons: 0 }))
    expect(document.querySelector(".rune-block-drag-preview")).toBeNull()
    expect(gestureKey.getState(editor.state)?.activeGesture).toBeNull()
    expect(editor.state.doc.child(0).textContent).toBe("A")
    expect(editor.state.doc.child(1).textContent).toBe("B")
    editor.destroy()
  })
})

describe("BlockDrag gesture hardening — primary-button gating (#297)", () => {
  function makeEditor(content = "<p>A</p><p>B</p><p>C</p><p>D</p>") {
    container.className = "rune-editor"
    const editor = new Editor({
      element: container,
      extensions: [Document, Text, Para, BlockId, GestureStatePlugin, SideMenu, BlockDrag, BlockSelection],
      content,
    })
    const ps = container.querySelectorAll("p")
    ps.forEach((p, i) => {
      ;(p as HTMLElement).getBoundingClientRect = () =>
        ({ top: i * 30, bottom: i * 30 + 20, left: 0, right: 100, width: 100, height: 20, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    })
    return editor
  }

  it("right-button grip press is fully inert — no drag, no MBS on release", () => {
    const editor = makeEditor()
    editor.view.dispatch(editor.state.tr.setMeta(sideMenuKey, { hoveredPos: 0 }))
    const grip = container.querySelector(".rune-side-menu-grip") as HTMLButtonElement

    grip.dispatchEvent(new MouseEvent("mousedown", { button: 2, buttons: 2, clientX: 0, clientY: 10, bubbles: true }))
    // Even if moves arrive while the right button is held, no drag arms.
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 0, clientY: 75, bubbles: true, buttons: 2 }))
    expect(document.querySelector(".rune-block-drag-preview")).toBeNull()
    document.dispatchEvent(new MouseEvent("mouseup", { button: 2, clientX: 0, clientY: 75, bubbles: true }))

    // A LEFT grip click commits an MBS-of-1 via applyGripClick; the right
    // click must not.
    expect(editor.state.selection).not.toBeInstanceOf(MultiBlockSelection)
    expect(editor.state.doc.child(0).textContent).toBe("A")
    editor.destroy()
  })

  it("right-button grip press does NOT eagerly clear an existing MBS", () => {
    const editor = makeEditor()
    // MBS over A+B; grip hovers D (outside the MBS). A LEFT press here
    // eagerly swaps the MBS for a NodeSelection on D — a right press must
    // leave the MBS untouched (context-menu territory).
    editor.commands.setBlockSelection({ from: 0, to: 1 })
    expect(editor.state.selection).toBeInstanceOf(MultiBlockSelection)
    let dPos = 0
    for (let i = 0; i < 3; i++) dPos += editor.state.doc.child(i).nodeSize
    editor.view.dispatch(editor.state.tr.setMeta(sideMenuKey, { hoveredPos: dPos }))
    const grip = container.querySelector(".rune-side-menu-grip") as HTMLButtonElement

    grip.dispatchEvent(new MouseEvent("mousedown", { button: 2, buttons: 2, clientX: 0, clientY: 100, bubbles: true }))

    expect(editor.state.selection).toBeInstanceOf(MultiBlockSelection)
    document.dispatchEvent(new MouseEvent("mouseup", { button: 2, clientX: 0, clientY: 100, bubbles: true }))
    editor.destroy()
  })

  it("right-button padding press on an MBS-covered block does not arm a padding-drag", () => {
    const editor = makeEditor()
    editor.commands.setBlockSelection({ from: 0, to: 1 })
    ;(editor.view.posAtCoords as unknown as (coords: { left: number; top: number }) => { pos: number; inside: number } | null) =
      () => null

    container.dispatchEvent(new MouseEvent("mousedown", { button: 2, buttons: 2, bubbles: true, clientX: -10, clientY: 10 }))
    document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: -10, clientY: 105, buttons: 2 }))
    expect(document.querySelector(".rune-block-drag-preview")).toBeNull()
    document.dispatchEvent(new MouseEvent("mouseup", { button: 2, bubbles: true, clientX: -10, clientY: 105 }))

    // Doc untouched — the right press never armed a reorder gesture.
    expect(editor.state.doc.child(0).textContent).toBe("A")
    expect(editor.state.doc.child(1).textContent).toBe("B")
    expect(editor.state.doc.child(2).textContent).toBe("C")
    expect(editor.state.doc.child(3).textContent).toBe("D")
    editor.destroy()
  })

  it("non-primary mouseup during a live gesture does not commit; the primary release does", () => {
    const editor = makeEditor()
    editor.view.dispatch(editor.state.tr.setMeta(sideMenuKey, { hoveredPos: 0 }))
    const grip = container.querySelector(".rune-side-menu-grip") as HTMLButtonElement

    // Left press arms pending; a stray RIGHT release (right-click while the
    // left button is still down) must not commit the grip click...
    grip.dispatchEvent(new MouseEvent("mousedown", { clientX: 0, clientY: 10, bubbles: true }))
    document.dispatchEvent(new MouseEvent("mouseup", { button: 2, clientX: 0, clientY: 10, bubbles: true }))
    expect(editor.state.selection).not.toBeInstanceOf(MultiBlockSelection)

    // ...while the real primary release still does.
    document.dispatchEvent(new MouseEvent("mouseup", { button: 0, clientX: 0, clientY: 10, bubbles: true }))
    expect(editor.state.selection).toBeInstanceOf(MultiBlockSelection)
    expect((editor.state.selection as MultiBlockSelection).blockIndices).toEqual([0, 0])
    editor.destroy()
  })
})

describe("BlockDrag gesture hardening — mid-drag doc change aborts (#307)", () => {
  function makeEditor(content = "<p>A</p><p>B</p>") {
    container.className = "rune-editor"
    const editor = new Editor({
      element: container,
      extensions: [Document, Text, Para, BlockId, GestureStatePlugin, SideMenu, BlockDrag, BlockSelection],
      content,
    })
    editor.view.dispatch(editor.state.tr.setMeta(sideMenuKey, { hoveredPos: 0 }))
    const grip = container.querySelector(".rune-side-menu-grip") as HTMLButtonElement
    const ps = container.querySelectorAll("p")
    ps.forEach((p, i) => {
      ;(p as HTMLElement).getBoundingClientRect = () =>
        ({ top: i * 40, bottom: i * 40 + 20, left: 0, right: 100, width: 100, height: 20, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    })
    return { editor, grip }
  }

  it("a docChanged transaction during an ACTIVE drag aborts the gesture (drop is inert)", () => {
    const { editor, grip } = makeEditor()
    // Arm a real drag with a live drop target below B (same geometry as the
    // lifecycle test, where mouseup WOULD reorder A after B).
    grip.dispatchEvent(new MouseEvent("mousedown", { clientX: 0, clientY: 10, bubbles: true }))
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 0, clientY: 50, bubbles: true, buttons: 1 }))
    expect(document.querySelector(".rune-block-drag-preview")).not.toBeNull()

    // External doc change lands mid-drag (collab peer / programmatic edit).
    // Every captured position is now stale — the gesture must abort.
    editor.view.dispatch(editor.state.tr.insertText("X", 1))

    expect(document.querySelector(".rune-block-drag-preview")).toBeNull()
    expect(document.querySelector(".rune-drag-indicator")).toBeNull()
    expect(gestureKey.getState(editor.state)?.activeGesture).toBeNull()
    expect(blockDragKey.getState(editor.state)?.draggingRange).toBeNull()

    // The mouseup that follows must NOT replay the stale drop.
    document.dispatchEvent(new MouseEvent("mouseup", { clientX: 0, clientY: 50, bubbles: true }))
    expect(editor.state.doc.child(0).textContent).toBe("XA")
    expect(editor.state.doc.child(1).textContent).toBe("B")
    editor.destroy()
  })

  it("a docChanged transaction during the PENDING stage aborts too", () => {
    const { editor, grip } = makeEditor()
    grip.dispatchEvent(new MouseEvent("mousedown", { clientX: 0, clientY: 10, bubbles: true }))
    editor.view.dispatch(editor.state.tr.insertText("X", 1))

    // Gesture is gone: crossing the threshold afterwards arms nothing, and
    // the release commits no grip click.
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 0, clientY: 50, bubbles: true, buttons: 1 }))
    expect(document.querySelector(".rune-block-drag-preview")).toBeNull()
    document.dispatchEvent(new MouseEvent("mouseup", { clientX: 0, clientY: 50, bubbles: true }))
    expect(editor.state.selection).not.toBeInstanceOf(MultiBlockSelection)
    editor.destroy()
  })

  it("the gesture's own drop does not self-cancel (reorder still lands)", async () => {
    // Regression pin for the cleanup-before-dispatch ordering in onMouseUp:
    // the drop tr is docChanged, so if the gesture were still live when it
    // dispatched, the abort hook would cancel it mid-drop.
    const { editor, grip } = makeEditor()
    grip.dispatchEvent(new MouseEvent("mousedown", { clientX: 0, clientY: 10, bubbles: true }))
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 0, clientY: 50, bubbles: true, buttons: 1 }))
    document.dispatchEvent(new MouseEvent("mouseup", { clientX: 0, clientY: 50, bubbles: true }))

    await new Promise((r) => requestAnimationFrame(r))

    expect(editor.state.doc.child(0).textContent).toBe("B")
    expect(editor.state.doc.child(1).textContent).toBe("A")
    expect(gestureKey.getState(editor.state)?.activeGesture).toBeNull()
    expect(document.querySelector(".rune-block-drag-preview")).toBeNull()
    editor.destroy()
  })
})

describe("BlockDrag — layout runs never drop into a column (COL-1)", () => {
  it("dragging a columnLayout over another layout's column does NOT commit a nested move", async () => {
    // COL-1 regression: `maybeReSnapshotSurface` swapped to a COLUMN surface
    // with no layout-run gate, so dragging a layout's grip over another
    // layout's column offered a drop slot there and executeReorder committed
    // a nested move (which ColumnsNormalization then flattened — destroying
    // the dragged layout). The command-level contract is pinned in
    // `api/commands/columnTargets.test.ts` ("moveBlocks — no-nesting guard");
    // this exercises the DRAG seam: the gesture must keep treating the cursor
    // as root-surface for a layout run, never offering a column drop slot.
    container.className = "rune-editor"
    const editor = createTestEditor({
      kit: { suggestionMenus: false },
      element: container,
    })
    const s = editor.schema
    const para = (id: string, t: string) =>
      s.nodes.paragraph!.create({ id, depth: 0 }, s.text(t))
    const col = (id: string, ...children: import("@tiptap/pm/model").Node[]) =>
      s.nodes.column!.create({ id, width: 1 }, children)
    const doc = s.nodes.doc!.create(null, [
      para("r1", "root-1"),
      s.nodes.columnLayout!.create({ id: "lay1", depth: 0 }, [
        col("col_a", para("a1", "A1")),
        col("col_b", para("b1", "B1")),
      ]),
      s.nodes.columnLayout!.create({ id: "lay2", depth: 0 }, [
        col("col_c", para("c1", "C1")),
        col("col_d", para("d1", "D1")),
      ]),
      para("r2", "root-2"),
    ])
    editor.view.dispatch(
      editor.state.tr.replaceWith(0, editor.state.doc.content.size, doc.content),
    )

    // lay2's top-level pos: r1 + lay1.
    const lay2Pos =
      editor.state.doc.child(0).nodeSize + editor.state.doc.child(1).nodeSize

    // Give lay1's FIRST column (col_a) a real rect so surfaceFromPoint sees
    // the cursor inside it; every other rect stays jsdom-zero.
    const colAEl = container.querySelector<HTMLElement>("[data-rune-column]")!
    colAEl.getBoundingClientRect = () =>
      ({ top: 100, bottom: 200, left: 0, right: 100, width: 100, height: 100, x: 0, y: 100, toJSON: () => ({}) }) as DOMRect

    editor.view.dispatch(editor.state.tr.setMeta(sideMenuKey, { hoveredPos: lay2Pos }))
    const grip = container.querySelector(".rune-side-menu-grip") as HTMLButtonElement
    expect(grip).not.toBeNull()

    // Grip lay2, cross the threshold landing INSIDE col_a's rect, release.
    grip.dispatchEvent(new MouseEvent("mousedown", { clientX: 0, clientY: 10, bubbles: true }))
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 50, clientY: 150, bubbles: true, buttons: 1 }))
    document.dispatchEvent(new MouseEvent("mouseup", { clientX: 50, clientY: 150, bubbles: true }))

    await new Promise((r) => requestAnimationFrame(r))

    // Both layouts survive AT ROOT (a root-level reorder of lay2 is fine; a
    // drop INTO col_a is not — normalization would flatten lay2 away).
    const rootTypes: string[] = []
    editor.state.doc.forEach((node) => rootTypes.push(node.type.name))
    expect(rootTypes.filter((t) => t === "columnLayout")).toHaveLength(2)
    // col_a kept exactly its own child — nothing nested/flattened into it.
    const lay1 = editor.state.doc.child(1)
    expect(lay1.attrs.id).toBe("lay1")
    expect(lay1.child(0).childCount).toBe(1)
    expect(lay1.child(0).child(0).attrs.id).toBe("a1")
    expect(gestureKey.getState(editor.state)?.activeGesture).toBeNull()
  })
})

describe("BlockDrag — native selected-text DnD suppression", () => {
  it("preventDefaults dragstart events that bubble up from editor content", () => {
    // Native HTML5 drag-and-drop of a text selection inside contenteditable
    // would otherwise (a) let PM dropcursor paint a stray indicator and
    // (b) let the browser move/copy the selected text on drop. We disable
    // the gesture entirely to match Notion: selected-text drag is a no-op,
    // only the grip / padding paths move blocks.
    const editor = new Editor({
      element: container,
      extensions: [Document, Text, Para, BlockDrag],
      content: "<p>hello world</p>",
    })

    const pDom = container.querySelector("p")!
    const event = new Event("dragstart", { bubbles: true, cancelable: true })
    pDom.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)

    editor.destroy()
  })
})
