// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, it, expect } from "vitest"
import { TextSelection } from "@tiptap/pm/state"
import { createTestEditor } from "../../../test-utils/createTestEditor"
import { exportMarkdown } from "../../../api/export/markdown"
import { TitleKit, TITLE_TYPE } from "../index"
import {
  setTitleText,
  handleTitleEnter,
  handleBoundaryBackspace,
} from "../boundary"

type Ed = ReturnType<typeof createTestEditor>

function makeEditor(element?: HTMLElement): Ed {
  // Omit `element` unless a test needs a mounted view. Tiptap only creates the
  // EditorView (and thus runs plugin `view()` callbacks) when `element` is set,
  // so an element-less editor skips the view() seed passes — both BlockId's id
  // backfill and the title self-heal in boundary.ts. Tests that drive
  // normalization through setContent's appendTransaction don't need them; the
  // mount-gap test below passes a real element precisely to exercise the title
  // view() pass.
  return createTestEditor(
    element ? { element, kit: { plugins: [TitleKit] } } : { kit: { plugins: [TitleKit] } },
  )
}

const titleJson = (text: string) =>
  text
    ? { type: TITLE_TYPE, content: [{ type: "text", text }] }
    : { type: TITLE_TYPE }

const paraJson = (text: string) =>
  text
    ? { type: "paragraph", content: [{ type: "text", text }] }
    : { type: "paragraph" }

function setDoc(editor: Ed, content: unknown[]) {
  editor.commands.setContent({ type: "doc", content } as never)
}

function setCaret(editor: Ed, pos: number) {
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)),
  )
}

function childTypes(editor: Ed): string[] {
  const out: string[] = []
  editor.state.doc.forEach((node) => out.push(node.type.name))
  return out
}

describe("TitleBlock — spec declaration", () => {
  it("is hidden from the slash menu, the side menu, and AI write tools", () => {
    const editor = makeEditor()
    const storage = editor.extensionManager.extensions.find(
      (e) => e.name === TITLE_TYPE,
    )!.storage as {
      slashMenuItems?: unknown
      sideMenu?: { draggable: boolean }
      agentHidden?: boolean
      clipboardRenderDOM?: () => unknown
    }
    // No slash entry — the title is structural, never user-inserted.
    expect(storage.slashMenuItems).toBeUndefined()
    // No drag handle.
    expect(storage.sideMenu?.draggable).toBe(false)
    // Excluded from rune-ai read-tool outputs, so write tools get no id to target it (T1 capability flag).
    expect(storage.agentHidden).toBe(true)
    // Clipboard emits ONLY the bare semantic <h1> (no rune chrome).
    expect(storage.clipboardRenderDOM!()).toEqual(["h1", {}, 0])
  })

  it("forbids inline marks — the page title is plain text (no bold/italic/color)", () => {
    const element = document.createElement("div")
    document.body.appendChild(element)
    const editor = makeEditor(element)
    setDoc(editor, [titleJson("Hello"), paraJson("body")])

    // Schema-level: the title node permits no marks, so PM's allowsMarkType is
    // false for every registered mark (`marks: ""` in the spec).
    expect(editor.schema.nodes[TITLE_TYPE]!.spec.marks).toBe("")

    // Behavioural: bolding the whole title is a no-op — PM's addMark skips a
    // range whose parent forbids the mark, so nothing sticks. (A paste carrying
    // marks is stripped by the same rule.)
    const bold = editor.schema.marks.bold!
    const title = editor.state.doc.firstChild!
    const start = 1
    const end = start + title.content.size
    editor.view.dispatch(editor.state.tr.addMark(start, end, bold.create()))

    let markCount = 0
    editor.state.doc.firstChild!.descendants((n) => {
      markCount += n.marks.length
    })
    expect(markCount).toBe(0)
    element.remove()
  })

  it("renders div.rune-block > div.rune-block-content > h1.rune-title with the a11y textbox role", () => {
    const element = document.createElement("div")
    document.body.appendChild(element)
    const editor = makeEditor(element)
    setDoc(editor, [titleJson("Hi"), paraJson("body")])

    const outer = editor.view.dom.querySelector<HTMLElement>(".rune-block")!
    expect(outer).not.toBeNull()
    const content = outer.firstElementChild as HTMLElement
    expect(content.classList.contains("rune-block-content")).toBe(true)
    const h1 = content.firstElementChild as HTMLElement
    expect(h1.tagName).toBe("H1")
    expect(h1.classList.contains("rune-title")).toBe(true)
    expect(h1.getAttribute("role")).toBe("textbox")
    expect(h1.getAttribute("aria-label")).toBe("Page title")
    expect(h1.getAttribute("aria-multiline")).toBe("true")
    element.remove()
  })

  it("gets its BlockId filled for free (derived plugin block)", () => {
    const editor = makeEditor()
    setDoc(editor, [titleJson("Hi"), paraJson("body")])
    const id = editor.state.doc.firstChild?.attrs.id
    expect(typeof id).toBe("string")
    expect(id).toBeTruthy()
  })
})

describe("TitleBoundary — keymap wiring", () => {
  it("registers Enter / Shift-Enter / Mod-Enter / Backspace at priority 200", () => {
    const editor = makeEditor()
    const ext = editor.extensionManager.extensions.find(
      (e) => e.name === "runeTitleBoundary",
    )
    expect(ext).toBeDefined()
    expect((ext as { config: { priority?: number } }).config.priority).toBe(200)
    const shortcuts = (
      ext as { config: { addKeyboardShortcuts: (this: unknown) => Record<string, unknown> } }
    ).config.addKeyboardShortcuts.call({ editor, type: ext, options: {} })
    expect(Object.keys(shortcuts).sort()).toEqual([
      "Backspace",
      "Enter",
      "Mod-Enter",
      "Shift-Enter",
    ])
  })
})

describe("title first / singleton / non-deletable (self-healing normalization)", () => {
  it("seeds a title at index 0 when content arrives without one", () => {
    const editor = makeEditor()
    setDoc(editor, [paraJson("body")])
    expect(editor.state.doc.firstChild?.type.name).toBe(TITLE_TYPE)
  })

  it("re-seeds a title after select-all + Delete empties the doc", () => {
    const editor = makeEditor()
    setDoc(editor, [titleJson("Hi"), paraJson("body")])
    editor.commands.selectAll()
    editor.commands.deleteSelection()
    expect(editor.state.doc.firstChild?.type.name).toBe(TITLE_TYPE)
  })

  it("moves a displaced title back to index 0, keeping its text", () => {
    const editor = makeEditor()
    setDoc(editor, [paraJson("ahead"), titleJson("Kept")])
    expect(editor.state.doc.firstChild?.type.name).toBe(TITLE_TYPE)
    // Text preserved — not blanked-and-re-seeded.
    expect(editor.state.doc.firstChild?.textContent).toBe("Kept")
    // The block that was ahead of it becomes body.
    expect(childTypes(editor).filter((t) => t === TITLE_TYPE)).toHaveLength(1)
    expect(editor.state.doc.child(1).textContent).toBe("ahead")
  })

  it("demotes a stray second title to a paragraph (keeps the topmost)", () => {
    const editor = makeEditor()
    setDoc(editor, [titleJson("A"), titleJson("B")])
    const types = childTypes(editor)
    expect(types[0]).toBe(TITLE_TYPE)
    expect(types[1]).toBe("paragraph")
    expect(types.filter((t) => t === TITLE_TYPE)).toHaveLength(1)
    // The demoted title keeps its text as body.
    expect(editor.state.doc.child(1).textContent).toBe("B")
  })
})

describe("title self-heal runs on mount (view() seed pass), not only on edit", () => {
  it("seeds a title at index 0 on construction when no docChanged tx ever fires", () => {
    // The mount gap: normalizeTitle used to run ONLY from the boundary's
    // appendTransaction (gated on tr.docChanged). On a freshly mounted editor
    // whose initial content has NO title and whose body blocks ALREADY carry
    // ids, BlockId's view-pass computes zero patches and dispatches nothing —
    // so no docChanged tx fires and (without boundary.ts's own view() pass)
    // the title would never be seeded until the first edit. A real-element
    // mount is required so plugin view() callbacks run at all (Tiptap creates
    // the EditorView only when `element` is set); content is passed to the
    // ctor — NOT setContent — so the ONLY thing that can seed the title is the
    // view() pass.
    const element = document.createElement("div")
    document.body.appendChild(element)
    const editor = createTestEditor({
      element,
      kit: { plugins: [TitleKit] },
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            // Already id'd → BlockId's view backfill is a no-op (zero patches),
            // so it can't be what cascades a title into existence.
            attrs: { id: "fixed-body-id" },
            content: [{ type: "text", text: "body" }],
          },
        ],
      } as never,
    })

    // No setContent, no edit — the title must already be present from the
    // view() seed pass.
    expect(editor.state.doc.firstChild?.type.name).toBe(TITLE_TYPE)
    expect(childTypes(editor).filter((t) => t === TITLE_TYPE)).toHaveLength(1)
    // The pre-id'd body block survives as the second block.
    expect(editor.state.doc.child(1).textContent).toBe("body")

    element.remove()
  })
})

describe("Enter inside the title splits at the caret (Notion)", () => {
  it("splits mid-title: prefix stays, suffix → new paragraph, caret at its start", () => {
    const editor = makeEditor()
    setDoc(editor, [titleJson("HelloWorld")])
    // pos 6 = title content start (1) + 5 chars ("Hello").
    setCaret(editor, 6)
    expect(handleTitleEnter(editor)).toBe(true)

    expect(editor.state.doc.firstChild?.type.name).toBe(TITLE_TYPE)
    expect(editor.state.doc.firstChild?.textContent).toBe("Hello")
    expect(editor.state.doc.child(1).type.name).toBe("paragraph")
    expect(editor.state.doc.child(1).textContent).toBe("World")
    const { $from } = editor.state.selection
    expect($from.parent.type.name).toBe("paragraph")
    expect($from.parentOffset).toBe(0)
  })

  it("Enter at the title's end opens an empty paragraph below", () => {
    const editor = makeEditor()
    setDoc(editor, [titleJson("Hello")])
    // pos 6 = end of "Hello" (title content end).
    setCaret(editor, 6)
    expect(handleTitleEnter(editor)).toBe(true)

    expect(editor.state.doc.firstChild?.textContent).toBe("Hello")
    expect(editor.state.doc.child(1).type.name).toBe("paragraph")
    expect(editor.state.doc.child(1).textContent).toBe("")
    expect(editor.state.selection.$from.parent.type.name).toBe("paragraph")
  })
})

describe("Backspace at the title↔body boundary (Notion)", () => {
  it("at the very start of the title — swallows it, doc unchanged", () => {
    const editor = makeEditor()
    setDoc(editor, [titleJson("Title"), paraJson("body")])
    setCaret(editor, 1) // start of title content
    const before = editor.state.doc.toJSON()
    expect(handleBoundaryBackspace(editor)).toBe(true)
    expect(editor.state.doc.toJSON()).toEqual(before)
  })

  it("an empty first body block collapses into the title", () => {
    const editor = makeEditor()
    setDoc(editor, [titleJson("Title"), paraJson(""), paraJson("second")])
    // Caret at start of the empty paragraph (index 1).
    const bodyStart = editor.state.doc.firstChild!.nodeSize + 1
    setCaret(editor, bodyStart)
    expect(handleBoundaryBackspace(editor)).toBe(true)

    expect(childTypes(editor)).toEqual([TITLE_TYPE, "paragraph"])
    expect(editor.state.doc.firstChild?.textContent).toBe("Title")
    expect(editor.state.doc.child(1).textContent).toBe("second")
    // Caret hops up into the title.
    expect(editor.state.selection.$from.parent.type.name).toBe(TITLE_TYPE)
  })

  it("a content first body block merges its text into the title end", () => {
    const editor = makeEditor()
    setDoc(editor, [titleJson("Hello"), paraJson(" World")])
    const bodyStart = editor.state.doc.firstChild!.nodeSize + 1
    setCaret(editor, bodyStart)
    expect(handleBoundaryBackspace(editor)).toBe(true)

    expect(editor.state.doc.firstChild?.type.name).toBe(TITLE_TYPE)
    expect(editor.state.doc.firstChild?.textContent).toBe("Hello World")
    // The merged body block is consumed; normalization keeps ONE empty body
    // line so the doc is never left title-only (the "always an editable body
    // line" invariant). The caret stays at the merge seam inside the title.
    expect(childTypes(editor)).toEqual([TITLE_TYPE, "paragraph"])
    expect(editor.state.doc.child(1).textContent).toBe("")
    expect(editor.state.selection.$from.parent.type.name).toBe(TITLE_TYPE)
  })

  it("never absorbs a non-textblock first body (divider stays put)", () => {
    // The literal `!body.isTextblock` hop branch is defensive: with rune's
    // current root blocks every non-textblock is a LEAF atom (divider, image,
    // …), which can't host a depth-1 text caret, so `atFirstBodyStart` never
    // resolves to a non-textblock body. We pin the observable contract — the
    // boundary backspace never merges/destroys a divider — via a NodeSelection
    // on it (handler declines; PM default, not the title, owns that key).
    const editor = makeEditor()
    setDoc(editor, [titleJson("T"), { type: "divider" }])
    const dividerPos = editor.state.doc.firstChild!.nodeSize
    editor.commands.setNodeSelection(dividerPos)
    expect(handleBoundaryBackspace(editor)).toBe(false)
    expect(editor.state.doc.child(1).type.name).toBe("divider")
  })
})

describe("setTitleText — imperative external rename", () => {
  it("replaces the title's text", () => {
    const editor = makeEditor()
    setDoc(editor, [titleJson("Old"), paraJson("body")])
    setTitleText(editor, "New")
    expect(editor.state.doc.firstChild?.textContent).toBe("New")
  })

  it("is a no-op when the text already matches (no doc mutation)", () => {
    const editor = makeEditor()
    setDoc(editor, [titleJson("Same"), paraJson("body")])
    const docBefore = editor.state.doc
    setTitleText(editor, "Same")
    // The command returns false before dispatching, so the doc is never
    // mutated — same node reference (Tiptap still rebuilds the surrounding
    // state object for any command run, so only the doc ref is load-bearing).
    expect(editor.state.doc).toBe(docBefore)
    expect(editor.state.doc.firstChild?.textContent).toBe("Same")
  })

  it("clears the title when given an empty string", () => {
    const editor = makeEditor()
    setDoc(editor, [titleJson("Something"), paraJson("body")])
    setTitleText(editor, "")
    expect(editor.state.doc.firstChild?.textContent).toBe("")
  })
})

describe("toMarkdown — single-line H1, null when empty", () => {
  it("emits `# text` as the first line", () => {
    const editor = makeEditor()
    setDoc(editor, [titleJson("My Title"), paraJson("body")])
    const md = exportMarkdown(editor)
    expect(md.split("\n")[0]).toBe("# My Title")
    expect(md).toContain("body")
  })

  it("omits an empty title entirely (no dangling `# `)", () => {
    const editor = makeEditor()
    setDoc(editor, [titleJson(""), paraJson("body")])
    const md = exportMarkdown(editor)
    expect(md).not.toContain("#")
    expect(md.trim()).toBe("body")
  })
})

describe("Backspace merge-up promotes the merged block's orphaned subtree", () => {
  const indentedPara = (text: string, depth: number) => ({
    type: "paragraph",
    attrs: { depth },
    content: [{ type: "text", text }],
  })

  function depths(editor: Ed): [string, unknown][] {
    const out: [string, unknown][] = []
    editor.state.doc.forEach((n) => out.push([n.textContent, n.attrs.depth]))
    return out
  }

  it("promotes a single indented follower to top level", () => {
    const editor = makeEditor()
    setDoc(editor, [titleJson("T"), indentedPara("parent", 0), indentedPara("child", 1)])
    const titleSize = editor.state.doc.child(0).nodeSize
    setCaret(editor, titleSize + 1) // start of "parent" (first body block)
    expect(handleBoundaryBackspace(editor)).toBe(true)
    // "parent" merged into the title; "child" no longer dangles indented under
    // the title (which is never an indent parent) — it is promoted to depth 0.
    expect(depths(editor)).toEqual([
      ["Tparent", 0],
      ["child", 0],
    ])
  })

  it("shifts a multi-level subtree uniformly, keeping its internal shape", () => {
    const editor = makeEditor()
    setDoc(editor, [
      titleJson("T"),
      indentedPara("parent", 0),
      indentedPara("child", 1),
      indentedPara("grand", 2),
      indentedPara("sibling", 0), // not part of the subtree — must stay put
    ])
    const titleSize = editor.state.doc.child(0).nodeSize
    setCaret(editor, titleSize + 1)
    expect(handleBoundaryBackspace(editor)).toBe(true)
    expect(depths(editor)).toEqual([
      ["Tparent", 0],
      ["child", 0],
      ["grand", 1],
      ["sibling", 0],
    ])
  })

  it("leaves a non-indented follower untouched (common case, no-op shift)", () => {
    const editor = makeEditor()
    setDoc(editor, [titleJson("T"), indentedPara("parent", 0), indentedPara("next", 0)])
    const titleSize = editor.state.doc.child(0).nodeSize
    setCaret(editor, titleSize + 1)
    expect(handleBoundaryBackspace(editor)).toBe(true)
    expect(depths(editor)).toEqual([
      ["Tparent", 0],
      ["next", 0],
    ])
  })
})

describe("read-only editor does not author title structure on mount (#7)", () => {
  it("a read-only editor over a title-less doc gets NO injected title", () => {
    const element = document.createElement("div")
    const editor = createTestEditor({
      element,
      editable: false,
      content: { type: "doc", content: [paraJson("body only")] } as never,
      kit: { plugins: [TitleKit] },
    })
    // The mount seed (and appendTransaction) are both gated on editable, so the
    // read-only doc is displayed verbatim — no <title>, no extra paragraph.
    expect(childTypes(editor)).toEqual(["paragraph"])
    expect(editor.state.doc.firstChild?.textContent).toBe("body only")
  })

  it("an editable editor over the same doc still gets the title seeded (control)", () => {
    const element = document.createElement("div")
    const editor = createTestEditor({
      element,
      content: { type: "doc", content: [paraJson("body only")] } as never,
      kit: { plugins: [TitleKit] },
    })
    expect(editor.state.doc.firstChild?.type.name).toBe(TITLE_TYPE)
  })
})
