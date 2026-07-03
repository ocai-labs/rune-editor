// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

/**
 * Flatten <details> subtrees in `doc` IN PLACE into a flat sequence of
 * top-level block-level elements:
 *   - the title element (<p> or <hN>) tagged with `data-rune-toggle-title="1"`,
 *     `data-rune-toggle-level`, `data-rune-toggle-expanded`
 *   - the body's block-level children, each tagged with
 *     `data-rune-paste-depth="<n>"` (incremented by 1 relative to the
 *     toggle's own depth — which is 0 at the outermost call).
 *
 * Nested toggles are flattened recursively, with depths summed.
 *
 * Called from `clipboard/transformPastedHTML.ts` BEFORE the list flattener,
 * because both layers consume `data-rune-paste-depth` and the list
 * flattener walks `<ul>/<ol>` only — it ignores body blocks introduced
 * by us.
 *
 * `<details>` (standards-based — GitHub and others) is the ONLY shape
 * detected here. A `.notion-selectable.notion-header-block` /
 * `.notion-toggle` heuristic used to also be matched, on the theory that it
 * caught Notion's toggle markup, but a live capture of REAL Notion clipboard
 * HTML (desktop app AND web, see
 * internal design notes
 * #4) showed it is clean semantic HTML with ZERO `.notion-*` classes — a
 * Notion toggle copies as `<ul><li><p>summary</p><p>body</p></li></ul>`, and
 * even a toggle-HEADING copies as a bare `<hN>` indistinguishable from a
 * plain heading (Notion itself discards the toggle-ness on copy). The
 * `.notion-*` selector was therefore dead against any real Notion paste, and
 * the only thing it could do was mis-toggle-ify a plain heading from some
 * OTHER, non-Notion source that happened to emit those class names with no
 * disclosure/aria signal. Removed; if a "this HTML came from Notion" signal
 * is ever needed, key on the trailing `<!-- notionvc: … -->` comment, never
 * on `.notion-*` classes.
 */
export function transformToggleHTML(doc: Document): void {
  // Walk outermost-first; recursion happens inside `flattenOne`.
  while (true) {
    const root = pickRootToggle(doc)
    if (!root) break
    flattenOne(doc, root, 0)
  }
}

function pickRootToggle(doc: Document): HTMLElement | null {
  // Document order from querySelector already guarantees outermost-first;
  // nested <details> are handled by flattenOne's recursion at the
  // body-element loop.
  return doc.querySelector("details")
}

function flattenOne(doc: Document, root: HTMLElement, depthOffset: number): void {
  const { titleEl, level, expanded, bodyEls } = extractTitleAndBody(doc, root)
  const out: HTMLElement[] = []

  titleEl.setAttribute("data-rune-toggle-title", "1")
  titleEl.setAttribute("data-rune-toggle-level", String(level))
  titleEl.setAttribute("data-rune-toggle-expanded", expanded ? "true" : "false")
  if (depthOffset > 0) titleEl.setAttribute("data-rune-paste-depth", String(depthOffset))
  out.push(titleEl)

  for (const body of bodyEls) {
    // If body is itself a toggle, flatten it inline with depth+1.
    if (body.matches("details")) {
      const stash = doc.createElement("div")
      doc.body.appendChild(stash)
      stash.appendChild(body)
      flattenOne(doc, body, depthOffset + 1)
      // After flattening, the title + children sit at top level under stash.
      Array.from(stash.children).forEach((c) => out.push(c as HTMLElement))
      stash.remove()
    } else {
      body.setAttribute("data-rune-paste-depth", String(depthOffset + 1))
      out.push(body)
    }
  }

  root.replaceWith(...out)
}

interface Extracted {
  titleEl: HTMLElement
  level: 0 | 2 | 3 | 4
  expanded: boolean
  bodyEls: HTMLElement[]
}

// `root` is always a `<details>` here — `pickRootToggle` and `flattenOne`'s
// recursion (`body.matches("details")`) never hand this anything else, now
// that the Notion-class heuristic is gone.
function extractTitleAndBody(doc: Document, root: HTMLElement): Extracted {
  // <details>: summary first child, others are body.
  const summary = root.querySelector(":scope > summary")
  const innerHead = summary?.querySelector("h1, h2, h3, h4, h5, h6")
  const titleEl =
    innerHead != null
      ? (doc.importNode(innerHead, true) as HTMLElement)
      : (() => {
          const p = doc.createElement("p")
          p.innerHTML = summary?.innerHTML ?? ""
          return p
        })()
  const level = headingLevelFromTag(titleEl.tagName)
  if (level === 0 && titleEl.tagName !== "P") {
    const p = doc.createElement("p")
    p.innerHTML = titleEl.innerHTML
    titleEl.replaceWith(p)
  }
  const expanded = (root as HTMLDetailsElement).open
  const bodyEls: HTMLElement[] = []
  for (const child of Array.from(root.children)) {
    if (child === summary) continue
    if (child instanceof HTMLElement) bodyEls.push(child)
  }
  return { titleEl, level, expanded, bodyEls }
}

function headingLevelFromTag(tag: string): 0 | 2 | 3 | 4 {
  // Toggle Heading caps at UI H3 (internal 4 → <h4>). Pasted H5/H6 from
  // other tools collapses to H4 here so a "Heading 5" toggle from an
  // external doc still lands as a toggle — just one level shallower.
  const m = /^H([1-6])$/.exec(tag.toUpperCase())
  if (!m) return 0
  const n = Number(m[1])
  if (n === 1) return 2
  if (n === 2) return 2
  if (n === 3) return 3
  return 4
}
