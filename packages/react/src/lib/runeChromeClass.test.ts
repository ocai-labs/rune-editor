// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, expect, it } from "vitest"

import { runeChromeClass, RUNE_CHROME_CLASS } from "./runeChromeClass"

// runeChromeClass is the single source of the floating-panel chrome. These tests
// lock (a) the variant contract, (b) the stable visual marker, and (c) PARITY
// with the visual utilities PopoverContent and nativeMenuContentClass used
// before PR-3 (tailwind-merge in cn() dedups against surface layout classes).

const CHROME_CORE =
  "rune-chrome-surface rounded-lg bg-popover text-popover-foreground ring-1 ring-foreground/10 outline-hidden origin-(--radix-popover-content-transform-origin) duration-100"

const ANIM_POPOVER =
  "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2"

const ANIM_NATIVE = "animate-in fade-in-0 zoom-in-95 slide-in-from-top-2"

/** Set membership — class order doesn't matter to the browser, so compare the
 *  utility SET, not the string. */
function classSet(s: string): Set<string> {
  return new Set(s.split(/\s+/).filter(Boolean))
}

describe("runeChromeClass", () => {
  it.each(["popover", "native", "none"] as const)(
    "includes the stable visual marker for %s animation",
    (animation) => {
      expect(classSet(runeChromeClass({ animation }))).toContain("rune-chrome-surface")
    },
  )

  it("defaults to md shadow + Radix-gated (popover) animation", () => {
    expect(classSet(runeChromeClass())).toEqual(
      classSet(`${CHROME_CORE} shadow-md ${ANIM_POPOVER}`),
    )
  })

  it("RUNE_CHROME_CLASS is the default", () => {
    expect(RUNE_CHROME_CLASS).toBe(runeChromeClass())
  })

  it("shadow: 'lg' swaps shadow-md → shadow-lg, nothing else", () => {
    const s = classSet(runeChromeClass({ shadow: "lg" }))
    expect(s.has("shadow-lg")).toBe(true)
    expect(s.has("shadow-md")).toBe(false)
  })

  it("animation: 'native' uses the animate-in-only set", () => {
    expect(classSet(runeChromeClass({ animation: "native" }))).toEqual(
      classSet(`${CHROME_CORE} shadow-md ${ANIM_NATIVE}`),
    )
  })

  it("animation: 'none' emits no animation classes", () => {
    const s = runeChromeClass({ animation: "none" })
    expect(classSet(s)).toEqual(classSet(`${CHROME_CORE} shadow-md`))
    expect(s).not.toMatch(/animate-|slide-in|fade-in|zoom-in/)
  })
})

describe("parity with the pre-PR-3 inline chrome strings", () => {
  // The exact string PopoverContent rendered before the refactor (chrome part —
  // the layout part z-50/flex/w-72/gap/p-2.5/text-sm stayed on the component).
  const POPOVER_INLINE_CHROME =
    "origin-(--radix-popover-content-transform-origin) rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"

  function withoutSurfaceMarker(classes: string): Set<string> {
    const result = classSet(classes)
    result.delete("rune-chrome-surface")
    return result
  }

  it("runeChromeClass() preserves PopoverContent's old visual utilities", () => {
    expect(withoutSurfaceMarker(runeChromeClass())).toEqual(classSet(POPOVER_INLINE_CHROME))
  })

  // nativeMenuContentClass("native") old chrome (layout z-50/w-3xs/p-1/text-sm split off).
  const NATIVE_INLINE_CHROME = `rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden origin-(--radix-popover-content-transform-origin) duration-100 ${ANIM_NATIVE}`

  it("runeChromeClass({animation:'native'}) preserves the native menu's old visual utilities", () => {
    expect(withoutSurfaceMarker(runeChromeClass({ animation: "native" }))).toEqual(
      classSet(NATIVE_INLINE_CHROME),
    )
  })
})
