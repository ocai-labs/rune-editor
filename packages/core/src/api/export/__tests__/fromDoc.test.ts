// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// packages/core/src/api/export/__tests__/fromDoc.test.ts
// @vitest-environment node
//
// Deliberately runs in a bare Node environment (no jsdom): the whole point
// of exportMarkdownFromDoc is that headless consumers (Electron main
// process, servers, CLIs) can convert stored ProseMirror JSON to Markdown
// without a DOM and without importing @tiptap/core themselves.
import { describe, it, expect } from "vitest"
import type { JSONContent } from "@tiptap/core"
import { exportMarkdownFromDoc } from "../fromDoc"

function block(
  type: string,
  text: string,
  attrs?: Record<string, unknown>,
): JSONContent {
  const node: JSONContent = {
    type,
    attrs: { id: `${type}-1`, depth: 0, ...attrs },
  }
  if (text) node.content = [{ type: "text", text }]
  return node
}

function doc(content: JSONContent[]): JSONContent {
  return { type: "doc", content }
}

describe("exportMarkdownFromDoc", () => {
  it("runs without a DOM", () => {
    expect(typeof document).toBe("undefined")
  })

  it("converts a doc with heading, paragraph and nested list", () => {
    const out = exportMarkdownFromDoc(
      doc([
        block("heading", "Title", { level: 1 }),
        block("paragraph", "Hello world"),
        block("bulletList", "parent"),
        block("bulletList", "child", { depth: 1 }),
      ]),
    )
    expect(out).toBe("# Title\n\nHello world\n\n- parent\n    - child\n")
  })

  it("preserves inline marks", () => {
    const out = exportMarkdownFromDoc(
      doc([
        {
          type: "paragraph",
          attrs: { id: "p-1", depth: 0 },
          content: [
            { type: "text", text: "bold", marks: [{ type: "bold" }] },
            { type: "text", text: " plain" },
          ],
        },
      ]),
    )
    expect(out).toBe("**bold** plain\n")
  })

  it("fills missing block ids via schema defaults instead of throwing", () => {
    const out = exportMarkdownFromDoc(
      doc([{ type: "paragraph", content: [{ type: "text", text: "no attrs" }] }]),
    )
    expect(out).toBe("no attrs\n")
  })

  it("accepts CreateRuneKitOptions", () => {
    const out = exportMarkdownFromDoc(doc([block("paragraph", "opts")]), {
      suggestionMenus: false,
    })
    expect(out).toBe("opts\n")
  })

  it("can run repeatedly (editor lifecycle is self-contained)", () => {
    for (let i = 0; i < 3; i++) {
      expect(exportMarkdownFromDoc(doc([block("paragraph", `run ${i}`)]))).toBe(
        `run ${i}\n`,
      )
    }
  })
})
