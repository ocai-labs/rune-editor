// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// mdast ↔ ProseMirror JSON for the blocks the roundtrip baseline measured as
// "只差序列化细节" (docs/2026-07-29-markdown-roundtrip-baseline.md) plus the
// free wins remark gives us (math → equationBlock, frontmatter handled by the
// caller in index.ts). The 9 identity-losing blocks (callout, toggle, media,
// TOC, …) are NOT mapped here — they arrive with step 4's per-block
// `toMdast`/`fromMdast` contracts on `createBlockSpec`; until then an unknown
// PM block degrades to a plain-text paragraph (content preserved, identity
// declared-lost) so nothing silently vanishes.
//
// Depth model (D9, FINAL 2026-07-29): markdown's own expressiveness IS the
// feature boundary. Depth serializes only where markdown has native syntax
// for it — list nesting (indented lists / item children) and container
// bodies (toggle children ride the folded-callout blockquote). The residual
// case — a non-list block indented under a non-list block, Notion's
// "indent anything" — has NO markdown syntax and does not persist: it
// flattens on serialize. Two in-file marker encodings (HTML comment, `%%`
// Obsidian comment) were field-tested visible in Obsidian's editing views
// and removed; per the product call, storage does not carry what markdown
// cannot say (no markers, no sidecar for depth).
import type { JSONContent } from "@tiptap/core"
import type {
  BlockContent,
  DefinitionContent,
  List,
  ListItem,
  PhrasingContent,
  Root,
  RootContent,
  Table as MdastTable,
} from "mdast"
import type { RuneMarkdownBlockContract, RuneMdastContext } from "../schema"
import type { MarkdownContracts } from "./contracts"
import { inlineToMdast, inlineToPM, mdastText } from "./inline"

// Heading identity: markdown depth N == PM level N == HTML <hN>. The host owns
// the page title, so the body schema no longer reserves level 1 or invents a
// tagless level 7.
const HEADING_MIN = 1
const HEADING_MAX = 6

const LIST_TYPES = new Set(["bulletList", "numberedList", "taskList"])

const NO_CONTRACTS: MarkdownContracts = []

/**
 * Per-conversion environment: the ordered contract list (parse-side
 * promoter order), the type-keyed map (serialize-side dispatch), and the
 * RuneMdastContext handed to contracts — whose `blocksToPM` recurses into
 * the same walker so container bodies get full treatment (contracts, depth
 * comments, list grouping). Built once per public call; holds no document
 * state (§7.1).
 */
interface Env {
  contracts: MarkdownContracts
  byType: ReadonlyMap<string, RuneMarkdownBlockContract>
  ctx: RuneMdastContext
  /**
   * The exact source bytes a node covers, or null when they cannot be recovered.
   * Derived here from the input rather than accepted as a caller-supplied
   * closure: the conversion's output must depend only on its arguments, and an
   * opaque function could smuggle in state that `parse` has no way to see.
   */
  sliceSource: (node: RootContent) => string | null
}

/**
 * Byte-exact source recovery for a node, or null.
 *
 * `node.value` is the right answer wherever it is available and complete —
 * at the root of the document it IS the source, and it survives a BOM better
 * than an offset does. It is NOT enough anywhere the enclosing construct
 * contributed characters that CommonMark strips before mdast sees them:
 * a list item's indentation, a blockquote's `> `, a paragraph continuation
 * line's leading whitespace. Those are the cases this exists for.
 *
 * Two hazards, both measured:
 *
 *   BOM  — offsets are computed against the BOM-stripped string, so slicing the
 *          original is off by one for every node in the file. Stripped up front.
 *   none — a node built by a contract, or any node that did not come from
 *          `parseToMdast`, has no `position`. Returning null (rather than a
 *          plausible-looking slice) is what keeps a caller from recording bytes
 *          the file never contained.
 */
function makeSlicer(source: string | undefined): (node: RootContent) => string | null {
  if (source == null) return () => null
  // U+FEFF only at the very start: elsewhere it is a zero-width no-break space
  // that belongs to the content and shifts nothing.
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source
  return (node) => {
    const start = node.position?.start?.offset
    const end = node.position?.end?.offset
    // `Number.isInteger` and not `typeof === "number"`: NaN and a fractional
    // offset both pass a bare type check and are then silently coerced by
    // `String.slice`, which is exactly the plausible-looking-but-wrong slice
    // this function exists to refuse.
    if (!Number.isInteger(start) || !Number.isInteger(end)) return null
    if (start! < 0 || end! > text.length || end! < start!) return null
    return text.slice(start, end)
  }
}

/**
 * The slicer, but only where mdast offsets still describe the bytes the writer
 * will produce.
 *
 * This is the inline half of the same rule `case "html"` follows for blocks, and
 * it exists for the same reason from the opposite direction. Inside a list item,
 * a blockquote or a table cell, offsets point at the ORIGINAL source — which
 * still carries the container's indentation and `> ` prefix. The writer then
 * adds its own prefix on top, so every save doubles it. Measured:
 *
 *   `- before <X\n  prop\n  /> after`  →  continuation lines indented FOUR spaces
 *   `> before <X\n> prop`              →  continuation lines gained `> > `
 *
 * Nested positions therefore fall back to `node.value`, which CommonMark has
 * already stripped to exactly what the writer expects to re-prefix. Omitting the
 * argument entirely at those call sites IS that fallback.
 */
const inlineSlice = (env: Env, verbatim: boolean) =>
  verbatim ? env.sliceSource : undefined

function makeEnv(contracts: MarkdownContracts, source?: string): Env {
  const env: Env = {
    contracts,
    byType: new Map(contracts.map((c) => [c.type, c.contract])),
    sliceSource: makeSlicer(source),
    ctx: {
      // No slice: a contract is handed nodes from wherever it claimed them —
      // Callout's promoter gets a root blockquote's paragraph children, which
      // are nested by definition.
      inlineToPM: (nodes) => inlineToPM(nodes, []),
      inlineToMdast: (content) => inlineToMdast(content),
      blocksToPM: (nodes) => nodesToPM(nodes, env),
    },
  }
  return env
}

// ─── mdast → PM ─────────────────────────────────────────────────────────────

export interface MdastToPMInput {
  root: Root
  /**
   * The markdown the tree was parsed from. Required for byte-exact fallback of
   * constructs whose `value` is not their source. `parseMarkdown` always passes
   * it; a bare mdast caller may omit it, and then those constructs degrade
   * exactly as they did before the carriers existed rather than recording
   * approximate bytes.
   */
  source?: string
}

export function mdastToPM(
  input: Root | MdastToPMInput,
  contracts: MarkdownContracts = NO_CONTRACTS,
): JSONContent {
  const { root, source } = "type" in input ? { root: input, source: undefined } : input
  // `verbatim: true` — these are the direct children of the document, the only
  // position where an mdast node's `value` is also its source bytes. See the
  // `case "html"` in `emitBlock`.
  return { type: "doc", content: nodesToPM(root.children, makeEnv(contracts, source), true) }
}

function nodesToPM(
  nodes: readonly RootContent[],
  env: Env,
  verbatim = false,
): JSONContent[] {
  const blocks: JSONContent[] = []
  for (const node of nodes) emitBlock(node, 0, blocks, env, verbatim)
  return blocks
}

/** Stamp the walker-owned depth onto a contract-returned block (contracts
 *  return surface-relative depth; the walker owns the absolute offset). */
function withDepthOffset(b: JSONContent, offset: number): JSONContent {
  if (offset <= 0) return b
  const depth = (typeof b.attrs?.depth === "number" ? b.attrs.depth : 0) + offset
  return { ...b, attrs: { ...b.attrs, depth } }
}

function block(type: string, depth: number, rest?: Partial<JSONContent>): JSONContent {
  const attrs = { ...(depth > 0 ? { depth } : {}), ...(rest?.attrs ?? {}) }
  return { type, ...(Object.keys(attrs).length ? { attrs } : {}), ...(rest?.content ? { content: rest.content } : {}) }
}

function emitBlock(
  node: RootContent,
  depth: number,
  out: JSONContent[],
  env: Env,
  /** True only for a DIRECT child of the mdast root — see `case "html"`. */
  verbatim = false,
): void {
  // Block contracts are offered every node first, in registration order —
  // this is the promoter hook (e.g. Callout claiming `[!TYPE]` blockquotes).
  for (const { contract } of env.contracts) {
    const claimed = contract.fromMdast(node, env.ctx)
    if (claimed == null) continue
    for (const b of Array.isArray(claimed) ? claimed : [claimed]) {
      out.push(withDepthOffset(b, depth))
    }
    return
  }
  switch (node.type) {
    case "yaml":
      return // frontmatter is carved off by parseMarkdown (index.ts)
    case "paragraph": {
      const lone = node.children.length === 1 ? node.children[0] : null
      if (lone?.type === "image") {
        out.push(
          block("image", depth, {
            attrs: imageAttrs(lone.url, lone.alt ?? "", lone.title),
          }),
        )
        return
      }
      out.push(
        block("paragraph", depth, {
          content: inlineToPM(node.children, [], inlineSlice(env, verbatim)),
        }),
      )
      return
    }
    case "heading": {
      const level = Math.min(HEADING_MAX, Math.max(HEADING_MIN, node.depth))
      out.push(
        block("heading", depth, {
          attrs: { level },
          content: inlineToPM(node.children, [], inlineSlice(env, verbatim)),
        }),
      )
      return
    }
    case "thematicBreak":
      out.push(block("divider", depth))
      return
    case "blockquote": {
      // Paragraph children merge into ONE quote block, separated by
      // hardBreak — the flat-schema quote is a single inline* block.
      // Non-paragraph children (nested lists, code) surface after it.
      const inline: JSONContent[] = []
      const trailing: RootContent[] = []
      for (const child of node.children) {
        if (child.type === "paragraph") {
          if (inline.length) inline.push({ type: "hardBreak" })
          // No slice — inside the `> ` prefix. See `inlineSlice`.
          inline.push(...inlineToPM(child.children, []))
        } else {
          trailing.push(child)
        }
      }
      out.push(block("blockquote", depth, { content: inline }))
      for (const t of trailing) emitBlock(t, depth, out, env)
      return
    }
    case "code":
      out.push(
        block("codeBlock", depth, {
          attrs: { language: node.lang ?? null },
          content: node.value ? [{ type: "text", text: node.value }] : [],
        }),
      )
      return
    case "list":
      emitList(node, depth, out, env)
      return
    case "table":
      out.push(nonRectangularTableSource(node, env, verbatim) ?? tableToPM(node, depth))
      return
    case "math":
      out.push(block("equationBlock", depth, { attrs: { latex: node.value } }))
      return
    case "html":
      // Block-level source with no PM representation. It reaches here only after
      // every block contract has declined it (the loop at the top of this
      // function), so first-class claims — media's `<video>` / `<audio>`, a
      // consumer's own promoter — still win. That ordering is what keeps the
      // fallback from eating nodes that already have a home.
      //
      // `node.value` is used rather than a `position` slice on purpose. At ROOT
      // level the two agree byte-for-byte, and `value` is the more robust of the
      // two: with a BOM, mdast offsets are computed on the stripped string, so
      // slicing the original would be off by one.
      //
      // `verbatim` is what keeps that guarantee honest. Anywhere else — a list
      // item, a blockquote, a container body — the enclosing construct's
      // indentation or `> ` prefix has already been stripped from `value`, so
      // claiming it would hand a rawBlock source bytes it never had and the
      // writer would re-indent them by its own rules. Those positions keep the
      // existing degrade-to-text behaviour and stay on §3.9's byte-damage list
      // until the source-slice foundation lands with A1-wide.
      if (verbatim) {
        out.push(block("rawBlock", depth, { attrs: { source: node.value, origin: "html" } }))
        return
      }
      out.push(block("paragraph", depth, { content: [{ type: "text", text: node.value }] }))
      return
    default: {
      // B2b — an unmapped block-level construct. `footnoteDefinition` is the
      // measured case: it has children but no `value`, so `mdastText` recovered
      // the note's prose while silently dropping the `[^1]:` marker that makes it
      // a footnote. The raw carrier keeps the whole construct instead.
      //
      // Only at `verbatim` position, and only with a recoverable slice — the same
      // two conditions as `case "html"`, for the same reason: anywhere else the
      // enclosing construct's prefix has already been stripped from what mdast
      // reports, so the bytes would be wrong.
      const source = verbatim ? env.sliceSource(node) : null
      if (source) {
        // Everything reaching `default:` is markdown that rune has no node for.
        // Only `footnote*` gets its own label; the rest — a link definition, an
        // MDX export — are plain markdown. Labelling them "html" was a lie the
        // user could read: `[id]: https://example.com` announced itself as HTML.
        const origin = node.type.startsWith("footnote") ? "footnote" : "markdown"
        out.push(block("rawBlock", depth, { attrs: { source, origin } }))
        return
      }
      // Preserve its text so content never silently vanishes (identity is
      // declared-lost) — the pre-carrier behaviour, kept as the fallback.
      const text = mdastText(node)
      if (text) out.push(block("paragraph", depth, { content: [{ type: "text", text }] }))
    }
  }
}

function emitList(list: List, depth: number, out: JSONContent[], env: Env): void {
  list.children.forEach((item: ListItem, index) => {
    const type = item.checked != null ? "taskList" : list.ordered ? "numberedList" : "bulletList"
    const attrs: Record<string, unknown> = {}
    if (item.checked != null) attrs.checked = item.checked
    if (list.ordered && index === 0 && list.start != null && list.start !== 1) attrs.start = list.start

    const [head, ...rest] = item.children
    // No slice — inside the list marker's indentation. See `inlineSlice`.
    const inline = head?.type === "paragraph" ? inlineToPM(head.children, []) : []
    out.push(block(type, depth, { attrs, content: inline }))
    const tail = head?.type === "paragraph" ? rest : item.children
    for (const child of tail) emitBlock(child, depth + 1, out, env)
  })
}

/**
 * F8 / A3 — a GFM table whose rows do not all have the header's width.
 *
 * NOT malformed, despite what an earlier version of this comment said: GFM
 * explicitly permits body rows that differ from the header, padding the short
 * ones and dropping the extra cells. The source is legal and the READ side is
 * correct. What it is not is RECTANGULAR, and rune's table node can only hold a
 * rectangle — so the damage is on the way out, where both directions invent
 * structure rather than merely reformatting:
 *
 *   row wider than header   `| 1 | 2 | 3 |` under `| a | b |`
 *                           → writes `| a | b | |` — a THIRD COLUMN in the header
 *   row narrower            `| 1 |` under `| a | b |`
 *                           → writes `| 1 | |` — an empty cell the author did
 *                             not write (GFM would have materialized one on
 *                             READ, but writing it back changes the file)
 *
 * Truncating would throw away the user's bytes and merging into the last cell
 * would invent table semantics, so neither is acceptable. The whole table becomes
 * a raw carrier instead — the source is returned untouched.
 *
 * The predicate is the measured shape, not a heuristic: a width mismatch is the
 * only thing checked, and a rectangular table is never touched.
 * `verbatim` gates it for the same reason as the other carriers — a slice taken
 * inside a list or quote would be re-indented by the writer's own rules.
 */
function nonRectangularTableSource(
  table: MdastTable,
  env: Env,
  verbatim: boolean,
): JSONContent | null {
  if (!verbatim) return null
  const header = table.children[0]
  if (!header) return null
  const width = header.children.length
  if (table.children.every((row) => row.children.length === width)) return null
  const source = env.sliceSource(table)
  return source ? block("rawBlock", 0, { attrs: { source, origin: "table" } }) : null
}

function tableToPM(table: MdastTable, depth: number): JSONContent {
  const rows = table.children.map((row, rowIndex) => ({
    type: "tableRow",
    content: row.children.map((cell) => ({
      type: rowIndex === 0 ? "tableHeader" : "tableCell",
      content: [
        // No slice — inside the `|` delimiters. See `inlineSlice`.
        { type: "tableParagraph", content: inlineToPM(cell.children, []) },
      ],
    })),
  }))
  // GFM column alignment is a fidelity passthrough (Table's columnAligns
  // attr) — all-null collapses to no attr, the authored-in-rune canonical.
  const aligns = (table.align ?? []).map((a) => a ?? null)
  const attrs = aligns.some((a) => a !== null) ? { columnAligns: aligns } : undefined
  return block("table", depth, { ...(attrs ? { attrs } : {}), content: rows })
}


// ─── PM → mdast ─────────────────────────────────────────────────────────────

export function pmToMdast(doc: JSONContent, contracts: MarkdownContracts = NO_CONTRACTS): Root {
  return { type: "root", children: serializeNodes(doc.content ?? [], makeEnv(contracts)) }
}

/** Rebase a block into a container body's surface: a direct child (depth
 *  base) becomes the body's level 0, deeper blocks keep their offset. */
function rebaseDepth(b: JSONContent, base: number): JSONContent {
  const depth = Math.max(0, depthOf(b) - base)
  if (depth === depthOf(b)) return b
  const { attrs: oldAttrs, ...rest } = b
  const attrs = { ...oldAttrs }
  if (depth > 0) attrs.depth = depth
  else delete attrs.depth
  return Object.keys(attrs).length ? { ...rest, attrs } : rest
}

/**
 * D13 enforced HERE, rather than trusted from upstream.
 *
 * A raw carrier's whole value is that its bytes come back unchanged, and every
 * container this walker can build writes a prefix on each line — a list item's
 * indentation, a blockquote's `> `. Measured: a `rawBlock` that reached depth 1
 * after a list owner serialized INTO the item and reparsed as a paragraph of
 * literal text, so the following save escaped the source to `\<div>`. Identity
 * and content both lost.
 *
 * The block spec declares `maxDepth: 0` and `insertBlocks` honours it, but the
 * drag path derives drop depth from the DESTINATION alone and never consults the
 * moved block's own config (`extensions/block-drag/reorder.ts`) — a pre-existing
 * gap shared with codeBlock, divider and table. Those three survive a container
 * (their fences and `---` travel with the indentation); this one cannot. So the
 * guarantee is made at the codec, where it holds however the depth arrived —
 * drag, a plugin, or a hand-built document.
 */
function flattenRawCarriers(
  content: readonly JSONContent[],
  env: Env,
): readonly JSONContent[] {
  // Read from the block's own `markdown.flattensDepth`, not from a name this
  // file knows: a plugin block whose bytes are equally container-hostile gets
  // the same guarantee by declaring it, and the drag path reads the same flag.
  const stray = (b: JSONContent) =>
    depthOf(b) > 0 && (b.type ? env.byType.get(b.type)?.flattensDepth === true : false)
  if (!content.some(stray)) return content
  return content.map((b) => (stray(b) ? rebaseDepth(b, depthOf(b)) : b))
}

function serializeNodes(raw: readonly JSONContent[], env: Env): RootContent[] {
  const content = flattenRawCarriers(raw, env)
  const children: RootContent[] = []
  let i = 0
  while (i < content.length) {
    const b = content[i]!
    if (LIST_TYPES.has(b.type!)) {
      const [list, next] = buildList(content, i, depthOf(b), env)
      children.push(list)
      i = next
      continue
    }
    const d = depthOf(b)
    const contract = b.type ? env.byType.get(b.type) : undefined
    if (contract?.absorbsDeeperRun) {
      // Flat-schema container: the run of deeper siblings is this block's
      // body. Rebase the run so a direct child is the body's level 0 and
      // convert it through the full walker (nested containers recurse).
      let j = i + 1
      while (j < content.length && depthOf(content[j]!) > d) j++
      const body = serializeNodes(
        content.slice(i + 1, j).map((c) => rebaseDepth(c, d + 1)),
        env,
      )
      const produced = contract.toMdast(b, env.ctx, body)
      if (produced != null) {
        children.push(...(Array.isArray(produced) ? produced : [produced]))
        i = j
        continue
      }
      // Declined: fall through — the run serializes as ordinary siblings.
    }
    children.push(...serializeBlock(b, env))
    i++
  }
  return children
}

/** Contract toMdast first (declared mapping wins), builtin switch fallback. */
function serializeBlock(b: JSONContent, env: Env): RootContent[] {
  const declared = b.type ? env.byType.get(b.type)?.toMdast(b, env.ctx) : null
  if (declared != null) return Array.isArray(declared) ? declared : [declared]
  return blockToMdast(b)
}

const depthOf = (b: JSONContent): number =>
  typeof b.attrs?.depth === "number" ? b.attrs.depth : 0

/** Build one mdast list from a flat run of same-kind list blocks at `depth`,
 *  absorbing deeper blocks as item children. Returns [list, nextIndex].
 *
 *  `spread: false` on both the list and its items is DELIBERATE and must stay:
 *  it keeps tight lists tight. Blank lines where a tight boundary would be
 *  misparsed are added per-boundary by `separateUnsafeBoundary` in
 *  `pipeline.ts`, because `spread` cannot express "this one boundary only". */
function buildList(
  blocks: readonly JSONContent[],
  start: number,
  depth: number,
  env: Env,
): [List, number] {
  const first = blocks[start]!
  const ordered = first.type === "numberedList"
  const startAttr = typeof first.attrs?.start === "number" ? first.attrs.start : 1
  const items: ListItem[] = []
  let i = start
  while (i < blocks.length) {
    const b = blocks[i]!
    const d = depthOf(b)
    if (d < depth || !LIST_TYPES.has(b.type!) || (b.type === "numberedList") !== ordered) break
    if (d > depth) break // deeper without an owning item — handled by absorb below
    const item: ListItem = {
      type: "listItem",
      spread: false,
      ...(b.type === "taskList" ? { checked: b.attrs?.checked === true } : {}),
      children: [{ type: "paragraph", children: inlineToMdast(b.content ?? []) }],
    }
    items.push(item)
    i++
    while (i < blocks.length && depthOf(blocks[i]!) > depth) {
      const child = blocks[i]!
      if (LIST_TYPES.has(child.type!)) {
        const [sub, next] = buildList(blocks, i, depthOf(child), env)
        item.children.push(sub)
        i = next
      } else {
        // Serialize the whole remaining child run through the document walker,
        // not one block at a time. A flat-schema container in this position
        // (notably Toggle inside a list item) owns its following deeper siblings;
        // serializeBlock would omit that ownership and leave the body as a
        // blockquote→paragraph sibling boundary. The list-boundary join guard
        // then correctly inserts a blank line for that sibling shape, but the
        // blank line also prevents CommonMark from treating the paragraph as the
        // toggle body. Keeping the run together lets absorbsDeeperRun build the
        // blockquote body explicitly while preserving the guard for genuinely
        // separate blockquote/paragraph siblings.
        let next = i + 1
        while (next < blocks.length && depthOf(blocks[next]!) > depth) next++
        item.children.push(
          ...(serializeNodes(blocks.slice(i, next), env) as (BlockContent | DefinitionContent)[]),
        )
        i = next
      }
    }
  }
  return [
    { type: "list", ordered, ...(ordered ? { start: startAttr } : {}), spread: false, children: items },
    i,
  ]
}

/**
 * D6, both halves.
 *
 * WIDTH rides Obsidian's native `![alt|300](src)`: the size lives at the END of
 * the alt text, after a pipe. Obsidian reads it, and anything that does not
 * simply shows it as part of the alt — no syntax is invented and nothing is
 * lost. Only a trailing all-digits segment counts, so an alt that legitimately
 * contains a pipe (`![a|b](x)`) stays alt text.
 *
 * ALIGN has no Markdown spelling at all, so a non-default alignment upgrades to
 * the `<img>` form. That half lives on the Image block's own `markdown`
 * contract (blocks/Image/block.ts), which runs before this builtin — here is
 * the plain path every unaligned image takes.
 *
 * `contentWidth` is deliberately NOT persisted: it is view state (zyler PRD
 * §4.1), and writing it would put a layout decision from one client into a file
 * every other client has to honour.
 */
const ALT_WIDTH = /^(.*)\|(\d+)$/

function imageAttrs(
  url: string,
  rawAlt: string,
  title: string | null | undefined,
): Record<string, unknown> {
  const sized = ALT_WIDTH.exec(rawAlt)
  const titleAttr = typeof title === "string" ? { title } : {}
  if (!sized) return { src: url, alt: rawAlt, ...titleAttr }
  return { src: url, alt: sized[1] ?? "", width: Number(sized[2]), ...titleAttr }
}

function imageToMdast(b: JSONContent): RootContent {
  const src = typeof b.attrs?.src === "string" ? b.attrs.src : ""
  const alt = typeof b.attrs?.alt === "string" ? b.attrs.alt : ""
  const width = typeof b.attrs?.width === "number" ? b.attrs.width : null
  const title = typeof b.attrs?.title === "string" ? b.attrs.title : null
  return {
    type: "paragraph",
    children: [{ type: "image", url: src, alt: width ? `${alt}|${width}` : alt, title }],
  }
}

function blockToMdast(b: JSONContent): RootContent[] {
  switch (b.type) {
    case "paragraph":
      return [{ type: "paragraph", children: inlineToMdast(b.content ?? []) }]
    case "heading": {
      const level = typeof b.attrs?.level === "number" ? b.attrs.level : HEADING_MIN
      const depth = Math.min(HEADING_MAX, Math.max(HEADING_MIN, level)) as 1 | 2 | 3 | 4 | 5 | 6
      return [{ type: "heading", depth, children: inlineToMdast(b.content ?? []) }]
    }
    case "divider":
      return [{ type: "thematicBreak" }]
    case "blockquote": {
      // Split at hardBreak back into quote paragraphs (inverse of mdastToPM).
      const runs: JSONContent[][] = [[]]
      for (const n of b.content ?? []) {
        if (n.type === "hardBreak") runs.push([])
        else runs[runs.length - 1]!.push(n)
      }
      return [
        {
          type: "blockquote",
          children: runs
            .filter((r) => r.length)
            .map((r) => ({ type: "paragraph", children: inlineToMdast(r) })),
        },
      ]
    }
    case "codeBlock": {
      const lang = typeof b.attrs?.language === "string" ? b.attrs.language : null
      return [{ type: "code", lang, value: (b.content ?? []).map((n) => n.text ?? "").join("") }]
    }
    case "table":
      return [pmTableToMdast(b)]
    case "image":
      return [imageToMdast(b)]
    case "equationBlock":
      return [{ type: "math", value: typeof b.attrs?.latex === "string" ? b.attrs.latex : "" }]
    default: {
      // Unmapped block (callout/toggle/media/… until step 4): degrade to a
      // plain paragraph so the CONTENT reaches the file even while the
      // identity is declared-lost.
      const text = pmText(b)
      return text ? [{ type: "paragraph", children: [{ type: "text", value: text }] }] : []
    }
  }
}

function pmTableToMdast(table: JSONContent): MdastTable {
  const stored = Array.isArray(table.attrs?.columnAligns) ? table.attrs.columnAligns : []
  return {
    type: "table",
    // One entry per column, from the stored passthrough; sized to the first
    // row so a drifted attr can never emit a malformed delimiter row.
    align: (table.content?.[0]?.content ?? []).map((_, i) => {
      const a = stored[i]
      return a === "left" || a === "center" || a === "right" ? a : null
    }),
    children: (table.content ?? []).map((row) => ({
      type: "tableRow",
      children: (row.content ?? []).map((cell) => {
        // GFM cells hold phrasing only. Multi-paragraph cells are a declared
        // baseline loss (§6.3 sidecar territory); their runs join on a space
        // so content survives.
        const paras = cell.content ?? []
        const phrasing: PhrasingContent[] = []
        paras.forEach((p, idx) => {
          if (idx > 0) phrasing.push({ type: "text", value: " " })
          // `br`: a GFM row cannot span physical lines, so a hard break inside a
          // cell has to ride `<br>` — the native form would end the row and the
          // continuation would re-parse as a second row.
          phrasing.push(...inlineToMdast(p.content ?? [], "br"))
        })
        return { type: "tableCell", children: phrasing }
      }),
    })),
  }
}


function pmText(node: JSONContent): string {
  if (typeof node.text === "string") return node.text
  return (node.content ?? []).map(pmText).join("")
}
