// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, expect, it } from "vitest"
import { isMarkdown } from "./isMarkdown"

describe("isMarkdown", () => {
  it.each([
    ["heading", "# Title\n\nbody text"],
    ["lone heading with no body", "# Introduction"],
    ["bold", "this is **bold** here"],
    ["link", "see [docs](https://example.com)"],
    ["inline code", "use `npm install` now"],
    ["bullet list", "- one\n- two"],
    ["ordered list", "1. one\n2. two"],
    ["fenced code", "```js\nconst a = 1\n```"],
    ["blockquote", "\n\n> a quote\n\n"],
    ["multi-paragraph blockquote (blank > line)", "> Para 1\n>\n> Para 2\n"],
    ["table", "| a | b |\n| - | - |\n| 1 | 2 |"],
  ])("detects %s", (_label, src) => {
    expect(isMarkdown(src)).toBe(true)
  })

  it.each([
    ["plain prose", "just a normal sentence with no markup"],
    ["multi-line prose", "first line\nsecond line\nthird line"],
    ["arithmetic with spaced asterisks", "price is 5 * 3 = 15 dollars"],
    ["two-dash separator (not a GFM HR)", "\n\n--\n\n"],
    ["empty", ""],
  ])("rejects %s", (_label, src) => {
    expect(isMarkdown(src)).toBe(false)
  })

  it("detects a fenced code block whose body exceeds the old 9999-char cap", () => {
    const big = "```python\n" + "x = 1\n".repeat(2500) + "```\n" // ~15k body
    expect(big.length).toBeGreaterThan(10000)
    expect(isMarkdown(big)).toBe(true)
  })

  it("resolves a wide pipe row without trailing pipe quickly (no ReDoS)", () => {
    // `(.+\|)+` backtracked exponentially here (~4.5s); the boundaried
    // `[^|\r\n]+` cell class keeps it linear.
    const row = "| " + Array.from({ length: 25 }, (_, i) => `col${i}`).join(" | ")
    const t0 = performance.now()
    isMarkdown(row)
    expect(performance.now() - t0).toBeLessThan(100)
  })

  it("may flag intra-word underscores — harmless because markdown-it leaves them literal", () => {
    // The heuristic is intentionally loose; the markdownToHtml safety net
    // (CommonMark: no intra-word emphasis) keeps the false positive benign.
    expect(isMarkdown("see foo_bar_baz_qux for details")).toBe(true)
  })
})
