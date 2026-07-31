// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { nanoid } from "nanoid"
import type { JSONContent } from "@tiptap/core"
import type { TagParseRule } from "@tiptap/pm/model"
import { createBlockSpec, mergeBlockHTMLAttributes } from "../../schema"
import type {
  RuneBlockSchemaContextSpec,
  RuneMarkdownBlockContract,
  RuneMarkdownBlockSerializer,
} from "../../schema"
import { insertOrUpdateBlockForSlashMenu } from "../../extensions/suggestion-menus"
import {
  applyContentWidthAttrs,
  contentWidthInPlaceAttr,
  inputContentWidthOrDefault,
  normalizeContentWidth,
} from "./contentWidth"
import {
  DEFAULT_MEDIA_ALIGN,
  inputMediaAlignOrDefault,
  mediaAlignInPlaceAttr,
  normalizeMediaAlign,
  parseMediaAlignAttr,
  renderMediaAlignAttr,
  type MediaAlign,
} from "./align"
import { openMediaOriginal, originalMediaUrl } from "./assetActions"
import { iframeAttrs, MEDIA_PAD_TOP, renderEmptyMediaDOM } from "./render"
import {
  isSupportedMediaUrlReference,
  mediaResultToAttrs,
  normalizeMediaUrlInput,
  URL_PARSE_BASE,
  validateMediaImportResult,
  type MediaEmbedProvider,
  type MediaImportResult,
  type MediaSourceAttrs,
  type MediaSourceType,
  type SourcedBlockKind,
} from "./source"
import {
  contentAttrsFromOuter,
  inputNullableStringOrDefault,
  inputNumberOrDefault,
  inputProviderOrDefault,
  inputSourceTypeOrDefault,
  inputStringOrDefault,
  isMediaImportResult,
  isProvider,
  numAttr,
  slashSourceDepth,
} from "./source-input-helpers"
import { getMediaImportState } from "./import-plugin"
import { escapeHtmlAttr, unescapeHtmlAttr } from "../../markdown/htmlAttr"

export type SourceMediaBlockKind = Extract<SourcedBlockKind, "video" | "audio">

export interface SourceMediaAttrs extends MediaSourceAttrs {
  id: string | null
  depth: number
  contentWidth: number | null
  /** Only present on blocks whose config sets `supportsAlign` (video). */
  align?: MediaAlign
}

export interface SourceMediaBlockConfig {
  type: SourceMediaBlockKind
  className: string
  iconPaths: string[]
  allowedProviders: readonly MediaEmbedProvider[]
  assetDataAttr: string
  assetTag: "video" | "audio"
  assetHasDimensions: boolean
  /** Adds the `align` attr + Alignment UI. Video yes; audio renders
   *  full-width and omits it (spec 2026-06-11). */
  supportsAlign: boolean
  slash: {
    key: string
    title: string
    aliases: string[]
    group: string
  }
  extraParseDOM?: TagParseRule[]
  includeContentWidthInOutput: boolean
  toMarkdown?: RuneMarkdownBlockSerializer
  schemaContext?: RuneBlockSchemaContextSpec
  /**
   * Overrides the derived `resizeMediaSelector`
   * (`<assetTag>[<assetDataAttr>], iframe[data-rune-media-embed]`) —
   * e.g. Audio adds its React player wrapper. See
   * `BlockSpecConfig.resizeMediaSelector`.
   */
  resizeMediaSelector?: string
}

type MaybeMediaPopoverCommands = {
  openMediaPopover?: (blockId: string) => boolean
}

function mediaSourceFromElement(
  el: HTMLElement,
  config: Pick<SourceMediaBlockConfig, "assetDataAttr" | "assetTag">,
): string {
  if (el.tagName.toLowerCase() === config.assetTag) {
    return (
      el.getAttribute("src") ||
      el.querySelector<HTMLSourceElement>("source[src]")?.getAttribute("src") ||
      ""
    )
  }

  const media = el.querySelector<HTMLElement>(
    `:scope > .rune-block-content > ${config.assetTag}[${config.assetDataAttr}]`,
  )
  return media ? mediaSourceFromElement(media, config) : ""
}

function validEmbedAttrs(
  config: SourceMediaBlockConfig,
  attrs: SourceMediaAttrs,
): boolean {
  const provider = attrs.provider
  if (
    !provider ||
    !attrs.embedUrl ||
    !attrs.sourceUrl ||
    !config.allowedProviders.includes(provider)
  ) {
    return false
  }

  return validateMediaImportResult(config.type, {
    kind: "embed",
    provider,
    embedUrl: attrs.embedUrl,
    sourceUrl: attrs.sourceUrl,
    title: attrs.title,
    width: attrs.width,
    height: attrs.height,
  }).ok
}

function validAssetAttrs(
  config: SourceMediaBlockConfig,
  attrs: SourceMediaAttrs,
): boolean {
  if (!attrs.src) return false
  return validateMediaImportResult(config.type, {
    kind: "asset",
    src: attrs.src,
    sourceUrl: attrs.sourceUrl ?? undefined,
    title: attrs.title,
    width: attrs.width,
    height: attrs.height,
  }).ok
}

function attrsFromInput({
  config,
  input,
  defaults,
}: {
  config: SourceMediaBlockConfig
  input: { [k: string]: unknown }
  defaults: { depth: number; attrs?: Record<string, unknown> }
}): SourceMediaAttrs | null {
  const sourceType = inputSourceTypeOrDefault(
    input.sourceType,
    defaults.attrs?.sourceType,
  )
  const title = inputStringOrDefault(input.title, defaults.attrs?.title)
  const width = inputNumberOrDefault(input.width, defaults.attrs?.width)
  const height = inputNumberOrDefault(input.height, defaults.attrs?.height)
  const contentWidth = inputContentWidthOrDefault(
    input.contentWidth,
    defaults.attrs?.contentWidth,
  )
  const alignAttrs = config.supportsAlign
    ? { align: inputMediaAlignOrDefault(input.align, defaults.attrs?.align) }
    : {}

  if (sourceType === "embed") {
    const provider = inputProviderOrDefault(input.provider, defaults.attrs?.provider)
    const embedUrl = inputNullableStringOrDefault(
      input.embedUrl,
      defaults.attrs?.embedUrl,
    )
    const sourceUrl = inputNullableStringOrDefault(
      input.sourceUrl,
      defaults.attrs?.sourceUrl,
    )

    const attrs = {
      ...defaults.attrs,
      id: input.id ?? null,
      depth: input.depth ?? defaults.depth,
      sourceType,
      src: "",
      embedUrl,
      provider,
      sourceUrl,
      title,
      width,
      height,
      contentWidth,
      ...alignAttrs,
    } as SourceMediaAttrs

    return validEmbedAttrs(config, attrs) ? attrs : null
  }

  const attrs = {
    ...defaults.attrs,
    id: input.id ?? null,
    depth: input.depth ?? defaults.depth,
    sourceType: "asset" as const,
    src: inputStringOrDefault(input.src, defaults.attrs?.src),
    embedUrl: null,
    provider: null,
    sourceUrl: inputNullableStringOrDefault(
      input.sourceUrl,
      defaults.attrs?.sourceUrl,
    ),
    title,
    width,
    height,
    contentWidth,
    ...alignAttrs,
  } as SourceMediaAttrs

  if (attrs.src && !validAssetAttrs(config, attrs)) return null
  return attrs
}

function genericAssetParseDOM(config: SourceMediaBlockConfig): TagParseRule {
  return {
    tag: config.assetTag === "video" ? "video" : "audio[src]",
    getAttrs: (el) => {
      const media = el as HTMLElement
      const src = mediaSourceFromElement(media, config)
      if (!src || !isSupportedMediaUrlReference(src)) return false
      return {
        sourceType: "asset",
        src,
        embedUrl: null,
        provider: null,
        sourceUrl: null,
        title: media.getAttribute("title") ?? "",
        width: config.assetHasDimensions ? numAttr(media, "width") : null,
        height: config.assetHasDimensions ? numAttr(media, "height") : null,
      }
    },
  }
}

function renderEmptySourceMedia(
  config: SourceMediaBlockConfig,
  outer: Record<string, any>,
  contentAttrs: Record<string, string>,
) {
  return renderEmptyMediaDOM(config.type, outer, contentAttrs, config.iconPaths)
}

function renderSourceMediaOuterAttrs(
  config: SourceMediaBlockConfig,
  outer: Record<string, any>,
) {
  return mergeBlockHTMLAttributes(outer, {
    className: config.className,
    styleVars: { "--block-pad-top": MEDIA_PAD_TOP },
  })
}

function embedDOMAttrs(
  config: SourceMediaBlockConfig,
  attrs: SourceMediaAttrs,
): Record<string, string> {
  const out = iframeAttrs(attrs.provider!, attrs.embedUrl!, attrs.title)
  if (config.type === "video") {
    out["data-rune-source-url"] = attrs.sourceUrl!
  }
  if (config.assetHasDimensions) {
    if (attrs.width != null) out.width = String(attrs.width)
    if (attrs.height != null) out.height = String(attrs.height)
  }
  return out
}

function assetDOMAttrs(
  config: SourceMediaBlockConfig,
  attrs: SourceMediaAttrs,
): Record<string, string> {
  return {
    src: attrs.src,
    controls: "",
    [config.assetDataAttr]: "",
    ...(attrs.title ? { title: attrs.title } : {}),
    ...(config.assetHasDimensions && attrs.width != null
      ? { width: String(attrs.width) }
      : {}),
    ...(config.assetHasDimensions && attrs.height != null
      ? { height: String(attrs.height) }
      : {}),
  }
}

// ─── markdown storage contract (PRD D5, Obsidian field-tested 2026-07-29) ───
//
// Split by kind: EMBEDS write `![title](sourceUrl)` — Obsidian renders the
// provider iframe for that form, while a `<video>` tag pointed at a watch URL
// is dead there. ASSETS write a paired `<video|audio src controls></tag>` —
// Obsidian plays it, while `![](clip.mp4)` shows nothing. The pair must stay
// explicit: these tags are not HTML void elements, so a self-closing `/` is
// ignored by real parsers and the open tag would swallow following content.
//
// Identity in the `![](url)` grammar belongs to Image by default; a media
// block claims it only on a URL-shape signal — a provider match, or a file
// extension naming this kind. Extension-less asset URLs stay images: the
// declared-lossy edge. The tag form needs no such gate (the tag IS the
// identity), so extension-less uploads survive through it, and a tag whose
// src turns out to be a provider URL normalizes forward into embed attrs.
// embedUrl is never trusted from the file — normalizeMediaUrlInput recomputes
// it from sourceUrl, so a stale or tampered embed URL cannot ride in.

const MEDIA_FILE_EXTENSIONS: Record<SourceMediaBlockKind, ReadonlySet<string>> = {
  video: new Set(["mp4", "webm", "mov", "m4v", "ogv"]),
  audio: new Set(["mp3", "wav", "m4a", "ogg", "oga", "flac", "aac"]),
}

function urlFileExtension(url: string): string | null {
  try {
    const pathname = new URL(url, URL_PARSE_BASE).pathname
    const last = pathname.split("/").pop() ?? ""
    const dot = last.lastIndexOf(".")
    return dot > 0 ? last.slice(dot + 1).toLowerCase() : null
  } catch {
    return null
  }
}

/** `![](url)` promotion gate: embed-provider match, or a file extension
 *  naming this media kind. Anything else stays an image. */
function classifyImageSyntaxUrl(
  kind: SourceMediaBlockKind,
  url: string,
): MediaImportResult | null {
  const normalized = normalizeMediaUrlInput(kind, url)
  if (!isMediaImportResult(normalized)) return null
  if (normalized.kind === "embed") return normalized
  const ext = urlFileExtension(url)
  return ext && MEDIA_FILE_EXTENSIONS[kind].has(ext) ? normalized : null
}

const TAG_ATTR = (name: string, value: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(value)

/** Parse a paired (or, generously, self-closing) asset tag emitted by us or
 *  hand-written: `<video src="…" title="…" width="640" controls></video>`. */
function parseAssetTag(
  tag: "video" | "audio",
  value: string,
): { src: string; title: string | null; width: number | null; height: number | null } | null {
  const shape = new RegExp(`^<${tag}\\b([^>]*?)/?>(?:\\s*</${tag}>)?\\s*$`).exec(value.trim())
  if (!shape) return null
  const attrs = shape[1]!
  const src = TAG_ATTR("src", attrs)?.[1]
  if (!src) return null
  const num = (name: string): number | null => {
    const raw = TAG_ATTR(name, attrs)?.[1]
    const parsed = raw ? Number(raw) : Number.NaN
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
  }
  const title = TAG_ATTR("title", attrs)?.[1]
  return {
    src: unescapeHtmlAttr(src),
    title: title ? unescapeHtmlAttr(title) : null,
    width: num("width"),
    height: num("height"),
  }
}

/** Build the block's PM JSON from a normalized import result; null/empty
 *  attrs are omitted (schema defaults fill them identically). */
function mediaBlockFromResult(
  config: SourceMediaBlockConfig,
  result: MediaImportResult,
  fallbackTitle: string,
): JSONContent {
  const full = mediaResultToAttrs(result)
  if (!full.title && fallbackTitle) full.title = fallbackTitle
  const attrs = Object.fromEntries(
    Object.entries(full).filter(([, v]) => v !== null && v !== ""),
  )
  return { type: config.type, ...(Object.keys(attrs).length ? { attrs } : {}) }
}

function createMediaMarkdownContract(config: SourceMediaBlockConfig): RuneMarkdownBlockContract {
  return {
    toMdast(blockJson) {
      const attrs = (blockJson.attrs ?? {}) as Partial<SourceMediaAttrs>
      const title = typeof attrs.title === "string" ? attrs.title : ""
      if (attrs.sourceType === "embed") {
        const sourceUrl =
          (typeof attrs.sourceUrl === "string" && attrs.sourceUrl) ||
          (typeof attrs.embedUrl === "string" && attrs.embedUrl) ||
          ""
        if (!sourceUrl) return null
        return {
          type: "paragraph",
          children: [{ type: "image", url: sourceUrl, alt: title }],
        }
      }
      const src = typeof attrs.src === "string" && attrs.src ? attrs.src : null
      if (!src) return null // placeholder block, no source picked — nothing to store
      const parts = [
        `src="${escapeHtmlAttr(src)}"`,
        ...(title ? [`title="${escapeHtmlAttr(title)}"`] : []),
        ...(typeof attrs.width === "number" ? [`width="${attrs.width}"`] : []),
        ...(typeof attrs.height === "number" ? [`height="${attrs.height}"`] : []),
        "controls",
      ]
      return {
        type: "html",
        value: `<${config.assetTag} ${parts.join(" ")}></${config.assetTag}>`,
      }
    },
    fromMdast(node) {
      const claimTagSource = (value: string): JSONContent | null => {
        const parsed = parseAssetTag(config.assetTag, value)
        if (!parsed) return null
        const normalized = normalizeMediaUrlInput(config.type, parsed.src)
        if (!isMediaImportResult(normalized)) return null
        const result: MediaImportResult = {
          ...normalized,
          ...(parsed.title ? { title: parsed.title } : {}),
          ...(parsed.width != null ? { width: parsed.width } : {}),
          ...(parsed.height != null ? { height: parsed.height } : {}),
        }
        if (!validateMediaImportResult(config.type, result).ok) return null
        return mediaBlockFromResult(config, result, "")
      }
      if (node.type === "paragraph") {
        const lone = node.children.length === 1 ? node.children[0] : null
        if (lone?.type === "image" && lone.url) {
          const result = classifyImageSyntaxUrl(config.type, lone.url)
          return result ? mediaBlockFromResult(config, result, lone.alt ?? "") : null
        }
        // A single-line `<video src="…"></video>` is INLINE html to
        // CommonMark (video/audio are absent from the type-6 block-element
        // list, and the same-line close tag disqualifies type 7), so the
        // pair arrives as a paragraph of html nodes. Rejoin and claim it.
        if (
          node.children.length > 0 &&
          node.children.every(
            (c) => c.type === "html" || (c.type === "text" && !c.value.trim()),
          )
        ) {
          const joined = node.children
            .map((c) => (c.type === "html" || c.type === "text" ? c.value : ""))
            .join("")
          return claimTagSource(joined)
        }
        return null
      }
      if (node.type === "html") return claimTagSource(node.value)
      return null
    },
  }
}

export function createSourceMediaBlockSpec(config: SourceMediaBlockConfig) {
  return createBlockSpec({
    type: config.type,
    content: "",
    props: {
      sourceType: {
        default: "asset" as MediaSourceType,
        renderHTML: () => ({}),
      },
      src: {
        default: "",
        parseHTML: (el) => mediaSourceFromElement(el, config),
        renderHTML: () => ({}),
      },
      embedUrl: { default: null as string | null, renderHTML: () => ({}) },
      provider: {
        default: null as MediaEmbedProvider | null,
        renderHTML: () => ({}),
      },
      sourceUrl: { default: null as string | null, renderHTML: () => ({}) },
      title: { default: "", renderHTML: () => ({}) },
      width: {
        default: null as number | null,
        parseHTML: (el) =>
          config.assetHasDimensions ? numAttr(el, "width") : null,
        renderHTML: () => ({}),
      },
      height: {
        default: null as number | null,
        parseHTML: (el) =>
          config.assetHasDimensions ? numAttr(el, "height") : null,
        renderHTML: () => ({}),
      },
      contentWidth: { default: null as number | null, renderHTML: () => ({}) },
      ...(config.supportsAlign
        ? {
            align: {
              default: DEFAULT_MEDIA_ALIGN as MediaAlign,
              parseHTML: parseMediaAlignAttr,
              renderHTML: renderMediaAlignAttr,
            },
          }
        : {}),
    },
    supports: {
      resize: true,
      mediaSource: true,
      align: config.supportsAlign,
    },
    resizeMediaSelector:
      config.resizeMediaSelector ??
      `${config.assetTag}[${config.assetDataAttr}], iframe[data-rune-media-embed]`,
    inPlaceAttrs: config.supportsAlign
      ? [contentWidthInPlaceAttr, mediaAlignInPlaceAttr]
      : [contentWidthInPlaceAttr],
    schemaContext: config.schemaContext,
    sideMenu: { draggable: true },
    blockActions: () => [
      {
        id: "replace-source",
        label: "Replace",
        icon: "replace",
        isVisible: ({ editor, isSingleBlock, blockId }) => {
          if (!isSingleBlock || !blockId) return false
          return getMediaImportState(editor, blockId)?.phase !== "importing"
        },
        run: ({ editor, blockId }) => {
          if (!blockId) return false
          return editor.commands.openMediaPopover(blockId)
        },
      },
      {
        id: "view-original",
        label: "View original",
        icon: "external-link",
        quickAction: true,
        isVisible: ({ node, isSingleBlock }) =>
          isSingleBlock && originalMediaUrl(node.attrs) !== null,
        run: ({ node }) => {
          const url = originalMediaUrl(node.attrs)
          if (!url) return false
          return openMediaOriginal(url)
        },
      },
    ],
    toMarkdown: config.toMarkdown,
    markdown: createMediaMarkdownContract(config),
    parseDOM: [
      ...(config.extraParseDOM ?? []),
      genericAssetParseDOM(config),
    ],

    renderDOM({ node, HTMLAttributes }) {
      const attrs = node.attrs as SourceMediaAttrs
      const { outer, contentAttrs } = contentAttrsFromOuter(HTMLAttributes)

      if (attrs.sourceType === "embed") {
        if (!validEmbedAttrs(config, attrs)) {
          return renderEmptySourceMedia(config, outer, contentAttrs)
        }

        const outerAttrs = renderSourceMediaOuterAttrs(config, outer)
        applyContentWidthAttrs(contentAttrs, attrs.contentWidth)
        return [
          "div",
          outerAttrs,
          [
            "div",
            contentAttrs,
            ["iframe", embedDOMAttrs(config, attrs)],
          ],
        ]
      }

      if (!validAssetAttrs(config, attrs)) {
        return renderEmptySourceMedia(config, outer, contentAttrs)
      }

      const outerAttrs = renderSourceMediaOuterAttrs(config, outer)
      applyContentWidthAttrs(contentAttrs, attrs.contentWidth)
      return [
        "div",
        outerAttrs,
        [
          "div",
          contentAttrs,
          [
            config.assetTag,
            assetDOMAttrs(config, attrs),
          ],
        ],
      ]
    },

    clipboardRenderDOM({ node }) {
      const attrs = node.attrs as SourceMediaAttrs
      if (attrs.sourceType === "embed") {
        if (!validEmbedAttrs(config, attrs)) return ["span"]
        return [
          "a",
          { href: attrs.sourceUrl || attrs.embedUrl || "" },
          attrs.title || attrs.sourceUrl || attrs.embedUrl || "",
        ]
      }
      if (!validAssetAttrs(config, attrs)) return ["span"]
      return [
        config.assetTag,
        {
          src: attrs.src,
          controls: "",
          ...(attrs.title ? { title: attrs.title } : {}),
        },
      ]
    },

    toRuneBlock(node) {
      const attrs = node.attrs as SourceMediaAttrs
      const contentWidth = normalizeContentWidth(attrs.contentWidth)
      const align = normalizeMediaAlign(attrs.align)
      return {
        type: config.type,
        id: typeof attrs.id === "string" ? attrs.id : "",
        depth: typeof attrs.depth === "number" ? attrs.depth : 0,
        sourceType: attrs.sourceType === "embed" ? "embed" : "asset",
        src: typeof attrs.src === "string" ? attrs.src : "",
        embedUrl: typeof attrs.embedUrl === "string" ? attrs.embedUrl : null,
        provider: isProvider(attrs.provider) ? attrs.provider : null,
        sourceUrl: typeof attrs.sourceUrl === "string" ? attrs.sourceUrl : null,
        title: typeof attrs.title === "string" ? attrs.title : "",
        width: typeof attrs.width === "number" ? attrs.width : null,
        height: typeof attrs.height === "number" ? attrs.height : null,
        ...(config.includeContentWidthInOutput && contentWidth !== null
          ? { contentWidth }
          : {}),
        ...(config.supportsAlign && align !== DEFAULT_MEDIA_ALIGN
          ? { align }
          : {}),
      }
    },

    fromInput({ schema, input, defaults }) {
      if (input.type !== config.type) return null
      const type = schema.nodes[config.type]
      if (!type) return null
      const attrs = attrsFromInput({ config, input, defaults })
      return attrs ? type.create(attrs) : null
    },

    slashMenuItems: () => [
      {
        key: config.slash.key,
        title: config.slash.title,
        aliases: config.slash.aliases,
        group: config.slash.group,
        onItemClick: (ctx) => {
          if (!ctx.editor.isEditable) return
          const id = nanoid(8)
          insertOrUpdateBlockForSlashMenu(ctx, {
            type: config.type,
            props: { id, depth: slashSourceDepth(ctx) },
          })
          const commands = ctx.editor.commands as typeof ctx.editor.commands &
            MaybeMediaPopoverCommands
          commands.openMediaPopover?.(id)
        },
      },
    ],
  })
}
