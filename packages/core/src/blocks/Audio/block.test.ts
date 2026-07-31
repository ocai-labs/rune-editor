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

const audioAttrs = {
  sourceType: "embed",
  src: "",
  embedUrl:
    "https://w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2Fexample%2Fdemo-track",
  provider: "soundcloud",
  sourceUrl: "https://soundcloud.com/example/demo-track",
  title: "Demo track",
  width: null,
  height: null,
} as const

describe("Audio block", () => {
  it("creates an atom audio block with default attrs", () => {
    const editor = createTestEditor()
    const type = editor.schema.nodes.audio

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

  it("renderDOM produces empty placeholder chrome when no source is set", () => {
    const editor = createTestEditor({
      content: {
        type: "doc",
        content: [{ type: "audio", attrs: { id: "aud-empty", depth: 0 } }],
      } as never,
    })

    const outer = editor.view.dom.querySelector<HTMLElement>(
      ".rune-block.rune-audio.rune-media-empty",
    )
    const content = outer?.querySelector<HTMLElement>(":scope > .rune-block-content")

    expect(outer).not.toBeNull()
    expect(outer!.getAttribute("data-id")).toBe("aud-empty")
    expect(content).not.toBeNull()
    expect(content!.querySelector(".rune-media-empty-control")).not.toBeNull()
    expect(content!.querySelector(".rune-media-empty-icon-svg")).not.toBeNull()
    expect(content!.querySelector(".rune-media-empty-label")?.textContent).toBe(
      "Add an audio file",
    )
    expect(outer!.getAttribute("style") ?? "").toContain("--block-pad-top")
  })

  it("renderDOM produces audio chrome for direct assets", () => {
    const editor = createTestEditor({
      content: {
        type: "doc",
        content: [
          {
            type: "audio",
            attrs: {
              id: "aud-asset",
              depth: 0,
              sourceType: "asset",
              src: "https://cdn.example.com/demo.mp3",
              title: "Asset audio",
            },
          },
        ],
      } as never,
    })

    const outer = editor.view.dom.querySelector<HTMLElement>(".rune-block.rune-audio")
    const audio = outer?.querySelector<HTMLAudioElement>("audio[data-rune-audio]")

    expect(outer).not.toBeNull()
    expect(audio).not.toBeNull()
    expect(audio!.getAttribute("src")).toBe("https://cdn.example.com/demo.mp3")
    expect(audio!.getAttribute("title")).toBe("Asset audio")
    expect(audio!.hasAttribute("controls")).toBe(true)
  })

  it.each(["javascript:alert(1)", "vbscript:msgbox(1)"])(
    "rejects blocked direct audio src %s during parseDOM",
    (src) => {
      const editor = createTestEditor()

      editor.commands.setContent(`<audio src="${src}" title="Bad"></audio>`)

      expect(getDocument(editor).some((block) => block.type === "audio")).toBe(
        false,
      )
      expect(editor.view.dom.querySelector(".rune-block.rune-audio")).toBeNull()
    },
  )

  it("renderDOM produces SoundCloud iframe chrome for valid embeds", () => {
    const editor = createTestEditor({
      content: {
        type: "doc",
        content: [{ type: "audio", attrs: { id: "aud-embed", ...audioAttrs } }],
      } as never,
    })

    const outer = editor.view.dom.querySelector<HTMLElement>(".rune-block.rune-audio")
    const iframe = outer?.querySelector<HTMLIFrameElement>(
      'iframe[data-rune-media-embed]',
    )

    expect(outer).not.toBeNull()
    expect(iframe).not.toBeNull()
    expect(iframe!.getAttribute("src")).toBe(audioAttrs.embedUrl)
    expect(iframe!.getAttribute("title")).toBe(audioAttrs.title)
    expect(iframe!.getAttribute("loading")).toBe("lazy")
    expect(iframe!.getAttribute("referrerpolicy")).toBe(
      "strict-origin-when-cross-origin",
    )
    expect(iframe!.getAttribute("allow")).toBe("autoplay")
    expect(iframe!.hasAttribute("allowfullscreen")).toBe(false)
  })

  it("parses SoundCloud iframe HTML through canonical validated embed attrs", () => {
    const editor = createTestEditor()
    const sourceUrl = "https://soundcloud.com/example/demo-track"
    const embedUrl =
      "https://w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2Fexample%2Fdemo-track"

    editor.commands.setContent(
      `<iframe src="${embedUrl}&color=%23ff5500" title="SoundCloud track"></iframe>`,
    )

    expect(getDocument(editor)).toMatchObject([
      {
        type: "audio",
        sourceType: "embed",
        src: "",
        embedUrl,
        provider: "soundcloud",
        sourceUrl,
        title: "SoundCloud track",
        width: null,
        height: null,
      },
    ])
    expect(
      editor.view.dom.querySelector<HTMLIFrameElement>(
        'iframe[data-rune-media-embed]',
      )?.getAttribute("src"),
    ).toBe(embedUrl)
  })

  it("rejects malformed SoundCloud iframe HTML during parseDOM", () => {
    const editor = createTestEditor()

    editor.commands.setContent(
      '<iframe src="https://w.soundcloud.com/player/?visual=true" title="Bad"></iframe>',
    )

    expect(getDocument(editor).some((block) => block.type === "audio")).toBe(
      false,
    )
    expect(editor.view.dom.querySelector(".rune-block.rune-audio")).toBeNull()
  })

  it("renders invalid persisted embed attrs as an empty placeholder", () => {
    const editor = createTestEditor({
      content: {
        type: "doc",
        content: [
          {
            type: "audio",
            attrs: {
              id: "aud-invalid",
              sourceType: "embed",
              provider: "soundcloud",
              sourceUrl: "https://soundcloud.com/example/demo-track",
              embedUrl: "https://evil.example.com/player/demo-track",
            },
          },
        ],
      } as never,
    })

    const outer = editor.view.dom.querySelector<HTMLElement>(
      ".rune-block.rune-audio.rune-media-empty",
    )

    expect(outer).not.toBeNull()
    expect(outer!.querySelector("iframe")).toBeNull()
    expect(outer!.querySelector(".rune-media-empty-label")?.textContent).toBe(
      "Add an audio file",
    )
  })

  it("toRuneBlock and fromInput expose persisted attrs", () => {
    const editor = createTestEditor()
    const spec = getBlockSpecs(editor).audio
    const node = editor.schema.nodes.audio!.create({
      id: "aud1",
      depth: 1,
      ...audioAttrs,
    })

    expect(spec?.toRuneBlock?.(node)).toEqual({
      type: "audio",
      id: "aud1",
      depth: 1,
      ...audioAttrs,
    })

    const built = spec?.fromInput?.({
      schema: editor.schema,
      input: { type: "audio", id: "aud2", depth: 2, ...audioAttrs },
      defaults: { depth: 0 },
      editor,
    })

    expect(built?.type.name).toBe("audio")
    expect(built?.attrs).toMatchObject({
      id: "aud2",
      depth: 2,
      ...audioAttrs,
    })
  })

  it("insertBlocks supports populated audio blocks", () => {
    const editor = createTestEditor({
      // An ordinary leading paragraph is not a Markdown depth owner.
      content: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "lead" }] }],
      } as never,
    })

    expect(
      editor.commands.insertBlocks([
        { type: "audio", id: "aud1", depth: 1, ...audioAttrs },
      ] as never),
    ).toBe(true)

    expect(getDocument(editor)[1]).toEqual(
      { type: "audio", id: "aud1", depth: 0, ...audioAttrs },
    )
  })

  it("fromInput rejects non-SoundCloud provider combinations", () => {
    const editor = createTestEditor()
    const spec = getBlockSpecs(editor).audio

    const built = spec?.fromInput?.({
      schema: editor.schema,
      input: {
        type: "audio",
        sourceType: "embed",
        provider: "youtube",
        sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        embedUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ",
      },
      defaults: { depth: 0 },
      editor,
    })

    expect(built).toBeNull()
  })

  it("fromInput rejects SoundCloud provider with a non-SoundCloud player URL", () => {
    const editor = createTestEditor()
    const spec = getBlockSpecs(editor).audio

    const built = spec?.fromInput?.({
      schema: editor.schema,
      input: {
        type: "audio",
        sourceType: "embed",
        provider: "soundcloud",
        sourceUrl: "https://soundcloud.com/example/demo-track",
        embedUrl: "https://evil.example.com/player/demo-track",
      },
      defaults: { depth: 0 },
      editor,
    })

    expect(built).toBeNull()
  })

  it("exposes an audio slash item that is not a turn-into target", () => {
    const editor = createTestEditor()
    const item = getDefaultSlashMenuItems(editor).find((i) => i.key === "audio")

    expect(item).toBeDefined()
    expect(item).toMatchObject({
      key: "audio",
      title: "Audio",
      group: "Media",
      aliases: expect.arrayContaining(["audio", "sound", "soundcloud"]),
    })
    expect(item!.block).toBeUndefined()
    expect(typeof item!.onItemClick).toBe("function")
  })

  it("audio slash item inserts an eager-id audio at source depth", () => {
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
    const item = getDefaultSlashMenuItems(editor).find((i) => i.key === "audio")!

    item.onItemClick({
      editor,
      range: { from: 1, to: 2 },
      triggerCharacter: "/",
    })

    const doc = getDocument(editor)
    expect(doc).toHaveLength(2)
    expect(doc[0]).toMatchObject({
      type: "audio",
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

  it("audio slash item no-ops while read-only", () => {
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
    const item = getDefaultSlashMenuItems(editor).find((i) => i.key === "audio")!

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
