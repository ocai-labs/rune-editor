// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, it, expect } from "vitest"
import { Editor } from "@tiptap/core"
import Document from "@tiptap/extension-document"
import Text from "@tiptap/extension-text"
import { History } from "@tiptap/extension-history"
import { Paragraph, Heading } from "../blocks"
import { BlockId } from "./block-id"
import { INTERNAL_NORMALIZATION_META } from "./internal-meta"

const SEED_DOC = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Title" }] },
    { type: "paragraph", content: [{ type: "text", text: "First paragraph" }] },
    { type: "paragraph", content: [{ type: "text", text: "Second paragraph" }] },
  ],
}

function makeEditor(content: unknown = SEED_DOC) {
  return new Editor({
    element: document.createElement("div"),
    extensions: [Document, Text, Paragraph, Heading, History, BlockId],
    content: content as never,
  })
}

function collectBlockIds(editor: Editor): Array<string | null> {
  const ids: Array<string | null> = []
  editor.state.doc.descendants((node) => {
    if (node.type.name === "paragraph" || node.type.name === "heading") {
      ids.push((node.attrs.id as string | null) ?? null)
    }
    return true
  })
  return ids
}

describe("BlockId", () => {
  it("fills ids on initial content (no typing required)", () => {
    const editor = makeEditor()
    const ids = collectBlockIds(editor)
    expect(ids).toHaveLength(3)
    expect(ids.every((id) => typeof id === "string" && id.length === 8)).toBe(true)
    editor.destroy()
  })

  it("assigns unique ids per block", () => {
    const editor = makeEditor()
    const ids = collectBlockIds(editor) as string[]
    expect(new Set(ids).size).toBe(ids.length)
    editor.destroy()
  })

  it("preserves existing ids if they are unique", () => {
    const editor = makeEditor({
      type: "doc",
      content: [
        { type: "paragraph", attrs: { id: "abcd1234" }, content: [{ type: "text", text: "has id" }] },
        { type: "paragraph", content: [{ type: "text", text: "no id" }] },
      ],
    })
    const ids = collectBlockIds(editor)
    expect(ids[0]).toBe("abcd1234")
    expect(ids[1]).not.toBe("abcd1234")
    expect(typeof ids[1]).toBe("string")
    editor.destroy()
  })

  it("regenerates colliding ids on initial content", () => {
    const editor = makeEditor({
      type: "doc",
      content: [
        { type: "paragraph", attrs: { id: "dup00001" }, content: [{ type: "text", text: "a" }] },
        { type: "paragraph", attrs: { id: "dup00001" }, content: [{ type: "text", text: "b" }] },
      ],
    })
    const ids = collectBlockIds(editor) as string[]
    expect(ids[0]).toBe("dup00001")
    expect(ids[1]).not.toBe("dup00001")
    expect(ids.length).toBe(new Set(ids).size)
    editor.destroy()
  })

  it("assigns ids to blocks created by transactions after init", () => {
    const editor = makeEditor()
    const initialIds = new Set(collectBlockIds(editor) as string[])
    editor.commands.insertContentAt(editor.state.doc.content.size, {
      type: "paragraph",
      content: [{ type: "text", text: "appended" }],
    })
    const afterIds = collectBlockIds(editor) as string[]
    expect(afterIds).toHaveLength(4)
    expect(afterIds.every((id) => typeof id === "string" && id.length === 8)).toBe(true)
    const newIds = afterIds.filter((id) => !initialIds.has(id))
    expect(newIds).toHaveLength(1)
    editor.destroy()
  })

  it("does not mutate id on content edit of an existing block", () => {
    const editor = makeEditor()
    const [headingIdBefore, firstParaIdBefore] = collectBlockIds(editor) as string[]
    editor.commands.focus("end")
    editor.commands.insertContent(" more text")
    const [headingIdAfter, firstParaIdAfter] = collectBlockIds(editor) as string[]
    expect(headingIdAfter).toBe(headingIdBefore)
    expect(firstParaIdAfter).toBe(firstParaIdBefore)
    editor.destroy()
  })

  it("tags backfill transaction with INTERNAL_NORMALIZATION_META so consumers can filter user-edit detection", () => {
    const editor = makeEditor()

    // Insert a block without an id — the next appendTransaction pass
    // produces the backfill tx we want to inspect.
    const paragraphType = editor.schema.nodes.paragraph
    if (!paragraphType) throw new Error("paragraph node type missing")
    const para = paragraphType.create({ id: null, depth: 0 }, [])
    const tr = editor.state.tr.insert(editor.state.doc.content.size, para)
    const { transactions } = editor.state.applyTransaction(tr)

    const backfill = transactions.find(
      (t) => t.getMeta(INTERNAL_NORMALIZATION_META) === true,
    )
    expect(backfill).toBeDefined()
    expect(backfill!.getMeta("addToHistory")).toBe(false)
    editor.destroy()
  })

  it("backfill transaction is excluded from history (undo does not reveal id-less state)", () => {
    const editor = makeEditor()
    const idsBefore = collectBlockIds(editor) as string[]
    // Type something so there's a real user edit in history.
    editor.commands.focus("end")
    editor.commands.insertContent("x")
    // Undo the type. Should NOT also undo the backfill.
    editor.commands.undo()
    const idsAfter = collectBlockIds(editor) as string[]
    expect(idsAfter.every((id) => typeof id === "string" && id.length === 8)).toBe(true)
    expect(idsAfter).toEqual(idsBefore)
    editor.destroy()
  })

  it("keeps the original block's id when a duplicate is pasted ABOVE it", () => {
    const editor = makeEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { id: "origABCD" },
          content: [{ type: "text", text: "original" }],
        },
      ],
    })
    // Sanity: after init the original owns its id.
    const idByText = (): Record<string, string | null> => {
      const out: Record<string, string | null> = {}
      editor.state.doc.descendants((node) => {
        if (node.type.name === "paragraph") {
          out[node.textContent] = (node.attrs.id as string | null) ?? null
        }
        return true
      })
      return out
    }
    expect(idByText().original).toBe("origABCD")

    // Simulate the internal rune-doc paste reinstating the SAME id, inserted
    // ABOVE the original (pos 0 = before the first block, earlier in doc order).
    const paragraphType = editor.schema.nodes.paragraph
    if (!paragraphType) throw new Error("paragraph node type missing")
    const pasted = paragraphType.create(
      { id: "origABCD", depth: 0 },
      editor.schema.text("pasted"),
    )
    editor.view.dispatch(editor.state.tr.insert(0, pasted))

    const ids = idByText()
    // The pre-existing block keeps origABCD; the pasted copy is regenerated.
    expect(ids.original).toBe("origABCD")
    expect(ids.pasted).not.toBe("origABCD")
    // And the doc still has unique ids overall.
    const all = collectBlockIds(editor) as string[]
    expect(new Set(all).size).toBe(all.length)
    editor.destroy()
  })
})
