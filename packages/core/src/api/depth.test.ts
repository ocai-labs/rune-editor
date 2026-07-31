// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, expect, it } from "vitest"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import { createTestEditor } from "../test-utils/createTestEditor"
import type { IndentConfig } from "../schema/blocks/createSpec"
import {
  markdownDepthOwnerTypes,
  maxPersistableDepthAfter,
  normalizeDepthAt,
} from "./depth"

type SeedBlock = { type: string; depth?: number; text?: string }

function docWithBlocks(blocks: SeedBlock[]): {
  doc: ProseMirrorNode
  posBeforeIndex: (index: number) => number
  endPos: number
  owners: ReadonlySet<string>
} {
  const editor = createTestEditor({ kit: { suggestionMenus: false } })
  editor.commands.setContent({
    type: "doc",
    content: blocks.map((block, index) => ({
      type: block.type,
      attrs: { id: `b${index}`, depth: block.depth ?? 0 },
      content: block.text == null ? [] : [{ type: "text", text: block.text }],
    })),
  })
  const doc = editor.state.doc
  const posBeforeIndex = (index: number): number => {
    let pos = 0
    doc.forEach((_child, offset, childIndex) => {
      if (childIndex === index) pos = offset
    })
    return pos
  }
  return {
    doc,
    posBeforeIndex,
    endPos: doc.content.size,
    owners: markdownDepthOwnerTypes(editor),
  }
}

const FOLLOW_PREV: IndentConfig = { mode: "follow-prev" }
const OWNER_TYPES = new Set(["bulletList", "numberedList", "taskList", "toggle"])

describe("maxPersistableDepthAfter", () => {
  it("does not let an ordinary paragraph own another paragraph", () => {
    expect(maxPersistableDepthAfter([{ type: "paragraph", depth: 0 }], OWNER_TYPES)).toBe(0)
  })

  it("opens one child level after a list or Toggle", () => {
    expect(maxPersistableDepthAfter([{ type: "bulletList", depth: 0 }], OWNER_TYPES)).toBe(1)
    expect(maxPersistableDepthAfter([{ type: "toggle", depth: 1 }], OWNER_TYPES)).toBe(2)
  })

  it("continues direct children without allowing an ordinary child to own depth", () => {
    expect(maxPersistableDepthAfter([
      { type: "toggle", depth: 0 },
      { type: "paragraph", depth: 1 },
    ], OWNER_TYPES)).toBe(1)
    expect(maxPersistableDepthAfter([
      { type: "bulletList", depth: 0 },
      { type: "paragraph", depth: 1 },
    ], OWNER_TYPES)).toBe(1)
  })

  it("supports a nested Toggle owner", () => {
    expect(maxPersistableDepthAfter([
      { type: "toggle", depth: 0 },
      { type: "toggle", depth: 1 },
      { type: "paragraph", depth: 2 },
    ], OWNER_TYPES)).toBe(2)
  })

  it("rejects a free depth chain rooted in a non-owner", () => {
    expect(maxPersistableDepthAfter([
      { type: "paragraph", depth: 0 },
      { type: "heading", depth: 1 },
    ], OWNER_TYPES)).toBe(0)
  })
})

describe("normalizeDepthAt", () => {
  it("clamps negative requestedDepth to 0", () => {
    const { doc, endPos, owners } = docWithBlocks([{ type: "paragraph", text: "p" }])
    expect(normalizeDepthAt(doc, endPos, -3, FOLLOW_PREV, owners)).toBe(0)
  })

  it("keeps a plain paragraph or heading after ordinary text at depth 0", () => {
    const { doc, endPos, owners } = docWithBlocks([{ type: "paragraph", text: "p" }])
    expect(normalizeDepthAt(doc, endPos, 4, FOLLOW_PREV, owners)).toBe(0)
  })

  it("allows a direct child after a list item", () => {
    const { doc, endPos, owners } = docWithBlocks([{ type: "bulletList", text: "item" }])
    expect(normalizeDepthAt(doc, endPos, 4, FOLLOW_PREV, owners)).toBe(1)
  })

  it("allows a direct child after a Toggle", () => {
    const { doc, endPos, owners } = docWithBlocks([{ type: "toggle", text: "details" }])
    expect(normalizeDepthAt(doc, endPos, 4, FOLLOW_PREV, owners)).toBe(1)
  })

  it("continues a direct child run but rejects paragraph-owned depth", () => {
    const { doc, endPos, owners } = docWithBlocks([
      { type: "bulletList", text: "item" },
      { type: "paragraph", depth: 1, text: "child" },
    ])
    expect(normalizeDepthAt(doc, endPos, 1, FOLLOW_PREV, owners)).toBe(1)
    expect(normalizeDepthAt(doc, endPos, 2, FOLLOW_PREV, owners)).toBe(1)
  })

  it("allows a child of a nested Toggle at depth 2", () => {
    const { doc, endPos, owners } = docWithBlocks([
      { type: "toggle", text: "outer" },
      { type: "toggle", depth: 1, text: "inner" },
    ])
    expect(normalizeDepthAt(doc, endPos, 9, FOLLOW_PREV, owners)).toBe(2)
  })

  it("numeric maxDepth is an additional cap, not an owner bypass", () => {
    const owned = docWithBlocks([{ type: "toggle", text: "owner" }])
    expect(normalizeDepthAt(
      owned.doc,
      owned.endPos,
      3,
      { mode: "numeric", maxDepth: 1 },
      owned.owners,
    )).toBe(1)

    const free = docWithBlocks([{ type: "paragraph", text: "not owner" }])
    expect(normalizeDepthAt(
      free.doc,
      free.endPos,
      1,
      { mode: "numeric", maxDepth: 3 },
      free.owners,
    )).toBe(0)
  })

  it("recognizes registered structural lists and absorbsDeeperRun contracts", () => {
    const { owners } = docWithBlocks([])
    expect([...owners]).toEqual(expect.arrayContaining([
      "bulletList",
      "numberedList",
      "taskList",
      "toggle",
    ]))
  })
})
