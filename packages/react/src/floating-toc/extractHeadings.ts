// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { Editor } from "@tiptap/core"
import type { TocHeading } from "./types"

// Walk top-level doc children only. Headings are flat siblings under <doc>
// per the rune schema invariant — no need to recurse, no need to descend
// into other block types.
export function extractHeadings(editor: Editor): TocHeading[] {
  const out: TocHeading[] = []
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== "heading") return true
    const level = node.attrs.level as number
    if (level < 1 || level > 6) return false
    const id = typeof node.attrs.id === "string" ? node.attrs.id : ""
    if (!id) return false
    out.push({ id, level: level as TocHeading["level"], text: node.textContent, pos })
    return false
  })
  return out
}
