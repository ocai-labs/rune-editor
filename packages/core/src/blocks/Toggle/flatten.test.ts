// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, it, expect } from "vitest"
import { transformToggleHTML } from "./flatten"

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html")
}

describe("transformToggleHTML — <details>", () => {
  it("flattens a <details> into title + body siblings with data-rune-paste-depth", () => {
    const doc = parse(`
      <details open>
        <summary>Title</summary>
        <p>Body A</p>
        <p>Body B</p>
      </details>
    `)
    transformToggleHTML(doc)
    const tops = Array.from(doc.body.children)
    expect(tops[0]!.getAttribute("data-rune-toggle-title")).toBe("1")
    expect(tops[0]!.getAttribute("data-rune-toggle-expanded")).toBe("true")
    expect(tops[0]!.textContent).toBe("Title")
    expect(tops[1]!.getAttribute("data-rune-paste-depth")).toBe("1")
    expect(tops[1]!.textContent).toBe("Body A")
    expect(tops[2]!.getAttribute("data-rune-paste-depth")).toBe("1")
    expect(tops[2]!.textContent).toBe("Body B")
  })

  it("preserves heading level from <summary><hN>", () => {
    const doc = parse(`
      <details>
        <summary><h2>Title</h2></summary>
        <p>Body</p>
      </details>
    `)
    transformToggleHTML(doc)
    const t = doc.body.firstElementChild!
    expect(t.tagName).toBe("H2")
    expect(t.getAttribute("data-rune-toggle-level")).toBe("2")
    expect(t.getAttribute("data-rune-toggle-expanded")).toBe("false")
  })

  it("flattens nested <details> recursively, incrementing depth", () => {
    const doc = parse(`
      <details open>
        <summary>Outer</summary>
        <details open>
          <summary>Inner</summary>
          <p>Deep</p>
        </details>
        <p>OuterBody</p>
      </details>
    `)
    transformToggleHTML(doc)
    const tops = Array.from(doc.body.children) as HTMLElement[]
    // outer title, inner title (depth 1), deep (depth 2), outer body (depth 1)
    expect(tops[0]!.textContent).toBe("Outer")
    expect(tops[0]!.getAttribute("data-rune-toggle-title")).toBe("1")
    expect(tops[1]!.textContent).toBe("Inner")
    expect(tops[1]!.getAttribute("data-rune-paste-depth")).toBe("1")
    expect(tops[1]!.getAttribute("data-rune-toggle-title")).toBe("1")
    expect(tops[2]!.textContent).toBe("Deep")
    expect(tops[2]!.getAttribute("data-rune-paste-depth")).toBe("2")
    expect(tops[3]!.textContent).toBe("OuterBody")
    expect(tops[3]!.getAttribute("data-rune-paste-depth")).toBe("1")
  })
})

// #22 — per internal design notes
// (#4): a live capture of REAL Notion clipboard HTML (desktop + web) contains
// ZERO `.notion-*` classes — a plain heading copies as a bare `<hN>`, and a
// toggle-heading copies as an IDENTICAL bare `<hN>` (Notion itself discards
// the toggle-ness). The `.notion-selectable.notion-header-block` /
// `.notion-toggle` selectors that used to live in `notionToggleSelector()`
// were therefore dead against any real Notion paste — the only thing they
// could do was mis-fire on a plain heading from some OTHER, non-Notion
// source that happened to emit those class names with no disclosure/aria
// signal. Removed (see flatten.ts's docstring); this pins the fixed
// behavior.
describe("transformToggleHTML — .notion-* class heuristic removed (#22)", () => {
  it("a plain heading wrapped in .notion-selectable.notion-header-block, with no aria-expanded and no body, is left untouched", () => {
    const doc = parse(`
      <div class="notion-selectable notion-header-block">
        <h2>Just a heading</h2>
      </div>
    `)
    transformToggleHTML(doc)
    const tops = Array.from(doc.body.children) as HTMLElement[]
    // No `<details>` anywhere in this doc, so transformToggleHTML is a
    // total no-op: the wrapper div and its heading survive verbatim, with
    // no toggle attrs injected.
    expect(tops.length).toBe(1)
    expect(tops[0]!.tagName).toBe("DIV")
    expect(tops[0]!.className).toBe("notion-selectable notion-header-block")
    const heading = tops[0]!.querySelector("h2")!
    expect(heading.textContent).toBe("Just a heading")
    expect(heading.hasAttribute("data-rune-toggle-title")).toBe(false)
  })
})

// Real Notion clipboard shapes, verbatim from the research doc's live
// capture (desktop app AND web app were byte-for-byte identical). Neither
// shape contains a `<details>` element, so `transformToggleHTML` — which
// only detects `<details>` now — is a no-op on both; downstream handling
// (heading render / list flattening) happens elsewhere.
describe("transformToggleHTML — real Notion clipboard shapes (#22)", () => {
  it("a real Notion toggle-HEADING paste is a bare <hN> and stays a heading (Notion itself discards the toggle-ness on copy)", () => {
    const doc = parse(`<h1>My Toggle Heading</h1>`)
    transformToggleHTML(doc)
    const tops = Array.from(doc.body.children) as HTMLElement[]
    expect(tops.length).toBe(1)
    expect(tops[0]!.tagName).toBe("H1")
    expect(tops[0]!.textContent).toBe("My Toggle Heading")
    expect(tops[0]!.hasAttribute("data-rune-toggle-title")).toBe(false)
  })

  // Characterization test, NOT a fix: a real Notion toggle arrives as
  // `<ul><li><p>summary</p><p>body</p></li></ul>` — no `<details>`, no
  // aria/disclosure marker. `transformToggleHTML` correctly ignores it (it
  // only looks for `<details>`); today this list shape gets claimed by the
  // list flattener downstream and lands as a bullet item with two
  // paragraphs, NOT a rune toggle. That toggle→toggle fidelity gap is
  // explicitly out of scope per the research doc (§#4 point 3) — pinning
  // current behavior here, not implementing detection for it.
  it("a real Notion toggle paste (<ul><li><p>…</p><p>…</p></li></ul>) is untouched by transformToggleHTML (fidelity gap, out of scope)", () => {
    const doc = parse(`
      <ul>
      <li>
      <p>My Toggle</p>
      <p>Inside toggle</p>
      </li>
      </ul>
    `)
    transformToggleHTML(doc)
    const tops = Array.from(doc.body.children) as HTMLElement[]
    expect(tops.length).toBe(1)
    expect(tops[0]!.tagName).toBe("UL")
    expect(tops[0]!.querySelector("li")).not.toBeNull()
    expect(tops[0]!.querySelectorAll("p").length).toBe(2)
    expect(tops[0]!.querySelector("[data-rune-toggle-title]")).toBeNull()
  })
})
