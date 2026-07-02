// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Notion-model slash matching — reference behavior captured in
// internal design notes.
// Two layers:
//   1. pure matcher calls (config + explicit session runs in current-doc
//      coordinates, as the session-run mapper would hand them over),
//   2. live-plugin integration (SuggestionMenus wired with the matcher,
//      driving the editor through transactions like the suppression specs).
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Editor, Mark } from "@tiptap/core"
import Document from "@tiptap/extension-document"
import Text from "@tiptap/extension-text"
import { createBlockSpec } from "../../../schema"
import { SuggestionMenus } from "../SuggestionMenus"
import { getSuggestionMenus } from "../getSuggestionMenus"
import { slashMatcher } from "./slashMatcher"

const Para = createBlockSpec({
  type: "paragraph",
  content: "inline*",
  parseDOM: [{ tag: "p" }],
  renderDOM: ({ HTMLAttributes }) => ["p", HTMLAttributes, 0],
})

// Minimal mark so a plain `/` typed after marked text lands in a separate
// text node — the boundary that fools the default node-local prefix check.
const Bold = Mark.create({
  name: "bold",
  parseHTML: () => [{ tag: "strong" }],
  renderHTML: () => ["strong", 0],
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
      Bold,
      Para,
      SuggestionMenus.configure({
        // Mirror the kit's production trigger: requireTypedTrigger is part
        // of the Notion session model (case 10 — sessions only START on
        // the `/` keystroke). Without it, post-exit bookkeeping
        // transactions (e.g. the fade plugin's meta dispatch) re-run the
        // fresh-anchor scan and re-open the menu on a dead `/` run.
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

function store(editor: Editor) {
  return getSuggestionMenus(editor).triggers["/"]!
}

function snap(editor: Editor) {
  return store(editor).getSnapshot()
}

// ---------------------------------------------------------------- layer 1

function matchAtCaret(
  editor: Editor,
  run?: { from: number; to: number } | null,
) {
  return slashMatcher(
    {
      char: "/",
      allowSpaces: true,
      allowToIncludeChar: false,
      allowedPrefixes: [" "],
      startOfLine: false,
      $position: editor.state.selection.$from,
    },
    run,
  )
}

describe("slashMatcher (pure)", () => {
  it("anchors at a block-start slash", () => {
    const editor = mk()
    editor.commands.insertContent("/he")
    const m = matchAtCaret(editor, null)
    expect(m).toEqual({
      range: { from: 1, to: 4 },
      query: "he",
      text: "/he",
    })
  })

  it("anchors after whitespace; rejects a word-char prefix", () => {
    const editor = mk()
    editor.commands.insertContent("hello /x")
    expect(matchAtCaret(editor, null)?.range.from).toBe(7)

    const inert = mk()
    inert.commands.insertContent("hello/x")
    expect(matchAtCaret(inert, null)).toBeNull()
    inert.destroy()
  })

  it("prefix gate reads the whole textblock across mark boundaries", () => {
    const editor = mk("<p><strong>hello</strong></p>")
    editor.commands.setTextSelection(6)
    editor.commands.unsetMark("bold")
    editor.commands.insertContent("/", {
      applyInputRules: false,
      applyPasteRules: false,
    })
    // Two text nodes ("hello" bold + "/" plain) — the char before the
    // slash is still "o", so no match.
    expect(editor.state.doc.firstChild?.childCount).toBe(2)
    expect(matchAtCaret(editor, null)).toBeNull()
  })

  it("fresh scan picks the LAST legal slash, skipping illegal ones after it", () => {
    const editor = mk()
    editor.commands.insertContent("/a b /c")
    // No session: anchor is the second slash (pos 6), not the first.
    const m = matchAtCaret(editor, null)
    expect(m?.range.from).toBe(6)
    expect(m?.query).toBe("c")
  })

  it("sticky session keeps the original anchor through spaces and slashes", () => {
    const editor = mk()
    editor.commands.insertContent("/a /")
    // Run as the mapper tracks it: anchored at 1, extended to 5 by the
    // typed " /" (right-edge insertions join the query, assoc 1).
    const m = matchAtCaret(editor, { from: 1, to: 5 })
    expect(m).toEqual({
      range: { from: 1, to: 5 },
      query: "a /",
      text: "/a /",
    })
  })

  // The run's right edge is the furthest the session has reached, not the
  // caret. A caret-only move back INSIDE the run keeps the whole query —
  // truncating at the caret made the trigger decoration chase the caret
  // (visible seam) and, with the caret right after the `/`, emptied the
  // query so the "Type to search" ghost re-appeared mid-run.
  it("caret-only move inside the run keeps the whole query", () => {
    const editor = mk()
    editor.commands.insertContent("/oc")
    editor.commands.setTextSelection(3) // /o|c
    expect(matchAtCaret(editor, { from: 1, to: 4 })).toEqual({
      range: { from: 1, to: 4 },
      query: "oc",
      text: "/oc",
    })
  })

  it("caret right after the anchor keeps the query non-empty (no ghost mid-run)", () => {
    const editor = mk()
    editor.commands.insertContent("/oc")
    editor.commands.setTextSelection(2) // /|oc
    expect(matchAtCaret(editor, { from: 1, to: 4 })).toEqual({
      range: { from: 1, to: 4 },
      query: "oc",
      text: "/oc",
    })
  })

  it("pre-existing text right of the run is never swallowed into the query", () => {
    const editor = mk()
    // "/x" typed immediately before pre-existing "brown": the run is "/x",
    // "brown" was never part of the session and must stay outside it.
    editor.commands.insertContent("hello brown")
    editor.commands.setTextSelection(7)
    editor.commands.insertContent("/x")
    expect(matchAtCaret(editor, { from: 7, to: 9 })).toEqual({
      range: { from: 7, to: 9 },
      query: "x",
      text: "/x",
    })
  })

  it("caret past the run end returns null (the run never chases the caret right)", () => {
    const editor = mk()
    // Run covers "/o"; the trailing "c" was never query text. A caret-only
    // move past the run's right edge dismisses.
    editor.commands.insertContent("/oc")
    editor.commands.setTextSelection(4)
    expect(matchAtCaret(editor, { from: 1, to: 3 })).toBeNull()
  })

  it("caret ON the anchor returns null (ArrowLeft onto the `/`)", () => {
    const editor = mk()
    editor.commands.insertContent("/oc")
    editor.commands.setTextSelection(1)
    expect(matchAtCaret(editor, { from: 1, to: 4 })).toBeNull()
  })

  it("a run end past the block end clamps to the block text", () => {
    const editor = mk()
    editor.commands.insertContent("/o") // block ends at 3; run claims 4
    expect(matchAtCaret(editor, { from: 1, to: 4 })).toEqual({
      range: { from: 1, to: 3 },
      query: "o",
      text: "/o",
    })
  })

  // [SM-1] An OPEN session must never re-anchor onto a different `/` run.
  // The fresh-anchor scan is only for the opening transaction (no run);
  // once open, any failure of the sticky checks closes the session (spec
  // case 10: sessions only START on the `/` keystroke — a silent re-anchor
  // is an untyped session start).
  it("[SM-1 probe A] open session + caret-only jump past a dead run in another block → null", () => {
    const editor = mk("<p>note /dd here</p><p></p>")
    // Session anchored to a "/" typed in p2 (pos 16); caret-only move to
    // the end of p1 (pos 14), which contains the dead "/dd here" run.
    editor.commands.setTextSelection(14)
    expect(matchAtCaret(editor, { from: 16, to: 17 })).toBeNull()
  })

  it("[SM-1 probe B] open session + ArrowLeft onto the anchor with an earlier dead run → null", () => {
    const editor = mk()
    editor.commands.insertContent("note /dd and x /")
    // Session anchored to the trailing "/" (pos 16); ArrowLeft puts the
    // caret ON the anchor (caret === from).
    editor.commands.setTextSelection(16)
    expect(matchAtCaret(editor, { from: 16, to: 17 })).toBeNull()
  })

  it("[SM-1] backspace deleting the live '/' with an earlier dead run in the block → null", () => {
    const editor = mk()
    // Post-backspace doc: the live "/" at pos 14 is gone, caret sits at
    // its old position; "/dd" at pos 6 is a dead run. The run's end now
    // hangs past the block end and clamps down onto the anchor → null.
    // (In the live system the mapper collapses this run to null anyway;
    // the matcher must reject it on its own too.)
    editor.commands.insertContent("note /dd and ")
    editor.commands.setTextSelection(14)
    expect(matchAtCaret(editor, { from: 14, to: 15 })).toBeNull()
  })

  // [SM-1] Inverted from "falls back to a fresh scan when the anchor char
  // is gone": that fall-through WAS the bug's vector — with the
  // `requireTypedTrigger` gate bypassed for live sessions, it silently
  // re-anchored the open menu onto another `/` run with no typed trigger
  // (contradicting spec case 10). An anchor that no longer holds the
  // trigger char now ends the session.
  it("sticky session CLOSES (no fresh re-scan) when the anchor char is gone", () => {
    const editor = mk()
    editor.commands.insertContent("a /x")
    // Caret inside the run so the trigger-char gate is the deciding check;
    // pos 1 holds "a", not "/".
    editor.commands.setTextSelection(2)
    expect(matchAtCaret(editor, { from: 1, to: 2 })).toBeNull()
  })
})

// ---------------------------------------------------------------- layer 2

describe("slash session through the live plugin (Notion edge-case report)", () => {
  it("case 6: '/a /' — one session, second slash is query text", async () => {
    const editor = mk()
    editor.commands.openSlashMenu({ pos: 1 })
    await Promise.resolve()
    editor.commands.insertContent("a /")
    await Promise.resolve()
    const s = snap(editor)
    expect(s.show).toBe(true)
    expect(s.range?.from).toBe(1)
    expect(s.query).toBe("a /")
  })

  it("case 6: backspacing the second slash restores the previous query", async () => {
    const editor = mk()
    editor.commands.openSlashMenu({ pos: 1 })
    await Promise.resolve()
    editor.commands.insertContent("a /")
    await Promise.resolve()
    const end = editor.state.selection.from
    editor.commands.deleteRange({ from: end - 1, to: end })
    await Promise.resolve()
    const s = snap(editor)
    expect(s.show).toBe(true)
    expect(s.range?.from).toBe(1)
    expect(s.query).toBe("a ")
  })

  it("case 2: '/ ' keeps the session open with the space as query", async () => {
    const editor = mk()
    editor.commands.openSlashMenu({ pos: 1 })
    await Promise.resolve()
    editor.commands.insertContent(" ")
    await Promise.resolve()
    const s = snap(editor)
    expect(s.show).toBe(true)
    expect(s.query).toBe(" ")
  })

  it("case 4: mark-boundary '/' after a word char stays inert", async () => {
    const editor = mk("<p><strong>hello</strong></p>")
    editor.commands.setTextSelection(6)
    editor.commands.unsetMark("bold")
    editor.commands.insertContent("/", {
      applyInputRules: false,
      applyPasteRules: false,
    })
    await Promise.resolve()
    expect(snap(editor).show).toBe(false)
  })

  it("a fresh slash after a dismissed one opens a NEW session at the new anchor", async () => {
    const editor = mk()
    editor.commands.openSlashMenu({ pos: 1 })
    await Promise.resolve()
    editor.commands.insertContent("a")
    await Promise.resolve()
    // Dismiss (mirrors the React controller's explicit-dismiss path).
    store(editor).suppressedAt.current = 1
    editor.view.dispatch(editor.state.tr)
    await Promise.resolve()
    expect(snap(editor).show).toBe(false)

    // Type " /x" — the new slash has a legal (whitespace) prefix and a
    // different anchor position, so it must open despite the suppression
    // at pos 1.
    editor.commands.insertContent(" /x")
    await Promise.resolve()
    const s = snap(editor)
    expect(s.show).toBe(true)
    expect(s.range?.from).toBe(4)
    expect(s.query).toBe("x")
  })

  // REGRESSION PIN — the rejected content heuristic ("extend the run past
  // the caret by whatever suffix of the previous query sits there")
  // corrupted the query when pre-existing text right of the run happened
  // to start with such a suffix: typing /b then x right before "bob"
  // yielded query "bxb" with the range over-extended into "bob", so an
  // item pick would have deleted a character of user text. Positional
  // mapping cannot confuse the two.
  it("typing /bx immediately before 'bob' keeps the query 'bx' and the run tight", async () => {
    const editor = mk()
    editor.commands.insertContent("hello bob")
    editor.commands.openSlashMenu({ pos: 7 })
    await Promise.resolve()
    editor.commands.insertContent("b")
    await Promise.resolve()
    editor.commands.insertContent("x")
    await Promise.resolve()
    const s = snap(editor)
    expect(s.show).toBe(true)
    expect(s.query).toBe("bx")
    expect(s.range).toEqual({ from: 7, to: 10 })
  })

  it("caret-left back inside the run keeps the query and range whole", async () => {
    const editor = mk()
    editor.commands.openSlashMenu({ pos: 1 })
    await Promise.resolve()
    editor.commands.insertContent("oc")
    await Promise.resolve()
    editor.commands.setTextSelection(2) // /|oc
    await Promise.resolve()
    const s = snap(editor)
    expect(s.show).toBe(true)
    expect(s.query).toBe("oc")
    expect(s.range).toEqual({ from: 1, to: 4 })
  })

  it("caret-left then typing keeps the run contiguous (no decoration split)", async () => {
    const editor = mk()
    editor.commands.openSlashMenu({ pos: 1 })
    await Promise.resolve()
    editor.commands.insertContent("oc")
    await Promise.resolve()
    editor.commands.setTextSelection(2) // /|oc
    await Promise.resolve()
    editor.commands.insertContent("t") // doc: /toc, caret /t|oc
    await Promise.resolve()
    const s = snap(editor)
    expect(s.show).toBe(true)
    expect(s.query).toBe("toc")
    expect(s.range).toEqual({ from: 1, to: 5 })
  })

  it("backspace at the run end shrinks the query", async () => {
    const editor = mk()
    editor.commands.openSlashMenu({ pos: 1 })
    await Promise.resolve()
    editor.commands.insertContent("oc")
    await Promise.resolve()
    editor.commands.deleteRange({ from: 3, to: 4 }) // backspace the "c"
    await Promise.resolve()
    const s = snap(editor)
    expect(s.show).toBe(true)
    expect(s.query).toBe("o")
    expect(s.range).toEqual({ from: 1, to: 3 })
  })

  it("caret-only ArrowRight past the run end CLOSES the session", async () => {
    const editor = mk("<p>tail</p>")
    editor.commands.openSlashMenu({ pos: 1 }) // doc: /tail
    await Promise.resolve()
    editor.commands.insertContent("o") // doc: /otail, run "/o"
    await Promise.resolve()
    expect(snap(editor).show).toBe(true)
    expect(snap(editor).range).toEqual({ from: 1, to: 3 })

    // Caret-only move one step right, into the pre-existing "tail" — that
    // text was never query; the session must close, not extend over it.
    editor.commands.setTextSelection(4)
    await Promise.resolve()
    const s = snap(editor)
    expect(s.show).toBe(false)
    expect(s.range).toBeNull()
  })

  // [AR-3 pin] An edit strictly BEFORE the anchor no longer kills the
  // session: the mapper shifts the run right and the query is untouched.
  // (Under the old snapshot model the unmapped anchor failed the
  // trigger-char check and the session closed.)
  it("an edit before the anchor shifts the run and keeps the session open", async () => {
    const editor = mk()
    editor.commands.insertContent("hello bob")
    editor.commands.openSlashMenu({ pos: 7 })
    await Promise.resolve()
    editor.commands.insertContent("x")
    await Promise.resolve()
    expect(snap(editor).query).toBe("x")
    expect(snap(editor).range).toEqual({ from: 7, to: 9 })

    // Programmatic insert at pos 1 — PM maps the selection automatically,
    // so the caret stays inside the (shifted) run.
    editor.view.dispatch(editor.state.tr.insertText("ZZ", 1))
    await Promise.resolve()
    const s = snap(editor)
    expect(s.show).toBe(true)
    expect(s.query).toBe("x")
    expect(s.range).toEqual({ from: 9, to: 11 })
  })

  it("[SM-1 probe A] caret-only move past a dead run CLOSES the open session", async () => {
    const editor = mk("<p>note /dd here</p><p></p>")
    // Open a session with a typed "/" in p2 (content pos 16).
    editor.commands.setTextSelection(16)
    editor.commands.insertContent("/")
    await Promise.resolve()
    expect(snap(editor).show).toBe(true)
    expect(snap(editor).range?.from).toBe(16)

    // Caret-only move to the end of p1, past the dead "/dd here" run. The
    // live menu must close — not silently jump to the dead run.
    editor.commands.setTextSelection(14)
    await Promise.resolve()
    const s = snap(editor)
    expect(s.show).toBe(false)
    expect(s.range).toBeNull()
  })

  it("[SM-1 probe B] ArrowLeft onto the anchor with an earlier dead run CLOSES the session", async () => {
    const editor = mk("<p>note /dd and x</p>")
    editor.commands.setTextSelection(15)
    editor.commands.insertContent(" /")
    await Promise.resolve()
    expect(snap(editor).show).toBe(true)
    expect(snap(editor).range?.from).toBe(16)

    // ArrowLeft: caret lands ON the anchor (caret === from). Must close,
    // not re-anchor to "/dd" with query "dd and x ".
    editor.commands.setTextSelection(16)
    await Promise.resolve()
    const s = snap(editor)
    expect(s.show).toBe(false)
    expect(s.range).toBeNull()
  })

  it("[SM-1] backspacing the live '/' with an earlier dead run CLOSES the session", async () => {
    const editor = mk("<p>note /dd and</p>")
    editor.commands.setTextSelection(13)
    editor.commands.insertContent(" /")
    await Promise.resolve()
    expect(snap(editor).show).toBe(true)
    expect(snap(editor).range?.from).toBe(14)

    // Backspace deletes the live "/" — the session must end even though
    // the dead "/dd" run at pos 6 is still in the block.
    editor.commands.deleteRange({ from: 14, to: 15 })
    await Promise.resolve()
    const s = snap(editor)
    expect(s.show).toBe(false)
    expect(s.range).toBeNull()
  })

  it("deleting back past the '/' ends the session", async () => {
    const editor = mk()
    editor.commands.openSlashMenu({ pos: 1 })
    await Promise.resolve()
    expect(snap(editor).show).toBe(true)
    editor.commands.deleteRange({ from: 1, to: 2 })
    await Promise.resolve()
    expect(snap(editor).show).toBe(false)
  })
})
