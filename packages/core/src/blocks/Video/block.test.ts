// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, expect, it } from "vitest"
import { getDocument } from "../../api"
import { getBlockSpecs } from "../../schema"
import { createTestEditor } from "../../test-utils/createTestEditor"
import { getDefaultSlashMenuItems } from "../../index"

const videoAttrs = {
  sourceType: "embed",
  src: "",
  embedUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ",
  provider: "youtube",
  sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  title: "Demo video",
  width: 640,
  height: 360,
} as const

describe("Video block", () => {
  it("creates an atom video block with default attrs", () => {
    const editor = createTestEditor()
    const type = editor.schema.nodes.video

    expect(type).toBeDefined()
    expect(type!.isAtom).toBe(true)
    expect(type!.isBlock).toBe(true)

    const node = type!.create()
    expect(node.attrs).toMatchObject({
      sourceType: "asset",
      src: "",
      embedUrl: null,
      provider: null,
      sourceUrl: null,
      title: "",
      width: null,
      height: null,
    })
  })

  it("defaults contentWidth to null", () => {
    const editor = createTestEditor()
    const node = editor.schema.nodes.video!.create()

    expect(node.attrs.contentWidth).toBeNull()
  })

  it("renderDOM produces empty placeholder chrome when no source is set", () => {
    const editor = createTestEditor({
      content: {
        type: "doc",
        content: [{ type: "video", attrs: { id: "vid-empty", depth: 0 } }],
      } as never,
    })

    const outer = editor.view.dom.querySelector<HTMLElement>(
      ".rune-block.rune-video.rune-media-empty",
    )
    const content = outer?.querySelector<HTMLElement>(":scope > .rune-block-content")

    expect(outer).not.toBeNull()
    expect(outer!.getAttribute("data-id")).toBe("vid-empty")
    expect(content).not.toBeNull()
    expect(content!.querySelector(".rune-media-empty-control")).not.toBeNull()
    expect(content!.querySelector(".rune-media-empty-icon-svg")).not.toBeNull()
    expect(content!.querySelector(".rune-media-empty-label")?.textContent).toBe(
      "Add a video",
    )
    expect(outer!.getAttribute("style") ?? "").toContain("--block-pad-top")
  })

  it("renderDOM produces video chrome for direct assets", () => {
    const editor = createTestEditor({
      content: {
        type: "doc",
        content: [
          {
            type: "video",
            attrs: {
              id: "vid-asset",
              depth: 0,
              sourceType: "asset",
              src: "https://cdn.example.com/demo.mp4",
              title: "Asset video",
              width: 640,
              height: 360,
            },
          },
        ],
      } as never,
    })

    const outer = editor.view.dom.querySelector<HTMLElement>(".rune-block.rune-video")
    const video = outer?.querySelector<HTMLVideoElement>("video[data-rune-video]")

    expect(outer).not.toBeNull()
    expect(video).not.toBeNull()
    expect(video!.getAttribute("src")).toBe("https://cdn.example.com/demo.mp4")
    expect(video!.getAttribute("title")).toBe("Asset video")
    expect(video!.getAttribute("width")).toBe("640")
    expect(video!.getAttribute("height")).toBe("360")
    expect(video!.hasAttribute("controls")).toBe(true)
  })

  it("parses raw direct video with contentWidth null", () => {
    const editor = createTestEditor()

    editor.commands.setContent(
      '<video src="https://cdn.example.com/demo.mp4" title="Asset video" width="640" height="360"></video>',
    )

    expect(editor.state.doc.firstChild?.attrs).toMatchObject({
      sourceType: "asset",
      src: "https://cdn.example.com/demo.mp4",
      title: "Asset video",
      width: 640,
      height: 360,
      contentWidth: null,
    })
  })

  it("parses raw direct video source children with contentWidth null", () => {
    const editor = createTestEditor()

    editor.commands.setContent(
      '<video title="Asset video" width="640" height="360"><source src="https://cdn.example.com/demo.mp4"></video>',
    )

    expect(editor.state.doc.firstChild?.attrs).toMatchObject({
      sourceType: "asset",
      src: "https://cdn.example.com/demo.mp4",
      title: "Asset video",
      width: 640,
      height: 360,
      contentWidth: null,
    })
  })

  it("renders explicit contentWidth on the video content frame only", () => {
    const editor = createTestEditor({
      content: {
        type: "doc",
        content: [
          {
            type: "video",
            attrs: {
              id: "vid-resized",
              sourceType: "asset",
              src: "https://cdn.example.com/demo.mp4",
              title: "Asset video",
              width: 640,
              height: 360,
              contentWidth: 100,
            },
          },
        ],
      } as never,
    })

    const outer = editor.view.dom.querySelector<HTMLElement>('.rune-block.rune-video[data-id="vid-resized"]')
    const content = outer?.querySelector<HTMLElement>(":scope > .rune-block-content")

    expect(outer).not.toBeNull()
    expect(content).not.toBeNull()
    expect(outer!.getAttribute("style") ?? "").not.toContain("width: 100%")
    expect(content!.getAttribute("style") ?? "").toContain("width: 100%")
    expect(content!.hasAttribute("data-rune-resized")).toBe(true)
  })

  it("mounts resize handles for populated editable videos", () => {
    const editor = createTestEditor({
      content: {
        type: "doc",
        content: [{ type: "video", attrs: { id: "vid-handles", ...videoAttrs } }],
      } as never,
    })

    const outer = editor.view.dom.querySelector<HTMLElement>(
      '.rune-block.rune-video[data-id="vid-handles"]',
    )

    expect(outer?.querySelector(".rune-resize-host")).not.toBeNull()
    expect(outer?.querySelector(".rune-resize-handle--start")).not.toBeNull()
    expect(outer?.querySelector(".rune-resize-handle--end")).not.toBeNull()
  })

  it.each(["javascript:alert(1)", "vbscript:msgbox(1)"])(
    "rejects blocked direct video src %s during parseDOM",
    (src) => {
      const editor = createTestEditor()

      editor.commands.setContent(`<video src="${src}" title="Bad"></video>`)

      expect(getDocument(editor).some((block) => block.type === "video")).toBe(
        false,
      )
      expect(editor.view.dom.querySelector(".rune-block.rune-video")).toBeNull()
    },
  )

  it("renderDOM produces provider iframe chrome for valid embeds", () => {
    const editor = createTestEditor({
      content: {
        type: "doc",
        content: [{ type: "video", attrs: { id: "vid-embed", ...videoAttrs } }],
      } as never,
    })

    const outer = editor.view.dom.querySelector<HTMLElement>(".rune-block.rune-video")
    const iframe = outer?.querySelector<HTMLIFrameElement>(
      'iframe[data-rune-media-embed]',
    )

    expect(outer).not.toBeNull()
    expect(iframe).not.toBeNull()
    expect(iframe!.getAttribute("src")).toBe(videoAttrs.embedUrl)
    expect(iframe!.getAttribute("title")).toBe(videoAttrs.title)
    expect(iframe!.getAttribute("loading")).toBe("lazy")
    expect(iframe!.getAttribute("referrerpolicy")).toBe(
      "strict-origin-when-cross-origin",
    )
    expect(iframe!.hasAttribute("allowfullscreen")).toBe(true)
    expect(iframe!.getAttribute("allow")).toContain("autoplay")
  })

  it("parses YouTube iframe HTML through canonical validated embed attrs", () => {
    const editor = createTestEditor()
    const sourceUrl =
      "https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1"

    editor.commands.setContent(
      `<iframe src="${sourceUrl}" title="YouTube clip" width="640" height="360"></iframe>`,
    )

    expect(getDocument(editor)).toMatchObject([
      {
        type: "video",
        sourceType: "embed",
        src: "",
        embedUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ",
        provider: "youtube",
        sourceUrl,
        title: "YouTube clip",
        width: 640,
        height: 360,
      },
    ])
    expect(
      editor.view.dom.querySelector<HTMLIFrameElement>(
        'iframe[data-rune-media-embed]',
      )?.getAttribute("src"),
    ).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ")
    expect(editor.state.doc.firstChild?.attrs.contentWidth).toBeNull()
  })

  it("parses Vimeo iframe HTML through canonical validated embed attrs", () => {
    const editor = createTestEditor()
    const sourceUrl = "https://player.vimeo.com/video/123456789?badge=0"

    editor.commands.setContent(
      `<iframe src="${sourceUrl}" title="Vimeo clip" width="640" height="360"></iframe>`,
    )

    expect(getDocument(editor)).toMatchObject([
      {
        type: "video",
        sourceType: "embed",
        src: "",
        embedUrl: "https://player.vimeo.com/video/123456789",
        provider: "vimeo",
        sourceUrl,
        title: "Vimeo clip",
        width: 640,
        height: 360,
      },
    ])
    expect(
      editor.view.dom.querySelector<HTMLIFrameElement>(
        'iframe[data-rune-media-embed]',
      )?.getAttribute("src"),
    ).toBe("https://player.vimeo.com/video/123456789")
  })

  it("sanitizes invalid parsed video iframe dimensions to null", () => {
    const editor = createTestEditor()
    const sourceUrl = "https://www.youtube.com/embed/dQw4w9WgXcQ"

    editor.commands.setContent(
      `<iframe src="${sourceUrl}" title="YouTube clip" width="-1" height="bad"></iframe>`,
    )

    expect(getDocument(editor)).toMatchObject([
      {
        type: "video",
        sourceType: "embed",
        src: "",
        embedUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ",
        provider: "youtube",
        sourceUrl,
        title: "YouTube clip",
        width: null,
        height: null,
      },
    ])
    expect(
      editor.view.dom.querySelector<HTMLIFrameElement>(
        'iframe[data-rune-media-embed]',
      )?.getAttribute("src"),
    ).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ")
  })

  it("rejects malformed video iframe HTML during parseDOM", () => {
    const editor = createTestEditor()

    editor.commands.setContent(
      '<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ/evil" title="Bad"></iframe>',
    )

    expect(getDocument(editor).some((block) => block.type === "video")).toBe(
      false,
    )
    expect(editor.view.dom.querySelector(".rune-block.rune-video")).toBeNull()
  })

  it("renders invalid persisted embed attrs as an empty placeholder", () => {
    const editor = createTestEditor({
      content: {
        type: "doc",
        content: [
          {
            type: "video",
            attrs: {
              id: "vid-invalid",
              sourceType: "embed",
              provider: "youtube",
              sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
              embedUrl: "https://evil.example.com/embed/dQw4w9WgXcQ",
            },
          },
        ],
      } as never,
    })

    const outer = editor.view.dom.querySelector<HTMLElement>(
      ".rune-block.rune-video.rune-media-empty",
    )

    expect(outer).not.toBeNull()
    expect(outer!.querySelector("iframe")).toBeNull()
    expect(outer!.querySelector(".rune-media-empty-label")?.textContent).toBe(
      "Add a video",
    )
  })

  it("toRuneBlock and fromInput expose persisted attrs", () => {
    const editor = createTestEditor()
    const spec = getBlockSpecs(editor).video
    const node = editor.schema.nodes.video!.create({
      id: "vid1",
      depth: 1,
      ...videoAttrs,
    })

    expect(spec?.toRuneBlock?.(node)).toEqual({
      type: "video",
      id: "vid1",
      depth: 1,
      ...videoAttrs,
    })

    const built = spec?.fromInput?.({
      schema: editor.schema,
      input: { type: "video", id: "vid2", depth: 2, ...videoAttrs },
      defaults: { depth: 0 },
      editor,
    })

    expect(built?.type.name).toBe("video")
    expect(built?.attrs).toMatchObject({
      id: "vid2",
      depth: 2,
      ...videoAttrs,
    })
  })

  it("round-trips video contentWidth through public projection and fromInput", () => {
    const editor = createTestEditor()
    const spec = getBlockSpecs(editor).video
    const node = editor.schema.nodes.video!.create({
      id: "vid1",
      depth: 1,
      ...videoAttrs,
      contentWidth: 72,
    })

    expect(spec?.toRuneBlock?.(node)).toMatchObject({
      type: "video",
      id: "vid1",
      depth: 1,
      ...videoAttrs,
      contentWidth: 72,
    })

    const built = spec?.fromInput?.({
      schema: editor.schema,
      input: {
        type: "video",
        id: "vid2",
        depth: 2,
        ...videoAttrs,
        contentWidth: 500,
      },
      defaults: { depth: 0 },
      editor,
    })

    expect(built?.attrs.contentWidth).toBe(100)
  })

  it("round-trips direct video contentWidth through generated HTML", () => {
    const source = createTestEditor({
      content: {
        type: "doc",
        content: [
          {
            type: "video",
            attrs: {
              id: "vid-asset-html",
              sourceType: "asset",
              src: "https://cdn.example.com/demo.mp4",
              title: "Asset video",
              width: 640,
              height: 360,
              contentWidth: 72,
            },
          },
        ],
      } as never,
    })
    const target = createTestEditor()

    target.commands.setContent(source.getHTML())

    expect(getDocument(target)).toMatchObject([
      {
        type: "video",
        id: "vid-asset-html",
        sourceType: "asset",
        src: "https://cdn.example.com/demo.mp4",
        title: "Asset video",
        width: 640,
        height: 360,
        contentWidth: 72,
      },
    ])
  })

  it("round-trips non-resized direct video chrome through generated HTML", () => {
    const source = createTestEditor({
      content: {
        type: "doc",
        content: [
          {
            type: "video",
            attrs: {
              id: "vid-asset-natural",
              depth: 2,
              sourceType: "asset",
              src: "https://cdn.example.com/natural.mp4",
              title: "Natural asset video",
              width: 800,
              height: 450,
            },
          },
        ],
      } as never,
    })
    const target = createTestEditor()

    target.commands.setContent(source.getHTML())

    expect(getDocument(target)).toEqual([
      {
        type: "video",
        id: "vid-asset-natural",
        depth: 2,
        sourceType: "asset",
        src: "https://cdn.example.com/natural.mp4",
        embedUrl: null,
        provider: null,
        sourceUrl: null,
        title: "Natural asset video",
        width: 800,
        height: 450,
      },
    ])
  })

  it("round-trips embedded video contentWidth through generated HTML", () => {
    const source = createTestEditor({
      content: {
        type: "doc",
        content: [
          {
            type: "video",
            attrs: {
              id: "vid-embed-html",
              ...videoAttrs,
              contentWidth: 33,
            },
          },
        ],
      } as never,
    })
    const target = createTestEditor()

    target.commands.setContent(source.getHTML())

    expect(getDocument(target)).toMatchObject([
      {
        type: "video",
        id: "vid-embed-html",
        ...videoAttrs,
        contentWidth: 33,
      },
    ])
  })

  it("round-trips non-resized embedded video chrome through generated HTML", () => {
    const source = createTestEditor({
      content: {
        type: "doc",
        content: [
          {
            type: "video",
            attrs: {
              id: "vid-embed-natural",
              depth: 2,
              ...videoAttrs,
            },
          },
        ],
      } as never,
    })
    const target = createTestEditor()

    target.commands.setContent(source.getHTML())

    expect(getDocument(target)).toEqual([
      {
        type: "video",
        id: "vid-embed-natural",
        depth: 2,
        ...videoAttrs,
      },
    ])
  })

  it("round-trips empty video chrome through generated HTML", () => {
    const source = createTestEditor({
      content: {
        type: "doc",
        content: [
          {
            type: "video",
            attrs: {
              id: "vid-empty-html",
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
        type: "video",
        id: "vid-empty-html",
        depth: 2,
        sourceType: "asset",
        src: "",
        embedUrl: null,
        provider: null,
        sourceUrl: null,
        title: "",
        width: null,
        height: null,
      },
    ])
  })

  it("insertBlocks supports populated video blocks", () => {
    const editor = createTestEditor({
      // An ordinary leading paragraph is not a Markdown depth owner.
      content: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "lead" }] }],
      } as never,
    })

    expect(
      editor.commands.insertBlocks([
        { type: "video", id: "vid1", depth: 1, ...videoAttrs },
      ] as never),
    ).toBe(true)

    expect(getDocument(editor)[1]).toEqual(
      { type: "video", id: "vid1", depth: 0, ...videoAttrs },
    )
  })

  it("fromInput rejects impossible provider combinations", () => {
    const editor = createTestEditor()
    const spec = getBlockSpecs(editor).video

    const built = spec?.fromInput?.({
      schema: editor.schema,
      input: {
        type: "video",
        sourceType: "embed",
        provider: "soundcloud",
        sourceUrl: "https://soundcloud.com/example/demo",
        embedUrl:
          "https://w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2Fexample%2Fdemo",
      },
      defaults: { depth: 0 },
      editor,
    })

    expect(built).toBeNull()
  })

  it("fromInput rejects embed URLs that do not match the allowlist", () => {
    const editor = createTestEditor()
    const spec = getBlockSpecs(editor).video

    const built = spec?.fromInput?.({
      schema: editor.schema,
      input: {
        type: "video",
        sourceType: "embed",
        provider: "youtube",
        sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        embedUrl: "https://evil.example.com/embed/dQw4w9WgXcQ",
      },
      defaults: { depth: 0 },
      editor,
    })

    expect(built).toBeNull()
  })

  it("declares resize support metadata", () => {
    const editor = createTestEditor()
    const spec = getBlockSpecs(editor).video

    expect(spec?.supports).toMatchObject({
      resize: true,
    })
  })

  it("exposes a video slash item that is not a turn-into target", () => {
    const editor = createTestEditor()
    const item = getDefaultSlashMenuItems(editor).find((i) => i.key === "video")

    expect(item).toBeDefined()
    expect(item).toMatchObject({
      key: "video",
      title: "Video",
      group: "Media",
      aliases: expect.arrayContaining(["video", "movie", "youtube", "vimeo"]),
    })
    expect(item!.block).toBeUndefined()
    expect(typeof item!.onItemClick).toBe("function")
  })

  it("video slash item inserts an eager-id video at source depth", () => {
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
    const item = getDefaultSlashMenuItems(editor).find((i) => i.key === "video")!

    item.onItemClick({
      editor,
      range: { from: 1, to: 2 },
      triggerCharacter: "/",
    })

    const doc = getDocument(editor)
    expect(doc).toHaveLength(2)
    expect(doc[0]).toMatchObject({
      type: "video",
      depth: 2,
      sourceType: "asset",
      src: "",
      embedUrl: null,
      provider: null,
      sourceUrl: null,
      title: "",
      width: null,
      height: null,
    })
    expect(doc[0]!.id).toMatch(/^[\w-]{8}$/)
  })

  it("video slash item no-ops while read-only", () => {
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
    const item = getDefaultSlashMenuItems(editor).find((i) => i.key === "video")!

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
  })
})
