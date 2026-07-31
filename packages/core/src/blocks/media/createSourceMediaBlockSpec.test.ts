// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import { describe, expect, it } from "vitest"
import { RUNE_BLOCK_SPEC_METADATA, type BlockSpecMetadata } from "../../schema"
import { createSourceMediaBlockSpec } from "./createSourceMediaBlockSpec"

const iconPaths = ["M0 0h1v1H0z"]

function getMetadata(extension: ReturnType<typeof createSourceMediaBlockSpec>) {
  return (extension as unknown as {
    [RUNE_BLOCK_SPEC_METADATA]: BlockSpecMetadata
  })[RUNE_BLOCK_SPEC_METADATA]
}

describe("createSourceMediaBlockSpec", () => {
  it("creates a source media block spec with slash and public projection metadata", () => {
    const extension = createSourceMediaBlockSpec({
      type: "video",
      className: "rune-video",
      iconPaths,
      allowedProviders: ["youtube", "vimeo"],
      assetDataAttr: "data-rune-video",
      assetTag: "video",
      assetHasDimensions: true,
      supportsAlign: true,
      includeContentWidthInOutput: true,
      slash: {
        key: "video",
        title: "Video",
        aliases: ["video", "movie", "youtube", "vimeo"],
        group: "Media",
      },
    })
    const metadata = getMetadata(extension)

    expect(extension.name).toBe("video")
    expect(metadata.supports).toMatchObject({
      resize: true,
      mediaSource: true,
    })

    const slashItem = metadata.slashMenuItems?.({} as never)[0]
    expect(slashItem).toMatchObject({
      key: "video",
      title: "Video",
      aliases: ["video", "movie", "youtube", "vimeo"],
      group: "Media",
    })
    expect(slashItem?.block).toBeUndefined()
    expect(typeof slashItem?.onItemClick).toBe("function")

    const block = metadata.toRuneBlock?.(({
      attrs: {
        id: "vid1",
        depth: 2,
        sourceType: "asset",
        src: "https://cdn.example.com/demo.mp4",
        embedUrl: null,
        provider: null,
        sourceUrl: "https://cdn.example.com/demo.mp4",
        title: "Demo",
        width: 640,
        height: 360,
        contentWidth: 72,
      },
    } as unknown) as ProseMirrorNode)

    expect(block).toEqual({
      type: "video",
      id: "vid1",
      depth: 2,
      sourceType: "asset",
      src: "https://cdn.example.com/demo.mp4",
      embedUrl: null,
      provider: null,
      sourceUrl: "https://cdn.example.com/demo.mp4",
      title: "Demo",
      width: 640,
      height: 360,
      contentWidth: 72,
    })
  })
})
