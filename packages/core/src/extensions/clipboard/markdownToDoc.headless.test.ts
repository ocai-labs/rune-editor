// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// packages/core/src/extensions/clipboard/markdownToDoc.headless.test.ts
// @vitest-environment node
//
// The sibling markdownToDoc.test.ts runs under jsdom, where every DOM class
// is a global AND every parsed node is an instance of it — so it can never
// catch a parse rule that reaches for `HTMLElement` & co. This file is the
// counterpart that can: a bare Node process (no DOM globals at all) parsing
// against an injected linkedom Document, i.e. exactly the shape an Electron
// main process / CLI / worker importer has.
//
// A parse rule written as `node instanceof HTMLElement` throws
// `ReferenceError: HTMLElement is not defined` here (and would silently
// return `false` — dropping the block — in the subtler variant where the
// host DOES have globals but from a DIFFERENT implementation than the
// Document being parsed). Parse rules therefore use tag/attribute/`matches`
// checks only; see the architecture notes §13.
import { describe, expect, it } from "vitest"
import { getSchema } from "@tiptap/core"
import type { JSONContent } from "@tiptap/core"
import { DOMParser as PMDOMParser, type Schema } from "@tiptap/pm/model"
import { DOMParser as LinkedomDOMParser } from "linkedom"

import { createRuneKit } from "../../kit"
import { transformPastedHTMLDoc } from "./transformPastedHTML"
import { collectKnownBlockTags } from "./knownBlockTags"
import { markdownToDoc } from "./markdownToDoc"

// linkedom, unlike the browser's DOMParser, does not auto-wrap a bare
// fragment in html/body — same wrap `ensureHeadlessGlobals` applies.
const parseHTML = (html: string): Document =>
  new LinkedomDOMParser().parseFromString(
    `<html><body>${html}</body></html>`,
    "text/html",
  ) as unknown as Document

const runeSchema: Schema = getSchema(createRuneKit())

/** PM parse with NO clipboard transform — the path `setContent(html)` /
 *  `generateJSON` take, where a block's own parseDOM rules are all that
 *  stand between raw HTML and the document. */
function parseHtmlToDoc(html: string): JSONContent {
  const dom = parseHTML(html)
  return PMDOMParser.fromSchema(runeSchema).parse(dom.body).toJSON() as JSONContent
}

function blockTypes(doc: JSONContent): string[] {
  return (doc.content ?? []).map((block) => block.type ?? "")
}

function nodesOfType(doc: JSONContent, typeName: string): JSONContent[] {
  const out: JSONContent[] = []
  const walk = (node: JSONContent) => {
    if (node.type === typeName) out.push(node)
    node.content?.forEach(walk)
  }
  walk(doc)
  return out
}

describe("headless parse — no DOM globals, injected Document", () => {
  it("runs in a bare Node environment", () => {
    expect(typeof globalThis.HTMLElement).toBe("undefined")
    expect(typeof globalThis.document).toBe("undefined")
  })

  it("converts a full Markdown document without touching a DOM global", () => {
    const doc = markdownToDoc(
      [
        "# Heading",
        "",
        "Paragraph with **bold** and a [link](https://example.com).",
        "",
        "- bullet",
        "  - nested bullet",
        "",
        "1. first",
        "",
        "- [ ] open task",
        "- [x] done task",
        "",
        "> quote",
        "",
        "```ts",
        "const x = 1",
        "```",
        "",
        "| a | b |",
        "| - | - |",
        "| 1 | 2 |",
        "",
        "---",
        "",
      ].join("\n"),
      runeSchema,
      parseHTML,
    )

    expect(blockTypes(doc)).toEqual([
      "heading",
      "paragraph",
      "bulletList",
      "bulletList",
      "numberedList",
      "taskList",
      "taskList",
      "blockquote",
      "codeBlock",
      "table",
      "divider",
    ])

    const tasks = nodesOfType(doc, "taskList")
    expect(tasks.map((t) => t.attrs?.checked)).toEqual([false, true])
    expect(nodesOfType(doc, "bulletList").map((b) => b.attrs?.depth)).toEqual([0, 1])
  })

  it("parses a GitHub-style checkbox <li> straight through parseDOM", () => {
    // No transformPastedHTML here, so `data-rune-paste-checked` is absent and
    // TaskList's rule has to find the <input> child itself.
    const doc = parseHtmlToDoc(
      `<ul><li><input type="checkbox" checked> done</li><li><input type="checkbox"> open</li></ul>`,
    )
    const tasks = nodesOfType(doc, "taskList")
    expect(tasks.map((t) => t.attrs?.checked)).toEqual([true, false])
  })

  it("parses wikiLink and internalRef marks", () => {
    const doc = parseHtmlToDoc(
      `<p><a data-wikilink="Some Page">Some Page</a> and ` +
        `<a data-rune-ref-kind="page" data-rune-ref-target="abc123">Ref</a></p>`,
    )
    const marks = nodesOfType(doc, "text").flatMap((t) => t.marks ?? [])
    expect(marks.find((m) => m.type === "wikiLink")?.attrs?.target).toBe("Some Page")
    expect(marks.find((m) => m.type === "internalRef")?.attrs?.target).toBe("abc123")
  })

  it("flattens a <details> toggle", () => {
    const dom = parseHTML(
      `<details open><summary>Title</summary><p>Body</p></details>`,
    )
    transformPastedHTMLDoc(dom, collectKnownBlockTags(runeSchema))
    const doc = PMDOMParser.fromSchema(runeSchema).parse(dom.body).toJSON() as JSONContent

    expect(blockTypes(doc)).toEqual(["toggle", "paragraph"])
    expect(doc.content?.[0]?.attrs?.expanded).toBe(true)
    expect(doc.content?.[1]?.attrs?.depth).toBe(1)
  })
})
