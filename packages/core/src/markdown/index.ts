// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Storage-format markdown API (markdown-storage PRD). Two pure functions —
// no DOM, no editor, no state (§7.1). Frontmatter is carved off on parse and
// handed back on serialize as an opaque string: PM has no frontmatter node,
// and the pairing of a doc with its frontmatter is the CALLER's concern
// (zyler owns the file, rune owns the conversion).
//
// Published as the `@ocai/rune-core/markdown` SUBPATH export — never from
// the package root. The codec pulls the unified/remark family; the subpath
// keeps that out of every consumer bundle that only wants the editor
// (PRD §7 dependency-weight note). This split is permanent API shape, not
// dev scaffolding.
import type { JSONContent } from "@tiptap/core"
import { parseToMdast, stringifyMdast } from "./pipeline"
import { mdastToPM, pmToMdast } from "./convert"
import { getDefaultMarkdownContracts, type MarkdownContracts } from "./contracts"

export type { MarkdownContracts, MarkdownContractEntry } from "./contracts"
export { collectMarkdownContracts } from "./contracts"
export {
  normalizeDocForComparison,
  sameDocument,
  countDuplicateMarks,
} from "./compare"

export interface ParsedMarkdown {
  doc: JSONContent
  /** Raw YAML frontmatter body (without the `---` fences), or null. */
  frontmatter: string | null
}

export interface MarkdownCodecOptions {
  /**
   * Per-block `markdown` contracts to consult (promoters + declared
   * serializers). Defaults to the contracts declared by the default body
   * blocks; pass `collectMarkdownContracts(...)` output to include plugin
   * blocks, or `[]` to run the builtin mappings only.
   */
  contracts?: MarkdownContracts
}

/**
 * Encoding normalization, applied once at the entry so the tree and the source
 * slice always agree about offsets.
 *
 * DECLARED BEHAVIOUR, not an accident (PRD D14): a byte-order mark is dropped
 * and CRLF becomes LF. Both are canonicalizations a Markdown editor is expected
 * to make, and both are what the rest of the pipeline already assumed.
 *
 * Doing it here is what makes the assumption true. Without it a CRLF file left
 * a BARE `\r` inside the document's text content — the `\n` was consumed as a
 * line break and the `\r` was not, so the carriage return became part of the
 * user's prose, travelled into the editor, and was written back to the file.
 * It was a fixpoint and structurally symmetric, so no gate could see it.
 */
function normalizeEncoding(markdown: string): string {
  const withoutBom = markdown.charCodeAt(0) === 0xfeff ? markdown.slice(1) : markdown
  return withoutBom.includes("\r") ? withoutBom.replace(/\r\n?/g, "\n") : withoutBom
}

/** md string → PM doc JSON (+ carved-off frontmatter). Pure. */
export function parseMarkdown(
  rawMarkdown: string,
  options?: MarkdownCodecOptions,
): ParsedMarkdown {
  const markdown = normalizeEncoding(rawMarkdown)
  const root = parseToMdast(markdown)
  let frontmatter: string | null = null
  if (root.children[0]?.type === "yaml") {
    frontmatter = root.children[0].value
    root.children = root.children.slice(1)
  }
  // `source` is the ORIGINAL string, not the frontmatter-stripped remainder:
  // `root.children` is sliced above, but every node keeps the offsets it was
  // parsed with, so they still index into the full document.
  return {
    doc: mdastToPM(
      { root, source: markdown },
      options?.contracts ?? getDefaultMarkdownContracts(),
    ),
    frontmatter,
  }
}

/** PM doc JSON (+ optional frontmatter) → md string. Pure. */
export function serializeMarkdown(
  doc: JSONContent,
  frontmatter?: string | null,
  options?: MarkdownCodecOptions,
): string {
  const root = pmToMdast(doc, options?.contracts ?? getDefaultMarkdownContracts())
  if (frontmatter != null) {
    root.children = [{ type: "yaml", value: frontmatter }, ...root.children]
  }
  return stringifyMdast(root)
}
