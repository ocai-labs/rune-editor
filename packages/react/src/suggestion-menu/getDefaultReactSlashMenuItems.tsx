// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { getDefaultSlashMenuItems } from "@ocai/rune-core";
import type { Editor } from "@tiptap/core";
import type { ComponentType } from "react";
import type { DefaultReactSuggestionItem } from "./types";
import {
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  TextIcon,
  BulletListIcon,
  NumberedListIcon,
  TaskListIcon,
  CodeIcon,
  QuoteIcon,
  DividerIcon,
  CalloutIcon,
  TableIcon,
  ImageBlockIcon,
  VideoIcon,
  AudioIcon,
  EmojiIcon,
  ToggleListIcon,
  ToggleHeading1Icon,
  ToggleHeading2Icon,
  ToggleHeading3Icon,
  MathIcon,
  TeXIcon,
  TableOfContentsIcon,
} from "@/icons";

type IconComponentType = ComponentType<{ size?: number }>;

// heading_4 reuses Heading3Icon because there is no Heading4Icon yet, not
// because the two look alike: H4 has had its own size step since the Notion
// pass (blocks/heading.css), so this is a placeholder to replace when the icon
// is drawn. Toggle has no heading_4 entry — Notion caps Toggle Heading at 3.
const ICONS: Record<string, IconComponentType> = {
  paragraph: TextIcon,
  heading_1: Heading1Icon,
  heading_2: Heading2Icon,
  heading_3: Heading3Icon,
  heading_4: Heading3Icon,
  bulletList: BulletListIcon,
  numberedList: NumberedListIcon,
  taskList: TaskListIcon,
  codeBlock: CodeIcon,
  blockquote: QuoteIcon,
  divider: DividerIcon,
  callout: CalloutIcon,
  table: TableIcon,
  image: ImageBlockIcon,
  video: VideoIcon,
  audio: AudioIcon,
  emoji: EmojiIcon,
  toggle: ToggleListIcon,
  toggle_heading_1: ToggleHeading1Icon,
  toggle_heading_2: ToggleHeading2Icon,
  toggle_heading_3: ToggleHeading3Icon,
  inlineEquation: MathIcon,
  blockEquation: TeXIcon,
  tableOfContents: TableOfContentsIcon,
};

// Pick the symbol-only alias (e.g. `#`, `>`, `---`, `1.`) so the slash
// menu can show it on the right as a punch-key hint. Letters are ruled
// out so we don't surface searchable text aliases like `h1` / `quote`.
const SYMBOL_ALIAS_RE = /^[^a-zA-Z]+$/;
const pickShortcut = (aliases: string[] | undefined): string | undefined =>
  aliases?.find((a) => a.length > 0 && SYMBOL_ALIAS_RE.test(a));

export function getDefaultReactSlashMenuItems(
  editor: Editor,
): DefaultReactSuggestionItem[] {
  return getDefaultSlashMenuItems(editor).map((item) => {
    const Icon = ICONS[item.key];
    const shortcut = item.key === "taskList" ? undefined : pickShortcut(item.aliases);
    return {
      ...item,
      icon: Icon ? <Icon size={18} /> : undefined,
      shortcut,
    };
  });
}
