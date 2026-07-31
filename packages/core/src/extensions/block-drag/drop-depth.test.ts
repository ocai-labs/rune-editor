// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, expect, it } from "vitest"
import { chooseDropDepth, dropIndicatorLeftForDepth } from "./drop-depth"

const owners = new Set(["bulletList", "numberedList", "taskList", "toggle"])

function choose(previousBlocks: Array<{ type: string; depth: number }>, cursorX: number) {
  return chooseDropDepth({
    cursorX,
    minLeft: 100,
    indentStepPx: 30,
    previousBlocks,
    ownerTypes: owners,
  })
}

describe("chooseDropDepth", () => {
  it("ordinary previous blocks only allow root depth", () => {
    expect(choose([{ type: "paragraph", depth: 4 }], 260)).toBe(0)
    expect(choose([{ type: "heading", depth: 0 }], 160)).toBe(0)
  })

  it("no previous block only allows depth 0", () => {
    expect(choose([], 190)).toBe(0)
  })

  it("allows one deeper than a list owner", () => {
    const previous = [{ type: "bulletList", depth: 1 }]
    expect(choose(previous, 100)).toBe(0)
    expect(choose(previous, 130)).toBe(1)
    expect(choose(previous, 160)).toBe(2)
  })

  it("allows one deeper than a Toggle owner", () => {
    expect(choose([{ type: "toggle", depth: 0 }], 160)).toBe(1)
    expect(choose([
      { type: "toggle", depth: 0 },
      { type: "toggle", depth: 1 },
    ], 190)).toBe(2)
  })

  it("continues an owner body after an ordinary child without nesting under it", () => {
    const previous = [
      { type: "toggle", depth: 0 },
      { type: "paragraph", depth: 1 },
    ]
    expect(choose(previous, 130)).toBe(1)
    expect(choose(previous, 190)).toBe(1)
  })

  it("clamps cursor left of the editor to depth 0", () => {
    expect(choose([{ type: "bulletList", depth: 2 }], 40)).toBe(0)
  })

  it("clamps cursor far right to the owner-aware max depth", () => {
    expect(choose([{ type: "bulletList", depth: 2 }], 1000)).toBe(3)
  })

  it("falls back to depth 0 when indent step is invalid", () => {
    expect(chooseDropDepth({
      cursorX: 160,
      minLeft: 100,
      indentStepPx: 0,
      previousBlocks: [{ type: "bulletList", depth: 2 }],
      ownerTypes: owners,
    })).toBe(0)
  })

  // The drop depth is otherwise a function of the DESTINATION alone. A block
  // whose bytes cannot survive a container is the one case where the source has
  // to be consulted: the codec flattens it on save, so offering a deeper slot
  // means the editor accepts a gesture, indents the block, and then quietly
  // undoes it at the next save.
  it("pins a depth-flattening block to 0 wherever the slot allows more", () => {
    const slot = {
      cursorX: 190,
      minLeft: 100,
      indentStepPx: 30,
      previousBlocks: [{ type: "bulletList", depth: 0 }],
      ownerTypes: owners,
    }
    // The same slot, same cursor, for an ordinary block:
    expect(chooseDropDepth(slot)).toBe(1)
    expect(chooseDropDepth({ ...slot, sourceFlattensDepth: true })).toBe(0)
  })

  it("leaves blocks that merely decline to indent alone", () => {
    // `indent.maxDepth: 0` is a weaker claim than `markdown.flattensDepth`, and
    // the drag deliberately does not read it: a fenced code block indented under
    // a list item round-trips perfectly, so that gesture stays available.
    expect(chooseDropDepth({
      cursorX: 190,
      minLeft: 100,
      indentStepPx: 30,
      previousBlocks: [{ type: "bulletList", depth: 0 }],
      ownerTypes: owners,
      sourceFlattensDepth: false,
    })).toBe(1)
  })
})

describe("dropIndicatorLeftForDepth", () => {
  it("maps depth back to minLeft plus indent steps", () => {
    expect(dropIndicatorLeftForDepth({
      minLeft: 100,
      indentStepPx: 30,
      depth: 2,
    })).toBe(160)
  })
})
