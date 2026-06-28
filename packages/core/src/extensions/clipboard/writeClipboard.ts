// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { EditorView } from "@tiptap/pm/view"
import { serializeBlocksForClipboard } from "./serializeBlocks"

/**
 * Replace PM's default copy/cut handler. PM's default begins with
 * `clipboardData.clearData()`, so we cannot augment from outside —
 * we must own the whole sequence. This sets all three MIMEs:
 *   - text/html (chrome-free, via clipboardSerializer prop)
 *   - text/plain (PM default text serialization)
 *   - application/x-rune-doc (Slice JSON)
 *
 * `event.preventDefault()` is called explicitly. We do not rely on PM's
 * "return true ⇒ default-prevented" implicit contract for editHandlers
 * (mousedown is documented; copy/cut/paste are not promised by PM source).
 *
 * Delegates to `serializeBlocksForClipboard` — the centralized seam shared
 * by Cmd-C and button-copy — which expands collapsed toggles before
 * serializing so the full content is always on the clipboard.
 */
export function writeClipboard(view: EditorView, event: ClipboardEvent, cut: boolean): boolean {
  const sel = view.state.selection
  if (sel.empty) return false
  const data = event.clipboardData
  if (!data) return false

  // Capture the slice BEFORE any mutation so the cut branch serializes the
  // right content. serializeBlocksForClipboard reads selection.content()
  // internally, but for cut we need to ensure no dispatch happens first.
  const slice = sel.content()
  const { html, text, runeDocJson } = serializeBlocksForClipboard(view, slice)

  event.preventDefault()
  data.clearData()
  data.setData("text/html", html)
  data.setData("text/plain", text)
  data.setData("application/x-rune-doc", runeDocJson)

  // IMPORTANT: deleteSelection AFTER all setData calls. `slice` was captured
  // from sel.content() above (still valid as a JSON snapshot), but a future
  // "lazy slice capture" optimization that fetched the slice inside the cut
  // branch would silently serialize the empty post-delete selection.
  //
  // Tag the delete with `uiEvent: "cut"` (PM's own convention for its native
  // cut handler, which this replaces). Downstream appendTransactions key off
  // it — notably TitleKit's boundary, which on a cut that empties the body
  // re-seeds an empty line and moves the caret into it.
  if (cut) view.dispatch(view.state.tr.deleteSelection().scrollIntoView().setMeta("uiEvent", "cut"))
  return true
}
