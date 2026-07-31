// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type {
  MediaEmbedProvider,
  MediaImportResult,
  MediaSourceType,
  MediaUrlInputResult,
} from "./source"
import type { SuggestionCommitContext } from "../../extensions/suggestion-menus"

export function numAttr(el: HTMLElement, name: string): number | null {
  const raw = el.getAttribute(name)
  if (raw == null) return null
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : null
}

export function inputNumberOrDefault(
  value: unknown,
  fallback: unknown,
): number | null {
  if (typeof value === "number") return value
  if (value === null) return null
  return typeof fallback === "number" ? fallback : null
}

export function inputStringOrDefault(value: unknown, fallback: unknown): string {
  if (typeof value === "string") return value
  return typeof fallback === "string" ? fallback : ""
}

export function inputNullableStringOrDefault(
  value: unknown,
  fallback: unknown,
): string | null {
  if (typeof value === "string") return value
  if (value === null) return null
  return typeof fallback === "string" ? fallback : null
}

export function inputSourceTypeOrDefault(value: unknown, fallback: unknown): MediaSourceType {
  if (value === "asset" || value === "embed") return value
  if (fallback === "asset" || fallback === "embed") return fallback
  return "asset"
}

export function isProvider(value: unknown): value is MediaEmbedProvider {
  return value === "youtube" || value === "vimeo" || value === "soundcloud"
}

export function inputProviderOrDefault(
  value: unknown,
  fallback: unknown,
): MediaEmbedProvider | null {
  if (isProvider(value)) return value
  if (value === null) return null
  return isProvider(fallback) ? fallback : null
}

export function slashSourceDepth(ctx: SuggestionCommitContext): number {
  const $from = ctx.editor.state.doc.resolve(ctx.range.from)
  const depth = $from.node($from.depth).attrs.depth
  return typeof depth === "number" ? depth : 0
}

export function contentAttrsFromOuter(
  HTMLAttributes: Record<string, any>,
): {
  outer: Record<string, any>
  contentAttrs: Record<string, string>
} {
  const outer = HTMLAttributes
  const contentAttrs: Record<string, string> = { class: "rune-block-content" }
  return { outer, contentAttrs }
}

export function isMediaImportResult(
  value: MediaImportResult | MediaUrlInputResult,
): value is MediaImportResult {
  return !("ok" in value)
}
