// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { Editor } from "@tiptap/core"
import { getBlockSpecs } from "../../schema/blocks/registry"
import { createNodeFromBlockInput } from "./insertBlocks"
import type { RuneBlockInput } from "../types"

/**
 * Explain WHY a block-write input (insert / update / turn_into) would be
 * rejected, so an agent corrects in one step instead of retrying blindly
 * against the opaque "Command rejected the given input." (G1, plan 2026-06-16).
 *
 * The constraint lives in ONE place: a block's `schemaContext.input.description`
 * — the same text `get_editor_context` advertises (e.g. heading's "level 1–6").
 * We don't add a parallel per-block rejection hook; instead, when `fromInput`
 * refuses an input we surface that block's advertised description.
 *
 * Returns `null` when the input IS constructible — the command failed for a
 * reason that isn't the input shape (e.g. placement / nesting), so the caller
 * should fall back to its generic message rather than mis-attribute the cause.
 */
export function explainBlockInputRejection(
  editor: Editor,
  input: { type?: unknown; [k: string]: unknown },
): string | null {
  const type = typeof input.type === "string" ? input.type : null
  if (!type) return "Block input is missing a string `type`."

  const meta = getBlockSpecs(editor)[type]
  if (!meta) return `Unknown block type "${type}".`

  // Constructible ⇒ the input shape is fine; the rejection was elsewhere.
  if (createNodeFromBlockInput(editor, editor.schema, input as RuneBlockInput, { depth: 0 })) {
    return null
  }

  const base = `Input for block "${type}" was rejected.`
  const description = meta.schemaContext?.input?.description
  return description
    ? `${base} ${description}`
    : `${base} Check its required props and value ranges via get_editor_context.`
}

/**
 * First actionable reason across a list of block inputs (for `insert_blocks`,
 * which takes many). `null` when every input is individually constructible.
 */
export function explainBlockInputsRejection(
  editor: Editor,
  inputs: ReadonlyArray<{ type?: unknown; [k: string]: unknown }>,
): string | null {
  for (const input of inputs) {
    const reason = explainBlockInputRejection(editor, input)
    if (reason) return reason
  }
  return null
}
