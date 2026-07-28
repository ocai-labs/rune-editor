// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Direct tests for the AI-parse-path raw-HTML sanitizer (a security surface).
// The full-doc round-trip suite (api/export/__tests__/roundtrip.test.ts)
// exercises it transitively; these pin the adversarial behaviors so a refactor
// of the scanner can't silently regress them.

import { describe, it, expect } from "vitest"
import { sanitizeRawHtml, isAllowedTag } from "./aiMarkdownSanitizer"

describe("sanitizeRawHtml — admits the whitelisted forms verbatim", () => {
  const pass = (html: string) => expect(sanitizeRawHtml(html)).toBe(html)

  it("<u>", () => pass("<u>"))
  it("</u>", () => pass("</u>"))
  it("an underline pair around text", () => pass("<u>emphasis</u>"))
  it("a text-color span", () => pass('<span data-text-color="blue">'))
  it("a background-color span", () => pass('<span data-background-color="yellow">'))
  it("both color attrs on one span", () =>
    pass('<span data-text-color="blue" data-background-color="yellow">'))
  it("</span>", () => pass("</span>"))
  it("<span> with an empty attr set", () => pass("<span>"))
  it("the task-list checkbox <input>", () =>
    pass('<input class="task-list-item-checkbox" checked disabled type="checkbox">'))
  it("<br>", () => pass("<br>"))
  it("<br/> (self-closing)", () => pass("<br/>"))
  it("a bare <br> between two text runs", () => pass("line1<br>line2"))
  it("a page mention", () => pass('<mention-page id="Target">'))
  it("a block mention", () => pass('<mention-block id="note#block">'))
  it("a mention with alias=\"true\"", () =>
    pass('<mention-page id="Target" alias="true">'))
  it("</mention-page>", () => pass("</mention-page>"))
  it("</mention-block>", () => pass("</mention-block>"))
})

describe("sanitizeRawHtml — neutralizes everything outside the whitelist", () => {
  // A neutralized run carries no `<` immediately followed by a tag-name char:
  // both brackets are escaped, so nothing re-opens as a live element.
  const noLiveTag = (s: string) => expect(s).not.toMatch(/<[/!a-zA-Z]/)

  it("<script> → literal text (open + close both escaped)", () => {
    const out = sanitizeRawHtml("before <script>alert(1)</script> after")
    expect(out).toContain("&lt;script&gt;")
    expect(out).toContain("&lt;/script&gt;")
    expect(out).toContain("alert(1)")
    noLiveTag(out)
  })

  it("<img onerror> → literal text (no image tag survives)", () => {
    const out = sanitizeRawHtml('x <img src=x onerror="alert(1)"> y')
    expect(out).toContain("&lt;img")
    expect(out).toContain("onerror")
    noLiveTag(out)
  })

  it("<span style> (non-whitelisted attr) rejected", () => {
    const out = sanitizeRawHtml('<span style="color:red">')
    expect(out).toBe('&lt;span style="color:red"&gt;')
  })

  it("event-handler attr on an otherwise-allowed color span → whole tag rejected", () => {
    const out = sanitizeRawHtml('<span data-text-color="blue" onclick="steal()">')
    expect(out).toContain("&lt;span")
    expect(out).toContain("onclick")
    noLiveTag(out)
  })

  it("<u onclick> rejected", () => {
    expect(sanitizeRawHtml("<u onclick>")).toBe("&lt;u onclick&gt;")
  })

  it("<br> carrying any attribute is rejected (empty allowed-attr set)", () => {
    expect(sanitizeRawHtml('<br onclick="x">')).toBe('&lt;br onclick="x"&gt;')
  })

  it("malformed attr junk after a valid attr → whole tag rejected", () => {
    const out = sanitizeRawHtml('<span data-text-color="blue" %bad>')
    expect(out).toContain("&lt;span")
    noLiveTag(out)
  })

  it("<!-- comment --> neutralized (no live comment node)", () => {
    expect(sanitizeRawHtml("keep <!-- secret --> text")).toBe(
      "keep &lt;!-- secret --&gt; text",
    )
  })

  it("closing tag carrying attrs is rejected", () => {
    expect(sanitizeRawHtml("</span foo>")).toBe("&lt;/span foo&gt;")
  })

  it("a non-whitelisted closing tag is rejected", () => {
    expect(sanitizeRawHtml("</script>")).toBe("&lt;/script&gt;")
  })

  it("a mention with a non-whitelisted attr is rejected", () => {
    const out = sanitizeRawHtml('<mention-page id="Target" onclick="steal()">')
    expect(out).toContain("&lt;mention-page")
    noLiveTag(out)
  })

  it("an unknown mention-* tag name is rejected (not in the whitelist)", () => {
    const out = sanitizeRawHtml('<mention-foo id="Target">')
    expect(out).toBe('&lt;mention-foo id="Target"&gt;')
  })
})

describe("sanitizeRawHtml — tag-boundary and quote handling", () => {
  it("honors a `>` inside a quoted attr value (does not truncate the tag)", () => {
    // The `>` sits inside the quoted value, so the allowed span passes intact.
    expect(sanitizeRawHtml('a <span data-text-color="a>b">z')).toBe(
      'a <span data-text-color="a>b">z',
    )
  })

  it("allows the other quote char nested inside a quoted value", () => {
    expect(sanitizeRawHtml(`<span data-text-color='a"b'>`)).toBe(
      `<span data-text-color='a"b'>`,
    )
  })

  it("an unbalanced quote leaves the tag unterminated → neutralized", () => {
    expect(sanitizeRawHtml('<span data-text-color="oops>')).toBe(
      '&lt;span data-text-color="oops>',
    )
  })

  it("an unterminated tag at end of input is escaped, not passed through", () => {
    expect(sanitizeRawHtml("trailing <u")).toBe("trailing &lt;u")
  })

  it("normalizes uppercase tag/attr names when matching the whitelist", () => {
    // Admitted (names match case-insensitively); original casing is preserved.
    expect(sanitizeRawHtml('<SPAN DATA-TEXT-COLOR="blue">')).toBe(
      '<SPAN DATA-TEXT-COLOR="blue">',
    )
    expect(sanitizeRawHtml("<U>x</U>")).toBe("<U>x</U>")
  })
})

describe("isAllowedTag — classification predicate", () => {
  it.each([
    "<u>",
    "</u>",
    "<span>",
    '<span data-text-color="blue">',
    '<span data-background-color="yellow">',
    '<span data-text-color="blue" data-background-color="red">',
    '<span data-text-color="a>b">',
    '<SPAN DATA-TEXT-COLOR="blue">',
    '<input class="task-list-item-checkbox" checked disabled type="checkbox">',
    '<mention-page id="Target">',
    '<mention-block id="note#block">',
    '<mention-page id="Target" alias="true">',
    "</mention-page>",
    // `id` is required for the MARK to apply (the schema's `mention-page[id]`
    // parse rule + internal-ref's own empty-target rejection), but that is a
    // parse-side concern, not the sanitizer's — the whitelist only vets
    // tag/attr NAMES, so a bare `<mention-page>` is still an admitted
    // (harmless) custom element here.
    "<mention-page>",
  ])("admits %s", (tag) => expect(isAllowedTag(tag)).toBe(true))

  it.each([
    "<script>",
    "</script>",
    '<img src=x onerror="a">',
    '<span data-text-color="blue" onclick="x">',
    "<u onclick>",
    "</span foo>",
    "<!-- c -->",
    '<span style="color:red">',
    "<div>",
    "not a tag",
    "<span", // no closing bracket
    '<mention-foo id="Target">',
    '<mention-page id="Target" onclick="x">',
  ])("rejects %s", (tag) => expect(isAllowedTag(tag)).toBe(false))
})
