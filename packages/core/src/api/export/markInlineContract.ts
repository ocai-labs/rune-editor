// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Central inline-mark markdown contract. One table maps a mark's name to how
// it serializes into rune's styling-aware markdown dialect. `serializeInline`
// dispatches to it, and the AI-parse sanitizer (aiMarkdownSanitizer.ts) derives
// its raw-HTML tag/attr whitelist from the `html` metadata so the read surface
// and the write surface stay a matched pair (see
// internal design notes).
//
// Adding a mark to the vocabulary is now a one-entry change here — the same
// registry-driven shape the block level already has (`specs[type].toMarkdown`).
// A mark with no entry at all passes its text through unwrapped; that is a
// *declared* lossy case, handled by the serializer, not an error. `internalRef`
// is the one ATTRS-DEPENDENT entry below: its own `serialize` falls back to
// that same unwrapped passthrough for a `kind` it doesn't recognize or an
// empty `target`, so an unrepresentable instance degrades exactly like a
// missing entry would (and still trips the lossless-edit guard in
// applyMarkdownEdits.ts).

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

/** HTML-escape an attribute value emitted by a contract (currently only
 * internalRef's mention `id`). Values ride inside a double-quoted attribute
 * in the emitted tag, so an embedded `"` MUST be escaped or it would close
 * the attribute early and corrupt the tag on re-parse; `&`/`<`/`>` are
 * escaped too so the value survives the round trip through both markdown-it's
 * html_inline tokenizer and the real DOM parser's entity decoding unchanged.
 * This module has no markdown-it dependency, so it's a tiny local copy of
 * the same four-character replacement `md.utils.escapeHtml` does. */
function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
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

  // Notion-mention-style tag, one per recognized `kind`: `<mention-page
  // id="target">label</mention-page>` (`<mention-block …>` for kind:"block").
  // `target` is opaque to rune-core for either kind — zyler's own block refs
  // pack a composite `<noteId>#<blockId>` string into it, but that structure
  // is the HOST's concern, never split or reassembled here — so the same
  // single-attribute shape covers both. `alias="true"` is emitted only when
  // true; the schema default is `false`, so omitting it on the common case
  // keeps `parse(serialize(x))` attr-for-attr identical (no synthesized
  // `alias="false"` to normalize away). An unrecognized `kind` or an empty
  // `target` returns `inner` unwrapped — the same declared-lossy passthrough
  // a mark with no contract entry gets (see the file header).
  internalRef: {
    serialize: (inner, mark) => {
      const kind = mark.attrs.kind
      const target = mark.attrs.target
      if (
        (kind !== "page" && kind !== "block") ||
        typeof target !== "string" ||
        !target
      ) {
        return inner
      }
      const tag = kind === "page" ? "mention-page" : "mention-block"
      const alias = mark.attrs.alias === true ? ` alias="true"` : ""
      return `<${tag} id="${escapeHtmlAttr(target)}"${alias}>${inner}</${tag}>`
    },
    html: [
      { tag: "mention-page", attrs: ["id", "alias"] },
      { tag: "mention-block", attrs: ["id", "alias"] },
    ],
  },
}
