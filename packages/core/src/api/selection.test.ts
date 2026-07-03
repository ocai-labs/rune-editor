// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, expect, it, vi } from "vitest"
import { Editor } from "@tiptap/core"
import { AllSelection, NodeSelection, TextSelection } from "@tiptap/pm/state"
import { CellSelection, TableMap } from "@tiptap/pm/tables"
import { createRuneKit } from "../kit"
import { getSelectionSnapshot, replaceSelectionText } from "./selection"

function editorWithDoc(content: unknown) {
  return new Editor({
    element: document.createElement("div"),
    extensions: createRuneKit({ suggestionMenus: false }),
    content: content as never,
  })
}

describe("getSelectionSnapshot", () => {
  it("reports an empty TextSelection inside a block", () => {
    const editor = editorWithDoc({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { id: "p1", depth: 0 },
          content: [{ type: "text", text: "Alpha" }],
        },
      ],
    })
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2)),
    )

    expect(getSelectionSnapshot(editor)).toMatchObject({
      kind: "text",
      replaceable: true,
      empty: true,
      text: "",
      anchorBlockId: "p1",
      headBlockId: "p1",
      blockIds: ["p1"],
      blocks: [{ id: "p1", type: "paragraph", index: 0, from: 1, to: 1 }],
    })
    editor.destroy()
  })

  it("reports single-block TextSelection offsets", () => {
    const editor = editorWithDoc({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { id: "p1", depth: 0 },
          content: [{ type: "text", text: "Alpha beta" }],
        },
      ],
    })
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 6)),
    )

    expect(getSelectionSnapshot(editor)).toMatchObject({
      kind: "text",
      replaceable: true,
      empty: false,
      text: "Alpha",
      blockIds: ["p1"],
      blocks: [{ id: "p1", type: "paragraph", index: 0, from: 0, to: 5 }],
    })
    editor.destroy()
  })

  it("flags containsInlineAtoms when the range covers an inline atom", () => {
    const editor = editorWithDoc({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { id: "p1", depth: 0 },
          content: [
            { type: "text", text: "Alpha " },
            { type: "inlineMath", attrs: { latex: "x^2" } },
            { type: "text", text: " beta" },
          ],
        },
      ],
    })
    // Whole paragraph text, spanning the inline math atom at pos 7.
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, 1, 13),
      ),
    )

    const snap = getSelectionSnapshot(editor)
    expect(snap.containsInlineAtoms).toBe(true)
    // The atom carries no text — textBetween drops it, which is exactly why a
    // plain-text round trip would destroy it.
    expect(snap.text).not.toContain("x^2")
    editor.destroy()
  })

  it("does not flag containsInlineAtoms for a plain text range", () => {
    const editor = editorWithDoc({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { id: "p1", depth: 0 },
          content: [
            { type: "text", text: "Alpha " },
            { type: "inlineMath", attrs: { latex: "x^2" } },
          ],
        },
      ],
    })
    // "Alpha" only — stops before the atom at pos 7.
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 6)),
    )

    expect(getSelectionSnapshot(editor).containsInlineAtoms).toBe(false)
    editor.destroy()
  })

  it("reports cross-block TextSelection offsets in document order", () => {
    const editor = editorWithDoc({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { id: "p1", depth: 0 },
          content: [{ type: "text", text: "Alpha" }],
        },
        {
          type: "paragraph",
          attrs: { id: "p2", depth: 0 },
          content: [{ type: "text", text: "Beta" }],
        },
      ],
    })
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 4, 10)),
    )

    expect(getSelectionSnapshot(editor)).toMatchObject({
      kind: "text",
      replaceable: true,
      text: "ha\nBe",
      blockIds: ["p1", "p2"],
      blocks: [
        { id: "p1", type: "paragraph", index: 0, from: 3, to: 5 },
        { id: "p2", type: "paragraph", index: 1, from: 0, to: 2 },
      ],
    })
    editor.destroy()
  })

  it("reports nested table TextSelection against the top-level table block", () => {
    const editor = editorWithDoc({
      type: "doc",
      content: [
        {
          type: "table",
          attrs: { id: "t1", depth: 0 },
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableHeader",
                  content: [{ type: "tableParagraph", content: [{ type: "text", text: "A" }] }],
                },
                {
                  type: "tableHeader",
                  content: [{ type: "tableParagraph", content: [{ type: "text", text: "B" }] }],
                },
              ],
            },
          ],
        },
      ],
    })
    const table = editor.state.doc.child(0)
    const map = TableMap.get(table)
    const tableStart = 1
    const firstCell = tableStart + map.map[0]!
    const firstCellTextStart = firstCell + 2
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, firstCellTextStart, firstCellTextStart + 1),
      ),
    )

    expect(getSelectionSnapshot(editor)).toMatchObject({
      kind: "text",
      replaceable: false,
      text: "A",
      blockIds: ["t1"],
      blocks: [{ id: "t1", type: "table", index: 0, from: 0, to: 1 }],
    })
    editor.destroy()
  })

  it("reports AllSelection as readable but not replaceable", () => {
    const editor = editorWithDoc({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { id: "p1", depth: 0 },
          content: [{ type: "text", text: "Alpha" }],
        },
      ],
    })
    editor.view.dispatch(
      editor.state.tr.setSelection(new AllSelection(editor.state.doc)),
    )

    expect(getSelectionSnapshot(editor)).toMatchObject({
      kind: "all",
      replaceable: false,
      empty: false,
      text: "Alpha",
      blockIds: ["p1"],
    })
    editor.destroy()
  })

  it("reports top-level NodeSelection as readable but not replaceable", () => {
    const editor = editorWithDoc({
      type: "doc",
      content: [
        {
          type: "divider",
          attrs: { id: "d1", depth: 0 },
        },
      ],
    })
    editor.view.dispatch(
      editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 0)),
    )

    expect(getSelectionSnapshot(editor)).toMatchObject({
      kind: "node",
      replaceable: false,
      empty: false,
      text: "",
      blockIds: ["d1"],
      blocks: [{ id: "d1", type: "divider", index: 0, from: 0, to: 0 }],
    })
    editor.destroy()
  })

  it("reports CellSelection as unsupported without PM positions", () => {
    const editor = editorWithDoc({
      type: "doc",
      content: [
        {
          type: "table",
          attrs: { id: "t1", depth: 0 },
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableHeader",
                  content: [{ type: "tableParagraph", content: [{ type: "text", text: "A" }] }],
                },
                {
                  type: "tableHeader",
                  content: [{ type: "tableParagraph", content: [{ type: "text", text: "B" }] }],
                },
              ],
            },
          ],
        },
      ],
    })
    const table = editor.state.doc.child(0)
    const map = TableMap.get(table)
    const tableStart = 1
    const firstCell = tableStart + map.map[0]!
    const secondCell = tableStart + map.map[1]!
    editor.view.dispatch(
      editor.state.tr.setSelection(CellSelection.create(editor.state.doc, firstCell, secondCell)),
    )

    expect(getSelectionSnapshot(editor)).toEqual({
      kind: "unsupported",
      replaceable: false,
      containsInlineAtoms: false,
      empty: false,
      text: "",
      blockIds: [],
      blocks: [],
      unsupportedReason: "unsupported-selection",
    })
    editor.destroy()
  })
})

describe("getSelectionSnapshot — columns (nested body-block frames, COL-4)", () => {
  // Regression: the frame walk emits the columnLayout AND its in-column
  // children — OVERLAPPING frames. The old disjoint-frame assumptions resolved
  // an in-column caret to the LAYOUT (wrong anchor id, layout-relative offsets,
  // double-counted blockIds) and reported an in-column NodeSelection as
  // "unsupported".
  const columnsDoc = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { id: "r1", depth: 0 },
        content: [{ type: "text", text: "Root one" }],
      },
      {
        type: "columnLayout",
        attrs: { id: "lay1", depth: 0 },
        content: [
          {
            type: "column",
            attrs: { id: "col_a", width: 1 },
            content: [
              {
                type: "paragraph",
                attrs: { id: "a1", depth: 0 },
                content: [{ type: "text", text: "A1" }],
              },
            ],
          },
          {
            type: "column",
            attrs: { id: "col_b", width: 1 },
            content: [
              {
                type: "paragraph",
                attrs: { id: "b1", depth: 0 },
                content: [{ type: "text", text: "B1" }],
              },
            ],
          },
        ],
      },
      {
        type: "paragraph",
        attrs: { id: "r2", depth: 0 },
        content: [{ type: "text", text: "Root two" }],
      },
    ],
  }

  function blockPos(editor: Editor, id: string): number {
    let p = -1
    editor.state.doc.descendants((node, pos) => {
      if (p >= 0) return false
      if (node.attrs?.id === id) {
        p = pos
        return false
      }
      return true
    })
    if (p < 0) throw new Error(`block ${id} not found`)
    return p
  }

  it("caret in an in-column paragraph resolves THAT block, not the layout", () => {
    const editor = editorWithDoc(columnsDoc)
    // Caret "A|1" — one char into a1's text.
    const caret = blockPos(editor, "a1") + 2
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, caret)),
    )

    expect(getSelectionSnapshot(editor)).toMatchObject({
      kind: "text",
      empty: true,
      anchorBlockId: "a1",
      headBlockId: "a1",
      blockIds: ["a1"],
      blocks: [{ id: "a1", type: "paragraph", from: 1, to: 1 }],
    })
    editor.destroy()
  })

  it("in-column text range reports block-local offsets without double counting", () => {
    const editor = editorWithDoc(columnsDoc)
    const a1 = blockPos(editor, "a1")
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, a1 + 1, a1 + 3)),
    )

    expect(getSelectionSnapshot(editor)).toMatchObject({
      kind: "text",
      text: "A1",
      anchorBlockId: "a1",
      headBlockId: "a1",
      blockIds: ["a1"],
      blocks: [{ id: "a1", type: "paragraph", from: 0, to: 2 }],
    })
    editor.destroy()
  })

  it("NodeSelection of an in-column paragraph is kind 'node', not unsupported", () => {
    const editor = editorWithDoc(columnsDoc)
    editor.view.dispatch(
      editor.state.tr.setSelection(
        NodeSelection.create(editor.state.doc, blockPos(editor, "a1")),
      ),
    )

    expect(getSelectionSnapshot(editor)).toMatchObject({
      kind: "node",
      text: "A1",
      anchorBlockId: "a1",
      headBlockId: "a1",
      blockIds: ["a1"],
    })
    editor.destroy()
  })

  it("NodeSelection of the layout itself resolves the layout frame", () => {
    const editor = editorWithDoc(columnsDoc)
    editor.view.dispatch(
      editor.state.tr.setSelection(
        NodeSelection.create(editor.state.doc, blockPos(editor, "lay1")),
      ),
    )

    expect(getSelectionSnapshot(editor)).toMatchObject({
      kind: "node",
      blockIds: ["lay1"],
    })
    editor.destroy()
  })

  it("NodeSelection of a non-first ROOT block resolves that block (boundary tie)", () => {
    // r2.from coincides with the layout frame's end boundary; the resolver
    // must pick r2's own frame, not stop at the earlier containing frame.
    const editor = editorWithDoc(columnsDoc)
    editor.view.dispatch(
      editor.state.tr.setSelection(
        NodeSelection.create(editor.state.doc, blockPos(editor, "r2")),
      ),
    )

    expect(getSelectionSnapshot(editor)).toMatchObject({
      kind: "node",
      text: "Root two",
      blockIds: ["r2"],
    })
    editor.destroy()
  })

  it("selection spanning the layout lists in-column children once, container excluded", () => {
    const editor = editorWithDoc(columnsDoc)
    const from = blockPos(editor, "r1") + 1 // start of "Root one"
    const to = blockPos(editor, "r2") + 1 + 8 // end of "Root two"
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)),
    )

    expect(getSelectionSnapshot(editor)).toMatchObject({
      kind: "text",
      blockIds: ["r1", "a1", "b1", "r2"],
      blocks: [
        { id: "r1", type: "paragraph", from: 0, to: 8 },
        { id: "a1", type: "paragraph", from: 0, to: 2 },
        { id: "b1", type: "paragraph", from: 0, to: 2 },
        { id: "r2", type: "paragraph", from: 0, to: 8 },
      ],
    })
    editor.destroy()
  })
})

describe("replaceSelectionText", () => {
  it("replaces a non-empty TextSelection with plain text", () => {
    const editor = editorWithDoc({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { id: "p1", depth: 0 },
          content: [{ type: "text", text: "Alpha beta" }],
        },
      ],
    })
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 6)),
    )

    const result = replaceSelectionText(editor, "Gamma")

    expect(result).toEqual({ ok: true, data: { changedBlockIds: ["p1"] } })
    expect(editor.state.doc.textContent).toBe("Gamma beta")
    editor.destroy()
  })

  it("inserts plain text at an empty TextSelection", () => {
    const editor = editorWithDoc({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { id: "p1", depth: 0 },
          content: [{ type: "text", text: "Alpha" }],
        },
      ],
    })
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 6)),
    )

    const result = replaceSelectionText(editor, " beta")

    expect(result).toEqual({ ok: true, data: { changedBlockIds: ["p1"] } })
    expect(editor.state.doc.textContent).toBe("Alpha beta")
    editor.destroy()
  })

  it("uses the existing plain-text parser for multiline input, not markdown import", () => {
    const editor = editorWithDoc({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { id: "p1", depth: 0 },
          content: [{ type: "text", text: "Alpha" }],
        },
      ],
    })
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 6)),
    )

    const result = replaceSelectionText(editor, "# Heading\r\n- bullet")

    expect(result.ok).toBe(true)
    expect(editor.getJSON()).toMatchObject({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "# Heading" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "- bullet" }],
        },
      ],
    })
    expect(editor.state.doc.child(0).type.name).toBe("paragraph")
    expect(editor.state.doc.child(1).type.name).toBe("paragraph")
    editor.destroy()
  })

  it("reports the ids of every resulting block for multiline replacement", () => {
    const editor = editorWithDoc({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { id: "p1", depth: 0 },
          content: [{ type: "text", text: "Alpha" }],
        },
      ],
    })
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 6)),
    )

    const result = replaceSelectionText(editor, "one\ntwo\nthree")

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected ok")

    const json = editor.getJSON()
    const resultingIds = (json.content ?? []).map(
      (block) => (block.attrs as { id?: string } | undefined)?.id,
    )

    // (a) contains exactly the ids of the resulting top-level blocks
    expect([...result.data.changedBlockIds].sort()).toEqual(
      [...(resultingIds as string[])].sort(),
    )
    // (b) does not contain the stale original id (regenerated by BlockId)
    expect(result.data.changedBlockIds).not.toContain("p1")
    // (c) has the right count (one paragraph per line)
    expect(result.data.changedBlockIds).toHaveLength(3)
    expect(resultingIds).toHaveLength(3)
    editor.destroy()
  })

  it("rejects nested table text replacement before dispatching", () => {
    const editor = editorWithDoc({
      type: "doc",
      content: [
        {
          type: "table",
          attrs: { id: "t1", depth: 0 },
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableHeader",
                  content: [{ type: "tableParagraph", content: [{ type: "text", text: "A" }] }],
                },
              ],
            },
          ],
        },
      ],
    })
    const table = editor.state.doc.child(0)
    const map = TableMap.get(table)
    const tableStart = 1
    const firstCell = tableStart + map.map[0]!
    const firstCellTextStart = firstCell + 2
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, firstCellTextStart, firstCellTextStart + 1),
      ),
    )
    const before = editor.getJSON()
    const dispatchSpy = vi.spyOn(editor.view, "dispatch")

    const result = replaceSelectionText(editor, "B")

    expect(result).toEqual({
      ok: false,
      error: {
        code: "unsupported",
        message: "Plain text replacement is only supported in top-level text blocks.",
      },
    })
    expect(dispatchSpy).not.toHaveBeenCalled()
    expect(editor.getJSON()).toEqual(before)
    editor.destroy()
  })

  it("rejects readonly editors without dispatching", () => {
    const editor = editorWithDoc({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { id: "p1", depth: 0 },
          content: [{ type: "text", text: "Alpha" }],
        },
      ],
    })
    editor.setEditable(false)
    const before = editor.getJSON()
    const dispatchSpy = vi.spyOn(editor.view, "dispatch")

    const result = replaceSelectionText(editor, "Beta")

    expect(result).toEqual({
      ok: false,
      error: {
        code: "not-editable",
        message: "Editor is not editable.",
      },
    })
    expect(dispatchSpy).not.toHaveBeenCalled()
    expect(editor.getJSON()).toEqual(before)
    editor.destroy()
  })

  it("rejects destroyed editors", () => {
    const editor = editorWithDoc({ type: "doc", content: [] })
    editor.destroy()

    expect(replaceSelectionText(editor, "Beta")).toEqual({
      ok: false,
      error: {
        code: "editor-destroyed",
        message: "Editor is destroyed.",
      },
    })
  })

  it("rejects NodeSelection without dispatching", () => {
    const editor = editorWithDoc({
      type: "doc",
      content: [{ type: "divider", attrs: { id: "d1", depth: 0 } }],
    })
    editor.view.dispatch(
      editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 0)),
    )
    const before = editor.getJSON()
    const dispatchSpy = vi.spyOn(editor.view, "dispatch")

    const result = replaceSelectionText(editor, "Beta")

    expect(result).toEqual({
      ok: false,
      error: {
        code: "unsupported",
        message: "Only text selections can be replaced as plain text.",
      },
    })
    expect(dispatchSpy).not.toHaveBeenCalled()
    expect(editor.getJSON()).toEqual(before)
    editor.destroy()
  })

  it("rejects selections containing an inline atom without dispatching", () => {
    const editor = editorWithDoc({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { id: "p1", depth: 0 },
          content: [
            { type: "text", text: "Alpha " },
            { type: "inlineMath", attrs: { latex: "x^2" } },
            { type: "text", text: " beta" },
          ],
        },
      ],
    })
    // Whole paragraph text, spanning the inline math atom.
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, 1, 13),
      ),
    )
    const before = editor.getJSON()
    const dispatchSpy = vi.spyOn(editor.view, "dispatch")

    const result = replaceSelectionText(editor, "rewritten")

    expect(result).toEqual({
      ok: false,
      error: {
        code: "unsupported",
        message:
          "Selection contains inline atoms (e.g. inline math) that plain-text replacement would delete.",
      },
    })
    // The atom — and the whole selection — must be untouched.
    expect(dispatchSpy).not.toHaveBeenCalled()
    expect(editor.getJSON()).toEqual(before)
    editor.destroy()
  })
})
