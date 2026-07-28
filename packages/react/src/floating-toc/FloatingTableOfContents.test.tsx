// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { useState } from "react"
import type { Editor } from "@tiptap/react"
import { MultiBlockSelection } from "@ocai/rune-core"
import { RuneEditor } from "../RuneEditor"
import {
  FloatingTableOfContents,
  extractHeadings,
  type FloatingTableOfContentsProps,
  type TocHeading,
} from "."

class TestPointerEvent extends MouseEvent {
  pointerType: string

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init)
    this.pointerType = init.pointerType ?? ""
  }
}

const STUB_RECT: DOMRect = {
  x: 800,
  y: 120,
  width: 56,
  height: 40,
  top: 120,
  right: 856,
  bottom: 160,
  left: 800,
  toJSON: () => ({}),
} as DOMRect

function TocHarness({
  onEditor,
  ...props
}: { onEditor?: (e: Editor | null) => void } & Partial<FloatingTableOfContentsProps> = {}) {
  const [editor, setEditor] = useState<Editor | null>(null)
  return (
    <>
      <RuneEditor
        content={
          '<h2 data-id="intro">Intro</h2><p>Body</p><h3 data-id="details">Details</h3>'
        }
        onReady={(e) => {
          setEditor(e)
          onEditor?.(e)
        }}
      />
      <FloatingTableOfContents editor={editor} {...props} />
    </>
  )
}

async function openCardAndGetRow(rowName: string): Promise<HTMLElement> {
  const column = await waitFor(() => {
    const el = document.querySelector("[data-rune-toc-column]")
    expect(el).toBeInstanceOf(HTMLElement)
    return el as HTMLElement
  })
  column.getBoundingClientRect = () => STUB_RECT
  fireEvent.pointerOver(column, { pointerType: "mouse" })
  return await screen.findByRole("button", { name: rowName })
}

describe("FloatingTableOfContents", () => {
  it("navigates to a heading and enters a MultiBlockSelection on it", async () => {
    vi.stubGlobal("PointerEvent", TestPointerEvent)

    let capturedEditor: Editor | null = null
    try {
      render(<TocHarness onEditor={(e) => { capturedEditor = e }} />)

      const detailsRow = await openCardAndGetRow("Details")
      const detailsBlock = document.querySelector('[data-id="details"]') as HTMLElement
      detailsBlock.scrollIntoView = vi.fn()

      fireEvent.click(detailsRow)

      expect(capturedEditor).not.toBeNull()
      const editor = capturedEditor as unknown as Editor
      // Single-block MBS over the clicked heading — the block-selection
      // plugin paints `data-block-selected="true"` as a node decoration,
      // which the visual halo CSS reads.
      expect(editor.state.selection).toBeInstanceOf(MultiBlockSelection)
      const sel = editor.state.selection as MultiBlockSelection
      expect(sel.blockIndices).toEqual([2, 2])
      expect(detailsBlock).toHaveAttribute("data-block-selected", "true")
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("calls onJump with the clicked heading after dispatching the MBS", async () => {
    vi.stubGlobal("PointerEvent", TestPointerEvent)

    const onJump = vi.fn<(heading: TocHeading) => void>()
    let capturedEditor: Editor | null = null
    try {
      render(
        <TocHarness
          onJump={onJump}
          onEditor={(e) => { capturedEditor = e }}
        />,
      )

      const detailsRow = await openCardAndGetRow("Details")
      const detailsBlock = document.querySelector('[data-id="details"]') as HTMLElement
      detailsBlock.scrollIntoView = vi.fn()

      fireEvent.click(detailsRow)

      expect(onJump).toHaveBeenCalledTimes(1)
      const heading = onJump.mock.calls[0]?.[0]
      expect(heading?.id).toBe("details")
      expect(heading?.text).toBe("Details")
      expect(heading?.level).toBe(3)
      // onJump fires after the MBS dispatch — observable via state.
      const editor = capturedEditor as unknown as Editor
      expect(editor.state.selection).toBeInstanceOf(MultiBlockSelection)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("position=\"none\" emits no fixed/top/right utilities so consumer owns layout", () => {
    render(<TocHarness position="none" />)
    const nav = document.querySelector("[data-rune-floating-toc]") as HTMLElement
    expect(nav).toBeInstanceOf(HTMLElement)
    const cls = nav.className
    // No positioning utilities at all — bare nav.
    expect(cls).not.toMatch(/\bfixed\b/)
    expect(cls).not.toMatch(/\babsolute\b/)
    expect(cls).not.toMatch(/\bsticky\b/)
    expect(cls).not.toMatch(/\btop-32\b/)
    expect(cls).not.toMatch(/\bright-0\b/)
  })

  it("position=\"sticky\" swaps the default positioning utility", () => {
    render(<TocHarness position="sticky" />)
    const nav = document.querySelector("[data-rune-floating-toc]") as HTMLElement
    expect(nav.className).toMatch(/\bsticky\b/)
    expect(nav.className).not.toMatch(/\bfixed\b/)
  })

  it("hides the whole TOC (visibility) while editor content overlaps the gutter, restores it after", async () => {
    // jsdom has no layout, so the geometry sampler is driven directly: a
    // non-zero bar-column rect plus a hit-test that lands on real editor
    // content (inside the ProseMirror DOM) is the overlap signal; landing
    // on chrome outside the editor is the cleared signal.
    const rafSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => {
        cb(0)
        return 0
      })
    const originalEFP = document.elementFromPoint
    let capturedEditor: Editor | null = null
    try {
      render(<TocHarness onEditor={(e) => { capturedEditor = e }} />)
      const column = await waitFor(() => {
        const el = document.querySelector("[data-rune-toc-column]")
        expect(el).toBeInstanceOf(HTMLElement)
        return el as HTMLElement
      })
      const nav = document.querySelector("[data-rune-floating-toc]") as HTMLElement
      column.getBoundingClientRect = () => STUB_RECT
      const editor = capturedEditor as unknown as Editor

      // Wide block under the bars: hit-test resolves to editor content.
      document.elementFromPoint = () => editor.view.dom
      fireEvent.scroll(window)
      await waitFor(() => expect(nav.className).toMatch(/\binvisible\b/))

      // Overlap cleared: hit-test resolves to chrome outside the editor.
      document.elementFromPoint = () => document.body
      fireEvent.scroll(window)
      await waitFor(() => expect(nav.className).not.toMatch(/\binvisible\b/))
    } finally {
      document.elementFromPoint = originalEFP
      rafSpy.mockRestore()
    }
  })

  it("does NOT hide when the editor content box reaches under the bar column (no gutter to sample — avoids a permanent false hide)", async () => {
    // Same hit-test in both phases (always lands inside the editor). Only the
    // editor's content-box right edge changes: when it ends LEFT of the sample
    // column, a hit there is a wide block bleeding into the gutter → hide; when
    // it extends UNDER the column (full-width / narrow-gutter layout), that hit
    // is just a normal full-width block → must NOT hide.
    const rafSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => {
        cb(0)
        return 0
      })
    const originalEFP = document.elementFromPoint
    let capturedEditor: Editor | null = null
    try {
      render(<TocHarness onEditor={(e) => { capturedEditor = e }} />)
      const column = await waitFor(() => {
        const el = document.querySelector("[data-rune-toc-column]")
        expect(el).toBeInstanceOf(HTMLElement)
        return el as HTMLElement
      })
      const nav = document.querySelector("[data-rune-floating-toc]") as HTMLElement
      column.getBoundingClientRect = () => STUB_RECT // sample x = left - 1 = 799
      const editor = capturedEditor as unknown as Editor
      document.elementFromPoint = () => editor.view.dom

      // Content box ends left of the column (real gutter) → wide-block overlap.
      editor.view.dom.getBoundingClientRect = () =>
        ({ ...STUB_RECT, left: 0, right: 700 }) as DOMRect
      fireEvent.scroll(window)
      await waitFor(() => expect(nav.className).toMatch(/\binvisible\b/))

      // Content box now extends under the column (no gutter) → same hit, but it
      // is indistinguishable from a normal block, so the TOC must reappear.
      editor.view.dom.getBoundingClientRect = () =>
        ({ ...STUB_RECT, left: 0, right: 2000 }) as DOMRect
      fireEvent.scroll(window)
      await waitFor(() => expect(nav.className).not.toMatch(/\binvisible\b/))
    } finally {
      document.elementFromPoint = originalEFP
      rafSpy.mockRestore()
    }
  })

  it("does NOT hide over a table's empty bleed padding (narrow table), but hides over real table content (wide table)", async () => {
    // A table's `.rune-table-scroll` viewport always reserves ~96px of bleed
    // padding that extends into the gutter, present even for a narrow table.
    // A bar-column hit on that EMPTY padding resolves to the scroll/chrome
    // wrappers — not real table geometry — so it must NOT hide the TOC; only
    // a hit inside `.rune-table-frame` (a wide table actually filling the
    // gutter) counts. jsdom has no layout, so drive the sampler directly.
    const rafSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => {
        cb(0)
        return 0
      })
    const originalEFP = document.elementFromPoint
    let capturedEditor: Editor | null = null
    try {
      render(<TocHarness onEditor={(e) => { capturedEditor = e }} />)
      const column = await waitFor(() => {
        const el = document.querySelector("[data-rune-toc-column]")
        expect(el).toBeInstanceOf(HTMLElement)
        return el as HTMLElement
      })
      const nav = document.querySelector("[data-rune-floating-toc]") as HTMLElement
      column.getBoundingClientRect = () => STUB_RECT // sample x = left - 1 = 799
      const editor = capturedEditor as unknown as Editor
      // Real gutter (content box ends left of the sample column) so the
      // gutter guard lets the sampler run.
      editor.view.dom.getBoundingClientRect = () =>
        ({ ...STUB_RECT, left: 0, right: 700 }) as DOMRect

      // Build the table chrome subtree: scroll > content > chrome-padding >
      // frame > table. Detached, but the sampler's `dom.contains` gate is
      // pointed at it so it reads as editor content.
      const scroll = document.createElement("div")
      scroll.className = "rune-table-scroll"
      const content = document.createElement("div")
      content.className = "rune-table-content"
      const chromePad = document.createElement("div")
      chromePad.className = "rune-table-chrome-padding"
      const frame = document.createElement("div")
      frame.className = "rune-table-frame"
      const table = document.createElement("table")
      table.className = "rune-table"
      frame.appendChild(table)
      chromePad.appendChild(frame)
      content.appendChild(chromePad)
      scroll.appendChild(content)
      const realContains = editor.view.dom.contains.bind(editor.view.dom)
      editor.view.dom.contains = (node: Node | null) =>
        (node !== null && scroll.contains(node)) || realContains(node)

      try {
        // Hit lands on the scroll viewport's empty bleed padding → narrow
        // table → must NOT hide.
        document.elementFromPoint = () => scroll
        fireEvent.scroll(window)
        await waitFor(() => expect(nav.className).not.toMatch(/\binvisible\b/))

        // Hit lands on the actual table inside the frame → wide table
        // bleeding into the gutter → hide.
        document.elementFromPoint = () => table
        fireEvent.scroll(window)
        await waitFor(() => expect(nav.className).toMatch(/\binvisible\b/))
      } finally {
        editor.view.dom.contains = realContains
      }
    } finally {
      document.elementFromPoint = originalEFP
      rafSpy.mockRestore()
    }
  })

  it("closes the hover card when the window loses focus (no pointerleave arrives on Cmd-Tab)", async () => {
    vi.stubGlobal("PointerEvent", TestPointerEvent)
    try {
      render(<TocHarness />)
      await openCardAndGetRow("Details")
      // Park the pointer on the card first — the hover refs now believe the
      // card is being hovered, and a window switch will never deliver the
      // pointerleave that would clear them.
      const card = document.querySelector("[data-rune-toc-hover-card]") as HTMLElement
      fireEvent.pointerOver(card, { pointerType: "mouse" })
      fireEvent.blur(window)
      await waitFor(() =>
        expect(screen.queryByRole("button", { name: "Details" })).toBeNull(),
      )
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("hover-leave still closes the card after a blur-close orphaned the pointer state", async () => {
    vi.stubGlobal("PointerEvent", TestPointerEvent)
    try {
      render(<TocHarness />)
      await openCardAndGetRow("Details")
      const card = document.querySelector("[data-rune-toc-hover-card]") as HTMLElement
      fireEvent.pointerOver(card, { pointerType: "mouse" })
      fireEvent.blur(window)
      await waitFor(() =>
        expect(screen.queryByRole("button", { name: "Details" })).toBeNull(),
      )
      // Reopen, then leave the column with the pointer going nowhere in
      // particular. The grace timer must be allowed to close the card — a
      // stale overCardRef from before the blur would veto it forever (the
      // "only a click closes it" wedge).
      const column = document.querySelector("[data-rune-toc-column]") as HTMLElement
      fireEvent.pointerOver(column, { pointerType: "mouse" })
      await screen.findByRole("button", { name: "Details" })
      fireEvent.pointerOut(column, { pointerType: "mouse" })
      await waitFor(() =>
        expect(screen.queryByRole("button", { name: "Details" })).toBeNull(),
      )
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe("extractHeadings", () => {
  // Re-exported from the barrel so downstream sidebar/outline/breadcrumb
  // consumers can build their own UI off the same data the floating TOC
  // uses, without re-implementing the doc walk.
  it("walks top-level headings via the barrel export", async () => {
    let capturedEditor: Editor | null = null
    render(<TocHarness onEditor={(e) => { capturedEditor = e }} />)
    await waitFor(() => expect(capturedEditor).not.toBeNull())
    const editor = capturedEditor as unknown as Editor
    const headings = extractHeadings(editor)
    expect(headings.map((h) => ({ id: h.id, level: h.level, text: h.text }))).toEqual([
      { id: "intro", level: 2, text: "Intro" },
      { id: "details", level: 3, text: "Details" },
    ])
  })
})
