// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { ReactNode, JSX } from "react";
import type { DefaultSuggestionItem, DefaultGridSuggestionItem } from "@ocai/rune-core";

export type DefaultReactSuggestionItem = DefaultSuggestionItem & {
  icon?: JSX.Element;
  size?: "default" | "small";
  /** Punch-key glyph rendered on the right (e.g. `#`, `>`, `---`). */
  shortcut?: string;
  /** Renders a check on the right when true. Used by the Turn-into menu
   *  AND by the slash menu in filtered mode to mark the source block's
   *  current type. */
  active?: boolean;
  /** Muted inline sub-label, rendered next to the title with a `·`
   *  separator (Notion pattern). The slash menu sets this to "Turn into"
   *  in filtered mode so users can see the action a click will perform;
   *  the browse view (empty query) leaves it undefined and falls back to
   *  group headers. */
  subLabel?: string;
};

export type DefaultReactGridSuggestionItem = DefaultGridSuggestionItem;

export type SuggestionMenuPopoverProps = {
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  sideOffset?: number;
  collisionPadding?: number;
  /** Extra classes appended to the default PopoverContent className.
   *  tailwind-merge (via cn() inside PopoverContent) resolves conflicts
   *  last-wins, so e.g. passing `"w-76"` overrides the default `w-81`. */
  className?: string;
};

export type SuggestionMenuProps<T> = {
  items: T[];
  loadingState: "loading-initial" | "loading" | "loaded";
  selectedIndex: number | undefined;
  /** Stable listbox id used to connect editor-root ARIA to the rendered menu. */
  menuId?: string;
  /** Whether the default renderer should show its "No results" row. */
  showEmptyState?: boolean;
  /** Whether selecting the active row should scroll it into view. */
  revealSelectedItem?: boolean;
  onItemClick?: (item: T) => void;
  /** Called when the pointer enters an item — pass `setSelectedIndex` here
   *  so mouse hover and keyboard selection share one highlight. */
  onItemHover?: (index: number) => void;
};

export type SuggestionMenuPopoverComponentProps = {
  open: boolean;
  getClientRect: (() => DOMRect | null) | null;
  /** The editor DOM the rect is measured within. floating-ui's autoUpdate reads
   *  it to find the real scroll ancestors so the menu re-positions on inner-
   *  container scroll, not just window. `getClientRect` here comes from core's
   *  shared suggestion store (Tiptap's caret clientRect) and must not be mutated,
   *  so the host threads the contextElement explicitly instead. */
  contextElement?: Element | null;
  popover?: SuggestionMenuPopoverProps;
  children: ReactNode;
  onEscapeKeyDown?: (event: KeyboardEvent) => void;
  /** Receives the pointerdown's original target so callers can opt out of
   *  closing when the click lands on the popover's trigger button (the
   *  click would otherwise close via dismissable-layer THEN reopen via
   *  the trigger's own onClick, stranding the popover open). */
  onPointerDownOutside?: (target: EventTarget | null) => void;
  onClose?: () => void;
  /** Render the "Close menu / esc" footer at the bottom of the popover.
   *  Defaults to `true` to preserve the slash-menu behavior. Surfaces
   *  that don't need an explicit close affordance (or that nest the
   *  popover inside another dismissable layer) can opt out. */
  showCloseFooter?: boolean;
};
