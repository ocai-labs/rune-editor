// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, it, expect, vi } from "vitest"
import { Node } from "@tiptap/core"
import { createTestEditor } from "../test-utils/createTestEditor"
import { createBlockSpec } from "../schema"
import type { BlockPropSpec } from "../schema"
import { getRuneSchemaContext } from "./schemaContext"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findBlock(
  ctx: ReturnType<typeof getRuneSchemaContext>,
  type: string,
) {
  return ctx.blocks.find((b) => b.type === type)
}

function walkForFunctions(value: unknown, path = "root"): string[] {
  if (value === null) return []
  if (typeof value === "function") return [path]
  if (Array.isArray(value)) {
    return value.flatMap((v, i) => walkForFunctions(v, `${path}[${i}]`))
  }
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
      walkForFunctions(v, `${path}.${k}`),
    )
  }
  return []
}

// ---------------------------------------------------------------------------
// Step 1: Top-level shape
// ---------------------------------------------------------------------------

describe("getRuneSchemaContext — top-level shape", () => {
  it("returns version 1", () => {
    const editor = createTestEditor()
    const ctx = getRuneSchemaContext(editor)
    expect(ctx.version).toBe(1)
  })

  it("returns the flat-blocks documentModel", () => {
    const editor = createTestEditor()
    const ctx = getRuneSchemaContext(editor)
    expect(ctx.editor.documentModel).toBe("flat-blocks")
  })

  it("declares sharedBlockAttrs as ['id', 'depth']", () => {
    const editor = createTestEditor()
    const ctx = getRuneSchemaContext(editor)
    expect(ctx.editor.sharedBlockAttrs).toEqual(["id", "depth"])
  })

  it("declares runtimeManagedBlockAttrs as ['id']", () => {
    const editor = createTestEditor()
    const ctx = getRuneSchemaContext(editor)
    expect(ctx.editor.runtimeManagedBlockAttrs).toEqual(["id"])
  })

  it("includes built-in factory blocks in the blocks array", () => {
    const editor = createTestEditor()
    const ctx = getRuneSchemaContext(editor)
    expect(Array.isArray(ctx.blocks)).toBe(true)
    const types = ctx.blocks.map((b) => b.type)
    expect(types).toContain("paragraph")
    expect(types).toContain("heading")
  })

  it("returns marks as an array of { type, attrs }", () => {
    const editor = createTestEditor()
    const ctx = getRuneSchemaContext(editor)
    expect(Array.isArray(ctx.marks)).toBe(true)
    for (const mark of ctx.marks) {
      expect(typeof mark.type).toBe("string")
      expect(typeof mark.attrs).toBe("object")
      expect(mark.attrs).not.toBeNull()
      // No functions in attr metadata.
      expect(walkForFunctions(mark.attrs)).toEqual([])
    }
  })

  it("exposes the shared colour palette (names incl. 'default')", () => {
    const editor = createTestEditor()
    const ctx = getRuneSchemaContext(editor)
    expect(Array.isArray(ctx.palette)).toBe(true)
    expect(ctx.palette).toContain("default")
    expect(ctx.palette).toContain("blue")
    // JSON-safe (plain strings, no functions).
    for (const name of ctx.palette) expect(typeof name).toBe("string")
  })
})

// ---------------------------------------------------------------------------
// Step 2: Built-in block projection
// ---------------------------------------------------------------------------

describe("getRuneSchemaContext — built-in block projection", () => {
  it("paragraph is writable (fromInput) and projects to public JSON", () => {
    const editor = createTestEditor()
    const ctx = getRuneSchemaContext(editor)
    const paragraph = findBlock(ctx, "paragraph")
    expect(paragraph).toBeDefined()
    expect(paragraph!.content).toBe("inline*")
    expect(paragraph!.input.supported).toBe(true)
    expect(paragraph!.output.publicJson).toBe(true)
  })

  it("paragraph declares at least one input example (satisfied by Task 4)", () => {
    const editor = createTestEditor()
    const ctx = getRuneSchemaContext(editor)
    const paragraph = findBlock(ctx, "paragraph")
    expect(paragraph!.input.examples).toBeDefined()
    expect(paragraph!.input.examples!.length).toBeGreaterThan(0)
  })

  it("heading projects level prop with JSON-safe default and an input example", () => {
    const editor = createTestEditor()
    const ctx = getRuneSchemaContext(editor)
    const heading = findBlock(ctx, "heading")
    expect(heading).toBeDefined()
    expect(heading!.props.level).toBeDefined()
    expect(heading!.props.level!.default).toBe(1)
    expect(heading!.input.examples).toBeDefined()
    expect(heading!.input.examples!.length).toBeGreaterThan(0)
  })

  it("table declares supports.fitToWidth and an input example", () => {
    const editor = createTestEditor()
    const ctx = getRuneSchemaContext(editor)
    const table = findBlock(ctx, "table")
    expect(table).toBeDefined()
    expect(table!.supports.fitToWidth).toBe(true)
    expect(table!.input.examples).toBeDefined()
    expect(table!.input.examples!.length).toBeGreaterThan(0)
  })

  it.each(["image", "video", "audio"])(
    "%s declares supports.mediaSource and an input example",
    (type) => {
      const editor = createTestEditor()
      const ctx = getRuneSchemaContext(editor)
      const block = findBlock(ctx, type)
      expect(block).toBeDefined()
      expect(block!.supports.mediaSource).toBe(true)
      expect(block!.input.examples).toBeDefined()
      expect(block!.input.examples!.length).toBeGreaterThan(0)
    },
  )

  it("tableOfContents declares output.markdown = 'serializer' (has toMarkdown)", () => {
    const editor = createTestEditor()
    const ctx = getRuneSchemaContext(editor)
    const toc = findBlock(ctx, "tableOfContents")
    expect(toc).toBeDefined()
    // TableOfContents/block.ts declares `toMarkdown`; the helper must
    // report "serializer" without calling it.
    expect(toc!.output.markdown).toBe("serializer")
  })
})

// ---------------------------------------------------------------------------
// Step 3: Missing-metadata degradation
// ---------------------------------------------------------------------------

describe("getRuneSchemaContext — missing metadata degradation", () => {
  it("read-only plugin block (no fromInput) reports input.supported=false with reason", () => {
    const ReadOnlyBlock = createBlockSpec({
      type: "readOnlyPluginBlock",
      content: "inline*",
      parseDOM: [{ tag: "div.read-only-plugin-block" }],
      renderDOM: ({ HTMLAttributes }) => [
        "div",
        { ...HTMLAttributes, class: "rune-block read-only-plugin-block" },
        ["div", { class: "rune-block-content" }, 0],
      ],
    })
    const editor = createTestEditor({
      kit: { plugins: [{ id: "test-readonly", blockExtensions: [ReadOnlyBlock] }] },
    })
    const ctx = getRuneSchemaContext(editor)
    const block = findBlock(ctx, "readOnlyPluginBlock")
    expect(block).toBeDefined()
    expect(block!.input.supported).toBe(false)
    expect(block!.input.reason).toBe("missing-fromInput")
  })

  it("writable plugin block with no input examples flags 'missing-input-example'", () => {
    const WritableNoExamples = createBlockSpec({
      type: "writableNoExamplesBlock",
      content: "inline*",
      parseDOM: [{ tag: "div.writable-no-examples" }],
      renderDOM: ({ HTMLAttributes }) => [
        "div",
        { ...HTMLAttributes, class: "rune-block writable-no-examples" },
        ["div", { class: "rune-block-content" }, 0],
      ],
      fromInput: ({ schema, input, defaults }) => {
        const t = schema.nodes["writableNoExamplesBlock"]
        if (!t) return null
        const text = typeof input.text === "string" ? input.text : ""
        return t.create(
          { ...defaults.attrs, id: input.id ?? null, depth: input.depth ?? defaults.depth },
          text ? schema.text(text) : undefined,
        )
      },
    })
    const editor = createTestEditor({
      kit: {
        plugins: [
          { id: "test-writable-no-examples", blockExtensions: [WritableNoExamples] },
        ],
      },
    })
    const ctx = getRuneSchemaContext(editor)
    const block = findBlock(ctx, "writableNoExamplesBlock")
    expect(block).toBeDefined()
    expect(block!.input.supported).toBe(true)
    expect(block!.warnings).toBeDefined()
    expect(block!.warnings).toContain("missing-input-example")
  })

  it("plugin block schemaContext fields are projected through", () => {
    const RichMetadataBlock = createBlockSpec({
      type: "richMetadataBlock",
      content: "inline*",
      props: {
        flavor: { default: "vanilla" },
      },
      parseDOM: [{ tag: "div.rich-metadata-block" }],
      renderDOM: ({ HTMLAttributes }) => [
        "div",
        { ...HTMLAttributes, class: "rune-block rich-metadata-block" },
        ["div", { class: "rune-block-content" }, 0],
      ],
      // NOTE: runtime UI factories must NOT be called by getRuneSchemaContext.
      // They throw here to prove that.
      slashMenuItems: () => {
        throw new Error("slashMenuItems should not be called by getRuneSchemaContext")
      },
      blockActions: () => {
        throw new Error("blockActions should not be called by getRuneSchemaContext")
      },
      fromInput: ({ schema, input, defaults }) => {
        const t = schema.nodes["richMetadataBlock"]
        if (!t) return null
        const text = typeof input.text === "string" ? input.text : ""
        return t.create(
          { ...defaults.attrs, id: input.id ?? null, depth: input.depth ?? defaults.depth },
          text ? schema.text(text) : undefined,
        )
      },
      schemaContext: {
        description: "A rich metadata test block",
        props: {
          flavor: {
            description: "Flavor of the block",
            type: "string",
            values: ["vanilla", "chocolate"],
          },
        },
        insert: {
          slashItems: [
            {
              key: "rich-metadata",
              title: "Rich Metadata",
              group: "test",
              aliases: ["rmb"],
              block: { type: "richMetadataBlock" },
            },
          ],
        },
        actions: [{ id: "do-something", label: "Do Something", group: "test" }],
        examples: [
          {
            label: "Basic",
            input: { type: "richMetadataBlock", text: "Hello" },
          },
        ],
        input: {
          examples: [{ type: "richMetadataBlock", text: "Hello" }],
        },
      },
    })
    const editor = createTestEditor({
      kit: {
        plugins: [{ id: "test-rich-metadata", blockExtensions: [RichMetadataBlock] }],
      },
    })
    const ctx = getRuneSchemaContext(editor)
    const block = findBlock(ctx, "richMetadataBlock")
    expect(block).toBeDefined()
    expect(block!.description).toBe("A rich metadata test block")
    expect(block!.props.flavor).toMatchObject({
      description: "Flavor of the block",
      type: "string",
      values: ["vanilla", "chocolate"],
    })
    expect(block!.insert).toBeDefined()
    expect(block!.insert!.slashItems).toEqual([
      {
        key: "rich-metadata",
        title: "Rich Metadata",
        group: "test",
        aliases: ["rmb"],
        block: { type: "richMetadataBlock" },
      },
    ])
    expect(block!.actions).toEqual([
      { id: "do-something", label: "Do Something", group: "test" },
    ])
    expect(block!.examples).toEqual([
      {
        label: "Basic",
        input: { type: "richMetadataBlock", text: "Hello" },
      },
    ])
  })

  it("block without toMarkdown reports output.markdown = 'none'", () => {
    const NoMarkdownBlock = createBlockSpec({
      type: "noMarkdownBlock",
      content: "inline*",
      parseDOM: [{ tag: "div.no-markdown-block" }],
      renderDOM: ({ HTMLAttributes }) => [
        "div",
        { ...HTMLAttributes, class: "rune-block no-markdown-block" },
        ["div", { class: "rune-block-content" }, 0],
      ],
    })
    const editor = createTestEditor({
      kit: { plugins: [{ id: "test-no-markdown", blockExtensions: [NoMarkdownBlock] }] },
    })
    const ctx = getRuneSchemaContext(editor)
    const block = findBlock(ctx, "noMarkdownBlock")
    expect(block).toBeDefined()
    expect(block!.output.markdown).toBe("none")
  })
})

// ---------------------------------------------------------------------------
// Step 4: Plugin / configure regression
// ---------------------------------------------------------------------------

describe("getRuneSchemaContext — plugin and configure regression", () => {
  it("plugin block passed through createRuneKit({ plugins }) appears in blocks", () => {
    const Plugged = createBlockSpec({
      type: "pluggedBlock",
      content: "inline*",
      parseDOM: [{ tag: "div.plugged" }],
      renderDOM: ({ HTMLAttributes }) => [
        "div",
        { ...HTMLAttributes, class: "rune-block plugged" },
        ["div", { class: "rune-block-content" }, 0],
      ],
    })
    const editor = createTestEditor({
      kit: { plugins: [{ id: "test-plugged", blockExtensions: [Plugged] }] },
    })
    const ctx = getRuneSchemaContext(editor)
    expect(findBlock(ctx, "pluggedBlock")).toBeDefined()
  })

  it("configured plugin block (.configure(...)) still appears with schemaContext metadata", () => {
    const Configurable = createBlockSpec({
      type: "configurableBlock",
      content: "inline*",
      parseDOM: [{ tag: "div.configurable" }],
      renderDOM: ({ HTMLAttributes }) => [
        "div",
        { ...HTMLAttributes, class: "rune-block configurable" },
        ["div", { class: "rune-block-content" }, 0],
      ],
      schemaContext: {
        description: "A configurable plugin block",
      },
    })
    const Configured = Configurable.configure({})
    const editor = createTestEditor({
      kit: { plugins: [{ id: "test-configured", blockExtensions: [Configured] }] },
    })
    const ctx = getRuneSchemaContext(editor)
    const block = findBlock(ctx, "configurableBlock")
    expect(block).toBeDefined()
    expect(block!.description).toBe("A configurable plugin block")
  })

  it("raw Node.create plugin blockExtensions are rejected by kit validation", () => {
    // Replicates the existing rejection path in kit.ts /
    // isFactoryBuiltBlockExtension — schema context must never get the
    // chance to advertise a non-factory block.
    const RawNode = Node.create({
      name: "rawPluginBlock",
      group: "block",
      content: "inline*",
      parseHTML: () => [{ tag: "div.raw-plugin-block" }],
      renderHTML: () => ["div", 0],
    })
    expect(() =>
      createTestEditor({
        kit: { plugins: [{ id: "test-raw", blockExtensions: [RawNode] }] },
      }),
    ).toThrow(/createBlockSpec/)
  })
})

// ---------------------------------------------------------------------------
// Step 5: Purity + JSON-safety
// ---------------------------------------------------------------------------

describe("getRuneSchemaContext — purity and JSON-safety", () => {
  it("round-trips through JSON.stringify / JSON.parse without loss", () => {
    const editor = createTestEditor()
    const ctx = getRuneSchemaContext(editor)
    expect(JSON.parse(JSON.stringify(ctx))).toEqual(ctx)
  })

  it("contains no function-valued fields anywhere", () => {
    const editor = createTestEditor()
    const ctx = getRuneSchemaContext(editor)
    expect(walkForFunctions(ctx)).toEqual([])
  })

  it("two editors with same schema but different document content return identical context", () => {
    const editorA = createTestEditor({
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Hello A" }],
          },
        ],
      },
    })
    const editorB = createTestEditor({
      content: {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 3 },
            content: [{ type: "text", text: "Heading B" }],
          },
          {
            type: "paragraph",
            content: [{ type: "text", text: "Different content" }],
          },
        ],
      },
    })
    const ctxA = getRuneSchemaContext(editorA)
    const ctxB = getRuneSchemaContext(editorB)
    // Normalize through JSON to avoid key-order noise.
    expect(JSON.parse(JSON.stringify(ctxA))).toEqual(JSON.parse(JSON.stringify(ctxB)))
  })

  it("throwing slashMenuItems / blockActions are NOT invoked; static schemaContext data is returned", () => {
    const StaticOnly = createBlockSpec({
      type: "staticOnlyBlock",
      content: "inline*",
      parseDOM: [{ tag: "div.static-only" }],
      renderDOM: ({ HTMLAttributes }) => [
        "div",
        { ...HTMLAttributes, class: "rune-block static-only" },
        ["div", { class: "rune-block-content" }, 0],
      ],
      slashMenuItems: () => {
        throw new Error("should not be called")
      },
      blockActions: () => {
        throw new Error("should not be called")
      },
      schemaContext: {
        insert: {
          slashItems: [
            {
              key: "static-only",
              title: "Static Only",
              block: { type: "staticOnlyBlock" },
            },
          ],
        },
        actions: [{ id: "static-action", label: "Static Action" }],
      },
    })
    const editor = createTestEditor({
      kit: { plugins: [{ id: "test-static-only", blockExtensions: [StaticOnly] }] },
    })
    // The mere act of building this context must not throw.
    let ctx: ReturnType<typeof getRuneSchemaContext>
    expect(() => {
      ctx = getRuneSchemaContext(editor)
    }).not.toThrow()
    const block = findBlock(ctx!, "staticOnlyBlock")
    expect(block).toBeDefined()
    expect(block!.insert!.slashItems).toEqual([
      {
        key: "static-only",
        title: "Static Only",
        block: { type: "staticOnlyBlock" },
      },
    ])
    expect(block!.actions).toEqual([{ id: "static-action", label: "Static Action" }])
  })

  it("non-JSON-safe prop defaults are dropped; no functions appear anywhere in the output", () => {
    // Build a prop spec whose `default` is a function (non-JSON-safe). The
    // BlockPropSpec type requires a typed `default`, so we cast through
    // unknown to express "the type system would forbid this, but a plugin
    // author could still do it at runtime".
    const fnDefaultProp = {
      default: (() => "dynamic") as unknown,
    } as unknown as BlockPropSpec<unknown>
    const UnsafeDefaultsBlock = createBlockSpec({
      type: "unsafeDefaultsBlock",
      content: "inline*",
      props: {
        // Function default — must not surface as a function.
        callable: fnDefaultProp,
        // Symbol default — also non-JSON-safe.
        sym: {
          default: Symbol("nope") as unknown,
        } as unknown as BlockPropSpec<unknown>,
        // JSON-safe sibling — must survive so we know we're not nuking the whole prop map.
        ok: { default: "fine" },
      },
      parseDOM: [{ tag: "div.unsafe-defaults-block" }],
      renderDOM: ({ HTMLAttributes }) => [
        "div",
        { ...HTMLAttributes, class: "rune-block unsafe-defaults-block" },
        ["div", { class: "rune-block-content" }, 0],
      ],
    })
    const editor = createTestEditor({
      kit: {
        plugins: [{ id: "test-unsafe-defaults", blockExtensions: [UnsafeDefaultsBlock] }],
      },
    })
    const ctx = getRuneSchemaContext(editor)
    const block = findBlock(ctx, "unsafeDefaultsBlock")
    expect(block).toBeDefined()
    // JSON-safe sibling survives.
    expect(block!.props.ok).toBeDefined()
    expect(block!.props.ok!.default).toBe("fine")
    // Function/symbol defaults: either the prop is omitted entirely, or it
    // surfaces without a `default` field. Either way, no function/symbol
    // value leaks through.
    if (block!.props.callable) {
      expect(typeof block!.props.callable).toBe("object")
      expect(typeof (block!.props.callable as { default?: unknown }).default).not.toBe(
        "function",
      )
      expect(typeof (block!.props.callable as { default?: unknown }).default).not.toBe(
        "symbol",
      )
    }
    if (block!.props.sym) {
      expect(typeof (block!.props.sym as { default?: unknown }).default).not.toBe(
        "function",
      )
      expect(typeof (block!.props.sym as { default?: unknown }).default).not.toBe(
        "symbol",
      )
    }
    // And the entire returned tree contains no functions.
    expect(walkForFunctions(ctx)).toEqual([])
    // Round-trip safety — JSON.stringify wouldn't omit a function from an
    // object value position; if any leaked, JSON.parse(JSON.stringify(...))
    // would diverge from the original. This complements the dedicated
    // round-trip test above by exercising the unsafe-defaults code path.
    expect(JSON.parse(JSON.stringify(ctx))).toEqual(ctx)
  })

  it("toMarkdown is reported as 'serializer' but is NOT invoked during projection", () => {
    const toMarkdownSpy = vi.fn(() => ({ line: "ignored" }))
    const SerializerBlock = createBlockSpec({
      type: "serializerBlock",
      content: "inline*",
      parseDOM: [{ tag: "div.serializer-block" }],
      renderDOM: ({ HTMLAttributes }) => [
        "div",
        { ...HTMLAttributes, class: "rune-block serializer-block" },
        ["div", { class: "rune-block-content" }, 0],
      ],
      toMarkdown: toMarkdownSpy,
    })
    const editor = createTestEditor({
      kit: { plugins: [{ id: "test-serializer", blockExtensions: [SerializerBlock] }] },
    })
    const ctx = getRuneSchemaContext(editor)
    const block = findBlock(ctx, "serializerBlock")
    expect(block).toBeDefined()
    expect(block!.output.markdown).toBe("serializer")
    expect(toMarkdownSpy).toHaveBeenCalledTimes(0)
  })

  it("toMarkdown is reported strictly as 'none' (never 'fallback' or any other string) when absent", () => {
    const NoMarkdown = createBlockSpec({
      type: "strictlyNoneBlock",
      content: "inline*",
      parseDOM: [{ tag: "div.strictly-none" }],
      renderDOM: ({ HTMLAttributes }) => [
        "div",
        { ...HTMLAttributes, class: "rune-block strictly-none" },
        ["div", { class: "rune-block-content" }, 0],
      ],
    })
    const editor = createTestEditor({
      kit: { plugins: [{ id: "test-strictly-none", blockExtensions: [NoMarkdown] }] },
    })
    const ctx = getRuneSchemaContext(editor)
    const block = findBlock(ctx, "strictlyNoneBlock")
    expect(block).toBeDefined()
    // Strictly the literal "none" — not any other truthy string.
    expect(block!.output.markdown).toBe("none")
  })

  it("non-finite number prop defaults (NaN / Infinity / -Infinity) are dropped", () => {
    // JSON.stringify(NaN) === "null" — these values break the round-trip
    // equality promise if they leak into the projected context.
    const nanProp = { default: Number.NaN as unknown } as unknown as BlockPropSpec<unknown>
    const infProp = {
      default: Number.POSITIVE_INFINITY as unknown,
    } as unknown as BlockPropSpec<unknown>
    const negInfProp = {
      default: Number.NEGATIVE_INFINITY as unknown,
    } as unknown as BlockPropSpec<unknown>
    const NonFiniteBlock = createBlockSpec({
      type: "nonFiniteBlock",
      content: "inline*",
      props: {
        nan: nanProp,
        inf: infProp,
        negInf: negInfProp,
        ok: { default: 42 },
      },
      schemaContext: {
        examples: [
          { label: "non-finite", input: { type: "nonFiniteBlock", n: Number.NaN } },
        ],
      },
      parseDOM: [{ tag: "div.non-finite-block" }],
      renderDOM: ({ HTMLAttributes }) => [
        "div",
        { ...HTMLAttributes, class: "rune-block non-finite-block" },
        ["div", { class: "rune-block-content" }, 0],
      ],
    })
    const editor = createTestEditor({
      kit: { plugins: [{ id: "test-non-finite", blockExtensions: [NonFiniteBlock] }] },
    })
    const ctx = getRuneSchemaContext(editor)
    const block = findBlock(ctx, "nonFiniteBlock")
    expect(block).toBeDefined()
    // Finite sibling survives so we know we didn't nuke the prop map.
    expect(block!.props.ok!.default).toBe(42)
    // Non-finite defaults are dropped (no `default` field on those props).
    for (const propName of ["nan", "inf", "negInf"] as const) {
      const entry = block!.props[propName]
      if (entry) {
        expect(entry.default).toBeUndefined()
      }
    }
    // Round-trip equality must still hold — proves nothing leaked as NaN.
    expect(JSON.parse(JSON.stringify(ctx))).toEqual(ctx)
  })

  it("does not leak a live reference to the editor's indent config (mutation isolation)", () => {
    const editor = createTestEditor()
    const ctxA = getRuneSchemaContext(editor)
    // codeBlock declares indent: { mode: "numeric", maxDepth: 0 }.
    const codeBlockA = findBlock(ctxA, "codeBlock")
    expect(codeBlockA).toBeDefined()
    expect(codeBlockA!.indent).toEqual({ mode: "numeric", maxDepth: 0 })
    // Mutate the projected context's indent. If the projection aliased the
    // stored config object, this corrupts the running editor's indent config.
    ;(codeBlockA!.indent as { maxDepth: number }).maxDepth = 999
    // Fetch again — must reflect the original config, not the mutation.
    const ctxB = getRuneSchemaContext(editor)
    const codeBlockB = findBlock(ctxB, "codeBlock")
    expect(codeBlockB).toBeDefined()
    expect((codeBlockB!.indent as { maxDepth: number }).maxDepth).not.toBe(999)
    expect((codeBlockB!.indent as { maxDepth: number }).maxDepth).toBe(0)
  })

  it("cyclic schemaContext objects do not crash editor construction", () => {
    // Plugin authors can construct a cycle at runtime even though TypeScript
    // can't express one in an object literal. The factory's sanitize path
    // must handle this without stack overflow.
    type Cyclic = { kind: string; self?: Cyclic }
    const cyclic: Cyclic = { kind: "self-ref" }
    cyclic.self = cyclic
    const CyclicBlock = createBlockSpec({
      type: "cyclicBlock",
      content: "inline*",
      schemaContext: {
        examples: [
          {
            label: "cycle",
            input: {
              type: "cyclicBlock",
              loop: cyclic,
            } as unknown as import("../schema").RuneSchemaContextInputExample,
          },
        ],
      },
      parseDOM: [{ tag: "div.cyclic-block" }],
      renderDOM: ({ HTMLAttributes }) => [
        "div",
        { ...HTMLAttributes, class: "rune-block cyclic-block" },
        ["div", { class: "rune-block-content" }, 0],
      ],
    })
    const editor = createTestEditor({
      kit: { plugins: [{ id: "test-cyclic", blockExtensions: [CyclicBlock] }] },
    })
    const ctx = getRuneSchemaContext(editor)
    const block = findBlock(ctx, "cyclicBlock")
    expect(block).toBeDefined()
    // Round-trip safety — if a cycle had leaked through sanitize,
    // JSON.stringify would throw. We assert it doesn't.
    expect(() => JSON.stringify(ctx)).not.toThrow()
  })
})
