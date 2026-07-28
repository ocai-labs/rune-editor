// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { Editor, Extension, type AnyExtension } from "@tiptap/core"
import Document from "@tiptap/extension-document"
import Text from "@tiptap/extension-text"
import { DOMParser } from "@tiptap/pm/model"
import { describe, expect, it } from "vitest"
import { Paragraph } from "../../blocks/Paragraph/block"
import { InternalRef } from "."

// Mirrors wiki-link.test.ts: a global-attributes extension that tries to
// inject reserved attributes onto every internalRef mark via PM's
// addGlobalAttributes pipeline — exercising the merged (HTMLAttributes)
// branch of renderHTML's strip loop.
const UnsafeInternalRefHTMLAttributes = Extension.create({
  name: "unsafeInternalRefHTMLAttributes",

  addGlobalAttributes() {
    return [
      {
        types: ["internalRef"],
        attributes: {
          "data-rune-ref-target": {
            default: "global-spoof-target",
            renderHTML: (attributes) => ({
              "data-rune-ref-target": attributes["data-rune-ref-target"],
            }),
          },
          "data-rune-ref-kind": {
            default: "global-spoof-kind",
            renderHTML: (attributes) => ({
              "data-rune-ref-kind": attributes["data-rune-ref-kind"],
            }),
          },
          href: {
            default: "https://example.test/unsafe",
            renderHTML: (attributes) => ({ href: attributes.href }),
          },
          tabindex: {
            default: "0",
            renderHTML: (attributes) => ({ tabindex: attributes.tabindex }),
          },
        },
      },
    ]
  },
})

function makeEditor(extensions: AnyExtension[] = [InternalRef]): Editor {
  const element = document.createElement("div")
  document.body.appendChild(element)
  const editor = new Editor({
    element,
    extensions: [Document, Paragraph, Text, ...extensions],
  })
  const destroy = editor.destroy.bind(editor)
  editor.destroy = () => {
    destroy()
    element.remove()
  }
  return editor
}

function firstInternalRefMark(editor: Editor) {
  const text = editor.state.doc.firstChild?.firstChild
  return text?.marks.find((m) => m.type.name === "internalRef")
}

describe("InternalRef — renderHTML reserved-attribute stripping", () => {
  it("strips configured reserved attributes; mark's own kind/target/role win", () => {
    const editor = makeEditor([
      InternalRef.configure({
        HTMLAttributes: {
          // All of these are reserved and must be stripped before the
          // mark re-stamps its real values.
          "data-rune-ref-kind": "configured-kind",
          "data-rune-ref-target": "configured-target",
          href: "https://example.test/configured",
          role: "button",
          tabindex: "0",
          // Non-reserved attribute must survive and token-merge with the
          // base `rune-wikilink rune-ref` class.
          class: "configured",
        },
      }),
    ])
    editor.commands.setContent(
      '<p><a data-rune-ref-kind="page" data-rune-ref-target="note-1">Note</a></p>',
    )

    const html = editor.getHTML()
    expect(html).toContain('data-rune-ref-kind="page"')
    expect(html).toContain('data-rune-ref-target="note-1"')
    expect(html).not.toContain("configured-kind")
    expect(html).not.toContain("configured-target")
    expect(html).toContain('role="link"')
    expect(html).not.toContain('role="button"')
    expect(html).toContain('class="rune-wikilink rune-ref configured"')
    expect(html).not.toContain("href=")
    expect(html).not.toContain("tabindex=")

    editor.destroy()
  })

  it("strips reserved attributes injected through addGlobalAttributes (merged branch)", () => {
    const editor = makeEditor([InternalRef, UnsafeInternalRefHTMLAttributes])
    editor.commands.setContent(
      '<p><a data-rune-ref-kind="block" data-rune-ref-target="b-1">Block</a></p>',
    )

    const html = editor.getHTML()
    // The mark's real attrs survive; the global-attribute spoofs do not.
    expect(html).toContain('data-rune-ref-kind="block"')
    expect(html).toContain('data-rune-ref-target="b-1"')
    expect(html).not.toContain("global-spoof-target")
    expect(html).not.toContain("global-spoof-kind")
    expect(html).toContain('role="link"')
    expect(html).not.toContain("href=")
    expect(html).not.toContain("tabindex=")

    editor.destroy()
  })

  it("strips reserved attributes case-insensitively", () => {
    const editor = makeEditor([
      InternalRef.configure({
        HTMLAttributes: {
          tabIndex: "0",
          HREF: "https://x.test",
          ROLE: "button",
          "DATA-RUNE-REF-KIND": "case-spoof-kind",
          "DATA-RUNE-REF-TARGET": "case-spoof-target",
        },
      }),
    ])
    editor.commands.setContent(
      '<p><a data-rune-ref-kind="page" data-rune-ref-target="note-1">Note</a></p>',
    )

    const html = editor.getHTML()
    expect(html).toContain('data-rune-ref-kind="page"')
    expect(html).toContain('data-rune-ref-target="note-1"')
    expect(html).not.toContain("case-spoof-kind")
    expect(html).not.toContain("case-spoof-target")
    expect(html).toContain('role="link"')
    expect(html).not.toContain('role="button"')
    expect(html).not.toContain("href=")
    expect(html).not.toContain("HREF=")
    expect(html).not.toContain("tabindex=")
    expect(html).not.toContain("tabIndex=")

    editor.destroy()
  })

  it("strips reserved attributes returned by renderAttrs", () => {
    const editor = makeEditor([
      InternalRef.configure({
        renderAttrs: () => ({
          href: "javascript:alert(1)",
          role: "button",
          tabindex: "0",
          "data-rune-ref-kind": "render-spoof-kind",
          "data-rune-ref-target": "render-spoof-target",
        }),
      }),
    ])
    editor.commands.setContent(
      '<p><a data-rune-ref-kind="page" data-rune-ref-target="note-1">Note</a></p>',
    )

    const html = editor.getHTML()
    expect(html).toContain('data-rune-ref-kind="page"')
    expect(html).toContain('data-rune-ref-target="note-1"')
    expect(html).not.toContain("render-spoof-kind")
    expect(html).not.toContain("render-spoof-target")
    expect(html).not.toContain("javascript:")
    expect(html).toContain('role="link"')
    expect(html).not.toContain('role="button"')
    expect(html).not.toContain("href=")
    expect(html).not.toContain("tabindex=")

    editor.destroy()
  })
})

describe("InternalRef — parseHTML round-trip", () => {
  it("round-trips kind/target and display text through getHTML and setContent", () => {
    const editor = makeEditor()
    editor.commands.setContent(
      '<p>See <a data-rune-ref-kind="page" data-rune-ref-target="Project Rune">Project Rune</a>.</p>',
    )

    const html = editor.getHTML()
    expect(html).toContain('data-rune-ref-kind="page"')
    expect(html).toContain('data-rune-ref-target="Project Rune"')
    expect(html).toContain("rune-ref")
    expect(html).toContain(">Project Rune</a>")

    editor.commands.setContent(html)
    const text = editor.state.doc.firstChild!.child(1)
    const mark = text.marks.find((m) => m.type.name === "internalRef")
    expect(mark?.attrs).toMatchObject({ kind: "page", target: "Project Rune" })
    expect(text.text).toBe("Project Rune")

    editor.destroy()
  })

  it("preserves a non-default kind through parse and render", () => {
    const editor = makeEditor()
    editor.commands.setContent(
      '<p><a data-rune-ref-kind="block" data-rune-ref-target="b-9">Block</a></p>',
    )

    expect(firstInternalRefMark(editor)?.attrs).toMatchObject({
      kind: "block",
      target: "b-9",
    })
    const html = editor.getHTML()
    editor.commands.setContent(html)
    expect(firstInternalRefMark(editor)?.attrs).toMatchObject({
      kind: "block",
      target: "b-9",
    })

    editor.destroy()
  })

  it("drops the mark but preserves inner text when the target attribute is empty", () => {
    // The `getAttrs` rejection path: the CSS selector
    // `a[data-rune-ref-kind][data-rune-ref-target]` matches on attribute
    // presence, but parseInternalRefElement returns false for an empty
    // target, so the mark is dropped. Parse via PM's DOMParser directly —
    // the wiki-link suite parses parseDOM-rule cases the same way (and the
    // project rule is to parse directly, not via setContent, when a parse
    // rule is the unit under test).
    const editor = makeEditor()
    const parser = DOMParser.fromSchema(editor.schema)
    const container = document.createElement("div")
    container.innerHTML =
      '<p><a data-rune-ref-kind="page" data-rune-ref-target="">Empty</a></p>'
    const doc = parser.parse(container)

    const text = doc.firstChild!.firstChild!
    expect(text.text).toBe("Empty")
    expect(text.marks.find((m) => m.type.name === "internalRef")).toBeUndefined()

    editor.destroy()
  })

  it("drops the mark but preserves inner text when the kind attribute is empty", () => {
    const editor = makeEditor()
    const parser = DOMParser.fromSchema(editor.schema)
    const container = document.createElement("div")
    container.innerHTML =
      '<p><a data-rune-ref-kind="" data-rune-ref-target="note-1">Empty Kind</a></p>'
    const doc = parser.parse(container)

    const text = doc.firstChild!.firstChild!
    expect(text.text).toBe("Empty Kind")
    expect(text.marks.find((m) => m.type.name === "internalRef")).toBeUndefined()

    editor.destroy()
  })
})

// The AI-markdown mention shape (markInlineContract.ts's `internalRef`
// entry): `<mention-page id="…">` / `<mention-block id="…">`, the raw HTML
// `parseAiMarkdown` hands to this same schema after markdown-it renders it.
describe("InternalRef — mention parseHTML (AI-markdown shape)", () => {
  it("parses a page mention (kind derived from tag name, alias defaults false)", () => {
    const editor = makeEditor()
    const parser = DOMParser.fromSchema(editor.schema)
    const container = document.createElement("div")
    container.innerHTML = '<p><mention-page id="Target">Display</mention-page></p>'
    const doc = parser.parse(container)

    const text = doc.firstChild!.firstChild!
    expect(text.text).toBe("Display")
    const mark = text.marks.find((m) => m.type.name === "internalRef")
    expect(mark?.attrs).toMatchObject({ kind: "page", target: "Target", alias: false })

    editor.destroy()
  })

  it("parses alias=\"true\" into alias: true", () => {
    const editor = makeEditor()
    const parser = DOMParser.fromSchema(editor.schema)
    const container = document.createElement("div")
    container.innerHTML =
      '<p><mention-page id="Target" alias="true">Display</mention-page></p>'
    const doc = parser.parse(container)

    const text = doc.firstChild!.firstChild!
    const mark = text.marks.find((m) => m.type.name === "internalRef")
    expect(mark?.attrs).toMatchObject({ kind: "page", target: "Target", alias: true })

    editor.destroy()
  })

  it("parses a block mention (kind: block, opaque target string)", () => {
    const editor = makeEditor()
    const parser = DOMParser.fromSchema(editor.schema)
    const container = document.createElement("div")
    container.innerHTML = '<p><mention-block id="note-1#block-2">Block ref</mention-block></p>'
    const doc = parser.parse(container)

    const text = doc.firstChild!.firstChild!
    expect(text.text).toBe("Block ref")
    const mark = text.marks.find((m) => m.type.name === "internalRef")
    expect(mark?.attrs).toMatchObject({ kind: "block", target: "note-1#block-2" })

    editor.destroy()
  })

  it("drops the mark but preserves inner text when the mention has no id attribute", () => {
    const editor = makeEditor()
    const parser = DOMParser.fromSchema(editor.schema)
    const container = document.createElement("div")
    container.innerHTML = "<p><mention-page>Display</mention-page></p>"
    const doc = parser.parse(container)

    const text = doc.firstChild!.firstChild!
    expect(text.text).toBe("Display")
    expect(text.marks.find((m) => m.type.name === "internalRef")).toBeUndefined()

    editor.destroy()
  })

  it("drops the mark but preserves inner text when the mention's id is empty", () => {
    const editor = makeEditor()
    const parser = DOMParser.fromSchema(editor.schema)
    const container = document.createElement("div")
    container.innerHTML = '<p><mention-page id="">Display</mention-page></p>'
    const doc = parser.parse(container)

    const text = doc.firstChild!.firstChild!
    expect(text.text).toBe("Display")
    expect(text.marks.find((m) => m.type.name === "internalRef")).toBeUndefined()

    editor.destroy()
  })

  it("an unknown mention-* tag name has no matching rule; inner text passes through unmarked", () => {
    const editor = makeEditor()
    const parser = DOMParser.fromSchema(editor.schema)
    const container = document.createElement("div")
    container.innerHTML = '<p><mention-foo id="Target">Display</mention-foo></p>'
    const doc = parser.parse(container)

    const text = doc.firstChild!.firstChild!
    expect(text.text).toBe("Display")
    expect(text.marks.find((m) => m.type.name === "internalRef")).toBeUndefined()

    editor.destroy()
  })

  it("renderHTML always emits the editor's data-rune-ref-* shape, even for a mark parsed from a mention tag", () => {
    const editor = makeEditor()
    editor.commands.setContent('<p><mention-page id="Target">Display</mention-page></p>')

    const html = editor.getHTML()
    expect(html).toContain('data-rune-ref-kind="page"')
    expect(html).toContain('data-rune-ref-target="Target"')
    expect(html).not.toContain("<mention-page")

    editor.destroy()
  })
})

describe("InternalRef — selection commands", () => {
  it("applies the mark with setInternalRef across a non-empty multi-node selection", () => {
    // An existing internalRef in the middle splits the paragraph into
    // three inline text nodes, so a selection spanning all three exercises
    // the addMarkToAllowedInlineSelection nodesBetween loop over multiple
    // nodes — including the existingMark remove+re-add merge branch on the
    // already-marked middle node.
    const editor = makeEditor()
    editor.commands.setContent(
      '<p>Alpha <a data-rune-ref-kind="block" data-rune-ref-target="mid">Beta</a> Gamma</p>',
    )
    // Select the entire paragraph text (pos 1 → end of the text content).
    const paragraphEnd = editor.state.doc.firstChild!.nodeSize - 1
    editor.commands.setTextSelection({ from: 1, to: paragraphEnd })

    expect(editor.commands.setInternalRef({ kind: "page", target: "n1" })).toBe(true)

    // Every inline text node in the selected range now carries the updated
    // ref; none is left unmarked. (PM may join adjacent identically-marked
    // text nodes, so assert coverage by character count, not node count.)
    let markedChars = 0
    let unmarkedChars = 0
    editor.state.doc.firstChild!.descendants((node) => {
      if (!node.isText) return true
      const mark = node.marks.find((m) => m.type.name === "internalRef")
      if (mark?.attrs.kind === "page" && mark.attrs.target === "n1") {
        markedChars += node.text?.length ?? 0
      } else {
        unmarkedChars += node.text?.length ?? 0
      }
      return true
    })
    expect(markedChars).toBe("Alpha Beta Gamma".length)
    expect(unmarkedChars).toBe(0)

    editor.destroy()
  })

  it("merges existing internalRef attrs when updating a selected ref", () => {
    const editor = makeEditor()
    editor.commands.setContent(
      '<p><a data-rune-ref-kind="block" data-rune-ref-target="old">Ref</a></p>',
    )
    editor.commands.setTextSelection({ from: 1, to: 4 })

    // Update only `target`; the existing `kind: "block"` must be retained
    // by the { ...existingMark.attrs, ...attrs } merge.
    expect(editor.commands.setInternalRef({ kind: "block", target: "new" })).toBe(true)

    expect(firstInternalRefMark(editor)?.attrs).toMatchObject({
      kind: "block",
      target: "new",
    })

    editor.destroy()
  })

  it("applies the mark with toggleInternalRef across a non-empty selection", () => {
    const editor = makeEditor()
    editor.commands.setContent("<p>Alpha Beta</p>")
    editor.commands.setTextSelection({ from: 1, to: 6 })

    expect(editor.commands.toggleInternalRef({ kind: "page", target: "Alpha" })).toBe(
      true,
    )

    const text = editor.state.doc.firstChild!.firstChild!
    const mark = text.marks.find((m) => m.type.name === "internalRef")
    expect(mark?.attrs).toMatchObject({ kind: "page", target: "Alpha" })
    expect(text.text).toBe("Alpha")

    editor.destroy()
  })

  it("removes the mark with unsetInternalRef", () => {
    const editor = makeEditor()
    editor.commands.setContent(
      '<p><a data-rune-ref-kind="page" data-rune-ref-target="Alpha">Alpha</a> Beta</p>',
    )
    editor.commands.setTextSelection({ from: 1, to: 6 })

    expect(editor.commands.unsetInternalRef()).toBe(true)

    const paragraph = editor.state.doc.firstChild!
    expect(paragraph.textContent).toBe("Alpha Beta")
    paragraph.descendants((node) => {
      expect(node.marks.find((m) => m.type.name === "internalRef")).toBeUndefined()
    })

    editor.destroy()
  })

  it("does not dispatch or change the doc when setting an invalid (empty target) ref", () => {
    const editor = makeEditor()
    editor.commands.setContent("<p>Alpha Beta</p>")
    editor.commands.setTextSelection({ from: 1, to: 6 })
    const before = editor.state.doc.toJSON()
    const dispatch = editor.view.dispatch.bind(editor.view)
    let dispatches = 0
    editor.view.dispatch = (transaction) => {
      dispatches += 1
      dispatch(transaction)
    }

    expect(editor.commands.setInternalRef({ kind: "page", target: "" })).toBe(false)

    expect(dispatches).toBe(0)
    expect(editor.state.doc.toJSON()).toEqual(before)

    editor.destroy()
  })

  it("does not dispatch or change the doc when toggling an invalid (empty kind) ref", () => {
    const editor = makeEditor()
    editor.commands.setContent("<p>Alpha Beta</p>")
    editor.commands.setTextSelection({ from: 1, to: 6 })
    const before = editor.state.doc.toJSON()
    const dispatch = editor.view.dispatch.bind(editor.view)
    let dispatches = 0
    editor.view.dispatch = (transaction) => {
      dispatches += 1
      dispatch(transaction)
    }

    expect(editor.commands.toggleInternalRef({ kind: "", target: "Alpha" })).toBe(false)

    expect(dispatches).toBe(0)
    expect(editor.state.doc.toJSON()).toEqual(before)

    editor.destroy()
  })
})
