// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, expect, it, vi } from "vitest"
import { createTestEditor } from "../../test-utils/createTestEditor"
import { getDocument } from "../../api"
import {
  getMediaImportState,
  mediaImportPluginKey,
  type RuneImageImportResult,
  type RuneMediaImportResult,
} from "./import-plugin"
import { getMediaPopoverBlockId } from "./popover-plugin"

/** Raw attrs of the first node in the doc carrying `id`, or null. */
function nodeAttrsById(
  editor: ReturnType<typeof createTestEditor>,
  id: string,
): Record<string, unknown> | null {
  let attrs: Record<string, unknown> | null = null
  editor.state.doc.descendants((node) => {
    if (attrs) return false
    if (node.attrs?.id === id) {
      attrs = node.attrs
      return false
    }
    return true
  })
  return attrs
}

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

function editorWithMedia(
  type: "image" | "video" | "audio",
  options: Parameters<typeof createTestEditor>[0] = {},
) {
  const baseAttrs = {
    id: `${type}1`,
    sourceType: "asset",
    src: "",
    embedUrl: null,
    provider: null,
    sourceUrl: null,
    title: "",
    width: null,
    height: null,
  }

  return createTestEditor({
    ...options,
    content: options.content ?? {
      type: "doc",
      content: [
        {
          type,
          attrs:
            type === "image"
              ? {
                  id: "image1",
                  src: "",
                  alt: "",
                  width: null,
                  height: null,
                }
              : baseAttrs,
        },
      ],
    } as never,
  })
}

describe("MediaImport commands", () => {
  it("insertMedia inserts an empty video with explicit id and opens the media popover", () => {
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

    expect(
      editor.commands.insertMedia("video", "end", {
        id: "video1",
        openPopover: true,
      }),
    ).toBe(true)

    expect(getDocument(editor)).toMatchObject([
      {
        type: "paragraph",
        id: "p1",
        depth: 0,
        text: "before",
      },
      {
        type: "video",
        id: "video1",
        depth: 0,
        sourceType: "asset",
        src: "",
        embedUrl: null,
        provider: null,
        sourceUrl: null,
        title: "",
        width: null,
        height: null,
      },
    ])
    expect(getMediaPopoverBlockId(editor)).toBe("video1")
  })

  it("insertVideo and insertAudio insert empty media blocks", () => {
    const editor = createTestEditor()

    expect(editor.commands.insertVideo("end", { id: "video1" })).toBe(true)
    expect(editor.commands.insertAudio("end", { id: "audio1" })).toBe(true)

    expect(getDocument(editor).filter((block) => block.type !== "paragraph")).toMatchObject([
      {
        type: "video",
        id: "video1",
        sourceType: "asset",
        src: "",
      },
      {
        type: "audio",
        id: "audio1",
        sourceType: "asset",
        src: "",
      },
    ])
  })

  it("startMediaUrlImport calls importMediaUrl with full media context", async () => {
    const pending = deferred<RuneMediaImportResult>()
    const importMediaUrl = vi.fn(() => pending.promise)
    const editor = editorWithMedia("video", {
      kit: { importMediaUrl },
    })

    expect(
      editor.commands.startMediaUrlImport(
        "video1",
        "https://source.example/clip.mp4",
        "embed",
      ),
    ).toBe(true)
    expect(importMediaUrl).toHaveBeenCalledWith(
      "https://source.example/clip.mp4",
      {
        blockId: "video1",
        kind: "video",
        nodeName: "video",
        source: "embed",
      },
    )
    expect(getMediaImportState(editor, "video1")).toMatchObject({
      phase: "importing",
      input: { kind: "url", url: "https://source.example/clip.mp4" },
      source: "embed",
    })

    pending.resolve({
      kind: "asset",
      src: "https://cdn.example/clip.mp4",
      sourceUrl: "https://source.example/clip.mp4",
      title: "Clip",
      width: 1280,
      height: 720,
    })
    await flushPromises()

    expect(getMediaImportState(editor, "video1")).toBeUndefined()
    expect(getDocument(editor)[0]).toMatchObject({
      type: "video",
      id: "video1",
      sourceType: "asset",
      src: "https://cdn.example/clip.mp4",
      sourceUrl: "https://source.example/clip.mp4",
      title: "Clip",
      width: 1280,
      height: 720,
    })
  })

  it("uses the built-in provider resolver when importMediaUrl is missing", async () => {
    const editor = editorWithMedia("video")

    expect(
      editor.commands.startMediaUrlImport(
        "video1",
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "embed",
      ),
    ).toBe(true)
    await flushPromises()

    expect(getMediaImportState(editor, "video1")).toBeUndefined()
    expect(getDocument(editor)[0]).toMatchObject({
      type: "video",
      sourceType: "embed",
      provider: "youtube",
      embedUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ",
      sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    })
  })

  it("writes unknown valid URLs as raw direct asset attrs when no provider matches", async () => {
    const editor = editorWithMedia("audio")

    expect(
      editor.commands.startMediaUrlImport(
        "audio1",
        "https://cdn.example/audio.mp3",
        "embed",
      ),
    ).toBe(true)
    await flushPromises()

    expect(getMediaImportState(editor, "audio1")).toBeUndefined()
    expect(getDocument(editor)[0]).toMatchObject({
      type: "audio",
      sourceType: "asset",
      src: "https://cdn.example/audio.mp3",
      sourceUrl: "https://cdn.example/audio.mp3",
    })
  })

  it("invalid hook result enters error state and leaves existing attrs unchanged", async () => {
    const pending = deferred<RuneMediaImportResult>()
    const editor = editorWithMedia("video", {
      kit: { importMediaUrl: vi.fn(() => pending.promise) },
      content: {
        type: "doc",
        content: [
          {
            type: "video",
            attrs: {
              id: "video1",
              sourceType: "asset",
              src: "https://cdn.example/old.mp4",
              embedUrl: null,
              provider: null,
              sourceUrl: null,
              title: "Old",
              width: 640,
              height: 360,
            },
          },
        ],
      } as never,
    })

    expect(
      editor.commands.startMediaUrlImport(
        "video1",
        "https://source.example/bad",
        "embed",
      ),
    ).toBe(true)
    pending.resolve({
      kind: "embed",
      provider: "soundcloud",
      sourceUrl: "https://soundcloud.com/example/demo",
      embedUrl:
        "https://w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2Fexample%2Fdemo",
    })
    await flushPromises()

    expect(getDocument(editor)[0]).toMatchObject({
      type: "video",
      src: "https://cdn.example/old.mp4",
      title: "Old",
      width: 640,
      height: 360,
    })
    expect(getMediaImportState(editor, "video1")).toMatchObject({
      phase: "error",
      input: { kind: "url", url: "https://source.example/bad" },
      source: "embed",
      error: "Unsupported media provider",
    })
  })

  it("supports the image URL import hook (startImageUrlImport / importImageUrl)", async () => {
    const pending = deferred<RuneImageImportResult>()
    const importImageUrl = vi.fn(() => pending.promise)
    const editor = editorWithMedia("image", {
      kit: { importImageUrl },
    })

    expect(
      editor.commands.startImageUrlImport(
        "image1",
        "/assets/imported.png",
        "embed",
      ),
    ).toBe(true)
    expect(importImageUrl).toHaveBeenCalledWith("/assets/imported.png", {
      blockId: "image1",
      source: "embed",
    })
    expect(getMediaImportState(editor, "image1")).toMatchObject({
      phase: "importing",
      input: { kind: "url", url: "/assets/imported.png" },
      source: "embed",
    })

    pending.resolve({
      src: "/assets/imported.png",
      width: 800,
      height: 600,
      alt: "Imported",
      sourceUrl: "/source",
    })
    await flushPromises()

    expect(getMediaImportState(editor, "image1")).toBeUndefined()
    expect(getDocument(editor)[0]).toMatchObject({
      type: "image",
      id: "image1",
      src: "/assets/imported.png",
      alt: "Imported",
      width: 800,
      height: 600,
      sourceUrl: "/source",
    })
  })

  it("startImageUrlImport falls back to built-in normalization without URL hooks", async () => {
    const editor = editorWithMedia("image", {
      content: {
        type: "doc",
        content: [
          {
            type: "image",
            attrs: {
              id: "m1",
              src: "",
              alt: "",
              width: null,
              height: null,
            },
          },
        ],
      } as never,
    })

    expect(
      editor.commands.startImageUrlImport("m1", "/remote.png", "embed"),
    ).toBe(true)
    await flushPromises()

    expect(getMediaImportState(editor, "m1")).toBeUndefined()
    expect(getDocument(editor)[0]).toMatchObject({
      type: "image",
      id: "m1",
      src: "/remote.png",
      alt: "",
      width: null,
      height: null,
      sourceUrl: "/remote.png",
    })
  })

  it("startImageUrlImport records error for blocked URL fallback without mutating attrs", async () => {
    const editor = editorWithMedia("image", {
      content: {
        type: "doc",
        content: [
          {
            type: "image",
            attrs: {
              id: "m1",
              src: "",
              alt: "",
              width: null,
              height: null,
            },
          },
        ],
      } as never,
    })

    expect(
      editor.commands.startImageUrlImport("m1", "javascript:alert(1)", "embed"),
    ).toBe(true)
    await flushPromises()

    expect(getDocument(editor)[0]).toMatchObject({
      type: "image",
      id: "m1",
      src: "",
      alt: "",
      width: null,
      height: null,
    })
    expect(getMediaImportState(editor, "m1")).toMatchObject({
      phase: "error",
      input: { kind: "url", url: "javascript:alert(1)" },
      source: "embed",
      error: "Unsupported media URL",
    })
  })
})

describe("MediaImport malformed hook results", () => {
  it("turns a null media hook result into error state without changing attrs", async () => {
    const importMediaUrl = vi.fn(() =>
      Promise.resolve(null as unknown as RuneMediaImportResult),
    )
    const editor = editorWithMedia("video", {
      kit: { importMediaUrl },
      content: {
        type: "doc",
        content: [
          {
            type: "video",
            attrs: {
              id: "video1",
              sourceType: "asset",
              src: "https://cdn.example/old.mp4",
              embedUrl: null,
              provider: null,
              sourceUrl: null,
              title: "Old",
              width: 640,
              height: 360,
            },
          },
        ],
      } as never,
    })

    expect(
      editor.commands.startMediaUrlImport(
        "video1",
        "https://source.example/bad.mp4",
        "embed",
      ),
    ).toBe(true)
    await flushPromises()

    expect(getDocument(editor)[0]).toMatchObject({
      type: "video",
      id: "video1",
      src: "https://cdn.example/old.mp4",
      title: "Old",
      width: 640,
      height: 360,
    })
    expect(getMediaImportState(editor, "video1")).toMatchObject({
      phase: "error",
      input: { kind: "url", url: "https://source.example/bad.mp4" },
      source: "embed",
      error: "Invalid media import result",
    })
  })

  it("turns an asset hook result missing src into error state", async () => {
    const importMediaUrl = vi.fn(() =>
      Promise.resolve({ kind: "asset" } as unknown as RuneMediaImportResult),
    )
    const editor = editorWithMedia("audio", {
      kit: { importMediaUrl },
    })

    expect(
      editor.commands.startMediaUrlImport(
        "audio1",
        "https://source.example/bad.mp3",
        "embed",
      ),
    ).toBe(true)
    await flushPromises()

    expect(getDocument(editor)[0]).toMatchObject({
      type: "audio",
      id: "audio1",
      src: "",
    })
    expect(getMediaImportState(editor, "audio1")).toMatchObject({
      phase: "error",
      error: "Invalid media import result",
    })
  })

  it("turns an embed hook result missing sourceUrl into error state", async () => {
    const importMediaUrl = vi.fn(() =>
      Promise.resolve({
        kind: "embed",
        provider: "youtube",
        embedUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ",
      } as unknown as RuneMediaImportResult),
    )
    const editor = editorWithMedia("video", {
      kit: { importMediaUrl },
    })

    expect(
      editor.commands.startMediaUrlImport(
        "video1",
        "https://source.example/bad",
        "embed",
      ),
    ).toBe(true)
    await flushPromises()

    expect(getDocument(editor)[0]).toMatchObject({
      type: "video",
      id: "video1",
      src: "",
      sourceType: "asset",
    })
    expect(getMediaImportState(editor, "video1")).toMatchObject({
      phase: "error",
      error: "Invalid media import result",
    })
  })

  it("turns a malformed legacy image hook result into error state", async () => {
    const importImageUrl = vi.fn(() =>
      Promise.resolve({ width: 12, height: 12 } as unknown as RuneImageImportResult),
    )
    const editor = editorWithMedia("image", {
      kit: { importImageUrl },
    })

    expect(
      editor.commands.startImageUrlImport("image1", "/broken.png", "embed"),
    ).toBe(true)
    await flushPromises()

    expect(getDocument(editor)[0]).toMatchObject({
      type: "image",
      id: "image1",
      src: "",
      alt: "",
      width: null,
      height: null,
    })
    expect(getMediaImportState(editor, "image1")).toMatchObject({
      phase: "error",
      error: "Invalid media import result",
    })
  })
})

describe("MediaImport overlays", () => {
  function queryMediaBlock(
    editor: ReturnType<typeof createTestEditor>,
    kind: "image" | "video" | "audio",
    blockId: string,
  ) {
    return editor.view.dom.querySelector<HTMLElement>(
      `.rune-block.rune-${kind}[data-id="${blockId}"]`,
    )
  }

  function queryOverlay(block: HTMLElement | null) {
    return block?.querySelector<HTMLElement>(".rune-image-import-overlay") ?? null
  }

  it("renders an importing overlay inside the active video block", async () => {
    const pending = deferred<RuneMediaImportResult>()
    const importMediaUrl = vi.fn(() => pending.promise)
    const editor = editorWithMedia("video", {
      kit: { importMediaUrl },
    })

    expect(
      editor.commands.startMediaUrlImport(
        "video1",
        "https://source.example/clip.mp4",
        "embed",
      ),
    ).toBe(true)
    await flushPromises()

    const block = queryMediaBlock(editor, "video", "video1")
    const overlay = queryOverlay(block)
    expect(block).not.toBeNull()
    expect(overlay).not.toBeNull()
    expect(overlay!.getAttribute("data-rune-image-import-overlay")).toBe(
      "importing",
    )
    expect(overlay!.getAttribute("data-rune-media-import-overlay")).toBe(
      "importing",
    )
    expect(overlay!.querySelector(".rune-image-import-title")?.textContent).toBe(
      "Importing content",
    )
    expect(overlay!.parentElement).toBe(block)
  })

  it("renders audio error overlay and retry restarts media import", async () => {
    const first = deferred<RuneMediaImportResult>()
    const second = deferred<RuneMediaImportResult>()
    const importMediaUrl = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const editor = editorWithMedia("audio", {
      kit: { importMediaUrl },
    })

    expect(
      editor.commands.startMediaUrlImport(
        "audio1",
        "https://source.example/audio.mp3",
        "embed",
      ),
    ).toBe(true)

    first.reject(new Error("Audio import failed"))
    await flushPromises()

    const block = queryMediaBlock(editor, "audio", "audio1")
    const overlay = queryOverlay(block)
    expect(block).not.toBeNull()
    expect(overlay).not.toBeNull()
    expect(overlay!.getAttribute("data-rune-image-import-overlay")).toBe("error")
    expect(overlay!.querySelector(".rune-image-import-message")?.textContent).toBe(
      "Audio import failed",
    )

    const retry = overlay!.querySelector<HTMLButtonElement>(
      'button[aria-label="Retry import"]',
    )
    expect(retry).not.toBeNull()
    retry!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
    await flushPromises()

    expect(importMediaUrl).toHaveBeenCalledTimes(2)
    expect(importMediaUrl).toHaveBeenLastCalledWith(
      "https://source.example/audio.mp3",
      {
        blockId: "audio1",
        kind: "audio",
        nodeName: "audio",
        source: "embed",
      },
    )

    second.resolve({
      kind: "asset",
      src: "https://cdn.example/audio.mp3",
      sourceUrl: "https://source.example/audio.mp3",
      title: "Audio",
    })
    await flushPromises()

    expect(getMediaImportState(editor, "audio1")).toBeUndefined()
    expect(getDocument(editor)[0]).toMatchObject({
      type: "audio",
      sourceType: "asset",
      src: "https://cdn.example/audio.mp3",
      sourceUrl: "https://source.example/audio.mp3",
      title: "Audio",
    })
    expect(queryOverlay(block)).toBeNull()
  })

  it("finds media blocks by exact id without relying on CSS id escaping", async () => {
    const pending = deferred<RuneMediaImportResult>()
    const blockId = 'video"quote]'
    const editor = editorWithMedia("video", {
      kit: { importMediaUrl: vi.fn(() => pending.promise) },
      content: {
        type: "doc",
        content: [
          {
            type: "video",
            attrs: {
              id: blockId,
              sourceType: "asset",
              src: "",
              embedUrl: null,
              provider: null,
              sourceUrl: null,
              title: "",
              width: null,
              height: null,
            },
          },
        ],
      } as never,
    })

    expect(
      editor.commands.startMediaUrlImport(
        blockId,
        "https://source.example/clip.mp4",
        "embed",
      ),
    ).toBe(true)
    await flushPromises()

    const block = Array.from(
      editor.view.dom.querySelectorAll<HTMLElement>(".rune-block.rune-video[data-id]"),
    ).find((el) => el.getAttribute("data-id") === blockId)
    const overlay = queryOverlay(block ?? null)
    expect(block).not.toBeNull()
    expect(overlay).not.toBeNull()
    expect(overlay!.parentElement).toBe(block)
  })
})
