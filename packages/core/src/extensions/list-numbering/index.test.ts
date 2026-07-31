// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, expect, it } from "vitest"
import { Schema, type Node as ProseMirrorNode } from "@tiptap/pm/model"

import { buildListNumberingDecorations } from "./index"

const schema = new Schema({
  nodes: {
    doc: { content: "block*" },
    text: { group: "inline" },
    paragraph: {
      group: "block",
      attrs: { depth: { default: 0 } },
      content: "inline*",
    },
    bulletList: {
      group: "block",
      attrs: { depth: { default: 0 } },
      content: "inline*",
    },
    numberedList: {
      group: "block",
      attrs: {
        depth: { default: 0 },
        start: { default: null },
      },
      content: "inline*",
    },
  },
})

type BlockInput = {
  type: "numberedList" | "bulletList" | "paragraph"
  depth: number
  attrs?: { start?: number | null }
}

type DecorationAttrs = {
  style?: string
}

type NodeDecoration = {
  type: { attrs: DecorationAttrs }
}

function docFromBlocks(blocks: BlockInput[]) {
  return schema.node(
    "doc",
    null,
    blocks.map((block) =>
      schema.node(
        block.type,
        { depth: block.depth, ...block.attrs },
        schema.text("x"),
      ),
    ),
  )
}

function listIndices(doc: ProseMirrorNode) {
  return buildListNumberingDecorations(doc)
    .find()
    .filter((decoration) => {
      const style = (decoration as unknown as NodeDecoration).type.attrs.style ?? ""
      return style.includes("--rune-list-index")
    })
    .map((decoration) => {
      const style = (decoration as unknown as NodeDecoration).type.attrs.style ?? ""
      return style.replace("--rune-list-index: ", "")
    })
}

function markerStyles(doc: ProseMirrorNode) {
  return buildListNumberingDecorations(doc)
    .find()
    .map((decoration) => {
      const attrs = (decoration as unknown as NodeDecoration).type.attrs
      return (attrs as Record<string, string>)["data-marker-style"] ?? ""
    })
}

describe("buildListNumberingDecorations — marker styles", () => {
  it("2.1 [bullet d=0, bullet d=0, bullet d=0] → disc, disc, disc", () => {
    const doc = docFromBlocks([
      { type: "bulletList", depth: 0 },
      { type: "bulletList", depth: 0 },
      { type: "bulletList", depth: 0 },
    ])
    expect(markerStyles(doc)).toEqual(["disc", "disc", "disc"])
  })

  it("2.2 [bullet d=0, bullet d=1, bullet d=2] → disc, circle, square", () => {
    const doc = docFromBlocks([
      { type: "bulletList", depth: 0 },
      { type: "bulletList", depth: 1 },
      { type: "bulletList", depth: 2 },
    ])
    expect(markerStyles(doc)).toEqual(["disc", "circle", "square"])
  })

  it("2.3 [bullet d=0, numbered d=1] → disc, decimal", () => {
    const doc = docFromBlocks([
      { type: "bulletList", depth: 0 },
      { type: "numberedList", depth: 1 },
    ])
    expect(markerStyles(doc)).toEqual(["disc", "decimal"])
  })

  it("2.4 [numbered d=0, bullet d=0] → decimal, disc (kind switch at same depth resets)", () => {
    const doc = docFromBlocks([
      { type: "numberedList", depth: 0 },
      { type: "bulletList", depth: 0 },
    ])
    expect(markerStyles(doc)).toEqual(["decimal", "disc"])
  })

  it("2.5 [bullet d=0, numbered d=1, bullet d=2] → disc, decimal, circle", () => {
    const doc = docFromBlocks([
      { type: "bulletList", depth: 0 },
      { type: "numberedList", depth: 1 },
      { type: "bulletList", depth: 2 },
    ])
    expect(markerStyles(doc)).toEqual(["disc", "decimal", "circle"])
  })

  it("2.6 6 nested bullets d=0..5 → disc, circle, square, disc, circle, square", () => {
    const doc = docFromBlocks([
      { type: "bulletList", depth: 0 },
      { type: "bulletList", depth: 1 },
      { type: "bulletList", depth: 2 },
      { type: "bulletList", depth: 3 },
      { type: "bulletList", depth: 4 },
      { type: "bulletList", depth: 5 },
    ])
    expect(markerStyles(doc)).toEqual(["disc", "circle", "square", "disc", "circle", "square"])
  })

  it("2.7 3 nested numbered d=0..2 → decimal, lower-alpha, lower-roman", () => {
    const doc = docFromBlocks([
      { type: "numberedList", depth: 0 },
      { type: "numberedList", depth: 1 },
      { type: "numberedList", depth: 2 },
    ])
    expect(markerStyles(doc)).toEqual(["decimal", "lower-alpha", "lower-roman"])
  })

  it("2.8 [bullet d=0, numbered d=0, bullet d=0] → disc, decimal, disc", () => {
    const doc = docFromBlocks([
      { type: "bulletList", depth: 0 },
      { type: "numberedList", depth: 0 },
      { type: "bulletList", depth: 0 },
    ])
    expect(markerStyles(doc)).toEqual(["disc", "decimal", "disc"])
  })

  it("2.10 [bullet d=0, task d=0, bullet d=0] → disc, disc (non-list gets no marker decoration)", () => {
    const doc = docFromBlocks([
      { type: "bulletList", depth: 0 },
      { type: "paragraph", depth: 0 },
      { type: "bulletList", depth: 0 },
    ])
    // paragraph gets no decoration — only list blocks produce entries
    expect(markerStyles(doc)).toEqual(["disc", "disc"])
  })
})

describe("buildListNumberingDecorations", () => {
  it("4.1.a numbers a single run of three depth-0 numbered blocks", () => {
    const doc = docFromBlocks([
      { type: "numberedList", depth: 0 },
      { type: "numberedList", depth: 0 },
      { type: "numberedList", depth: 0 },
    ])

    expect(listIndices(doc)).toEqual(["1", "2", "3"])
  })

  it("4.1.b restarts after a same-depth paragraph breaks the run", () => {
    const doc = docFromBlocks([
      { type: "numberedList", depth: 0 },
      { type: "paragraph", depth: 0 },
      { type: "numberedList", depth: 0 },
      { type: "numberedList", depth: 0 },
    ])

    expect(listIndices(doc)).toEqual(["1", "1", "2"])
  })

  it("4.1.c preserves the outer run across a nested bullet aside", () => {
    const doc = docFromBlocks([
      { type: "numberedList", depth: 0 },
      { type: "bulletList", depth: 1 },
      { type: "numberedList", depth: 0 },
    ])

    expect(listIndices(doc)).toEqual(["1", "2"])
  })

  it("4.1.d preserves the outer run across a nested paragraph aside", () => {
    const doc = docFromBlocks([
      { type: "numberedList", depth: 0 },
      { type: "paragraph", depth: 1 },
      { type: "numberedList", depth: 0 },
    ])

    expect(listIndices(doc)).toEqual(["1", "2"])
  })

  it("4.1.e starts nested depth runs at one and resumes the outer run", () => {
    const doc = docFromBlocks([
      { type: "numberedList", depth: 0 },
      { type: "numberedList", depth: 0 },
      { type: "numberedList", depth: 1 },
      { type: "numberedList", depth: 1 },
      { type: "numberedList", depth: 0 },
    ])

    expect(listIndices(doc)).toEqual(["1", "2", "1", "2", "3"])
  })

  it("4.1.f honors explicit start=5 on the first item", () => {
    const doc = docFromBlocks([
      { type: "numberedList", depth: 0, attrs: { start: 5 } },
      { type: "numberedList", depth: 0 },
      { type: "numberedList", depth: 0 },
    ])

    expect(listIndices(doc)).toEqual(["5", "6", "7"])
  })

  it("4.1.g ignores mid-run explicit start=5 — counter continues", () => {
    // Flipped from the legacy "[1, 5, 6]" semantic. In the flat schema
    // a mid-run `start` is stale data (it can't survive reorder), so
    // the engine treats `start` as meaningful only on a run leader.
    // ListNormalization separately erases the rogue attr so the stored
    // doc shape matches what's rendered. See spec §7.
    const doc = docFromBlocks([
      { type: "numberedList", depth: 0 },
      { type: "numberedList", depth: 0, attrs: { start: 5 } },
      { type: "numberedList", depth: 0 },
    ])

    expect(listIndices(doc)).toEqual(["1", "2", "3"])
  })

  it("4.1.g.1 treats mid-run start=1 as no-anchor (default index) and continues the run", () => {
    // Regression: after a list-chain promote, the displaced d=0 sibling may
    // carry start=1 from the input rule that originally created it. start=1
    // is semantically equivalent to "no anchor" (1 is the default index),
    // so it must not restart the counter.
    const doc = docFromBlocks([
      { type: "numberedList", depth: 0 },
      { type: "numberedList", depth: 1 },
      { type: "numberedList", depth: 0, attrs: { start: 1 } },
      { type: "numberedList", depth: 0 },
    ])

    expect(listIndices(doc)).toEqual(["1", "1", "2", "3"])
  })

  it("4.1.h restarts after an adjacent same-depth kind change", () => {
    const doc = docFromBlocks([
      { type: "numberedList", depth: 0 },
      { type: "bulletList", depth: 0 },
      { type: "numberedList", depth: 0 },
    ])

    expect(listIndices(doc)).toEqual(["1", "1"])
  })

  it("4.1.i reflows indices after deleting a block and rebuilding", () => {
    const newDoc = docFromBlocks([
      { type: "numberedList", depth: 0 },
      { type: "numberedList", depth: 1 },
      { type: "numberedList", depth: 0 },
    ])

    expect(listIndices(newDoc)).toEqual(["1", "1", "2"])
  })
})
