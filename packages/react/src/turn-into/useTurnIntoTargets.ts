// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { Editor } from "@tiptap/core"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import {
  getDefaultSlashMenuItems,
  resolveBodyBlockById,
  type DefaultSuggestionItem,
  type TurnIntoBlockInput,
} from "@ocai/rune-core"
import { useRuneEditorState } from "../useRuneEditorState"

export interface TurnIntoTargetItem {
  key: string
  title: string
  group: string
  item: DefaultSuggestionItem & { block: TurnIntoBlockInput }
  active: boolean
}

export interface TurnIntoTargetsResult {
  sources: ProseMirrorNode[]
  groups: Array<{ group: string; items: TurnIntoTargetItem[] }>
}

export function useTurnIntoTargets(
  editor: Editor,
  sourceBlockIds: string[],
): TurnIntoTargetsResult {
  const idKey = sourceBlockIds.join("|")
  return useRuneEditorState(
    editor,
    (current) => computeSnapshot(current, sourceBlockIds),
    { events: ["transaction", "update"], deps: [idKey] },
  )
}

function computeSnapshot(
  editor: Editor,
  sourceBlockIds: string[],
): TurnIntoTargetsResult {
  const sources = sourceBlockIds
    .map((id) => findBlockNodeById(editor, id))
    .filter((node): node is ProseMirrorNode => node !== null)

  if (sources.length === 0) return { sources, groups: [] }
  // Skip non-convertible sources (tables, dividers, media — anything that
  // isn't a textblock) but still offer Turn-into as long as SOMETHING in the
  // selection is convertible. A mixed selection converts the eligible blocks
  // and leaves the rest untouched (core's turnInto skips non-matching nodes).
  // Bailing entirely when ANY source is non-textblock (the all-or-nothing
  // form this replaced) regressed that — see the "skips table sources" spec.
  const eligibleSources = sources.filter(isTurnIntoSource)
  if (eligibleSources.length === 0) return { sources, groups: [] }

  const order: string[] = []
  const buckets = new Map<string, TurnIntoTargetItem[]>()

  for (const item of getDefaultSlashMenuItems(editor)) {
    if (!item.block) continue
    if (!editor.schema.nodes[item.block.type]) continue

    const group = item.group ?? "Other"
    if (!buckets.has(group)) {
      buckets.set(group, [])
      order.push(group)
    }

    buckets.get(group)!.push({
      key: item.key,
      title: item.title,
      group,
      item: item as DefaultSuggestionItem & { block: TurnIntoBlockInput },
      active:
        sources.length === 1 &&
        sources.every((source) => isExactMatch(source, item.block!)),
    })
  }

  return {
    sources,
    groups: order.map((group) => ({ group, items: buckets.get(group)! })),
  }
}

function isTurnIntoSource(source: ProseMirrorNode): boolean {
  return source.type.isTextblock
}

function findBlockNodeById(editor: Editor, id: string): ProseMirrorNode | null {
  // Surface-aware: a root-only `doc.child(i)` scan missed blocks inside a
  // column, leaving the turn-into menu empty for them. `resolveBodyBlockById`
  // resolves on the root surface AND any nested column surface.
  return resolveBodyBlockById(editor.state.doc, id)?.node ?? null
}

function isExactMatch(
  source: ProseMirrorNode,
  block: TurnIntoBlockInput,
): boolean {
  if (source.type.name !== block.type) return false
  for (const [key, value] of Object.entries(block.props ?? {})) {
    if (source.attrs[key] !== value) return false
  }
  return true
}
