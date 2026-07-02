// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import StarterKit from "@tiptap/starter-kit"
import Code from "@tiptap/extension-code"
import Underline from "@tiptap/extension-underline"
import Link, { isAllowedUri, type LinkOptions } from "@tiptap/extension-link"
import { RUNE_BODY_BLOCKS, deriveBlockIdTypes, isFactoryBuiltBlockExtension, MediaImport, MediaPopover, CalloutEmojiPopover } from "./blocks"
import type { RuneImportImageFile, RuneImportImageUrl, RuneImportMediaFile, RuneImportMediaUrl } from "./blocks"
import { InlineMath, type InlineNodeViewFactory } from "./inlines"
import {
  RUNE_BLOCK_SPEC_METADATA,
  type BlockNodeViewFactory,
  type BlockSupportsSpec,
} from "./schema"
import {
  CellHandlePills,
  CellHandleDrag,
  TableExtendButtons,
} from "./blocks/Table/block"
// Import the concrete module, not the "./api" barrel: the barrel re-exports
// api/export/fromDoc, which imports createRuneKit from this file — going
// through the barrel would create an import cycle.
import { BlockCommands } from "./api/commands"
import { BlockId } from "./extensions/block-id"
import {
  BlockTextColor,
  BlockBackgroundColor,
  TextStyleWithColorAttrs,
  TextColor,
  BackgroundColor,
} from "./extensions/color"
import { SuggestionMenus, slashMatcher, wikiLinkMatcher } from "./extensions/suggestion-menus"
import { SideMenu } from "./extensions/side-menu"
import { BlockDrag } from "./extensions/block-drag"
import { BlockResize } from "./extensions/resize"
import { BlockSelection } from "./extensions/block-selection"
import { Clipboard, type ClipboardOptions } from "./extensions/clipboard"
import { ListNumbering } from "./extensions/list-numbering"
import { ListNormalization } from "./extensions/list-normalization"
import { CaretComfort } from "./extensions/caret-comfort"
import { Indent } from "./extensions/indent"
import { EmptyBlockBackspace } from "./extensions/empty-block-backspace"
import { ToggleBodyPlugin } from "./blocks/Toggle/plugin"
import { Placeholder } from "./extensions/placeholder"
import { TailClick } from "./extensions/tail-click"
import { WikiLink, type WikiLinkOptions } from "./extensions/wiki-link"
import { InternalRef, type InternalRefOptions } from "./extensions/internal-ref"
import { GestureStatePlugin } from "./extensions/shared"
import type { AnyExtension } from "@tiptap/core"
import type { TriggerConfig } from "./extensions/suggestion-menus"
import type { PlaceholderConfig } from "./extensions/placeholder/types"
import {
  EntityRefs,
  addMarkToAllowedInlineSelection,
} from "./extensions/entity-refs"

/**
 * A first-class plugin that extends the Rune editor with additional
 * block types and/or support extensions. Plugin blocks MUST be created
 * via `createBlockSpec` — raw `Node.create(...)` extensions are rejected
 * at composition time. Support extensions are arbitrary Tiptap extensions
 * (marks, plugins, etc.) that the plugin needs.
 */
export interface RunePlugin {
  /** Unique identifier for this plugin. */
  id: string
  /** Block extensions created via `createBlockSpec`. */
  blockExtensions?: AnyExtension[]
  /** Non-block Tiptap extensions (marks, plugins, commands, etc.). */
  extensions?: AnyExtension[]
  /** Plugin ordering hints (reserved for future use). */
  runsBefore?: string[]
  /** Plugin ordering hints (reserved for future use). */
  runsAfter?: string[]
}

export interface CreateRuneKitOptions {
  /**
   * Override the set of node types whose `id` attribute the BlockId
   * plugin scans and fills. Defaults to the rune-native blocks
   * (paragraph, heading, divider). Extend if you register custom
   * blocks via createBlockSpec.
   */
  blockIdTypes?: string[]
  /**
   * false → omit SuggestionMenus (consumer registers their own).
   * TriggerConfig[] → custom trigger set replacing the defaults.
   * undefined → default triggers: '/', ':', '[['.
   */
  suggestionMenus?: false | TriggerConfig[]
  /**
   * Placeholder strings shown on empty editor blocks. @ocai/rune-react's
   * <RuneEditor> ships English defaults and forwards them here.
   */
  placeholders?: PlaceholderConfig
  /**
   * Configure the default WikiLink mark for host click routing and raw-target
   * normalization.
   */
  wikiLink?: Partial<WikiLinkOptions>
  /** Configure the typed internal reference mark used by page and block refs. */
  internalRef?: Partial<InternalRefOptions>
  /**
   * Override the placeholder text for empty (expanded) toggle bodies.
   * Default: "Empty toggle. Click to add a block."
   */
  toggleEmptyPlaceholder?: string
  /**
   * Override the always-on hint rendered inside every empty toggle
   * title. Unlike the generic `placeholders` (focus/selection gated),
   * this is painted on every empty toggle title regardless of caret
   * position. Default: "Toggle".
   */
  toggleTitlePlaceholder?: string
  /**
   * Override math NodeViews. Core defaults stay headless and KaTeX-free;
   * a React-side seam is the only way to inject KaTeX rendering without
   * pulling DOM/CSS into core.
   */
  mathNodeViews?: {
    inlineMath?: InlineNodeViewFactory
    equationBlock?: BlockNodeViewFactory
  }
  /**
   * Override block-level NodeViews. Mirrors `mathNodeViews` for any block
   * whose live render needs React (subscribing to editor events, etc.).
   * Core stays headless; @ocai/rune-react injects React NodeViews via
   * `useRuneEditor`.
   */
  blockNodeViews?: {
    tableOfContents?: BlockNodeViewFactory
    audio?: BlockNodeViewFactory
  }
  /**
   * First-class plugins that extend the editor with additional blocks
   * and/or support extensions. Plugin blocks must be created via
   * `createBlockSpec`; raw `Node.create(...)` extensions are rejected.
   */
  plugins?: RunePlugin[]
  /** Configure Rune's core clipboard plugin. */
  clipboard?: ClipboardOptions
  /** Host-owned media import hook for File inputs. */
  importMediaFile?: RuneImportMediaFile
  /** Host-owned media import hook for URL inputs. */
  importMediaUrl?: RuneImportMediaUrl
  /**
   * Host-owned image import hook for File inputs. Used by programmatic
   * commands in PR2; picker/drop/paste entry points are wired in later PRs.
   */
  importImageFile?: RuneImportImageFile
  /**
   * Host-owned image import hook for URL inputs. If omitted, callers can
   * still use writeRawImageUrl for the generic web-editor fallback.
   */
  importImageUrl?: RuneImportImageUrl
}

// Suppress slash menu inside code-like blocks (codeBlock today, any future
// block declaring `meta.code: true`). `meta.code` is propagated to PM's
// NodeSpec.code in createBlockSpec, so we just walk ancestors of the trigger
// position and reject if any has `type.spec.code === true`. Without this the
// suggestion plugin happily fires on `/` typed inside a <pre><code>, which
// is wrong — code blocks should treat `/` as a literal character.
const denySlashInsideCode: NonNullable<TriggerConfig["allow"]> = ({ state, range }) => {
  const $pos = state.doc.resolve(range.from)
  for (let d = $pos.depth; d >= 0; d--) {
    if ($pos.node(d).type.spec.code) return false
  }
  return true
}

const denySlashInsideTable: NonNullable<TriggerConfig["allow"]> = ({ state, range }) => {
  const $pos = state.doc.resolve(range.from)
  for (let d = $pos.depth; d >= 0; d--) {
    const name = $pos.node(d).type.name
    if (name === "tableCell" || name === "tableHeader") return false
  }
  return true
}

const DEFAULT_TRIGGERS: TriggerConfig[] = [
  {
    char: "/",
    placeholder: "Type to search",
    // Notion-model matching (slashMatcher): the prefix gate (block start /
    // whitespace before the `/`) is evaluated on the whole textblock, and
    // an open session is sticky to its anchor — spaces and further slashes
    // typed after the trigger are query text, never terminators or
    // re-anchors. Full reference behavior in
    // internal design notes.
    // allowSpaces stays set for @tiptap/suggestion's plugin-level dismissal
    // bookkeeping (`shouldKeepDismissed` keys off it); the match itself is
    // entirely the custom matcher's.
    allowSpaces: true,
    matcher: slashMatcher,
    // Sessions start on the `/` KEYSTROKE only — caret placed into a dead
    // `/query` run (click, arrows, fresh doc load) never reopens the menu.
    requireTypedTrigger: true,
    allow: (ctx) => denySlashInsideCode(ctx) && denySlashInsideTable(ctx),
  },
  {
    char: ":",
    // A lone ":" stays literal — the emoji picker only opens once the
    // user has typed at least one character after it (`:smi` → open).
    // The gate is re-evaluated on every transaction, so deleting the
    // query back to ":" and then retyping reopens the picker.
    shouldShow: ({ query }) => query.length > 0,
  },
  { char: "[[", matcher: wikiLinkMatcher },
]

const RuneLink = Link.extend<LinkOptions>({
  priority: 50,
  excludes: "wikiLink internalRef",

  addCommands() {
    const parentCommands = this.parent?.()

    return {
      ...parentCommands,
      setLink:
        (attributes) =>
        (props) => {
          const { tr, state } = props
          const { href } = attributes

          if (
            !this.options.isAllowedUri(href, {
              defaultValidate: (url) => !!isAllowedUri(url, this.options.protocols),
              protocols: this.options.protocols,
              defaultProtocol: this.options.defaultProtocol,
            })
          ) {
            return false
          }

          if (tr.selection.empty) {
            return parentCommands?.setLink?.(attributes)(props) ?? false
          }

          const markType = state.schema.marks[this.name]
          if (!markType) return false

          const applied = addMarkToAllowedInlineSelection(tr, markType, attributes)
          if (!applied) return false

          tr.setMeta("preventAutolink", true)
          return true
        },
    }
  },
})

interface StaticBlockSpecMetadata {
  supports?: BlockSupportsSpec
}

function staticBlockSupports(ext: AnyExtension): BlockSupportsSpec | undefined {
  const direct = (ext as unknown as {
    [RUNE_BLOCK_SPEC_METADATA]?: StaticBlockSpecMetadata
  })[RUNE_BLOCK_SPEC_METADATA]
  if (direct) return direct.supports
  const config = (ext as unknown as Record<string, unknown>).config as Record<string, unknown> | undefined
  return (config?.[RUNE_BLOCK_SPEC_METADATA] as StaticBlockSpecMetadata | undefined)?.supports
}

const TABLE_COLOR_TYPES = ["tableCell", "tableHeader"] as const

export function deriveBlockColorTypes(extensions: readonly AnyExtension[]) {
  const types: string[] = []
  for (const ext of extensions) {
    const supports = staticBlockSupports(ext)
    if (supports?.textColor || supports?.backgroundColor) types.push(ext.name)
  }
  return [...types, ...TABLE_COLOR_TYPES]
}

function configureBodyBlocks(options: CreateRuneKitOptions): AnyExtension[] {
  const overrides: Record<string, Record<string, unknown>> = {
    equationBlock: { nodeView: options.mathNodeViews?.equationBlock },
    audio: { nodeView: options.blockNodeViews?.audio },
    tableOfContents: { nodeView: options.blockNodeViews?.tableOfContents },
  }
  return RUNE_BODY_BLOCKS.map((ext) => {
    const cfg = overrides[ext.name]
    return cfg ? ext.configure(cfg) : ext
  })
}

/** Node types that get block-level `textColor` / `backgroundColor` attrs.
 *  Derived from each block spec's `supports` flags; table cell nodes are
 *  appended because they share the same color DOM contract but are not
 *  factory-built page-body blocks. */
export const BLOCK_COLOR_TYPES = deriveBlockColorTypes(RUNE_BODY_BLOCKS)

function validateRunePlugins(plugins: readonly RunePlugin[] = []): void {
  const seen = new Set<string>()
  for (const plugin of plugins) {
    if (!plugin.id) throw new Error("Rune plugin id is required")
    if (seen.has(plugin.id)) {
      throw new Error(`Duplicate Rune plugin id: ${plugin.id}`)
    }
    seen.add(plugin.id)
  }
}

function pluginBlockExtensions(plugins: readonly RunePlugin[] = []): AnyExtension[] {
  return plugins.flatMap((plugin) => {
    for (const ext of plugin.blockExtensions ?? []) {
      if (!isFactoryBuiltBlockExtension(ext)) {
        throw new Error(
          `Rune plugin ${plugin.id} blockExtensions must be created with createBlockSpec: ${ext.name}`,
        )
      }
    }
    return plugin.blockExtensions ?? []
  })
}

function pluginSupportExtensions(plugins: readonly RunePlugin[] = []): AnyExtension[] {
  return plugins.flatMap((plugin) => plugin.extensions ?? [])
}

// createRuneKit assembles the v0.2 extension set: StarterKit minus the
// nested-list and default paragraph/heading, rune's own Paragraph and
// Heading (built via createBlockSpec), BlockId, Divider, and
// SuggestionMenus with default triggers. Returned as a plain array so
// consumers can `.concat(...)` their own extensions before passing into
// Tiptap's Editor / useEditor.
//
// What's intentionally OFF here vs StarterKit defaults:
//   - paragraph / heading: replaced by factory-built Paragraph / Heading
//   - bulletList / orderedList / listItem: lists land later as flat
//     blocks with depth attr; nested list schema would conflict
//   - underline / link: StarterKit 3.22 bundles both, but we disable the
//     bundled copies and re-register our own below — Link is wrapped in
//     `.extend({ priority })` for the #88 mark-nesting fix, and Tiptap
//     dedupes extensions by name and keeps the first registration, so
//     leaving StarterKit's copy on would silently drop our priority
//     override. Schema extensions belong in core regardless of whether
//     their UI lives in @ocai/rune-react — Bold/Italic/Strike/Code already
//     ship via StarterKit here for the same reason. UI-only consumers
//     can skip the toolbar; the marks just sit unused in the schema.
//
// SuggestionMenus default triggers: '/' (slash), ':' (emoji), '[[' (wiki-link).
// '@' (mention) is opt-in only — pass { suggestionMenus: [...] } to override.
// Pass { suggestionMenus: false } to skip entirely and register your own.
export function createRuneKit(options: CreateRuneKitOptions = {}): AnyExtension[] {
  validateRunePlugins(options.plugins)
  const pluginBlocks = pluginBlockExtensions(options.plugins)
  const pluginExtensions = pluginSupportExtensions(options.plugins)
  const bodyBlocks = configureBodyBlocks(options)
  const blockIdTypes = options.blockIdTypes
    ?? deriveBlockIdTypes([...RUNE_BODY_BLOCKS, ...pluginBlocks])
  const extensions: AnyExtension[] = [
    StarterKit.configure({
      paragraph: false,
      heading: false,
      bulletList: false,
      orderedList: false,
      listItem: false,
      // v0.2 ships paragraph + heading only. Leaving StarterKit's
      // blockquote / codeBlock enabled means they're still in the
      // schema, and because our own paragraph/heading are registered
      // AFTER StarterKit, these end up earlier in the block type list.
      // That bit us in two places:
      //   1. TrailingNode (also from StarterKit) uses
      //      `doc.contentMatch.defaultType` to pick what to insert at
      //      the end of the doc on every transaction — which resolved
      //      to `blockquote`, appending a phantom empty <blockquote>
      //      after the last paragraph on the first click.
      //   2. PM's `splitBlock` (Enter at end of last paragraph) falls
      //      through to the same default-type, producing a stray
      //      <pre><code> instead of a new <p>.
      // Dropping them until we actually add quote/code-block blocks.
      blockquote: false,
      codeBlock: false,
      trailingNode: false,
      // StarterKit registers Tiptap's generic HorizontalRule by default;
      // Rune registers its own factory-built Divider block below.
      horizontalRule: false,
      // StarterKit also bundles Underline and Link as of 3.22. We re-
      // register both below: Underline is unchanged but kept explicit
      // for clarity, and Link is wrapped in `.extend({ priority })` to
      // flip mark nesting (#88) — that override is silently dropped if
      // StarterKit's copy is registered first (Tiptap dedupes by name
      // and keeps the first). Disable the bundled ones so ours win.
      //
      // Code gets the same treatment: StarterKit's Code is `excludes: "_"`
      // (excludes ALL marks) + default priority, so it can neither carry an
      // inline color nor nest inside a color span. We re-register it below
      // with a low priority (inner nesting, like Link) and a narrowed
      // `excludes` so the code mark can coexist with textStyle/colour.
      underline: false,
      link: false,
      code: false,
    }),
    ...bodyBlocks,
    ...pluginBlocks,
    ...pluginExtensions,
    MediaImport.configure({
      importMediaFile: options.importMediaFile,
      importMediaUrl: options.importMediaUrl,
      importImageFile: options.importImageFile,
      importImageUrl: options.importImageUrl,
    }),
    MediaPopover,
    CalloutEmojiPopover,
    InlineMath.configure({ nodeView: options.mathNodeViews?.inlineMath }),
    BlockCommands,
    BlockId.configure({ types: blockIdTypes }),
    Indent,
    EmptyBlockBackspace,
    ToggleBodyPlugin.configure({
      emptyPlaceholder: options.toggleEmptyPlaceholder,
      titlePlaceholder: options.toggleTitlePlaceholder,
    }),
  ]

  const allBodyBlocks = [...RUNE_BODY_BLOCKS, ...pluginBlocks]
  extensions.push(
    BlockTextColor.configure({ types: deriveBlockColorTypes(allBodyBlocks) }),
    BlockBackgroundColor.configure({ types: deriveBlockColorTypes(allBodyBlocks) }),
  )

  // Inline color (M4b). Order matters: the wrapper registers the
  // textStyle mark; TextColor + BackgroundColor hang attrs on it via
  // addGlobalAttributes — registering them before the mark exists is a
  // schema error. StarterKit does NOT include TextStyle in our v0.2
  // config (verified Apr 2026: not in @tiptap/starter-kit deps, not
  // exported by @tiptap/extensions), so this wrapper is the sole source
  // of the textStyle mark.
  extensions.push(TextStyleWithColorAttrs, TextColor, BackgroundColor)

  // Inline marks for the formatting toolbar (M4 toolbar UI). StarterKit
  // bundles Bold/Italic/Strike/Code/Underline/Link — we keep its
  // Bold/Italic/Strike as-is, re-register Code with a priority/excludes
  // override (below), and disable underline/link/code in the StarterKit
  // config above, then register our own copies here. Link is
  // configured for the default safe-href set (http/https/mailto/tel)
  // and openOnClick:false because the LinkHoverCard / consumer app
  // handles navigation, not PM.
  //
  // Priority 50 (vs Tiptap's default 1000) drops Link below TextStyle
  // (priority 101). Tiptap sorts higher priority first → outer in DOM,
  // so by going lower, Link renders INNER and the produced DOM is
  // `<span data-text-color="..."><a>...</a></span>`. Combined with
  // `color: inherit` on `.rune-editor a` (typography.css), the user's
  // inline text-color flows through to the link glyph + underline. See
  // issue #88 — without this, link color is fixed by the `<a>` rule and
  // any text-color span sits inside it, never reaching the anchor.
  extensions.push(
    EntityRefs,
    Underline,
    // Code, re-registered (StarterKit's copy disabled above). Priority 50
    // (below textStyle's 101) makes it render INNER of an inline color span
    // — `<span data-text-color="…"><code>…</code></span>` — mirroring the
    // Link #88 fix, so typography.css can flow the chosen colour through the
    // code mark. `excludes` is narrowed from Tiptap's blanket "_" to the
    // navigation/reference marks only: a verbatim code span still cannot
    // also be a link/wikiLink/internalRef (preserves existing behaviour +
    // tests), but it CAN now carry bold/italic/strike/underline and an
    // inline colour, matching Notion.
    Code.extend({ priority: 50, excludes: "link wikiLink internalRef" }),
    RuneLink.configure({
      openOnClick: false,
      autolink: true,
      defaultProtocol: "https",
    }),
    InternalRef.extend({ excludes: "link wikiLink" }).configure(options.internalRef),
    WikiLink.extend({ excludes: "link internalRef" }).configure(options.wikiLink),
  )

  extensions.push(GestureStatePlugin, BlockResize, SideMenu, BlockDrag)
  // CellHandleDrag consumes gestureKey (claims "cell-drag") so it must
  // come AFTER GestureStatePlugin in the extensions array.
  // CellHandlePills + TableExtendButtons stay grouped here for cohesion.
  extensions.push(CellHandlePills, CellHandleDrag, TableExtendButtons)
  extensions.push(BlockSelection)
  // Normalization must run before numbering: ListNormalization cleans
  // stale run-level attrs (e.g. `start` on a non-leader numberedList)
  // and ListNumbering re-renders from the post-normalization doc.
  extensions.push(ListNormalization)
  extensions.push(ListNumbering)
  extensions.push(Clipboard.configure(options.clipboard ?? {}))
  extensions.push(CaretComfort)
  extensions.push(TailClick)
  extensions.push(Placeholder.configure({ placeholders: options.placeholders }))

  if (options.suggestionMenus !== false) {
    extensions.push(
      SuggestionMenus.configure({
        triggers: options.suggestionMenus ?? DEFAULT_TRIGGERS,
      }),
    )
  }

  return extensions
}
