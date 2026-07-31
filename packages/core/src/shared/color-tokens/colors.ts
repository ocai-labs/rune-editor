// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

export const COLOR_NAMES = [
  "default","gray","brown","orange","yellow","green","blue","purple","pink","red",
] as const
export type ColorName = (typeof COLOR_NAMES)[number]

export type NamedColorEntry = {
  label: string
  /** Matching reference values, NOT render values. Used by nearestColorName
   *  at paste time to map an arbitrary CSS color back to a palette name.
   *  Rendered colors in light/dark live in color-palette.css; these stay
   *  theme-invariant so paste semantics are stable across modes.
   *
   *  fg = canonical fg per Notion (same in light + dark — verified 2026-06-26).
   *  bg = canonical dark bg per Notion (measured 2026-06-26). Light-mode bg
   *       pastes match against this dark reference too (lower precision;
   *       closest fg-channel proximity wins). Render-time light/dark bg
   *       values live in color-palette.css. */
  fg: string
  bg: string
}

/** The palette name markdown's native `==highlight==` anchors to, both
 *  directions (D4). "default" is never stored (choosing it removes the
 *  attr), and Obsidian renders `==` as yellow — so yellow is the token
 *  that writes as `==` and the one a bare `<mark>` reads back as. */
export const HIGHLIGHT_COLOR_NAME: ColorName = "yellow"

export const COLORS: Record<ColorName, NamedColorEntry> = {
  default: { label: "Default", fg: "inherit",            bg: "transparent" },
  gray:    { label: "Gray",    fg: "rgb(125, 122, 117)", bg: "rgb(56, 56, 54)" },
  brown:   { label: "Brown",   fg: "rgb(159, 118, 90)",  bg: "rgb(69, 54, 45)" },
  orange:  { label: "Orange",  fg: "rgb(210, 123, 45)",  bg: "rgb(83, 54, 31)" },
  yellow:  { label: "Yellow",  fg: "rgb(203, 148, 52)",  bg: "rgb(80, 68, 37)" },
  green:   { label: "Green",   fg: "rgb(80, 148, 110)",  bg: "rgb(38, 61, 48)" },
  blue:    { label: "Blue",    fg: "rgb(56, 125, 201)",  bg: "rgb(35, 56, 80)" },
  purple:  { label: "Purple",  fg: "rgb(154, 107, 180)", bg: "rgb(60, 45, 71)" },
  pink:    { label: "Pink",    fg: "rgb(193, 76, 138)",  bg: "rgb(78, 43, 60)" },
  red:     { label: "Red",     fg: "rgb(207, 81, 72)",   bg: "rgb(80, 44, 41)" },
}
