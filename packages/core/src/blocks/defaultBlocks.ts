// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { AnyExtension } from "@tiptap/core"
import { RUNE_BLOCK_SPEC_METADATA } from "../schema"
import { Paragraph } from "./Paragraph/block"
import { Heading } from "./Heading/block"
import { Divider } from "./Divider/block"
import { Equation } from "./Equation/block"
import { Image } from "./Image/block"
import { Video } from "./Video/block"
import { Audio } from "./Audio/block"
import { BulletList } from "./BulletList/block"
import { NumberedList } from "./NumberedList/block"
import { TaskList } from "./TaskList/block"
import { Blockquote } from "./Blockquote/block"
import { Callout } from "./Callout/block"
import { CodeBlock } from "./CodeBlock/block"
import { Toggle } from "./Toggle/block"
import { Table } from "./Table/block"
import { TableOfContents } from "./TableOfContents/block"
import { RawBlock } from "./RawBlock/block"

type StaticBlockSpecExtension = AnyExtension & {
  [RUNE_BLOCK_SPEC_METADATA]?: unknown
}

/**
 * Tiptap's `.configure()` returns a new extension that does not carry
 * own properties set via `Object.defineProperty`. The factory also stores
 * the marker on the Node.create config object, which `.configure()` spreads
 * into the new extension's config. Check both paths so configured
 * factory-built extensions are still recognised.
 */
export function isFactoryBuiltBlockExtension(
  extension: AnyExtension,
): extension is StaticBlockSpecExtension {
  if (RUNE_BLOCK_SPEC_METADATA in extension) return true
  const config = (extension as unknown as Record<string, unknown>).config
  return config != null && typeof config === "object" && RUNE_BLOCK_SPEC_METADATA in config
}

export const RUNE_BODY_BLOCKS = [
  Paragraph,
  Heading,
  Divider,
  Equation,
  Image,
  Video,
  Audio,
  BulletList,
  NumberedList,
  TaskList,
  Blockquote,
  Callout,
  CodeBlock,
  Toggle,
  Table,
  TableOfContents,
  RawBlock,
] as const

export function deriveBlockIdTypes(
  extensions: readonly AnyExtension[],
): string[] {
  return extensions
    .filter(isFactoryBuiltBlockExtension)
    .map((ext) => ext.name)
}

export const RUNE_BODY_BLOCK_ID_TYPES = deriveBlockIdTypes(RUNE_BODY_BLOCKS)
