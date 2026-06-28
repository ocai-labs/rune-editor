// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Editor } from "@tiptap/core"
import Document from "@tiptap/extension-document"
import Text from "@tiptap/extension-text"
import { createBlockSpec } from "../../schema"
import { Placeholder, placeholderPluginKey } from "./index"

const Para = createBlockSpec({
  type: "paragraph",
  content: "inline*",
  parseDOM: [{ tag: "p" }],
  renderDOM: ({ HTMLAttributes }) => ["p", HTMLAttributes, 0],
})

const Heading = createBlockSpec({
  type: "heading",
  content: "inline*",
  props: { level: { default: 2, renderHTML: () => ({}) } },
  parseDOM: [
    { tag: "h2", attrs: { level: 2 } },
    { tag: "h3", attrs: { level: 3 } },
    { tag: "h4", attrs: { level: 4 } },
  ],
  renderDOM: ({ node }) => [`h${node.attrs.level as number}`, {}, 0],
})

let container: HTMLDivElement

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
})

afterEach(() => {
  container.remove()
})

function makeEditor(html: string) {
  return new Editor({
    element: container,
    extensions: [
      Document,
      Text,
      Para,
      Heading,
      Placeholder.configure({
        placeholders: {
          default: '"/" for commands',
          heading: (node) => `Heading ${(node.attrs.level as number) - 1}`,
        },
      }),
    ],
    content: html,
  })
}

function simulateFocus(editor: Editor, focused: boolean) {
  const tr = editor.state.tr
    .setMeta(placeholderPluginKey, { focused })
    .setMeta("addToHistory", false)
  editor.view.dispatch(tr)
}

function decoratedBlocks() {
  return Array.from(
    container.querySelectorAll<HTMLElement>(".ProseMirror .is-empty[data-placeholder]"),
  )
}

function decoratedBlock() {
  return decoratedBlocks()[0] ?? null
}

describe("Placeholder plugin", () => {
  it("decorates the focused empty paragraph in a multi-block doc", () => {
    const editor = makeEditor("<p>hello</p><p></p>")
    simulateFocus(editor, true)
    editor.commands.setTextSelection(editor.state.doc.content.size)

    const block = decoratedBlock()
    expect(block?.getAttribute("data-placeholder")).toBe('"/" for commands')
    expect(block?.getAttribute("data-placeholder-type")).toBe("paragraph")
    expect(block?.getAttribute("data-placeholder-state")).toBe("default")
    expect(decoratedBlocks()).toHaveLength(1)
    editor.destroy()
  })

  it("uses default copy for a single empty paragraph (no empty-document special case)", () => {
    const editor = makeEditor("<p></p>")
    simulateFocus(editor, true)
    const block = decoratedBlock()
    expect(block?.getAttribute("data-placeholder")).toBe('"/" for commands')
    expect(block?.getAttribute("data-placeholder-state")).toBe("default")
    editor.destroy()
  })

  it("uses heading per-type copy and level metadata", () => {
    const editor = makeEditor("<h2></h2>")
    simulateFocus(editor, true)

    const block = decoratedBlock()
    expect(block?.getAttribute("data-placeholder")).toBe("Heading 1")
    expect(block?.getAttribute("data-placeholder-type")).toBe("heading")
    expect(block?.getAttribute("data-placeholder-level")).toBe("1")
    expect(block?.getAttribute("data-placeholder-state")).toBe("per-type")
    editor.destroy()
  })

  it("does not decorate non-empty blocks", () => {
    const editor = makeEditor("<p>hello</p>")
    simulateFocus(editor, true)
    expect(decoratedBlock()).toBeNull()
    editor.destroy()
  })

  it("removes decorations on blur", () => {
    const editor = makeEditor("<p></p>")
    simulateFocus(editor, true)
    expect(decoratedBlock()).not.toBeNull()
    simulateFocus(editor, false)
    expect(decoratedBlock()).toBeNull()
    editor.destroy()
  })

  it("does not decorate when the editor is read-only", () => {
    const editor = makeEditor("<p></p>")
    editor.setEditable(false)
    simulateFocus(editor, true)
    expect(decoratedBlock()).toBeNull()
    editor.destroy()
  })

  it("removes the decoration after typing", () => {
    const editor = makeEditor("<p></p>")
    simulateFocus(editor, true)
    expect(decoratedBlock()).not.toBeNull()
    editor.commands.insertContent("a")
    expect(decoratedBlock()).toBeNull()
    editor.destroy()
  })

  it("moves the single decoration with the text selection", () => {
    const editor = makeEditor("<p></p><p></p>")
    simulateFocus(editor, true)

    editor.commands.setTextSelection(1)
    const first = decoratedBlock()
    expect(first).not.toBeNull()

    editor.commands.setTextSelection(editor.state.doc.content.size - 1)
    expect(decoratedBlock()).not.toBe(first)
    expect(decoratedBlocks()).toHaveLength(1)
    editor.destroy()
  })

  it("renders the placeholder text via a widget INSIDE the textblock, not as ::before on the outer block", () => {
    // #183: an outer-block ::before with `position: absolute` overlapped
    // the list marker / task checkbox. The fix moves the visible text
    // into a widget that lands inside the contentDOM, so list flex
    // layout pushes it after the marker.
    const editor = makeEditor("<p></p>")
    simulateFocus(editor, true)
    const block = decoratedBlock()
    expect(block).not.toBeNull()
    // Outer wrapper carries aria-hidden and is the widget root. It must
    // NOT have contenteditable="false" (PM's addTextblockHacks would
    // otherwise inject an <img.ProseMirror-separator> at end-of-textblock,
    // shifting the caret line box on hover). See JSDoc on the widget
    // decoration in placeholder/index.ts and project_pm_widget_textblock_hack.
    const outer = block!.querySelector(".rune-placeholder")
    expect(outer).not.toBeNull()
    expect(outer?.getAttribute("aria-hidden")).toBe("true")
    expect(outer?.hasAttribute("contenteditable")).toBe(false)
    // Inner span carries the visible text and the ce=false that keeps
    // click/selection out.
    const widget = outer!.querySelector(".rune-placeholder-text")
    expect(widget).not.toBeNull()
    expect(widget?.textContent).toBe('"/" for commands')
    expect(widget?.getAttribute("contenteditable")).toBe("false")
    editor.destroy()
  })

  describe("headings always show their placeholder", () => {
    it("paints every empty heading regardless of focus or caret pos", () => {
      const editor = makeEditor("<h2></h2><p>body</p><h3></h3>")
      // No simulateFocus — heading placeholders must NOT require focus.
      const headingBlocks = decoratedBlocks().filter(
        (el) => el.getAttribute("data-placeholder-type") === "heading",
      )
      expect(headingBlocks).toHaveLength(2)
      expect(headingBlocks[0]?.getAttribute("data-placeholder")).toBe("Heading 1")
      expect(headingBlocks[1]?.getAttribute("data-placeholder")).toBe("Heading 2")
      // Both render the inline widget, not just the outer attrs.
      expect(container.querySelectorAll(".rune-placeholder-text")).toHaveLength(2)
      editor.destroy()
    })

    it("keeps painting empty headings after editor blur", () => {
      const editor = makeEditor("<h2></h2>")
      simulateFocus(editor, true)
      expect(decoratedBlock()).not.toBeNull()
      simulateFocus(editor, false)
      // Unlike paragraph (focus-gated), heading stays.
      expect(decoratedBlock()).not.toBeNull()
      editor.destroy()
    })

    it("hides the heading hint in readonly mode", () => {
      const editor = makeEditor("<h2></h2>")
      editor.setEditable(false)
      expect(decoratedBlock()).toBeNull()
      editor.destroy()
    })

    it("removes the heading widget once the heading has content", () => {
      const editor = makeEditor("<h2></h2><h3></h3>")
      expect(decoratedBlocks()).toHaveLength(2)
      editor.commands.setTextSelection(1)
      editor.commands.insertContent("Title")
      // First heading now non-empty; second still labelled.
      expect(decoratedBlocks()).toHaveLength(1)
      editor.destroy()
    })
  })

  it("clears the widget when focus leaves", () => {
    const editor = makeEditor("<p></p>")
    simulateFocus(editor, true)
    expect(container.querySelector(".rune-placeholder-text")).not.toBeNull()
    simulateFocus(editor, false)
    expect(container.querySelector(".rune-placeholder-text")).toBeNull()
    editor.destroy()
  })

  it("warns once on init for placeholder keys that don't match a registered node (#178)", () => {
    // The tightened type catches typos for built-in block names at
    // compile time, but downstream blocks registered via createBlockSpec
    // aren't in the union. A dev-only console.warn at editor init covers
    // those (and any consumer who casts past the type).
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const localContainer = document.createElement("div")
      document.body.appendChild(localContainer)
      const editor = new Editor({
        element: localContainer,
        extensions: [
          Document,
          Text,
          Para,
          Heading,
          Placeholder.configure({
            placeholders: {
              default: '"/" for commands',
              // `paragrahp` is a typo; `notARealBlock` mimics a downstream block
              // name the consumer thought existed. Neither matches schema.nodes.
              // Cast through unknown so the test exercises the runtime guard
              // rather than tripping the new compile-time guard.
              ...({ paragrahp: "x", notARealBlock: "y" } as unknown as Record<
                string,
                string
              >),
            },
          }),
        ],
        content: "<p></p>",
      })

      const messages = warn.mock.calls.map((args) => String(args[0] ?? ""))
      const ours = messages.filter((m) => m.includes("rune-placeholder"))
      expect(ours.length).toBeGreaterThan(0)
      // Each unknown key must be named so a reader knows what to fix.
      expect(ours.some((m) => m.includes("paragrahp"))).toBe(true)
      expect(ours.some((m) => m.includes("notARealBlock"))).toBe(true)
      // `default` is not a node name — must not be reported.
      expect(ours.some((m) => m.includes("default"))).toBe(false)

      editor.destroy()
      localContainer.remove()
    } finally {
      warn.mockRestore()
    }
  })

  it("does not warn for an explicit `undefined` opt-out of an unregistered type", () => {
    // rune-react ships `title: undefined` in its default placeholders, but
    // TitleKit (the only thing that registers the `title` node) is opt-in.
    // An explicit `undefined` is a deliberate opt-out, not a typo, so it must
    // NOT trip the unknown-key warning for consumers without TitleKit.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const localContainer = document.createElement("div")
      document.body.appendChild(localContainer)
      const editor = new Editor({
        element: localContainer,
        extensions: [
          Document,
          Text,
          Para,
          Heading,
          Placeholder.configure({
            placeholders: {
              default: '"/" for commands',
              // `title` is not registered here; the explicit `undefined`
              // opt-out must stay silent. A real string for an unknown key
              // (covered by the test above) still warns.
              ...({ title: undefined } as unknown as Record<string, string>),
            },
          }),
        ],
        content: "<p></p>",
      })

      const ours = warn.mock.calls
        .map((args) => String(args[0] ?? ""))
        .filter((m) => m.includes("rune-placeholder"))
      expect(ours.some((m) => m.includes("title"))).toBe(false)

      editor.destroy()
      localContainer.remove()
    } finally {
      warn.mockRestore()
    }
  })

  it("widget lands inside a NodeView's contentDOM, not on the outer wrapper", () => {
    // Regression net for PR #184 review concern: TaskList (and any future
    // block whose NodeView root != contentDOM) must receive the placeholder
    // widget on the inner contentDOM. If PM's DecorationSet diff or the
    // NodeView's update/ignoreMutation rejects the widget, list flex layout
    // can no longer push it after the marker / checkbox and the original
    // overlap regression returns silently.
    let updateCalls = 0
    let lastUpdateDecorationCount = -1

    const NodeViewBlock = createBlockSpec({
      type: "paragraph",
      content: "inline*",
      parseDOM: [{ tag: "p" }],
      renderDOM: ({ HTMLAttributes }) => ["div", HTMLAttributes, ["p", {}, 0]],
      nodeView: () => {
        const dom = document.createElement("div")
        dom.className = "nodeview-outer"
        const contentDOM = document.createElement("p")
        contentDOM.className = "nodeview-inner"
        dom.appendChild(contentDOM)
        return {
          dom,
          contentDOM,
          update: (_next, decorations) => {
            updateCalls += 1
            lastUpdateDecorationCount = decorations.length
            return true
          },
          ignoreMutation: (mutation) =>
            mutation.type === "attributes" && mutation.target === dom,
        }
      },
    })

    const localContainer = document.createElement("div")
    document.body.appendChild(localContainer)
    const editor = new Editor({
      element: localContainer,
      extensions: [
        Document,
        Text,
        NodeViewBlock,
        Placeholder.configure({ placeholders: { default: "Type something" } }),
      ],
      content: "<p></p>",
    })
    simulateFocus(editor, true)

    const outer = localContainer.querySelector(".nodeview-outer")
    const inner = localContainer.querySelector(".nodeview-inner")
    expect(outer).not.toBeNull()
    expect(inner).not.toBeNull()

    // Widget must be inside the inner contentDOM, not a direct child of the
    // outer wrapper. (If it landed on the outer, list/task layouts would
    // overlap the marker — the bug PR #184 fixes.)
    const widget = inner!.querySelector(".rune-placeholder-text")
    expect(widget).not.toBeNull()
    expect(widget?.textContent).toBe("Type something")
    expect(outer!.querySelector(":scope > .rune-placeholder-text")).toBeNull()

    // NodeView must have observed at least one update with the decoration
    // set non-empty — confirms the widget reached the NodeView dispatch
    // path rather than being silently dropped.
    expect(updateCalls).toBeGreaterThan(0)
    expect(lastUpdateDecorationCount).toBeGreaterThan(0)

    editor.destroy()
    localContainer.remove()
  })
})
