// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, it, expect } from "vitest"
import { Editor } from "@tiptap/core"
import Document from "@tiptap/extension-document"
import Text from "@tiptap/extension-text"
import { History } from "@tiptap/extension-history"
import { TextSelection } from "@tiptap/pm/state"
import { Paragraph, Heading } from "../../blocks"
import { BlockId } from "../block-id"
import { BlockSelection } from "./index"
import { MultiBlockSelection } from "./MultiBlockSelection"
import { blockSelectionKeymap } from "./keymap"
import { createTestEditor } from "../../test-utils/createTestEditor"

function makeEditor() {
  const element = document.createElement("div")
  document.body.appendChild(element)
  return new Editor({
    element,
    extensions: [Document, Text, Paragraph, Heading, History, BlockId, BlockSelection],
    content: {
      type: "doc",
      content: Array.from({ length: 4 }, (_, i) => ({
        type: "paragraph",
        content: [{ type: "text", text: `Block ${i + 1}` }],
      })),
    } as never,
  })
}

function fireKey(editor: Editor, key: string, mods: { meta?: boolean; shift?: boolean } = {}): boolean {
  // prosemirror-keymap normalizes "Mod-a" to "Ctrl-a" or "Meta-a" depending
  // on navigator.platform. jsdom's platform is empty string → non-mac → Ctrl.
  // Setting BOTH ctrlKey and metaKey would produce a "Meta-Ctrl-a" lookup
  // that matches neither, so we set only the right modifier for jsdom.
  const isMac = /Mac|iP(hone|[oa]d)/.test(navigator.platform)
  const useMeta = (mods.meta ?? false) && isMac
  const useCtrl = (mods.meta ?? false) && !isMac
  const event = new KeyboardEvent("keydown", {
    key,
    code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
    metaKey: useMeta,
    ctrlKey: useCtrl,
    shiftKey: mods.shift ?? false,
    bubbles: true,
    cancelable: true,
  })
  editor.view.dom.dispatchEvent(event)
  return event.defaultPrevented
}

describe("Keymap: Cmd+A three-stage", () => {
  it("stage 1: text partial → selects all text in current block", () => {
    const editor = makeEditor()
    // Caret inside block 2 (position after "Block 2"[0] = block1Size + 1 + 1 = 9+1+1=11).
    const block1Size = editor.state.doc.child(0).nodeSize
    const caretPos = block1Size + 1 + 1 // inside block 2, after first char
    editor.commands.setTextSelection(caretPos)
    fireKey(editor, "a", { meta: true })
    const sel = editor.state.selection
    expect(sel).toBeInstanceOf(TextSelection)
    const block2 = editor.state.doc.child(1)
    const expectedFrom = block1Size + 1
    expect(sel.from).toBe(expectedFrom)
    expect(sel.to).toBe(expectedFrom + block2.content.size)
    editor.destroy()
  })

  it("stage 2: text fully selected → promotes to MultiBlockSelection over all blocks", () => {
    const editor = makeEditor()
    const block1Size = editor.state.doc.child(0).nodeSize
    const block2 = editor.state.doc.child(1)
    const blockStart = block1Size + 1
    editor.commands.setTextSelection({
      from: blockStart,
      to: blockStart + block2.content.size,
    })
    fireKey(editor, "a", { meta: true })
    const sel = editor.state.selection as MultiBlockSelection
    expect(sel).toBeInstanceOf(MultiBlockSelection)
    expect(sel.blockIndices).toEqual([0, 3])
    editor.destroy()
  })

  it("stage 3: MultiBlockSelection partial → expands to all blocks", () => {
    const editor = makeEditor()
    editor.commands.setBlockSelection({ from: 1, to: 2 })
    fireKey(editor, "a", { meta: true })
    const sel = editor.state.selection as MultiBlockSelection
    expect(sel.blockIndices).toEqual([0, 3])
    editor.destroy()
  })

  it("stage 4: MultiBlockSelection over all → no-op, key consumed", () => {
    const editor = makeEditor()
    editor.commands.setBlockSelection({ from: 0, to: 3 })
    const consumed = fireKey(editor, "a", { meta: true })
    // Key consumed (default prevented) → browser won't run native Cmd+A.
    expect(consumed).toBe(true)
    const sel = editor.state.selection as MultiBlockSelection
    expect(sel.blockIndices).toEqual([0, 3])
    editor.destroy()
  })
})

describe("Keymap: Esc", () => {
  it("from TextSelection: promotes to MultiBlockSelection on containing block", () => {
    const editor = makeEditor()
    const block1Size = editor.state.doc.child(0).nodeSize
    editor.commands.setTextSelection(block1Size + 2) // inside block 2
    fireKey(editor, "Escape")
    const sel = editor.state.selection as MultiBlockSelection
    expect(sel).toBeInstanceOf(MultiBlockSelection)
    expect(sel.blockIndices).toEqual([1, 1])
    editor.destroy()
  })

  it("from MultiBlockSelection: passthrough (not consumed)", () => {
    const editor = makeEditor()
    editor.commands.setBlockSelection({ from: 0, to: 1 })
    const consumed = fireKey(editor, "Escape")
    expect(consumed).toBe(false)
    // Selection unchanged (no other extension consumed it either).
    const sel = editor.state.selection as MultiBlockSelection
    expect(sel).toBeInstanceOf(MultiBlockSelection)
    expect(sel.blockIndices).toEqual([0, 1])
    editor.destroy()
  })
})

describe("Keymap: arrow keys — collapse-move", () => {
  it("↑ from single-block MultiBlockSelection moves to previous block", () => {
    const editor = makeEditor()
    editor.commands.setBlockSelection({ from: 2, to: 2 })
    fireKey(editor, "ArrowUp")
    const sel = editor.state.selection as MultiBlockSelection
    expect(sel.blockIndices).toEqual([1, 1])
    editor.destroy()
  })

  it("↑ at top clamps to index 0", () => {
    const editor = makeEditor()
    editor.commands.setBlockSelection({ from: 0, to: 0 })
    fireKey(editor, "ArrowUp")
    const sel = editor.state.selection as MultiBlockSelection
    expect(sel.blockIndices).toEqual([0, 0])
    editor.destroy()
  })

  it("↓ from N-block range collapses to block AFTER the range", () => {
    const editor = makeEditor()
    editor.commands.setBlockSelection({ from: 0, to: 1 })
    fireKey(editor, "ArrowDown")
    const sel = editor.state.selection as MultiBlockSelection
    expect(sel.blockIndices).toEqual([2, 2])
    editor.destroy()
  })

  it("↓ at bottom clamps", () => {
    const editor = makeEditor()
    editor.commands.setBlockSelection({ from: 3, to: 3 })
    fireKey(editor, "ArrowDown")
    const sel = editor.state.selection as MultiBlockSelection
    expect(sel.blockIndices).toEqual([3, 3])
    editor.destroy()
  })

  it("↑/↓ do nothing when selection is a TextSelection", () => {
    const editor = makeEditor()
    editor.commands.setTextSelection(3)
    const consumedUp = fireKey(editor, "ArrowUp")
    const consumedDown = fireKey(editor, "ArrowDown")
    expect(consumedUp).toBe(false)
    expect(consumedDown).toBe(false)
    editor.destroy()
  })
})

describe("Keymap: shift+arrow extend", () => {
  it("Shift+↓ from N=1 extends range downward", () => {
    const editor = makeEditor()
    editor.commands.setBlockSelection({ from: 1, to: 1 })
    fireKey(editor, "ArrowDown", { shift: true })
    const sel = editor.state.selection as MultiBlockSelection
    expect(sel.blockIndices).toEqual([1, 2])
    editor.destroy()
  })

  it("Shift+↑ shrinks a forward range", () => {
    const editor = makeEditor()
    editor.commands.setBlockSelection({ from: 1, to: 3 }) // anchor=block 2 (idx 1)
    fireKey(editor, "ArrowUp", { shift: true })
    const sel = editor.state.selection as MultiBlockSelection
    expect(sel.blockIndices).toEqual([1, 2])
    editor.destroy()
  })

  it("Shift+↑ past anchor flips direction cleanly", () => {
    const editor = makeEditor()
    editor.commands.setBlockSelection({ from: 2, to: 3 }) // anchor=block 3 (idx 2), head=idx 3
    fireKey(editor, "ArrowUp", { shift: true }) // head → idx 2 (collapse)
    expect((editor.state.selection as MultiBlockSelection).blockIndices).toEqual([2, 2])
    fireKey(editor, "ArrowUp", { shift: true }) // head → idx 1, range flips
    expect((editor.state.selection as MultiBlockSelection).blockIndices).toEqual([1, 2])
    editor.destroy()
  })

  it("Shift+↑ at top clamps at 0", () => {
    const editor = makeEditor()
    editor.commands.setBlockSelection({ from: 0, to: 0 })
    fireKey(editor, "ArrowUp", { shift: true })
    const sel = editor.state.selection as MultiBlockSelection
    expect(sel.blockIndices).toEqual([0, 0])
    editor.destroy()
  })

  it("Shift+↓ at bottom clamps at N-1", () => {
    const editor = makeEditor()
    editor.commands.setBlockSelection({ from: 3, to: 3 })
    fireKey(editor, "ArrowDown", { shift: true })
    const sel = editor.state.selection as MultiBlockSelection
    expect(sel.blockIndices).toEqual([3, 3])
    editor.destroy()
  })
})

describe("Keymap: ←/→/Enter from MultiBlockSelection", () => {
  it("← is a no-op (consumed)", () => {
    const editor = makeEditor()
    editor.commands.setBlockSelection({ from: 1, to: 2 })
    const consumed = fireKey(editor, "ArrowLeft")
    expect(consumed).toBe(true)
    expect((editor.state.selection as MultiBlockSelection).blockIndices).toEqual([1, 2])
    editor.destroy()
  })

  it("→ is a no-op (consumed)", () => {
    const editor = makeEditor()
    editor.commands.setBlockSelection({ from: 1, to: 2 })
    const consumed = fireKey(editor, "ArrowRight")
    expect(consumed).toBe(true)
    expect((editor.state.selection as MultiBlockSelection).blockIndices).toEqual([1, 2])
    editor.destroy()
  })

  it("Enter collapses to TextSelection at end of first selected block", () => {
    const editor = makeEditor()
    editor.commands.setBlockSelection({ from: 1, to: 2 })
    fireKey(editor, "Enter")
    const sel = editor.state.selection
    expect(sel).toBeInstanceOf(TextSelection)
    const block1Size = editor.state.doc.child(0).nodeSize
    const block2 = editor.state.doc.child(1)
    const expectedPos = block1Size + 1 + block2.content.size
    expect(sel.from).toBe(expectedPos)
    editor.destroy()
  })

  it("←/→/Enter pass through when selection is not ours", () => {
    const editor = makeEditor()
    editor.commands.setTextSelection(3)
    expect(fireKey(editor, "ArrowLeft")).toBe(false)
    expect(fireKey(editor, "ArrowRight")).toBe(false)
    // Enter in TextSelection is handled by PM's default (splits block) — we
    // don't assert the result, only that our keymap doesn't consume it.
    editor.destroy()
  })
})

describe("Keymap: Enter on MBS whose first block is not a textblock (dead-caret regression)", () => {
  // firstBlockTextEnd assumes the first selected block is a textblock and
  // hands its raw position straight to TextSelection.create. A divider
  // (content: "", a PM leaf — no interior text position) or a columnLayout
  // (structural, its content-end boundary isn't inside a textblock either)
  // makes that position invalid; PM's TextSelection ctor doesn't throw, it
  // just warns and builds a selection whose $from.parent has no inline
  // content — a dead caret that swallows subsequent typing.
  it("divider first: Enter lands in a real textblock, not a dead position", () => {
    const editor = createTestEditor()
    editor.commands.setContent([
      { type: "divider" },
      { type: "paragraph", content: [{ type: "text", text: "after" }] },
    ] as never)
    editor.commands.setBlockSelection({ from: 0, to: 0 })
    const km = blockSelectionKeymap()
    expect(km.Enter!({ editor })).toBe(true)
    const sel = editor.state.selection
    expect(sel).toBeInstanceOf(TextSelection)
    expect(sel.$from.parent.inlineContent).toBe(true)
  })

  it("columnLayout first: Enter lands in a real textblock, not a dead position", () => {
    const editor = createTestEditor()
    const s = editor.schema
    const para = (id: string, t: string) => s.nodes.paragraph!.create({ id, depth: 0 }, s.text(t))
    const col = (id: string, ...children: import("@tiptap/pm/model").Node[]) =>
      s.nodes.column!.create({ id, width: 1 }, children)
    const doc = s.nodes.doc!.create(null, [
      s.nodes.columnLayout!.create({ id: "lay", depth: 0 }, [
        col("col_a", para("a1", "A1")),
        col("col_b", para("b1", "B1")),
      ]),
      para("r1", "root-1"),
    ])
    editor.view.dispatch(editor.state.tr.replaceWith(0, editor.state.doc.content.size, doc.content))
    editor.commands.setBlockSelection({ from: 0, to: 0 })
    const km = blockSelectionKeymap()
    expect(km.Enter!({ editor })).toBe(true)
    const sel = editor.state.selection
    expect(sel).toBeInstanceOf(TextSelection)
    expect(sel.$from.parent.inlineContent).toBe(true)
  })
})

describe("Backspace / Delete on MBS", () => {
  it("Backspace handler returns true and deletes the range", () => {
    const editor = makeEditor()
    editor.commands.setBlockSelection({ from: 1, to: 2 })
    const km = blockSelectionKeymap()
    expect(km.Backspace!({ editor })).toBe(true)
    expect(editor.state.doc.childCount).toBe(2)
    editor.destroy()
  })

  it("Delete handler also deletes the range", () => {
    const editor = makeEditor()
    editor.commands.setBlockSelection({ from: 0, to: 1 })
    const km = blockSelectionKeymap()
    expect(km.Delete!({ editor })).toBe(true)
    expect(editor.state.doc.childCount).toBe(2)
    editor.destroy()
  })

  it("returns false when not in MBS (does not consume the key)", () => {
    const editor = makeEditor()
    // default = TextSelection
    const km = blockSelectionKeymap()
    expect(km.Backspace!({ editor })).toBe(false)
    expect(km.Delete!({ editor })).toBe(false)
    editor.destroy()
  })
})

describe("Mod-d duplicate", () => {
  it("Mod-d on TextSelection duplicates the containing block", () => {
    const editor = makeEditor()
    // Caret defaults to TextSelection at start of doc → block 0.
    const km = blockSelectionKeymap()
    expect(km["Mod-d"]!({ editor })).toBe(true)
    expect(editor.state.doc.childCount).toBe(5)
    editor.destroy()
  })

  it("Mod-d on MBS duplicates the range", () => {
    const editor = makeEditor()
    editor.commands.setBlockSelection({ from: 1, to: 2 })
    const km = blockSelectionKeymap()
    expect(km["Mod-d"]!({ editor })).toBe(true)
    expect(editor.state.doc.childCount).toBe(6)
    editor.destroy()
  })
})

describe("Mod-Arrow block move", () => {
  it("Mod-ArrowDown on TextSelection calls moveBlockDown", () => {
    const editor = makeEditor()
    const block1Size = editor.state.doc.child(0).nodeSize
    editor.commands.setTextSelection(block1Size + 2)
    const km = blockSelectionKeymap()
    expect(km["Mod-ArrowDown"]!({ editor })).toBe(true)
    expect(editor.state.doc.child(2).textContent).toBe("Block 2")
    editor.destroy()
  })

  it("Mod-Shift-ArrowUp on MBS also moves the range", () => {
    const editor = makeEditor()
    editor.commands.setBlockSelection({ from: 2, to: 3 })
    const km = blockSelectionKeymap()
    expect(km["Mod-Shift-ArrowUp"]!({ editor })).toBe(true)
    expect(editor.state.selection).toBeInstanceOf(MultiBlockSelection)
    expect((editor.state.selection as MultiBlockSelection).blockIndices).toEqual([1, 2])
    editor.destroy()
  })
})
