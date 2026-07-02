// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, it, expect } from "vitest"
import { createTestEditor } from "../../../test-utils/createTestEditor"
import { serializeInlineContent } from "../serializeInline"

function inlineFromEditor(json: Record<string, unknown>): string {
  const editor = createTestEditor({
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { id: "p1", depth: 0 },
          ...json,
        },
      ],
    },
  })
  const para = editor.state.doc.firstChild!
  return serializeInlineContent(para)
}

describe("serializeInlineContent", () => {
  it("serializes plain text", () => {
    expect(
      inlineFromEditor({
        content: [{ type: "text", text: "hello world" }],
      }),
    ).toBe("hello world")
  })

  it("serializes bold", () => {
    expect(
      inlineFromEditor({
        content: [
          { type: "text", marks: [{ type: "bold" }], text: "bold" },
        ],
      }),
    ).toBe("**bold**")
  })

  it("serializes italic", () => {
    expect(
      inlineFromEditor({
        content: [
          { type: "text", marks: [{ type: "italic" }], text: "italic" },
        ],
      }),
    ).toBe("*italic*")
  })

  it("serializes strikethrough", () => {
    expect(
      inlineFromEditor({
        content: [
          { type: "text", marks: [{ type: "strike" }], text: "struck" },
        ],
      }),
    ).toBe("~~struck~~")
  })

  it("serializes inline code", () => {
    expect(
      inlineFromEditor({
        content: [
          { type: "text", marks: [{ type: "code" }], text: "code" },
        ],
      }),
    ).toBe("`code`")
  })

  it("serializes link", () => {
    expect(
      inlineFromEditor({
        content: [
          {
            type: "text",
            marks: [
              { type: "link", attrs: { href: "https://example.com" } },
            ],
            text: "click",
          },
        ],
      }),
    ).toBe("[click](https://example.com)")
  })

  it("serializes wikiLink with matching text and target", () => {
    expect(
      inlineFromEditor({
        content: [
          {
            type: "text",
            marks: [{ type: "wikiLink", attrs: { target: "My Page" } }],
            text: "My Page",
          },
        ],
      }),
    ).toBe("[[My Page]]")
  })

  it("serializes wikiLink with differing display text", () => {
    expect(
      inlineFromEditor({
        content: [
          {
            type: "text",
            marks: [{ type: "wikiLink", attrs: { target: "Target" } }],
            text: "Display",
          },
        ],
      }),
    ).toBe("[[Target|Display]]")
  })

  it("serializes underline as <u>", () => {
    expect(
      inlineFromEditor({
        content: [
          { type: "text", marks: [{ type: "underline" }], text: "under" },
        ],
      }),
    ).toBe("<u>under</u>")
  })

  it("serializes textStyle textColor as a data-text-color span", () => {
    expect(
      inlineFromEditor({
        content: [
          {
            type: "text",
            marks: [{ type: "textStyle", attrs: { textColor: "blue" } }],
            text: "blue text",
          },
        ],
      }),
    ).toBe('<span data-text-color="blue">blue text</span>')
  })

  it("serializes textStyle backgroundColor as a data-background-color span", () => {
    expect(
      inlineFromEditor({
        content: [
          {
            type: "text",
            marks: [
              { type: "textStyle", attrs: { backgroundColor: "yellow" } },
            ],
            text: "hi",
          },
        ],
      }),
    ).toBe('<span data-background-color="yellow">hi</span>')
  })

  it("serializes textStyle with both colors in one span", () => {
    expect(
      inlineFromEditor({
        content: [
          {
            type: "text",
            marks: [
              {
                type: "textStyle",
                attrs: { textColor: "blue", backgroundColor: "yellow" },
              },
            ],
            text: "both",
          },
        ],
      }),
    ).toBe(
      '<span data-text-color="blue" data-background-color="yellow">both</span>',
    )
  })

  it("emits no wrapper for an attr-less textStyle mark", () => {
    expect(
      inlineFromEditor({
        content: [
          {
            type: "text",
            marks: [
              {
                type: "textStyle",
                attrs: { textColor: null, backgroundColor: null },
              },
            ],
            text: "plain",
          },
        ],
      }),
    ).toBe("plain")
  })

  it("nests link ⊃ bold ⊃ colored text", () => {
    expect(
      inlineFromEditor({
        content: [
          {
            type: "text",
            marks: [
              { type: "link", attrs: { href: "https://example.com" } },
              { type: "bold" },
              { type: "textStyle", attrs: { textColor: "blue" } },
            ],
            text: "deep",
          },
        ],
      }),
    ).toBe(
      '<span data-text-color="blue">[**deep**](https://example.com)</span>',
    )
  })

  it("wraps a color span OUTSIDE inline code so it can round-trip", () => {
    expect(
      inlineFromEditor({
        content: [
          {
            type: "text",
            marks: [
              { type: "code" },
              { type: "textStyle", attrs: { textColor: "blue" } },
            ],
            text: "fn()",
          },
        ],
      }),
    ).toBe('<span data-text-color="blue">`fn()`</span>')
  })

  it("wraps bold OUTSIDE inline code (code innermost, not `**x**`)", () => {
    expect(
      inlineFromEditor({
        content: [
          {
            type: "text",
            marks: [{ type: "code" }, { type: "bold" }],
            text: "x",
          },
        ],
      }),
    ).toBe("**`x`**")
  })

  it("wraps a link OUTSIDE inline code (code innermost)", () => {
    // code + link can't coexist in a live doc (Code excludes link), so this can
    // never round-trip; the serializer must still emit code innermost.
    expect(
      inlineFromEditor({
        content: [
          {
            type: "text",
            marks: [
              { type: "link", attrs: { href: "https://example.com" } },
              { type: "code" },
            ],
            text: "x",
          },
        ],
      }),
    ).toBe("[`x`](https://example.com)")
  })

  it("orders html outermost, bold middle, code innermost (all three)", () => {
    expect(
      inlineFromEditor({
        content: [
          {
            type: "text",
            marks: [
              { type: "code" },
              { type: "bold" },
              { type: "textStyle", attrs: { textColor: "blue" } },
            ],
            text: "x",
          },
        ],
      }),
    ).toBe('<span data-text-color="blue">**`x`**</span>')
  })

  it("serializes multiple marks — bold italic", () => {
    expect(
      inlineFromEditor({
        content: [
          {
            type: "text",
            marks: [{ type: "bold" }, { type: "italic" }],
            text: "both",
          },
        ],
      }),
    ).toBe("***both***")
  })

  it("serializes mixed inline runs", () => {
    expect(
      inlineFromEditor({
        content: [
          { type: "text", text: "plain " },
          { type: "text", marks: [{ type: "bold" }], text: "bold" },
          { type: "text", text: " end" },
        ],
      }),
    ).toBe("plain **bold** end")
  })

  it("serializes inlineMath atom node", () => {
    expect(
      inlineFromEditor({
        content: [
          { type: "text", text: "energy is " },
          {
            type: "inlineMath",
            attrs: { latex: "E = mc^2" },
          },
        ],
      }),
    ).toBe("energy is $E = mc^2$")
  })

  it("returns empty string for empty content", () => {
    expect(inlineFromEditor({})).toBe("")
  })

  it("escapes brackets in link text", () => {
    expect(
      inlineFromEditor({
        content: [
          {
            type: "text",
            marks: [
              { type: "link", attrs: { href: "https://example.com" } },
            ],
            text: "[test]",
          },
        ],
      }),
    ).toBe("[\\[test\\]](https://example.com)")
  })

  it("escapes parentheses in link href", () => {
    expect(
      inlineFromEditor({
        content: [
          {
            type: "text",
            marks: [
              {
                type: "link",
                attrs: { href: "https://example.com/page_(1)" },
              },
            ],
            text: "link",
          },
        ],
      }),
    ).toBe("[link](https://example.com/page_\\(1\\))")
  })

  it("wraps code containing backtick with double backticks", () => {
    expect(
      inlineFromEditor({
        content: [
          {
            type: "text",
            marks: [{ type: "code" }],
            text: "code`here",
          },
        ],
      }),
    ).toBe("`` code`here ``")
  })

  describe("plain-text escaping", () => {
    const plain = (text: string) =>
      inlineFromEditor({ content: [{ type: "text", text }] })

    it("escapes emphasis-looking asterisks", () => {
      expect(plain("*not italic*")).toBe("\\*not italic\\*")
    })

    it("escapes underscores", () => {
      expect(plain("_under_")).toBe("\\_under\\_")
    })

    it("escapes a literal backtick in plain text", () => {
      expect(plain("a`b")).toBe("a\\`b")
    })

    it("escapes brackets in plain text", () => {
      expect(plain("[brackets]")).toBe("\\[brackets\\]")
    })

    it("escapes a backslash before other escapes", () => {
      expect(plain("a\\*b")).toBe("a\\\\\\*b")
    })

    it("neutralizes a tag-like < but leaves `< 3` alone", () => {
      expect(plain("<tag>")).toBe("&lt;tag>")
      expect(plain("</p>")).toBe("&lt;/p>")
      expect(plain("< 3")).toBe("< 3")
    })

    it("escapes only entity-like ampersands", () => {
      expect(plain("&amp;")).toBe("&amp;amp;")
      expect(plain("&#39;")).toBe("&amp;#39;")
      expect(plain("Tom & Jerry")).toBe("Tom & Jerry")
      expect(plain("Q&A")).toBe("Q&A")
    })

    it("escapes dollar signs so they are not read as inline math", () => {
      expect(plain("$5 and $6")).toBe("\\$5 and \\$6")
    })

    it("escapes a leading heading marker", () => {
      expect(plain("# not a heading")).toBe("\\# not a heading")
    })

    it("escapes a leading ordered-list marker", () => {
      expect(plain("1. not a list")).toBe("1\\. not a list")
    })

    it("escapes a leading bullet marker", () => {
      expect(plain("- not a bullet")).toBe("\\- not a bullet")
    })

    it("escapes a leading blockquote marker", () => {
      expect(plain("> not a quote")).toBe("\\> not a quote")
    })

    it("leaves a mid-line hash and a spaced hash-word alone", () => {
      expect(plain("use # here")).toBe("use # here")
      expect(plain("#hashtag")).toBe("#hashtag")
    })
  })
})
