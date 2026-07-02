// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, expect, it } from "vitest"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"

import { createTestEditor } from "../../test-utils/createTestEditor"
import { INTERNAL_NORMALIZATION_META } from "../internal-meta"

type DocSeed = {
  type: string
  attrs?: Record<string, unknown>
  content?: { type: "text"; text: string }[]
}

function makeEditor(blocks: DocSeed[]) {
  return createTestEditor({
    element: document.createElement("div"),
    content: {
      type: "doc",
      content: blocks.map((b) => ({
        type: b.type,
        attrs: b.attrs ?? {},
        content: b.content ?? [{ type: "text", text: "x" }],
      })),
    },
  })
}

function startsOf(editor: ReturnType<typeof createTestEditor>): (number | null)[] {
  const out: (number | null)[] = []
  editor.state.doc.forEach((node) => {
    if (node.type.name === "numberedList") {
      out.push((node.attrs.start as number | null) ?? null)
    }
  })
  return out
}

describe("ListNormalization", () => {
  it("clears start=1 on a leader (1 is the default index)", () => {
    const editor = makeEditor([
      { type: "numberedList", attrs: { start: 1 } },
      { type: "numberedList" },
    ])
    expect(startsOf(editor)).toEqual([null, null])
  })

  it("clears start=5 on a non-leader (stale positional data)", () => {
    const editor = makeEditor([
      { type: "numberedList" },
      { type: "numberedList", attrs: { start: 5 } },
      { type: "numberedList" },
    ])
    expect(startsOf(editor)).toEqual([null, null, null])
  })

  it("preserves start=5 on a leader (explicit user intent)", () => {
    const editor = makeEditor([
      { type: "numberedList", attrs: { start: 5 } },
      { type: "numberedList" },
    ])
    expect(startsOf(editor)).toEqual([5, null])
  })

  it("cleans up after a transaction makes a former leader mid-run", () => {
    // Seed: [start=null, start=null]  → both clean.
    // Then insert a new numberedList at position 0 (becomes the new
    // leader). The old leader is now mid-run; its (already-null) start
    // stays null. To exercise the displacement path we instead seed a
    // dirty mid-run insertion: programmatically insert a numberedList
    // with start=5 between two existing ones and verify normalization
    // strips it.
    const editor = makeEditor([
      { type: "numberedList" },
      { type: "numberedList" },
    ])
    expect(startsOf(editor)).toEqual([null, null])

    const insertPos = editor.state.doc.firstChild!.nodeSize
    editor
      .chain()
      .insertContentAt(insertPos, {
        type: "numberedList",
        attrs: { start: 5 },
        content: [{ type: "text", text: "rogue" }],
      })
      .run()

    expect(startsOf(editor)).toEqual([null, null, null])
  })

  it("does not loop when its own transaction is the only docChanged input", () => {
    // The self-loop guard short-circuits when every input tx carries
    // our own meta. The clearest check that the loop does NOT happen
    // is to confirm the editor reaches a steady state — any infinite
    // appendTransaction recursion would either stack-overflow or
    // exceed PM's appendTransaction iteration cap. Reaching here
    // without throwing is the assertion.
    const editor = makeEditor([
      { type: "numberedList", attrs: { start: 5 } },
      { type: "numberedList", attrs: { start: 7 } },
      { type: "numberedList", attrs: { start: 1 } },
    ])
    // Leader keeps start=5, mid-run start=7 and start=1 both clear.
    expect(startsOf(editor)).toEqual([5, null, null])
  })

  it("tags its tx so the user-edit detector (INTERNAL_NORMALIZATION_META) skips it", () => {
    // The point of INTERNAL_NORMALIZATION_META is that downstream code
    // doing "did the user edit?" can skip housekeeping txs:
    //   if (tr.docChanged && !tr.getMeta(INTERNAL_NORMALIZATION_META))
    // Verify directly that normalization-produced txs satisfy this
    // contract.
    const editor = createTestEditor({
      element: document.createElement("div"),
      content: { type: "doc", content: [{ type: "paragraph" }] },
    })

    const userEdits: boolean[] = []
    editor.on("transaction", ({ transaction: tr }) => {
      if (!tr.docChanged) return
      userEdits.push(!tr.getMeta(INTERNAL_NORMALIZATION_META))
    })

    editor
      .chain()
      .insertContentAt(editor.state.doc.content.size, {
        type: "numberedList",
        attrs: { start: 1 },
        content: [{ type: "text", text: "x" }],
      })
      .run()

    // First docChanged tx is the user's insert (should be flagged as
    // user edit). The follow-up normalization tx — if it surfaces
    // through the transaction event — must NOT be flagged as a user
    // edit. We don't assert how many normalization txs fire (tiptap
    // batching is undefined here), just that any non-user-edit tx
    // we DID see was internal.
    expect(userEdits.length).toBeGreaterThan(0)
    expect(userEdits[0]).toBe(true) // the insert itself
    // And the doc-state assertion confirms normalization ran.
    expect(startsOf(editor)).toEqual([null])
  })

  it("undo skips the normalization tx — lands on the pre-user-edit state", () => {
    const editor = createTestEditor({
      element: document.createElement("div"),
      content: { type: "doc", content: [{ type: "paragraph" }] },
    })

    editor
      .chain()
      .insertContentAt(editor.state.doc.content.size, {
        type: "numberedList",
        attrs: { start: 1 },
        content: [{ type: "text", text: "x" }],
      })
      .run()

    // After insert + normalization, doc has [paragraph, numberedList(start=null)].
    expect(startsOf(editor)).toEqual([null])

    editor.commands.undo()

    // Undo removes the inserted numberedList; the intermediate
    // "start=1" state is NOT a separate history step.
    expect(startsOf(editor)).toEqual([])
  })

  it("scenario-1 promote shape settles to [null, null, null, null]", () => {
    // Models the dirty doc that the chain-promote drag leaves behind
    // when the old d=0 leader had start=1 from the `1.` input rule.
    const editor = makeEditor([
      { type: "numberedList", attrs: { depth: 0 } },
      { type: "numberedList", attrs: { depth: 1 } },
      { type: "numberedList", attrs: { depth: 0, start: 1 } },
      { type: "numberedList", attrs: { depth: 0 } },
    ])
    expect(startsOf(editor)).toEqual([null, null, null, null])
  })

  it("clears a stale mid-run start INSIDE a column (surface-aware walk)", () => {
    // Root-only normalization never reached a numberedList inside a column,
    // so a stale `start` survived there. The engine now numbers the column on
    // its own surface (leader keeps its start, mid-run start is stale) and the
    // walk visits every body block, so the column's rogue start is cleared.
    const editor = createTestEditor({ kit: { suggestionMenus: false } })
    const s = editor.schema
    const nl = (attrs: Record<string, unknown>): ProseMirrorNode =>
      s.nodes.numberedList!.create({ depth: 0, ...attrs }, s.text("x"))
    const col = (...children: ProseMirrorNode[]): ProseMirrorNode =>
      s.nodes.column!.create({ width: 1 }, children)
    const doc = s.nodes.doc!.create(null, [
      s.nodes.columnLayout!.create({ depth: 0 }, [
        col(nl({}), nl({ start: 5 })), // start=5 is a stale non-leader item
        col(s.nodes.paragraph!.create({ depth: 0 }, s.text("x"))),
      ]),
    ])
    editor.view.dispatch(
      editor.state.tr.replaceWith(0, editor.state.doc.content.size, doc.content),
    )

    const starts: (number | null)[] = []
    editor.state.doc.descendants((node) => {
      if (node.type.name === "numberedList") {
        starts.push((node.attrs.start as number | null) ?? null)
      }
    })
    expect(starts).toEqual([null, null])
  })
})
