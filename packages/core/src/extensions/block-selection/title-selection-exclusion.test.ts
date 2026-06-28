// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The in-document page title (`TitleKit`) declares `meta: { selectable: false }`
// so it is NEVER swept into a block selection — Notion-correct, and it makes
// "select-all + Delete" preserve the title. These tests pin the exclusion at
// every block-selection entry point: `selectAllBlocks`, the Cmd+A keymap
// staging, the delete path, and the marquee intersection walk.

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { TextSelection } from "@tiptap/pm/state"
import type { Editor } from "@tiptap/core"
import { createTestEditor } from "../../test-utils/createTestEditor"
import { TitleKit, TITLE_TYPE } from "../../blocks/Title"
import { MultiBlockSelection } from "./MultiBlockSelection"
import { blockSelectionKeymap } from "./keymap"
import { blockSelectionKey } from "./plugin"

const titleJson = (text: string) => ({
  type: TITLE_TYPE,
  content: [{ type: "text", text }],
})
const paraJson = (text: string) => ({
  type: "paragraph",
  content: [{ type: "text", text }],
})

// [title, p, p, p] — the canonical "page with a title and body" shape.
const docJson = {
  type: "doc",
  content: [
    titleJson("My Page"),
    paraJson("one"),
    paraJson("two"),
    paraJson("three"),
  ],
}

function makeTitledEditor(element?: HTMLElement): Editor {
  return createTestEditor(
    element
      ? { element, kit: { plugins: [TitleKit] }, content: docJson as never }
      : { kit: { plugins: [TitleKit] }, content: docJson as never },
  )
}

function bodyTexts(editor: Editor): string[] {
  const out: string[] = []
  editor.state.doc.forEach((n) => {
    if (n.type.name !== TITLE_TYPE) out.push(n.textContent)
  })
  return out
}

describe("title excluded from selectAllBlocks", () => {
  it("selects body blocks only — selection starts at index 1, title not covered", () => {
    const editor = makeTitledEditor()
    // Sanity: the title really is child 0.
    expect(editor.state.doc.child(0).type.name).toBe(TITLE_TYPE)

    const ok = editor.commands.selectAllBlocks()
    expect(ok).toBe(true)

    const sel = editor.state.selection as MultiBlockSelection
    expect(sel).toBeInstanceOf(MultiBlockSelection)
    // [1, 3] — the three body paragraphs; the title (index 0) is excluded.
    expect(sel.blockIndices).toEqual([1, 3])
    // No selected node is the title.
    expect(sel.blockNodes.some((n) => n.type.name === TITLE_TYPE)).toBe(false)
    expect(sel.blockNodes.map((n) => n.textContent)).toEqual(["one", "two", "three"])
    // Anchor is the first SELECTABLE block (index 1), not the title.
    const firstBodyId = editor.state.doc.child(1).attrs.id as string
    expect(blockSelectionKey.getState(editor.state)?.anchorBlockId).toBe(firstBodyId)
  })
})

describe("title excluded from the Cmd+A 'all blocks' stage (keymap)", () => {
  it("expand-from-MBS branch: a sub-range MBS + Cmd+A expands to body blocks only", () => {
    const editor = makeTitledEditor()
    // Sub-range MBS over a single body block (index 2).
    editor.commands.setBlockSelection({ from: 2, to: 2 })
    const consumed = blockSelectionKeymap()["Mod-a"]!({ editor })
    expect(consumed).toBe(true)

    const sel = editor.state.selection as MultiBlockSelection
    expect(sel.blockIndices).toEqual([1, 3])
    expect(sel.blockNodes.some((n) => n.type.name === TITLE_TYPE)).toBe(false)
  })

  it("promote-from-text branch: whole body-block text + Cmd+A promotes to body blocks only", () => {
    const editor = makeTitledEditor()
    // Select the entire text of body block index 1 ("one") so handleModA hits
    // the stage-2 promote branch.
    const titleSize = editor.state.doc.child(0).nodeSize
    const block1 = editor.state.doc.child(1)
    const from = titleSize + 1 // content start of block 1
    const to = from + block1.content.size
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)),
    )

    const consumed = blockSelectionKeymap()["Mod-a"]!({ editor })
    expect(consumed).toBe(true)

    const sel = editor.state.selection as MultiBlockSelection
    expect(sel).toBeInstanceOf(MultiBlockSelection)
    expect(sel.blockIndices).toEqual([1, 3])
    expect(sel.blockNodes.some((n) => n.type.name === TITLE_TYPE)).toBe(false)
    // Anchor is the first body block, not the title.
    const firstBodyId = editor.state.doc.child(1).attrs.id as string
    expect(blockSelectionKey.getState(editor.state)?.anchorBlockId).toBe(firstBodyId)
  })

  it("no-op stage: a full body-only MBS + Cmd+A is consumed and unchanged", () => {
    const editor = makeTitledEditor()
    editor.commands.selectAllBlocks() // [1, 3]
    const consumed = blockSelectionKeymap()["Mod-a"]!({ editor })
    expect(consumed).toBe(true)
    const sel = editor.state.selection as MultiBlockSelection
    expect(sel.blockIndices).toEqual([1, 3])
  })
})

describe("title excluded from Arrow / Shift-Arrow block-selection movement", () => {
  it("ArrowUp from the first body-block MBS stays on the body — never the title", () => {
    const editor = makeTitledEditor()
    editor.commands.setBlockSelection({ from: 1, to: 1 }) // first body block
    const consumed = blockSelectionKeymap().ArrowUp!({ editor })
    expect(consumed).toBe(true)
    const sel = editor.state.selection as MultiBlockSelection
    // Clamped at the first selectable index (1); without the firstSelectableIndex
    // floor this would have moved to index 0 (the title).
    expect(sel.blockIndices).toEqual([1, 1])
    expect(sel.blockNodes.some((n) => n.type.name === TITLE_TYPE)).toBe(false)
  })

  it("Shift-ArrowUp from the first body-block MBS does not extend onto the title", () => {
    const editor = makeTitledEditor()
    editor.commands.setBlockSelection({ from: 1, to: 1 })
    const consumed = blockSelectionKeymap()["Shift-ArrowUp"]!({ editor })
    expect(consumed).toBe(true)
    const sel = editor.state.selection as MultiBlockSelection
    expect(sel.blockIndices).toEqual([1, 1])
    expect(sel.blockNodes.some((n) => n.type.name === TITLE_TYPE)).toBe(false)
  })
})

describe("MultiBlockSelection.create clamps the leading non-selectable run", () => {
  // The single enforcement point. Drag-extend, marquee reclaim, and any future
  // gesture build their MBS here from a geometry-derived index that has no
  // selectable gate (e.g. headIndexAtY returns 0 for the title row), so the
  // clamp here is what stops a drag/marquee from ever covering the title.
  it("create(doc, 0, 0) on a titled doc clamps to the first body block", () => {
    const editor = makeTitledEditor()
    const sel = MultiBlockSelection.create(editor.state.doc, 0, 0)
    expect(sel.blockIndices).toEqual([1, 1])
    expect(sel.blockNodes.some((n) => n.type.name === TITLE_TYPE)).toBe(false)
  })

  it("create(doc, 0, 3) (anchor on the title) clamps the anchor past it", () => {
    const editor = makeTitledEditor()
    const sel = MultiBlockSelection.create(editor.state.doc, 0, 3)
    expect(sel.blockIndices).toEqual([1, 3])
    expect(sel.blockNodes.some((n) => n.type.name === TITLE_TYPE)).toBe(false)
  })

  it("create(doc, 3, 0) (head on the title, reversed) clamps the head past it", () => {
    const editor = makeTitledEditor()
    const sel = MultiBlockSelection.create(editor.state.doc, 3, 0)
    expect(sel.blockIndices).toEqual([1, 3])
    expect(sel.blockNodes.some((n) => n.type.name === TITLE_TYPE)).toBe(false)
  })
})

describe("title excluded from Escape promotion", () => {
  it("Escape with the caret in the title is a no-op (no MBS, caret stays)", () => {
    const editor = makeTitledEditor()
    editor.commands.setTextSelection(2) // caret inside the title text
    const consumed = blockSelectionKeymap().Escape!({ editor })
    expect(consumed).toBe(false)
    expect(editor.state.selection).not.toBeInstanceOf(MultiBlockSelection)
    expect(editor.state.doc.child(0).textContent).toBe("My Page")
  })

  it("Escape with the caret in a body block still promotes to that single-block MBS", () => {
    const editor = makeTitledEditor()
    const titleSize = editor.state.doc.child(0).nodeSize
    editor.commands.setTextSelection(titleSize + 2) // caret in body block (index 1)
    const consumed = blockSelectionKeymap().Escape!({ editor })
    expect(consumed).toBe(true)
    const sel = editor.state.selection as MultiBlockSelection
    expect(sel.blockIndices).toEqual([1, 1])
  })

  it("Escape→Delete from the title leaves the title intact (the data-loss path)", () => {
    const editor = makeTitledEditor()
    editor.commands.setTextSelection(2)
    blockSelectionKeymap().Escape!({ editor }) // no-op (no MBS)
    blockSelectionKeymap().Delete!({ editor }) // no MBS → no block delete
    expect(editor.state.doc.child(0).type.name).toBe(TITLE_TYPE)
    expect(editor.state.doc.child(0).textContent).toBe("My Page")
  })
})

describe("title excluded from Mod-Arrow block movement", () => {
  // The move is a NET no-op even without the clamp — normalizeTitle yanks a
  // displaced title back. The real defect is the spurious transaction (a wasted
  // undo-history entry), so these assert the doc is UNCHANGED BY REFERENCE: with
  // the clamp the command early-returns before dispatching any reordering step.
  it("Mod-ArrowDown with the caret in the title does not move the title", () => {
    const editor = makeTitledEditor()
    editor.commands.setTextSelection(2) // caret in title
    const before = editor.state.doc
    expect(editor.commands.moveBlockDown()).toBe(true) // consumed, no-op
    expect(editor.state.doc).toBe(before) // no reorder transaction dispatched
    expect(editor.state.doc.child(0).type.name).toBe(TITLE_TYPE)
    expect(bodyTexts(editor)).toEqual(["one", "two", "three"])
  })

  it("Mod-ArrowUp with the caret in the first body block doesn't move it above the title", () => {
    const editor = makeTitledEditor()
    const titleSize = editor.state.doc.child(0).nodeSize
    editor.commands.setTextSelection(titleSize + 2) // caret in body "one" (index 1)
    const before = editor.state.doc
    expect(editor.commands.moveBlockUp()).toBe(true) // consumed, no-op (already top)
    expect(editor.state.doc).toBe(before)
    expect(editor.state.doc.child(0).type.name).toBe(TITLE_TYPE)
    expect(editor.state.doc.child(1).textContent).toBe("one")
  })

  it("Mod-ArrowUp with an MBS on the first body block doesn't move it above the title", () => {
    const editor = makeTitledEditor()
    editor.commands.setBlockSelection({ from: 1, to: 1 })
    const before = editor.state.doc
    expect(editor.commands.moveBlockUp()).toBe(true) // consumed, no-op
    expect(editor.state.doc).toBe(before)
    expect(editor.state.doc.child(0).type.name).toBe(TITLE_TYPE)
    expect(editor.state.doc.child(1).textContent).toBe("one")
  })

  it("Mod-ArrowDown still moves a body block down (not over-clamped)", () => {
    const editor = makeTitledEditor()
    const titleSize = editor.state.doc.child(0).nodeSize
    editor.commands.setTextSelection(titleSize + 2) // caret in body "one" (index 1)
    expect(editor.commands.moveBlockDown()).toBe(true)
    // "one" swaps with "two": title stays first, body order becomes two,one,three.
    expect(editor.state.doc.child(0).type.name).toBe(TITLE_TYPE)
    expect(bodyTexts(editor)).toEqual(["two", "one", "three"])
  })
})

describe("select-all + Delete preserves the title (the bug this fixes)", () => {
  it("selectAllBlocks + Delete keeps the title with its text and removes the body", () => {
    const editor = makeTitledEditor()
    editor.commands.selectAllBlocks() // body blocks only — title excluded
    const consumed = blockSelectionKeymap().Delete!({ editor })
    expect(consumed).toBe(true)

    // Title survives at index 0 with its original text.
    expect(editor.state.doc.firstChild?.type.name).toBe(TITLE_TYPE)
    expect(editor.state.doc.firstChild?.textContent).toBe("My Page")
    // Exactly one title remains.
    let titleCount = 0
    editor.state.doc.forEach((n) => {
      if (n.type.name === TITLE_TYPE) titleCount++
    })
    expect(titleCount).toBe(1)
    // None of the deleted body text survives (allowing for a trailing-paragraph
    // that delete-all may leave behind — we assert on content, not childCount).
    expect(bodyTexts(editor)).not.toContain("one")
    expect(bodyTexts(editor)).not.toContain("two")
    expect(bodyTexts(editor)).not.toContain("three")
  })

  it("selectAllBlocks + deleteBlockSelection command path also preserves the title", () => {
    const editor = makeTitledEditor()
    editor.commands.selectAllBlocks()
    expect(editor.commands.deleteBlockSelection()).toBe(true)
    expect(editor.state.doc.firstChild?.type.name).toBe(TITLE_TYPE)
    expect(editor.state.doc.firstChild?.textContent).toBe("My Page")
    expect(bodyTexts(editor)).not.toContain("one")
  })

  it("deleting all body re-seeds ONE empty body paragraph, caret inside it", () => {
    // The doc is schema-valid with just a title (`block+`), but the user needs a
    // line to type into — so the delete must leave [title, empty-paragraph].
    const editor = makeTitledEditor()
    editor.commands.selectAllBlocks()
    expect(editor.commands.deleteBlockSelection()).toBe(true)

    expect(editor.state.doc.childCount).toBe(2)
    expect(editor.state.doc.child(0).type.name).toBe(TITLE_TYPE)
    expect(editor.state.doc.child(1).type.name).toBe("paragraph")
    expect(editor.state.doc.child(1).textContent).toBe("")
    // Caret landed in the body paragraph, NOT in the title.
    expect(editor.state.selection.$from.parent.type.name).toBe("paragraph")
  })

  it("deleting a range starting at the first body block lands the caret in the body, not the title", () => {
    // [title, one, two, three] — delete body indices 1..2 (root indices 1..2).
    const editor = makeTitledEditor()
    editor.commands.setBlockSelection({ from: 1, to: 2 })
    expect(editor.commands.deleteBlockSelection()).toBe(true)

    // Surviving body is "three"; the caret must sit at its START (a following
    // keystroke prepends to it) — never parked at the end of the title.
    expect(bodyTexts(editor)).toEqual(["three"])
    const { $from } = editor.state.selection
    expect($from.parent.type.name).toBe("paragraph")
    expect($from.parent.textContent).toBe("three")
    expect($from.parentOffset).toBe(0)
  })
})

describe("title excluded from a marquee sweep", () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement("div")
    container.className = "rune-editor"
    document.body.appendChild(container)
    // surfaceFromPoint reads elementFromPoint; jsdom lacks it. Returning null
    // makes the marquee resolve the ROOT surface (mirrors marquee.test.ts).
    if (typeof document.elementFromPoint !== "function") {
      ;(document as unknown as {
        elementFromPoint: (x: number, y: number) => Element | null
      }).elementFromPoint = () => null
    }
  })

  afterEach(() => {
    document.querySelectorAll(".rune-marquee").forEach((el) => el.remove())
    container.remove()
  })

  function setBlockRects() {
    // One synthetic rect per .rune-block, stacked top→bottom (40px stride).
    // Index 0 = title, 1..3 = body paragraphs.
    const blocks = container.querySelectorAll(".rune-block")
    blocks.forEach((block, i) => {
      const rect = {
        top: 20 + i * 40,
        bottom: 50 + i * 40,
        left: 100,
        right: 300,
        width: 200,
        height: 30,
        x: 100,
        y: 20 + i * 40,
        toJSON: () => ({}),
      } as DOMRect
      ;(block as HTMLElement).getBoundingClientRect = () => rect
      const content = block.querySelector(".rune-block-content") as HTMLElement | null
      if (content) content.getBoundingClientRect = () => rect
    })
  }

  async function nextFrame() {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  }

  it("a sweep covering the title + all body blocks selects body only", async () => {
    const editor = makeTitledEditor(container)
    // Four blocks rendered: title + 3 paragraphs.
    expect(container.querySelectorAll(".rune-block").length).toBe(4)
    setBlockRects()

    // Start in the editor padding above/right of the title, sweep down past the
    // last body block — the rect geometrically covers ALL four blocks.
    container.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, clientX: 320, clientY: 5 }),
    )
    document.dispatchEvent(
      new MouseEvent("mousemove", { bubbles: true, buttons: 1, clientX: 120, clientY: 185 }),
    )
    await nextFrame()

    const sel = editor.state.selection as MultiBlockSelection
    expect(sel).toBeInstanceOf(MultiBlockSelection)
    // [1, 3] — the title (index 0) is geometrically covered but excluded.
    expect(sel.blockIndices).toEqual([1, 3])
    expect(sel.blockNodes.some((n) => n.type.name === TITLE_TYPE)).toBe(false)

    document.dispatchEvent(
      new MouseEvent("mouseup", { bubbles: true, clientX: 120, clientY: 185 }),
    )
  })
})
