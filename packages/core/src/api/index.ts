// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

export { BlockCommands } from "./commands"
export {
  explainBlockInputRejection,
  explainBlockInputsRejection,
} from "./commands/blockInputDiagnostics"
export { applyMarkdownEdits } from "./commands"
export type {
  RuneMarkdownEdit,
  ApplyMarkdownEditsOptions,
  ApplyMarkdownEditsData,
} from "./commands"
export { applyMatching } from "./commands"
export type {
  RuneMatchWhere,
  RuneMatchSet,
  ApplyMatchingOptions,
  ApplyMatchingData,
} from "./commands"
export { exportMarkdown, exportMarkdownWithChunks, exportMarkdownFromDoc } from "./export"
export type { RuneMarkdownChunk, ExportMarkdownOptions, MarkdownDialect } from "./export"
export {
  getDocument,
  getBlockById,
  findBlocks,
  blockFromNode,
  getBlockOutline,
  getBlockSnapshot,
} from "./queries"
export type {
  RuneBlockOutline,
  RuneBlockSnapshot,
  RunePublicBlock,
} from "./queries"
export {
  runeCommandOk,
  runeCommandError,
} from "./result"
export { getSelectionSnapshot, replaceSelectionText } from "./selection"
export { setInlineMark, posAtBlockOffset } from "./inlineMark"
export type { SetInlineMarkInput, SetInlineMarkData } from "./inlineMark"
export { setBlockColor } from "./blockColor"
export type { SetBlockColorInput, SetBlockColorData, BlockColorKind } from "./blockColor"
export type {
  RuneSelectionBlockRange,
  RuneSelectionKind,
  RuneSelectionSnapshot,
} from "./selection"
export type {
  RuneCommandError,
  RuneCommandErrorCode,
  RuneCommandResult,
} from "./result"
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
} from "./types"
