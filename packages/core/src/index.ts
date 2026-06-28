// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

export {
  COLORS,
  COLOR_NAMES,
  type ColorName,
  type NamedColorEntry,
} from "./shared/color-tokens"

export { createRuneKit, BLOCK_COLOR_TYPES, deriveBlockColorTypes } from "./kit"
export type { CreateRuneKitOptions, RunePlugin } from "./kit"

export {
  BlockCommands,
  getDocument,
  getBlockById,
  findBlocks,
  exportMarkdown,
  exportMarkdownFromDoc,
  runeCommandOk,
  runeCommandError,
  getBlockOutline,
  getBlockSnapshot,
  getSelectionSnapshot,
  replaceSelectionText,
  setInlineMark,
  posAtBlockOffset,
  setBlockColor,
  explainBlockInputRejection,
  explainBlockInputsRejection,
} from "./api"
export type {
  BlockIdInsertTarget,
  BlockInsertTarget,
  BlockUpdate,
  ColumnInsertTarget,
  DeleteBlocksTarget,
  InsertBlocksByIdOptions,
  InsertBlocksOptions,
  MoveBlocksTarget,
  RuneBlockInput,
  TurnIntoBlockInput,
  TurnIntoTarget,
  WrapIntoColumnsTarget,
  RuneCommandError,
  RuneCommandErrorCode,
  RuneCommandResult,
  RuneBlockOutline,
  RuneBlockSnapshot,
  RunePublicBlock,
  RuneSelectionBlockRange,
  RuneSelectionKind,
  RuneSelectionSnapshot,
  SetInlineMarkInput,
  SetInlineMarkData,
  SetBlockColorInput,
  SetBlockColorData,
  BlockColorKind,
} from "./api"

export { getRuneSchemaContext, getAgentHiddenTypes } from "./api/schemaContext"
export type {
  RuneSchemaContext,
  RuneEditorSchemaSummary,
  RuneBlockSchemaContext,
  RunePropSchemaContext,
  RuneBlockSupportsContext,
  RuneIndentSchemaContext,
  RuneBlockInputContext,
  RuneBlockOutputContext,
  RuneMarkSchemaContext,
} from "./api/schemaContext"
export type {
  JsonValue,
  RuneBlockSchemaContextSpec,
  RuneSchemaContextInputExample,
  RuneSchemaContextPropMetadata,
  RuneSchemaContextPropType,
} from "./schema"

// Block-level color extensions. createRuneKit registers these by default;
// re-exported so consumers composing extensions manually can reach them
// without depending on the kit.
export { BlockTextColor, BlockBackgroundColor } from "./extensions/color"
export type {
  BlockTextColorOptions,
  BlockBackgroundColorOptions,
} from "./extensions/color"

// Block factory + shared attribute names. Consumers building custom
// blocks call createBlockSpec the same way @ocai/rune-core's own blocks do.
export {
  createBlockSpec,
  BLOCK_ATTRIBUTES,
  createBlockExtension,
  syncMenuSlot,
  syncResizeSlot,
  mergeBlockHTMLAttributes,
} from "./schema"
export type {
  BlockSpecConfig,
  BlockPropSchema,
  BlockPropSpec,
  BlockMetaSpec,
  BlockSupportsSpec,
  MergeBlockHTMLAttributesOptions,
  BlockNodeViewFactoryArgs,
  BlockNodeViewFactory,
  BlockNodeViewSpec,
  RuneInPlaceAttr,
  RuneInPlaceAttrTarget,
  DeclarativeBlockExtension,
  DeclarativeInputRule,
  RuneBlockAction,
  RuneBlockActionContext,
  RuneBlockActionFactory,
  RuneBlockActionRuntimeContext,
  RuneBlockProjectionContext,
  RuneMarkdownBlockInfo,
  RuneMarkdownBlockSerializer,
  RuneMarkdownBlockSerializerContext,
  RuneMarkdownSpacing,
  ShortcutHandler,
} from "./schema"
export {
  forEachBlockSpec,
  getBlockSpecs,
  isStructuralIndentType,
} from "./schema"
export type { BlockSpecMetadata, BlockSideMenuSpec } from "./schema"

// Body-surface resolver layer. The single seam Phase 1 (nested columns)
// re-implements recursively; in Phase 0 it resolves against the doc root.
export {
  resolveBodyBlockById,
  forEachBodyBlock,
  nearestBodyBlock,
  bodyBlocksInRange,
} from "./schema"
export type {
  ResolvedBodyBlock,
  NearestBodyBlock,
  BodyBlockInRange,
} from "./schema"

export {
  RUNE_BODY_BLOCKS,
  RUNE_BODY_BLOCK_ID_TYPES,
  deriveBlockIdTypes,
  isFactoryBuiltBlockExtension,
} from "./blocks"

// Built-in blocks + their per-block types. Each block module owns its
// own type surface; see blocks/<Name>/block.ts.
export {
  Paragraph,
  Heading,
  Divider,
  BulletList,
  NumberedList,
  TaskList,
  Blockquote,
  CodeBlock,
  Toggle,
  Equation,
  EquationBlockCommands,
  ColumnLayout,
  Column,
  Image,
  Video,
  Audio,
  Callout,
  CalloutEmojiPopover,
  calloutEmojiPopoverPluginKey,
  getCalloutEmojiPopoverBlockId,
  MediaImport,
  MediaPopover,
  mediaImportPluginKey,
  mediaPopoverPluginKey,
  isSupportedMediaUrlReference,
  mediaResultToAttrs,
  normalizeMediaUrlInput,
  getMediaImportState,
  getMediaPopoverBlockId,
  validateMediaImportResult,
  DEFAULT_MEDIA_ALIGN,
  MEDIA_ALIGN_VALUES,
  MEDIA_PLACEHOLDER_LABELS,
  isMediaAlign,
  normalizeMediaAlign,
  downloadMediaAsset,
  openMediaOriginal,
  originalMediaUrl,
} from "./blocks"
export type {
  HeadingLevel,
  RuneParagraphBlock,
  RuneHeadingBlock,
  RuneDividerBlock,
  RuneBulletListBlock,
  RuneNumberedListBlock,
  RuneTaskListBlock,
  RuneBlockquoteBlock,
  RuneCalloutBlock,
  RuneCodeBlock,
  RuneToggleBlock,
  ToggleLevel,
  RuneEquationBlock,
  RuneColumnsBlock,
  RuneColumn,
  RuneImageBlock,
  RuneVideoBlock,
  RuneAudioBlock,
  RuneBlock,
  MediaAlign,
  InsertImageOptions,
  InsertMediaOptions,
  RuneImageImportContext,
  RuneImageImportResult,
  RuneImageImportSource,
  RuneImportImageFile,
  RuneImportImageUrl,
  MediaImportInput,
  MediaImportMap,
  MediaImportOptions,
  MediaImportState,
  MediaPopoverState,
  CalloutEmojiPopoverState,
  MediaAssetImportResult,
  MediaEmbedImportResult,
  MediaEmbedProvider,
  MediaImportResult,
  MediaImportValidationResult,
  SourcedBlockKind,
  MediaSourceAttrs,
  MediaSourceType,
  MediaUrlInputResult,
  RuneImportMediaFile,
  RuneImportMediaUrl,
  RuneMediaImportContext,
  RuneMediaImportResult,
  RuneMediaImportSource,
} from "./blocks"

// Opt-in in-document page title (NOT a default body block). Enable via
// createRuneKit({ plugins: [TitleKit] }). See blocks/Title.
export { TitleKit, TitleBlock, TITLE_TYPE, setTitleText } from "./blocks/Title"
export type { RuneTitleBlock } from "./blocks/Title"

export {
  InlineMath,
  MathController,
  mathControllerKey,
} from "./inlines"
export type {
  InlineNodeViewFactory,
  InsertInlineMathOptions,
  MathControllerMeta,
  MathControllerState,
} from "./inlines"

export {
  ToggleBodyPlugin,
  toggleBodyKey,
  toggleBodyRange,
  findCollapsedToggleContaining,
  expandCollapsedToggles,
} from "./blocks/Toggle/block"
export type {
  CollapsedToggleContainingResult,
  ToggleBodyOptions,
} from "./blocks/Toggle/block"

export {
  Table,
  TableCommands,
  isTableHeaderRow,
  isTableHeaderColumn,
  TableRow,
  TableCell,
  TableHeader,
  TableParagraph,
  TableSupport,
  TableMergedCellsGuard,
  CellSelectionEdges,
  TableMouseSelection,
  PinColumnWidths,
  findCellBefore,
  findCellContext,
  resolveTableFromFrame,
  CellHandlePills,
  PILL_ORIGIN_META,
  PILL_DROPDOWN_META,
  cellHandlePillsKey,
  selectFullColumn,
  selectFullRow,
  CellHandleDrag,
  TableExtendButtons,
} from "./blocks/Table/block"
export type { PillDropdownState } from "./blocks/Table/block"
export type {
  RuneTableBlock,
  RuneTableRow,
  RuneTableCellContent,
  InsertTableOptions,
  CellContext,
  ResolvedTable,
} from "./blocks/Table/block"

export { BlockId } from "./extensions/block-id"
export { AGENT_WRITE_META } from "./extensions/agent-write-meta"
export { INTERNAL_NORMALIZATION_META } from "./extensions/internal-meta"
export {
  ListNumbering,
  listNumberingKey,
  buildListNumberingDecorations,
} from "./extensions/list-numbering"

// General block-API types (shared base across all blocks).
export type { RuneBlockBase } from "./types"

// Suggestion menus (multi-trigger, built on @tiptap/suggestion).
export {
  SuggestionMenus,
  dismissSuggestionMenu,
  getSuggestionMenus,
  wikiLinkMatcher,
  slashMatcher,
  commitSuggestion,
  insertOrUpdateBlockForSlashMenu,
  filterSuggestionItems,
  getDefaultSlashMenuItems,
  recordSuggestionUse,
  getSuggestionFrequency,
  pickRecentlyUsed,
} from "./extensions/suggestion-menus"
export type {
  TriggerConfig,
  TriggerState,
  TriggerStore,
  TriggerKeyHandler,
  SuggestionMenusOptions,
  SuggestionMenusStorage,
  DefaultSuggestionItem,
  DefaultGridSuggestionItem,
  SuggestionCommitContext,
  FrequencyEntry,
  FrequencyMap,
} from "./extensions/suggestion-menus"

export { SideMenu, sideMenuKey } from "./extensions/side-menu"
export type {
  SideMenuState,
  SideMenuStorage,
  SideMenuHoveredBlock,
} from "./extensions/side-menu"
export { addBlockBelowAndOpenSlash } from "./extensions/side-menu/add-block"
export { isDraggable } from "./extensions/side-menu/block-registry"

export { GestureStatePlugin, gestureKey, isGestureActive, claimGesture, isPrimaryRelease, primaryLost } from "./extensions/shared"
export type { ActiveGesture, GestureState, GestureName, GestureClaim } from "./extensions/shared"

export {
  BlockResize,
  getResizeState,
  resizeKey,
} from "./extensions/resize"
export type { ResizeState } from "./extensions/resize"

export { BlockDrag, blockDragKey } from "./extensions/block-drag"
export type {
  BlockDragState,
  BlockGeom,
  BlocksSnapshot,
  DropTarget,
} from "./extensions/block-drag"

export {
  BlockSelection,
  blockSelectionKey,
  blockSelectionCommands,
  openBlockActionsDropdown,
} from "./extensions/block-selection"
export type {
  BlockActionsDropdownAnchor,
  DropdownAnchorRect,
} from "./extensions/block-selection"
export { MultiBlockSelection } from "./extensions/block-selection/MultiBlockSelection"
export { setMarqueeZone } from "./extensions/block-selection/marquee"

export { Clipboard, collectKnownBlockTags } from "./extensions/clipboard"
export type { ClipboardOptions } from "./extensions/clipboard"
export { clipboardPluginKey } from "./extensions/clipboard/plugin"
export { serializeBlocksForClipboard } from "./extensions/clipboard/serializeBlocks"

export { CaretComfort, caretComfortKey } from "./extensions/caret-comfort"

export { Indent } from "./extensions/indent"

export {
  EntityRefs,
  entityRefsRefreshKey,
  createRefDecorationPlugin,
} from "./extensions/entity-refs"
export type {
  EntityRefsRefreshMeta,
  RefDecorationConfig,
} from "./extensions/entity-refs"

export { WikiLink } from "./extensions/wiki-link"
export { commitWikiLink } from "./extensions/wiki-link/commitWikiLink"
export type { WikiLinkAttrs, WikiLinkOptions } from "./extensions/wiki-link"
export { InternalRef } from "./extensions/internal-ref"
export type {
  InternalRefAttrs,
  InternalRefKind,
  InternalRefOptions,
  InternalRefResolveResult,
} from "./extensions/internal-ref"
export { internalRefLabelSyncKey } from "./extensions/internal-ref/labelSyncPlugin"

export { TailClick, tailClickKey } from "./extensions/tail-click"

export { Placeholder, placeholderPluginKey } from "./extensions/placeholder"
export type { PlaceholderOptions } from "./extensions/placeholder"
export type {
  PlaceholderConfig,
  PlaceholderHit,
  PlaceholderPluginState,
  PlaceholderResolver,
  RuneBlockTypeName,
} from "./extensions/placeholder/types"
