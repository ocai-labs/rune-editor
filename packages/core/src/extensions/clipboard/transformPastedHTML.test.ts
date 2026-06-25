// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, expect, it } from "vitest"
import { Editor } from "@tiptap/core"
import { DOMParser as PMDOMParser } from "@tiptap/pm/model"
import { createRuneKit as kit } from "../../kit"
import { transformPastedHTML } from "./transformPastedHTML"

function withEditor<T>(
  fn: (editor: Editor) => T,
  kitOptions: Parameters<typeof kit>[0] = {},
): T {
  const editor = new Editor({
    extensions: kit(kitOptions),
    element: document.createElement("div"),
  })
  try { return fn(editor) } finally { editor.destroy() }
}

function transform(html: string, kitOptions: Parameters<typeof kit>[0] = {}): string {
  return withEditor((editor) => transformPastedHTML(html, editor.view, editor), kitOptions)
}

// Mirror the real paste pipeline: transformPastedHTML preprocesses the raw
// clipboard HTML, then PM's DOMParser maps it into doc blocks (block-fill wraps
// loose inline runs into paragraphs). Returns the top-level block names.
function pasteBlocks(html: string): string[] {
  return withEditor((editor) => {
    const transformed = transformPastedHTML(html, editor.view, editor)
    const dom = new DOMParser().parseFromString(transformed, "text/html")
    const docNode = PMDOMParser.fromSchema(editor.schema).parse(dom.body)
    const names: string[] = []
    docNode.forEach((node) => names.push(node.type.name))
    return names
  })
}

// Returns the text spans that carry a given mark after pasting `html`.
function pastedTextWithMark(html: string, markName: string): string[] {
  return withEditor((editor) => {
    const transformed = transformPastedHTML(html, editor.view, editor)
    const dom = new DOMParser().parseFromString(transformed, "text/html")
    const docNode = PMDOMParser.fromSchema(editor.schema).parse(dom.body)
    const out: string[] = []
    docNode.descendants((node) => {
      if (node.isText && node.marks.some((m) => m.type.name === markName)) {
        out.push(node.text ?? "")
      }
    })
    return out
  })
}

describe("transformPastedHTML", () => {

  it("passes known top-level <p> through unchanged", () => {
    expect(transform("<p>foo</p>")).toBe("<p>foo</p>")
  })

  it("passes known top-level <table> through unchanged (table is a schema block)", () => {
    const out = transform("<table><tr><td>a</td><td>b</td><td>c</td><td>d</td></tr></table>")
    // Table is now a known schema block; transformPastedHTML preserves it so
    // PM's DOMParser can parse it as a table node (not degrade to paragraphs).
    expect(out).toContain("<table")
    expect(out).toContain("<td>a</td>")
  })

  it("flattens <ul> to single-item list wrappers", () => {
    expect(transform("<ul><li>a</li><li>b</li><li>c</li></ul>")).toBe(
      '<ul><li data-rune-paste-depth="0" data-rune-paste-kind="bullet">a</li></ul>' +
        '<ul><li data-rune-paste-depth="0" data-rune-paste-kind="bullet">b</li></ul>' +
        '<ul><li data-rune-paste-depth="0" data-rune-paste-kind="bullet">c</li></ul>',
    )
  })

  it("Notion-shaped <div data-block-id><h2>T</h2></div> preserves H2", () => {
    expect(transform('<div data-block-id="x"><h2>T</h2></div>')).toBe('<h2>T</h2>')
  })

  it("multi-block Notion dump", () => {
    const html =
      '<div data-block-id="1"><p>para</p></div>' +
      '<div data-block-id="2"><h2>head</h2></div>' +
      '<div data-block-id="3"><ul><li>a</li><li>b</li></ul></div>'
    expect(transform(html)).toBe(
      "<p>para</p><h2>head</h2>" +
        '<ul><li data-rune-paste-depth="0" data-rune-paste-kind="bullet">a</li></ul>' +
        '<ul><li data-rune-paste-depth="0" data-rune-paste-kind="bullet">b</li></ul>',
    )
  })

  it("passes <table> with inline marks through unchanged (table is a schema block)", () => {
    const out = transform("<table><tr><td>foo <strong>bar</strong></td></tr></table>")
    // Table is a known schema block; marks inside cells survive for PM's
    // DOMParser to handle downstream (no degrade-to-paragraph step).
    expect(out).toContain("<table")
    expect(out).toContain("<strong>bar</strong>")
  })

  it("flattens nested mixed lists under a wrapper with depth and ordered start", () => {
    const out = transform('<div><ul><li>a<ol start="3"><li>b</li></ol></li></ul></div>')

    expect(out).toContain('data-rune-paste-depth="0"')
    expect(out).toContain('data-rune-paste-depth="1"')
    expect(out).toContain('<ol start="3"><li')
  })

  it("records task checkbox state and strips checkbox inputs", () => {
    const out = transform('<ul><li><input type="checkbox" checked> done</li></ul>')

    expect(out).toContain('data-rune-paste-checked="true"')
    expect(out).not.toContain('type="checkbox"')
  })

  it("wraps a task li from an ordered list as unordered and drops start", () => {
    const out = transform('<ol start="7"><li><input type="checkbox"> task</li></ol>')

    expect(out).toContain('<ul><li')
    expect(out).toContain('data-rune-paste-checked="false"')
    expect(out).not.toContain('<ol')
    expect(out).not.toContain('start="7"')
  })

  it("flattens an empty whitespace-only li as an empty bullet", () => {
    const out = transform("<ul><li>   </li></ul>")

    expect(out).toBe('<ul><li data-rune-paste-depth="0" data-rune-paste-kind="bullet">   </li></ul>')
  })

  it("emits an empty parent before nested-only list children", () => {
    const out = transform("<ul><li><ul><li>child</li></ul></li></ul>")

    expect(out).toContain('<ul><li data-rune-paste-depth="0" data-rune-paste-kind="bullet"></li></ul>')
    expect(out).toContain('<ul><li data-rune-paste-depth="1" data-rune-paste-kind="bullet">child</li></ul>')
  })

  it("retains inline marks inside flattened list items", () => {
    const out = transform("<ul><li>a <strong>b</strong></li></ul>")

    expect(out).toContain("a <strong>b</strong>")
  })

  it("finds and flattens list roots nested inside blockquotes", () => {
    const out = transform("<blockquote><ul><li>x</li></ul></blockquote>")

    expect(out).toBe('<ul><li data-rune-paste-depth="0" data-rune-paste-kind="bullet">x</li></ul>')
  })

  it("preserves non-whitespace text around flattened lists in wrappers", () => {
    const out = transform("<div>intro<ul><li>a</li></ul>outro</div>")

    expect(out).toBe(
      '<p>intro</p><ul><li data-rune-paste-depth="0" data-rune-paste-kind="bullet">a</li></ul><p>outro</p>',
    )
  })

  it("flattens depth two mixed nested lists in source order", () => {
    const out = transform("<ul><li>a<ol><li>b<ul><li>c</li></ul></li></ol></li></ul>")

    expect(out.match(/data-rune-paste-depth=/g)).toHaveLength(3)
    expect(out).toContain('data-rune-paste-depth="0"')
    expect(out).toContain('data-rune-paste-depth="1"')
    expect(out).toContain('data-rune-paste-depth="2"')
    expect(out.indexOf(">a</li>")).toBeLessThan(out.indexOf(">b</li>"))
    expect(out.indexOf(">b</li>")).toBeLessThan(out.indexOf(">c</li>"))
  })

  // #182 — heterogeneous-child wrapper. flattenLists hoists list roots out
  // of <ul>/<ol> nesting, but if a list shares a wrapper with non-list
  // siblings, the unwrap pass needs to splice them rather than punt the
  // whole wrapper to degrade (which would strip the list kind).
  describe("mixed-wrapper hoist (#182)", () => {
    it("hoists a flattened list out of a <div> alongside a <p> sibling", () => {
      const out = transform("<div><p>intro</p><ul><li>a</li></ul></div>")
      expect(out).toBe(
        "<p>intro</p>" +
          '<ul><li data-rune-paste-depth="0" data-rune-paste-kind="bullet">a</li></ul>',
      )
    })

    it("hoists a numbered list with start, preserves trailing paragraph in source order", () => {
      const out = transform(
        '<blockquote><ol start="3"><li>a</li><li>b</li></ol><p>after</p></blockquote>',
      )
      expect(out).toBe(
        '<ol start="3"><li data-rune-paste-depth="0" data-rune-paste-kind="numbered">a</li></ol>' +
          '<ol><li data-rune-paste-depth="0" data-rune-paste-kind="numbered">b</li></ol>' +
          "<p>after</p>",
      )
    })

    it("hoists nested mixed-wrapper lists at the right depths with trailing paragraph", () => {
      const out = transform(
        "<div><ul><li>a<ul><li>b</li></ul></li></ul><p>tail</p></div>",
      )
      expect(out).toBe(
        '<ul><li data-rune-paste-depth="0" data-rune-paste-kind="bullet">a</li></ul>' +
          '<ul><li data-rune-paste-depth="1" data-rune-paste-kind="bullet">b</li></ul>' +
          "<p>tail</p>",
      )
    })

    it("degrades unknown sibling elements but keeps list wrappers intact", () => {
      // <span> isn't in knownBlockTags; it should degrade, not vanish, and
      // it must NOT consume / wrap the sibling list.
      const out = transform("<div><span>note</span><ul><li>x</li></ul></div>")
      expect(out).toBe(
        "<p>note</p>" +
          '<ul><li data-rune-paste-depth="0" data-rune-paste-kind="bullet">x</li></ul>',
      )
    })

    it("leaves wrappers without any list inside them on the existing degrade path", () => {
      // No flattened list wrapper among children → return null and let the
      // top-level degrade handle the whole subtree. Schema-known block tags
      // (paragraph / table) are emitted WHOLE — not torn into orphan cells.
      const out = transform("<div><p>only</p><table><tr><td>x</td></tr></table></div>")
      expect(out).toBe("<p>only</p><table><tbody><tr><td>x</td></tr></tbody></table>")
    })

  })

  it("routes pasted img through data-rune-paste-image when importImageUrl exists", () => {
    const out = transform(
      '<p>before</p><img src="https://source.example/a.png" alt="A"><p>after</p>',
      { importImageUrl: () => Promise.resolve({ src: "x", width: 1, height: 1 }) },
    )

    expect(out).toContain("<p>before</p>")
    expect(out).toContain('data-rune-paste-image="https://source.example/a.png"')
    expect(out).not.toContain('src="https://source.example/a.png"')
    expect(out).toContain("<p>after</p>")
  })

  it("preserves pasted img raw src when importImageUrl is absent", () => {
    expect(transform('<img src="https://source.example/a.png" alt="A">'))
      .toBe('<img src="https://source.example/a.png" alt="A">')
  })

  // A single paragraph copied from Notion arrives as a flat run of top-level
  // text nodes interleaved with inline elements (a `<span>` for colored text, a
  // `<div style="display:inline">` for inline-code) — NOT wrapped in a `<p>`.
  // Degrading those inline elements to block `<p>`s used to fragment the one
  // paragraph into N blocks (the inline boundaries became block boundaries).
  describe("inline-rooted paste stays one paragraph (Notion single paragraph)", () => {
    const NOTION_PARAGRAPH =
      `Make a new page and type ` +
      `<div class="notion-inline-code-container" style="display:inline">` +
      `<span style="color:#EB5757" data-token-index="1">/meet</span></div>` +
      ` to capture meeting ` +
      `<span style="color:rgba(44, 44, 43, 1)" data-token-index="3">notes </span>` +
      `and thoughts effortlessly`

    it("folds the whole inline run into a single paragraph", () => {
      expect(pasteBlocks(NOTION_PARAGRAPH)).toEqual(["paragraph"])
    })

    it("does not inject block <p> boundaries into the inline run", () => {
      const out = transform(NOTION_PARAGRAPH)
      expect(out).not.toContain("<p>")
      // inline-code <div> → <code> (inline); colored span stays a span
      expect(out).not.toContain("notion-inline-code-container")
      expect(out).toContain("<code>/meet</code>")
      expect(out).toContain(">notes </span>")
    })

    it("keeps a bare top-level <span> as inline content, not a paragraph", () => {
      expect(pasteBlocks("hello <span>world</span> again")).toEqual(["paragraph"])
    })

    it("still degrades a genuine block <div> wrapper to a paragraph", () => {
      // No inline display + block tag → unchanged degrade behavior.
      expect(transform("<div>plain block</div>")).toBe("<p>plain block</p>")
    })

    it("preserves Notion inline code as a real <code> carrying the code mark", () => {
      // The notion-inline-code-container is rewritten to <code> so PM's code
      // mark matches; only "/meet" carries the mark, the rest is plain text.
      expect(pastedTextWithMark(NOTION_PARAGRAPH, "code")).toEqual(["/meet"])
      expect(transform(NOTION_PARAGRAPH)).toContain("<code>/meet</code>")
    })
  })

  it("keeps image marker alongside existing list flattening", () => {
    const out = transform(
      '<div><p>intro</p><img src="https://source.example/a.png"><ul><li>x</li></ul></div>',
      { importImageUrl: () => Promise.resolve({ src: "x", width: 1, height: 1 }) },
    )

    expect(out).toContain("<p>intro</p>")
    expect(out).toContain('data-rune-paste-image="https://source.example/a.png"')
    expect(out).toContain('data-rune-paste-kind="bullet"')
  })
})
