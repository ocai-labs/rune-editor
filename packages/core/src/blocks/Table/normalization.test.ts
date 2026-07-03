// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, it, expect } from "vitest"
import { Editor } from "@tiptap/core"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import { createTestEditor } from "../../test-utils/createTestEditor"
import { createRuneKit } from "../../kit"
import { INTERNAL_NORMALIZATION_META } from "../../extensions/internal-meta"
import { __internals } from "./normalization"

const { splitTableParagraphAtHardBreaks, computeCellSplitPatches } = __internals

// A 1x1 (header + 1 body row) table whose single body cell holds the given
// tableParagraph children.
function tableWithBodyCell(children: object[]) {
  return {
    type: "table",
    attrs: { id: "tbl", depth: 0 },
    content: [
      {
        type: "tableRow",
        content: [
          {
            type: "tableHeader",
            content: [{ type: "tableParagraph", content: [{ type: "text", text: "H" }] }],
          },
        ],
      },
      {
        type: "tableRow",
        content: [{ type: "tableCell", content: children }],
      },
    ],
  }
}

function embeddedBreakCellDoc(lines: string[]) {
  return {
    type: "doc",
    content: [
      tableWithBodyCell([
        {
          type: "tableParagraph",
          content: lines.flatMap((t, i) =>
            i === 0
              ? [{ type: "text", text: t }]
              : [{ type: "hardBreak" }, { type: "text", text: t }],
          ),
        },
      ]),
    ],
  }
}

function cellParagraphTexts(editor: Editor): string[] {
  const out: string[] = []
  editor.state.doc.descendants((node) => {
    if (node.type.name === "tableParagraph") out.push(node.textContent)
    return true
  })
  return out
}

describe("splitTableParagraphAtHardBreaks (pure)", () => {
  it("returns null for a tableParagraph with no hardBreak", () => {
    const probe = new Editor({ extensions: createRuneKit() })
    const s = probe.schema
    const node = s.nodes.tableParagraph!.create(null, s.text("plain"))
    expect(splitTableParagraphAtHardBreaks(s, node)).toBeNull()
    probe.destroy()
  })

  it("splits a single hardBreak into two sibling tableParagraphs, preserving marks", () => {
    const probe = new Editor({ extensions: createRuneKit() })
    const s = probe.schema
    const bold = s.marks.bold!.create()
    const node = s.nodes.tableParagraph!.create(null, [
      s.text("line1", [bold]),
      s.nodes.hardBreak!.create(),
      s.text("line2"),
    ])
    const out = splitTableParagraphAtHardBreaks(s, node)!
    expect(out).toHaveLength(2)
    expect(out[0]!.type.name).toBe("tableParagraph")
    expect(out[0]!.textContent).toBe("line1")
    expect(out[0]!.firstChild?.marks.map((m) => m.type.name)).toEqual(["bold"])
    expect(out[1]!.textContent).toBe("line2")
    expect(out[1]!.firstChild?.marks).toEqual([])
    probe.destroy()
  })

  it("keeps consecutive hardBreaks as an empty tableParagraph in between", () => {
    const probe = new Editor({ extensions: createRuneKit() })
    const s = probe.schema
    const node = s.nodes.tableParagraph!.create(null, [
      s.text("a"),
      s.nodes.hardBreak!.create(),
      s.nodes.hardBreak!.create(),
      s.text("b"),
    ])
    const out = splitTableParagraphAtHardBreaks(s, node)!
    expect(out.map((p) => p.textContent)).toEqual(["a", "", "b"])
    expect(out[1]!.childCount).toBe(0)
    probe.destroy()
  })

  it("keeps a leading/trailing hardBreak as an empty edge tableParagraph", () => {
    const probe = new Editor({ extensions: createRuneKit() })
    const s = probe.schema
    const node = s.nodes.tableParagraph!.create(null, [
      s.nodes.hardBreak!.create(),
      s.text("a"),
      s.nodes.hardBreak!.create(),
    ])
    const out = splitTableParagraphAtHardBreaks(s, node)!
    expect(out.map((p) => p.textContent)).toEqual(["", "a", ""])
    probe.destroy()
  })
})

describe("computeCellSplitPatches (pure)", () => {
  // Built directly against the schema (bypassing a live editor mount, which
  // would normalize the doc before we ever get to inspect the PRE-split
  // shape — the pure function is exercised on a raw node here, same
  // discipline as ColumnsNormalization's pure-function tests).
  it("finds a patch for every hardBreak-bearing tableParagraph, skipping clean ones", () => {
    const probe = new Editor({ extensions: createRuneKit() })
    const s = probe.schema
    const headerPara = s.nodes.tableParagraph!.create(null, s.text("H"))
    const bodyPara = s.nodes.tableParagraph!.create(null, [
      s.text("line1"),
      s.nodes.hardBreak!.create(),
      s.text("line2"),
    ])
    const doc = s.nodes.doc!.create(null, [
      s.nodes.table!.create({ id: "tbl", depth: 0 }, [
        s.nodes.tableRow!.create(null, [s.nodes.tableHeader!.create(null, headerPara)]),
        s.nodes.tableRow!.create(null, [s.nodes.tableCell!.create(null, bodyPara)]),
      ]),
    ])

    const patches = computeCellSplitPatches(doc)
    // One patch: the body cell's single tableParagraph (the header cell's
    // tableParagraph has no hardBreak, so it's excluded).
    expect(patches).toHaveLength(1)
    expect(patches[0]!.replacement.map((p) => p.textContent)).toEqual(["line1", "line2"])
    probe.destroy()
  })

  it("returns an empty array when no cell has a hardBreak", () => {
    const editor = createTestEditor({
      content: { type: "doc", content: [tableWithBodyCell([{ type: "tableParagraph", content: [{ type: "text", text: "plain" }] }])] },
    })
    expect(computeCellSplitPatches(editor.state.doc)).toHaveLength(0)
    editor.destroy()
  })
})

describe("TableCellNormalization — integration", () => {
  it("splits an embedded in-cell hardBreak into sibling tableParagraphs on mount", () => {
    const editor = createTestEditor({ content: embeddedBreakCellDoc(["line1", "line2"]) })
    expect(cellParagraphTexts(editor)).toEqual(["H", "line1", "line2"])
    editor.destroy()
  })

  it("normalization tr is tagged INTERNAL_NORMALIZATION_META + addToHistory=false", () => {
    const editor = createTestEditor({ content: { type: "doc", content: [tableWithBodyCell([{ type: "tableParagraph", content: [{ type: "text", text: "plain" }] }])] } })

    let cellPos = -1
    editor.state.doc.descendants((node, pos) => {
      if (cellPos < 0 && node.type.name === "tableParagraph" && node.textContent === "plain") {
        cellPos = pos
      }
      return true
    })
    const node = editor.state.doc.nodeAt(cellPos)!
    const tr = editor.state.tr.replaceWith(cellPos, cellPos + node.nodeSize, [
      editor.schema.nodes.tableParagraph!.create(null, [
        editor.schema.text("a"),
        editor.schema.nodes.hardBreak!.create(),
        editor.schema.text("b"),
      ]),
    ])
    const { transactions } = editor.state.applyTransaction(tr)
    const norm = transactions.find((t) => t.getMeta(INTERNAL_NORMALIZATION_META) === true)
    expect(norm).toBeDefined()
    expect(norm!.getMeta("addToHistory")).toBe(false)
    editor.destroy()
  })
})

describe("TableCellNormalization — editable gate (#21)", () => {
  it("a read-only editor over an embedded in-cell hardBreak leaves it untouched on mount", () => {
    const editor = createTestEditor({
      content: embeddedBreakCellDoc(["line1", "line2"]),
      editable: false,
    })
    expect(editor.isEditable).toBe(false)
    // Still ONE tableParagraph in the body cell, hardBreak embedded — not
    // split into siblings.
    expect(cellParagraphTexts(editor)).toEqual(["H", "line1line2"])
    let hardBreaks = 0
    editor.state.doc.descendants((node) => {
      if (node.type.name === "hardBreak") hardBreaks += 1
      return true
    })
    expect(hardBreaks).toBe(1)
    editor.destroy()
  })

  it("an editable editor over the same doc splits on mount (control)", () => {
    const editor = createTestEditor({ content: embeddedBreakCellDoc(["line1", "line2"]) })
    expect(editor.isEditable).toBe(true)
    expect(cellParagraphTexts(editor)).toEqual(["H", "line1", "line2"])
    editor.destroy()
  })

  it("setEditable(true) alone does not re-normalize; the NEXT doc-changing transaction does", () => {
    // Mirrors Columns/normalization.test.ts's identical gate test: Tiptap's
    // setEditable/setOptions calls view.updateState with the SAME state (no
    // transaction dispatched), so appendTransaction never fires from the
    // flip itself. Normalization resumes on the next transaction that
    // changes the doc, which re-scans and fixes the WHOLE doc.
    const editor = createTestEditor({
      content: embeddedBreakCellDoc(["line1", "line2"]),
      editable: false,
    })
    expect(cellParagraphTexts(editor)).toEqual(["H", "line1line2"])

    editor.setEditable(true)
    // No transaction fired yet — still unnormalized immediately after the flip.
    expect(cellParagraphTexts(editor)).toEqual(["H", "line1line2"])

    // Any doc-changing transaction (a plain text insert, standing in for a
    // real user edit) triggers appendTransaction, which now passes the
    // editable gate and normalizes the whole doc in the same pass. Insert
    // at the start of the header cell's own text (found explicitly — a
    // table's nested structure makes a magic position unreliable).
    let headerTextPos = -1
    editor.state.doc.descendants((node, pos) => {
      if (headerTextPos < 0 && node.isText && node.text === "H") headerTextPos = pos
      return true
    })
    expect(headerTextPos).toBeGreaterThan(-1)
    editor.commands.command(({ tr, dispatch }) => {
      if (dispatch) dispatch(tr.insertText("!", headerTextPos))
      return true
    })
    expect(cellParagraphTexts(editor)).toEqual(["!H", "line1", "line2"])
    editor.destroy()
  })
})
