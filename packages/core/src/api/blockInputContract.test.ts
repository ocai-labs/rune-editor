// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The structured block-input contract (spec 2026-06-15): an agent authors any
// block by emitting RuneBlockInput JSON; `fromInput` converts it. These tests
// keep the ADVERTISED contract honest — they iterate EVERY registered block
// spec, so a new block that ships `fromInput` but a thin/wrong example fails
// here instead of silently shrinking agent coverage (the existing
// `missing-input-example` warning only catches ZERO examples, not thin ones).

import { describe, expect, it } from "vitest"
import type { Editor } from "@tiptap/core"
import { createTestEditor } from "../test-utils/createTestEditor"
import { forEachBlockSpec, type BlockSpecMetadata } from "../schema"
import type { RuneBlockInput } from "./types"
import { createNodeFromBlockInput } from "./commands/insertBlocks"
import { getDocument } from "./queries/getDocument"
import { getBlockOutline } from "./queries/blockSnapshots"
import { getRuneSchemaContext } from "./schemaContext"
import type { RuneBlock } from "../blocks"

type NamedSpec = { name: string; meta: BlockSpecMetadata }

function allSpecs(editor: Editor): NamedSpec[] {
  const out: NamedSpec[] = []
  forEachBlockSpec(editor, (name, meta) => out.push({ name, meta }))
  return out
}

/** Insert one block and return its public JSON (the projection that runs each
 *  block's `toRuneBlock` with the proper child-projection ctx). Identified by
 *  the id that wasn't a top-level block before — robust even when the example
 *  shares a type with the seeded paragraph. */
function insertAndRead(editor: Editor, input: RuneBlockInput): RuneBlock {
  const before = new Set(getBlockOutline(editor).map((b) => b.id))
  editor.commands.insertBlocks([input], { at: "end" })
  // Pin the single-fresh-block assumption: every example here inserts exactly
  // one top-level block, so `fresh` is unambiguous. If a future writable block
  // yields two top-level nodes, fail loudly here instead of silently reading
  // one and round-tripping against the wrong block.
  const fresh = getDocument(editor).filter((b) => !before.has(b.id))
  if (fresh.length !== 1) {
    throw new Error(
      `expected exactly one fresh top-level block for ${input.type}, got ${fresh.length}`,
    )
  }
  return fresh[0]!
}

/** Drop runtime-assigned ids (block + nested column / children) so two
 *  independently-inserted projections compare by structure, not identity. */
function stripIds(block: RuneBlock): unknown {
  const b = block as unknown as Record<string, unknown> & { id?: unknown }
  const { id: _id, ...rest } = b
  const out: Record<string, unknown> = { ...rest }
  if (Array.isArray(out.children)) {
    out.children = (out.children as RuneBlock[]).map(stripIds)
  }
  if (Array.isArray(out.columns)) {
    out.columns = (out.columns as Array<Record<string, unknown>>).map((col) => {
      const { id: _cid, children, ...crest } = col
      return {
        ...crest,
        children: Array.isArray(children) ? (children as RuneBlock[]).map(stripIds) : [],
      }
    })
  }
  return out
}

describe("block input contract", () => {
  it("advertises at least one input example for every writable block", () => {
    const editor = createTestEditor()
    const ctx = getRuneSchemaContext(editor)
    const missing = ctx.blocks
      .filter((b) => b.input.supported && !b.input.examples)
      .map((b) => b.type)
    // A block with `fromInput` but no advertised example leaves an agent
    // guessing its shape. New writable blocks must declare one.
    expect(missing).toEqual([])
  })

  it("accepts every declared input example via fromInput (no thin/wrong examples)", () => {
    const editor = createTestEditor()
    for (const { name, meta } of allSpecs(editor)) {
      for (const ex of meta.schemaContext?.input?.examples ?? []) {
        const node = createNodeFromBlockInput(editor, editor.schema, ex as unknown as RuneBlockInput)
        expect(node, `${name}: fromInput rejected its own example ${JSON.stringify(ex)}`).not.toBeNull()
      }
    }
  })

  it("round-trips fromInput ∘ toRuneBlock for every block's first example", () => {
    const editor = createTestEditor()
    for (const { name, meta } of allSpecs(editor)) {
      if (!meta.fromInput || !meta.toRuneBlock) continue
      const ex = meta.schemaContext?.input?.examples?.[0]
      if (!ex) continue
      // example -> node -> public JSON, then re-insert that JSON and read it
      // back: a stable contract reconstructs the same structure both times.
      const first = insertAndRead(editor, ex as unknown as RuneBlockInput)
      const second = insertAndRead(editor, stripIds(first) as RuneBlockInput)
      expect(stripIds(second), `${name} did not round-trip`).toEqual(stripIds(first))
    }
  })
})

describe("table input", () => {
  it("advertises and round-trips the populated rows shape", () => {
    const editor = createTestEditor()
    const ctx = getRuneSchemaContext(editor)
    const table = ctx.blocks.find((b) => b.type === "table")
    // The populated example (rows as an array of cells) must be advertised, not
    // only the blank-grid dimensions sugar.
    const populated = table?.input.examples?.find((ex) => Array.isArray((ex as { rows?: unknown }).rows))
    expect(populated).toBeDefined()

    const read = insertAndRead(editor, populated as unknown as RuneBlockInput) as RuneBlock & {
      rows: Array<{ cells: Array<{ text: string }>; isHeader: boolean }>
    }
    expect(read.type).toBe("table")
    expect(read.rows[0]?.isHeader).toBe(true)
    expect(read.rows[0]?.cells[0]?.text).toBe("Feature")
    expect(read.rows[1]?.cells[1]?.text).toBe("Shipped")
  })
})

// The INVARIANT this section guards (the class of bug behind the downstream
// table-write report): a block with a STRUCTURED content field (a nested
// array/object, not a scalar `text`) must never SILENTLY drop content it was
// given. When a model emits a near-miss of the advertised shape, `fromInput`
// must do exactly one of two things — and the success/`null` channel must
// reflect which:
//   • RECOVER the content (coerce the obvious-intent deviation), or
//   • REJECT (return null) so `insertBlocks` surfaces
//     `explainBlockInputRejection`'s actionable reason.
// Building a content-LESS node and reporting success is forbidden: it loses the
// user's content while telling the agent it succeeded (→ blind retry loop).
// `table` historically degraded malformed input to a blank grid.
// Any NEW structured block must be added here with both halves asserted.
describe("structured blocks never silently drop content", () => {
  function tableRows(editor: Editor, input: RuneBlockInput) {
    const read = insertAndRead(editor, input) as RuneBlock & {
      rows: Array<{ cells: Array<{ text: string }>; isHeader: boolean }>
    }
    return read.rows.map((r) => ({ cells: r.cells.map((c) => c.text), isHeader: r.isHeader }))
  }

  it("table: recovers bare-string cells (rows[].cells = ['a','b'])", () => {
    const editor = createTestEditor()
    const rows = tableRows(editor, {
      type: "table",
      rows: [
        { cells: ["Feature", "Status"], isHeader: true },
        { cells: ["Search", "Shipped"] },
      ],
    } as unknown as RuneBlockInput)
    expect(rows[0]?.cells).toEqual(["Feature", "Status"])
    expect(rows[1]?.cells).toEqual(["Search", "Shipped"])
    expect(rows[0]?.isHeader).toBe(true)
  })

  it("table: recovers array-of-arrays rows (no `cells` wrapper)", () => {
    const editor = createTestEditor()
    const rows = tableRows(editor, {
      type: "table",
      rows: [
        ["Feature", "Status"],
        ["Search", "Shipped"],
      ],
    } as unknown as RuneBlockInput)
    expect(rows[0]?.cells).toEqual(["Feature", "Status"])
    expect(rows[1]?.cells).toEqual(["Search", "Shipped"])
  })

  it("table: recovers a `content` cell key (model guesses the wrong field)", () => {
    const editor = createTestEditor()
    const rows = tableRows(editor, {
      type: "table",
      rows: [{ cells: [{ content: "Feature" }, { content: "Status" }] }],
    } as unknown as RuneBlockInput)
    expect(rows[0]?.cells).toEqual(["Feature", "Status"])
  })

  it("table: parses a flat `|`/newline markdown table from `text`", () => {
    const editor = createTestEditor()
    const rows = tableRows(editor, {
      type: "table",
      text: "| Feature | Status |\n| --- | --- |\n| Search | Shipped |",
    } as unknown as RuneBlockInput)
    expect(rows[0]?.cells).toEqual(["Feature", "Status"])
    expect(rows[0]?.isHeader).toBe(true) // promoted by the separator row
    expect(rows[1]?.cells).toEqual(["Search", "Shipped"])
  })

  it("table: REJECTS content under an unmappable cell key (signal, not blank)", () => {
    const editor = createTestEditor()
    // `Feature` is real content but sits under a key we can't map → reject so the
    // agent is told the shape, instead of getting a silently blank table.
    const node = createNodeFromBlockInput(editor, editor.schema, {
      type: "table",
      rows: [{ label: "Feature" }, { label: "Status" }],
    } as unknown as RuneBlockInput)
    expect(node).toBeNull()
  })

  it("table: REJECTS prose in `text` (not a grid)", () => {
    const editor = createTestEditor()
    const node = createNodeFromBlockInput(editor, editor.schema, {
      type: "table",
      text: "just some prose, no pipes",
    } as unknown as RuneBlockInput)
    expect(node).toBeNull()
  })

  it("table: still builds a genuinely-empty populated request (not a drop)", () => {
    const editor = createTestEditor()
    // All cells empty AND no content anywhere in the input → a valid empty
    // table, not dropped content. Must build, not reject.
    const node = createNodeFromBlockInput(editor, editor.schema, {
      type: "table",
      rows: [{ cells: [{ text: "" }, { text: "" }] }],
    } as unknown as RuneBlockInput)
    expect(node).not.toBeNull()
    expect(node!.type.name).toBe("table")
  })
})
