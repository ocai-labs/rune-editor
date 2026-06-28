// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, it, expect } from "vitest"
import { createTestEditor } from "../test-utils/createTestEditor"
import { createBlockSpec } from "../schema"
import { getAgentHiddenTypes } from "./schemaContext"

describe("getAgentHiddenTypes", () => {
  it("returns a Set containing agent-hidden block types and excluding normal blocks", () => {
    const HiddenBlock = createBlockSpec({
      type: "probeHidden",
      content: "inline*",
      agentHidden: true,
      parseDOM: [{ tag: "div.probe-hidden" }],
      renderDOM: ({ HTMLAttributes }) => [
        "div",
        { ...HTMLAttributes, class: "rune-block probe-hidden" },
        ["div", { class: "rune-block-content" }, 0],
      ],
    })
    const VisibleBlock = createBlockSpec({
      type: "probeVisible",
      content: "inline*",
      parseDOM: [{ tag: "div.probe-visible" }],
      renderDOM: ({ HTMLAttributes }) => [
        "div",
        { ...HTMLAttributes, class: "rune-block probe-visible" },
        ["div", { class: "rune-block-content" }, 0],
      ],
    })
    const editor = createTestEditor({
      kit: {
        plugins: [
          { id: "test-agent-hidden", blockExtensions: [HiddenBlock, VisibleBlock] },
        ],
      },
    })

    const hidden = getAgentHiddenTypes(editor)
    expect(hidden).toBeInstanceOf(Set)
    expect(hidden.has("probeHidden")).toBe(true)
    expect(hidden.has("probeVisible")).toBe(false)
    // A built-in normal block is never hidden.
    expect(hidden.has("paragraph")).toBe(false)
  })

  it("returns an empty Set when no block opts in", () => {
    const editor = createTestEditor()
    const hidden = getAgentHiddenTypes(editor)
    expect(hidden).toBeInstanceOf(Set)
    expect(hidden.size).toBe(0)
  })
})
