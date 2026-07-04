// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Regression coverage for the header row/column switch freeze: the
// dropdown's own useRuneEditorState subscription (samePillDropdown) never
// changes for toggleTableHeaderRow/Column — a size-preserving setNodeMarkup
// that deliberately keeps the menu open — so Col/RowMenuItems must
// subscribe to isHeader directly (see TableActionsDropdown.tsx) or the
// switch never reflects the toggle.

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react"
import { Editor } from "@tiptap/core"
import { createRuneKit } from "@ocai/rune-core"
import { TableActionsDropdown } from "./TableActionsDropdown"

function makeTableEditor() {
  const element = document.createElement("div")
  document.body.appendChild(element)
  const editor = new Editor({ element, extensions: createRuneKit() })
  // withHeaderRow defaults to true (insertTable's own default), which would
  // start row 0 as tableHeader cells and make the row-toggle assertions
  // below start from `checked` — force a body-only table instead.
  editor.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: false })
  return {
    editor,
    cleanupEditor: () => {
      editor.destroy()
      element.remove()
    },
  }
}

// jsdom returns a zero rect for everything; the dropdown's virtual anchor
// (useStableVirtualElement) treats a zero-origin/zero-size rect as
// "unusable" and never mounts — stub a real rect for the pills it anchors to.
let restoreRect: (() => void) | null = null
beforeEach(() => {
  const real = HTMLElement.prototype.getBoundingClientRect
  HTMLElement.prototype.getBoundingClientRect = function () {
    if (
      this.classList?.contains("rune-col-pill") ||
      this.classList?.contains("rune-row-pill")
    ) {
      return new DOMRect(10, 10, 18, 18)
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
  cleanup()
})

describe("TableActionsDropdown — header switch", () => {
  it("flips checked state on header-column toggle and flips back", async () => {
    const { editor, cleanupEditor } = makeTableEditor()
    render(<TableActionsDropdown editor={editor} />)

    const pill = editor.view.dom.querySelector(".rune-col-pill") as HTMLElement
    fireEvent.click(pill)

    const toggle = await screen.findByRole("menuitemcheckbox", {
      name: "Header column",
    })
    expect(toggle).toHaveAttribute("aria-checked", "false")

    fireEvent.click(toggle)
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"))

    fireEvent.click(toggle)
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "false"))

    cleanupEditor()
  })

  it("flips checked state on header-row toggle and flips back", async () => {
    const { editor, cleanupEditor } = makeTableEditor()
    render(<TableActionsDropdown editor={editor} />)

    const pill = editor.view.dom.querySelector(".rune-row-pill") as HTMLElement
    fireEvent.click(pill)

    const toggle = await screen.findByRole("menuitemcheckbox", {
      name: "Header row",
    })
    expect(toggle).toHaveAttribute("aria-checked", "false")

    fireEvent.click(toggle)
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"))

    fireEvent.click(toggle)
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "false"))

    cleanupEditor()
  })
})
