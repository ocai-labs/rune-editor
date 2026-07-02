// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The Tier 0 gate: serialize (exportMarkdown) → scoped parse (parseAiMarkdown)
// must be structurally identical to the original doc content. This is THE
// contract that makes the `apply_edits` quote-don't-compute path safe — if the
// round-trip holds, a whole-block re-parse is equivalent to a surgical splice.
// See internal design notes.

import { describe, it, expect } from "vitest"
import type { JSONContent } from "@tiptap/core"
import { createTestEditor } from "../../../test-utils/createTestEditor"
import { exportMarkdown } from "../markdown"
import { parseAiMarkdown } from "../../../extensions/clipboard/aiMarkdown"

// ── structural canonicalization ────────────────────────────────────────────
// Compare only what markdown can represent: block type/order/depth, the
// props markdown carries (level, language, checked, start…), text, and marks
// with attrs. Block `id`s never survive a parse, so strip them; a null/absent
// attr and an omitted one are the same thing (default), so drop nulls; marks
// are sorted by type so nesting-order canonicalization on both sides matches.

type Attrs = Record<string, unknown>

function canonAttrs(attrs?: Attrs): Attrs | undefined {
  if (!attrs) return undefined
  const out: Attrs = {}
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "id") continue
    if (v === null || v === undefined) continue
    out[k] = v
  }
  return Object.keys(out).length > 0 ? out : undefined
}

interface CanonMark {
  type: string
  attrs?: Attrs
}

function canonMarks(marks?: Array<{ type: string; attrs?: Attrs }>): CanonMark[] | undefined {
  if (!marks || marks.length === 0) return undefined
  return marks
    .map((m) => {
      const attrs = canonAttrs(m.attrs)
      return attrs ? { type: m.type, attrs } : { type: m.type }
    })
    .sort((a, b) => a.type.localeCompare(b.type))
}

function canon(node: JSONContent): JSONContent {
  const out: JSONContent = { type: node.type }
  const attrs = canonAttrs(node.attrs)
  if (attrs) out.attrs = attrs
  if (typeof node.text === "string") out.text = node.text
  const marks = canonMarks(node.marks as CanonMark[] | undefined)
  if (marks) out.marks = marks as JSONContent["marks"]
  if (Array.isArray(node.content)) out.content = node.content.map(canon)
  return out
}

function roundTrip(content: JSONContent[]) {
  const editor = createTestEditor({ content: { type: "doc", content } })
  const markdown = exportMarkdown(editor)
  const parsed = parseAiMarkdown(markdown, editor.schema)
  const original = editor.state.doc.toJSON() as JSONContent
  return { markdown, parsed, original }
}

function expectRoundTrip(content: JSONContent[], label = ""): string {
  const { markdown, parsed, original } = roundTrip(content)
  const got = canon(parsed)
  const want = canon(original)
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    // eslint-disable-next-line no-console
    console.error(`[roundtrip ${label}] markdown was: ${JSON.stringify(markdown)}`)
  }
  expect(got).toEqual(want)
  return markdown
}

// Convenience builders.
const para = (content: JSONContent[]): JSONContent => ({
  type: "paragraph",
  attrs: { id: "b", depth: 0 },
  content,
})
const text = (t: string, marks?: JSONContent["marks"]): JSONContent =>
  marks ? { type: "text", text: t, marks } : { type: "text", text: t }

describe("exportMarkdown → parseAiMarkdown round-trip", () => {
  describe("inline styling matrix", () => {
    it("inline code", () => {
      expectRoundTrip([para([text("call "), text("fn()", [{ type: "code" }])])], "code")
    })

    it("code + color (the headline case: code mark + textStyle mark on same text)", () => {
      const md = expectRoundTrip(
        [
          para([
            text("fn()", [
              { type: "code" },
              { type: "textStyle", attrs: { textColor: "blue" } },
            ]),
          ]),
        ],
        "code+color",
      )
      // Sanity: the span must sit OUTSIDE the backticks in the dialect.
      expect(md).toContain('<span data-text-color="blue">`fn()`</span>')
    })

    it("bold / italic / strike", () => {
      expectRoundTrip(
        [
          para([
            text("b", [{ type: "bold" }]),
            text(" "),
            text("i", [{ type: "italic" }]),
            text(" "),
            text("s", [{ type: "strike" }]),
          ]),
        ],
        "bis",
      )
    })

    it("links", () => {
      expectRoundTrip(
        [para([text("click", [{ type: "link", attrs: { href: "https://example.com" } }])])],
        "link",
      )
    })

    it("nested marks (link ⊃ bold ⊃ colored text)", () => {
      expectRoundTrip(
        [
          para([
            text("deep", [
              { type: "link", attrs: { href: "https://example.com" } },
              { type: "bold" },
              { type: "textStyle", attrs: { textColor: "blue" } },
            ]),
          ]),
        ],
        "nested",
      )
    })

    it("color-only span (same text, only textStyle differs)", () => {
      expectRoundTrip(
        [
          para([
            text("plain "),
            text("colored", [{ type: "textStyle", attrs: { textColor: "red" } }]),
          ]),
        ],
        "color-only",
      )
    })

    it("background-color span", () => {
      expectRoundTrip(
        [para([text("hi", [{ type: "textStyle", attrs: { backgroundColor: "yellow" } }])])],
        "bg-color",
      )
    })

    it("underline", () => {
      expectRoundTrip([para([text("under", [{ type: "underline" }])])], "underline")
    })

    it("wikiLink without alias", () => {
      expectRoundTrip(
        [para([text("My Page", [{ type: "wikiLink", attrs: { target: "My Page" } }])])],
        "wiki-noalias",
      )
    })

    it("wikiLink with alias", () => {
      expectRoundTrip(
        [para([text("Display", [{ type: "wikiLink", attrs: { target: "Target" } }])])],
        "wiki-alias",
      )
    })

    it("inlineMath", () => {
      expectRoundTrip(
        [
          para([
            text("energy is "),
            { type: "inlineMath", attrs: { latex: "E = mc^2" } },
          ]),
        ],
        "math",
      )
    })
  })

  // `code` content is verbatim on re-parse, so every OTHER mark's syntax must
  // wrap OUTSIDE the backticks or it can never round-trip (bold inside backticks
  // is literal `**x**` text). Before the code-innermost fix these all serialized
  // as `` `**x**` `` / `` `[x](url)` `` and failed the structural compare.
  describe("code wraps innermost among markdown marks (A1)", () => {
    it("code + bold", () => {
      const md = expectRoundTrip(
        [para([text("x", [{ type: "code" }, { type: "bold" }])])],
        "code+bold",
      )
      expect(md).toContain("**`x`**")
    })

    it("code + italic", () => {
      const md = expectRoundTrip(
        [para([text("x", [{ type: "code" }, { type: "italic" }])])],
        "code+italic",
      )
      expect(md).toContain("*`x`*")
    })

    it("code + strike", () => {
      const md = expectRoundTrip(
        [para([text("x", [{ type: "code" }, { type: "strike" }])])],
        "code+strike",
      )
      expect(md).toContain("~~`x`~~")
    })

    // NOTE: code + link is NOT a round-trip case — the schema's
    // `Code.extend({ excludes: "link wikiLink internalRef" })` forbids the two
    // marks coexisting, so a code span inside link text drops the link mark on
    // re-parse. Its serialization order (code innermost → `[`x`](url)`) is
    // pinned in serializeInline.test.ts instead.

    it("code + bold + color (html outermost, bold middle, code innermost)", () => {
      const md = expectRoundTrip(
        [
          para([
            text("x", [
              { type: "code" },
              { type: "bold" },
              { type: "textStyle", attrs: { textColor: "blue" } },
            ]),
          ]),
        ],
        "code+bold+color",
      )
      expect(md).toContain('<span data-text-color="blue">**`x`**</span>')
    })

    it("a paragraph mixing a plain code span AND a bold+code span", () => {
      const md = expectRoundTrip(
        [
          para([
            text("plain "),
            text("a", [{ type: "code" }]),
            text(" and "),
            text("b", [{ type: "code" }, { type: "bold" }]),
          ]),
        ],
        "mixed-code",
      )
      expect(md).toContain("`a`")
      expect(md).toContain("**`b`**")
    })
  })

  describe("adversarial literals in plain text", () => {
    const plain = (t: string, label: string) => expectRoundTrip([para([text(t)])], label)

    it("*not italic*", () => plain("*not italic*", "asterisks"))
    it("_under_", () => plain("_under_", "underscores"))
    it("backtick in text", () => plain("a`b`c", "backtick"))
    it("[brackets]", () => plain("[brackets] and [[wiki-ish]]", "brackets"))
    it("<angle> and < 3", () => plain("<angle> and < 3 and </p>", "angle"))
    it("R&D and &amp;-looking text", () => plain("R&D and &amp; and Q&A", "amp"))
    it("$5 and $6", () => plain("$5 and $6", "dollars"))
    it("paragraph starting with '# '", () => plain("# not a heading", "hash"))
    it("paragraph starting with '1. '", () => plain("1. not a list", "ol"))
    it("paragraph starting with '- '", () => plain("- not a bullet", "ul"))
    it("paragraph starting with '> '", () => plain("> not a quote", "quote"))

    // A bare URL/email in unlinked plain text must NOT acquire a `link` mark on
    // re-parse — the dialect only ever emits explicit `[text](href)` links, so
    // auto-linkification would silently mutate unedited text under the
    // whole-block re-parse editing model (the exact failure round-trip guards).
    it("bare URL as plain (unlinked) text", () =>
      plain("see https://example.com now", "bare-url"))
    it("bare email as plain (unlinked) text", () =>
      plain("contact foo@example.com please", "bare-email"))
  })

  describe("block-level sweep", () => {
    it("headings at every level (axis-shift symmetry)", () => {
      expectRoundTrip(
        [2, 3, 4, 5].map((level, i) => ({
          type: "heading",
          attrs: { id: `h${i}`, depth: 0, level },
          content: [text(`H level ${level}`)],
        })),
        "headings",
      )
    })

    it("bullet list incl. nesting", () => {
      expectRoundTrip(
        [
          { type: "bulletList", attrs: { id: "a", depth: 0 }, content: [text("parent")] },
          { type: "bulletList", attrs: { id: "b", depth: 1 }, content: [text("child")] },
          { type: "bulletList", attrs: { id: "c", depth: 0 }, content: [text("sibling")] },
        ],
        "bullets",
      )
    })

    it("numbered list", () => {
      expectRoundTrip(
        [
          { type: "numberedList", attrs: { id: "a", depth: 0 }, content: [text("first")] },
          { type: "numberedList", attrs: { id: "b", depth: 0 }, content: [text("second")] },
          { type: "numberedList", attrs: { id: "c", depth: 0 }, content: [text("third")] },
        ],
        "numbered",
      )
    })

    it("task list (checked + unchecked)", () => {
      expectRoundTrip(
        [
          { type: "taskList", attrs: { id: "a", depth: 0, checked: true }, content: [text("done")] },
          { type: "taskList", attrs: { id: "b", depth: 0, checked: false }, content: [text("todo")] },
        ],
        "tasks",
      )
    })

    it("quote", () => {
      expectRoundTrip(
        [{ type: "blockquote", attrs: { id: "a", depth: 0 }, content: [text("a wise quote")] }],
        "quote",
      )
    })

    it("code block (fenced content stays literal — no escaping inside)", () => {
      const md = expectRoundTrip(
        [
          {
            type: "codeBlock",
            attrs: { id: "a", depth: 0, language: "js" },
            content: [text("const x = *not italic*\nif (a < b) return `x`")],
          },
        ],
        "codeblock",
      )
      // The fence body must carry the literal markdown, unescaped.
      expect(md).toContain("const x = *not italic*")
    })

    it("a doc mixing all of the above", () => {
      expectRoundTrip(
        [
          { type: "heading", attrs: { id: "h", depth: 0, level: 2 }, content: [text("Title")] },
          para([
            text("intro with "),
            text("bold", [{ type: "bold" }]),
            text(" and "),
            text("code", [{ type: "code" }]),
            text(" and a "),
            text("link", [{ type: "link", attrs: { href: "https://x.dev" } }]),
            text("."),
          ]),
          { type: "bulletList", attrs: { id: "u1", depth: 0 }, content: [text("one")] },
          { type: "bulletList", attrs: { id: "u2", depth: 1 }, content: [text("nested")] },
          { type: "numberedList", attrs: { id: "o1", depth: 0 }, content: [text("step 1")] },
          { type: "numberedList", attrs: { id: "o2", depth: 0 }, content: [text("step 2")] },
          { type: "blockquote", attrs: { id: "q", depth: 0 }, content: [text("quote")] },
          {
            type: "codeBlock",
            attrs: { id: "c", depth: 0, language: "ts" },
            content: [text("const a = 1")],
          },
          para([
            text("colored", [{ type: "textStyle", attrs: { textColor: "blue" } }]),
            text(" and "),
            text("Wiki", [{ type: "wikiLink", attrs: { target: "Some Page" } }]),
          ]),
        ],
        "mixed",
      )
    })
  })
})

// ── sanitizer (parse-only; hostile input must be neutralized) ───────────────

function nodesOfType(doc: JSONContent, type: string): JSONContent[] {
  const out: JSONContent[] = []
  const walk = (n: JSONContent) => {
    if (n.type === type) out.push(n)
    n.content?.forEach(walk)
  }
  walk(doc)
  return out
}

function allText(doc: JSONContent): string {
  let s = ""
  const walk = (n: JSONContent) => {
    if (typeof n.text === "string") s += n.text
    n.content?.forEach(walk)
  }
  walk(doc)
  return s
}

function allMarkTypes(doc: JSONContent): Set<string> {
  const set = new Set<string>()
  const walk = (n: JSONContent) => {
    for (const m of (n.marks ?? []) as Array<{ type: string }>) set.add(m.type)
    n.content?.forEach(walk)
  }
  walk(doc)
  return set
}

describe("parseAiMarkdown — raw-HTML sanitizer", () => {
  function schema() {
    const editor = createTestEditor({})
    return editor.schema
  }

  it("neutralizes <script> to literal text", () => {
    const doc = parseAiMarkdown("before <script>alert(1)</script> after", schema())
    expect(nodesOfType(doc, "script")).toHaveLength(0)
    // The script never becomes an element; its payload survives as literal text.
    expect(allText(doc)).toContain("alert(1)")
    expect(allText(doc)).toContain("script")
  })

  it("neutralizes <img onerror=…> (no image node, no live tag)", () => {
    const doc = parseAiMarkdown('x <img src=x onerror="alert(1)"> y', schema())
    expect(nodesOfType(doc, "image")).toHaveLength(0)
    expect(allText(doc)).toContain("onerror")
    expect(allText(doc)).toContain("img")
  })

  it("neutralizes <span style=…> (no textStyle mark, text preserved)", () => {
    const doc = parseAiMarkdown('a <span style="color:red">x</span> b', schema())
    expect(allMarkTypes(doc).has("textStyle")).toBe(false)
    expect(allText(doc)).toContain("x")
    expect(allText(doc)).toContain("style")
  })

  it("neutralizes a color span carrying an event handler", () => {
    const doc = parseAiMarkdown(
      'a <span data-text-color="blue" onclick="steal()">x</span> b',
      schema(),
    )
    // The whole opening tag is rejected because of the onclick attr — no
    // textStyle mark is produced, and the handler survives only as inert text.
    expect(allMarkTypes(doc).has("textStyle")).toBe(false)
    expect(allText(doc)).toContain("onclick")
    expect(allText(doc)).toContain("x")
  })

  it("still admits the whitelisted color span + underline", () => {
    const doc = parseAiMarkdown(
      'a <span data-text-color="blue">x</span> <u>y</u>',
      schema(),
    )
    const marks = allMarkTypes(doc)
    expect(marks.has("textStyle")).toBe(true)
    expect(marks.has("underline")).toBe(true)
  })
})
