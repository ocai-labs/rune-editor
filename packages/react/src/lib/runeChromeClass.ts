// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The editor-grade "shadow box" chrome — ONE source for the floating-panel look
// (rounded corners, popover bg, hairline ring, drop shadow, open/close
// animation) that rune's popovers and menus sit inside. PopoverContent and the
// native-menu surface both consume this, and it's exported so a downstream host
// can put rune's exact chrome on its OWN popover (Tailwind path). Non-Tailwind
// hosts use the `.rune-chrome` plain-CSS class instead (built from the same
// --rune-chrome-* tokens; see styles/chrome.css). `rune-chrome-surface` is a
// styling-only marker on the Tailwind path; downstream visual overrides that
// support both paths should select `:is(.rune-chrome-surface, .rune-chrome)`.
//
// This returns ONLY chrome utilities — no layout (z-index, width, padding,
// flex). The caller adds its own layout and merges via cn(), e.g.
//   cn(runeChromeClass(), "z-50 w-72 p-2.5", className)

export interface RuneChromeOptions {
  /** Drop-shadow weight. "md" (default) is the popover/menu shadow; "lg" is the
   *  heavier shadow for surfaces floating over content (hover cards). */
  shadow?: "md" | "lg"
  /** Open/close animation:
   *  - "popover" (default): Radix data-state gated (animate in AND out) — for a
   *    controlled-mount popover that plays an exit animation.
   *  - "native": animate-in only — for a surface that hard-unmounts on close.
   *  - "none": no animation classes (a non-animating panel). */
  animation?: "popover" | "native" | "none"
}

// Static chrome shared by every variant. Mirrors the inline string that lived in
// popover.tsx and nativeMenuContentClass; `bg-popover`/`text-popover-foreground`/
// `rounded-lg` resolve to the --popover/--popover-foreground/--radius tokens that
// --rune-chrome-* alias, so the Tailwind path and the .rune-chrome path track the
// same values for color + radius. (shadow + ring are the one hand-matched pair;
// see styles/chrome.css.)
const BASE =
  "rune-chrome-surface rounded-lg bg-popover text-popover-foreground ring-1 ring-foreground/10 outline-hidden origin-(--radix-popover-content-transform-origin) duration-100"

const SHADOW = { md: "shadow-md", lg: "shadow-lg" } as const

const ANIMATION = {
  popover:
    "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
  native: "animate-in fade-in-0 zoom-in-95 slide-in-from-top-2",
  none: "",
} as const

/** The chrome class string for the given variant. See RuneChromeOptions. */
export function runeChromeClass(opts: RuneChromeOptions = {}): string {
  const { shadow = "md", animation = "popover" } = opts
  return [BASE, SHADOW[shadow], ANIMATION[animation]].filter(Boolean).join(" ")
}

/** The canonical shadow box — `runeChromeClass()` with defaults (md shadow,
 *  Radix-gated animation). Drop onto a Radix PopoverContent (or any popover) to
 *  get rune's editor chrome. */
export const RUNE_CHROME_CLASS: string = runeChromeClass()
