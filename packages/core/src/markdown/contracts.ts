// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Static collection of per-block `markdown` contracts (BlockSpecConfig.markdown)
// from block extensions — the same no-editor metadata read `kit.ts`'s
// `staticBlockSupports` uses. Order is registration order: `fromMdast`
// promoters are offered nodes in this order, first claim wins.
import { RUNE_BLOCK_SPEC_METADATA, type RuneMarkdownBlockContract } from "../schema"
import { RUNE_BODY_BLOCKS } from "../blocks/defaultBlocks"

export interface MarkdownContractEntry {
  type: string
  contract: RuneMarkdownBlockContract
}

export type MarkdownContracts = ReadonlyArray<MarkdownContractEntry>

interface StaticSpecMetadata {
  type?: string
  markdown?: RuneMarkdownBlockContract
}

function staticSpecMetadata(ext: unknown): StaticSpecMetadata | undefined {
  const direct = (ext as Record<string, unknown> | null)?.[RUNE_BLOCK_SPEC_METADATA]
  if (direct) return direct as StaticSpecMetadata
  const config = (ext as { config?: Record<string, unknown> } | null)?.config
  return config?.[RUNE_BLOCK_SPEC_METADATA] as StaticSpecMetadata | undefined
}

/** Collect declared contracts from a block-extension list, in order. */
export function collectMarkdownContracts(extensions: readonly unknown[]): MarkdownContracts {
  const out: MarkdownContractEntry[] = []
  for (const ext of extensions) {
    const meta = staticSpecMetadata(ext)
    if (meta?.type && meta.markdown) out.push({ type: meta.type, contract: meta.markdown })
  }
  return out
}

let defaults: MarkdownContracts | null = null

/** Contracts of the default body-block set. Config, not document state —
 *  computed once from static metadata, never touches a doc (§7.1 intact). */
export function getDefaultMarkdownContracts(): MarkdownContracts {
  return (defaults ??= collectMarkdownContracts(RUNE_BODY_BLOCKS))
}
