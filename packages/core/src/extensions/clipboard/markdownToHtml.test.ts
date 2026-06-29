// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, expect, it } from "vitest"
import { markdownToHtml } from "./markdownToHtml"

describe("markdownToHtml — heading axis shift (decision a / option 2)", () => {
  it("shifts every heading down one tag, no cascade", () => {
    const html = markdownToHtml("# h1\n\n## h2\n\n### h3\n\n#### h4\n")
    expect(html).toContain("<h2>h1</h2>")
    expect(html).toContain("<h3>h2</h3>")
    expect(html).toContain("<h4>h3</h4>")
    expect(html).toContain("<h5>h4</h5>")
    expect(html).not.toContain("<h1>")
  })

  it("clamps <h5> and <h6> to <h5>", () => {
    const html = markdownToHtml("##### five\n\n###### six\n")
    expect(html).toContain("<h5>five</h5>")
    expect(html).toContain("<h5>six</h5>")
    expect(html).not.toContain("<h6>")
  })
})

describe("markdownToHtml — GFM coverage", () => {
  it("renders GFM tables (no plugin needed)", () => {
    const html = markdownToHtml("| a | b |\n| - | - |\n| 1 | 2 |\n")
    expect(html).toContain("<table>")
    expect(html).toContain("<th>a</th>")
    expect(html).toContain("<td>1</td>")
  })

  it("renders strikethrough as <s>", () => {
    expect(markdownToHtml("~~gone~~")).toContain("<s>gone</s>")
  })

  it("emits the language class on fenced code", () => {
    const html = markdownToHtml("```js\nconst a = 1\n```\n")
    expect(html).toContain('class="language-js"')
  })

  it("emits checkboxes for task lists", () => {
    const html = markdownToHtml("- [ ] todo\n- [x] done\n")
    expect(html).toContain('type="checkbox"')
    expect(html.match(/checked/g)?.length).toBe(1)
  })

  it("renders nested lists", () => {
    const html = markdownToHtml("- a\n  - b\n")
    // nested <ul> lives inside the parent <li> — rune's flattenLists handles depth.
    expect(html).toMatch(/<li>[\s\S]*<ul>[\s\S]*<li>/)
  })

  it("escapes raw embedded HTML (html: false)", () => {
    expect(markdownToHtml("<script>alert(1)</script>")).not.toContain("<script>")
  })

  it("leaves intra-word underscores literal (no spurious emphasis)", () => {
    const html = markdownToHtml("see foo_bar_baz_qux for details")
    expect(html).toContain("foo_bar_baz_qux")
    expect(html).not.toContain("<em>")
  })
})
