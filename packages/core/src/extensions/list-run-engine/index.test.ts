// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, expect, it } from "vitest"
import { Schema, type Node as ProseMirrorNode } from "@tiptap/pm/model"

import { computeListRuns } from "./index"

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
    // `columnLayout` is a body block (carries the `depth` factory attr, so
    // isBodyBlockNode → true) whose children are structural `column` nodes.
    // `column` carries NO depth attr and admits body blocks, so it classifies
    // as a structural surface — mirrors the real schema/blocks/Columns shape
    // closely enough for the surface walk under test.
    columnLayout: {
      group: "block",
      attrs: { depth: { default: 0 } },
      content: "column+",
    },
    column: {
      content: "block+",
    },
  },
})

type BlockInput = {
  type: "numberedList" | "bulletList" | "paragraph"
  depth: number
  attrs?: { start?: number | null }
}

function docFromBlocks(blocks: BlockInput[]): ProseMirrorNode {
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

// Column-doc builders (kept separate from docFromBlocks so the flat-doc tests
// stay untouched). A `column` holds first-class body blocks on its own surface.
function nList(depth = 0, attrs: { start?: number | null } = {}): ProseMirrorNode {
  return schema.node("numberedList", { depth, ...attrs }, schema.text("x"))
}
function bList(depth = 0): ProseMirrorNode {
  return schema.node("bulletList", { depth }, schema.text("x"))
}
function para(depth = 0): ProseMirrorNode {
  return schema.node("paragraph", { depth }, schema.text("x"))
}
function col(...children: ProseMirrorNode[]): ProseMirrorNode {
  return schema.node("column", null, children)
}
function layout(...columns: ProseMirrorNode[]): ProseMirrorNode {
  return schema.node("columnLayout", { depth: 0 }, columns)
}
function doc(...blocks: ProseMirrorNode[]): ProseMirrorNode {
  return schema.node("doc", null, blocks)
}

function infosInOrder(doc: ProseMirrorNode) {
  const info = computeListRuns(doc)
  // Map iterates in insertion order, matching the doc walk.
  return Array.from(info.byPos.values())
}

// Index of every numberedList in DOCUMENT order (undefined ⇒ the engine
// produced no run info for it — the "0." fallback bug). Robust to the
// per-surface emission order of the engine: it looks each block up by its
// own absolute pos rather than relying on byPos insertion order.
function numberedIndicesInDocOrder(doc: ProseMirrorNode): (number | undefined)[] {
  const info = computeListRuns(doc)
  const out: (number | undefined)[] = []
  doc.descendants((node, pos) => {
    if (node.type.name === "numberedList") out.push(info.byPos.get(pos)?.index)
  })
  return out
}

// Marker style of every list block in DOCUMENT order.
function markerStylesInDocOrder(doc: ProseMirrorNode): (string | undefined)[] {
  const info = computeListRuns(doc)
  const out: (string | undefined)[] = []
  doc.descendants((node, pos) => {
    if (node.type.name === "numberedList" || node.type.name === "bulletList") {
      out.push(info.byPos.get(pos)?.markerStyle)
    }
  })
  return out
}

describe("computeListRuns — numbered indices + leader detection", () => {
  it("flags the first numberedList at a depth as run leader", () => {
    const doc = docFromBlocks([
      { type: "numberedList", depth: 0 },
      { type: "numberedList", depth: 0 },
      { type: "numberedList", depth: 0 },
    ])
    const infos = infosInOrder(doc)
    expect(infos.map((i) => i.isRunLeader)).toEqual([true, false, false])
    expect(infos.map((i) => i.index)).toEqual([1, 2, 3])
  })

  it("honors leader's start=5 and continues from there", () => {
    const doc = docFromBlocks([
      { type: "numberedList", depth: 0, attrs: { start: 5 } },
      { type: "numberedList", depth: 0 },
      { type: "numberedList", depth: 0 },
    ])
    const infos = infosInOrder(doc)
    expect(infos.map((i) => i.isRunLeader)).toEqual([true, false, false])
    expect(infos.map((i) => i.index)).toEqual([5, 6, 7])
  })

  it("ignores non-leader start (mid-run start=5 does NOT jump the counter)", () => {
    // The semantic flip vs. legacy test 4.1.g — see spec §7.
    const doc = docFromBlocks([
      { type: "numberedList", depth: 0 },
      { type: "numberedList", depth: 0, attrs: { start: 5 } },
      { type: "numberedList", depth: 0 },
    ])
    const infos = infosInOrder(doc)
    expect(infos.map((i) => i.isRunLeader)).toEqual([true, false, false])
    expect(infos.map((i) => i.index)).toEqual([1, 2, 3])
  })

  it("treats leader start=1 the same as start=null (1 is the default index)", () => {
    const a = infosInOrder(
      docFromBlocks([
        { type: "numberedList", depth: 0, attrs: { start: 1 } },
        { type: "numberedList", depth: 0 },
      ]),
    )
    const b = infosInOrder(
      docFromBlocks([
        { type: "numberedList", depth: 0 },
        { type: "numberedList", depth: 0 },
      ]),
    )
    expect(a.map((i) => i.index)).toEqual([1, 2])
    expect(b.map((i) => i.index)).toEqual([1, 2])
  })

  it("scenario-1 promote shape: [d=0, d=1, d=0(start=1), d=0] → [1, 1, 2, 3]", () => {
    const doc = docFromBlocks([
      { type: "numberedList", depth: 0 },
      { type: "numberedList", depth: 1 },
      { type: "numberedList", depth: 0, attrs: { start: 1 } },
      { type: "numberedList", depth: 0 },
    ])
    const infos = infosInOrder(doc)
    expect(infos.map((i) => i.index)).toEqual([1, 1, 2, 3])
    expect(infos.map((i) => i.isRunLeader)).toEqual([true, true, false, false])
  })

  it("paragraph at same depth breaks the run; next numberedList is a new leader", () => {
    const doc = docFromBlocks([
      { type: "numberedList", depth: 0 },
      { type: "paragraph", depth: 0 },
      { type: "numberedList", depth: 0 },
    ])
    const numbered = infosInOrder(doc).filter((i) => i.kind === "numbered")
    expect(numbered.map((i) => i.isRunLeader)).toEqual([true, true])
    expect(numbered.map((i) => i.index)).toEqual([1, 1])
  })

  it("kind switch at same depth (numbered → bullet → numbered) restarts numbering", () => {
    const doc = docFromBlocks([
      { type: "numberedList", depth: 0 },
      { type: "bulletList", depth: 0 },
      { type: "numberedList", depth: 0 },
    ])
    const numbered = infosInOrder(doc).filter((i) => i.kind === "numbered")
    expect(numbered.map((i) => i.isRunLeader)).toEqual([true, true])
    expect(numbered.map((i) => i.index)).toEqual([1, 1])
  })

  it("nested numbered run at d=1 starts at 1 and outer d=0 resumes", () => {
    const doc = docFromBlocks([
      { type: "numberedList", depth: 0 },
      { type: "numberedList", depth: 1 },
      { type: "numberedList", depth: 1 },
      { type: "numberedList", depth: 0 },
    ])
    const infos = infosInOrder(doc)
    expect(infos.map((i) => i.index)).toEqual([1, 1, 2, 2])
    expect(infos.map((i) => i.isRunLeader)).toEqual([true, true, false, false])
  })
})

describe("computeListRuns — marker styles", () => {
  it("3 nested numbered depths → decimal, lower-alpha, lower-roman", () => {
    const doc = docFromBlocks([
      { type: "numberedList", depth: 0 },
      { type: "numberedList", depth: 1 },
      { type: "numberedList", depth: 2 },
    ])
    expect(infosInOrder(doc).map((i) => i.markerStyle)).toEqual([
      "decimal",
      "lower-alpha",
      "lower-roman",
    ])
  })

  it("3 nested bullet depths → disc, circle, square", () => {
    const doc = docFromBlocks([
      { type: "bulletList", depth: 0 },
      { type: "bulletList", depth: 1 },
      { type: "bulletList", depth: 2 },
    ])
    expect(infosInOrder(doc).map((i) => i.markerStyle)).toEqual([
      "disc",
      "circle",
      "square",
    ])
  })

  it("bullets get no isRunLeader/index in v1", () => {
    const doc = docFromBlocks([
      { type: "bulletList", depth: 0 },
      { type: "bulletList", depth: 0 },
    ])
    const infos = infosInOrder(doc)
    expect(infos.map((i) => i.isRunLeader)).toEqual([undefined, undefined])
    expect(infos.map((i) => i.index)).toEqual([undefined, undefined])
  })
})

describe("computeListRuns — pos/nodeSize wiring", () => {
  it("each entry's pos+nodeSize matches the underlying node's slot", () => {
    const doc = docFromBlocks([
      { type: "numberedList", depth: 0 },
      { type: "paragraph", depth: 0 },
      { type: "bulletList", depth: 0 },
    ])
    const info = computeListRuns(doc)
    const positions: number[] = []
    doc.forEach((node, offset) => {
      if (node.type.name === "numberedList" || node.type.name === "bulletList") {
        positions.push(offset)
        const entry = info.byPos.get(offset)
        expect(entry).toBeDefined()
        expect(entry?.nodeSize).toBe(node.nodeSize)
      }
    })
    expect(positions.length).toBeGreaterThan(0)
  })
})

describe("computeListRuns — columns (per-surface numbering)", () => {
  it("(a) numbers a 3-item numbered list inside a column 1/2/3", () => {
    const d = doc(
      layout(
        col(nList(), nList(), nList()),
        col(para()),
      ),
    )
    expect(numberedIndicesInDocOrder(d)).toEqual([1, 2, 3])
    const info = computeListRuns(d)
    // The in-column entries are keyed by ABSOLUTE pos, so the decoration
    // builder and normalization can address them uniformly.
    const leaders = Array.from(info.byPos.values()).map((i) => i.isRunLeader)
    expect(leaders).toEqual([true, false, false])
  })

  it("(b) two columns each numbered independently, restarting at 1", () => {
    const d = doc(
      layout(
        col(nList(), nList()),
        col(nList(), nList(), nList()),
      ),
    )
    expect(numberedIndicesInDocOrder(d)).toEqual([1, 2, 1, 2, 3])
  })

  it("(c) root run before/after a columnLayout is unchanged (layout interrupts like a paragraph)", () => {
    const withLayout = doc(
      nList(),
      nList(),
      layout(col(nList()), col(para())),
      nList(),
      nList(),
    )
    // Root run: 1,2 before. The columnLayout is a non-list root child — an
    // interrupter exactly like a same-depth paragraph (test 4.1.b) — so the
    // root run RESTARTS after it: 1,2. The single in-column list is its own
    // surface, numbered independently from 1 (the middle entry).
    expect(numberedIndicesInDocOrder(withLayout)).toEqual([1, 2, 1, 1, 2])

    // Proof the layout behaves as the pre-existing paragraph interrupter:
    // replacing it with a plain paragraph drops only the in-column entry and
    // leaves root numbering byte-identical.
    const withParagraph = doc(nList(), nList(), para(), nList(), nList())
    expect(numberedIndicesInDocOrder(withParagraph)).toEqual([1, 2, 1, 2])
  })

  it("(d) in-column bullets depth-cycle disc/circle/square, independent of a root bullet", () => {
    const d = doc(
      bList(0),
      layout(
        col(bList(0), bList(1), bList(2)),
        col(para()),
      ),
    )
    // Root bullet is disc; the column's own surface restarts the cycle, so
    // its depth-0 bullet is disc again (not carried over from root).
    expect(markerStylesInDocOrder(d)).toEqual(["disc", "disc", "circle", "square"])
  })
})
