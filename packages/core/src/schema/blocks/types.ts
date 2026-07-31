// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Generic type contracts for the block factory. Intentionally empty
// right now — the factory (createBlockSpec) works off a plain
// BlockSpecConfig and we don't yet have a reason to surface
// BlockSchema-level generics.
//
// This file starts filling when the Block CRUD API lands
// (editor.document / insertBlocks / updateBlock). Expected entries,
// modelled on BlockNote's schema/blocks/types.ts:
//
//   - BlockConfig<Type, Props, Content>
//       Per-block schema contract — the thing createBlockSpec accepts.
//   - BlockSchema
//       A map of registered block types (name → BlockConfig). Lets
//       editor.document be typed as `RuneBlock<Schema>[]`.
//   - BlockSpec / BlockSpecs
//       Runtime + schema bundle, what a consumer registers with the
//       editor.
//   - BlockSchemaFromSpecs / BlockSchemaWithBlock
//       Narrowing helpers for type-level inference inside commands.
//
// Why split from createSpec.ts: createSpec.ts describes ONE block's
// config/implementation. This file describes the SET of blocks a given
// editor knows about — a different concern and a different shape.

import type { AnyExtension, Editor, JSONContent } from "@tiptap/core"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import type { PhrasingContent, RootContent } from "mdast"
import type { RuneBlock } from "../../blocks"
import type { RuneShortcutActionId } from "../../keymap"

// ---------------------------------------------------------------------------
// Block projection context (toRuneBlock recursion)
// ---------------------------------------------------------------------------

/**
 * Context handed to a block's `toRuneBlock` so a container block can
 * recurse into its child nodes and project each as its own RuneBlock.
 *
 * `projectChild` is backed by `blockFromNode` — the same per-node
 * projection `getDocument` runs — so a child projects identically whether
 * it is reached as a top-level doc child or via a parent's recursion.
 * Returns `null` for children whose type declares no `toRuneBlock`
 * (structural-only nodes), letting the caller skip them.
 *
 * Flat-schema blocks (every built-in today) ignore this argument; it only
 * matters once a block's content holds other registered body blocks. The
 * `ctx` parameter is optional in the signature so direct callers (e.g.
 * unit tests projecting a single node) stay additive, but the production
 * read path (`getDocument` / `blockFromNode`) ALWAYS supplies a real ctx —
 * container blocks rely on that and may treat it as present.
 */
export interface RuneBlockProjectionContext {
  projectChild(node: ProseMirrorNode): RuneBlock | null
}

// ---------------------------------------------------------------------------
// Markdown serializer types
// ---------------------------------------------------------------------------

/**
 * Spacing hint returned by `toMarkdown`. Controls blank-line insertion
 * between consecutive blocks in the final Markdown output.
 *
 * - `"default"` — standard rules (blank line between non-list blocks).
 * - `"list-item"` — consecutive list-items suppress the blank line.
 * - `"isolated"` — always insert a blank line before and after.
 */
export type RuneMarkdownSpacing = "default" | "list-item" | "isolated"

/**
 * The value a block's `toMarkdown` returns. `line` is the fully-rendered
 * Markdown string (including any prefix/indent the block computed).
 * Optional overrides let the block influence spacing and type identity.
 */
export interface RuneMarkdownBlockInfo {
  type?: string
  depth?: number
  line: string
  spacing?: RuneMarkdownSpacing
}

/**
 * Context passed to a block's `toMarkdown` serializer. Contains everything
 * the block needs to render itself without reaching into global state.
 */
export interface RuneMarkdownBlockSerializerContext {
  editor: Editor
  node: ProseMirrorNode
  depth: number
  prefix: string
  numberedIndex?: number
  serializeInline: (node: ProseMirrorNode) => string
}

/**
 * Per-block Markdown serializer. Return a `RuneMarkdownBlockInfo` to
 * render the block, or `null` to skip it entirely (e.g. TableOfContents).
 */
export type RuneMarkdownBlockSerializer = (
  ctx: RuneMarkdownBlockSerializerContext,
) => RuneMarkdownBlockInfo | null

// ---------------------------------------------------------------------------
// Storage-markdown bidirectional contract (markdown-storage PRD §5.2)
// ---------------------------------------------------------------------------

/**
 * Shared inline codec handed to a block's `markdown` contract so no block
 * ever reimplements mark mapping. Both functions are pure.
 */
export interface RuneMdastContext {
  /** mdast phrasing → PM inline array (marks, hardBreaks, soft `\n` splits). */
  inlineToPM(nodes: PhrasingContent[]): JSONContent[]
  /** PM inline array → mdast phrasing. */
  inlineToMdast(content: JSONContent[]): PhrasingContent[]
  /**
   * mdast flow nodes → PM blocks, running the FULL walker (contracts,
   * depth comments, list grouping) at surface-relative depth 0. Container
   * contracts use this to convert their body (e.g. Toggle turning the
   * blockquote's remaining children into its child blocks) — the returned
   * blocks carry surface-relative depths; the contract offsets them for
   * its own nesting (+1 for a direct child) and the walker adds the outer
   * offset on top.
   */
  blocksToPM(nodes: RootContent[]): JSONContent[]
}

/**
 * Bidirectional storage-markdown mapping for one block type, declared on
 * `createBlockSpec` and collected statically (no editor) by
 * `core/src/markdown`. Scope is deliberately narrow: the block maps ITS OWN
 * attrs + inline content. Document-level concerns — depth comments,
 * list-run assembly, expanding one mdast node into several flat blocks'
 * ordering — belong to the walker (`markdown/convert.ts`), which stamps
 * `depth` onto returned blocks and sequences multi-block results.
 *
 * `fromMdast` doubles as a promoter: it is offered mdast nodes in block
 * registration order BEFORE the walker's builtin mapping, and returns
 * `null` to decline (e.g. Callout claims only blockquotes whose first line
 * is a `[!TYPE]` marker; plain blockquotes fall through to the builtin).
 */
export interface RuneMarkdownBlockContract {
  /**
   * Flat-schema container marker: when true, the walker collects the run
   * of FOLLOWING siblings deeper than this block (its children in the
   * flat depth model), converts them — depths rebased so a direct child
   * is the body's surface level 0 — and hands them to `toMdast` as the
   * `children` argument. The run is consumed (not re-serialized as
   * siblings) unless `toMdast` returns null.
   */
  absorbsDeeperRun?: boolean
  /**
   * This block's bytes cannot survive a container, so it must never hold a
   * depth. Declared here rather than inferred from `indent.maxDepth: 0`,
   * because those are different claims: CodeBlock, Divider and Table also cap
   * at 0, but a fenced block indented under a list item round-trips perfectly —
   * their syntax travels with the indentation. A raw carrier's does not, and it
   * is the difference between "we would rather not" and "this destroys it".
   *
   * Two consumers read it, which is the point of declaring it once:
   *   - `markdown/convert.ts` flattens such a block before serializing, so the
   *     guarantee holds however the depth arrived
   *   - `extensions/block-drag` refuses to offer a deeper drop slot, so the
   *     editor stops accepting a nesting that disappears on the next save
   */
  flattensDepth?: boolean
  /** PM block JSON → mdast node(s), or null to fall back to the builtin. */
  toMdast(
    block: JSONContent,
    ctx: RuneMdastContext,
    children?: RootContent[],
  ): RootContent | RootContent[] | null
  /** Claim an mdast node → PM block JSON(s); null declines. */
  fromMdast(node: RootContent, ctx: RuneMdastContext): JSONContent | JSONContent[] | null
}

/**
 * A handler bound to a keyboard chord. Receives the editor; return
 * `true` if handled (stop propagation), `false` to let Tiptap continue
 * processing the keypress.
 */
export type ShortcutHandler = (ctx: { editor: Editor }) => boolean

/**
 * A declarative input rule. The block declares a regex `find` pattern and
 * a `replace` returning the target block to convert/replace into. The
 * runtime (`replaceWithNode` in `internal.ts`) executes the actual
 * transform — the block author never writes a PM transaction.
 *
 * Return `false` from `replace` to no-op (rule matched but a precondition
 * is unmet, e.g. cursor in a code block).
 */
export interface DeclarativeInputRule {
  find: RegExp
  replace: (ctx: { match: RegExpMatchArray; editor: Editor }) =>
    | { type: string; props?: Record<string, unknown> }
    | false
}

/**
 * Per-block declarative extension. Add these to `createBlockSpec`'s
 * `extensions` field; the factory compiles them into Tiptap extensions
 * and Tiptap's extension manager auto-registers them — `kit.ts` does
 * NOT need to know about them.
 */
export interface DeclarativeBlockExtension {
  /** Stable name for debugging + extension-manager dedupe. Required. */
  key: string
  /**
   * Tiptap extension priority for the generated sub-Extension. Defaults
   * to Tiptap's `100` when omitted. Set higher than 1000 to outrank
   * generic editor-wide extensions like `Indent` (M8.5).
   *
   * Why this lives here, not on the parent block: the keymap runs on
   * the sub-Extension that the factory generates inside addExtensions(),
   * not on the block Node itself. `.extend({ priority })` on the Node
   * has no effect on the sub-Extension's keymap priority.
   */
  priority?: number
  /**
   * FIXED structural bindings (Enter-in-codeBlock, divider arrow skips…),
   * keyed by literal chord. Hosts cannot remap these. A user-facing chord
   * (Mod-combo) belongs in `shortcutActions` instead, so the host keymap
   * override channel reaches it.
   */
  keyboardShortcuts?: Record<string, ShortcutHandler>
  /**
   * REMAPPABLE bindings, keyed by registry action id — the factory binds
   * each handler under the chords the editor's resolved keymap assigns to
   * that action (defaults from `RUNE_SHORTCUT_ACTIONS`, host overrides via
   * `createRuneKit({ keymap })`). An unbound action registers nothing.
   */
  shortcutActions?: Partial<Record<RuneShortcutActionId, ShortcutHandler>>
  inputRules?: DeclarativeInputRule[]
}

/**
 * A block-owned extension can be either a declarative spec (shortcuts +
 * input rules compiled by the factory) OR an already-built Tiptap
 * extension (commands, plugins, etc.) passed through as-is.
 */
export type RuneBlockExtensionInput = DeclarativeBlockExtension | AnyExtension

/**
 * Discriminator: DeclarativeBlockExtension has `key` but no `name`;
 * Tiptap's AnyExtension has `name` but no `key`.
 */
export function isDeclarativeBlockExtension(
  extension: RuneBlockExtensionInput,
): extension is DeclarativeBlockExtension {
  return (
    typeof extension === "object" &&
    extension !== null &&
    "key" in extension &&
    !("name" in extension)
  )
}

// ---------------------------------------------------------------------------
// Block action descriptors
// ---------------------------------------------------------------------------

/**
 * Context passed to `blockActions` factory. Available at editor-construction
 * time — no per-block runtime context yet.
 */
export interface RuneBlockActionContext {
  editor: Editor
}

/**
 * Runtime context passed to each action's `isVisible`, `isDisabled`, and
 * `run` callbacks. Contains the resolved node, position, and selection info.
 */
export interface RuneBlockActionRuntimeContext {
  editor: Editor
  node: ProseMirrorNode
  blockId: string | null
  pos: number
  isSingleBlock: boolean
}

/**
 * A single block action descriptor. The React layer maps `icon` string
 * tokens to Lucide components — unknown tokens render without an icon.
 */
export interface RuneBlockAction {
  id: string
  label: string
  icon?: string
  group?: string
  /**
   * Promote this action to a direct icon button on the block's floating
   * bar (media blocks). All actions — flagged or not — also render as
   * rows in menus (side-menu dropdown, the bar's `•••`); `quickAction`
   * only adds the one-click surface.
   */
  quickAction?: boolean
  isVisible?: (ctx: RuneBlockActionRuntimeContext) => boolean
  isDisabled?: (ctx: RuneBlockActionRuntimeContext) => boolean
  run: (ctx: RuneBlockActionRuntimeContext) => boolean | void
}

/**
 * Factory that produces block actions for a given block spec.
 * Receives `{ editor }` so actions can close over editor commands.
 */
export type RuneBlockActionFactory = (
  ctx: RuneBlockActionContext,
) => RuneBlockAction[]

// ---------------------------------------------------------------------------
// Schema context metadata (JSON-safe; consumed by getRuneSchemaContext)
// ---------------------------------------------------------------------------

/**
 * Recursive JSON-safe value. Used everywhere schema-context metadata
 * crosses the editor → tool descriptor boundary. No functions, DOM nodes,
 * symbols, or class instances allowed.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

/**
 * Coarse type tag used by schema-context prop descriptors. Inferred from
 * a prop's default value when no override is supplied via `schemaContext`.
 */
export type RuneSchemaContextPropType =
  | "string"
  | "number"
  | "boolean"
  | "null"
  | "array"
  | "object"
  | "unknown"

/**
 * Minimal legal input example for a block. Represents a public
 * `RuneBlockInput` accepted by the block's `fromInput`. Arbitrary
 * JSON-safe top-level fields are allowed (`text`, `level`, `src`, `rows`,
 * `cols`, etc.).
 */
export type RuneSchemaContextInputExample = { type: string } & Record<
  string,
  JsonValue
>

/**
 * Per-prop schema-context metadata. `type` is required; `default`,
 * `description`, and `values` are optional. All values are JSON-safe.
 */
export interface RuneSchemaContextPropMetadata {
  default?: JsonValue
  type: RuneSchemaContextPropType
  description?: string
  values?: JsonValue[]
}

/**
 * Optional per-block schema-context metadata supplied to `createBlockSpec`.
 * Pure data — read by `getRuneSchemaContext(editor)` and projected into the
 * public agent-facing context. Must be JSON-safe; the factory sanitizes it
 * before storing, so plugin authors cannot bypass the contract.
 */
export interface RuneBlockSchemaContextSpec {
  description?: string
  input?: {
    description?: string
    examples?: RuneSchemaContextInputExample[]
  }
  props?: Record<
    string,
    {
      description?: string
      type?: RuneSchemaContextPropType
      values?: JsonValue[]
    }
  >
  insert?: {
    slashItems?: Array<{
      key: string
      title: string
      group?: string
      aliases?: string[]
      block?: { type: string; props?: Record<string, JsonValue> }
    }>
  }
  actions?: Array<{
    id: string
    label: string
    group?: string
  }>
  examples?: Array<{
    label?: string
    input?: RuneSchemaContextInputExample
    markdown?: string
  }>
}
