// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { Editor, type JSONContent } from "@tiptap/core"
import { createRuneKit, type CreateRuneKitOptions } from "../kit"
import { markHeadlessEditorDestroyed, registerHeadlessEditor } from "./editorLifecycle"
import { ensureHeadlessGlobals } from "./headlessDom"

/**
 * Construct a fully-functional Rune `Editor` with no DOM/window/document
 * dependency at all — safe from Electron main, a server, a CLI, or a bare
 * Node process with zero ambient globals (see `runRuneToolOnDocument` in
 * `@ocai/rune-ai`, the primary consumer).
 *
 * Uses the `element: null` construction Tiptap documents for SSR (the same
 * pattern `exportMarkdownFromDoc` already relies on) — but ALSO does the one
 * extra step SSR usually gets away without: wiring the extensions' own
 * ProseMirror plugins into editor state. Tiptap only does that inside
 * `createView()`, reachable exclusively through `mount(element)` — which
 * `element: null` skips entirely (see `extensions/block-id.ts`'s
 * onBeforeCreate comment for the same observation). Skipping it would
 * silently disable every appendTransaction-driven invariant an agent-tool
 * write depends on: new-block id backfill, list renumbering, table/column
 * normalization, and so on — a plain `new Editor({ element: null, ... })`
 * only appears to work because simple docs don't exercise any of that.
 *
 * `editor.extensionManager.plugins` must be read EXACTLY ONCE per editor
 * (matching what a real `mount()` does): it's a getter that reruns each
 * extension's `addProseMirrorPlugins()` on every access, and at least one
 * extension (`SuggestionMenus`) registers stateful per-trigger storage as a
 * side effect — a second read throws "duplicate trigger char". Cache the
 * result locally; never call the getter again for this instance.
 *
 * `editor.isDestroyed` can never distinguish "never mounted" from "destroyed"
 * for this construction mode (see `editorLifecycle.ts`) — pair this editor
 * with `isEditorAlive`, not `editor.isDestroyed`, wherever its liveness
 * matters.
 *
 * Also self-installs the couple of browser globals a handful of write
 * commands assume are ambient (`DOMParser`, `requestAnimationFrame`) when
 * they're missing — see `ensureHeadlessGlobals` — so a caller in a bare Node
 * process never has to inject anything itself.
 */
export function createHeadlessEditor(
  content: JSONContent,
  options?: CreateRuneKitOptions,
): Editor {
  ensureHeadlessGlobals()
  const editor = new Editor({
    element: null,
    extensions: createRuneKit(options),
    content,
  })
  const plugins = editor.extensionManager.plugins
  editor.view.updateState(editor.state.reconfigure({ plugins }))
  registerHeadlessEditor(editor)

  const destroy = editor.destroy.bind(editor)
  editor.destroy = () => {
    markHeadlessEditorDestroyed(editor)
    destroy()
  }

  return editor
}
