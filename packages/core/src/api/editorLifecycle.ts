// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { Editor } from "@tiptap/core"

/**
 * Tiptap's own `editor.isDestroyed` getter is `editorView?.isDestroyed ?? true`
 * — true whenever there is no live `EditorView`. That conflates two different
 * editors:
 *
 *   - A MOUNTED editor (browser DOM or jsdom) whose view was later torn down
 *     by `.destroy()`. `editorView` really did exist and really was
 *     destroyed — the flag is correct.
 *   - A HEADLESS editor (`element: null`, see `createHeadlessEditor`), which
 *     never calls `mount()` at all — `editorView` is never assigned in the
 *     FIRST place. Tiptap reports it as "destroyed" from the moment it's
 *     constructed, even though it's perfectly alive: commands still dispatch,
 *     `getJSON()` still reads back the current doc. There is no tiptap-level
 *     signal that can tell "never mounted" apart from "destroyed" here — both
 *     leave `editorView` unset — so it has to be tracked separately.
 *
 * `createHeadlessEditor` registers each instance it creates here; every other
 * editor (constructed directly with `new Editor(...)`, never routed through
 * the headless factory) falls back to tiptap's own flag, unchanged.
 */
const headlessLiveness = new WeakMap<Editor, boolean>()

/** @internal Called by `createHeadlessEditor` only. */
export function registerHeadlessEditor(editor: Editor): void {
  headlessLiveness.set(editor, true)
}

/** @internal Called by `createHeadlessEditor`'s wrapped `destroy()` only. */
export function markHeadlessEditorDestroyed(editor: Editor): void {
  headlessLiveness.set(editor, false)
}

/**
 * The one true "is this editor safe to read/write" check. Replaces every
 * direct `editor.isDestroyed` read across core and the ai package's tool
 * adapters — a headless editor (created via `createHeadlessEditor`) gets its
 * real, tracked lifecycle here instead of tiptap's always-true flag; every
 * other editor keeps tiptap's own (already-correct) semantics.
 */
export function isEditorAlive(editor: Editor): boolean {
  const headless = headlessLiveness.get(editor)
  return headless !== undefined ? headless : !editor.isDestroyed
}
