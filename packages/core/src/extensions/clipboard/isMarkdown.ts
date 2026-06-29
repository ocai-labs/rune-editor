// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

/**
 * Heuristic "does this plain text look like Markdown?" gate.
 *
 * Pasted `text/plain` only takes the Markdown → blocks path (see
 * `handlePaste`) when this returns true AND the clipboard carries no
 * rich `text/html`. The regexes are intentionally conservative: a false
 * positive is cheap because markdown-it itself is conservative (e.g. it
 * leaves intra-word `foo_bar_baz` untouched), so misfiring on ordinary
 * prose still renders the text faithfully.
 *
 * Regex set adapted from BlockNote's `detectMarkdown` (MPL-compatible
 * MPL-2.0 / same family of editors); kept as a single OR so any one
 * block- or inline-level Markdown signal flips it on.
 */

// ATX headings H1–H6. Mirrors markdown-it's own heading rule (0–3 lead
// spaces, 1–6 `#`, ≥1 space, content) so the gate fires exactly when the
// renderer would emit a heading — including a lone `# Heading` with no
// body below it.
const heading = /(^|\n) {0,3}#{1,6} +\S/

// Bold / italic / strikethrough / highlight runs.
const emphasis = /(_|__|\*|\*\*|~~|==|\+\+)(?!\s)(?:[^\s](?:.{0,62}[^\s])?|\S)(?=\1)/

// Inline link (also captures image syntax).
const link = /\[[^\]]{1,128}\]\(https?:\/\/\S{1,999}\)/

// Inline code span.
const code = /(?:\s|^)`(?!\s)(?:[^\s`](?:[^`]{0,46}[^\s`])?|[^\s`])`([^\w]|$)/

// Unordered list (two consecutive items).
const ul = /(?:^|\n)\s{0,5}-\s{1}[^\n]+\n\s{0,15}-\s/

// Ordered list (two consecutive items).
const ol = /(?:^|\n)\s{0,5}\d+\.\s{1}[^\n]+\n\s{0,15}\d+\.\s/

// Horizontal rule (GFM requires 3+ dashes; `--` is not an HR).
const hr = /\n{2} {0,3}-{3,48}\n{2}/

// Fenced code block (``` / ~~~ / $$). Body cap is generous (100k chars,
// ~2.5k lines) so large pastes still detect; the closing-fence backref
// keeps the lazy scan bounded.
const fences =
  /(?:\n|^)(```|~~~|\$\$)(?!`|~)[^\s]{0,64} {0,64}[^\n]{0,64}\n[\s\S]{0,100000}?\s*\1 {0,64}(?:\n+|$)/

// Setext (underlined) H1 / H2.
const setext = /(?:\n|^)(?!\s)\w[^\n]{0,64}\r?\n(-|=)\1{0,64}\n\n\s{0,64}(\w|$)/

// Blockquote. Inner quantifier is `{0,333}` so blank continuation lines
// (`>` with nothing after it) inside a multi-paragraph quote still count.
const blockquote = /(?:^|(\r?\n\r?\n))( {0,3}>[^\n]{0,333}\n){1,999}($|(\r?\n))/

// GFM table row / divider. The cell class `[^|\r\n]+` excludes the `|`
// delimiter, so each pipe is a hard boundary — this avoids the
// catastrophic backtracking that `(.+\|)+` suffers on a wide row with no
// trailing pipe (GitHub omits it), which measured in the seconds.
const tableRow = /^\s*\|([^|\r\n]+\|)+\s*$/m
const tableDivider = /^\s*\|(\s*[-:]+[-:]\s*\|)+\s*$/m

/** Returns `true` if `src` plausibly contains Markdown syntax. */
export function isMarkdown(src: string): boolean {
  return (
    heading.test(src) ||
    emphasis.test(src) ||
    link.test(src) ||
    code.test(src) ||
    ul.test(src) ||
    ol.test(src) ||
    hr.test(src) ||
    fences.test(src) ||
    setext.test(src) ||
    blockquote.test(src) ||
    tableRow.test(src) ||
    tableDivider.test(src)
  )
}
