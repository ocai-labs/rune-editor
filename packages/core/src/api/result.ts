// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { JsonValue } from "../schema"

export type RuneCommandResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: RuneCommandError }

export interface RuneCommandError {
  code: RuneCommandErrorCode
  message: string
  details?: JsonValue
}

export type RuneCommandErrorCode =
  | "editor-destroyed"
  | "invalid-input"
  | "not-editable"
  | "not-found"
  | "unsupported"
  // apply_edits (Tier 1) locate/guard failures — see api/commands/applyMarkdownEdits.ts.
  | "no-match"
  | "ambiguous-match"
  | "not-editable-lossless"

export function runeCommandOk<T>(data: T): RuneCommandResult<T> {
  return { ok: true, data }
}

export function runeCommandError<T = never>(
  code: RuneCommandErrorCode,
  message: string,
  details?: JsonValue,
): RuneCommandResult<T> {
  return details === undefined
    ? { ok: false, error: { code, message } }
    : { ok: false, error: { code, message, details } }
}
