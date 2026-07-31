// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, expect, it } from "vitest"
import { Editor } from "@tiptap/core"
import Document from "@tiptap/extension-document"
import Text from "@tiptap/extension-text"
import { NodeSelection } from "@tiptap/pm/state"
import { Divider } from "../../blocks"
import { createBlockSpec } from "../../schema"
import { resolvePlaceholder } from "./resolve"
import type { PlaceholderConfig } from "./types"

const Para = createBlockSpec({
  type: "paragraph",
  content: "inline*",
  parseDOM: [{ tag: "p" }],
  renderDOM: ({ HTMLAttributes }) => ["p", HTMLAttributes, 0],
})

const Heading = createBlockSpec({
  type: "heading",
  content: "inline*",
  props: { level: { default: 1, renderHTML: () => ({}) } },
  parseDOM: [
    { tag: "h1", attrs: { level: 1 } },
    { tag: "h2", attrs: { level: 2 } },
    { tag: "h3", attrs: { level: 3 } },
    { tag: "h4", attrs: { level: 4 } },
  ],
  renderDOM: ({ node }) => [`h${node.attrs.level as number}`, {}, 0],
})

function makeEditor(html: string) {
  const element = document.createElement("div")
  document.body.appendChild(element)
  return new Editor({
    element,
    extensions: [Document, Text, Para, Heading, Divider],
    content: html,
  })
}

const baseConfig: PlaceholderConfig = {
  default: '"/" for commands',
  heading: (node) => `Heading ${node.attrs.level as number}`,
}

function firstHit(
  hits: ReturnType<typeof resolvePlaceholder>,
): ReturnType<typeof resolvePlaceholder>[number] | null {
  return hits[0] ?? null
}

describe("resolvePlaceholder", () => {
  it("returns no hits when editor not focused (no always-on types)", () => {
    const editor = makeEditor("<p></p>")
    expect(resolvePlaceholder(editor.state, baseConfig, false, true)).toEqual([])
    editor.destroy()
  })

  it("returns no hits when editor not editable", () => {
    const editor = makeEditor("<p></p>")
    expect(resolvePlaceholder(editor.state, baseConfig, true, false)).toEqual([])
    editor.destroy()
  })

  it("returns no hits when config is undefined", () => {
    const editor = makeEditor("<p></p>")
    expect(resolvePlaceholder(editor.state, undefined, true, true)).toEqual([])
    editor.destroy()
  })

  it("returns no hits when selection is on a non-empty block", () => {
    const editor = makeEditor("<p>hello</p>")
    expect(resolvePlaceholder(editor.state, baseConfig, true, true)).toEqual([])
    editor.destroy()
  })

  it("returns no hits when the focused block is a leaf divider", () => {
    const editor = makeEditor("<hr>")
    editor.view.dispatch(
      editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 0)),
    )
    expect(resolvePlaceholder(editor.state, baseConfig, true, true)).toEqual([])
    editor.destroy()
  })

  it("uses default for a focused empty paragraph in a multi-block doc", () => {
    const editor = makeEditor("<p>hello</p><p></p>")
    editor.commands.setTextSelection(editor.state.doc.content.size)
    const hit = firstHit(resolvePlaceholder(editor.state, baseConfig, true, true))
    expect(hit?.text).toBe('"/" for commands')
    expect(hit?.node.type.name).toBe("paragraph")
    expect(hit?.state).toBe("default")
    editor.destroy()
  })

  it("uses default for a single empty paragraph", () => {
    const editor = makeEditor("<p></p>")
    const hit = firstHit(resolvePlaceholder(editor.state, baseConfig, true, true))
    expect(hit?.text).toBe('"/" for commands')
    expect(hit?.state).toBe("default")
    editor.destroy()
  })

  it("lets per-type paragraph override beat default on a single-block doc", () => {
    const hit = firstHit(
      resolvePlaceholder(
        makeEditor("<p></p>").state,
        { ...baseConfig, paragraph: "Custom paragraph" },
        true,
        true,
      ),
    )
    expect(hit?.text).toBe("Custom paragraph")
    expect(hit?.state).toBe("per-type")
  })

  it("lets explicit per-type undefined disable a block type without fallback", () => {
    const editor = makeEditor("<h2></h2>")
    expect(
      resolvePlaceholder(editor.state, { ...baseConfig, heading: undefined }, true, true),
    ).toEqual([])
    editor.destroy()
  })

  it("maps empty heading tags directly to their UI levels", () => {
    for (const [tag, label] of [
      ["h1", "Heading 1"],
      ["h2", "Heading 2"],
      ["h3", "Heading 3"],
    ] as const) {
      const editor = makeEditor(`<${tag}></${tag}>`)
      const hit = firstHit(resolvePlaceholder(editor.state, baseConfig, true, true))
      expect(hit?.text).toBe(label)
      editor.destroy()
    }
  })

  it("uses heading per-type placeholder in a multi-block doc", () => {
    const editor = makeEditor("<p>title</p><h2></h2>")
    editor.commands.setTextSelection(editor.state.doc.content.size)
    const hit = firstHit(resolvePlaceholder(editor.state, baseConfig, true, true))
    expect(hit?.text).toBe("Heading 2")
    editor.destroy()
  })

  it("returns no hits for empty string resolvers", () => {
    const editor = makeEditor("<p></p>")
    expect(resolvePlaceholder(editor.state, { default: "" }, true, true)).toEqual([])
    expect(resolvePlaceholder(editor.state, { default: () => "" }, true, true)).toEqual([])
    editor.destroy()
  })

  describe("heading is always-on", () => {
    it("paints every empty heading regardless of focus or caret position", () => {
      const editor = makeEditor("<h2></h2><p>body</p><h3></h3>")
      editor.commands.setTextSelection(7) // caret in the paragraph, NOT a heading
      const hits = resolvePlaceholder(editor.state, baseConfig, true, true)
      const headingHits = hits.filter((h) => h.node.type.name === "heading")
      expect(headingHits).toHaveLength(2)
      expect(headingHits.map((h) => h.text)).toEqual(["Heading 2", "Heading 3"])
      expect(headingHits.every((h) => h.state === "per-type")).toBe(true)
    })

    it("still emits heading hits when the editor is not focused", () => {
      const editor = makeEditor("<h2></h2><p></p>")
      const hits = resolvePlaceholder(editor.state, baseConfig, false, true)
      // Heading still painted, paragraph silently skipped (focus-gated).
      expect(hits).toHaveLength(1)
      expect(hits[0]?.node.type.name).toBe("heading")
    })

    it("does not double-emit when the focused block is also a heading", () => {
      const editor = makeEditor("<h2></h2>")
      editor.commands.setTextSelection(1)
      expect(resolvePlaceholder(editor.state, baseConfig, true, true)).toHaveLength(1)
    })

    it("respects isEditable for heading always-on hits", () => {
      const editor = makeEditor("<h2></h2>")
      expect(resolvePlaceholder(editor.state, baseConfig, true, false)).toEqual([])
    })

    it("skips non-empty headings", () => {
      const editor = makeEditor("<h2>title</h2><h3></h3>")
      const hits = resolvePlaceholder(editor.state, baseConfig, false, true)
      expect(hits).toHaveLength(1)
      expect(hits[0]?.text).toBe("Heading 3")
    })

    it("opts out cleanly when `heading: undefined` is configured", () => {
      const editor = makeEditor("<h2></h2><h3></h3>")
      // Consumer explicitly disables the heading placeholder — neither pass
      // should emit a hit.
      expect(
        resolvePlaceholder(
          editor.state,
          { ...baseConfig, heading: undefined },
          false,
          true,
        ),
      ).toEqual([])
    })
  })

  it("code-like blocks (spec.code) opt out of the default placeholder", () => {
    // Regression: kit.ts denies `/` triggers inside any block whose
    // type.spec.code is true (see denySlashInsideCode). The default
    // placeholder `'"/" for commands'` would advertise an interaction
    // that's been suppressed there. Per-type overrides still win.
    const Code = createBlockSpec({
      type: "codeBlock",
      content: "text*",
      meta: { code: true },
      parseDOM: [{ tag: "pre" }],
      renderDOM: () => ["pre", {}, ["code", {}, 0]],
    })
    const element = document.createElement("div")
    document.body.appendChild(element)
    const editor = new Editor({
      element,
      extensions: [Document, Text, Para, Code],
      content: "<pre></pre>",
    })
    // Default fallback is suppressed for code-like blocks.
    expect(
      resolvePlaceholder(editor.state, { default: '"/" for commands' }, true, true),
    ).toEqual([])
    // Explicit per-type override still applies.
    const hit = firstHit(
      resolvePlaceholder(
        editor.state,
        { default: '"/" for commands', codeBlock: "Type code…" },
        true,
        true,
      ),
    )
    expect(hit?.text).toBe("Type code…")
    editor.destroy()
  })

  it("rejects `emptyDocument` at the type level (regression guard)", () => {
    // If this assignment stops erroring, the `[blockType: string]` index
    // signature on PlaceholderConfig has silently re-exposed the removed
    // `emptyDocument` field — consumers could pass it again and resolve.ts
    // would ignore it at runtime. The `emptyDocument?: never` declaration
    // in types.ts is what keeps this a compile-time break.
    // @ts-expect-error PlaceholderConfig must reject `emptyDocument`.
    const config: PlaceholderConfig = { emptyDocument: "ignored" }
    expect(config.emptyDocument).toBe("ignored")
  })

  it("rejects typo'd built-in block names at the type level (#178)", () => {
    // Built-in block names are a finite set — typos like `paragrahp` or
    // `headng` used to be accepted by the open index signature and then
    // silently fall through to `default` at runtime. The tightened
    // PlaceholderConfig type (Partial<Record<RuneBlockTypeName, …>>) now
    // refuses unknown keys at compile time.
    // @ts-expect-error PlaceholderConfig must reject typo'd block names.
    const typo: PlaceholderConfig = { paragrahp: "Type something" }
    expect(typo).toBeDefined()
  })

})
