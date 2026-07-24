// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, expect, it, vi } from "vitest"
import type { EditorView } from "@tiptap/pm/view"

import {
  pointAnchorAtHead,
  rangeToRect,
  rectForBlockId,
  unionBlockRect,
} from "./anchors"

// ─────────────────────────────────────────────────────────────────────────
// PARITY HARNESS
//
// These getters are LIFTED from pre-existing inline implementations. The lift is
// only safe if each getter reproduces its source's DOMRect EXACTLY — the three
// coordsAtPos sites look similar but are NOT identical (the trap §3 of the
// floating-primitives spec). Cited by symbol, not line number, so the references
// don't rot as the call sites move:
//
//   * pointAnchorAtHead, ZERO height — point-at-head. head.left / min-top.
//     A collapsed selection point.
//   * pointAnchorAtHead, "selection" height — InlineToolbar.selectionAnchorRect.
//     head.left / min-top / NON-ZERO height (= bottom-top), DELIBERATE so the
//     toolbar clears the text whichever side Radix lands on (default bottom, top
//     when flipped), plus a `from === to → null` guard at the call site.
//   * rangeToRect — useRangeAnchor (LinkHoverCard / BlockLinkPasteMenu). start.left
//     / start.top / bbox w&h with a 1px min clamp; throw → null, and the hook
//     falls back to its last good rect.
//
// The expected DOMRects below are hand-derived from those exact source bodies.
// Changing a getter so a parity assertion fails means the lift moved a real
// anchor — fix the getter, not the test.
// ─────────────────────────────────────────────────────────────────────────

type Coords = { left: number; right: number; top: number; bottom: number }

/** A coords entry is either one rect (both `side` biases coincide — the normal
 *  mid-line case) or a soft-wrap boundary: `before` (side -1, end of the upper
 *  visual line) and `after` (side 1, start of the lower line). One document
 *  position, two valid screen points — the ambiguity the getters must
 *  disambiguate via coordsAtPos's `side` argument. */
type SideCoords = Coords | { before: Coords; after: Coords }

/** Mock EditorView exposing only what the getters touch: coordsAtPos and
 *  dom.querySelector. coordsAtPos throws for a position absent from the map
 *  (mirrors PM's RangeError on an invalid pos). */
function makeView(opts: {
  coords?: Record<number, SideCoords>
  throwAt?: Set<number>
  elements?: Record<string, DOMRect | null>
}): { view: EditorView; querySelector: ReturnType<typeof vi.fn> } {
  const coords = opts.coords ?? {}
  const throwAt = opts.throwAt ?? new Set<number>()
  const elements = opts.elements ?? {}

  const querySelector = vi.fn((selector: string): { getBoundingClientRect: () => DOMRect } | null => {
    // The getters build `[data-id="<escaped>"]`; pull the escaped id back out.
    const match = /\[data-id="(.*)"\]$/.exec(selector)
    if (!match || match[1] === undefined) return null
    const escaped = match[1]
    const rect = elements[escaped]
    if (rect === undefined || rect === null) return null
    return { getBoundingClientRect: () => rect }
  })

  const view = {
    coordsAtPos: (pos: number, side = 1): Coords => {
      if (throwAt.has(pos)) throw new RangeError(`mock: invalid pos ${pos}`)
      const c = coords[pos]
      if (!c) throw new RangeError(`mock: no coords for pos ${pos}`)
      if ("before" in c) return side < 0 ? c.before : c.after
      return c
    },
    dom: { querySelector },
  } as unknown as EditorView

  return { view, querySelector }
}

function tuple(rect: DOMRect | null): [number, number, number, number] | null {
  return rect && [rect.x, rect.y, rect.width, rect.height]
}

// A two-line selection: `from` on the upper line, `to` on the lower line, head
// at `to` (forward drag). Distinct tops/bottoms so each getter's choice of
// origin and height is observable.
const TWO_LINE = {
  coords: {
    5: { left: 100, right: 140, top: 50, bottom: 66 }, // from (upper line)
    20: { left: 300, right: 340, top: 80, bottom: 96 }, // to / head (lower line)
  } as Record<number, Coords>,
  from: 5,
  to: 20,
  head: 20,
}

describe("pointAnchorAtHead — parity with the two selection-point sites", () => {
  it('zero height (point-at-head): DOMRect(head.left, min-top, 0, 0)', () => {
    const { view } = makeView({ coords: TWO_LINE.coords })
    const rect = pointAnchorAtHead(view, TWO_LINE.from, TWO_LINE.to, TWO_LINE.head, {
      height: "zero",
    })
    // x = head.left (300), y = min(start.top 50, end.top 80) = 50, w = 0, h = 0
    expect(tuple(rect)).toEqual([300, 50, 0, 0])
  })

  it('selection height (InlineToolbar.selectionAnchorRect): DOMRect(head.left, min-top, 0, bottom-top)', () => {
    const { view } = makeView({ coords: TWO_LINE.coords })
    const rect = pointAnchorAtHead(view, TWO_LINE.from, TWO_LINE.to, TWO_LINE.head, {
      height: "selection",
    })
    // h = max(start.bottom 66, end.bottom 96) - top(50) = 96 - 50 = 46
    expect(tuple(rect)).toEqual([300, 50, 0, 46])
  })

  it("default height is 'zero' (the more minimal AI shape)", () => {
    const { view } = makeView({ coords: TWO_LINE.coords })
    const rect = pointAnchorAtHead(view, TWO_LINE.from, TWO_LINE.to, TWO_LINE.head)
    expect(tuple(rect)).toEqual([300, 50, 0, 0])
  })

  it("anchors x at HEAD, not start — backward drag (head at from) moves x", () => {
    const { view } = makeView({ coords: TWO_LINE.coords })
    // head = from (5) now: x should be start.left (100), not to.left (300).
    const rect = pointAnchorAtHead(view, TWO_LINE.from, TWO_LINE.to, /* head */ 5, {
      height: "zero",
    })
    expect(tuple(rect)).toEqual([100, 50, 0, 0])
  })

  it("returns null when coordsAtPos throws (pure getter — no swallow, hook adds fallback)", () => {
    const { view } = makeView({ coords: TWO_LINE.coords, throwAt: new Set([20]) })
    expect(pointAnchorAtHead(view, 5, 20, 20)).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────
// SOFT-WRAP BOUNDARY
//
// A selection endpoint that lands exactly on a soft line-wrap is ONE document
// position with TWO valid screen points: end of the upper line (side -1) and
// start of the lower line (side 1). PM's TextSelection stores no affinity —
// the DOM selection's leaning is dropped at the DOM→PM boundary — so the
// getters must reconstruct it: bias each endpoint INTO the selection (`from`
// side 1 = the first selected char's line, `to` side -1 = the last selected
// char's line, head takes the bias of whichever end it is). Off-boundary both
// sides coincide, so the parity rects above are unaffected.
//
// Numbers mirror the playground repro ("…create columns; drag ⏎ into the
// gap…"): upper line ends at x 928 (top 440, bottom 459), lower line starts
// at x 257 (top 464, bottom 483), selection start (the ";") at x 882.
// ─────────────────────────────────────────────────────────────────────────

const WRAP = {
  coords: {
    85: { left: 882, right: 890, top: 440, bottom: 459 }, // ";" on the upper line
    92: {
      before: { left: 928, right: 928, top: 440, bottom: 459 }, // end of upper line
      after: { left: 257, right: 258, top: 464, bottom: 483 }, // start of lower line
    },
  } as Record<number, SideCoords>,
  from: 85,
  to: 92,
}

describe("soft-wrap boundary — endpoint coords bias INTO the selection", () => {
  it("forward drag (head at `to` on the wrap): anchors at the UPPER line's end, not the lower line's start", () => {
    const { view } = makeView({ coords: WRAP.coords })
    const rect = pointAnchorAtHead(view, WRAP.from, WRAP.to, /* head */ WRAP.to, {
      height: "selection",
    })
    // x = end-of-upper-line 928 (side -1), NOT lower-line start 257 (side 1);
    // height spans the upper line only: 459 - 440 = 19, not down to 483.
    expect(tuple(rect)).toEqual([928, 440, 0, 19])
  })

  it("backward drag (head at `from`): x already correct, but height must not swallow the lower line", () => {
    const { view } = makeView({ coords: WRAP.coords })
    const rect = pointAnchorAtHead(view, WRAP.from, WRAP.to, /* head */ WRAP.from, {
      height: "selection",
    })
    // x = head 882 either way; h = 19 (upper line), not 43 (down to the
    // lower line's bottom) — the `to` extent needs side -1 too.
    expect(tuple(rect)).toEqual([882, 440, 0, 19])
  })

  it("rangeToRect ending on the wrap: real bbox out to the upper line's end, not the 1px degenerate clamp", () => {
    const { view } = makeView({ coords: WRAP.coords })
    const rect = rangeToRect(view, WRAP.from, WRAP.to)
    // w = 928 - 882 = 46 (was max(258 - 882, 1) = 1), h = 459 - 440 = 19.
    expect(tuple(rect)).toEqual([882, 440, 46, 19])
  })

  it("collapsed range on the wrap keeps the legacy after-bias (no interior to bias into)", () => {
    const { view } = makeView({ coords: WRAP.coords })
    const rect = pointAnchorAtHead(view, WRAP.to, WRAP.to, WRAP.to, {
      height: "zero",
    })
    expect(tuple(rect)).toEqual([257, 464, 0, 0])
  })
})

describe("rangeToRect — parity with useBlockLinkPaste.rectForRange", () => {
  it("origin = start.left/start.top, size = bbox to end, NOT head-anchored", () => {
    const { view } = makeView({ coords: TWO_LINE.coords })
    const rect = rangeToRect(view, TWO_LINE.from, TWO_LINE.to)
    // x = start.left 100, y = start.top 50,
    // w = max(end.right 340 - 100, 1) = 240, h = max(end.bottom 96 - 50, 1) = 46
    expect(tuple(rect)).toEqual([100, 50, 240, 46])
  })

  it("clamps width/height to a 1px minimum when the range is degenerate/reversed", () => {
    // end.right < start.left and end.bottom < start.top → both clamp to 1.
    const { view } = makeView({
      coords: {
        5: { left: 300, right: 340, top: 80, bottom: 96 },
        20: { left: 100, right: 120, top: 40, bottom: 50 },
      },
    })
    const rect = rangeToRect(view, 5, 20)
    // x = 300, y = 80, w = max(120 - 300, 1) = 1, h = max(50 - 80, 1) = 1
    expect(tuple(rect)).toEqual([300, 80, 1, 1])
  })

  it("returns null when coordsAtPos throws (caller substitutes its 1×1 fallback)", () => {
    const { view } = makeView({ coords: TWO_LINE.coords, throwAt: new Set([5]) })
    expect(rangeToRect(view, 5, 20)).toBeNull()
  })
})

describe("rectForBlockId — block-element rect query", () => {
  it("queries [data-id] with CSS.escape and returns the element rect", () => {
    const elRect = new DOMRect(100, 50, 200, 30)
    const { view, querySelector } = makeView({ elements: { "block-1": elRect } })
    const rect = rectForBlockId(view, "block-1")
    expect(querySelector).toHaveBeenCalledWith('[data-id="block-1"]')
    expect(tuple(rect)).toEqual([100, 50, 200, 30])
  })

  it("CSS.escapes ids with special characters (no raw template injection)", () => {
    const { view, querySelector } = makeView({ elements: {} })
    rectForBlockId(view, 'a"b]c')
    // CSS.escape turns `"` and `]` into escaped sequences — assert the selector
    // is the escaped form, never the raw `[data-id="a"b]c"]`.
    expect(querySelector).toHaveBeenCalledWith(`[data-id="${CSS.escape('a"b]c')}"]`)
  })

  it("returns null when the element is not in the DOM", () => {
    const { view } = makeView({ elements: {} })
    expect(rectForBlockId(view, "missing")).toBeNull()
  })
})

describe("unionBlockRect — first/last block union", () => {
  it("unions the bbox of all resolved block elements (min-left/top, max-right/bottom)", () => {
    const { view } = makeView({
      elements: {
        first: new DOMRect(100, 50, 100, 30), // right 200, bottom 80
        last: new DOMRect(120, 90, 140, 50), // right 260, bottom 140
      },
    })
    const rect = unionBlockRect(view, ["first", "last"])
    // left = min(100,120)=100, top = min(50,90)=50,
    // w = max(200,260)-100 = 160, h = max(80,140)-50 = 90
    expect(tuple(rect)).toEqual([100, 50, 160, 90])
  })

  it("a single block degenerates to that block's own rect", () => {
    const { view } = makeView({ elements: { only: new DOMRect(10, 20, 300, 40) } })
    expect(tuple(unionBlockRect(view, ["only"]))).toEqual([10, 20, 300, 40])
  })

  it("drops ids whose element is missing, unioning whatever resolves", () => {
    const { view } = makeView({ elements: { present: new DOMRect(10, 20, 300, 40) } })
    expect(tuple(unionBlockRect(view, ["gone", "present"]))).toEqual([10, 20, 300, 40])
  })

  it("returns null when no id resolves", () => {
    const { view } = makeView({ elements: {} })
    expect(unionBlockRect(view, ["a", "b"])).toBeNull()
  })
})
