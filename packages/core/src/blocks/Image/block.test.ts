// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, expect, it } from "vitest"
import { DOMParser } from "@tiptap/pm/model"
import { createTestEditor } from "../../test-utils/createTestEditor"
import { getBlockSpecs } from "../../schema"
import { getDocument } from "../../api"
import {
  getDefaultSlashMenuItems,
  getMediaPopoverBlockId,
} from "../../index"

describe("Image block", () => {
  it("creates an atom image block with default attrs", () => {
    const editor = createTestEditor()
    const type = editor.schema.nodes.image

    expect(type).toBeDefined()
    expect(type!.isAtom).toBe(true)
    expect(type!.isBlock).toBe(true)

    const node = type!.create()
    expect(node.attrs.src).toBe("")
    expect(node.attrs.alt).toBe("")
    expect(node.attrs.title).toBeNull()
    expect(node.attrs.width).toBeNull()
    expect(node.attrs.height).toBeNull()
    expect(node.attrs.sourceUrl).toBeNull()
  })

  it("defaults contentWidth to null", () => {
    const editor = createTestEditor()
    const node = editor.schema.nodes.image!.create()

    expect(node.attrs.contentWidth).toBeNull()
  })

  it("parses an <img> into attrs", () => {
    const editor = createTestEditor()

    editor.commands.setContent(
      '<img src="https://example.com/a.png" alt="Alt text" title="Advisory" width="640" height="480">',
    )

    const node = editor.state.doc.firstChild
    expect(node?.type.name).toBe("image")
    expect(node?.attrs.src).toBe("https://example.com/a.png")
    expect(node?.attrs.alt).toBe("Alt text")
    expect(node?.attrs.title).toBe("Advisory")
    expect(node?.attrs.width).toBe(640)
    expect(node?.attrs.height).toBe(480)
    expect(node?.attrs.contentWidth).toBeNull()
  })

  it("renderDOM produces empty placeholder chrome when src is empty", () => {
    const editor = createTestEditor({
      content: {
        type: "doc",
        content: [{ type: "image", attrs: { id: "img-empty", depth: 0 } }],
      } as never,
    })

    const outer = editor.view.dom.querySelector<HTMLElement>(".rune-block.rune-image.rune-image-empty")
    expect(outer).not.toBeNull()
    expect(outer!.getAttribute("data-id")).toBe("img-empty")

    const content = outer!.querySelector<HTMLElement>(":scope > .rune-block-content")
    const icon = content!.querySelector<SVGSVGElement>(".rune-image-empty-icon-svg")
    expect(content).not.toBeNull()
    expect(icon).not.toBeNull()
    expect(icon!.namespaceURI).toBe("http://www.w3.org/2000/svg")
    expect(content!.querySelector(".rune-image-empty-label")?.textContent).toBe("Add an image")
  })

  it("renderDOM produces image chrome when src is set", () => {
    const editor = createTestEditor({
      content: {
        type: "doc",
        content: [
          {
            type: "image",
            attrs: {
              id: "img-real",
              depth: 0,
              src: "https://example.com/a.png",
              alt: "A",
              title: "Advisory",
              width: 640,
              height: 480,
            },
          },
        ],
      } as never,
    })

    const outer = editor.view.dom.querySelector<HTMLElement>(".rune-block.rune-image")
    const img = outer?.querySelector<HTMLImageElement>('img[data-rune-image]')

    expect(outer).not.toBeNull()
    expect(outer!.hasAttribute("src")).toBe(false)
    expect(outer!.hasAttribute("alt")).toBe(false)
    expect(img).not.toBeNull()
    expect(img!.getAttribute("src")).toBe("https://example.com/a.png")
    expect(img!.getAttribute("alt")).toBe("A")
    expect(img!.getAttribute("title")).toBe("Advisory")
    expect(img!.getAttribute("width")).toBe("640")
    expect(img!.getAttribute("height")).toBe("480")
    // Native HTML5 image drag must be off so it doesn't trigger
    // prosemirror-dropcursor and compete with side-menu block drag.
    expect(img!.getAttribute("draggable")).toBe("false")
  })

  it("renders explicit contentWidth on the image content frame only", () => {
    const editor = createTestEditor({
      content: {
        type: "doc",
        content: [
          {
            type: "image",
            attrs: {
              id: "img-resized",
              src: "https://example.com/a.png",
              alt: "A",
              width: 640,
              height: 480,
              contentWidth: 45,
            },
          },
        ],
      } as never,
    })

    const outer = editor.view.dom.querySelector<HTMLElement>('.rune-block.rune-image[data-id="img-resized"]')
    const content = outer?.querySelector<HTMLElement>(":scope > .rune-block-content")
    const img = content?.querySelector<HTMLImageElement>('img[data-rune-image]')

    expect(outer).not.toBeNull()
    expect(content).not.toBeNull()
    expect(img).not.toBeNull()
    expect(outer!.getAttribute("style") ?? "").not.toContain("width: 45%")
    expect(content!.getAttribute("style") ?? "").toContain("width: 45%")
    expect(content!.hasAttribute("data-rune-resized")).toBe(true)
  })

  it("mounts resize handles for populated editable images", () => {
    const editor = createTestEditor({
      content: {
        type: "doc",
        content: [
          {
            type: "image",
            attrs: {
              id: "img-handles",
              src: "https://example.com/a.png",
              alt: "A",
            },
          },
        ],
      } as never,
    })

    const outer = editor.view.dom.querySelector<HTMLElement>(
      '.rune-block.rune-image[data-id="img-handles"]',
    )

    expect(outer?.querySelector(".rune-resize-host")).not.toBeNull()
    expect(outer?.querySelector(".rune-resize-handle--start")).not.toBeNull()
    expect(outer?.querySelector(".rune-resize-handle--end")).not.toBeNull()
  })

  it("does not mount resize handles for empty image placeholders", () => {
    const editor = createTestEditor({
      content: {
        type: "doc",
        content: [{ type: "image", attrs: { id: "img-empty-handles" } }],
      } as never,
    })

    const outer = editor.view.dom.querySelector<HTMLElement>(
      '.rune-block.rune-image-empty[data-id="img-empty-handles"]',
    )

    expect(outer?.querySelector(".rune-resize-handle")).toBeNull()
  })

  it("preserves depth style while adding --block-pad-top", () => {
    const editor = createTestEditor({
      content: {
        type: "doc",
        content: [
          {
            type: "image",
            attrs: {
              id: "img-depth",
              depth: 2,
              src: "https://example.com/a.png",
            },
          },
        ],
      } as never,
    })

    const outer = editor.view.dom.querySelector<HTMLElement>('.rune-block[data-id="img-depth"]')
    const style = outer?.getAttribute("style") ?? ""

    expect(outer).not.toBeNull()
    expect(outer!.getAttribute("data-depth")).toBe("2")
    expect(style).toContain("--rune-block-depth: 2")
    expect(style).toContain("--block-pad-top")
  })

  it("clipboardRenderDOM emits a bare img", () => {
    const editor = createTestEditor()
    const spec = getBlockSpecs(editor).image
    const node = editor.schema.nodes.image!.create({
      src: "https://example.com/a.png",
      alt: "Alt",
      title: "Advisory",
      width: 640,
      height: 480,
    })

    expect(spec?.clipboardRenderDOM?.({ node })).toEqual([
      "img",
      { src: "https://example.com/a.png", alt: "Alt", title: "Advisory" },
    ])
  })

  it("clipboardRenderDOM suppresses img when src is empty", () => {
    const editor = createTestEditor()
    const spec = getBlockSpecs(editor).image
    const node = editor.schema.nodes.image!.create({ src: "", alt: "" })

    expect(spec?.clipboardRenderDOM?.({ node })).toEqual(["span"])
  })

  it("toRuneBlock exposes public image attrs", () => {
    const editor = createTestEditor()
    const spec = getBlockSpecs(editor).image
    const node = editor.schema.nodes.image!.create({
      id: "img1",
      depth: 1,
      src: "https://cdn.example/a.png",
      alt: "Alt",
      title: "Advisory",
      width: 640,
      height: 480,
      sourceUrl: "https://source.example/a.png",
    })

    expect(spec?.toRuneBlock?.(node)).toEqual({
      type: "image",
      id: "img1",
      depth: 1,
      src: "https://cdn.example/a.png",
      alt: "Alt",
      title: "Advisory",
      width: 640,
      height: 480,
      sourceUrl: "https://source.example/a.png",
    })
  })

  it("round-trips image contentWidth through public projection and fromInput", () => {
    const editor = createTestEditor()
    const spec = getBlockSpecs(editor).image
    const node = editor.schema.nodes.image!.create({
      id: "img1",
      depth: 1,
      src: "https://cdn.example/a.png",
      alt: "Alt",
      width: 640,
      height: 480,
      contentWidth: 37,
    })

    expect(spec?.toRuneBlock?.(node)).toMatchObject({
      type: "image",
      id: "img1",
      depth: 1,
      src: "https://cdn.example/a.png",
      alt: "Alt",
      width: 640,
      height: 480,
      contentWidth: 37,
    })

    const built = spec?.fromInput?.({
      schema: editor.schema,
      input: {
        type: "image",
        id: "img2",
        src: "https://cdn.example/b.png",
        alt: "B",
        title: "Imported title",
        contentWidth: 2,
      },
      defaults: { depth: 0 },
      editor,
    })

    expect(built?.attrs.contentWidth).toBe(10)
    expect(built?.attrs.title).toBe("Imported title")
  })

  it("round-trips image contentWidth through generated HTML", () => {
    const source = createTestEditor({
      content: {
        type: "doc",
        content: [
          {
            type: "image",
            attrs: {
              id: "img-html",
              src: "https://cdn.example/a.png",
              alt: "Alt",
              width: 640,
              height: 480,
              contentWidth: 45,
            },
          },
        ],
      } as never,
    })
    const target = createTestEditor()

    target.commands.setContent(source.getHTML())

    expect(getDocument(target)).toMatchObject([
      {
        type: "image",
        id: "img-html",
        src: "https://cdn.example/a.png",
        alt: "Alt",
        width: 640,
        height: 480,
        contentWidth: 45,
      },
    ])
  })

  it("round-trips non-resized image chrome through generated HTML", () => {
    const source = createTestEditor({
      content: {
        type: "doc",
        content: [
          {
            type: "image",
            attrs: {
              id: "img-html-natural",
              depth: 2,
              src: "https://cdn.example/natural.png",
              alt: "Natural",
              width: 800,
              height: 600,
            },
          },
        ],
      } as never,
    })
    const target = createTestEditor()

    target.commands.setContent(source.getHTML())

    expect(getDocument(target)).toEqual([
      {
        type: "image",
        id: "img-html-natural",
        depth: 2,
        src: "https://cdn.example/natural.png",
        alt: "Natural",
        width: 800,
        height: 600,
      },
    ])
  })

  it("round-trips empty image chrome through generated HTML", () => {
    const source = createTestEditor({
      content: {
        type: "doc",
        content: [
          {
            type: "image",
            attrs: {
              id: "img-empty-html",
              depth: 2,
            },
          },
        ],
      } as never,
    })
    const target = createTestEditor()

    target.commands.setContent(source.getHTML())

    expect(getDocument(target)).toEqual([
      {
        type: "image",
        id: "img-empty-html",
        depth: 2,
        src: "",
        alt: "",
        width: null,
        height: null,
      },
    ])
  })

  it("insertBlocks exposes image contentWidth through getDocument", () => {
    const editor = createTestEditor({
      content: { type: "doc", content: [] } as never,
    })

    expect(
      editor.commands.insertBlocks([
        {
          type: "image",
          id: "img-inserted",
          src: "https://cdn.example/a.png",
          alt: "Alt",
          contentWidth: 500,
        },
      ] as never),
    ).toBe(true)

    expect(getDocument(editor)).toMatchObject([
      {
        type: "image",
        id: "img-inserted",
        src: "https://cdn.example/a.png",
        alt: "Alt",
        contentWidth: 100,
      },
    ])
  })

  it("declares draggable side-menu metadata", () => {
    const editor = createTestEditor()
    const spec = getBlockSpecs(editor).image
    expect(spec?.sideMenu).toEqual({ draggable: true })
  })

  it("declares resize support metadata", () => {
    const editor = createTestEditor()
    const spec = getBlockSpecs(editor).image

    expect(spec?.supports).toMatchObject({
      resize: true,
      mediaSource: true,
    })
  })

  it("parseDOM turns data-rune-paste-image into a transient pending paste image", () => {
    // Parse via PM's DOMParser directly so we observe the parsed attrs
    // before appendTransaction (in the ImageImport plugin) clears
    // pendingFromPaste. Going through editor.commands.setContent would
    // dispatch a transaction and the marker would be wiped before the
    // assertion runs.
    const editor = createTestEditor()
    const parser = DOMParser.fromSchema(editor.schema)
    const container = document.createElement("div")
    container.innerHTML =
      '<img data-rune-paste-image="https://source.example/pasted.png" alt="Pasted alt">'
    const doc = parser.parse(container)

    const node = doc.firstChild
    expect(node?.type.name).toBe("image")
    expect(node?.attrs).toMatchObject({
      src: "",
      alt: "Pasted alt",
      width: null,
      height: null,
      pendingFromPaste: "https://source.example/pasted.png",
    })
    // parseDOM does NOT eager-mint an id for paste-routed blocks;
    // BlockId's appendTransaction stamps one once the node lands in a
    // dispatched transaction (verified by the import-plugin paste tests).
    expect(node?.attrs.id).toBeNull()
  })

  it("parseDOM leaves normal img pendingFromPaste null", () => {
    const editor = createTestEditor()

    editor.commands.setContent('<img src="https://example.com/raw.png">')

    expect(editor.state.doc.firstChild?.attrs).toMatchObject({
      src: "https://example.com/raw.png",
      pendingFromPaste: null,
    })
  })

  it("toRuneBlock never exposes pendingFromPaste", () => {
    const editor = createTestEditor()
    const spec = getBlockSpecs(editor).image
    const node = editor.schema.nodes.image!.create({
      id: "img1",
      src: "",
      alt: "",
      width: null,
      height: null,
      pendingFromPaste: "https://source.example/pasted.png",
    })

    const block = spec?.toRuneBlock?.(node)

    expect(block).toMatchObject({
      type: "image",
      id: "img1",
      src: "",
    })
    expect(block).not.toHaveProperty("pendingFromPaste")
  })

  it("exposes an image slash item that is not a turn-into target", () => {
    const editor = createTestEditor()
    const item = getDefaultSlashMenuItems(editor).find((i) => i.key === "image")

    expect(item).toBeDefined()
    expect(item).toMatchObject({
      key: "image",
      title: "Image",
      group: "Media",
      aliases: expect.arrayContaining(["image", "photo", "picture"]),
    })
    expect(item!.block).toBeUndefined()
    expect(typeof item!.onItemClick).toBe("function")
  })

  it("image slash item inserts an eager-id image at source depth and opens its popover", () => {
    const editor = createTestEditor({
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { id: "p1", depth: 2 },
            content: [{ type: "text", text: "/" }],
          },
        ],
      } as never,
    })
    const item = getDefaultSlashMenuItems(editor).find((i) => i.key === "image")!

    item.onItemClick({
      editor,
      range: { from: 1, to: 2 },
      triggerCharacter: "/",
    })

    const doc = getDocument(editor)
    expect(doc).toHaveLength(2)
    expect(doc[0]).toMatchObject({
      type: "image",
      depth: 2,
      src: "",
      alt: "",
      width: null,
      height: null,
    })
    expect(doc[0]!.id).toMatch(/^[\w-]{8}$/)
    expect(getMediaPopoverBlockId(editor)).toBe(doc[0]!.id)
  })

  it("image slash item no-ops while read-only", () => {
    const editor = createTestEditor({
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { id: "p1", depth: 2 },
            content: [{ type: "text", text: "/" }],
          },
        ],
      } as never,
    })
    const item = getDefaultSlashMenuItems(editor).find((i) => i.key === "image")!

    editor.setEditable(false)
    item.onItemClick({
      editor,
      range: { from: 1, to: 2 },
      triggerCharacter: "/",
    })

    expect(getDocument(editor)).toEqual([
      {
        type: "paragraph",
        id: "p1",
        depth: 2,
        text: "/",
      },
    ])
    expect(getMediaPopoverBlockId(editor)).toBeNull()
  })
})
