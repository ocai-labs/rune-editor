// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, expect, it } from "vitest"
import {
  Blockquote,
  CodeBlock,
  InlineMath,
  MathController,
  Toggle,
  TextStyleWithColorAttrs,
  TextColor,
  BackgroundColor,
  ToggleBodyPlugin,
  expandCollapsedToggles,
  findCollapsedToggleContaining,
  mathControllerKey,
  mediaResultToAttrs,
  normalizeMediaUrlInput,
  toggleBodyKey,
  toggleBodyRange,
  validateMediaImportResult,
} from "./index"
import {
  mediaResultToAttrs as mediaResultToAttrsFromBlocks,
  normalizeMediaUrlInput as normalizeMediaUrlInputFromBlocks,
  validateMediaImportResult as validateMediaImportResultFromBlocks,
} from "./blocks"
import * as core from "./index"
import type {
  MediaEmbedProvider,
  MediaSourceAttrs,
  RuneBlockquoteBlock,
  RuneCodeBlock,
  RuneImportMediaFile,
  RuneImportMediaUrl,
  RuneMediaImportContext,
  RuneMediaImportResult,
  RuneSchemaContext,
  SourcedBlockKind,
  RuneToggleBlock,
  ToggleBodyOptions,
  ToggleLevel,
} from "./index"

describe("public core exports", () => {
  it("exposes built-in block surfaces from the package root", () => {
    const quote: RuneBlockquoteBlock = {
      type: "blockquote",
      id: "quote",
      depth: 0,
      text: "Quote",
    }
    const code: RuneCodeBlock = {
      type: "codeBlock",
      id: "code",
      depth: 0,
      text: "code",
      language: null,
    }
    const level: ToggleLevel = 3
    const toggle: RuneToggleBlock = {
      type: "toggle",
      id: "toggle",
      depth: 0,
      level,
      expanded: false,
      text: "Toggle",
    }

    expect(Blockquote).toBeDefined()
    expect(CodeBlock).toBeDefined()
    expect(Toggle).toBeDefined()
    expect(quote.type).toBe("blockquote")
    expect(code.type).toBe("codeBlock")
    expect(toggle.type).toBe("toggle")
  })

  it("exposes core math extension surfaces from the package root", () => {
    expect(InlineMath).toBeDefined()
    expect(MathController).toBeDefined()
    expect(typeof mathControllerKey.getState).toBe("function")
  })

  it("exposes inline color extensions without block-color APIs", () => {
    expect(TextStyleWithColorAttrs).toBeDefined()
    expect(TextColor).toBeDefined()
    expect(BackgroundColor).toBeDefined()
    expect("BlockTextColor" in core).toBe(false)
    expect("BlockBackgroundColor" in core).toBe(false)
    expect("setBlockColor" in core).toBe(false)
  })

  it("exposes first-class toggle helpers from the package root", () => {
    const options: ToggleBodyOptions = {
      emptyPlaceholder: "Empty toggle",
      titlePlaceholder: "Toggle",
    }

    expect(ToggleBodyPlugin).toBeDefined()
    expect(toggleBodyKey).toBeDefined()
    expect(typeof toggleBodyRange).toBe("function")
    expect(typeof findCollapsedToggleContaining).toBe("function")
    expect(typeof expandCollapsedToggles).toBe("function")
    expect(options.titlePlaceholder).toBe("Toggle")
  })

  it("exposes media source helpers from blocks and the package root", () => {
    const kind: SourcedBlockKind = "video"
    const provider: MediaEmbedProvider = "youtube"
    const context: RuneMediaImportContext = {
      blockId: "media1",
      kind,
      nodeName: "video",
      source: "embed",
    }
    const result: RuneMediaImportResult = {
      kind: "asset",
      src: "/clip.mp4",
      title: context.nodeName,
    }
    const attrs: MediaSourceAttrs = mediaResultToAttrs(result)
    const importFile: RuneImportMediaFile = async () => result
    const importUrl: RuneImportMediaUrl = async (url) => ({
      kind: "asset",
      src: url,
    })

    expect(normalizeMediaUrlInput(kind, "https://youtu.be/dQw4w9WgXcQ")).toMatchObject({
      kind: "embed",
      provider,
    })
    expect(validateMediaImportResult(kind, result)).toMatchObject({ ok: true })
    expect(attrs.title).toBe("video")
    expect(typeof mediaResultToAttrsFromBlocks).toBe("function")
    expect(typeof normalizeMediaUrlInputFromBlocks).toBe("function")
    expect(typeof validateMediaImportResultFromBlocks).toBe("function")
    expect(importFile).toBeDefined()
    expect(importUrl).toBeDefined()
  })

  it("exports exportMarkdown", () => {
    expect(typeof core.exportMarkdown).toBe("function")
  })

  it("exports exportMarkdownFromDoc", () => {
    expect(typeof core.exportMarkdownFromDoc).toBe("function")
  })

  it("exports getRuneSchemaContext", () => {
    expect(typeof core.getRuneSchemaContext).toBe("function")
    const ctx: RuneSchemaContext | undefined = undefined
    expect(ctx).toBeUndefined()
  })

  it("exports schemaContext input metadata types for plugin authors", () => {
    // Type-level assertions only — these types let third-party plugin
    // authors declare schemaContext literals without reaching into
    // subpath imports (package.json only exposes ".").
    const json: core.JsonValue = { count: 1, name: "ok", flags: [true, null] }
    const propMeta: core.RuneSchemaContextPropMetadata = {
      type: "string",
      default: "x",
      description: "example",
      values: ["x", "y"],
    }
    const propType: core.RuneSchemaContextPropType = "boolean"
    const example: core.RuneSchemaContextInputExample = {
      type: "myBlock",
      text: "hello",
    }
    const spec: core.RuneBlockSchemaContextSpec = {
      description: "A plugin block",
      input: { description: "input", examples: [example] },
      props: { mode: { type: "string", description: "mode", values: ["a", "b"] } },
    }
    expect(json.count).toBe(1)
    expect(propMeta.type).toBe("string")
    expect(propType).toBe("boolean")
    expect(spec.description).toBe("A plugin block")
  })

  it("exports in-place attr declaration types for block spec authors", () => {
    // Type-level assertions only — plugin blocks declare these literals
    // in their `createBlockSpec({ inPlaceAttrs })` config.
    const pair: core.RuneInPlaceAttr = {
      attr: "tint",
      applyToDOM: (target: core.RuneInPlaceAttrTarget, value) => {
        if (!target.content) return false
        target.content.setAttribute("data-tint", String(value))
      },
    }
    expect(pair.attr).toBe("tint")
  })

  it("exports default block manifest helpers", () => {
    expect(core.RUNE_BODY_BLOCKS.map((ext) => ext.name)).toContain("paragraph")
    expect(core.RUNE_BODY_BLOCK_ID_TYPES).toContain("paragraph")
    expect(core.deriveBlockIdTypes(core.RUNE_BODY_BLOCKS)).toContain("table")
    expect(core.isFactoryBuiltBlockExtension(core.RUNE_BODY_BLOCKS[0]!)).toBe(true)
  })

  it("exports RunePlugin type through CreateRuneKitOptions", () => {
    const plugin: core.RunePlugin = {
      id: "public-plugin",
      blockExtensions: [],
      extensions: [],
    }
    expect(plugin.id).toBe("public-plugin")
  })

  it("exports manifest contract helpers", () => {
    expect(typeof core.createRuneKit).toBe("function")
    expect(Array.isArray(core.RUNE_BODY_BLOCKS)).toBe(true)
    expect(typeof core.deriveBlockIdTypes).toBe("function")
    expect(typeof core.getBlockSpecs).toBe("function")
    expect(typeof core.isStructuralIndentType).toBe("function")
  })

  it("keeps the DOM-only toggle paste flattener internal", () => {
    expect("transformToggleHTML" in core).toBe(false)
  })

  it("exports body-surface resolver helpers and their shape types", () => {
    expect(typeof core.resolveBodyBlockById).toBe("function")
    expect(typeof core.forEachBodyBlock).toBe("function")
    expect(typeof core.nearestBodyBlock).toBe("function")
    expect(typeof core.bodyBlocksInRange).toBe("function")

    // Type-level assertions only — consumers (later tasks) build these shapes.
    const resolved: core.ResolvedBodyBlock | null = null
    const nearest: core.NearestBodyBlock | null = null
    const inRange: core.BodyBlockInRange[] = []
    expect(resolved).toBeNull()
    expect(nearest).toBeNull()
    expect(inRange).toEqual([])
  })

  it("exports AI-facing API readiness helpers", () => {
    expect(typeof core.getBlockOutline).toBe("function")
    expect(typeof core.getBlockSnapshot).toBe("function")
    expect(typeof core.getSelectionSnapshot).toBe("function")
    expect(typeof core.replaceSelectionText).toBe("function")
    expect(typeof core.runeCommandOk).toBe("function")
    expect(typeof core.runeCommandError).toBe("function")
  })
})
