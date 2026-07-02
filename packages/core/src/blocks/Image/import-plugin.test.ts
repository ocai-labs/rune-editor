// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, expect, it, vi } from "vitest"
import { TextSelection } from "@tiptap/pm/state"
import { createTestEditor } from "../../test-utils/createTestEditor"
import { getDocument } from "../../api"
import {
  mediaImportPluginKey,
  getMediaImportState,
  type RuneImageImportResult,
} from "../media/import-plugin"

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function flushPromises() {
  await Promise.resolve()
  await Promise.resolve()
}

function imageFile(name = "image.png") {
  return new File(["image-bytes"], name, { type: "image/png" })
}

function textFile(name = "note.txt") {
  return new File(["text"], name, { type: "text/plain" })
}

function mockTransfer(files: File[], types: string[] = []): DataTransfer {
  return {
    files,
    types,
  } as unknown as DataTransfer
}

function mockDropEvent(files: File[], types: string[] = []): DragEvent {
  let defaultPrevented = false
  return {
    type: "drop",
    clientX: 0,
    clientY: 0,
    dataTransfer: mockTransfer(files, types),
    get defaultPrevented() { return defaultPrevented },
    preventDefault: () => { defaultPrevented = true },
  } as unknown as DragEvent
}

function mockPasteEvent(files: File[], types: string[] = []): ClipboardEvent {
  let defaultPrevented = false
  return {
    type: "paste",
    clipboardData: mockTransfer(files, types),
    get defaultPrevented() { return defaultPrevented },
    preventDefault: () => { defaultPrevented = true },
  } as unknown as ClipboardEvent
}

type ImportPluginDOMEvents = {
  drop?: (view: unknown, event: DragEvent) => boolean | void
  paste?: (view: unknown, event: ClipboardEvent) => boolean | void
}

function imageImportDOMEvents(editor: { state: { plugins: readonly unknown[] } }): ImportPluginDOMEvents {
  const plugins = editor.state.plugins as Array<{ spec: { key?: unknown }; props: { handleDOMEvents?: ImportPluginDOMEvents } }>
  const plugin = plugins.find((p) => p.spec.key === mediaImportPluginKey)
  return plugin?.props.handleDOMEvents ?? {}
}

function editorWithImage(options: Parameters<typeof createTestEditor>[0] = {}) {
  return createTestEditor({
    ...options,
    content: options.content ?? {
      type: "doc",
      content: [
        {
          type: "image",
          attrs: {
            id: "img1",
            src: "",
            alt: "",
            width: null,
            height: null,
          },
        },
      ],
    } as never,
  })
}

describe("ImageImport commands", () => {
  it("insertImage inserts an empty image with an eager id", () => {
    const editor = createTestEditor({
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { id: "p1" },
            content: [{ type: "text", text: "before" }],
          },
        ],
      } as never,
    })

    expect(editor.commands.insertImage({ id: "p1", side: "after" })).toBe(true)

    const doc = getDocument(editor)
    expect(doc).toHaveLength(2)
    expect(doc[1]).toMatchObject({
      type: "image",
      depth: 0,
      src: "",
      alt: "",
      width: null,
      height: null,
    })
    expect(doc[1]!.id).toMatch(/^[\w-]{8}$/)
  })

  it("insertImage accepts an explicit depth option", () => {
    const editor = createTestEditor({
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { id: "p1", depth: 2 },
            content: [{ type: "text", text: "nested" }],
          },
        ],
      } as never,
    })

    expect(editor.commands.insertImage({ id: "p1", side: "after" }, { depth: 2 })).toBe(true)

    expect(getDocument(editor)[1]).toMatchObject({
      type: "image",
      depth: 2,
      src: "",
      alt: "",
      width: null,
      height: null,
    })
  })

  it("startImageFileImport resolve writes attrs and clears sidecar state", async () => {
    const pending = deferred<RuneImageImportResult>()
    const file = imageFile()
    const importImageFile = vi.fn(() => pending.promise)
    const editor = editorWithImage({
      kit: { importImageFile },
    })

    expect(editor.commands.startImageFileImport("img1", file, "picker")).toBe(true)
    expect(importImageFile).toHaveBeenCalledWith(file, {
      blockId: "img1",
      source: "picker",
    })
    expect(getMediaImportState(editor, "img1")).toMatchObject({
      phase: "importing",
      input: { kind: "file", file },
      source: "picker",
    })

    pending.resolve({
      src: "https://cdn.example/a.png",
      width: 640,
      height: 480,
      alt: "Imported",
      sourceUrl: "file:///source.png",
    })
    await flushPromises()

    expect(getMediaImportState(editor, "img1")).toBeUndefined()
    expect(getDocument(editor)).toEqual([
      {
        type: "image",
        id: "img1",
        depth: 0,
        src: "https://cdn.example/a.png",
        alt: "Imported",
        width: 640,
        height: 480,
        sourceUrl: "file:///source.png",
      },
    ])
  })

  it("startImageFileImport reject records error and leaves attrs unchanged", async () => {
    const pending = deferred<RuneImageImportResult>()
    const file = imageFile()
    const editor = editorWithImage({
      kit: { importImageFile: vi.fn(() => pending.promise) },
    })

    expect(editor.commands.startImageFileImport("img1", file, "picker")).toBe(true)
    pending.reject(new Error("upload failed"))
    await flushPromises()

    expect(getDocument(editor)[0]).toMatchObject({
      type: "image",
      id: "img1",
      src: "",
      alt: "",
      width: null,
      height: null,
    })
    expect(getMediaImportState(editor, "img1")).toMatchObject({
      phase: "error",
      input: { kind: "file", file },
      source: "picker",
      error: "upload failed",
    })
  })

  it("startImageFileImport handles synchronous hook throws as error state", async () => {
    const file = imageFile()
    const editor = editorWithImage({
      kit: {
        importImageFile: vi.fn(() => {
          throw new Error("sync upload failed")
        }),
      },
    })

    expect(editor.commands.startImageFileImport("img1", file, "picker")).toBe(true)
    await flushPromises()

    expect(getDocument(editor)[0]).toMatchObject({
      type: "image",
      id: "img1",
      src: "",
      alt: "",
      width: null,
      height: null,
    })
    expect(getMediaImportState(editor, "img1")).toMatchObject({
      phase: "error",
      input: { kind: "file", file },
      source: "picker",
      error: "sync upload failed",
    })
  })

  it("retryImageImport reuses cached file input", async () => {
    const first = deferred<RuneImageImportResult>()
    const second = deferred<RuneImageImportResult>()
    const file = imageFile()
    const importImageFile = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const editor = editorWithImage({
      kit: { importImageFile },
    })

    editor.commands.startImageFileImport("img1", file, "picker")
    first.reject("first failed")
    await flushPromises()

    expect(editor.commands.retryImageImport("img1")).toBe(true)
    expect(importImageFile).toHaveBeenCalledTimes(2)
    expect(importImageFile).toHaveBeenLastCalledWith(file, {
      blockId: "img1",
      source: "picker",
    })

    second.resolve({
      src: "https://cdn.example/retry.png",
      width: 320,
      height: 200,
      alt: "Retry",
    })
    await flushPromises()

    expect(getMediaImportState(editor, "img1")).toBeUndefined()
    expect(getDocument(editor)[0]).toMatchObject({
      type: "image",
      src: "https://cdn.example/retry.png",
      alt: "Retry",
      width: 320,
      height: 200,
    })
  })

  it("startImageUrlImport routes through importImageUrl", async () => {
    const pending = deferred<RuneImageImportResult>()
    const importImageUrl = vi.fn(() => pending.promise)
    const editor = editorWithImage({
      kit: { importImageUrl },
    })

    expect(editor.commands.startImageUrlImport("img1", "https://source.example/a.png", "embed")).toBe(true)
    expect(importImageUrl).toHaveBeenCalledWith("https://source.example/a.png", {
      blockId: "img1",
      source: "embed",
    })

    pending.resolve({
      src: "https://cdn.example/a.png",
      width: 800,
      height: 600,
      sourceUrl: "https://source.example/a.png",
    })
    await flushPromises()

    expect(getDocument(editor)[0]).toMatchObject({
      type: "image",
      src: "https://cdn.example/a.png",
      alt: "",
      width: 800,
      height: 600,
      sourceUrl: "https://source.example/a.png",
    })
  })

  it("resolved imports clear stale alt and sourceUrl when result omits them", async () => {
    const pending = deferred<RuneImageImportResult>()
    const editor = editorWithImage({
      kit: { importImageUrl: vi.fn(() => pending.promise) },
      content: {
        type: "doc",
        content: [
          {
            type: "image",
            attrs: {
              id: "img1",
              src: "https://old.example/old.png",
              alt: "Old alt",
              width: 120,
              height: 80,
              sourceUrl: "https://old.example/source.png",
            },
          },
        ],
      } as never,
    })

    expect(editor.commands.startImageUrlImport("img1", "https://source.example/new.png", "embed")).toBe(true)
    pending.resolve({
      src: "https://cdn.example/new.png",
      width: 640,
      height: 480,
    })
    await flushPromises()

    const block = getDocument(editor)[0]
    expect(block).toMatchObject({
      type: "image",
      src: "https://cdn.example/new.png",
      alt: "",
      width: 640,
      height: 480,
    })
    expect(block).not.toHaveProperty("sourceUrl")
    expect(editor.state.doc.nodeAt(0)?.attrs.sourceUrl).toBeNull()
  })

  it("late resolve from an older request cannot overwrite a newer import", async () => {
    const first = deferred<RuneImageImportResult>()
    const second = deferred<RuneImageImportResult>()
    const importImageUrl = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const editor = editorWithImage({
      kit: { importImageUrl },
    })

    expect(editor.commands.startImageUrlImport("img1", "https://source.example/first.png", "embed")).toBe(true)
    expect(editor.commands.startImageUrlImport("img1", "https://source.example/second.png", "embed")).toBe(true)

    first.resolve({
      src: "https://cdn.example/first.png",
      width: 111,
      height: 111,
      alt: "First",
    })
    await flushPromises()

    expect(getMediaImportState(editor, "img1")).toMatchObject({
      phase: "importing",
      input: { kind: "url", url: "https://source.example/second.png" },
      source: "embed",
    })
    expect(getDocument(editor)[0]).toMatchObject({
      type: "image",
      src: "",
      alt: "",
      width: null,
      height: null,
    })

    second.resolve({
      src: "https://cdn.example/second.png",
      width: 222,
      height: 222,
      alt: "Second",
    })
    await flushPromises()

    expect(getMediaImportState(editor, "img1")).toBeUndefined()
    expect(getDocument(editor)[0]).toMatchObject({
      type: "image",
      src: "https://cdn.example/second.png",
      alt: "Second",
      width: 222,
      height: 222,
    })
  })

  it("writeRawImageUrl writes src with null dimensions and clears sidecar", () => {
    const editor = editorWithImage({
      content: {
        type: "doc",
        content: [
          {
            type: "image",
            attrs: {
              id: "img1",
              src: "https://old.example/old.png",
              alt: "Old alt",
              width: 120,
              height: 80,
              sourceUrl: "https://old.example/source.png",
            },
          },
        ],
      } as never,
    })

    expect(editor.commands.writeRawImageUrl("img1", "https://example.com/raw.png")).toBe(true)

    expect(getMediaImportState(editor, "img1")).toBeUndefined()
    expect(getDocument(editor)[0]).toMatchObject({
      type: "image",
      src: "https://example.com/raw.png",
      width: null,
      height: null,
    })
    expect(editor.state.doc.nodeAt(0)?.attrs.sourceUrl).toBeNull()
  })

  it("doc-changing import and raw URL writes remain undoable", async () => {
    const pending = deferred<RuneImageImportResult>()
    const editor = editorWithImage({
      kit: { importImageFile: vi.fn(() => pending.promise) },
    })

    expect(editor.commands.startImageFileImport("img1", imageFile(), "picker")).toBe(true)
    pending.resolve({
      src: "https://cdn.example/a.png",
      width: 640,
      height: 480,
      alt: "Imported",
    })
    await flushPromises()

    expect(getDocument(editor)[0]).toMatchObject({
      type: "image",
      src: "https://cdn.example/a.png",
      width: 640,
      height: 480,
    })
    expect(editor.commands.undo()).toBe(true)
    expect(getDocument(editor)[0]).toMatchObject({
      type: "image",
      src: "",
      alt: "",
      width: null,
      height: null,
    })

    expect(editor.commands.writeRawImageUrl("img1", "https://example.com/raw.png")).toBe(true)
    expect(getDocument(editor)[0]).toMatchObject({
      type: "image",
      src: "https://example.com/raw.png",
    })
    expect(editor.commands.undo()).toBe(true)
    expect(getDocument(editor)[0]).toMatchObject({
      type: "image",
      src: "",
      alt: "",
      width: null,
      height: null,
    })
  })

  it("file import commands no-op when required hooks are missing", () => {
    const editor = editorWithImage()

    expect(editor.commands.startImageFileImport("img1", imageFile(), "picker")).toBe(false)
    expect(getMediaImportState(editor, "img1")).toBeUndefined()
    expect(getDocument(editor)[0]).toMatchObject({ type: "image", src: "" })
  })

  it("read-only commands do not mutate state or invoke hooks", () => {
    const importImageFile = vi.fn()
    const importImageUrl = vi.fn()
    const editor = editorWithImage({
      kit: { importImageFile, importImageUrl },
    })
    editor.setEditable(false)

    expect(editor.commands.insertImage()).toBe(false)
    expect(editor.commands.startImageFileImport("img1", imageFile(), "picker")).toBe(false)
    expect(editor.commands.startImageUrlImport("img1", "https://example.com/a.png", "embed")).toBe(false)
    expect(editor.commands.writeRawImageUrl("img1", "https://example.com/raw.png")).toBe(false)
    expect(editor.commands.retryImageImport("img1")).toBe(false)

    expect(importImageFile).not.toHaveBeenCalled()
    expect(importImageUrl).not.toHaveBeenCalled()
    expect(getMediaImportState(editor, "img1")).toBeUndefined()
    expect(getDocument(editor)).toEqual([
      {
        type: "image",
        id: "img1",
        depth: 0,
        src: "",
        alt: "",
        width: null,
        height: null,
      },
    ])
  })

  it("late import resolve does not write attrs after editor becomes read-only", async () => {
    const pending = deferred<RuneImageImportResult>()
    const editor = editorWithImage({
      kit: { importImageFile: vi.fn(() => pending.promise) },
    })

    expect(editor.commands.startImageFileImport("img1", imageFile(), "picker")).toBe(true)
    expect(getMediaImportState(editor, "img1")?.phase).toBe("importing")
    editor.setEditable(false)

    pending.resolve({
      src: "https://cdn.example/a.png",
      width: 1,
      height: 1,
    })
    await flushPromises()

    expect(getMediaImportState(editor, "img1")).toBeUndefined()
    expect(getDocument(editor)[0]).toMatchObject({
      type: "image",
      src: "",
      width: null,
      height: null,
    })
  })

  it("late import reject clears pending state instead of writing error after read-only", async () => {
    const pending = deferred<RuneImageImportResult>()
    const file = imageFile()
    const editor = editorWithImage({
      kit: { importImageFile: vi.fn(() => pending.promise) },
    })

    expect(editor.commands.startImageFileImport("img1", file, "picker")).toBe(true)
    expect(getMediaImportState(editor, "img1")?.phase).toBe("importing")
    editor.setEditable(false)

    pending.reject(new Error("late failure"))
    await flushPromises()

    expect(getMediaImportState(editor, "img1")).toBeUndefined()
    expect(getDocument(editor)[0]).toMatchObject({
      type: "image",
      src: "",
      width: null,
      height: null,
    })
  })

  it("deleting a block mid-import prunes sidecar state and late resolve no-ops", async () => {
    const pending = deferred<RuneImageImportResult>()
    const editor = editorWithImage({
      kit: { importImageFile: vi.fn(() => pending.promise) },
    })

    editor.commands.startImageFileImport("img1", imageFile(), "picker")
    expect(getMediaImportState(editor, "img1")?.phase).toBe("importing")

    editor.commands.deleteBlocks(["img1"])
    expect(getMediaImportState(editor, "img1")).toBeUndefined()

    pending.resolve({
      src: "https://cdn.example/late.png",
      width: 10,
      height: 10,
    })
    await flushPromises()

    expect(getDocument(editor).some((block) => block.type === "image")).toBe(false)
  })

  it("onload fallback fills dimensions for raw URL images without width", async () => {
    const editor = editorWithImage({
      content: {
        type: "doc",
        content: [
          {
            type: "image",
            attrs: {
              id: "img1",
              src: "https://example.com/raw.png",
              alt: "",
              width: null,
              height: null,
            },
          },
        ],
      } as never,
    })

    const img = editor.view.dom.querySelector<HTMLImageElement>('img[data-rune-image]')
    expect(img).not.toBeNull()
    Object.defineProperty(img!, "naturalWidth", { configurable: true, value: 1024 })
    Object.defineProperty(img!, "naturalHeight", { configurable: true, value: 768 })

    img!.dispatchEvent(new Event("load"))
    await flushPromises()

    expect(getDocument(editor)[0]).toMatchObject({
      type: "image",
      src: "https://example.com/raw.png",
      width: 1024,
      height: 768,
    })
  })

  it("onload fallback does not write dimensions while read-only", async () => {
    const editor = editorWithImage({
      content: {
        type: "doc",
        content: [
          {
            type: "image",
            attrs: {
              id: "img1",
              src: "https://example.com/raw.png",
              alt: "",
              width: null,
              height: null,
            },
          },
        ],
      } as never,
    })
    editor.setEditable(false)

    const img = editor.view.dom.querySelector<HTMLImageElement>('img[data-rune-image]')
    expect(img).not.toBeNull()
    Object.defineProperty(img!, "naturalWidth", { configurable: true, value: 1024 })
    Object.defineProperty(img!, "naturalHeight", { configurable: true, value: 768 })

    img!.dispatchEvent(new Event("load"))
    await flushPromises()

    expect(getDocument(editor)[0]).toMatchObject({
      type: "image",
      src: "https://example.com/raw.png",
      width: null,
      height: null,
    })
  })

  it("onload fallback ignores images that already have dimensions", async () => {
    const editor = editorWithImage({
      content: {
        type: "doc",
        content: [
          {
            type: "image",
            attrs: {
              id: "img1",
              src: "https://example.com/raw.png",
              alt: "",
              width: 400,
              height: 300,
            },
          },
        ],
      } as never,
    })

    const img = editor.view.dom.querySelector<HTMLImageElement>('img[data-rune-image]')
    Object.defineProperty(img!, "naturalWidth", { configurable: true, value: 1024 })
    Object.defineProperty(img!, "naturalHeight", { configurable: true, value: 768 })

    img!.dispatchEvent(new Event("load"))
    await flushPromises()

    expect(getDocument(editor)[0]).toMatchObject({
      width: 400,
      height: 300,
    })
  })

  it("drop image file inserts image and starts file import", async () => {
    const pending = deferred<RuneImageImportResult>()
    const importImageFile = vi.fn(() => pending.promise)
    const file = imageFile("drop.png")
    const editor = editorWithImage({
      kit: { importImageFile },
      content: {
        type: "doc",
        content: [
          { type: "paragraph", attrs: { id: "p1", depth: 1 }, content: [{ type: "text", text: "A" }] },
        ],
      } as never,
    })
    editor.view.posAtCoords = () => ({ pos: 1, inside: 0 })
    const block = editor.view.dom.querySelector<HTMLElement>(".rune-block")!
    block.getBoundingClientRect = () => ({ top: 0, bottom: 40, left: 0, right: 200, width: 200, height: 40, x: 0, y: 0, toJSON: () => ({}) })

    const event = mockDropEvent([file])
    const plugin = imageImportDOMEvents(editor)

    expect(plugin.drop?.(editor.view, event)).toBe(true)
    await flushPromises()

    expect(event.defaultPrevented).toBe(true)
    expect(importImageFile).toHaveBeenCalledWith(file, expect.objectContaining({ source: "drop" }))
    const image = getDocument(editor).find((block) => block.type === "image")
    expect(image).toMatchObject({ type: "image", depth: 1, src: "" })
    const imageId = image!.id
    expect(getMediaImportState(editor, imageId)?.phase).toBe("importing")

    pending.resolve({ src: "https://cdn.example/drop.png", width: 10, height: 20 })
    await flushPromises()
    expect(getDocument(editor).find((block) => block.id === imageId)).toMatchObject({
      type: "image",
      src: "https://cdn.example/drop.png",
      width: 10,
      height: 20,
    })
  })

  it("drop with missing importImageFile consumes image files without inserting", () => {
    const editor = editorWithImage()
    const event = mockDropEvent([imageFile("drop.png")])
    const plugin = imageImportDOMEvents(editor)

    expect(plugin.drop?.(editor.view, event)).toBe(true)

    expect(event.defaultPrevented).toBe(true)
    expect(getDocument(editor)).toHaveLength(1)
  })

  it("drop ignores non-image files", () => {
    const importImageFile = vi.fn()
    const editor = editorWithImage({ kit: { importImageFile } })
    const event = mockDropEvent([textFile()])
    const plugin = imageImportDOMEvents(editor)

    expect(plugin.drop?.(editor.view, event)).toBe(false)

    expect(event.defaultPrevented).toBe(false)
    expect(importImageFile).not.toHaveBeenCalled()
  })

  it("binary paste image inserts after current block and starts file import", async () => {
    const pending = deferred<RuneImageImportResult>()
    const importImageFile = vi.fn(() => pending.promise)
    const file = imageFile("paste.png")
    const editor = editorWithImage({ kit: { importImageFile } })
    const event = mockPasteEvent([file], ["Files"])
    const plugin = imageImportDOMEvents(editor)

    expect(plugin.paste?.(editor.view, event)).toBe(true)
    await flushPromises()

    expect(event.defaultPrevented).toBe(true)
    expect(importImageFile).toHaveBeenCalledWith(file, expect.objectContaining({ source: "paste-binary" }))
    expect(getDocument(editor)).toHaveLength(2)
  })

  it("binary paste with a block selection inserts after the selected block, not at doc end", async () => {
    // Regression probe: a MultiBlockSelection's `to` sits on the block-END
    // boundary of the last selected block. For a non-leaf block (paragraph)
    // that boundary is inside no block's text bounds, so a bounds-only lookup
    // falls through to the doc-end fallback and the pasted image lands at the
    // BOTTOM of the document instead of right after the selection.
    const pending = deferred<RuneImageImportResult>()
    const importImageFile = vi.fn(() => pending.promise)
    const editor = createTestEditor({
      kit: { importImageFile },
      content: {
        type: "doc",
        content: [
          { type: "paragraph", attrs: { id: "p1" }, content: [{ type: "text", text: "one" }] },
          { type: "paragraph", attrs: { id: "p2" }, content: [{ type: "text", text: "two" }] },
          { type: "paragraph", attrs: { id: "p3" }, content: [{ type: "text", text: "three" }] },
        ],
      } as never,
    })
    expect(editor.commands.setBlockSelection({ from: "p2", to: "p2" })).toBe(true)
    const plugin = imageImportDOMEvents(editor)

    expect(plugin.paste?.(editor.view, mockPasteEvent([imageFile("paste.png")], ["Files"]))).toBe(true)
    await flushPromises()

    expect(getDocument(editor).map((block) => block.type)).toEqual([
      "paragraph",
      "paragraph",
      "image",
      "paragraph",
    ])
  })

  it("binary paste lets rune-doc clipboard MIME win", () => {
    const importImageFile = vi.fn()
    const editor = editorWithImage({ kit: { importImageFile } })
    const event = mockPasteEvent([imageFile("paste.png")], ["application/x-rune-doc", "Files"])
    const plugin = imageImportDOMEvents(editor)

    expect(plugin.paste?.(editor.view, event)).toBe(false)

    expect(event.defaultPrevented).toBe(false)
    expect(importImageFile).not.toHaveBeenCalled()
  })

  it("drop and binary paste are gated in read-only mode", () => {
    const importImageFile = vi.fn()
    const editor = editorWithImage({ kit: { importImageFile } })
    editor.setEditable(false)
    const plugin = imageImportDOMEvents(editor)

    const drop = mockDropEvent([imageFile("drop.png")])
    const paste = mockPasteEvent([imageFile("paste.png")], ["Files"])

    expect(plugin.drop?.(editor.view, drop)).toBe(false)
    expect(plugin.paste?.(editor.view, paste)).toBe(false)
    expect(importImageFile).not.toHaveBeenCalled()
    expect(getDocument(editor)).toHaveLength(1)
  })

  it("queued drop import does not call host hook after the inserted block is deleted", async () => {
    const importImageFile = vi.fn(() =>
      Promise.resolve({ src: "https://cdn.example/drop.png", width: 10, height: 20 }),
    )
    const editor = editorWithImage({
      kit: { importImageFile },
      content: {
        type: "doc",
        content: [
          { type: "paragraph", attrs: { id: "p1", depth: 1 }, content: [{ type: "text", text: "A" }] },
        ],
      } as never,
    })
    editor.view.posAtCoords = () => ({ pos: 1, inside: 0 })
    const block = editor.view.dom.querySelector<HTMLElement>(".rune-block")!
    block.getBoundingClientRect = () => ({ top: 0, bottom: 40, left: 0, right: 200, width: 200, height: 40, x: 0, y: 0, toJSON: () => ({}) })
    const plugin = imageImportDOMEvents(editor)

    expect(plugin.drop?.(editor.view, mockDropEvent([imageFile("drop.png")]))).toBe(true)
    const image = getDocument(editor).find((block) => block.type === "image")!
    editor.commands.deleteBlocks([image.id])
    await flushPromises()

    expect(importImageFile).not.toHaveBeenCalled()
    expect(getMediaImportState(editor, image.id)).toBeUndefined()
  })

  it("stores configured hooks on imageImport storage for sibling core helpers", () => {
    const importImageFile = vi.fn()
    const importImageUrl = vi.fn()
    const editor = createTestEditor({
      kit: { importImageFile, importImageUrl },
    })

    const storage = editor.storage.imageImport as {
      importImageFile?: unknown
      importImageUrl?: unknown
    }

    expect(storage.importImageFile).toBe(importImageFile)
    expect(storage.importImageUrl).toBe(importImageUrl)
  })

  it("appendTransaction clears pendingFromPaste and starts paste-html URL import", async () => {
    const pending = deferred<RuneImageImportResult>()
    const importImageUrl = vi.fn(() => pending.promise)
    const editor = editorWithImage({ kit: { importImageUrl } })
    const imageType = editor.state.schema.nodes.image!
    const node = imageType.create({
      id: "pasted1",
      src: "",
      alt: "A",
      width: null,
      height: null,
      pendingFromPaste: "https://source.example/a.png",
    })

    editor.view.dispatch(editor.state.tr.insert(editor.state.doc.content.size, node))
    await flushPromises()

    expect(editor.state.doc.lastChild?.attrs.pendingFromPaste).toBeNull()
    expect(importImageUrl).toHaveBeenCalledWith("https://source.example/a.png", {
      blockId: "pasted1",
      source: "paste-html",
    })
    expect(getMediaImportState(editor, "pasted1")?.phase).toBe("importing")

    pending.resolve({ src: "https://cdn.example/a.png", width: 100, height: 80, alt: "A" })
    await flushPromises()

    expect(getDocument(editor).find((block) => block.id === "pasted1")).toMatchObject({
      type: "image",
      src: "https://cdn.example/a.png",
      width: 100,
      height: 80,
    })
  })

  it("appendTransaction without hook writes stashed URL into src and clears pendingFromPaste", async () => {
    const editor = editorWithImage()
    const imageType = editor.state.schema.nodes.image!
    const node = imageType.create({
      id: "pasted1",
      src: "",
      alt: "",
      width: null,
      height: null,
      pendingFromPaste: "https://source.example/a.png",
    })

    editor.view.dispatch(editor.state.tr.insert(editor.state.doc.content.size, node))
    await flushPromises()

    expect(editor.state.doc.lastChild?.attrs.pendingFromPaste).toBeNull()
    expect(editor.state.doc.lastChild?.attrs.src).toBe("https://source.example/a.png")
    expect(getMediaImportState(editor, "pasted1")).toBeUndefined()
  })

  it("appendTransaction falls back to raw src when importImageUrl was removed between paste and apply", async () => {
    const importImageUrl = vi.fn()
    const editor = editorWithImage({ kit: { importImageUrl } })
    const imageType = editor.state.schema.nodes.image!
    const node = imageType.create({
      id: "pasted-race",
      src: "",
      alt: "",
      width: null,
      height: null,
      pendingFromPaste: "https://source.example/race.png",
    })

    // Simulate host reconfig: hook present at paste time, gone at apply time.
    editor.storage.imageImport.importImageUrl = undefined

    editor.view.dispatch(editor.state.tr.insert(editor.state.doc.content.size, node))
    await flushPromises()

    expect(editor.state.doc.lastChild?.attrs.pendingFromPaste).toBeNull()
    expect(editor.state.doc.lastChild?.attrs.src).toBe(
      "https://source.example/race.png",
    )
    expect(getMediaImportState(editor, "pasted-race")).toBeUndefined()
    expect(importImageUrl).not.toHaveBeenCalled()
  })

  it("public insertBlocks cannot inject pendingFromPaste or start paste-html import", async () => {
    const importImageUrl = vi.fn(() =>
      Promise.resolve({ src: "https://cdn.example/a.png", width: 1, height: 1 }),
    )
    const editor = editorWithImage({ kit: { importImageUrl } })

    expect(
      editor.commands.insertBlocks(
        [
          {
            type: "image",
            id: "public1",
            src: "",
            alt: "",
            width: null,
            height: null,
            pendingFromPaste: "https://source.example/a.png",
          } as never,
        ],
        { at: "end" },
      ),
    ).toBe(true)
    await flushPromises()

    const image = editor.state.doc.lastChild
    expect(image?.attrs.id).toBe("public1")
    expect(image?.attrs.pendingFromPaste).toBeNull()
    expect(importImageUrl).not.toHaveBeenCalled()
    expect(getMediaImportState(editor, "public1")).toBeUndefined()
  })

  it("multiple pending HTML paste images get independent imports", async () => {
    const first = deferred<RuneImageImportResult>()
    const second = deferred<RuneImageImportResult>()
    const importImageUrl = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const editor = editorWithImage({ kit: { importImageUrl } })
    const imageType = editor.state.schema.nodes.image!
    const nodes = [
      imageType.create({ id: "pasted1", src: "", alt: "", width: null, height: null, pendingFromPaste: "https://source.example/1.png" }),
      imageType.create({ id: "pasted2", src: "", alt: "", width: null, height: null, pendingFromPaste: "data:image/png;base64,abc" }),
    ]

    editor.view.dispatch(editor.state.tr.insert(editor.state.doc.content.size, nodes))
    await flushPromises()

    expect(importImageUrl).toHaveBeenCalledTimes(2)
    expect(getMediaImportState(editor, "pasted1")?.phase).toBe("importing")
    expect(getMediaImportState(editor, "pasted2")?.phase).toBe("importing")

    second.resolve({ src: "https://cdn.example/2.png", width: 2, height: 2 })
    await flushPromises()
    expect(getDocument(editor).find((block) => block.id === "pasted2")).toMatchObject({
      type: "image",
      src: "https://cdn.example/2.png",
    })

    first.resolve({ src: "https://cdn.example/1.png", width: 1, height: 1 })
    await flushPromises()
    expect(getDocument(editor).find((block) => block.id === "pasted1")).toMatchObject({
      type: "image",
      src: "https://cdn.example/1.png",
    })
  })

  it("HTML img paste with importImageUrl transforms marker then resolves through import hook", async () => {
    const pending = deferred<RuneImageImportResult>()
    const importImageUrl = vi.fn(() => pending.promise)
    const editor = editorWithImage({
      kit: { importImageUrl },
      content: {
        type: "doc",
        content: [
          { type: "paragraph", attrs: { id: "p1" }, content: [{ type: "text", text: "Start" }] },
        ],
      } as never,
    })
    const plugin = editor.state.plugins.find((p) => p.props.transformPastedHTML)!
    const html = plugin.props.transformPastedHTML!.call(
      plugin,
      '<p>before</p><img src="https://source.example/a.png" alt="A"><p>after</p>',
      editor.view,
    )

    editor.commands.insertContent(html)
    await flushPromises()

    const image = getDocument(editor).find((block) => block.type === "image")!
    expect(image).toMatchObject({ type: "image", src: "", alt: "A" })
    expect(importImageUrl).toHaveBeenCalledWith("https://source.example/a.png", {
      blockId: image.id,
      source: "paste-html",
    })
    editor.state.doc.descendants((node) => {
      expect(node.attrs.pendingFromPaste).not.toBe("https://source.example/a.png")
    })

    pending.resolve({ src: "https://cdn.example/a.png", width: 30, height: 40, alt: "A" })
    await flushPromises()
    expect(getDocument(editor).find((block) => block.id === image.id)).toMatchObject({
      type: "image",
      src: "https://cdn.example/a.png",
      width: 30,
      height: 40,
    })
  })

  it("HTML img paste with importMediaUrl transforms marker then resolves through media hook", async () => {
    const pending = deferred<{
      kind: "asset"
      src: string
      width: number
      height: number
      alt: string
      sourceUrl: string
    }>()
    const importMediaUrl = vi.fn(() => pending.promise)
    const editor = editorWithImage({
      kit: { importMediaUrl },
      content: {
        type: "doc",
        content: [
          { type: "paragraph", attrs: { id: "p1" }, content: [{ type: "text", text: "Start" }] },
        ],
      } as never,
    })
    const plugin = editor.state.plugins.find((p) => p.props.transformPastedHTML)!
    const html = plugin.props.transformPastedHTML!.call(
      plugin,
      '<p>before</p><img src="https://source.example/media.png" alt="Media"><p>after</p>',
      editor.view,
    )

    editor.commands.insertContent(html)
    await flushPromises()

    const image = getDocument(editor).find((block) => block.type === "image")!
    expect(image).toMatchObject({ type: "image", src: "", alt: "Media" })
    expect(importMediaUrl).toHaveBeenCalledWith("https://source.example/media.png", {
      blockId: image.id,
      kind: "image",
      nodeName: "image",
      source: "paste-html",
    })

    pending.resolve({
      kind: "asset",
      src: "https://cdn.example/media.png",
      width: 60,
      height: 70,
      alt: "Media",
      sourceUrl: "https://source.example/media.png",
    })
    await flushPromises()

    expect(getDocument(editor).find((block) => block.id === image.id)).toMatchObject({
      type: "image",
      src: "https://cdn.example/media.png",
      alt: "Media",
      width: 60,
      height: 70,
      sourceUrl: "https://source.example/media.png",
    })
  })

  it("HTML img paste without URL import hooks preserves raw src", () => {
    const editor = editorWithImage({
      content: {
        type: "doc",
        content: [
          { type: "paragraph", attrs: { id: "p1" }, content: [{ type: "text", text: "Start" }] },
        ],
      } as never,
    })
    const plugin = editor.state.plugins.find((p) => p.props.transformPastedHTML)!
    const html = plugin.props.transformPastedHTML!.call(
      plugin,
      '<img src="https://source.example/raw.png" alt="Raw">',
      editor.view,
    )

    editor.commands.insertContent(html)

    expect(getDocument(editor).find((block) => block.type === "image")).toMatchObject({
      type: "image",
      src: "https://source.example/raw.png",
      alt: "Raw",
    })
  })
})

describe("ImageImport overlays", () => {
  function queryOverlay(editor: ReturnType<typeof createTestEditor>) {
    return editor.view.dom.querySelector<HTMLElement>(".rune-image-import-overlay")
  }

  it("renders an importing overlay while sidecar phase is importing", async () => {
    const pending = deferred<RuneImageImportResult>()
    const editor = editorWithImage({
      kit: { importImageFile: vi.fn(() => pending.promise) },
    })

    expect(editor.commands.startImageFileImport("img1", imageFile(), "picker")).toBe(true)
    await flushPromises()

    const overlay = queryOverlay(editor)
    expect(overlay).not.toBeNull()
    expect(overlay!.getAttribute("data-rune-image-import-overlay")).toBe("importing")
    expect(overlay!.querySelector(".rune-image-import-title")?.textContent).toBe(
      "Importing content",
    )
  })

  it("renders an error overlay with the rejection message and a Retry button", async () => {
    const pending = deferred<RuneImageImportResult>()
    const editor = editorWithImage({
      kit: { importImageFile: vi.fn(() => pending.promise) },
    })

    editor.commands.startImageFileImport("img1", imageFile(), "picker")
    pending.reject(new Error("Upload failed"))
    await flushPromises()

    const overlay = queryOverlay(editor)
    expect(overlay).not.toBeNull()
    expect(overlay!.getAttribute("data-rune-image-import-overlay")).toBe("error")
    expect(
      overlay!.querySelector(".rune-image-import-message")?.textContent,
    ).toBe("Upload failed")
    const retry = overlay!.querySelector<HTMLButtonElement>(
      'button[aria-label="Retry import"]',
    )
    expect(retry).not.toBeNull()
  })

  it("Retry button dispatches retryImageImport", async () => {
    const first = deferred<RuneImageImportResult>()
    const second = deferred<RuneImageImportResult>()
    const file = imageFile()
    const importImageFile = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const editor = editorWithImage({ kit: { importImageFile } })

    editor.commands.startImageFileImport("img1", file, "picker")
    first.reject(new Error("Upload failed"))
    await flushPromises()

    const retry = queryOverlay(editor)!.querySelector<HTMLButtonElement>(
      'button[aria-label="Retry import"]',
    )!
    retry.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
    await flushPromises()

    expect(importImageFile).toHaveBeenCalledTimes(2)
    expect(importImageFile).toHaveBeenLastCalledWith(file, {
      blockId: "img1",
      source: "picker",
    })
  })

  it("Retry button is gated while editor is read-only", async () => {
    const first = deferred<RuneImageImportResult>()
    const importImageFile = vi.fn().mockReturnValueOnce(first.promise)
    const editor = editorWithImage({ kit: { importImageFile } })

    editor.commands.startImageFileImport("img1", imageFile(), "picker")
    first.reject(new Error("Upload failed"))
    await flushPromises()

    editor.setEditable(false)
    const retry = queryOverlay(editor)!.querySelector<HTMLButtonElement>(
      'button[aria-label="Retry import"]',
    )!
    retry.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
    await flushPromises()

    expect(importImageFile).toHaveBeenCalledTimes(1)
  })

  it("overlay disappears when sidecar state clears on resolve", async () => {
    const pending = deferred<RuneImageImportResult>()
    const editor = editorWithImage({
      kit: { importImageFile: vi.fn(() => pending.promise) },
    })

    editor.commands.startImageFileImport("img1", imageFile(), "picker")
    pending.resolve({
      src: "https://cdn.example/a.png",
      width: 10,
      height: 10,
    })
    await flushPromises()

    expect(queryOverlay(editor)).toBeNull()
  })

  it("overlay is removed when the host block is deleted mid-import", async () => {
    const pending = deferred<RuneImageImportResult>()
    const editor = editorWithImage({
      kit: { importImageFile: vi.fn(() => pending.promise) },
    })

    editor.commands.startImageFileImport("img1", imageFile(), "picker")
    await flushPromises()
    expect(queryOverlay(editor)).not.toBeNull()

    editor.commands.deleteBlocks(["img1"])
    await flushPromises()

    expect(queryOverlay(editor)).toBeNull()
  })
})

describe("ImageImport drop / paste into a column", () => {
  // Absolute PM pos of the (first) block carrying `id`, anywhere in the doc.
  function blockPosById(
    editor: ReturnType<typeof createTestEditor>,
    id: string,
  ): number {
    let pos = -1
    editor.state.doc.descendants((node, p) => {
      if (pos !== -1) return false
      if (node.attrs?.id === id) {
        pos = p
        return false
      }
      return true
    })
    return pos
  }

  // Node type of the parent holding the (first) inserted image — "column" when
  // it landed on a column surface, "doc" when it fell back to the root.
  function insertedImageParentType(
    editor: ReturnType<typeof createTestEditor>,
  ): string | null {
    let parentType: string | null = null
    editor.state.doc.descendants((node, pos) => {
      if (parentType) return false
      if (node.type.name === "image") {
        parentType = editor.state.doc.resolve(pos).parent.type.name
        return false
      }
      return true
    })
    return parentType
  }

  function twoColumnDoc() {
    return {
      type: "doc",
      content: [
        {
          type: "columnLayout",
          attrs: { id: "cl1", depth: 0 },
          content: [
            {
              type: "column",
              attrs: { id: "colL", width: 1 },
              content: [
                { type: "paragraph", attrs: { id: "L0" }, content: [{ type: "text", text: "left" }] },
              ],
            },
            {
              type: "column",
              attrs: { id: "colR", width: 1 },
              content: [
                { type: "paragraph", attrs: { id: "R0" }, content: [{ type: "text", text: "right" }] },
              ],
            },
          ],
        },
      ],
    } as never
  }

  it("drop over a column inserts the image INTO that column, not at the root", async () => {
    const pending = deferred<RuneImageImportResult>()
    const importImageFile = vi.fn(() => pending.promise)
    const editor = editorWithImage({
      kit: { importImageFile },
      content: twoColumnDoc(),
    })

    // Point the drop (clientX/clientY = 0,0 from mockDropEvent) at the LEFT
    // column: its rect contains the origin, the right column's does not, so
    // surfaceFromPoint resolves to colL. posAtCoords lands inside colL's text.
    const cols = editor.view.dom.querySelectorAll<HTMLElement>("[data-rune-column]")
    cols[0]!.getBoundingClientRect = () =>
      ({ top: -10, bottom: 100, left: -10, right: 100, width: 110, height: 110, x: -10, y: -10, toJSON: () => ({}) }) as DOMRect
    cols[1]!.getBoundingClientRect = () =>
      ({ top: -10, bottom: 100, left: 200, right: 300, width: 100, height: 110, x: 200, y: -10, toJSON: () => ({}) }) as DOMRect
    editor.view.posAtCoords = () => ({ pos: blockPosById(editor, "L0") + 1, inside: blockPosById(editor, "L0") })

    const event = mockDropEvent([imageFile("drop.png")])
    const plugin = imageImportDOMEvents(editor)

    expect(plugin.drop?.(editor.view, event)).toBe(true)
    await flushPromises()

    expect(event.defaultPrevented).toBe(true)
    expect(insertedImageParentType(editor)).toBe("column")
  })

  it("binary paste with the caret in a column inserts the image INTO that column", async () => {
    const pending = deferred<RuneImageImportResult>()
    const importImageFile = vi.fn(() => pending.promise)
    const editor = editorWithImage({
      kit: { importImageFile },
      content: twoColumnDoc(),
    })

    // Caret inside colR's paragraph — the pasted image must land as R0's
    // sibling on the column surface, not appended after the whole layout.
    const r0 = blockPosById(editor, "R0")
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, r0 + 1)),
    )

    const event = mockPasteEvent([imageFile("paste.png")], ["Files"])
    const plugin = imageImportDOMEvents(editor)

    expect(plugin.paste?.(editor.view, event)).toBe(true)
    await flushPromises()

    expect(event.defaultPrevented).toBe(true)
    expect(insertedImageParentType(editor)).toBe("column")
  })
})
