// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import type { Decoration } from "@tiptap/pm/view"

import { createBlockExtension, createBlockSpec, readBlockInputText, inlineContentFromText } from "../../schema"
import { insertOrUpdateBlockForSlashMenu } from "../../extensions/suggestion-menus"
import type { RuneBlockBase } from "../../types"
import { listChainDragRange } from "../list-shared/dragChainRange"
import { parseListDepth } from "../list-shared/parseDepth"

export interface RuneTaskListBlock extends RuneBlockBase {
  type: "taskList"
  text: string
  checked: boolean
}

function taskListAttrsFromElement(li: HTMLElement) {
  const checkedAttr = li.getAttribute("data-rune-paste-checked")
  const cb = Array.from(li.children).find(
    (child): child is HTMLInputElement =>
      child instanceof HTMLInputElement && child.matches("input[type='checkbox']"),
  )
  if (checkedAttr == null && cb == null) return false
  return {
    checked: checkedAttr != null ? checkedAttr === "true" : cb?.hasAttribute("checked") === true,
    depth: parseListDepth(li),
  }
}

function setCheckedAttributes(dom: HTMLElement, button: HTMLButtonElement, checked: boolean) {
  button.setAttribute("aria-checked", checked ? "true" : "false")
  if (checked) dom.setAttribute("data-checked", "true")
  else dom.removeAttribute("data-checked")
}

function splitTaskListAttributes(HTMLAttributes: Record<string, unknown>) {
  const {
    "data-text-color": textColor,
    "data-background-color": bgColor,
    ...root
  } = HTMLAttributes
  const content: Record<string, string> = { class: "rune-block-content" }
  if (textColor) content["data-text-color"] = String(textColor)
  if (bgColor) content["data-background-color"] = String(bgColor)
  return { root, content }
}

function rootAttributesFromNode(node: ProseMirrorNode): Record<string, string> {
  const attrs: Record<string, string> = {}
  if (typeof node.attrs.id === "string" && node.attrs.id.length > 0) {
    attrs["data-id"] = node.attrs.id
  }
  if (typeof node.attrs.depth === "number" && node.attrs.depth > 0) {
    attrs["data-depth"] = String(node.attrs.depth)
    // Mirror the factory's depth.renderHTML (createSpec.ts): emit both the
    // data-attr AND the inline `--rune-block-depth` var that editor-chrome.css
    // multiplies into the indent step. The factory path is bypassed here
    // because TaskList hand-rolls its NodeView, and `update()` rebuilds attrs
    // from this function — so without the var, indenting a to-do (a depth
    // change → update) drops the multiplier and the row shifts LEFT (the
    // [data-depth] rule overrides the base padding with calc(0 * step)).
    attrs.style = `--rune-block-depth: ${node.attrs.depth}`
  }
  if (node.attrs.checked === true) attrs["data-checked"] = "true"
  if (typeof node.attrs.textColor === "string" && node.attrs.textColor.length > 0) {
    attrs["data-text-color"] = node.attrs.textColor
  }
  if (typeof node.attrs.backgroundColor === "string" && node.attrs.backgroundColor.length > 0) {
    attrs["data-background-color"] = node.attrs.backgroundColor
  }
  return attrs
}

type DecorationWithAttrs = Decoration & {
  type?: { attrs?: Record<string, string | undefined> }
}

function attrsFromDecorations(decorations: readonly Decoration[]): Record<string, string> {
  const attrs: Record<string, string> = {}
  for (const decoration of decorations) {
    const decorationAttrs = (decoration as DecorationWithAttrs).type?.attrs
    if (!decorationAttrs) continue
    for (const [key, value] of Object.entries(decorationAttrs)) {
      if (value == null || key === "nodeName") continue
      if (key === "class") {
        attrs.class = [attrs.class, value].filter(Boolean).join(" ")
      } else if (key === "style") {
        attrs.style = [attrs.style, value].filter(Boolean).join("; ")
      } else {
        attrs[key] = value
      }
    }
  }
  return attrs
}

function rootAttributesFromNodeAndDecorations(
  node: ProseMirrorNode,
  decorations: readonly Decoration[],
) {
  const base = rootAttributesFromNode(node)
  const deco = attrsFromDecorations(decorations)
  const merged = { ...base, ...deco }
  // `style` must concatenate, not clobber: the node contributes the depth var
  // and decorations may add their own (e.g. block-selection paint). A plain
  // spread would let a decoration's style overwrite the indent var, re-opening
  // the left-shift bug whenever an indented to-do is also decorated.
  const style = [base.style, deco.style].filter(Boolean).join("; ")
  if (style) merged.style = style
  return merged
}

function applyRootAttributes(
  dom: HTMLElement,
  HTMLAttributes: Record<string, unknown>,
) {
  const nextNames = new Set(Object.keys(HTMLAttributes))
  for (const name of Array.from(dom.getAttributeNames())) {
    if (name !== "class" && !nextNames.has(name)) dom.removeAttribute(name)
  }
  dom.removeAttribute("data-text-color")
  dom.removeAttribute("data-background-color")

  for (const [key, value] of Object.entries(HTMLAttributes)) {
    if (value == null) continue
    if (key === "class") continue
    if (key === "data-text-color" || key === "data-background-color") continue
    dom.setAttribute(key, String(value))
  }

  const classes = new Set(
    String(HTMLAttributes.class ?? "")
      .split(/\s+/)
      .filter(Boolean),
  )
  classes.add("rune-block")
  classes.add("rune-task-list")
  dom.setAttribute("class", Array.from(classes).join(" "))
}

function applyContentAttributes(content: HTMLElement, HTMLAttributes: Record<string, string>) {
  const nextNames = new Set(Object.keys(HTMLAttributes))
  for (const name of Array.from(content.getAttributeNames())) {
    if (!nextNames.has(name)) content.removeAttribute(name)
  }
  for (const [key, value] of Object.entries(HTMLAttributes)) {
    content.setAttribute(key, value)
  }
}

type TaskListCommands = {
  updateBlock: (id: string, partial: { checked: boolean }) => boolean
}

export const TaskList = createBlockSpec({
  type: "taskList",
  content: "inline*",
  supports: { textColor: true, backgroundColor: true },
  indent: { mode: "structural" },
  props: {
    checked: {
      default: false,
      parseHTML: (el) => {
        const attrs = taskListAttrsFromElement(el)
        if (attrs !== false) return attrs.checked
        return el.getAttribute("data-checked") === "true"
      },
      renderHTML: (attrs): Record<string, string> =>
        (attrs.checked as boolean) ? { "data-checked": "true" } : {},
    },
  },
  schemaContext: {
    input: {
      examples: [{ type: "taskList", text: "Example task", checked: false }],
    },
  },
  toRuneBlock: (node) => ({
    type: "taskList",
    id: typeof node.attrs.id === "string" ? node.attrs.id : "",
    depth: typeof node.attrs.depth === "number" ? node.attrs.depth : 0,
    text: node.textContent,
    checked: node.attrs.checked === true,
  }),
  fromInput: ({ schema, input, defaults }) => {
    const t = schema.nodes["taskList"]
    if (!t) return null
    const text = readBlockInputText(input)
    const attrs = {
      ...defaults.attrs,
      id: input.id ?? null,
      depth: input.depth ?? defaults.depth,
      checked: input.checked === true,
    }
    const content =
      defaults.preserveContent &&
      defaults.content &&
      t.validContent(defaults.content)
        ? defaults.content
        : text
          ? inlineContentFromText(schema, text)
          : undefined
    return t.create(attrs, content, defaults.marks)
  },
  parseDOM: [
    {
      tag: "li",
      priority: 60,
      getAttrs: (li) => (li instanceof HTMLElement ? taskListAttrsFromElement(li) : false),
    },
  ],
  renderDOM: ({ HTMLAttributes }) => {
    const {
      "data-text-color": textColor,
      "data-background-color": bgColor,
      ...outer
    } = HTMLAttributes
    const contentAttrs: Record<string, string> = { class: "rune-block-content" }
    if (textColor) contentAttrs["data-text-color"] = String(textColor)
    if (bgColor) contentAttrs["data-background-color"] = String(bgColor)
    return [
      "div",
      { ...outer, class: "rune-block rune-task-list" },
      [
        "div",
        contentAttrs,
        [
          "button",
          {
            class: "rune-task-checkbox",
            role: "checkbox",
            "aria-checked": HTMLAttributes["data-checked"] === "true" ? "true" : "false",
            tabindex: "-1",
            contenteditable: "false",
          },
        ],
        ["p", {}, 0],
      ],
    ]
  },
  toMarkdown({ prefix, serializeInline, node }) {
    const marker = node.attrs.checked === true ? "- [x]  " : "- [ ]  "
    return { line: `${prefix}${marker}${serializeInline(node)}`, spacing: "list-item" }
  },
  clipboardRenderDOM: ({ node }) => [
    "ul",
    {},
    [
      "li",
      {},
      [
        "input",
        {
          type: "checkbox",
          disabled: "",
          ...(node.attrs.checked ? { checked: "" } : {}),
        },
      ],
      " ",
      // The content hole must be the only child of its immediate parent
      // (ProseMirror `renderSpec` rule), so it cannot sit as a sibling of
      // the <input>/space inside <li> — wrap it in a <span>. Emitting a
      // bare `0` here throws RangeError mid-serialization, which crashes
      // the whole clipboard write (any Cmd-C over a range with a to-do).
      ["span", {}, 0],
    ],
  ],
  nodeView: ({ node, editor, HTMLAttributes }) => {
    let currentNode: ProseMirrorNode = node
    const initialAttrs = splitTaskListAttributes(HTMLAttributes)
    const dom = document.createElement("div")
    applyRootAttributes(dom, initialAttrs.root)

    const content = document.createElement("div")
    applyContentAttributes(content, initialAttrs.content)

    const button = document.createElement("button")
    button.className = "rune-task-checkbox"
    button.setAttribute("role", "checkbox")
    button.setAttribute("tabindex", "-1")
    button.contentEditable = "false"

    const contentDOM = document.createElement("p")

    content.append(button, contentDOM)
    dom.appendChild(content)
    setCheckedAttributes(dom, button, currentNode.attrs.checked === true)

    button.addEventListener("mousedown", (event) => {
      event.preventDefault()
    })

    button.addEventListener("click", () => {
      const id = currentNode.attrs.id
      if (typeof id !== "string" || id.length === 0) return
      const commands = editor.commands as typeof editor.commands & TaskListCommands
      commands.updateBlock(id, { checked: currentNode.attrs.checked !== true })
    })

    return {
      dom,
      contentDOM,
      update: (next, decorations) => {
        if (next.type !== currentNode.type) return false
        currentNode = next
        const nextAttrs = splitTaskListAttributes(
          rootAttributesFromNodeAndDecorations(currentNode, decorations),
        )
        applyRootAttributes(dom, nextAttrs.root)
        applyContentAttributes(content, nextAttrs.content)
        setCheckedAttributes(dom, button, currentNode.attrs.checked === true)
        return true
      },
      selectNode: () => {},
      deselectNode: () => {},
      stopEvent: (event) =>
        (event.type === "mousedown" || event.type === "click") &&
        event.target instanceof Node &&
        button.contains(event.target),
      ignoreMutation: (mutation) => {
        if (mutation.type === "attributes" && mutation.target === dom) return true
        return mutation.target instanceof Node && button.contains(mutation.target)
      },
    }
  },
  slashMenuItems: () => {
    const block = { type: "taskList", props: { checked: false } }
    return [
      {
        key: "taskList",
        title: "To-do list",
        aliases: ["todo", "task", "check", "checkbox", "[]"],
        group: "Basic blocks",
        block,
        onItemClick: (ctx) => insertOrUpdateBlockForSlashMenu(ctx, block),
      },
    ]
  },
  dragSourceRange: ({ node, pos, doc, editor }) =>
    listChainDragRange({ node, pos, doc, editor }),
  sideMenu: { draggable: true },
  extensions: [
    createBlockExtension({
      key: "input-rule",
      inputRules: [
        {
          find: /^\[(\s|x|X)?\]\s$/,
          replace: ({ match }) => ({
            type: "taskList",
            props: { checked: match[1]?.toLowerCase() === "x" },
          }),
        },
      ],
    }),
  ],
})
