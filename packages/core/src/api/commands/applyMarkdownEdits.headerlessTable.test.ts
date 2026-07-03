// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Regression coverage for the header-less-table apply_edits path: before
// `dropSyntheticEmptyTableHeader` (extensions/clipboard/aiMarkdown.ts), the
// pre-flight lossless round-trip in applyOneEdit/applyMatch always failed for
// a header-less table — `serializeTableMarkdown`'s synthesized `|   |   |`
// header re-parsed into a real tableHeader row the live doc never had, so
// `content.eq` never matched and every edit was refused with
// "not-editable-lossless". See api/export/__tests__/roundtrip.test.ts's
// "table round-trip" describe block for the underlying parse-side coverage.

import { describe, it, expect } from "vitest"
import type { Editor, JSONContent } from "@tiptap/core"
import type { Node as PMNode } from "@tiptap/pm/model"
import { createTestEditor } from "../../test-utils/createTestEditor"
import type { RuneCommandResult } from "../result"
import { applyMarkdownEdits, type ApplyMarkdownEditsData } from "./applyMarkdownEdits"

function editorWith(content: JSONContent[]): Editor {
  return createTestEditor({ content: { type: "doc", content } })
}

const text = (t: string): JSONContent => ({ type: "text", text: t })

const tableCellNode = (t: string, header = false): JSONContent => ({
  type: header ? "tableHeader" : "tableCell",
  content: [{ type: "tableParagraph", content: t === "" ? undefined : [text(t)] }],
})
const tableRow = (cells: string[], header = false): JSONContent => ({
  type: "tableRow",
  content: cells.map((c) => tableCellNode(c, header)),
})
const table = (id: string, rows: JSONContent[]): JSONContent => ({
  type: "table",
  attrs: { id, depth: 0 },
  content: rows,
})

function findBlock(editor: Editor, id: string): PMNode | null {
  let out: PMNode | null = null
  editor.state.doc.descendants((node) => {
    if (out) return false
    if (node.attrs && node.attrs.id === id) {
      out = node
      return false
    }
    return true
  })
  return out
}

function hasDescendantOfType(node: PMNode, typeName: string): boolean {
  let found = false
  node.descendants((child) => {
    if (child.type.name === typeName) found = true
    return !found
  })
  return found
}

function expectOk(
  res: RuneCommandResult<ApplyMarkdownEditsData>,
): ApplyMarkdownEditsData {
  if (!res.ok) throw new Error(`expected ok, got error ${JSON.stringify(res.error)}`)
  return res.data
}

describe("applyMarkdownEdits — header-less table", () => {
  it("edits a cell in a header-less table (ok:true, no tableHeader row, cell text changed)", () => {
    const editor = editorWith([
      table("tbl", [tableRow(["A1", "B1"]), tableRow(["A2", "B2"])]),
    ])
    const res = applyMarkdownEdits(editor, {
      edits: [{ oldStr: "A1", newStr: "Z1", blockId: "tbl" }],
    })
    expectOk(res)

    const block = findBlock(editor, "tbl")!
    expect(block.type.name).toBe("table")
    expect(hasDescendantOfType(block, "tableHeader")).toBe(false)
    expect(block.textContent).toContain("Z1")
    expect(block.textContent).not.toContain("A1")
    // The rest of the table is untouched.
    expect(block.textContent).toContain("B1")
    expect(block.textContent).toContain("A2")
    expect(block.textContent).toContain("B2")
  })

  it("control: editing a cell in a WITH-header table still works (header row preserved)", () => {
    const editor = editorWith([
      table("tbl", [tableRow(["Name", "Age"], true), tableRow(["Alice", "30"])]),
    ])
    const res = applyMarkdownEdits(editor, {
      edits: [{ oldStr: "Alice", newStr: "Bob", blockId: "tbl" }],
    })
    expectOk(res)

    const block = findBlock(editor, "tbl")!
    expect(block.type.name).toBe("table")
    expect(hasDescendantOfType(block, "tableHeader")).toBe(true)
    expect(block.textContent).toContain("Bob")
    expect(block.textContent).not.toContain("Alice")
    expect(block.textContent).toContain("Name")
    expect(block.textContent).toContain("Age")
  })
})
