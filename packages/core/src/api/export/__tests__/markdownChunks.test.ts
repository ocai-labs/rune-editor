// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// packages/core/src/api/export/__tests__/markdownChunks.test.ts
import { describe, it, expect } from "vitest"
import type { JSONContent } from "@tiptap/core"
import { createTestEditor, type CreateTestEditorOptions } from "../../../test-utils/createTestEditor"
import { createBlockSpec } from "../../../schema"
import {
  exportMarkdown,
  exportMarkdownWithChunks,
  type RuneMarkdownChunk,
} from "../markdown"

function editorFor(content: unknown[], opts?: CreateTestEditorOptions) {
  return createTestEditor({
    content: { type: "doc", content: content as JSONContent[] },
    ...opts,
  })
}

/**
 * A synthetic body block whose `toMarkdown` returns an OVERRIDDEN `depth`
 * (99) that diverges from the render-time depth whose `INDENT.repeat(...)`
 * prefix it actually baked into `line`. No built-in block does this today,
 * but the contract allows it — a serializer may set `depth` purely as a
 * `needsBlankLineBetween` spacing input. This pins `chunk.indent` to the
 * prefix-derived depth, not the spacing-overridable one (regression guard:
 * before the fix `chunk.indent` would surface the bogus 99).
 */
const DepthOverrideBlock = createBlockSpec({
  type: "depthOverrideBlock",
  content: "inline*",
  parseDOM: [{ tag: "div.rune-depth-override" }],
  renderDOM: ({ HTMLAttributes }) => [
    "div",
    { ...HTMLAttributes, class: "rune-block" },
    ["div", { class: "rune-block-content" }, ["p", {}, 0]],
  ],
  toMarkdown({ prefix, serializeInline, node }) {
    // Prefix uses the real render-time depth; `depth` is a bogus spacing
    // override that must NOT leak into chunk.indent.
    return { line: `${prefix}${serializeInline(node)}`, depth: 99 }
  },
})

const depthOverridePlugin = {
  id: "test-depth-override",
  blockExtensions: [DepthOverrideBlock],
}

/** A body block with an explicit, unique id so chunk.blockId is assertable. */
function block(
  id: string,
  type: string,
  text: string,
  attrs?: Record<string, unknown>,
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>,
) {
  const node: Record<string, unknown> = {
    type,
    attrs: { id, depth: 0, ...attrs },
  }
  if (text) {
    const textNode: Record<string, unknown> = { type: "text", text }
    if (marks) textNode.marks = marks
    node.content = [textNode]
  }
  return node
}

function columns(id: string, cols: unknown[][]) {
  return {
    type: "columnLayout",
    attrs: { id, depth: 0 },
    content: cols.map((children, i) => ({
      type: "column",
      attrs: { id: `${id}-col-${i}`, width: 1 },
      content: children,
    })),
  }
}

/**
 * The contract: concatenating `chunks[i].text` with the same blank-line
 * separators the join inserted reproduces `markdown` byte-for-byte.
 *
 * Walks a cursor through `markdown`: each chunk text must appear verbatim at
 * the cursor; the gap to the next chunk is exactly one or two newlines (the
 * join only ever inserts a single blank line); the tail is the trailing "\n".
 * Chunk texts never start with a newline and are never empty in these
 * fixtures, so the greedy separator read is unambiguous.
 */
function assertReconstructs(markdown: string, chunks: RuneMarkdownChunk[]) {
  let cursor = 0
  chunks.forEach((chunk, i) => {
    expect(markdown.slice(cursor, cursor + chunk.text.length)).toBe(chunk.text)
    cursor += chunk.text.length
    if (i < chunks.length - 1) {
      if (markdown.startsWith("\n\n", cursor)) {
        cursor += 2
      } else {
        expect(markdown.startsWith("\n", cursor)).toBe(true)
        cursor += 1
      }
    }
  })
  expect(markdown.slice(cursor)).toBe("\n")
}

/** Named fixtures reused by the per-case tests and the sweep at the end. */
const fixtures: Record<string, unknown[]> = {
  simple: [
    block("h-1", "heading", "Title", { level: 2 }),
    block("p-1", "paragraph", "First paragraph"),
    block("p-2", "paragraph", "Second paragraph"),
  ],
  numberedRun: [
    block("n-1", "numberedList", "first"),
    block("n-2", "numberedList", "second"),
    block("n-3", "numberedList", "third"),
  ],
  nested: [
    block("b-1", "bulletList", "parent", { depth: 0 }),
    block("b-2", "bulletList", "child", { depth: 1 }),
    block("b-3", "bulletList", "grandchild", { depth: 2 }),
  ],
  toggleHeading: [
    {
      type: "toggle",
      attrs: { id: "tg-1", depth: 0, level: 2, expanded: true },
      content: [{ type: "text", text: "Section" }],
    },
    block("p-3", "paragraph", "Child text", { depth: 1 }),
    block("n-4", "numberedList", "A", { depth: 1 }),
    block("n-5", "numberedList", "B", { depth: 1 }),
  ],
  columnSeparator: [
    columns("cl-1", [
      [
        block("cn-1", "numberedList", "a"),
        block("cn-2", "numberedList", "b"),
      ],
      [block("cn-3", "numberedList", "c")],
    ]),
  ],
  mixed: [
    block("h-2", "heading", "Doc", { level: 2 }),
    block("p-4", "paragraph", "intro"),
    block("n-6", "numberedList", "one"),
    block("n-7", "numberedList", "two"),
    {
      type: "codeBlock",
      attrs: { id: "cb-1", depth: 0, language: "ts" },
      content: [{ type: "text", text: "const x = 1\nconst y = 2" }],
    },
    { type: "divider", attrs: { id: "d-1", depth: 0 } },
    block("b-4", "bulletList", "item"),
  ],
}

describe("exportMarkdownWithChunks", () => {
  it("simple doc: one chunk per block, ids match, texts verbatim, indent 0", () => {
    const editor = editorFor(fixtures.simple!)
    const { markdown, chunks } = exportMarkdownWithChunks(editor)

    expect(chunks).toHaveLength(3)
    expect(chunks.map((c) => c.blockId)).toEqual(["h-1", "p-1", "p-2"])
    for (const chunk of chunks) {
      expect(chunk.indent).toBe(0)
      expect(markdown).toContain(chunk.text)
    }
    assertReconstructs(markdown, chunks)
  })

  it("numbered run: chunk texts carry the joined 1./2./3. indices", () => {
    const editor = editorFor(fixtures.numberedRun!)
    const { markdown, chunks } = exportMarkdownWithChunks(editor)

    expect(chunks.map((c) => c.text)).toEqual(["1. first", "2. second", "3. third"])
    // These are the exact indices the model reads — standalone re-serialization
    // would render every item as "1. …".
    expect(markdown).toContain("2. second")
    assertReconstructs(markdown, chunks)
  })

  it("nested list: indent reflects rendered depth, text starts with the indent prefix", () => {
    const editor = editorFor(fixtures.nested!)
    const { markdown, chunks } = exportMarkdownWithChunks(editor)

    expect(chunks.map((c) => c.indent)).toEqual([0, 1, 2])
    for (const chunk of chunks) {
      expect(chunk.text.startsWith("    ".repeat(chunk.indent))).toBe(true)
    }
    assertReconstructs(markdown, chunks)
  })

  it("toggle heading flattens child depth: child chunks render at indent 0", () => {
    const editor = editorFor(fixtures.toggleHeading!)
    const { markdown, chunks } = exportMarkdownWithChunks(editor)

    // Toggle heading and its depth-1 children all flatten to indent 0.
    expect(chunks.map((c) => c.indent)).toEqual([0, 0, 0, 0])
    for (const chunk of chunks) {
      expect(chunk.text.startsWith(" ")).toBe(false)
    }
    // The numbered children keep their running indices under flattening.
    const numbered = chunks.filter((c) => /^\d+\. /.test(c.text)).map((c) => c.text)
    expect(numbered).toEqual(["1. A", "2. B"])
    assertReconstructs(markdown, chunks)
  })

  it("column boundary between numbered runs emits a blockId:null separator chunk", () => {
    const editor = editorFor(fixtures.columnSeparator!)
    const { markdown, chunks } = exportMarkdownWithChunks(editor)

    const separators = chunks.filter((c) => c.blockId === null)
    expect(separators).toHaveLength(1)
    expect(separators[0]!.text).toBe("<!-- -->")
    expect(separators[0]!.indent).toBe(0)

    // The real blocks keep their ids in column order.
    expect(chunks.filter((c) => c.blockId !== null).map((c) => c.blockId)).toEqual([
      "cn-1",
      "cn-2",
      "cn-3",
    ])
    assertReconstructs(markdown, chunks)
  })

  it("reconstruction invariant holds for every fixture", () => {
    for (const [name, content] of Object.entries(fixtures)) {
      const editor = editorFor(content)
      const { markdown, chunks } = exportMarkdownWithChunks(editor)
      // Annotate failures with the fixture name.
      expect(chunks.length, `fixture ${name} produced no chunks`).toBeGreaterThan(0)
      assertReconstructs(markdown, chunks)
      // Every non-separator chunk carries the id of a real block.
      for (const chunk of chunks) {
        if (chunk.blockId !== null) {
          expect(typeof chunk.blockId, `fixture ${name}`).toBe("string")
        }
      }
    }
  })

  it("chunk.indent derives from the render-time prefix depth, not a toMarkdown depth override", () => {
    const editor = editorFor(
      [
        block("p-ov-0", "paragraph", "root"),
        block("ov-1", "depthOverrideBlock", "nested", { depth: 1 }),
      ],
      { kit: { plugins: [depthOverridePlugin] } },
    )
    const { markdown, chunks } = exportMarkdownWithChunks(editor)

    const overridden = chunks.find((c) => c.blockId === "ov-1")!
    // Rendered at depth 1 → a single INDENT prefix, regardless of the bogus
    // depth:99 the serializer returned for spacing.
    expect(overridden.text).toBe("    nested")
    expect(overridden.indent).toBe(1)
    // The prefix-derivation invariant: exactly `indent` INDENT units, no more.
    expect(overridden.text.startsWith("    ".repeat(overridden.indent))).toBe(true)
    expect(overridden.text.startsWith("    ".repeat(overridden.indent + 1))).toBe(false)
    assertReconstructs(markdown, chunks)
  })

  it("prefix-derivation invariant holds for every chunk of every fixture", () => {
    // `chunk.text` carries exactly `INDENT.repeat(indent)` of leading
    // whitespace — the prefix a consumer strips before re-parsing standalone.
    for (const [name, content] of Object.entries(fixtures)) {
      const editor = editorFor(content)
      const { chunks } = exportMarkdownWithChunks(editor)
      for (const chunk of chunks) {
        expect(
          chunk.text.startsWith("    ".repeat(chunk.indent)),
          `fixture ${name}: chunk ${JSON.stringify(chunk.text)} missing indent ${chunk.indent} prefix`,
        ).toBe(true)
        expect(
          chunk.text.startsWith("    ".repeat(chunk.indent + 1)),
          `fixture ${name}: chunk ${JSON.stringify(chunk.text)} over-indented past ${chunk.indent}`,
        ).toBe(false)
      }
    }
  })

  it("exportMarkdown output is byte-identical to exportMarkdownWithChunks(...).markdown", () => {
    // Run over the two richest fixtures (columns + mixed) — the ones where the
    // refactor could most plausibly diverge.
    for (const content of [fixtures.columnSeparator!, fixtures.mixed!, fixtures.toggleHeading!]) {
      const editor = editorFor(content)
      expect(exportMarkdown(editor)).toBe(exportMarkdownWithChunks(editor).markdown)
    }
  })
})
