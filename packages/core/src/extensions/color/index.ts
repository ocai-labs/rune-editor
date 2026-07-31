// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { type ColorName } from "../../shared/color-tokens"
import {
  createColorExtension,
  type ColorExtensionOptions,
} from "./createColorExtension"

export { createColorExtension }
export type { ColorExtensionOptions }
export { TextStyleWithColorAttrs } from "./TextStyleWithColorAttrs"

export interface TextColorOptions extends ColorExtensionOptions {}
export interface BackgroundColorOptions extends ColorExtensionOptions {}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    runeTextColor: {
      setRuneTextColor: (name: ColorName) => ReturnType
      unsetRuneTextColor: () => ReturnType
    }
    runeBackgroundColor: {
      setRuneBackgroundColor: (name: ColorName) => ReturnType
      unsetRuneBackgroundColor: () => ReturnType
    }
  }
}

export const TextColor = createColorExtension({ kind: "text" })
export const BackgroundColor = createColorExtension({
  kind: "background",
})
