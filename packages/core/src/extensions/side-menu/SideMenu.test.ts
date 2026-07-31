// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { Editor } from "@tiptap/core"
import Document from "@tiptap/extension-document"
import Text from "@tiptap/extension-text"
import { createBlockSpec } from "../../schema"
import { SideMenu, sideMenuKey } from "./SideMenu"
import { GestureStatePlugin, gestureKey } from "../shared/gesture-state"
import { BlockSelection, blockSelectionKey } from "../block-selection"
import { BlockId } from "../block-id"
import { Divider } from "../../blocks/Divider/block"
import { SuggestionMenus } from "../suggestion-menus/SuggestionMenus"
import { createTestEditor } from "../../test-utils/createTestEditor"

const Para = createBlockSpec({
  type: "paragraph",
  content: "inline*",
  parseDOM: [{ tag: "p" }],
  renderDOM: ({ HTMLAttributes }) => ["p", HTMLAttributes, 0],
  sideMenu: { draggable: true },
})

const SyntheticAtom = createBlockSpec({
  type: "synthetic-atom",
  content: "",
  parseDOM: [{ tag: "synthetic-atom" }],
  renderDOM: ({ HTMLAttributes }) => [
    "div",
    { ...HTMLAttributes, class: "rune-block" },
    ["span", { class: "synthetic-atom__visible" }, "ATOM"],
  ],
  sideMenu: { draggable: true },
})

let container: HTMLDivElement

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
})

afterEach(() => {
  container.remove()
})

function mk(content: string) {
  return new Editor({
    element: container,
    extensions: [Document, Text, Para, GestureStatePlugin, SideMenu],
    content,
  })
}

type SMStorage = { sideMenu: { hoveredBlock: { pos: number; type: string } | null } }

describe("SideMenu integration", () => {
  it("mousemove dispatches hoveredPos inside editor hot zone", async () => {
    const editor = mk("<p>hello</p><p>world</p>")
    editor.view.posAtCoords = () => ({ pos: 2, inside: 0 })
    const rect = {
      left: 0, top: 0, right: 500, bottom: 500, width: 500, height: 500,
      x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect
    editor.view.dom.getBoundingClientRect = () => rect
    const ps = container.querySelectorAll("p")
    for (const p of Array.from(ps)) {
      ;(p as HTMLElement).getBoundingClientRect = () =>
        ({
          top: 0, bottom: 500, left: 0, right: 500,
          width: 500, height: 500, x: 0, y: 0, toJSON: () => ({}),
        }) as DOMRect
    }

    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 100, clientY: 50 }))
    await new Promise((r) => requestAnimationFrame(r))
    await new Promise((r) => requestAnimationFrame(r))

    expect(sideMenuKey.getState(editor.state)?.hoveredPos).toBe(0)
    editor.destroy()
  })

  it("mousemove early-returns when gesture is active", async () => {
    const editor = mk("<p>hello</p>")
    editor.view.dispatch(
      editor.state.tr.setMeta(gestureKey, { activeGesture: "block-drag" }),
    )
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 100, clientY: 50 }))
    await new Promise((r) => requestAnimationFrame(r))
    await new Promise((r) => requestAnimationFrame(r))
    expect(sideMenuKey.getState(editor.state)?.hoveredPos).toBeNull()
    editor.destroy()
  })

  it("flushes DOM selection before hoveredPos dispatch", async () => {
    const editor = mk("<p>hello</p><p>world</p>")
    editor.view.posAtCoords = () => ({ pos: 2, inside: 0 })
    const rect = {
      left: 0, top: 0, right: 500, bottom: 500, width: 500, height: 500,
      x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect
    editor.view.dom.getBoundingClientRect = () => rect
    const ps = container.querySelectorAll("p")
    for (const p of Array.from(ps)) {
      ;(p as HTMLElement).getBoundingClientRect = () =>
        ({
          top: 0, bottom: 500, left: 0, right: 500,
          width: 500, height: 500, x: 0, y: 0, toJSON: () => ({}),
        }) as DOMRect
    }

    const domObserver = (editor.view as unknown as { domObserver?: { flush: () => void } }).domObserver
    expect(domObserver).toBeDefined()
    const flushSpy = vi.spyOn(domObserver!, "flush")

    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 100, clientY: 50 }))
    await new Promise((r) => requestAnimationFrame(r))
    await new Promise((r) => requestAnimationFrame(r))

    expect(flushSpy).toHaveBeenCalled()
    editor.destroy()
  })

  it("ignores mousemove from portaled Rune editor chrome", async () => {
    const editor = mk("<p>hello</p>")
    const posAtCoords = vi.fn(() => ({ pos: 2, inside: 0 }))
    editor.view.posAtCoords = posAtCoords
    editor.view.dom.getBoundingClientRect = () =>
      ({
        left: 0, top: 0, right: 500, bottom: 500, width: 500, height: 500,
        x: 0, y: 0, toJSON: () => ({}),
      }) as DOMRect

    const chrome = document.createElement("div")
    chrome.setAttribute("data-rune-editor-chrome", "")
    const child = document.createElement("button")
    chrome.appendChild(child)
    document.body.appendChild(chrome)

    child.dispatchEvent(
      new MouseEvent("mousemove", {
        bubbles: true,
        clientX: 100,
        clientY: 50,
      }),
    )
    await new Promise((r) => requestAnimationFrame(r))
    await new Promise((r) => requestAnimationFrame(r))

    expect(posAtCoords).not.toHaveBeenCalled()
    expect(sideMenuKey.getState(editor.state)?.hoveredPos).toBeNull()
    chrome.remove()
    editor.destroy()
  })

  it("renders widget decoration at hovered block", () => {
    const editor = mk("<p>hello</p>")
    editor.view.dispatch(editor.state.tr.setMeta(sideMenuKey, { hoveredPos: 0 }))
    expect(container.querySelector(".rune-side-menu")).not.toBeNull()
    editor.destroy()
  })

  it("external storage.hoveredBlock updates when hoveredPos changes", () => {
    const editor = mk("<p>hello</p>")
    const storage = (editor.storage as unknown as SMStorage).sideMenu
    expect(storage.hoveredBlock).toBeNull()
    editor.view.dispatch(editor.state.tr.setMeta(sideMenuKey, { hoveredPos: 0 }))
    expect(storage.hoveredBlock?.pos).toBe(0)
    expect(storage.hoveredBlock?.type).toBe("paragraph")
    editor.destroy()
  })

  it("synthetic atom block — host renders, decoration sync works", () => {
    const editor = new Editor({
      element: container,
      extensions: [Document, Text, SyntheticAtom, GestureStatePlugin, SideMenu],
      content: "<synthetic-atom></synthetic-atom>",
    })
    const block = container.querySelector(".rune-block")
    const host = block?.querySelector(".rune-side-menu-host") as HTMLElement
    expect(host).not.toBeNull()
    expect(host.children.length).toBe(0)

    editor.view.dispatch(editor.state.tr.setMeta(sideMenuKey, { hoveredPos: 0 }))
    expect(host.children.length).toBe(1)
    expect(host.querySelector(".rune-side-menu")).not.toBeNull()
    expect(host.querySelector(".rune-side-menu-grip")).not.toBeNull()

    editor.view.dispatch(editor.state.tr.setMeta(sideMenuKey, { hoveredPos: null }))
    expect(host.children.length).toBe(0)
    editor.destroy()
  })
})

function mkWithBlockSelection(content: string) {
  return new Editor({
    element: container,
    extensions: [Document, Text, Para, BlockId, GestureStatePlugin, SideMenu, BlockSelection],
    content,
  })
}

function mkWithDivider(content: string) {
  return new Editor({
    element: container,
    extensions: [Document, Text, Para, Divider, GestureStatePlugin, SideMenu],
    content,
  })
}

describe("SideMenu — atom host mount", () => {
  it("fills and clears the divider atom host", () => {
    const editor = mkWithDivider("<hr><p>tail</p>")
    const divider = container.querySelector(".ProseMirror > .rune-block") as HTMLElement
    const host = divider.querySelector(".rune-side-menu-host")

    expect(host).not.toBeNull()
    expect(host?.querySelector(".rune-side-menu")).toBeNull()

    editor.view.dispatch(editor.state.tr.setMeta(sideMenuKey, { hoveredPos: 0 }))
    expect(host?.querySelector(".rune-side-menu")).not.toBeNull()
    expect(divider.classList.contains("rune-side-menu-active")).toBe(true)

    editor.view.dispatch(editor.state.tr.setMeta(sideMenuKey, { hoveredPos: null }))
    expect(divider.classList.contains("rune-side-menu-active")).toBe(false)
    expect(host?.querySelector(".rune-side-menu")).toBeNull()
    editor.destroy()
  })

  it("does not mount divider side-menu as a direct ProseMirror widget sibling", () => {
    const editor = mkWithDivider("<hr><p>tail</p>")
    editor.view.dispatch(editor.state.tr.setMeta(sideMenuKey, { hoveredPos: 0 }))

    const pm = container.querySelector(".ProseMirror") as HTMLElement
    const directWidget = Array.from(pm.children).find((child) =>
      child.classList.contains("rune-side-menu"),
    )
    expect(directWidget).toBeUndefined()
    editor.destroy()
  })

  it("atom host + action resolves the latest position after dropdown-pinned doc changes", () => {
    const editor = new Editor({
      element: container,
      extensions: [
        Document,
        Text,
        Para,
        Divider,
        BlockId,
        GestureStatePlugin,
        SideMenu,
        BlockSelection,
        SuggestionMenus.configure({ triggers: [{ char: "/" }] }),
      ],
      content: "<hr>",
    })

    const dividerId = editor.state.doc.child(0).attrs.id as string
    editor.view.dispatch(editor.state.tr.setMeta(sideMenuKey, { hoveredPos: 0 }))
    editor.view.dispatch(
      editor.state.tr.setMeta(blockSelectionKey, { openDropdownFor: dividerId }),
    )
    const add = container.querySelector(
      ".rune-side-menu-host [data-rune-side-menu-button='add']",
    ) as HTMLButtonElement
    expect(add).not.toBeNull()

    const paragraph = editor.state.schema.nodes.paragraph!.create()
    editor.view.dispatch(editor.state.tr.insert(0, paragraph))
    expect(sideMenuKey.getState(editor.state)?.hoveredPos).toBeNull()

    add.click()

    expect(editor.state.doc.childCount).toBe(3)
    expect(editor.state.doc.child(0).type.name).toBe("paragraph")
    expect(editor.state.doc.child(0).textContent).toBe("")
    expect(editor.state.doc.child(1).type.name).toBe("divider")
    expect(editor.state.doc.child(2).type.name).toBe("paragraph")
    expect(editor.state.doc.child(2).textContent).toBe("/")

    editor.destroy()
  })
})

describe("SideMenu — pin to dropdown block", () => {
  it("widget renders at dropdownBlockId block when set, ignoring hoveredPos", () => {
    const editor = mkWithBlockSelection("<p>a</p><p>b</p><p>c</p>")
    // hoveredPos points at block 0; dropdown is for block 2.
    editor.view.dispatch(editor.state.tr.setMeta(sideMenuKey, { hoveredPos: 0 }))
    const id2 = editor.state.doc.child(2).attrs.id as string
    editor.view.dispatch(
      editor.state.tr.setMeta(blockSelectionKey, { openDropdownFor: id2 }),
    )
    // Widget should be inside block 2's DOM, not block 0's.
    // Para in this test renders as bare <p> (no .rune-block wrapper); blocks
    // are the top-level children of the ProseMirror root.
    const blocks = container.querySelectorAll(".ProseMirror > p")
    const block2 = blocks[2] as HTMLElement
    const block0 = blocks[0] as HTMLElement
    expect(block2.querySelector(".rune-side-menu")).not.toBeNull()
    expect(block0.querySelector(".rune-side-menu")).toBeNull()
    editor.destroy()
  })

  it("after closeDropdown, widget snaps back to current hoveredPos", () => {
    const editor = mkWithBlockSelection("<p>a</p><p>b</p><p>c</p>")
    const id2 = editor.state.doc.child(2).attrs.id as string
    editor.view.dispatch(editor.state.tr.setMeta(sideMenuKey, { hoveredPos: 0 }))
    editor.view.dispatch(
      editor.state.tr.setMeta(blockSelectionKey, { openDropdownFor: id2 }),
    )
    editor.view.dispatch(
      editor.state.tr.setMeta(blockSelectionKey, { closeDropdown: true }),
    )
    const blocks = container.querySelectorAll(".ProseMirror > p")
    const block0 = blocks[0] as HTMLElement
    expect(block0.querySelector(".rune-side-menu")).not.toBeNull()
    editor.destroy()
  })

  it("if dropdown block is deleted, widget falls through to hoveredPos", () => {
    const editor = mkWithBlockSelection("<p>a</p><p>b</p><p>c</p>")
    const id2 = editor.state.doc.child(2).attrs.id as string
    editor.view.dispatch(
      editor.state.tr.setMeta(blockSelectionKey, { openDropdownFor: id2 }),
    )
    // Delete block 2.
    const block0Size = editor.state.doc.child(0).nodeSize
    const block1Size = editor.state.doc.child(1).nodeSize
    const from = block0Size + block1Size
    const to = from + editor.state.doc.child(2).nodeSize
    editor.view.dispatch(editor.state.tr.delete(from, to))
    // Re-establish hoveredPos AFTER the deletion (side-menu plugin clears
    // hoveredPos on any doc change, by design). The contract under test:
    // when dropdownBlockId no longer resolves, decorations() falls through
    // to hoveredPos rather than returning null.
    editor.view.dispatch(editor.state.tr.setMeta(sideMenuKey, { hoveredPos: 0 }))
    const blocks = container.querySelectorAll(".ProseMirror > p")
    const block0 = blocks[0] as HTMLElement
    expect(block0.querySelector(".rune-side-menu")).not.toBeNull()
    editor.destroy()
  })
})
