// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

export {
  createBlockSpec,
  BLOCK_ATTRIBUTES,
  RUNE_BLOCK_SPEC_METADATA,
} from "./blocks/createSpec"
export type {
  BlockSpecConfig,
  BlockPropSchema,
  BlockPropSpec,
  BlockSideMenuSpec,
  BlockSupportsSpec,
  BlockMetaSpec,
  BlockNodeViewFactoryArgs,
  BlockNodeViewFactory,
  BlockNodeViewSpec,
  RuneInPlaceAttr,
  RuneInPlaceAttrTarget,
} from "./blocks/createSpec"
export {
  forEachBlockSpec,
  getBlockSpecs,
  isStructuralIndentType,
  structuralIndentTypes,
} from "./blocks/registry"
export type { BlockSpecMetadata } from "./blocks/registry"
export {
  resolveBodyBlockById,
  forEachBodyBlock,
  forEachBodySurface,
  nearestBodyBlock,
  bodyBlocksInRange,
  surfaceChildrenAt,
} from "./bodySurface"
export type {
  ResolvedBodyBlock,
  NearestBodyBlock,
  BodyBlockInRange,
  ResolvedSurface,
  BodySurface,
  BodySurfaceBlock,
} from "./bodySurface"
export { createBlockExtension } from "./blocks/createBlockExtension"
export { readBlockInputText } from "./blocks/blockInputText"
export { inlineContentFromText } from "./blocks/inlineMarkdown"
export { syncMenuSlot, syncResizeSlot } from "./blocks/atomNodeView"
export { mergeBlockHTMLAttributes } from "./blocks/htmlAttributes"
export type { MergeBlockHTMLAttributesOptions } from "./blocks/htmlAttributes"
export type {
  DeclarativeBlockExtension,
  DeclarativeInputRule,
  JsonValue,
  RuneBlockAction,
  RuneBlockActionContext,
  RuneBlockActionFactory,
  RuneBlockActionRuntimeContext,
  RuneBlockExtensionInput,
  RuneBlockProjectionContext,
  RuneBlockSchemaContextSpec,
  RuneMarkdownBlockContract,
  RuneMarkdownBlockInfo,
  RuneMarkdownBlockSerializer,
  RuneMarkdownBlockSerializerContext,
  RuneMarkdownSpacing,
  RuneSchemaContextInputExample,
  RuneSchemaContextPropMetadata,
  RuneMdastContext,
  RuneSchemaContextPropType,
  ShortcutHandler,
} from "./blocks/types"
export { isDeclarativeBlockExtension } from "./blocks/types"
