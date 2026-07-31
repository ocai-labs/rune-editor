// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// `requireTypedTrigger` — Notion session-start model (user-verified
// 2026-06-11, follow-up to the slash-menu edge-case report): a suggestion
// session only ever STARTS on the transaction that typed/inserted the
// trigger char at the anchor. Placing the caret into a dead `/query` run —
// by click, arrow keys, or loading a doc that already contains one — must
// never reopen the menu. Mirrors the kit's `/` trigger config.
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Editor } from "@tiptap/core"
import Document from "@tiptap/extension-document"
import Text from "@tiptap/extension-text"
import { createBlockSpec } from "../../schema"
import { SuggestionMenus } from "./SuggestionMenus"
import { getSuggestionMenus } from "./getSuggestionMenus"
import { slashMatcher } from "./matchers/slashMatcher"
import { AGENT_WRITE_META } from "../agent-write-meta"

const Para = createBlockSpec({
  type: "paragraph",
  content: "inline*",
  parseDOM: [{ tag: "p" }],
  renderDOM: ({ HTMLAttributes }) => ["p", HTMLAttributes, 0],
})

let container: HTMLDivElement
beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
})
afterEach(() => {
  container.remove()
})

function mk(content = "<p></p>") {
  return new Editor({
    element: container,
    extensions: [
      Document,
      Text,
      Para,
      SuggestionMenus.configure({
        // Same shape as the kit's `/` trigger.
        triggers: [
          {
            char: "/",
            allowSpaces: true,
            matcher: slashMatcher,
            requireTypedTrigger: true,
          },
        ],
      }),
    ],
    content,
  })
}

// The kit's `:` (emoji) trigger shape: default matcher, no
// `requireTypedTrigger` — the gate the `/` tests below lean on doesn't
// exist here, which is why the whole-doc branch has to arm suppression.
function mkColon(content = "<p></p>") {
  return new Editor({
    element: container,
    extensions: [
      Document,
      Text,
      Para,
      SuggestionMenus.configure({
        triggers: [{ char: ":", shouldShow: ({ query }) => query.length > 0 }],
      }),
    ],
    content,
  })
}

function snap(editor: Editor) {
  return getSuggestionMenus(editor).triggers["/"]!.getSnapshot()
}

function colonSnap(editor: Editor) {
  return getSuggestionMenus(editor).triggers[":"]!.getSnapshot()
}

describe("requireTypedTrigger — caret placement never opens a session", () => {
  it("doc already containing a slash run: caret into it stays closed", async () => {
    const editor = mk("<p>drop a column /dd here</p><p>target</p>")
    editor.commands.setTextSelection(1 + "drop a column /dd".length)
    await Promise.resolve()
    expect(snap(editor).show).toBe(false)
  })

  it("session exited by caret-move: returning caret does not reopen", async () => {
    const editor = mk("<p></p><p>target</p>")
    editor.commands.openSlashMenu({ pos: 1 })
    await Promise.resolve()
    editor.commands.insertContent("dd")
    await Promise.resolve()
    expect(snap(editor).show).toBe(true)
    const runEnd = editor.state.selection.from

    // Caret leaves to the second paragraph — natural exit, no dismissal.
    editor.commands.setTextSelection(editor.state.doc.content.size - 2)
    await Promise.resolve()
    expect(snap(editor).show).toBe(false)

    editor.commands.setTextSelection(runEnd)
    await Promise.resolve()
    expect(snap(editor).show).toBe(false)
  })

  // [SM-1] The `sessionAlive` typed-trigger bypass must never approve a
  // re-anchored match: while a session is open, a caret-only move past a
  // dead `/` run closes the session instead of silently adopting the dead
  // run (which would later let an item-pick delete committed text).
  it("[SM-1] open session + caret-only jump past a dead run closes (gate bypass stays safe)", async () => {
    const editor = mk("<p>note /dd here</p><p></p>")
    editor.commands.setTextSelection(16)
    editor.commands.insertContent("/")
    await Promise.resolve()
    expect(snap(editor).show).toBe(true)
    expect(snap(editor).range?.from).toBe(16)

    editor.commands.setTextSelection(14)
    await Promise.resolve()
    const s = snap(editor)
    expect(s.show).toBe(false)
    expect(s.range).toBeNull()
  })

  it("typing MORE text inside a dead run does not revive it", async () => {
    const editor = mk("<p>note /dd</p>")
    editor.commands.setTextSelection(1 + "note /dd".length)
    await Promise.resolve()
    expect(snap(editor).show).toBe(false)

    // The inserted char is query-range text, not the anchor char.
    editor.commands.insertContent("x")
    await Promise.resolve()
    expect(snap(editor).show).toBe(false)
  })
})

describe("requireTypedTrigger — typed/inserted triggers still open", () => {
  it("a typed '/' opens, query keystrokes keep the session alive", async () => {
    const editor = mk()
    editor.commands.insertContent("/")
    await Promise.resolve()
    expect(snap(editor).show).toBe(true)

    editor.commands.insertContent("he")
    await Promise.resolve()
    expect(snap(editor).show).toBe(true)
    expect(snap(editor).query).toBe("he")
  })

  it("openSlashMenu (gutter `+` path) opens", async () => {
    const editor = mk()
    editor.commands.openSlashMenu({ pos: 1 })
    await Promise.resolve()
    expect(snap(editor).show).toBe(true)
  })

  it("a fresh '/' typed inside a block that already holds a dead run opens at the NEW anchor", async () => {
    const editor = mk("<p>note /dd and</p>")
    const end = 1 + "note /dd and".length
    editor.commands.setTextSelection(end)
    await Promise.resolve()
    expect(snap(editor).show).toBe(false)

    editor.commands.insertContent(" /")
    await Promise.resolve()
    const s = snap(editor)
    expect(s.show).toBe(true)
    expect(s.range?.from).toBe(end + 1)
    expect(s.query).toBe("")
  })

  it("backspace past the '/' closes; retyping '/' reopens", async () => {
    const editor = mk()
    editor.commands.insertContent("/")
    await Promise.resolve()
    expect(snap(editor).show).toBe(true)

    editor.commands.deleteRange({ from: 1, to: 2 })
    await Promise.resolve()
    expect(snap(editor).show).toBe(false)

    editor.commands.insertContent("/")
    await Promise.resolve()
    expect(snap(editor).show).toBe(true)
  })
})

// An AI/agent tool inserts content programmatically (the AI agent-tool layer stamps
// AGENT_WRITE_META on the dispatched transaction). The user did not type the
// `/`, so it must NOT open the slash menu — even though the transaction
// genuinely inserts the char at the anchor and would otherwise pass the
// `requireTypedTrigger` gate. Mirrors the existing paste suppression.
describe("requireTypedTrigger — an agent write never opens a session", () => {
  it("inserting '/' under AGENT_WRITE_META stays closed", async () => {
    const editor = mk()
    editor.chain().setMeta(AGENT_WRITE_META, true).insertContent("/").run()
    await Promise.resolve()
    expect(snap(editor).show).toBe(false)
  })

  it("inserting a block whose text ENDS in '/' stays closed", async () => {
    const editor = mk()
    editor.chain().setMeta(AGENT_WRITE_META, true).insertContent("and/or /").run()
    await Promise.resolve()
    expect(snap(editor).show).toBe(false)
  })

  it("control: the SAME insert without the meta DOES open (proves the meta is load-bearing)", async () => {
    const editor = mk()
    editor.commands.insertContent("/")
    await Promise.resolve()
    expect(snap(editor).show).toBe(true)
  })

  it("a later USER-typed '/' still opens after an agent write (suppression is per-anchor)", async () => {
    const editor = mk()
    editor.chain().setMeta(AGENT_WRITE_META, true).insertContent("note /").run()
    await Promise.resolve()
    expect(snap(editor).show).toBe(false)

    // User types a fresh '/' at a new anchor — a real keystroke, unsuppressed.
    editor.commands.insertContent(" /")
    await Promise.resolve()
    expect(snap(editor).show).toBe(true)
  })
})

// A host `setContent` — an external/remote write landing in an open tab, a
// snapshot restore, a rehydrate — replaces the whole document. ProseMirror
// maps the old selection to the END of the incoming content, so the matcher
// scans the last text block of prose the user never typed, and the full-doc
// ReplaceStep makes `transactionInsertedAt` true at EVERY position — the
// `requireTypedTrigger` gate can't tell it from a keystroke. Reproduces the
// field report: an MCP write into the focused document popped an item-less
// slash menu (query = a sentence, zero matches, "Close menu" footer only).
describe("a whole-document swap never opens a session", () => {
  // The host sequence verbatim: swap the doc, then restore the caret the
  // swap blew away. The restore lands INSIDE the incoming `/` run, which is
  // what kept the menu on screen instead of closing it a tick later.
  function swapAndRestoreCaret(editor: Editor, html: string, caret: number) {
    editor.commands.setContent(html, { emitUpdate: false })
    const size = editor.state.doc.content.size
    editor.commands.setTextSelection(Math.min(caret, size))
  }

  it("setContent onto prose containing a legal '/' run stays closed", async () => {
    const editor = mk("<p>hello</p>")
    editor.commands.setTextSelection(3)
    swapAndRestoreCaret(editor, "<p>hello</p><p>data source /update daily</p>", 26)
    await Promise.resolve()
    expect(snap(editor).show).toBe(false)
  })

  it("a trigger WITHOUT requireTypedTrigger is covered too (suppression survives the caret restore)", async () => {
    const editor = mkColon("<p>hello</p>")
    editor.commands.setTextSelection(3)
    editor.commands.setContent("<p>hello</p><p>ping :smile</p>", { emitUpdate: false })
    await Promise.resolve()
    expect(colonSnap(editor).show).toBe(false)

    // The caret restore is a selection-only transaction: nothing but the
    // armed suppression stands between it and a fresh session here.
    editor.commands.setTextSelection(editor.state.doc.content.size - 1)
    await Promise.resolve()
    expect(colonSnap(editor).show).toBe(false)
  })

  it("the trigger still works after a swap — a '/' typed into the new doc opens", async () => {
    const editor = mk("<p>hello</p>")
    swapAndRestoreCaret(editor, "<p>hello</p><p>data source /update daily</p>", 26)
    await Promise.resolve()
    expect(snap(editor).show).toBe(false)

    editor.commands.setTextSelection(editor.state.doc.content.size - 1)
    editor.commands.insertContent(" /")
    await Promise.resolve()
    expect(snap(editor).show).toBe(true)
  })
})
