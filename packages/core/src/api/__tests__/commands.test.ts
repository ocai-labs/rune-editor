// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, expect, expectTypeOf, it, vi } from "vitest"
import { Editor } from "@tiptap/core"
import Document from "@tiptap/extension-document"
import Text from "@tiptap/extension-text"
import { TextSelection } from "@tiptap/pm/state"
import {
  BlockCommands,
  createBlockSpec,
  createRuneKit,
  getBlockById,
  getDocument,
  type BlockUpdate,
  type InsertBlocksByIdOptions,
  type InsertBlocksOptions,
  type RuneBlock,
  type RuneBlockInput,
} from "../../index"
import type { RuneColumnsBlock } from "../../blocks/Columns/block"

function makeEditor(content: unknown = { type: "doc", content: [] }) {
  const element = document.createElement("div")
  document.body.appendChild(element)
  const editor = new Editor({
    element,
    extensions: createRuneKit({ suggestionMenus: false }),
    content: content as never,
  })
  return {
    editor,
    destroy: () => {
      editor.destroy()
      element.remove()
    },
  }
}

function ids(editor: Editor) {
  return getDocument(editor).map((block) => block.id)
}

// Chain-safety fixture (task #17): a 5-token paragraph inserted at doc start
// shifts every later position by +5. Under `editor.chain()`, `state.doc` IS
// the live, already-mutated `tr.doc` (it reflects prior chain steps) — so a
// command resolving a position from `state.doc` and applying it to `tr`
// UNMAPPED is chain-safe; one that re-maps it through the WHOLE `tr.mapping`
// double-counts those prior steps. The tests tagged "chain-safety" below pin
// that contract for both the always-safe commands (insertBlocks, deleteBlocks,
// updateBlock, indentBlock) and the ones that needed the `tr.mapping.slice
// (mapFrom)` fix (moveBlocks, turnInto, wrapIntoColumns, splitListBlock).
const PRE = {
  type: "paragraph",
  attrs: { id: "PRE", depth: 0 },
  content: [{ type: "text", text: "PRE" }],
}

describe("commands.insertBlocks", () => {
  it("keeps RuneBlockInput tied to the built-in RuneBlock union", () => {
    expectTypeOf<RuneBlockInput>().toMatchTypeOf<
      | { type: "paragraph"; id?: string; depth?: number; text: string }
      | { type: "heading"; id?: string; depth?: number; level: 2 | 3 | 4 | 5; text: string }
      | { type: "divider"; id?: string; depth?: number }
      | { type: "bulletList"; id?: string; depth?: number; text: string }
      | { type: "numberedList"; id?: string; depth?: number; text: string; start: number | null }
      | { type: "taskList"; id?: string; depth?: number; text: string; checked: boolean }
      | { type: "blockquote"; id?: string; depth?: number; text: string }
      | { type: "callout"; id?: string; depth?: number; icon: string; text: string }
      | { type: "codeBlock"; id?: string; depth?: number; text: string; language: string | null }
      | {
          type: "table"
          id?: string
          depth?: number
          rows: { cells: { text: string }[]; isHeader: boolean }[]
        }
      | { type: "toggle"; id?: string; depth?: number; level: 0 | 2 | 3 | 4; expanded: boolean; text: string }
      | { type: "equationBlock"; id?: string; depth?: number; latex: string }
      | { type: "tableOfContents"; id?: string; depth?: number }
      | {
          type: "image"
          id?: string
          depth?: number
          src: string
          alt: string
          width: number | null
          height: number | null
          sourceUrl?: string
        }
      | {
          type: "video"
          id?: string
          depth?: number
          sourceType: "asset" | "embed"
          src: string
          embedUrl: string | null
          provider: "youtube" | "vimeo" | "soundcloud" | null
          sourceUrl: string | null
          title: string
          width: number | null
          height: number | null
        }
      | {
          type: "audio"
          id?: string
          depth?: number
          sourceType: "asset" | "embed"
          src: string
          embedUrl: string | null
          provider: "youtube" | "vimeo" | "soundcloud" | null
          sourceUrl: string | null
          title: string
          width: number | null
          height: number | null
        }
      | {
          type: "columnLayout"
          id?: string
          depth?: number
          columns: { id: string; width: number; children: RuneBlock[] }[]
        }
    >()

    const paragraph = { type: "paragraph", text: "Body" } satisfies RuneBlockInput
    // @ts-expect-error paragraph input requires text
    const paragraphWithoutText = { type: "paragraph" } satisfies RuneBlockInput

    const heading = { type: "heading", level: 2, text: "Title" } satisfies RuneBlockInput
    // @ts-expect-error heading input requires level
    const headingWithoutLevel = { type: "heading", text: "Title" } satisfies RuneBlockInput
    // @ts-expect-error heading input requires text
    const headingWithoutText = { type: "heading", level: 2 } satisfies RuneBlockInput

    const divider = { type: "divider" } satisfies RuneBlockInput
    // @ts-expect-error divider input does not accept text
    const dividerWithText = { type: "divider", text: "x" } satisfies RuneBlockInput

    const bulletList = { type: "bulletList", text: "Bullet" } satisfies RuneBlockInput
    const numberedList = {
      type: "numberedList",
      text: "Numbered",
      start: 5,
    } satisfies RuneBlockInput
    const taskList = { type: "taskList", text: "Task", checked: true } satisfies RuneBlockInput

    const image = {
      type: "image",
      src: "https://example.com/a.png",
      alt: "Alt",
      width: 640,
      height: 480,
    } satisfies RuneBlockInput

    const video = {
      type: "video",
      sourceType: "asset",
      src: "https://example.com/a.mp4",
      embedUrl: null,
      provider: null,
      sourceUrl: null,
      title: "Video",
      width: 640,
      height: 360,
    } satisfies RuneBlockInput

    const audio = {
      type: "audio",
      sourceType: "asset",
      src: "https://example.com/a.mp3",
      embedUrl: null,
      provider: null,
      sourceUrl: null,
      title: "Audio",
      width: null,
      height: null,
    } satisfies RuneBlockInput

    // External custom-block input typing is explicitly out of scope for this
    // follow-up. Runtime dispatch is tested with an explicit cast in Task 5.
    // @ts-expect-error custom blocks are not in RuneBlockInput yet
    const custom = { type: "custom-block", text: "x" } satisfies RuneBlockInput
    void paragraph
    void paragraphWithoutText
    void heading
    void headingWithoutLevel
    void headingWithoutText
    void divider
    void dividerWithText
    void bulletList
    void numberedList
    void taskList
    void image
    void video
    void audio
    void custom
  })

  it("keeps BlockUpdate distributive over block-specific fields while excluding id", () => {
    const taskUpdate = { checked: true } satisfies BlockUpdate
    const headingUpdate = { level: 3 } satisfies BlockUpdate
    const imageUpdate = { alt: "Diagram" } satisfies BlockUpdate
    const depthUpdate = { depth: 2 } satisfies BlockUpdate
    const typeUpdate = { type: "paragraph" } satisfies BlockUpdate

    // @ts-expect-error id is runtime-managed and cannot be updated
    const idUpdate = { id: "new-id" } satisfies BlockUpdate

    void taskUpdate
    void headingUpdate
    void imageUpdate
    void depthUpdate
    void typeUpdate
    void idUpdate
  })

  it("keeps AI-facing insert targets block-id-only while preserving PM-position compatibility", () => {
    const compatPos = { at: 0 } satisfies InsertBlocksOptions
    const compatId = { at: { id: "p1", side: "after" } } satisfies InsertBlocksOptions
    const aiEnd = { at: "end" } satisfies InsertBlocksByIdOptions
    const aiId = { at: { id: "p1", side: "before" } } satisfies InsertBlocksByIdOptions

    // @ts-expect-error AI-facing insert options must not accept PM positions
    const aiPos = { at: 0 } satisfies InsertBlocksByIdOptions

    void compatPos
    void compatId
    void aiEnd
    void aiId
    void aiPos
  })

  it("all public built-in body blocks expose CRUD hooks", () => {
    const { editor, destroy } = makeEditor()
    // When M8.4 adds a public built-in block, update blocks/index.ts, kit.ts,
    // BlockId.options.types, this allowlist, and getDocument/insertBlocks/updateBlock
    // coverage. This is not a registry walk:
    // future structural-only nodes may use createBlockSpec without public JSON.
    const publicBodyBlocks = ["paragraph", "heading", "divider", "bulletList", "numberedList", "taskList", "blockquote", "codeBlock", "table", "image", "video", "audio"]

    for (const name of publicBodyBlocks) {
      const storage = editor.extensionManager.extensions.find((extension) => extension.name === name)
        ?.storage as
        | { toRuneBlock?: unknown; fromInput?: unknown }
        | undefined

      expect(storage?.toRuneBlock).toBeTypeOf("function")
      expect(storage?.fromInput).toBeTypeOf("function")
    }

    destroy()
  })

  it("returns false when inserting an empty blocks array", () => {
    const { editor, destroy } = makeEditor()

    expect(editor.commands.insertBlocks([], { at: "end" })).toBe(false)
    expect(getDocument(editor)).toEqual([])
    destroy()
  })

  it("inserts paragraph, heading, and divider blocks at the end", () => {
    const { editor, destroy } = makeEditor()

    const ok = editor.commands.insertBlocks(
      [
        { type: "paragraph", id: "p1", depth: 0, text: "Body" },
        { type: "heading", id: "h1", depth: 0, level: 2, text: "Title" },
        { type: "divider", id: "d1", depth: 0 },
      ],
      { at: "end" },
    )

    expect(ok).toBe(true)
    expect(getDocument(editor)).toEqual([
      { type: "paragraph", id: "p1", depth: 0, text: "Body" },
      { type: "heading", id: "h1", depth: 0, level: 2, text: "Title" },
      { type: "divider", id: "d1", depth: 0 },
    ])
    destroy()
  })

  it("inserts a bullet list block", () => {
    const { editor, destroy } = makeEditor()

    expect(editor.commands.insertBlocks([{ type: "bulletList", text: "a" }])).toBe(true)

    expect(getDocument(editor)[0]).toMatchObject({ type: "bulletList", text: "a" })
    destroy()
  })

  it("inserts a numbered list block with an explicit start", () => {
    const { editor, destroy } = makeEditor()

    expect(
      editor.commands.insertBlocks([{ type: "numberedList", text: "x", start: 5 }]),
    ).toBe(true)

    expect(getDocument(editor)[0]).toMatchObject({ type: "numberedList", text: "x", start: 5 })
    destroy()
  })

  it("resolves numeric positions and id/side targets", () => {
    const { editor, destroy } = makeEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { id: "first", depth: 0 },
          content: [{ type: "text", text: "First" }],
        },
        {
          type: "paragraph",
          attrs: { id: "last", depth: 0 },
          content: [{ type: "text", text: "Last" }],
        },
      ],
    })

    const secondStart = editor.state.doc.child(0).nodeSize
    expect(
      editor.commands.insertBlocks(
        [{ type: "paragraph", id: "middle", depth: 0, text: "Middle" }],
        { at: secondStart },
      ),
    ).toBe(true)
    expect(
      editor.commands.insertBlocks(
        [{ type: "heading", id: "after-first", depth: 1, level: 4, text: "Nested" }],
        { at: { id: "first", side: "after" } },
      ),
    ).toBe(true)

    expect(ids(editor)).toEqual(["first", "after-first", "middle", "last"])
    expect(getDocument(editor)[1]).toMatchObject({ id: "after-first", depth: 1 })
    destroy()
  })

  it("returns false when inserting before a missing id", () => {
    const { editor, destroy } = makeEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { id: "first", depth: 0 },
          content: [{ type: "text", text: "First" }],
        },
      ],
    })

    const ok = editor.commands.insertBlocks(
      [{ type: "paragraph", id: "new", depth: 0, text: "New" }],
      { at: { id: "missing", side: "before" } },
    )

    expect(ok).toBe(false)
    expect(getDocument(editor)).toEqual([
      { type: "paragraph", id: "first", depth: 0, text: "First" },
    ])
    destroy()
  })

  it("uses options.depth as the default depth for id-optional inputs (clamped to destination, Task 5)", () => {
    const { editor, destroy } = makeEditor()
    const input: RuneBlockInput = { type: "paragraph", text: "Nested by option" }

    editor.commands.insertBlocks([input], { at: "end", depth: 2 })

    const [block] = getDocument(editor)
    expect(block).toBeDefined()
    if (!block) throw new Error("expected inserted block")
    // Task 5 depth hygiene: a lone block inserted into an empty doc has no
    // preceding sibling, so the follow-prev cap is 0 — requested depth 2 is
    // clamped to 0. (Pre-Task-5 this honored depth 2 verbatim.)
    expect(block).toMatchObject({ type: "paragraph", depth: 0, text: "Nested by option" })
    expect(block.id).toMatch(/^[\w-]{8}$/)
    destroy()
  })

  it("clamps options.depth to a legal destination depth when a predecessor exists (Task 5)", () => {
    const { editor, destroy } = makeEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { id: "first", depth: 0 },
          content: [{ type: "text", text: "First" }],
        },
      ],
    })

    // prev sibling depth 0 -> cap 1; requested depth 5 clamps to 1.
    editor.commands.insertBlocks([{ type: "paragraph", text: "B" }], { at: "end", depth: 5 })
    expect(getDocument(editor)[1]).toMatchObject({ type: "paragraph", depth: 1 })
    destroy()
  })

  it("participates in Tiptap command chains", () => {
    const { editor, destroy } = makeEditor()

    const ok = editor
      .chain()
      .insertBlocks([{ type: "paragraph", id: "chain", depth: 0, text: "Chain" }])
      .focus()
      .run()

    expect(ok).toBe(true)
    expect(getDocument(editor)).toEqual([
      { type: "paragraph", id: "chain", depth: 0, text: "Chain" },
    ])
    destroy()
  })

  it("inserts image blocks", () => {
    const { editor, destroy } = makeEditor()

    expect(
      editor.commands.insertBlocks([
        {
          type: "image",
          id: "img1",
          depth: 1,
          src: "https://example.com/a.png",
          alt: "Alt",
          width: 640,
          height: 480,
          sourceUrl: "https://source.example/a.png",
        },
      ]),
    ).toBe(true)

    expect(getDocument(editor)).toEqual([
      {
        type: "image",
        id: "img1",
        // Task 5 depth hygiene: lone block into empty doc -> cap 0.
        depth: 0,
        src: "https://example.com/a.png",
        alt: "Alt",
        width: 640,
        height: 480,
        sourceUrl: "https://source.example/a.png",
      },
    ])
    destroy()
  })

  it("chain-safety: inserts after 'a', chained after insertContentAt(0)", () => {
    const { editor, destroy } = makeEditor({
      type: "doc",
      content: ["a", "b"].map((id) => ({
        type: "paragraph",
        attrs: { id, depth: 0 },
        content: [{ type: "text", text: id.toUpperCase() }],
      })),
    })
    editor
      .chain()
      .insertContentAt(0, PRE)
      .insertBlocks([{ type: "paragraph", id: "X", depth: 0, text: "X" }], {
        at: { id: "a", side: "after" },
      })
      .run()
    expect(ids(editor)).toEqual(["PRE", "a", "X", "b"])
    destroy()
  })
})

describe("insertBlocks via fromInput", () => {
  it("inserts a block declared via createBlockSpec.fromInput", () => {
    const Custom = createBlockSpec({
      type: "custom-block",
      content: "inline*",
      props: { label: { default: "default" } },
      parseDOM: [{ tag: "custom-block" }],
      renderDOM: ({ HTMLAttributes }) => ["div", HTMLAttributes, 0],
      fromInput: ({ schema, input, defaults }) => {
        const type = schema.nodes["custom-block"]
        if (!type) return null
        const text = typeof input.text === "string" ? input.text : ""
        return type.create(
          {
            id: input.id ?? null,
            depth: input.depth ?? defaults.depth,
            label: typeof input.label === "string" ? input.label : "default",
          },
          text ? schema.text(text) : undefined,
        )
      },
    })
    const element = document.createElement("div")
    document.body.appendChild(element)
    const editor = new Editor({
      element,
      extensions: [...createRuneKit({ suggestionMenus: false }), Custom],
      content: { type: "doc", content: [] },
    })

    const ok = editor.commands.insertBlocks(
      [
        {
          type: "custom-block",
          id: "custom-1",
          text: "hi",
          label: "runtime",
        },
      ] as unknown as RuneBlockInput[],
      { at: "end", depth: 2 },
    )

    expect(ok).toBe(true)
    const node = editor.state.doc.firstChild
    expect(node?.type.name).toBe("custom-block")
    expect(node?.attrs).toMatchObject({
      id: "custom-1",
      // Task 5 depth hygiene: lone block into empty doc -> cap 0.
      depth: 0,
      label: "runtime",
    })
    expect(node?.textContent).toBe("hi")
    editor.destroy()
    element.remove()
  })

  it("returns false when fromInput returns null", () => {
    const { editor, destroy } = makeEditor()
    const ok = editor.commands.insertBlocks([
      { type: "heading" } as unknown as RuneBlockInput,
    ])

    expect(ok).toBe(false)
    expect(getDocument(editor)).toEqual([])
    destroy()
  })
})

describe("commands.updateBlock", () => {
  it("rejects runtime id updates and does not dispatch", () => {
    const { editor, destroy } = makeEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { id: "target", depth: 0 },
          content: [{ type: "text", text: "Before" }],
        },
      ],
    })

    const before = editor.getJSON()
    const dispatchSpy = vi.spyOn(editor.view, "dispatch")
    const ok = editor.commands.updateBlock("target", {
      id: "other",
      text: "After",
    } as never)

    expect(ok).toBe(false)
    // Tiptap's CommandManager always flushes the command tr even on `return false`;
    // what we assert is that our command did not append any steps to it.
    const stepDispatches = dispatchSpy.mock.calls.filter(
      ([tr]) => tr.steps.length > 0,
    )
    expect(stepDispatches).toHaveLength(0)
    expect(editor.getJSON()).toEqual(before)
    destroy()
  })

  it("updates text and props while preserving id and depth by default", () => {
    const { editor, destroy } = makeEditor({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { id: "target", depth: 1, level: 2 },
          content: [{ type: "text", text: "Old" }],
        },
      ],
    })

    expect(editor.commands.updateBlock("target", { type: "heading", level: 4, text: "New" })).toBe(true)

    expect(getDocument(editor)).toEqual([
      { type: "heading", id: "target", depth: 1, level: 4, text: "New" },
    ])
    destroy()
  })

  it("can change block type and explicitly override depth", () => {
    const { editor, destroy } = makeEditor({
      type: "doc",
      content: [
        // Predecessors at depth 0 then 1 so the target's cap is 2 — the
        // explicit depth: 2 override below is legal (Task 5 clamps to the cap).
        {
          type: "paragraph",
          attrs: { id: "pre0", depth: 0 },
          content: [{ type: "text", text: "Pre0" }],
        },
        {
          type: "paragraph",
          attrs: { id: "pre1", depth: 1 },
          content: [{ type: "text", text: "Pre1" }],
        },
        {
          type: "paragraph",
          attrs: { id: "target", depth: 0 },
          content: [{ type: "text", text: "Body" }],
        },
      ],
    })

    expect(editor.commands.updateBlock("target", { type: "heading", depth: 2, level: 3 })).toBe(true)

    expect(getDocument(editor)[2]).toEqual(
      { type: "heading", id: "target", depth: 2, level: 3, text: "Body" },
    )
    destroy()
  })

  it("returns false when partial update would produce a heading without a level", () => {
    const { editor, destroy } = makeEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { id: "target", depth: 0 },
          content: [{ type: "text", text: "Body" }],
        },
      ],
    })

    const ok = editor.commands.updateBlock("target", { type: "heading" })

    expect(ok).toBe(false)
    expect(getDocument(editor)).toEqual([
      { type: "paragraph", id: "target", depth: 0, text: "Body" },
    ])
    destroy()
  })

  it("type-change paragraph -> heading carries text", () => {
    const { editor, destroy } = makeEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { id: "target", depth: 1 },
          content: [{ type: "text", text: "hello" }],
        },
      ],
    })

    expect(editor.commands.updateBlock("target", { type: "heading", level: 3 })).toBe(true)
    expect(getDocument(editor)).toEqual([
      { type: "heading", id: "target", depth: 1, level: 3, text: "hello" },
    ])
    destroy()
  })

  it("type-change paragraph -> numberedList sets start and carries text", () => {
    const { editor, destroy } = makeEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { id: "target", depth: 0 },
          content: [{ type: "text", text: "hello" }],
        },
      ],
    })

    expect(editor.commands.updateBlock("target", { type: "numberedList", start: 5 })).toBe(true)
    expect(getDocument(editor)).toEqual([
      { type: "numberedList", id: "target", depth: 0, text: "hello", start: 5 },
    ])
    destroy()
  })

  it("updates taskList checked state", () => {
    const { editor, destroy } = makeEditor({
      type: "doc",
      content: [
        {
          type: "taskList",
          attrs: { id: "task", depth: 0, checked: false },
          content: [{ type: "text", text: "todo" }],
        },
      ],
    })

    expect(editor.commands.updateBlock("task", { checked: true })).toBe(true)
    expect(getBlockById(editor, "task")).toEqual({
      type: "taskList",
      id: "task",
      depth: 0,
      text: "todo",
      checked: true,
    })
    destroy()
  })

  it("type-change heading -> divider drops text", () => {
    const { editor, destroy } = makeEditor({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { id: "target", depth: 0, level: 2 },
          content: [{ type: "text", text: "x" }],
        },
      ],
    })

    expect(editor.commands.updateBlock("target", { type: "divider" })).toBe(true)
    expect(getDocument(editor)).toEqual([
      { type: "divider", id: "target", depth: 0 },
    ])
    expect(editor.state.doc.firstChild?.textContent).toBe("")
    destroy()
  })

  it("preserves inline marks for attr-only updates", () => {
    const { editor, destroy } = makeEditor({
      type: "doc",
      content: [
        // Leading sibling at depth 0 so the depth: 1 update below is legal
        // under Task 5 destination clamping (cap = prev depth + 1 = 1).
        {
          type: "paragraph",
          attrs: { id: "lead", depth: 0 },
          content: [{ type: "text", text: "Lead" }],
        },
        {
          type: "paragraph",
          attrs: { id: "p1", depth: 0 },
          content: [
            {
              type: "text",
              marks: [{ type: "bold" }],
              text: "Bold",
            },
          ],
        },
      ],
    })

    expect(editor.commands.updateBlock("p1", { depth: 1 })).toBe(true)

    const text = editor.state.doc.child(1).firstChild
    expect(text?.marks.map((mark) => mark.type.name)).toEqual(["bold"])
    expect(getDocument(editor)[1]).toEqual(
      { type: "paragraph", id: "p1", depth: 1, text: "Bold" },
    )
    destroy()
  })

  it("preserves block color attrs for attr-only updates", () => {
    const { editor, destroy } = makeEditor({
      type: "doc",
      content: [
        // Leading sibling at depth 0 so the depth: 1 update below is legal
        // under Task 5 destination clamping (cap = prev depth + 1 = 1).
        {
          type: "paragraph",
          attrs: { id: "lead", depth: 0 },
          content: [{ type: "text", text: "Lead" }],
        },
        {
          type: "paragraph",
          attrs: { id: "p1", depth: 0 },
          content: [{ type: "text", text: "Colorful" }],
        },
      ],
    })

    const p1Pos = editor.state.doc.child(0).nodeSize
    editor.commands.setBlockTextColor(p1Pos, "blue")
    editor.commands.setBlockBackgroundColor(p1Pos, "gray")

    expect(editor.commands.updateBlock("p1", { depth: 1 })).toBe(true)

    const node = editor.state.doc.child(1)
    expect(node.attrs.textColor).toBe("blue")
    expect(node.attrs.backgroundColor).toBe("gray")
    expect(getDocument(editor)[1]).toEqual(
      { type: "paragraph", id: "p1", depth: 1, text: "Colorful" },
    )
    destroy()
  })

  it("updates image attrs while preserving block background color", () => {
    const { editor, destroy } = makeEditor({
      type: "doc",
      content: [
        {
          type: "image",
          attrs: {
            id: "img1",
            depth: 0,
            src: "https://example.com/old.png",
            alt: "Old",
            width: 320,
            height: 200,
          },
        },
      ],
    })

    editor.commands.setBlockBackgroundColor(0, "blue")

    expect(editor.commands.updateBlock("img1", { alt: "New" })).toBe(true)

    const node = editor.state.doc.child(0)
    expect(node.attrs.backgroundColor).toBe("blue")
    expect(getDocument(editor)).toEqual([
      {
        type: "image",
        id: "img1",
        depth: 0,
        src: "https://example.com/old.png",
        alt: "New",
        width: 320,
        height: 200,
      },
    ])
    destroy()
  })

  it("updates a custom projected block declared via createBlockSpec.fromInput", () => {
    const Custom = createBlockSpec({
      type: "custom-projection",
      content: "inline*",
      parseDOM: [{ tag: "custom-projection" }],
      renderDOM: ({ HTMLAttributes }) => ["span", HTMLAttributes, 0],
      toRuneBlock: (node) => ({
        type: "custom-projection",
        id: typeof node.attrs.id === "string" ? node.attrs.id : "",
        depth: typeof node.attrs.depth === "number" ? node.attrs.depth : 0,
        label: node.textContent,
      }),
      fromInput: ({ schema, input, defaults }) => {
        const type = schema.nodes["custom-projection"]
        if (!type) return null
        return type.create(
          {
            ...defaults.attrs,
            id: input.id ?? null,
            depth: input.depth ?? defaults.depth,
          },
          defaults.preserveContent && defaults.content
            ? defaults.content
            : typeof input.label === "string"
              ? schema.text(input.label)
              : undefined,
          defaults.marks,
        )
      },
    })
    const element = document.createElement("div")
    document.body.appendChild(element)
    const editor = new Editor({
      element,
      extensions: [Document, Text, Custom, BlockCommands],
      content: {
        type: "doc",
        content: [
          // Leading sibling at depth 0 so the depth: 1 update is legal under
          // Task 5 destination clamping (cap = prev depth + 1 = 1).
          {
            type: "custom-projection",
            attrs: { id: "lead", depth: 0 },
            content: [{ type: "text", text: "lead" }],
          },
          {
            type: "custom-projection",
            attrs: { id: "custom-id", depth: 0 },
            content: [{ type: "text", text: "x" }],
          },
        ],
      },
    })

    expect(editor.commands.updateBlock("custom-id", { depth: 1 })).toBe(true)
    expect((getDocument(editor) as unknown[])[1]).toEqual(
      { type: "custom-projection", id: "custom-id", depth: 1, label: "x" },
    )

    editor.destroy()
    element.remove()
  })

  it("chain-safety: updates 'a', chained after insertContentAt(0)", () => {
    const { editor, destroy } = makeEditor({
      type: "doc",
      content: ["a", "b"].map((id) => ({
        type: "paragraph",
        attrs: { id, depth: 0 },
        content: [{ type: "text", text: id.toUpperCase() }],
      })),
    })
    editor.chain().insertContentAt(0, PRE).updateBlock("a", { text: "NEW" }).run()
    const blocks = getDocument(editor) as Array<{ id: string; text?: string }>
    expect(ids(editor)).toEqual(["PRE", "a", "b"])
    expect(blocks.find((b) => b.id === "a")?.text).toBe("NEW")
    expect(blocks.find((b) => b.id === "PRE")?.text).toBe("PRE")
    destroy()
  })

  it("chain-safety: target removed by a prior deleteRange no-ops (no throw)", () => {
    const { editor, destroy } = makeEditor({
      type: "doc",
      content: ["a", "b"].map((id) => ({
        type: "paragraph",
        attrs: { id, depth: 0 },
        content: [{ type: "text", text: id.toUpperCase() }],
      })),
    })
    const run = () =>
      editor.chain().deleteRange({ from: 0, to: 3 }).updateBlock("a", { text: "NEW" }).run()
    expect(run).not.toThrow()
    expect(ids(editor)).toEqual(["b"])
    destroy()
  })
})

describe("commands.deleteBlocks", () => {
  it("deletes list blocks", () => {
    const { editor, destroy } = makeEditor({
      type: "doc",
      content: [
        {
          type: "bulletList",
          attrs: { id: "delete-me", depth: 0 },
          content: [{ type: "text", text: "remove" }],
        },
        {
          type: "paragraph",
          attrs: { id: "keep", depth: 0 },
          content: [{ type: "text", text: "keep" }],
        },
      ],
    })

    expect(editor.commands.deleteBlocks(["delete-me"])).toBe(true)

    expect(getDocument(editor)).toEqual([
      { type: "paragraph", id: "keep", depth: 0, text: "keep" },
    ])
    destroy()
  })

  it("deletes non-contiguous ids", () => {
    const { editor, destroy } = makeEditor({
      type: "doc",
      content: ["a", "b", "c", "d"].map((id) => ({
        type: "paragraph",
        attrs: { id, depth: 0 },
        content: [{ type: "text", text: id.toUpperCase() }],
      })),
    })

    expect(editor.commands.deleteBlocks(["b", "d"])).toBe(true)

    expect(ids(editor)).toEqual(["a", "c"])
    expect(editor.state.selection).toBeInstanceOf(TextSelection)
    destroy()
  })

  it("deletes an inclusive id range", () => {
    const { editor, destroy } = makeEditor({
      type: "doc",
      content: ["a", "b", "c", "d"].map((id) => ({
        type: "paragraph",
        attrs: { id, depth: 0 },
        content: [{ type: "text", text: id.toUpperCase() }],
      })),
    })

    expect(editor.commands.deleteBlocks({ from: "b", to: "c" })).toBe(true)

    expect(ids(editor)).toEqual(["a", "d"])
    destroy()
  })

  it("does not create an invalid TextSelection when only an atom block remains", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { editor, destroy } = makeEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { id: "p1", depth: 0 },
          content: [{ type: "text", text: "Delete me" }],
        },
        { type: "divider", attrs: { id: "d1", depth: 0 } },
      ],
    })

    expect(editor.commands.deleteBlocks(["p1"])).toBe(true)

    expect(getDocument(editor)).toEqual([{ type: "divider", id: "d1", depth: 0 }])
    expect(
      warn.mock.calls.some((args) =>
        String(args[0]).includes("TextSelection endpoint not pointing into a node with inline content"),
      ),
    ).toBe(false)
    warn.mockRestore()
    destroy()
  })

  it("chain-safety: deletes 'a', chained after insertContentAt(0)", () => {
    const { editor, destroy } = makeEditor({
      type: "doc",
      content: ["a", "b"].map((id) => ({
        type: "paragraph",
        attrs: { id, depth: 0 },
        content: [{ type: "text", text: id.toUpperCase() }],
      })),
    })
    editor.chain().insertContentAt(0, PRE).deleteBlocks(["a"]).run()
    expect(ids(editor)).toEqual(["PRE", "b"])
    destroy()
  })
})

describe("commands.moveBlocks", () => {
  it("moves a numbered list block", () => {
    const { editor, destroy } = makeEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { id: "a", depth: 0 },
          content: [{ type: "text", text: "A" }],
        },
        {
          type: "numberedList",
          attrs: { id: "n", depth: 0, start: 5 },
          content: [{ type: "text", text: "N" }],
        },
        {
          type: "paragraph",
          attrs: { id: "b", depth: 0 },
          content: [{ type: "text", text: "B" }],
        },
      ],
    })

    expect(editor.commands.moveBlocks(["n"], { id: "b", side: "after" })).toBe(true)

    expect(ids(editor)).toEqual(["a", "b", "n"])
    expect(getDocument(editor)[2]).toEqual({
      type: "numberedList",
      id: "n",
      depth: 0,
      text: "N",
      start: 5,
    })
    destroy()
  })

  it("moves a contiguous id range using the same order as block drag", () => {
    const { editor, destroy } = makeEditor({
      type: "doc",
      content: ["a", "b", "c", "d"].map((id) => ({
        type: "paragraph",
        attrs: { id, depth: id === "b" ? 1 : 0 },
        content: [{ type: "text", text: id.toUpperCase() }],
      })),
    })

    expect(editor.commands.moveBlocks(["b", "c"], { id: "d", side: "after" })).toBe(true)

    expect(ids(editor)).toEqual(["a", "d", "b", "c"])
    expect(getDocument(editor)[2]).toMatchObject({ id: "b", depth: 1 })
    destroy()
  })

  it("returns false for non-contiguous ids", () => {
    const { editor, destroy } = makeEditor({
      type: "doc",
      content: ["a", "b", "c"].map((id) => ({
        type: "paragraph",
        attrs: { id, depth: 0 },
        content: [{ type: "text", text: id.toUpperCase() }],
      })),
    })

    expect(editor.commands.moveBlocks(["a", "c"], { id: "b", side: "after" })).toBe(false)
    expect(ids(editor)).toEqual(["a", "b", "c"])
    destroy()
  })

  // --- D1: moveBlocks re-bases depth at the destination (Task 5) ---
  // BEHAVIOR CHANGE. Pre-Task-5, moveBlocks preserved a moved block's depth
  // verbatim regardless of where it landed. Now it normalizes depth to the
  // destination context, exactly like the drag path (`reorder.ts`): the first
  // moved block is clamped to the legal cap at the destination, and the rest of
  // the moved slice shifts by the same delta (preserving internal structure).
  it("D1: re-bases a deeper block down to the destination context (OLD: kept depth, NEW: clamps)", () => {
    const { editor, destroy } = makeEditor({
      type: "doc",
      content: [
        { type: "paragraph", attrs: { id: "a", depth: 0 }, content: [{ type: "text", text: "A" }] },
        { type: "paragraph", attrs: { id: "b", depth: 1 }, content: [{ type: "text", text: "B" }] },
        // c is depth 2; moving it to the very start re-bases it down.
        { type: "paragraph", attrs: { id: "c", depth: 2 }, content: [{ type: "text", text: "C" }] },
      ],
    })

    // Move c before a. Destination = doc start, no preceding sibling -> cap 0.
    expect(editor.commands.moveBlocks(["c"], { id: "a", side: "before" })).toBe(true)
    expect(ids(editor)).toEqual(["c", "a", "b"])
    // NEW (D1): depth re-based from 2 down to 0. OLD behavior would have been 2.
    expect(getDocument(editor)[0]).toMatchObject({ id: "c", depth: 0 })
    destroy()
  })

  it("D1: re-bases relative to the destination's preceding sibling, not the source", () => {
    const { editor, destroy } = makeEditor({
      type: "doc",
      content: [
        { type: "paragraph", attrs: { id: "a", depth: 0 }, content: [{ type: "text", text: "A" }] },
        { type: "paragraph", attrs: { id: "b", depth: 1 }, content: [{ type: "text", text: "B" }] },
        { type: "paragraph", attrs: { id: "c", depth: 0 }, content: [{ type: "text", text: "C" }] },
      ],
    })

    // Move c (depth 0) after b (depth 1). prev sibling depth 1 -> cap 2;
    // requested depth 0 is already legal, so it stays 0.
    expect(editor.commands.moveBlocks(["c"], { id: "b", side: "after" })).toBe(true)
    expect(ids(editor)).toEqual(["a", "b", "c"])
    expect(getDocument(editor)[2]).toMatchObject({ id: "c", depth: 0 })
    destroy()
  })

  it("D1: preserves internal depth deltas when re-basing a multi-block move", () => {
    const { editor, destroy } = makeEditor({
      type: "doc",
      content: [
        { type: "paragraph", attrs: { id: "a", depth: 0 }, content: [{ type: "text", text: "A" }] },
        // A parent (depth 1) + child (depth 2) pair moved to doc start.
        { type: "paragraph", attrs: { id: "p", depth: 1 }, content: [{ type: "text", text: "P" }] },
        { type: "paragraph", attrs: { id: "ch", depth: 2 }, content: [{ type: "text", text: "Ch" }] },
      ],
    })

    expect(editor.commands.moveBlocks(["p", "ch"], { id: "a", side: "before" })).toBe(true)
    expect(ids(editor)).toEqual(["p", "ch", "a"])
    // First block re-based 1 -> 0 (delta -1); child shifts by the same delta 2 -> 1.
    expect(getDocument(editor)[0]).toMatchObject({ id: "p", depth: 0 })
    expect(getDocument(editor)[1]).toMatchObject({ id: "ch", depth: 1 })
    destroy()
  })

  it("leaves same-context moves unaffected (depth stays when already legal)", () => {
    const { editor, destroy } = makeEditor({
      type: "doc",
      content: [
        { type: "paragraph", attrs: { id: "a", depth: 0 }, content: [{ type: "text", text: "A" }] },
        { type: "paragraph", attrs: { id: "b", depth: 0 }, content: [{ type: "text", text: "B" }] },
        { type: "paragraph", attrs: { id: "c", depth: 0 }, content: [{ type: "text", text: "C" }] },
      ],
    })

    // All depth 0; moving within the same depth-0 surface changes nothing.
    expect(editor.commands.moveBlocks(["a"], { id: "c", side: "after" })).toBe(true)
    expect(ids(editor)).toEqual(["b", "c", "a"])
    for (const block of getDocument(editor)) {
      expect(block).toMatchObject({ depth: 0 })
    }
    destroy()
  })

  it("accepts partial RuneBlock values for updateBlock", () => {
    const _partial: Partial<RuneBlock> = { text: "typed" }
    expect(_partial).toEqual({ text: "typed" })
  })

  it("chain-safety: moves 'c' before 'a', chained after insertContentAt(0)", () => {
    const { editor, destroy } = makeEditor({
      type: "doc",
      content: ["a", "b", "c"].map((id) => ({
        type: "paragraph",
        attrs: { id, depth: 0 },
        content: [{ type: "text", text: id.toUpperCase() }],
      })),
    })
    editor.chain().insertContentAt(0, PRE).moveBlocks(["c"], { id: "a", side: "before" }).run()
    expect(ids(editor)).toEqual(["PRE", "c", "a", "b"])
    destroy()
  })

  it("chain-safety: moves 'd' before 'b', chained after a prior deleteBlocks (shrinking step)", () => {
    const { editor, destroy } = makeEditor({
      type: "doc",
      content: ["a", "b", "c", "d"].map((id) => ({
        type: "paragraph",
        attrs: { id, depth: 0 },
        content: [{ type: "text", text: id.toUpperCase() }],
      })),
    })
    editor.chain().deleteBlocks(["a"]).moveBlocks(["d"], { id: "b", side: "before" }).run()
    expect(ids(editor)).toEqual(["d", "b", "c"])
    destroy()
  })

  it("chain-safety: no-ops (no throw) when its target was deleted by a prior chained step", () => {
    const { editor, destroy } = makeEditor({
      type: "doc",
      content: ["a", "b", "c"].map((id) => ({
        type: "paragraph",
        attrs: { id, depth: 0 },
        content: [{ type: "text", text: id.toUpperCase() }],
      })),
    })
    const run = () =>
      editor.chain().deleteBlocks(["b"]).moveBlocks(["b"], { id: "a", side: "after" }).run()
    expect(run).not.toThrow()
    expect(ids(editor)).toEqual(["a", "c"])
    destroy()
  })

  it("chain-safety: F2 unwrap branch (move into a surviving column) survives a chained prior step", () => {
    const { editor, destroy } = makeEditor({
      type: "doc",
      content: [
        { type: "paragraph", attrs: { id: "r1", depth: 0 }, content: [{ type: "text", text: "root-1" }] },
        {
          type: "columnLayout",
          attrs: { id: "lay", depth: 0 },
          content: [
            {
              type: "column",
              attrs: { id: "col_a", width: 1 },
              content: [
                { type: "paragraph", attrs: { id: "a1", depth: 0 }, content: [{ type: "text", text: "A1" }] },
              ],
            },
            {
              type: "column",
              attrs: { id: "col_b", width: 1 },
              content: [
                { type: "paragraph", attrs: { id: "b1", depth: 0 }, content: [{ type: "text", text: "B1" }] },
              ],
            },
          ],
        },
        { type: "paragraph", attrs: { id: "r2", depth: 0 }, content: [{ type: "text", text: "root-2" }] },
      ],
    })
    editor
      .chain()
      .insertContentAt(0, PRE)
      .moveBlocks(["a1"], { columnId: "col_b", at: "end" })
      .run()
    // col_a empties -> the layout unwraps (F2); "content stays put" at the
    // layout's original slot, now shifted by PRE. The F2 branch never used
    // `tr.mapping` (it reads `tr.doc` directly, still safe pre-fix) — this
    // pins that it stays correct once chained after a position-shifting step.
    expect(getDocument(editor).some((b) => b.type === "columnLayout")).toBe(false)
    expect(ids(editor)).toEqual(["PRE", "r1", "b1", "a1", "r2"])
    destroy()
  })
})

describe("commands.indentBlock / outdentBlock", () => {
  function docWithBlocks(blocks: { type: string; id?: string; depth?: number; text?: string }[]) {
    return {
      type: "doc" as const,
      content: blocks.map((b, i) => ({
        type: b.type,
        attrs: { id: b.id ?? `b${i}`, depth: b.depth ?? 0 },
        content: b.text != null ? [{ type: "text", text: b.text }] : [],
      })),
    }
  }

  it("3.1 indentBlock(id) on lone paragraph d=0 → no-op under follow-prev (no predecessor → cap=0)", () => {
    const { editor, destroy } = makeEditor(docWithBlocks([{ type: "paragraph", id: "p1", text: "hi" }]))
    expect(editor.commands.indentBlock("p1")).toBe(false)
    const block = getDocument(editor)[0]!
    expect(block.depth).toBe(0)
    expect(block.id).toBe("p1")
    destroy()
  })

  it("3.2 indentBlock(id) on lone paragraph d=1 → no-op (cap=0, current≥cap)", () => {
    const { editor, destroy } = makeEditor(docWithBlocks([{ type: "paragraph", id: "p1", depth: 1, text: "hi" }]))
    expect(editor.commands.indentBlock("p1")).toBe(false)
    expect(getDocument(editor)[0]!.depth).toBe(1)
    destroy()
  })

  it("3.3 outdentBlock(id) on paragraph d=1 → d=0", () => {
    const { editor, destroy } = makeEditor(docWithBlocks([{ type: "paragraph", id: "p1", depth: 1, text: "hi" }]))
    expect(editor.commands.outdentBlock("p1")).toBe(true)
    expect(getDocument(editor)[0]!.depth).toBe(0)
    destroy()
  })

  it("3.4 outdentBlock(id) on paragraph d=0 → no-op, returns false", () => {
    const { editor, destroy } = makeEditor(docWithBlocks([{ type: "paragraph", id: "p1", text: "hi" }]))
    expect(editor.commands.outdentBlock("p1")).toBe(false)
    expect(getDocument(editor)[0]!.depth).toBe(0)
    destroy()
  })

  it("3.5 indentBlock(id) on bulletList that is first item of run → no-op, returns false", () => {
    const { editor, destroy } = makeEditor(docWithBlocks([{ type: "bulletList", id: "b1", text: "hi" }]))
    expect(editor.commands.indentBlock("b1")).toBe(false)
    expect(getDocument(editor)[0]!.depth).toBe(0)
    destroy()
  })

  it("3.6 indentBlock(id) on second bulletList of run at d=0 → d=1", () => {
    const { editor, destroy } = makeEditor(docWithBlocks([
      { type: "bulletList", id: "b1", text: "one" },
      { type: "bulletList", id: "b2", text: "two" },
    ]))
    expect(editor.commands.indentBlock("b2")).toBe(true)
    expect(getDocument(editor)[1]!.depth).toBe(1)
    destroy()
  })

  it("3.7 cross-kind predecessor → no-op", () => {
    const { editor, destroy } = makeEditor(docWithBlocks([
      { type: "numberedList", id: "n1", text: "one" },
      { type: "bulletList", id: "b1", text: "two" },
    ]))
    expect(editor.commands.indentBlock("b1")).toBe(false)
    expect(getDocument(editor)[1]!.depth).toBe(0)
    destroy()
  })

  it("3.8 mixed-depth predecessor: skip deeper, find same-kind same-depth", () => {
    const { editor, destroy } = makeEditor(docWithBlocks([
      { type: "bulletList", id: "b1", depth: 0, text: "one" },
      { type: "bulletList", id: "b2", depth: 1, text: "two" },
      { type: "bulletList", id: "b3", depth: 0, text: "three" },
    ]))
    expect(editor.commands.indentBlock("b3")).toBe(true)
    expect(getDocument(editor)[2]!.depth).toBe(1)
    destroy()
  })

  it("3.9 indentBlock() no-id applies to block at cursor", () => {
    const { editor, destroy } = makeEditor(docWithBlocks([
      { type: "numberedList", id: "n1", depth: 1, text: "anchor" },
      { type: "paragraph", id: "p1", text: "hello world" },
    ]))
    const paragraphStart = editor.state.doc.child(0).nodeSize + 1
    editor.commands.setTextSelection(paragraphStart + 1)
    expect(editor.commands.indentBlock()).toBe(true)
    expect(getDocument(editor)[1]!.depth).toBe(1)
    destroy()
  })

  it("3.12 indent does not change id attr", () => {
    const { editor, destroy } = makeEditor(docWithBlocks([{ type: "bulletList", id: "bx", text: "one" }, { type: "bulletList", id: "by", text: "two" }]))
    editor.commands.indentBlock("by")
    expect(getDocument(editor)[1]!.id).toBe("by")
    destroy()
  })

  it("3.13 block with no indent field defaults to follow-prev (cap = prev sibling depth + 1)", () => {
    const { editor, destroy } = makeEditor(docWithBlocks([
      { type: "paragraph", id: "p1", text: "hi" },
      { type: "paragraph", id: "p2", text: "there" },
    ]))
    // p2's prev is p1 at d=0 → cap=1 → first Tab indents to d=1
    expect(editor.commands.indentBlock("p2")).toBe(true)
    expect(getDocument(editor)[1]!.depth).toBe(1)
    // Now at cap (current=1, cap=1) → no-op
    expect(editor.commands.indentBlock("p2")).toBe(false)
    expect(getDocument(editor)[1]!.depth).toBe(1)
    destroy()
  })

  describe("MBS spread", () => {
    it("3.10 indentBlock() MBS over [paragraph d=0, paragraph d=1, paragraph d=0] → [d=0, d=1, d=1]", () => {
      const { editor, destroy } = makeEditor(docWithBlocks([
        { type: "paragraph", id: "p1", depth: 0, text: "a" },
        { type: "paragraph", id: "p2", depth: 1, text: "b" },
        { type: "paragraph", id: "p3", depth: 0, text: "c" },
      ]))
      editor.commands.setBlockSelection({ from: "p1", to: "p3" })
      expect(editor.commands.indentBlock()).toBe(true)
      const doc = getDocument(editor)
      expect(doc.map((b) => b.depth)).toEqual([0, 1, 1])
      destroy()
    })

    it("3.11 outdentBlock() MBS over [d=1, d=0, d=2] → [d=0, d=0, d=1]", () => {
      const { editor, destroy } = makeEditor(docWithBlocks([
        { type: "paragraph", id: "p1", depth: 1, text: "a" },
        { type: "paragraph", id: "p2", depth: 0, text: "b" },
        { type: "paragraph", id: "p3", depth: 2, text: "c" },
      ]))
      editor.commands.setBlockSelection({ from: "p1", to: "p3" })
      expect(editor.commands.outdentBlock()).toBe(true)
      const doc = getDocument(editor)
      expect(doc.map((b) => b.depth)).toEqual([0, 0, 1])
      destroy()
    })
  })

  describe("follow-prev mode", () => {
    it("3.14 indentBlock on paragraph after numberedList d=1 → d=1 (capability)", () => {
      const { editor, destroy } = makeEditor(docWithBlocks([
        { type: "numberedList", id: "n1", depth: 0, text: "parent" },
        { type: "numberedList", id: "n2", depth: 1, text: "child" },
        { type: "paragraph", id: "p1", depth: 0, text: "middle" },
      ]))
      expect(editor.commands.indentBlock("p1")).toBe(true)
      expect(getDocument(editor)[2]!.depth).toBe(1)
      destroy()
    })

    it("3.15 indentBlock at cap (paragraph already at prev.depth+1) returns false", () => {
      const { editor, destroy } = makeEditor(docWithBlocks([
        { type: "numberedList", id: "n1", depth: 0, text: "parent" },
        { type: "numberedList", id: "n2", depth: 1, text: "child" },
        { type: "paragraph", id: "p1", depth: 2, text: "middle" },
      ]))
      // p1's prev = numList d=1 → cap=2; current=2 ≥ cap → no-op
      expect(editor.commands.indentBlock("p1")).toBe(false)
      expect(getDocument(editor)[2]!.depth).toBe(2)
      destroy()
    })

    it("3.16 indentBlock cannot exceed prev sibling depth + 1 (multiple Tabs)", () => {
      const { editor, destroy } = makeEditor(docWithBlocks([
        { type: "numberedList", id: "n1", depth: 0, text: "a" },
        { type: "numberedList", id: "n2", depth: 2, text: "b" },
        { type: "paragraph", id: "p1", depth: 0, text: "c" },
      ]))
      // prev = numList d=2 → cap=3; can reach d=3 (aligns with list content column)
      expect(editor.commands.indentBlock("p1")).toBe(true)
      expect(getDocument(editor)[2]!.depth).toBe(1)
      expect(editor.commands.indentBlock("p1")).toBe(true)
      expect(getDocument(editor)[2]!.depth).toBe(2)
      expect(editor.commands.indentBlock("p1")).toBe(true)
      expect(getDocument(editor)[2]!.depth).toBe(3)
      expect(editor.commands.indentBlock("p1")).toBe(false)
      expect(getDocument(editor)[2]!.depth).toBe(3)
      destroy()
    })

    it("3.17 indentBlock follow-prev works when prev is also non-list", () => {
      const { editor, destroy } = makeEditor(docWithBlocks([
        { type: "paragraph", id: "p1", depth: 3, text: "anchored deep somehow" },
        { type: "paragraph", id: "p2", depth: 0, text: "after" },
      ]))
      // prev = paragraph d=3 → cap=4
      expect(editor.commands.indentBlock("p2")).toBe(true)
      expect(getDocument(editor)[1]!.depth).toBe(1)
      expect(editor.commands.indentBlock("p2")).toBe(true)
      expect(getDocument(editor)[1]!.depth).toBe(2)
      expect(editor.commands.indentBlock("p2")).toBe(true)
      expect(getDocument(editor)[1]!.depth).toBe(3)
      expect(editor.commands.indentBlock("p2")).toBe(true)
      expect(getDocument(editor)[1]!.depth).toBe(4)
      expect(editor.commands.indentBlock("p2")).toBe(false)
      destroy()
    })

    it("3.18 indentBlock MBS reads pre-transaction doc for each target's cap (discriminating)", () => {
      // Seed: [numList d=2, paragraph d=0, paragraph d=1]
      // MBS over [p1, p2]:
      //   p1's prev = numList d=2 → cap=3; current=0 < cap → +1 → d=1
      //   p2's prev IN THE ORIGINAL DOC = p1 d=0 → cap=1; current=1 ≥ cap → no-op (stays 1)
      // If implementation reads the live (in-pass) doc, p2 would see p1 now at d=1,
      // cap=2, current=1 < cap, and incorrectly indent to d=2. p2.depth=1 catches that.
      const { editor, destroy } = makeEditor(docWithBlocks([
        { type: "numberedList", id: "n1", depth: 2, text: "anchor" },
        { type: "paragraph", id: "p1", depth: 0, text: "first" },
        { type: "paragraph", id: "p2", depth: 1, text: "second" },
      ]))
      editor.commands.setBlockSelection({ from: "p1", to: "p2" })
      expect(editor.commands.indentBlock()).toBe(true)
      const doc = getDocument(editor)
      expect(doc.map((b) => b.depth)).toEqual([2, 1, 1])
      destroy()
    })
  })

  it("chain-safety: indents 'b', chained after insertContentAt(0)", () => {
    const { editor, destroy } = makeEditor(docWithBlocks([
      { type: "paragraph", id: "a", text: "A" },
      { type: "paragraph", id: "b", text: "B" },
    ]))
    editor.chain().insertContentAt(0, PRE).indentBlock("b").run()
    const blocks = getDocument(editor)
    expect(blocks.find((b) => b.id === "b")?.depth).toBe(1)
    expect(blocks.find((b) => b.id === "a")?.depth).toBe(0)
    destroy()
  })
})

describe("commands.turnInto — chain safety (task #17)", () => {
  it("turns 'b' into a heading, chained after insertContentAt(0)", () => {
    const { editor, destroy } = makeEditor({
      type: "doc",
      content: ["a", "b"].map((id) => ({
        type: "paragraph",
        attrs: { id, depth: 0 },
        content: [{ type: "text", text: id.toUpperCase() }],
      })),
    })
    const run = () =>
      editor
        .chain()
        .insertContentAt(0, PRE)
        .turnInto("b", { type: "heading", props: { level: 2 } } as never)
        .run()
    expect(run).not.toThrow()
    const blocks = getDocument(editor)
    expect(blocks.find((b) => b.id === "b")?.type).toBe("heading")
    expect(ids(editor)).toEqual(["PRE", "a", "b"])
    destroy()
  })

  it("turns 'c' into a heading, chained after a prior deleteBlocks (shrinking step)", () => {
    const { editor, destroy } = makeEditor({
      type: "doc",
      content: ["a", "b", "c"].map((id) => ({
        type: "paragraph",
        attrs: { id, depth: 0 },
        content: [{ type: "text", text: id.toUpperCase() }],
      })),
    })
    editor
      .chain()
      .deleteBlocks(["a"])
      .turnInto("c", { type: "heading", props: { level: 2 } } as never)
      .run()
    const blocks = getDocument(editor)
    expect(ids(editor)).toEqual(["b", "c"])
    expect(blocks.find((b) => b.id === "c")?.type).toBe("heading")
    destroy()
  })

  it("no-ops (no throw) when its target was deleted by a prior chained step", () => {
    const { editor, destroy } = makeEditor({
      type: "doc",
      content: ["a", "b"].map((id) => ({
        type: "paragraph",
        attrs: { id, depth: 0 },
        content: [{ type: "text", text: id.toUpperCase() }],
      })),
    })
    const run = () =>
      editor
        .chain()
        .deleteBlocks(["b"])
        .turnInto("b", { type: "heading", props: { level: 2 } } as never)
        .run()
    expect(run).not.toThrow()
    expect(ids(editor)).toEqual(["a"])
    destroy()
  })
})

describe("commands.wrapIntoColumns — chain safety (task #17)", () => {
  function flatDoc(blockIds: string[]) {
    return {
      type: "doc" as const,
      content: blockIds.map((id) => ({
        type: "paragraph",
        attrs: { id, depth: 0 },
        content: [{ type: "text", text: id.toUpperCase() }],
      })),
    }
  }

  function layoutOf(editor: Editor): RuneColumnsBlock | undefined {
    return getDocument(editor).find(
      (b): b is RuneColumnsBlock => b.type === "columnLayout",
    )
  }

  it("wraps 'a' + 'c' into a 2-column layout, chained after insertContentAt(0)", () => {
    const { editor, destroy } = makeEditor(flatDoc(["a", "b", "c"]))
    editor
      .chain()
      .insertContentAt(0, PRE)
      .wrapIntoColumns(["c"], { id: "a", side: "right" })
      .run()
    const layout = layoutOf(editor)
    expect(layout).toBeDefined()
    expect(layout!.columns.map((c) => c.children.map((ch) => ch.id))).toEqual([["a"], ["c"]])
    expect(ids(editor)).toEqual(["PRE", layout!.id, "b"])
    destroy()
  })

  it("wraps 'b' + 'd' into a 2-column layout, chained after a prior deleteBlocks (shrinking step)", () => {
    const { editor, destroy } = makeEditor(flatDoc(["a", "b", "c", "d"]))
    editor.chain().deleteBlocks(["a"]).wrapIntoColumns(["d"], { id: "b", side: "right" }).run()
    const layout = layoutOf(editor)
    expect(layout).toBeDefined()
    expect(layout!.columns.map((c) => c.children.map((ch) => ch.id))).toEqual([["b"], ["d"]])
    expect(ids(editor)).toEqual([layout!.id, "c"])
    destroy()
  })

  it("no-ops (no throw) when its wrap target was deleted by a prior chained step", () => {
    const { editor, destroy } = makeEditor(flatDoc(["a", "b", "c"]))
    const run = () =>
      editor.chain().deleteBlocks(["a"]).wrapIntoColumns(["c"], { id: "a", side: "right" }).run()
    expect(run).not.toThrow()
    expect(layoutOf(editor)).toBeUndefined()
    expect(ids(editor)).toEqual(["b", "c"])
    destroy()
  })
})

describe("commands.splitListBlock — chain safety (task #17)", () => {
  it("splits a bulletList at the cursor, chained after insertContentAt(0)", () => {
    const { editor, destroy } = makeEditor({
      type: "doc",
      content: [
        { type: "bulletList", attrs: { id: "li", depth: 0 }, content: [{ type: "text", text: "AB" }] },
      ],
    })
    // PRE (5 tokens) shifts the doc; the split point ("between A and B", pos 2
    // pre-shift) lands at pos 7 post-shift.
    editor.chain().insertContentAt(0, PRE).setTextSelection(7).splitListBlock().run()
    const lists = getDocument(editor).filter(
      (b): b is Extract<RuneBlock, { type: "bulletList" }> => b.type === "bulletList",
    )
    expect(ids(editor)[0]).toBe("PRE")
    expect(lists.length).toBe(2)
    expect(lists[0]).toMatchObject({ id: "li", text: "A" })
    expect(lists[1]!.id).not.toBe("li")
    expect(lists[1]).toMatchObject({ text: "B" })
    destroy()
  })

  it("splits a bulletList at the cursor, chained after a prior deleteBlocks (shrinking step)", () => {
    const { editor, destroy } = makeEditor({
      type: "doc",
      content: [
        { type: "paragraph", attrs: { id: "junk", depth: 0 }, content: [{ type: "text", text: "J" }] },
        { type: "bulletList", attrs: { id: "li", depth: 0 }, content: [{ type: "text", text: "AB" }] },
      ],
    })
    // Deleting "junk" (3 tokens) shrinks the doc; the split point ("between A
    // and B") is pos 2 against the POST-delete doc.
    editor.chain().deleteBlocks(["junk"]).setTextSelection(2).splitListBlock().run()
    const lists = getDocument(editor).filter(
      (b): b is Extract<RuneBlock, { type: "bulletList" }> => b.type === "bulletList",
    )
    expect(lists.length).toBe(2)
    expect(lists[0]).toMatchObject({ id: "li", text: "A" })
    expect(lists[1]).toMatchObject({ text: "B" })
    destroy()
  })

  it("no-ops (no throw) when the prior chained step removes the list the selection was in", () => {
    const { editor, destroy } = makeEditor({
      type: "doc",
      content: [
        { type: "bulletList", attrs: { id: "li", depth: 0 }, content: [{ type: "text", text: "solo" }] },
      ],
    })
    const run = () => editor.chain().deleteBlocks(["li"]).splitListBlock().run()
    expect(run).not.toThrow()
    expect(getDocument(editor).some((b) => b.type === "bulletList")).toBe(false)
    destroy()
  })
})
