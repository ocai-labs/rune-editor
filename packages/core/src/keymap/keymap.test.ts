// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, expect, it } from "vitest"
import type { Editor } from "@tiptap/core"

import {
  RUNE_DEFAULT_KEYMAP,
  RUNE_SHORTCUT_ACTIONS,
  RUNE_SHORTCUT_ACTION_IDS,
  eventMatchesRuneKeys,
  getRuneKeymap,
  resolveRuneKeymap,
} from "./index"
import { blockSelectionKeymap } from "../extensions/block-selection/keymap"
import { createTestEditor } from "../test-utils/createTestEditor"

// Dispatch a keydown through the SAME prop chain a real keypress takes —
// every keymap plugin in priority order. Returns whether any handler
// consumed it: `false` = the chord is unbound and would bubble to the host.
// jsdom has no Mac/Windows platform marker, so prosemirror-keymap resolves
// `Mod` to Ctrl — tests use ctrlKey throughout.
function press(editor: Editor, init: KeyboardEventInit): boolean {
  const event = new KeyboardEvent("keydown", init)
  return (
    editor.view.someProp("handleKeyDown", (f) => f(editor.view, event)) ?? false
  )
}

describe("resolveRuneKeymap", () => {
  it("no overrides → the defaults, one entry per registry action", () => {
    const resolved = resolveRuneKeymap()
    expect(resolved).toEqual(RUNE_DEFAULT_KEYMAP)
    expect(Object.keys(resolved).sort()).toEqual(
      [...RUNE_SHORTCUT_ACTION_IDS].sort(),
    )
  })

  it("rebinding replaces only the targeted action", () => {
    const resolved = resolveRuneKeymap({ bold: ["Mod-Shift-q"] })
    expect(resolved.bold).toEqual(["Mod-Shift-q"])
    expect(resolved.italic).toEqual(RUNE_SHORTCUT_ACTIONS.italic.keys)
  })

  it("false and [] both unbind", () => {
    expect(resolveRuneKeymap({ link: false }).link).toEqual([])
    expect(resolveRuneKeymap({ link: [] }).link).toEqual([])
  })

  it("throws on an unknown action id", () => {
    expect(() =>
      resolveRuneKeymap({ nope: ["Mod-x"] } as never),
    ).toThrow(/unknown action "nope"/)
  })

  it("throws on a multi-step sequence (prosemirror-keymap can't match them)", () => {
    expect(() => resolveRuneKeymap({ bold: ["K L"] })).toThrow(/sequences/)
  })

  it("throws on an empty key string", () => {
    expect(() => resolveRuneKeymap({ bold: [""] })).toThrow(/empty key/)
  })
})

describe("keymap distribution (storage)", () => {
  it("kit editors expose the resolved map at editor.storage.runeKeymap", () => {
    const editor = createTestEditor({
      kit: { keymap: { bold: ["Mod-Shift-q"] } },
    })
    expect(getRuneKeymap(editor).bold).toEqual(["Mod-Shift-q"])
    expect(getRuneKeymap(editor).italic).toEqual(
      RUNE_SHORTCUT_ACTIONS.italic.keys,
    )
  })

  it("getRuneKeymap falls back to defaults without the storage extension", () => {
    const fake = { storage: {} } as Editor
    expect(getRuneKeymap(fake)).toBe(RUNE_DEFAULT_KEYMAP)
  })
})

describe("mark chords through the full keymap chain", () => {
  const selectHello = (editor: Editor) =>
    editor.commands.setTextSelection({ from: 1, to: 6 })

  it("default: Mod-b toggles bold (re-registration preserves the default)", () => {
    const editor = createTestEditor({ content: "<p>hello</p>" })
    selectHello(editor)
    expect(press(editor, { key: "b", ctrlKey: true })).toBe(true)
    expect(editor.isActive("bold")).toBe(true)
  })

  it("rebound: the new chord works, the default chord is dead", () => {
    const editor = createTestEditor({
      content: "<p>hello</p>",
      kit: { keymap: { bold: ["Mod-Shift-q"] } },
    })
    selectHello(editor)
    expect(press(editor, { key: "b", ctrlKey: true })).toBe(false)
    expect(editor.isActive("bold")).toBe(false)
    expect(press(editor, { key: "q", ctrlKey: true, shiftKey: true })).toBe(true)
    expect(editor.isActive("bold")).toBe(true)
  })

  it("unbound: the chord is NOT consumed — it would bubble to the host", () => {
    const editor = createTestEditor({
      content: "<p>hello</p>",
      kit: { keymap: { bold: false } },
    })
    selectHello(editor)
    expect(press(editor, { key: "b", ctrlKey: true })).toBe(false)
    expect(editor.isActive("bold")).toBe(false)
  })

  it("undo unbinds cleanly (history plugin itself stays registered)", () => {
    const editor = createTestEditor({
      content: "<p>hello</p>",
      kit: { keymap: { undo: false } },
    })
    editor.commands.insertContentAt(6, " world")
    expect(press(editor, { key: "z", ctrlKey: true })).toBe(false)
    expect(editor.state.doc.textContent).toContain("hello world")
    // The command path still works — only the chord was released.
    expect(editor.commands.undo()).toBe(true)
    expect(editor.state.doc.textContent).not.toContain("world")
  })

  it("hardBreak: unbinding Mod-Enter keeps the fixed structural Shift-Enter", () => {
    const editor = createTestEditor({
      content: "<p>hello</p>",
      kit: { keymap: { hardBreak: false } },
    })
    editor.commands.setTextSelection(6)
    expect(press(editor, { key: "Enter", ctrlKey: true })).toBe(false)
    expect(press(editor, { key: "Enter", shiftKey: true })).toBe(true)
    expect(editor.getHTML()).toContain("<br")
  })

  it("shifted-chord caveat: unbinding Mod-Shift-e alone leaves PM's shift-fallback offering it to Mod-e (code)", () => {
    const bound = createTestEditor({ content: "<p>hello</p>" })
    bound.commands.setTextSelection(6)
    expect(press(bound, { key: "e", ctrlKey: true, shiftKey: true })).toBe(true)

    // prosemirror-keymap semantics (NOT rune-specific): a shifted single-char
    // chord with no direct binding falls back to the unshifted binding. So
    // releasing a shifted chord to the host requires its unshifted sibling to
    // be unbound (or remapped off the base key) too.
    const mathUnbound = createTestEditor({
      content: "<p>hello</p>",
      kit: { keymap: { inlineMath: false } },
    })
    mathUnbound.commands.setTextSelection({ from: 1, to: 6 })
    expect(
      press(mathUnbound, { key: "e", ctrlKey: true, shiftKey: true }),
    ).toBe(true)
    expect(mathUnbound.isActive("code")).toBe(true)

    const bothUnbound = createTestEditor({
      content: "<p>hello</p>",
      kit: { keymap: { inlineMath: false, code: false } },
    })
    bothUnbound.commands.setTextSelection(6)
    expect(
      press(bothUnbound, { key: "e", ctrlKey: true, shiftKey: true }),
    ).toBe(false)
  })
})

describe("block-conversion actions (factory shortcutActions path)", () => {
  it("default: Mod-Alt-1 turns a paragraph into UI-H1 (<h2>, level 2)", () => {
    const editor = createTestEditor({ content: "<p>hello</p>" })
    editor.commands.setTextSelection(3)
    expect(press(editor, { key: "1", ctrlKey: true, altKey: true })).toBe(true)
    expect(editor.isActive("heading", { level: 2 })).toBe(true)
  })

  it("rebound: new chord converts, default chord is dead", () => {
    const editor = createTestEditor({
      content: "<p>hello</p>",
      kit: { keymap: { blockHeading1: ["Mod-Alt-9"] } },
    })
    editor.commands.setTextSelection(3)
    expect(press(editor, { key: "1", ctrlKey: true, altKey: true })).toBe(false)
    expect(editor.isActive("paragraph")).toBe(true)
    expect(press(editor, { key: "9", ctrlKey: true, altKey: true })).toBe(true)
    expect(editor.isActive("heading", { level: 2 })).toBe(true)
  })
})

describe("blockSelectionKeymap tiers", () => {
  it("defaults: remappable chords present alongside fixed structural keys", () => {
    const map = blockSelectionKeymap()
    for (const key of [
      "Mod-a",
      "Mod-d",
      "Mod-ArrowUp",
      "Mod-Shift-ArrowUp",
      "Mod-ArrowDown",
      "Mod-Shift-ArrowDown",
      "Escape",
      "Enter",
      "Backspace",
      "Delete",
    ]) {
      expect(map, key).toHaveProperty([key])
    }
  })

  it("overrides move the remappable chords and leave structural keys alone", () => {
    const map = blockSelectionKeymap(
      resolveRuneKeymap({ blockDuplicate: ["Mod-Shift-9"], selectExpand: false }),
    )
    expect(map).toHaveProperty(["Mod-Shift-9"])
    expect(map).not.toHaveProperty(["Mod-d"])
    expect(map).not.toHaveProperty(["Mod-a"])
    expect(map).toHaveProperty(["Escape"])
    expect(map).toHaveProperty(["Enter"])
  })
})

describe("eventMatchesRuneKeys (DOM-listener surfaces, e.g. the link chord)", () => {
  it("matches with prosemirror-keymap semantics; [] never matches", () => {
    const editor = createTestEditor({ content: "<p>hello</p>" })
    const ctrlK = new KeyboardEvent("keydown", { key: "k", ctrlKey: true })
    const bareK = new KeyboardEvent("keydown", { key: "k" })
    expect(eventMatchesRuneKeys(editor.view, ctrlK, ["Mod-k"])).toBe(true)
    expect(eventMatchesRuneKeys(editor.view, bareK, ["Mod-k"])).toBe(false)
    expect(eventMatchesRuneKeys(editor.view, ctrlK, [])).toBe(false)
  })
})
