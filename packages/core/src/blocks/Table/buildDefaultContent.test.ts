// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, it, expect, vi } from "vitest"
import { Editor } from "@tiptap/core"
import Document from "@tiptap/extension-document"
import Text from "@tiptap/extension-text"
import { Paragraph } from "../Paragraph/block"
import { Table } from "./block"
import {
  buildDefaultTableContent,
  buildTableContentFromRows,
  computeFitColWidth,
  parseFlatTableText,
  tableColCount,
  tableInputCarriesText,
  tableInputRecoversText,
} from "./buildDefaultContent"
import { createNodeFromBlockInput } from "../../api/commands/insertBlocks"

function makeEditor() {
  return new Editor({
    element: document.createElement("div"),
    extensions: [Document, Text, Paragraph, Table],
  })
}

describe("buildDefaultTableContent", () => {
  it("creates a header row by default", () => {
    const editor = makeEditor()
    const fragment = buildDefaultTableContent(editor.schema, 2, 3)
    const table = editor.schema.nodes.table!.create(null, fragment)
    expect(table.childCount).toBe(2)
    table.forEach((row, _, rowIndex) => {
      expect(row.childCount).toBe(3)
      row.forEach((cell) => {
        expect(cell.type.name).toBe(rowIndex === 0 ? "tableHeader" : "tableCell")
        expect(cell.firstChild?.type.name).toBe("tableParagraph")
      })
    })
    editor.destroy()
  })

  it("creates body-only tables when header row is disabled", () => {
    const editor = makeEditor()
    const fragment = buildDefaultTableContent(editor.schema, 4, 2, { withHeaderRow: false })
    const table = editor.schema.nodes.table!.create(null, fragment)
    expect(table.childCount).toBe(4)
    table.forEach((row) => {
      expect(row.childCount).toBe(2)
      row.forEach((cell) => {
        expect(cell.type.name).toBe("tableCell")
        expect(cell.firstChild?.type.name).toBe("tableParagraph")
      })
    })
    editor.destroy()
  })

  it("honors a caller-supplied colWidth on every cell", () => {
    const editor = makeEditor()
    const fragment = buildDefaultTableContent(editor.schema, 2, 3, { colWidth: 52 })
    const table = editor.schema.nodes.table!.create(null, fragment)
    table.forEach((row) => {
      row.forEach((cell) => {
        expect(cell.attrs.colwidth).toEqual([52])
      })
    })
    editor.destroy()
  })

  it("clamps colWidth to the cell min when caller passes a too-small value", () => {
    const editor = makeEditor()
    const fragment = buildDefaultTableContent(editor.schema, 1, 2, { colWidth: 10 })
    const table = editor.schema.nodes.table!.create(null, fragment)
    table.firstChild!.forEach((cell) => {
      expect(cell.attrs.colwidth).toEqual([35])
    })
    editor.destroy()
  })

  it("falls back to the legacy 235 default when colWidth is omitted or zero", () => {
    const editor = makeEditor()
    const omitted = buildDefaultTableContent(editor.schema, 1, 2)
    const zero = buildDefaultTableContent(editor.schema, 1, 2, { colWidth: 0 })
    for (const fragment of [omitted, zero]) {
      const table = editor.schema.nodes.table!.create(null, fragment)
      table.firstChild!.forEach((cell) => {
        expect(cell.attrs.colwidth).toEqual([235])
      })
    }
    editor.destroy()
  })

  it("falls back to 1x1 for non-finite dimensions", () => {
    const editor = makeEditor()
    const fragment = buildDefaultTableContent(editor.schema, Number.NaN, Number.POSITIVE_INFINITY)
    const table = editor.schema.nodes.table!.create(null, fragment)
    expect(table.childCount).toBe(1)
    expect(table.firstChild?.childCount).toBe(1)
    expect(table.firstChild?.firstChild?.type.name).toBe("tableHeader")
    expect(table.firstChild?.firstChild?.firstChild?.type.name).toBe("tableParagraph")
    editor.destroy()
  })
})

describe("buildTableContentFromRows", () => {
  it("fills cell text and marks the header row with tableHeader cells", () => {
    const editor = makeEditor()
    const fragment = buildTableContentFromRows(editor.schema, [
      { cells: [{ text: "Feature" }, { text: "A" }], isHeader: true },
      { cells: [{ text: "Cost" }, { text: "low" }], isHeader: false },
    ])
    const table = editor.schema.nodes.table!.create(null, fragment)
    expect(table.childCount).toBe(2)
    const header = table.child(0)
    header.forEach((cell) => expect(cell.type.name).toBe("tableHeader"))
    expect(header.child(0).textContent).toBe("Feature")
    expect(header.child(1).textContent).toBe("A")
    const body = table.child(1)
    body.forEach((cell) => expect(cell.type.name).toBe("tableCell"))
    expect(body.child(0).textContent).toBe("Cost")
    expect(body.child(1).textContent).toBe("low")
    editor.destroy()
  })

  it("normalizes ragged rows to the widest row, padding with empty cells", () => {
    const editor = makeEditor()
    const fragment = buildTableContentFromRows(editor.schema, [
      { cells: [{ text: "a" }, { text: "b" }, { text: "c" }], isHeader: true },
      { cells: [{ text: "x" }], isHeader: false },
    ])
    const table = editor.schema.nodes.table!.create(null, fragment)
    expect(table.child(1).childCount).toBe(3)
    expect(table.child(1).child(0).textContent).toBe("x")
    expect(table.child(1).child(1).textContent).toBe("")
    expect(table.child(1).child(2).textContent).toBe("")
    editor.destroy()
  })

  it("degrades a row with missing/non-array cells (and a null row) to an empty row, never throws", () => {
    const editor = makeEditor()
    const fragment = buildTableContentFromRows(editor.schema, [
      { cells: [{ text: "a" }, { text: "b" }], isHeader: true },
      { isHeader: false } as unknown as { cells: { text: string }[]; isHeader: boolean }, // no `cells`
      null as unknown as { cells: { text: string }[]; isHeader: boolean }, // null row
    ])
    const table = editor.schema.nodes.table!.create(null, fragment)
    expect(table.childCount).toBe(3)
    // Every row is rectangle-normalized to the widest (2) and degraded rows are
    // all-empty — no crash on the missing `cells` / null row.
    expect(table.child(1).childCount).toBe(2)
    expect(table.child(1).child(0).textContent).toBe("")
    expect(table.child(2).childCount).toBe(2)
    expect(table.child(2).child(1).textContent).toBe("")
    editor.destroy()
  })

  it("recovers bare-string cells, array-of-arrays rows, and a `content` cell key", () => {
    const editor = makeEditor()
    const fragment = buildTableContentFromRows(editor.schema, [
      { cells: ["a", "b"], isHeader: true }, // bare strings
      ["c", "d"], // row IS the cell array
      { cells: [{ content: "e" }, { content: "f" }], isHeader: false }, // `content` key
    ] as unknown as Parameters<typeof buildTableContentFromRows>[1])
    const table = editor.schema.nodes.table!.create(null, fragment)
    expect(table.child(0).child(0).textContent).toBe("a")
    expect(table.child(0).child(1).textContent).toBe("b")
    expect(table.child(1).child(0).textContent).toBe("c")
    expect(table.child(1).child(1).textContent).toBe("d")
    expect(table.child(2).child(0).textContent).toBe("e")
    expect(table.child(2).child(1).textContent).toBe("f")
    editor.destroy()
  })

  it("coerces a non-string cell text (number/boolean) instead of building a corrupt TextNode", () => {
    const editor = makeEditor()
    const fragment = buildTableContentFromRows(editor.schema, [
      {
        cells: [{ text: 42 }, { text: true }, { text: null }] as unknown as {
          text: string
        }[],
        isHeader: false,
      },
    ])
    const row = editor.schema.nodes.table!.create(null, fragment).child(0)
    expect(row.child(0).textContent).toBe("42")
    expect(row.child(1).textContent).toBe("true")
    expect(row.child(2).textContent).toBe("")
    // The built nodes have valid sizes (a number text would yield nodeSize
    // `undefined` and corrupt position math).
    expect(Number.isFinite(row.child(0).nodeSize)).toBe(true)
    editor.destroy()
  })
})

describe("table fromInput", () => {
  it("builds a populated table from RuneTableRow[] input", () => {
    const editor = makeEditor()
    const node = createNodeFromBlockInput(editor, editor.schema, {
      type: "table",
      rows: [
        { cells: [{ text: "H1" }, { text: "H2" }], isHeader: true },
        { cells: [{ text: "v1" }, { text: "v2" }], isHeader: false },
      ],
    })
    expect(node).not.toBeNull()
    expect(node!.type.name).toBe("table")
    expect(node!.child(0).child(0).type.name).toBe("tableHeader")
    expect(node!.child(0).child(0).textContent).toBe("H1")
    expect(node!.child(1).child(1).textContent).toBe("v2")
    editor.destroy()
  })

  it("still treats numeric rows/cols as a blank-grid request (back-compat)", () => {
    const editor = makeEditor()
    const node = createNodeFromBlockInput(editor, editor.schema, {
      // dimensions sugar — number, not an array
      type: "table",
      rows: 2,
      cols: 3,
    } as unknown as Parameters<typeof createNodeFromBlockInput>[2])
    expect(node).not.toBeNull()
    expect(node!.childCount).toBe(2)
    expect(node!.child(0).childCount).toBe(3)
    expect(node!.child(0).child(0).textContent).toBe("")
    editor.destroy()
  })

  it("builds (does not throw) when a populated row is missing its cells", () => {
    const editor = makeEditor()
    let node: ReturnType<typeof createNodeFromBlockInput> = null
    expect(() => {
      node = createNodeFromBlockInput(editor, editor.schema, {
        type: "table",
        rows: [{ isHeader: true }],
      } as unknown as Parameters<typeof createNodeFromBlockInput>[2])
    }).not.toThrow()
    expect(node).not.toBeNull()
    expect(node!.type.name).toBe("table")
    editor.destroy()
  })
})

describe("flat-text + coercion helpers", () => {
  it("parseFlatTableText parses a pipe table and promotes a separated header", () => {
    const rows = parseFlatTableText("| Feature | Status |\n| --- | --- |\n| Search | Shipped |")
    expect(rows).not.toBeNull()
    expect(rows!.length).toBe(2)
    expect(rows![0]).toEqual({ cells: [{ text: "Feature" }, { text: "Status" }], isHeader: true })
    expect(rows![1]).toEqual({ cells: [{ text: "Search" }, { text: "Shipped" }], isHeader: false })
  })

  it("parseFlatTableText returns null for text without a pipe (prose, not a grid)", () => {
    expect(parseFlatTableText("just some prose")).toBeNull()
    expect(parseFlatTableText("")).toBeNull()
  })

  it("tableColCount uses the widest row across shapes", () => {
    expect(tableColCount([{ cells: ["a", "b", "c"] }, ["x"]])).toBe(3)
    expect(tableColCount([{ isHeader: true }])).toBe(1) // no cells → floor of 1
  })

  it("tableInputRecoversText / tableInputCarriesText distinguish dropped from empty", () => {
    // content present AND mappable → recovers
    expect(tableInputRecoversText([{ cells: [{ text: "a" }] }])).toBe(true)
    // content present but under an unmappable key → carries but does NOT recover
    expect(tableInputRecoversText([{ label: "a" }])).toBe(false)
    expect(tableInputCarriesText([{ label: "a" }])).toBe(true)
    // genuinely empty (only structure) → neither
    expect(tableInputRecoversText([{ cells: [{ text: "" }], isHeader: true }])).toBe(false)
    expect(tableInputCarriesText([{ cells: [{ text: "" }], isHeader: true }])).toBe(false)
  })
})

describe("computeFitColWidth", () => {
  function fakeEditorWith(opts: {
    proseMirrorWidth: number
    blockContentWidth?: number
  }): Editor {
    // Minimal Editor-shaped stub mirroring the surface this helper reads.
    // It prefers a measurable `.rune-block-content` (the layout context
    // a new table actually lives in) and only falls back to the
    // `.ProseMirror` clientWidth when no block-content has rendered.
    const dom: Partial<HTMLElement> = {
      clientWidth: opts.proseMirrorWidth,
      querySelector: (selector: string) => {
        if (selector !== ".rune-block-content") return null
        if (opts.blockContentWidth == null) return null
        return { clientWidth: opts.blockContentWidth } as HTMLElement
      },
    }
    return { view: { dom } } as unknown as Editor
  }

  it("divides the editor block-content among the requested cols", () => {
    // Block-content width on a narrow window: 152 (= 156 ProseMirror − 4
    // block-padding). With 3 cols and floor division: 50 per col.
    // (The old measurement read ProseMirror's 156 → 52 each → col sum
    //  156 ≠ 152 frame → MBS gap on the right edge.)
    expect(
      computeFitColWidth(fakeEditorWith({ proseMirrorWidth: 156, blockContentWidth: 152 }), 3),
    ).toBe(50)
    expect(
      computeFitColWidth(fakeEditorWith({ proseMirrorWidth: 708, blockContentWidth: 704 }), 3),
    ).toBe(234)
  })

  it("falls back to ProseMirror clientWidth when no block-content has rendered", () => {
    // Empty-doc / pre-mount case. Use the broader measurement so the
    // table at least roughly fits; the residual error is bounded by
    // .rune-block's padding-inline (~4 px).
    expect(
      computeFitColWidth(fakeEditorWith({ proseMirrorWidth: 708 }), 3),
    ).toBe(236)
  })

  it("clamps to the 35px cell-min floor when the editor is very narrow", () => {
    expect(
      computeFitColWidth(fakeEditorWith({ proseMirrorWidth: 60, blockContentWidth: 56 }), 3),
    ).toBe(35)
  })

  it("returns undefined when no editor is supplied (SSR / pre-mount)", () => {
    expect(computeFitColWidth(undefined, 3)).toBeUndefined()
  })

  it("returns undefined when neither block-content nor ProseMirror has a measured width", () => {
    expect(
      computeFitColWidth(fakeEditorWith({ proseMirrorWidth: 0 }), 3),
    ).toBeUndefined()
  })

  it("returns undefined for non-positive col counts", () => {
    expect(
      computeFitColWidth(fakeEditorWith({ proseMirrorWidth: 400, blockContentWidth: 396 }), 0),
    ).toBeUndefined()
  })

  it("returns undefined for a real but never-mounted editor, instead of throwing", () => {
    // Regression: `element: null` (createHeadlessEditor's construction mode)
    // never assigns a real EditorView, so `editor.view` is tiptap's stub
    // Proxy — truthy, unlike a plain `undefined`, but it THROWS on any
    // property access outside a small whitelist (`dom` not among them: "The
    // editor view is not available. Cannot access view['dom']."). This used
    // to escape uncaught from insertTable's fit-to-width path the moment a
    // headless editor inserted a table.
    const editor = new Editor({
      element: null,
      extensions: [Document, Text, Paragraph, Table],
    })
    expect(() => computeFitColWidth(editor, 3)).not.toThrow()
    expect(computeFitColWidth(editor, 3)).toBeUndefined()
    editor.destroy()
  })
})

describe("insertTable command — fit-to-editor default width", () => {
  it("scales fresh-table cell colwidths to the editor's block-content width", () => {
    // End-to-end: mount an editor, stub block-content clientWidth to a
    // 152-px narrow case, run insertTable, and assert every cell's
    // colwidth lands at 50 (152/3) — i.e. the table's col-sum matches
    // the frame width, with no MBS overlap gap on the right.
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: [
        Document,
        Text,
        Paragraph,
        Table,
      ],
    })
    // jsdom returns 0 for clientWidth on every element; stub
    // `dom.querySelector` to return a synthetic block-content node
    // whose clientWidth we control. This is the same shape the helper
    // sees at runtime.
    const realQuery = editor.view.dom.querySelector.bind(editor.view.dom)
    vi.spyOn(editor.view.dom, "querySelector").mockImplementation((selector: string) => {
      if (selector === ".rune-block-content") {
        return { clientWidth: 152 } as unknown as HTMLElement
      }
      return realQuery(selector)
    })

    editor.commands.insertTable()

    let tableNode: import("@tiptap/pm/model").Node | null = null
    editor.state.doc.descendants((node) => {
      if (node.type.name === "table") {
        tableNode = node
        return false
      }
      return true
    })
    expect(tableNode).not.toBeNull()
    tableNode!.forEach((row) => {
      row.forEach((cell) => {
        expect(cell.attrs.colwidth).toEqual([50])
      })
    })
    editor.destroy()
  })
})
