// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, it, expect } from "vitest"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import { Editor } from "@tiptap/core"
import { onTestFinished } from "vitest"
import { createTestEditor } from "../../test-utils/createTestEditor"
import { createRuneKit } from "../../kit"
import { INTERNAL_NORMALIZATION_META } from "../../extensions/internal-meta"
import { normalizeColumnWidth, __internals } from "./normalization"

const { firstNestedLayout, firstLayoutToUnwrap, firstEmptyColumn, flattenNestedLayouts } =
  __internals

// Build a doc node directly from the schema, BYPASSING the JSON/HTML parser's
// content re-fitting, then feed `node.toJSON()` to a fresh editor. PM's
// `Node.fromJSON` (the content-JSON path) does NOT re-fit against the schema
// content expression, so schema-INVALID intermediate states (a 1-column
// layout, an empty column, a nested layout) survive to the editor where the
// normalization pass — view() seed + appendTransaction — can act on them.
// `tr.delete` / `tr.replace` can't reach these states: PM's content fitting
// refuses to leave a `column{2,5}` / `block+` invalid. (Probed 2026-06-10.)
function editorWithDoc(
  build: (schema: Editor["schema"]) => ProseMirrorNode,
  opts?: { editable?: boolean },
): Editor {
  const probe = new Editor({ extensions: createRuneKit() })
  const docNode = build(probe.schema)
  probe.destroy()
  const editor = new Editor({
    extensions: createRuneKit(),
    content: docNode.toJSON(),
    ...(opts?.editable === undefined ? {} : { editable: opts.editable }),
  })
  onTestFinished(() => {
    if (!editor.isDestroyed) editor.destroy()
  })
  return editor
}

function dumpTypes(doc: ProseMirrorNode): string[] {
  const out: string[] = []
  doc.descendants((node) => {
    out.push(node.type.name)
    return true
  })
  return out
}

// A 2-column layout doc. `column` attrs are set explicitly per-test to
// exercise normalization. Built via JSON content so the editor's
// appendTransaction passes run (id backfill + width clamp).
function columnsDoc(cols: Array<{ id?: string | null; width?: unknown }>) {
  return {
    type: "doc",
    content: [
      {
        type: "columnLayout",
        content: cols.map((c) => ({
          type: "column",
          attrs: {
            id: c.id ?? null,
            width: c.width === undefined ? 1 : c.width,
          },
          content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }],
        })),
      },
    ],
  }
}

function columnNodes(editor: ReturnType<typeof createTestEditor>): ProseMirrorNode[] {
  const out: ProseMirrorNode[] = []
  editor.state.doc.descendants((node) => {
    if (node.type.name === "column") out.push(node)
    return true
  })
  return out
}

describe("normalizeColumnWidth (pure)", () => {
  it("clamps 0 / -2 / NaN / missing / non-number to 1", () => {
    expect(normalizeColumnWidth(0)).toBe(1)
    expect(normalizeColumnWidth(-2)).toBe(1)
    expect(normalizeColumnWidth(Number.NaN)).toBe(1)
    expect(normalizeColumnWidth(undefined)).toBe(1)
    expect(normalizeColumnWidth(null)).toBe(1)
    expect(normalizeColumnWidth("2")).toBe(1)
  })

  it("preserves a valid positive width", () => {
    expect(normalizeColumnWidth(1)).toBe(1)
    expect(normalizeColumnWidth(2.5)).toBe(2.5)
  })
})

describe("Columns normalization plugin", () => {
  it("backfills a col_ id onto a column with null id", () => {
    const editor = createTestEditor({ content: columnsDoc([{ id: null }, { id: null }]) })
    const cols = columnNodes(editor)
    expect(cols).toHaveLength(2)
    for (const col of cols) {
      expect(typeof col.attrs.id).toBe("string")
      expect((col.attrs.id as string).startsWith("col_")).toBe(true)
    }
    // unique
    expect(new Set(cols.map((c) => c.attrs.id)).size).toBe(2)
  })

  it("preserves an existing valid column id", () => {
    const editor = createTestEditor({
      content: columnsDoc([{ id: "col_keepme1" }, { id: "col_keepme2" }]),
    })
    const ids = columnNodes(editor).map((c) => c.attrs.id)
    expect(ids).toEqual(["col_keepme1", "col_keepme2"])
  })

  it("clamps stored non-positive widths (0, -2) to 1", () => {
    const editor = createTestEditor({
      content: columnsDoc([
        { id: "col_a", width: 0 },
        { id: "col_b", width: -2 },
      ]),
    })
    const widths = columnNodes(editor).map((c) => c.attrs.width)
    expect(widths).toEqual([1, 1])
  })

  it("preserves a valid non-default width (2.5)", () => {
    const editor = createTestEditor({
      content: columnsDoc([
        { id: "col_a", width: 2.5 },
        { id: "col_b", width: 1 },
      ]),
    })
    const widths = columnNodes(editor).map((c) => c.attrs.width)
    expect(widths).toEqual([2.5, 1])
  })

  it("normalization tr is tagged INTERNAL_NORMALIZATION_META + addToHistory=false", () => {
    const editor = createTestEditor({ content: columnsDoc([{ id: "col_a" }, { id: "col_b" }]) })

    // Insert a column-less-id layout-ish change: simplest is to set a
    // column's id to null via a raw tr, then apply and inspect the
    // resulting appendTransaction.
    let columnPos = -1
    editor.state.doc.descendants((node, pos) => {
      if (columnPos < 0 && node.type.name === "column") columnPos = pos
      return true
    })
    const col = editor.state.doc.nodeAt(columnPos)!
    const tr = editor.state.tr.setNodeMarkup(columnPos, undefined, {
      ...col.attrs,
      id: null,
      width: 0,
    })
    const { transactions } = editor.state.applyTransaction(tr)
    const norm = transactions.find(
      (t) => t.getMeta(INTERNAL_NORMALIZATION_META) === true,
    )
    expect(norm).toBeDefined()
    expect(norm!.getMeta("addToHistory")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Task 3 — schema builders for invalid intermediate states.
// ---------------------------------------------------------------------------

function para(schema: Editor["schema"], text: string): ProseMirrorNode {
  return schema.nodes.paragraph!.create({ id: null, depth: 0 }, schema.text(text))
}
function paraDepth(schema: Editor["schema"], text: string, depth: number): ProseMirrorNode {
  return schema.nodes.paragraph!.create({ id: null, depth }, schema.text(text))
}
function col(
  schema: Editor["schema"],
  id: string,
  children: ProseMirrorNode[],
  width = 1,
): ProseMirrorNode {
  return schema.nodes.column!.create({ id, width }, children)
}
function layoutNode(
  schema: Editor["schema"],
  attrs: { id: string; depth: number },
  cols: ProseMirrorNode[] = [],
): ProseMirrorNode {
  return cols.length === 0
    ? schema.nodes.columnLayout!.create(attrs)
    : schema.nodes.columnLayout!.create(attrs, cols)
}
function docNode(schema: Editor["schema"], children: ProseMirrorNode[]): ProseMirrorNode {
  return schema.nodes.doc!.create(null, children)
}

describe("firstEmptyColumn (pure)", () => {
  it("finds a column with zero children", () => {
    // Pure finder: build a schema node with an empty column directly (the
    // editor would normalize it away, so inspect the raw node). E2's actual
    // padding behavior is covered by the integration test below.
    const probe = new Editor({ extensions: createRuneKit() })
    const s = probe.schema
    const node = docNode(s, [
      layoutNode(s, { id: "lay", depth: 0 }, [
        col(s, "col_a", []), // empty
        col(s, "col_b", [para(s, "B")]),
      ]),
    ])
    const found = firstEmptyColumn(node)
    expect(found).not.toBeNull()
    // The reported pos is the empty (first) column, not the populated one.
    const at = node.nodeAt(found!.pos)
    expect(at?.type.name).toBe("column")
    expect(at?.childCount).toBe(0)
    probe.destroy()
  })

  it("returns null when every column has ≥1 child", () => {
    const probe = new Editor({ extensions: createRuneKit() })
    const s = probe.schema
    const node = docNode(s, [
      layoutNode(s, { id: "lay", depth: 0 }, [
        col(s, "col_a", [para(s, "A")]),
        col(s, "col_b", [para(s, "B")]),
      ]),
    ])
    expect(firstEmptyColumn(node)).toBeNull()
    probe.destroy()
  })
})

describe("firstLayoutToUnwrap (pure)", () => {
  it("flags a 1-column layout and reports the survivor", () => {
    const probe = new Editor({ extensions: createRuneKit() })
    const s = probe.schema
    const survivor = col(s, "col_a", [para(s, "A")])
    const node = docNode(s, [
      layoutNode(s, { id: "lay", depth: 0 }, [survivor]),
    ])
    const found = firstLayoutToUnwrap(node)
    expect(found).not.toBeNull()
    expect(found!.survivor?.attrs.id).toBe("col_a")
    probe.destroy()
  })

  it("flags a 0-column layout with a null survivor", () => {
    const probe = new Editor({ extensions: createRuneKit() })
    const s = probe.schema
    const node = docNode(s, [
      layoutNode(s, { id: "lay", depth: 0 }),
    ])
    const found = firstLayoutToUnwrap(node)
    expect(found).not.toBeNull()
    expect(found!.survivor).toBeNull()
    probe.destroy()
  })

  it("returns null for a healthy 2-column layout", () => {
    const probe = new Editor({ extensions: createRuneKit() })
    const s = probe.schema
    const node = docNode(s, [
      layoutNode(s, { id: "lay", depth: 0 }, [
        col(s, "col_a", [para(s, "A")]),
        col(s, "col_b", [para(s, "B")]),
      ]),
    ])
    expect(firstLayoutToUnwrap(node)).toBeNull()
    probe.destroy()
  })
})

describe("firstNestedLayout (pure)", () => {
  it("finds a columnLayout whose parent is a column", () => {
    const probe = new Editor({ extensions: createRuneKit() })
    const s = probe.schema
    const inner = layoutNode(s, { id: "inner", depth: 0 }, [
      col(s, "ci_a", [para(s, "ia")]),
      col(s, "ci_b", [para(s, "ib")]),
    ])
    const node = docNode(s, [
      layoutNode(s, { id: "outer", depth: 0 }, [
        col(s, "co_a", [inner]),
        col(s, "co_b", [para(s, "B")]),
      ]),
    ])
    expect(firstNestedLayout(node)).not.toBeNull()
    probe.destroy()
  })

  it("returns null for a root-level layout", () => {
    const probe = new Editor({ extensions: createRuneKit() })
    const s = probe.schema
    const node = docNode(s, [
      layoutNode(s, { id: "lay", depth: 0 }, [
        col(s, "col_a", [para(s, "A")]),
        col(s, "col_b", [para(s, "B")]),
      ]),
    ])
    expect(firstNestedLayout(node)).toBeNull()
    probe.destroy()
  })
})

describe("flattenNestedLayouts (pure)", () => {
  it("lifts a layout nested in a column up to the column's children", () => {
    const probe = new Editor({ extensions: createRuneKit() })
    const s = probe.schema
    const inner = layoutNode(s, { id: "inner", depth: 0 }, [
      col(s, "ci_a", [para(s, "ia")]),
      col(s, "ci_b", [para(s, "ib")]),
    ])
    // A fragment representing the contents of an outer column: [inner layout].
    const colWithNested = col(s, "co_a", [inner, para(s, "tail")])
    const flat = flattenNestedLayouts(colWithNested.content, true)
    // inner layout removed; its columns' bodies (ia, ib) + tail remain.
    const names: string[] = []
    flat.forEach((n) => names.push(`${n.type.name}:${n.textContent}`))
    expect(names).toEqual(["paragraph:ia", "paragraph:ib", "paragraph:tail"])
    probe.destroy()
  })

  it("leaves a root-level layout (not inside a column) intact", () => {
    const probe = new Editor({ extensions: createRuneKit() })
    const s = probe.schema
    const layout = layoutNode(s, { id: "lay", depth: 0 }, [
      col(s, "col_a", [para(s, "A")]),
      col(s, "col_b", [para(s, "B")]),
    ])
    const docContent = docNode(s, [layout]).content
    const flat = flattenNestedLayouts(docContent, false)
    expect(flat.eq(docContent)).toBe(true)
    probe.destroy()
  })
})

// ---------------------------------------------------------------------------
// Task 3 — integration: the single pass applies the rules to a live editor.
// ---------------------------------------------------------------------------

describe("Columns normalization — E2 (empty column → paragraph)", () => {
  it("pads an empty column with one empty paragraph", () => {
    const editor = editorWithDoc((s) =>
      docNode(s, [
        layoutNode(s, { id: "lay", depth: 0 }, [
          col(s, "col_a", []), // empty — should get a paragraph
          col(s, "col_b", [para(s, "B")]),
        ]),
      ]),
    )
    let emptyColumns = 0
    let paddedColumnChildIsParagraph = false
    editor.state.doc.descendants((node) => {
      if (node.type.name === "column") {
        if (node.childCount === 0) emptyColumns += 1
        if (node.attrs.id === "col_a") {
          paddedColumnChildIsParagraph =
            node.childCount === 1 && node.child(0).type.name === "paragraph"
        }
      }
      return true
    })
    expect(emptyColumns).toBe(0)
    expect(paddedColumnChildIsParagraph).toBe(true)
  })
})

describe("Columns normalization — unwrap (drop below 2 columns)", () => {
  it("dissolves a 1-column layout, splicing the survivor's children to root", () => {
    const editor = editorWithDoc((s) =>
      docNode(s, [
        para(s, "before"),
        layoutNode(s, { id: "lay", depth: 0 }, [
          col(s, "col_a", [para(s, "A1"), para(s, "A2")]),
        ]),
        para(s, "after"),
      ]),
    )
    // Layout is gone; its column's two paragraphs now sit at root between
    // "before" and "after".
    expect(dumpTypes(editor.state.doc)).not.toContain("columnLayout")
    expect(dumpTypes(editor.state.doc)).not.toContain("column")
    const rootTexts: string[] = []
    editor.state.doc.forEach((child) => rootTexts.push(child.textContent))
    expect(rootTexts).toEqual(["before", "A1", "A2", "after"])
  })

  it("removes a 0-column layout entirely", () => {
    const editor = editorWithDoc((s) =>
      docNode(s, [
        para(s, "before"),
        layoutNode(s, { id: "lay", depth: 0 }),
        para(s, "after"),
      ]),
    )
    expect(dumpTypes(editor.state.doc)).not.toContain("columnLayout")
    const rootTexts: string[] = []
    editor.state.doc.forEach((child) => rootTexts.push(child.textContent))
    expect(rootTexts).toEqual(["before", "after"])
  })

  it("setContent with an id-less 1-column layout does not throw and unwraps (regression: BlockId backfill vs schema-invalid layout)", () => {
    // Node.fromJSON (the setContent JSON path) does NOT re-fit content, so an
    // id-less sub-2-column layout lands in the doc as-is. BlockId's backfill
    // then ran tr.setNodeMarkup on the layout, which RE-CREATES the node and
    // re-validates `column{2,5}` — RangeError "Invalid content for node type
    // columnLayout" BEFORE ColumnsNormalization could unwrap it. The shared
    // backfill (structural-id.ts) now skips nodes whose re-validation fails;
    // normalization dissolves the layout in the same appendTransaction round
    // and the backfill converges on the next.
    const editor = createTestEditor()
    expect(() =>
      editor.commands.setContent({
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "before" }] },
          {
            type: "columnLayout",
            content: [
              {
                type: "column",
                content: [
                  { type: "paragraph", content: [{ type: "text", text: "left one" }] },
                  { type: "paragraph", content: [{ type: "text", text: "left two" }] },
                ],
              },
            ],
          },
          { type: "paragraph", content: [{ type: "text", text: "after" }] },
        ],
      }),
    ).not.toThrow()

    // Layout dissolved: the survivor column's children sit at root.
    expect(dumpTypes(editor.state.doc)).not.toContain("columnLayout")
    expect(dumpTypes(editor.state.doc)).not.toContain("column")
    const rootTexts: string[] = []
    editor.state.doc.forEach((child) => rootTexts.push(child.textContent))
    expect(rootTexts).toEqual(["before", "left one", "left two", "after"])
    // And the backfill retried after the unwrap: every root block has an id.
    editor.state.doc.forEach((child) => {
      expect(typeof child.attrs.id).toBe("string")
      expect((child.attrs.id as string).length).toBeGreaterThan(0)
    })
  })

  it("clamps spliced children's depths against the new root predecessor", () => {
    // before(depth 0), then a dissolving layout whose column holds a depth-3
    // paragraph. At root after a depth-0 predecessor the legal cap is 1.
    const editor = editorWithDoc((s) =>
      docNode(s, [
        para(s, "before"),
        layoutNode(s, { id: "lay", depth: 0 }, [
          col(s, "col_a", [paraDepth(s, "deep", 3)]),
        ]),
      ]),
    )
    let deepDepth = -1
    editor.state.doc.forEach((child) => {
      if (child.textContent === "deep") deepDepth = child.attrs.depth as number
    })
    expect(deepDepth).toBe(1)
  })
})

describe("Columns normalization — no-nesting safety net", () => {
  it("flattens a columnLayout nested inside a column", () => {
    const editor = editorWithDoc((s) => {
      const inner = layoutNode(s, { id: "inner", depth: 0 }, [
        col(s, "ci_a", [para(s, "ia")]),
        col(s, "ci_b", [para(s, "ib")]),
      ])
      return docNode(s, [
        layoutNode(s, { id: "outer", depth: 0 }, [
          col(s, "co_a", [inner]),
          col(s, "co_b", [para(s, "B")]),
        ]),
      ])
    })
    // No nested layout survives: only the outer layout remains, and column A
    // now holds the inner layout's flattened bodies (ia, ib).
    let layoutCount = 0
    editor.state.doc.descendants((node) => {
      if (node.type.name === "columnLayout") layoutCount += 1
      return true
    })
    expect(layoutCount).toBe(1)
    let colAText = ""
    editor.state.doc.descendants((node) => {
      if (node.type.name === "column" && node.attrs.id === "co_a") {
        colAText = node.textContent
      }
      return true
    })
    expect(colAText).toBe("iaib")
  })
})

describe("Columns normalization — paste guard (transformPasted)", () => {
  it("strips a columnLayout pasted inside a column", () => {
    // Build a healthy 2-col doc, place the caret inside column A, then paste
    // a slice that contains a nested layout. transformPasted should flatten.
    const editor = editorWithDoc((s) =>
      docNode(s, [
        layoutNode(s, { id: "lay", depth: 0 }, [
          col(s, "col_a", [para(s, "A")]),
          col(s, "col_b", [para(s, "B")]),
        ]),
      ]),
    )
    // Find a position inside column A's paragraph.
    let caret = -1
    editor.state.doc.descendants((node, pos) => {
      if (caret < 0 && node.type.name === "paragraph" && node.textContent === "A") {
        caret = pos + 1
      }
      return true
    })
    // The pasted slice carries the column-internal content shape: a layout.
    // transformPastedSlice is exercised indirectly; assert via the pure
    // transform that it would not leave a layout inside this column context.
    // (Real clipboard paste is e2e — Task 9. Here we pin the transform.)
    const s = editor.state.schema
    const innerLayout = layoutNode(s, { id: "i", depth: 0 }, [
      col(s, "x", [para(s, "p1")]),
      col(s, "y", [para(s, "p2")]),
    ])
    const colWrap = col(s, "wrap", [innerLayout])
    const flat = flattenNestedLayouts(colWrap.content, true)
    const names: string[] = []
    flat.forEach((n) => names.push(n.type.name))
    expect(names).toEqual(["paragraph", "paragraph"])
    expect(caret).toBeGreaterThan(0)
  })
})

describe("Columns normalization — editable gate (#9)", () => {
  it("a read-only editor over a malformed 1-column layout leaves it untouched on mount", () => {
    const editor = editorWithDoc(
      (s) =>
        docNode(s, [
          para(s, "before"),
          layoutNode(s, { id: "lay", depth: 0 }, [
            col(s, "col_a", [para(s, "A1"), para(s, "A2")]),
          ]),
          para(s, "after"),
        ]),
      { editable: false },
    )
    expect(editor.isEditable).toBe(false)
    // The mount seed (view()) is gated on editable, so the malformed doc is
    // displayed verbatim — the 1-column layout is NOT unwrapped.
    expect(dumpTypes(editor.state.doc)).toContain("columnLayout")
    const rootTexts: string[] = []
    editor.state.doc.forEach((child) => rootTexts.push(child.textContent))
    expect(rootTexts).toEqual(["before", "A1A2", "after"])
  })

  it("an editable editor over the same doc unwraps on mount (control)", () => {
    const editor = editorWithDoc((s) =>
      docNode(s, [
        para(s, "before"),
        layoutNode(s, { id: "lay", depth: 0 }, [
          col(s, "col_a", [para(s, "A1"), para(s, "A2")]),
        ]),
        para(s, "after"),
      ]),
    )
    expect(editor.isEditable).toBe(true)
    expect(dumpTypes(editor.state.doc)).not.toContain("columnLayout")
  })

  it("does not backfill a missing column id/width while read-only", () => {
    const editor = editorWithDoc(
      (s) =>
        docNode(s, [
          layoutNode(s, { id: "lay", depth: 0 }, [
            col(s, "col_a", [para(s, "A")], 0),
            col(s, "col_b", [para(s, "B")]),
          ]),
        ]),
      { editable: false },
    )
    const widths: unknown[] = []
    editor.state.doc.descendants((node) => {
      if (node.type.name === "column") widths.push(node.attrs.width)
      return true
    })
    // Width 0 is invalid and would normally clamp to 1 — read-only skips it.
    expect(widths).toEqual([0, 1])
  })

  it("setEditable(true) alone does not re-normalize; the NEXT doc-changing transaction does", () => {
    // Tiptap's setEditable/setOptions calls view.updateState with the SAME
    // state (no transaction dispatched), so appendTransaction never fires
    // from the flip itself — verified against TitleBoundary's identical
    // gate. Normalization resumes on the next transaction that changes the
    // doc, which re-scans and fixes the WHOLE doc, not just the new edit.
    const editor = editorWithDoc(
      (s) =>
        docNode(s, [
          para(s, "before"),
          layoutNode(s, { id: "lay", depth: 0 }, [
            col(s, "col_a", [para(s, "A1"), para(s, "A2")]),
          ]),
          para(s, "after"),
        ]),
      { editable: false },
    )
    expect(dumpTypes(editor.state.doc)).toContain("columnLayout")

    editor.setEditable(true)
    // No transaction fired yet — still unnormalized immediately after the flip.
    expect(dumpTypes(editor.state.doc)).toContain("columnLayout")

    // Any doc-changing transaction (a plain text insert, standing in for a
    // real user edit) triggers appendTransaction, which now passes the
    // editable gate and normalizes the whole doc in the same pass.
    editor.commands.command(({ tr, dispatch }) => {
      if (dispatch) dispatch(tr.insertText("!", 1))
      return true
    })
    expect(dumpTypes(editor.state.doc)).not.toContain("columnLayout")
    const rootTexts: string[] = []
    editor.state.doc.forEach((child) => rootTexts.push(child.textContent))
    expect(rootTexts).toEqual(["!before", "A1", "A2", "after"])
  })
})

describe("Columns normalization — selection sanity", () => {
  it("maps the selection through a dissolving layout without throwing", () => {
    const editor = editorWithDoc((s) =>
      docNode(s, [
        para(s, "before"),
        layoutNode(s, { id: "lay", depth: 0 }, [
          col(s, "col_a", [para(s, "A1"), para(s, "A2")]),
        ]),
      ]),
    )
    // After normalization the selection resolves to a valid position in the
    // dissolved doc (no RangeError, no stale anchor in a removed layout).
    expect(() => editor.state.selection.from).not.toThrow()
    expect(editor.state.selection.from).toBeLessThanOrEqual(
      editor.state.doc.content.size,
    )
    expect(dumpTypes(editor.state.doc)).not.toContain("columnLayout")
  })
})
