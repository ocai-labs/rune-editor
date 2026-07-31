// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import {
  maxPersistableDepthAfter,
  type MarkdownDepthBlock,
} from "../../api/depth"

export interface ChooseDropDepthInput {
  cursorX: number
  minLeft: number
  indentStepPx: number
  previousBlocks: readonly MarkdownDepthBlock[]
  ownerTypes: ReadonlySet<string>
  /**
   * True when the block being dragged declares `markdown.flattensDepth` — its
   * bytes cannot survive a container, so the codec flattens it on save.
   *
   * Without this the drop depth was derived from the DESTINATION alone. The
   * editor would accept the nesting, draw the indicator indented, apply the
   * depth — and the next save would drop it, so reopening showed the block back
   * at the margin. Bytes were safe once the codec enforced D13; what was not
   * safe was the user's belief that the gesture had done something.
   */
  sourceFlattensDepth?: boolean
}

export interface DropIndicatorLeftInput {
  minLeft: number
  indentStepPx: number
  depth: number
}

export function maxDropDepthForSlot(
  previousBlocks: readonly MarkdownDepthBlock[],
  ownerTypes: ReadonlySet<string>,
): number {
  return maxPersistableDepthAfter(previousBlocks, ownerTypes)
}

export function chooseDropDepth(input: ChooseDropDepthInput): number {
  if (input.sourceFlattensDepth) return 0
  const maxDepth = maxDropDepthForSlot(input.previousBlocks, input.ownerTypes)
  if (!Number.isFinite(input.indentStepPx) || input.indentStepPx <= 0) return 0

  // Deliberately no hysteresis yet: #253 only makes depths reachable.
  // Boundary-jitter polish can add a sticky source-depth bias later.
  const rawDepth = Math.floor((input.cursorX - input.minLeft) / input.indentStepPx)
  return clamp(rawDepth, 0, maxDepth)
}

export function dropIndicatorLeftForDepth(input: DropIndicatorLeftInput): number {
  if (!Number.isFinite(input.indentStepPx) || input.indentStepPx <= 0) {
    return input.minLeft
  }
  return input.minLeft + input.depth * input.indentStepPx
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
