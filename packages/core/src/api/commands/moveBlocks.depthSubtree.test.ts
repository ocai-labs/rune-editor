// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Regression suite — moveBlocks orphans depth-children left behind at the
// SOURCE when only the parent id is moved. Same family + same fix as
// deleteBlocks.depthSubtree.test.ts: `resolveContiguousSourceRun`
// (moveBlocks.ts) widens the run's tail over `depthSubtreeRange`
// (schema/bodySurface.ts) so the parent carries its depth-children to the
// destination — parity with delete, per the live-Notion research doc.

import { describe, it, expect } from "vitest"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import { createTestEditor } from "../../test-utils/createTestEditor"
import { getDocument } from "../queries"

const HIDDEN = "HIDDEN-CHILD"

// parent@0 · child@1 (HIDDEN text) · sibling@0 · target@0 — moving "parent"
// after "target" must carry "child" along, not strand it at the old spot.
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
    {
      type: "paragraph",
      attrs: { id: "target", depth: 0 },
      content: [{ type: "text", text: "Target" }],
    },
  ] as never)
  return editor
}

describe("moveBlocks — depth-subtree carry (no orphaned children left at source)", () => {
  it("moveBlocks([parentId], ...) carries the depth-child to the destination", () => {
    const editor = makeParentChildDoc()
    const ok = editor.commands.moveBlocks(["parent"], { id: "target", side: "after" })
    expect(ok).toBe(true)
    // Doc order: sibling, target, parent, child.
    expect(getDocument(editor).map((b) => b.id)).toEqual([
      "sibling",
      "target",
      "parent",
      "child",
    ])
    // The child kept its relative depth under the moved parent.
    let childDepth: number | undefined
    editor.state.doc.forEach((node) => {
      if (node.attrs.id === "child") childDepth = node.attrs.depth as number
    })
    expect(childDepth).toBe(1)
  })

  it("moveBlocks carries a MULTI-LEVEL depth-subtree (grandchildren too)", () => {
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
      {
        type: "paragraph",
        attrs: { id: "target", depth: 0 },
        content: [{ type: "text", text: "Target" }],
      },
    ] as never)
    const ok = editor.commands.moveBlocks(["parent"], { id: "target", side: "after" })
    expect(ok).toBe(true)
    expect(getDocument(editor).map((b) => b.id)).toEqual([
      "sibling",
      "target",
      "parent",
      "child",
      "grandchild",
    ])
  })

  it("moveBlocks does NOT drag a depth-0 sibling following the parent (no over-move)", () => {
    const editor = makeParentChildDoc()
    editor.commands.moveBlocks(["parent"], { id: "target", side: "after" })
    // "sibling" is depth 0, same as "parent" — it must stay put at the source.
    expect(getDocument(editor).map((b) => b.id)).toContain("sibling")
    expect(getDocument(editor).map((b) => b.id).indexOf("sibling")).toBeLessThan(
      getDocument(editor).map((b) => b.id).indexOf("parent"),
    )
  })

  // Multi-id run: parent + a proper PREFIX of its children. The widen must
  // cover EVERY requested id's subtree, not just the tail's — the parent's
  // subtree extends PAST the tail id ("childA"), so "childB" belongs to the
  // move too. Regression: widening only the last id stranded childB at the
  // source as a depth-1 orphan, disagreeing with deleteBlocks on the same
  // input (its id-list branch widens each anchor).
  it("moveBlocks(['parent','childA']) carries childB — a non-tail id's subtree past the tail", () => {
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
        attrs: { id: "target", depth: 0 },
        content: [{ type: "text", text: "Target" }],
      },
    ] as never)
    const ok = editor.commands.moveBlocks(["parent", "childA"], { id: "target", side: "after" })
    expect(ok).toBe(true)
    expect(getDocument(editor).map((b) => b.id)).toEqual([
      "target",
      "parent",
      "childA",
      "childB",
    ])
  })

  // Moving a CHILD by its own id must move only ITS OWN subtree — the
  // parent and any OTHER child stay at the source. Counterpoint to the
  // parent-move tests above.
  it("moving a child id alone leaves the parent and its other child at the source", () => {
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
      {
        type: "paragraph",
        attrs: { id: "target", depth: 0 },
        content: [{ type: "text", text: "Target" }],
      },
    ] as never)
    const ok = editor.commands.moveBlocks(["childA"], { id: "target", side: "after" })
    expect(ok).toBe(true)
    expect(getDocument(editor).map((b) => b.id)).toEqual([
      "parent",
      "childB",
      "target",
      "childA",
    ])
  })

  // Same repro, but source and destination both live inside a column — the
  // widen must stay surface-local (the column's own children), and the
  // OTHER column must be untouched.
  it("moveBlocks([parentId], ...) carries the depth-subtree inside a column", () => {
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
          para("target", "Target"),
        ),
        col("col_b", para("b1", "B1")),
      ]),
    ])
    editor.view.dispatch(
      editor.state.tr.replaceWith(0, editor.state.doc.content.size, doc.content),
    )
    const ok = editor.commands.moveBlocks(["parent"], { id: "target", side: "after" })
    expect(ok).toBe(true)
    // Doc order within col_a: target, parent, child.
    expect(editor.state.doc.textContent).toContain("TargetParentHIDDEN-CHILD")
    // col_b untouched.
    expect(editor.state.doc.textContent).toContain("B1")
  })
})
