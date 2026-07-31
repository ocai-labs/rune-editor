// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Text from "@tiptap/extension-text";
import { Paragraph } from "./block";
import { Heading } from "../Heading/block";

describe("Paragraph block", () => {
  it("exposes slashMenuItems() on its Tiptap storage", () => {
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: [Document, Paragraph, Text],
    });
    const fn = (editor.extensionManager.extensions.find((e) => e.name === "paragraph")!
      .storage as { slashMenuItems?: unknown }).slashMenuItems;
    expect(typeof fn).toBe("function");
    const items = (fn as Function)(editor);
    expect(items).toHaveLength(1);
    expect(items[0].key).toBe("paragraph");
    expect(items[0].title).toBe("Paragraph");
    editor.destroy();
  });

  it("renderDOM produces .rune-block > .rune-block-content > <p>", () => {
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: [Document, Paragraph, Text],
      content: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "hello" }] }],
      } as never,
    });

    const outer = editor.view.dom.querySelector<HTMLElement>(".rune-block");
    expect(outer).not.toBeNull();
    expect(outer!.tagName).toBe("DIV");

    const inner = outer!.firstElementChild as HTMLElement;
    expect(inner.classList.contains("rune-block-content")).toBe(true);

    const p = inner.firstElementChild as HTMLElement;
    expect(p.tagName).toBe("P");
    expect(p.textContent).toBe("hello");

    editor.destroy();
  });

  it("registers paragraph--extras with Mod-Alt-0 that converts a heading back to paragraph", () => {
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: [Document, Paragraph, Heading, Text],
    });

    const ext = editor.extensionManager.extensions.find(
      (e) => e.name === "paragraph--extras",
    );
    expect(ext).toBeDefined();

    const shortcuts = (ext as any).config.addKeyboardShortcuts.call({
      editor,
      type: ext,
      options: {},
    });
    expect(Object.keys(shortcuts)).toEqual(["Mod-Alt-0"]);

    // Heading → Mod-Alt-0 → paragraph.
    editor.commands.setContent({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "x" }] },
      ],
    } as never);
    editor.commands.setTextSelection(2);

    const ok = shortcuts["Mod-Alt-0"]({ editor });
    expect(ok).toBe(true);
    expect(editor.state.doc.firstChild?.type.name).toBe("paragraph");

    // Paragraph → Mod-Alt-0 → still paragraph (no-op, but Tiptap returns true
    // because setBlockType is "applicable" even when type already matches).
    shortcuts["Mod-Alt-0"]({ editor });
    expect(editor.state.doc.firstChild?.type.name).toBe("paragraph");

    editor.destroy();
  });
});

describe("Paragraph — clipboardRenderDOM", () => {
  it("emits a bare <p> with no chrome", () => {
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: [Document, Paragraph, Text],
    });
    const meta = editor.extensionManager.extensions.find((e) => e.name === "paragraph")
      ?.storage as { clipboardRenderDOM?: (a: { node: any }) => unknown };
    expect(typeof meta?.clipboardRenderDOM).toBe("function");
    const out = meta!.clipboardRenderDOM!({ node: editor.schema.nodes.paragraph!.create() });
    expect(out).toEqual(["p", 0]);
    editor.destroy();
  });
});
