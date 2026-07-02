// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { Editor, type JSONContent } from "@tiptap/core"
import { createRuneKit, type CreateRuneKitOptions } from "../../kit"
import { exportMarkdown, type ExportMarkdownOptions } from "./markdown"

/**
 * Convert a stored ProseMirror document (`doc` JSON, e.g. the persisted
 * `editor.getJSON()` output) to Markdown without a pre-existing editor.
 *
 * Internally constructs a throwaway headless `Editor` (`element: null`,
 * never mounted — no DOM required) carrying the full rune kit, runs
 * {@link exportMarkdown}, and destroys the editor. This is the entry point
 * for non-browser consumers (Electron main process, servers, CLIs) that
 * must not depend on `@tiptap/core` directly.
 *
 * Invalid input fails at the schema boundary: unknown node/mark types throw
 * from ProseMirror's `nodeFromJSON`, while missing attrs (e.g. `id`,
 * `depth`) are filled from schema defaults.
 *
 * @param content - A full `{ type: "doc", content: [...] }` JSON document.
 * @param options - Forwarded to {@link createRuneKit}; only schema-affecting
 *   options (custom blocks via `blockIdTypes`, etc.) influence the output.
 * @param exportOptions - Forwarded to {@link exportMarkdown} (e.g.
 *   `{ dialect: "plain" }` for a user-facing export). Defaults to `"styled"`.
 */
export function exportMarkdownFromDoc(
  content: JSONContent,
  options?: CreateRuneKitOptions,
  exportOptions?: ExportMarkdownOptions,
): string {
  const editor = new Editor({
    element: null,
    extensions: createRuneKit(options),
    content,
  })
  try {
    return exportMarkdown(editor, exportOptions)
  } finally {
    editor.destroy()
  }
}
