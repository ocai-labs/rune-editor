// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, it, expect } from "vitest"
import { createTestEditor } from "../../test-utils/createTestEditor"
import { getBlockSpecs } from "../../schema"

function fresh() {
  return createTestEditor()
}

describe("Toggle.dragSourceRange", () => {
  it("collapsed: extends to include body", () => {
    const editor = fresh()
    editor.commands.setContent([
      { type: "toggle", attrs: { level: 0, expanded: false }, content: [{ type: "text", text: "t" }] },
      { type: "paragraph", attrs: { depth: 1 }, content: [{ type: "text", text: "c1" }] },
      { type: "paragraph", attrs: { depth: 1 }, content: [{ type: "text", text: "c2" }] },
      { type: "paragraph", attrs: { depth: 0 }, content: [{ type: "text", text: "after" }] },
    ])
    const hook = getBlockSpecs(editor)["toggle"]!.dragSourceRange!
    const togglePos = 0
    const toggleNode = editor.state.doc.firstChild!
    const r = hook({ node: toggleNode, pos: togglePos, doc: editor.state.doc })
    const expectedTo =
      toggleNode.nodeSize +
      editor.state.doc.child(1).nodeSize +
      editor.state.doc.child(2).nodeSize
    expect(r).toEqual({ from: 0, to: expectedTo })
  })

  it("expanded: extends to include body", () => {
    const editor = fresh()
    editor.commands.setContent([
      { type: "toggle", attrs: { level: 0, expanded: true }, content: [{ type: "text", text: "t" }] },
      { type: "paragraph", attrs: { depth: 1 }, content: [{ type: "text", text: "c" }] },
    ])
    const hook = getBlockSpecs(editor)["toggle"]!.dragSourceRange!
    const toggleNode = editor.state.doc.firstChild!
    const r = hook({ node: toggleNode, pos: 0, doc: editor.state.doc })
    expect(r).toEqual({ from: 0, to: toggleNode.nodeSize + editor.state.doc.child(1).nodeSize })
  })
})

// v1.1 follow-up: drop INTO a collapsed toggle requires geometry-layer
// support (block-drag-geometry expose body-drop-zones for collapsed
// containers). v1 only supports "drop AT" (after a collapsed toggle as
// a sibling). The empty-state widget covers the "add first child"
// case for empty toggles.
//
// See spec §16.2 and the follow-up design that will define the
// drop-zone heuristics + hover-to-expand behavior.
