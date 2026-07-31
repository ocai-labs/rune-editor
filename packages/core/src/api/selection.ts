// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { Editor } from "@tiptap/core"
import type { Node as PMNode } from "@tiptap/pm/model"
import {
  AllSelection,
  NodeSelection,
  TextSelection,
} from "@tiptap/pm/state"
import { clipboardTextParser } from "../extensions/clipboard/clipboardTextParser"
import { forEachBodyBlock } from "../schema/bodySurface"
import { isEditorAlive } from "./editorLifecycle"
import {
  runeCommandError,
  runeCommandOk,
  type RuneCommandResult,
} from "./result"

export interface RuneSelectionBlockRange {
  id: string
  type: string
  index: number
  from: number
  to: number
}

export type RuneSelectionKind =
  | "text"
  | "node"
  | "all"
  | "unsupported"

export interface RuneSelectionSnapshot {
  kind: RuneSelectionKind
  replaceable: boolean
  /**
   * The selected range contains an inline atom node (e.g. inline math, a
   * node-form entity ref). Such nodes carry no text — `text` silently drops
   * them, and a plain-text replacement would delete them. Consumers that round
   * trip the selection as text (AI rewrite) should refuse when this is true.
   * Inline *marks* (bold, link, mark-form refs) are not atoms and don't set it.
   */
  containsInlineAtoms: boolean
  empty: boolean
  text: string
  anchorBlockId?: string
  headBlockId?: string
  blockIds: string[]
  blocks: RuneSelectionBlockRange[]
  unsupportedReason?: string
}

/**
 * One body block's absolute span. Rune's built-in schema is flat; the
 * innermost-frame handling below also keeps plugin-provided structured blocks
 * from being double-counted.
 */
interface BodyBlockFrame {
  index: number
  from: number
  to: number
  node: PMNode
}

function unsupportedSnapshot(empty: boolean): RuneSelectionSnapshot {
  return {
    kind: "unsupported",
    replaceable: false,
    containsInlineAtoms: false,
    empty,
    text: "",
    blockIds: [],
    blocks: [],
    unsupportedReason: "unsupported-selection",
  }
}

function rangeHasInlineAtom(doc: PMNode, from: number, to: number): boolean {
  if (from >= to) return false
  let found = false
  doc.nodesBetween(from, to, (node) => {
    if (found) return false
    // Text nodes are also leaf/atom in PM — exclude them; we only care about
    // non-text inline atoms (inline math, node-form refs).
    if (node.isInline && node.isAtom && !node.isText) {
      found = true
      return false
    }
    return undefined
  })
  return found
}

function bodyBlockFrames(doc: PMNode): BodyBlockFrame[] {
  const frames: BodyBlockFrame[] = []
  forEachBodyBlock(doc, ({ node, pos, index }) => {
    frames.push({ index, from: pos, to: pos + node.nodeSize, node })
  })
  return frames
}

/**
 * The INNERMOST frame containing `pos`. Frames arrive in document order and a
 * nested frame always starts after its container, so the last containing frame
 * is the innermost. The backward scan also resolves the boundary
 * tie between adjacent siblings toward the block that STARTS at `pos` (a
 * NodeSelection's `from` is both the previous sibling's end and the selected
 * node's start).
 */
function frameAtPos(doc: PMNode, pos: number): BodyBlockFrame | null {
  const frames = bodyBlockFrames(doc)
  for (let i = frames.length - 1; i >= 0; i--) {
    const frame = frames[i]!
    if (pos >= frame.from && pos <= frame.to) return frame
  }
  return null
}

function textOffset(doc: PMNode, frame: BodyBlockFrame, pos: number): number {
  const from = frame.from + 1
  const to = Math.max(from, Math.min(pos, frame.to - 1))
  return doc.textBetween(from, to, "\n", "\n").length
}

function rangeForFrame(
  doc: PMNode,
  frame: BodyBlockFrame,
  from: number,
  to: number,
): RuneSelectionBlockRange {
  return {
    id: typeof frame.node.attrs.id === "string" ? frame.node.attrs.id : "",
    type: frame.node.type.name,
    index: frame.index,
    from: textOffset(doc, frame, from),
    to: textOffset(doc, frame, to),
  }
}

function rangesForSelection(
  doc: PMNode,
  from: number,
  to: number,
): RuneSelectionBlockRange[] {
  const overlapping = bodyBlockFrames(doc).filter(
    (frame) => to >= frame.from + 1 && from <= frame.to - 1,
  )
  return overlapping
    // Frames nest (a layout contains its in-column children). Keep only the
    // innermost overlapping frames: a container whose descendant also overlaps
    // would double-count the children and report layout-relative text offsets.
    .filter(
      (frame) =>
        !overlapping.some(
          (other) =>
            other !== frame && other.from >= frame.from && other.to <= frame.to,
        ),
    )
    .map((frame) =>
      rangeForFrame(
        doc,
        frame,
        Math.max(from, frame.from + 1),
        Math.min(to, frame.to - 1),
      ),
    )
}

function isTopLevelTextSelection(selection: TextSelection): boolean {
  return selection.$from.depth === 1 && selection.$to.depth === 1
}

function snapshotFromTextSelection(
  doc: PMNode,
  selection: TextSelection,
): RuneSelectionSnapshot {
  const blocks = rangesForSelection(doc, selection.from, selection.to)
  const anchorFrame = frameAtPos(doc, selection.anchor)
  const headFrame = frameAtPos(doc, selection.head)
  return {
    kind: "text",
    replaceable: isTopLevelTextSelection(selection),
    containsInlineAtoms: rangeHasInlineAtom(doc, selection.from, selection.to),
    empty: selection.empty,
    text: selection.empty ? "" : doc.textBetween(selection.from, selection.to, "\n", "\n"),
    anchorBlockId:
      typeof anchorFrame?.node.attrs.id === "string" ? anchorFrame.node.attrs.id : undefined,
    headBlockId:
      typeof headFrame?.node.attrs.id === "string" ? headFrame.node.attrs.id : undefined,
    blockIds: blocks.map((block) => block.id),
    blocks,
  }
}

function snapshotFromAllSelection(doc: PMNode): RuneSelectionSnapshot {
  // NOTE: deliberately NOT filtered to innermost frames — AllSelection's block
  // list is "every body block", and changing its shape is out of scope for the
  // overlapping-frame fix (no probed failure). Consumers see the layout AND its
  // children here, in document order.
  const blocks = bodyBlockFrames(doc).map((frame) =>
    rangeForFrame(doc, frame, frame.from + 1, frame.to - 1),
  )
  return {
    kind: "all",
    replaceable: false,
    containsInlineAtoms: rangeHasInlineAtom(doc, 0, doc.content.size),
    empty: false,
    text: doc.textBetween(0, doc.content.size, "\n", "\n"),
    blockIds: blocks.map((block) => block.id),
    blocks,
  }
}

function snapshotFromNodeSelection(
  doc: PMNode,
  selection: NodeSelection,
): RuneSelectionSnapshot {
  const frame = frameAtPos(doc, selection.from)
  if (!frame || selection.node !== frame.node) return unsupportedSnapshot(selection.empty)
  const block = rangeForFrame(doc, frame, frame.from + 1, frame.to - 1)
  return {
    kind: "node",
    replaceable: false,
    // A NodeSelection of an inline atom (e.g. inline math) is itself an atom.
    containsInlineAtoms: selection.node.isInline && selection.node.isAtom,
    empty: false,
    text: doc.textBetween(frame.from + 1, frame.to - 1, "\n", "\n"),
    anchorBlockId: block.id,
    headBlockId: block.id,
    blockIds: [block.id],
    blocks: [block],
  }
}

export function getSelectionSnapshot(editor: Editor): RuneSelectionSnapshot {
  const { doc, selection } = editor.state
  if (selection instanceof TextSelection) return snapshotFromTextSelection(doc, selection)
  if (selection instanceof AllSelection) return snapshotFromAllSelection(doc)
  if (selection instanceof NodeSelection) return snapshotFromNodeSelection(doc, selection)
  return unsupportedSnapshot(selection.empty)
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values))
}

export function replaceSelectionText(
  editor: Editor,
  text: string,
): RuneCommandResult<{ changedBlockIds: string[] }> {
  if (!isEditorAlive(editor)) {
    return runeCommandError("editor-destroyed", "Editor is destroyed.")
  }
  if (!editor.isEditable) {
    return runeCommandError("not-editable", "Editor is not editable.")
  }

  const { state } = editor
  if (!(state.selection instanceof TextSelection)) {
    return runeCommandError(
      "unsupported",
      "Only text selections can be replaced as plain text.",
    )
  }

  const before = getSelectionSnapshot(editor)
  if (!before.replaceable) {
    return runeCommandError(
      "unsupported",
      "Plain text replacement is only supported in top-level text blocks.",
    )
  }
  // A plain-text replacement deletes the whole selection, so inline atoms
  // (inline math, node-form refs) in range would be silently destroyed — they
  // also never reached `text`, since textBetween drops them. Refuse rather
  // than lose them; callers that want this must strip/serialize atoms first.
  if (before.containsInlineAtoms) {
    return runeCommandError(
      "unsupported",
      "Selection contains inline atoms (e.g. inline math) that plain-text replacement would delete.",
    )
  }

  const normalized = text.replace(/\r\n?/g, "\n")
  const slice = clipboardTextParser(normalized, state.selection.$from)
  const selFrom = state.selection.from
  const tr = state.tr
  try {
    tr.replaceSelection(slice)
  } catch {
    return runeCommandError(
      "unsupported",
      "Plain text cannot be inserted in the current selection context.",
    )
  }
  // Collapsed cursor at the end of the inserted content, in tr.doc coords.
  const insertedTo = tr.selection.to
  editor.view.dispatch(tr)

  // BlockId fills ids synchronously during dispatch and the inserted span's
  // positions are stable (attrs-only changes), so derive the affected
  // top-level block ids from the final doc over the inserted range.
  return runeCommandOk({
    changedBlockIds: unique(
      rangesForSelection(editor.state.doc, selFrom, insertedTo)
        .map((range) => range.id)
        .filter(Boolean),
    ),
  })
}
