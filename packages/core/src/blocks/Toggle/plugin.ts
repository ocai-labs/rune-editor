// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { Extension } from "@tiptap/core"
import { Plugin, PluginKey, Selection, TextSelection } from "@tiptap/pm/state"
import type { EditorState } from "@tiptap/pm/state"
import { Decoration, DecorationSet } from "@tiptap/pm/view"
import {
  caretBlockBefore,
  caretBlockDepth,
  findCollapsedToggleContaining,
  surfacePrevBlockStart,
  toggleBodyRange,
  togglePosById,
} from "./range"

export const toggleBodyKey = new PluginKey("rune-toggle-body")

const EMPTY_PLACEHOLDER_DEFAULT = "Empty toggle. Click to add a block."
const TITLE_PLACEHOLDER_DEFAULT = "Toggle"

export interface ToggleBodyOptions {
  emptyPlaceholder?: string
  /** Always-on hint rendered inside every empty toggle title. Unlike
   *  the generic Placeholder extension (which only paints the focused
   *  block), this stays visible on every empty toggle title regardless
   *  of caret position or editor focus — matching the empty-body
   *  widget's always-visible behavior. */
  titlePlaceholder?: string
}

function buildDecos(
  state: EditorState,
  placeholder: string,
  titlePlaceholder: string,
): DecorationSet {
  const decos: Decoration[] = []
  // Walk EVERY toggle in the document, on any surface (root, or inside a
  // `column`). `descendants` gives absolute positions; the surface-local
  // body range + the per-toggle surface comparison below keep the
  // hidden / body-marker decorations from spilling across a column
  // boundary (pitfall 2 — pure node-tree math, no editor/registry).
  state.doc.descendants((node, pos) => {
    if (node.type.name === "toggle") {
      const expanded = node.attrs.expanded !== false
      const body = toggleBodyRange(state.doc, pos)
      // The toggle's own surface (its parent node): used to scope the
      // node-level decorations to direct siblings on the SAME surface,
      // replacing the old root-only `parent === state.doc` check.
      const toggleSurface = state.doc.resolve(pos).parent

      // Always-on title placeholder for empty toggles. Mirrors the
      // shape emitted by extensions/placeholder so the same CSS in
      // packages/react/src/styles/placeholder.css applies. DEFAULT
      // placeholders in RuneEditor opts toggle out of the generic
      // Placeholder extension, so this is the only source — no double
      // widget when the toggle title is focused.
      if (node.content.size === 0) {
        const capturedPos = pos
        const capturedNode = node
        decos.push(
          Decoration.node(pos, pos + node.nodeSize, {
            class: "is-empty",
            "data-placeholder": titlePlaceholder,
            "data-placeholder-type": "toggle",
            "data-placeholder-state": "per-type",
          }),
        )
        decos.push(
          Decoration.widget(
            pos + 1,
            () => {
              const outer = document.createElement("span")
              outer.className = "rune-placeholder"
              outer.setAttribute("aria-hidden", "true")
              const inner = document.createElement("span")
              inner.className = "rune-placeholder-text"
              inner.setAttribute("contenteditable", "false")
              inner.textContent = titlePlaceholder
              outer.appendChild(inner)
              return outer
            },
            // raw + inner ce="false" keeps PM's addTextblockHacks from
            // injecting a separator img — same rationale as the generic
            // Placeholder widget (see project_pm_widget_textblock_hack).
            // Key suffix scopes the widget to this toggle pos so PM can
            // dedupe correctly across re-renders.
            {
              side: -1,
              ignoreSelection: true,
              raw: true,
              key: `rune-toggle-title-placeholder:${capturedPos}:${capturedNode.attrs.id ?? ""}`,
            } as unknown as Parameters<typeof Decoration.widget>[2],
          ),
        )
      }

      if (!expanded && !body.isEmpty) {
        state.doc.nodesBetween(body.from, body.to, (n, p, parent) => {
          if (parent === toggleSurface) {
            decos.push(
              Decoration.node(p, p + n.nodeSize, {
                style: "display: none",
                "data-rune-hidden": "1",
              }),
            )
            // A surface-direct body block: don't descend into it.
            return false
          }
          // Otherwise keep descending — the body range may sit inside a
          // structural node (a `column`), so we must walk down to reach
          // the toggle's surface-direct siblings.
          return true
        })
      }

      if (expanded && !body.isEmpty) {
        const toggleDepth = (node.attrs.depth as number | undefined) ?? 0
        state.doc.nodesBetween(body.from, body.to, (n, p, parent) => {
          if (parent === toggleSurface) {
            const childDepth = (n.attrs.depth as number | undefined) ?? 0
            if (childDepth === toggleDepth + 1) {
              decos.push(
                Decoration.node(p, p + n.nodeSize, {
                  "data-rune-toggle-body": "1",
                }),
              )
            }
            // A surface-direct block: handled (marked or not); stop here.
            return false
          }
          // Keep descending to reach the toggle's surface (e.g. through a
          // `column`).
          return true
        })
      }

      if (expanded && body.isEmpty) {
        const widgetPos = pos + node.nodeSize
        const capturedTogglePos = pos
        decos.push(
          Decoration.widget(
            widgetPos,
            (view) => {
              // Use a <div role="button"> rather than a real <button>: clicking a
              // <button> moves native focus to it, blurring the editor. Even with
              // mousedown.preventDefault(), the focus shift + DOMObserver flush can
              // race against our programmatic TextSelection and require a second
              // click to land the caret (see project_pm_dom_observer_overrides_custom_selection).
              const btn = document.createElement("div")
              btn.setAttribute("role", "button")
              btn.setAttribute("tabindex", "-1")
              btn.className = "rune-toggle-empty"
              btn.setAttribute("contenteditable", "false")
              btn.textContent = placeholder
              btn.dataset.runeTogglePos = String(capturedTogglePos)
              // Drive the action from mousedown — that way the editor never loses
              // focus and we set the new TextSelection in the same tick. preventDefault
              // also blocks the browser's native caret/focus shift before it can
              // race the DOMObserver.
              btn.addEventListener("mousedown", (e) => {
                e.preventDefault()
                e.stopPropagation()
                const togglePos = Number(btn.dataset.runeTogglePos)
                const toggle = view.state.doc.nodeAt(togglePos)
                if (!toggle || toggle.type.name !== "toggle") return
                const paraType = view.state.schema.nodes["paragraph"]
                if (!paraType) return
                const para = paraType.createAndFill({
                  depth: ((toggle.attrs.depth as number) ?? 0) + 1,
                })
                if (!para) return
                const insertAt = togglePos + toggle.nodeSize
                const tr = view.state.tr.insert(insertAt, para)
                tr.setSelection(TextSelection.create(tr.doc, insertAt + 1))
                view.dispatch(tr)
                view.focus()
              })
              // Swallow the trailing click so any ancestor handler doesn't re-act.
              btn.addEventListener("click", (e) => {
                e.preventDefault()
                e.stopPropagation()
              })
              return btn
            },
            // side:1 → widget sorts AFTER the toggle. raw avoids the
            // Safari ProseMirror-separator hack on textblock-final widgets
            // (project_pm_widget_textblock_hack).
            { side: 1, ignoreSelection: true, raw: true } as unknown as Parameters<typeof Decoration.widget>[2],
          ),
        )
      }
    }
    // Keep descending so toggles in plugin-provided structural surfaces are
    // also decorated.
    return true
  })
  return DecorationSet.create(state.doc, decos)
}

export const ToggleBodyPlugin = Extension.create<ToggleBodyOptions>({
  name: "toggleBody",
  addOptions() {
    return {
      emptyPlaceholder: EMPTY_PLACEHOLDER_DEFAULT,
      titlePlaceholder: TITLE_PLACEHOLDER_DEFAULT,
    }
  },
  addProseMirrorPlugins() {
    const placeholder = this.options.emptyPlaceholder ?? EMPTY_PLACEHOLDER_DEFAULT
    const titlePlaceholder = this.options.titlePlaceholder ?? TITLE_PLACEHOLDER_DEFAULT
    return [
      new Plugin({
        key: toggleBodyKey,
        state: {
          init: (_, state) => buildDecos(state, placeholder, titlePlaceholder),
          apply(tr, old, _oldState, newState) {
            if (!tr.docChanged) return old
            return buildDecos(newState, placeholder, titlePlaceholder)
          },
        },
        props: {
          decorations(state) {
            return toggleBodyKey.getState(state) ?? DecorationSet.empty
          },
          handleDOMEvents: {
            click(view, event) {
              const target = event.target as HTMLElement | null
              const caret = target?.closest?.(".rune-toggle-caret") as HTMLElement | null
              if (!caret) return false
              const blockEl = caret.closest(".rune-block.rune-toggle") as HTMLElement | null
              if (!blockEl) return false
              const id = blockEl.getAttribute("data-id")
              if (!id) return false
              const togglePos = togglePosById(view.state.doc, id)
              if (togglePos < 0) return false
              const node = view.state.doc.nodeAt(togglePos)
              if (!node || node.type.name !== "toggle") return false
              const next = !(node.attrs.expanded !== false)
              const tr = view.state.tr
                .setNodeAttribute(togglePos, "expanded", next)
                .setMeta("addToHistory", false)
              view.dispatch(tr)
              return true
            },
          },
          handleKeyDown(view, event) {
            const { state } = view
            const { $from } = state.selection
            if (!state.selection.empty) return false

            if (event.key === "ArrowDown") {
              // The caret's containing block — depth 1 at root, depth 3 inside
              // a `column`. Surface-aware: never hardcode node(1).
              const block = $from.node(caretBlockDepth($from))
              if (!block) return false
              if (block.type.name === "toggle" && block.attrs.expanded === false) {
                // Only redirect when caret is at end of the title.
                if ($from.parentOffset === block.content.size) {
                  const togglePos = caretBlockBefore($from)
                  const body = toggleBodyRange(state.doc, togglePos)
                  const landingPos = togglePos + block.nodeSize + (body.to - body.from)
                  // Land only while still on the toggle's OWN surface. At root
                  // `$from.end(0)` is `doc.content.size` (the old guard);
                  // inside a column it is the column's inner end — when the
                  // hidden body is the column's last block, `landingPos`
                  // points at the column boundary (not inline content), so
                  // fall through and let the browser's default ArrowDown skip
                  // the display:none lines instead.
                  const surfaceEnd = $from.end(caretBlockDepth($from) - 1)
                  if (landingPos < surfaceEnd) {
                    // +1 steps past the node boundary; Selection.near resolves to the
                    // nearest valid cursor pos — handles the case where the next block
                    // after the hidden body is a structural plugin node
                    // rather than a textblock, where raw TextSelection.create would
                    // produce a non-text-position selection (console warning + wrong caret).
                    view.dispatch(
                      state.tr.setSelection(
                        Selection.near(state.doc.resolve(landingPos + 1)),
                      ),
                    )
                    event.preventDefault()
                    return true
                  }
                }
              }
            }

            if (event.key === "ArrowUp") {
              if ($from.parentOffset !== 0) return false
              // Surface-local previous sibling start — root or column-local.
              const prevPos = surfacePrevBlockStart($from)
              if (prevPos < 0) return false
              const owner = findCollapsedToggleContaining(state.doc, prevPos)
              if (owner) {
                const titleEndPos = owner.pos + 1 + owner.node.content.size
                view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, titleEndPos)))
                event.preventDefault()
                return true
              }
            }

            if (event.key === "Backspace") {
              if ($from.parentOffset !== 0) return false
              // Surface-local previous sibling start — root or column-local.
              const prevPos = surfacePrevBlockStart($from)
              if (prevPos < 0) return false
              const owner = findCollapsedToggleContaining(state.doc, prevPos)
              if (owner) {
                const titleEndPos = owner.pos + 1 + owner.node.content.size
                view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, titleEndPos)))
                event.preventDefault()
                return true
              }
            }

            if (event.key === "Enter" && !event.shiftKey) {
              const block = $from.node(caretBlockDepth($from))
              if (block && block.type.name === "toggle") {
                const expanded = block.attrs.expanded !== false
                if (expanded && $from.parentOffset === block.content.size) {
                  const togglePos = caretBlockBefore($from)
                  const body = toggleBodyRange(state.doc, togglePos)
                  if (body.isEmpty) {
                    const para = state.schema.nodes["paragraph"]?.createAndFill({
                      depth: ((block.attrs.depth as number) ?? 0) + 1,
                    })
                    if (!para) return false
                    const insertAt = togglePos + block.nodeSize
                    const tr = state.tr.insert(insertAt, para)
                    tr.setSelection(TextSelection.create(tr.doc, insertAt + 1))
                    view.dispatch(tr)
                    event.preventDefault()
                    return true
                  }
                }
              }
            }

            return false
          },
        },
      }),
    ]
  },
})
