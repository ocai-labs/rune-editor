// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, it, expect } from "vitest"
import type { Editor, JSONContent } from "@tiptap/core"
import type { Node as PMNode } from "@tiptap/pm/model"
import { undo } from "@tiptap/pm/history"
import { createTestEditor } from "../../test-utils/createTestEditor"
import { exportMarkdownWithChunks } from "../export/markdown"
import { parseAiMarkdown } from "../../extensions/clipboard/aiMarkdown"
import type { RuneCommandResult } from "../result"
import { applyMarkdownEdits, type ApplyMarkdownEditsData } from "./applyMarkdownEdits"

// ── fixtures / helpers ─────────────────────────────────────────────────────

// The default kit ships StarterKit's undo/redo history, so `undo` operates on
// the live editor without any extra extension wiring.
function editorWith(content: JSONContent[]): Editor {
  return createTestEditor({ content: { type: "doc", content } })
}

const text = (t: string, marks?: JSONContent["marks"]): JSONContent =>
  marks ? { type: "text", text: t, marks } : { type: "text", text: t }

const para = (id: string, content: JSONContent[], attrs?: Record<string, unknown>): JSONContent => ({
  type: "paragraph",
  attrs: { id, depth: 0, ...attrs },
  content,
})

function findBlock(editor: Editor, id: string): PMNode | null {
  let out: PMNode | null = null
  editor.state.doc.descendants((node) => {
    if (out) return false
    if (node.attrs && node.attrs.id === id) {
      out = node
      return false
    }
    return true
  })
  return out
}

/** Sorted mark-type names on the (first) text run whose text is exactly `t`. */
function marksOnText(node: PMNode, t: string): string[] {
  let names: string[] = []
  node.descendants((child) => {
    if (child.isText && child.text === t) names = child.marks.map((m) => m.type.name).sort()
  })
  return names
}

function markAttrOnText(node: PMNode, t: string, markName: string, attr: string): unknown {
  let value: unknown
  node.descendants((child) => {
    if (child.isText && child.text === t) {
      const mark = child.marks.find((m) => m.type.name === markName)
      if (mark) value = mark.attrs[attr]
    }
  })
  return value
}

function expectOk(
  res: RuneCommandResult<ApplyMarkdownEditsData>,
): ApplyMarkdownEditsData {
  if (!res.ok) throw new Error(`expected ok, got error ${JSON.stringify(res.error)}`)
  return res.data
}

// ── inline edits (same-type re-parse) ──────────────────────────────────────

describe("applyMarkdownEdits — inline edits", () => {
  it("recolors an inline-code span by quoting it (the headline case)", () => {
    const editor = editorWith([para("p", [text("call "), text("alpha", [{ type: "code" }])])])
    const res = applyMarkdownEdits(editor, {
      edits: [{ oldStr: "`alpha`", newStr: '<span data-text-color="blue">`alpha`</span>' }],
    })
    const data = expectOk(res)
    expect(data.changedBlockIds).toEqual(["p"])

    const block = findBlock(editor, "p")!
    expect(block.textContent).toBe("call alpha")
    expect(marksOnText(block, "alpha")).toEqual(["code", "textStyle"])
    expect(markAttrOnText(block, "alpha", "textStyle", "textColor")).toBe("blue")
  })

  it("swaps a color blue → yellow", () => {
    const editor = editorWith([
      para("p", [text("hi", [{ type: "textStyle", attrs: { textColor: "blue" } }])]),
    ])
    const res = applyMarkdownEdits(editor, {
      edits: [{ oldStr: 'data-text-color="blue"', newStr: 'data-text-color="yellow"' }],
    })
    expectOk(res)
    expect(markAttrOnText(findBlock(editor, "p")!, "hi", "textStyle", "textColor")).toBe("yellow")
  })

  it("replaces a plain word", () => {
    const editor = editorWith([para("p", [text("the quick brown fox")])])
    expectOk(applyMarkdownEdits(editor, { edits: [{ oldStr: "quick", newStr: "slow" }] }))
    expect(findBlock(editor, "p")!.textContent).toBe("the slow brown fox")
  })

  it("bolds a phrase via `**…**`", () => {
    const editor = editorWith([para("p", [text("make this bold now")])])
    expectOk(applyMarkdownEdits(editor, { edits: [{ oldStr: "this bold", newStr: "**this bold**" }] }))
    const block = findBlock(editor, "p")!
    expect(block.textContent).toBe("make this bold now")
    expect(marksOnText(block, "this bold")).toEqual(["bold"])
  })

  it("preserves an indented block's depth across an inline edit", () => {
    const editor = editorWith([
      { type: "bulletList", attrs: { id: "b1", depth: 0 }, content: [text("parent")] },
      { type: "bulletList", attrs: { id: "b2", depth: 1 }, content: [text("child")] },
    ])
    expectOk(applyMarkdownEdits(editor, { edits: [{ oldStr: "child", newStr: "kid" }] }))
    const b2 = findBlock(editor, "b2")!
    expect(b2.textContent).toBe("kid")
    expect(b2.attrs.depth).toBe(1)
    expect(b2.type.name).toBe("bulletList")
  })

  it("preserves block color across an inline edit", () => {
    const editor = editorWith([para("p", [text("hello")], { backgroundColor: "blue" })])
    expectOk(applyMarkdownEdits(editor, { edits: [{ oldStr: "hello", newStr: "goodbye" }] }))
    const block = findBlock(editor, "p")!
    expect(block.textContent).toBe("goodbye")
    expect(block.attrs.backgroundColor).toBe("blue")
  })

  it("preserves a checked todo across an inline edit", () => {
    const editor = editorWith([
      { type: "taskList", attrs: { id: "t", depth: 0, checked: true }, content: [text("task")] },
    ])
    expectOk(applyMarkdownEdits(editor, { edits: [{ oldStr: "task", newStr: "done" }] }))
    const block = findBlock(editor, "t")!
    expect(block.textContent).toBe("done")
    expect(block.attrs.checked).toBe(true)
  })

  it("does NOT trip the guard on bold+code text (A1: code wraps innermost)", () => {
    // Before `code` was forced innermost among markdown marks, a bold+code span
    // serialized as `` `**fn()**` `` — backtick content is literal, so the
    // pre-flight re-parse dropped the bold mark, the round-trip failed, and the
    // lossless guard falsely refused the whole block with a generic message.
    // With code innermost (`` **`fn()`** ``) it round-trips, so an unrelated
    // edit in the same block now applies.
    const editor = editorWith([
      para("p", [text("call "), text("fn()", [{ type: "code" }, { type: "bold" }])]),
    ])
    expectOk(applyMarkdownEdits(editor, { edits: [{ oldStr: "call", newStr: "run" }] }))
    const block = findBlock(editor, "p")!
    expect(block.textContent).toBe("run fn()")
    expect(marksOnText(block, "fn()")).toEqual(["bold", "code"])
  })

  it("does NOT trip the guard on ordinary styled content (bold/color/link/wikiLink)", () => {
    const editor = editorWith([
      para("p", [
        text("plain "),
        text("bold", [{ type: "bold" }]),
        text(" "),
        text("blue", [{ type: "textStyle", attrs: { textColor: "blue" } }]),
        text(" "),
        text("site", [{ type: "link", attrs: { href: "https://example.com" } }]),
        text(" "),
        text("Page", [{ type: "wikiLink", attrs: { target: "Page" } }]),
      ]),
    ])
    expectOk(applyMarkdownEdits(editor, { edits: [{ oldStr: "plain", newStr: "clear" }] }))
    const block = findBlock(editor, "p")!
    expect(block.textContent).toBe("clear bold blue site Page")
    expect(marksOnText(block, "bold")).toEqual(["bold"])
    expect(marksOnText(block, "blue")).toEqual(["textStyle"])
    expect(marksOnText(block, "site")).toEqual(["link"])
    expect(marksOnText(block, "Page")).toEqual(["wikiLink"])
  })
})

// ── normalization ladder ───────────────────────────────────────────────────

describe("applyMarkdownEdits — normalization ladder", () => {
  it("matches a double-space needle against a single-space haystack (tier 2)", () => {
    const editor = editorWith([para("p", [text("a b")])])
    expectOk(applyMarkdownEdits(editor, { edits: [{ oldStr: "a  b", newStr: "c" }] }))
    expect(findBlock(editor, "p")!.textContent).toBe("c")
  })

  it("matches a single-space needle against a double-space haystack (tier 2, reverse)", () => {
    // A code block preserves the literal double space (a paragraph would
    // collapse it and trip the lossless guard).
    const editor = editorWith([
      { type: "codeBlock", attrs: { id: "c", depth: 0, language: "text" }, content: [text("a  b")] },
    ])
    expectOk(applyMarkdownEdits(editor, { edits: [{ oldStr: "a b", newStr: "z" }] }))
    expect(findBlock(editor, "c")!.textContent).toBe("z")
  })

  it("folds an NBSP needle to match a normal-space haystack (tier 2, whitespace collapse)", () => {
    // The needle carries a real U+00A0 (written as \u00A0 so it is visible and
    // stable in source — a literal NBSP is indistinguishable from a space). The
    // exact tier cannot match it against the ordinary space in the haystack; JS's
    // \s matches NBSP, so tier 2's whitespace collapse folds it (NOT the
    // smart-quote tier).
    const editor = editorWith([para("p", [text("alpha beta")])])
    expectOk(applyMarkdownEdits(editor, { edits: [{ oldStr: "alpha\u00A0beta", newStr: "gamma" }] }))
    expect(findBlock(editor, "p")!.textContent).toBe("gamma")
  })

  it("folds smart quotes to match straight quotes (tier 3)", () => {
    const editor = editorWith([para("p", [text('say "hello" now')])])
    expectOk(
      applyMarkdownEdits(editor, { edits: [{ oldStr: "“hello”", newStr: '"hi"' }] }),
    )
    expect(findBlock(editor, "p")!.textContent).toBe('say "hi" now')
  })

  it("case-folds as a last resort (tier 4)", () => {
    const editor = editorWith([para("p", [text("Hello World")])])
    expectOk(applyMarkdownEdits(editor, { edits: [{ oldStr: "hello world", newStr: "Goodbye" }] }))
    expect(findBlock(editor, "p")!.textContent).toBe("Goodbye")
  })

  it("resolves at the tightest tier: unique at exact wins over ambiguous-at-tier-2", () => {
    // p1 has one space (exact match); p2 has two (would also match once
    // whitespace collapses). Exact tier finds exactly one → p1, never reaching
    // the looser tier where both match.
    const editor = editorWith([
      para("p1", [text("foo bar")]),
      { type: "codeBlock", attrs: { id: "p2", depth: 0, language: "text" }, content: [text("foo  bar")] },
    ])
    expectOk(applyMarkdownEdits(editor, { edits: [{ oldStr: "foo bar", newStr: "foo BAR" }] }))
    expect(findBlock(editor, "p1")!.textContent).toBe("foo BAR")
    expect(findBlock(editor, "p2")!.textContent).toBe("foo  bar")
  })
})

// ── match errors ────────────────────────────────────────────────────────────

describe("applyMarkdownEdits — locate errors", () => {
  it("reports ambiguous-match with the block ids when oldStr appears in two blocks", () => {
    const editor = editorWith([
      para("p1", [text("hello world")]),
      para("p2", [text("hello there")]),
    ])
    const res = applyMarkdownEdits(editor, { edits: [{ oldStr: "hello", newStr: "hi" }] })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error.code).toBe("ambiguous-match")
    const details = res.error.details as { blockIds: string[] }
    expect([...details.blockIds].sort()).toEqual(["p1", "p2"])
    // Nothing applied.
    expect(findBlock(editor, "p1")!.textContent).toBe("hello world")
    expect(findBlock(editor, "p2")!.textContent).toBe("hello there")
  })

  it("succeeds on the same ambiguous oldStr when a blockId scopes it", () => {
    const editor = editorWith([
      para("p1", [text("hello world")]),
      para("p2", [text("hello there")]),
    ])
    expectOk(applyMarkdownEdits(editor, { edits: [{ oldStr: "hello", newStr: "HELLO", blockId: "p2" }] }))
    expect(findBlock(editor, "p1")!.textContent).toBe("hello world")
    expect(findBlock(editor, "p2")!.textContent).toBe("HELLO there")
  })

  it("reports no-match and echoes the scoped block text when blockId is given", () => {
    const editor = editorWith([para("p1", [text("hello world")])])
    const res = applyMarkdownEdits(editor, {
      edits: [{ oldStr: "zzz", newStr: "x", blockId: "p1" }],
    })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error.code).toBe("no-match")
    const details = res.error.details as { blockText: string }
    expect(details.blockText).toBe("hello world")
  })
})

// ── structural edits (whole-block re-parse) ────────────────────────────────

describe("applyMarkdownEdits — structural edits", () => {
  it("turns a paragraph into a bulleted list via a multi-block newStr", () => {
    const editor = editorWith([para("p", [text("shopping list")])])
    const data = expectOk(
      applyMarkdownEdits(editor, {
        edits: [{ oldStr: "shopping list", newStr: "- milk\n- eggs\n- bread" }],
      }),
    )
    // First result inherits the original id; the batch reports it.
    expect(data.changedBlockIds).toEqual(["p"])

    const roots: PMNode[] = []
    editor.state.doc.content.forEach((n) => roots.push(n))
    expect(roots.map((n) => n.type.name)).toEqual(["bulletList", "bulletList", "bulletList"])
    expect(roots.map((n) => n.textContent)).toEqual(["milk", "eggs", "bread"])
    expect(roots.map((n) => n.attrs.depth)).toEqual([0, 0, 0])
    expect(roots[0]!.attrs.id).toBe("p")
    // Subsequent blocks got fresh ids from BlockId's appendTransaction.
    expect(typeof roots[1]!.attrs.id).toBe("string")
    expect(roots[1]!.attrs.id).not.toBe("p")
    expect(roots[2]!.attrs.id).not.toBe(roots[1]!.attrs.id)
  })

  it("changes a heading level by editing its `#` prefix", () => {
    const editor = editorWith([
      { type: "heading", attrs: { id: "h", depth: 0, level: 2 }, content: [text("Title")] },
    ])
    const line = exportMarkdownWithChunks(editor).chunks[0]!.text
    expect(line).toBe("# Title")
    const newStr = "## Title"
    // Independently derive the level "## Title" parses to (axis-shift aware).
    const expectedLevel = parseAiMarkdown(newStr, editor.schema).content![0]!.attrs!.level

    expectOk(applyMarkdownEdits(editor, { edits: [{ oldStr: line, newStr }] }))
    const block = findBlock(editor, "h")!
    expect(block.type.name).toBe("heading")
    expect(block.attrs.level).toBe(expectedLevel)
    expect(block.attrs.level).not.toBe(2)
    expect(block.textContent).toBe("Title")
  })

  it("edits a numbered-list item quoted with its run index (provenance)", () => {
    const editor = editorWith([
      { type: "numberedList", attrs: { id: "n1", depth: 0 }, content: [text("first")] },
      { type: "numberedList", attrs: { id: "n2", depth: 0 }, content: [text("second")] },
      { type: "numberedList", attrs: { id: "n3", depth: 0 }, content: [text("third")] },
    ])
    // The model reads "3. third" (standalone re-serialization would show "1.").
    expectOk(applyMarkdownEdits(editor, { edits: [{ oldStr: "3. third", newStr: "3. THIRD" }] }))
    expect(findBlock(editor, "n1")!.textContent).toBe("first")
    expect(findBlock(editor, "n2")!.textContent).toBe("second")
    expect(findBlock(editor, "n3")!.textContent).toBe("THIRD")
    // Run indices still render 1./2./3.
    const chunks = exportMarkdownWithChunks(editor).chunks
    expect(chunks.map((c) => c.text)).toEqual(["1. first", "2. second", "3. THIRD"])
  })

  it("keeps a toggle-heading child's real depth across a structural swap", () => {
    // A toggle heading (level > 0) flattens its children to render at indent 0,
    // so the child's chunk.indent is 0 while its real node depth is 1. A
    // structural swap must inherit the ORIGINAL node depth (1), not the
    // flattened render indent (0).
    const editor = editorWith([
      { type: "toggle", attrs: { id: "tg", depth: 0, level: 2, expanded: true }, content: [text("Section")] },
      para("child", [text("child text")], { depth: 1 }),
    ])
    expectOk(
      applyMarkdownEdits(editor, { edits: [{ oldStr: "child text", newStr: "- item", blockId: "child" }] }),
    )
    const block = findBlock(editor, "child")!
    expect(block.type.name).toBe("bulletList")
    expect(block.textContent).toBe("item")
    expect(block.attrs.depth).toBe(1)
  })

  it("lifts a multi-block structural swap's relative parse depths onto the toggle-heading child's base", () => {
    const editor = editorWith([
      { type: "toggle", attrs: { id: "tg", depth: 0, level: 2, expanded: true }, content: [text("Section")] },
      para("child", [text("child text")], { depth: 1 }),
    ])
    const newStr = "- outer\n    - inner"
    // Independently derive the depths this newStr parses to standalone (base 0);
    // the swap must add each onto the child's real base depth (1).
    const parseDepths = parseAiMarkdown(newStr, editor.schema).content!.map(
      (n) => n.attrs!.depth as number,
    )
    expectOk(
      applyMarkdownEdits(editor, { edits: [{ oldStr: "child text", newStr, blockId: "child" }] }),
    )
    const roots: PMNode[] = []
    editor.state.doc.content.forEach((n) => roots.push(n))
    const bullets = roots.filter((n) => n.type.name === "bulletList")
    expect(bullets.map((n) => n.attrs.depth)).toEqual(parseDepths.map((d) => 1 + d))
  })
})

// ── batch semantics ─────────────────────────────────────────────────────────

describe("applyMarkdownEdits — batch semantics", () => {
  it("applies a batch of two edits as one undo step", () => {
    const editor = editorWith([para("p1", [text("one")]), para("p2", [text("two")])])
    expectOk(
      applyMarkdownEdits(editor, {
        edits: [
          { oldStr: "one", newStr: "1" },
          { oldStr: "two", newStr: "2" },
        ],
      }),
    )
    expect(findBlock(editor, "p1")!.textContent).toBe("1")
    expect(findBlock(editor, "p2")!.textContent).toBe("2")

    // A single undo reverts BOTH → one history entry → one transaction.
    undo(editor.state, editor.view.dispatch)
    expect(findBlock(editor, "p1")!.textContent).toBe("one")
    expect(findBlock(editor, "p2")!.textContent).toBe("two")
  })

  it("processes edits sequentially against the evolving doc", () => {
    const editor = editorWith([para("p", [text("alpha")])])
    // "gamma" only exists AFTER the first edit runs.
    expectOk(
      applyMarkdownEdits(editor, {
        edits: [
          { oldStr: "alpha", newStr: "beta gamma" },
          { oldStr: "gamma", newStr: "GAMMA" },
        ],
      }),
    )
    expect(findBlock(editor, "p")!.textContent).toBe("beta GAMMA")
  })

  it("is atomic: a later invalid edit rolls back the whole batch", () => {
    const editor = editorWith([para("p1", [text("alpha")]), para("p2", [text("beta")])])
    const res = applyMarkdownEdits(editor, {
      edits: [
        { oldStr: "alpha", newStr: "ALPHA" },
        { oldStr: "zzz", newStr: "x" },
      ],
    })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error.code).toBe("no-match")
    expect((res.error.details as { editIndex: number }).editIndex).toBe(1)
    // The first (valid) edit was NOT applied — nothing dispatched.
    expect(findBlock(editor, "p1")!.textContent).toBe("alpha")
    expect(findBlock(editor, "p2")!.textContent).toBe("beta")
  })
})

// ── clear (empty newStr covering the whole chunk) ──────────────────────────

describe("applyMarkdownEdits — clear (empty newStr)", () => {
  it("clears a paragraph's text but KEEPS the block (id / depth / color preserved)", () => {
    const editor = editorWith([para("p", [text("hello")], { backgroundColor: "blue" })])
    expectOk(applyMarkdownEdits(editor, { edits: [{ oldStr: "hello", newStr: "" }] }))
    const block = findBlock(editor, "p")!
    expect(block.type.name).toBe("paragraph")
    expect(block.textContent).toBe("")
    expect(block.attrs.id).toBe("p")
    expect(block.attrs.depth).toBe(0)
    expect(block.attrs.backgroundColor).toBe("blue")
  })

  it("clears a checked todo's text but keeps it checked", () => {
    const editor = editorWith([
      { type: "taskList", attrs: { id: "t", depth: 0, checked: true }, content: [text("buy milk")] },
    ])
    // The model quotes the WHOLE rendered chunk (marker + text) and clears it.
    const chunk = exportMarkdownWithChunks(editor).chunks[0]!.text
    expectOk(applyMarkdownEdits(editor, { edits: [{ oldStr: chunk, newStr: "" }] }))
    const block = findBlock(editor, "t")!
    expect(block.type.name).toBe("taskList")
    expect(block.textContent).toBe("")
    expect(block.attrs.checked).toBe(true)
  })

  it("still handles a partial empty (surviving text re-parses)", () => {
    const editor = editorWith([para("p", [text("hello world")])])
    expectOk(applyMarkdownEdits(editor, { edits: [{ oldStr: "hello ", newStr: "" }] }))
    expect(findBlock(editor, "p")!.textContent).toBe("world")
  })

  it("keeps a batch with a clear + a normal edit atomic (one undo step)", () => {
    const editor = editorWith([para("p1", [text("clear me")]), para("p2", [text("keep")])])
    expectOk(
      applyMarkdownEdits(editor, {
        edits: [
          { oldStr: "clear me", newStr: "" },
          { oldStr: "keep", newStr: "kept" },
        ],
      }),
    )
    expect(findBlock(editor, "p1")!.textContent).toBe("")
    expect(findBlock(editor, "p2")!.textContent).toBe("kept")
    // One undo reverts BOTH → the clear and the edit were one transaction.
    undo(editor.state, editor.view.dispatch)
    expect(findBlock(editor, "p1")!.textContent).toBe("clear me")
    expect(findBlock(editor, "p2")!.textContent).toBe("keep")
  })
})

// ── lossless guard ───────────────────────────────────────────────────────

describe("applyMarkdownEdits — lossless guard", () => {
  it("refuses a block carrying an internalRef mark, naming it", () => {
    const editor = editorWith([
      para("p", [text("ref", [{ type: "internalRef", attrs: { kind: "page", target: "Page" } }])]),
    ])
    const res = applyMarkdownEdits(editor, { edits: [{ oldStr: "ref", newStr: "reference" }] })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error.code).toBe("not-editable-lossless")
    expect(res.error.message).toContain("internalRef")
    expect((res.error.details as { blockId: string }).blockId).toBe("p")
    // Untouched.
    expect(findBlock(editor, "p")!.textContent).toBe("ref")
  })

  it("refuses a block with consecutive spaces inside inline code", () => {
    const editor = editorWith([para("p", [text("x"), text("a  b", [{ type: "code" }])])])
    const res = applyMarkdownEdits(editor, { edits: [{ oldStr: "x", newStr: "y" }] })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error.code).toBe("not-editable-lossless")
    expect(res.error.message).toContain("not representable")
    expect(findBlock(editor, "p")!.textContent).toBe("xa  b")
  })
})

// ── scope / gates ────────────────────────────────────────────────────────

describe("applyMarkdownEdits — scope and gates", () => {
  it("does not search excluded block types", () => {
    const editor = editorWith([
      { type: "heading", attrs: { id: "h", depth: 0, level: 2 }, content: [text("unique heading text")] },
      para("p", [text("other")]),
    ])
    const res = applyMarkdownEdits(editor, {
      edits: [{ oldStr: "unique heading", newStr: "changed" }],
      excludeBlockTypes: ["heading"],
    })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error.code).toBe("no-match")
    expect(findBlock(editor, "h")!.textContent).toBe("unique heading text")
  })

  it("rejects a read-only editor", () => {
    const editor = editorWith([para("p", [text("hello")])])
    editor.setEditable(false)
    const res = applyMarkdownEdits(editor, { edits: [{ oldStr: "hello", newStr: "hi" }] })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error.code).toBe("not-editable")
  })

  it("rejects an empty edits array", () => {
    const editor = editorWith([para("p", [text("hello")])])
    const res = applyMarkdownEdits(editor, { edits: [] })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error.code).toBe("invalid-input")
  })
})
