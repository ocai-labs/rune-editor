// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { Extension, type Editor, type RawCommands } from "@tiptap/core"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import { Plugin, PluginKey, Selection } from "@tiptap/pm/state"
import type { EditorState, Transaction } from "@tiptap/pm/state"
import type { EditorView } from "@tiptap/pm/view"
import { nanoid } from "nanoid"
import { createNodeFromBlockInput, resolveInsertPos } from "../../api/commands/insertBlocks"
import type { BlockInsertTarget } from "../../api/types"
import {
  forEachBodyBlock,
  resolveBodyBlockById,
  surfaceChildrenAt,
} from "../../schema/bodySurface"
import { surfaceFromPoint } from "../../extensions/shared/surface-from-point"
import { IMAGE_ICON_PATHS } from "../Image/block"
import {
  SOURCE_BLOCK_KINDS,
  mediaResultToAttrs,
  normalizeMediaUrlInput,
  validateMediaImportResult,
  type MediaAssetImportResult,
  type MediaImportResult,
  type RuneImportMediaFile,
  type RuneImportMediaUrl,
  type RuneMediaImportContext,
  type RuneMediaImportResult,
  type RuneMediaImportSource,
  type SourcedBlockKind,
} from "./source"
import { mediaPopoverPluginKey } from "./popover-plugin"

export type {
  RuneImportMediaFile,
  RuneImportMediaUrl,
  RuneMediaImportContext,
  RuneMediaImportResult,
  RuneMediaImportSource,
} from "./source"

export interface RuneImageImportContext {
  blockId: string
  source: RuneImageImportSource
}

export interface RuneImageImportResult {
  src: string
  width: number
  height: number
  alt?: string
  sourceUrl?: string
}

export type RuneImageImportSource = RuneMediaImportSource

export type RuneImportImageFile = (
  file: File,
  context: RuneImageImportContext,
) => Promise<RuneImageImportResult>

export type RuneImportImageUrl = (
  url: string,
  context: RuneImageImportContext,
) => Promise<RuneImageImportResult>

export type MediaImportInput =
  | { kind: "file"; file: File }
  | { kind: "url"; url: string }

export type MediaImportState =
  | {
      phase: "importing"
      requestId: string
      input: MediaImportInput
      source: RuneMediaImportSource
    }
  | {
      phase: "error"
      requestId: string
      input: MediaImportInput
      source: RuneMediaImportSource
      error: string
    }

export type MediaImportMap = Map<string, MediaImportState>

type MediaImportMetaAction =
  | { type: "set"; blockId: string; state: MediaImportState }
  | { type: "clear"; blockId: string }

type MediaImportMeta =
  | MediaImportMetaAction
  | { type: "batch"; actions: MediaImportMetaAction[] }

function mediaImportMetaActions(meta: MediaImportMeta | undefined): MediaImportMetaAction[] {
  if (!meta) return []
  return meta.type === "batch" ? meta.actions : [meta]
}

function appendMediaImportMeta(tr: Transaction, action: MediaImportMetaAction): void {
  const existing = tr.getMeta(mediaImportPluginKey) as MediaImportMeta | undefined
  const actions = mediaImportMetaActions(existing)
  tr.setMeta(mediaImportPluginKey, { type: "batch", actions: [...actions, action] } satisfies MediaImportMeta)
}

export interface MediaImportOptions {
  importMediaFile?: RuneImportMediaFile
  importMediaUrl?: RuneImportMediaUrl
  importImageFile?: RuneImportImageFile
  importImageUrl?: RuneImportImageUrl
}

export interface InsertMediaOptions {
  id?: string
  depth?: number
  openPopover?: boolean
}

export interface InsertImageOptions extends InsertMediaOptions {}

export const mediaImportPluginKey = new PluginKey<MediaImportMap>("rune-media-import")

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    mediaImport: {
      insertMedia: (
        kind: SourcedBlockKind,
        at?: BlockInsertTarget,
        options?: InsertMediaOptions,
      ) => ReturnType
      insertVideo: (at?: BlockInsertTarget, options?: InsertMediaOptions) => ReturnType
      insertAudio: (at?: BlockInsertTarget, options?: InsertMediaOptions) => ReturnType
      startMediaFileImport: (
        blockId: string,
        file: File,
        source: RuneMediaImportSource,
      ) => ReturnType
      startMediaUrlImport: (
        blockId: string,
        url: string,
        source: RuneMediaImportSource,
      ) => ReturnType
      retryMediaImport: (blockId: string) => ReturnType
    }
    imageImport: {
      insertImage: (at?: BlockInsertTarget, options?: InsertImageOptions) => ReturnType
      startImageFileImport: (
        blockId: string,
        file: File,
        source: RuneImageImportSource,
      ) => ReturnType
      startImageUrlImport: (
        blockId: string,
        url: string,
        source: RuneImageImportSource,
      ) => ReturnType
      writeRawImageUrl: (blockId: string, url: string) => ReturnType
      retryImageImport: (blockId: string) => ReturnType
    }
  }
  interface Storage {
    // Kept under imageImport for compatibility with the original image-only
    // hooks; the storage now backs all source-backed blocks.
    imageImport: {
      importMediaFile?: RuneImportMediaFile
      importMediaUrl?: RuneImportMediaUrl
      importImageFile?: RuneImportImageFile
      importImageUrl?: RuneImportImageUrl
    }
  }
}

export function getMediaImportState(
  editor: Editor,
  blockId: string,
): MediaImportState | undefined {
  return mediaImportPluginKey.getState(editor.state)?.get(blockId)
}

function cloneMap(map: MediaImportMap): MediaImportMap {
  return new Map(map)
}

function isSourcedBlockKind(value: string): value is SourcedBlockKind {
  return (SOURCE_BLOCK_KINDS as readonly string[]).includes(value)
}

function collectLiveMediaIds(doc: ProseMirrorNode): Set<string> {
  const ids = new Set<string>()
  // Body-surface walk (not root-only `doc.forEach`) so import state for media
  // inside a column is not pruned as "deleted" on every unrelated docChange.
  forEachBodyBlock(doc, ({ node }) => {
    if (!isSourcedBlockKind(node.type.name)) return
    const id = node.attrs.id
    if (typeof id === "string") ids.add(id)
  })
  return ids
}

function applyMediaImportMeta(
  value: MediaImportMap,
  tr: Transaction,
): MediaImportMap {
  let next = value
  const meta = tr.getMeta(mediaImportPluginKey) as MediaImportMeta | undefined
  const actions = mediaImportMetaActions(meta)
  if (actions.length > 0) {
    next = cloneMap(next)
    for (const action of actions) {
      if (action.type === "set") next.set(action.blockId, action.state)
      if (action.type === "clear") next.delete(action.blockId)
    }
  }

  if (tr.docChanged && next.size > 0) {
    const liveIds = collectLiveMediaIds(tr.doc)
    let pruned: MediaImportMap | null = null
    for (const blockId of next.keys()) {
      if (liveIds.has(blockId)) continue
      pruned ??= cloneMap(next)
      pruned.delete(blockId)
    }
    if (pruned) next = pruned
  }

  return next
}

function findMediaBlock(
  state: EditorState,
  blockId: string,
): { pos: number; node: ProseMirrorNode; kind: SourcedBlockKind; nodeName: string } | null {
  // Surface-aware: resolves media blocks on nested surfaces (a `column`), not
  // just root siblings of <doc>.
  const resolved = resolveBodyBlockById(state.doc, blockId)
  if (!resolved) return null
  const node = resolved.node
  if (!isSourcedBlockKind(node.type.name)) return null
  return { pos: resolved.pos, node, kind: node.type.name, nodeName: node.type.name }
}

function findImageBlock(
  state: EditorState,
  blockId: string,
): { pos: number; node: ProseMirrorNode; kind: "image"; nodeName: string } | null {
  const found = findMediaBlock(state, blockId)
  return found?.kind === "image" ? { ...found, kind: "image" } : null
}

function mediaContext(
  found: { kind: SourcedBlockKind; nodeName: string },
  blockId: string,
  source: RuneMediaImportSource,
): RuneMediaImportContext {
  return {
    blockId,
    kind: found.kind,
    nodeName: found.nodeName,
    source,
  }
}

function legacyImageContext(
  blockId: string,
  source: RuneImageImportSource,
): RuneImageImportContext {
  return { blockId, source }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === "string" && error) return error
  return "Media import failed"
}

function setImportState(
  editor: Editor,
  blockId: string,
  state: MediaImportState,
) {
  const tr = editor.state.tr.setMeta("addToHistory", false)
  appendMediaImportMeta(tr, { type: "set", blockId, state })
  editor.view.dispatch(tr)
}

function clearImportState(tr: Transaction, blockId: string): void {
  appendMediaImportMeta(tr, { type: "clear", blockId })
}

function clearImportStateOnly(editor: Editor, blockId: string) {
  const tr = editor.state.tr.setMeta("addToHistory", false)
  appendMediaImportMeta(tr, { type: "clear", blockId })
  editor.view.dispatch(tr)
}

function stillCurrent(editor: Editor, blockId: string, requestId: string): boolean {
  const current = getMediaImportState(editor, blockId)
  return current?.phase === "importing" && current.requestId === requestId
}

function imageResultToMediaAsset(result: RuneImageImportResult): MediaAssetImportResult {
  return {
    kind: "asset",
    src: result.src,
    alt: result.alt,
    width: result.width,
    height: result.height,
    sourceUrl: result.sourceUrl,
  }
}

function mediaAssetToImageAttrs(
  result: MediaAssetImportResult,
): {
  src: string
  alt: string
  width: number | null
  height: number | null
  sourceUrl: string | null
} {
  return {
    src: result.src,
    alt: result.alt ?? "",
    width: typeof result.width === "number" ? result.width : null,
    height: typeof result.height === "number" ? result.height : null,
    sourceUrl: result.sourceUrl ?? null,
  }
}

function invalidMediaImportResult() {
  return {
    ok: false as const,
    error: "Invalid media import result",
  }
}

function safeValidateMediaImportResult(
  kind: SourcedBlockKind,
  result: unknown,
) {
  if (!result || typeof result !== "object") {
    return invalidMediaImportResult()
  }

  const candidate = result as Partial<MediaImportResult>
  if (candidate.kind === "asset") {
    if (typeof candidate.src !== "string") {
      return invalidMediaImportResult()
    }
  } else if (candidate.kind === "embed") {
    if (
      typeof candidate.provider !== "string" ||
      typeof candidate.sourceUrl !== "string" ||
      typeof candidate.embedUrl !== "string"
    ) {
      return invalidMediaImportResult()
    }
  } else {
    return invalidMediaImportResult()
  }

  try {
    return validateMediaImportResult(kind, candidate as MediaImportResult)
  } catch {
    return invalidMediaImportResult()
  }
}

function applyValidatedResult(
  editor: Editor,
  blockId: string,
  requestId: string,
  found: { pos: number; node: ProseMirrorNode; kind: SourcedBlockKind },
  result: MediaImportResult,
): void {
  const tr =
    found.kind === "image"
      ? editor.state.tr.setNodeMarkup(found.pos, undefined, {
          ...found.node.attrs,
          ...mediaAssetToImageAttrs(result as MediaAssetImportResult),
        })
      : editor.state.tr.setNodeMarkup(found.pos, undefined, {
          ...found.node.attrs,
          ...mediaResultToAttrs(result),
        })

  clearImportState(tr, blockId)
  editor.view.dispatch(tr)
}

function applyImportResult(
  editor: Editor,
  blockId: string,
  requestId: string,
  input: MediaImportInput,
  source: RuneMediaImportSource,
  result: unknown,
) {
  if (editor.isDestroyed || !stillCurrent(editor, blockId, requestId)) return
  if (!editor.isEditable) {
    clearImportStateOnly(editor, blockId)
    return
  }
  const found = findMediaBlock(editor.state, blockId)
  if (!found) return

  const validation = safeValidateMediaImportResult(found.kind, result)
  if (!validation.ok) {
    applyImportError(editor, blockId, requestId, input, source, validation.error)
    return
  }
  if (found.kind === "image" && validation.result.kind !== "asset") {
    applyImportError(editor, blockId, requestId, input, source, "Unsupported media provider")
    return
  }

  applyValidatedResult(editor, blockId, requestId, found, validation.result)
}

function applyImportError(
  editor: Editor,
  blockId: string,
  requestId: string,
  input: MediaImportInput,
  source: RuneMediaImportSource,
  error: unknown,
) {
  if (editor.isDestroyed || !stillCurrent(editor, blockId, requestId)) return
  if (!editor.isEditable) {
    clearImportStateOnly(editor, blockId)
    return
  }
  if (!findMediaBlock(editor.state, blockId)) return
  setImportState(editor, blockId, {
    phase: "error",
    requestId,
    input,
    source,
    error: errorMessage(error),
  })
}

function startImport(
  editor: Editor,
  blockId: string,
  input: MediaImportInput,
  source: RuneMediaImportSource,
  run: () => Promise<RuneMediaImportResult>,
  tr: Transaction,
): boolean {
  if (!editor.isEditable || editor.isDestroyed) return false
  if (!findMediaBlock(editor.state, blockId)) return false

  const requestId = nanoid(8)
  tr.setMeta("addToHistory", false)
  appendMediaImportMeta(tr, {
    type: "set",
    blockId,
    state: { phase: "importing", requestId, input, source },
  })

  let promise: Promise<RuneMediaImportResult>
  try {
    promise = run()
  } catch (e) {
    promise = Promise.reject(e)
  }

  void promise.then(
    (result) => applyImportResult(editor, blockId, requestId, input, source, result),
    (error) => applyImportError(editor, blockId, requestId, input, source, error),
  )
  return true
}

function urlFallbackRun(kind: SourcedBlockKind, url: string): () => Promise<RuneMediaImportResult> {
  return () => {
    const normalized = normalizeMediaUrlInput(kind, url)
    if ("ok" in normalized) {
      return Promise.reject(new Error(normalized.error))
    }
    return Promise.resolve(normalized)
  }
}

function urlImportRun(
  editor: Editor,
  found: { kind: SourcedBlockKind; nodeName: string },
  blockId: string,
  url: string,
  source: RuneMediaImportSource,
  allowFallback: boolean,
): (() => Promise<RuneMediaImportResult>) | null {
  const storage = editor.storage.imageImport
  if (storage.importMediaUrl) {
    return () =>
      storage.importMediaUrl!(url, mediaContext(found, blockId, source))
  }

  if (found.kind === "image" && storage.importImageUrl) {
    return () =>
      storage.importImageUrl!(url, legacyImageContext(blockId, source)).then(
        imageResultToMediaAsset,
      )
  }

  return allowFallback ? urlFallbackRun(found.kind, url) : null
}

function fileImportRun(
  editor: Editor,
  found: { kind: SourcedBlockKind; nodeName: string },
  blockId: string,
  file: File,
  source: RuneMediaImportSource,
  missingAsError: boolean,
): (() => Promise<RuneMediaImportResult>) | null {
  const storage = editor.storage.imageImport
  if (storage.importMediaFile) {
    return () =>
      storage.importMediaFile!(file, mediaContext(found, blockId, source))
  }

  if (found.kind === "image" && storage.importImageFile) {
    return () =>
      storage.importImageFile!(file, legacyImageContext(blockId, source)).then(
        imageResultToMediaAsset,
      )
  }

  if (!missingAsError) return null
  return () => Promise.reject(new Error("No media file import hook configured"))
}

function nodeDepth(node: ProseMirrorNode): number {
  return typeof node.attrs.depth === "number" ? node.attrs.depth : 0
}

function lastBlockDepth(state: EditorState): number {
  const last = state.doc.lastChild
  return last ? nodeDepth(last) : 0
}

function resolveSelectionInsertTarget(state: EditorState): { pos: number; depth: number } {
  // Resolve the selection head's OWN surface (the doc root, or the column for
  // an in-column selection) so a pasted image lands as a sibling on that
  // surface, not appended after the whole layout — then insert after the
  // surface child the head sits in or on. `to <= end` covers both a caret
  // INSIDE a block and a boundary selection sitting BETWEEN blocks (a
  // MultiBlockSelection's `to`, or a NodeSelection past a non-leaf block) —
  // the pre-column root loop's `head <= end` semantics, made surface-local.
  // A text-bounds lookup is NOT enough here: block-end boundaries fall inside
  // no block's text bounds and would leak to the doc-end fallback.
  const to = state.selection.to
  const surface = surfaceChildrenAt(state.doc, to)
  if (surface) {
    let offset = surface.start
    for (let i = 0; i < surface.node.childCount; i++) {
      const child = surface.node.child(i)
      const end = offset + child.nodeSize
      if (to <= end) return { pos: end, depth: nodeDepth(child) }
      offset = end
    }
  }
  return { pos: state.doc.content.size, depth: lastBlockDepth(state) }
}

function resolveDropInsertTarget(view: EditorView, event: DragEvent): { pos: number; depth: number } {
  const doc = view.state.doc
  // Which body-block surface is the drop geometrically over — the root, or a
  // column? surfaceFromPoint uses rect-containment (NOT posAtCoords, which
  // snaps across the column boundary in gaps/padding), so an OS-file drop over
  // a column inserts INTO it. The before/after midpoint test then runs against
  // THAT surface's own children. `surfacePos + 1` is the first position inside
  // the surface (0 for the root), which surfaceChildrenAt resolves back to it.
  const { surfacePos } = surfaceFromPoint(view, event.clientX, event.clientY)
  const surface = surfaceChildrenAt(doc, surfacePos + 1)
  if (!surface) return { pos: doc.content.size, depth: lastBlockDepth(view.state) }

  const surfaceEnd = surface.start + surface.node.content.size
  const endDepth = surface.node.lastChild ? nodeDepth(surface.node.lastChild) : 0

  const hit = view.posAtCoords({ left: event.clientX, top: event.clientY })
  if (!hit) return { pos: surfaceEnd, depth: endDepth }

  let offset = surface.start
  for (let i = 0; i < surface.node.childCount; i++) {
    const child = surface.node.child(i)
    const end = offset + child.nodeSize
    if (hit.pos <= end) {
      const dom = view.nodeDOM(offset) as HTMLElement | null
      const rect = dom?.getBoundingClientRect()
      const before = rect ? event.clientY < rect.top + rect.height / 2 : false
      return { pos: before ? offset : end, depth: nodeDepth(child) }
    }
    offset = end
  }
  return { pos: surfaceEnd, depth: endDepth }
}

interface QueuedFileImport {
  blockId: string
  file: File
  requestId: string
  source: "drop" | "paste-binary"
}

function imageFilesFromTransfer(data: DataTransfer | null | undefined): File[] {
  return Array.from(data?.files ?? []).filter((file) => file.type.startsWith("image/"))
}

function runQueuedFileImport(editor: Editor, item: QueuedFileImport) {
  if (editor.isDestroyed || !stillCurrent(editor, item.blockId, item.requestId)) return
  if (!editor.isEditable) {
    clearImportStateOnly(editor, item.blockId)
    return
  }

  const found = findImageBlock(editor.state, item.blockId)
  if (!found) return
  const run = fileImportRun(editor, found, item.blockId, item.file, item.source, false)
  if (!run) return

  let promise: Promise<RuneMediaImportResult>
  try {
    promise = run()
  } catch (error) {
    promise = Promise.reject(error)
  }

  void promise.then(
    (result) => applyImportResult(editor, item.blockId, item.requestId, { kind: "file", file: item.file }, item.source, result),
    (error) => applyImportError(editor, item.blockId, item.requestId, { kind: "file", file: item.file }, item.source, error),
  )
}

function hasImageFileImportHook(editor: Editor): boolean {
  const storage = editor.storage.imageImport
  return typeof storage.importMediaFile === "function" || typeof storage.importImageFile === "function"
}

function insertImageFileImports(
  editor: Editor,
  view: EditorView,
  files: File[],
  target: { pos: number; depth: number },
  source: "drop" | "paste-binary",
): boolean {
  if (!hasImageFileImportHook(editor)) return true

  const tr = view.state.tr
  const queued: QueuedFileImport[] = []
  let insertPos = target.pos

  for (const file of files) {
    const blockId = nanoid(8)
    const requestId = nanoid(8)
    const node = createNodeFromBlockInput(
      editor,
      view.state.schema,
      { type: "image", id: blockId, depth: target.depth, src: "", alt: "", width: null, height: null },
      { depth: target.depth },
    )
    if (!node) continue
    tr.insert(insertPos, node)
    appendMediaImportMeta(tr, {
      type: "set",
      blockId,
      state: { phase: "importing", requestId, input: { kind: "file", file }, source },
    })
    queued.push({ blockId, file, requestId, source })
    insertPos += node.nodeSize
  }

  if (queued.length === 0) return true
  view.dispatch(tr.scrollIntoView())
  queueMicrotask(() => queued.forEach((item) => runQueuedFileImport(editor, item)))
  return true
}

function handleImageDrop(editor: Editor, view: EditorView, event: DragEvent): boolean {
  if (!view.editable || !editor.isEditable) return false
  const files = imageFilesFromTransfer(event.dataTransfer)
  if (files.length === 0) return false
  event.preventDefault()
  if (!hasImageFileImportHook(editor)) return true
  return insertImageFileImports(editor, view, files, resolveDropInsertTarget(view, event), "drop")
}

function handleImageBinaryPaste(editor: Editor, view: EditorView, event: ClipboardEvent): boolean {
  if (!view.editable || !editor.isEditable) return false
  const data = event.clipboardData
  if (!data || data.types.includes("application/x-rune-doc")) return false
  const files = imageFilesFromTransfer(data)
  if (files.length === 0) return false
  event.preventDefault()
  if (!hasImageFileImportHook(editor)) return true
  return insertImageFileImports(editor, view, files, resolveSelectionInsertTarget(view.state), "paste-binary")
}

interface QueuedUrlImport {
  blockId: string
  url: string
  requestId: string
}

function collectPendingHtmlImports(state: EditorState): Array<{ pos: number; node: ProseMirrorNode; blockId: string; url: string }> {
  const pending: Array<{ pos: number; node: ProseMirrorNode; blockId: string; url: string }> = []
  // Body-surface walk (the walker supplies each block's absolute pos) so
  // pasted-HTML images inside a column are imported, not just root ones.
  forEachBodyBlock(state.doc, ({ node, pos }) => {
    if (node.type.name !== "image") return
    const url = node.attrs.pendingFromPaste
    const blockId = node.attrs.id
    if (typeof url === "string" && url !== "" && typeof blockId === "string" && blockId !== "") {
      pending.push({ pos, node, blockId, url })
    }
  })
  return pending
}

function runQueuedUrlImport(editor: Editor, item: QueuedUrlImport) {
  if (editor.isDestroyed || !stillCurrent(editor, item.blockId, item.requestId)) return
  if (!editor.isEditable) {
    clearImportStateOnly(editor, item.blockId)
    return
  }

  const found = findImageBlock(editor.state, item.blockId)
  if (!found) return
  const run = urlImportRun(editor, found, item.blockId, item.url, "paste-html", false)
  if (!run) return

  let promise: Promise<RuneMediaImportResult>
  try {
    promise = run()
  } catch (error) {
    promise = Promise.reject(error)
  }

  void promise.then(
    (result) => applyImportResult(editor, item.blockId, item.requestId, { kind: "url", url: item.url }, "paste-html", result),
    (error) => applyImportError(editor, item.blockId, item.requestId, { kind: "url", url: item.url }, "paste-html", error),
  )
}

function flushQueuedUrlImports(editor: Editor, queue: QueuedUrlImport[]) {
  const items = queue.splice(0)
  for (const item of items) runQueuedUrlImport(editor, item)
}

function captureNaturalDimensions(view: EditorView, img: HTMLImageElement, blockId: string) {
  if (!view.editable) return
  const width = img.naturalWidth
  const height = img.naturalHeight
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return

  const found = findImageBlock(view.state, blockId)
  if (!found || found.node.attrs.width != null || found.node.attrs.src === "") return

  const tr = view.state.tr
    .setNodeMarkup(found.pos, undefined, {
      ...found.node.attrs,
      width,
      height,
    })
    .setMeta("addToHistory", false)
  view.dispatch(tr)
}

function createOnloadFallbackView(view: EditorView) {
  const listeners = new Map<HTMLImageElement, { blockId: string; onLoad: () => void }>()

  const sync = () => {
    const live = new Set<HTMLImageElement>()
    for (const img of Array.from(view.dom.querySelectorAll<HTMLImageElement>('img[data-rune-image]'))) {
      const block = img.closest<HTMLElement>(".rune-block[data-id]")
      const blockId = block?.getAttribute("data-id")
      if (!blockId) continue

      const found = findImageBlock(view.state, blockId)
      if (!found || found.node.attrs.src === "" || found.node.attrs.width != null) continue

      live.add(img)
      if (!listeners.has(img)) {
        const onLoad = () => captureNaturalDimensions(view, img, blockId)
        listeners.set(img, { blockId, onLoad })
        img.addEventListener("load", onLoad)
        if (img.complete && img.naturalWidth > 0) queueMicrotask(onLoad)
      }
    }

    for (const [img, entry] of Array.from(listeners.entries())) {
      if (live.has(img)) continue
      img.removeEventListener("load", entry.onLoad)
      listeners.delete(img)
    }
  }

  sync()
  return {
    update: sync,
    destroy() {
      for (const [img, entry] of Array.from(listeners.entries())) {
        img.removeEventListener("load", entry.onLoad)
      }
    },
  }
}

const SVG_NS = "http://www.w3.org/2000/svg"

function createImportIcon(): SVGElement {
  const svg = document.createElementNS(SVG_NS, "svg")
  svg.setAttribute(
    "class",
    "rune-source-import-icon rune-image-import-icon rune-media-import-icon",
  )
  svg.setAttribute("viewBox", "0 0 20 20")
  svg.setAttribute("aria-hidden", "true")
  for (const d of IMAGE_ICON_PATHS) {
    const path = document.createElementNS(SVG_NS, "path")
    path.setAttribute("d", d)
    svg.appendChild(path)
  }
  return svg
}

function createImportingOverlay(): HTMLElement {
  const root = document.createElement("div")
  root.className =
    "rune-source-import-overlay rune-image-import-overlay rune-media-import-overlay"
  root.setAttribute("data-rune-source-import-overlay", "importing")
  root.setAttribute("data-rune-image-import-overlay", "importing")
  root.setAttribute("data-rune-media-import-overlay", "importing")
  root.contentEditable = "false"

  const panel = document.createElement("div")
  panel.className =
    "rune-source-import-panel rune-source-import-panel-importing rune-image-import-panel rune-image-import-panel-importing rune-media-import-panel rune-media-import-panel-importing"
  panel.setAttribute("role", "status")
  panel.setAttribute("aria-live", "polite")

  panel.appendChild(createImportIcon())

  const title = document.createElement("span")
  title.className =
    "rune-source-import-title rune-image-import-title rune-media-import-title"
  title.textContent = "Importing content"
  panel.appendChild(title)

  const shimmer = document.createElement("span")
  shimmer.className =
    "rune-source-import-shimmer rune-image-import-shimmer rune-media-import-shimmer"
  shimmer.setAttribute("aria-hidden", "true")
  panel.appendChild(shimmer)

  root.appendChild(panel)
  return root
}

function createErrorOverlay(
  editor: Editor,
  blockId: string,
  message: string,
): HTMLElement {
  const root = document.createElement("div")
  root.className =
    "rune-source-import-overlay rune-image-import-overlay rune-media-import-overlay"
  root.setAttribute("data-rune-source-import-overlay", "error")
  root.setAttribute("data-rune-image-import-overlay", "error")
  root.setAttribute("data-rune-media-import-overlay", "error")
  root.contentEditable = "false"

  const panel = document.createElement("div")
  panel.className =
    "rune-source-import-panel rune-source-import-panel-error rune-image-import-panel rune-image-import-panel-error rune-media-import-panel rune-media-import-panel-error"
  panel.setAttribute("role", "status")

  const copy = document.createElement("div")
  copy.className =
    "rune-source-import-error-copy rune-image-import-error-copy rune-media-import-error-copy"
  copy.appendChild(createImportIcon())

  const text = document.createElement("div")
  text.className =
    "rune-source-import-text rune-image-import-text rune-media-import-text"

  const title = document.createElement("div")
  title.className =
    "rune-source-import-title rune-image-import-title rune-media-import-title"
  title.textContent = "Import failed"
  text.appendChild(title)

  const messageEl = document.createElement("div")
  messageEl.className =
    "rune-source-import-message rune-image-import-message rune-media-import-message"
  messageEl.textContent = message
  text.appendChild(messageEl)

  copy.appendChild(text)
  panel.appendChild(copy)

  const retry = document.createElement("button")
  retry.type = "button"
  retry.className =
    "rune-source-import-retry rune-image-import-retry rune-media-import-retry"
  retry.setAttribute("aria-label", "Retry import")
  retry.textContent = "Retry"
  retry.addEventListener("mousedown", (e) => e.preventDefault())
  retry.addEventListener("click", (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (!editor.isEditable) return
    editor.commands.retryMediaImport(blockId)
  })
  panel.appendChild(retry)

  root.appendChild(panel)
  return root
}

interface OverlayEntry {
  el: HTMLElement
  phase: "importing" | "error"
  error: string | null
}

function createOverlayManager(editor: Editor, view: EditorView) {
  const mounted = new Map<string, OverlayEntry>()

  function detach(blockId: string) {
    const entry = mounted.get(blockId)
    if (!entry) return
    if (entry.el.parentNode) entry.el.parentNode.removeChild(entry.el)
    mounted.delete(blockId)
  }

  function findMediaBlockElement(blockId: string): HTMLElement | null {
    const candidates = view.dom.querySelectorAll<HTMLElement>(
      ".rune-block.rune-image[data-id], .rune-block.rune-video[data-id], .rune-block.rune-audio[data-id]",
    )
    return Array.from(candidates).find(
      (block) => block.getAttribute("data-id") === blockId,
    ) ?? null
  }

  function buildOverlay(
    blockId: string,
    state: MediaImportState,
  ): { el: HTMLElement; phase: "importing" | "error"; error: string | null } {
    if (state.phase === "importing") {
      return { el: createImportingOverlay(), phase: "importing", error: null }
    }
    return {
      el: createErrorOverlay(editor, blockId, state.error),
      phase: "error",
      error: state.error,
    }
  }

  function sync() {
    const map = mediaImportPluginKey.getState(view.state)
    const liveIds = new Set<string>()

    if (map && map.size > 0) {
      for (const [blockId, state] of map) {
        liveIds.add(blockId)
        const block = findMediaBlockElement(blockId)
        if (!block) {
          detach(blockId)
          continue
        }

        const existing = mounted.get(blockId)
        const nextError = state.phase === "error" ? state.error : null
        if (
          existing &&
          existing.phase === state.phase &&
          existing.error === nextError
        ) {
          if (!existing.el.isConnected) {
            block.appendChild(existing.el)
          } else if (existing.el.parentNode !== block) {
            block.appendChild(existing.el)
          }
          continue
        }

        if (existing) detach(blockId)
        const built = buildOverlay(blockId, state)
        block.appendChild(built.el)
        mounted.set(blockId, built)
      }
    }

    for (const blockId of Array.from(mounted.keys())) {
      if (!liveIds.has(blockId)) detach(blockId)
    }
  }

  sync()

  return {
    update: sync,
    destroy() {
      for (const blockId of Array.from(mounted.keys())) detach(blockId)
    },
  }
}

function inputForEmptyMediaBlock(kind: SourcedBlockKind, id: string, depth: number) {
  if (kind === "image") {
    return { type: "image" as const, id, depth, src: "", alt: "", width: null, height: null }
  }

  return {
    type: kind,
    id,
    depth,
    sourceType: "asset" as const,
    src: "",
    embedUrl: null,
    provider: null,
    sourceUrl: null,
    title: "",
    width: null,
    height: null,
  }
}

export const MediaImport = Extension.create<MediaImportOptions>({
  name: "imageImport",

  addOptions() {
    return {
      importMediaFile: undefined,
      importMediaUrl: undefined,
      importImageFile: undefined,
      importImageUrl: undefined,
    }
  },

  addStorage() {
    return {
      importMediaFile: this.options.importMediaFile,
      importMediaUrl: this.options.importMediaUrl,
      importImageFile: this.options.importImageFile,
      importImageUrl: this.options.importImageUrl,
    }
  },

  addCommands() {
    return {
      insertMedia:
        (kind, at, options = {}) =>
        ({ editor, state, dispatch }) => {
          if (!editor.isEditable || editor.isDestroyed) return false
          const pos = resolveInsertPos(state.doc, at)
          if (pos === -1) return false
          const depth = options.depth ?? 0
          const id = options.id ?? nanoid(8)
          const node = createNodeFromBlockInput(
            editor,
            state.schema,
            inputForEmptyMediaBlock(kind, id, depth),
            { depth },
          )
          if (!node) return false
          if (!dispatch) return true

          const tr = state.tr.insert(pos, node)
          const selectionPos = Math.min(pos + node.nodeSize, tr.doc.content.size)
          tr.setSelection(Selection.near(tr.doc.resolve(selectionPos), -1))
          if (options.openPopover) {
            tr.setMeta(mediaPopoverPluginKey, { type: "open", blockId: id })
          }
          dispatch(tr.scrollIntoView())
          return true
        },

      insertVideo:
        (at, options = {}) =>
        ({ commands }) =>
          commands.insertMedia("video", at, options),

      insertAudio:
        (at, options = {}) =>
        ({ commands }) =>
          commands.insertMedia("audio", at, options),

      insertImage:
        (at, options = {}) =>
        ({ commands }) =>
          commands.insertMedia("image", at, options),

      startMediaFileImport:
        (blockId, file, source) =>
        ({ editor, state, dispatch }) => {
          if (!editor.isEditable || editor.isDestroyed) return false
          const found = findMediaBlock(editor.state, blockId)
          if (!found) return false
          if (!dispatch) return true
          const run = fileImportRun(editor, found, blockId, file, source, true)
          if (!run) return false
          return startImport(editor, blockId, { kind: "file", file }, source, run, state.tr)
        },

      startMediaUrlImport:
        (blockId, url, source) =>
        ({ editor, state, dispatch }) => {
          if (!editor.isEditable || editor.isDestroyed) return false
          const found = findMediaBlock(editor.state, blockId)
          if (!found) return false
          if (!dispatch) return true
          const run = urlImportRun(editor, found, blockId, url, source, true)
          if (!run) return false
          return startImport(editor, blockId, { kind: "url", url }, source, run, state.tr)
        },

      startImageFileImport:
        (blockId, file, source) =>
        ({ editor, state, dispatch }) => {
          if (!editor.isEditable || editor.isDestroyed) return false
          const found = findImageBlock(editor.state, blockId)
          if (!found) return false
          const run = fileImportRun(editor, found, blockId, file, source, false)
          if (!run) return false
          if (!dispatch) return true
          return startImport(editor, blockId, { kind: "file", file }, source, run, state.tr)
        },

      startImageUrlImport:
        (blockId, url, source) =>
        ({ editor, state, dispatch }) => {
          if (!editor.isEditable || editor.isDestroyed) return false
          const found = findImageBlock(editor.state, blockId)
          if (!found) return false
          const run = urlImportRun(editor, found, blockId, url, source, true)
          if (!run) return false
          if (!dispatch) return true
          return startImport(editor, blockId, { kind: "url", url }, source, run, state.tr)
        },

      writeRawImageUrl:
        (blockId, url) =>
        ({ editor, state, dispatch }) => {
          if (!editor.isEditable || editor.isDestroyed) return false
          const found = findImageBlock(editor.state, blockId)
          if (!found) return false
          if (!dispatch) return true

          const normalized = normalizeMediaUrlInput("image", url)
          if ("ok" in normalized) {
            const tr = state.tr.setMeta("addToHistory", false)
            appendMediaImportMeta(tr, {
              type: "set",
              blockId,
              state: {
                phase: "error",
                requestId: nanoid(8),
                input: { kind: "url", url },
                source: "embed",
                error: normalized.error,
              },
            })
            dispatch(tr)
            return true
          }

          const validation = validateMediaImportResult("image", normalized)
          if (!validation.ok || validation.result.kind !== "asset") {
            const tr = state.tr.setMeta("addToHistory", false)
            appendMediaImportMeta(tr, {
              type: "set",
              blockId,
              state: {
                phase: "error",
                requestId: nanoid(8),
                input: { kind: "url", url },
                source: "embed",
                error: validation.ok ? "Unsupported media provider" : validation.error,
              },
            })
            dispatch(tr)
            return true
          }

          const tr = state.tr.setNodeMarkup(found.pos, undefined, {
            ...found.node.attrs,
            src: validation.result.src,
            width: null,
            height: null,
            sourceUrl: null,
          })
          clearImportState(tr, blockId)
          dispatch(tr)
          return true
        },

      retryMediaImport:
        (blockId) =>
        ({ editor, state, dispatch }) => {
          if (!editor.isEditable || editor.isDestroyed) return false
          const current = getMediaImportState(editor, blockId)
          if (!current || current.phase !== "error") return false
          const found = findMediaBlock(editor.state, blockId)
          if (!found) return false
          if (!dispatch) return true

          const run =
            current.input.kind === "file"
              ? fileImportRun(editor, found, blockId, current.input.file, current.source, true)
              : urlImportRun(editor, found, blockId, current.input.url, current.source, true)
          if (!run) return false
          return startImport(editor, blockId, current.input, current.source, run, state.tr)
        },

      retryImageImport:
        (blockId) =>
        ({ editor, state, dispatch }) => {
          if (!editor.isEditable || editor.isDestroyed) return false
          const current = getMediaImportState(editor, blockId)
          if (!current || current.phase !== "error") return false
          const found = findImageBlock(editor.state, blockId)
          if (!found) return false
          if (!dispatch) return true

          const run =
            current.input.kind === "file"
              ? fileImportRun(editor, found, blockId, current.input.file, current.source, false)
              : urlImportRun(editor, found, blockId, current.input.url, current.source, false)
          if (!run) return false
          return startImport(editor, blockId, current.input, current.source, run, state.tr)
        },
    } as Partial<RawCommands>
  },

  addProseMirrorPlugins() {
    const editor = this.editor
    const postApplyUrlImports: QueuedUrlImport[] = []

    return [
      new Plugin<MediaImportMap>({
        key: mediaImportPluginKey,
        state: {
          init: () => new Map(),
          apply: (tr, value) => applyMediaImportMeta(value, tr),
        },
        appendTransaction(_transactions, _oldState, newState) {
          const pending = collectPendingHtmlImports(newState)
          if (pending.length === 0) return null

          const tr = newState.tr.setMeta("addToHistory", false)

          for (const item of pending) {
            const found = findImageBlock(newState, item.blockId)
            const hookAvailable =
              !!found &&
              !!urlImportRun(editor, found, item.blockId, item.url, "paste-html", false) &&
              editor.isEditable

            tr.setNodeMarkup(item.pos, undefined, {
              ...item.node.attrs,
              pendingFromPaste: null,
              ...(hookAvailable ? {} : { src: item.url }),
            })

            if (!hookAvailable) continue

            const requestId = nanoid(8)
            appendMediaImportMeta(tr, {
              type: "set",
              blockId: item.blockId,
              state: {
                phase: "importing",
                requestId,
                input: { kind: "url", url: item.url },
                source: "paste-html",
              },
            })
            postApplyUrlImports.push({
              blockId: item.blockId,
              url: item.url,
              requestId,
            })
          }

          return tr
        },
        props: {
          handleDOMEvents: {
            drop: (view, event) => handleImageDrop(editor, view, event as DragEvent),
            paste: (view, event) => handleImageBinaryPaste(editor, view, event as ClipboardEvent),
          },
        },
        view: (view) => {
          const onloadFallback = createOnloadFallbackView(view)
          const overlays = createOverlayManager(editor, view)
          flushQueuedUrlImports(editor, postApplyUrlImports)
          return {
            update: () => {
              onloadFallback.update()
              flushQueuedUrlImports(editor, postApplyUrlImports)
              overlays.update()
            },
            destroy: () => {
              onloadFallback.destroy()
              overlays.destroy()
            },
          }
        },
      }),
    ]
  },
})
