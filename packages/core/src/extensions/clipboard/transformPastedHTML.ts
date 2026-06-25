// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { Editor } from "@tiptap/core"
import type { EditorView } from "@tiptap/pm/view"
import { collectKnownBlockTags } from "./knownBlockTags"
import { degradeToParagraphs } from "./degrade"
import { transformToggleHTML } from "../../blocks/Toggle/flatten"
import { transformPastedImageHTML } from "../../blocks/Image/transformPastedImageHTML"

type ListKind = "bullet" | "numbered" | "task"

function flattenLists(doc: Document) {
  const rootLists = Array.from(doc.body.querySelectorAll("ul, ol")).filter(
    (list) => list.parentElement?.closest("ul, ol") == null,
  )

  for (const list of rootLists) {
    const flattened: HTMLLIElement[] = []
    walkList(list, 0, flattened)
    list.replaceWith(...flattened.map((li) => wrapForParse(doc, li)))
  }
}

function walkList(list: Element, depth: number, out: HTMLLIElement[]) {
  const isOL = list instanceof HTMLOListElement
  const startAttr = isOL ? list.getAttribute("start") : null
  let firstNumberedSeen = false

  for (const li of Array.from(list.children)) {
    if (!(li instanceof HTMLLIElement)) continue

    const checkbox = Array.from(li.children).find(
      (child): child is HTMLInputElement =>
        child instanceof HTMLInputElement && child.matches("input[type='checkbox']"),
    )
    const kind: ListKind = checkbox != null ? "task" : isOL ? "numbered" : "bullet"
    const nestedLists = Array.from(li.children).filter(
      (child) => child.tagName === "UL" || child.tagName === "OL",
    )
    nestedLists.forEach((nested) => nested.remove())

    if (checkbox != null) {
      li.setAttribute("data-rune-paste-checked", String(checkbox.hasAttribute("checked")))
      checkbox.remove()
    }

    li.setAttribute("data-rune-paste-depth", String(depth))
    li.setAttribute("data-rune-paste-kind", kind)
    if (kind === "numbered" && !firstNumberedSeen && startAttr != null) {
      li.setAttribute("data-rune-paste-start", startAttr)
      firstNumberedSeen = true
    }

    out.push(li)
    for (const nested of nestedLists) walkList(nested, depth + 1, out)
  }
}

function wrapForParse(doc: Document, li: HTMLLIElement): HTMLElement {
  const kind = li.getAttribute("data-rune-paste-kind")
  if (kind === "numbered") {
    const ol = doc.createElement("ol")
    const startAttr = li.getAttribute("data-rune-paste-start")
    if (startAttr != null) ol.setAttribute("start", startAttr)
    li.removeAttribute("data-rune-paste-start")
    ol.appendChild(li)
    return ol
  }

  const ul = doc.createElement("ul")
  ul.appendChild(li)
  return ul
}

/**
 * Tiptap/PM `transformPastedHTML` prop. Runs BEFORE PM's DOMParser:
 * preprocesses the raw HTML so unknown block-level subtrees become
 * paragraphs, then hands the cleaned HTML back to PM. PM's DOMParser
 * then performs the actual schema mapping using each block's parseDOM.
 *
 * No mark handling here — marks pass through untouched and PM's
 * DOMParser matches them against schema mark rules.
 */
export function transformPastedHTML(html: string, view: EditorView, editor: Editor): string {
  const knownBlockTags = collectKnownBlockTags(view.state.schema)
  const doc = new DOMParser().parseFromString(html, "text/html")

  transformToggleHTML(doc)
  transformInlineCodeHTML(doc)
  flattenLists(doc)
  transformPastedImageHTML(doc, view, editor)

  for (const el of Array.from(doc.body.children)) {
    const unwrapped = unwrapFlattenedListWrapperChildren(el, knownBlockTags)
    if (unwrapped != null) {
      el.replaceWith(...unwrapped)
      continue
    }
    if (knownBlockTags.has(el.tagName.toLowerCase()) || isFlattenedListWrapper(el)) continue
    // Inline-level top-level elements are part of a single paragraph's inline run,
    // NOT block wrappers. Degrading them to `<p>` injects block boundaries that
    // fragment the surrounding top-level text nodes (one Notion paragraph → N blocks).
    if (isInlineLevel(el)) {
      // A genuine inline tag (`<span>`, `<a>`, `<code>`…) is left in place — PM's
      // DOMParser folds it into the contiguous inline run.
      if (INLINE_TAGS.has(el.tagName.toLowerCase())) continue
      // A block tag forced inline via `display:inline` (Notion's inline-code
      // `<div style="display:inline">`) is still treated as a block by PM's
      // hardcoded block-tag set, so it would break the paragraph. Unwrap it to
      // its inline children so only inline content remains.
      el.replaceWith(...Array.from(el.childNodes))
      continue
    }
    el.replaceWith(...degradeToParagraphs(el, knownBlockTags))
  }
  return doc.body.innerHTML
}

/**
 * Notion serialises inline code as
 * `<div class="notion-inline-code-container" style="display:inline"><span
 * style="…monospace…;background:…">code</span></div>`. Two problems on paste:
 * the `<div>` is block-level to PM's DOMParser (it would fragment the host
 * paragraph), and the styled `<span>` is not a `<code>` element, so the code
 * mark's `<code>`-only parseHTML never matches and the inline code degrades to
 * plain text. Rewrite each container to a real `<code>` element: inline (no
 * fragmentation) AND matched by the code mark downstream. textContent only —
 * the monospace/background styling on the inner span is chrome we don't want to
 * leak into the document.
 */
function transformInlineCodeHTML(doc: Document) {
  for (const el of Array.from(doc.querySelectorAll(".notion-inline-code-container"))) {
    const code = doc.createElement("code")
    code.textContent = el.textContent
    el.replaceWith(code)
  }
}

const INLINE_TAGS = new Set([
  "span", "a", "code", "em", "strong", "b", "i", "u", "s", "strike", "del", "ins",
  "sub", "sup", "mark", "small", "abbr", "cite", "q", "time", "label", "font",
  "kbd", "samp", "var", "big", "tt",
])

function isInlineLevel(el: Element): boolean {
  if (INLINE_TAGS.has(el.tagName.toLowerCase())) return true
  const display = (el as HTMLElement).style?.display ?? ""
  return display.startsWith("inline")
}

/**
 * After flattenLists, a wrapper like `<div>` may contain a flattened list
 * wrapper alongside non-list siblings (`<p>`, `<span>`, another wrapper,
 * etc.). The whole-wrapper degrade path strips list kind context from
 * those flattened wrappers, so we splice instead: list wrappers are kept
 * as-is, known-block siblings are kept as-is, and unknown siblings are
 * degraded in place. Order is preserved so `<div><p>intro</p><ul>…</ul></div>`
 * lands as `<p>intro</p>` followed by the flattened bullet item.
 *
 * Returns `null` if the wrapper contains NO flattened list — the caller
 * falls through to the existing whole-wrapper degrade path so non-list
 * wrappers behave exactly as before.
 *
 * Single-level only. A flattened list nested two wrappers deep
 * (`<div><div><ul>…</ul></div></div>`) still degrades as a whole; if that
 * surfaces, recurse into non-list element children instead of returning
 * the original element. Tracked via the original #182 fixtures.
 */
function unwrapFlattenedListWrapperChildren(el: Element, knownBlockTags: Set<string>) {
  const replacements: Element[] = []
  let sawFlattenedList = false

  for (const node of Array.from(el.childNodes)) {
    if (node instanceof Text) {
      if (node.textContent?.replace(/\s/g, "") === "") continue
      const p = el.ownerDocument.createElement("p")
      p.textContent = node.textContent
      replacements.push(p)
      continue
    }

    if (!(node instanceof Element)) continue

    if (isFlattenedListWrapper(node)) {
      replacements.push(node)
      sawFlattenedList = true
      continue
    }

    if (knownBlockTags.has(node.tagName.toLowerCase())) {
      replacements.push(node)
      continue
    }

    replacements.push(...degradeToParagraphs(node, knownBlockTags))
  }

  return sawFlattenedList ? replacements : null
}

function isFlattenedListWrapper(el: Element) {
  if (el.tagName !== "UL" && el.tagName !== "OL") return false
  return el.children.length === 1 && el.firstElementChild?.hasAttribute("data-rune-paste-depth") === true
}
