// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { RuneBlock } from "../blocks"

type OptionalInputCommon<T> = T extends { id: string; depth: number }
  ? Omit<T, "id" | "depth"> & { id?: string; depth?: number }
  : never

type DistributiveBlockUpdate<T> = T extends unknown
  ? Omit<Partial<T>, "id">
  : never

/**
 * Distributes over RuneBlock so adding a new block to the
 * RuneBlock union (in packages/core/src/blocks/index.ts) auto-
 * extends RuneBlockInput. No api/types.ts edit per new block.
 */
export type RuneBlockInput = OptionalInputCommon<RuneBlock>

export type BlockInsertTarget =
  | number
  | "end"
  | { id: string; side: "before" | "after" }

// AI-facing insert target: block-id-relative (or "end"), never a raw PM
// numeric boundary.
export type BlockIdInsertTarget =
  | "end"
  | { id: string; side: "before" | "after" }

export interface InsertBlocksOptions {
  at?: BlockInsertTarget
  depth?: number
}

export interface InsertBlocksByIdOptions {
  at?: BlockIdInsertTarget
  depth?: number
}

export type DeleteBlocksTarget = string[] | { from: string; to: string }

export type TurnIntoTarget =
  | string
  | string[]
  | { from: string; to: string }

export interface TurnIntoBlockInput {
  type: string
  props?: Record<string, unknown>
  content?: string
}

export type MoveBlocksTarget = { id: string; side: "before" | "after" }

export type BlockUpdate = DistributiveBlockUpdate<RuneBlock>
