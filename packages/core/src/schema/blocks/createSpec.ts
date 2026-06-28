// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { Node, Extension } from "@tiptap/core"
import type { Editor, NodeViewRendererProps } from "@tiptap/core"
import { compileDeclarativeInputRules } from "./internal"
import type {
  DOMOutputSpec,
  Node as ProseMirrorNode,
  Schema,
  TagParseRule,
} from "@tiptap/pm/model"
import type { NodeView } from "@tiptap/pm/view"
import type { DefaultSuggestionItem } from "../../extensions/suggestion-menus"
import { createAtomNodeView } from "./atomNodeView"
import {
  isDeclarativeBlockExtension,
  type JsonValue,
  type RuneBlockActionFactory,
  type RuneBlockProjectionContext,
  type RuneBlockExtensionInput,
  type RuneBlockSchemaContextSpec,
  type RuneMarkdownBlockSerializer,
  type RuneSchemaContextPropMetadata,
  type RuneSchemaContextPropType,
} from "./types"

// HTML-attribute map for the attributes every rune block shares.
// Mirrors BlockNote's `BlockAttributes` map (pm-nodes/BlockContainer.ts)
// but applied per-node because our schema is flat — no wrapper.
export const BLOCK_ATTRIBUTES = {
  id: "data-id",
  depth: "data-depth",
} as const

// Per-block prop spec. Each prop becomes a Tiptap attribute on the node
// the factory generates. Keep parse/renderHTML optional — most props
// are plain data (level, listType, …) that don't need special HTML
// marshalling because they're carried as node attrs through the model.
export interface BlockPropSpec<T = unknown> {
  default: T
  parseHTML?: (el: HTMLElement) => T
  renderHTML?: (attrs: Record<string, unknown>) => Record<string, string>
}

export type BlockPropSchema = Record<string, BlockPropSpec>

/**
 * Side-menu / gutter integration. Absent → not draggable, no widget.
 * Flat schema needs no placement variants — tables and other
 * pick-your-battles cases get their own spec when they land.
 */
export interface BlockSideMenuSpec {
  draggable: boolean
}

export interface BlockSupportsSpec {
  textColor?: boolean
  backgroundColor?: boolean
  resize?: boolean
  mediaSource?: boolean
  fitToWidth?: boolean
  /** Block supports the `align` ("left" | "center" | "right") attr —
   *  surfaces the Alignment control on the media floating bar. */
  align?: boolean
}

/**
 * The live DOM an in-place attr application writes to.
 *
 * `root` is the NodeView's outer `.rune-block` element. `content` is its
 * `:scope > .rune-block-content` child, or `null` when renderDOM emitted
 * none (e.g. an empty-state media block).
 */
export interface RuneInPlaceAttrTarget {
  root: HTMLElement
  content: HTMLElement | null
}

/**
 * Declares one node attr the factory-injected atom NodeView absorbs
 * IN PLACE: when only declared attrs changed, `update()` mutates the
 * existing DOM via `applyToDOM` instead of rebuilding the view. In-place
 * absorption exists because chrome (e.g. the media floating bar) can be
 * portaled INSIDE the NodeView's DOM — a rebuild would unmount it
 * mid-interaction.
 *
 * `applyToDOM` may return `false` to signal "cannot apply in place"
 * (e.g. contentWidth when the view rendered no `.rune-block-content`);
 * the NodeView then rebuilds. Any other return absorbs the change.
 * DOM writes made before a later decline are discarded with the old DOM.
 *
 * Only consulted by the factory atom NodeView (`content: ""`, no custom
 * `nodeView`); a changed attr without a declared pair rebuilds the view,
 * keeping renderDOM output the source of truth.
 */
export interface RuneInPlaceAttr {
  attr: string
  applyToDOM: (target: RuneInPlaceAttrTarget, value: unknown) => boolean | void
}

export type BlockNodeViewSpec = NodeView

export type BlockNodeViewFactoryArgs = NodeViewRendererProps

export type BlockNodeViewFactory = (args: BlockNodeViewFactoryArgs) => BlockNodeViewSpec

export interface BlockMetaSpec {
  selectable?: boolean
  code?: boolean
  isolating?: boolean
  defining?: boolean
  hardBreakShortcut?: "shift+enter" | "enter" | "none"
  /**
   * The ProseMirror node-spec `marks` allow-list. Omit (the default) → the node
   * permits every registered mark. `""` → the node permits NO inline marks, so
   * bold/italic/color/link/etc. can never be applied or pasted into it. Use for
   * plain-text display nodes like the page title. rune-react's InlineToolbar
   * reads this off the schema and stays closed over a selection wholly inside a
   * marks-free block (a formatting toolbar with nothing to format is noise).
   */
  marks?: string
}

export type BlockSpecFromInput = (args: {
  schema: Schema
  input: { type: string; id?: string; depth?: number; [k: string]: unknown }
  defaults: {
    depth: number
    attrs?: Record<string, unknown>
    content?: ProseMirrorNode["content"]
    marks?: ProseMirrorNode["marks"]
    preserveContent?: boolean
  }
  /** Optional live editor reference. Present for runtime insertion paths
   *  (slash menu, `editor.commands.insertBlocks`). Absent in pure-schema
   *  contexts (unit tests, SSR doc construction). Blocks that need to
   *  measure the editor's content surface at insert time (e.g. Table
   *  scaling default column widths to fit the current editor column)
   *  read it here; everything else should ignore it. */
  editor?: Editor
}) => ProseMirrorNode | null

/**
 * Indent mode declaration for keyboard Tab/Shift-Tab handling.
 *
 * - `numeric`: simple cap. Tab succeeds while `depth < maxDepth`. Used by
 *   blocks that should NOT indent (`maxDepth: 0`, e.g. CodeBlock, Divider,
 *   Table).
 * - `structural`: no numeric cap. Tab succeeds only when the block has a
 *   same-kind same-depth predecessor (Notion list behavior). Used by
 *   bullet / numbered / task lists.
 * - `follow-prev`: cap = (immediately preceding top-level block's
 *   `depth`) + 1. If there is no preceding block, the cap is 0. The +1
 *   accounts for rune's list-marker layout: list[d=N] text content sits
 *   at column (N+1)*step, so a paragraph aligned with that content needs
 *   depth N+1. See spec 2026-05-19-issue-254.
 *
 * When omitted from a block spec, the consumer treats it as
 * `{ mode: "follow-prev" }`. Spec §4.
 */
export type IndentConfig =
  | { mode: "numeric"; maxDepth: number }
  | { mode: "structural" }
  | { mode: "follow-prev" }

/**
 * The indent config a block is treated as having when its spec omits
 * `indent`. Single source of truth for consumers (`indentBlock`, the
 * `Indent` keyboard extension) — see `IndentConfig` JSDoc, Spec §4.
 */
export const DEFAULT_INDENT: IndentConfig = { mode: "follow-prev" }

export interface BlockSpecConfig {
  /** Tiptap node name AND the block's public `type` identifier. */
  type: string
  /** PM content expression, e.g. `"inline*"` or `""` for atoms. */
  content: string
  /** Per-block attributes beyond the shared `id` / `depth`. */
  props?: BlockPropSchema
  /**
   * Body block visual placement hint for host/editor CSS.
   * "content" is the default. "full" injects data-bleed="full" into
   * renderDOM HTMLAttributes so CSS can opt the block's visual content
   * into full-width treatment. This does not change the side-menu model
   * and is not passed to clipboardRenderDOM.
   */
  bleed?: "content" | "full"
  /** Indent mode declaration. Spec §4. Default when omitted: `follow-prev`. */
  indent?: IndentConfig
  /** ParseRules in Tiptap's format. `getAttrs` / `attrs` are merged
   *  with the shared-attribute parsers the factory injects. */
  parseDOM: TagParseRule[]
  /** Serializer. Receives the Tiptap node and the merged HTMLAttributes
   *  object (already containing `data-id` / `data-depth` when non-empty).
   *  Atom blocks (`content: ""`) must render an outer `.rune-block`
   *  element; the factory-injected NodeView uses it as the side-menu
   *  host ancestor. */
  renderDOM: (args: { node: ProseMirrorNode; HTMLAttributes: Record<string, any> }) => DOMOutputSpec
  /**
   * DOM output used when serializing this block to the clipboard's
   * `text/html` MIME. Should emit ONLY the semantic node, no editor
   * chrome (no `.rune-block` / `.rune-block-content` wrappers, no
   * `data-id` / `data-depth` attrs).
   *
   * Falls back to `renderDOM` if not declared. Marks are NOT covered
   * by this slot — they always serialize via their schema-default
   * `toDOM`, which is already chrome-free.
   *
   * Example:
   *   renderDOM: ({ node, HTMLAttributes }) => [
   *     "div", { ...HTMLAttributes, class: "rune-block" },
   *     ["div", { class: "rune-block-content" },
   *      [`h${node.attrs.level}`, {}, 0]],
   *   ],
   *   clipboardRenderDOM: ({ node }) => [`h${node.attrs.level}`, {}, 0],
   */
  clipboardRenderDOM?: (args: { node: ProseMirrorNode }) => DOMOutputSpec
  /** Plain-text projection used by Tiptap clipboard text serializers. */
  renderText?: (args: { node: ProseMirrorNode }) => string
  /**
   * Project this block to its public RuneBlock JSON representation.
   * Used by the public read API (`getDocument` / `findBlocks` /
   * `getBlockById`). Each block owns its own projection; the API layer
   * dispatches via storage.
   *
   * Absent -> block is invisible to the public read API. (Useful for
   * structural-only nodes; built-in body blocks should always declare it.)
   *
   * Caller guarantees `node.type.name === config.type`. Implementations
   * should read from `node.attrs` / `node.textContent` / children - not
   * from anywhere else.
   *
   * A container block (one whose content holds other registered body
   * blocks) uses the `ctx` argument to recurse: `ctx.projectChild(child)`
   * returns that child's own RuneBlock projection (the same value
   * `getDocument` would produce for it top-level), or `null` if the child
   * declares no projection. Flat blocks ignore `ctx`. The argument is
   * optional in the signature (direct unit-test callers may pass only the
   * node) but the production read path always supplies it.
   *
   * Example (a structural wrapper projecting its children):
   *   toRuneBlock: (node, ctx) => {
   *     const children: unknown[] = []
   *     node.forEach((child) => {
   *       const projected = ctx?.projectChild(child)
   *       if (projected) children.push(projected)
   *     })
   *     return { type: node.type.name, id: node.attrs.id, children }
   *   }
   */
  toRuneBlock?: (node: ProseMirrorNode, ctx?: RuneBlockProjectionContext) => unknown
  /**
   * Construct a PM node from a `RuneBlockInput`-shaped descriptor.
   * Used by the public write API (`insertBlocks` / `updateBlock`).
   *
   * Each block owns its content shape — the API layer does NOT special-case
   * heading.level, paragraph.text, etc. Return `null` to reject the input
   * (e.g. heading missing level), in which case the calling command
   * returns `false`.
   *
   * `defaults.depth` is the depth from `InsertBlocksOptions.depth` (or 0).
   * Other defaults (id) live on the input; the implementation passes
   * `input.id ?? null` so BlockId's appendTransaction fills in.
   *
   * Update commands may also pass the current node's attrs/content/marks
   * through this object. Blocks must use that context to preserve existing
   * inline marks and block-level attrs for attr-only updates.
   */
  fromInput?: BlockSpecFromInput
  /**
   * Opt-in live editor NodeView. renderDOM remains required and is still
   * the source for SSR, clipboard fallback, and getHTML serialization.
   */
  nodeView?: BlockNodeViewFactory
  /** Block-owned slash-menu items. Called once per render pass from
   *  getDefaultSlashMenuItems; closure captures the editor. */
  slashMenuItems?: (editor: Editor) => DefaultSuggestionItem[]
  /** Gutter/side-menu integration. */
  sideMenu?: BlockSideMenuSpec
  /**
   * A block marked `agentHidden` is excluded from rune-ai read-tool outputs
   * (the AI can't target it) — e.g. a structural page title.
   */
  agentHidden?: boolean
  /** Block-owned capability flags consumed by schema/UI integration. */
  supports?: BlockSupportsSpec
  /** Attr changes the factory atom NodeView absorbs without a rebuild.
   *  See `RuneInPlaceAttr` for the full contract. */
  inPlaceAttrs?: ReadonlyArray<RuneInPlaceAttr>
  /**
   * CSS selector (scoped under the block's root element) naming the
   * block's resizable media element(s). Required alongside
   * `supports.resize` — resize handles mount only when the selector
   * matches the rendered DOM, so empty-state renders (no media yet)
   * naturally get no handles. The resize gesture also uses it to locate
   * the media element whose pointer-events it suppresses mid-drag.
   */
  resizeMediaSelector?: string
  /**
   * Resolve the document range that should be dragged when this block is
   * the drag source. Default (when omitted) is the single block:
   * `{ from: pos, to: pos + node.nodeSize }`. Toggle uses this to widen
   * the range to include its depth+1 body.
   *
   * `editor` is supplied by the production drag path so the hook can read
   * spec metadata (e.g. list blocks deriving "structural indent" sibling
   * classification via `isStructuralIndentType`). It is optional because
   * direct unit-test callers may omit it.
   */
  dragSourceRange?: (args: {
    node: ProseMirrorNode
    pos: number
    doc: ProseMirrorNode
    editor?: Editor
  }) => { from: number; to: number }
  /** PM NodeSpec flags and block-level editing hints. */
  meta?: BlockMetaSpec
  /**
   * Per-block Markdown serializer. When `exportMarkdown` encounters this
   * block type, it delegates to `toMarkdown` instead of the central
   * switch. Return `null` to skip the block entirely.
   */
  toMarkdown?: RuneMarkdownBlockSerializer
  /** Per-block declarative extensions (shortcuts + input rules). The factory
   *  compiles these into Tiptap Extensions registered via `addExtensions()`,
   *  so kit assembly does NOT need to know about them. */
  extensions?: RuneBlockExtensionInput[]
  /**
   * Block-owned action descriptors. The React dropdown collects these from
   * block spec metadata and renders them as menu items. The factory receives
   * `{ editor }` and returns an array of `RuneBlockAction` descriptors.
   *
   * `icon` is a string token — the React layer maps tokens to Lucide
   * components. Unknown tokens render without an icon.
   */
  blockActions?: RuneBlockActionFactory
  /**
   * Optional JSON-safe metadata describing this block to agent-facing
   * tools. Read by `getRuneSchemaContext(editor)` and projected into the
   * public agent context. Pure data — must not contain functions, DOM
   * nodes, or class instances. The factory sanitizes this value before
   * storing it on metadata so plugin authors cannot bypass the JSON-safe
   * contract.
   */
  schemaContext?: RuneBlockSchemaContextSpec
}

export const RUNE_BLOCK_SPEC_METADATA = "__runeBlockSpecMetadata" as const

// JSON-safety helpers used to sanitize schemaContext before it crosses
// the boundary into BlockSpecMetadata. Kept file-local; the public
// projection helper in api/schemaContext.ts owns its own helpers for
// values that come from outside the factory (mark attr defaults, etc).

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null) return false
  if (Array.isArray(v)) return false
  // Reject DOM nodes (have nodeType) and class instances (proto !== Object.prototype).
  if (typeof (v as { nodeType?: unknown }).nodeType === "number") return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

function isJsonSafeValue(v: unknown, seen: WeakSet<object> = new WeakSet()): boolean {
  if (v === null) return true
  const t = typeof v
  if (t === "string" || t === "boolean") return true
  // JSON.stringify(NaN | Infinity | -Infinity) → "null", which would corrupt
  // the round-trip equality promise. Treat non-finite numbers as unsafe.
  if (t === "number") return Number.isFinite(v)
  if (t === "function" || t === "symbol" || t === "undefined" || t === "bigint") return false
  if (Array.isArray(v)) {
    // Path-based cycle detection: `seen` tracks only ancestors on the current
    // recursion path, not finished siblings. A shared-but-acyclic reference
    // (DAG) reached twice is fine; only a back-edge into an ancestor is a cycle.
    if (seen.has(v)) return false
    seen.add(v)
    const ok = v.every((entry) => isJsonSafeValue(entry, seen))
    seen.delete(v)
    return ok
  }
  if (!isPlainObject(v)) return false
  if (seen.has(v)) return false
  seen.add(v)
  const ok = Object.values(v).every((entry) => isJsonSafeValue(entry, seen))
  seen.delete(v)
  return ok
}

function inferPropType(v: unknown): RuneSchemaContextPropType {
  if (v === null) return "null"
  const t = typeof v
  if (t === "string") return "string"
  if (t === "number") return "number"
  if (t === "boolean") return "boolean"
  if (Array.isArray(v)) return "array"
  if (isPlainObject(v)) return "object"
  return "unknown"
}

function projectPropsForSchemaContext(
  props: BlockPropSchema | undefined,
  overrides: RuneBlockSchemaContextSpec["props"] | undefined,
): Record<string, RuneSchemaContextPropMetadata> | undefined {
  if (!props) return undefined
  const out: Record<string, RuneSchemaContextPropMetadata> = {}
  for (const [key, spec] of Object.entries(props)) {
    const override = overrides?.[key]
    const inferred = inferPropType(spec.default)
    const entry: RuneSchemaContextPropMetadata = {
      type: override?.type ?? inferred,
    }
    if (isJsonSafeValue(spec.default)) {
      entry.default = spec.default as JsonValue
    }
    if (override?.description) entry.description = override.description
    if (override?.values) {
      const safeValues = override.values.filter((v) => isJsonSafeValue(v))
      if (safeValues.length > 0) entry.values = safeValues as JsonValue[]
    }
    out[key] = entry
  }
  return out
}

function sanitizeJson(
  v: unknown,
  seen: WeakSet<object> = new WeakSet(),
): JsonValue | undefined {
  if (v === null) return null
  const t = typeof v
  if (t === "string" || t === "boolean") return v as JsonValue
  if (t === "number") return Number.isFinite(v) ? (v as JsonValue) : undefined
  if (t === "function" || t === "symbol" || t === "undefined" || t === "bigint") return undefined
  if (Array.isArray(v)) {
    // Path-based cycle detection (see isJsonSafeValue): remove the node from
    // `seen` after walking its subtree so a shared-but-acyclic reference
    // reached again in a sibling position is preserved, not dropped.
    if (seen.has(v)) return undefined
    seen.add(v)
    const out: JsonValue[] = []
    for (const entry of v) {
      const cleaned = sanitizeJson(entry, seen)
      if (cleaned !== undefined) out.push(cleaned)
    }
    seen.delete(v)
    return out
  }
  if (!isPlainObject(v)) return undefined
  if (seen.has(v)) return undefined
  seen.add(v)
  const out: { [k: string]: JsonValue } = {}
  for (const [k, val] of Object.entries(v)) {
    const cleaned = sanitizeJson(val, seen)
    if (cleaned !== undefined) out[k] = cleaned
  }
  seen.delete(v)
  return out
}

function sanitizeSchemaContext(
  ctx: RuneBlockSchemaContextSpec | undefined,
): RuneBlockSchemaContextSpec | undefined {
  if (ctx === undefined) return undefined
  const cleaned = sanitizeJson(ctx)
  if (cleaned === undefined || typeof cleaned !== "object" || Array.isArray(cleaned)) {
    return undefined
  }
  return cleaned as unknown as RuneBlockSchemaContextSpec
}

/**
 * createBlockSpec is rune's equivalent of BlockNote's createBlockSpec.
 * Each rune-native block is declared via this factory instead of a raw
 * `Node.create(...)` call, so the shared attributes (id, depth) and
 * Tiptap boilerplate (group, defining, content) live in one place.
 *
 * Per-block input rules and keyboard shortcuts are declared via the
 * `extensions` field — the factory compiles each entry into a Tiptap
 * Extension that the extension manager picks up via `addExtensions()`,
 * so `kit.ts` does NOT need to register them.
 *
 * @example
 * ```ts
 * createBlockSpec({
 *   type: "heading",
 *   content: "inline*",
 *   props: {
 *     level: { default: 2, parseHTML: () => 2, renderHTML: () => ({}) },
 *   },
 *   parseDOM: [{ tag: "h2" }, { tag: "h3" }, { tag: "h4" }],
 *   renderDOM: ({ node, HTMLAttributes }) =>
 *     [`h${node.attrs.level}`, HTMLAttributes, 0],
 *   extensions: [
 *     createBlockExtension({
 *       key: "heading-shortcuts",
 *       keyboardShortcuts: {
 *         "Mod-Alt-1": ({ editor }) =>
 *           editor.commands.setNode("heading", { level: 2 }),
 *       },
 *       inputRules: [
 *         { find: /^#\s$/, replace: () => ({ type: "heading", props: { level: 2 }}) },
 *       ],
 *     }),
 *   ],
 * })
 * ```
 */
export function createBlockSpec(config: BlockSpecConfig) {
  // Registration-time contract checks. Misdeclarations would otherwise
  // surface far from the cause: a typo'd in-place attr never matches, so
  // every change silently rebuilds the NodeView (unmounting portaled
  // chrome mid-interaction); a resize flag without a media selector
  // silently never mounts handles.
  if (config.inPlaceAttrs) {
    const known = new Set([...Object.keys(config.props ?? {}), "id", "depth"])
    for (const pair of config.inPlaceAttrs) {
      if (!known.has(pair.attr)) {
        throw new Error(
          `[rune] block "${config.type}": inPlaceAttrs declares "${pair.attr}", ` +
            `which is not a declared prop or the shared id/depth attrs`,
        )
      }
    }
  }
  if (config.supports?.resize === true && !config.resizeMediaSelector) {
    throw new Error(
      `[rune] block "${config.type}": supports.resize requires resizeMediaSelector — ` +
        `resize handles mount only where the selector matches the rendered media element`,
    )
  }

  const metadata = {
    type: config.type,
    content: config.content,
    props: projectPropsForSchemaContext(config.props, config.schemaContext?.props),
    schemaContext: sanitizeSchemaContext(config.schemaContext),
    slashMenuItems: config.slashMenuItems,
    sideMenu: config.sideMenu,
    agentHidden: config.agentHidden,
    supports: config.supports,
    inPlaceAttrs: config.inPlaceAttrs,
    resizeMediaSelector: config.resizeMediaSelector,
    renderDOM: config.renderDOM,
    clipboardRenderDOM: config.clipboardRenderDOM,
    hardBreakShortcut: config.meta?.hardBreakShortcut,
    toRuneBlock: config.toRuneBlock,
    fromInput: config.fromInput,
    indent: config.indent,
    dragSourceRange: config.dragSourceRange,
    toMarkdown: config.toMarkdown,
    blockActions: config.blockActions,
  }

  const extension = Node.create({
    name: config.type,
    group: "block",
    content: config.content,
    defining: config.meta?.defining ?? true,
    selectable: config.meta?.selectable,
    code: config.meta?.code,
    isolating: config.meta?.isolating,
    // Omit → PM default (all marks allowed). `""` → no marks (plain-text node).
    marks: config.meta?.marks,

    addOptions() {
      return {
        nodeView: undefined as BlockNodeViewFactory | undefined,
      }
    },

    addStorage() {
      return {
        __runeBlockSpec: true as const,
        ...metadata,
      }
    },

    addAttributes() {
      const attrs: Record<string, unknown> = {
        // id is populated by the BlockId extension's appendTransaction.
        // `keepOnSplit: false` so splitting a block via Enter produces a
        // fresh-id child, which BlockId then fills on the next tick.
        id: {
          default: null,
          keepOnSplit: false,
          parseHTML: (el: HTMLElement) => el.getAttribute(BLOCK_ATTRIBUTES.id),
          renderHTML: (a: Record<string, unknown>) =>
            a.id ? { [BLOCK_ATTRIBUTES.id]: a.id as string } : {},
        },
        depth: {
          default: 0,
          parseHTML: (el: HTMLElement) => {
            // Prefer the persisted `data-depth`. Fall back to the
            // paste-depth marker that `transformPastedHTML` flatteners
            // (lists, toggles, future custom flatteners) stamp on
            // top-level block elements that originated from a nested
            // source structure. The fallback makes "any block becomes
            // a valid nested child on paste" a universal contract —
            // each block does NOT have to opt in by writing its own
            // parseDOM depth probe.
            const raw =
              el.getAttribute(BLOCK_ATTRIBUTES.depth) ??
              el.getAttribute("data-rune-paste-depth")
            const n = raw == null ? 0 : Number.parseInt(raw, 10)
            return Number.isFinite(n) && n >= 0 ? n : 0
          },
          renderHTML: (a: Record<string, unknown>) => {
            // Emit both the data-attr (used by selectors, e.g.
            // [data-depth="1"]) and an inline CSS variable that
            // `editor-chrome.css` multiplies into the indent step.
            // The variable approach scales to arbitrary depth without
            // needing per-N rules — `attr(name type(<number>))` would
            // be cleaner but isn't supported across Safari/Firefox yet.
            const d = a.depth as number
            return d > 0
              ? {
                  [BLOCK_ATTRIBUTES.depth]: String(d),
                  style: `--rune-block-depth: ${d};`,
                }
              : {}
          },
        },
      }

      if (config.props) {
        for (const [key, spec] of Object.entries(config.props)) {
          const entry: Record<string, unknown> = { default: spec.default }
          if (spec.parseHTML) entry.parseHTML = spec.parseHTML
          if (spec.renderHTML) entry.renderHTML = spec.renderHTML
          attrs[key] = entry
        }
      }

      return attrs
    },

    parseHTML() {
      return config.parseDOM
    },

    renderHTML({ node, HTMLAttributes }) {
      const merged =
        config.bleed === "full"
          ? { ...HTMLAttributes, "data-bleed": "full" }
          : HTMLAttributes
      return config.renderDOM({ node, HTMLAttributes: merged })
    },

    ...(config.renderText
      ? {
          renderText({ node }: { node: ProseMirrorNode }) {
            return config.renderText?.({ node }) ?? ""
          },
        }
      : {}),

    ...(config.nodeView || config.content === ""
      ? {
          addNodeView() {
            return (props) => {
              const { node, editor, getPos, decorations, HTMLAttributes } = props
              const merged =
                config.bleed === "full"
                  ? { ...HTMLAttributes, "data-bleed": "full" }
                  : HTMLAttributes
              const factory = this.options.nodeView ?? config.nodeView
              if (factory) return factory({ ...props, HTMLAttributes: merged })
              return createAtomNodeView({
                node,
                editor,
                getPos,
                decorations,
                HTMLAttributes: merged,
                renderDOM: config.renderDOM,
              })
            }
          },
        }
      : {}),

    addExtensions() {
      const exts = config.extensions ?? []
      return exts.map((ext) => {
        if (!isDeclarativeBlockExtension(ext)) return ext

        return Extension.create({
          name: `${config.type}--${ext.key}`,
          priority: ext.priority,
          addKeyboardShortcuts() {
            return ext.keyboardShortcuts ?? {}
          },
          addInputRules() {
            return compileDeclarativeInputRules(ext.inputRules ?? [], this.editor)
          },
        })
      })
    },
  })

  Object.defineProperty(extension, RUNE_BLOCK_SPEC_METADATA, {
    value: metadata,
    enumerable: false,
  })
  // Also store on config so .configure() / .extend() preserve it
  // (they spread this.config into the new extension).
  const cfg = (extension as unknown as { config: Record<string, unknown> }).config
  cfg[RUNE_BLOCK_SPEC_METADATA] = metadata

  return extension
}
