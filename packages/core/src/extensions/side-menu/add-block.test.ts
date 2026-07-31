// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Editor } from "@tiptap/core"
import Document from "@tiptap/extension-document"
import Text from "@tiptap/extension-text"
import { createBlockSpec } from "../../schema"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import { SuggestionMenus } from "../suggestion-menus/SuggestionMenus"
import { addBlockBelowAndOpenSlash } from "./add-block"
import { createTestEditor } from "../../test-utils/createTestEditor"

const Para = createBlockSpec({
  type: "paragraph",
  content: "inline*",
  parseDOM: [{ tag: "p" }],
  renderDOM: ({ HTMLAttributes }) => ["p", HTMLAttributes, 0],
})

const Heading = createBlockSpec({
  type: "heading",
  content: "inline*",
  parseDOM: [{ tag: "h2" }],
  renderDOM: ({ HTMLAttributes }) => ["h2", HTMLAttributes, 0],
})

let container: HTMLDivElement

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
})

afterEach(() => {
  container.remove()
})

function mk(content: string) {
  return new Editor({
    element: container,
    extensions: [
      Document,
      Text,
      Para,
      Heading,
      SuggestionMenus.configure({ triggers: [{ char: "/" }] }),
    ],
    content,
  })
}

type SMStorage = {
  suggestionMenus: {
    triggers: Record<string, { getSnapshot: () => { show: boolean } }>
  }
}

describe("addBlockBelowAndOpenSlash", () => {
  it("empty paragraph: types '/' in place", () => {
    const editor = mk("<p></p>")
    addBlockBelowAndOpenSlash(editor, 0)
    expect(editor.state.doc.childCount).toBe(1)
    expect(editor.state.doc.firstChild?.textContent).toBe("/")
    editor.destroy()
  })

  it("non-empty paragraph: inserts paragraph after + '/'", () => {
    const editor = mk("<p>hello</p>")
    addBlockBelowAndOpenSlash(editor, 0)
    expect(editor.state.doc.childCount).toBe(2)
    expect(editor.state.doc.child(0).textContent).toBe("hello")
    expect(editor.state.doc.child(1).textContent).toBe("/")
    editor.destroy()
  })

  it("heading: inserts paragraph after + '/' (not inside heading)", () => {
    const editor = mk("<h2>title</h2>")
    addBlockBelowAndOpenSlash(editor, 0)
    expect(editor.state.doc.childCount).toBe(2)
    expect(editor.state.doc.child(1).type.name).toBe("paragraph")
    expect(editor.state.doc.child(1).textContent).toBe("/")
    editor.destroy()
  })

  it("empty heading: inserts paragraph after (NOT '/' into heading)", () => {
    const editor = mk("<h2></h2>")
    addBlockBelowAndOpenSlash(editor, 0)
    expect(editor.state.doc.childCount).toBe(2)
    expect(editor.state.doc.firstChild?.type.name).toBe("heading")
    expect(editor.state.doc.child(1).type.name).toBe("paragraph")
    expect(editor.state.doc.child(1).textContent).toBe("/")
    editor.destroy()
  })

  it("slash menu store transitions to show: true", async () => {
    const editor = mk("<p></p>")
    addBlockBelowAndOpenSlash(editor, 0)
    await Promise.resolve()
    const store = (editor.storage as unknown as SMStorage).suggestionMenus.triggers["/"]!
    expect(store.getSnapshot().show).toBe(true)
    editor.destroy()
  })
})
