// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { Editor } from "@tiptap/core"
import { TextSelection } from "@tiptap/pm/state"
import type { ResolvedPos } from "@tiptap/pm/model"
import { MultiBlockSelection } from "./MultiBlockSelection"
import { firstSelectableIndex, isBlockSelectable } from "./selectable"
import { blockSelectionKey, type BlockSelectionPluginMeta } from "./plugin"
import {
  surfaceBlockTextBoundsAtPos,
  type ResolvedSurface,
} from "../../schema/bodySurface"

// Tiptap's addKeyboardShortcuts handlers receive `{ editor }` and must
// return true to mark the key consumed.
export function blockSelectionKeymap(): Record<string, (props: { editor: Editor }) => boolean> {
  return {
    "Mod-a": ({ editor }) => handleModA(editor),
    Escape: ({ editor }) => handleEscape(editor),
    "Mod-ArrowUp": ({ editor }) => editor.commands.moveBlockUp(),
    "Mod-ArrowDown": ({ editor }) => editor.commands.moveBlockDown(),
    "Mod-Shift-ArrowUp": ({ editor }) => editor.commands.moveBlockUp(),
    "Mod-Shift-ArrowDown": ({ editor }) => editor.commands.moveBlockDown(),
    ArrowUp: ({ editor }) => handleArrow(editor, -1),
    ArrowDown: ({ editor }) => handleArrow(editor, +1),
    "Shift-ArrowUp": ({ editor }) => handleShiftArrow(editor, -1),
    "Shift-ArrowDown": ({ editor }) => handleShiftArrow(editor, +1),
    ArrowLeft: ({ editor }) => consumeIfBlockMode(editor),
    ArrowRight: ({ editor }) => consumeIfBlockMode(editor),
    Enter: ({ editor }) => handleEnter(editor),
    Backspace: ({ editor }) => deleteOnBlockSelection(editor),
    Delete: ({ editor }) => deleteOnBlockSelection(editor),
    "Mod-d": ({ editor }) => editor.commands.duplicateBlocks(),
  }
}

// A ResolvedPos whose `.parent` is the MBS's surface node, so
// `MultiBlockSelection.create(doc, lo, hi, surfaceArg)` reads that surface's
// children. `undefined` ≡ root (the doc), matching the historical signature.
function surfaceArg(doc: import("@tiptap/pm/model").Node, surface: ResolvedSurface): ResolvedPos | undefined {
  return surface.pos === -1 ? undefined : doc.resolve(surface.start)
}

// The surface of an existing MBS, as a ResolvedPos for the `create` factory.
function mbsSurfaceArg(sel: MultiBlockSelection): ResolvedPos | undefined {
  return sel.surface === sel.$anchor.doc ? undefined : sel.$anchor
}

// The number of body blocks on an MBS's surface.
function mbsSurfaceChildCount(sel: MultiBlockSelection): number {
  return sel.surface.childCount
}

function handleModA(editor: Editor): boolean {
  const { state } = editor
  const { selection, doc } = state
  const N = doc.childCount // ROOT child count — Mod-A's expansion target is ALWAYS root (F4).
  // First SELECTABLE root index — skips a leading non-selectable block (the
  // title). The full-root MBS is [lo, N-1], so the title is never swept in.
  const lo = firstSelectableIndex(doc)

  // Already in MultiBlockSelection — expand to the ROOT full MBS, or no-op.
  // F4: a column-local MBS + Mod-A jumps straight to the layout-as-one-unit
  // ROOT selection (there is NO column-local Mod-A stage). A root full MBS is
  // a no-op. We never expand within a column surface.
  if (selection instanceof MultiBlockSelection) {
    const isRootSurface = selection.surface === doc
    if (isRootSurface) {
      const [curLo, curHi] = selection.blockIndices
      if (curLo === lo && curHi === N - 1) return true // already all selectable root blocks, no-op
    }
    if (lo >= N) return true // nothing selectable; consume and no-op
    editor.commands.setBlockSelection({ from: lo, to: N - 1 })
    return true
  }

  if (!(selection instanceof TextSelection)) return false

  // Stage 1 vs 2: is the whole CONTAINING block's text selected? "Containing
  // block" is surface-aware — for an in-column caret it is the COLUMN CHILD,
  // not the whole layout (so stage 1 scopes to the column child's text).
  const block = surfaceBlockTextBoundsAtPos(state.doc, selection.from)
  if (!block) return false

  if (selection.from === block.from && selection.to === block.to) {
    // Whole (surface-local) block text selected → promote to a ROOT MBS over
    // ALL SELECTABLE root blocks (`lo` skips a leading non-selectable title).
    // F4: from inside a column this selects the layout's root-level ancestor
    // as one of the root blocks (the layout participates as a single unit); it
    // does NOT select the column's children.
    if (lo >= N) return true // nothing selectable (e.g. title-only doc); consume, no-op
    const firstId = doc.child(lo).attrs.id as string | null
    const meta: BlockSelectionPluginMeta = { setAnchor: firstId }
    editor.view.dispatch(
      editor.state.tr
        .setSelection(MultiBlockSelection.create(doc, lo, N - 1))
        .setMeta(blockSelectionKey, meta),
    )
    return true
  }

  // Partial text selection → select the (surface-local) block's whole text.
  editor.view.dispatch(
    editor.state.tr.setSelection(
      TextSelection.create(doc, block.from, block.to),
    ),
  )
  return true
}

function handleEscape(editor: Editor): boolean {
  const { selection, doc } = editor.state
  // From MultiBlockSelection → passthrough (let suggestion menus etc. handle).
  if (selection instanceof MultiBlockSelection) return false
  if (!(selection instanceof TextSelection)) return false

  // Resolve the containing block on its OWN surface. For an in-column caret
  // this is the column child → a column-local single-block MBS (not the layout).
  const block = surfaceBlockTextBoundsAtPos(doc, selection.from)
  if (block) {
    // A non-selectable block (the in-document title) can't be promoted to a
    // block selection — Escape inside it is a no-op, caret stays. Without this
    // the caret would be promoted to an MBS that create() then clamps onto the
    // first body block (a surprising jump); a clean no-op matches Notion. The
    // create() clamp remains the safety net for the non-keyboard paths.
    if (!isBlockSelectable(block.node)) return false
    const id = block.node.attrs.id as string | null
    const meta: BlockSelectionPluginMeta = { setAnchor: id }
    editor.view.dispatch(
      editor.state.tr
        .setSelection(
          MultiBlockSelection.create(
            doc,
            block.indexInSurface,
            block.indexInSurface,
            surfaceArg(doc, block.surface),
          ),
        )
        .setMeta(blockSelectionKey, meta),
    )
    return true
  }
  return false
}

function handleArrow(editor: Editor, direction: -1 | 1): boolean {
  const sel = editor.state.selection
  if (!(sel instanceof MultiBlockSelection)) return false
  const [lo, hi] = sel.blockIndices
  const N = mbsSurfaceChildCount(sel) // surface-local child count (column-local stops here)
  // Lower bound = first SELECTABLE index on this surface (skips a leading
  // non-selectable title on the root; 0 inside a column). Keeps ArrowUp from
  // moving the block selection onto the title.
  const minIdx = firstSelectableIndex(sel.surface)
  const targetIdx =
    direction === -1 ? Math.max(minIdx, lo - 1) : Math.min(N - 1, hi + 1)
  const surfaceArgPos = mbsSurfaceArg(sel)
  const targetId = sel.surface.child(targetIdx).attrs.id as string | null
  const meta: BlockSelectionPluginMeta = { setAnchor: targetId }
  editor.view.dispatch(
    editor.state.tr
      .setSelection(
        MultiBlockSelection.create(editor.state.doc, targetIdx, targetIdx, surfaceArgPos),
      )
      .setMeta(blockSelectionKey, meta),
  )
  return true
}

function handleShiftArrow(editor: Editor, direction: -1 | 1): boolean {
  const sel = editor.state.selection
  if (!(sel instanceof MultiBlockSelection)) return false
  // F5: Shift-arrow extends COLUMN-LOCAL and STOPS at the column edge — the
  // index math runs entirely on the MBS's OWN surface; clamping at the
  // surface's child count is what keeps a column selection from promoting to
  // root. The anchor index is resolved on the SAME surface (not root).
  const N = mbsSurfaceChildCount(sel)
  const surfaceArgPos = mbsSurfaceArg(sel)
  const anchorId = blockSelectionKey.getState(editor.state)?.anchorBlockId ?? null
  const [lo, hi] = sel.blockIndices
  const anchorIdx = anchorId ? surfaceLocalIndexById(sel, anchorId) : -1
  // Head is the end opposite the anchor. If anchor missing, use lo as anchor.
  const effectiveAnchor = anchorIdx >= 0 ? anchorIdx : lo
  const currentHead = effectiveAnchor === lo ? hi : lo
  // Clamp the head to the first SELECTABLE index on this surface so a
  // Shift-ArrowUp from the first body block never extends onto the title.
  const minIdx = firstSelectableIndex(sel.surface)
  const newHead =
    direction === -1 ? Math.max(minIdx, currentHead - 1) : Math.min(N - 1, currentHead + 1)
  editor.view.dispatch(
    editor.state.tr.setSelection(
      MultiBlockSelection.create(editor.state.doc, effectiveAnchor, newHead, surfaceArgPos),
    ),
  )
  return true
}

// The surface-local index of the block whose `id` matches, within the MBS's
// own surface. Returns -1 when the anchor isn't on this surface (anchor was on
// a different surface or deleted) — handleShiftArrow then falls back to `lo`.
function surfaceLocalIndexById(sel: MultiBlockSelection, id: string): number {
  const surface = sel.surface
  for (let i = 0; i < surface.childCount; i++) {
    if ((surface.child(i).attrs.id as string | null) === id) return i
  }
  return -1
}

function consumeIfBlockMode(editor: Editor): boolean {
  return editor.state.selection instanceof MultiBlockSelection
}

function handleEnter(editor: Editor): boolean {
  const sel = editor.state.selection
  if (!(sel instanceof MultiBlockSelection)) return false
  // Collapse to a caret at the end of the first selected block's text, on the
  // MBS's own surface (column-local or root).
  editor.view.dispatch(
    editor.state.tr.setSelection(
      TextSelection.create(editor.state.doc, sel.firstBlockTextEnd),
    ),
  )
  return true
}

function deleteOnBlockSelection(editor: Editor): boolean {
  if (!(editor.state.selection instanceof MultiBlockSelection)) return false
  return editor.commands.deleteBlockSelection()
}
