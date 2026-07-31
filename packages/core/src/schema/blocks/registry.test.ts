// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, it, expect } from "vitest"
import { Editor } from "@tiptap/core"
import Document from "@tiptap/extension-document"
import Text from "@tiptap/extension-text"
import { createBlockSpec } from "./createSpec"
import { forEachBlockSpec, getBlockSpecs } from "./registry"

const Para = createBlockSpec({
  type: "paragraph",
  content: "inline*",
  parseDOM: [{ tag: "p" }],
  renderDOM: ({ HTMLAttributes }) => ["p", HTMLAttributes, 0],
  sideMenu: { draggable: true },
  slashMenuItems: () => [],
})

const Heading = createBlockSpec({
  type: "heading",
  content: "inline*",
  parseDOM: [{ tag: "h2" }],
  renderDOM: ({ HTMLAttributes }) => ["h2", HTMLAttributes, 0],
  sideMenu: { draggable: true },
})

function mkEditor() {
  return new Editor({ extensions: [Document, Text, Para, Heading] })
}

describe("forEachBlockSpec", () => {
  it("visits every factory-built block", () => {
    const editor = mkEditor()
    const names: string[] = []
    forEachBlockSpec(editor, (name) => names.push(name))
    expect(names.sort()).toEqual(["heading", "paragraph"])
    editor.destroy()
  })

  it("exposes sideMenu metadata", () => {
    const editor = mkEditor()
    const found: Record<string, boolean | undefined> = {}
    forEachBlockSpec(editor, (name, meta) => {
      found[name] = meta.sideMenu?.draggable
    })
    expect(found).toEqual({ paragraph: true, heading: true })
    editor.destroy()
  })

  it("exposes block support metadata", () => {
    const editor = mkEditor()
    const specs = getBlockSpecs(editor)
    expect(specs.paragraph?.supports).toBeUndefined()
    expect(specs.heading?.supports).toBeUndefined()
    editor.destroy()
  })

  it("skips non-marked nodes (Document, Text)", () => {
    const editor = mkEditor()
    const names: string[] = []
    forEachBlockSpec(editor, (name) => names.push(name))
    expect(names).not.toContain("doc")
    expect(names).not.toContain("text")
    editor.destroy()
  })
})

describe("getBlockSpecs", () => {
  it("returns a map keyed by node name", () => {
    const editor = mkEditor()
    const specs = getBlockSpecs(editor)
    expect(Object.keys(specs).sort()).toEqual(["heading", "paragraph"])
    expect(specs.paragraph?.sideMenu?.draggable).toBe(true)
    editor.destroy()
  })
})
