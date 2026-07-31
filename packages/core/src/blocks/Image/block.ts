// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { nanoid } from "nanoid"
import { createBlockSpec, mergeBlockHTMLAttributes } from "../../schema"
import type { RuneBlockBase } from "../../types"
import {
  insertOrUpdateBlockForSlashMenu,
  type SuggestionCommitContext,
} from "../../extensions/suggestion-menus"
import {
  applyContentWidthAttrs,
  contentWidthInPlaceAttr,
  inputContentWidthOrDefault,
  normalizeContentWidth,
  parseContentWidthAttrs,
} from "../media/contentWidth"
import {
  DEFAULT_MEDIA_ALIGN,
  inputMediaAlignOrDefault,
  mediaAlignInPlaceAttr,
  normalizeMediaAlign,
  parseMediaAlignAttr,
  renderMediaAlignAttr,
  type MediaAlign,
} from "../media/align"
import { escapeHtmlAttr, unescapeHtmlAttr } from "../../markdown/htmlAttr"
import { downloadMediaAsset } from "../media/assetActions"
import { getMediaImportState } from "../media/import-plugin"

// Value lives in rune-tokens.css (--rune-media-pad-top) — see media/render.ts.
const IMAGE_PAD_TOP = "var(--rune-media-pad-top)"
export const IMAGE_ICON_PATHS = [
  "M8.5 9.31a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3",
  "M2.375 6.25c0-1.174.951-2.125 2.125-2.125h11c1.174 0 2.125.951 2.125 2.125v7.5a2.125 2.125 0 0 1-2.125 2.125h-11a2.125 2.125 0 0 1-2.125-2.125zM4.5 5.375a.875.875 0 0 0-.875.875v5.491l1.996-1.995a.625.625 0 0 1 .883 0l1.98 1.98 4.137-4.137a.625.625 0 0 1 .883 0l2.871 2.87V6.25a.875.875 0 0 0-.875-.875zm11.875 6.852-3.312-3.312-4.137 4.136a.625.625 0 0 1-.884 0l-1.98-1.98-2.437 2.438v.241c0 .483.392.875.875.875h11a.875.875 0 0 0 .875-.875z",
]
interface ImageAttrs {
  id: string | null
  depth: number
  src: string
  alt: string
  title: string | null
  width: number | null
  height: number | null
  contentWidth: number | null
  align: MediaAlign
  sourceUrl: string | null
  pendingFromPaste: string | null
}

function numAttr(el: HTMLElement, name: string): number | null {
  const raw = el.getAttribute(name)
  if (raw == null) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

function inputNumberOrDefault(
  value: unknown,
  fallback: unknown,
): number | null {
  if (typeof value === "number") return value
  if (value === null) return null
  return typeof fallback === "number" ? fallback : null
}

function inputStringOrDefault(value: unknown, fallback: unknown): string {
  if (typeof value === "string") return value
  return typeof fallback === "string" ? fallback : ""
}

function inputNullableStringOrDefault(value: unknown, fallback: unknown): string | null {
  if (typeof value === "string") return value
  if (value === null) return null
  return typeof fallback === "string" ? fallback : null
}

function slashSourceDepth(ctx: SuggestionCommitContext): number {
  const $from = ctx.editor.state.doc.resolve(ctx.range.from)
  const depth = $from.node($from.depth).attrs.depth
  return typeof depth === "number" ? depth : 0
}

function runeImageAttrsFromChrome(el: HTMLElement): Partial<ImageAttrs> | false {
  const content = el.querySelector<HTMLElement>(
    ":scope > .rune-block-content",
  )
  if (!content) return false

  const base = {
    id: el.getAttribute("data-id"),
    depth: numAttr(el, "data-depth") ?? 0,
  }

  const img = content?.querySelector<HTMLImageElement>(
    ":scope > img[data-rune-image]",
  )
  if (!img) {
    const isEmptyChrome =
      el.classList.contains("rune-image-empty") ||
      content.querySelector(":scope > .rune-image-empty-control") !== null
    if (!isEmptyChrome) return false
    return {
      ...base,
      src: "",
      alt: "",
      title: null,
      width: null,
      height: null,
      contentWidth: null,
      sourceUrl: null,
      pendingFromPaste: null,
    }
  }

  const src = img.getAttribute("src")
  if (!src) return false

  return {
    ...base,
    src,
    alt: img.getAttribute("alt") ?? "",
    title: img.getAttribute("title"),
    width: numAttr(img, "width"),
    height: numAttr(img, "height"),
    contentWidth: parseContentWidthAttrs(content),
    sourceUrl: null,
    pendingFromPaste: null,
  }
}

/** One attribute out of a self-contained `<img …>`; same shape media uses. */
const IMG_ATTR = (name: string, attrs: string): string | undefined =>
  new RegExp(`\\b${name}="([^"]*)"`).exec(attrs)?.[1]

export const Image = createBlockSpec({
  type: "image",
  content: "",
  props: {
    src: { default: "", renderHTML: () => ({}) },
    alt: { default: "", renderHTML: () => ({}) },
    title: { default: null as string | null, renderHTML: () => ({}) },
    width: { default: null as number | null, renderHTML: () => ({}) },
    height: { default: null as number | null, renderHTML: () => ({}) },
    contentWidth: { default: null as number | null, renderHTML: () => ({}) },
    align: {
      default: DEFAULT_MEDIA_ALIGN as MediaAlign,
      parseHTML: parseMediaAlignAttr,
      renderHTML: renderMediaAlignAttr,
    },
    sourceUrl: { default: null as string | null, renderHTML: () => ({}) },
    pendingFromPaste: { default: null as string | null, renderHTML: () => ({}) },
  },
  supports: { resize: true, mediaSource: true, align: true },
  resizeMediaSelector: "img[data-rune-image]",
  inPlaceAttrs: [contentWidthInPlaceAttr, mediaAlignInPlaceAttr],
  /**
   * D6's align half. Width rides Obsidian's native `![alt|300](src)` and is
   * handled by the builtin mapping in `markdown/convert.ts`; alignment has no
   * Markdown spelling at all, so a non-default alignment upgrades to the `<img>`
   * form and this contract owns both directions of that.
   *
   * `center` is the default, so the overwhelmingly common image still writes as
   * `![alt](src)` and never sees a tag. `contentWidth` is deliberately absent:
   * it is view state (zyler PRD §4.1), and persisting it would push one
   * client's layout decision into a file every other client must honour.
   */
  markdown: {
    toMdast: (block) => {
      const align = block.attrs?.align
      if (align !== "left" && align !== "right") return null // builtin `![]()`
      const src = typeof block.attrs?.src === "string" ? block.attrs.src : ""
      const alt = typeof block.attrs?.alt === "string" ? block.attrs.alt : ""
      const title = typeof block.attrs?.title === "string" ? block.attrs.title : null
      const width = typeof block.attrs?.width === "number" ? block.attrs.width : null
      return {
        type: "html",
        value:
          `<img src="${escapeHtmlAttr(src)}"` +
          (alt ? ` alt="${escapeHtmlAttr(alt)}"` : "") +
          (title !== null ? ` title="${escapeHtmlAttr(title)}"` : "") +
          (width ? ` width="${width}"` : "") +
          ` align="${align}">`,
      }
    },
    fromMdast: (node) => {
      if (node.type !== "html") return null
      const shape = /^<img\b([^>]*?)\/?>\s*$/.exec(node.value.trim())
      if (!shape) return null
      const attrs = shape[1] ?? ""
      const src = IMG_ATTR("src", attrs)
      const align = IMG_ATTR("align", attrs)
      const title = IMG_ATTR("title", attrs)
      // Only an `<img>` this codec could itself have written is claimed. One
      // with no alignment is a plain image the author spelled as a tag, and
      // reading it as `![]()` would rewrite their file on the next save; the
      // raw carrier keeps those bytes instead.
      if (!src || (align !== "left" && align !== "right")) return null
      const width = Number(IMG_ATTR("width", attrs) ?? "")
      return {
        type: "image",
        attrs: {
          src: unescapeHtmlAttr(src),
          alt: unescapeHtmlAttr(IMG_ATTR("alt", attrs) ?? ""),
          ...(title !== undefined ? { title: unescapeHtmlAttr(title) } : {}),
          align,
          ...(Number.isFinite(width) && width > 0 ? { width } : {}),
        },
      }
    },
  },
  schemaContext: {
    input: {
      examples: [
        {
          type: "image",
          src: "https://example.com/image.png",
          alt: "Example image",
        },
      ],
    },
  },
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
      id: "download",
      label: "Download",
      icon: "download",
      quickAction: true,
      isVisible: ({ node, isSingleBlock }) =>
        isSingleBlock && typeof node.attrs.src === "string" && node.attrs.src !== "",
      run: ({ node }) => {
        const { src, alt } = node.attrs as ImageAttrs
        return downloadMediaAsset(src, alt)
      },
    },
  ],

  parseDOM: [
    {
      tag: "div.rune-block.rune-image",
      getAttrs: (el) => runeImageAttrsFromChrome(el as HTMLElement),
    },
    {
      tag: "img",
      getAttrs: (el) => {
        const img = el as HTMLImageElement
        const pendingFromPaste = img.getAttribute("data-rune-paste-image")
        if (pendingFromPaste) {
          // BlockId stamps id via appendTransaction (createSpec contract);
          // no need to mint one here. Eager-id only matters for paths that
          // hand the id back to the caller synchronously (slash, drop) —
          // paste routing just needs parseDOM → appendTransaction to fire.
          return {
            src: "",
            alt: img.getAttribute("alt") ?? "",
            title: img.getAttribute("title"),
            width: null,
            height: null,
            sourceUrl: null,
            pendingFromPaste,
          }
        }

        const src = img.getAttribute("src")
        if (!src) return false
        return {
          src,
          alt: img.getAttribute("alt") ?? "",
          title: img.getAttribute("title"),
          width: numAttr(img, "width"),
          height: numAttr(img, "height"),
          pendingFromPaste: null,
        }
      },
    },
  ],

  renderDOM({ node, HTMLAttributes }) {
    const outer = HTMLAttributes
    const { src, alt, title, width, height, contentWidth } = node.attrs as ImageAttrs
    const contentAttrs: Record<string, string> = { class: "rune-block-content" }

    if (src === "") {
      const outerAttrs = mergeBlockHTMLAttributes(outer, {
        className: "rune-image rune-image-empty",
        styleVars: { "--block-pad-top": IMAGE_PAD_TOP },
      })
      return [
        "div",
        outerAttrs,
        [
          "div",
          contentAttrs,
          [
            "div",
            { class: "rune-image-empty-control" },
            [
              "div",
              { class: "rune-image-empty-icon" },
              [
                "http://www.w3.org/2000/svg svg",
                {
                  "aria-hidden": "true",
                  role: "graphics-symbol",
                  viewBox: "0 0 20 20",
                  class: "rune-image-empty-icon-svg",
                },
                ...IMAGE_ICON_PATHS.map((d) => [
                  "http://www.w3.org/2000/svg path",
                  { d },
                ]),
              ],
            ],
            ["span", { class: "rune-image-empty-label" }, "Add an image"],
          ],
        ],
      ]
    }

    applyContentWidthAttrs(contentAttrs, contentWidth)

    const outerAttrs = mergeBlockHTMLAttributes(outer, {
      className: "rune-image",
      styleVars: { "--block-pad-top": IMAGE_PAD_TOP },
    })
    return [
      "div",
      outerAttrs,
      [
        "div",
        contentAttrs,
        [
          "img",
          {
            src,
            alt,
            ...(title !== null ? { title } : {}),
            ...(width != null ? { width: String(width) } : {}),
            ...(height != null ? { height: String(height) } : {}),
            // Block native HTML5 image drag: a direct mousedown+drag on the
            // <img> would otherwise fire dragstart, which prosemirror-dropcursor
            // (bundled by StarterKit) renders as a stray white drop indicator
            // and competes with our side-menu grip block-drag path.
            draggable: "false",
            "data-rune-image": "",
          },
        ],
      ],
    ]
  },

  toMarkdown({ prefix, node }) {
    const src = typeof node.attrs.src === "string" ? node.attrs.src : ""
    const alt = typeof node.attrs.alt === "string" ? node.attrs.alt : ""
    const title = typeof node.attrs.title === "string" ? node.attrs.title : null
    const titlePart =
      title === null
        ? ""
        : ` "${title.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
    return { line: `${prefix}![${alt}](${src}${titlePart})` }
  },

  clipboardRenderDOM({ node }) {
    const attrs = node.attrs as ImageAttrs
    if (!attrs.src) return ["span"]
    return [
      "img",
      {
        src: attrs.src,
        alt: attrs.alt,
        ...(attrs.title !== null ? { title: attrs.title } : {}),
      },
    ]
  },

  toRuneBlock(node) {
    const attrs = node.attrs as ImageAttrs
    const contentWidth = normalizeContentWidth(attrs.contentWidth)
    const align = normalizeMediaAlign(attrs.align)
    return {
      type: "image" as const,
      id: typeof attrs.id === "string" ? attrs.id : "",
      depth: typeof attrs.depth === "number" ? attrs.depth : 0,
      src: typeof attrs.src === "string" ? attrs.src : "",
      alt: typeof attrs.alt === "string" ? attrs.alt : "",
      ...(typeof attrs.title === "string" ? { title: attrs.title } : {}),
      width: typeof attrs.width === "number" ? attrs.width : null,
      height: typeof attrs.height === "number" ? attrs.height : null,
      ...(contentWidth !== null ? { contentWidth } : {}),
      ...(align !== DEFAULT_MEDIA_ALIGN ? { align } : {}),
      ...(typeof attrs.sourceUrl === "string"
        ? { sourceUrl: attrs.sourceUrl }
        : {}),
    }
  },

  fromInput({ schema, input, defaults }) {
    if (input.type !== "image") return null
    const type = schema.nodes.image
    if (!type) return null

    const attrs = {
      ...defaults.attrs,
      id: input.id ?? null,
      depth: input.depth ?? defaults.depth ?? 0,
      src: inputStringOrDefault(input.src, defaults.attrs?.src),
      alt: inputStringOrDefault(input.alt, defaults.attrs?.alt),
      title: inputNullableStringOrDefault(input.title, defaults.attrs?.title),
      width: inputNumberOrDefault(input.width, defaults.attrs?.width),
      height: inputNumberOrDefault(input.height, defaults.attrs?.height),
      contentWidth: inputContentWidthOrDefault(
        input.contentWidth,
        defaults.attrs?.contentWidth,
      ),
      align: inputMediaAlignOrDefault(input.align, defaults.attrs?.align),
      sourceUrl: inputNullableStringOrDefault(input.sourceUrl, defaults.attrs?.sourceUrl),
      pendingFromPaste: inputNullableStringOrDefault(
        undefined,
        defaults.attrs?.pendingFromPaste,
      ),
    }

    return type.create(attrs)
  },

  slashMenuItems: () => [
    {
      key: "image",
      title: "Image",
      aliases: ["image", "photo", "picture"],
      group: "Media",
      onItemClick: (ctx) => {
        if (!ctx.editor.isEditable) return
        const id = nanoid(8)
        insertOrUpdateBlockForSlashMenu(ctx, {
          type: "image",
          props: { id, depth: slashSourceDepth(ctx) },
        })
        ctx.editor.commands.openImagePopover?.(id)
      },
    },
  ],
})

export interface RuneImageBlock extends RuneBlockBase {
  type: "image"
  src: string
  alt: string
  /** Optional Markdown/HTML advisory title. */
  title?: string
  width: number | null
  height: number | null
  contentWidth?: number | null
  /** Horizontal placement of the media within the block. Absent → center. */
  align?: MediaAlign
  sourceUrl?: string
}
