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
import { Paragraph, Heading, Table } from "../../blocks"
import { BlockId } from "../block-id"
import { BlockSelection, blockSelectionKey } from "./index"
import { MultiBlockSelection } from "./MultiBlockSelection"
import { createTestEditor } from "../../test-utils/createTestEditor"

function makeEditor(content?: unknown) {
  const element = document.createElement("div")
  document.body.appendChild(element)
  return new Editor({
    element,
    extensions: [Document, Text, Paragraph, Heading, History, BlockId, BlockSelection],
    content: (content ?? {
      type: "doc",
      content: Array.from({ length: 4 }, (_, i) => ({
        type: "paragraph",
        content: [{ type: "text", text: `Block ${i + 1}` }],
      })),
    }) as never,
  })
}

describe("commands.setBlockSelection", () => {
  it("resolves numeric indices", () => {
    const editor = makeEditor()
    const ok = editor.commands.setBlockSelection({ from: 1, to: 2 })
    expect(ok).toBe(true)
    const sel = editor.state.selection as MultiBlockSelection
    expect(sel).toBeInstanceOf(MultiBlockSelection)
    expect(sel.blockIndices).toEqual([1, 2])
    editor.destroy()
  })

  it("resolves block ids", () => {
    const editor = makeEditor()
    const fromId = editor.state.doc.child(0).attrs.id as string
    const toId = editor.state.doc.child(2).attrs.id as string
    editor.commands.setBlockSelection({ from: fromId, to: toId })
    const sel = editor.state.selection as MultiBlockSelection
    expect(sel.blockIndices).toEqual([0, 2])
    expect(blockSelectionKey.getState(editor.state)?.anchorBlockId).toBe(fromId)
    editor.destroy()
  })

  it("returns false for out-of-range indices", () => {
    const editor = makeEditor()
    const ok = editor.commands.setBlockSelection({ from: 0, to: 99 })
    expect(ok).toBe(false)
    editor.destroy()
  })
})

describe("commands.selectAllBlocks", () => {
  it("selects every top-level block; anchor = first block id", () => {
    const editor = makeEditor()
    const firstId = editor.state.doc.child(0).attrs.id as string
    editor.commands.selectAllBlocks()
    const sel = editor.state.selection as MultiBlockSelection
    expect(sel.blockIndices).toEqual([0, 3])
    expect(blockSelectionKey.getState(editor.state)?.anchorBlockId).toBe(firstId)
    editor.destroy()
  })

  it("single-paragraph doc → N=1 selection", () => {
    const editor = makeEditor({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "only" }] }],
    })
    editor.commands.selectAllBlocks()
    const sel = editor.state.selection as MultiBlockSelection
    expect(sel.blockIndices).toEqual([0, 0])
    editor.destroy()
  })
})

describe("commands.clearBlockSelection", () => {
  it("collapses to TextSelection at end of first selected block", () => {
    const editor = makeEditor()
    editor.commands.setBlockSelection({ from: 1, to: 2 })
    editor.commands.clearBlockSelection()
    const sel = editor.state.selection
    expect(sel).toBeInstanceOf(TextSelection)
    // Caret should sit at the end of block 2 ("Block 2" = 7 chars).
    const block = editor.state.doc.child(1)
    // End of block 2 in absolute positions: nodeSize(block1) + (1 + block2.content.size).
    const block1Size = editor.state.doc.child(0).nodeSize
    const expectedPos = block1Size + 1 + block.content.size
    expect(sel.from).toBe(expectedPos)
    editor.destroy()
  })

  it("returns false when selection is not MultiBlockSelection", () => {
    const editor = makeEditor()
    const ok = editor.commands.clearBlockSelection()
    expect(ok).toBe(false)
    editor.destroy()
  })

  // Same firstBlockTextEnd hazard as the Enter keymap: the first selected
  // block being a divider (leaf, no interior text position) hands
  // TextSelection.create a position outside any textblock — PM warns and
  // builds a dead caret instead of throwing.
  it("dead-caret regression: first block is a divider (not a textblock)", () => {
    const editor = createTestEditor()
    editor.commands.setContent([
      { type: "divider" },
      { type: "paragraph", content: [{ type: "text", text: "after" }] },
    ] as never)
    editor.commands.setBlockSelection({ from: 0, to: 0 })
    const ok = editor.commands.clearBlockSelection()
    expect(ok).toBe(true)
    const sel = editor.state.selection
    expect(sel).toBeInstanceOf(TextSelection)
    expect(sel.$from.parent.inlineContent).toBe(true)
  })
})

describe("commands.deleteBlockSelection", () => {
  it("deletes mid-range MBS; caret lands at end of block before", () => {
    const editor = makeEditor()
    editor.commands.setBlockSelection({ from: 1, to: 2 })
    const ok = editor.commands.deleteBlockSelection()
    expect(ok).toBe(true)
    expect(editor.state.doc.childCount).toBe(2)
    expect(editor.state.doc.child(0).textContent).toBe("Block 1")
    expect(editor.state.doc.child(1).textContent).toBe("Block 4")
    // Caret at end of Block 1 = pos 1 (before block) + 1 (open) + content.size
    const expected = 1 + editor.state.doc.child(0).content.size
    expect(editor.state.selection.from).toBe(expected)
    expect(editor.state.selection.empty).toBe(true)
    editor.destroy()
  })

  it("deletes MBS starting at index 0; caret at start of new first block", () => {
    const editor = makeEditor()
    editor.commands.setBlockSelection({ from: 0, to: 1 })
    editor.commands.deleteBlockSelection()
    expect(editor.state.doc.childCount).toBe(2)
    expect(editor.state.doc.child(0).textContent).toBe("Block 3")
    // Caret inside opening of new block 0 = pos 1
    expect(editor.state.selection.from).toBe(1)
    expect(editor.state.selection.empty).toBe(true)
    editor.destroy()
  })

  it("deletes all blocks; doc becomes one empty paragraph; caret at start", () => {
    const editor = makeEditor()
    editor.commands.selectAllBlocks()
    editor.commands.deleteBlockSelection()
    expect(editor.state.doc.childCount).toBe(1)
    expect(editor.state.doc.child(0).type.name).toBe("paragraph")
    expect(editor.state.doc.child(0).content.size).toBe(0)
    expect(editor.state.selection.from).toBe(1)
    editor.destroy()
  })

  it("returns false when selection is not MBS", () => {
    const editor = makeEditor()
    // default selection is TextSelection at start
    expect(editor.commands.deleteBlockSelection()).toBe(false)
    editor.destroy()
  })

  it("undo restores both blocks and the prior MBS in one step", () => {
    const editor = makeEditor()
    editor.commands.setBlockSelection({ from: 1, to: 2 })
    editor.commands.deleteBlockSelection()
    expect(editor.state.doc.childCount).toBe(2)
    editor.commands.undo()
    expect(editor.state.doc.childCount).toBe(4)
    expect(editor.state.selection).toBeInstanceOf(MultiBlockSelection)
    expect((editor.state.selection as MultiBlockSelection).blockIndices).toEqual([1, 2])
    editor.destroy()
  })

  it("deletes blocks after a table; caret lands inside last table cell", () => {
    const element = document.createElement("div")
    document.body.appendChild(element)
    const editor = new Editor({
      element,
      extensions: [
        Document, Text, Paragraph, Heading, Table,
        History, BlockId, BlockSelection,
      ],
      content: {
        type: "doc",
        content: [
          {
            type: "table",
            content: [
              {
                type: "tableRow",
                content: [
                  { type: "tableCell", content: [{ type: "tableParagraph", content: [{ type: "text", text: "A" }] }] },
                  { type: "tableCell", content: [{ type: "tableParagraph", content: [{ type: "text", text: "B" }] }] },
                ],
              },
            ],
          },
          { type: "paragraph", content: [{ type: "text", text: "After 1" }] },
          { type: "paragraph", content: [{ type: "text", text: "After 2" }] },
        ],
      } as never,
    })

    expect(editor.state.doc.childCount).toBe(3)
    editor.commands.setBlockSelection({ from: 1, to: 2 })
    editor.commands.deleteBlockSelection()
    expect(editor.state.doc.childCount).toBe(1)
    expect(editor.state.doc.child(0).type.name).toBe("table")

    const sel = editor.state.selection as TextSelection
    expect(sel).toBeInstanceOf(TextSelection)
    expect(sel.empty).toBe(true)
    // Cursor should be inside the table's last cell, not at an invalid
    // structural position. Verify it's inside a tableParagraph.
    const $pos = sel.$from
    const parent = $pos.parent
    expect(parent.type.name).toBe("tableParagraph")

    editor.destroy()
  })
})

describe("commands.duplicateBlocks (MultiBlockSelection)", () => {
  it("inserts copies after the selected range; selection covers the copies", () => {
    const editor = makeEditor()
    editor.commands.setBlockSelection({ from: 1, to: 2 }) // Block 2, Block 3
    const ok = editor.commands.duplicateBlocks()
    expect(ok).toBe(true)
    expect(editor.state.doc.childCount).toBe(6)
    expect(editor.state.doc.child(0).textContent).toBe("Block 1")
    expect(editor.state.doc.child(1).textContent).toBe("Block 2")
    expect(editor.state.doc.child(2).textContent).toBe("Block 3")
    expect(editor.state.doc.child(3).textContent).toBe("Block 2")
    expect(editor.state.doc.child(4).textContent).toBe("Block 3")
    expect(editor.state.doc.child(5).textContent).toBe("Block 4")
    const sel = editor.state.selection
    expect(sel).toBeInstanceOf(MultiBlockSelection)
    expect((sel as MultiBlockSelection).blockIndices).toEqual([3, 4])
    editor.destroy()
  })

  it("regenerates block ids on duplicates (no collisions with originals)", () => {
    const editor = makeEditor()
    const originalIds = [
      editor.state.doc.child(1).attrs.id,
      editor.state.doc.child(2).attrs.id,
    ]
    editor.commands.setBlockSelection({ from: 1, to: 2 })
    editor.commands.duplicateBlocks()
    const dupIds = [
      editor.state.doc.child(3).attrs.id,
      editor.state.doc.child(4).attrs.id,
    ]
    expect(dupIds[0]).not.toBe(originalIds[0])
    expect(dupIds[1]).not.toBe(originalIds[1])
    expect(dupIds[0]).not.toBe(dupIds[1])
    expect(dupIds[0]).toMatch(/^[\w-]{8}$/)
    expect(dupIds[1]).toMatch(/^[\w-]{8}$/)
    editor.destroy()
  })

  it("undo restores pre-duplicate state in one step", () => {
    const editor = makeEditor()
    editor.commands.setBlockSelection({ from: 1, to: 2 })
    editor.commands.duplicateBlocks()
    expect(editor.state.doc.childCount).toBe(6)
    editor.commands.undo()
    expect(editor.state.doc.childCount).toBe(4)
    editor.destroy()
  })
})

describe("commands.duplicateBlocks (TextSelection)", () => {
  it("duplicates containing block; caret lands at same offset in the duplicate", () => {
    const editor = makeEditor()
    // Place caret 3 chars into Block 3 (index 2). Block 3 starts at:
    // pos = sum(child[0..1].nodeSize) + 1 (open).
    let posBeforeBlock3 = 0
    for (let i = 0; i < 2; i++) posBeforeBlock3 += editor.state.doc.child(i).nodeSize
    const offset = 3 // "Blo|ck 3"
    const caret = posBeforeBlock3 + 1 + offset
    editor.commands.setTextSelection(caret)
    const ok = editor.commands.duplicateBlocks()
    expect(ok).toBe(true)
    expect(editor.state.doc.childCount).toBe(5)
    expect(editor.state.doc.child(2).textContent).toBe("Block 3")
    expect(editor.state.doc.child(3).textContent).toBe("Block 3")
    // Caret in the duplicate (block 4 = index 3), same offset.
    let posBeforeDup = 0
    for (let i = 0; i < 3; i++) posBeforeDup += editor.state.doc.child(i).nodeSize
    expect(editor.state.selection.from).toBe(posBeforeDup + 1 + offset)
    editor.destroy()
  })
})

describe("commands.moveBlockUp / moveBlockDown", () => {
  it("TextSelection: moves containing block down and preserves caret offset", () => {
    const editor = makeEditor()
    let posBeforeBlock2 = editor.state.doc.child(0).nodeSize
    const caret = posBeforeBlock2 + 1 + 3
    editor.commands.setTextSelection(caret)

    const ok = editor.commands.moveBlockDown()
    expect(ok).toBe(true)
    expect(editor.state.doc.child(0).textContent).toBe("Block 1")
    expect(editor.state.doc.child(1).textContent).toBe("Block 3")
    expect(editor.state.doc.child(2).textContent).toBe("Block 2")
    expect(editor.state.selection.empty).toBe(true)
    editor.destroy()
  })

  it("MultiBlockSelection: moves the selected range up and preserves MBS", () => {
    const editor = makeEditor()
    editor.commands.setBlockSelection({ from: 2, to: 3 })
    const ok = editor.commands.moveBlockUp()
    expect(ok).toBe(true)
    expect(editor.state.doc.child(0).textContent).toBe("Block 1")
    expect(editor.state.doc.child(1).textContent).toBe("Block 3")
    expect(editor.state.doc.child(2).textContent).toBe("Block 4")
    expect(editor.state.doc.child(3).textContent).toBe("Block 2")
    expect(editor.state.selection).toBeInstanceOf(MultiBlockSelection)
    expect((editor.state.selection as MultiBlockSelection).blockIndices).toEqual([1, 2])
    editor.destroy()
  })

  it("top clamp: moveBlockUp returns true and leaves doc unchanged", () => {
    const editor = makeEditor()
    editor.commands.setBlockSelection({ from: 0, to: 0 })
    const before = editor.state.doc.toJSON()
    expect(editor.commands.moveBlockUp()).toBe(true)
    expect(editor.state.doc.toJSON()).toEqual(before)
    expect((editor.state.selection as MultiBlockSelection).blockIndices).toEqual([0, 0])
    editor.destroy()
  })

  it("bottom clamp: moveBlockDown returns true and leaves doc unchanged", () => {
    const editor = makeEditor()
    editor.commands.setBlockSelection({ from: 3, to: 3 })
    const before = editor.state.doc.toJSON()
    expect(editor.commands.moveBlockDown()).toBe(true)
    expect(editor.state.doc.toJSON()).toEqual(before)
    expect((editor.state.selection as MultiBlockSelection).blockIndices).toEqual([3, 3])
    editor.destroy()
  })
})
