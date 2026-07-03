// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { Editor } from "@tiptap/core"
import { Fragment, Slice } from "@tiptap/pm/model"
import type {
  Node as ProseMirrorNode,
  NodeType,
  Schema,
} from "@tiptap/pm/model"
import type { Transaction } from "@tiptap/pm/state"
import { createNodeFromBlockInput } from "./insertBlocks"
import type { RuneBlockInput, TurnIntoBlockInput } from "../types"
import { mathControllerKey } from "../../inlines/InlineMath/controller"

export type TurnIntoKind = "inline" | "text" | "atom" | "container"

export interface AdapterResult {
  node: ProseMirrorNode
  postProcess?: (tr: Transaction, pos: number) => void
  attrsOnly?: boolean
}

/**
 * Adapters return `null` to REJECT the conversion (the orchestrator counts
 * it as rejected and leaves the source untouched) — never an invalid node.
 */
export type TurnIntoAdapter = (
  editor: Editor,
  sourceNode: ProseMirrorNode,
  target: TurnIntoBlockInput,
  schema: Schema,
) => AdapterResult | null

/**
 * Classify a node type STRUCTURALLY, not by name. A "container" is any
 * non-atom type whose content is structured nodes rather than inline text —
 * `table` (tableRow+) and `columnLayout` (column{2,5}) both land here, as
 * does any future structured block, with zero per-name edits. The old
 * `type.name === "table"` special case classified `columnLayout` as
 * "inline", which routed it through the textblock adapter and built an
 * invalid layout that normalization silently deleted (COL-2).
 */
export function classifyKind(type: NodeType): TurnIntoKind {
  if (type.isAtom) return "atom"
  if (type.isTextblock) return type.spec.code === true ? "text" : "inline"
  return "container"
}

/**
 * Validate explicit `props` the same way the insert/update path does: build the
 * target via `fromInput` and reject if it refuses (e.g. a heading `level:1`,
 * which is schema-illegal — h1 is reserved for the page title). Gated on props
 * PRESENCE, so a no-props turn-into keeps the target's defaults (unchanged
 * behavior). Returns false ⇒ the conversion must reject. Without this, the
 * textblock/same-type paths wrote `props` straight onto attrs unvalidated and
 * could persist an invalid node (the turn_into contract bug, plan 2026-06-16).
 */
function targetPropsAreValid(
  editor: Editor,
  schema: Schema,
  target: TurnIntoBlockInput,
): boolean {
  if (!target.props || Object.keys(target.props).length === 0) return true
  const probe = createNodeFromBlockInput(
    editor,
    schema,
    { type: target.type, ...target.props } as unknown as RuneBlockInput,
    { depth: 0 },
  )
  return probe !== null
}

/**
 * Resolve a turn-into's OVERRIDE content (D3, presence-based): an explicit
 * `target.content` string — INCLUDING `""` (clears) — overrides the block's
 * content; `undefined` returns null so the caller keeps its source-content
 * handling (e.g. the code-target flatten of AR-1). Plain text only; marks are
 * not carried, matching the textblock paths.
 */
function overrideContentFragment(
  target: TurnIntoBlockInput,
  schema: Schema,
): Fragment | null {
  if (target.content === undefined) return null
  return target.content.length > 0 ? Fragment.from(schema.text(target.content)) : Fragment.empty
}

const sameTypeAdapter: TurnIntoAdapter = (editor, sourceNode, target, schema) => {
  const type = schema.nodes[target.type]!
  if (!targetPropsAreValid(editor, schema, target)) return null
  const attrs = {
    ...sourceNode.attrs,
    ...(target.props ?? {}),
  }
  // D3: explicit content (incl. "") overrides → the node must be REPLACED
  // (attrsOnly only patches attributes, so it cannot change content); an absent
  // content preserves the source via the efficient attrsOnly path.
  const override = overrideContentFragment(target, schema)
  if (override !== null) {
    if (!type.validContent(override)) return null
    return { node: type.create(attrs, override, sourceNode.marks) }
  }
  return {
    node: type.create(attrs, sourceNode.content, sourceNode.marks),
    attrsOnly: true,
  }
}

export function getAdapter(
  sourceKind: TurnIntoKind,
  targetKind: TurnIntoKind,
  sourceType: string,
  targetType: string,
): TurnIntoAdapter {
  if (sourceType === targetType) return sameTypeAdapter

  const key = `${sourceKind}->${targetKind}` as AdapterKey
  const adapter = adapterRegistry[key]
  if (!adapter) {
    throw new Error(
      `turnInto: no adapter for ${sourceType} (${sourceKind}) to ${targetType} (${targetKind})`,
    )
  }
  return adapter
}

type AdapterKey = `${TurnIntoKind}->${TurnIntoKind}`
const adapterRegistry: Partial<Record<AdapterKey, TurnIntoAdapter>> = {}

export function registerAdapter(key: AdapterKey, adapter: TurnIntoAdapter): void {
  adapterRegistry[key] = adapter
}

function buildTextblock(
  editor: Editor,
  sourceNode: ProseMirrorNode,
  target: TurnIntoBlockInput,
  schema: Schema,
): AdapterResult | null {
  const targetType = schema.nodes[target.type]!
  // Validate explicit props (e.g. reject heading level:1) — the textblock
  // turn-into used to write props straight onto attrs, bypassing the
  // fromInput validation that insert/update run.
  if (!targetPropsAreValid(editor, schema, target)) return null
  const attrs = {
    ...pickDeclaredAttrs(sourceNode.attrs, targetType),
    ...(target.props ?? {}),
  }
  // D3: an explicit `content` string (incl. "") overrides; otherwise preserve
  // the source. Code textblocks (`spec.code === true`, content `text*`) can't
  // hold hardBreak or inline atoms, so a bare validContent check refused EVERY
  // soft-wrapped paragraph → codeBlock conversion (AR-1): flatten the source's
  // inline content to one plain text node first; only refuse if even the
  // flattened text is invalid.
  const content =
    overrideContentFragment(target, schema) ??
    (targetType.spec.code === true
      ? flattenInlineToCodeText(sourceNode.content, schema)
      : sourceNode.content)
  // Belt-and-braces: `.create` does NOT validate content. A source whose
  // inline content the target can't hold must reject, not persist a
  // schema-invalid node.
  if (!targetType.validContent(content)) return null
  return { node: targetType.create(attrs, content) }
}

// Flatten inline content for a code-textblock target: hardBreak → "\n",
// `inlineMath` → its `latex` attr (same atom handling as
// extractLatexFromSource below), anything else → its plain textContent.
// The result is a single UNMARKED text node — code blocks render verbatim
// text, so marks (bold etc.) are dropped, matching the old
// `keepMarks: false` behavior of the inline->text adapter.
function flattenInlineToCodeText(fragment: Fragment, schema: Schema): Fragment {
  let out = ""
  fragment.forEach((child) => {
    if (child.type.name === "hardBreak") {
      out += "\n"
    } else if (child.type.name === "inlineMath") {
      out += String(child.attrs.latex ?? "")
    } else {
      out += child.textContent
    }
  })
  return out.length > 0 ? Fragment.from(schema.text(out)) : Fragment.empty
}

function pickDeclaredAttrs(
  attrs: Record<string, unknown>,
  type: NodeType,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const name of Object.keys(type.spec.attrs ?? {})) {
    if (name in attrs) out[name] = attrs[name]
  }
  return out
}

function buildAtom(
  _editor: Editor,
  sourceNode: ProseMirrorNode,
  target: TurnIntoBlockInput,
  schema: Schema,
): AdapterResult {
  const type = schema.nodes[target.type]!
  const attrs = {
    ...pickDeclaredAttrs(sourceNode.attrs, type),
    ...(target.props ?? {}),
  }
  return { node: type.create(attrs) }
}

function buildContainer(
  editor: Editor,
  sourceNode: ProseMirrorNode,
  target: TurnIntoBlockInput,
  schema: Schema,
): AdapterResult | null {
  const built = createNodeFromBlockInput(
    editor,
    schema,
    { type: target.type, ...(target.props ?? {}) } as unknown as RuneBlockInput,
    {
      depth: typeof sourceNode.attrs.depth === "number" ? sourceNode.attrs.depth : 0,
    },
  )
  // `fromInput` refusal (e.g. a columnLayout target without a `columns`
  // payload) rejects the conversion — the old throw crashed the command
  // for what is an addressable-but-invalid input.
  if (!built) return null
  const type = schema.nodes[target.type]!
  const node = type.create(
    { ...built.attrs, id: sourceNode.attrs.id },
    built.content,
    built.marks,
  )
  return { node: seedFirstBodyTextblock(node, sourceNode) }
}

/**
 * Carry the source's inline content into a freshly built container by
 * seeding it into the container's first EMPTY body-block textblock — for a
 * `columnLayout` that is column 1's E2-seeded paragraph, so "Hello" →
 * "/2 columns · Turn into" lands "Hello" in the first column instead of
 * dropping it.
 *
 * Scoped to BODY-BLOCK textblocks ("has a `depth` attr in its type spec",
 * the same node-local discriminator bodySurface.ts uses): `table`'s cells
 * hold `tableParagraph` (not a body block), so the table turn-into keeps
 * its established discard semantics unchanged.
 */
function seedFirstBodyTextblock(
  container: ProseMirrorNode,
  source: ProseMirrorNode,
): ProseMirrorNode {
  if (!source.isTextblock || source.content.size === 0) return container
  let found = -1
  container.descendants((child, pos) => {
    if (found >= 0) return false
    const attrs = child.type.spec.attrs
    if (
      attrs != null &&
      "depth" in attrs &&
      child.isTextblock &&
      child.content.size === 0 &&
      child.type.validContent(source.content)
    ) {
      found = pos
      return false
    }
    return true
  })
  if (found < 0) return container
  try {
    return container.replace(found + 1, found + 1, new Slice(source.content, 0, 0))
  } catch {
    // A replace the schema refuses just means "nothing to seed into" —
    // fall back to the plain container rather than failing the turn-into.
    return container
  }
}

// Walk the source block's inline content and recover a LaTeX string:
// `inlineMath` atoms contribute their `latex` attr (so `$$x^2$$` → inline
// math → equation block preserves the expression), and any other inline
// content contributes its plain `textContent` (so a paragraph of
// `\frac{1}{2}` typed without delimiters also carries through). Mirrors
// the textblock paths which keep the source's content under turn-into;
// without this, atom targets silently dropped everything.
function extractLatexFromSource(source: ProseMirrorNode): string {
  let out = ""
  source.content.forEach((child) => {
    if (child.type.name === "inlineMath") {
      out += String(child.attrs.latex ?? "")
    } else {
      out += child.textContent
    }
  })
  return out.trim()
}

function withMathOpenIfEquation(inner: TurnIntoAdapter): TurnIntoAdapter {
  return (editor, source, target, schema) => {
    if (target.type !== "equationBlock") {
      return inner(editor, source, target, schema)
    }
    const explicitLatex =
      target.props && typeof (target.props as { latex?: unknown }).latex === "string"
        ? (target.props as { latex: string }).latex
        : undefined
    const carriedLatex = explicitLatex ?? extractLatexFromSource(source)
    const effectiveTarget: TurnIntoBlockInput = carriedLatex
      ? { ...target, props: { ...(target.props ?? {}), latex: carriedLatex } }
      : target
    const result = inner(editor, source, effectiveTarget, schema)
    if (!result) return null
    const prev = result.postProcess
    return {
      ...result,
      postProcess: (tr, pos) => {
        prev?.(tr, pos)
        tr.setMeta(mathControllerKey, { type: "open", pos })
      },
    }
  }
}

// Mark handling lives inside buildTextblock: non-code targets keep the
// source's marks; code targets flatten to unmarked plain text.
registerAdapter("inline->inline", buildTextblock)
registerAdapter("inline->text", buildTextblock)
registerAdapter("text->inline", buildTextblock)
registerAdapter("inline->atom", withMathOpenIfEquation(buildAtom))
registerAdapter("text->atom", withMathOpenIfEquation(buildAtom))
registerAdapter("atom->inline", buildAtom)
registerAdapter("atom->text", buildAtom)
registerAdapter("atom->atom", buildAtom)
registerAdapter("inline->container", buildContainer)
registerAdapter("text->container", buildContainer)
registerAdapter("atom->container", buildContainer)
