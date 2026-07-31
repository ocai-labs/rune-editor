// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// packages/core/src/api/export/__tests__/markdown.test.ts
import { describe, it, expect } from "vitest"
import type { JSONContent } from "@tiptap/core"
import { createTestEditor } from "../../../test-utils/createTestEditor"
import { exportMarkdown, exportMarkdownWithChunks } from "../markdown"

function md(content: unknown[]): string {
  const editor = createTestEditor({
    content: { type: "doc", content: content as JSONContent[] },
  })
  return exportMarkdown(editor)
}

function block(
  type: string,
  text: string,
  attrs?: Record<string, unknown>,
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>,
) {
  const node: Record<string, unknown> = {
    type,
    attrs: { id: `${type}-1`, depth: 0, ...attrs },
  }
  if (text) {
    const textNode: Record<string, unknown> = { type: "text", text }
    if (marks) textNode.marks = marks
    node.content = [textNode]
  }
  return node
}

describe("exportMarkdown", () => {
  describe("paragraph", () => {
    it("exports paragraph", () => {
      expect(md([block("paragraph", "Hello world")])).toBe("Hello world\n")
    })

    it("exports empty paragraph as blank line", () => {
      expect(md([block("paragraph", "")])).toBe("\n")
    })

    it("separates paragraphs with blank line", () => {
      expect(
        md([block("paragraph", "First"), block("paragraph", "Second")]),
      ).toBe("First\n\nSecond\n")
    })
  })

  describe("heading", () => {
    it("exports heading level 1 as #", () => {
      expect(md([block("heading", "Title", { level: 1 })])).toBe("# Title\n")
    })
    it("exports heading level 2 as ##", () => {
      expect(md([block("heading", "Sub", { level: 2 })])).toBe("## Sub\n")
    })
    it("exports heading level 3 as ###", () => {
      expect(md([block("heading", "Sub2", { level: 3 })])).toBe("### Sub2\n")
    })
    it("exports heading level 4 as ####", () => {
      expect(md([block("heading", "Sub3", { level: 4 })])).toBe("#### Sub3\n")
    })
  })

  describe("blockquote", () => {
    it("exports blockquote", () => {
      expect(md([block("blockquote", "quoted")])).toBe("> quoted\n")
    })
  })

  describe("bullet list", () => {
    it("exports bullet list", () => {
      expect(md([block("bulletList", "item")])).toBe("- item\n")
    })
    it("exports nested bullets", () => {
      expect(
        md([
          block("bulletList", "parent", { depth: 0 }),
          block("bulletList", "child", { depth: 1 }),
        ]),
      ).toBe("- parent\n    - child\n")
    })
    it("consecutive bullets have no blank line", () => {
      expect(
        md([block("bulletList", "a"), block("bulletList", "b")]),
      ).toBe("- a\n- b\n")
    })
  })

  describe("numbered list", () => {
    it("exports numbered list with counter", () => {
      expect(
        md([block("numberedList", "first"), block("numberedList", "second")]),
      ).toBe("1. first\n2. second\n")
    })
    it("resets counter after non-numbered block", () => {
      expect(
        md([
          block("numberedList", "one"),
          block("paragraph", "break"),
          block("numberedList", "restart"),
        ]),
      ).toBe("1. one\n\nbreak\n\n1. restart\n")
    })
    it("preserves parent counter after nested children", () => {
      expect(
        md([
          block("numberedList", "A", { depth: 0 }),
          block("numberedList", "X", { depth: 1 }),
          block("numberedList", "Y", { depth: 1 }),
          block("numberedList", "B", { depth: 0 }),
        ]),
      ).toBe("1. A\n    1. X\n    2. Y\n2. B\n")
    })
    it("uses start attr for first item", () => {
      expect(md([block("numberedList", "third", { start: 3 })])).toBe("3. third\n")
    })
    it("preserves parent counter when child is different list type", () => {
      expect(
        md([
          block("numberedList", "A", { depth: 0 }),
          block("bulletList", "bullet child", { depth: 1 }),
          block("numberedList", "B", { depth: 0 }),
        ]),
      ).toBe("1. A\n    - bullet child\n2. B\n")
    })
  })

  describe("task list", () => {
    it("exports unchecked task", () => {
      expect(md([block("taskList", "todo", { checked: false })])).toBe("- [ ]  todo\n")
    })
    it("exports checked task", () => {
      expect(md([block("taskList", "done", { checked: true })])).toBe("- [x]  done\n")
    })
  })

  describe("code block", () => {
    it("exports code block with language", () => {
      expect(
        md([{
          type: "codeBlock",
          attrs: { id: "cb1", depth: 0, language: "ts" },
          content: [{ type: "text", text: "const x = 1" }],
        }]),
      ).toBe("```ts\nconst x = 1\n```\n")
    })
    it("exports code block without language", () => {
      expect(
        md([{
          type: "codeBlock",
          attrs: { id: "cb1", depth: 0, language: null },
          content: [{ type: "text", text: "plain" }],
        }]),
      ).toBe("```\nplain\n```\n")
    })
  })

  describe("equation block", () => {
    it("exports equation block", () => {
      expect(
        md([{
          type: "equationBlock",
          attrs: { id: "eq1", depth: 0, latex: "E = mc^2" },
        }]),
      ).toBe("$$\nE = mc^2\n$$\n")
    })
  })

  describe("divider", () => {
    it("exports divider", () => {
      expect(md([{ type: "divider", attrs: { id: "d1", depth: 0 } }])).toBe("---\n")
    })
  })

  describe("image", () => {
    it("exports image with alt", () => {
      expect(
        md([{
          type: "image",
          attrs: {
            id: "img1", depth: 0,
            src: "https://example.com/pic.png", alt: "A picture",
            width: null, height: null, sourceUrl: null, pendingFromPaste: null,
          },
        }]),
      ).toBe("![A picture](https://example.com/pic.png)\n")
    })
    it("exports image without alt", () => {
      expect(
        md([{
          type: "image",
          attrs: {
            id: "img1", depth: 0,
            src: "https://example.com/pic.png", alt: "",
            width: null, height: null, sourceUrl: null, pendingFromPaste: null,
          },
        }]),
      ).toBe("![](https://example.com/pic.png)\n")
    })
  })

  describe("video", () => {
    it("exports asset video", () => {
      expect(
        md([{
          type: "video",
          attrs: {
            id: "v1", depth: 0, sourceType: "asset",
            src: "https://cdn.example.com/video.mp4",
            embedUrl: null, provider: null, sourceUrl: null,
            title: "My clip", width: null, height: null,
          },
        }]),
      ).toBe("[My clip](https://cdn.example.com/video.mp4)\n")
    })
    it("exports embed video", () => {
      expect(
        md([{
          type: "video",
          attrs: {
            id: "v2", depth: 0, sourceType: "embed", src: "",
            embedUrl: "https://www.youtube.com/embed/abc",
            provider: "youtube",
            sourceUrl: "https://www.youtube.com/watch?v=abc",
            title: "YouTube vid", width: 640, height: 360,
          },
        }]),
      ).toBe("[YouTube vid](https://www.youtube.com/embed/abc)\n")
    })
    it("defaults title to Video when empty", () => {
      expect(
        md([{
          type: "video",
          attrs: {
            id: "v3", depth: 0, sourceType: "asset",
            src: "https://cdn.example.com/clip.mp4",
            embedUrl: null, provider: null, sourceUrl: null,
            title: "", width: null, height: null,
          },
        }]),
      ).toBe("[Video](https://cdn.example.com/clip.mp4)\n")
    })
  })

  describe("audio", () => {
    it("exports asset audio", () => {
      expect(
        md([{
          type: "audio",
          attrs: {
            id: "a1", depth: 0, sourceType: "asset",
            src: "https://cdn.example.com/song.mp3",
            embedUrl: null, provider: null, sourceUrl: null,
            title: "My song", width: null, height: null,
          },
        }]),
      ).toBe("[My song](https://cdn.example.com/song.mp3)\n")
    })
    it("defaults title to Audio when empty", () => {
      expect(
        md([{
          type: "audio",
          attrs: {
            id: "a2", depth: 0, sourceType: "asset",
            src: "https://cdn.example.com/clip.wav",
            embedUrl: null, provider: null, sourceUrl: null,
            title: "", width: null, height: null,
          },
        }]),
      ).toBe("[Audio](https://cdn.example.com/clip.wav)\n")
    })
  })

  describe("tableOfContents", () => {
    it("skips tableOfContents", () => {
      expect(
        md([
          { type: "tableOfContents", attrs: { id: "toc1", depth: 0 } },
          block("paragraph", "after toc"),
        ]),
      ).toBe("after toc\n")
    })
  })

  describe("table", () => {
    function tableDoc(
      rows: Array<{
        cells: Array<{ text: string; isHeader?: boolean }>
      }>,
    ) {
      return [
        {
          type: "table",
          attrs: { id: "t1", depth: 0 },
          content: rows.map((row) => ({
            type: "tableRow",
            content: row.cells.map((cell) => ({
              type: cell.isHeader ? "tableHeader" : "tableCell",
              attrs: { colspan: 1, rowspan: 1, colwidth: null },
              content: [
                {
                  type: "tableParagraph",
                  content: cell.text
                    ? [{ type: "text", text: cell.text }]
                    : [],
                },
              ],
            })),
          })),
        },
      ]
    }

    it("exports table with header row", () => {
      expect(
        md(
          tableDoc([
            {
              cells: [
                { text: "Col A", isHeader: true },
                { text: "Col B", isHeader: true },
              ],
            },
            { cells: [{ text: "A1" }, { text: "B1" }] },
            { cells: [{ text: "A2" }, { text: "B2" }] },
          ]),
        ),
      ).toBe("| Col A | Col B |\n| --- | --- |\n| A1 | B1 |\n| A2 | B2 |\n")
    })

    it("synthesizes header for table without header row", () => {
      expect(
        md(
          tableDoc([
            { cells: [{ text: "A1" }, { text: "B1" }] },
            { cells: [{ text: "A2" }, { text: "B2" }] },
          ]),
        ),
      ).toBe("|   |   |\n| --- | --- |\n| A1 | B1 |\n| A2 | B2 |\n")
    })

    it("escapes pipe characters in cell text", () => {
      expect(
        md(
          tableDoc([
            {
              cells: [
                { text: "a|b", isHeader: true },
                { text: "c", isHeader: true },
              ],
            },
            { cells: [{ text: "d" }, { text: "e|f" }] },
          ]),
        ),
      ).toBe("| a\\|b | c |\n| --- | --- |\n| d | e\\|f |\n")
    })

    it("handles multi-paragraph cells with <br>", () => {
      expect(
        md([
          {
            type: "table",
            attrs: { id: "t2", depth: 0 },
            content: [
              {
                type: "tableRow",
                content: [
                  {
                    type: "tableHeader",
                    attrs: { colspan: 1, rowspan: 1, colwidth: null },
                    content: [
                      {
                        type: "tableParagraph",
                        content: [{ type: "text", text: "H" }],
                      },
                    ],
                  },
                ],
              },
              {
                type: "tableRow",
                content: [
                  {
                    type: "tableCell",
                    attrs: { colspan: 1, rowspan: 1, colwidth: null },
                    content: [
                      {
                        type: "tableParagraph",
                        content: [{ type: "text", text: "line 1" }],
                      },
                      {
                        type: "tableParagraph",
                        content: [{ type: "text", text: "line 2" }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ]),
      ).toBe("| H |\n| --- |\n| line 1<br>line 2 |\n")
    })
  })

  describe("toggle", () => {
    it("exports toggle level 0 as bullet with indented children", () => {
      expect(
        md([
          {
            type: "toggle",
            attrs: { id: "tg1", depth: 0, level: 0, expanded: true },
            content: [{ type: "text", text: "Toggle title" }],
          },
          block("paragraph", "Child content", { depth: 1 }),
        ]),
      ).toBe("- Toggle title\n\n    Child content\n")
    })

    it("exports toggle heading level 1 as # with children following", () => {
      expect(
        md([
          {
            type: "toggle",
            attrs: { id: "tg2", depth: 0, level: 1, expanded: true },
            content: [{ type: "text", text: "Toggle H1" }],
          },
          block("paragraph", "Child text", { depth: 1 }),
        ]),
      ).toBe("# Toggle H1\n\nChild text\n")
    })

    it("exports toggle heading level 2 as ##", () => {
      expect(
        md([
          {
            type: "toggle",
            attrs: { id: "tg3", depth: 0, level: 2, expanded: false },
            content: [{ type: "text", text: "Toggle H2" }],
          },
        ]),
      ).toBe("## Toggle H2\n")
    })

    it("exports toggle heading level 3 as ###", () => {
      expect(
        md([
          {
            type: "toggle",
            attrs: { id: "tg4", depth: 0, level: 3, expanded: true },
            content: [{ type: "text", text: "Toggle H3" }],
          },
        ]),
      ).toBe("### Toggle H3\n")
    })
  })

  describe("spacing", () => {
    it("blank line between paragraph and code block", () => {
      expect(
        md([
          block("paragraph", "before"),
          {
            type: "codeBlock",
            attrs: { id: "cb1", depth: 0, language: "js" },
            content: [{ type: "text", text: "x = 1" }],
          },
          block("paragraph", "after"),
        ]),
      ).toBe("before\n\n```js\nx = 1\n```\n\nafter\n")
    })

    it("blank line around divider", () => {
      expect(
        md([
          block("paragraph", "above"),
          { type: "divider", attrs: { id: "d1", depth: 0 } },
          block("paragraph", "below"),
        ]),
      ).toBe("above\n\n---\n\nbelow\n")
    })

    it("no blank line between consecutive bullet items", () => {
      expect(
        md([
          block("bulletList", "a"),
          block("bulletList", "b"),
          block("bulletList", "c"),
        ]),
      ).toBe("- a\n- b\n- c\n")
    })

    it("no blank line between parent and deeper child list", () => {
      expect(
        md([
          block("bulletList", "parent", { depth: 0 }),
          block("bulletList", "child", { depth: 1 }),
          block("bulletList", "sibling", { depth: 0 }),
        ]),
      ).toBe("- parent\n    - child\n- sibling\n")
    })

    it("blank line between list group and paragraph", () => {
      expect(
        md([block("bulletList", "item"), block("paragraph", "text")]),
      ).toBe("- item\n\ntext\n")
    })

    it("mixed list types — no blank line", () => {
      expect(
        md([
          block("bulletList", "bullet"),
          block("numberedList", "num"),
          block("taskList", "task", { checked: false }),
        ]),
      ).toBe("- bullet\n1. num\n- [ ]  task\n")
    })

    // Pins the intended list-item merge contract: a level-0 toggle declares
    // spacing "list-item", so it merges (no blank line) with an adjacent
    // bullet/numbered list that also declares "list-item".
    it("no blank line between level-0 toggle and following bullet list", () => {
      expect(
        md([
          {
            type: "toggle",
            attrs: { id: "tg1", depth: 0, level: 0, expanded: true },
            content: [{ type: "text", text: "Toggle" }],
          },
          block("bulletList", "item"),
        ]),
      ).toBe("- Toggle\n- item\n")
    })

    it("no blank line between level-0 toggle and following numbered list", () => {
      expect(
        md([
          {
            type: "toggle",
            attrs: { id: "tg1", depth: 0, level: 0, expanded: true },
            content: [{ type: "text", text: "Toggle" }],
          },
          block("numberedList", "item"),
        ]),
      ).toBe("- Toggle\n1. item\n")
    })

    it("paragraph with inline marks", () => {
      expect(
        md([
          {
            type: "paragraph",
            attrs: { id: "p1", depth: 0 },
            content: [
              { type: "text", marks: [{ type: "bold" }], text: "bold" },
              { type: "text", text: " and " },
              { type: "text", marks: [{ type: "italic" }], text: "italic" },
            ],
          },
        ]),
      ).toBe("**bold** and *italic*\n")
    })

    it("multiline code block at depth>0 indents all lines", () => {
      expect(
        md([
          {
            type: "toggle",
            attrs: { id: "tg1", depth: 0, level: 0, expanded: true },
            content: [{ type: "text", text: "Toggle" }],
          },
          {
            type: "codeBlock",
            attrs: { id: "cb1", depth: 1, language: "js" },
            content: [{ type: "text", text: "line 1\nline 2\nline 3" }],
          },
        ]),
      ).toBe(
        "- Toggle\n\n    ```js\n    line 1\n    line 2\n    line 3\n    ```\n",
      )
    })

    it("table inside toggle indents all rows", () => {
      expect(
        md([
          {
            type: "toggle",
            attrs: { id: "tg1", depth: 0, level: 0, expanded: true },
            content: [{ type: "text", text: "Toggle" }],
          },
          {
            type: "table",
            attrs: { id: "t1", depth: 1 },
            content: [
              {
                type: "tableRow",
                content: [
                  {
                    type: "tableHeader",
                    attrs: { colspan: 1, rowspan: 1, colwidth: null },
                    content: [
                      {
                        type: "tableParagraph",
                        content: [{ type: "text", text: "A" }],
                      },
                    ],
                  },
                  {
                    type: "tableHeader",
                    attrs: { colspan: 1, rowspan: 1, colwidth: null },
                    content: [
                      {
                        type: "tableParagraph",
                        content: [{ type: "text", text: "B" }],
                      },
                    ],
                  },
                ],
              },
              {
                type: "tableRow",
                content: [
                  {
                    type: "tableCell",
                    attrs: { colspan: 1, rowspan: 1, colwidth: null },
                    content: [
                      {
                        type: "tableParagraph",
                        content: [{ type: "text", text: "1" }],
                      },
                    ],
                  },
                  {
                    type: "tableCell",
                    attrs: { colspan: 1, rowspan: 1, colwidth: null },
                    content: [
                      {
                        type: "tableParagraph",
                        content: [{ type: "text", text: "2" }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ]),
      ).toBe(
        "- Toggle\n\n    | A | B |\n    | --- | --- |\n    | 1 | 2 |\n",
      )
    })

    it("toggle heading with numbered + bullet list children preserves counter", () => {
      expect(
        md([
          {
            type: "toggle",
            attrs: { id: "tg1", depth: 0, level: 1, expanded: true },
            content: [{ type: "text", text: "Section" }],
          },
          block("numberedList", "A", { depth: 1 }),
          block("bulletList", "note", { depth: 2 }),
          block("numberedList", "B", { depth: 1 }),
        ]),
      ).toBe("# Section\n\n1. A\n    - note\n2. B\n")
    })
  })
})

// ── dialects (B1: styled default vs plain user-facing export) ───────────────

describe("exportMarkdown — dialects (B1)", () => {
  function editorWith(content: unknown[]) {
    return createTestEditor({
      content: { type: "doc", content: content as JSONContent[] },
    })
  }

  const run = (t: string, marks: Array<{ type: string; attrs?: Record<string, unknown> }>) =>
    ({ type: "text", text: t, marks }) as JSONContent
  const p = (content: JSONContent[]): unknown[] => [
    { type: "paragraph", attrs: { id: "p", depth: 0 }, content },
  ]

  it("plain drops color spans and <u>, keeping the text unwrapped", () => {
    const editor = editorWith(
      p([
        run("colored", [{ type: "textStyle", attrs: { textColor: "blue" } }]),
        { type: "text", text: " and " },
        run("under", [{ type: "underline" }]),
      ]),
    )
    expect(exportMarkdown(editor, { dialect: "plain" })).toBe("colored and under\n")
    // Styled keeps both HTML emissions.
    expect(exportMarkdown(editor, { dialect: "styled" })).toBe(
      '<span data-text-color="blue">colored</span> and <u>under</u>\n',
    )
  })

  it("plain drops an internalRef mention (unwraps to bare text), styled keeps it", () => {
    const editor = editorWith(
      p([run("Some Page", [{ type: "internalRef", attrs: { kind: "page", target: "Some Page" } }])]),
    )
    expect(exportMarkdown(editor, { dialect: "plain" })).toBe("Some Page\n")
    expect(exportMarkdown(editor, { dialect: "styled" })).toBe(
      '<mention-page id="Some Page">Some Page</mention-page>\n',
    )
  })

  it("plain keeps markdown-syntax marks (code+color → just backticks)", () => {
    const editor = editorWith(
      p([
        run("fn()", [
          { type: "code" },
          { type: "textStyle", attrs: { textColor: "blue" } },
        ]),
      ]),
    )
    expect(exportMarkdown(editor, { dialect: "plain" })).toBe("`fn()`\n")
    expect(exportMarkdown(editor, { dialect: "styled" })).toBe(
      '<span data-text-color="blue">`fn()`</span>\n',
    )
  })

  it("plain still escapes CommonMark literals (escaping is not a styled-only concern)", () => {
    const editor = editorWith(
      p([run("*x*", [{ type: "textStyle", attrs: { textColor: "blue" } }])]),
    )
    // Span dropped, but the literal asterisks are still escaped.
    expect(exportMarkdown(editor, { dialect: "plain" })).toBe("\\*x\\*\n")
  })

  it("defaults to styled — no options === { dialect: 'styled' }", () => {
    const editor = editorWith(
      p([run("colored", [{ type: "textStyle", attrs: { textColor: "blue" } }])]),
    )
    expect(exportMarkdown(editor)).toBe(exportMarkdown(editor, { dialect: "styled" }))
    expect(exportMarkdown(editor)).toContain('data-text-color="blue"')
  })

  it("exportMarkdownWithChunks stays styled (chunks keep color spans)", () => {
    const editor = editorWith(
      p([run("colored", [{ type: "textStyle", attrs: { textColor: "blue" } }])]),
    )
    const { markdown, chunks } = exportMarkdownWithChunks(editor)
    expect(markdown).toContain('data-text-color="blue"')
    expect(chunks[0]!.text).toContain('data-text-color="blue"')
  })
})
