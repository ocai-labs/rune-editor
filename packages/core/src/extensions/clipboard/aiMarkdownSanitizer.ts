// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The quote-aware raw-HTML sanitizer for the AI-edit parse path (aiMarkdown.ts).
// The AI dialect runs markdown-it with `html: true` so the two raw-HTML
// constructs it emits (`<u>` and `<span data-*-color>`) survive; this scanner
// neutralizes everything ELSE the (untrusted, model-supplied) markdown might
// carry down to a registry-derived whitelist. It is a security surface, so it
// lives in its own module with focused tests (aiMarkdownSanitizer.test.ts) —
// internal to the clipboard extension, never a public core export.

import { markInlineContract } from "../../api/export/markInlineContract"

// ── Raw-HTML whitelist, derived from the mark contract ─────────────────────
//
// tag name → set of attribute names the dialect allows on it. Built from the
// `html` metadata each mark contract declares, so the read whitelist and the
// write emission stay a matched pair: add a mark that emits `<mark …>` and it
// becomes parseable here with no edit to this file.
const ALLOWED_HTML: Map<string, Set<string>> = (() => {
  const map = new Map<string, Set<string>>()
  for (const contract of Object.values(markInlineContract)) {
    for (const emission of contract.html ?? []) {
      const tag = emission.tag.toLowerCase()
      const attrs = map.get(tag) ?? new Set<string>()
      for (const attr of emission.attrs) attrs.add(attr.toLowerCase())
      map.set(tag, attrs)
    }
  }
  // The task-list plugin renders its checkbox as an inline `<input>` html_inline
  // token, which flows through the same sanitizer as source raw HTML — admit it
  // (a disabled checkbox is inert). Not a mark, so it sits outside the
  // registry-derived whitelist; the list flattener downstream reads it.
  map.set("input", new Set(["class", "checked", "disabled", "type", "id"]))
  return map
})()

/** Attribute matcher: `name` or `name="value"` / `name='value'` / `name=bare`. */
const ATTR_RE =
  /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g

/** Every attribute NAME present must be in `allowed`, and nothing else may be
 * lurking in the attribute string (stray junk → reject conservatively). */
function attrsSubsetOf(attrsStr: string, allowed: Set<string>): boolean {
  if (attrsStr === "") return true
  ATTR_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = ATTR_RE.exec(attrsStr)) !== null) {
    if (!allowed.has(match[1]!.toLowerCase())) return false
  }
  // Anything the attribute grammar did not consume (unbalanced quotes, stray
  // `<`, malformed pairs) means we can't vouch for the tag — neutralize it.
  return attrsStr.replace(ATTR_RE, "").replace(/\s+/g, "") === ""
}

/**
 * True only for `<u>`/`</u>` and `<span …>`/`</span>` (plus the task-list
 * `<input>`) whose attrs are a subset of the mark contract's whitelist. `tag`
 * includes the surrounding `<` and `>`.
 *
 * @internal exported only for aiMarkdownSanitizer.test.ts.
 */
export function isAllowedTag(tag: string): boolean {
  if (!tag.startsWith("<") || !tag.endsWith(">")) return false
  let inner = tag.slice(1, -1).trim()
  const closing = inner.startsWith("/")
  if (closing) inner = inner.slice(1).trim()
  if (inner.endsWith("/")) inner = inner.slice(0, -1).trim() // self-closing
  const spaceIdx = inner.search(/\s/)
  const name = (spaceIdx === -1 ? inner : inner.slice(0, spaceIdx)).toLowerCase()
  const allowed = ALLOWED_HTML.get(name)
  if (!allowed) return false
  const attrsStr = spaceIdx === -1 ? "" : inner.slice(spaceIdx + 1).trim()
  if (closing) return attrsStr === ""
  return attrsSubsetOf(attrsStr, allowed)
}

/** Find the `>` that closes the tag opened at `start`, honoring quoted
 * attribute values (so a `>` inside `data-x="a>b"` doesn't truncate). */
function findTagEnd(raw: string, start: number): number {
  let quote: string | null = null
  for (let i = start + 1; i < raw.length; i++) {
    const ch = raw[i]!
    if (quote) {
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") quote = ch
    else if (ch === ">") return i
  }
  return -1
}

/**
 * Neutralize a raw-HTML token's content down to the whitelist. Whitelisted
 * tags pass verbatim; every other tag-like run has BOTH its angle brackets
 * escaped (`&lt;`/`&gt;`) so it renders as literal text — never as an element.
 * Escaping both brackets (not just the leading `<`) matters: a rejected tag
 * may carry an inner `<` inside a quoted attr (`<div title="<img onerror=…>">`)
 * that would otherwise re-open as a live tag downstream.
 */
export function sanitizeRawHtml(raw: string): string {
  let out = ""
  let i = 0
  while (i < raw.length) {
    const lt = raw.indexOf("<", i)
    if (lt === -1) {
      out += raw.slice(i)
      break
    }
    out += raw.slice(i, lt)
    const end = findTagEnd(raw, lt)
    if (end === -1) {
      out += "&lt;" + raw.slice(lt + 1)
      break
    }
    const tag = raw.slice(lt, end + 1)
    out += isAllowedTag(tag)
      ? tag
      : tag.replace(/</g, "&lt;").replace(/>/g, "&gt;")
    i = end + 1
  }
  return out
}
