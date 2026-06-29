// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { beforeAll, describe, it, expect } from "vitest"
import { loadKatex, renderKatexSafe } from "./renderKatex"

describe("renderKatexSafe", () => {
  // KaTeX is now lazy-loaded; resolve the dynamic import before exercising
  // the synchronous render path (the NodeViews gate on useKatexReady).
  beforeAll(async () => {
    await loadKatex()
  })

  it("returns ok:true with HTML for valid latex", () => {
    const result = renderKatexSafe("x^2", { displayMode: true })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.html).toContain("katex")
    }
  })

  it("returns ok:false with a message stripped of the KaTeX prefix on parse error", () => {
    const result = renderKatexSafe("x^", { displayMode: true })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      // KaTeX raw message: "KaTeX parse error: Expected group after '^' at position 2: x^"
      // We strip the prefix so the in-block banner doesn't double up.
      expect(result.message).toMatch(/^Expected group after/)
      expect(result.message).not.toMatch(/^KaTeX parse error/)
    }
  })

  it("caches identical inputs (same reference returned)", () => {
    const a = renderKatexSafe("x^2", { displayMode: true })
    const b = renderKatexSafe("x^2", { displayMode: true })
    expect(a).toBe(b)
  })
})
