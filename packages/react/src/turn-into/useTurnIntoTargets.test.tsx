// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { Editor } from "@tiptap/core"
import { createRuneKit } from "@ocai/rune-core"
import { useTurnIntoTargets } from "./useTurnIntoTargets"

const editors: Editor[] = []

afterEach(() => {
  while (editors.length > 0) editors.pop()?.destroy()
})

function track(editor: Editor) {
  editors.push(editor)
  return editor
}

function rootEditor() {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: createRuneKit(),
  })
  editor.commands.setContent({
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { id: "r1", depth: 0 },
        content: [{ type: "text", text: "root-1" }],
      },
      {
        type: "paragraph",
        attrs: { id: "r2", depth: 0 },
        content: [{ type: "text", text: "root-2" }],
      },
    ],
  })
  return track(editor)
}

describe("useTurnIntoTargets — root source", () => {
  it("resolves a body block and offers convertible targets", () => {
    const editor = rootEditor()
    const { result } = renderHook(() => useTurnIntoTargets(editor, ["r1"]))
    expect(result.current.sources).toHaveLength(1)
    expect(result.current.sources[0]!.textContent).toBe("root-1")
    expect(result.current.groups.length).toBeGreaterThan(0)
    const titles = result.current.groups.flatMap((group) =>
      group.items.map((item) => item.title),
    )
    expect(titles).toContain("Heading 1")
  })
})
