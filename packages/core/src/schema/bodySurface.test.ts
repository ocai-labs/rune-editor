// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, expect, it } from "vitest"

import { createTestEditor } from "../test-utils/createTestEditor"
import {
  bodyBlocksInRange,
  forEachBodyBlock,
  nearestBodyBlock,
  resolveBodyBlockById,
} from "./bodySurface"

// A flat doc with three blocks of mixed type. Phase 0 resolves every
// body-surface query against the root surface, so these positions/indices
// are exactly the top-level child positions/indices.
function mkEditor() {
  const editor = createTestEditor()
  editor.commands.setContent([
    { type: "heading", attrs: { level: 2, id: "first" }, content: [{ type: "text", text: "one" }] },
    { type: "paragraph", attrs: { id: "middle" }, content: [{ type: "text", text: "two" }] },
    { type: "codeBlock", attrs: { id: "last" }, content: [{ type: "text", text: "code" }] },
  ])
  return editor
}

describe("bodySurface", () => {
  describe("resolveBodyBlockById", () => {
    it("returns pos/index/depth on the root surface for an existing id", () => {
      const editor = mkEditor()
      const doc = editor.state.doc

      const first = resolveBodyBlockById(doc, "first")
      expect(first).not.toBeNull()
      expect(first!.id).toBe("first")
      expect(first!.pos).toBe(0)
      expect(first!.indexInSurface).toBe(0)
      expect(first!.depth).toBe(0)
      // -1 marks the root surface; Phase 1 returns the column node's pos.
      expect(first!.surfacePos).toBe(-1)
      expect(first!.node.type.name).toBe("heading")

      const middle = resolveBodyBlockById(doc, "middle")
      expect(middle!.pos).toBe(doc.child(0).nodeSize)
      expect(middle!.indexInSurface).toBe(1)
      expect(middle!.node.type.name).toBe("paragraph")

      const last = resolveBodyBlockById(doc, "last")
      expect(last!.indexInSurface).toBe(2)
      expect(last!.node.type.name).toBe("codeBlock")
    })

    it("reflects the depth attr", () => {
      const editor = createTestEditor()
      editor.commands.setContent([
        { type: "bulletList", attrs: { id: "lead" }, content: [{ type: "text", text: "a" }] },
        { type: "paragraph", attrs: { id: "nested", depth: 1 }, content: [{ type: "text", text: "b" }] },
      ])
      const resolved = resolveBodyBlockById(editor.state.doc, "nested")
      expect(resolved!.depth).toBe(1)
      expect(resolved!.indexInSurface).toBe(1)
    })

    it("returns null for a missing id", () => {
      const editor = mkEditor()
      expect(resolveBodyBlockById(editor.state.doc, "nope")).toBeNull()
    })
  })

  describe("forEachBodyBlock", () => {
    it("visits exactly the root children in doc order", () => {
      const editor = mkEditor()
      const doc = editor.state.doc

      const seen: Array<{ name: string; pos: number; index: number }> = []
      forEachBodyBlock(doc, ({ node, pos, index }) => {
        seen.push({ name: node.type.name, pos, index })
      })

      const expected: Array<{ name: string; pos: number; index: number }> = []
      doc.forEach((node, offset, index) => {
        expected.push({ name: node.type.name, pos: offset, index })
      })

      expect(seen).toEqual(expected)
      expect(seen.map((s) => s.name)).toEqual(["heading", "paragraph", "codeBlock"])
    })
  })

  describe("nearestBodyBlock", () => {
    it("resolves the body block ancestor for a caret inside a paragraph", () => {
      const editor = mkEditor()
      const doc = editor.state.doc
      // a caret inside the paragraph's text
      const paraStart = doc.child(0).nodeSize + 1
      const $pos = doc.resolve(paraStart)

      const block = nearestBodyBlock(editor, $pos)
      expect(block).not.toBeNull()
      expect(block!.node.type.name).toBe("paragraph")
      expect(block!.pos).toBe($pos.before(1))
      expect(block!.indexInSurface).toBe($pos.index(0))
      // matches today's flat behavior
      expect(block!.node).toBe($pos.node(1))
    })

    it("resolves registry body blocks that are not paragraphs (heading, codeBlock)", () => {
      const editor = mkEditor()
      const doc = editor.state.doc

      const headingCaret = doc.resolve(1)
      const heading = nearestBodyBlock(editor, headingCaret)
      expect(heading!.node.type.name).toBe("heading")

      const codeStart = doc.child(0).nodeSize + doc.child(1).nodeSize + 1
      const code = nearestBodyBlock(editor, doc.resolve(codeStart))
      expect(code!.node.type.name).toBe("codeBlock")
    })

    it("uses the block-spec registry, not depth === 1 — resolves a body block through wrapper nodes", () => {
      // A table's caret sits inside tableCell > tableParagraph, which are NOT
      // registered body blocks. nearestBodyBlock must skip those wrappers and
      // return the `table` block (a registry body block), proving it keys off
      // the registry rather than the resolved depth.
      const editor = createTestEditor()
      editor.commands.insertTable({ rows: 2, cols: 2 })
      const doc = editor.state.doc

      let tablePos = -1
      doc.forEach((node, offset) => {
        if (node.type.name === "table") tablePos = offset
      })
      expect(tablePos).toBeGreaterThanOrEqual(0)

      // resolve a caret deep inside the first cell's paragraph
      const inside = doc.resolve(tablePos + 4)
      expect(inside.depth).toBeGreaterThan(1)

      const block = nearestBodyBlock(editor, inside)
      expect(block).not.toBeNull()
      expect(block!.node.type.name).toBe("table")
      expect(block!.pos).toBe(tablePos)
    })

    it("returns null at depth 0", () => {
      const editor = mkEditor()
      const $pos = editor.state.doc.resolve(0)
      expect($pos.depth).toBe(0)
      expect(nearestBodyBlock(editor, $pos)).toBeNull()
    })
  })

  describe("bodyBlocksInRange", () => {
    it("returns the blocks a boundary range overlaps", () => {
      const editor = mkEditor()
      const doc = editor.state.doc

      const from0 = 0
      const size0 = doc.child(0).nodeSize
      const size1 = doc.child(1).nodeSize

      // a range fully inside the first two blocks
      const overlap = bodyBlocksInRange(doc, from0, size0 + size1)
      expect(overlap.map((b) => b.node.type.name)).toEqual(["heading", "paragraph"])
      expect(overlap.map((b) => b.id)).toEqual(["first", "middle"])
      expect(overlap.map((b) => b.pos)).toEqual([0, size0])

      // a zero-width boundary at the start of the paragraph touches no block
      // (boundary guards: offsetEnd <= from skips block 0, offset >= to skips
      // block 1), matching collectTargets' MBS branch.
      const atBoundary = bodyBlocksInRange(doc, size0, size0)
      expect(atBoundary).toEqual([])

      // whole-doc range covers all three
      const all = bodyBlocksInRange(doc, 0, doc.content.size)
      expect(all.map((b) => b.id)).toEqual(["first", "middle", "last"])
    })
  })
})
