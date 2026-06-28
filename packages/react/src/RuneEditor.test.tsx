// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { render, screen, waitFor } from "@testing-library/react"
import { beforeAll, describe, expect, it, vi } from "vitest"
import { RuneEditor } from "./RuneEditor"
import { Editor as CoreEditor } from "@tiptap/core"
import type { Editor } from "@tiptap/core"
import { createRuneKit } from "@ocai/rune-core"

beforeAll(() => {
  const zeroRect = () => new DOMRect(0, 0, 0, 0)
  const zeroRects = () => [zeroRect()] as unknown as DOMRectList
  if (!Range.prototype.getClientRects) {
    Range.prototype.getClientRects = zeroRects
  }
  if (!Range.prototype.getBoundingClientRect) {
    Range.prototype.getBoundingClientRect = zeroRect
  }
})

describe("RuneEditor", () => {
  it("renders a single .rune-editor and no legacy .rune-editor-surface wrapper", () => {
    render(<RuneEditor content="<p>Hello</p>" />)

    const editor = document.querySelector(".rune-editor")
    expect(editor).toBeInstanceOf(HTMLElement)
    expect(document.querySelector(".rune-editor-surface")).toBeNull()
  })

  it("applies className and style to .rune-editor", () => {
    render(<RuneEditor content="<p>Hello</p>" className="min-h-screen" style={{ minHeight: 600 }} />)

    const editor = document.querySelector(".rune-editor") as HTMLElement
    expect(editor.classList.contains("rune-editor")).toBe(true)
    expect(editor.classList.contains("min-h-screen")).toBe(true)
    expect(editor.style.minHeight).toBe("600px")
  })

  it("renders chrome and children as siblings of EditorContent (Fragment)", () => {
    render(
      <RuneEditor content="<p>Hello</p>">
        <div data-testid="child">child</div>
      </RuneEditor>,
    )

    // Children land in the same parent as .rune-editor (no wrapper div).
    const editor = document.querySelector(".rune-editor") as HTMLElement
    const child = screen.getByTestId("child")
    expect(child.parentElement).toBe(editor.parentElement)
  })

  it("forwards default placeholders into the Rune kit", async () => {
    let editor: Editor | null = null
    render(<RuneEditor content="<p></p>" onReady={(ed) => { editor = ed }} />)

    await waitFor(() => expect(editor).not.toBeNull())
    const placeholder = editor!.extensionManager.extensions.find(
      (extension) => extension.name === "placeholder",
    )
    expect(placeholder?.options.placeholders.emptyDocument).toBeUndefined()
    expect(placeholder?.options.placeholders.default).toBe('"/" for commands')
    expect(placeholder?.options.placeholders.heading).toBeTypeOf("function")
    // Toggle title is now painted by ToggleBodyPlugin (always-on),
    // not the focus-gated generic Placeholder. The key is explicitly
    // present-as-undefined so resolve.ts treats it as a hard opt-out
    // via its hasOwn check.
    expect(placeholder?.options.placeholders.toggle).toBeUndefined()
    expect(Object.prototype.hasOwnProperty.call(placeholder?.options.placeholders, "toggle")).toBe(true)
    // The in-document page title (opt-in TitleKit) opts OUT of the generic
    // Placeholder: title.css's always-on "New page" ::before is the only
    // title hint. The key is present-as-undefined so resolve.ts treats it as
    // a hard opt-out (hasOwn) and index.ts skips the unknown-key warning for
    // it (consumers without TitleKit aren't warned).
    expect(placeholder?.options.placeholders.title).toBeUndefined()
    expect(Object.prototype.hasOwnProperty.call(placeholder?.options.placeholders, "title")).toBe(true)
  })

  it("merges consumer placeholders without dropping other kit fields", async () => {
    let editor: Editor | null = null
    render(
      <RuneEditor
        content="<p></p>"
        placeholders={{ default: "Custom default" }}
        kit={{ blockIdTypes: ["paragraph", "heading"] }}
        onReady={(ed) => { editor = ed }}
      />,
    )

    await waitFor(() => expect(editor).not.toBeNull())
    const placeholder = editor!.extensionManager.extensions.find(
      (extension) => extension.name === "placeholder",
    )
    const blockId = editor!.extensionManager.extensions.find(
      (extension) => extension.name === "blockId",
    )
    expect(placeholder?.options.placeholders.default).toBe("Custom default")
    expect(placeholder?.options.placeholders.emptyDocument).toBeUndefined()
    expect(blockId?.options.types).toEqual(["paragraph", "heading"])
  })

  it("forwards top-level image import hooks into core kit storage", async () => {
    const importImageFile = vi.fn(async () => ({ src: "/image.png", width: 100, height: 80 }))
    const importImageUrl = vi.fn(async () => ({ src: "/remote.png", width: 120, height: 90 }))
    let editor: Editor | null = null

    render(
      <RuneEditor
        content="<p></p>"
        importImageFile={importImageFile}
        importImageUrl={importImageUrl}
        onReady={(ed) => { editor = ed }}
      />,
    )

    await waitFor(() => expect(editor).not.toBeNull())
    expect(editor!.storage.imageImport.importImageFile).toBe(importImageFile)
    expect(editor!.storage.imageImport.importImageUrl).toBe(importImageUrl)
  })

  it("forwards top-level media import hooks into core kit storage", async () => {
    const importMediaFile = vi.fn(async () => ({ kind: "asset" as const, src: "/media.bin" }))
    const importMediaUrl = vi.fn(async () => ({ kind: "asset" as const, src: "/remote.bin" }))
    let editor: Editor | null = null

    render(
      <RuneEditor
        content="<p></p>"
        importMediaFile={importMediaFile}
        importMediaUrl={importMediaUrl}
        onReady={(ed) => { editor = ed }}
      />,
    )

    await waitFor(() => expect(editor).not.toBeNull())
    expect(editor!.storage.imageImport.importMediaFile).toBe(importMediaFile)
    expect(editor!.storage.imageImport.importMediaUrl).toBe(importMediaUrl)
  })

  it("top-level image hooks override kit hooks when both are supplied", async () => {
    const kitLevel = vi.fn(async () => ({ src: "/kit.png", width: 100, height: 80 }))
    const topLevel = vi.fn(async () => ({ src: "/top-level.png", width: 120, height: 90 }))
    let editor: Editor | null = null

    render(
      <RuneEditor
        content="<p></p>"
        kit={{ importImageFile: kitLevel }}
        importImageFile={topLevel}
        onReady={(ed) => { editor = ed }}
      />,
    )

    await waitFor(() => expect(editor).not.toBeNull())
    expect(editor!.storage.imageImport.importImageFile).toBe(topLevel)
  })

  // -- block-link paste wiring helpers --

  function mockPlainTextClipboard(text: string): DataTransfer {
    const store = new Map<string, string>([["text/plain", text]])
    return {
      get types() {
        return Array.from(store.keys())
      },
      getData: (mime: string) => store.get(mime) ?? "",
      setData: (mime: string, value: string) => {
        store.set(mime, value)
      },
      clearData: () => {
        store.clear()
      },
    } as unknown as DataTransfer
  }

  function dispatchPlainPaste(editor: Editor, text: string) {
    const event = new Event("paste", { bubbles: true, cancelable: true })
    Object.defineProperty(event, "clipboardData", {
      value: mockPlainTextClipboard(text),
    })
    editor.view.dom.dispatchEvent(event)
  }

  it("does not show block-link paste UI when resolver is missing", async () => {
    let editor: Editor | null = null
    render(
      <RuneEditor
        content="<p></p>"
        onReady={(ed) => { editor = ed }}
        parseBlockLink={(href) => ({ docId: "doc-a", blockId: "target", href, refTarget: "doc-a#target" })}
      />,
    )
    await waitFor(() => expect(editor).not.toBeNull())

    dispatchPlainPaste(editor!, "/editor?doc=doc-a&block=target")

    await waitFor(() => {
      expect(screen.queryByText("Paste as")).toBeNull()
    })
  })

  it("does not show block-link paste UI when parser is missing", async () => {
    let editor: Editor | null = null
    render(
      <RuneEditor
        content="<p></p>"
        onReady={(ed) => { editor = ed }}
        resolveRef={async () => ({ displayText: "Doc A - Target" })}
      />,
    )
    await waitFor(() => expect(editor).not.toBeNull())

    dispatchPlainPaste(editor!, "/editor?doc=doc-a&block=target")

    await waitFor(() => {
      expect(screen.queryByText("Paste as")).toBeNull()
    })
  })

  it("wires block-link paste props through RuneEditor", async () => {
    let editor: Editor | null = null
    render(
      <RuneEditor
        content="<p></p>"
        onReady={(ed) => { editor = ed }}
        parseBlockLink={(href) => ({ docId: "doc-a", blockId: "target", href, refTarget: "doc-a#target" })}
        resolveRef={async () => ({ displayText: "Doc A - Target" })}
      />,
    )
    await waitFor(() => expect(editor).not.toBeNull())

    editor!.commands.focus()
    dispatchPlainPaste(editor!, "/editor?doc=doc-a&block=target")

    await screen.findByText("Paste as")
  })

  it("uses an external editor without replacing it and calls onReady once", async () => {
    const external = new CoreEditor({
      element: document.createElement("div"),
      extensions: createRuneKit({ suggestionMenus: false }),
      content: "<p>External</p>",
    })
    const onCreate = vi.fn()
    const onReady = vi.fn()

    const { rerender } = render(
      <RuneEditor
        editor={external as unknown as Editor}
        onCreate={onCreate}
        onReady={onReady}
      />,
    )
    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1))
    expect(onReady).toHaveBeenCalledWith(external)
    expect(onCreate).not.toHaveBeenCalled()

    rerender(
      <RuneEditor
        editor={external as unknown as Editor}
        onCreate={onCreate}
        onReady={() => {
          onReady(external as unknown as Editor)
        }}
      />,
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(onReady).toHaveBeenCalledTimes(1)
    expect(onCreate).not.toHaveBeenCalled()

    external.destroy()
  })

  it("fires onReady once for each distinct external editor instance", async () => {
    const first = new CoreEditor({
      element: document.createElement("div"),
      extensions: createRuneKit({ suggestionMenus: false }),
      content: "<p>First</p>",
    })
    const second = new CoreEditor({
      element: document.createElement("div"),
      extensions: createRuneKit({ suggestionMenus: false }),
      content: "<p>Second</p>",
    })
    const onReady = vi.fn()

    const { rerender } = render(
      <RuneEditor editor={first as unknown as Editor} onReady={onReady} />,
    )
    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1))

    rerender(<RuneEditor editor={second as unknown as Editor} onReady={onReady} />)
    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(2))
    expect(onReady).toHaveBeenLastCalledWith(second)

    first.destroy()
    second.destroy()
  })
})
