// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Regression suite — collapsed-toggle body leak on the destructive paths
// (Escape+Delete, native cut, duplicate x2, api deleteBlocks). Each asserts
// the CORRECT (no-leak) behavior; each fix lives in
// `expandRangeOverToggleBodies` (blocks/Toggle/range.ts) and its call sites
// in block-selection/commands.ts, clipboard/writeClipboard.ts, and
// api/commands/deleteBlocks.ts.
//
// Model recap (flat schema): a collapsed toggle's body blocks are the
// FOLLOWING SIBLINGS on its own surface whose `depth` > the toggle's depth
// (see blocks/Toggle/range.ts toggleBodyRange). Copy widens to include them
// (expandCollapsedToggles) and drag widens (dragSourceRange); the destructive
// paths below now widen too via `expandRangeOverToggleBodies`.

import { describe, it, expect } from "vitest"
import { createTestEditor } from "../../test-utils/createTestEditor"
import { writeClipboard } from "../../extensions/clipboard/writeClipboard"
import { toggleBodyRange, togglePosById } from "./range"

const HIDDEN = "HIDDEN-CHILD"

// Collapsed toggle "tog" (depth 0) + one hidden body paragraph (depth 1) +
// a trailing depth-0 paragraph that terminates the toggle's body run.
function makeCollapsedToggleDoc() {
  const editor = createTestEditor()
  editor.commands.setContent([
    {
      type: "toggle",
      attrs: { id: "tog", depth: 0, level: 0, expanded: false },
      content: [{ type: "text", text: "Title" }],
    },
    {
      type: "paragraph",
      attrs: { id: "body", depth: 1 },
      content: [{ type: "text", text: HIDDEN }],
    },
    {
      type: "paragraph",
      attrs: { id: "after", depth: 0 },
      content: [{ type: "text", text: "after" }],
    },
  ] as never)
  return editor
}

function countToggles(editor: ReturnType<typeof createTestEditor>): number {
  let n = 0
  editor.state.doc.descendants((node) => {
    if (node.type.name === "toggle") n++
  })
  return n
}

// jsdom lacks ClipboardEvent / DataTransfer — mint the minimal surface
// writeClipboard reads (mirrors writeClipboard.test.ts).
function makeClipboardEvent(): ClipboardEvent {
  const store = new Map<string, string>()
  const data = {
    get types() {
      return Array.from(store.keys())
    },
    clearData: () => store.clear(),
    setData: (mime: string, value: string) => {
      store.set(mime, value)
    },
    getData: (mime: string) => store.get(mime) ?? "",
  } as unknown as DataTransfer
  let defaultPrevented = false
  return {
    type: "cut",
    clipboardData: data,
    get defaultPrevented() {
      return defaultPrevented
    },
    preventDefault: () => {
      defaultPrevented = true
    },
  } as unknown as ClipboardEvent
}

describe("collapsed-toggle body leak on destructive paths", () => {
  // Scenario 1 — Escape builds a single-block MBS over ONLY the toggle title
  // (keymap.ts handleEscape -> MultiBlockSelection.create over the toggle's
  // index); Delete then removes only the title, orphaning the hidden body.
  // setBlockSelection({from: id, to: id}) builds the IDENTICAL single-toggle
  // MBS, so it is a faithful deterministic stand-in for the Escape keypress.
  it("Escape+Delete (single-block MBS deleteBlockSelection) deletes the hidden body too", () => {
    const editor = makeCollapsedToggleDoc()
    editor.commands.setBlockSelection({ from: "tog", to: "tog" })
    editor.commands.deleteBlockSelection()
    // Correct: deleting a collapsed toggle removes its hidden body with it.
    expect(editor.state.doc.textContent).not.toContain(HIDDEN)
  })

  // Scenario 2 — native cut: the clipboard gets an EXPANDED copy (toggle +
  // body) via expandCollapsedToggles, but the in-doc delete removes only the
  // title, so the body is duplicated (survives in the doc AND on the clipboard).
  it("cut removes the hidden body from the doc (no duplication)", () => {
    const editor = makeCollapsedToggleDoc()
    editor.commands.setBlockSelection({ from: "tog", to: "tog" })
    const event = makeClipboardEvent()
    const ok = writeClipboard(editor.view, event, /* cut */ true)
    expect(ok).toBe(true)

    // Copy side is already correct: the clipboard carries toggle + body.
    const runeDoc = JSON.parse(
      event.clipboardData!.getData("application/x-rune-doc"),
    )
    expect(runeDoc.content.length).toBe(2)

    // Leak: the hidden body must NOT still be in the document after a cut.
    expect(editor.state.doc.textContent).not.toContain(HIDDEN)
  })

  // Scenario 3 — duplicate: duplicateBlocks inserts the clone at sel.to (the
  // boundary BETWEEN the toggle and its body), so toggleBodyRange reassigns
  // the body to the clone and leaves the original empty.
  it("duplicate produces two complete toggles (original keeps its body)", () => {
    const editor = makeCollapsedToggleDoc()
    editor.commands.setBlockSelection({ from: "tog", to: "tog" })
    editor.commands.duplicateBlocks()

    expect(countToggles(editor)).toBe(2)

    // The ORIGINAL toggle must still own a non-empty body.
    const origPos = togglePosById(editor.state.doc, "tog")
    expect(origPos).toBeGreaterThanOrEqual(0)
    const origBody = toggleBodyRange(editor.state.doc, origPos)
    expect(origBody.isEmpty).toBe(false)

    // And the hidden body text should appear twice (one per toggle).
    const occurrences = editor.state.doc.textContent.split(HIDDEN).length - 1
    expect(occurrences).toBe(2)
  })

  // Scenario 3b — the SAME duplicate leak via the caret (TextSelection)
  // branch: Mod-d with a caret inside the collapsed toggle title inserts a
  // clone of only the title right after the toggle (commands.ts:288), again
  // reparenting the body to the clone. This is the common Cmd+D path (no
  // Escape needed).
  it("caret-duplicate (Mod-d in title) keeps the original body", () => {
    const editor = makeCollapsedToggleDoc()
    // Caret at end of the toggle title (pos 1..content end inside the toggle).
    const titleEnd = 1 + editor.state.doc.child(0).content.size
    editor.commands.setTextSelection(titleEnd)
    editor.commands.duplicateBlocks()

    expect(countToggles(editor)).toBe(2)
    const origPos = togglePosById(editor.state.doc, "tog")
    const origBody = toggleBodyRange(editor.state.doc, origPos)
    expect(origBody.isEmpty).toBe(false)
    const occurrences = editor.state.doc.textContent.split(HIDDEN).length - 1
    expect(occurrences).toBe(2)
  })

  // Scenario 4 — public/AI editor.commands.deleteBlocks has no toggle
  // awareness (resolveDeleteRanges targets only the toggle node), so the
  // hidden body is left orphaned.
  it("deleteBlocks([toggleId]) removes the hidden body too", () => {
    const editor = makeCollapsedToggleDoc()
    editor.commands.deleteBlocks(["tog"])
    expect(editor.state.doc.textContent).not.toContain(HIDDEN)
  })
})
