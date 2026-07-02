// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Integration coverage for the media `align` attr + the expanded
// blockActions (Download / View original) across image / video / audio.
// Spec: internal design notes.

import { afterEach, describe, expect, it, vi } from "vitest"
import { createTestEditor } from "../../test-utils/createTestEditor"
import { getBlockSpecs } from "../../schema"
import { getDocument } from "../../api"
import type { RuneBlockActionRuntimeContext } from "../../schema"

afterEach(() => {
  vi.restoreAllMocks()
})

function imageDoc(attrs: Record<string, unknown>) {
  return {
    type: "doc",
    content: [{ type: "image", attrs: { id: "img1", depth: 0, ...attrs } }],
  } as never
}

function runtimeFor(
  editor: ReturnType<typeof createTestEditor>,
  pos = 0,
): RuneBlockActionRuntimeContext {
  const node = editor.state.doc.nodeAt(pos)!
  return {
    editor,
    node,
    blockId: (node.attrs.id as string | null) ?? null,
    pos,
    isSingleBlock: true,
  }
}

describe("media align attr", () => {
  it("image renders data-align only for non-center", () => {
    const editor = createTestEditor({
      content: imageDoc({ src: "https://cdn.example/a.png", align: "right" }),
    })
    const outer = editor.view.dom.querySelector<HTMLElement>(".rune-block.rune-image")
    expect(outer!.getAttribute("data-align")).toBe("right")

    const centered = createTestEditor({
      content: imageDoc({ src: "https://cdn.example/a.png" }),
    })
    const centeredOuter =
      centered.view.dom.querySelector<HTMLElement>(".rune-block.rune-image")
    expect(centered.state.doc.firstChild!.attrs.align).toBe("center")
    expect(centeredOuter!.hasAttribute("data-align")).toBe(false)
  })

  it("image round-trips align through generated HTML", () => {
    const source = createTestEditor({
      content: imageDoc({ src: "https://cdn.example/a.png", align: "left" }),
    })
    const target = createTestEditor()

    target.commands.setContent(source.getHTML())

    expect(target.state.doc.firstChild!.attrs.align).toBe("left")
    expect(getDocument(target)).toMatchObject([
      { type: "image", align: "left" },
    ])
  })

  it("toRuneBlock omits align when center", () => {
    const editor = createTestEditor({
      content: imageDoc({ src: "https://cdn.example/a.png" }),
    })
    const block = getDocument(editor)[0]
    expect(block).toMatchObject({ type: "image" })
    expect("align" in block!).toBe(false)
  })

  it("video carries align; audio does not", () => {
    const editor = createTestEditor()
    expect(editor.schema.nodes.video!.create().attrs.align).toBe("center")
    expect(
      Object.keys(editor.schema.nodes.audio!.create().attrs),
    ).not.toContain("align")
  })

  it("video renders data-align and projects it when non-center", () => {
    const editor = createTestEditor({
      content: {
        type: "doc",
        content: [
          {
            type: "video",
            attrs: {
              id: "vid1",
              sourceType: "asset",
              src: "https://cdn.example/v.mp4",
              align: "left",
            },
          },
        ],
      } as never,
    })

    const outer = editor.view.dom.querySelector<HTMLElement>(".rune-block.rune-video")
    expect(outer!.getAttribute("data-align")).toBe("left")
    expect(getDocument(editor)).toMatchObject([{ type: "video", align: "left" }])
  })

  it("supports.align is declared by image + video, not audio", () => {
    const editor = createTestEditor()
    const specs = getBlockSpecs(editor)
    expect(specs.image?.supports?.align).toBe(true)
    expect(specs.video?.supports?.align).toBe(true)
    expect(specs.audio?.supports?.align).toBe(false)
  })

  it("fromInput accepts align", () => {
    const editor = createTestEditor()
    const spec = getBlockSpecs(editor).image
    const node = spec?.fromInput?.({
      schema: editor.schema,
      input: { type: "image", src: "https://cdn.example/a.png", align: "right" },
      defaults: { depth: 0 },
    })
    expect(node?.attrs.align).toBe("right")
  })
})

describe("media block actions", () => {
  it("image exposes a quick Download action gated on src", () => {
    const editor = createTestEditor({
      content: imageDoc({ src: "data:image/png;base64,AAAA" }),
    })
    const actions = getBlockSpecs(editor).image!.blockActions!({ editor })
    const download = actions.find((a) => a.id === "download")
    expect(download).toBeDefined()
    expect(download!.quickAction).toBe(true)
    expect(download!.icon).toBe("download")

    const runtime = runtimeFor(editor)
    expect(download!.isVisible?.(runtime)).toBe(true)

    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {})
    expect(download!.run(runtime)).toBe(true)
    expect(click).toHaveBeenCalledTimes(1)
  })

  it("image Download is hidden when src is empty", () => {
    const editor = createTestEditor({ content: imageDoc({ src: "" }) })
    const actions = getBlockSpecs(editor).image!.blockActions!({ editor })
    const download = actions.find((a) => a.id === "download")!
    expect(download.isVisible?.(runtimeFor(editor))).toBe(false)
  })

  it("video exposes a quick View original action that opens sourceUrl", () => {
    const editor = createTestEditor({
      content: {
        type: "doc",
        content: [
          {
            type: "video",
            attrs: {
              id: "vid1",
              sourceType: "embed",
              src: "",
              embedUrl: "https://www.youtube.com/embed/abc12345678",
              provider: "youtube",
              sourceUrl: "https://www.youtube.com/watch?v=abc12345678",
            },
          },
        ],
      } as never,
    })
    const actions = getBlockSpecs(editor).video!.blockActions!({ editor })
    const view = actions.find((a) => a.id === "view-original")
    expect(view).toBeDefined()
    expect(view!.quickAction).toBe(true)
    expect(view!.icon).toBe("external-link")

    const runtime = runtimeFor(editor)
    expect(view!.isVisible?.(runtime)).toBe(true)

    const open = vi.spyOn(window, "open").mockReturnValue(null)
    expect(view!.run(runtime)).toBe(true)
    expect(open).toHaveBeenCalledWith(
      "https://www.youtube.com/watch?v=abc12345678",
      "_blank",
      "noopener,noreferrer",
    )
  })

  it("audio View original is hidden when no source is resolvable", () => {
    const editor = createTestEditor({
      content: {
        type: "doc",
        content: [
          {
            type: "audio",
            attrs: { id: "aud1", sourceType: "asset", src: "" },
          },
        ],
      } as never,
    })
    const actions = getBlockSpecs(editor).audio!.blockActions!({ editor })
    const view = actions.find((a) => a.id === "view-original")!
    expect(view.isVisible?.(runtimeFor(editor))).toBe(false)
  })
})
