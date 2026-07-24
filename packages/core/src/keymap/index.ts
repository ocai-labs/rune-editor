// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The remappable-shortcut registry — the machine-readable source of truth a
// host app (settings UI, conflict checker) reads instead of hand-auditing
// rune's keymap, plus the override channel `createRuneKit({ keymap })`.
//
// Scope: ONLY user-facing chords (the Mod-combos a host could want for its own
// commands) are remappable. Structural editing keys — Enter/Tab/Backspace/
// arrow/Escape context behaviors, the `/` `:` `[[` triggers, menu navigation —
// are editing semantics, not shortcuts; they stay fixed and are deliberately
// absent from this registry.
//
// Distribution: `createRuneKit` resolves overrides once and registers the
// result as extension storage (`editor.storage.runeKeymap`). Every remappable
// binding site reads it back via `getRuneKeymap(this.editor)` inside its
// `addKeyboardShortcuts()` — Tiptap invokes those AFTER all extension storages
// exist, so the storage extension is the one distribution channel and no
// per-extension option threading is needed. Sites outside a kit (a block
// registered raw in a test) fall back to the defaults.
//
// Unbinding (`false` / `[]`) means the chord is NOT registered at all — the
// keydown falls through PM unhandled and bubbles to the host's own dispatcher.
// Never "disable" a chord by consuming it with a truthy handler: that eats the
// key for everyone, which is the opposite of releasing it.

import { Extension, type Editor } from "@tiptap/core"
import { keydownHandler } from "@tiptap/pm/keymap"
import type { EditorView } from "@tiptap/pm/view"

/** Stable ids for every remappable shortcut action. These are a public
 *  contract with host keybinding UIs — renaming one is a breaking change. */
export type RuneShortcutActionId =
  | "bold"
  | "italic"
  | "underline"
  | "strike"
  | "code"
  | "inlineMath"
  | "link"
  | "undo"
  | "redo"
  | "hardBreak"
  | "blockParagraph"
  | "blockHeading1"
  | "blockHeading2"
  | "blockHeading3"
  | "blockHeading4"
  | "blockToggle"
  | "toggleCollapse"
  | "selectExpand"
  | "blockDuplicate"
  | "blockMoveUp"
  | "blockMoveDown"
  | "tableDelete"

export interface RuneShortcutActionSpec {
  /** Default bindings in prosemirror-keymap dialect (`"Mod-Alt-1"`),
   *  most-preferred first. Single chords only — no multi-step sequences. */
  keys: readonly string[]
  /** Human-readable label for host settings UIs. */
  label: string
}

/** Canonical registry: every remappable action with its default keys.
 *  prosemirror-keymap's keyCode fallback covers layout/caps variants (CapsLock
 *  `Mod-B`, Cyrillic `Mod-я` → the physical key's base name), so each action
 *  lists only canonical chords — no belt-and-braces aliases. */
export const RUNE_SHORTCUT_ACTIONS: Readonly<
  Record<RuneShortcutActionId, RuneShortcutActionSpec>
> = {
  bold: { keys: ["Mod-b"], label: "Bold" },
  italic: { keys: ["Mod-i"], label: "Italic" },
  underline: { keys: ["Mod-u"], label: "Underline" },
  strike: { keys: ["Mod-Shift-s"], label: "Strikethrough" },
  code: { keys: ["Mod-e"], label: "Inline code" },
  inlineMath: { keys: ["Mod-Shift-e"], label: "Inline math" },
  // Bound in @ocai/rune-react (InlineToolbar's document listener while the
  // toolbar is open), not in a core keymap — listed here so hosts see the full
  // conflict surface and can remap/unbind it through the same channel.
  link: { keys: ["Mod-k"], label: "Link" },
  undo: { keys: ["Mod-z"], label: "Undo" },
  redo: { keys: ["Shift-Mod-z", "Mod-y"], label: "Redo" },
  // Shift-Enter also inserts a hard break but is a fixed structural key —
  // only the Mod-Enter chord participates in remapping.
  hardBreak: { keys: ["Mod-Enter"], label: "Hard break" },
  blockParagraph: { keys: ["Mod-Alt-0"], label: "Turn into text" },
  // UI heading 1..4 store internal level 2..5 (<h2>..<h5>) — the page reserves
  // <h1> for the document title. The action ids follow the UI numbering.
  blockHeading1: { keys: ["Mod-Alt-1"], label: "Turn into heading 1" },
  blockHeading2: { keys: ["Mod-Alt-2"], label: "Turn into heading 2" },
  blockHeading3: { keys: ["Mod-Alt-3"], label: "Turn into heading 3" },
  blockHeading4: { keys: ["Mod-Alt-4"], label: "Turn into heading 4" },
  blockToggle: { keys: ["Mod-Shift-7"], label: "Turn into toggle" },
  toggleCollapse: { keys: ["Mod-Alt-T"], label: "Expand/collapse toggle" },
  selectExpand: { keys: ["Mod-a"], label: "Expand selection" },
  blockDuplicate: { keys: ["Mod-d"], label: "Duplicate block" },
  blockMoveUp: {
    keys: ["Mod-ArrowUp", "Mod-Shift-ArrowUp"],
    label: "Move block up",
  },
  blockMoveDown: {
    keys: ["Mod-ArrowDown", "Mod-Shift-ArrowDown"],
    label: "Move block down",
  },
  tableDelete: { keys: ["Mod-Backspace", "Mod-Delete"], label: "Delete table" },
}

export const RUNE_SHORTCUT_ACTION_IDS = Object.keys(
  RUNE_SHORTCUT_ACTIONS,
) as readonly RuneShortcutActionId[]

/** Per-action override: `string[]` rebinds (prosemirror-keymap dialect, may
 *  list several chords), `false` or `[]` unbinds — the default chord is then
 *  NOT registered and bubbles to the host's own shortcut dispatcher. */
export type RuneKeymapOverrides = Partial<
  Record<RuneShortcutActionId, readonly string[] | false>
>

/** The effective action → chords map after applying overrides. `[]` = unbound. */
export type ResolvedRuneKeymap = Readonly<
  Record<RuneShortcutActionId, readonly string[]>
>

export const RUNE_DEFAULT_KEYMAP: ResolvedRuneKeymap = Object.fromEntries(
  RUNE_SHORTCUT_ACTION_IDS.map((id) => [id, RUNE_SHORTCUT_ACTIONS[id].keys]),
) as Record<RuneShortcutActionId, readonly string[]>

/** Apply host overrides over the defaults. Throws on an unknown action id or a
 *  malformed chord so a host misdeclaration surfaces at kit-build time, not as
 *  a silently dead binding. */
export function resolveRuneKeymap(
  overrides?: RuneKeymapOverrides,
): ResolvedRuneKeymap {
  if (!overrides) return RUNE_DEFAULT_KEYMAP
  const resolved: Record<string, readonly string[]> = { ...RUNE_DEFAULT_KEYMAP }
  for (const [id, value] of Object.entries(overrides)) {
    if (!(id in RUNE_SHORTCUT_ACTIONS)) {
      throw new Error(`[rune] keymap override for unknown action "${id}"`)
    }
    if (value === undefined) continue
    if (value === false) {
      resolved[id] = []
      continue
    }
    for (const key of value) {
      if (typeof key !== "string" || key.length === 0) {
        throw new Error(`[rune] keymap override for "${id}": empty key`)
      }
      // prosemirror-keymap has no multi-step sequences; a spaced string like
      // "K L" would register a binding that can never match. Reject loudly so
      // hosts translate sequence bindings before handing them to the editor.
      if (/\s/.test(key)) {
        throw new Error(
          `[rune] keymap override for "${id}": "${key}" — multi-step sequences are not supported in the editor keymap`,
        )
      }
    }
    resolved[id] = [...value]
  }
  return resolved as ResolvedRuneKeymap
}

/** The storage extension `createRuneKit` registers to distribute the resolved
 *  keymap. Its storage IS the resolved map: `editor.storage.runeKeymap`. */
export function createRuneKeymapState(resolved: ResolvedRuneKeymap) {
  return Extension.create({
    name: "runeKeymap",
    addStorage() {
      return resolved
    },
  })
}

/** The editor's effective keymap. Falls back to the defaults when the storage
 *  extension isn't registered (a block or extension used outside createRuneKit,
 *  e.g. raw in a test) so binding sites behave identically either way. */
export function getRuneKeymap(editor: Editor): ResolvedRuneKeymap {
  // `?? {}` also guards hand-rolled Editor stubs (tests / imperative callers)
  // that carry no storage object at all.
  const stored = (
    (editor.storage ?? {}) as Partial<Record<"runeKeymap", ResolvedRuneKeymap>>
  ).runeKeymap
  return stored ?? RUNE_DEFAULT_KEYMAP
}

/** Fan a handler out over an action's resolved chords, in Tiptap
 *  `addKeyboardShortcuts()` shape. `keys: []` → `{}` (the action is unbound
 *  and its chord is simply never registered). */
export function bindShortcutKeys<H>(
  keys: readonly string[],
  handler: H,
): Record<string, H> {
  return Object.fromEntries(keys.map((key) => [key, handler]))
}

/** Does this DOM keydown match any of the given prosemirror-keymap chords?
 *  Delegates to prosemirror-keymap's own matcher (via a probe handler map), so
 *  DOM-listener surfaces — e.g. the react InlineToolbar's link chord — use
 *  EXACTLY the normalization PM keymaps use (Mod resolution, Shift handling,
 *  keyCode base fallback), with zero drift. */
export function eventMatchesRuneKeys(
  view: EditorView,
  event: KeyboardEvent,
  keys: readonly string[],
): boolean {
  if (keys.length === 0) return false
  return keydownHandler(bindShortcutKeys(keys, () => true))(view, event)
}
