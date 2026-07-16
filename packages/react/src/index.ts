// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import "./index.css"

export { useRuneEditor } from "./useRuneEditor"
export type { UseRuneEditorOptions } from "./useRuneEditor"
export { useRuneEditorState } from "./useRuneEditorState"
export type {
  RuneEditorStateEvent,
  UseRuneEditorStateOptions,
} from "./useRuneEditorState"

export { RuneEditor } from "./RuneEditor"
export type { RuneEditorProps } from "./RuneEditor"

export { RuneMarqueeZone } from "./RuneMarqueeZone"
export type { RuneMarqueeZoneProps } from "./RuneMarqueeZone"

// Re-export Tiptap's React surface so consumers depend on a single
// package (@ocai/rune-react). @tiptap/react transitively re-exports
// @tiptap/core, so Editor / Extension types come through this path.
export { EditorContent, EditorProvider, useCurrentEditor } from "@tiptap/react"
export type { Editor, AnyExtension } from "@tiptap/react"

// Re-export the core Extension/Node/Mark constructors as VALUES (not
// just types — @tiptap/react doesn't surface these). Lets downstream
// apps wrap raw PM plugins in a Tiptap Extension without taking a
// direct @tiptap/core dependency, so the single-package contract holds
// for plugin authoring too.
export { Extension, Node, Mark } from "@tiptap/core"

// Re-export the raw ProseMirror primitives a host needs to AUTHOR a plugin
// (the Extension re-export above only lets it WRAP an existing one). A
// decoration-painting extension — e.g. a host-owned AI inline-diff preview —
// constructs `new Plugin({...})` with `Decoration`/`DecorationSet` and reads
// selections via `TextSelection`/`Selection`. The dist BUNDLES tiptap/PM, so a
// host taking its own @tiptap/prosemirror dep would get a SECOND, incompatible
// PM instance (cross-instance plugins/decorations are rejected). Surfacing
// rune's single bundled instance here is the only safe source — it completes
// the single-package plugin-authoring contract the Extension re-export began.
export { Plugin, PluginKey, TextSelection, Selection } from "@tiptap/pm/state"
export { Decoration, DecorationSet } from "@tiptap/pm/view"
export type { EditorState, Transaction } from "@tiptap/pm/state"
export type { Node as PMNode } from "@tiptap/pm/model"

export {
  ComponentsContext,
  DefaultSuggestionMenu,
  RuneEmojiPicker,
  RuneLinkMenu,
  RuneMentionMenu,
  RuneSlashMenu,
  SuggestionMenuController,
  SuggestionMenuPopover,
  defaultComponents,
  getDefaultReactSlashMenuItems,
  useComponentsContext,
  useLoadSuggestionMenuItems,
  useSuggestionMenuKeyboard,
  useSuggestionMenuState,
} from "./suggestion-menu"
export type {
  DefaultReactGridSuggestionItem,
  DefaultReactSuggestionItem,
  RuneComponentProps,
  RuneEmojiPickerProps,
  SuggestionMenuPopoverProps,
  SuggestionMenuProps,
} from "./suggestion-menu"

export {
  AlignCenterIcon,
  AlignLeftIcon,
  AlignRightIcon,
  ArrowDiagonalUpRightIcon,
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  AudioIcon,
  BoldIcon,
  BulletListIcon,
  CalloutIcon,
  CaptionIcon,
  ChevronRightIcon,
  CircleXIcon,
  CodeIcon,
  CommentIcon,
  CopyIcon,
  DividerIcon,
  DownloadIcon,
  EllipsisIcon,
  EmojiIcon,
  FileBlockIcon,
  FitWidthIcon,
  GlobeIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  ImageBlockIcon,
  ItalicIcon,
  LinkIcon,
  MathIcon,
  MoreHorizontalIcon,
  NumberedListIcon,
  PaintRollerIcon,
  QuoteIcon,
  StrikethroughIcon,
  TableHeaderIcon,
  TableIcon,
  TableOfContentsIcon,
  TaskListIcon,
  TextIcon,
  ToggleHeading1Icon,
  ToggleHeading2Icon,
  ToggleHeading3Icon,
  ToggleListIcon,
  TrashIcon,
  UnderlineIcon,
  VideoIcon,
} from "./icons"
export type { IconProps } from "./icons"

export { BlockActionsDropdown } from "./block-actions"
export type { BlockActionsDropdownProps } from "./block-actions"
export type {
  BuildBlockLink,
  BuildBlockLinkContext,
  OnCopyLink,
  OnCopyLinkResult,
} from "./block-actions"
export { TableActionsDropdown } from "./table-actions"
export type { TableActionsDropdownProps } from "./table-actions"
export { MediaFloatingBar } from "./media-bar"
export type { MediaFloatingBarProps } from "./media-bar"
export { InlineToolbar, LinkHoverCard } from "./inline-toolbar"
export type {
  InlineToolbarProps,
  InlineToolbarSectionContext,
  RenderInlineToolbarSection,
  LinkHoverCardProps,
} from "./inline-toolbar"
// Floating-UI positioning primitives. The two Radix bridges that make an
// editor-anchored popover follow the selection/block through scroll & reflow
// and not flip side mid-life. Promoted from the private components/ui path
// (13+ internal surfaces already depend on them) so a downstream host can drive
// its OWN Popover with rune's anchoring — the suggestion menu, hover cards and
// link menus all sit on these. Zero Tailwind/CSS coupling:
//   * useStableVirtualElement — wraps a lazy `() => DOMRect | null` getter into
//     a Radix virtual element, re-reading the live rect on every measurement and
//     falling back to the last good rect during close transitions.
//   * useLockedPopoverSide — pins the side Radix picks on first open so later
//     content-size changes don't flip the panel over the anchor.
export { useStableVirtualElement } from "./components/ui/useStableVirtualElement"
export type { VirtualElementRef } from "./components/ui/useStableVirtualElement"
export { useLockedPopoverSide } from "./components/ui/useLockedPopoverSide"
export type { PopoverSide, LockedPopoverSide } from "./components/ui/useLockedPopoverSide"

// Anchor getters + hooks — the rect math that feeds useStableVirtualElement,
// so a host can anchor its own popover to an editor selection or block. Pure
// getters (rangeToRect / pointAnchorAtHead /
// rectForBlockId / unionBlockRect) for imperative callers; useSelectionAnchor /
// useBlockAnchor / useRangeAnchor wrap them with the last-good-rect fallback (and
// the inner-scroll contextElement tag) for React surfaces.
export {
  pointAnchorAtHead,
  rangeToRect,
  rectForBlockId,
  unionBlockRect,
  useSelectionAnchor,
  useBlockAnchor,
  useRangeAnchor,
} from "./positioning"
export type { RuneAnchor, PointAnchorOptions } from "./positioning"

export { MediaSourcePopover, SourceBlockPopover } from "./blocks/media"
export type { MediaSourcePopoverProps, SourceBlockPopoverProps } from "./blocks/media"
export { CalloutEmojiPicker } from "./blocks/callout/CalloutEmojiPicker"
export type { CalloutEmojiPickerProps } from "./blocks/callout/CalloutEmojiPicker"
export { ImageEmptyPopover } from "./blocks/image"
export type { ImageEmptyPopoverProps } from "./blocks/image"
export { AudioPlayer, audioBlockReactNodeView } from "./blocks/audio"
export { FloatingTableOfContents, extractHeadings } from "./floating-toc"
export type { FloatingTableOfContentsProps, TocHeading } from "./floating-toc"
export { ColorMenu } from "./color"
export type { ColorMenuProps } from "./color"
export {
  recordColorUse,
  getRecentColors,
  getColorFrequency,
  RECENT_COLORS_LIMIT,
} from "./color"
export type { RecentColor, ColorKind } from "./color"
export { reactMathNodeViews } from "./math"
export { reactBlockNodeViews, tableOfContentsReactNodeView } from "./toc-block"

export { EmojiPicker } from "./emoji-picker/EmojiPicker"
export type { EmojiPickerProps, EmojiPickerSelection } from "./emoji-picker/EmojiPicker"

export { copyBlocksToClipboard } from "./lib/copyBlocksToClipboard"
export type { CopyBlocksRange } from "./lib/copyBlocksToClipboard"
export { scrollToBlock } from "./lib/scrollToBlock"
export type { ScrollToBlockOptions } from "./lib/scrollToBlock"
export { getAccentForeground } from "./lib/getAccentForeground"

// Editor-grade floating-panel "shadow box" chrome — the ONE source rune's
// PopoverContent + native menus consume, exported so a downstream host can put
// rune's exact chrome on its own popover. `RUNE_CHROME_CLASS` is the canonical
// Tailwind class string; `runeChromeClass(opts)` varies shadow/animation. A
// non-Tailwind host uses the `.rune-chrome` plain-CSS class (style.css) instead
// — the two paths are an either/or, both built from the --rune-chrome-* tokens.
// Rune-owned Tailwind panels carry the stable, styling-only
// `.rune-chrome-surface` marker; cross-stack overrides can select
// `:is(.rune-chrome-surface, .rune-chrome)`.
export { runeChromeClass, RUNE_CHROME_CLASS } from "./lib/runeChromeClass"
export type { RuneChromeOptions } from "./lib/runeChromeClass"

export { formatBlockMentionLabel, parseQueryBlockLink } from "./block-link"
export type {
  OpenRuneBlockLink,
  OpenRuneBlockLinkContext,
  OpenRuneRef,
  OpenRuneRefContext,
  ParseRuneBlockLink,
  ResolveRuneRef,
  ResolveRuneRefContext,
  RuneBlockLinkTarget,
  RuneBlockMentionLabel,
  RuneRefResolveResult,
} from "./block-link"
