// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { Extension, type Attributes, type CommandProps } from "@tiptap/core"
import {
  HIGHLIGHT_COLOR_NAME,
  nearestColorName,
  normalizeAttrValue,
  type ColorName,
} from "../../shared/color-tokens"

export type ColorKind = "text" | "background"
export interface ColorExtensionOptions {
  types: string[]
}

interface CreateColorExtensionConfig {
  kind: ColorKind
}

type ColorAttribute = "textColor" | "backgroundColor"
type ColorDataAttribute = "data-text-color" | "data-background-color"
type ColorStyleProperty = "color" | "backgroundColor"

const COLOR_ATTRIBUTES = {
  text: {
    attr: "textColor",
    dataAttr: "data-text-color",
    styleProp: "color",
  },
  background: {
    attr: "backgroundColor",
    dataAttr: "data-background-color",
    styleProp: "backgroundColor",
  },
} satisfies Record<
  ColorKind,
  {
    attr: ColorAttribute
    dataAttr: ColorDataAttribute
    styleProp: ColorStyleProperty
  }
>

const EXTENSION_NAMES = {
  text: "runeTextColor",
  background: "runeBackgroundColor",
} satisfies Record<ColorKind, string>

const DEFAULT_TYPES = ["textStyle"]

const storedColor = (name: ColorName | null) =>
  name === "default" ? null : name

function createInlineColorAttribute(kind: ColorKind): Attributes[string] {
  const { attr, dataAttr, styleProp } = COLOR_ATTRIBUTES[kind]

  return {
    default: null,
    parseHTML: (element) => {
      const dataAttrValue = element.getAttribute(dataAttr)
      if (dataAttrValue) return normalizeAttrValue(dataAttrValue, kind)

      // <mark> — the markdown-storage background form (D4). data-color
      // carries a palette name; a bare <mark> (or an unusable value) is the
      // HIGHLIGHT_COLOR_NAME anchor, matching what `==` reads back as.
      if (kind === "background" && element.tagName?.toLowerCase() === "mark") {
        const named = normalizeAttrValue(element.getAttribute("data-color"), kind)
        if (named && named !== "default") return named
        const inline = element.style?.[styleProp]
        const styled = inline ? nearestColorName(inline, kind) : null
        return styled && styled !== "default" ? styled : HIGHLIGHT_COLOR_NAME
      }

      const inline = element.style?.[styleProp]
      if (inline) return nearestColorName(inline, kind)

      return null
    },
    renderHTML: (attrs) => {
      const value = attrs[attr]
      return typeof value === "string" ? { [dataAttr]: value } : {}
    },
  }
}

function setInlineColor(
  attr: ColorAttribute,
  name: ColorName,
  { chain }: CommandProps,
) {
  const value = storedColor(name)
  const next = chain().setMark("textStyle", { [attr]: value })
  return (value === null ? next.command(pruneEmptyTextStyleMarks) : next).run()
}

function unsetInlineColor(attr: ColorAttribute, { chain }: CommandProps) {
  return chain()
    .setMark("textStyle", { [attr]: null })
    .command(pruneEmptyTextStyleMarks)
    .run()
}

function pruneEmptyTextStyleMarks({ tr, state }: CommandProps) {
  const markType = state.schema.marks["textStyle"]
  if (!markType) return false

  const { from, to } = tr.selection
  tr.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText) return true

    const mark = node.marks.find((candidate) => candidate.type === markType)
    if (mark && !Object.values(mark.attrs).some(Boolean)) {
      tr.removeMark(pos, pos + node.nodeSize, mark)
    }
    return false
  })

  return true
}

export function createColorExtension({ kind }: CreateColorExtensionConfig) {
  const { attr } = COLOR_ATTRIBUTES[kind]

  return Extension.create<ColorExtensionOptions>({
    name: EXTENSION_NAMES[kind],

    addOptions() {
      return { types: [...DEFAULT_TYPES] }
    },

    addGlobalAttributes() {
      return [
        {
          types: this.options.types,
          attributes: {
            [attr]: createInlineColorAttribute(kind),
          },
        },
      ]
    },

    addCommands() {
      if (kind === "text") {
        return {
          setRuneTextColor:
            (name: ColorName) =>
            (props: CommandProps) =>
              setInlineColor(attr, name, props),
          unsetRuneTextColor:
            () =>
            (props: CommandProps) =>
              unsetInlineColor(attr, props),
        }
      }

      return {
        setRuneBackgroundColor:
          (name: ColorName) =>
          (props: CommandProps) =>
            setInlineColor(attr, name, props),
        unsetRuneBackgroundColor:
          () =>
          (props: CommandProps) =>
            unsetInlineColor(attr, props),
      }
    },
  })
}
