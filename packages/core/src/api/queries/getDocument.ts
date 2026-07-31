// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { Editor } from "@tiptap/core"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import type { RuneBlock } from "../../blocks"
import type { RuneBlockProjectionContext } from "../../schema/blocks/types"
import { getBlockSpecs } from "../../schema/blocks/registry"

export function blockFromNode(editor: Editor, node: ProseMirrorNode): RuneBlock | null {
  const project = getBlockSpecs(editor)[node.type.name]?.toRuneBlock
  if (typeof project !== "function") return null

  // Projection context remains available to custom projection contracts.
  const ctx: RuneBlockProjectionContext = {
    projectChild: (child) => blockFromNode(editor, child),
  }

  const result = project(node, ctx)
  return (result ?? null) as RuneBlock | null
}

export function getDocument(editor: Editor): RuneBlock[] {
  const blocks: RuneBlock[] = []
  editor.state.doc.forEach((node) => {
    const block = blockFromNode(editor, node)
    if (block) blocks.push(block)
  })
  return blocks
}

/** Visit every projected root Rune block in document order. */
export function walkRuneBlocks(
  blocks: RuneBlock[],
  fn: (block: RuneBlock) => void,
): void {
  for (const block of blocks) {
    fn(block)
  }
}
