// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import MarkdownIt from "markdown-it"
import taskLists from "markdown-it-task-lists"

/**
 * Renders pasted Markdown text to an HTML string, which `handlePaste`
 * then feeds through the EXISTING `transformPastedHTML` → PM DOMParser
 * pipeline. Pure string → string (no DOM), so it stays usable in core's
 * SSR / worker contexts.
 *
 * markdown-it's "default" preset already covers GFM tables and
 * strikethrough; the task-lists plugin adds `<input type="checkbox">`
 * output that rune's list flattener turns into TaskList items. `html:
 * false` keeps raw embedded HTML escaped rather than injected.
 */
const md = new MarkdownIt({ html: false, linkify: true }).use(taskLists)

/**
 * Shift the whole heading axis down one tag, clamped at `<h5>`:
 * `h1→h2 … h4→h5`, `h5/h6→h5`. This is the inverse of rune's heading
 * `toMarkdown` (internal level 2 → `#`), so Markdown's top heading `#`
 * lands as body Heading level 2 (UI "H1") instead of `<h1>` — which rune
 * reserves for the page title and would otherwise degrade to a paragraph
 * (decision a / option 2). Also folds the unsupported `<h6>` into `<h5>`.
 *
 * Replacement reads each tag's original level, so there is no cascade
 * (a shifted `h1→h2` is not re-matched and pushed to `h3`).
 */
function shiftHeadings(html: string): string {
  return html.replace(
    /<(\/?)h([1-6])\b([^>]*)>/gi,
    (_match, slash: string, digit: string, rest: string) => {
      const shifted = Math.min(Number(digit) + 1, 5)
      return `<${slash}h${shifted}${rest}>`
    },
  )
}

/** Convert a Markdown document to rune-pipeline-ready HTML. */
export function markdownToHtml(markdown: string): string {
  return shiftHeadings(md.render(markdown))
}
