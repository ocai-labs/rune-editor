// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Node built-ins for this source-boundary probe. @types/node isn't a
// devDependency of core (it stays runtime-agnostic — no Node-shaped APIs
// leak into the published types), and vitest resolves these at run time, so
// silence tsc here.
// @ts-expect-error -- node:fs has no types in this package
import { readFileSync } from "node:fs"
// @ts-expect-error -- node:url has no types in this package
import { fileURLToPath } from "node:url"
// @ts-expect-error -- node:path has no types in this package
import { dirname, resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { createTestEditor } from "../../test-utils/createTestEditor"
import { canTurnInto, resolveTurnIntoSources } from "./turnInto"
import type { TurnIntoBlockInput, TurnIntoTarget } from "../types"
import { mathControllerKey } from "../../inlines/InlineMath/controller"

function setupDoc() {
  const editor = createTestEditor()
  editor.commands.setContent([
    { type: "paragraph", attrs: { id: "p1" }, content: [{ type: "text", text: "A" }] },
    { type: "paragraph", attrs: { id: "p2" }, content: [{ type: "text", text: "B" }] },
    { type: "paragraph", attrs: { id: "p3" }, content: [{ type: "text", text: "C" }] },
  ])
  return editor
}

function nodeOf(editor: ReturnType<typeof setupDoc>, id: string) {
  for (let i = 0; i < editor.state.doc.childCount; i++) {
    const child = editor.state.doc.child(i)
    if (child.attrs.id === id) return child
  }
  throw new Error(`missing block ${id}`)
}

function tableInput(id: string) {
  return { type: "table" as const, id, rows: [] }
}

describe("resolveTurnIntoSources", () => {
  it("resolves a single id string to one source", () => {
    const editor = setupDoc()
    const sources = resolveTurnIntoSources(editor.state.doc, "p2")
    expect(sources).toHaveLength(1)
    expect(sources[0]!.node.attrs.id).toBe("p2")
  })

  it("resolves an array of ids in document order", () => {
    const editor = setupDoc()
    const sources = resolveTurnIntoSources(editor.state.doc, ["p3", "p1"])
    expect(sources.map((s) => s.node.attrs.id)).toEqual(["p1", "p3"])
  })

  it("resolves an inclusive range", () => {
    const editor = setupDoc()
    const sources = resolveTurnIntoSources(
      editor.state.doc,
      { from: "p1", to: "p3" } satisfies TurnIntoTarget,
    )
    expect(sources.map((s) => s.node.attrs.id)).toEqual(["p1", "p2", "p3"])
  })

  it("returns empty when an id is unknown", () => {
    const editor = setupDoc()
    expect(resolveTurnIntoSources(editor.state.doc, "missing")).toEqual([])
    expect(resolveTurnIntoSources(editor.state.doc, ["p1", "missing"])).toEqual([])
    expect(resolveTurnIntoSources(editor.state.doc, { from: "p1", to: "missing" })).toEqual([])
  })

  it("deduplicates and sorts arrays", () => {
    const editor = setupDoc()
    const sources = resolveTurnIntoSources(editor.state.doc, ["p2", "p2", "p1"])
    expect(sources.map((s) => s.node.attrs.id)).toEqual(["p1", "p2"])
  })
})

describe("canTurnInto", () => {
  it("accepts an inline* source to another inline* target", () => {
    const editor = setupDoc()
    const target: TurnIntoBlockInput = { type: "heading", props: { level: 2 } }
    expect(canTurnInto(nodeOf(editor, "p1"), target, editor.schema)).toBe(true)
  })

  it("accepts an inline* source to divider", () => {
    const editor = setupDoc()
    expect(canTurnInto(nodeOf(editor, "p1"), { type: "divider" }, editor.schema)).toBe(true)
  })

  it("accepts identical source and target", () => {
    const editor = setupDoc()
    expect(canTurnInto(nodeOf(editor, "p1"), { type: "paragraph" }, editor.schema)).toBe(true)
  })

  it("rejects table-as-source for any target", () => {
    const editor = createTestEditor()
    editor.commands.setContent([
      { type: "paragraph", attrs: { id: "before" }, content: [{ type: "text", text: "x" }] },
    ])
    editor.commands.insertBlocks(
      [tableInput("t1")],
      { at: { id: "before", side: "after" } },
    )
    const table = editor.state.doc.child(1)
    expect(canTurnInto(table, { type: "paragraph" }, editor.schema)).toBe(false)
    expect(canTurnInto(table, { type: "table" }, editor.schema)).toBe(false)
  })

  it("rejects unknown target types", () => {
    const editor = setupDoc()
    expect(canTurnInto(nodeOf(editor, "p1"), { type: "bogus" }, editor.schema)).toBe(false)
  })
})

describe("editor.commands.turnInto", () => {
  it("core turnInto command files do not import suggestion-menu implementation payloads", () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const files = ["index.ts", "turnInto.ts", "turnIntoAdapters.ts"]

    for (const file of files) {
      const source = readFileSync(resolve(here, file), "utf8")
      expect(source).not.toContain(
        "extensions/suggestion-menus/default-items/insertOrUpdateBlockForSlashMenu",
      )
      expect(source).not.toContain("BlockInsertPayload")
    }
  })

  it("converts a single paragraph to heading h2", () => {
    const editor = setupDoc()
    const ok = editor.commands.turnInto("p2", { type: "heading", props: { level: 2 } })
    expect(ok).toBe(true)
    const second = editor.state.doc.child(1)
    expect(second.type.name).toBe("heading")
    expect(second.attrs.level).toBe(2)
    expect(second.attrs.id).toBe("p2")
    expect(second.textContent).toBe("B")
  })

  it("accepts identical source and target as a no-op", () => {
    const editor = setupDoc()
    const before = editor.state.doc.toJSON()
    const ok = editor.commands.turnInto("p1", { type: "paragraph" })
    expect(ok).toBe(true)
    expect(editor.state.doc.toJSON()).toEqual(before)
  })

  it("returns false when every source is rejected", () => {
    const editor = createTestEditor()
    editor.commands.setContent([
      { type: "paragraph", attrs: { id: "before" }, content: [{ type: "text", text: "x" }] },
    ])
    editor.commands.insertBlocks(
      [tableInput("t1")],
      { at: { id: "before", side: "after" } },
    )
    const ok = editor.commands.turnInto("t1", { type: "paragraph" })
    expect(ok).toBe(false)
  })

  it("skips rejected table sources inside a multi-block range", () => {
    const editor = createTestEditor()
    editor.commands.setContent([
      { type: "paragraph", attrs: { id: "p1" }, content: [{ type: "text", text: "A" }] },
      { type: "paragraph", attrs: { id: "p3" }, content: [{ type: "text", text: "C" }] },
    ])
    editor.commands.insertBlocks(
      [tableInput("t1")],
      { at: { id: "p1", side: "after" } },
    )
    const ok = editor.commands.turnInto(
      { from: "p1", to: "p3" },
      { type: "heading", props: { level: 2 } },
    )
    expect(ok).toBe(true)
    expect(editor.state.doc.child(0).type.name).toBe("heading")
    expect(editor.state.doc.child(1).type.name).toBe("table")
    expect(editor.state.doc.child(2).type.name).toBe("heading")
  })

  it("preserves depth by default", () => {
    const editor = createTestEditor()
    editor.commands.setContent([
      { type: "bulletList", attrs: { id: "li", depth: 2 }, content: [{ type: "text", text: "item" }] },
    ])
    editor.commands.turnInto("li", { type: "paragraph" })
    expect(editor.state.doc.firstChild!.attrs.depth).toBe(2)
  })

  it("clears depth when keepDepth is false", () => {
    const editor = createTestEditor()
    editor.commands.setContent([
      { type: "bulletList", attrs: { id: "li", depth: 2 }, content: [{ type: "text", text: "item" }] },
    ])
    editor.commands.turnInto("li", { type: "paragraph" }, { keepDepth: false })
    expect(editor.state.doc.firstChild!.attrs.depth).toBe(0)
  })

  it("preserves toggle body depth when only the toggle title is converted", () => {
    const editor = createTestEditor()
    editor.commands.setContent([
      { type: "toggle", attrs: { id: "toggle1", depth: 0, level: 0, expanded: true }, content: [{ type: "text", text: "Toggle title" }] },
      { type: "paragraph", attrs: { id: "body1", depth: 1 }, content: [{ type: "text", text: "Body one" }] },
      { type: "bulletList", attrs: { id: "body2", depth: 2 }, content: [{ type: "text", text: "Body two" }] },
      { type: "paragraph", attrs: { id: "after", depth: 0 }, content: [{ type: "text", text: "After" }] },
    ])

    editor.commands.turnInto("toggle1", { type: "paragraph" })

    expect(editor.state.doc.child(0).type.name).toBe("paragraph")
    expect(editor.state.doc.child(0).attrs.depth).toBe(0)
    expect(editor.state.doc.child(1).type.name).toBe("paragraph")
    expect(editor.state.doc.child(1).attrs.depth).toBe(1)
    expect(editor.state.doc.child(2).type.name).toBe("bulletList")
    expect(editor.state.doc.child(2).attrs.depth).toBe(2)
    expect(editor.state.doc.child(3).attrs.depth).toBe(0)
  })

  it("turnInto to equationBlock dispatches mathControllerKey open meta", () => {
    const editor = createTestEditor()
    editor.commands.setContent([
      { type: "paragraph", attrs: { id: "p1" }, content: [{ type: "text", text: "hello" }] },
    ])

    editor.commands.turnInto("p1", { type: "equationBlock", props: { latex: "" } })

    const intent = mathControllerKey.getState(editor.state)?.openTarget
    expect(intent).not.toBeNull()
    // intent should match the pos of the (now) equationBlock node
    expect(editor.state.doc.nodeAt(intent!)?.type.name).toBe("equationBlock")
  })

  it("turnInto to equationBlock carries inlineMath latex from the source", () => {
    const editor = createTestEditor()
    editor.commands.setContent([
      {
        type: "paragraph",
        attrs: { id: "p1" },
        content: [{ type: "inlineMath", attrs: { latex: "x^2" } }],
      },
    ])

    editor.commands.turnInto("p1", { type: "equationBlock" })

    const block = editor.state.doc.firstChild!
    expect(block.type.name).toBe("equationBlock")
    expect(block.attrs.latex).toBe("x^2")
  })

  it("turnInto to equationBlock carries plain text as latex when no inline math present", () => {
    const editor = createTestEditor()
    editor.commands.setContent([
      { type: "paragraph", attrs: { id: "p1" }, content: [{ type: "text", text: "\\frac{1}{2}" }] },
    ])

    editor.commands.turnInto("p1", { type: "equationBlock" })

    const block = editor.state.doc.firstChild!
    expect(block.type.name).toBe("equationBlock")
    expect(block.attrs.latex).toBe("\\frac{1}{2}")
  })

  it("converts an atom source to a different atom target instead of throwing (image -> divider)", () => {
    // Regression: turnIntoAdapters had no "atom->atom" adapter registered,
    // so canTurnInto (which only rejects container sources) let an atom
    // source through and getAdapter threw uncaught.
    const editor = createTestEditor()
    editor.commands.setContent([
      { type: "image", attrs: { id: "img1", src: "https://example.com/x.png" } },
    ])
    let ok = false
    expect(() => {
      ok = editor.commands.turnInto("img1", { type: "divider" })
    }).not.toThrow()
    expect(ok).toBe(true)
    const block = editor.state.doc.firstChild!
    expect(block.type.name).toBe("divider")
    expect(block.attrs.id).toBe("img1")
  })

  it("turnInto to equationBlock honors explicit latex in target.props over source extraction", () => {
    const editor = createTestEditor()
    editor.commands.setContent([
      { type: "paragraph", attrs: { id: "p1" }, content: [{ type: "text", text: "ignored" }] },
    ])

    editor.commands.turnInto("p1", { type: "equationBlock", props: { latex: "y" } })

    const block = editor.state.doc.firstChild!
    expect(block.attrs.latex).toBe("y")
  })
})
