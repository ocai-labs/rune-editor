// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The in-document page title. A real node in rune's single ProseMirror
// document (block 0) plus the `TitleBoundary` extension that keeps it
// first/singleton/non-deletable via self-healing normalization and makes
// Enter/Backspace flow across the title↔body boundary the way Notion does.
//
// Ported up from downstream verbatim; the only adaptation is the import
// surface — `createBlockSpec` from rune-core's schema factory and
// `TITLE_TYPE` / `TitleBoundary` from sibling modules.
import { createBlockSpec } from "../../schema"
import { TITLE_TYPE } from "./constants"
import { TitleBoundary } from "./boundary"

// The title block. Deliberately minimal: no slash-menu entry, no side-menu
// drag handle, no block colour, no turn-into — it's a fixed structural node,
// not something the user inserts or restyles. Kept out of rune-ai's read-tool
// outputs via `agentHidden` (so the model gets no id to target it). Renders an
// <h1> inside the standard `.rune-block` wrapper
// so it aligns with body blocks; the React layer owns its visual styling via
// the `rune-title` class. There is no per-block placeholder here: the empty
// "New page" hint is CSS-only (rune-react's title.css ::before, always-on like
// Notion), and rune-react's default placeholders ship `title: undefined` so the
// generic Placeholder extension stays off the title and the two never double up.
export const TitleBlock = createBlockSpec({
  type: TITLE_TYPE,
  content: "inline*",
  parseDOM: [{ tag: "h1" }],
  renderDOM: ({ HTMLAttributes }) => [
    "div",
    { ...HTMLAttributes, class: "rune-block" },
    [
      "div",
      { class: "rune-block-content" },
      [
        // `role=textbox` + `aria-label` give the title an accessible name the way
        // the old out-of-editor <h1> did (so AT announces "Page title, <text>"
        // rather than an unlabeled heading); role=textbox keeps the title TEXT as
        // the field value (a bare aria-label on an h1 would REPLACE the text).
        // The editor root's `contenteditable` already conveys read-only state
        // when the note is locked, so no per-block aria-readonly is needed.
        "h1",
        {
          class: "rune-title",
          role: "textbox",
          "aria-label": "Page title",
          "aria-multiline": "true",
        },
        0,
      ],
    ],
  ],
  clipboardRenderDOM: () => ["h1", {}, 0],
  // The title is a fixed structural node: not in the slash menu, not draggable,
  // and kept out of rune-ai's read-tool outputs via `agentHidden` (so the model
  // gets no id to insert-before / turn-into / move it).
  sideMenu: { draggable: false },
  agentHidden: true,
  // Never swept into a block selection. Notion never includes the page title
  // in Cmd+A / marquee / select-all, and excluding it makes "select-all +
  // Delete" preserve the title (without this, the MBS covered index 0 and
  // delete-all wiped the title, which normalizeTitle then re-seeded EMPTY).
  // `selectable: false` is a ProseMirror NodeSpec flag that only blocks
  // NodeSelection (whole-node selection) — it does NOT affect
  // TextSelection/caret editing, so typing in the title is unaffected.
  // Block-selection code keys off `node.type.spec.selectable === false`.
  //
  // `marks: ""` makes the title PLAIN TEXT — no bold/italic/color/link/etc. can
  // be applied or pasted (the schema forbids every inline mark), and rune-react's
  // InlineToolbar reads the same fact to stay closed when the selection sits
  // wholly inside the title. Matches Notion, where the page title takes no inline
  // formatting.
  meta: { selectable: false, marks: "" },
  // Serializes as the markdown H1 at the top of the document. Skip entirely
  // when empty so an untitled note doesn't emit a dangling `# `. Collapse any
  // newline (a hard_break can still reach the title via paste — see the
  // Shift/Mod-Enter keymap guard for the typed path) so the heading stays a
  // single `# …` line and matches the host's single-line title field.
  toMarkdown: ({ serializeInline, node }) => {
    const text = serializeInline(node).replace(/\s*\\?\r?\n\s*/g, " ").trim()
    return text ? { line: `# ${text}` } : null
  },
  toRuneBlock: (node) => ({
    type: TITLE_TYPE,
    id: typeof node.attrs.id === "string" ? node.attrs.id : "",
    text: node.textContent,
  }),
  // Ship the boundary extension (normalization + Enter/Backspace keymaps)
  // through the block's `extensions: [...]` array — kit.ts needs no
  // special-casing (Table / Columns precedent).
  extensions: [TitleBoundary],
})

// Public shape of the title in the block read API (editor.document). The title
// is always at depth 0, so the projection carries only `id` + `text`.
export interface RuneTitleBlock {
  type: "title"
  id: string
  text: string
}
