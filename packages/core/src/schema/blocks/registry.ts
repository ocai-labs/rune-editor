// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { Editor } from "@tiptap/core"
import type { DOMOutputSpec, Node as ProseMirrorNode } from "@tiptap/pm/model"
import type { DefaultSuggestionItem } from "../../extensions/suggestion-menus"
import type {
  BlockSideMenuSpec,
  BlockSpecFromInput,
  BlockSupportsSpec,
  IndentConfig,
  RuneInPlaceAttr,
} from "./createSpec"
import type {
  RuneBlockActionFactory,
  RuneBlockProjectionContext,
  RuneBlockSchemaContextSpec,
  RuneMarkdownBlockSerializer,
  RuneSchemaContextPropMetadata,
} from "./types"

export interface BlockSpecMetadata {
  /** Tiptap node name and public block type. Mirrors `BlockSpecConfig.type`. */
  type?: string
  /** ProseMirror content expression. Mirrors `BlockSpecConfig.content`. */
  content?: string
  /**
   * JSON-safe per-prop schema-context projection. Built by the factory
   * from `BlockSpecConfig.props` + optional `schemaContext.props` overrides.
   * Never carries `parseHTML` / `renderHTML` functions.
   */
  props?: Record<string, RuneSchemaContextPropMetadata>
  /**
   * Sanitized JSON-safe schema-context metadata supplied to the factory.
   * See `BlockSpecConfig.schemaContext`.
   */
  schemaContext?: RuneBlockSchemaContextSpec
  slashMenuItems?: (editor: Editor) => DefaultSuggestionItem[]
  sideMenu?: BlockSideMenuSpec
  /**
   * Whether the block is hidden from rune-ai read-tool outputs.
   * See `BlockSpecConfig.agentHidden`.
   */
  agentHidden?: boolean
  supports?: BlockSupportsSpec
  /**
   * Attr changes the factory atom NodeView absorbs without a rebuild.
   * See `BlockSpecConfig.inPlaceAttrs` / `RuneInPlaceAttr`.
   */
  inPlaceAttrs?: ReadonlyArray<RuneInPlaceAttr>
  /**
   * Selector naming the block's resizable media element(s).
   * See `BlockSpecConfig.resizeMediaSelector`.
   */
  resizeMediaSelector?: string
  /**
   * The block's standard DOM output (chrome-included). Stored on the
   * block's storage so the clipboard serializer can fall back to it
   * when `clipboardRenderDOM` isn't declared.
   */
  renderDOM?: (args: { node: ProseMirrorNode; HTMLAttributes: Record<string, any> }) => DOMOutputSpec
  /**
   * Optional chrome-free DOM output for clipboard `text/html` MIME.
   * See `BlockSpecConfig.clipboardRenderDOM` for the full contract.
   */
  clipboardRenderDOM?: (args: { node: ProseMirrorNode }) => DOMOutputSpec
  /**
   * Optional projection to the block's public RuneBlock JSON representation.
   * See `BlockSpecConfig.toRuneBlock` for the full contract.
   */
  toRuneBlock?: (node: ProseMirrorNode, ctx?: RuneBlockProjectionContext) => unknown
  /**
   * Optional construction hook from a public RuneBlockInput-shaped descriptor.
   * See `BlockSpecConfig.fromInput` for the full contract.
   */
  fromInput?: BlockSpecFromInput
  /** Indent mode declaration. See `BlockSpecConfig.indent`. */
  indent?: IndentConfig
  /** Optional drag source range resolver. See BlockSpecConfig.dragSourceRange. */
  dragSourceRange?: (args: {
    node: ProseMirrorNode
    pos: number
    doc: ProseMirrorNode
    editor?: Editor
  }) => { from: number; to: number }
  /** Optional per-block Markdown serializer. See BlockSpecConfig.toMarkdown. */
  toMarkdown?: RuneMarkdownBlockSerializer
  /** Optional block action factory. See BlockSpecConfig.blockActions. */
  blockActions?: RuneBlockActionFactory
}

interface MarkedStorage extends BlockSpecMetadata {
  __runeBlockSpec: true
}

function isMarked(storage: unknown): storage is MarkedStorage {
  return (
    typeof storage === "object" &&
    storage !== null &&
    (storage as { __runeBlockSpec?: unknown }).__runeBlockSpec === true
  )
}

export function forEachBlockSpec(
  editor: Editor,
  fn: (nodeName: string, meta: BlockSpecMetadata) => void,
): void {
  for (const ext of editor.extensionManager.extensions) {
    if (!isMarked(ext.storage)) continue
    fn(ext.name, ext.storage)
  }
}

export function getBlockSpecs(editor: Editor): Record<string, BlockSpecMetadata> {
  const out: Record<string, BlockSpecMetadata> = {}
  forEachBlockSpec(editor, (name, meta) => {
    out[name] = meta
  })
  return out
}

/**
 * Whether a block type's registered indent mode is `"structural"` — the
 * single source of truth for "is this a list-style block" across indent,
 * split, markdown export, and drag-chain logic. Derived from the block's
 * declared `indent: { mode: "structural" }` spec metadata, NOT a hardcoded
 * name set, so a plugin block that opts into structural indent is
 * classified as a list everywhere automatically.
 */
export function isStructuralIndentType(editor: Editor, typeName: string): boolean {
  return getBlockSpecs(editor)[typeName]?.indent?.mode === "structural"
}

/**
 * The full set of block type names whose registered indent mode is
 * `"structural"`. Built from spec metadata (see `isStructuralIndentType`).
 * Use when a hot loop needs repeated membership checks against one editor.
 */
export function structuralIndentTypes(editor: Editor): Set<string> {
  const out = new Set<string>()
  forEachBlockSpec(editor, (name, meta) => {
    if (meta.indent?.mode === "structural") out.add(name)
  })
  return out
}
