// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { Extension } from "@tiptap/core"
import { Plugin, PluginKey } from "@tiptap/pm/state"
import { Decoration, DecorationSet } from "@tiptap/pm/view"
import { resolvePlaceholder } from "./resolve"
import type {
  PlaceholderConfig,
  PlaceholderPluginState,
  PlaceholderResolver,
} from "./types"

export const placeholderPluginKey = new PluginKey<PlaceholderPluginState>("rune-placeholder")

export interface PlaceholderOptions {
  placeholders?: PlaceholderConfig
}

export const Placeholder = Extension.create<PlaceholderOptions>({
  name: "placeholder",

  addOptions() {
    return { placeholders: undefined }
  },

  addProseMirrorPlugins() {
    const extension = this

    return [
      new Plugin<PlaceholderPluginState>({
        key: placeholderPluginKey,

        state: {
          init: () => ({ focused: false }),
          apply(tr, value) {
            const meta = tr.getMeta(placeholderPluginKey) as
              | PlaceholderPluginState
              | undefined
            if (meta) return { focused: meta.focused }
            return value
          },
        },

        view(view) {
          // Warn once per editor init for placeholder keys that don't match
          // any registered node type. Built-in block names are caught at
          // compile time by RuneBlockTypeName; this covers (a) custom blocks
          // registered via createBlockSpec (not in the union), and (b) any
          // consumer who cast past the type. See #178.
          const placeholders = extension.options.placeholders
          if (placeholders) {
            const unknown: string[] = []
            const entries = placeholders as Record<
              string,
              PlaceholderResolver | undefined
            >
            for (const key of Object.keys(placeholders)) {
              if (key === "default") continue
              // An explicit per-type `undefined` is a deliberate opt-out, not
              // a typo — harmless even when the type isn't registered (e.g.
              // rune-react ships `title: undefined` in its defaults but
              // TitleKit, the only thing that registers `title`, is opt-in).
              // Don't flag it.
              if (entries[key] === undefined) continue
              if (!view.state.schema.nodes[key]) unknown.push(key)
            }
            if (unknown.length > 0) {
              console.warn(
                `[rune-placeholder] Ignored placeholder key(s) with no matching block type: ${unknown
                  .map((k) => `"${k}"`)
                  .join(
                    ", ",
                  )}. Check for typos, or for custom blocks ensure the block is registered before Placeholder.`,
              )
            }
          }

          const dispatchFocus = (focused: boolean) => {
            const current = placeholderPluginKey.getState(view.state)
            if (current?.focused === focused) return
            const tr = view.state.tr
              .setMeta(placeholderPluginKey, { focused })
              .setMeta("addToHistory", false)
            view.dispatch(tr)
          }

          const onFocus = () => dispatchFocus(true)
          const onBlur = () => dispatchFocus(false)
          view.dom.addEventListener("focus", onFocus)
          view.dom.addEventListener("blur", onBlur)

          if (view.dom === document.activeElement) onFocus()

          return {
            destroy() {
              view.dom.removeEventListener("focus", onFocus)
              view.dom.removeEventListener("blur", onBlur)
            },
          }
        },

        props: {
          decorations(state) {
            const focused = placeholderPluginKey.getState(state)?.focused ?? false
            const hits = resolvePlaceholder(
              state,
              extension.options.placeholders,
              focused,
              extension.editor.isEditable,
            )

            if (hits.length === 0) return DecorationSet.empty

            const decorations: Decoration[] = []
            for (const hit of hits) {
              const attrs: Record<string, string> = {
                class: "is-empty",
                "data-placeholder": hit.text,
                "data-placeholder-type": hit.node.type.name,
                "data-placeholder-state": hit.state,
              }

              if (hit.node.type.name === "heading") {
                const level = hit.node.attrs.level as number
                attrs["data-placeholder-level"] = String(level - 1)
              }

              // Outer node decoration: surfaces is-empty / data-placeholder
              // / data-placeholder-type / -state on the rune-block wrapper.
              // Consumers reading these for analytics or per-type styling
              // continue to work unchanged.
              decorations.push(
                Decoration.node(hit.pos, hit.pos + hit.node.nodeSize, attrs),
              )
              // Inline widget at the start of the textblock's content. Lands
              // inside the contentDOM (inner <p> / heading), so list blocks'
              // flex layout naturally pushes it after the marker / checkbox
              // instead of overlapping. `float: left; height: 0` (see CSS)
              // keeps the caret on the same line. side:-1 anchors it before
              // any inserted text so the first keystroke pushes the caret
              // past the placeholder (PM removes the widget on next render
              // because the textblock is no longer empty).
              //
              // Two-element shape (outer .rune-placeholder + inner
              // .rune-placeholder-text) avoids PM's addTextblockHacks
              // injecting an <img.ProseMirror-separator>: that hack fires
              // when the textblock's last non-trailing-break child is
              // contenteditable=false. Tailwind preflight sizes the
              // injected img with `vertical-align: middle`, creating an
              // inline strut that pads the line box. In an empty block,
              // hovering then mounts the side-menu widget at the same
              // pos which displaces the placeholder out of "last
              // non-editable" position → PM removes the IMG → caret
              // visibly shrinks. Keeping ce="false" on an inner child
              // (so click/selection still skips it) and pairing with
              // `raw: true` (so PM doesn't force ce="false" on the
              // outer root) means the textblock's last non-editable
              // check fails and no separator is injected in either
              // state. Memory: project_pm_widget_textblock_hack.md.
              decorations.push(
                Decoration.widget(
                  hit.pos + 1,
                  () => {
                    const outer = document.createElement("span")
                    outer.className = "rune-placeholder"
                    outer.setAttribute("aria-hidden", "true")
                    const inner = document.createElement("span")
                    inner.className = "rune-placeholder-text"
                    inner.setAttribute("contenteditable", "false")
                    inner.textContent = hit.text
                    outer.appendChild(inner)
                    return outer
                  },
                  // Key includes pos so PM can dedupe per-block — multiple
                  // always-on hits in the same doc render distinct widgets.
                  {
                    side: -1,
                    ignoreSelection: true,
                    raw: true,
                    key: `rune-placeholder:${hit.pos}:${hit.text}`,
                  },
                ),
              )
            }

            return DecorationSet.create(state.doc, decorations)
          },
        },
      }),
    ]
  },
})
