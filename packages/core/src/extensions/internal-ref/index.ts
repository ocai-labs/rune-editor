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

  addAttributes() {
    return {
      kind: {
        default: "page",
        parseHTML: (element) =>
          element.getAttribute("data-rune-ref-kind") ?? "page",
        renderHTML: (attributes) => {
          const kind = attributes.kind
          return typeof kind === "string" && kind ? { "data-rune-ref-kind": kind } : {}
        },
      },
      target: {
        default: "",
        parseHTML: (element) =>
          element.getAttribute("data-rune-ref-target") ?? "",
        renderHTML: (attributes) => {
          const target = attributes.target
          return typeof target === "string" && target
            ? { "data-rune-ref-target": target }
            : {}
        },
      },
      alias: {
        default: false,
        parseHTML: (element) =>
          element.getAttribute("data-rune-ref-alias") === "true" ? true : false,
        renderHTML: (attributes) =>
          attributes.alias === true ? { "data-rune-ref-alias": "true" } : {},
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: "a[data-rune-ref-kind][data-rune-ref-target]",
        getAttrs: (node) =>
          node instanceof HTMLElement ? parseInternalRefElement(node) : false,
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
