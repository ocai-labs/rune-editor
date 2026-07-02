// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { Node as PMNode, Mark } from "@tiptap/pm/model"
import { markInlineContract } from "./markInlineContract"

/**
 * Which inline dialect to serialize:
 * - `"styled"` (default) — the AI read/write dialect: raw-HTML contracts
 *   (`<span data-*-color>`, `<u>`) DO emit, so read == write and colors/
 *   underline survive an `apply_edits` round-trip.
 * - `"plain"` — user-facing export (a host "Export as Markdown" menu): raw-HTML
 *   contracts do NOT emit, their text passing through unwrapped. Markdown-syntax
 *   marks (bold/italic/strike/code/link/wikiLink), `$math$`, and text escaping
 *   are identical in both dialects.
 */
export type MarkdownDialect = "styled" | "plain"

// Marks whose content is a verbatim sub-grammar (NOT re-parsed as markdown),
// so plain-text escaping must not run inside them: `code` (backtick content is
// literal — the double-backtick fallback already handles embedded backticks)
// and `wikiLink` (a custom `[[…]]` inline rule; its target/alias are raw).
const VERBATIM_MARKS = new Set(["code", "wikiLink"])

/**
 * Escape markdown-significant characters in a plain-text run so that document
 * text which merely *looks like* markdown survives a round-trip instead of
 * re-parsing as formatting (e.g. literal `*foo*`, a stray backtick, `[x]`).
 * The scoped AI parser runs markdown-it with `html: true`, so tag-like `<` and
 * entity-like `&` are neutralized too.
 */
function escapeInlineText(text: string): string {
  return (
    text
      // Backslash first, so we don't re-escape the backslashes we introduce.
      .replace(/\\/g, "\\\\")
      // Inline emphasis / code / link-bracket / math delimiters.
      .replace(/[*_~`\[\]$]/g, (ch) => `\\${ch}`)
      // `&` only when it would otherwise parse as an HTML entity. Runs BEFORE
      // the `<` rule below so the `&` in an introduced `&lt;` is not re-escaped.
      .replace(/&(?=#\d+;|#x[0-9a-fA-F]+;|\w+;)/g, "&amp;")
      // `<` only when it looks like a tag opener (followed by a letter, `/`, or
      // `!`). Harmless cases like `< 3` are left alone.
      .replace(/<(?=[a-zA-Z/!])/g, "&lt;")
  )
}

/**
 * Escape a leading character that would parse as BLOCK syntax at column 0.
 * `serializeInlineContent` is called once per block, so position 0 of its
 * output is a sound proxy for line start. Handles ATX headings, blockquotes,
 * bullet markers, and ordered-list markers. Inline-only hazards (`*`, `` ` ``,
 * `[`, …) are already escaped per-run by `escapeInlineText`.
 */
function escapeLineStart(s: string): string {
  if (s === "") return s
  // ATX heading (`#`…`######` followed by space or EOL).
  if (/^#{1,6}(?:\s|$)/.test(s)) return `\\${s}`
  // Blockquote (`>`; a following space is optional in CommonMark).
  if (s[0] === ">") return `\\${s}`
  // Bullet-list marker (`-`/`+` followed by space or EOL).
  if (/^[-+](?:\s|$)/.test(s)) return `\\${s}`
  // Ordered-list marker (digits then `.`/`)` followed by space or EOL) —
  // escape the punctuation, since `\1.` is not a valid escape in CommonMark.
  const ordered = /^(\d{1,9})[.)](?:\s|$)/.exec(s)
  if (ordered) {
    const digits = ordered[1]!
    return `${digits}\\${s.slice(digits.length)}`
  }
  return s
}

// PM sorts marks by schema definition order (rank). The serialization loop
// wraps the first mark innermost and the last outermost, so a link wrapping
// bold produces `[**text**](url)`. This is the inverse of DOM nesting.
//
// We apply marks in three stages, NOT raw PM rank order, because content
// nested inside some marks re-parses verbatim and can only round-trip if every
// other mark's syntax sits OUTSIDE it:
//
//   1. VERBATIM marks (`code`, `wikiLink`) — INNERMOST. Their content is a
//      literal sub-grammar on re-parse (backtick content, a `[[…]]` target),
//      so markdown syntax INSIDE them is dead text: `` `**x**` `` re-parses as
//      a code span holding the characters `**x**`, never bold+code. PM ranks
//      bold/italic/strike BEFORE code, so left as-is bold would land inside the
//      backticks and could never round-trip. Forcing verbatim marks innermost
//      makes `` **`x`** `` — bold outside, code innermost — which round-trips.
//   2. Other markdown-syntax marks — MIDDLE, in PM rank order (unchanged).
//   3. Raw-HTML marks (`<u>`, `<span data-*-color>` — those carrying `html`
//      metadata) — OUTERMOST. Same reasoning as stage 1 for the code+color
//      case: `<span…>`fn()`</span>` (span outside the backticks) is what rune
//      styles (`span[data-text-color] code` in react typography.css) and what
//      round-trips; a span inside the backticks would be literal text.
//
// Relative order WITHIN each stage is preserved, so no output shifts beyond
// the verbatim-innermost / html-outermost repositioning.
//
// In the `"plain"` dialect the html stage is dropped entirely — those contracts
// do not emit, their text passing through unwrapped (verbatim + markdown stages
// and escaping are identical to `"styled"`).
function wrapWithMarks(
  text: string,
  marks: readonly Mark[],
  dialect: MarkdownDialect,
): string {
  if (text === "") return ""

  const verbatim = marks.some((mark) => VERBATIM_MARKS.has(mark.type.name))
  let result = verbatim ? text : escapeInlineText(text)

  const verbatimMarks: Mark[] = []
  const markdownMarks: Mark[] = []
  const htmlMarks: Mark[] = []
  for (const mark of marks) {
    const contract = markInlineContract[mark.type.name]
    if (!contract) continue // Marks with no contract (e.g. internalRef) pass through unwrapped.
    if (contract.html) htmlMarks.push(mark)
    else if (VERBATIM_MARKS.has(mark.type.name)) verbatimMarks.push(mark)
    else markdownMarks.push(mark)
  }

  const applied =
    dialect === "plain"
      ? [...verbatimMarks, ...markdownMarks]
      : [...verbatimMarks, ...markdownMarks, ...htmlMarks]
  for (const mark of applied) {
    result = markInlineContract[mark.type.name]!.serialize(result, mark)
  }

  return result
}

export function serializeInlineContent(
  node: PMNode,
  dialect: MarkdownDialect = "styled",
): string {
  const parts: string[] = []

  node.content.forEach((child) => {
    if (child.type.name === "inlineMath") {
      parts.push(`$${child.attrs.latex as string}$`)
      return
    }

    if (child.isText && child.text != null) {
      parts.push(wrapWithMarks(child.text, child.marks, dialect))
    }
  })

  return escapeLineStart(parts.join(""))
}
