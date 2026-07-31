// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// packages/react/src/suggestion-menu/SuggestionMenuController.tsx
import { useCallback, useEffect, useId, useMemo, useState, type FC } from "react";
import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import {
  filterSuggestionItems,
  dismissSuggestionMenu,
  getSuggestionFrequency,
  nearestBodyBlock,
  recordSuggestionUse,
  type TriggerState,
  type TurnIntoBlockInput,
} from "@ocai/rune-core";
import { useSuggestionMenuState } from "./hooks/useSuggestionMenuState";
import { useLoadSuggestionMenuItems } from "./hooks/useLoadSuggestionMenuItems";
import { useSuggestionMenuKeyboard } from "./hooks/useSuggestionMenuKeyboard";
import { SuggestionMenuPopover } from "./SuggestionMenuPopover";
import { editorViewDom } from "../positioning";
import { DefaultSuggestionMenu } from "./defaultRenderer";
import { getDefaultReactSlashMenuItems } from "./getDefaultReactSlashMenuItems";
import { orderSuggestionMenuItems } from "./grouping";
import { withRecentlyUsedGroup } from "./recent";
import type {
  DefaultReactSuggestionItem,
  SuggestionMenuPopoverProps,
  SuggestionMenuProps,
} from "./types";

const ARIA_OWNER_ATTR = "data-rune-suggestion-aria-owner";

// Resolve the caret's nearest body block via core's registry-aware resolver.
// This remains correct if a plugin adds structural ancestors; callers fall
// back to "no enrichment" when no registered body block contains the caret.
export function sourceBlockAtPos(editor: Editor, pos: number): ProseMirrorNode | null {
  const doc = editor.state.doc;
  if (pos < 0 || pos > doc.content.size) return null;
  return nearestBodyBlock(editor, doc.resolve(pos))?.node ?? null;
}

// Same shape-match used by Turn-into: type must match and every prop the
// item's block payload pins must equal the source node's attr. Extra
// attrs on the source (e.g. `id`, `depth`) don't disqualify — the item
// only declares the props that define its identity (e.g. `level`).
function isExactBlockMatch(
  source: ProseMirrorNode,
  block: TurnIntoBlockInput,
): boolean {
  if (source.type.name !== block.type) return false;
  for (const [key, value] of Object.entries(block.props ?? {})) {
    if (source.attrs[key] !== value) return false;
  }
  return true;
}

// Same eligibility test as `canTurnInto` in core's `turnInto.ts`. Inlined
// here to keep the React controller dependency-light (importing the core
// helper would pull the rest of `turnIntoAdapters` into the bundle for
// what amounts to two lines of logic that hasn't churned since v1).
// Mirrors core's STRUCTURAL container-source refusal: any non-atom,
// non-textblock source (a table or plugin-provided structured block) holds
// nested nodes rather than inline text and cannot convert.
function canSourceTurnInto(
  source: ProseMirrorNode,
  block: TurnIntoBlockInput,
  schema: { nodes: Record<string, unknown> },
): boolean {
  if (!schema.nodes[block.type]) return false;
  if (!source.type.isTextblock && !source.type.isAtom) return false;
  return true;
}

export interface SuggestionMenuControllerProps<T> {
  editor: Editor | null;
  triggerCharacter: string;
  getItems?: (query: string) => Promise<T[]>;
  suggestionMenuComponent?: FC<SuggestionMenuProps<T>>;
  onItemClick?: (item: T) => void;
  popover?: SuggestionMenuPopoverProps;
}

export function SuggestionMenuController<T = DefaultReactSuggestionItem>(
  props: SuggestionMenuControllerProps<T>,
) {
  const { editor, triggerCharacter, popover } = props;
  const state: TriggerState | null = useSuggestionMenuState(editor, triggerCharacter);
  const reactId = useId();
  const menuId = useMemo(
    () => `rune-suggestion-menu-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`,
    [reactId],
  );
  const ariaOwner = `${triggerCharacter}:${menuId}`;

  const getItems = useMemo(() => {
    if (props.getItems) return props.getItems;
    return async (q: string) => {
      if (!editor) return [] as T[];
      const all = getDefaultReactSlashMenuItems(editor);
      // Notion folds leading/trailing spaces out of the query before
      // matching: `/a ` shows the same results as `/a`, and `/ ` shows the
      // full default list (edge-case report, cases 2 & 6). Without the
      // trim, a trailing space silently drops every single-word title.
      const filtered = filterSuggestionItems(all, q.trim());
      // Recents only on empty-query view — under an active query users
      // expect score-by-match, not chronology, and a duplicate group would
      // crowd out matches. Gated on the RAW query: `/ ` is a filtered view
      // (all results), not the browse view.
      if (q.length > 0) return filtered as unknown as T[];
      const freq = getSuggestionFrequency(editor, triggerCharacter);
      return withRecentlyUsedGroup(filtered, freq) as unknown as T[];
    };
  }, [editor, props.getItems, triggerCharacter]);

  const loadSessionKey = state?.show
    ? `${state.range?.from ?? "none"}:${state.range?.to ?? "none"}`
    : "closed";

  const { items: rawItems, loadingState } = useLoadSuggestionMenuItems(
    state?.query ?? "",
    getItems,
    loadSessionKey,
  );

  // Filtered-result enrichment (Notion pattern). When the user has typed
  // past the bare trigger, render the filtered set as ONE group titled
  // "Filter results" containing TWO half-lists in order:
  //
  //   1. The plain matches, identical to the browse view (with the
  //      `#`/`>`/`---` shortcut glyph on the right). Clicking these
  //      keeps the existing slash-insert semantics: convert in place if
  //      the source block contained only the trigger text, otherwise
  //      insert a new sibling block after.
  //
  //   2. The same matches AGAIN as "Turn into" duplicates, but only for
  //      items that the source block can convert to (Turn-into rules:
  //      schema knows the target, and the source isn't a `table`). Each
  //      duplicate carries `subLabel: "Turn into"` (renders inline next
  //      to the title with a `·` separator) and `active: true` when the
  //      source block IS already that exact shape — which surfaces a
  //      checkmark on the right in the spot the shortcut would occupy.
  //      Clicking deletes the trigger range and calls `turnInto`, so
  //      "Hello/heading 1" becomes a Heading 1 containing "Hello" (and a
  //      bare "/heading 1" likewise becomes an empty Heading 1) — never
  //      a new sibling block.
  //
  // Only the default getItems path is enriched; host-provided getItems
  // is returned untouched because we don't know the shape of T.
  const items = useMemo(() => {
    if (!editor || !state?.range) return rawItems;
    if (props.getItems) return rawItems;
    // Trimmed: a whitespace-only query (`/ `) is the default list under a
    // "filtered" header, not an enriched filter view with Turn-into dups.
    if ((state.query?.trim().length ?? 0) === 0) return rawItems;
    const sourceBlock = sourceBlockAtPos(editor, state.range.from);
    if (!sourceBlock) return rawItems;
    const sourceId =
      typeof sourceBlock.attrs.id === "string" ? sourceBlock.attrs.id : null;
    const reactItems = rawItems as unknown as DefaultReactSuggestionItem[];

    const FILTER_GROUP = "Filter results";
    const normal: DefaultReactSuggestionItem[] = reactItems.map((item) => ({
      ...item,
      group: FILTER_GROUP,
    }));

    const turnInto: DefaultReactSuggestionItem[] = [];
    if (sourceId !== null) {
      for (const item of reactItems) {
        if (!item.block) continue;
        if (!canSourceTurnInto(sourceBlock, item.block, editor.schema)) continue;
        const block = item.block;
        turnInto.push({
          ...item,
          // Key must differ from the insert variant or the renderer (and
          // recency tracking) would collide on the duplicate.
          key: `${item.key}__turn-into`,
          group: FILTER_GROUP,
          subLabel: "Turn into",
          // Drop the shortcut glyph — the `active` branch in
          // SuggestionMenuItem renders a check in that same right slot
          // when the source is already this shape; otherwise the slot
          // stays empty, which is what the Notion reference shows.
          shortcut: undefined,
          active: isExactBlockMatch(sourceBlock, block),
          onItemClick: (ctx) => {
            ctx.editor
              .chain()
              .focus()
              .deleteRange(ctx.range)
              .turnInto(sourceId, block)
              .run();
          },
        });
      }
    }

    return [...normal, ...turnInto] as unknown as typeof rawItems;
  }, [rawItems, editor, state?.range, state?.query, props.getItems]);

  const orderedItems = useMemo(() => orderSuggestionMenuItems(items), [items]);

  // Notion-style no-match behavior: instead of auto-closing when the
  // filtered list is empty, we keep the popover open and let the footer
  // surface a "Close menu" affordance. Two reasons for this over the
  // earlier auto-close-and-suppress design:
  //   1. Typo recovery — `filterSuggestionItems` now has a fuzzy tier, but
  //      true misses (e.g. `/qzzz`) still produce zero items, and dumping
  //      the user out of the menu mid-typing punishes them for it.
  //   2. The "menu only triggers once per session" guarantee falls out of
  //      this design for free: nothing ever auto-reopens because nothing
  //      ever auto-closed. Explicit dismissal (Esc / Close menu /
  //      outside-click) suppresses that exact trigger position without
  //      deleting the typed text.

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [revealSelectedItem, setRevealSelectedItem] = useState(false);
  // Reset on every new menu session (show flip) AND on each typed
  // character (query change). Depending on query alone is insufficient:
  // re-opening with the same empty query keeps the last session's index.
  useEffect(() => {
    setSelectedIndex(0);
    setRevealSelectedItem(false);
  }, [state?.query, state?.show]);

  const setKeyboardSelectedIndex = useCallback((idx: number) => {
    setRevealSelectedItem(true);
    setSelectedIndex(idx);
  }, []);

  const handleItemHover = useCallback((idx: number) => {
    setRevealSelectedItem(false);
    setSelectedIndex(idx);
  }, []);

  useEffect(() => {
    if (!editor) return;
    const root = editor.view.dom;
    const activeId =
      state?.show &&
      selectedIndex >= 0 &&
      selectedIndex < orderedItems.length
        ? `${menuId}-item-${selectedIndex}`
        : null;

    if (state?.show) {
      root.setAttribute(ARIA_OWNER_ATTR, ariaOwner);
      root.setAttribute("aria-expanded", "true");
      root.setAttribute("aria-haspopup", "listbox");
      root.setAttribute("aria-controls", menuId);
      if (activeId) root.setAttribute("aria-activedescendant", activeId);
      else root.removeAttribute("aria-activedescendant");
    } else if (root.getAttribute(ARIA_OWNER_ATTR) === ariaOwner) {
      root.setAttribute("aria-expanded", "false");
      root.removeAttribute("aria-haspopup");
      root.removeAttribute("aria-controls");
      root.removeAttribute("aria-activedescendant");
      root.removeAttribute(ARIA_OWNER_ATTR);
    }

    return () => {
      if (root.getAttribute(ARIA_OWNER_ATTR) !== ariaOwner) return;
      root.setAttribute("aria-expanded", "false");
      root.removeAttribute("aria-haspopup");
      root.removeAttribute("aria-controls");
      root.removeAttribute("aria-activedescendant");
      root.removeAttribute(ARIA_OWNER_ATTR);
    };
  }, [ariaOwner, editor, menuId, orderedItems.length, selectedIndex, state?.show]);

  const close = useCallback(() => {
    if (!editor) return;
    dismissSuggestionMenu(editor, triggerCharacter);
  }, [editor, triggerCharacter]);

  const commit = useCallback(
    (item: T) => {
      // Track use under the item's stable `key` (DefaultSuggestionItem.key
      // for built-in items; custom getItems must include `key` to opt in).
      // Recorded before delegation so host onItemClick handlers see the
      // updated frequency on their next render if they read it themselves.
      const k = (item as { key?: unknown }).key;
      if (editor && typeof k === "string") {
        recordSuggestionUse(editor, triggerCharacter, k);
      }
      if (props.onItemClick) return props.onItemClick(item);
      // Default commit path for DefaultReactSuggestionItem-shaped items.
      const maybe = item as unknown as DefaultReactSuggestionItem & {
        onItemClick?: DefaultReactSuggestionItem["onItemClick"];
      };
      if (typeof maybe.onItemClick === "function" && editor && state?.range) {
        maybe.onItemClick({
          editor,
          range: state.range,
          triggerCharacter,
        });
      }
    },
    [editor, props.onItemClick, state?.range, triggerCharacter],
  );

  useSuggestionMenuKeyboard(editor, triggerCharacter, {
    items: orderedItems,
    selectedIndex,
    setSelectedIndex: setKeyboardSelectedIndex,
    commit,
    close,
  });

  if (!state || !editor) return null;
  const Renderer = (props.suggestionMenuComponent ??
    (DefaultSuggestionMenu as unknown)) as FC<SuggestionMenuProps<T>>;

  return (
    <SuggestionMenuPopover
      open={state.show}
      getClientRect={state.getClientRect}
      contextElement={editorViewDom(editor)}
      popover={popover}
      onEscapeKeyDown={() => close()}
      onPointerDownOutside={() => close()}
      onClose={() => close()}
    >
      <Renderer
        items={orderedItems}
        loadingState={loadingState}
        selectedIndex={selectedIndex}
        menuId={menuId}
        showEmptyState={triggerCharacter !== "/"}
        revealSelectedItem={revealSelectedItem}
        onItemClick={commit}
        onItemHover={handleItemHover}
      />
    </SuggestionMenuPopover>
  );
}
