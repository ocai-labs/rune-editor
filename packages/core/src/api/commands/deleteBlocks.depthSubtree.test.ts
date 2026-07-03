// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Regression suite — deleteBlocks orphans depth-children of the deleted
// parent. Live-Notion research (internal design notes) confirmed real Notion always deletes the
// WHOLE depth-subtree with a parent, never orphans, never promotes. Fix:
// resolveDeleteRanges (deleteBlocks.ts) widens each resolved range's tail
// over `depthSubtreeRange` (schema/bodySurface.ts) — the same "consecutive
// following siblings with depth > mine" walk `wrapIntoColumns`'s targetTo
// widening and `Toggle/range.ts`'s toggleBodyRange already use, generalized
// to any block type (flat-schema indentation is depth-attribute-only, not
// tied to toggles or lists).

import { describe, it, expect } from "vitest"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import { createTestEditor } from "../../test-utils/createTestEditor"
import { getDocument } from "../queries"

const HIDDEN = "HIDDEN-CHILD"

// parent@0 · child@1 (HIDDEN text) · sibling@0 — the exact repro from the
// task: deleting "parent" by id must not leave "child" floating at depth 1
// with no parent above it.
function makeParentChildDoc() {
  const editor = createTestEditor()
  editor.commands.setContent([
    {
      type: "paragraph",
      attrs: { id: "parent", depth: 0 },
      content: [{ type: "text", text: "Parent" }],
    },
    {
      type: "paragraph",
      attrs: { id: "child", depth: 1 },
      content: [{ type: "text", text: HIDDEN }],
    },
    {
      type: "paragraph",
      attrs: { id: "sibling", depth: 0 },
      content: [{ type: "text", text: "Sibling" }],
    },
  ] as never)
  return editor
}

describe("deleteBlocks — depth-subtree carry (no orphaned children)", () => {
  it("deleteBlocks([parentId]) removes the depth-child too", () => {
    const editor = makeParentChildDoc()
    const ok = editor.commands.deleteBlocks(["parent"])
    expect(ok).toBe(true)
    expect(editor.state.doc.textContent).not.toContain(HIDDEN)
    expect(getDocument(editor).map((b) => b.id)).toEqual(["sibling"])
  })

  it("deleteBlocks({from,to}) ending on a depth-parent carries its subtree too", () => {
    const editor = createTestEditor()
    editor.commands.setContent([
      {
        type: "paragraph",
        attrs: { id: "a", depth: 0 },
        content: [{ type: "text", text: "A" }],
      },
      {
        type: "paragraph",
        attrs: { id: "parent", depth: 0 },
        content: [{ type: "text", text: "Parent" }],
      },
      {
        type: "paragraph",
        attrs: { id: "child", depth: 1 },
        content: [{ type: "text", text: HIDDEN }],
      },
      {
        type: "paragraph",
        attrs: { id: "sibling", depth: 0 },
        content: [{ type: "text", text: "Sibling" }],
      },
    ] as never)
    const ok = editor.commands.deleteBlocks({ from: "a", to: "parent" })
    expect(ok).toBe(true)
    expect(editor.state.doc.textContent).not.toContain(HIDDEN)
    expect(getDocument(editor).map((b) => b.id)).toEqual(["sibling"])
  })

  it("deleteBlocks carries a MULTI-LEVEL depth-subtree (grandchildren too)", () => {
    const editor = createTestEditor()
    editor.commands.setContent([
      {
        type: "paragraph",
        attrs: { id: "parent", depth: 0 },
        content: [{ type: "text", text: "Parent" }],
      },
      {
        type: "paragraph",
        attrs: { id: "child", depth: 1 },
        content: [{ type: "text", text: "Child" }],
      },
      {
        type: "paragraph",
        attrs: { id: "grandchild", depth: 2 },
        content: [{ type: "text", text: HIDDEN }],
      },
      {
        type: "paragraph",
        attrs: { id: "sibling", depth: 0 },
        content: [{ type: "text", text: "Sibling" }],
      },
    ] as never)
    const ok = editor.commands.deleteBlocks(["parent"])
    expect(ok).toBe(true)
    expect(editor.state.doc.textContent).not.toContain(HIDDEN)
    expect(getDocument(editor).map((b) => b.id)).toEqual(["sibling"])
  })

  it("deleteBlocks does NOT delete a depth-0 sibling following the parent (no over-deletion)", () => {
    const editor = makeParentChildDoc()
    editor.commands.deleteBlocks(["parent"])
    // "sibling" is depth 0, same as "parent" — it must survive.
    expect(editor.state.doc.textContent).toContain("Sibling")
  })

  // parent@0 · childA@1 · childB@1 · sibling@0 — TWO same-depth children
  // under one parent must BOTH go; the walk doesn't stop after the first one.
  it("deleteBlocks([parentId]) removes ALL same-depth children, not just the first", () => {
    const editor = createTestEditor()
    editor.commands.setContent([
      {
        type: "paragraph",
        attrs: { id: "parent", depth: 0 },
        content: [{ type: "text", text: "Parent" }],
      },
      {
        type: "paragraph",
        attrs: { id: "childA", depth: 1 },
        content: [{ type: "text", text: "ChildA" }],
      },
      {
        type: "paragraph",
        attrs: { id: "childB", depth: 1 },
        content: [{ type: "text", text: "ChildB" }],
      },
      {
        type: "paragraph",
        attrs: { id: "sibling", depth: 0 },
        content: [{ type: "text", text: "Sibling" }],
      },
    ] as never)
    const ok = editor.commands.deleteBlocks(["parent"])
    expect(ok).toBe(true)
    expect(getDocument(editor).map((b) => b.id)).toEqual(["sibling"])
  })

  // Same repro, but the parent+children live inside a column — the widen
  // must stay surface-local (walk the column's own children), not leak past
  // the column boundary or fall back to the root surface.
  it("deleteBlocks([parentId]) carries the depth-subtree inside a column", () => {
    const editor = createTestEditor({ kit: { suggestionMenus: false } })
    const s = editor.schema
    const para = (id: string, t: string, depth = 0) =>
      s.nodes.paragraph!.create({ id, depth }, s.text(t))
    const col = (id: string, ...children: ProseMirrorNode[]) =>
      s.nodes.column!.create({ id, width: 1 }, children)
    const doc = s.nodes.doc!.create(null, [
      s.nodes.columnLayout!.create({ id: "lay", depth: 0 }, [
        col(
          "col_a",
          para("parent", "Parent"),
          para("child", HIDDEN, 1),
          para("colSibling", "ColSibling"),
        ),
        col("col_b", para("b1", "B1")),
      ]),
    ])
    editor.view.dispatch(
      editor.state.tr.replaceWith(0, editor.state.doc.content.size, doc.content),
    )
    const ok = editor.commands.deleteBlocks(["parent"])
    expect(ok).toBe(true)
    expect(editor.state.doc.textContent).not.toContain(HIDDEN)
    // The OTHER column's block must be untouched — widening stayed inside col_a.
    expect(editor.state.doc.textContent).toContain("B1")
    expect(editor.state.doc.textContent).toContain("ColSibling")
  })

  // Deleting a CHILD by its own id must delete only ITS OWN subtree — the
  // parent and any OTHER child stay put. This is the counterpoint to the
  // parent-delete tests above: a child is not somehow "protected" by its
  // parent, but neither does deleting it reach upward or sideways.
  it("deleting a child id alone leaves the parent and its other child untouched", () => {
    const editor = createTestEditor()
    editor.commands.setContent([
      {
        type: "paragraph",
        attrs: { id: "parent", depth: 0 },
        content: [{ type: "text", text: "Parent" }],
      },
      {
        type: "paragraph",
        attrs: { id: "childA", depth: 1 },
        content: [{ type: "text", text: HIDDEN }],
      },
      {
        type: "paragraph",
        attrs: { id: "childB", depth: 1 },
        content: [{ type: "text", text: "ChildB" }],
      },
    ] as never)
    const ok = editor.commands.deleteBlocks(["childA"])
    expect(ok).toBe(true)
    expect(editor.state.doc.textContent).not.toContain(HIDDEN)
    expect(getDocument(editor).map((b) => b.id)).toEqual(["parent", "childB"])
  })

  // Multi-id parity anchor for moveBlocks' identical case (see
  // moveBlocks.depthSubtree.test.ts): parent + a proper PREFIX of its
  // children — the per-anchor widen already covers childB via the PARENT's
  // subtree, so delete and move must agree on this input.
  it("deleteBlocks(['parent','childA']) removes childB too (parent's subtree past the tail id)", () => {
    const editor = createTestEditor()
    editor.commands.setContent([
      {
        type: "paragraph",
        attrs: { id: "parent", depth: 0 },
        content: [{ type: "text", text: "Parent" }],
      },
      {
        type: "paragraph",
        attrs: { id: "childA", depth: 1 },
        content: [{ type: "text", text: "ChildA" }],
      },
      {
        type: "paragraph",
        attrs: { id: "childB", depth: 1 },
        content: [{ type: "text", text: HIDDEN }],
      },
      {
        type: "paragraph",
        attrs: { id: "sibling", depth: 0 },
        content: [{ type: "text", text: "Sibling" }],
      },
    ] as never)
    const ok = editor.commands.deleteBlocks(["parent", "childA"])
    expect(ok).toBe(true)
    expect(editor.state.doc.textContent).not.toContain(HIDDEN)
    expect(getDocument(editor).map((b) => b.id)).toEqual(["sibling"])
  })
})
