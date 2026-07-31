// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { createBlockSpec } from "../../schema"
import type { RuneBlockBase } from "../../types"

/**
 * What the source region was, before it fell through to the raw carrier.
 *
 * A CLOSED set on purpose. rune-react surfaces the label through `attr()`, and a
 * closed vocabulary written by the codec is what makes that safe — an open string
 * would put decoded document text into a CSS value.
 */
export type RuneRawOrigin = "html" | "footnote" | "table" | "markdown"

const ORIGINS: readonly RuneRawOrigin[] = ["html", "footnote", "table", "markdown"]

/** Shown by rune-react's `::before`; kept here so the vocabulary has one home. */
const LABELS: Record<RuneRawOrigin, string> = {
  html: "HTML · kept as written",
  footnote: "Footnote · kept as written",
  // Not "malformed": GFM explicitly allows body rows that differ from the
  // header's width (it pads short rows and drops extra cells). These tables are
  // legal — they are just not something rune's fixed-width table can hold
  // without changing the author's bytes.
  table: "Non-rectangular table · kept as written",
  // A construct that IS markdown but has no rune node — a link definition, an
  // MDX export. Calling these "HTML" was simply a lie in the UI.
  markdown: "Markdown · kept as written",
}

const isOrigin = (value: unknown): value is RuneRawOrigin =>
  typeof value === "string" && (ORIGINS as readonly string[]).includes(value)

const sourceOf = (attrs: Record<string, unknown>): string =>
  typeof attrs.source === "string" ? attrs.source : ""

/**
 * RawBlock — a lossless carrier for a block of source markdown that has no PM
 * representation. Its whole job is to make "unclaimed source keeps its original
 * bytes" true, which is the fifth gate assertion in
 * docs/2026-07-30-storage-fidelity-gate-and-fix-plan.md §4.1.
 *
 * The source is DISPLAYED, never rendered. This is a hard invariant, not a
 * v1 shortcut: activating the HTML would turn every note into an injection
 * surface, and it is unrelated to the reason the block exists (keeping bytes).
 * Every path out of this block therefore goes through a text node —
 * `renderDOM` nests the string as a text child, `clipboardRenderDOM` does the
 * same, and nothing writes `innerHTML` or builds an attribute out of it.
 *
 * `maxDepth: 0` is decision D13. A raw block cannot be indented or dragged into
 * a list, because serialization derives list indentation and `>` prefixes from
 * `depth` — so "movable into a container" and "original bytes" are contradictory
 * requirements. Table and Divider already take the same position for the same
 * kind of reason.
 *
 * It deliberately has NO slash-menu entry: it is a decoder artefact, not
 * something a user creates. It arrives from `convert.ts` when a source block
 * has nowhere else to go.
 */
export const RawBlock = createBlockSpec({
  type: "rawBlock",
  content: "",
  indent: { mode: "numeric", maxDepth: 0 },
  meta: { defining: false },
  props: {
    /** The original source bytes, verbatim. */
    source: {
      default: "",
      parseHTML: (el: HTMLElement) => el.textContent ?? "",
      // Carried as the element's TEXT, never as an attribute — see the
      // display-not-render invariant above.
      renderHTML: () => ({}),
    },
    origin: {
      default: "html" as RuneRawOrigin,
      parseHTML: (el: HTMLElement) => {
        const raw = el.getAttribute("data-rune-raw")
        return isOrigin(raw) ? raw : "html"
      },
      // Emitted by `renderDOM` onto the <pre>, NOT here. The factory merges a
      // prop's `renderHTML` into the OUTER `.rune-block` element, and the parse
      // rule matches `pre[data-rune-raw]` — a marker on the wrapper would leave
      // the inner <pre> bare, and `getHTML()` → `setContent()` would hand it to
      // CodeBlock. Pinned by contract.test.ts.
      renderHTML: () => ({}),
    },
  },
  schemaContext: {
    input: {
      description:
        "Verbatim source that has no rune representation, preserved byte-for-byte. " +
        "Not creatable from the UI; produced by the markdown decoder.",
      examples: [{ type: "rawBlock", source: "<div>kept as written</div>" }],
    },
  },
  toRuneBlock: (node) => ({
    type: "rawBlock",
    id: typeof node.attrs.id === "string" ? node.attrs.id : "",
    depth: typeof node.attrs.depth === "number" ? node.attrs.depth : 0,
    source: sourceOf(node.attrs),
    origin: isOrigin(node.attrs.origin) ? node.attrs.origin : "html",
  }),
  fromInput: ({ schema, input, defaults }) => {
    const t = schema.nodes["rawBlock"]
    if (!t) return null
    return t.create({
      ...defaults.attrs,
      id: input.id ?? null,
      depth: input.depth ?? defaults.depth,
      source: typeof input.source === "string" ? input.source : "",
      origin: isOrigin(input.origin) ? input.origin : "html",
    })
  },
  // `pre[data-rune-raw]` must out-rank CodeBlock's bare `tag: "pre"`
  // (blocks/CodeBlock/block.ts) — without the higher priority, a raw block that
  // travelled through an app which kept only `text/html` would come back as a
  // code block, and its next save would wrap the source in ``` fences.
  parseDOM: [
    {
      tag: "pre[data-rune-raw]",
      priority: 100,
      preserveWhitespace: "full",
    },
  ],
  renderDOM: ({ node, HTMLAttributes }) => [
    "div",
    { ...HTMLAttributes, class: "rune-block" },
    [
      "pre",
      {
        class: "rune-block-content rune-raw-block",
        // The marker lives HERE, on the element the parse rule matches, so
        // `getHTML()` → `setContent()` recovers a raw block instead of losing
        // the bare <pre> to CodeBlock.
        "data-rune-raw": isOrigin(node.attrs.origin) ? node.attrs.origin : "html",
        // Read by a `::before` in rune-react so the block announces that it is
        // preserved, not interpreted. A closed set written by the codec — never
        // user source — so surfacing it through `attr()` is safe.
        "data-rune-raw-label": LABELS[
          isOrigin(node.attrs.origin) ? node.attrs.origin : "html"
        ],
      },
      sourceOf(node.attrs),
    ],
  ],
  // Chrome-free, and re-importable: the marker is what lets rune recognise its
  // own raw block on the way back in.
  clipboardRenderDOM: ({ node }) => [
    "pre",
    { "data-rune-raw": isOrigin(node.attrs.origin) ? node.attrs.origin : "html" },
    sourceOf(node.attrs),
  ],
  // Without this an atom contributes "" to the clipboard's `text/plain`
  // (extensions/clipboard/serializeBlocks.ts), so copying to a plain-text editor
  // would silently produce a blank.
  renderText: ({ node }) => sourceOf(node.attrs),
  toMarkdown({ node, prefix }) {
    const lines = sourceOf(node.attrs).split("\n")
    return { line: lines.map((l) => `${prefix}${l}`).join("\n"), spacing: "isolated" }
  },
  markdown: {
    // D13, declared once and read by both the codec and the drag path. Measured
    // before it existed: a raw block that reached depth 1 after a list owner
    // serialized INTO the item and came back as a paragraph of literal text, so
    // the next save escaped every `<`.
    flattensDepth: true,
    toMdast: (block) => ({
      type: "html",
      value: typeof block.attrs?.source === "string" ? block.attrs.source : "",
    }),
    // Deliberately declines. Claiming happens in `convert.ts`'s `case "html"`,
    // which runs AFTER every block contract has been offered the node — if this
    // joined the contract list it would enter the registration-order race and
    // could out-rank a first-class mapping (media's `<video>` / `<audio>`), so
    // the fallback would start eating nodes that already had a home.
    fromMdast: () => null,
  },
  sideMenu: { draggable: true },
})

export interface RuneRawBlock extends RuneBlockBase {
  type: "rawBlock"
  source: string
  origin: RuneRawOrigin
}
