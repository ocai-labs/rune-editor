// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { Editor, Extension, type AnyExtension } from "@tiptap/core"
import Document from "@tiptap/extension-document"
import Text from "@tiptap/extension-text"
import type { Mark } from "@tiptap/pm/model"
import { NodeSelection } from "@tiptap/pm/state"
import { describe, expect, it, vi } from "vitest"
import { Paragraph } from "../../blocks/Paragraph/block"
import { createRuneKit } from "../../kit"
import { EntityRefs } from "../entity-refs"
import { commitWikiLink } from "./commitWikiLink"
import { WIKI_LINK_PASTE_RULE_RE, WikiLink } from "."

const UnsafeWikiLinkHTMLAttributes = Extension.create({
  name: "unsafeWikiLinkHTMLAttributes",

  addGlobalAttributes() {
    return [
      {
        types: ["wikiLink"],
        attributes: {
          "data-wikilink": {
            default: "global-spoof",
            renderHTML: (attributes) => ({
              "data-wikilink": attributes["data-wikilink"],
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

const ExtraWikiLinkAttributes = Extension.create({
  name: "extraWikiLinkAttributes",

  addGlobalAttributes() {
    return [
      {
        types: ["wikiLink"],
        attributes: {
          "data-extra": {
            default: null,
            parseHTML: (element) => element.getAttribute("data-extra"),
            renderHTML: (attributes) =>
              attributes["data-extra"]
                ? { "data-extra": attributes["data-extra"] }
                : {},
          },
        },
      },
    ]
  },
})

function makeEditor(extensions: AnyExtension[] = [WikiLink]): Editor {
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

function makeKitEditor(options: Parameters<typeof createRuneKit>[0] = {}): Editor {
  const element = document.createElement("div")
  document.body.appendChild(element)
  const editor = new Editor({
    element,
    extensions: createRuneKit(options),
  })
  const destroy = editor.destroy.bind(editor)
  editor.destroy = () => {
    destroy()
    element.remove()
  }
  return editor
}

function typeText(editor: Editor, text: string) {
  for (const ch of text) {
    const { from, to } = editor.state.selection
    const handled = editor.view.someProp("handleTextInput", (fn) =>
      fn(editor.view, from, to, ch, null as any),
    )
    if (!handled) {
      editor.view.dispatch(editor.state.tr.insertText(ch, from, to))
    }
  }
}

function firstWikiLinkMark(editor: Editor) {
  const text = editor.state.doc.firstChild?.firstChild
  return text?.marks.find((m) => m.type.name === "wikiLink")
}

function firstInternalRefMark(editor: Editor) {
  const text = editor.state.doc.firstChild?.firstChild
  return text?.marks.find((m) => m.type.name === "internalRef")
}

function textNodeWithText(editor: Editor, text: string) {
  let match: { text: string | undefined; marks: readonly Mark[] } | undefined

  editor.state.doc.descendants((node) => {
    if (node.isText && node.text === text) {
      match = { text: node.text, marks: node.marks }
      return false
    }
    return true
  })

  if (!match) throw new Error(`Expected a text node containing ${text}`)
  return match
}

function triggerWikiLinkClick(editor: Editor) {
  const pos = 1
  const node = editor.state.doc.nodeAt(pos)
  if (!node) throw new Error("Expected a text node at the wiki link click position")

  const event = new MouseEvent("click", { bubbles: true, cancelable: true })
  let handled: boolean | undefined
  editor.view.someProp("handleClickOn", (handler) => {
    handled = handler(editor.view, pos, node, pos, event, true) ?? undefined
    return true
  })

  return { event, handled }
}

function triggerWikiLinkAncestorClick(editor: Editor) {
  const pos = 1
  const node = editor.state.doc.firstChild
  if (!node) throw new Error("Expected a paragraph node for the wiki link click")

  const event = new MouseEvent("click", { bubbles: true, cancelable: true })
  let handled: boolean | undefined
  editor.view.someProp("handleClickOn", (handler) => {
    handled = handler(editor.view, pos, node, pos, event, false) ?? undefined
    return true
  })

  return { event, handled }
}

function dispatchProseMirrorClick(
  editor: Editor,
  target: EventTarget,
  pos: number,
  inside: number,
) {
  const posAtCoords = editor.view.posAtCoords.bind(editor.view)
  editor.view.posAtCoords = () => ({ pos, inside })

  try {
    target.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    )
    const mouseUp = new MouseEvent("mouseup", { bubbles: true, cancelable: true })
    target.dispatchEvent(mouseUp)
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
    return mouseUp
  } finally {
    editor.view.posAtCoords = posAtCoords
  }
}

function wikiLinkElement(editor: Editor) {
  const element = editor.view.dom.querySelector("[data-wikilink]")
  if (!element) throw new Error("Expected a rendered wiki link element")
  return element
}

function attrOnWikiLinkOrChild(
  anchor: HTMLElement | null | undefined,
  attr: string,
) {
  if (!anchor) return null
  return (
    anchor.querySelector(`[${attr}]`)?.getAttribute(attr) ??
    anchor.getAttribute(attr) ??
    null
  )
}

describe("createRuneKit", () => {
  it("registers WikiLink in the default kit", () => {
    const element = document.createElement("div")
    document.body.appendChild(element)
    const editor = new Editor({
      element,
      extensions: createRuneKit({ suggestionMenus: false }),
      content: "<p></p>",
    })

    expect(editor.schema.marks.wikiLink).toBeDefined()

    editor.destroy()
    element.remove()
  })

  it("registers InternalRef in the default kit", () => {
    const element = document.createElement("div")
    document.body.appendChild(element)
    const editor = new Editor({
      element,
      extensions: createRuneKit({ suggestionMenus: false }),
      content: "<p></p>",
    })

    expect(editor.schema.marks.internalRef).toBeDefined()

    editor.destroy()
    element.remove()
  })
})

describe("WikiLink", () => {
  it("applies the mark with setWikiLink", () => {
    const editor = makeEditor()
    editor.commands.setContent("<p>Alpha Beta</p>")
    editor.commands.setTextSelection({ from: 1, to: 6 })

    expect(editor.commands.setWikiLink({ target: "Alpha" })).toBe(true)

    const text = editor.state.doc.firstChild!.firstChild!
    const mark = text.marks.find((m) => m.type.name === "wikiLink")
    expect(mark?.attrs.target).toBe("Alpha")
    expect(text.text).toBe("Alpha")

    editor.destroy()
  })

  it("removes the mark with unsetWikiLink", () => {
    const editor = makeEditor()
    editor.commands.setContent('<p><a data-wikilink="Alpha">Alpha</a> Beta</p>')
    editor.commands.setTextSelection({ from: 1, to: 6 })

    expect(editor.commands.unsetWikiLink()).toBe(true)

    const paragraph = editor.state.doc.firstChild!
    expect(paragraph.textContent).toBe("Alpha Beta")
    paragraph.descendants((node) => {
      expect(node.marks.find((m) => m.type.name === "wikiLink")).toBeUndefined()
    })

    editor.destroy()
  })

  it("applies the mark with toggleWikiLink", () => {
    const editor = makeEditor()
    editor.commands.setContent("<p>Alpha Beta</p>")
    editor.commands.setTextSelection({ from: 1, to: 6 })

    expect(editor.commands.toggleWikiLink({ target: "Alpha" })).toBe(true)

    const text = editor.state.doc.firstChild!.firstChild!
    const mark = text.marks.find((m) => m.type.name === "wikiLink")
    expect(mark?.attrs.target).toBe("Alpha")
    expect(text.text).toBe("Alpha")

    editor.destroy()
  })

  it("does not dispatch or change the doc when setting an empty target", () => {
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

    expect(editor.commands.setWikiLink({ target: "" })).toBe(false)

    expect(dispatches).toBe(0)
    expect(editor.state.doc.toJSON()).toEqual(before)

    editor.destroy()
  })

  it("does not dispatch or change the doc when toggling an empty target", () => {
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

    expect(editor.commands.toggleWikiLink({ target: "" })).toBe(false)

    expect(dispatches).toBe(0)
    expect(editor.state.doc.toJSON()).toEqual(before)

    editor.destroy()
  })

  it("does not apply transformTarget when setting the mark through commands", () => {
    const editor = makeEditor([
      WikiLink.configure({
        transformTarget: (target) => `id:${target}`,
      }),
    ])
    editor.commands.setContent("<p>Foo</p>")
    editor.commands.setTextSelection({ from: 1, to: 4 })

    expect(editor.commands.setWikiLink({ target: "Foo" })).toBe(true)

    const text = editor.state.doc.firstChild!.firstChild!
    const mark = text.marks.find((m) => m.type.name === "wikiLink")
    expect(mark?.attrs.target).toBe("Foo")
    expect(editor.getHTML()).toContain('data-wikilink="Foo"')
    expect(editor.getHTML()).not.toContain('data-wikilink="id:Foo"')

    editor.destroy()
  })

  it("merges existing wiki link attrs when updating a selected wiki link", () => {
    const editor = makeEditor([WikiLink, ExtraWikiLinkAttributes])
    editor.commands.setContent(
      '<p><a data-wikilink="Foo" data-extra="keep">Foo</a></p>',
    )
    editor.commands.setTextSelection({ from: 1, to: 4 })

    expect(editor.commands.setWikiLink({ target: "Bar" })).toBe(true)

    const mark = firstWikiLinkMark(editor)
    expect(mark?.attrs.target).toBe("Bar")
    expect(mark?.attrs["data-extra"]).toBe("keep")

    editor.destroy()
  })

  it("removes URL link from the overlap when setting a wiki link through the default kit", () => {
    const editor = makeKitEditor({ suggestionMenus: false })
    editor.commands.setContent(
      '<p><a href="https://example.test/page">Alpha Beta Gamma</a></p>',
    )
    editor.commands.setTextSelection({ from: 7, to: 11 })
    const wikiLinkMark = editor.state.schema.marks.wikiLink
    if (!wikiLinkMark) throw new Error("Expected default kit to register wikiLink")

    editor.view.dispatch(
      editor.state.tr.addMark(7, 11, wikiLinkMark.create({ target: "Beta" })),
    )

    const beta = textNodeWithText(editor, "Beta")
    expect(beta.marks.find((m) => m.type.name === "wikiLink")?.attrs.target).toBe(
      "Beta",
    )
    expect(beta.marks.find((m) => m.type.name === "link")).toBeUndefined()

    editor.destroy()
  })

  it("returns true and removes URL link from the overlap when setWikiLink is chained through the default kit", () => {
    const editor = makeKitEditor({ suggestionMenus: false })
    editor.commands.setContent(
      '<p><a href="https://example.test/page">Alpha Beta Gamma</a></p>',
    )

    const ok = editor
      .chain()
      .setTextSelection({ from: 7, to: 11 })
      .setWikiLink({ target: "Beta" })
      .run()

    expect(ok).toBe(true)
    const beta = textNodeWithText(editor, "Beta")
    expect(beta.marks.find((m) => m.type.name === "wikiLink")?.attrs.target).toBe(
      "Beta",
    )
    expect(beta.marks.find((m) => m.type.name === "link")).toBeUndefined()

    editor.destroy()
  })

  it("does not report success when setWikiLink is applied to a divider selection", () => {
    const editor = makeKitEditor({ suggestionMenus: false })
    editor.commands.setContent("<hr>")
    editor.view.dispatch(
      editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 0)),
    )
    const before = editor.state.doc.toJSON()

    expect(editor.commands.setWikiLink({ target: "Divider" })).toBe(false)
    expect(editor.state.doc.toJSON()).toEqual(before)

    editor.destroy()
  })

  it("does not report success or add wikiLink when selected inline code excludes it", () => {
    const editor = makeKitEditor({ suggestionMenus: false })
    editor.commands.setContent("<p><code>Beta</code></p>")

    const ok = editor
      .chain()
      .setTextSelection({ from: 1, to: 5 })
      .setWikiLink({ target: "Beta" })
      .run()

    expect(ok).toBe(false)
    const beta = textNodeWithText(editor, "Beta")
    expect(beta.marks.find((m) => m.type.name === "code")).toBeDefined()
    expect(beta.marks.find((m) => m.type.name === "wikiLink")).toBeUndefined()

    editor.destroy()
  })

  it("removes wiki link from the overlap when setting a URL link through the default kit", () => {
    const editor = makeKitEditor({ suggestionMenus: false })
    editor.commands.setContent(
      '<p><a data-wikilink="Page">Alpha Beta Gamma</a></p>',
    )
    editor.commands.setTextSelection({ from: 7, to: 11 })
    expect(
      textNodeWithText(editor, "Alpha Beta Gamma").marks.some(
        (m) => m.type.name === "wikiLink",
      ),
    ).toBe(true)
    const linkMark = editor.state.schema.marks.link
    if (!linkMark) throw new Error("Expected default kit to register link")

    editor.view.dispatch(
      editor.state.tr.addMark(
        7,
        11,
        linkMark.create({ href: "https://example.test/page" }),
      ),
    )

    const beta = textNodeWithText(editor, "Beta")
    expect(beta.marks.find((m) => m.type.name === "link")?.attrs.href).toBe(
      "https://example.test/page",
    )
    expect(beta.marks.find((m) => m.type.name === "wikiLink")).toBeUndefined()

    editor.destroy()
  })

  it("returns true and removes wiki link from the overlap when setLink is chained through the default kit", () => {
    const editor = makeKitEditor({ suggestionMenus: false })
    editor.commands.setContent(
      '<p><a data-wikilink="Page">Alpha Beta Gamma</a></p>',
    )

    const ok = editor
      .chain()
      .setTextSelection({ from: 7, to: 11 })
      .setLink({ href: "https://example.test/page" })
      .run()

    expect(ok).toBe(true)
    const beta = textNodeWithText(editor, "Beta")
    expect(beta.marks.find((m) => m.type.name === "link")?.attrs.href).toBe(
      "https://example.test/page",
    )
    expect(beta.marks.find((m) => m.type.name === "wikiLink")).toBeUndefined()

    editor.destroy()
  })

  it("merges existing URL link attrs when updating a selected link through the default kit", () => {
    const editor = makeKitEditor({ suggestionMenus: false })
    editor.commands.setContent(
      '<p><a href="https://old.example" target="_blank" rel="noopener" title="Old title" class="old-link">Alpha</a></p>',
    )

    const ok = editor
      .chain()
      .setTextSelection({ from: 1, to: 6 })
      .setLink({ href: "https://new.example" })
      .run()

    expect(ok).toBe(true)
    const alpha = textNodeWithText(editor, "Alpha")
    const mark = alpha.marks.find((m) => m.type.name === "link")
    expect(mark?.attrs).toMatchObject({
      href: "https://new.example",
      target: "_blank",
      rel: "noopener",
      title: "Old title",
      class: "old-link",
    })

    editor.destroy()
  })

  it("does not report success when setLink is applied to a divider selection", () => {
    const editor = makeKitEditor({ suggestionMenus: false })
    editor.commands.setContent("<hr>")
    editor.view.dispatch(
      editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 0)),
    )
    const before = editor.state.doc.toJSON()

    const ok = editor
      .chain()
      .setLink({ href: "https://example.test/page" })
      .run()

    expect(ok).toBe(false)
    expect(editor.state.doc.toJSON()).toEqual(before)

    editor.destroy()
  })

  it("does not report success or add link when selected inline code excludes it", () => {
    const editor = makeKitEditor({ suggestionMenus: false })
    editor.commands.setContent("<p><code>Beta</code></p>")

    const ok = editor
      .chain()
      .setTextSelection({ from: 1, to: 5 })
      .setLink({ href: "https://example.test/page" })
      .run()

    expect(ok).toBe(false)
    const beta = textNodeWithText(editor, "Beta")
    expect(beta.marks.find((m) => m.type.name === "code")).toBeDefined()
    expect(beta.marks.find((m) => m.type.name === "link")).toBeUndefined()

    editor.destroy()
  })

  it("round-trips target attr and display text through getHTML and setContent", () => {
    const editor = makeEditor()
    editor.commands.setContent(
      '<p>See <a data-wikilink="Project Rune">Project Rune</a>.</p>',
    )

    const html = editor.getHTML()
    expect(html).toContain('data-wikilink="Project Rune"')
    expect(html).toContain('class="rune-wikilink"')
    expect(html).toContain(">Project Rune</a>")

    editor.commands.setContent(html)
    const text = editor.state.doc.firstChild!.child(1)
    const mark = text.marks.find((m) => m.type.name === "wikiLink")
    expect(mark?.attrs.target).toBe("Project Rune")
    expect(text.text).toBe("Project Rune")

    editor.destroy()
  })

  it("drops the mark but preserves inner text when parsing an empty target", () => {
    const editor = makeEditor()
    editor.commands.setContent('<p><a data-wikilink="">Empty</a></p>')

    const text = editor.state.doc.firstChild!.firstChild!
    expect(text.text).toBe("Empty")
    expect(text.marks.find((m) => m.type.name === "wikiLink")).toBeUndefined()

    editor.destroy()
  })

  it("omits data-wikilink when rendering a programmatic empty-target mark", () => {
    const editor = makeEditor([
      WikiLink.configure({
        HTMLAttributes: {
          "data-wikilink": "configured-spoof",
          "DATA-WIKILINK": "case-spoof",
          HREF: "https://x.test",
          ROLE: "button",
          tabIndex: "0",
        },
      }),
    ])
    editor.commands.setContent({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Empty",
              marks: [{ type: "wikiLink", attrs: { target: "" } }],
            },
          ],
        },
      ],
    })

    const html = editor.getHTML()
    expect(html).toContain(">Empty</a>")
    expect(html).toContain('role="link"')
    expect(html).not.toContain("data-wikilink")
    expect(html).not.toContain('data-wikilink=""')
    expect(html).not.toContain("case-spoof")
    expect(html).not.toContain("href=")
    expect(html).not.toContain("tabindex=")

    editor.destroy()
  })

  it("strips reserved configured and merged HTML attributes", () => {
    const editor = makeEditor([
      WikiLink.configure({
        HTMLAttributes: {
          href: "https://example.test/configured",
          tabindex: "0",
          "data-wikilink": "configured-spoof",
          role: "button",
          class: "configured",
        },
      }),
      UnsafeWikiLinkHTMLAttributes,
    ])
    editor.commands.setContent('<p><a data-wikilink="Alpha">Alpha</a></p>')

    const html = editor.getHTML()
    expect(html).toContain('data-wikilink="Alpha"')
    expect(html).not.toContain("configured-spoof")
    expect(html).not.toContain("global-spoof")
    expect(html).toContain('role="link"')
    expect(html).not.toContain('role="button"')
    expect(html).toContain('class="rune-wikilink configured"')
    expect(html).not.toContain("href=")
    expect(html).not.toContain("tabindex=")

    editor.destroy()
  })

  it("strips reserved HTML attributes case-insensitively", () => {
    const editor = makeEditor([
      WikiLink.configure({
        HTMLAttributes: {
          tabIndex: "0",
          HREF: "https://x.test",
          ROLE: "button",
          "DATA-WIKILINK": "spoof",
        },
      }),
    ])
    editor.commands.setContent('<p><a data-wikilink="Alpha">Alpha</a></p>')

    const html = editor.getHTML()
    expect(html).toContain('data-wikilink="Alpha"')
    expect(html).not.toContain("spoof")
    expect(html).toContain('role="link"')
    expect(html).not.toContain('role="button"')
    expect(html).not.toContain("href=")
    expect(html).not.toContain("HREF=")
    expect(html).not.toContain("tabindex=")
    expect(html).not.toContain("tabIndex=")

    editor.destroy()
  })

  it("preserves special characters in target through parse and render", () => {
    const editor = makeEditor()
    const target = `Area/One?x=1&y=<two> "quote" 'tick'`
    editor.commands.setContent(
      '<p><a data-wikilink="Area/One?x=1&amp;y=&lt;two&gt; &quot;quote&quot; &#39;tick&#39;">Special</a></p>',
    )

    const html = editor.getHTML()
    editor.commands.setContent(html)
    const text = editor.state.doc.firstChild!.firstChild!
    const mark = text.marks.find((m) => m.type.name === "wikiLink")
    expect(mark?.attrs.target).toBe(target)
    expect(text.text).toBe("Special")
    expect(editor.getHTML()).toContain('data-wikilink="Area/One?x=1&amp;y=')

    editor.destroy()
  })

  it("does not extend the mark when typing at its trailing edge", () => {
    const editor = makeEditor()
    editor.commands.setContent('<p><a data-wikilink="Alpha">Alpha</a></p>')
    editor.commands.setTextSelection(6)
    editor.commands.insertContent("!")

    const bang = editor.state.doc.firstChild!.child(1)
    expect(bang.text).toBe("!")
    expect(bang.marks.find((m) => m.type.name === "wikiLink")).toBeUndefined()

    editor.destroy()
  })

  it("does not absorb inserted text immediately before the mark", () => {
    const editor = makeEditor()
    editor.commands.setContent('<p><a data-wikilink="Alpha">Alpha</a></p>')
    editor.commands.setTextSelection(1)
    editor.commands.insertContent("Before ")

    const before = editor.state.doc.firstChild!.firstChild!
    const marked = editor.state.doc.firstChild!.child(1)
    expect(before.text).toBe("Before ")
    expect(before.marks.find((m) => m.type.name === "wikiLink")).toBeUndefined()
    expect(marked.marks.find((m) => m.type.name === "wikiLink")?.attrs.target).toBe(
      "Alpha",
    )

    editor.destroy()
  })

  it("commits a wiki link by deleting the trigger range and inserting marked alias text", () => {
    const editor = makeKitEditor({ suggestionMenus: false })
    editor.commands.setContent("<p>before [[ho</p>")

    commitWikiLink(
      {
        editor,
        range: { from: 8, to: 12 },
        triggerCharacter: "[[",
      },
      { target: "note-1", alias: "Home" },
    )

    const paragraph = editor.state.doc.firstChild!
    const linkText = paragraph.child(1)
    expect(paragraph.textContent).toBe("before Home")
    expect(paragraph.textContent).not.toContain("[[ho")
    expect(linkText.text).toBe("Home")
    expect(linkText.marks.find((m) => m.type.name === "internalRef")?.attrs).toMatchObject({
      kind: "page",
      target: "note-1",
    })
    expect(linkText.marks.find((m) => m.type.name === "wikiLink")).toBeUndefined()
    expect(editor.getHTML()).toContain('data-rune-ref-kind="page"')
    expect(editor.getHTML()).toContain('data-rune-ref-target="note-1"')

    editor.destroy()
  })

  it("commits a wiki link using the target as display text when alias is omitted", () => {
    const editor = makeKitEditor({ suggestionMenus: false })
    editor.commands.setContent("<p>before [[ho</p>")

    commitWikiLink(
      {
        editor,
        range: { from: 8, to: 12 },
        triggerCharacter: "[[",
      },
      { target: "note-1" },
    )

    const paragraph = editor.state.doc.firstChild!
    const linkText = paragraph.child(1)
    expect(paragraph.textContent).toBe("before note-1")
    expect(linkText.text).toBe("note-1")
    expect(linkText.marks.find((m) => m.type.name === "internalRef")?.attrs).toMatchObject({
      kind: "page",
      target: "note-1",
    })

    editor.destroy()
  })

  it("does not change the doc when committing a wiki link with an empty target", () => {
    const editor = makeEditor()
    editor.commands.setContent("<p>before [[ho</p>")
    const before = editor.state.doc.toJSON()
    const dispatch = editor.view.dispatch.bind(editor.view)
    let dispatches = 0
    editor.view.dispatch = (transaction) => {
      dispatches += 1
      dispatch(transaction)
    }

    commitWikiLink(
      {
        editor,
        range: { from: 8, to: 12 },
        triggerCharacter: "[[",
      },
      { target: "", alias: "Home" },
    )

    expect(dispatches).toBe(0)
    expect(editor.state.doc.toJSON()).toEqual(before)
    expect(editor.state.doc.firstChild?.textContent).toBe("before [[ho")

    editor.destroy()
  })

  it("does not change the doc or dispatch when committing without a wiki link mark in the schema", () => {
    const editor = makeEditor([])
    editor.commands.setContent("<p>before [[ho</p>")
    const before = editor.state.doc.toJSON()
    const dispatch = editor.view.dispatch.bind(editor.view)
    let dispatches = 0
    editor.view.dispatch = (transaction) => {
      dispatches += 1
      dispatch(transaction)
    }

    commitWikiLink(
      {
        editor,
        range: { from: 8, to: 12 },
        triggerCharacter: "[[",
      },
      { target: "note-1", alias: "Home" },
    )

    expect(dispatches).toBe(0)
    expect(editor.state.doc.toJSON()).toEqual(before)
    expect(editor.state.doc.firstChild?.textContent).toBe("before [[ho")

    editor.destroy()
  })

  // `label` vs `alias`: both seed the committed run's initial display text,
  // but only `alias` marks it as a user-fixed override (internalRef.alias =
  // true) that the label-sync plugin (labelSyncPlugin.ts) skips forever. A
  // `label`-seeded run stays alias=false, so syncLabel keeps following the
  // target's title on every future rename — the #56/#58 fix for the
  // suggestion menu, which only wants an initial display text, not a pin.
  describe("commitWikiLink — label vs alias (syncLabel semantics)", () => {
    function makeSyncKitEditor(titles: Map<string, string>) {
      return makeKitEditor({
        suggestionMenus: false,
        internalRef: {
          syncLabel: true,
          resolve: (attrs) => {
            const title = titles.get(attrs.target)
            return title ? { displayText: title } : null
          },
        },
      })
    }

    it("a label-created ref follows the target's title after a rename", () => {
      const titles = new Map([["note-1", "Original Title"]])
      const editor = makeSyncKitEditor(titles)
      editor.commands.setContent("<p>before [[ho</p>")

      commitWikiLink(
        { editor, range: { from: 8, to: 12 }, triggerCharacter: "[[" },
        { target: "note-1", label: "Original Title" },
      )

      const linkText = editor.state.doc.firstChild!.child(1)
      expect(linkText.text).toBe("Original Title")
      expect(
        linkText.marks.find((m) => m.type.name === "internalRef")?.attrs.alias,
      ).toBe(false)

      titles.set("note-1", "Renamed Title")
      editor.commands.refreshEntityRefs("internalRef")

      const updated = editor.state.doc.firstChild!.child(1)
      expect(updated.text).toBe("Renamed Title")

      editor.destroy()
    })

    it("an alias-created ref keeps its fixed text after the target is renamed", () => {
      const titles = new Map([["note-1", "Original Title"]])
      const editor = makeSyncKitEditor(titles)
      editor.commands.setContent("<p>before [[ho</p>")

      commitWikiLink(
        { editor, range: { from: 8, to: 12 }, triggerCharacter: "[[" },
        { target: "note-1", alias: "Custom Alias" },
      )

      const linkText = editor.state.doc.firstChild!.child(1)
      expect(linkText.text).toBe("Custom Alias")
      expect(
        linkText.marks.find((m) => m.type.name === "internalRef")?.attrs.alias,
      ).toBe(true)

      titles.set("note-1", "Renamed Title")
      editor.commands.refreshEntityRefs("internalRef")

      const updated = editor.state.doc.firstChild!.child(1)
      expect(updated.text).toBe("Custom Alias")

      editor.destroy()
    })

    it("alias wins over label when both are given", () => {
      const editor = makeKitEditor({ suggestionMenus: false })
      editor.commands.setContent("<p>before [[ho</p>")

      commitWikiLink(
        { editor, range: { from: 8, to: 12 }, triggerCharacter: "[[" },
        { target: "note-1", label: "Seeded Title", alias: "Custom Alias" },
      )

      const linkText = editor.state.doc.firstChild!.child(1)
      expect(linkText.text).toBe("Custom Alias")
      expect(
        linkText.marks.find((m) => m.type.name === "internalRef")?.attrs.alias,
      ).toBe(true)

      editor.destroy()
    })

    it("no label/no alias still falls back to target text with alias=false (no regression)", () => {
      const editor = makeKitEditor({ suggestionMenus: false })
      editor.commands.setContent("<p>before [[ho</p>")

      commitWikiLink(
        { editor, range: { from: 8, to: 12 }, triggerCharacter: "[[" },
        { target: "note-1" },
      )

      const linkText = editor.state.doc.firstChild!.child(1)
      expect(linkText.text).toBe("note-1")
      expect(
        linkText.marks.find((m) => m.type.name === "internalRef")?.attrs.alias,
      ).toBe(false)

      editor.destroy()
    })
  })

  it("calls onClick with attrs and the mouse event when clicked while editable", () => {
    const onClick = vi.fn()
    const editor = makeEditor([WikiLink.configure({ onClick })])
    editor.commands.setContent('<p><a data-wikilink="n1">Node</a></p>')

    const { event, handled } = triggerWikiLinkClick(editor)

    expect(handled).toBe(false)
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onClick).toHaveBeenCalledWith({ target: "n1" }, event)
    editor.destroy()
  })

  it("does not throw when a clicked wiki link has no onClick handler", () => {
    const editor = makeEditor()
    editor.commands.setContent('<p><a data-wikilink="n1">Node</a></p>')

    expect(() => triggerWikiLinkClick(editor)).not.toThrow()
    editor.destroy()
  })

  it("calls onClick when clicked while readonly", () => {
    const onClick = vi.fn()
    const editor = makeEditor([WikiLink.configure({ onClick })])
    editor.commands.setContent('<p><a data-wikilink="n1">Node</a></p>')
    editor.setEditable(false)

    const { event, handled } = triggerWikiLinkClick(editor)

    expect(handled).toBe(false)
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onClick).toHaveBeenCalledWith({ target: "n1" }, event)
    editor.destroy()
  })

  it("does not call onClick for non-direct handleClickOn calls", () => {
    const onClick = vi.fn()
    const editor = makeEditor([WikiLink.configure({ onClick })])
    editor.commands.setContent('<p><a data-wikilink="n1">Node</a></p>')

    const { handled } = triggerWikiLinkAncestorClick(editor)

    expect(handled).toBe(false)
    expect(onClick).not.toHaveBeenCalled()
    editor.destroy()
  })

  it("calls onClick exactly once from a DOM click while editable", () => {
    const onClick = vi.fn()
    const editor = makeEditor([WikiLink.configure({ onClick })])
    editor.commands.setContent('<p><a data-wikilink="n1">Node</a></p>')

    const event = dispatchProseMirrorClick(editor, wikiLinkElement(editor), 1, 1)

    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onClick).toHaveBeenCalledWith({ target: "n1" }, event)
    editor.destroy()
  })

  it("calls onClick exactly once from a DOM click while readonly", () => {
    const onClick = vi.fn()
    const editor = makeEditor([WikiLink.configure({ onClick })])
    editor.commands.setContent('<p><a data-wikilink="n1">Node</a></p>')
    editor.setEditable(false)

    const event = dispatchProseMirrorClick(editor, wikiLinkElement(editor), 1, 1)

    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onClick).toHaveBeenCalledWith({ target: "n1" }, event)
    editor.destroy()
  })

  it("does not call onClick when adjacent unmarked text is clicked", () => {
    const onClick = vi.fn()
    const editor = makeEditor([WikiLink.configure({ onClick })])
    editor.commands.setContent('<p><a data-wikilink="n1">Node</a> plain</p>')
    const unmarkedText = editor.view.dom.querySelector("p")?.childNodes[1]
    if (!unmarkedText) throw new Error("Expected adjacent unmarked text")

    dispatchProseMirrorClick(editor, unmarkedText, 5, 5)

    expect(onClick).not.toHaveBeenCalled()
    editor.destroy()
  })

  it("merges renderAttrs return value into rendered HTML attributes", () => {
    const renderAttrs = vi.fn(() => ({
      style: "--rune-wikilink-icon-display:none",
      class: "has-emoji",
    }))
    const editor = makeEditor([WikiLink.configure({ renderAttrs })])
    editor.commands.setContent('<p><a data-wikilink="page-1">Page</a></p>')

    const html = editor.getHTML()
    expect(renderAttrs).toHaveBeenCalledWith({ target: "page-1" })
    expect(html).toContain('class="rune-wikilink has-emoji"')
    expect(html).toMatch(/--rune-wikilink-icon-display:\s*none/)
    expect(html).toContain('data-wikilink="page-1"')

    editor.destroy()
  })

  it("strips reserved HTML attributes returned by renderAttrs", () => {
    const renderAttrs = () => ({
      href: "javascript:alert(1)",
      role: "button",
      tabindex: "0",
      "data-wikilink": "spoof",
    })
    const editor = makeEditor([WikiLink.configure({ renderAttrs })])
    editor.commands.setContent('<p><a data-wikilink="page-1">Page</a></p>')

    const html = editor.getHTML()
    expect(html).toContain('data-wikilink="page-1"')
    expect(html).not.toContain("spoof")
    expect(html).not.toContain("javascript:")
    expect(html).toContain('role="link"')
    expect(html).not.toContain('role="button"')
    expect(html).not.toContain("href=")
    expect(html).not.toContain("tabindex=")

    editor.destroy()
  })

  it("calls onHover with attrs, event, and rect when the wiki link is entered", () => {
    const onHover = vi.fn()
    const editor = makeEditor([WikiLink.configure({ onHover })])
    editor.commands.setContent('<p><a data-wikilink="page-1">Page</a></p>')
    const anchor = wikiLinkElement(editor)

    const event = new MouseEvent("mouseover", { bubbles: true, cancelable: true })
    anchor.dispatchEvent(event)

    expect(onHover).toHaveBeenCalledTimes(1)
    const firstCall = onHover.mock.calls[0]
    if (!firstCall) throw new Error("Expected onHover to record a call")
    const [attrs, eventArg, rect] = firstCall
    expect(attrs).toEqual({ target: "page-1" })
    expect(eventArg).toBe(event)
    // jsdom returns a plain DOMRect-shaped object rather than a DOMRect
    // instance — assert the shape, not the class identity.
    expect(rect).toMatchObject({
      x: expect.any(Number),
      y: expect.any(Number),
      width: expect.any(Number),
      height: expect.any(Number),
      top: expect.any(Number),
      left: expect.any(Number),
      right: expect.any(Number),
      bottom: expect.any(Number),
    })
    editor.destroy()
  })

  it("calls onHoverEnd with attrs and event when the wiki link is left", () => {
    const onHoverEnd = vi.fn()
    const editor = makeEditor([WikiLink.configure({ onHoverEnd })])
    editor.commands.setContent('<p><a data-wikilink="page-1">Page</a></p>')
    const anchor = wikiLinkElement(editor)

    const event = new MouseEvent("mouseout", { bubbles: true, cancelable: true })
    anchor.dispatchEvent(event)

    expect(onHoverEnd).toHaveBeenCalledTimes(1)
    expect(onHoverEnd).toHaveBeenCalledWith({ target: "page-1" }, event)
    editor.destroy()
  })

  it("does not refire onHover when relatedTarget is within the same wiki link", () => {
    const onHover = vi.fn()
    const editor = makeEditor([WikiLink.configure({ onHover })])
    editor.commands.setContent('<p><a data-wikilink="page-1">Page</a></p>')
    const anchor = wikiLinkElement(editor)

    // First entry from outside the anchor.
    anchor.dispatchEvent(
      new MouseEvent("mouseover", {
        bubbles: true,
        cancelable: true,
        relatedTarget: editor.view.dom,
      }),
    )
    expect(onHover).toHaveBeenCalledTimes(1)

    // Mouseover whose relatedTarget sits inside the anchor (e.g. moving
    // among nested mark elements) must NOT refire.
    anchor.dispatchEvent(
      new MouseEvent("mouseover", {
        bubbles: true,
        cancelable: true,
        relatedTarget: anchor,
      }),
    )
    expect(onHover).toHaveBeenCalledTimes(1)

    editor.destroy()
  })

  it("does not fire onHover when hovering content outside any wiki link", () => {
    const onHover = vi.fn()
    const editor = makeEditor([WikiLink.configure({ onHover })])
    editor.commands.setContent('<p><a data-wikilink="page-1">Page</a> plain</p>')
    const paragraph = editor.view.dom.querySelector("p")
    if (!paragraph) throw new Error("Expected a paragraph element")

    paragraph.dispatchEvent(
      new MouseEvent("mouseover", { bubbles: true, cancelable: true }),
    )

    expect(onHover).not.toHaveBeenCalled()
    editor.destroy()
  })

  it("does not throw on mouseover or mouseout when no hover handlers are configured", () => {
    const editor = makeEditor()
    editor.commands.setContent('<p><a data-wikilink="page-1">Page</a></p>')
    const anchor = wikiLinkElement(editor)

    expect(() =>
      anchor.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })),
    ).not.toThrow()
    expect(() =>
      anchor.dispatchEvent(new MouseEvent("mouseout", { bubbles: true })),
    ).not.toThrow()
    editor.destroy()
  })

  it("converts [[Foo]] into display text marked with target Foo", () => {
    const editor = makeKitEditor({ suggestionMenus: false })
    editor.commands.setContent("<p></p>")
    editor.commands.setTextSelection(1)

    typeText(editor, "[[Foo]]")

    expect(editor.state.doc.firstChild?.textContent).toBe("Foo")
    expect(editor.state.doc.textContent).not.toContain("[[")
    expect(firstInternalRefMark(editor)?.attrs).toMatchObject({
      kind: "page",
      target: "Foo",
    })
    expect(firstWikiLinkMark(editor)).toBeUndefined()
    editor.destroy()
  })

  it("preserves normal prose before a converted wiki link", () => {
    const editor = makeEditor()
    editor.commands.setContent("<p></p>")
    editor.commands.setTextSelection(1)

    typeText(editor, "See [[Foo]]")

    const paragraph = editor.state.doc.firstChild!
    const prefix = paragraph.child(0)
    const linkText = paragraph.child(1)
    expect(paragraph.textContent).toBe("See Foo")
    expect(prefix.text).toBe("See ")
    expect(prefix.marks.find((m) => m.type.name === "wikiLink")).toBeUndefined()
    expect(linkText.text).toBe("Foo")
    expect(linkText.marks.find((m) => m.type.name === "wikiLink")?.attrs.target).toBe(
      "Foo",
    )
    editor.destroy()
  })

  it("converts [[Foo|Bar]] into alias text marked with target Foo", () => {
    const editor = makeEditor()
    editor.commands.setContent("<p></p>")
    editor.commands.setTextSelection(1)

    typeText(editor, "[[Foo|Bar]]")

    expect(editor.state.doc.firstChild?.textContent).toBe("Bar")
    expect(firstWikiLinkMark(editor)?.attrs.target).toBe("Foo")
    editor.destroy()
  })

  it("uses the raw target as display text for an empty alias", () => {
    const editor = makeEditor()
    editor.commands.setContent("<p></p>")
    editor.commands.setTextSelection(1)

    typeText(editor, "[[Foo|]]")

    expect(editor.state.doc.firstChild?.textContent).toBe("Foo")
    expect(firstWikiLinkMark(editor)?.attrs.target).toBe("Foo")
    editor.destroy()
  })

  it("leaves empty targets as literal text", () => {
    const editor = makeEditor()
    editor.commands.setContent("<p></p>")
    editor.commands.setTextSelection(1)

    typeText(editor, "[[]]")

    expect(editor.state.doc.firstChild?.textContent).toBe("[[]]")
    expect(firstWikiLinkMark(editor)).toBeUndefined()
    editor.destroy()
  })

  it("leaves alias-only wiki links as literal text", () => {
    const editor = makeEditor()
    editor.commands.setContent("<p></p>")
    editor.commands.setTextSelection(1)

    typeText(editor, "[[|Bar]]")

    expect(editor.state.doc.firstChild?.textContent).toBe("[[|Bar]]")
    expect(firstWikiLinkMark(editor)).toBeUndefined()
    editor.destroy()
  })

  it("applies transformTarget to the mark target without changing display text", () => {
    const editor = makeKitEditor({
      suggestionMenus: false,
      wikiLink: {
        transformTarget: (rawTarget) => rawTarget.toLowerCase().replaceAll(" ", "-"),
      },
    })
    editor.commands.setContent("<p></p>")
    editor.commands.setTextSelection(1)

    typeText(editor, "[[Project Rune|Rune]]")

    expect(editor.state.doc.firstChild?.textContent).toBe("Rune")
    expect(firstInternalRefMark(editor)?.attrs).toMatchObject({
      kind: "page",
      target: "project-rune",
    })
    editor.destroy()
  })

  it("passes wiki link options through the default kit registration", () => {
    const editor = makeKitEditor({
      suggestionMenus: false,
      wikiLink: { transformTarget: (target) => `id:${target}` },
    })
    editor.commands.setContent("<p></p>")
    editor.commands.setTextSelection(1)

    typeText(editor, "[[Home]]")

    expect(editor.state.doc.firstChild?.textContent).toBe("Home")
    expect(firstInternalRefMark(editor)?.attrs).toMatchObject({
      kind: "page",
      target: "id:Home",
    })
    editor.destroy()
  })

  it("keeps the raw target when transformTarget returns an empty string", () => {
    const editor = makeEditor([
      WikiLink.configure({
        transformTarget: () => "",
      }),
    ])
    editor.commands.setContent("<p></p>")
    editor.commands.setTextSelection(1)

    typeText(editor, "[[Project Rune|Rune]]")

    expect(editor.state.doc.firstChild?.textContent).toBe("Rune")
    expect(firstWikiLinkMark(editor)?.attrs.target).toBe("Project Rune")
    editor.destroy()
  })

  // Vitest/jsdom does not fully drive the paste pipeline; these cover the
  // paste regex directly, with the browser paste path covered in Task 11.
  it("matches multiple wiki links in pasted text", () => {
    const matches = Array.from(
      "x [[Foo]] y [[Bar|Baz]] z".matchAll(WIKI_LINK_PASTE_RULE_RE),
    )

    expect(matches).toHaveLength(2)
    expect(matches[0]?.[1]).toBe("Foo")
    expect(matches[0]?.[2]).toBeUndefined()
    expect(matches[1]?.[1]).toBe("Bar")
    expect(matches[1]?.[2]).toBe("Baz")
  })

  it("does not match pasted wiki links with an empty target", () => {
    expect(Array.from("[[|Bar]]".matchAll(WIKI_LINK_PASTE_RULE_RE))).toHaveLength(0)
    expect(Array.from("[[]]".matchAll(WIKI_LINK_PASTE_RULE_RE))).toHaveLength(0)
  })

  it("matches pasted wiki links with an empty alias", () => {
    const matches = Array.from("[[Foo|]]".matchAll(WIKI_LINK_PASTE_RULE_RE))

    expect(matches).toHaveLength(1)
    expect(matches[0]?.[1]).toBe("Foo")
    expect(matches[0]?.[2]).toBe("")
  })
})

describe("WikiLink — reactive entity refs", () => {
  it("isBroken adds data-broken to matching wiki links", () => {
    const editor = makeEditor([
      EntityRefs,
      WikiLink.configure({
        isBroken: (attrs) => attrs.target === "deleted",
      }),
    ])
    editor.commands.setContent(
      '<p><a data-wikilink="deleted">Deleted</a> <a data-wikilink="alive">Alive</a></p>',
    )

    const deleted = editor.view.dom.querySelector<HTMLAnchorElement>(
      'a[data-wikilink="deleted"]',
    )
    const alive = editor.view.dom.querySelector<HTMLAnchorElement>(
      'a[data-wikilink="alive"]',
    )
    expect(attrOnWikiLinkOrChild(deleted, "data-broken")).toBe("true")
    expect(attrOnWikiLinkOrChild(alive, "data-broken")).toBeNull()

    editor.destroy()
  })

  it("refreshEntityRefs re-stamps data-broken after host state changes", () => {
    const broken = new Set<string>()
    const editor = makeEditor([
      EntityRefs,
      WikiLink.configure({
        isBroken: (attrs) => broken.has(attrs.target),
      }),
    ])
    editor.commands.setContent('<p><a data-wikilink="alive">Alive</a></p>')

    let anchor = editor.view.dom.querySelector<HTMLAnchorElement>("a[data-wikilink]")
    expect(attrOnWikiLinkOrChild(anchor, "data-broken")).toBeNull()

    broken.add("alive")
    expect(editor.commands.refreshEntityRefs()).toBe(true)

    anchor = editor.view.dom.querySelector<HTMLAnchorElement>("a[data-wikilink]")
    expect(attrOnWikiLinkOrChild(anchor, "data-broken")).toBe("true")

    editor.destroy()
  })

  it("resolve title adds data-title and title without changing visible text", () => {
    const editor = makeEditor([
      EntityRefs,
      WikiLink.configure({
        resolve: (attrs) =>
          attrs.target === "note-1" ? { title: "Custom Title" } : null,
      }),
    ])
    editor.commands.setContent('<p><a data-wikilink="note-1">Link text</a></p>')

    const anchor = editor.view.dom.querySelector<HTMLAnchorElement>("a[data-wikilink]")
    expect(attrOnWikiLinkOrChild(anchor, "data-title")).toBe("Custom Title")
    expect(attrOnWikiLinkOrChild(anchor, "title")).toBe("Custom Title")
    expect(anchor?.textContent).toBe("Link text")

    editor.destroy()
  })

  it("resolve icon writes the wiki-link icon CSS variable with escaped URL", () => {
    const editor = makeEditor([
      EntityRefs,
      WikiLink.configure({
        resolve: () => ({
          icon: "data:image/svg+xml;utf8,<svg name='a' path='\\\\'/>",
        }),
      }),
    ])
    editor.commands.setContent('<p><a data-wikilink="note-1">Link</a></p>')

    const anchor = editor.view.dom.querySelector<HTMLAnchorElement>("a[data-wikilink]")
    const style = attrOnWikiLinkOrChild(anchor, "style") ?? ""
    expect(style).toContain("--rune-wikilink-icon-image")
    expect(style).toContain("url('data:image/svg+xml")
    expect(style).toContain("\\'")
    expect(style).toContain("\\\\")

    editor.destroy()
  })

  it("with no reactive options, no reactive attrs are emitted", () => {
    const editor = makeEditor([EntityRefs, WikiLink])
    editor.commands.setContent('<p><a data-wikilink="note-1">Link</a></p>')

    const anchor = editor.view.dom.querySelector<HTMLAnchorElement>("a[data-wikilink]")
    expect(attrOnWikiLinkOrChild(anchor, "data-broken")).toBeNull()
    expect(attrOnWikiLinkOrChild(anchor, "data-title")).toBeNull()
    expect(attrOnWikiLinkOrChild(anchor, "title")).toBeNull()
    expect(anchor?.className).toContain("rune-wikilink")

    editor.destroy()
  })

  it("isBroken + resolve icon co-locate data-broken and icon style on one element", () => {
    // Regression guard for the Fallback C broken-icon tint gap: when PM
    // hangs the decoration on an inner child span, both `data-broken` and
    // the icon `style` MUST land on the same element so the CSS rule
    // `.rune-wikilink [data-broken="true"][style*="--rune-wikilink-icon-image"]::before`
    // can override the icon color from the regular icon-fg to ref-broken-fg.
    // If a future PM update splits these into separate decoration children,
    // this test fails and the CSS needs a `:has()` fallback.
    const editor = makeEditor([
      EntityRefs,
      WikiLink.configure({
        isBroken: () => true,
        resolve: () => ({ icon: "data:image/svg+xml;utf8,<svg/>" }),
      }),
    ])
    editor.commands.setContent('<p><a data-wikilink="note-1">Link</a></p>')

    const anchor = editor.view.dom.querySelector<HTMLAnchorElement>("a[data-wikilink]")
    expect(anchor).not.toBeNull()
    // Find the element carrying data-broken (anchor or descendant).
    const brokenHost =
      anchor!.querySelector("[data-broken]") ??
      (anchor!.hasAttribute("data-broken") ? anchor! : null)
    expect(brokenHost).not.toBeNull()
    // Same element must carry the icon style — that's the precondition for
    // the broken-icon CSS override to fire.
    expect(brokenHost!.getAttribute("data-broken")).toBe("true")
    expect(brokenHost!.getAttribute("style") ?? "").toContain(
      "--rune-wikilink-icon-image",
    )

    editor.destroy()
  })

  it("resolve iconText emits the text/glyph CSS variable for emoji-style icons", () => {
    const editor = makeEditor([
      EntityRefs,
      WikiLink.configure({
        resolve: () => ({ iconText: "📝" }),
      }),
    ])
    editor.commands.setContent('<p><a data-wikilink="note-1">Link</a></p>')

    const anchor = editor.view.dom.querySelector<HTMLAnchorElement>("a[data-wikilink]")
    const style = attrOnWikiLinkOrChild(anchor, "style") ?? ""
    expect(style).toContain("--rune-wikilink-icon-text")
    expect(style).toContain("'📝'")
    // The mask-path slot must NOT be set — otherwise the image CSS rule
    // would also match and we'd double-render (mask silhouette of an
    // empty url() over the glyph).
    expect(style).not.toContain("--rune-wikilink-icon-image")

    editor.destroy()
  })

  it("resolve iconText wins when both icon and iconText are returned", () => {
    const editor = makeEditor([
      EntityRefs,
      WikiLink.configure({
        resolve: () => ({
          icon: "data:image/svg+xml;utf8,<svg/>",
          iconText: "📝",
        }),
      }),
    ])
    editor.commands.setContent('<p><a data-wikilink="note-1">Link</a></p>')

    const anchor = editor.view.dom.querySelector<HTMLAnchorElement>("a[data-wikilink]")
    const style = attrOnWikiLinkOrChild(anchor, "style") ?? ""
    expect(style).toContain("--rune-wikilink-icon-text")
    expect(style).not.toContain("--rune-wikilink-icon-image")

    editor.destroy()
  })

  it("resolve iconText escapes quote and backslash in the CSS content string", () => {
    const editor = makeEditor([
      EntityRefs,
      WikiLink.configure({
        resolve: () => ({ iconText: "a'b\\c" }),
      }),
    ])
    editor.commands.setContent('<p><a data-wikilink="note-1">Link</a></p>')

    const anchor = editor.view.dom.querySelector<HTMLAnchorElement>("a[data-wikilink]")
    const style = attrOnWikiLinkOrChild(anchor, "style") ?? ""
    expect(style).toContain("--rune-wikilink-icon-text")
    // Must escape — otherwise the embedded `'` closes the CSS string and
    // downstream-supplied text could inject arbitrary declarations.
    expect(style).toContain("\\'")
    expect(style).toContain("\\\\")
    // The literal unescaped sequence `a'b` must not appear in the value
    // (it would mean the quote wasn't escaped).
    expect(style).not.toMatch(/--rune-wikilink-icon-text: 'a'b/)

    editor.destroy()
  })

  it("isBroken + resolve iconText co-locate data-broken and icon-text style on one element", () => {
    // Parallel to the icon-image regression guard: the broken-state CSS
    // override for the glyph variant lives on the same descendant
    // selector, so both attributes must land on the same element.
    const editor = makeEditor([
      EntityRefs,
      WikiLink.configure({
        isBroken: () => true,
        resolve: () => ({ iconText: "📝" }),
      }),
    ])
    editor.commands.setContent('<p><a data-wikilink="note-1">Link</a></p>')

    const anchor = editor.view.dom.querySelector<HTMLAnchorElement>("a[data-wikilink]")
    const brokenHost =
      anchor!.querySelector("[data-broken]") ??
      (anchor!.hasAttribute("data-broken") ? anchor! : null)
    expect(brokenHost).not.toBeNull()
    expect(brokenHost!.getAttribute("data-broken")).toBe("true")
    expect(brokenHost!.getAttribute("style") ?? "").toContain(
      "--rune-wikilink-icon-text",
    )

    editor.destroy()
  })

  it("resolve icon takes precedence over renderAttrs icon for the same CSS variable", () => {
    const editor = makeEditor([
      EntityRefs,
      WikiLink.configure({
        renderAttrs: () => ({
          style: "--rune-wikilink-icon-image: url('static-icon')",
        }),
        resolve: () => ({ icon: "dynamic-icon" }),
      }),
    ])
    editor.commands.setContent('<p><a data-wikilink="note-1">Link</a></p>')

    const anchor = editor.view.dom.querySelector<HTMLAnchorElement>("a[data-wikilink]")
    const style = attrOnWikiLinkOrChild(anchor, "style") ?? ""
    expect(style).toContain("dynamic-icon")
    expect(style.lastIndexOf("dynamic-icon")).toBeGreaterThan(
      style.lastIndexOf("static-icon"),
    )

    editor.destroy()
  })
})

describe("WikiLink — standalone schema (no URL Link mark)", () => {
  it("builds an Editor with bare WikiLink + Paragraph + Text + Document — no schema crash", () => {
    // Regression guard for spec rev. 5 / test #21: the bare WikiLink
    // mark must not declare a mark-level `excludes` that references the
    // URL `link` mark, because doing so would crash PM `Schema` build
    // for any consumer who registers WikiLink without also registering
    // @tiptap/extension-link. Mutex with Link lives at the kit layer
    // (kit.ts patches both sides via .extend), not on the bare mark.
    let buildErr: unknown = null
    let editor: Editor | null = null
    try {
      editor = new Editor({
        element: document.createElement("div"),
        extensions: [Document, Paragraph, Text, WikiLink],
        content: "<p>hi</p>",
      })
      expect(editor.schema.marks.wikiLink).toBeDefined()
      // Setting the mark on a standalone schema must work (sanity).
      const ok = editor
        .chain()
        .setTextSelection({ from: 1, to: 3 })
        .setWikiLink({ target: "n1" })
        .run()
      expect(ok).toBe(true)
      expect(editor.getHTML()).toContain('data-wikilink="n1"')
    } catch (e) {
      buildErr = e
    } finally {
      editor?.destroy()
    }
    expect(buildErr).toBeNull()
  })
})
