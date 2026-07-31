// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, it, expect, beforeEach } from "vitest"
import { Editor } from "@tiptap/core"
import Document from "@tiptap/extension-document"
import Text from "@tiptap/extension-text"
import { History } from "@tiptap/extension-history"
import { TextSelection } from "@tiptap/pm/state"
import { Paragraph, Heading, Divider } from "../../blocks"
import { NodeSelection } from "@tiptap/pm/state"
import { BlockId } from "../block-id"
import { BlockSelection, blockSelectionKey } from "./index"
import { getBlockSelectionApi } from "./plugin"
import { MultiBlockSelection } from "./MultiBlockSelection"
import { surfaceChildrenAt } from "../../schema/bodySurface"
import { createTestEditor } from "../../test-utils/createTestEditor"

beforeEach(() => {
  // jsdom lacks elementFromPoint; PM's default mousedown handler calls
  // it via posAtCoords and throws an unhandled error otherwise.
  if (typeof document.elementFromPoint !== "function") {
    ;(document as unknown as { elementFromPoint: (x: number, y: number) => Element | null }).elementFromPoint = () => null
  }
})

function makeEditor() {
  const element = document.createElement("div")
  document.body.appendChild(element)
  return new Editor({
    element,
    extensions: [Document, Text, Paragraph, Heading, History, BlockId, BlockSelection],
    content: {
      type: "doc",
      content: Array.from({ length: 6 }, (_, i) => ({
        type: "paragraph",
        content: [{ type: "text", text: `Block ${i + 1}` }],
      })),
    } as never,
  })
}

describe("BlockSelectionPlugin state", () => {
  it("initial anchorBlockId is null", () => {
    const editor = makeEditor()
    const state = blockSelectionKey.getState(editor.state)
    expect(state?.anchorBlockId).toBeNull()
    editor.destroy()
  })

  it("meta { setAnchor: id } sets anchorBlockId", () => {
    const editor = makeEditor()
    const firstBlockId = (editor.state.doc.child(0).attrs.id as string) ?? null
    expect(firstBlockId).toBeTruthy()
    const tr = editor.state.tr
      .setSelection(MultiBlockSelection.create(editor.state.doc, 0, 0))
      .setMeta(blockSelectionKey, { setAnchor: firstBlockId })
    editor.view.dispatch(tr)
    expect(blockSelectionKey.getState(editor.state)?.anchorBlockId).toBe(firstBlockId)
    editor.destroy()
  })

  it("transaction without meta preserves anchorBlockId (shift-extend path)", () => {
    const editor = makeEditor()
    const firstId = editor.state.doc.child(0).attrs.id as string
    editor.view.dispatch(
      editor.state.tr
        .setSelection(MultiBlockSelection.create(editor.state.doc, 0, 0))
        .setMeta(blockSelectionKey, { setAnchor: firstId }),
    )
    // Now extend without resetting anchor.
    editor.view.dispatch(
      editor.state.tr.setSelection(MultiBlockSelection.create(editor.state.doc, 0, 2)),
    )
    expect(blockSelectionKey.getState(editor.state)?.anchorBlockId).toBe(firstId)
    editor.destroy()
  })

  it("switching to TextSelection clears anchorBlockId", () => {
    const editor = makeEditor()
    const firstId = editor.state.doc.child(0).attrs.id as string
    editor.view.dispatch(
      editor.state.tr
        .setSelection(MultiBlockSelection.create(editor.state.doc, 0, 0))
        .setMeta(blockSelectionKey, { setAnchor: firstId }),
    )
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1)),
    )
    expect(blockSelectionKey.getState(editor.state)?.anchorBlockId).toBeNull()
    editor.destroy()
  })
})

describe("BlockSelectionPlugin decorations", () => {
  it("emits data-block-selected on every block inside the range, nothing else", () => {
    const editor = makeEditor()
    editor.view.dispatch(
      editor.state.tr.setSelection(MultiBlockSelection.create(editor.state.doc, 1, 3)),
    )
    // Flush one tick so PM re-renders decorations.
    return Promise.resolve().then(() => {
      const selected = Array.from(
        editor.view.dom.querySelectorAll('[data-block-selected="true"]'),
      )
      expect(selected).toHaveLength(3)
      expect(selected.map((el) => (el as HTMLElement).textContent)).toEqual([
        "Block 2",
        "Block 3",
        "Block 4",
      ])
      editor.destroy()
    })
  })

  it("decorations clear when selection reverts to TextSelection", () => {
    const editor = makeEditor()
    editor.view.dispatch(
      editor.state.tr.setSelection(MultiBlockSelection.create(editor.state.doc, 0, 2)),
    )
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1)),
    )
    return Promise.resolve().then(() => {
      const selected = editor.view.dom.querySelectorAll('[data-block-selected="true"]')
      expect(selected).toHaveLength(0)
      editor.destroy()
    })
  })
})

// The plugin no longer listens to grip mousedown — block-drag/gesture.ts
// is the single arbiter of the grip gesture and calls applyGripClick on
// a release-without-threshold-cross. Tests below exercise the plugin's
// click-application contract directly via the exported API. End-to-end
// wiring (mousedown → mouseup with no movement → applyGripClick) is
// covered in BlockDrag.test.ts, and the "drag does NOT set MBS" guard
// lives there too.
describe("BlockSelectionPlugin applyGripClick (plain click)", () => {
  function blockPosByIndex(
    editor: import("@tiptap/core").Editor,
    blockIndex: number,
  ): number {
    let pos = 0
    for (let i = 0; i < blockIndex; i++) pos += editor.state.doc.child(i).nodeSize
    return pos
  }

  it("applyGripClick on a block → MultiBlockSelection on that block; anchor set", () => {
    const editor = makeEditor()
    const thirdId = editor.state.doc.child(2).attrs.id as string
    expect(thirdId).toBeTruthy()

    const api = getBlockSelectionApi(editor.view)
    expect(api).toBeDefined()
    const snapshot = api!.snapshotForGripDown()
    api!.applyGripClick({ blockPos: blockPosByIndex(editor, 2), shiftKey: false, snapshot })

    expect(editor.state.selection).toBeInstanceOf(MultiBlockSelection)
    expect((editor.state.selection as MultiBlockSelection).blockIndices).toEqual([2, 2])
    expect(blockSelectionKey.getState(editor.state)?.anchorBlockId).toBe(thirdId)
    editor.destroy()
  })

  it("plain click with multi-block range → MBS spans the whole range; anchor at gripped block", () => {
    // Parity with drag path: when dragSourceRange extends over a list
    // chain / toggle subtree, a no-drag release must select the same
    // span (not just the gripped block) so the click visual matches
    // what the drag picks up.
    const editor = makeEditor()
    const headId = editor.state.doc.child(1).attrs.id as string
    const head = blockPosByIndex(editor, 1)
    const tail = blockPosByIndex(editor, 4) // exclusive end == start of block 4
    const api = getBlockSelectionApi(editor.view)!
    api.applyGripClick({
      blockPos: head,
      range: { from: head, to: tail },
      shiftKey: false,
      snapshot: api.snapshotForGripDown(),
    })

    expect(editor.state.selection).toBeInstanceOf(MultiBlockSelection)
    expect((editor.state.selection as MultiBlockSelection).blockIndices).toEqual([1, 3])
    // Anchor stays on the gripped block (range head), so subsequent
    // shift-extend pivots around the user-clicked target.
    expect(blockSelectionKey.getState(editor.state)?.anchorBlockId).toBe(headId)
    editor.destroy()
  })

  it("applyGripClick on the only-selected block closes dropdown but PRESERVES MBS", () => {
    const editor = makeEditor()
    const api = getBlockSelectionApi(editor.view)!
    const blockPos = blockPosByIndex(editor, 2)
    const thirdId = editor.state.doc.child(2).attrs.id as string

    // First click opens MBS=[2,2] + dropdown.
    api.applyGripClick({ blockPos, shiftKey: false, snapshot: api.snapshotForGripDown() })
    expect(editor.state.selection).toBeInstanceOf(MultiBlockSelection)
    expect(blockSelectionKey.getState(editor.state)?.dropdownBlockId).toBe(thirdId)

    // Second click — snapshot sees MBS + dropdown open → close dropdown,
    // MBS persists (spec §1.1).
    api.applyGripClick({ blockPos, shiftKey: false, snapshot: api.snapshotForGripDown() })
    expect(editor.state.selection).toBeInstanceOf(MultiBlockSelection)
    expect((editor.state.selection as MultiBlockSelection).blockIndices).toEqual([2, 2])
    expect(blockSelectionKey.getState(editor.state)?.anchorBlockId).toBe(thirdId)
    expect(blockSelectionKey.getState(editor.state)?.dropdownBlockId).toBeNull()
    editor.destroy()
  })

  it("applyGripClick uses snapshot to survive mid-click override (re-asserts MBS at mouseup)", () => {
    const editor = makeEditor()
    const api = getBlockSelectionApi(editor.view)!
    const blockPos = blockPosByIndex(editor, 2)
    const thirdId = editor.state.doc.child(2).attrs.id as string

    // First click sets MBS + opens dropdown.
    api.applyGripClick({ blockPos, shiftKey: false, snapshot: api.snapshotForGripDown() })
    expect(editor.state.selection).toBeInstanceOf(MultiBlockSelection)

    // Capture snapshot at "mousedown" — sees MBS + dropdownBlockId.
    const snapshot = api.snapshotForGripDown()
    expect(snapshot.sel).toBeInstanceOf(MultiBlockSelection)
    expect(snapshot.dropdownBlockId).toBe(thirdId)

    // Simulate a stray pointer-tagged override between mousedown and
    // mouseup (DOMObserver dispatching a TextSelection from Chrome's
    // autonomous caret placement) — this is what we have to defend.
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1)),
    )
    expect(editor.state.selection).not.toBeInstanceOf(MultiBlockSelection)

    // Now the deferred mouseup fires applyGripClick with the pre-override
    // snapshot. The in-MBS branch must close the dropdown AND re-assert
    // MBS in the same dispatch, painting over the override.
    api.applyGripClick({ blockPos, shiftKey: false, snapshot })
    expect(editor.state.selection).toBeInstanceOf(MultiBlockSelection)
    expect((editor.state.selection as MultiBlockSelection).blockIndices).toEqual([2, 2])
    expect(blockSelectionKey.getState(editor.state)?.anchorBlockId).toBe(thirdId)
    expect(blockSelectionKey.getState(editor.state)?.dropdownBlockId).toBeNull()
    editor.destroy()
  })
})

describe("BlockSelectionPlugin applyGripClick (shift-click extend)", () => {
  function applyAt(
    editor: import("@tiptap/core").Editor,
    blockIndex: number,
    opts: { shiftKey?: boolean } = {},
  ) {
    let pos = 0
    for (let i = 0; i < blockIndex; i++) pos += editor.state.doc.child(i).nodeSize
    const api = getBlockSelectionApi(editor.view)!
    api.applyGripClick({
      blockPos: pos,
      shiftKey: opts.shiftKey ?? false,
      snapshot: api.snapshotForGripDown(),
    })
  }

  it("plain click then shift-click extends range forward, anchor fixed", () => {
    const editor = makeEditor()
    const thirdId = editor.state.doc.child(2).attrs.id as string

    applyAt(editor, 2) // anchor = block 3
    applyAt(editor, 5, { shiftKey: true }) // extend to block 6

    const sel = editor.state.selection as MultiBlockSelection
    expect(sel).toBeInstanceOf(MultiBlockSelection)
    expect(sel.blockIndices).toEqual([2, 5])
    expect(blockSelectionKey.getState(editor.state)?.anchorBlockId).toBe(thirdId)
    editor.destroy()
  })

  it("shift-click backward uses anchor as pivot (range flips)", () => {
    const editor = makeEditor()
    const thirdId = editor.state.doc.child(2).attrs.id as string

    applyAt(editor, 2) // anchor = block 3
    applyAt(editor, 0, { shiftKey: true }) // shift-click block 1

    const sel = editor.state.selection as MultiBlockSelection
    expect(sel.blockIndices).toEqual([0, 2])
    expect(blockSelectionKey.getState(editor.state)?.anchorBlockId).toBe(thirdId)
    editor.destroy()
  })

  it("shift-click with no prior anchor behaves like a plain click", () => {
    const editor = makeEditor()
    const fourthId = editor.state.doc.child(3).attrs.id as string
    applyAt(editor, 3, { shiftKey: true })
    const sel = editor.state.selection as MultiBlockSelection
    expect(sel.blockIndices).toEqual([3, 3])
    expect(blockSelectionKey.getState(editor.state)?.anchorBlockId).toBe(fourthId)
    editor.destroy()
  })
})

describe("plugin state — dropdownBlockId", () => {
  it("initial state has dropdownBlockId === null", () => {
    const editor = makeEditor()
    expect(blockSelectionKey.getState(editor.state)?.dropdownBlockId).toBeNull()
    editor.destroy()
  })

  it("setMeta { openDropdownFor: id } sets dropdownBlockId", () => {
    const editor = makeEditor()
    const id = editor.state.doc.child(0).attrs.id as string
    editor.view.dispatch(
      editor.state.tr.setMeta(blockSelectionKey, { openDropdownFor: id }),
    )
    expect(blockSelectionKey.getState(editor.state)?.dropdownBlockId).toBe(id)
    editor.destroy()
  })

  it("setMeta { closeDropdown: true } clears dropdownBlockId without changing selection", () => {
    const editor = makeEditor()
    const id = editor.state.doc.child(0).attrs.id as string
    editor.commands.setBlockSelection({ from: 0, to: 0 })
    editor.view.dispatch(
      editor.state.tr.setMeta(blockSelectionKey, { openDropdownFor: id }),
    )
    const selBefore = editor.state.selection
    editor.view.dispatch(
      editor.state.tr.setMeta(blockSelectionKey, { closeDropdown: true }),
    )
    expect(blockSelectionKey.getState(editor.state)?.dropdownBlockId).toBeNull()
    expect(editor.state.selection.eq(selBefore)).toBe(true)
    editor.destroy()
  })

  it("docChanged transaction that deletes dropdown block nulls dropdownBlockId", () => {
    const editor = makeEditor()
    const id = editor.state.doc.child(1).attrs.id as string
    editor.view.dispatch(
      editor.state.tr.setMeta(blockSelectionKey, { openDropdownFor: id }),
    )
    expect(blockSelectionKey.getState(editor.state)?.dropdownBlockId).toBe(id)
    // Delete block 1 (positions: block 0 size + 0, block 0 size + nodeSize(block1))
    const block0Size = editor.state.doc.child(0).nodeSize
    const block1Size = editor.state.doc.child(1).nodeSize
    editor.view.dispatch(
      editor.state.tr.delete(block0Size, block0Size + block1Size),
    )
    expect(blockSelectionKey.getState(editor.state)?.dropdownBlockId).toBeNull()
    editor.destroy()
  })
})

describe("grip click — dropdownBlockId", () => {
  function gripClick(
    editor: import("@tiptap/core").Editor,
    blockIdx: number,
    shiftKey = false,
  ) {
    const api = getBlockSelectionApi(editor.view)
    if (!api) throw new Error("plugin api missing")
    const snapshot = api.snapshotForGripDown()
    let pos = 0
    for (let i = 0; i < blockIdx; i++) pos += editor.state.doc.child(i).nodeSize
    api.applyGripClick({ blockPos: pos, shiftKey, snapshot })
  }

  it("idle block → MBS set + dropdownBlockId === clickedId", () => {
    const editor = makeEditor()
    const id = editor.state.doc.child(1).attrs.id as string
    gripClick(editor, 1)
    expect(editor.state.selection).toBeInstanceOf(MultiBlockSelection)
    expect(blockSelectionKey.getState(editor.state)?.dropdownBlockId).toBe(id)
    editor.destroy()
  })

  it("re-click only-selected block → dropdownBlockId === null, MBS preserved", () => {
    const editor = makeEditor()
    const id = editor.state.doc.child(1).attrs.id as string
    gripClick(editor, 1)
    gripClick(editor, 1) // second click closes dropdown only
    expect(editor.state.selection).toBeInstanceOf(MultiBlockSelection)
    expect((editor.state.selection as MultiBlockSelection).blockIndices).toEqual([1, 1])
    expect(blockSelectionKey.getState(editor.state)?.anchorBlockId).toBe(id)
    expect(blockSelectionKey.getState(editor.state)?.dropdownBlockId).toBeNull()
    editor.destroy()
  })

  it("third click on the same block → dropdown reopens, MBS still preserved", () => {
    const editor = makeEditor()
    const id = editor.state.doc.child(1).attrs.id as string
    gripClick(editor, 1) // open
    gripClick(editor, 1) // close dropdown
    gripClick(editor, 1) // reopen
    expect(editor.state.selection).toBeInstanceOf(MultiBlockSelection)
    expect((editor.state.selection as MultiBlockSelection).blockIndices).toEqual([1, 1])
    expect(blockSelectionKey.getState(editor.state)?.dropdownBlockId).toBe(id)
    editor.destroy()
  })

  it("click block inside multi-block MBS → MBS unchanged + dropdownBlockId === clickedId", () => {
    const editor = makeEditor()
    editor.commands.setBlockSelection({ from: 0, to: 2 })
    const selBefore = editor.state.selection
    const id1 = editor.state.doc.child(1).attrs.id as string
    gripClick(editor, 1)
    expect(editor.state.selection.eq(selBefore)).toBe(true)
    expect(blockSelectionKey.getState(editor.state)?.dropdownBlockId).toBe(id1)
    editor.destroy()
  })

  it("shift-extend → dropdownBlockId === clickedId", () => {
    const editor = makeEditor()
    gripClick(editor, 0)
    const id2 = editor.state.doc.child(2).attrs.id as string
    gripClick(editor, 2, true)
    const sel = editor.state.selection as MultiBlockSelection
    expect(sel.blockIndices).toEqual([0, 2])
    expect(blockSelectionKey.getState(editor.state)?.dropdownBlockId).toBe(id2)
    editor.destroy()
  })
})

describe("BlockSelectionPlugin printable-char no-op", () => {
  it("typing 'a' over MultiBlockSelection: doc unchanged, selection unchanged", () => {
    const editor = makeEditor()
    editor.commands.setBlockSelection({ from: 1, to: 2 })
    const docBefore = editor.state.doc.toJSON()
    editor.view.dom.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "a",
        code: "KeyA",
        bubbles: true,
        cancelable: true,
      }),
    )
    expect(editor.state.doc.toJSON()).toEqual(docBefore)
    expect(editor.state.selection).toBeInstanceOf(MultiBlockSelection)
    editor.destroy()
  })

  it("Ctrl/Meta + letter passes through (shortcut chains keep working)", () => {
    const editor = makeEditor()
    editor.commands.setBlockSelection({ from: 0, to: 0 })
    const event = new KeyboardEvent("keydown", {
      key: "c",
      code: "KeyC",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    })
    editor.view.dom.dispatchEvent(event)
    // We don't consume it — the Cmd-C shortcut (if any) should flow through.
    expect(event.defaultPrevented).toBe(false)
    editor.destroy()
  })
})

describe("BlockSelectionPlugin outside-click dismissal", () => {
  // Bug repro: doc starts with a divider; user select-alls into MBS, then
  // clicks outside the editor to dismiss. The dismissal path resolves a
  // new selection from the first selected block's start position. Without
  // textOnly bias, PM's Selection.near returns a NodeSelection on the
  // divider (it's a selectable atom) — PM auto-applies
  // .ProseMirror-selectednode and the divider keeps the selected
  // background even though MBS is cleared.
  it("does not land NodeSelection on a divider when it is the first selected block", () => {
    const element = document.createElement("div")
    document.body.appendChild(element)
    const editor = new Editor({
      element,
      extensions: [Document, Text, Paragraph, Heading, Divider, History, BlockId, BlockSelection],
      content: {
        type: "doc",
        content: [
          { type: "divider" },
          { type: "paragraph", content: [{ type: "text", text: "after" }] },
        ],
      } as never,
    })

    // Enter MBS covering both blocks (matches user-visible "select all").
    editor.view.dispatch(
      editor.state.tr.setSelection(MultiBlockSelection.create(editor.state.doc, 0, 1)),
    )
    expect(editor.state.selection).toBeInstanceOf(MultiBlockSelection)

    // Click outside the editor — pointerdown on document.body bubbles up
    // to the capture-phase listener installed by the plugin.
    document.body.dispatchEvent(
      new MouseEvent("pointerdown", { button: 0, bubbles: true, cancelable: true }),
    )

    expect(editor.state.selection).not.toBeInstanceOf(MultiBlockSelection)
    // The actual regression: must NOT be a NodeSelection on the divider.
    expect(editor.state.selection).not.toBeInstanceOf(NodeSelection)

    editor.destroy()
    element.remove()
  })

  // Bug repro: user clicks the side-menu grip on a NodeSelection-friendly
  // atom (divider / equation block) → block enters a top-level
  // NodeSelection. PM only fires its own click-outside dismissal for
  // events that land inside .ProseMirror, so a click on the editor
  // gutter (left/right of content) used to leave the blue "selected"
  // background stuck until the user clicked below the last block.
  it("dismisses a top-level NodeSelection on a divider when clicking outside the editor", () => {
    const element = document.createElement("div")
    document.body.appendChild(element)
    const editor = new Editor({
      element,
      extensions: [Document, Text, Paragraph, Divider, History, BlockId, BlockSelection],
      content: {
        type: "doc",
        content: [
          { type: "divider" },
          { type: "paragraph", content: [{ type: "text", text: "after" }] },
        ],
      } as never,
    })

    // Land a NodeSelection on the divider (mirrors what the grip click
    // does for an equation block / divider).
    editor.view.dispatch(
      editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 0)),
    )
    expect(editor.state.selection).toBeInstanceOf(NodeSelection)

    document.body.dispatchEvent(
      new MouseEvent("pointerdown", { button: 0, bubbles: true, cancelable: true }),
    )

    // Selection must have moved off the divider (NodeSelection cleared).
    expect(editor.state.selection).not.toBeInstanceOf(NodeSelection)

    editor.destroy()
    element.remove()
  })
})

describe("BlockSelectionPlugin leading-atom initial selection", () => {
  // Bug repro: PM's EditorState.create defaults selection to
  // Selection.atStart(doc), which lands a NodeSelection on a selectable
  // leaf atom (e.g. divider) when it is the first block. PM auto-applies
  // .ProseMirror-selectednode, painting the divider as if it were
  // selected on a fresh, never-interacted-with editor. Same root cause
  // as the outside-click dismissal bug, different entry point.
  it("does not land NodeSelection on a leading divider on initial mount", () => {
    const element = document.createElement("div")
    document.body.appendChild(element)
    const editor = new Editor({
      element,
      extensions: [Document, Text, Paragraph, Heading, Divider, History, BlockId, BlockSelection],
      content: {
        type: "doc",
        content: [
          { type: "divider" },
          { type: "paragraph", content: [{ type: "text", text: "after" }] },
        ],
      } as never,
    })

    expect(editor.state.selection).not.toBeInstanceOf(NodeSelection)
    expect(editor.state.selection).toBeInstanceOf(TextSelection)

    editor.destroy()
    element.remove()
  })

  it("preserves a user-driven NodeSelection on a leading divider (e.g. arrow-into / explicit click)", () => {
    const element = document.createElement("div")
    document.body.appendChild(element)
    const editor = new Editor({
      element,
      extensions: [Document, Text, Paragraph, Heading, Divider, History, BlockId, BlockSelection],
      content: {
        type: "doc",
        content: [
          { type: "divider" },
          { type: "paragraph", content: [{ type: "text", text: "after" }] },
        ],
      } as never,
    })

    // After init normalization, selection is in the paragraph.
    // User explicitly NodeSelects the divider (mirrors a deliberate click
    // on the divider grip or arrow-up from the paragraph).
    editor.view.dispatch(
      editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 0)),
    )

    // Normalization is a one-shot at mount; it must not undo subsequent
    // deliberate selections.
    expect(editor.state.selection).toBeInstanceOf(NodeSelection)

    editor.destroy()
    element.remove()
  })

  it("leaves selection alone in an all-atom doc (degenerate case)", () => {
    const element = document.createElement("div")
    document.body.appendChild(element)
    const editor = new Editor({
      element,
      extensions: [Document, Text, Paragraph, Heading, Divider, History, BlockId, BlockSelection],
      content: {
        type: "doc",
        content: [{ type: "divider" }],
      } as never,
    })

    // No textblock exists to host a caret. Normalization should be a
    // no-op (findFrom with textOnly=true returns null) rather than
    // looping or throwing.
    expect(() => editor.state.selection).not.toThrow()

    editor.destroy()
    element.remove()
  })
})

import { positionOfBlockId } from "./plugin"

describe("positionOfBlockId", () => {
  it("returns absolute position of the block whose id matches", () => {
    const editor = makeEditor()
    const id2 = editor.state.doc.child(2).attrs.id as string
    const expected =
      editor.state.doc.child(0).nodeSize + editor.state.doc.child(1).nodeSize
    expect(positionOfBlockId(editor.state.doc, id2)).toBe(expected)
    editor.destroy()
  })

  it("returns -1 when id is not found", () => {
    const editor = makeEditor()
    expect(positionOfBlockId(editor.state.doc, "no-such-id")).toBe(-1)
    editor.destroy()
  })
})

import { openBlockActionsDropdown } from "./plugin"

describe("openBlockActionsDropdown (non-grip chrome, e.g. media bar •••)", () => {
  it("no active MBS → fresh single-block MBS + dropdown with the given anchor", () => {
    const editor = makeEditor()
    const id = editor.state.doc.child(2).attrs.id as string

    expect(openBlockActionsDropdown(editor.view, id, "media-bar")).toBe(true)

    const sel = editor.state.selection
    expect(sel).toBeInstanceOf(MultiBlockSelection)
    expect((sel as MultiBlockSelection).blockIndices).toEqual([2, 2])
    const ps = blockSelectionKey.getState(editor.state)
    expect(ps?.dropdownBlockId).toBe(id)
    expect(ps?.anchorBlockId).toBe(id)
    expect(ps?.dropdownAnchor).toBe("media-bar")
    // Live-rect anchors (grip / media-bar) carry no frozen rect.
    expect(ps?.dropdownAnchorRect).toBeNull()
    editor.destroy()
  })

  it("block inside an active MBS → re-asserts the FULL range and keeps the stored anchor (grip parity)", () => {
    const editor = makeEditor()
    const anchorId = editor.state.doc.child(1).attrs.id as string
    const clickedId = editor.state.doc.child(2).attrs.id as string
    editor.view.dispatch(
      editor.state.tr
        .setSelection(MultiBlockSelection.create(editor.state.doc, 1, 3))
        .setMeta(blockSelectionKey, { setAnchor: anchorId }),
    )

    expect(openBlockActionsDropdown(editor.view, clickedId, "media-bar")).toBe(true)

    // The user's 3-block selection survives — the dropdown acts on all of
    // it, exactly as a grip click on the same block would.
    const sel = editor.state.selection
    expect(sel).toBeInstanceOf(MultiBlockSelection)
    expect((sel as MultiBlockSelection).blockIndices).toEqual([1, 3])
    const ps = blockSelectionKey.getState(editor.state)
    expect(ps?.dropdownBlockId).toBe(clickedId)
    expect(ps?.anchorBlockId).toBe(anchorId)
    editor.destroy()
  })

  it("block OUTSIDE the active MBS → fresh single-block MBS on that block", () => {
    const editor = makeEditor()
    const clickedId = editor.state.doc.child(5).attrs.id as string
    editor.view.dispatch(
      editor.state.tr.setSelection(
        MultiBlockSelection.create(editor.state.doc, 1, 3),
      ),
    )

    expect(openBlockActionsDropdown(editor.view, clickedId, "media-bar")).toBe(true)

    const sel = editor.state.selection
    expect(sel).toBeInstanceOf(MultiBlockSelection)
    expect((sel as MultiBlockSelection).blockIndices).toEqual([5, 5])
    expect(blockSelectionKey.getState(editor.state)?.anchorBlockId).toBe(clickedId)
    editor.destroy()
  })
})

describe("openBlockActionsDropdown (toolbar ••• — frozen anchor rect)", () => {
  it("threads the passed rect into plugin state alongside the toolbar anchor", () => {
    const editor = makeEditor()
    const id = editor.state.doc.child(2).attrs.id as string
    // The inline toolbar unmounts the instant the block selection is set, so
    // it ships a frozen viewport rect instead of a live-queryable element.
    const rect = { top: 120, left: 40, width: 24, height: 0 }

    expect(openBlockActionsDropdown(editor.view, id, "toolbar", rect)).toBe(true)

    const sel = editor.state.selection
    expect(sel).toBeInstanceOf(MultiBlockSelection)
    expect((sel as MultiBlockSelection).blockIndices).toEqual([2, 2])
    const ps = blockSelectionKey.getState(editor.state)
    expect(ps?.dropdownBlockId).toBe(id)
    expect(ps?.dropdownAnchor).toBe("toolbar")
    expect(ps?.dropdownAnchorRect).toEqual(rect)
    editor.destroy()
  })

  it("closing the dropdown resets the anchor to grip and drops the frozen rect", () => {
    const editor = makeEditor()
    const id = editor.state.doc.child(2).attrs.id as string
    openBlockActionsDropdown(editor.view, id, "toolbar", {
      top: 120,
      left: 40,
      width: 24,
      height: 0,
    })

    editor.view.dispatch(
      editor.state.tr.setMeta(blockSelectionKey, { closeDropdown: true }),
    )

    const ps = blockSelectionKey.getState(editor.state)
    expect(ps?.dropdownBlockId).toBeNull()
    expect(ps?.dropdownAnchor).toBe("grip")
    expect(ps?.dropdownAnchorRect).toBeNull()
    editor.destroy()
  })
})
