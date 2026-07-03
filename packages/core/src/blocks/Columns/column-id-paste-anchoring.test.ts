// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Regression coverage: column-id paste anchoring.
//
// normalization.ts's column-id backfill anchors each column id to the
// pre-existing column that carried it (via computeAnchoredPositions, the same
// helper BlockId uses in extensions/block-id.ts). Without that anchor,
// computeIdPatches falls back to "first occurrence in doc order keeps the id",
// so pasting a copy of a columnLayout ABOVE its original — same column ids,
// different text — would make the COPY (now first in doc order) keep
// col_A/col_B while the ORIGINAL got its ids regenerated, silently redirecting
// resolveColumnById / insertBlocks({columnId}) / moveBlocks at the copy.
//
// Each assertion states the CORRECT contract, mirroring BlockId's own
// anchoring guarantee ("keeps the original block's id when a duplicate is
// pasted ABOVE it" in extensions/block-id.test.ts). The second column case
// additionally forces a structural normalization step (no-nesting flatten) to
// run BEFORE the id pass, proving the anchor positions survive the resulting
// position shift via tr.mapping.

import { describe, it, expect } from "vitest"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import { createTestEditor } from "../../test-utils/createTestEditor"

function idForNodeText(doc: ProseMirrorNode, nodeType: string, text: string): string {
  let found: string | null = null
  doc.descendants((node) => {
    if (node.type.name === nodeType && node.textContent === text) {
      found = node.attrs.id as string
    }
    return true
  })
  if (found == null) throw new Error(`no ${nodeType} with text "${text}" found`)
  return found
}

function columnIdCounts(doc: ProseMirrorNode): Map<string, number> {
  const counts = new Map<string, number>()
  doc.descendants((node) => {
    if (node.type.name === "column") {
      const id = node.attrs.id as string
      counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    return true
  })
  return counts
}

describe("Columns column-id paste anchoring", () => {
  it("keeps the ORIGINAL layout's column ids stable when an identical copy is pasted ABOVE it", () => {
    const editor = createTestEditor({
      content: {
        type: "doc",
        content: [
          {
            type: "columnLayout",
            content: [
              {
                type: "column",
                attrs: { id: "col_A", width: 1 },
                content: [
                  { type: "paragraph", content: [{ type: "text", text: "left original" }] },
                ],
              },
              {
                type: "column",
                attrs: { id: "col_B", width: 1 },
                content: [
                  { type: "paragraph", content: [{ type: "text", text: "right original" }] },
                ],
              },
            ],
          },
        ],
      },
    })

    // Sanity: unique ids on the initial doc are preserved as-is.
    expect(idForNodeText(editor.state.doc, "column", "left original")).toBe("col_A")
    expect(idForNodeText(editor.state.doc, "column", "right original")).toBe("col_B")

    // Simulate a paste-above: an identical-id copy of the whole layout,
    // inserted at pos 0 (before the original in doc order). Text differs so
    // original vs. copy are distinguishable after the dispatch; the layout's
    // own id is left null (its anchoring is BlockId's concern — isolating the
    // column-id variable under test).
    const schema = editor.schema
    const pastedLayout = schema.nodes.columnLayout!.create({ id: null, depth: 0 }, [
      schema.nodes.column!.create({ id: "col_A", width: 1 }, [
        schema.nodes.paragraph!.create({ id: null, depth: 0 }, schema.text("left pasted")),
      ]),
      schema.nodes.column!.create({ id: "col_B", width: 1 }, [
        schema.nodes.paragraph!.create({ id: null, depth: 0 }, schema.text("right pasted")),
      ]),
    ])
    editor.view.dispatch(editor.state.tr.insert(0, pastedLayout))

    // The pre-existing (original) column keeps its id; the newly-inserted copy
    // is the one regenerated (mirrors BlockId's anchoring for body blocks).
    expect(idForNodeText(editor.state.doc, "column", "left original")).toBe("col_A")
    expect(idForNodeText(editor.state.doc, "column", "right original")).toBe("col_B")
    expect(idForNodeText(editor.state.doc, "column", "left pasted")).not.toBe("col_A")
    expect(idForNodeText(editor.state.doc, "column", "right pasted")).not.toBe("col_B")
  })

  it("keeps the original's ids even when the pasted copy triggers a structural normalization step (no-nesting flatten) BEFORE the id pass", () => {
    const editor = createTestEditor({
      content: {
        type: "doc",
        content: [
          {
            type: "columnLayout",
            content: [
              {
                type: "column",
                attrs: { id: "col_A", width: 1 },
                content: [
                  { type: "paragraph", content: [{ type: "text", text: "left original" }] },
                ],
              },
              {
                type: "column",
                attrs: { id: "col_B", width: 1 },
                content: [
                  { type: "paragraph", content: [{ type: "text", text: "right original" }] },
                ],
              },
            ],
          },
        ],
      },
    })

    expect(idForNodeText(editor.state.doc, "column", "left original")).toBe("col_A")
    expect(idForNodeText(editor.state.doc, "column", "right original")).toBe("col_B")

    // A copy of the layout pasted ABOVE the original, same outer column ids.
    // One copy column additionally holds a NESTED columnLayout: schema-valid
    // (column content is `block+` and columnLayout is a block), so it survives
    // tr.insert — but it violates the Rune no-nesting invariant, which the
    // normalization pass FLATTENS in the same appendTransaction, BEFORE the id
    // pass. That flatten shrinks the copy (which sits above the original),
    // shifting the original columns' positions. The anchor map must ride
    // tr.mapping through the flatten or the original loses its ids.
    const schema = editor.schema
    const innerLayout = schema.nodes.columnLayout!.create({ id: null, depth: 0 }, [
      schema.nodes.column!.create({ id: "col_inner_x", width: 1 }, [
        schema.nodes.paragraph!.create({ id: null, depth: 0 }, schema.text("nested one")),
      ]),
      schema.nodes.column!.create({ id: "col_inner_y", width: 1 }, [
        schema.nodes.paragraph!.create({ id: null, depth: 0 }, schema.text("nested two")),
      ]),
    ])
    const pastedLayout = schema.nodes.columnLayout!.create({ id: null, depth: 0 }, [
      schema.nodes.column!.create({ id: "col_A", width: 1 }, [
        schema.nodes.paragraph!.create({ id: null, depth: 0 }, schema.text("left pasted")),
        innerLayout,
      ]),
      schema.nodes.column!.create({ id: "col_B", width: 1 }, [
        schema.nodes.paragraph!.create({ id: null, depth: 0 }, schema.text("right pasted")),
      ]),
    ])
    editor.view.dispatch(editor.state.tr.insert(0, pastedLayout))

    // The nested layout was flattened away (no-nesting ran): only the two
    // top-level layouts remain. This confirms a structural step preceded the
    // id pass — the position shift the anchor map has to survive.
    let layoutCount = 0
    editor.state.doc.descendants((node) => {
      if (node.type.name === "columnLayout") layoutCount += 1
      return true
    })
    expect(layoutCount).toBe(2)

    // The original columns keep their ids through the structural shift.
    expect(idForNodeText(editor.state.doc, "column", "left original")).toBe("col_A")
    expect(idForNodeText(editor.state.doc, "column", "right original")).toBe("col_B")

    // Exactly one surviving column bears each original id — the pasted copies
    // were regenerated, the dissolved inner columns are gone.
    const counts = columnIdCounts(editor.state.doc)
    expect(counts.get("col_A")).toBe(1)
    expect(counts.get("col_B")).toBe(1)
  })

  it("CONTROL: the same paste-above gesture on plain paragraph body blocks keeps the original's block id (BlockId anchoring works)", () => {
    const editor = createTestEditor({
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { id: "paraA001" },
            content: [{ type: "text", text: "first original" }],
          },
          {
            type: "paragraph",
            attrs: { id: "paraB001" },
            content: [{ type: "text", text: "second original" }],
          },
        ],
      },
    })

    expect(idForNodeText(editor.state.doc, "paragraph", "first original")).toBe("paraA001")
    expect(idForNodeText(editor.state.doc, "paragraph", "second original")).toBe("paraB001")

    const schema = editor.schema
    const pastedParas = [
      schema.nodes.paragraph!.create({ id: "paraA001", depth: 0 }, schema.text("first pasted")),
      schema.nodes.paragraph!.create({ id: "paraB001", depth: 0 }, schema.text("second pasted")),
    ]
    editor.view.dispatch(editor.state.tr.insert(0, pastedParas))

    expect(idForNodeText(editor.state.doc, "paragraph", "first original")).toBe("paraA001")
    expect(idForNodeText(editor.state.doc, "paragraph", "second original")).toBe("paraB001")
    expect(idForNodeText(editor.state.doc, "paragraph", "first pasted")).not.toBe("paraA001")
    expect(idForNodeText(editor.state.doc, "paragraph", "second pasted")).not.toBe("paraB001")
  })
})
