// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { Editor } from "@tiptap/core"
import { COLOR_NAMES, type ColorName } from "../shared/color-tokens"
import { getBlockSpecs } from "../schema"
import { resolveBodyBlockById } from "../schema/bodySurface"
import {
  runeCommandError,
  runeCommandOk,
  type RuneCommandResult,
} from "./result"

export type BlockColorKind = "text" | "background"

export interface SetBlockColorInput {
  blockId: string
  kind: BlockColorKind
  /** A palette colour name; `"default"` clears the colour. Validated by core. */
  name: ColorName
}

export interface SetBlockColorData {
  blockId: string
  kind: BlockColorKind
  name: ColorName
}

function isColorName(value: unknown): value is ColorName {
  return typeof value === "string" && (COLOR_NAMES as readonly string[]).includes(value)
}

/**
 * Set (or clear, via `name: "default"`) a block's text or background colour by
 * id, in one transaction (one undo step). A thin block-id wrapper over the
 * existing pos-addressed `setBlockTextColor` / `setBlockBackgroundColor`
 * commands; the single core API the AI agent's `set_block_color` tool wraps.
 *
 * Colour-name validity is decided by `COLOR_NAMES` (unknown → `invalid-input`),
 * not a zod enum (the same validity-by-core stance as `setInlineMark`'s mark). The
 * block's COLOUR CAPABILITY is gated by the block spec's DECLARED `supports`
 * (what the agent sees in `getRuneSchemaContext`), not by raw runtime attr
 * presence — `deriveBlockColorTypes` lists a block under both axes when it
 * declares either, so an Image (background-only) carries a `textColor` attr it
 * does not actually support; gating on `supports` keeps the tool consistent with
 * the advertised contract. (Without the gate the write would not throw — PM's
 * node.type.create silently drops an undeclared attr — it would SILENTLY no-op
 * while reporting success, which is worse.)
 */
export function setBlockColor(
  editor: Editor,
  input: SetBlockColorInput,
): RuneCommandResult<SetBlockColorData> {
  if (editor.isDestroyed) {
    return runeCommandError("editor-destroyed", "Editor is destroyed.")
  }
  if (!editor.isEditable) {
    return runeCommandError("not-editable", "Editor is not editable.")
  }

  const { blockId, kind, name } = input
  if (kind !== "text" && kind !== "background") {
    return runeCommandError("invalid-input", `Unknown colour kind "${kind}".`)
  }
  if (!isColorName(name)) {
    return runeCommandError(
      "invalid-input",
      `Unknown colour "${name}". Valid names: ${COLOR_NAMES.join(", ")}.`,
    )
  }

  const { doc } = editor.state
  const resolved = resolveBodyBlockById(doc, blockId)
  if (!resolved) {
    return runeCommandError("not-found", `Block "${blockId}" was not found.`)
  }
  const node = resolved.node

  const supports = getBlockSpecs(editor)[node.type.name]?.supports
  const supported = kind === "text" ? supports?.textColor : supports?.backgroundColor
  if (!supported) {
    return runeCommandError(
      "unsupported",
      `Block "${blockId}" (${node.type.name}) does not support ${kind} colour.`,
    )
  }

  // The pos-addressed colour command only fails when there is no node at
  // `pos` — already excluded above on the same unmutated doc — so it always
  // applies here; no failure branch to handle.
  if (kind === "text") {
    editor.commands.setBlockTextColor(resolved.pos, name)
  } else {
    editor.commands.setBlockBackgroundColor(resolved.pos, name)
  }

  return runeCommandOk({ blockId, kind, name })
}
