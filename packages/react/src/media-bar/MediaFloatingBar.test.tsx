// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import type { Editor } from "@tiptap/react"
import { blockSelectionKey, sideMenuKey } from "@ocai/rune-core"
import { RuneEditor } from "../RuneEditor"

// jsdom rects are all zero — serve a real rect for any .rune-block-content
// (collapse threshold) and the bar's `•••` button (the dropdown anchors to
// it) via the prototype, so the stubs survive PM NodeView recreation.
let contentRectWidth = 0
const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect

beforeAll(() => {
  const zeroRect = () => new DOMRect(0, 0, 0, 0)
  const zeroRects = () => [zeroRect()] as unknown as DOMRectList
  if (!Range.prototype.getClientRects) {
    Range.prototype.getClientRects = zeroRects
  }
  if (!Range.prototype.getBoundingClientRect) {
    Range.prototype.getBoundingClientRect = zeroRect
  }
  Element.prototype.getBoundingClientRect = function () {
    if (this instanceof HTMLElement) {
      if (contentRectWidth > 0 && this.classList.contains("rune-block-content")) {
        return new DOMRect(50, 50, contentRectWidth, 200)
      }
      if (this.hasAttribute("data-rune-media-bar-more")) {
        return new DOMRect(400, 54, 28, 28)
      }
    }
    return originalGetBoundingClientRect.call(this)
  }
})

afterAll(() => {
  Element.prototype.getBoundingClientRect = originalGetBoundingClientRect
})

beforeEach(() => {
  contentRectWidth = 0
})

const FILLED_IMAGE_DOC = {
  type: "doc",
  content: [
    {
      type: "image",
      attrs: { id: "img1", depth: 0, src: "data:image/png;base64,AAAA" },
    },
  ],
}

const EMPTY_IMAGE_DOC = {
  type: "doc",
  content: [{ type: "image", attrs: { id: "img-empty", depth: 0, src: "" } }],
}

const FILLED_AUDIO_DOC = {
  type: "doc",
  content: [
    {
      type: "audio",
      attrs: {
        id: "aud1",
        sourceType: "asset",
        src: "https://cdn.example/t.mp3",
        embedUrl: null,
        provider: null,
        sourceUrl: null,
        title: "",
      },
    },
  ],
}

async function renderEditor(content: unknown) {
  let editor: Editor | null = null
  render(<RuneEditor content={content as never} onReady={(ed) => { editor = ed }} />)
  await waitFor(() => expect(editor).not.toBeNull())
  return editor!
}

function stubContentRect(width: number) {
  contentRectWidth = width
}

function hoverBlock(editor: Editor, pos = 0) {
  editor.view.dispatch(
    editor.state.tr.setMeta(sideMenuKey, { hoveredPos: pos }),
  )
}

function barRoot(): HTMLElement | null {
  return document.querySelector("[data-rune-media-floating-bar]")
}

describe("MediaFloatingBar", () => {
  it("shows Alignment + Download + More inside the block content on a wide filled image", async () => {
    const editor = await renderEditor(FILLED_IMAGE_DOC)
    stubContentRect(400)
    hoverBlock(editor)

    expect(await screen.findByLabelText("Set block alignment")).toBeInTheDocument()
    expect(screen.getByLabelText("Download")).toBeInTheDocument()
    expect(screen.getByLabelText("Open block actions menu")).toBeInTheDocument()
    const mainPanel = screen.getByLabelText("Block actions")
    expect(mainPanel).toHaveClass("rune-chrome-surface")
    expect(barRoot()).not.toHaveClass("rune-chrome-surface")
    // Notion structure: the bar is an absolutely-positioned child of the
    // block's content element, not a floating portal at document level.
    expect(barRoot()!.closest(".rune-block-content")).not.toBeNull()
  })

  it("collapses to More alone on a narrow block", async () => {
    const editor = await renderEditor(FILLED_IMAGE_DOC)
    stubContentRect(100)
    hoverBlock(editor)

    expect(await screen.findByLabelText("Open block actions menu")).toBeInTheDocument()
    expect(screen.queryByLabelText("Set block alignment")).toBeNull()
    expect(screen.queryByLabelText("Download")).toBeNull()
  })

  it("does not show for an empty media block", async () => {
    const editor = await renderEditor(EMPTY_IMAGE_DOC)
    stubContentRect(400)
    hoverBlock(editor)

    await waitFor(() => expect(barRoot()).toBeNull())
  })

  it("does not show for audio at all", async () => {
    const editor = await renderEditor(FILLED_AUDIO_DOC)
    stubContentRect(400)
    hoverBlock(editor)

    await waitFor(() => expect(barRoot()).toBeNull())
  })

  it("writes align from the horizontal row and survives the doc change", async () => {
    const editor = await renderEditor(FILLED_IMAGE_DOC)
    stubContentRect(400)
    hoverBlock(editor)

    fireEvent.mouseDown(
      await screen.findByLabelText("Set block alignment"),
      { button: 0 },
    )
    const right = await screen.findByLabelText("Right alignment")
    expect(screen.getByRole("dialog", { name: "Set block alignment" })).toHaveClass(
      "rune-chrome-surface",
    )
    fireEvent.mouseDown(right, { button: 0 })

    expect(editor.state.doc.firstChild!.attrs.align).toBe("right")
    // hoveredPos restored in the same tr → bar still mounted.
    expect(sideMenuKey.getState(editor.state)?.hoveredPos).toBe(0)
    expect(screen.getByLabelText("Set block alignment")).toBeInTheDocument()
    expect(
      document
        .querySelector(".rune-block.rune-image")
        ?.getAttribute("data-align"),
    ).toBe("right")
  })

  it("••• opens the SAME BlockActionsDropdown the grip opens", async () => {
    const editor = await renderEditor(FILLED_IMAGE_DOC)
    stubContentRect(400)
    hoverBlock(editor)

    fireEvent.mouseDown(
      await screen.findByLabelText("Open block actions menu"),
      { button: 0 },
    )

    // Plugin state carries the media-bar anchor…
    await waitFor(() => {
      const ps = blockSelectionKey.getState(editor.state)
      expect(ps?.dropdownBlockId).toBe("img1")
      expect(ps?.dropdownAnchor).toBe("media-bar")
    })
    // …and the dropdown renders the full grip menu (per-type actions +
    // common rows), not a bar-local clone.
    expect(
      await screen.findByRole("menuitem", { name: "Replace" }),
    ).toBeInTheDocument()
    expect(screen.getByRole("menuitem", { name: "Download" })).toBeInTheDocument()
    expect(screen.getByRole("menuitem", { name: /Duplicate/ })).toBeInTheDocument()
    expect(screen.getByRole("menuitem", { name: /Delete/ })).toBeInTheDocument()

    // The bar stays mounted (pinned to the dropdown's block).
    expect(barRoot()).not.toBeNull()

    // Second press toggles the dropdown closed.
    fireEvent.mouseDown(screen.getByLabelText("Open block actions menu"), {
      button: 0,
    })
    await waitFor(() =>
      expect(blockSelectionKey.getState(editor.state)?.dropdownBlockId).toBeNull(),
    )
  })

  it("stays pinned while a grip-opened dropdown is up", async () => {
    const editor = await renderEditor(FILLED_IMAGE_DOC)
    stubContentRect(400)
    hoverBlock(editor)
    expect(await screen.findByLabelText("Open block actions menu")).toBeInTheDocument()

    editor.view.dispatch(
      editor.state.tr.setMeta(blockSelectionKey, { openDropdownFor: "img1" }),
    )

    // Hover moves away — the bar must NOT unmount while the dropdown is open.
    editor.view.dispatch(
      editor.state.tr.setMeta(sideMenuKey, { hoveredPos: null }),
    )
    expect(barRoot()).not.toBeNull()
  })
})
