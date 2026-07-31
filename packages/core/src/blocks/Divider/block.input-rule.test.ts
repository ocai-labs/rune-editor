// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Text from "@tiptap/extension-text";
import { Paragraph } from "../Paragraph/block";
import { Heading } from "../Heading/block";
import { Divider } from "./block";
import { createTestEditor } from "../../test-utils/createTestEditor";

function makeEditor(content?: object) {
  return new Editor({
    element: document.createElement("div"),
    extensions: [Document, Paragraph, Heading, Text, Divider],
    content: content as never,
  });
}

async function typeAtCaret(editor: Editor, text: string) {
  const { from, to } = editor.state.selection;
  const handled = editor.view.someProp("handleTextInput", (fn) =>
    fn(editor.view, to, to, text, null as any),
  );
  if (handled) return;

  editor.view.dispatch(editor.state.tr.setMeta("applyInputRules", { from: to, text }));
  await new Promise((r) => setTimeout(r, 0));
  if (editor.state.selection.from === from && editor.state.selection.to === to) {
    editor.commands.insertContent(text);
  }
}

function docChildTypes(editor: Editor) {
  const types: string[] = [];
  editor.state.doc.forEach((node) => types.push(node.type.name));
  return types;
}

describe("Divider block — input rule", () => {
  it("registers an extension named divider--input-rule", () => {
    const editor = makeEditor();
    const ext = editor.extensionManager.extensions.find(
      (e) => e.name === "divider--input-rule",
    );
    expect(ext).toBeDefined();
    editor.destroy();
  });

  it("replaces an empty paragraph with a divider, appends a paragraph, and moves the caret into it", async () => {
    const editor = makeEditor({
      type: "doc",
      content: [{ type: "paragraph" }],
    });

    editor.commands.focus();
    editor.commands.setTextSelection(1);
    await typeAtCaret(editor, "--- ");

    expect(docChildTypes(editor)).toEqual(["divider", "paragraph"]);
    expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
    expect(editor.state.selection.empty).toBe(true);
    editor.destroy();
  });

  it("does not fire mid-paragraph due to the regex anchor", async () => {
    const editor = makeEditor({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "hello" }] },
      ],
    });

    editor.commands.setTextSelection(6);
    await typeAtCaret(editor, "--- ");

    expect(docChildTypes(editor)).toEqual(["paragraph"]);
    expect(editor.state.doc.textContent).toContain("--- ");
    editor.destroy();
  });

  it("fires on a heading at start, converting it to a divider and trailing paragraph", async () => {
    const editor = makeEditor({
      type: "doc",
      content: [{ type: "heading", attrs: { level: 2 } }],
    });

    editor.commands.setTextSelection(1);
    await typeAtCaret(editor, "--- ");

    expect(docChildTypes(editor)).toEqual(["divider", "paragraph"]);
    editor.destroy();
  });

  describe("inside a table cell (regression: fitter ejected the divider to doc root)", () => {
    it("no-ops — typed text stays in the cell, table structure untouched, no divider anywhere", async () => {
      const editor = createTestEditor({
        element: document.createElement("div"),
        content: {
          type: "doc",
          content: [
            {
              type: "table",
              content: [
                {
                  type: "tableRow",
                  content: [
                    {
                      type: "tableCell",
                      content: [
                        {
                          type: "tableParagraph",
                          content: [{ type: "text", text: "---" }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        } as never,
      });

      // Caret at the end of "---" inside the cell's tableParagraph.
      let target = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "tableParagraph") target = pos;
      });
      expect(target).toBeGreaterThan(-1);
      editor.commands.setTextSelection(target + 1 + 3);
      await typeAtCaret(editor, " ");

      // No divider anywhere — neither in the cell nor ejected to the root.
      const types: string[] = [];
      editor.state.doc.descendants((node) => {
        types.push(node.type.name);
      });
      expect(types).not.toContain("divider");

      // Table structure untouched: one row, one cell, same tableParagraph.
      const table = editor.state.doc.child(0);
      expect(table.type.name).toBe("table");
      expect(table.childCount).toBe(1);
      const row = table.child(0);
      expect(row.childCount).toBe(1);
      const cell = row.child(0);
      expect(cell.childCount).toBe(1);
      expect(cell.child(0).type.name).toBe("tableParagraph");

      // The typed text stays as plain text in the cell.
      expect(cell.child(0).textContent).toBe("--- ");
    });
  });
});
