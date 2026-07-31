// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, expect, it } from "vitest"
import { Extension } from "@tiptap/core"
import {
  RUNE_BODY_BLOCKS,
  deriveBlockIdTypes,
  isFactoryBuiltBlockExtension,
} from "../defaultBlocks"
import { MediaImport, MediaPopover, EquationBlockCommands } from "../index"

describe("RUNE_BODY_BLOCKS", () => {
  it("contains only factory-built top-level body blocks", () => {
    const names = RUNE_BODY_BLOCKS.map((ext) => ext.name)

    expect(names).toEqual([
      "paragraph",
      "heading",
      "divider",
      "equationBlock",
      "image",
      "video",
      "audio",
      "bulletList",
      "numberedList",
      "taskList",
      "blockquote",
      "callout",
      "codeBlock",
      "toggle",
      "table",
      "tableOfContents",
      "rawBlock",
    ])
    expect(names).not.toContain("mediaImport")
    expect(names).not.toContain("mediaPopover")
    expect(names).not.toContain("equationBlockCommands")
  })

  it("identifies factory-built block extensions by static metadata", () => {
    expect(isFactoryBuiltBlockExtension(RUNE_BODY_BLOCKS[0]!)).toBe(true)
    expect(isFactoryBuiltBlockExtension(MediaImport)).toBe(false)
    expect(isFactoryBuiltBlockExtension(MediaPopover)).toBe(false)
    expect(isFactoryBuiltBlockExtension(EquationBlockCommands)).toBe(false)
    expect(isFactoryBuiltBlockExtension(Extension.create({ name: "plain" }))).toBe(false)
  })

  it("recognises configured factory-built block extensions", () => {
    const configured = RUNE_BODY_BLOCKS[0]!.configure({})
    expect(isFactoryBuiltBlockExtension(configured)).toBe(true)
  })

  it("derives BlockId types from configured factory-built blocks", () => {
    const configured = RUNE_BODY_BLOCKS.map((ext) => ext.configure({}))
    const types = deriveBlockIdTypes(configured)
    expect(types).toHaveLength(17)
    expect(types).toContain("paragraph")
    expect(types).toContain("table")
    expect(types).not.toContain("columnLayout")
    expect(types).not.toContain("column")
  })

  it("derives BlockId types from factory-built block metadata only", () => {
    expect(deriveBlockIdTypes([
      ...RUNE_BODY_BLOCKS,
      MediaImport,
      MediaPopover,
      EquationBlockCommands,
      Extension.create({ name: "plainSupport" }),
    ])).toEqual([
      "paragraph",
      "heading",
      "divider",
      "equationBlock",
      "image",
      "video",
      "audio",
      "bulletList",
      "numberedList",
      "taskList",
      "blockquote",
      "callout",
      "codeBlock",
      "toggle",
      "table",
      "tableOfContents",
      "rawBlock",
    ])
  })
})
