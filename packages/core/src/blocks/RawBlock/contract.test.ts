// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

/**
 * The raw carriers exist to make one sentence true: source that rune cannot
 * represent still comes back byte-for-byte. `markdown/gate.headless.test.ts`
 * proves that for the storage surface. This file proves it for the two OTHER
 * surfaces a block has — the editor DOM and the clipboard — plus the two
 * invariants that keep the carriers safe to hold arbitrary bytes:
 *
 *   1. the source is DISPLAYED, never rendered (no injection surface), and
 *   2. a raw block never acquires a depth (decision D13), because depth is
 *      what serialization turns into list indentation and `>` prefixes.
 *
 * The clipboard round-trip is not theoretical: copy out of rune, paste into an
 * app that keeps only `text/html`, paste back. If `pre[data-rune-raw]` lost to
 * CodeBlock's bare `tag: "pre"` on the way in, the next save would wrap the
 * user's HTML in ``` fences.
 */
import { describe, it, expect } from "vitest"
import { NodeSelection, TextSelection } from "@tiptap/pm/state"
import { createTestEditor } from "../../test-utils/createTestEditor"
import { serializeBlocksForClipboard } from "../../extensions/clipboard/serializeBlocks"
import { getDocument } from "../../api/queries/getDocument"
import type { RuneBlockInput } from "../../api/types"

/** Deliberately hostile: a tag rune has no mapping for, wrapping a script. */
const SOURCE = '<div class="callout">\n  <script>alert(1)</script>\n</div>'

function fresh(content?: unknown) {
  const element = document.createElement("div")
  document.body.appendChild(element)
  return createTestEditor({ element, content: content as never })
}

function rawDoc(source = SOURCE, origin = "html") {
  return { type: "doc", content: [{ type: "rawBlock", attrs: { source, origin } }] }
}

describe("RawBlock — schema shape", () => {
  it("is a block-group leaf atom that never defines a parse boundary", () => {
    const editor = fresh()
    const type = editor.schema.nodes.rawBlock
    expect(type).toBeDefined()
    expect(type!.spec.group).toBe("block")
    expect(type!.isAtom).toBe(true)
    expect(type!.isLeaf).toBe(true)
    expect(type!.spec.defining).toBe(false)
  })

  it("declares the D13 depth cap so drag and Tab read it from one place", () => {
    const editor = fresh()
    const meta = editor.extensionManager.extensions.find((e) => e.name === "rawBlock")
      ?.storage as { indent?: { mode: string; maxDepth: number } }
    expect(meta?.indent).toEqual({ mode: "numeric", maxDepth: 0 })
  })

  it("has no slash-menu entry — it is a decoder artefact, not a user block", () => {
    const editor = fresh()
    const meta = editor.extensionManager.extensions.find((e) => e.name === "rawBlock")
      ?.storage as { slashMenuItems?: unknown }
    expect(meta?.slashMenuItems).toBeUndefined()
  })
})

describe("RawBlock — the source is displayed, never rendered", () => {
  it("nests the source as a text node, so its tags stay inert in the editor", () => {
    const editor = fresh(rawDoc())
    const pre = editor.view.dom.querySelector<HTMLElement>(".rune-raw-block")
    expect(pre).not.toBeNull()
    expect(pre!.textContent).toBe(SOURCE)
    // The whole point: the <script> and <div> in the source are TEXT here.
    expect(editor.view.dom.querySelector("script")).toBeNull()
    expect(editor.view.dom.querySelector(".callout")).toBeNull()
    // The atom NodeView appends its own empty chrome slots (side-menu host,
    // resize host). Those are rune's; nothing from the source may join them.
    for (const child of Array.from(pre!.children)) {
      expect(child.className).toMatch(/^rune-/)
    }
  })

  it("never puts the source in an attribute, where a quote would break out", () => {
    const editor = fresh(rawDoc('<a title="x">'))
    const pre = editor.view.dom.querySelector<HTMLElement>(".rune-raw-block")!
    for (const attr of Array.from(pre.attributes)) {
      expect(attr.value).not.toContain("<a title=")
    }
  })

  it("labels itself from the closed origin vocabulary", () => {
    const cases = {
      footnote: "Footnote · kept as written",
      // NOT "HTML". Everything the decoder cannot map used to be labelled html,
      // so a link definition — `[id]: https://example.com`, unambiguously
      // markdown — announced itself to the reader as HTML.
      markdown: "Markdown · kept as written",
      // NOT "malformed": GFM explicitly allows body rows that differ from the
      // header's width. These tables are legal; they just are not something a
      // fixed-width table node can hold without changing the author's bytes.
      table: "Non-rectangular table · kept as written",
    }
    for (const [origin, label] of Object.entries(cases)) {
      const editor = fresh(rawDoc("x", origin))
      const pre = editor.view.dom.querySelector<HTMLElement>(".rune-raw-block")!
      expect(pre.getAttribute("data-rune-raw-label")).toBe(label)
    }
  })

  it("falls back to the html label when the origin is not one rune wrote", () => {
    const editor = fresh(rawDoc(SOURCE, "not-an-origin"))
    const pre = editor.view.dom.querySelector<HTMLElement>(".rune-raw-block")!
    expect(pre.getAttribute("data-rune-raw-label")).toBe("HTML · kept as written")
  })
})

describe("RawBlock — clipboard", () => {
  const copy = (editor: ReturnType<typeof fresh>) => {
    editor.view.dispatch(
      editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 0)),
    )
    return serializeBlocksForClipboard(editor.view)
  }

  it("emits only the semantic node — no rune chrome, no runtime ids", () => {
    const { html } = copy(fresh(rawDoc()))
    expect(html).toContain('data-rune-raw="html"')
    expect(html).not.toContain("rune-block")
    expect(html).not.toContain("data-id")
    expect(html).not.toContain("data-depth")
  })

  it("puts the source verbatim on text/plain, not an empty atom", () => {
    const { text } = copy(fresh(rawDoc()))
    expect(text).toBe(SOURCE)
  })

  it("comes back as a rawBlock — not a code block — after a text/html round-trip", () => {
    const { html } = copy(fresh(rawDoc()))
    const editor = fresh()
    editor.commands.setContent(html)
    const first = editor.state.doc.child(0)
    expect(first.type.name).toBe("rawBlock")
    expect(first.attrs.source).toBe(SOURCE)
  })

  it("carries its origin across that round-trip so the label survives", () => {
    const { html } = copy(fresh(rawDoc("[^1]: a note", "footnote")))
    const editor = fresh()
    editor.commands.setContent(html)
    expect(editor.state.doc.child(0).attrs.origin).toBe("footnote")
  })
})

describe("RawBlock — the editor's own HTML export", () => {
  // A separate surface from the clipboard, and it used to behave differently:
  // the `origin` prop's `renderHTML` put `data-rune-raw` on the OUTER
  // `.rune-block` div (that is where the factory merges prop attributes), while
  // the parse rule matches `pre[data-rune-raw]`. The inner <pre> was therefore
  // bare, and CodeBlock's `tag: "pre"` claimed it — so `getHTML()` →
  // `setContent()` turned preserved source into a code block, and the next save
  // wrapped the user's HTML in ``` fences. The clipboard path hid this, because
  // `clipboardRenderDOM` emits the marked <pre> directly.
  it("survives getHTML() → setContent() instead of decaying to a code block", () => {
    const source = fresh(rawDoc())
    const html = source.getHTML()
    expect(html).toContain('data-rune-raw="html"')

    const editor = fresh()
    editor.commands.setContent(html)
    const first = editor.state.doc.child(0)
    expect(first.type.name).toBe("rawBlock")
    expect(first.attrs.source).toBe(SOURCE)
  })

  it("marks the element the parse rule actually matches", () => {
    const editor = fresh(rawDoc())
    const html = editor.getHTML()
    // The marker must be ON the <pre>; a marker on the wrapper is invisible to
    // `pre[data-rune-raw]` and loses the priority race against CodeBlock.
    expect(html).toMatch(/<pre[^>]*data-rune-raw="html"/)
  })
})

describe("RawBlock — D13: it never acquires a depth", () => {
  it("stays at depth 0 even where the surface would allow a child level", () => {
    const editor = fresh({
      type: "doc",
      content: [{ type: "bulletList", content: [{ type: "text", text: "owner" }] }],
    })
    const input = { type: "rawBlock", source: SOURCE } as unknown as RuneBlockInput
    expect(editor.commands.insertBlocks([input], { at: "end", depth: 1 })).toBe(true)

    const blocks = getDocument(editor)
    const raw = blocks.find((block) => block.type === "rawBlock")
    expect(raw).toBeDefined()
    // A paragraph inserted here WOULD reach depth 1 — bulletList owns a child
    // level. The numeric cap is what holds this one at 0.
    expect(raw!.depth).toBe(0)
  })
})

describe("RawInline — the inline half", () => {
  const inlineDoc = (source: string, marks?: unknown) => ({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "before " },
          { type: "rawInline", attrs: { source }, ...(marks ? { marks } : {}) },
          { type: "text", text: " after" },
        ],
      },
    ],
  })

  it("keeps the tag inert while the surrounding text stays ordinary content", () => {
    const editor = fresh(inlineDoc('<span class="x">'))
    const span = editor.view.dom.querySelector<HTMLElement>(".rune-raw-inline")
    expect(span).not.toBeNull()
    expect(span!.textContent).toBe('<span class="x">')
    expect(span!.childElementCount).toBe(0)
    expect(editor.view.dom.querySelector(".x")).toBeNull()
    expect(editor.state.doc.textBetween(0, editor.state.doc.content.size, "")).toContain(
      "before ",
    )
  })

  it("survives a text/html clipboard round-trip inside its paragraph", () => {
    const source = "<!-- keep me -->"
    const editor = fresh(inlineDoc(source))
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, editor.state.doc.content.size - 1)),
    )
    const { html } = serializeBlocksForClipboard(editor.view)

    const target = fresh()
    target.commands.setContent(html)
    const carried: string[] = []
    target.state.doc.descendants((node) => {
      if (node.type.name === "rawInline") carried.push(String(node.attrs.source))
    })
    expect(carried).toEqual([source])
  })

  it("still reports its source on text/plain when a mark wraps it", () => {
    const source = "<u>"
    const editor = fresh(inlineDoc(source, [{ type: "bold" }]))
    editor.commands.selectAll()
    const { text } = serializeBlocksForClipboard(editor.view)
    expect(text).toContain(source)
    // The mark is the paragraph's business; the atom's bytes are unchanged.
    let found = false
    editor.state.doc.descendants((node) => {
      if (node.type.name !== "rawInline") return
      found = true
      expect(node.attrs.source).toBe(source)
      expect(node.marks.map((m) => m.type.name)).toEqual(["bold"])
    })
    expect(found).toBe(true)
  })
})
