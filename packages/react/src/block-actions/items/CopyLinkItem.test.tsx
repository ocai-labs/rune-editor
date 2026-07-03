// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, it, expect, vi, beforeEach, afterEach, onTestFinished } from "vitest"
import { fireEvent, render, screen, cleanup } from "@testing-library/react"
import { Editor } from "@tiptap/core"
import { createRuneKit } from "@ocai/rune-core"
import { CopyLinkItem } from "./CopyLinkItem"

function makeEditor() {
  const element = document.createElement("div")
  document.body.appendChild(element)
  const editor = new Editor({
    element,
    extensions: createRuneKit(),
    content: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "alpha" }] },
        { type: "paragraph", content: [{ type: "text", text: "beta" }] },
      ],
    },
  })
  onTestFinished(() => {
    if (!editor.isDestroyed) editor.destroy()
    element.remove()
  })
  return editor
}

function firstBlockId(editor: Editor) {
  return editor.state.doc.child(0).attrs.id as string
}

afterEach(cleanup)

describe("CopyLinkItem", () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    })
  })

  it("renders enabled when targeting a single block", () => {
    const editor = makeEditor()
    const blockId = firstBlockId(editor)
    render(
      <CopyLinkItem
        editor={editor}
        blockId={blockId}
        mbsBlockCount={1}
        buildBlockLink={({ blockId }) => `/test?block=${blockId}`}
        onAfterCopy={vi.fn()}
      />,
    )
    const item = screen.getByRole("menuitem", { name: /copy link to block/i })
    expect(item).not.toHaveAttribute("aria-disabled", "true")
  })

  it("renders disabled when MBS spans >1 block", () => {
    const editor = makeEditor()
    render(
      <CopyLinkItem
        editor={editor}
        blockId={firstBlockId(editor)}
        mbsBlockCount={2}
        buildBlockLink={({ blockId }) => `/test?block=${blockId}`}
        onAfterCopy={vi.fn()}
      />,
    )
    const item = screen.getByRole("menuitem", { name: /copy link to block/i })
    expect(item).toHaveAttribute("aria-disabled", "true")
  })

  it("calls buildBlockLink, writes to clipboard, fires onCopyLink ok=true", async () => {
    const editor = makeEditor()
    const blockId = firstBlockId(editor)
    const buildBlockLink = vi.fn(({ blockId }: { blockId: string }) => `/p?block=${blockId}`)
    const onCopyLink = vi.fn()
    const onAfterCopy = vi.fn()
    render(
      <CopyLinkItem
        editor={editor}
        blockId={blockId}
        mbsBlockCount={1}
        buildBlockLink={buildBlockLink}
        onCopyLink={onCopyLink}
        onAfterCopy={onAfterCopy}
      />,
    )
    fireEvent.click(screen.getByRole("menuitem", { name: /copy link to block/i }))
    expect(buildBlockLink).toHaveBeenCalledWith({ editor, blockId })
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(`/p?block=${blockId}`)
    expect(onAfterCopy).toHaveBeenCalledTimes(1)
    await new Promise((r) => setTimeout(r, 0))
    expect(onCopyLink).toHaveBeenCalledWith({
      ok: true,
      blockId,
      url: `/p?block=${blockId}`,
    })
  })

  it("fires onCopyLink ok=false when clipboard write rejects", async () => {
    const editor = makeEditor()
    const blockId = firstBlockId(editor)
    const error = new Error("denied")
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockRejectedValue(error) },
    })
    const onCopyLink = vi.fn()
    render(
      <CopyLinkItem
        editor={editor}
        blockId={blockId}
        mbsBlockCount={1}
        buildBlockLink={({ blockId }) => `/p?block=${blockId}`}
        onCopyLink={onCopyLink}
        onAfterCopy={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole("menuitem", { name: /copy link to block/i }))
    await new Promise((r) => setTimeout(r, 0))
    expect(onCopyLink).toHaveBeenCalledWith({
      ok: false,
      blockId,
      url: `/p?block=${blockId}`,
      error,
    })
  })

  it("fires onCopyLink ok=false when navigator.clipboard is undefined (insecure context)", async () => {
    const editor = makeEditor()
    const blockId = firstBlockId(editor)
    Object.assign(navigator, { clipboard: undefined })
    const onCopyLink = vi.fn()
    render(
      <CopyLinkItem
        editor={editor}
        blockId={blockId}
        mbsBlockCount={1}
        buildBlockLink={({ blockId }) => `/p?block=${blockId}`}
        onCopyLink={onCopyLink}
        onAfterCopy={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole("menuitem", { name: /copy link to block/i }))
    await new Promise((r) => setTimeout(r, 0))
    expect(onCopyLink).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, blockId, url: `/p?block=${blockId}` }),
    )
  })

  it("does not call clipboard when disabled", async () => {
    const editor = makeEditor()
    const buildBlockLink = vi.fn(({ blockId }: { blockId: string }) => `/p?block=${blockId}`)
    render(
      <CopyLinkItem
        editor={editor}
        blockId={firstBlockId(editor)}
        mbsBlockCount={3}
        buildBlockLink={buildBlockLink}
      />,
    )
    fireEvent.click(screen.getByRole("menuitem", { name: /copy link to block/i }))
    expect(buildBlockLink).not.toHaveBeenCalled()
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled()
  })
})
