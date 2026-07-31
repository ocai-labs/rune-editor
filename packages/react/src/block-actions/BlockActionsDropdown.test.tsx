// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Regression coverage for the ColorRow submenu state-leak flagged in
// PR #262 code review.
//
// Two layers:
//
//  1. Reducer probe — confirms the block-selection plugin can
//     transition `dropdownBlockId` A → B in a single transaction
//     without passing through null. This is the upstream precondition
//     of the leak: the outside-click handler in BlockActionsDropdown
//     exempts GRIP_SELECTOR, so a grip→grip click never produces a
//     `closeDropdown` meta.
//
//  2. Reset effect mirror — exercises the EXACT reset useEffect from
//     BlockActionsDropdown.tsx (prev-id ref pattern) and verifies it
//     calls submenu.close() on A → B as well as on A → null. Also
//     verifies the deliberate non-fire path: when `submenu` itself
//     changes (its memoized object updates when isOpen flips) but
//     dropdownBlockId is stable, close() must NOT be called — that
//     would race the user's own hover-open.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { Editor, type Content } from "@tiptap/core"
import {
  createBlockSpec,
  createRuneKit,
  blockSelectionKey,
  getMediaImportState,
  getMediaPopoverBlockId,
  type CreateRuneKitOptions,
} from "@ocai/rune-core"
import { MediaSourcePopover } from "../blocks/media/MediaSourcePopover"
import { BlockActionsDropdown } from "./BlockActionsDropdown"

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
  return { editor, cleanup: () => { editor.destroy(); element.remove() } }
}

function makeBlockActionsEditor(
  content: Content,
  kitOptions: CreateRuneKitOptions = {},
) {
  const element = document.createElement("div")
  document.body.appendChild(element)
  const editor = new Editor({
    element,
    extensions: createRuneKit(kitOptions),
    content,
  })
  const cleanup = () => {
    editor.destroy()
    element.remove()
  }
  return { editor, cleanup }
}

// The dropdown anchors via a LIVE getter (findAnchorRect re-queries the grip /
// media-bar `•••` on every floating-ui measurement), so stubbing a single
// element instance is fragile — PM may recreate the widget. Stub at the
// prototype for the anchor elements instead, so any re-queried instance reads a
// usable (non-zero) rect and the popover mounts. jsdom returns 0×0 otherwise.
let restoreRect: (() => void) | null = null
beforeEach(() => {
  const real = HTMLElement.prototype.getBoundingClientRect
  HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.matches?.('[data-rune-side-menu-button="grip"]')) {
      return new DOMRect(10, 10, 24, 24)
    }
    if (this.matches?.("[data-rune-media-bar-more]")) {
      return new DOMRect(10, 10, 24, 24)
    }
    if (this.classList?.contains("rune-block")) {
      return new DOMRect(10, 10, 320, 180)
    }
    return real.call(this)
  }
  restoreRect = () => {
    HTMLElement.prototype.getBoundingClientRect = real
  }
})
afterEach(() => {
  restoreRect?.()
  restoreRect = null
})

async function openDropdownFor(
  editor: Editor,
  blockId: string,
  selection: { from: string; to: string } = { from: blockId, to: blockId },
) {
  expect(editor.commands.setBlockSelection(selection)).toBe(true)
  editor.view.dispatch(
    editor.state.tr.setMeta(blockSelectionKey, { openDropdownFor: blockId }),
  )
  await waitFor(() =>
    expect(blockSelectionKey.getState(editor.state)?.dropdownBlockId).toBe(blockId),
  )
}

describe("blockSelectionKey reducer — dropdownBlockId transitions", () => {
  it("transitions dropdownBlockId from A to B in one tr without passing through null", () => {
    const { editor, cleanup } = makeEditor()
    const idA = editor.state.doc.child(0).attrs.id as string
    const idB = editor.state.doc.child(1).attrs.id as string

    editor.view.dispatch(
      editor.state.tr.setMeta(blockSelectionKey, { openDropdownFor: idA }),
    )
    expect(blockSelectionKey.getState(editor.state)?.dropdownBlockId).toBe(idA)

    // Single tr: only `openDropdownFor: B`. Mirrors the gesture path at
    // plugin.ts:182, which the outside-click handler
    // (BlockActionsDropdown.tsx:157, `target.closest(GRIP_SELECTOR)` bail)
    // cannot intercept.
    editor.view.dispatch(
      editor.state.tr.setMeta(blockSelectionKey, { openDropdownFor: idB }),
    )
    expect(blockSelectionKey.getState(editor.state)?.dropdownBlockId).toBe(idB)
    cleanup()
  })
})

describe("BlockActionsDropdown — inline-only color notice", () => {
  it("renders a disabled Color row and clicking it dispatches no transaction", async () => {
    const { editor, cleanup } = makeEditor()
    const id = editor.state.doc.firstChild!.attrs.id as string
    render(<BlockActionsDropdown editor={editor} />)
    await openDropdownFor(editor, id)

    const row = await screen.findByRole("menuitem", {
      name: "Color Inline text only",
    })
    expect(row).toBeDisabled()
    expect(row).not.toHaveAttribute("aria-haspopup")

    const onTransaction = vi.fn()
    editor.on("transaction", onTransaction)
    fireEvent.click(row)
    expect(onTransaction).not.toHaveBeenCalled()
    editor.off("transaction", onTransaction)
    cleanup()
  })
})

const replaceableMediaBlocks = [
  [
    "image",
    "img1",
    { src: "https://example.com/image.png", alt: "" },
    "Replace image",
  ],
  [
    "video",
    "vid1",
    { sourceType: "asset", src: "/clip.mp4", title: "Clip" },
    "Replace video",
  ],
  [
    "audio",
    "aud1",
    { sourceType: "asset", src: "/track.mp3", title: "Track" },
    "Replace audio",
  ],
] as const

describe("BlockActionsDropdown — media actions", () => {

  it.each(replaceableMediaBlocks)(
    "shows Replace for %s blocks and opens the media popover",
    async (type, id, attrs, popoverTitle) => {
      const { editor, cleanup } = makeBlockActionsEditor({
        type: "doc",
        content: [
          {
            type,
            attrs: {
              id,
              ...attrs,
            },
          },
        ],
      })
      render(
        <>
          <BlockActionsDropdown editor={editor} />
          <MediaSourcePopover editor={editor} />
        </>,
      )

      await openDropdownFor(editor, id)
      const replace = await screen.findByRole("menuitem", { name: "Replace" })

      fireEvent.click(replace)
      await waitFor(() => expect(getMediaPopoverBlockId(editor)).toBe(id))
      expect(await screen.findByText(popoverTitle)).toBeVisible()
      expect(blockSelectionKey.getState(editor.state)?.dropdownBlockId).toBeNull()

      cleanup()
    },
  )

  it("does not show Replace for paragraph blocks", async () => {
    const { editor, cleanup } = makeBlockActionsEditor({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { id: "p1" },
          content: [{ type: "text", text: "plain text" }],
        },
      ],
    })
    render(<BlockActionsDropdown editor={editor} />)

    await openDropdownFor(editor, "p1")
    expect(screen.queryByRole("menuitem", { name: "Replace" })).toBeNull()

    cleanup()
  })

  it("opens Replace for media block ids that are unsafe as CSS selectors", async () => {
    const id = 'vid"quote]'
    const { editor, cleanup } = makeBlockActionsEditor({
      type: "doc",
      content: [
        {
          type: "video",
          attrs: {
            id,
            sourceType: "asset",
            src: "/clip.mp4",
            title: "Clip",
          },
        },
      ],
    })
    render(
      <>
        <BlockActionsDropdown editor={editor} />
        <MediaSourcePopover editor={editor} />
      </>,
    )

    await openDropdownFor(editor, id)
    fireEvent.click(await screen.findByRole("menuitem", { name: "Replace" }))

    await waitFor(() => expect(getMediaPopoverBlockId(editor)).toBe(id))
    expect(await screen.findByText("Replace video")).toBeVisible()

    cleanup()
  })

  it("does not show Replace for multi-block selections that include media", async () => {
    const { editor, cleanup } = makeBlockActionsEditor({
      type: "doc",
      content: [
        {
          type: "video",
          attrs: {
            id: "vid1",
            sourceType: "asset",
            src: "/clip.mp4",
            title: "Clip",
          },
        },
        {
          type: "paragraph",
          attrs: { id: "p1" },
          content: [{ type: "text", text: "plain text" }],
        },
      ],
    })
    render(<BlockActionsDropdown editor={editor} />)

    await openDropdownFor(editor, "vid1", { from: "vid1", to: "p1" })
    await screen.findByRole("menuitem", { name: "Duplicate" })
    expect(screen.queryByRole("menuitem", { name: "Replace" })).toBeNull()

    cleanup()
  })

  it.each(replaceableMediaBlocks)(
    "does not show Replace while %s blocks are importing",
    async (type, id, attrs) => {
      const { editor, cleanup } = makeBlockActionsEditor(
        {
          type: "doc",
          content: [
            {
              type,
              attrs: {
                id,
                ...attrs,
              },
            },
          ],
        },
        {
          importMediaUrl: () => new Promise<never>(() => {}),
        },
      )
      render(<BlockActionsDropdown editor={editor} />)

      expect(
        editor.commands.startMediaUrlImport(
          id,
          "https://example.com/replacement",
          "embed",
        ),
      ).toBe(true)
      await waitFor(() =>
        expect(getMediaImportState(editor, id)).toMatchObject({
          phase: "importing",
        }),
      )

      await openDropdownFor(editor, id)
      expect(screen.queryByRole("menuitem", { name: "Replace" })).toBeNull()

      cleanup()
    },
  )
})

describe("BlockActionsDropdown — manifest-driven actions", () => {
  it("renders table actions from block spec metadata", async () => {
    const { editor, cleanup } = makeBlockActionsEditor({
      type: "doc",
      content: [
        {
          type: "table",
          attrs: { id: "table1", depth: 0 },
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  content: [
                    {
                      type: "tableParagraph",
                      content: [{ type: "text", text: "A" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    })
    render(<BlockActionsDropdown editor={editor} />)

    await openDropdownFor(editor, "table1")
    expect(
      await screen.findByRole("menuitem", { name: "Fit to width" }),
    ).toBeVisible()

    cleanup()
  })

  it("omits unknown block action icons without crashing", async () => {
    const UnknownActionBlock = createBlockSpec({
      type: "unknownActionBlock",
      content: "inline*",
      parseDOM: [{ tag: "p[data-unknown-action]" }],
      renderDOM: ({ HTMLAttributes }) => [
        "div",
        { ...HTMLAttributes, class: "rune-block" },
        ["div", { class: "rune-block-content" }, ["p", {}, 0]],
      ],
      sideMenu: { draggable: true },
      blockActions: () => [
        {
          id: "unknown-icon-action",
          label: "Unknown icon action",
          icon: "icon-token-not-in-react-map",
          run: () => true,
        },
      ],
    })
    const { editor, cleanup } = makeBlockActionsEditor(
      {
        type: "doc",
        content: [
          {
            type: "unknownActionBlock",
            attrs: { id: "u1", depth: 0 },
            content: [{ type: "text", text: "Unknown" }],
          },
        ],
      },
      {
        plugins: [
          { id: "unknown-action", blockExtensions: [UnknownActionBlock] },
        ],
      },
    )
    render(<BlockActionsDropdown editor={editor} />)

    await openDropdownFor(editor, "u1")
    expect(
      await screen.findByRole("menuitem", { name: "Unknown icon action" }),
    ).toBeVisible()

    cleanup()
  })
})
