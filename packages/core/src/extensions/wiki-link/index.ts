// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import {
  InputRule,
  Mark,
  PasteRule,
  type ExtendedRegExpMatchArray,
  type Range,
  mergeAttributes,
} from "@tiptap/core"
import { Plugin, type EditorState } from "@tiptap/pm/state"
import {
  addMarkToAllowedInlineSelection,
  createRefDecorationPlugin,
  escapeCssString,
} from "../entity-refs"

export type WikiLinkAttrs = { target: string }

export const WIKI_LINK_INPUT_RULE_RE = /\[\[([^\[\]\|]+)(?:\|([^\[\]]*))?\]\]$/
export const WIKI_LINK_PASTE_RULE_RE = /\[\[([^\[\]\|]+)(?:\|([^\[\]]*))?\]\]/g

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    wikiLink: {
      setWikiLink: (attrs: WikiLinkAttrs) => ReturnType
      unsetWikiLink: () => ReturnType
      toggleWikiLink: (attrs: WikiLinkAttrs) => ReturnType
    }
  }
}

export interface WikiLinkOptions {
  onClick?: (attrs: WikiLinkAttrs, event: MouseEvent) => void
  onHover?: (attrs: WikiLinkAttrs, event: MouseEvent, rect: DOMRect) => void
  onHoverEnd?: (attrs: WikiLinkAttrs, event: MouseEvent) => void
  transformTarget?: (rawTarget: string) => string
  isBroken?: (attrs: WikiLinkAttrs) => boolean
  /**
   * Per-link metadata. `icon` is a URL / data-URL string rendered as a
   * mono-color silhouette via `mask-image` (font-icon style). `iconText` is
   * a glyph (emoji, single unicode char, short logo string) rendered as
   * CSS `content` and keeps its native color — use this for emoji page
   * icons. If both are returned, `iconText` wins.
   */
  resolve?: (
    attrs: WikiLinkAttrs,
  ) => { title?: string; icon?: string; iconText?: string } | null
  /**
   * Return per-instance HTML attributes (typically inline `style` carrying
   * CSS variable overrides like `--rune-wikilink-icon-image`) computed from
   * the mark's `target`. Consumers close over their own data store to map
   * `target → page metadata → icon` without polluting the editor's doc state.
   * Reserved attributes (`href`, `role`, `tabindex`, `data-wikilink`) are
   * stripped — they can't be spoofed through this hook.
   */
  renderAttrs?: (attrs: WikiLinkAttrs) => Record<string, unknown>
  HTMLAttributes: Record<string, unknown>
}

const RESERVED_RENDER_ATTRIBUTES = new Set([
  "data-wikilink",
  "href",
  "role",
  "tabindex",
])

function wikiLinkDecorationAttrs({
  attrs,
  isBroken,
  resolve,
}: {
  attrs: WikiLinkAttrs
  isBroken?: WikiLinkOptions["isBroken"]
  resolve?: WikiLinkOptions["resolve"]
}) {
  const broken = isBroken?.(attrs) === true
  const meta = resolve?.(attrs) ?? null
  const out: Record<string, string> = {}

  if (broken) out["data-broken"] = "true"
  if (meta?.title) {
    out["data-title"] = meta.title
    out.title = meta.title
  }
  // `iconText` wins over `icon` — text variant uses CSS `content` and
  // bypasses the mono-mask path, so emitting both would let the mask
  // selector also match and double-render. Single slot per instance.
  if (meta?.iconText) {
    out.style = `--rune-wikilink-icon-text: '${escapeCssString(meta.iconText)}';`
  } else if (meta?.icon) {
    out.style = `--rune-wikilink-icon-image: url('${escapeCssString(meta.icon)}');`
  }

  return Object.keys(out).length > 0 ? out : null
}

function applyWikiLinkRule({
  state,
  range,
  match,
  markName,
  transformTarget,
}: {
  state: EditorState
  range: Range
  match: ExtendedRegExpMatchArray
  markName: string
  transformTarget?: WikiLinkOptions["transformTarget"]
}) {
  const rawTarget = match[1] ?? ""
  const alias = match[2] ?? ""
  if (!rawTarget) return null

  const transformed = transformTarget?.(rawTarget)
  const target =
    typeof transformed === "string" && transformed.length > 0 ? transformed : rawTarget
  const text = alias.length > 0 ? alias : rawTarget
  const internalRefType = state.schema.marks.internalRef
  const markType = internalRefType ?? state.schema.marks[markName]
  if (!markType) return null
  // Only set alias:true when a non-empty alias was explicitly typed.
  // Empty alias ([[Foo|]]) falls back to rawTarget as display text — not an alias.
  const hasAlias = alias.length > 0
  const attrs = internalRefType
    ? { kind: "page", target, ...(hasAlias ? { alias: true } : {}) }
    : { target }

  state.tr
    .replaceRangeWith(range.from, range.to, state.schema.text(text))
    .addMark(range.from, range.from + text.length, markType.create(attrs))
}

export const WikiLink = Mark.create<WikiLinkOptions>({
  name: "wikiLink",

  inclusive: false,

  addOptions() {
    return {
      onClick: undefined,
      onHover: undefined,
      onHoverEnd: undefined,
      transformTarget: undefined,
      isBroken: undefined,
      resolve: undefined,
      renderAttrs: undefined,
      HTMLAttributes: {},
    }
  },

  addAttributes() {
    return {
      target: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-wikilink") ?? "",
        renderHTML: (attributes) => {
          if (!attributes.target) return {}
          return { "data-wikilink": attributes.target }
        },
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: "a[data-wikilink]",
        getAttrs: (node) => {
          const target = node.getAttribute("data-wikilink")
          if (!target) return false
          return { target }
        },
      },
    ]
  },

  addCommands() {
    return {
      setWikiLink:
        (attrs) =>
        ({ commands, tr, state }) => {
          if (!attrs.target) {
            // Tiptap dispatches the accumulated tr even when the command
            // body returns false (see @tiptap/core CommandManager — only
            // tr.setMeta("preventDispatch", true) actually suppresses it).
            // Without this, empty-target invocations would still bump the
            // editor's transaction stream with a no-op tr.
            tr.setMeta("preventDispatch", true)
            return false
          }
          if (!tr.selection.empty) {
            const markType = state.schema.marks[this.name]
            if (!markType) return false

            return addMarkToAllowedInlineSelection(
              tr,
              markType,
              attrs,
            )
          }
          return commands.setMark(this.name, attrs)
        },
      unsetWikiLink:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
      toggleWikiLink:
        (attrs) =>
        ({ commands, tr }) => {
          if (!attrs.target) {
            tr.setMeta("preventDispatch", true)
            return false
          }
          return commands.toggleMark(this.name, attrs)
        },
    }
  },

  addInputRules() {
    return [
      new InputRule({
        find: WIKI_LINK_INPUT_RULE_RE,
        handler: ({ state, range, match }) =>
          applyWikiLinkRule({
            state,
            range,
            match,
            markName: this.name,
            transformTarget: this.options.transformTarget,
          }),
      }),
    ]
  },

  addPasteRules() {
    return [
      new PasteRule({
        find: WIKI_LINK_PASTE_RULE_RE,
        handler: ({ state, range, match }) =>
          applyWikiLinkRule({
            state,
            range,
            match,
            markName: this.name,
            transformTarget: this.options.transformTarget,
          }),
      }),
    ]
  },

  addProseMirrorPlugins() {
    const findWikiLinkAnchor = (
      eventTarget: EventTarget | null,
    ): { anchor: HTMLElement; attrs: WikiLinkAttrs } | null => {
      if (!(eventTarget instanceof Element)) return null
      const anchor = eventTarget.closest("a[data-wikilink]")
      if (!(anchor instanceof HTMLElement)) return null
      const target = anchor.getAttribute("data-wikilink")
      if (!target) return null
      return { anchor, attrs: { target } }
    }

    return [
      createRefDecorationPlugin<WikiLinkAttrs>({
        refType: "wikiLink",
        markName: this.name,
        getKey: (attrs) => attrs.target,
        deriveAttrs: (attrs) =>
          wikiLinkDecorationAttrs({
            attrs,
            isBroken: this.options.isBroken,
            resolve: this.options.resolve,
          }),
      }),
      new Plugin({
        props: {
          handleClickOn: (view, pos, node, _nodePos, event, direct) => {
            if (!direct) return false

            const directMark = node.marks.find((mark) => mark.type.name === this.name)
            const nodeAtMark = view.state.doc
              .nodeAt(pos)
              ?.marks.find((mark) => mark.type.name === this.name)
            const resolvedMark = view.state.doc
              .resolve(pos)
              .marks()
              .find((mark) => mark.type.name === this.name)
            const mark = directMark ?? nodeAtMark ?? resolvedMark
            if (!mark) return false

            const { target } = mark.attrs
            if (typeof target !== "string") return false

            this.options.onClick?.({ target }, event)
            return false
          },
          handleDOMEvents: {
            mouseover: (_view, event) => {
              const hit = findWikiLinkAnchor(event.target)
              if (!hit) return false
              // Skip moves that originate inside the same anchor — descendant
              // marks (e.g. bold-inside-wiki) emit mouseover on transitions
              // and we only care about boundary crossings.
              const related = (event as MouseEvent).relatedTarget
              if (related instanceof Node && hit.anchor.contains(related)) {
                return false
              }
              this.options.onHover?.(
                hit.attrs,
                event as MouseEvent,
                hit.anchor.getBoundingClientRect(),
              )
              return false
            },
            mouseout: (_view, event) => {
              const hit = findWikiLinkAnchor(event.target)
              if (!hit) return false
              const related = (event as MouseEvent).relatedTarget
              if (related instanceof Node && hit.anchor.contains(related)) {
                return false
              }
              this.options.onHoverEnd?.(hit.attrs, event as MouseEvent)
              return false
            },
          },
        },
      }),
    ]
  },

  renderHTML({ mark, HTMLAttributes }) {
    const decoration =
      this.options.renderAttrs?.(mark.attrs as WikiLinkAttrs) ?? {}
    const attributes = mergeAttributes(
      {
        class: "rune-wikilink",
      },
      this.options.HTMLAttributes,
      HTMLAttributes,
      decoration,
    )
    for (const key of Object.keys(attributes)) {
      if (RESERVED_RENDER_ATTRIBUTES.has(key.toLowerCase())) {
        delete attributes[key]
      }
    }
    attributes.role = "link"
    if (mark.attrs.target) {
      attributes["data-wikilink"] = mark.attrs.target
    }

    return [
      "a",
      attributes,
      0,
    ]
  },
})
