// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import {
  Mark,
  mergeAttributes,
} from "@tiptap/core"
import { Plugin } from "@tiptap/pm/state"
import {
  addMarkToAllowedInlineSelection,
  createRefDecorationPlugin,
  escapeCssString,
} from "../entity-refs"
import { createLabelSyncPlugin } from "./labelSyncPlugin"

export type InternalRefKind = "page" | "block" | (string & {})

export interface InternalRefAttrs {
  kind: InternalRefKind
  target: string
  /**
   * When true, the visible text was deliberately authored as an alias
   * (e.g. `[[Target|Alias]]` syntax or an explicit alias via `commitWikiLink`).
   * The labelSync plugin skips rewriting aliased runs — the author's chosen
   * text overrides whatever `resolve().displayText` returns. The broken-target
   * decoration still fires; only the text rewrite is suppressed.
   */
  alias?: boolean
}

export interface InternalRefResolveResult {
  displayText?: string
  title?: string
  icon?: string
  iconText?: string
  broken?: boolean
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    internalRef: {
      setInternalRef: (attrs: InternalRefAttrs) => ReturnType
      unsetInternalRef: () => ReturnType
      toggleInternalRef: (attrs: InternalRefAttrs) => ReturnType
    }
  }
}

export interface InternalRefOptions {
  onClick?: (attrs: InternalRefAttrs, event: MouseEvent) => void
  onHover?: (attrs: InternalRefAttrs, event: MouseEvent, rect: DOMRect) => void
  onHoverEnd?: (attrs: InternalRefAttrs, event: MouseEvent) => void
  isBroken?: (attrs: InternalRefAttrs) => boolean
  resolve?: (attrs: InternalRefAttrs) => InternalRefResolveResult | null
  renderAttrs?: (attrs: InternalRefAttrs) => Record<string, unknown>
  /**
   * When true AND `resolve` is provided, the mark's visible text is kept
   * in sync with `resolve().displayText` via an `addToHistory: false`
   * appendTransaction — Notion's live-label model. Re-runs on every doc
   * change and on `refreshEntityRefs("internalRef")`; call the latter
   * after your title cache mutates. `resolve` must stay synchronous and
   * O(1); returning `null` (or an empty/absent `displayText`) leaves the
   * on-doc text untouched — that text IS the cached fallback for deleted
   * or not-yet-loaded targets.
   *
   * Off by default: every enabled client rewrites labels into the shared
   * doc, which is churn in collab setups. Collab apps should enable it on
   * exactly one authority client or leave it off. See
   * internal design notes.
   */
  syncLabel?: boolean
  HTMLAttributes: Record<string, unknown>
}

const RESERVED_RENDER_ATTRIBUTES = new Set([
  "data-rune-ref-kind",
  "data-rune-ref-target",
  "href",
  "role",
  "tabindex",
])

function validAttrs(attrs: InternalRefAttrs): boolean {
  return !!attrs.kind && !!attrs.target
}

function internalRefDecorationAttrs({
  attrs,
  isBroken,
  resolve,
}: {
  attrs: InternalRefAttrs
  isBroken?: InternalRefOptions["isBroken"]
  resolve?: InternalRefOptions["resolve"]
}) {
  const meta = resolve?.(attrs) ?? null
  const broken = isBroken?.(attrs) === true || meta?.broken === true
  const out: Record<string, string> = {}

  if (broken) out["data-broken"] = "true"
  if (meta?.title) {
    out["data-title"] = meta.title
    out.title = meta.title
  }
  if (meta?.iconText) {
    out.style = `--rune-wikilink-icon-text: '${escapeCssString(meta.iconText)}';`
  } else if (meta?.icon) {
    out.style = `--rune-wikilink-icon-image: url('${escapeCssString(meta.icon)}');`
  }

  return Object.keys(out).length > 0 ? out : null
}

function parseInternalRefElement(node: HTMLElement): InternalRefAttrs | false {
  const kind = node.getAttribute("data-rune-ref-kind") ?? ""
  const target = node.getAttribute("data-rune-ref-target") ?? ""
  if (!kind || !target) return false
  const alias = node.getAttribute("data-rune-ref-alias") === "true" ? true : undefined
  return { kind, target, ...(alias ? { alias } : {}) }
}

/** `<mention-page>` / `<mention-block>` — the Notion-mention-style raw-HTML
 * shape `markInlineContract`'s `internalRef` entry serializes `kind: "page" |
 * "block"` into (api/export/markInlineContract.ts). Returns the
 * `InternalRefKind` the tag name implies, or `null` for any other tag
 * (including the editor's own `<a data-rune-ref-*>` DOM shape, which
 * `parseInternalRefElement` above handles). */
function mentionKindFromTag(tagName: string): InternalRefKind | null {
  const tag = tagName.toLowerCase()
  if (tag === "mention-page") return "page"
  if (tag === "mention-block") return "block"
  return null
}

/** Parse `<mention-page id="…">` / `<mention-block id="…">` — the AI-markdown
 * mention shape. `false` (dropped mark, inner text preserved) for a
 * missing/empty `id`, mirroring `parseInternalRefElement`'s empty-attr
 * rejection above; a hand-authored `<mention-foo>` never reaches this
 * function at all (no `parseHTML` rule below matches its tag). */
function parseMentionElement(node: HTMLElement): InternalRefAttrs | false {
  const kind = mentionKindFromTag(node.tagName)
  if (!kind) return false
  const target = node.getAttribute("id") ?? ""
  if (!target) return false
  const alias = node.getAttribute("alias") === "true" ? true : undefined
  return { kind, target, ...(alias ? { alias } : {}) }
}

export const InternalRef = Mark.create<InternalRefOptions>({
  name: "internalRef",

  inclusive: false,

  addOptions() {
    return {
      onClick: undefined,
      onHover: undefined,
      onHoverEnd: undefined,
      isBroken: undefined,
      resolve: undefined,
      renderAttrs: undefined,
      syncLabel: false,
      HTMLAttributes: {},
    }
  },

  // Tiptap calls EVERY attribute's own `parseHTML` against whatever node
  // matched below, regardless of which `parseHTML()` rule matched it or what
  // that rule's `getAttrs` returned (`injectExtensionAttributesToParseRule`
  // in @tiptap/core spreads the per-attribute results OVER the rule's own —
  // last writer wins). So each attribute here must independently recognize
  // BOTH DOM shapes (the editor's `<a data-rune-ref-*>` round-trip shape and
  // the AI-markdown `<mention-page>`/`<mention-block>` shape) or the mention
  // rule's correctly-parsed attrs would get silently clobbered back to this
  // shape's defaults.
  addAttributes() {
    return {
      kind: {
        default: "page",
        parseHTML: (element) =>
          element.getAttribute("data-rune-ref-kind") ??
          mentionKindFromTag(element.tagName) ??
          "page",
        renderHTML: (attributes) => {
          const kind = attributes.kind
          return typeof kind === "string" && kind ? { "data-rune-ref-kind": kind } : {}
        },
      },
      target: {
        default: "",
        parseHTML: (element) => {
          const dataTarget = element.getAttribute("data-rune-ref-target")
          if (dataTarget != null) return dataTarget
          if (!mentionKindFromTag(element.tagName)) return ""
          return element.getAttribute("id") ?? ""
        },
        renderHTML: (attributes) => {
          const target = attributes.target
          return typeof target === "string" && target
            ? { "data-rune-ref-target": target }
            : {}
        },
      },
      alias: {
        default: false,
        parseHTML: (element) => {
          if (element.hasAttribute("data-rune-ref-alias")) {
            return element.getAttribute("data-rune-ref-alias") === "true"
          }
          if (!mentionKindFromTag(element.tagName)) return false
          return element.getAttribute("alias") === "true"
        },
        renderHTML: (attributes) =>
          attributes.alias === true ? { "data-rune-ref-alias": "true" } : {},
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: "a[data-rune-ref-kind][data-rune-ref-target]",
        getAttrs: parseInternalRefElement,
      },
      {
        tag: "mention-page[id]",
        getAttrs: parseMentionElement,
      },
      {
        tag: "mention-block[id]",
        getAttrs: parseMentionElement,
      },
    ]
  },

  addCommands() {
    return {
      setInternalRef:
        (attrs) =>
        ({ commands, tr, state }) => {
          if (!validAttrs(attrs)) {
            tr.setMeta("preventDispatch", true)
            return false
          }
          if (!tr.selection.empty) {
            const markType = state.schema.marks[this.name]
            if (!markType) return false
            return addMarkToAllowedInlineSelection(tr, markType, { ...attrs })
          }
          return commands.setMark(this.name, attrs)
        },
      unsetInternalRef:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
      toggleInternalRef:
        (attrs) =>
        ({ commands, tr }) => {
          if (!validAttrs(attrs)) {
            tr.setMeta("preventDispatch", true)
            return false
          }
          return commands.toggleMark(this.name, attrs)
        },
    }
  },

  addProseMirrorPlugins() {
    const findInternalRefAnchor = (
      eventTarget: EventTarget | null,
    ): { anchor: HTMLElement; attrs: InternalRefAttrs } | null => {
      if (!(eventTarget instanceof Element)) return null
      const anchor = eventTarget.closest(
        "a[data-rune-ref-kind][data-rune-ref-target]",
      )
      if (!(anchor instanceof HTMLElement)) return null
      const attrs = parseInternalRefElement(anchor)
      if (!attrs) return null
      return { anchor, attrs }
    }

    const plugins = [
      createRefDecorationPlugin<InternalRefAttrs>({
        refType: "internalRef",
        markName: this.name,
        getKey: (attrs) => `${attrs.kind}:${attrs.target}`,
        deriveAttrs: (attrs) =>
          internalRefDecorationAttrs({
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

            const { kind, target } = mark.attrs
            if (typeof kind !== "string" || typeof target !== "string") return false

            this.options.onClick?.({ kind, target }, event)
            return false
          },
          handleDOMEvents: {
            mouseover: (_view, event) => {
              const hit = findInternalRefAnchor(event.target)
              if (!hit) return false
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
              const hit = findInternalRefAnchor(event.target)
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

    if (this.options.syncLabel && this.options.resolve) {
      plugins.push(
        createLabelSyncPlugin({
          markName: this.name,
          refType: "internalRef",
          resolve: (attrs) => this.options.resolve?.(attrs) ?? null,
        }),
      )
    }

    return plugins
  },

  renderHTML({ mark, HTMLAttributes }) {
    const attrs = mark.attrs as InternalRefAttrs
    const decoration = this.options.renderAttrs?.(attrs) ?? {}
    const attributes = mergeAttributes(
      {
        class: "rune-wikilink rune-ref",
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
    if (attrs.kind) attributes["data-rune-ref-kind"] = attrs.kind
    if (attrs.target) attributes["data-rune-ref-target"] = attrs.target

    return ["a", attributes, 0]
  },
})
