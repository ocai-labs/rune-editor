// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Regression coverage for two serialization bugs where a block's identity
// (or an attribute) failed to survive a getHTML() → setContent() round-trip.
//
// bulletList/numberedList/taskList each declare a parse rule keyed on their
// outer `.rune-block.rune-*-list` wrapper (matching Callout/Toggle/Image,
// which all match the outer div), with `contentElement` pointing PM at the
// inner `<p>`. Without that rule, the inner `<p>` would win the paragraph
// parse rule instead, degrading the block to a plain paragraph — and
// numberedList would additionally lose `start`, taskList would lose
// `checked` (both carried as data attrs on the outer div).
//
// Equation's `latex` prop declares `renderHTML: () => ({})` so it doesn't
// leak a raw `latex="…"` attribute onto the outer `.rune-block` div.

import { describe, it, expect } from "vitest"
import { createTestEditor } from "../../test-utils/createTestEditor"

function fresh() {
  const el = document.createElement("div")
  document.body.appendChild(el)
  return createTestEditor({ element: el })
}

describe("getHTML → setContent round-trip", () => {
  it("bulletList keeps its type through a getHTML round-trip", () => {
    const a = fresh()
    a.commands.setContent([
      { type: "bulletList", attrs: { id: "alpha" }, content: [{ type: "text", text: "alpha" }] },
    ])
    const html = a.getHTML()

    const b = fresh()
    b.commands.setContent(html)

    expect(b.state.doc.child(0).type.name).toBe("bulletList")
    expect(b.state.doc.child(0).textContent).toBe("alpha")
  })

  it("numberedList keeps its type AND `start` through a getHTML round-trip", () => {
    const a = fresh()
    a.commands.setContent([
      {
        type: "numberedList",
        attrs: { id: "alpha", start: 3 },
        content: [{ type: "text", text: "alpha" }],
      },
    ])
    const html = a.getHTML()

    const b = fresh()
    b.commands.setContent(html)

    expect(b.state.doc.child(0).type.name).toBe("numberedList")
    expect(b.state.doc.child(0).attrs.start).toBe(3)
  })

  it("taskList keeps its type AND `checked` through a getHTML round-trip", () => {
    const a = fresh()
    a.commands.setContent([
      {
        type: "taskList",
        attrs: { id: "alpha", checked: true },
        content: [{ type: "text", text: "alpha" }],
      },
    ])
    const html = a.getHTML()

    const b = fresh()
    b.commands.setContent(html)

    expect(b.state.doc.child(0).type.name).toBe("taskList")
    expect(b.state.doc.child(0).attrs.checked).toBe(true)
  })

  it("equationBlock does not leak a raw `latex` attribute onto the wrapper div", () => {
    const editor = fresh()
    editor.commands.setContent([
      { type: "equationBlock", attrs: { id: "eq1", latex: "x = 1" } },
    ])

    expect(editor.getHTML()).not.toMatch(/ latex=/)
  })

  // Controls — prove the harness (fresh(), getHTML, setContent, doc shape)
  // is sound independent of the four fixes above.
  it("[control] paragraph keeps its type and text through a getHTML round-trip", () => {
    const a = fresh()
    a.commands.setContent([
      { type: "paragraph", attrs: { id: "p1" }, content: [{ type: "text", text: "hello" }] },
    ])
    const html = a.getHTML()

    const b = fresh()
    b.commands.setContent(html)

    expect(b.state.doc.child(0).type.name).toBe("paragraph")
    expect(b.state.doc.child(0).textContent).toBe("hello")
  })

  it("[control] callout keeps its type through a getHTML round-trip", () => {
    const a = fresh()
    a.commands.setContent([
      { type: "callout", attrs: { id: "c1", icon: "🔥" }, content: [{ type: "text", text: "hi" }] },
    ])
    const html = a.getHTML()

    const b = fresh()
    b.commands.setContent(html)

    expect(b.state.doc.child(0).type.name).toBe("callout")
    expect(b.state.doc.child(0).textContent).toBe("hi")
  })
})
