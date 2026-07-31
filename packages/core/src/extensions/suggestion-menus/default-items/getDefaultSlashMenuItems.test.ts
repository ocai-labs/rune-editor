// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Text from "@tiptap/extension-text";
import { Paragraph } from "../../../blocks/Paragraph/block";
import { Heading } from "../../../blocks/Heading/block";
import { Divider } from "../../../blocks/Divider/block";
import { createTestEditor } from "../../../test-utils/createTestEditor";
import { getDefaultSlashMenuItems } from "./getDefaultSlashMenuItems";

describe("getDefaultSlashMenuItems", () => {
  it("aggregates block-owned items from Paragraph + Heading + Divider", () => {
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: [Document, Paragraph, Heading, Divider, Text],
    });
    const keys = getDefaultSlashMenuItems(editor).map((i) => i.key);
    expect(keys).toEqual(
      expect.arrayContaining(["paragraph", "heading_1", "heading_2", "heading_3", "divider"]),
    );
    editor.destroy();
  });

  it("preserves block declaration order", () => {
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: [Document, Paragraph, Heading, Divider, Text],
    });
    const keys = getDefaultSlashMenuItems(editor).map((i) => i.key);
    const dividerIdx = keys.indexOf("divider");
    const heading3Idx = keys.indexOf("heading_3");
    expect(heading3Idx).toBeLessThan(dividerIdx);
    editor.destroy();
  });

  it("sources divider from editor.storage.divider.slashMenuItems", () => {
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: [Document, Divider, Text],
    });
    const dividerItems = (editor.extensionManager.extensions.find((e) => e.name === "divider")!
      .storage as {
      slashMenuItems?: (e: typeof editor) => Array<{
        key: string;
        title: string;
        aliases?: string[];
        group?: string;
        onItemClick?: unknown;
      }>;
    })
      .slashMenuItems!(editor);
    const items = getDefaultSlashMenuItems(editor).filter((i) => i.key === "divider");
    expect(items).toHaveLength(1);
    const item = items[0]!;
    const dividerItem = dividerItems[0]!;
    expect(item).toMatchObject({
      key: dividerItem.key,
      title: dividerItem.title,
      aliases: dividerItem.aliases,
      group: dividerItem.group,
    });
    expect(typeof item.onItemClick).toBe("function");
    editor.destroy();
  });

  it("omits divider if Divider is not registered", () => {
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: [Document, Paragraph, Text],
    });
    const keys = getDefaultSlashMenuItems(editor).map((i) => i.key);
    expect(keys).not.toContain("divider");
    editor.destroy();
  });
});

describe("DefaultSuggestionItem.block payload", () => {
  it("every built-in block slash item declares its block payload", () => {
    const editor = createTestEditor();
    const items = getDefaultSlashMenuItems(editor);
    // Drop inline-only / picker entries — they don't insert a complete
    // top-level block from `item.block` and intentionally leave it unset.
    const inlineOnlyKeys = new Set([
      "emoji",
      "inlineEquation",
      "image",
      "video",
      "audio",
    ]);
    const blockItems = items.filter((i) => !inlineOnlyKeys.has(i.key));

    expect(blockItems.map((i) => i.key)).toEqual(
      expect.arrayContaining([
        "paragraph",
        "heading_1",
        "heading_2",
        "heading_3",
        "heading_4",
        "bulletList",
        "numberedList",
        "taskList",
        "toggle",
        "toggle_heading_1",
        "toggle_heading_2",
        "toggle_heading_3",
        "blockquote",
        "codeBlock",
        "divider",
        "table",
      ]),
    );

    for (const item of blockItems) {
      expect(item.block, `${item.key} should declare item.block`).toBeDefined();
      expect(typeof item.block!.type).toBe("string");
    }
  });

  it("emoji item leaves block undefined", () => {
    const editor = createTestEditor();
    const items = getDefaultSlashMenuItems(editor);
    const emoji = items.find((i) => i.key === "emoji");
    expect(emoji).toBeDefined();
    expect(emoji!.block).toBeUndefined();
  });

  it("image item leaves block undefined", () => {
    const editor = createTestEditor();
    const items = getDefaultSlashMenuItems(editor);
    const image = items.find((i) => i.key === "image");
    expect(image).toBeDefined();
    expect(image!.block).toBeUndefined();
  });

  it("heading items carry the correct level in block.props", () => {
    const editor = createTestEditor();
    const items = getDefaultSlashMenuItems(editor);
    const expected: Record<string, number> = {
      heading_1: 1,
      heading_2: 2,
      heading_3: 3,
      heading_4: 4,
    };
    for (const [key, level] of Object.entries(expected)) {
      const item = items.find((i) => i.key === key)!;
      expect(item.block).toEqual({ type: "heading", props: { level } });
    }
  });

  it("toggle heading items carry level in block.props", () => {
    const editor = createTestEditor();
    const items = getDefaultSlashMenuItems(editor);
    const expected: Record<string, number> = {
      toggle_heading_1: 1,
      toggle_heading_2: 2,
      toggle_heading_3: 3,
    };
    for (const [key, level] of Object.entries(expected)) {
      const item = items.find((i) => i.key === key)!;
      expect(item.block).toEqual({ type: "toggle", props: { level } });
    }
  });
});
