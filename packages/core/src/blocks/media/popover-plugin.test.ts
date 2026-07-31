// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, expect, it, vi } from "vitest"
import { TextSelection } from "@tiptap/pm/state"
import { createTestEditor, type CreateTestEditorOptions } from "../../test-utils/createTestEditor"
import { getDocument } from "../../api"
import { mediaImportPluginKey } from "./import-plugin"
import {
  getMediaPopoverBlockId,
  mediaPopoverPluginKey,
} from "./popover-plugin"

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function editorWithMediaBlocks(options: CreateTestEditorOptions = {}) {
  return createTestEditor({
    ...options,
    content: options.content ?? {
      type: "doc",
      content: [
        {
          type: "image",
          attrs: {
            id: "image1",
            src: "",
            alt: "",
            width: null,
            height: null,
          },
        },
        {
          type: "video",
          attrs: {
            id: "video1",
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
        {
          type: "audio",
          attrs: {
            id: "audio1",
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
}

describe("MediaPopover", () => {
  it("openMediaPopover and closeMediaPopover update state for image, video, and audio blocks", () => {
    const editor = editorWithMediaBlocks()

    expect(getMediaPopoverBlockId(editor)).toBeNull()
    expect(editor.commands.openMediaPopover("image1")).toBe(true)
    expect(getMediaPopoverBlockId(editor)).toBe("image1")
    expect(editor.commands.openMediaPopover("video1")).toBe(true)
    expect(getMediaPopoverBlockId(editor)).toBe("video1")
    expect(editor.commands.openMediaPopover("audio1")).toBe(true)
    expect(getMediaPopoverBlockId(editor)).toBe("audio1")
    expect(editor.commands.closeMediaPopover()).toBe(true)
    expect(getMediaPopoverBlockId(editor)).toBeNull()
  })

  it("openImagePopover / closeImagePopover drive the shared media popover state", () => {
    const editor = editorWithMediaBlocks()

    expect(editor.commands.openImagePopover("image1")).toBe(true)
    expect(getMediaPopoverBlockId(editor)).toBe("image1")
    expect(editor.commands.closeImagePopover()).toBe(true)
    expect(getMediaPopoverBlockId(editor)).toBeNull()
  })

  it("openMediaPopover returns false for non-media blocks", () => {
    const editor = editorWithMediaBlocks({
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { id: "p1" },
            content: [{ type: "text", text: "Text" }],
          },
        ],
      } as never,
    })

    expect(editor.commands.openMediaPopover("p1")).toBe(false)
    expect(getMediaPopoverBlockId(editor)).toBeNull()
  })

  it("video placeholder click opens the media popover and is gated in read-only", () => {
    const editor = editorWithMediaBlocks({
      content: {
        type: "doc",
        content: [
          {
            type: "video",
            attrs: {
              id: "video1",
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
    const control = editor.view.dom.querySelector<HTMLElement>(
      ".rune-video-empty-control",
    )
    expect(control).not.toBeNull()

    const openEvent = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    })
    control!.dispatchEvent(openEvent)
    expect(openEvent.defaultPrevented).toBe(true)
    expect(getMediaPopoverBlockId(editor)).toBe("video1")

    expect(editor.commands.closeMediaPopover()).toBe(true)
    editor.setEditable(false)
    const readOnlyEvent = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    })
    control!.dispatchEvent(readOnlyEvent)

    expect(readOnlyEvent.defaultPrevented).toBe(false)
    expect(getMediaPopoverBlockId(editor)).toBeNull()
    expect(getDocument(editor)[0]).toMatchObject({
      type: "video",
      id: "video1",
      src: "",
    })
  })

  it("closes on selection change and when the active media block is deleted", () => {
    const editor = editorWithMediaBlocks({
      content: {
        type: "doc",
        content: [
          {
            type: "video",
            attrs: {
              id: "video1",
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
          {
            type: "paragraph",
            attrs: { id: "p1" },
            content: [{ type: "text", text: "After" }],
          },
        ],
      } as never,
    })

    expect(editor.commands.openMediaPopover("video1")).toBe(true)
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2)),
    )
    expect(getMediaPopoverBlockId(editor)).toBeNull()

    expect(editor.commands.openMediaPopover("video1")).toBe(true)
    expect(editor.commands.deleteBlocks(["video1"])).toBe(true)
    expect(getMediaPopoverBlockId(editor)).toBeNull()
  })

  it("closes when import starts for the active media block", () => {
    const pending = deferred<{ kind: "asset"; src: string }>()
    const importMediaUrl = vi.fn(() => pending.promise)
    const editor = editorWithMediaBlocks({
      kit: { importMediaUrl },
      content: {
        type: "doc",
        content: [
          {
            type: "audio",
            attrs: {
              id: "audio1",
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

    expect(editor.commands.openMediaPopover("audio1")).toBe(true)
    expect(
      editor.commands.startMediaUrlImport(
        "audio1",
        "https://cdn.example/audio.mp3",
        "embed",
      ),
    ).toBe(true)

    expect(importMediaUrl).toHaveBeenCalled()
    expect(getMediaPopoverBlockId(editor)).toBeNull()
  })

  it("does not open when the same transaction starts import for that block", () => {
    const editor = editorWithMediaBlocks({
      content: {
        type: "doc",
        content: [
          {
            type: "video",
            attrs: {
              id: "video1",
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

    editor.view.dispatch(
      editor.state.tr
        .setMeta(mediaImportPluginKey, {
          type: "set",
          blockId: "video1",
          state: {
            phase: "importing",
            requestId: "req1",
            input: { kind: "url", url: "https://source.example/video.mp4" },
            source: "embed",
          },
        })
        .setMeta(mediaPopoverPluginKey, { type: "open", blockId: "video1" })
        .setMeta("addToHistory", false),
    )

    expect(getMediaPopoverBlockId(editor)).toBeNull()
  })
})
