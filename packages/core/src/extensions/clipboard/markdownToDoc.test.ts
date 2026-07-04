// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, expect, it } from "vitest"
import { Editor } from "@tiptap/core"
import type { JSONContent } from "@tiptap/core"
import { createRuneKit as kit } from "../../kit"
import { markdownToDoc } from "./markdownToDoc"

// markdownToDoc only needs a Schema; spin up a throwaway editor to get the
// real rune schema (same node set a downstream page would mount with).
function schema() {
  const editor = new Editor({ extensions: kit(), element: document.createElement("div") })
  const s = editor.schema
  editor.destroy()
  return s
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

describe("markdownToDoc — headless Markdown import", () => {
  it("returns a top-level doc JSON ready for setContent", () => {
    const doc = markdownToDoc("# Title\n\nbody\n", schema())
    expect(doc.type).toBe("doc")
    expect(Array.isArray(doc.content)).toBe(true)
    expect((doc.content?.length ?? 0)).toBeGreaterThan(0)
  })

  it("splits a multi-block document into multiple top-level blocks", () => {
    const doc = markdownToDoc("# Heading\n\nA paragraph.\n\n- one\n- two\n", schema())
    // Heading + paragraph + two list items, all flat top-level siblings.
    expect((doc.content?.length ?? 0)).toBeGreaterThanOrEqual(3)
    expect(nodesOfType(doc, "heading").length).toBe(1)
    expect(nodesOfType(doc, "paragraph").some((p) => p.content?.[0]?.text === "A paragraph.")).toBe(
      true,
    )
    expect(nodesOfType(doc, "bulletList").length).toBe(2)
  })

  it("applies the heading axis shift (Markdown `#` → Heading level 2)", () => {
    const doc = markdownToDoc("# Title\n", schema())
    const heading = nodesOfType(doc, "heading")[0]
    expect(heading?.attrs?.level).toBe(2)
  })

  it("preserves a fenced code block with its language", () => {
    const doc = markdownToDoc("```js\nconst a = 1\n```\n", schema())
    const code = nodesOfType(doc, "codeBlock")
    expect(code.length).toBe(1)
    expect(code[0]?.attrs?.language).toBe("js")
    expect(code[0]?.content?.[0]?.text).toContain("const a = 1")
  })

  it("parses a GFM table", () => {
    const doc = markdownToDoc("| a | b |\n| - | - |\n| 1 | 2 |\n", schema())
    expect(nodesOfType(doc, "table").length).toBe(1)
  })

  it("keeps an image's original src (no upload — migration rewrites URLs downstream)", () => {
    const doc = markdownToDoc("![alt text](https://cdn.example.com/x.png)\n", schema())
    const images = nodesOfType(doc, "image")
    expect(images.length).toBe(1)
    expect(images[0]?.attrs?.src).toBe("https://cdn.example.com/x.png")
  })

  it("preserves a local/relative image path verbatim (Obsidian vault case)", () => {
    const doc = markdownToDoc("![](./attachments/diagram.png)\n", schema())
    expect(nodesOfType(doc, "image")[0]?.attrs?.src).toBe("./attachments/diagram.png")
  })

  it("lands a standalone image as a clean top-level block (no stray leading paragraph)", () => {
    // markdown-it wraps a lone image in `<p>`; image is a BLOCK node, so a
    // naive full-doc parse leaves the emptied `<p>` as a blank line above it.
    const doc = markdownToDoc("![alt](x.png)\n", schema())
    expect(nodesOfType(doc, "image").length).toBe(1)
    // The image is the first block — nothing empty precedes it.
    expect(doc.content?.[0]?.type).toBe("image")
    const emptyParas = nodesOfType(doc, "paragraph").filter(
      (p) => (p.content?.length ?? 0) === 0,
    )
    expect(emptyParas.length).toBe(0)
  })

  it("honors an injected parseHTML (editor-less / non-global DOM path)", () => {
    // The Node/worker import path supplies its own headless DOM instead of the
    // browser global; assert the param is actually wired through.
    let received = ""
    const doc = markdownToDoc("# Title\n\nbody\n", schema(), (html) => {
      received = html
      return new DOMParser().parseFromString(html, "text/html")
    })
    expect(received).toContain("<h2>") // heading-shifted HTML reached the injected parser
    expect(doc.type).toBe("doc")
    expect(nodesOfType(doc, "heading").length).toBe(1)
  })

  it("produces a valid doc the schema accepts (round-trips through setContent)", () => {
    const md = "# Heading\n\nbody with **bold**\n\n1. first\n2. second\n\n> quote\n"
    const doc = markdownToDoc(md, schema())
    const editor = new Editor({
      extensions: kit(),
      content: doc,
      element: document.createElement("div"),
    })
    // If the JSON were schema-invalid, the Editor would throw on construction.
    expect(editor.state.doc.childCount).toBeGreaterThan(0)
    expect(editor.state.doc.textContent).toContain("Heading")
    // "quote" must live IN the blockquote block itself, not a de-nested
    // stray paragraph sitting next to an emptied blockquote.
    let quoteInBlockquote = false
    editor.state.doc.descendants((node) => {
      if (node.type.name === "blockquote" && node.textContent.includes("quote")) {
        quoteInBlockquote = true
      }
    })
    expect(quoteInBlockquote).toBe(true)
    editor.destroy()
  })

  // markdown-it nests `<p>` inside `<li>`/`<blockquote>` for "loose" content;
  // rune's blockquote/list blocks are flat inline* textblocks, so left alone
  // PM's DOMParser splits that `<p>` out — a ghost empty block followed by a
  // stray de-nested paragraph. `normalizeInlineContainers` (transformPastedHTML.ts)
  // unwraps the `<p>` before flattenLists ever sees it.
  describe("loose blockquote / list content lands in the block, not de-nested (regression)", () => {
    it("a single-line blockquote is ONE blockquote block holding the text", () => {
      const doc = markdownToDoc("> hello\n", schema())
      const quotes = nodesOfType(doc, "blockquote")
      expect(quotes.length).toBe(1)
      expect(quotes[0]?.content?.[0]?.text).toBe("hello")
      // No stray de-nested paragraph anywhere in the doc.
      expect(nodesOfType(doc, "paragraph").length).toBe(0)
    })

    it("a loose bullet list (`- a\\n\\n- b`) yields two clean bulletList blocks", () => {
      const doc = markdownToDoc("- a\n\n- b\n", schema())
      const bullets = nodesOfType(doc, "bulletList")
      expect(bullets.length).toBe(2)
      expect(bullets[0]?.content?.[0]?.text).toBe("a")
      expect(bullets[1]?.content?.[0]?.text).toBe("b")
    })

    it("a loose numbered list (`1. a\\n\\n2. b`) yields two clean numberedList blocks", () => {
      const doc = markdownToDoc("1. a\n\n2. b\n", schema())
      const items = nodesOfType(doc, "numberedList")
      expect(items.length).toBe(2)
      expect(items[0]?.content?.[0]?.text).toBe("a")
      expect(items[1]?.content?.[0]?.text).toBe("b")
    })

    it("a loose task list (`- [ ] a\\n\\n- [x] b`) yields two taskList blocks with correct checked state", () => {
      const doc = markdownToDoc("- [ ] a\n\n- [x] b\n", schema())
      const tasks = nodesOfType(doc, "taskList")
      expect(tasks.length).toBe(2)
      expect(tasks[0]?.attrs?.checked).toBe(false)
      expect(tasks[0]?.content?.[0]?.text?.trim()).toBe("a")
      expect(tasks[1]?.attrs?.checked).toBe(true)
      expect(tasks[1]?.content?.[0]?.text?.trim()).toBe("b")
    })

    it("[control] a tight bullet list (`- a\\n- b`, no blank line) is unaffected", () => {
      const doc = markdownToDoc("- a\n- b\n", schema())
      const bullets = nodesOfType(doc, "bulletList")
      expect(bullets.length).toBe(2)
      expect(bullets[0]?.content?.[0]?.text).toBe("a")
      expect(bullets[1]?.content?.[0]?.text).toBe("b")
    })
  })

  it("yields a valid (non-empty) doc for empty input", () => {
    const doc = markdownToDoc("", schema())
    expect(doc.type).toBe("doc")
    // The schema requires block+ content; an empty import must still be a
    // valid doc (PM fills a default block) so setContent never throws.
    expect((doc.content?.length ?? 0)).toBeGreaterThan(0)
  })
})
