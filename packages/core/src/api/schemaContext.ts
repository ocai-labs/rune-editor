// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { Editor } from "@tiptap/core"
import type { MarkType } from "@tiptap/pm/model"
import { COLOR_NAMES, type ColorName } from "../shared/color-tokens"
import { forEachBlockSpec, type BlockSpecMetadata } from "../schema"
import type {
  JsonValue,
  RuneBlockSchemaContextSpec,
  RuneSchemaContextInputExample,
  RuneSchemaContextPropMetadata,
} from "../schema"

// ---------------------------------------------------------------------------
// Public output types
// ---------------------------------------------------------------------------

export interface RuneEditorSchemaSummary {
  documentModel: "flat-blocks"
  sharedBlockAttrs: readonly ["id", "depth"]
  runtimeManagedBlockAttrs: readonly ["id"]
}

export type RunePropSchemaContext = RuneSchemaContextPropMetadata

export interface RuneBlockSupportsContext {
  textColor?: boolean
  backgroundColor?: boolean
  resize?: boolean
  mediaSource?: boolean
  fitToWidth?: boolean
}

export type RuneIndentSchemaContext =
  | { mode: "numeric"; maxDepth: number }
  | { mode: "structural" }
  | { mode: "follow-prev" }

export interface RuneBlockInputContext {
  supported: boolean
  reason?: "missing-fromInput"
  description?: string
  examples?: RuneSchemaContextInputExample[]
}

export interface RuneBlockOutputContext {
  publicJson: boolean
  markdown: "serializer" | "none"
}

export interface RuneBlockSchemaContext {
  type: string
  content: string
  props: Record<string, RunePropSchemaContext>
  supports: RuneBlockSupportsContext
  indent: RuneIndentSchemaContext
  input: RuneBlockInputContext
  output: RuneBlockOutputContext
  insert?: NonNullable<RuneBlockSchemaContextSpec["insert"]>
  actions?: NonNullable<RuneBlockSchemaContextSpec["actions"]>
  description?: string
  examples?: NonNullable<RuneBlockSchemaContextSpec["examples"]>
  warnings?: string[]
}

export interface RuneMarkSchemaContext {
  type: string
  attrs: Record<string, { default?: JsonValue }>
}

export interface RuneSchemaContext {
  version: 1
  editor: RuneEditorSchemaSummary
  blocks: RuneBlockSchemaContext[]
  marks: RuneMarkSchemaContext[]
  /**
   * The one shared colour palette (`COLOR_NAMES`) every colour surface draws
   * from — block `set_block_color`, the `textStyle` colour mark, table cells.
   * `blocks[].supports.textColor` / `.backgroundColor` say WHICH blocks can be
   * coloured; this says with WHICH names (`"default"` clears). Exposed here so an
   * agent learns the vocabulary once from `get_editor_context` rather than
   * guessing names.
   */
  palette: ColorName[]
}

// ---------------------------------------------------------------------------
// JSON-safety helpers (file-local)
// ---------------------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null) return false
  if (Array.isArray(v)) return false
  if (typeof (v as { nodeType?: unknown }).nodeType === "number") return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

function isJsonSafe(v: unknown, seen: WeakSet<object> = new WeakSet()): boolean {
  if (v === null) return true
  const t = typeof v
  if (t === "string" || t === "boolean") return true
  // JSON.stringify(NaN | Infinity | -Infinity) → "null", which would corrupt
  // the round-trip equality promise. Treat non-finite numbers as unsafe.
  if (t === "number") return Number.isFinite(v)
  if (t === "function" || t === "symbol" || t === "undefined" || t === "bigint") return false
  if (Array.isArray(v)) {
    if (seen.has(v)) return false
    seen.add(v)
    return v.every((entry) => isJsonSafe(entry, seen))
  }
  if (!isPlainObject(v)) return false
  if (seen.has(v)) return false
  seen.add(v)
  return Object.values(v).every((entry) => isJsonSafe(entry, seen))
}

function jsonSafeValue(v: unknown): JsonValue | undefined {
  if (!isJsonSafe(v)) return undefined
  // Deep-clone via JSON to guarantee no live references leak.
  return JSON.parse(JSON.stringify(v)) as JsonValue
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

function projectBlock(
  nodeName: string,
  meta: BlockSpecMetadata,
): RuneBlockSchemaContext {
  const type = meta.type ?? nodeName
  const content = meta.content ?? ""
  const supports: RuneBlockSupportsContext = meta.supports ? { ...meta.supports } : {}
  const indent: RuneIndentSchemaContext = meta.indent ? { ...meta.indent } : { mode: "follow-prev" }

  const props: Record<string, RunePropSchemaContext> = {}
  if (meta.props) {
    for (const [key, propMeta] of Object.entries(meta.props)) {
      const safe = jsonSafeValue(propMeta)
      if (safe && typeof safe === "object" && !Array.isArray(safe)) {
        props[key] = safe as unknown as RunePropSchemaContext
      }
    }
  }

  const inputSupported = typeof meta.fromInput === "function"
  const inputExamplesRaw = meta.schemaContext?.input?.examples
  const inputDescription = meta.schemaContext?.input?.description
  const input: RuneBlockInputContext = { supported: inputSupported }
  if (!inputSupported) input.reason = "missing-fromInput"
  if (inputDescription) input.description = inputDescription
  if (inputExamplesRaw && inputExamplesRaw.length > 0) {
    const examples = inputExamplesRaw
      .map((ex) => jsonSafeValue(ex))
      .filter((ex): ex is JsonValue =>
        ex !== undefined && typeof ex === "object" && ex !== null && !Array.isArray(ex),
      ) as unknown as RuneSchemaContextInputExample[]
    if (examples.length > 0) input.examples = examples
  }

  const output: RuneBlockOutputContext = {
    publicJson: typeof meta.toRuneBlock === "function",
    markdown: typeof meta.toMarkdown === "function" ? "serializer" : "none",
  }

  const block: RuneBlockSchemaContext = {
    type,
    content,
    props,
    supports,
    indent,
    input,
    output,
  }

  // ONLY from schemaContext — runtime factories (slashMenuItems, blockActions)
  // must never run during schema-context projection.
  const sc = meta.schemaContext
  if (sc?.insert) {
    const safe = jsonSafeValue(sc.insert)
    if (safe && typeof safe === "object" && !Array.isArray(safe)) {
      block.insert = safe as unknown as NonNullable<RuneBlockSchemaContextSpec["insert"]>
    }
  }
  if (sc?.actions && sc.actions.length > 0) {
    const safe = jsonSafeValue(sc.actions)
    if (Array.isArray(safe) && safe.length > 0) {
      block.actions = safe as unknown as NonNullable<RuneBlockSchemaContextSpec["actions"]>
    }
  }
  if (sc?.description) block.description = sc.description
  if (sc?.examples && sc.examples.length > 0) {
    const safe = jsonSafeValue(sc.examples)
    if (Array.isArray(safe) && safe.length > 0) {
      block.examples = safe as unknown as NonNullable<RuneBlockSchemaContextSpec["examples"]>
    }
  }

  const warnings: string[] = []
  if (input.supported && !input.examples) warnings.push("missing-input-example")
  if (warnings.length > 0) block.warnings = warnings

  return block
}

function projectMarks(editor: Editor): RuneMarkSchemaContext[] {
  const out: RuneMarkSchemaContext[] = []
  const marks = editor.schema.marks as Record<string, MarkType>
  for (const markName of Object.keys(marks)) {
    const mark = marks[markName]
    if (!mark) continue
    const attrs: Record<string, { default?: JsonValue }> = {}
    const specAttrs = (mark.spec.attrs ?? {}) as Record<string, { default?: unknown }>
    for (const [attrName, attrSpec] of Object.entries(specAttrs)) {
      const entry: { default?: JsonValue } = {}
      const safeDefault = jsonSafeValue(attrSpec?.default)
      if (safeDefault !== undefined) entry.default = safeDefault
      attrs[attrName] = entry
    }
    out.push({ type: markName, attrs })
  }
  return out
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Project the live editor's Rune block schema and marks into a JSON-safe
 * descriptor suitable for agent tool context. Pure projection: never
 * inspects `editor.state.doc`, never calls runtime UI factories
 * (`slashMenuItems`, `blockActions`), never serializes Markdown.
 */
export function getRuneSchemaContext(editor: Editor): RuneSchemaContext {
  const blocks: RuneBlockSchemaContext[] = []
  forEachBlockSpec(editor, (nodeName, meta) => {
    blocks.push(projectBlock(nodeName, meta))
  })
  return {
    version: 1,
    editor: {
      documentModel: "flat-blocks",
      sharedBlockAttrs: ["id", "depth"] as const,
      runtimeManagedBlockAttrs: ["id"] as const,
    },
    blocks,
    marks: projectMarks(editor),
    palette: [...COLOR_NAMES],
  }
}

/**
 * The set of block types marked `agentHidden` in their spec — blocks that
 * rune-ai strips from its read-tool outputs (`list_blocks` /
 * `get_editor_context`) so the AI can't target them (e.g. a structural page
 * title). Derived from spec metadata, so any block (built-in or plugin) that
 * opts in via `agentHidden: true` is classified here automatically.
 */
export function getAgentHiddenTypes(editor: Editor): Set<string> {
  const out = new Set<string>()
  forEachBlockSpec(editor, (nodeName, meta) => {
    if (meta.agentHidden === true) out.add(meta.type ?? nodeName)
  })
  return out
}
