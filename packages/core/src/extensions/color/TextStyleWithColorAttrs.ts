// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// TextStyleWithColorAttrs — extends Tiptap's TextStyle mark with parseHTML
// rules that accept our own-output <span data-text-color> / <span
// data-background-color> shapes (no inline style= attr). Without these
// rules, the upstream parser rejects styleless spans before our
// addGlobalAttributes parsers run, and round-trip drops the data attr.
//
// Both extra rules use `consuming: false` so they participate in attr
// collection without claiming the node — the global-attribute parsers
// (TextColor, BackgroundColor) and the upstream `style=` rule still run
// alongside, which is what lets a span with both `style="color:..."` and
// `data-text-color="blue"` resolve correctly (data-attr wins because it's
// the explicit name).
//
// Round-trip / external-paste tests for this wrapper live in TextColor.test.ts
// and BackgroundColor.test.ts — they need a global attr to actually exercise
// the rules. The local tests in TextStyleWithColorAttrs.test.ts only check
// that the parseDOM array carries our two extra rules.

import { TextStyle } from "@tiptap/extension-text-style"

export const TextStyleWithColorAttrs = TextStyle.extend({
  parseHTML() {
    const base = this.parent?.() ?? []
    return [
      ...base,
      { tag: "span[data-text-color]", consuming: false, getAttrs: () => ({}) },
      { tag: "span[data-background-color]", consuming: false, getAttrs: () => ({}) },
      // <mark> is the markdown-storage background form (D4): bare = the
      // HIGHLIGHT_COLOR_NAME anchor, data-color = a palette name. The
      // BackgroundColor global attribute reads the value.
      { tag: "mark", consuming: false, getAttrs: () => ({}) },
    ]
  },
})
