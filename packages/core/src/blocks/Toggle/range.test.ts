// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, it, expect } from "vitest"
import { createTestEditor } from "../../test-utils/createTestEditor"
import { findCollapsedToggleContaining, toggleBodyRange, togglePosById } from "./range"

function makeEditor() {
  return createTestEditor()
}

describe("toggleBodyRange", () => {
  it("returns isEmpty for a toggle with no following siblings", () => {
    const editor = makeEditor()
    editor.commands.setContent([
      { type: "toggle", attrs: { depth: 0, level: 0, expanded: true }, content: [{ type: "text", text: "t" }] },
    ])
    const togglePos = 0
    const r = toggleBodyRange(editor.state.doc, togglePos)
    expect(r.isEmpty).toBe(true)
    expect(r.to - r.from).toBe(0)
  })

  it("includes siblings whose depth > toggle.depth and stops at depth <= toggle.depth", () => {
    const editor = makeEditor()
    editor.commands.setContent([
      { type: "toggle", attrs: { depth: 0, level: 0, expanded: true }, content: [{ type: "text", text: "t" }] },
      { type: "paragraph", attrs: { depth: 1 }, content: [{ type: "text", text: "child a" }] },
      { type: "paragraph", attrs: { depth: 1 }, content: [{ type: "text", text: "child b" }] },
      { type: "paragraph", attrs: { depth: 0 }, content: [{ type: "text", text: "sibling" }] },
    ])
    const togglePos = 0
    const toggleNode = editor.state.doc.firstChild!
    const r = toggleBodyRange(editor.state.doc, togglePos)
    expect(r.isEmpty).toBe(false)
    expect(r.from).toBe(togglePos + toggleNode.nodeSize)
    // body = two paragraphs of depth 1; ends right before the depth-0 sibling.
    const expectedTo = togglePos + toggleNode.nodeSize +
      editor.state.doc.child(1).nodeSize + editor.state.doc.child(2).nodeSize
    expect(r.to).toBe(expectedTo)
  })

  it("body spans nested toggles (children of a child toggle still count)", () => {
    const editor = makeEditor()
    editor.commands.setContent([
      { type: "toggle", attrs: { depth: 0, level: 0, expanded: true }, content: [{ type: "text", text: "outer" }] },
      { type: "toggle", attrs: { depth: 1, level: 0, expanded: true }, content: [{ type: "text", text: "inner" }] },
      { type: "paragraph", attrs: { depth: 2 }, content: [{ type: "text", text: "deep" }] },
      { type: "paragraph", attrs: { depth: 0 }, content: [{ type: "text", text: "out" }] },
    ])
    const togglePos = 0
    const r = toggleBodyRange(editor.state.doc, togglePos)
    // body of outer = inner toggle + deep paragraph
    expect(r.isEmpty).toBe(false)
    const expectedTo = editor.state.doc.child(0).nodeSize +
      editor.state.doc.child(1).nodeSize +
      editor.state.doc.child(2).nodeSize
    expect(r.to).toBe(expectedTo)
  })
})

describe("togglePosById", () => {
  it("finds a root toggle by id", () => {
    const editor = makeEditor()
    editor.commands.setContent([
      { type: "toggle", attrs: { id: "tog-root", depth: 0, level: 0, expanded: true }, content: [{ type: "text", text: "t" }] },
    ])
    expect(togglePosById(editor.state.doc, "tog-root")).toBe(0)
  })

  it("returns -1 for an unknown id", () => {
    const editor = makeEditor()
    editor.commands.setContent([
      { type: "toggle", attrs: { id: "x", depth: 0, level: 0, expanded: true }, content: [{ type: "text", text: "t" }] },
    ])
    expect(togglePosById(editor.state.doc, "nope")).toBe(-1)
  })
})

describe("findCollapsedToggleContaining", () => {
  it("returns the collapsed toggle whose body contains the position", () => {
    const editor = makeEditor()
    editor.commands.setContent([
      { type: "toggle", attrs: { depth: 0, level: 0, expanded: false }, content: [{ type: "text", text: "outer" }] },
      { type: "paragraph", attrs: { depth: 1 }, content: [{ type: "text", text: "hidden" }] },
      { type: "paragraph", attrs: { depth: 0 }, content: [{ type: "text", text: "after" }] },
    ])

    const body = toggleBodyRange(editor.state.doc, 0)
    const owner = findCollapsedToggleContaining(editor.state.doc, body.from)

    expect(owner?.pos).toBe(0)
    expect(owner?.node.textContent).toBe("outer")
    expect(findCollapsedToggleContaining(editor.state.doc, body.to)).toBeNull()
  })

  it("ignores expanded toggles", () => {
    const editor = makeEditor()
    editor.commands.setContent([
      { type: "toggle", attrs: { depth: 0, level: 0, expanded: true }, content: [{ type: "text", text: "outer" }] },
      { type: "paragraph", attrs: { depth: 1 }, content: [{ type: "text", text: "visible" }] },
    ])

    const body = toggleBodyRange(editor.state.doc, 0)

    expect(findCollapsedToggleContaining(editor.state.doc, body.from)).toBeNull()
  })
})
