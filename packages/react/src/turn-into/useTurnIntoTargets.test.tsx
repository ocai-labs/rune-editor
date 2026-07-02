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

/**
 * Editor whose doc is: r1 · columnLayout[ col_a[pa] · col_b[pb] ] · r2.
 * `pa` is a paragraph INSIDE a column — the block whose turn-into targets used
 * to come back empty (findBlockNodeById scanned only root children).
 */
function columnEditor() {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: createRuneKit(),
  })
  const s = editor.schema
  const para = (id: string, t: string) =>
    s.nodes.paragraph!.create({ id, depth: 0 }, s.text(t))
  const col = (id: string, child: ReturnType<typeof para>) =>
    s.nodes.column!.create({ id, width: 1 }, child)
  const doc = s.nodes.doc!.create(null, [
    para("r1", "root-1"),
    s.nodes.columnLayout!.create({ id: "lay", depth: 0 }, [
      col("col_a", para("pa", "in-column")),
      col("col_b", para("pb", "other")),
    ]),
    para("r2", "root-2"),
  ])
  editor.view.dispatch(
    editor.state.tr.replaceWith(0, editor.state.doc.content.size, doc.content),
  )
  return track(editor)
}

describe("useTurnIntoTargets — in-column source", () => {
  it("resolves turn-into targets for a paragraph inside a column", () => {
    const editor = columnEditor()
    const { result } = renderHook(() => useTurnIntoTargets(editor, ["pa"]))
    // The in-column paragraph resolves as a source…
    expect(result.current.sources).toHaveLength(1)
    expect(result.current.sources[0]!.textContent).toBe("in-column")
    // …and the menu offers convertible targets (was empty before the fix).
    expect(result.current.groups.length).toBeGreaterThan(0)
    const titles = result.current.groups.flatMap((g) => g.items.map((i) => i.title))
    expect(titles).toContain("Heading 1")
  })

  it("still resolves root sources", () => {
    const editor = columnEditor()
    const { result } = renderHook(() => useTurnIntoTargets(editor, ["r1"]))
    expect(result.current.sources).toHaveLength(1)
    expect(result.current.sources[0]!.textContent).toBe("root-1")
    expect(result.current.groups.length).toBeGreaterThan(0)
  })
})
