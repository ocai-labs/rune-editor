// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

export { Paragraph } from "./Paragraph/block"
export type { RuneParagraphBlock } from "./Paragraph/block"

export { Heading } from "./Heading/block"
export type { HeadingLevel, RuneHeadingBlock } from "./Heading/block"

export { Divider } from "./Divider/block"
export type { RuneDividerBlock } from "./Divider/block"

export { BulletList } from "./BulletList/block"
export type { RuneBulletListBlock } from "./BulletList/block"

export { NumberedList } from "./NumberedList/block"
export type { RuneNumberedListBlock } from "./NumberedList/block"

export { TaskList } from "./TaskList/block"
export type { RuneTaskListBlock } from "./TaskList/block"

export { Blockquote } from "./Blockquote/block"
export type { RuneBlockquoteBlock } from "./Blockquote/block"

export { Callout } from "./Callout/block"
export type { RuneCalloutBlock } from "./Callout/block"
export {
  CalloutEmojiPopover,
  calloutEmojiPopoverPluginKey,
  getCalloutEmojiPopoverBlockId,
} from "./Callout/emoji-popover-plugin"
export type { CalloutEmojiPopoverState } from "./Callout/emoji-popover-plugin"

export { CodeBlock } from "./CodeBlock/block"
export type { RuneCodeBlock } from "./CodeBlock/block"

export { Table } from "./Table/block"
export type {
  RuneTableBlock,
  RuneTableRow,
  RuneTableCellContent,
} from "./Table/block"

export { Toggle } from "./Toggle/block"
export type { RuneToggleBlock, ToggleLevel } from "./Toggle/block"

export { Equation } from "./Equation/block"
export { EquationBlockCommands } from "./Equation/extension"
export type { RuneEquationBlock } from "./Equation/block"

export { TableOfContents } from "./TableOfContents/block"
export type { RuneTableOfContentsBlock } from "./TableOfContents/block"
export { RawBlock } from "./RawBlock/block"
export type { RuneRawBlock, RuneRawOrigin } from "./RawBlock/block"

export { Image } from "./Image/block"
export type { RuneImageBlock } from "./Image/block"

export { Video } from "./Video/block"
export type { RuneVideoBlock } from "./Video/block"

export { Audio } from "./Audio/block"
export type { RuneAudioBlock } from "./Audio/block"

export {
  MediaImport,
  mediaImportPluginKey,
  getMediaImportState,
} from "./media/import-plugin"
export type {
  InsertImageOptions,
  RuneImageImportContext,
  RuneImageImportResult,
  RuneImageImportSource,
  RuneImportImageFile,
  RuneImportImageUrl,
  InsertMediaOptions,
  MediaImportInput,
  MediaImportMap,
  MediaImportOptions,
  MediaImportState,
} from "./media/import-plugin"

export {
  MediaPopover,
  mediaPopoverPluginKey,
  getMediaPopoverBlockId,
} from "./media/popover-plugin"
export type { MediaPopoverState } from "./media/popover-plugin"

export {
  isSupportedMediaUrlReference,
  mediaResultToAttrs,
  normalizeMediaUrlInput,
  validateMediaImportResult,
  DEFAULT_MEDIA_ALIGN,
  MEDIA_ALIGN_VALUES,
  isMediaAlign,
  normalizeMediaAlign,
  downloadMediaAsset,
  openMediaOriginal,
  originalMediaUrl,
} from "./media"
export type { MediaAlign } from "./media"
export { MEDIA_PLACEHOLDER_LABELS } from "./media/render"
export type {
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
} from "./media"

import type { RuneParagraphBlock } from "./Paragraph/block"
import type { RuneHeadingBlock } from "./Heading/block"
import type { RuneDividerBlock } from "./Divider/block"
import type { RuneBulletListBlock } from "./BulletList/block"
import type { RuneNumberedListBlock } from "./NumberedList/block"
import type { RuneTaskListBlock } from "./TaskList/block"
import type { RuneBlockquoteBlock } from "./Blockquote/block"
import type { RuneCalloutBlock } from "./Callout/block"
import type { RuneCodeBlock } from "./CodeBlock/block"
import type { RuneTableBlock } from "./Table/block"
import type { RuneToggleBlock } from "./Toggle/block"
import type { RuneEquationBlock } from "./Equation/block"
import type { RuneTableOfContentsBlock } from "./TableOfContents/block"
import type { RuneRawBlock } from "./RawBlock/block"
import type { RuneImageBlock } from "./Image/block"
import type { RuneVideoBlock } from "./Video/block"
import type { RuneAudioBlock } from "./Audio/block"

// Built-in block union. Custom blocks registered via createBlockSpec
// extend this from the consumer side — `editor.document` will return
// RuneBlock | YourCustomBlock once the CRUD API lands.
export type RuneBlock =
  | RuneParagraphBlock
  | RuneHeadingBlock
  | RuneDividerBlock
  | RuneBulletListBlock
  | RuneNumberedListBlock
  | RuneTaskListBlock
  | RuneBlockquoteBlock
  | RuneCalloutBlock
  | RuneCodeBlock
  | RuneTableBlock
  | RuneToggleBlock
  | RuneEquationBlock
  | RuneTableOfContentsBlock
  | RuneRawBlock
  | RuneImageBlock
  | RuneVideoBlock
  | RuneAudioBlock

export {
  RUNE_BODY_BLOCKS,
  RUNE_BODY_BLOCK_ID_TYPES,
  deriveBlockIdTypes,
  isFactoryBuiltBlockExtension,
} from "./defaultBlocks"
