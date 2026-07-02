// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Central inline-mark markdown contract. One table maps a mark's name to how
// it serializes into rune's styling-aware markdown dialect. `serializeInline`
// dispatches to it, and a later task derives the scoped-parser tag/attr
// whitelist from the `html` metadata so the read surface and the write surface
// stay a matched pair (see internal design notes).
//
// Adding a mark to the vocabulary is now a one-entry change here — the same
// registry-driven shape the block level already has (`specs[type].toMarkdown`).
// Marks with no entry (e.g. `internalRef`) pass their text through unwrapped;
// that is a *declared* lossy case, handled by the serializer, not an error.

import type { Mark } from "@tiptap/pm/model"

/** A raw-HTML tag this contract emits, for deriving a parser whitelist. */
export interface MarkHtmlEmission {
  tag: string
  attrs: string[]
}

export interface MarkInlineContract {
  /** Wrap already-serialized inner markdown with this mark's syntax. */
  serialize: (inner: string, mark: Mark) => string
  /**
   * Raw-HTML tags/attrs this contract emits (only marks with no native
   * markdown syntax need this). Consumed later to build the scoped AI parser's
   * sanitizer whitelist — the read dialect and the write dialect derive from
   * the same table.
   */
  html?: MarkHtmlEmission[]
}

/** Link href keeps only paren-escaping; the general text escaper (in the
 * serializer) handles everything else, including bracket-escaping the link
 * TEXT before it reaches this contract. */
function escapeLinkHref(href: string): string {
  return href.replace(/[()]/g, (ch) => `\\${ch}`)
}

export const markInlineContract: Record<string, MarkInlineContract> = {
  bold: { serialize: (inner) => `**${inner}**` },
  italic: { serialize: (inner) => `*${inner}*` },
  strike: { serialize: (inner) => `~~${inner}~~` },

  // Backticks, with the double-backtick fallback when the content itself
  // contains a backtick (padded with spaces per CommonMark's rule).
  code: {
    serialize: (inner) =>
      inner.includes("`") ? `\`\` ${inner} \`\`` : `\`${inner}\``,
  },

  link: {
    serialize: (inner, mark) =>
      `[${inner}](${escapeLinkHref(mark.attrs.href as string)})`,
  },

  // `[[target]]` when the display text equals the target, `[[target|text]]`
  // otherwise. wikiLink content is a verbatim sub-grammar, so the serializer
  // does NOT escape its runs (see VERBATIM_MARKS) — `inner` here is the raw
  // display text, which the target comparison relies on.
  wikiLink: {
    serialize: (inner, mark) => {
      const target = mark.attrs.target as string
      return target === inner ? `[[${target}]]` : `[[${target}|${inner}]]`
    },
  },

  underline: {
    serialize: (inner) => `<u>${inner}</u>`,
    html: [{ tag: "u", attrs: [] }],
  },

  // One <span> carrying whichever inline color attrs are set. The attr names
  // (`data-text-color` / `data-background-color`) are exactly what rune's
  // parseDOM already accepts (see extensions/color), so the model writes the
  // same span it reads. If neither color is set the mark carries no style —
  // emit no wrapper.
  textStyle: {
    serialize: (inner, mark) => {
      const attrs: string[] = []
      const textColor = mark.attrs.textColor
      const backgroundColor = mark.attrs.backgroundColor
      if (typeof textColor === "string")
        attrs.push(`data-text-color="${textColor}"`)
      if (typeof backgroundColor === "string")
        attrs.push(`data-background-color="${backgroundColor}"`)
      if (attrs.length === 0) return inner
      return `<span ${attrs.join(" ")}>${inner}</span>`
    },
    html: [
      { tag: "span", attrs: ["data-text-color", "data-background-color"] },
    ],
  },
}
