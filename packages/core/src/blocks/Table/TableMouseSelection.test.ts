// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, it, expect, beforeAll, afterEach } from "vitest"
import { Editor } from "@tiptap/core"
import Document from "@tiptap/extension-document"
import Text from "@tiptap/extension-text"
import { TextSelection } from "@tiptap/pm/state"
import { CellSelection } from "@tiptap/pm/tables"
import { Paragraph } from "../Paragraph/block"
import { Table } from "./block"
import { gestureKey, GestureStatePlugin } from "../../extensions/shared/gesture-state"

// jsdom doesn't implement Document.elementFromPoint, which prosemirror-view's
// posAtCoords falls back to when our test's synthetic mouse events flow
// through PM core / tableEditing's own (non-stubbed) handlers. Polyfill a
// no-op so those handlers see "no element here" instead of throwing — they
// then return null and bail cleanly.
beforeAll(() => {
  if (!(document as Document & { elementFromPoint?: unknown }).elementFromPoint) {
    (document as Document & { elementFromPoint: () => Element | null }).elementFromPoint = () => null
  }
})

// Destroy-hardening: each test that creates an editor should call
// editor.destroy() at the end, but we add a belt-and-suspenders afterEach
// that catches any test that forgets. Guard with isDestroyed so it's
// idempotent even when the per-test destroy already ran.
const _editorsToDestroy: Editor[] = []
afterEach(() => {
  for (const e of _editorsToDestroy) {
    if (!e.isDestroyed) e.destroy()
  }
  _editorsToDestroy.length = 0
})

function makeEditor() {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: [
      Document, Text, Paragraph,
      Table,
      GestureStatePlugin,
    ],
  })
  _editorsToDestroy.push(editor)
  return editor
}

// Build a posAtCoords stub keyed by clientX. The plugin should resolve
// the cell at (clientX, clientY) via posAtCoords, so we map a small set
// of x-values to known positions inside specific cells.
function stubPosAtCoords(editor: Editor, mapping: Record<number, number>) {
  const orig = editor.view.posAtCoords.bind(editor.view)
  editor.view.posAtCoords = ((coords: { left: number; top: number }) => {
    const pos = mapping[coords.left]
    // `inside: -1` signals "not inside a leaf node" so PM's own MouseDown
    // handler resolves via `doc.resolve(pos).parent` instead of trying
    // `doc.nodeAt(inside)` (which can be null for our paragraph-interior
    // positions and throws). Our plugin only reads `pos`.
    if (pos !== undefined) return { pos, inside: -1 }
    return orig(coords)
  }) as typeof editor.view.posAtCoords
}

// Locate the position inside the i-th cell of the first table.
function posInsideCell(editor: Editor, index: number): number {
  let count = 0
  let pos = -1
  editor.state.doc.descendants((node, p) => {
    const role = node.type.spec.tableRole
    if (role === "cell" || role === "header_cell") {
      if (count === index) pos = p + 2 // +1 to enter cell, +1 to enter tableParagraph
      count += 1
    }
  })
  if (pos < 0) throw new Error(`no cell at index ${index}`)
  return pos
}

describe("TableMouseSelection — gates", () => {
  it("skips selection-drag setup when target is a pill", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 2 })
    const fakePill = document.createElement("button")
    fakePill.className = "rune-col-pill"
    editor.view.dom.appendChild(fakePill)
    const selBefore = editor.state.selection
    fakePill.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 10, clientY: 10 }))
    expect(editor.state.selection).toBe(selBefore)
    editor.destroy()
  })

  it("bails when PM root has resize-cursor class", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 2 })
    editor.view.dom.classList.add("resize-cursor")
    const cellEl = editor.view.dom.querySelector("td, th") as HTMLElement
    const selBefore = editor.state.selection
    cellEl.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 10, clientY: 10 }))
    expect(editor.state.selection).toBe(selBefore)
    editor.view.dom.classList.remove("resize-cursor")
    editor.destroy()
  })
})

describe("TableMouseSelection — happy path (REQUIRED)", () => {
  it("cross-cell drag dispatches CellSelection", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 2 })
    const cellA = posInsideCell(editor, 0) // header cell A1
    const cellB = posInsideCell(editor, 1) // header cell B1
    stubPosAtCoords(editor, { 10: cellA, 100: cellB })

    const cellEl = editor.view.dom.querySelector("td, th") as HTMLElement
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, clientX: 10, clientY: 10 })
    cellEl.dispatchEvent(down)

    const move = new MouseEvent("mousemove", { bubbles: true, cancelable: true, button: 0, clientX: 100, clientY: 10, buttons: 1 })
    document.dispatchEvent(move)

    expect(editor.state.selection).toBeInstanceOf(CellSelection)
    editor.destroy()
  })

  it("mousedown only (no move) does not dispatch CellSelection", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 2 })
    const cellA = posInsideCell(editor, 0)
    stubPosAtCoords(editor, { 10: cellA })
    const before = editor.state.selection

    const cellEl = editor.view.dom.querySelector("td, th") as HTMLElement
    cellEl.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 10, clientY: 10 }))
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0, clientX: 10, clientY: 10 }))

    expect(editor.state.selection).toBe(before)
    editor.destroy()
  })

  // Intra-cell drag → stays TextSelection: covered in e2e (table-mouse-selection.spec.ts)
  // and not unit-testable in isolation. prosemirror-tables' `tableEditing` plugin runs
  // its own document-level mousemove (registered inside its own mousedown handler) and
  // in jsdom dispatches a CellSelection because synthetic MouseEvents have
  // `target === document`, bypassing tableEditing's `event.target != startDOMCell`
  // self-bail. Real browsers route the event with the actual cell target and
  // tableEditing self-bails, so the e2e assertion holds. We refuse to add a
  // `stopImmediatePropagation` workaround in production to make this jsdom case pass —
  // that would silently suppress legitimate document-level mousemove listeners in host
  // applications. See PR review thread for rationale.

  it("clears drag state on mouseup so subsequent mousemove does nothing", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 2 })
    const cellA = posInsideCell(editor, 0)
    const cellB = posInsideCell(editor, 1)
    stubPosAtCoords(editor, { 10: cellA, 100: cellB })

    const cellEl = editor.view.dom.querySelector("td, th") as HTMLElement
    cellEl.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 10, clientY: 10 }))
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0, clientX: 10, clientY: 10 }))

    const beforeStrayMove = editor.state.selection
    document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, button: 0, clientX: 100, clientY: 10, buttons: 1 }))
    expect(editor.state.selection).toBe(beforeStrayMove)
    editor.destroy()
  })
})

describe("TableMouseSelection — does NOT do global selection coercion", () => {
  // Regression guards. These prove the appendTransaction branch was dropped.
  it("does not coerce a programmatic cross-cell TextSelection into CellSelection", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 2 })
    let a = -1, b = -1
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "tableParagraph") {
        if (a === -1) a = pos + 1
        else if (b === -1) b = pos + 1
      }
    })
    editor.view.dispatch(editor.state.tr.setSelection(
      TextSelection.create(editor.state.doc, a, b),
    ))
    expect(editor.state.selection).toBeInstanceOf(TextSelection)
    editor.destroy()
  })

  it("leaves intra-cell TextSelection alone", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 2 })
    expect(editor.state.selection).toBeInstanceOf(TextSelection)
    editor.destroy()
  })
})

// ---------------------------------------------------------------------------
// GS-2 probes — button filtering and lost-mouseup watchdog
// ---------------------------------------------------------------------------

describe("TableMouseSelection — GS-2(a): non-primary mouseup does not end gesture", () => {
  it("right-click mouseup during a cross-cell drag does NOT release the gesture; primary mouseup ends it", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 2 })
    const cellA = posInsideCell(editor, 0)
    const cellB = posInsideCell(editor, 1)
    stubPosAtCoords(editor, { 10: cellA, 100: cellB })

    // Start drag: mousedown in cell A
    const cellEl = editor.view.dom.querySelector("td, th") as HTMLElement
    cellEl.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, clientX: 10, clientY: 10 }))

    // Move into cell B — should promote to CellSelection and claim the registry
    document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, cancelable: true, button: 0, clientX: 100, clientY: 10, buttons: 1 }))
    expect(editor.state.selection).toBeInstanceOf(CellSelection)

    // Registry should be claimed as "table-select" at this point
    expect(gestureKey.getState(editor.state)?.activeGesture).toBe("table-select")

    // Non-primary mouseup (button: 2 = right button) — must NOT release the registry
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, button: 2, clientX: 100, clientY: 10 }))

    // Registry still owned by table-select
    expect(gestureKey.getState(editor.state)?.activeGesture).toBe("table-select")
    // rune-dragging still present (drag not ended)
    expect(editor.view.dom.classList.contains("rune-dragging")).toBe(true)

    // Now primary mouseup (button: 0) — should fully release
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, button: 0, clientX: 100, clientY: 10 }))

    // Registry released
    expect(gestureKey.getState(editor.state)?.activeGesture).toBeNull()
    // rune-dragging removed
    expect(editor.view.dom.classList.contains("rune-dragging")).toBe(false)

    editor.destroy()
  })
})

describe("TableMouseSelection — GS-2(b): lost-mouseup (buttons:0 in mousemove) runs full cleanup", () => {
  it("mousemove with buttons:0 releases registry, removes rune-dragging, and stops further moves", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 2 })
    const cellA = posInsideCell(editor, 0)
    const cellB = posInsideCell(editor, 1)
    stubPosAtCoords(editor, { 10: cellA, 100: cellB })

    // Start drag
    const cellEl = editor.view.dom.querySelector("td, th") as HTMLElement
    cellEl.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, clientX: 10, clientY: 10 }))

    // Move into cell B — promotes to CellSelection, claims registry, adds rune-dragging
    document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, cancelable: true, button: 0, clientX: 100, clientY: 10, buttons: 1 }))
    expect(editor.state.selection).toBeInstanceOf(CellSelection)
    expect(gestureKey.getState(editor.state)?.activeGesture).toBe("table-select")
    expect(editor.view.dom.classList.contains("rune-dragging")).toBe(true)

    // Simulate OS-level mouseup loss: mousemove with buttons:0 (primary lost)
    document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, cancelable: true, button: 0, clientX: 100, clientY: 10, buttons: 0 }))

    // Full cleanup: registry released
    expect(gestureKey.getState(editor.state)?.activeGesture).toBeNull()
    // rune-dragging class removed
    expect(editor.view.dom.classList.contains("rune-dragging")).toBe(false)

    // startCellPos reset: a stray mousemove with buttons:1 should no longer dispatch
    const selAfterAbort = editor.state.selection
    document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, cancelable: true, button: 0, clientX: 100, clientY: 10, buttons: 1 }))
    expect(editor.state.selection).toBe(selAfterAbort)

    editor.destroy()
  })
})

describe("TableMouseSelection — GS-6: claim refusal leads to full local cleanup", () => {
  it("when another gesture owns the registry at promotion time, armed state is cleared", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 2 })
    const cellA = posInsideCell(editor, 0)
    const cellB = posInsideCell(editor, 1)
    stubPosAtCoords(editor, { 10: cellA, 100: cellB })

    // Pre-claim the registry with another gesture
    editor.view.dispatch(
      editor.state.tr.setMeta(gestureKey, { activeGesture: "block-drag" }),
    )
    expect(gestureKey.getState(editor.state)?.activeGesture).toBe("block-drag")

    // Start a table drag
    const cellEl = editor.view.dom.querySelector("td, th") as HTMLElement
    cellEl.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, clientX: 10, clientY: 10 }))

    // Move into cell B — claim will be refused
    document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, cancelable: true, button: 0, clientX: 100, clientY: 10, buttons: 1 }))

    // Registry still belongs to block-drag (table-select did NOT steal it)
    expect(gestureKey.getState(editor.state)?.activeGesture).toBe("block-drag")

    // The plugin must NOT have rune-dragging hanging around
    expect(editor.view.dom.classList.contains("rune-dragging")).toBe(false)

    // Armed state cleared: a subsequent stray mousemove does nothing
    const selAfterRefusal = editor.state.selection
    document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, cancelable: true, button: 0, clientX: 100, clientY: 10, buttons: 1 }))
    expect(editor.state.selection).toBe(selAfterRefusal)

    editor.destroy()
  })
})

// ---------------------------------------------------------------------------
// RC-3 probes — Escape / window-blur / pointercancel cancellation
// ---------------------------------------------------------------------------
// RC-3 pins: an armed gesture must release the registry and clear
// rune-dragging on Escape / window blur (via registerDragCancelHandlers).
// These follow the same arm-then-cancel pattern as the GS-2 tests above.

describe("TableMouseSelection — RC-3: Escape cancels an armed gesture", () => {
  it("Escape keydown releases the registry and removes rune-dragging", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 2 })
    const cellA = posInsideCell(editor, 0)
    const cellB = posInsideCell(editor, 1)
    stubPosAtCoords(editor, { 10: cellA, 100: cellB })

    // Arm: mousedown in cell A, mousemove into cell B → CellSelection + registry claimed
    const cellEl = editor.view.dom.querySelector("td, th") as HTMLElement
    cellEl.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, clientX: 10, clientY: 10 }))
    document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, cancelable: true, button: 0, clientX: 100, clientY: 10, buttons: 1 }))

    expect(editor.state.selection).toBeInstanceOf(CellSelection)
    expect(gestureKey.getState(editor.state)?.activeGesture).toBe("table-select")
    expect(editor.view.dom.classList.contains("rune-dragging")).toBe(true)

    // Cancel via Escape — drag-utils listens on document for keydown
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))

    // Registry released
    expect(gestureKey.getState(editor.state)?.activeGesture).toBeNull()
    // rune-dragging class removed
    expect(editor.view.dom.classList.contains("rune-dragging")).toBe(false)

    editor.destroy()
  })
})

describe("TableMouseSelection — RC-3: window blur cancels an armed gesture", () => {
  it("window blur event releases the registry and removes rune-dragging", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 2 })
    const cellA = posInsideCell(editor, 0)
    const cellB = posInsideCell(editor, 1)
    stubPosAtCoords(editor, { 10: cellA, 100: cellB })

    // Arm: mousedown in cell A, mousemove into cell B → CellSelection + registry claimed
    const cellEl = editor.view.dom.querySelector("td, th") as HTMLElement
    cellEl.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, clientX: 10, clientY: 10 }))
    document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, cancelable: true, button: 0, clientX: 100, clientY: 10, buttons: 1 }))

    expect(editor.state.selection).toBeInstanceOf(CellSelection)
    expect(gestureKey.getState(editor.state)?.activeGesture).toBe("table-select")
    expect(editor.view.dom.classList.contains("rune-dragging")).toBe(true)

    // Cancel via window blur — drag-utils listens on window for blur
    window.dispatchEvent(new Event("blur"))

    // Registry released
    expect(gestureKey.getState(editor.state)?.activeGesture).toBeNull()
    // rune-dragging class removed
    expect(editor.view.dom.classList.contains("rune-dragging")).toBe(false)

    editor.destroy()
  })
})

describe("TableMouseSelection — editable-flip abort", () => {
  it("mid-gesture mousemove with view.editable=false aborts (ends drag without releasing already-dispatched selection)", () => {
    const editor = makeEditor()
    editor.commands.insertTable({ rows: 2, cols: 2 })
    const cellA = posInsideCell(editor, 0)
    const cellB = posInsideCell(editor, 1)
    stubPosAtCoords(editor, { 10: cellA, 100: cellB })

    // Start drag
    const cellEl = editor.view.dom.querySelector("td, th") as HTMLElement
    cellEl.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, clientX: 10, clientY: 10 }))

    // Move to cell B — claims registry, sets CellSelection
    document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, cancelable: true, button: 0, clientX: 100, clientY: 10, buttons: 1 }))
    expect(editor.state.selection).toBeInstanceOf(CellSelection)

    // Flip to non-editable (e.g. read-only mode)
    editor.setEditable(false)

    // Mid-gesture mousemove — plugin must abort: release registry, remove rune-dragging, clear armed state
    document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, cancelable: true, button: 0, clientX: 100, clientY: 10, buttons: 1 }))

    // Registry released
    expect(gestureKey.getState(editor.state)?.activeGesture).toBeNull()
    // rune-dragging removed
    expect(editor.view.dom.classList.contains("rune-dragging")).toBe(false)

    // Selection is preserved (selection-only gesture: editable-flip ends drag, leaves selection)
    expect(editor.state.selection).toBeInstanceOf(CellSelection)

    editor.destroy()
  })
})
