// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { Node } from "@tiptap/core"

/**
 * RawInline — the inline half of the lossless fallback (step-8 track A2). It
 * carries a run of source that sits INSIDE a paragraph and has no rune meaning:
 * an unrecognised tag, a stray closing tag, an inline comment, a multi-line MDX
 * component. `rawBlock` is the block-level counterpart.
 *
 * An ATOM, not a mark. mdast represents `<span class="x">middle</span>` as three
 * independently positioned nodes — html / text / html — and an atom preserves
 * that topology: the tags are quarantined and the middle text stays ordinary
 * editable content. A mark could not do either job. Editing splits and extends a
 * mark, so one authored span would become several generated ones and the source
 * tag boundaries would be gone; and an unmatched `</div>`, a self-closing tag or
 * a comment has no text to attach a mark to at all.
 *
 * The source is DISPLAYED, never rendered — same hard invariant as `rawBlock`,
 * and for the same reason. The value reaches the DOM only as a text child.
 *
 * It is only ever produced by the markdown decoder, which is why it has no input
 * rule, no command and no menu entry.
 */
export const RawInline = Node.create({
  name: "rawInline",
  inline: true,
  group: "inline",
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      source: {
        default: "",
        // Carried as the element's TEXT, never as an attribute value — see the
        // display-not-render invariant above.
        parseHTML: (el: HTMLElement) => el.textContent ?? "",
        renderHTML: () => ({}),
      },
    }
  },

  parseHTML() {
    return [{ tag: "span[data-rune-raw-inline]" }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      {
        ...HTMLAttributes,
        "data-rune-raw-inline": "",
        class: "rune-raw-inline",
      },
      String(node.attrs.source ?? ""),
    ]
  },

  renderText({ node }) {
    return String(node.attrs.source ?? "")
  },
})
