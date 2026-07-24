// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { Node } from "@tiptap/core"
import type { Editor, NodeViewRendererProps } from "@tiptap/core"
import type { NodeView } from "@tiptap/pm/view"
import { bindShortcutKeys, getRuneKeymap } from "../../keymap"
import { MathController } from "./controller"
import { inlineMathCommands } from "./commands"
import { compileDeclarativeInputRules } from "../../schema/blocks/internal"
import type { DeclarativeInputRule } from "../../schema/blocks/types"

export type InlineNodeViewFactory = (args: NodeViewRendererProps) => NodeView

function defaultInlineMathNodeView({ node, HTMLAttributes }: NodeViewRendererProps): NodeView {
  const dom = document.createElement("span")
  for (const [name, value] of Object.entries(HTMLAttributes)) {
    dom.setAttribute(name, String(value))
  }
  dom.dataset.type = "inline-math"
  dom.classList.add("rune-inline-math")
  dom.textContent = `$${String(node.attrs.latex ?? "")}$`
  return { dom }
}

// `$$latex$$` → one `inlineMath` atom as soon as the closing delimiter is typed.
// The shared `replaceWithNode` executor
// (auto-detects inline-atom target) handles the actual replacement.
const inlineMathRule: DeclarativeInputRule = {
  find: /\$\$([^$\n]+)\$\$$/,
  replace: ({ match, editor }) => {
    const { $from } = editor.state.selection
    // Suppress inside any code-like ancestor or under the inline `code` mark.
    // Matches the established pattern in kit.ts (suggestion-menu suppression
    // by `spec.code`) — uses node-level metadata, not hard-coded names.
    for (let depth = $from.depth; depth >= 0; depth--) {
      if ($from.node(depth).type.spec.code) return false
    }
    if ($from.marks().some((mark) => mark.type.spec.code)) return false

    const latex = String(match[1] ?? "").trim()
    if (!latex) return false
    return { type: "inlineMath", props: { latex } }
  },
}

export const InlineMath = Node.create<{ nodeView?: InlineNodeViewFactory }>({
  name: "inlineMath",
  inline: true,
  group: "inline",
  atom: true,
  selectable: true,
  draggable: false,

  addOptions() {
    return {
      nodeView: undefined,
    }
  },

  addAttributes() {
    return {
      latex: {
        default: "",
        parseHTML: (el: HTMLElement) => el.getAttribute("data-latex") ?? "",
        renderHTML: (attrs: Record<string, unknown>) => ({
          "data-latex": String(attrs.latex ?? ""),
        }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-type="inline-math"]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const latex = String(node.attrs.latex ?? "")
    return [
      "span",
      {
        ...HTMLAttributes,
        "data-type": "inline-math",
        class: "rune-inline-math",
      },
      `$${latex}$`,
    ]
  },

  renderText({ node }) {
    return `$${String(node.attrs.latex ?? "")}$`
  },

  addNodeView() {
    return (props) => (this.options.nodeView ?? defaultInlineMathNodeView)(props)
  },

  addCommands() {
    return inlineMathCommands()
  },

  addKeyboardShortcuts() {
    // The `inlineMath` action (default Mod-Shift-e). Collapsed cursor →
    // insert empty inline math. Non-collapsed single-textblock selection →
    // wrap as inline math. Both commands self-gate (readonly, inline-content
    // context, single-textblock for wrap); a `false` here lets PM fall
    // through, so a multi-block selection or readonly editor leaves the
    // chord free for the next handler / browser default.
    return bindShortcutKeys(
      getRuneKeymap(this.editor).inlineMath,
      ({ editor }: { editor: Editor }) => {
        if (editor.state.selection.empty) {
          return editor.commands.insertInlineMath({ latex: "" })
        }
        return editor.commands.wrapSelectionAsInlineMath()
      },
    )
  },

  addInputRules() {
    return compileDeclarativeInputRules([inlineMathRule], this.editor)
  },

  addProseMirrorPlugins() {
    return [MathController]
  },
})
