// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, expect, it, vi } from "vitest"
import { Editor, Extension } from "@tiptap/core"
import Document from "@tiptap/extension-document"
import Text from "@tiptap/extension-text"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import { Plugin, PluginKey } from "@tiptap/pm/state"
import { Decoration, DecorationSet } from "@tiptap/pm/view"

import { BlockCommands } from "../../api/commands"
import { BlockBackgroundColor, BlockTextColor } from "../../extensions/color"
import { Paragraph } from "../Paragraph/block"
import { BulletList } from "../BulletList/block"
import { TaskList } from "./block"

async function triggerInputRule(editor: Editor, from: number, to: number, text: string) {
  const handled = editor.view.someProp("handleTextInput", (fn) =>
    fn(editor.view, to, to, text, null as never),
  )
  if (handled) return
  editor.view.dispatch(editor.state.tr.setMeta("applyInputRules", { from: to, text }))
  await new Promise((r) => setTimeout(r, 0))
}

type TaskListStorage = {
  slashMenuItems?: (editor: Editor) => Array<{
    key: string
    title: string
    aliases?: string[]
    group?: string
  }>
  sideMenu?: { draggable: boolean }
  clipboardRenderDOM?: (args: { node: ProseMirrorNode }) => unknown
  toRuneBlock?: (node: ProseMirrorNode) => {
    type: string
    id: string
    depth: number
    text: string
    checked: boolean
  }
}

type TaskListCommands = {
  updateBlock: (
    id: string,
    partial: { id?: string; depth?: number; checked?: boolean },
  ) => boolean
}

function makeEditor(content?: object | string) {
  return new Editor({
    element: document.createElement("div"),
    extensions: [Document, Paragraph, BlockCommands, TaskList, Text],
    content: content as never,
  })
}

const ClassProbe = Extension.create({
  name: "task-list-class-probe",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          decorations: (state) => {
            const first = state.doc.firstChild
            if (!first) return DecorationSet.empty
            return DecorationSet.create(state.doc, [
              Decoration.node(0, first.nodeSize, {
                class: "probe-class",
                style: "--probe: 1",
              }),
            ])
          },
        },
      }),
    ]
  },
})

const dynamicDecorationKey = new PluginKey<number>("rune-task-list-dynamic-decoration-probe")

const DynamicDecorationProbe = Extension.create({
  name: "task-list-dynamic-decoration-probe",
  addProseMirrorPlugins() {
    return [
      new Plugin<number>({
        key: dynamicDecorationKey,
        state: {
          init: () => 0,
          apply: (tr, value) => {
            const next = tr.getMeta(dynamicDecorationKey)
            return typeof next === "number" ? next : value
          },
        },
        props: {
          decorations: (state) => {
            const first = state.doc.firstChild
            if (!first) return DecorationSet.empty
            const phase = dynamicDecorationKey.getState(state) ?? 0
            if (phase === 2) return DecorationSet.empty
            return DecorationSet.create(state.doc, [
              Decoration.node(0, first.nodeSize, {
                class: phase === 0 ? "probe-one" : "probe-two",
                style: phase === 0 ? "--probe: 1" : "--probe: 2",
              }),
            ])
          },
        },
      }),
    ]
  },
})

function taskStorage(editor: Editor) {
  return editor.extensionManager.extensions.find((e) => e.name === "taskList")
    ?.storage as TaskListStorage
}

describe("TaskList block — schema + storage", () => {
  it("registers slash item, draggable side-menu, and input-rule extension", () => {
    const editor = makeEditor()
    const items = taskStorage(editor).slashMenuItems?.(editor)

    expect(items).toHaveLength(1)
    expect(items?.[0]).toMatchObject({
      key: "taskList",
      title: "To-do list",
      aliases: ["todo", "task", "check", "checkbox", "[]"],
      group: "Basic blocks",
    })
    expect(taskStorage(editor).sideMenu).toEqual({ draggable: true })
    expect(editor.extensionManager.extensions.some((e) => e.name === "taskList--input-rule")).toBe(true)

    editor.destroy()
  })

  it("keeps the source block's depth when the [] input rule converts an indented line", async () => {
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: [Document, Paragraph, BulletList, TaskList, Text],
      content: {
        type: "doc",
        content: [
          // depth-0 predecessor so the depth-1 line below is a legal indent.
          { type: "bulletList", attrs: { depth: 0 }, content: [{ type: "text", text: "a" }] },
          { type: "paragraph", attrs: { depth: 1 }, content: [{ type: "text", text: "[]" }] },
        ],
      } as never,
    })

    // Caret just after "[]" on the indented second block.
    const secondStart = editor.state.doc.child(0).nodeSize
    const caret = secondStart + 1 + 2 // +1 open token, +2 for "[]"
    editor.commands.setTextSelection(caret)
    await triggerInputRule(editor, secondStart + 1, caret, " ")

    const converted = editor.state.doc.child(1)
    expect(converted?.type.name).toBe("taskList")
    // Regression: depth used to reset to 0 because setBlockType replaced attrs
    // wholesale with only `{ checked }`.
    expect(converted?.attrs.depth).toBe(1)

    editor.destroy()
  })

  it("defaults props.checked false and omits the data-checked HTML mirror", () => {
    const editor = makeEditor({
      type: "doc",
      content: [{ type: "taskList", content: [{ type: "text", text: "todo" }] }],
    })

    expect(editor.state.doc.firstChild?.attrs.checked).toBe(false)
    expect(editor.getHTML()).not.toContain("data-checked")

    editor.destroy()
  })
})

describe("TaskList block — parseDOM", () => {
  it("parses post-flatten checked tasks from data-rune-paste-checked", () => {
    const editor = makeEditor()

    editor.commands.setContent('<ul><li data-rune-paste-checked="true">done</li></ul>')

    expect(editor.state.doc.firstChild?.type.name).toBe("taskList")
    expect(editor.state.doc.firstChild?.attrs.checked).toBe(true)
    expect(editor.state.doc.firstChild?.textContent).toBe("done")

    editor.destroy()
  })

  it("parses raw checkbox tasks from a direct input child", () => {
    const editor = makeEditor()

    editor.commands.setContent('<ul><li><input type="checkbox" checked> x</li></ul>')

    expect(editor.state.doc.firstChild?.type.name).toBe("taskList")
    expect(editor.state.doc.firstChild?.attrs.checked).toBe(true)

    editor.destroy()
  })

  it("returns false for non-task list items so other list blocks can claim them", () => {
    const editor = makeEditor()
    const ext = editor.extensionManager.extensions.find((e) => e.name === "taskList") as {
      config?: { parseHTML?: () => Array<{ getAttrs?: (node: HTMLElement) => false | Record<string, unknown> }> }
    }
    const li = document.createElement("li")
    li.textContent = "plain"

    expect(ext.config?.parseHTML?.()[1]?.getAttrs?.(li)).toBe(false)

    editor.destroy()
  })

  it("reads data-rune-paste-depth into depth", () => {
    const editor = makeEditor()
    const ext = editor.extensionManager.extensions.find((e) => e.name === "taskList") as {
      config?: { parseHTML?: () => Array<{ getAttrs?: (node: HTMLElement) => false | Record<string, unknown> }> }
    }
    const li = document.createElement("li")
    li.setAttribute("data-rune-paste-checked", "false")
    li.setAttribute("data-rune-paste-depth", "2")
    li.textContent = "nested"

    expect(ext.config?.parseHTML?.()[1]?.getAttrs?.(li)).toMatchObject({
      checked: false,
      depth: 2,
    })

    editor.destroy()
  })
})

describe("TaskList block — NodeView", () => {
  it("merges HTMLAttributes onto the root and preserves classes", () => {
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: [Document, Paragraph, BlockCommands, ClassProbe, TaskList, Text],
      content: {
        type: "doc",
        content: [
          {
            type: "taskList",
            attrs: { id: "abc", depth: 1, checked: true },
            content: [{ type: "text", text: "todo" }],
          },
        ],
      } as never,
    })

    const view = editor.view.dom.querySelector<HTMLElement>(".rune-task-list")
    expect(view).not.toBeNull()

    expect(view!.tagName).toBe("DIV")
    expect(view!.classList.contains("rune-block")).toBe(true)
    expect(view!.classList.contains("rune-task-list")).toBe(true)
    expect(view!.classList.contains("probe-class")).toBe(true)
    expect(view!.getAttribute("data-id")).toBe("abc")
    expect(view!.getAttribute("data-depth")).toBe("1")
    // The depth>0 root carries the `--rune-block-depth` var (so the indent CSS
    // multiplies by a non-zero depth) AND merges the decoration's style —
    // neither clobbers the other. Without the var, an indented to-do shifts
    // LEFT because [data-depth] overrides the base padding with calc(0 * step).
    expect(view!.getAttribute("style")).toBe("--rune-block-depth: 1; --probe: 1;")

    expect(view!.getAttribute("data-checked")).toBe("true")

    editor.destroy()
  })

  it("omits data-checked on the root when unchecked", () => {
    const editor = makeEditor({
      type: "doc",
      content: [{ type: "taskList", attrs: { checked: false }, content: [{ type: "text", text: "todo" }] }],
    })

    expect(editor.view.dom.querySelector<HTMLElement>(".rune-task-list")?.hasAttribute("data-checked")).toBe(false)

    editor.destroy()
  })

  it("renders checkbox button before the paragraph contentDOM", () => {
    const editor = makeEditor({
      type: "doc",
      content: [{ type: "taskList", attrs: { checked: true }, content: [{ type: "text", text: "todo" }] }],
    })
    const outer = editor.view.dom.querySelector<HTMLElement>(".rune-task-list")!
    const content = outer.querySelector<HTMLElement>(".rune-block-content")
    const button = content?.querySelector<HTMLButtonElement>(".rune-task-checkbox")

    expect(button).not.toBeNull()
    expect(button?.getAttribute("role")).toBe("checkbox")
    expect(button?.getAttribute("aria-checked")).toBe("true")
    expect(button?.getAttribute("tabindex")).toBe("-1")
    expect(button?.contentEditable).toBe("false")
    expect(content?.firstElementChild).toBe(button)
    expect(content?.lastElementChild?.tagName).toBe("P")
    expect(content?.lastElementChild?.textContent).toBe("todo")

    editor.destroy()
  })

  it("clicking the button dispatches updateBlock once and updates checked state", () => {
    const editor = makeEditor({
      type: "doc",
      content: [
        { type: "taskList", attrs: { id: "abc", checked: false }, content: [{ type: "text", text: "todo" }] },
      ],
    })
    const stableCommands = editor.commands
    Object.defineProperty(editor, "commands", { value: stableCommands })
    const updateSpy = vi.spyOn(stableCommands, "updateBlock")
    const outer = editor.view.dom.querySelector<HTMLElement>(".rune-task-list")!
    const button = outer.querySelector<HTMLButtonElement>(".rune-task-checkbox")
    expect(button).not.toBeNull()
    expect(editor.state.doc.firstChild?.attrs.id).toBe("abc")

    button!.dispatchEvent(new MouseEvent("click", { bubbles: true }))

    expect(updateSpy).toHaveBeenCalledOnce()
    expect(updateSpy).toHaveBeenCalledWith("abc", { checked: true })
    expect(editor.state.doc.firstChild?.attrs.checked).toBe(true)
    expect(button?.getAttribute("aria-checked")).toBe("true")
    expect(editor.view.dom.querySelector<HTMLElement>(".rune-task-list")?.getAttribute("data-checked")).toBe("true")

    updateSpy.mockRestore()
    editor.destroy()
  })

  it("keeps the same DOM root when only checked flips", () => {
    const editor = makeEditor({
      type: "doc",
      content: [
        { type: "taskList", attrs: { id: "abc", checked: false }, content: [{ type: "text", text: "todo" }] },
      ],
    })
    const before = editor.view.dom.querySelector<HTMLElement>(".rune-task-list")

    const commands = editor.commands as typeof editor.commands & TaskListCommands
    commands.updateBlock("abc", { checked: true })

    expect(editor.view.dom.querySelector<HTMLElement>(".rune-task-list")).toBe(before)
    expect(before?.getAttribute("data-checked")).toBe("true")

    editor.destroy()
  })

  it("resyncs mutable root attrs while keeping the same DOM root", () => {
    const editor = makeEditor({
      type: "doc",
      content: [
        // Predecessors at depth 0 then 1 so the depth: 2 update below is legal
        // under Task 5 destination clamping (cap = prev depth + 1).
        { type: "taskList", attrs: { id: "pre0", checked: false, depth: 0 }, content: [{ type: "text", text: "p0" }] },
        { type: "taskList", attrs: { id: "pre1", checked: false, depth: 1 }, content: [{ type: "text", text: "p1" }] },
        { type: "taskList", attrs: { id: "abc", checked: false }, content: [{ type: "text", text: "todo" }] },
      ],
    })
    const root = editor.view.dom.querySelector<HTMLElement>(
      '.rune-task-list[data-id="abc"]',
    )
    const commands = editor.commands as typeof editor.commands & TaskListCommands

    commands.updateBlock("abc", { depth: 2, checked: true })

    expect(
      editor.view.dom.querySelector<HTMLElement>('.rune-task-list[data-id="abc"]'),
    ).toBe(root)
    expect(root?.getAttribute("data-id")).toBe("abc")
    expect(root?.getAttribute("data-depth")).toBe("2")
    expect(root?.getAttribute("data-checked")).toBe("true")
    // The update path (not just the initial mount) must keep the
    // `--rune-block-depth` var, or indenting a to-do shifts it LEFT: the
    // [data-depth] CSS rule overrides the base padding with calc(0 * step)
    // when the var is absent.
    expect(root?.getAttribute("style")).toBe("--rune-block-depth: 2")

    const nextCommands = editor.commands as typeof editor.commands & TaskListCommands
    nextCommands.updateBlock("abc", { depth: 0, checked: false })

    expect(root?.getAttribute("data-id")).toBe("abc")
    expect(root?.hasAttribute("data-depth")).toBe(false)
    expect(root?.hasAttribute("data-checked")).toBe(false)
    // depth back to 0 → no data-depth, so the var is dropped too (no stale
    // indent left behind).
    expect(root?.hasAttribute("style")).toBe(false)

    editor.destroy()
  })

  it("refreshes decoration class and style without replacing the DOM root", () => {
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: [Document, Paragraph, BlockCommands, DynamicDecorationProbe, TaskList, Text],
      content: {
        type: "doc",
        content: [{ type: "taskList", attrs: { id: "abc" }, content: [{ type: "text", text: "todo" }] }],
      } as never,
    })
    const root = editor.view.dom.querySelector<HTMLElement>(".rune-task-list")
    expect(root?.classList.contains("probe-one")).toBe(true)
    expect(root?.getAttribute("style")).toBe("--probe: 1;")

    editor.view.dispatch(editor.state.tr.setMeta(dynamicDecorationKey, 1))

    expect(editor.view.dom.querySelector<HTMLElement>(".rune-task-list")).toBe(root)
    expect(root?.classList.contains("probe-one")).toBe(false)
    expect(root?.classList.contains("probe-two")).toBe(true)
    expect(root?.classList.contains("rune-block")).toBe(true)
    expect(root?.classList.contains("rune-task-list")).toBe(true)
    expect(root?.getAttribute("style")).toBe("--probe: 2;")

    editor.view.dispatch(editor.state.tr.setMeta(dynamicDecorationKey, 2))

    expect(editor.view.dom.querySelector<HTMLElement>(".rune-task-list")).toBe(root)
    expect(root?.classList.contains("probe-two")).toBe(false)
    expect(root?.classList.contains("rune-block")).toBe(true)
    expect(root?.classList.contains("rune-task-list")).toBe(true)
    expect(root?.hasAttribute("style")).toBe(false)

    editor.destroy()
  })

  it("places block color attrs on content instead of the root", () => {
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: [
        Document,
        Paragraph,
        BlockCommands,
        TaskList,
        Text,
        BlockTextColor.configure({ types: ["taskList"] }),
        BlockBackgroundColor.configure({ types: ["taskList"] }),
      ],
      content: {
        type: "doc",
        content: [{ type: "taskList", attrs: { id: "abc" }, content: [{ type: "text", text: "todo" }] }],
      } as never,
    })
    editor.commands.setBlockTextColor(0, "red")
    editor.commands.setBlockBackgroundColor(0, "blue")
    const root = editor.view.dom.querySelector<HTMLElement>(".rune-task-list")
    const content = root?.querySelector<HTMLElement>(".rune-block-content")

    expect(root?.hasAttribute("data-text-color")).toBe(false)
    expect(root?.hasAttribute("data-background-color")).toBe(false)
    expect(content?.getAttribute("data-text-color")).toBe("red")
    expect(content?.getAttribute("data-background-color")).toBe("blue")

    editor.destroy()
  })

  it("prevents checkbox mousedown from stealing focus", () => {
    const hostInput = document.createElement("input")
    document.body.appendChild(hostInput)
    hostInput.focus()
    const editor = makeEditor({
      type: "doc",
      content: [{ type: "taskList", attrs: { id: "abc" }, content: [{ type: "text", text: "todo" }] }],
    })
    const button = editor.view.dom.querySelector<HTMLButtonElement>(".rune-task-checkbox")
    const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true })

    button?.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(hostInput)

    editor.destroy()
    hostInput.remove()
  })
})

describe("TaskList block — clipboard", () => {
  it("emits the exact GitHub-flavored task list shape", () => {
    const editor = makeEditor()
    const checkedNode = editor.schema.nodes.taskList!.create({ checked: true })
    const uncheckedNode = editor.schema.nodes.taskList!.create({ checked: false })

    expect(taskStorage(editor).clipboardRenderDOM?.({ node: checkedNode })).toEqual([
      "ul",
      {},
      [
        "li",
        {},
        ["input", { type: "checkbox", disabled: "", checked: "" }],
        " ",
        ["span", {}, 0],
      ],
    ])
    expect(taskStorage(editor).clipboardRenderDOM?.({ node: uncheckedNode })).toEqual([
      "ul",
      {},
      ["li", {}, ["input", { type: "checkbox", disabled: "" }], " ", ["span", {}, 0]],
    ])

    editor.destroy()
  })
})
