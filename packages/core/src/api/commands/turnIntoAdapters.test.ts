// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, expect, it } from "vitest"
import { Schema } from "@tiptap/pm/model"
import { createTestEditor } from "../../test-utils/createTestEditor"
import { classifyKind, getAdapter } from "./turnIntoAdapters"

describe("classifyKind", () => {
  it("classifies built-in node kinds", () => {
    const editor = createTestEditor()
    const types = editor.schema.nodes
    expect(classifyKind(types.paragraph!)).toBe("inline")
    expect(classifyKind(types.heading!)).toBe("inline")
    expect(classifyKind(types.bulletList!)).toBe("inline")
    expect(classifyKind(types.codeBlock!)).toBe("text")
    expect(classifyKind(types.divider!)).toBe("atom")
    expect(classifyKind(types.table!)).toBe("container")
  })
})

describe("same-type adapter", () => {
  it("flags attrsOnly so the orchestrator can skip replacement", () => {
    const editor = createTestEditor()
    editor.commands.setContent([
      { type: "paragraph", attrs: { id: "p1" }, content: [{ type: "text", text: "hi" }] },
    ])
    const source = editor.state.doc.firstChild!
    const adapter = getAdapter("inline", "inline", "paragraph", "paragraph")
    const result = adapter(editor, source, { type: "paragraph" }, editor.schema)
    expect(result!.attrsOnly).toBe(true)
    expect(result!.node.type.name).toBe("paragraph")
    expect(result!.node.textContent).toBe("hi")
  })

  it("merges target props onto source attrs", () => {
    const editor = createTestEditor()
    editor.commands.setContent([
      { type: "heading", attrs: { id: "h1", level: 2 }, content: [{ type: "text", text: "hi" }] },
    ])
    const source = editor.state.doc.firstChild!
    const adapter = getAdapter("inline", "inline", "heading", "heading")
    const result = adapter(
      editor,
      source,
      { type: "heading", props: { level: 3 } },
      editor.schema,
    )
    expect(result!.attrsOnly).toBe(true)
    expect(result!.node.attrs.level).toBe(3)
    expect(result!.node.textContent).toBe("hi")
  })
})

describe("inline to inline cross-type adapter", () => {
  it("paragraph to heading carries content and target attrs", () => {
    const editor = createTestEditor()
    editor.commands.setContent([
      { type: "paragraph", attrs: { id: "p1" }, content: [{ type: "text", text: "title" }] },
    ])
    const adapter = getAdapter("inline", "inline", "paragraph", "heading")
    const result = adapter(
      editor,
      editor.state.doc.firstChild!,
      { type: "heading", props: { level: 2 } },
      editor.schema,
    )
    expect(result!.node.type.name).toBe("heading")
    expect(result!.node.attrs.level).toBe(2)
    expect(result!.node.attrs.id).toBe("p1")
    expect(result!.node.textContent).toBe("title")
  })
})

describe("inline to text adapter", () => {
  it("paragraph to codeBlock drops marks and leaves language unset", () => {
    const editor = createTestEditor()
    editor.commands.setContent([
      {
        type: "paragraph",
        attrs: { id: "p1" },
        content: [
          { type: "text", marks: [{ type: "bold" }], text: "foo " },
          { type: "text", text: "bar" },
        ],
      },
    ])
    const adapter = getAdapter("inline", "text", "paragraph", "codeBlock")
    const result = adapter(
      editor,
      editor.state.doc.firstChild!,
      { type: "codeBlock" },
      editor.schema,
    )
    expect(result!.node.type.name).toBe("codeBlock")
    expect(result!.node.textContent).toBe("foo bar")
    result!.node.descendants((child) => {
      expect(child.marks.length).toBe(0)
    })
    expect(result!.node.attrs.language ?? null).toBe(null)
  })

  it("flattens hardBreak to a newline for code targets (AR-1)", () => {
    const editor = createTestEditor()
    editor.commands.setContent([
      {
        type: "paragraph",
        attrs: { id: "p1" },
        content: [
          { type: "text", text: "line one" },
          { type: "hardBreak" },
          { type: "text", text: "line two" },
        ],
      },
    ])
    const adapter = getAdapter("inline", "text", "paragraph", "codeBlock")
    const result = adapter(
      editor,
      editor.state.doc.firstChild!,
      { type: "codeBlock" },
      editor.schema,
    )
    expect(result).not.toBeNull()
    expect(result!.node.type.name).toBe("codeBlock")
    expect(result!.node.textContent).toBe("line one\nline two")
    expect(() => result!.node.check()).not.toThrow()
  })

  it("flattens inlineMath to its latex for code targets (AR-1)", () => {
    const editor = createTestEditor()
    editor.commands.setContent([
      {
        type: "paragraph",
        attrs: { id: "p1" },
        content: [
          { type: "text", text: "area: " },
          { type: "inlineMath", attrs: { latex: "\\pi r^2" } },
        ],
      },
    ])
    const adapter = getAdapter("inline", "text", "paragraph", "codeBlock")
    const result = adapter(
      editor,
      editor.state.doc.firstChild!,
      { type: "codeBlock" },
      editor.schema,
    )
    expect(result).not.toBeNull()
    expect(result!.node.textContent).toBe("area: \\pi r^2")
    expect(() => result!.node.check()).not.toThrow()
  })
})

describe("non-code textblock refusal (belt-and-braces)", () => {
  // Every non-code textblock in the REAL schema holds `inline*`, so nothing
  // there can trigger this guard anymore (code targets flatten instead of
  // refusing). Pin the refusal honestly with a minimal schema whose non-code
  // textblock is `text*`-restricted.
  it("rejects inline content a non-code target textblock cannot hold", () => {
    const editor = createTestEditor()
    const mini = new Schema({
      nodes: {
        doc: { content: "block+" },
        paragraph: { group: "block", content: "inline*" },
        plain: { group: "block", content: "text*" }, // textblock, NOT code
        chip: { group: "inline", inline: true, atom: true },
        text: { group: "inline" },
      },
    })
    const source = mini.nodes.paragraph!.create(null, mini.nodes.chip!.create())
    const adapter = getAdapter("inline", "inline", "paragraph", "plain")
    const result = adapter(editor, source, { type: "plain" }, mini)
    expect(result).toBeNull()
  })
})

describe("text to inline adapter", () => {
  it("codeBlock to paragraph keeps text and drops language", () => {
    const editor = createTestEditor()
    editor.commands.setContent([
      {
        type: "codeBlock",
        attrs: { id: "c1", language: "js" },
        content: [{ type: "text", text: "let x = 1" }],
      },
    ])
    const adapter = getAdapter("text", "inline", "codeBlock", "paragraph")
    const result = adapter(
      editor,
      editor.state.doc.firstChild!,
      { type: "paragraph" },
      editor.schema,
    )
    expect(result!.node.type.name).toBe("paragraph")
    expect(result!.node.textContent).toBe("let x = 1")
    expect("language" in result!.node.attrs).toBe(false)
  })
})

describe("inline to atom adapter", () => {
  it("paragraph to divider discards content and preserves id", () => {
    const editor = createTestEditor()
    editor.commands.setContent([
      { type: "paragraph", attrs: { id: "p1" }, content: [{ type: "text", text: "ignored" }] },
    ])
    const adapter = getAdapter("inline", "atom", "paragraph", "divider")
    const result = adapter(
      editor,
      editor.state.doc.firstChild!,
      { type: "divider" },
      editor.schema,
    )
    expect(result!.node.type.name).toBe("divider")
    expect(result!.node.content.size).toBe(0)
    expect(result!.node.attrs.id).toBe("p1")
  })
})

describe("atom to inline adapter", () => {
  it("divider to paragraph produces an empty paragraph", () => {
    const editor = createTestEditor()
    editor.commands.setContent([{ type: "divider", attrs: { id: "d1" } }])
    const adapter = getAdapter("atom", "inline", "divider", "paragraph")
    const result = adapter(
      editor,
      editor.state.doc.firstChild!,
      { type: "paragraph" },
      editor.schema,
    )
    expect(result!.node.type.name).toBe("paragraph")
    expect(result!.node.content.size).toBe(0)
  })
})

describe("atom to atom adapter", () => {
  it("divider to divider is handled by the same-type adapter, not getAdapter", () => {
    // Sanity: getAdapter("atom","atom",...) is only reached for a TYPE change;
    // same-type conversions short-circuit in getAdapter itself.
    const editor = createTestEditor()
    editor.commands.setContent([{ type: "divider", attrs: { id: "d1" } }])
    const adapter = getAdapter("atom", "atom", "divider", "divider")
    const result = adapter(editor, editor.state.doc.firstChild!, { type: "divider" }, editor.schema)
    expect(result!.attrsOnly).toBe(true)
  })

  it("image to divider converts instead of throwing (no atom->atom adapter was registered)", () => {
    const editor = createTestEditor()
    editor.commands.setContent([
      { type: "image", attrs: { id: "img1", src: "https://example.com/x.png" } },
    ])
    const adapter = getAdapter("atom", "atom", "image", "divider")
    const result = adapter(
      editor,
      editor.state.doc.firstChild!,
      { type: "divider" },
      editor.schema,
    )
    expect(result).not.toBeNull()
    expect(result!.node.type.name).toBe("divider")
  })
})

describe("anything to container adapter", () => {
  it("paragraph to table produces a default-shape table at source depth", () => {
    const editor = createTestEditor()
    editor.commands.setContent([
      { type: "paragraph", attrs: { id: "p1", depth: 1 }, content: [{ type: "text", text: "ignored" }] },
    ])
    const adapter = getAdapter("inline", "container", "paragraph", "table")
    const result = adapter(
      editor,
      editor.state.doc.firstChild!,
      { type: "table" },
      editor.schema,
    )
    expect(result!.node.type.name).toBe("table")
    expect(result!.node.attrs.depth).toBe(1)
    expect(result!.node.childCount).toBeGreaterThan(0)
  })
})

describe("toggle source adapter", () => {
  it("does not outdent subsequent body siblings", () => {
    const editor = createTestEditor()
    editor.commands.setContent([
      { type: "toggle", attrs: { id: "t1", depth: 0, level: 0, expanded: true }, content: [{ type: "text", text: "title" }] },
      { type: "paragraph", attrs: { id: "b1", depth: 1 }, content: [{ type: "text", text: "body 1" }] },
      { type: "bulletList", attrs: { id: "b2", depth: 2 }, content: [{ type: "text", text: "nested" }] },
      { type: "paragraph", attrs: { id: "after", depth: 0 }, content: [{ type: "text", text: "after" }] },
    ])
    const sourceNode = editor.state.doc.firstChild!
    const adapter = getAdapter("inline", "inline", "toggle", "paragraph")
    const result = adapter(editor, sourceNode, { type: "paragraph" }, editor.schema)

    expect(result!.postProcess).toBeUndefined()

    const tr = editor.state.tr
    const pos = 0
    tr.replaceWith(pos, pos + sourceNode.nodeSize, result!.node)

    const depths: Record<string, number> = {}
    tr.doc.forEach((child) => {
      depths[child.attrs.id as string] = child.attrs.depth as number
    })
    expect(depths.b1).toBe(1)
    expect(depths.b2).toBe(2)
    expect(depths.after).toBe(0)
  })
})

describe("props validation + content override (turn_into contract, plan 2026-06-16)", () => {
  it("rejects an illegal heading level (cross-type)", () => {
    const editor = createTestEditor()
    editor.commands.setContent([
      { type: "paragraph", attrs: { id: "p1" }, content: [{ type: "text", text: "x" }] },
    ])
    const adapter = getAdapter("inline", "inline", "paragraph", "heading")
    const result = adapter(
      editor,
      editor.state.doc.firstChild!,
      { type: "heading", props: { level: 7 } },
      editor.schema,
    )
    expect(result).toBeNull()
  })

  it("rejects an illegal heading level (same-type)", () => {
    const editor = createTestEditor()
    editor.commands.setContent([
      { type: "heading", attrs: { id: "h1", level: 2 }, content: [{ type: "text", text: "x" }] },
    ])
    const adapter = getAdapter("inline", "inline", "heading", "heading")
    const result = adapter(
      editor,
      editor.state.doc.firstChild!,
      { type: "heading", props: { level: 7 } },
      editor.schema,
    )
    expect(result).toBeNull()
  })

  it("overrides content when target.content is provided (cross-type)", () => {
    const editor = createTestEditor()
    editor.commands.setContent([
      { type: "paragraph", attrs: { id: "p1" }, content: [{ type: "text", text: "old" }] },
    ])
    const adapter = getAdapter("inline", "inline", "paragraph", "heading")
    const result = adapter(
      editor,
      editor.state.doc.firstChild!,
      { type: "heading", props: { level: 2 }, content: "New" },
      editor.schema,
    )
    expect(result!.node.textContent).toBe("New")
  })

  it("clears content with an empty-string override and REPLACES (not attrsOnly)", () => {
    const editor = createTestEditor()
    editor.commands.setContent([
      { type: "heading", attrs: { id: "h1", level: 2 }, content: [{ type: "text", text: "old" }] },
    ])
    const adapter = getAdapter("inline", "inline", "heading", "heading")
    const result = adapter(
      editor,
      editor.state.doc.firstChild!,
      { type: "heading", content: "" },
      editor.schema,
    )
    expect(result!.attrsOnly).toBeFalsy()
    expect(result!.node.textContent).toBe("")
  })

  it("overrides content on a same-type conversion and drops attrsOnly", () => {
    const editor = createTestEditor()
    editor.commands.setContent([
      { type: "heading", attrs: { id: "h1", level: 2 }, content: [{ type: "text", text: "old" }] },
    ])
    const adapter = getAdapter("inline", "inline", "heading", "heading")
    const result = adapter(
      editor,
      editor.state.doc.firstChild!,
      { type: "heading", props: { level: 3 }, content: "fresh" },
      editor.schema,
    )
    expect(result!.attrsOnly).toBeFalsy()
    expect(result!.node.attrs.level).toBe(3)
    expect(result!.node.textContent).toBe("fresh")
  })
})
