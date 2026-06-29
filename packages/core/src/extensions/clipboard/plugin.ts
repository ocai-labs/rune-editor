// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { Editor } from "@tiptap/core"
import { Plugin, PluginKey } from "@tiptap/pm/state"
import { writeClipboard } from "./writeClipboard"
import { handlePaste } from "./handlePaste"
import { transformPastedHTML } from "./transformPastedHTML"
import { clipboardTextParser } from "./clipboardTextParser"
import { buildClipboardSerializer } from "./serializer"
import type { DOMSerializer } from "@tiptap/pm/model"

export const clipboardPluginKey = new PluginKey("rune-clipboard")

export interface ClipboardOptions {
  clipboardSerializer?: (base: DOMSerializer, editor: Editor) => DOMSerializer
}

export function createClipboardPlugin(editor: Editor, options: ClipboardOptions = {}): Plugin {
  // Built once at plugin construction since editor.schema is stable for
  // the editor lifetime. If we ever support runtime schema swaps, rebuild
  // when the schema identity changes.
  const baseSerializer = buildClipboardSerializer(editor)
  const clipboardSerializer = options.clipboardSerializer
    ? options.clipboardSerializer(baseSerializer, editor)
    : baseSerializer

  return new Plugin({
    key: clipboardPluginKey,
    props: {
      clipboardSerializer,
      clipboardTextParser,
      transformPastedHTML: (html, view) => transformPastedHTML(html, view, editor),
      handlePaste: (view, event) => handlePaste(view, event as ClipboardEvent, editor),
      handleDOMEvents: {
        copy: (view, event) => writeClipboard(view, event as ClipboardEvent, /*cut*/ false),
        cut:  (view, event) => writeClipboard(view, event as ClipboardEvent, /*cut*/ true),
      },
    },
  })
}
