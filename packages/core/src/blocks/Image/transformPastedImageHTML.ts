// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { Editor, JSONContent } from "@tiptap/core"
import type { EditorView } from "@tiptap/pm/view"
import type { RuneImportImageUrl, RuneImportMediaUrl } from "../media/import-plugin"

function hasImageUrlImporter(editor: Editor): boolean {
  const storage = editor.storage.imageImport as
    | {
        importMediaUrl?: RuneImportMediaUrl
        importImageUrl?: RuneImportImageUrl
      }
    | undefined
  return (
    typeof storage?.importMediaUrl === "function" ||
    typeof storage?.importImageUrl === "function"
  )
}

export function transformPastedImageHTML(
  doc: Document,
  view: EditorView,
  editor: Editor,
): void {
  if (!view.editable || !hasImageUrlImporter(editor)) return

  for (const img of Array.from(doc.body.querySelectorAll<HTMLImageElement>("img[src]"))) {
    const src = img.getAttribute("src")
    if (!src) continue
    img.setAttribute("data-rune-paste-image", src)
    img.removeAttribute("src")
  }
}

/**
 * The DOM-free counterpart of {@link transformPastedImageHTML}, for the Markdown
 * paste path — which builds ProseMirror JSON through the storage codec and never
 * produces a `Document` to walk.
 *
 * Both routes have to end at the SAME node shape, because `image`'s `parseDOM`
 * is what defines it: an `img` carrying `data-rune-paste-image` parses to
 * `{ src: "", pendingFromPaste: <original src> }`, and the upload plugin keys off
 * `pendingFromPaste`. Writing those two attrs directly is that rule expressed
 * against the node instead of against an element.
 *
 * Returns a new tree; the input is not mutated.
 */
export function markPastedImagesInDoc(
  doc: JSONContent,
  view: EditorView,
  editor: Editor,
): JSONContent {
  if (!view.editable || !hasImageUrlImporter(editor)) return doc

  const walk = (node: JSONContent): JSONContent => {
    const next: JSONContent =
      node.type === "image" && typeof node.attrs?.src === "string" && node.attrs.src !== ""
        ? { ...node, attrs: { ...node.attrs, src: "", pendingFromPaste: node.attrs.src } }
        : node
    return next.content ? { ...next, content: next.content.map(walk) } : next
  }

  return walk(doc)
}
