// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Regression suite — in-cell (and regular-block) hardBreak read/round-trip
// fidelity (#21). hardBreak used to be silently DROPPED on export, gluing
// "line1"+"line2" into "line1line2" (a lossy read surface) and refusing
// `apply_edits` on any block that held one. Each fix lives in:
//   - api/export/serializeInline.ts — hardBreak → bare "<br>" (both dialects).
//   - extensions/clipboard/aiMarkdownSanitizer.ts — "<br>" whitelisted (empty
//     attr set: bare/self-closing accepted, any attribute rejected).
//   - extensions/clipboard/aiMarkdown.ts — splitCellLineBreaks: markdown-it
//     renders table-cell content BARE (never <p>-wrapped), so re-splitting a
//     cell's <br>-joined content into sibling <p>s is explicit, not something
//     PM's DOMParser does on its own.
//   - blocks/Table/TableCommands.ts — Shift-Enter/Mod-Enter inside a cell
//     always splits the tableParagraph (Enter's own semantics) instead of
//     falling through to a hardBreak insert.
//   - blocks/Table/normalization.ts (TableCellNormalization) — the PM-level
//     safety net: any hardBreak that still lands embedded in ONE
//     tableParagraph (paste / setContent / AI edits / collab) is split into
//     sibling tableParagraphs, converging every path on the same canonical
//     shape `serializeTableMarkdown` (blocks/Table/markdown.ts) reads/writes.
//
// Broader round-trip coverage (inline serialization + table-cell stacking /
// blank-line cases) lives in api/export/__tests__/{serializeInline,
// roundtrip}.test.ts; this file pins the specific read-surface + apply_edits
// symptoms the bug report was filed against, plus the syntax-verdict
// research that shaped the fix (native CommonMark hard-breaks vs a raw
// `<br>` tag, and why markdown-it forces an explicit cell splitter).

import { describe, it, expect } from "vitest"
import MarkdownIt from "markdown-it"
import { createTestEditor } from "../../test-utils/createTestEditor"
import { exportMarkdown } from "../../api/export/markdown"
import { parseAiMarkdown } from "../../extensions/clipboard/aiMarkdown"
import { applyMarkdownEdits } from "../../api/commands/applyMarkdownEdits"

function cellPara(text: string) {
  return { type: "tableParagraph", content: text ? [{ type: "text", text }] : [] }
}

// A 1x1 (header + 1 body row) table whose single body cell holds the given
// tableParagraph children.
function tableWithBodyCell(children: object[]) {
  return {
    type: "table",
    attrs: { id: "tbl", depth: 0 },
    content: [
      {
        type: "tableRow",
        content: [{ type: "tableHeader", content: [cellPara("H")] }],
      },
      {
        type: "tableRow",
        content: [{ type: "tableCell", content: children }],
      },
    ],
  }
}

describe("in-cell hardBreak — export + apply_edits (#21)", () => {
  it("an embedded in-cell hardBreak reads honestly as <br> (never glued) and apply_edits can edit the cell", () => {
    const editor = createTestEditor()
    editor.commands.setContent({
      type: "doc",
      content: [
        tableWithBodyCell([
          {
            type: "tableParagraph",
            content: [
              { type: "text", text: "line1" },
              { type: "hardBreak" },
              { type: "text", text: "line2" },
            ],
          },
        ]),
      ],
    })

    const md = exportMarkdown(editor)
    expect(md).toContain("line1<br>line2")
    expect(md).not.toContain("line1line2")

    const res = applyMarkdownEdits(editor, {
      edits: [{ oldStr: "line1", newStr: "X", blockId: "tbl" }],
    })
    expect(res.ok).toBe(true)
  })

  it("a stacked (multi-tableParagraph) cell exports <br>-joined lines and apply_edits can edit the cell", () => {
    const editor = createTestEditor()
    editor.commands.setContent({
      type: "doc",
      content: [tableWithBodyCell([cellPara("line1"), cellPara("line2")])],
    })

    const md = exportMarkdown(editor)
    expect(md).toContain("<br>") // stacked paragraphs join with <br>

    // The exported <br> re-parses back to a paragraph split (the cell
    // splitter), so the round-trip is lossless and apply_edits can edit it.
    const res = applyMarkdownEdits(editor, {
      edits: [{ oldStr: "line1", newStr: "X", blockId: "tbl" }],
    })
    expect(res.ok).toBe(true)
  })

  it("a hardBreak inside a REGULAR (non-cell) paragraph also reads honestly as <br>", () => {
    const editor = createTestEditor()
    editor.commands.setContent({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { id: "p1", depth: 0 },
          content: [
            { type: "text", text: "line1" },
            { type: "hardBreak" },
            { type: "text", text: "line2" },
          ],
        },
      ],
    })
    const md = exportMarkdown(editor)
    expect(md).toContain("line1<br>line2")
    expect(md).not.toContain("line1line2")
  })
})

describe("markdown hard-break syntax — parseAiMarkdown verdict (#21)", () => {
  it("a raw <br> tag, and both native CommonMark hard-break forms, all parse to a hardBreak", () => {
    const schema = createTestEditor().schema
    const forms: Record<string, string> = {
      "br-tag": "line1<br>line2",
      "backslash-newline": "line1\\\nline2",
      "two-space-newline": "line1  \nline2",
    }
    const hasBreak: Record<string, boolean> = {}
    for (const [label, src] of Object.entries(forms)) {
      hasBreak[label] = JSON.stringify(parseAiMarkdown(src, schema)).includes(
        '"hardBreak"',
      )
    }
    // Native CommonMark hard breaks (backslash-newline, two-space-newline)
    // have always round-tripped through the AI parse. A raw `<br>` now does
    // too, now that the sanitizer whitelists it (PM's own parseDOM already
    // mapped `<br>` → hardBreak; the sanitizer was the only blocker).
    expect(hasBreak).toEqual({
      "br-tag": true,
      "backslash-newline": true,
      "two-space-newline": true,
    })
  })

  it("PM parseDOM turns <p>a<br>b</p> into a hardBreak", () => {
    const editor = createTestEditor()
    editor.commands.setContent("<p>line1<br>line2</p>")
    const flat = JSON.stringify(editor.state.doc.toJSON())
    expect(flat).toContain("hardBreak")
  })

  it("markdown-it (html:true) renders table-cell content BARE, never <p>-wrapped — why the cell splitter is explicit", () => {
    const md = new MarkdownIt({ html: true })
    const src = "| H |\n| --- |\n| line1<br>line2 |"
    const html = md.render(src)
    // PM's DOMParser would otherwise auto-wrap the whole cell into ONE
    // tableParagraph (with the <br> surviving as an embedded hardBreak) —
    // splitCellLineBreaks (extensions/clipboard/aiMarkdown.ts) exists
    // because there is no <p> boundary here for PM to split on natively.
    expect(html).toContain("<td>line1<br>line2</td>")
    expect(html).not.toContain("<td><p>")
  })
})
