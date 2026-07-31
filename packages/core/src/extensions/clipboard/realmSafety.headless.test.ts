// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// packages/core/src/extensions/clipboard/realmSafety.headless.test.ts
// @vitest-environment node
//
// Every jsdom test in this repo runs where DOM classes are globals AND every
// parsed node is an instance of them — so none of them can catch a parse rule
// that reaches for `HTMLElement` & co. This file is the counterpart that can: a
// bare Node process (no DOM globals at all) parsing against an INJECTED
// linkedom Document, i.e. exactly the shape an Electron main process / CLI /
// worker importer has.
//
// A parse rule written as `node instanceof HTMLElement` throws
// `ReferenceError: HTMLElement is not defined` here (and would silently return
// `false` — dropping the block — in the subtler variant where the host DOES
// have globals but from a DIFFERENT implementation than the Document being
// parsed). Parse rules therefore use tag/attribute/`matches` checks only; see
// the architecture notes §13.
//
// Named for the invariant rather than for a function: this used to be
// `markdownToDoc.headless.test.ts`, and when the Markdown paste path moved onto
// the storage codec that function went away while the invariant did not. What
// is guarded here is the set of paths that still meet a Document at all —
// schema `parseDOM` rules, the clipboard pre-transforms, and `parseAiMarkdown`.
import { describe, expect, it } from "vitest"
import { getSchema } from "@tiptap/core"
import type { JSONContent } from "@tiptap/core"
import { DOMParser as PMDOMParser, type Schema } from "@tiptap/pm/model"
import { DOMParser as LinkedomDOMParser } from "linkedom"

import { createRuneKit } from "../../kit"
import { parseMarkdown } from "../../markdown"
import { transformPastedHTMLDoc } from "./transformPastedHTML"
import { collectKnownBlockTags } from "./knownBlockTags"
import { parseAiMarkdown } from "./aiMarkdown"

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

  // The Markdown import path is now the storage codec, which never builds a
  // Document at all. That is a STRONGER property than the injected-Document
  // one this case used to assert of `markdownToDoc`: there is no realm to get
  // wrong. Asserted here rather than assumed, because it is the property that
  // lets a bare Node importer call it with no DOM shim whatsoever.
  it("converts a full Markdown document with no DOM in reach", () => {
    const { doc } = parseMarkdown(
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
    // `?? 0` on purpose: the codec hand-builds JSON and omits attrs sitting at
    // their schema default, where PM's `toJSON()` writes every one out. Both
    // mean depth 0, and asserting the meaning keeps this case about nesting
    // rather than about which of the two representations produced it.
    expect(nodesOfType(doc, "bulletList").map((b) => b.attrs?.depth ?? 0)).toEqual([0, 1])
  })

  // `parseAiMarkdown` is the markdown path that still goes through a Document,
  // so it keeps the injected-realm coverage the codec no longer needs.
  it("converts AI-dialect Markdown against an injected Document", () => {
    const doc = parseAiMarkdown(
      "# Heading\n\nParagraph with **bold**.\n\n- [x] done task\n",
      runeSchema,
      parseHTML,
    )
    expect(blockTypes(doc)).toEqual(["heading", "paragraph", "taskList"])
    expect(nodesOfType(doc, "taskList")[0]?.attrs?.checked).toBe(true)
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
