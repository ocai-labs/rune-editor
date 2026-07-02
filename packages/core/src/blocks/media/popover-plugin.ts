// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { Extension, type Editor, type RawCommands } from "@tiptap/core"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import { Plugin, PluginKey } from "@tiptap/pm/state"
import type { EditorState, Transaction } from "@tiptap/pm/state"
import type { EditorView } from "@tiptap/pm/view"
import { getBlockSpecs } from "../../schema"
import { resolveBodyBlockById } from "../../schema/bodySurface"
import {
  getMediaImportState,
  mediaImportPluginKey,
} from "./import-plugin"

export interface MediaPopoverState {
  activeBlockId: string | null
}

type MediaPopoverMeta =
  | { type: "open"; blockId: string }
  | { type: "close" }

type MediaImportMetaAction =
  | { type: "set"; blockId: string }
  | { type: "clear"; blockId: string }

type MediaImportMeta =
  | MediaImportMetaAction
  | { type: "batch"; actions: MediaImportMetaAction[] }

export const mediaPopoverPluginKey = new PluginKey<MediaPopoverState>(
  "rune-media-popover",
)

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    mediaPopover: {
      openMediaPopover: (blockId: string) => ReturnType
      closeMediaPopover: () => ReturnType
    }
    imagePopover: {
      openImagePopover: (blockId: string) => ReturnType
      closeImagePopover: () => ReturnType
    }
  }
}

export function getMediaPopoverBlockId(editor: Editor): string | null {
  return mediaPopoverPluginKey.getState(editor.state)?.activeBlockId ?? null
}

function supportsMediaSource(editor: Editor, node: ProseMirrorNode): boolean {
  return getBlockSpecs(editor)[node.type.name]?.supports?.mediaSource === true
}

function findMediaBlock(
  editor: Editor,
  state: EditorState,
  blockId: string,
): { pos: number; node: ProseMirrorNode } | null {
  // Surface-aware: resolves media blocks on nested surfaces (a `column`), not
  // just root siblings of <doc>.
  const resolved = resolveBodyBlockById(state.doc, blockId)
  if (!resolved || !supportsMediaSource(editor, resolved.node)) return null
  return { pos: resolved.pos, node: resolved.node }
}

function canOpenMediaPopover(
  editor: Editor,
  state: EditorState,
  blockId: string,
): boolean {
  if (editor.isDestroyed || !editor.isEditable) return false
  if (!findMediaBlock(editor, state, blockId)) return false
  return getMediaImportState(editor, blockId)?.phase !== "importing"
}

function importMetaActions(meta: MediaImportMeta | undefined): MediaImportMetaAction[] {
  if (!meta) return []
  return meta.type === "batch" ? meta.actions : [meta]
}

function transactionStartsImportForBlock(
  tr: Transaction,
  blockId: string,
): boolean {
  const meta = tr.getMeta(mediaImportPluginKey) as MediaImportMeta | undefined
  return importMetaActions(meta).some(
    (action) => action.type === "set" && action.blockId === blockId,
  )
}

function applyMediaPopoverMeta(
  editor: Editor,
  tr: Transaction,
  value: MediaPopoverState,
  newState: EditorState,
): MediaPopoverState {
  const meta = tr.getMeta(mediaPopoverPluginKey) as MediaPopoverMeta | undefined

  if (meta?.type === "close") return { activeBlockId: null }
  if (meta?.type === "open") {
    if (transactionStartsImportForBlock(tr, meta.blockId)) {
      return { activeBlockId: null }
    }
    if (mediaImportPluginKey.getState(newState)?.get(meta.blockId)?.phase === "importing") {
      return { activeBlockId: null }
    }
    return {
      activeBlockId: canOpenMediaPopover(editor, newState, meta.blockId)
        ? meta.blockId
        : null,
    }
  }

  const activeBlockId = value.activeBlockId
  if (!activeBlockId) return value
  if (!editor.isEditable) return { activeBlockId: null }
  if (tr.selectionSet) return { activeBlockId: null }
  if (transactionStartsImportForBlock(tr, activeBlockId)) {
    return { activeBlockId: null }
  }
  if (!findMediaBlock(editor, newState, activeBlockId)) {
    return { activeBlockId: null }
  }
  return value
}

function openFromPlaceholderClick(
  editor: Editor,
  view: EditorView,
  event: MouseEvent,
): boolean {
  if (!view.editable || !editor.isEditable || editor.isDestroyed) return false
  const target = event.target
  if (!(target instanceof Element)) return false

  const control = target.closest(
    ".rune-media-empty-control, .rune-image-empty-control",
  )
  const block = control?.closest<HTMLElement>(
    ".rune-block.rune-media-empty[data-id], .rune-block.rune-image-empty[data-id]",
  )
  const blockId = block?.getAttribute("data-id")
  if (!blockId || !canOpenMediaPopover(editor, view.state, blockId)) {
    return false
  }

  event.preventDefault()
  const tr = view.state.tr
    .setMeta(mediaPopoverPluginKey, { type: "open", blockId } satisfies MediaPopoverMeta)
    .setMeta("addToHistory", false)
  view.dispatch(tr)
  return true
}

function closePopoverIfReadOnly(editor: Editor, view: EditorView): void {
  if (editor.isDestroyed) return
  if (editor.isEditable && view.editable) return
  if (!mediaPopoverPluginKey.getState(view.state)?.activeBlockId) return

  view.dispatch(
    view.state.tr
      .setMeta(mediaPopoverPluginKey, { type: "close" } satisfies MediaPopoverMeta)
      .setMeta("addToHistory", false),
  )
}

export const MediaPopover = Extension.create({
  name: "mediaPopover",

  addCommands() {
    return {
      openMediaPopover:
        (blockId) =>
        ({ editor, state, dispatch }) => {
          if (!canOpenMediaPopover(editor, state, blockId)) return false
          if (!dispatch) return true
          dispatch(
            state.tr
              .setMeta(mediaPopoverPluginKey, { type: "open", blockId } satisfies MediaPopoverMeta)
              .setMeta("addToHistory", false),
          )
          return true
        },

      closeMediaPopover:
        () =>
        ({ state, dispatch }) => {
          if (!dispatch) return true
          dispatch(
            state.tr
              .setMeta(mediaPopoverPluginKey, { type: "close" } satisfies MediaPopoverMeta)
              .setMeta("addToHistory", false),
          )
          return true
        },

      openImagePopover:
        (blockId) =>
        ({ commands }) =>
          commands.openMediaPopover(blockId),

      closeImagePopover:
        () =>
        ({ commands }) =>
          commands.closeMediaPopover(),
    } as Partial<RawCommands>
  },

  addProseMirrorPlugins() {
    const editor = this.editor
    return [
      new Plugin<MediaPopoverState>({
        key: mediaPopoverPluginKey,
        state: {
          init: () => ({ activeBlockId: null }),
          apply: (tr, value, _oldState, newState) =>
            applyMediaPopoverMeta(editor, tr, value, newState),
        },
        props: {
          handleDOMEvents: {
            click: (view, event) =>
              openFromPlaceholderClick(editor, view, event as MouseEvent),
          },
          handleClick: (view, _pos, event) =>
            openFromPlaceholderClick(editor, view, event),
        },
        view: (view) => ({
          update: () => closePopoverIfReadOnly(editor, view),
        }),
      }),
    ]
  },
})
