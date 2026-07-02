// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Adding a fourth source-backed block (e.g. PDF) must also replace
// import-plugin's hardcoded kind routing with metadata-driven routing.
// See "Future Work" in internal design notes.
export const SOURCE_BLOCK_KINDS = ["image", "video", "audio"] as const
export type SourcedBlockKind = (typeof SOURCE_BLOCK_KINDS)[number]

export type MediaEmbedProvider = "youtube" | "vimeo" | "soundcloud"

export type MediaSourceType = "asset" | "embed"

export type RuneMediaImportSource =
  | "drop"
  | "paste-binary"
  | "picker"
  | "embed"
  | "paste-html"

export interface RuneMediaImportContext {
  blockId: string
  kind: SourcedBlockKind
  nodeName: string
  source: RuneMediaImportSource
}

export interface MediaAssetImportResult {
  kind: "asset"
  src: string
  sourceUrl?: string
  alt?: string
  title?: string
  width?: number | null
  height?: number | null
}

export interface MediaEmbedImportResult {
  kind: "embed"
  provider: MediaEmbedProvider
  sourceUrl: string
  embedUrl: string
  title?: string
  width?: number | null
  height?: number | null
}

export type MediaImportResult =
  | MediaAssetImportResult
  | MediaEmbedImportResult

export type RuneMediaImportResult = MediaImportResult

export type RuneImportMediaFile = (
  file: File,
  context: RuneMediaImportContext,
) => Promise<RuneMediaImportResult>

export type RuneImportMediaUrl = (
  url: string,
  context: RuneMediaImportContext,
) => Promise<RuneMediaImportResult>

export interface MediaSourceAttrs {
  sourceType: MediaSourceType
  src: string
  embedUrl: string | null
  provider: MediaEmbedProvider | null
  sourceUrl: string | null
  title: string
  width: number | null
  height: number | null
}

export type MediaImportValidationResult =
  | { ok: true; result: MediaImportResult }
  | { ok: false; error: string }

export type MediaUrlInputResult =
  | MediaImportResult
  | { ok: false; error: string }

/** Sentinel base for parsing possibly-relative media URLs with `new URL`. */
export const URL_PARSE_BASE = "https://rune.local/"
const BLOCKED_PROTOCOLS = new Set(["javascript:", "vbscript:"])
const BLOCKED_URL_REFERENCE_SYNTAX = /[<>\u0000-\u001F\u007F]/
const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{6,}$/

function trimInput(input: string): string {
  return input.trim()
}

function parseUrlReference(input: string): URL | null {
  const value = trimInput(input)
  if (!value) return null
  if (BLOCKED_URL_REFERENCE_SYNTAX.test(value)) return null

  try {
    return new URL(value, URL_PARSE_BASE)
  } catch {
    return null
  }
}

export function isSupportedMediaUrlReference(input: string): boolean {
  const parsed = parseUrlReference(input)
  if (!parsed) return false
  return !BLOCKED_PROTOCOLS.has(parsed.protocol.toLowerCase())
}

function hostWithoutWww(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, "")
}

function firstPathSegment(url: URL): string | null {
  const [segment] = url.pathname.split("/").filter(Boolean)
  return segment ?? null
}

function isKnownProviderUrl(url: URL): boolean {
  const host = hostWithoutWww(url)
  return (
    host === "youtu.be" ||
    host === "youtube.com" ||
    host === "m.youtube.com" ||
    host === "vimeo.com" ||
    host === "player.vimeo.com" ||
    host === "soundcloud.com"
  )
}

function youtubeIdFromUrl(url: URL): string | null {
  const host = hostWithoutWww(url)
  if (host === "youtu.be") {
    const segments = url.pathname.split("/").filter(Boolean)
    return segments.length === 1 ? firstPathSegment(url) : null
  }
  if (host !== "youtube.com" && host !== "m.youtube.com") return null

  if (url.pathname === "/watch") {
    return url.searchParams.get("v")
  }

  const segments = url.pathname.split("/").filter(Boolean)
  if (segments[0] === "embed" || segments[0] === "shorts") {
    return segments.length === 2 ? segments[1] ?? null : null
  }

  return null
}

function normalizeYoutubeUrl(input: string, url: URL): MediaEmbedImportResult | null {
  const id = youtubeIdFromUrl(url)
  if (!id || !YOUTUBE_ID_PATTERN.test(id)) return null

  return {
    kind: "embed",
    provider: "youtube",
    embedUrl: `https://www.youtube.com/embed/${id}`,
    sourceUrl: input,
  }
}

function normalizeVimeoUrl(input: string, url: URL): MediaEmbedImportResult | null {
  const host = hostWithoutWww(url)
  const segments = url.pathname.split("/").filter(Boolean)
  const vimeoId = host === "vimeo.com" ? segments[0] : null
  const playerId = host === "player.vimeo.com" && segments[0] === "video"
    ? segments[1]
    : null
  const id = vimeoId ?? playerId
  if (!id || !/^\d+$/.test(id)) return null

  return {
    kind: "embed",
    provider: "vimeo",
    embedUrl: `https://player.vimeo.com/video/${id}`,
    sourceUrl: input,
  }
}

function normalizeSoundCloudUrl(input: string, url: URL): MediaEmbedImportResult | null {
  const host = hostWithoutWww(url)
  if (host !== "soundcloud.com") return null
  if (url.pathname.split("/").filter(Boolean).length < 2) return null

  return {
    kind: "embed",
    provider: "soundcloud",
    embedUrl: `https://w.soundcloud.com/player/?url=${encodeURIComponent(input)}`,
    sourceUrl: input,
  }
}

function normalizeKnownProviderUrl(input: string): MediaEmbedImportResult | null {
  const value = trimInput(input)
  const parsed = parseUrlReference(value)
  if (!parsed) return null
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null

  return (
    normalizeYoutubeUrl(value, parsed) ??
    normalizeVimeoUrl(value, parsed) ??
    normalizeSoundCloudUrl(value, parsed)
  )
}

function providerSupportsKind(
  kind: SourcedBlockKind,
  provider: MediaEmbedProvider,
): boolean {
  if (kind === "video") return provider === "youtube" || provider === "vimeo"
  if (kind === "audio") return provider === "soundcloud"
  return false
}

function validOptionalDimension(value: number | null | undefined): boolean {
  return value == null || (typeof value === "number" && Number.isFinite(value) && value >= 0)
}

function validateDimensions(result: MediaImportResult): MediaImportValidationResult | null {
  if (!validOptionalDimension(result.width) || !validOptionalDimension(result.height)) {
    return { ok: false, error: "Invalid media dimensions" }
  }
  return null
}

function validateAssetResult(result: MediaAssetImportResult): MediaImportValidationResult {
  if (!isSupportedMediaUrlReference(result.src)) {
    return { ok: false, error: "Unsupported media URL" }
  }

  if (result.sourceUrl && !isSupportedMediaUrlReference(result.sourceUrl)) {
    return { ok: false, error: "Unsupported media URL" }
  }

  const dimensionError = validateDimensions(result)
  if (dimensionError) return dimensionError

  return { ok: true, result }
}

function validateEmbedResult(
  kind: SourcedBlockKind,
  result: MediaEmbedImportResult,
): MediaImportValidationResult {
  if (!providerSupportsKind(kind, result.provider)) {
    return { ok: false, error: "Unsupported media provider" }
  }

  const normalized = normalizeKnownProviderUrl(result.sourceUrl)
  if (
    !normalized ||
    normalized.provider !== result.provider ||
    normalized.embedUrl !== result.embedUrl
  ) {
    return { ok: false, error: "Unsupported media embed" }
  }

  const dimensionError = validateDimensions(result)
  if (dimensionError) return dimensionError

  return { ok: true, result }
}

export function normalizeMediaUrlInput(
  kind: SourcedBlockKind,
  input: string,
): MediaUrlInputResult {
  const value = trimInput(input)
  const parsed = parseUrlReference(value)
  const normalized = normalizeKnownProviderUrl(value)

  if (normalized) {
    const validation = validateEmbedResult(kind, normalized)
    return validation.ok ? validation.result : validation
  }

  if (
    parsed &&
    (parsed.protocol === "http:" || parsed.protocol === "https:") &&
    isKnownProviderUrl(parsed)
  ) {
    return { ok: false, error: "Unsupported media embed" }
  }

  if (!isSupportedMediaUrlReference(value)) {
    return { ok: false, error: "Unsupported media URL" }
  }

  return {
    kind: "asset",
    src: value,
    sourceUrl: value,
  }
}

export function validateMediaImportResult(
  kind: SourcedBlockKind,
  result: MediaImportResult,
): MediaImportValidationResult {
  if (result.kind === "asset") return validateAssetResult(result)
  return validateEmbedResult(kind, result)
}

export function mediaResultToAttrs(result: MediaImportResult): MediaSourceAttrs {
  if (result.kind === "asset") {
    return {
      sourceType: "asset",
      src: result.src,
      embedUrl: null,
      provider: null,
      sourceUrl: result.sourceUrl ?? null,
      title: result.title ?? result.alt ?? "",
      width: typeof result.width === "number" ? result.width : null,
      height: typeof result.height === "number" ? result.height : null,
    }
  }

  return {
    sourceType: "embed",
    src: "",
    embedUrl: result.embedUrl,
    provider: result.provider,
    sourceUrl: result.sourceUrl,
    title: result.title ?? "",
    width: typeof result.width === "number" ? result.width : null,
    height: typeof result.height === "number" ? result.height : null,
  }
}
