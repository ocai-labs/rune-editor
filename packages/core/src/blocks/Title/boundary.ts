// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The `TitleBoundary` extension that (a) keeps the title first/singleton/
// non-deletable via self-healing normalization — the same appendTransaction
// pattern rune uses for Columns — and (b) makes Enter/Backspace flow across
// the title↔body boundary the way Notion does.
//
// Ported up from downstream into rune-core: the only adaptation versus the
// proven host code is the import surface — `Extension` from `@tiptap/core`,
// `Plugin` / `PluginKey` / `TextSelection` from `@tiptap/pm/state`, and the
// `TITLE_TYPE` constant from this package instead of the host's runeTitleDoc.
import { Extension } from "@tiptap/core"
import type { Editor } from "@tiptap/core"
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state"
import { TITLE_TYPE } from "./constants"

const titleNormalizeKey = new PluginKey("rune-title-normalize")

type EditorState = Editor["state"]

function titleType(state: EditorState) {
  return state.schema.nodes[TITLE_TYPE]
}

function isInTitle(state: EditorState): boolean {
  const t = titleType(state)
  return t != null && state.selection.$from.parent.type === t
}

/**
 * Imperatively replace the title block's text — the host's way of pushing an
 * EXTERNAL rename (sidebar / another window) into the live title block without
 * a full `setContent` (which would tear down the body selection). Tagged
 * `addToHistory: false` so it's neither a user undo step nor — by the host
 * save layer's convention — a dirtying edit that would re-save a rename
 * that already landed on disk elsewhere. No-op when block 0 isn't a title or
 * the text already matches. The caller owns the "don't clobber active typing"
 * guard (it lives in the host's editor integration): this just performs the write.
 */
export function setTitleText(editor: Editor, text: string): void {
  editor.commands.command(({ tr, state, dispatch }) => {
    const t = state.schema.nodes[TITLE_TYPE]
    const title = state.doc.firstChild
    if (!t || !title || title.type !== t) return false
    if (title.textContent === text) return false
    if (dispatch) {
      // Position 1 is the start of the title's inline content (after its
      // opening token); nodeSize - 1 is the end (before the closing token).
      const from = 1
      const to = title.nodeSize - 1
      if (text) tr.replaceWith(from, to, state.schema.text(text))
      else tr.delete(from, to)
      tr.setMeta("addToHistory", false)
    }
    return true
  })
}

type PMNode = NonNullable<EditorState["doc"]["firstChild"]>

/** Whether the doc has any non-title (body) block. */
function hasBodyBlock(doc: PMNode, titleNodeType: PMNode["type"]): boolean {
  for (let i = 0; i < doc.childCount; i++) {
    if (doc.child(i).type !== titleNodeType) return true
  }
  return false
}

/**
 * Self-healing structure pass keeping two doc invariants. Tagged
 * `addToHistory: false` so it never lands as its own undo step.
 *
 * Invariant 1 — exactly one title, at index 0:
 *   • no title at all (e.g. select-all + Delete) — re-seed an empty one;
 *   • a title displaced from index 0 (e.g. an AI insert_blocks / move_blocks
 *     dropped a block ahead of it) — MOVE the title back to the front,
 *     preserving its text. The previous version demoted the displaced title and
 *     re-seeded a BLANK one, silently blanking the page title; this keeps it;
 *   • extra titles past the topmost (paste, AI) — demote them to paragraphs.
 *
 * Invariant 2 — at least one body block exists:
 *   the doc is schema-valid (`block+`) with just a title, but a title-only doc
 *   has no line to type into. Pre-title, the doc was all body so ProseMirror's
 *   own delete always re-created an empty paragraph; the title keeps the doc
 *   valid and defeats that, so any path that empties the body (cut, native
 *   deleteSelection, merge-up, AI/paste deletes) gets one empty paragraph
 *   appended here — preserving rune's historical "there is always an editable
 *   body line" contract. The keyboard delete path ALSO re-seeds in
 *   `setSelectionAfterDelete` so the caret lands in the new paragraph; this is
 *   the universal safety net for the paths that don't run that command (the
 *   caret stays where the operation left it, which for merge-up is the title).
 */
export function normalizeTitle(
  state: EditorState,
  opts?: { placeCaretInReseededBody?: boolean },
) {
  const t = titleType(state)
  const paragraph = state.schema.nodes.paragraph
  if (!t || !paragraph) return null

  const { doc } = state
  const bodyMissing = !hasBodyBlock(doc, t)

  // Fast path for the overwhelmingly common keystroke: block 0 is a title, no
  // later block is, and a body block exists. A tight index loop (no closure, no
  // array) over the top-level blocks, bailing out the moment it confirms the
  // canonical shape — so a normal edit allocates nothing and builds no
  // transaction. The full collection below only runs when the structure is off.
  if (doc.firstChild?.type === t && !bodyMissing) {
    let hasStray = false
    for (let i = 1; i < doc.childCount; i++) {
      if (doc.child(i).type === t) {
        hasStray = true
        break
      }
    }
    if (!hasStray) return null
  }

  const titles: { offset: number; index: number; node: PMNode }[] = []
  doc.forEach((node, offset, index) => {
    if (node.type === t) titles.push({ offset, index, node })
  })

  const tr = state.tr

  if (titles.length === 0) {
    // The title node is gone entirely; re-seed an empty one. Its text is
    // unrecoverable here — the host re-pushes the persisted title via setTitleText.
    tr.insert(0, t.create())
  } else {
    // Keep the TOPMOST title (never blank the page title); demote the rest to
    // paragraphs. Demote in reverse so earlier offsets stay valid; setNodeMarkup
    // preserves node size, so the kept title's offset is still correct after.
    // (`titles` is non-empty in this branch, so the indexed reads are safe under
    // core's `noUncheckedIndexedAccess`.)
    const keep = titles[0]!
    for (let i = titles.length - 1; i >= 1; i--) {
      tr.setNodeMarkup(titles[i]!.offset, paragraph)
    }
    // If something was inserted ahead of the title, lift it back to index 0
    // with its content intact (the blocks that preceded it become body).
    if (keep.index !== 0) {
      tr.delete(keep.offset, keep.offset + keep.node.nodeSize)
      tr.insert(0, keep.node)
    }
  }

  // Invariant 2: ensure a body block remains. Demoting a stray title already
  // supplies one, so this only fires when the doc is genuinely title-only.
  if (!hasBodyBlock(tr.doc as PMNode, t)) {
    const at = tr.doc.content.size
    tr.insert(at, paragraph.create())
    // A cut that emptied the body leaves the caret stranded in the title
    // (ProseMirror's cut handler put it there); move it into the fresh body
    // line so the user keeps typing where the content was — matching the
    // pre-title cut, where PM re-created the empty paragraph and selected it.
    // Other paths (merge-up keeps the caret at the title seam; the keyboard
    // delete command re-seeds with its own caret so this branch never fires)
    // are left untouched.
    if (opts?.placeCaretInReseededBody) {
      tr.setSelection(TextSelection.create(tr.doc, at + 1))
    }
  }

  tr.setMeta("addToHistory", false)
  return tr
}

/**
 * Enter inside the title splits at the caret the way Notion does: the text
 * before the caret stays in the title, everything after it moves into a new
 * paragraph inserted directly below the title, and the caret lands at the start
 * of that paragraph. At the title's end the suffix is empty, so this just opens
 * a fresh paragraph. The split-off block is always a paragraph (never a second
 * title) — normalizeTitle would demote a split title anyway.
 */
export function handleTitleEnter(editor: Editor): boolean {
  const { state } = editor
  const t = titleType(state)
  if (!isInTitle(state) || !t) return false
  const { $from, $to } = state.selection
  // Only handle a selection contained in the title; one that reaches into the
  // body falls through to rune's default Enter.
  if ($to.parent.type !== t) return false
  const paragraph = state.schema.nodes.paragraph
  const title = state.doc.firstChild
  if (!paragraph || !title) return false

  // Inline content from the (range) selection end to the end of the title.
  const suffix = title.content.cut($to.parentOffset)
  const titleContentEnd = title.nodeSize - 1

  return editor
    .chain()
    .command(({ tr, dispatch }) => {
      if (dispatch) {
        // Lift the selection + suffix out of the title, then drop the suffix
        // into a new paragraph right after the (now-shortened) title. Map the
        // old after-title position across the deletion so the insert lands
        // correctly even after the title shrank.
        tr.delete($from.pos, titleContentEnd)
        const insertAt = tr.mapping.map(title.nodeSize)
        tr.insert(insertAt, paragraph.create(null, suffix))
        tr.setSelection(TextSelection.create(tr.doc, insertAt + 1))
      }
      return true
    })
    .scrollIntoView()
    .run()
}

/**
 * Backspace at a boundary:
 *   • at the start of the title — swallow it (nothing precedes the title, and
 *     PM must not lift/join it away).
 *   • at the start of the first body block — merge that block up into the
 *     title (Notion behaviour). An empty first block just collapses into the
 *     title; a non-textblock first block (divider/image) only hops the caret
 *     up rather than absorbing it.
 * Any other Backspace falls through to rune's default handling.
 */
export function handleBoundaryBackspace(editor: Editor): boolean {
  const { state } = editor
  const { selection, doc } = state
  const { $from, empty } = selection
  if (!empty) return false
  const t = titleType(state)
  if (!t) return false

  if ($from.parent.type === t && $from.parentOffset === 0) {
    return true
  }

  const atFirstBodyStart =
    $from.depth === 1 && $from.index(0) === 1 && $from.parentOffset === 0
  if (!atFirstBodyStart || doc.firstChild?.type !== t) return false

  const title = doc.firstChild
  const titleContentEnd = title.nodeSize - 1
  const body = doc.child(1)

  if (!body.isTextblock) {
    // Divider/image/etc. as the first body block: just hop the caret up into
    // the title rather than absorbing the node.
    return editor.chain().setTextSelection(titleContentEnd).scrollIntoView().run()
  }

  // Merge the first body block's inline content into the end of the title,
  // then drop the now-empty block. Insert first, then map the delete range
  // across that insertion. An empty body block just collapses (nothing to
  // insert) with the caret landing at the title's end.
  const bodyFrom = title.nodeSize
  const bodyTo = bodyFrom + body.nodeSize
  const bodyDepth = typeof body.attrs.depth === "number" ? body.attrs.depth : 0
  return editor
    .chain()
    .command(({ tr, dispatch }) => {
      if (dispatch) {
        tr.insert(titleContentEnd, body.content)
        tr.delete(tr.mapping.map(bodyFrom), tr.mapping.map(bodyTo))
        tr.setSelection(TextSelection.create(tr.doc, titleContentEnd))
        // The merged block's indented subtree (the contiguous run of followers
        // deeper than it) just lost its parent — promote each one level so it
        // doesn't dangle indented under the TITLE, which is never an indent
        // parent. A uniform -1 shift preserves the subtree's internal shape
        // (child→0, grandchild→1, …). No-op in the common case (no deeper
        // follower): the loop breaks on the first block at/above bodyDepth.
        let offset = tr.doc.child(0).nodeSize // first block after the grown title
        for (let i = 1; i < tr.doc.childCount; i++) {
          const node = tr.doc.child(i)
          const d = typeof node.attrs.depth === "number" ? node.attrs.depth : 0
          if (d <= bodyDepth) break
          tr.setNodeMarkup(offset, undefined, { ...node.attrs, depth: d - 1 })
          offset += node.nodeSize
        }
      }
      return true
    })
    .scrollIntoView()
    .run()
}

export const TitleBoundary = Extension.create({
  name: "runeTitleBoundary",
  // Above rune's own block keymaps (default priority 100) so the boundary
  // merge/no-op wins over generic empty-block Backspace handling.
  priority: 200,

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => handleTitleEnter(editor),
      // Shift/Mod-Enter inside the title behaves like Enter (split out a new
      // paragraph) rather than inserting a hard_break — the page title is a
      // single line (a hard_break would split the markdown `# …` heading and
      // diverge from the host's single-line title field). Outside the title, handleTitleEnter
      // returns false so rune's default line-break handling still runs.
      "Shift-Enter": ({ editor }) => handleTitleEnter(editor),
      "Mod-Enter": ({ editor }) => handleTitleEnter(editor),
      Backspace: ({ editor }) => handleBoundaryBackspace(editor),
    }
  },

  addProseMirrorPlugins() {
    const editor = this.editor
    return [
      new Plugin({
        key: titleNormalizeKey,
        // view() fires once right after the editor view is mounted. The
        // initial EditorState arrives via EditorState.create (no transaction),
        // so appendTransaction never sees the seed content. Without this pass
        // the "exactly one title at index 0" invariant would only establish on
        // mount if SOME docChanged transaction happened to fire — today that's
        // BlockId's own view-pass backfill. So a title-less doc whose blocks
        // are ALL already id'd (e.g. enabling TitleKit on a previously-saved
        // rune doc) would get no title until the first edit, and a consumer
        // with TitleKit but WITHOUT BlockId would get no title at all. Mirror
        // block-id.ts: normalize once on mount. normalizeTitle returns null
        // (no-op) the instant the shape is canonical, so this never loops with
        // appendTransaction; its tr already carries addToHistory:false.
        view(view) {
          // A read-only editor must not author structure. Skip the mount seed
          // (otherwise displaying a title-less / title-only saved doc read-only
          // would silently inject a <title> and/or empty paragraph the user
          // never wrote — which a host that later persists getDocument() would
          // capture). The same guard rides on appendTransaction below.
          if (view.editable) {
            const tr = normalizeTitle(view.state)
            if (tr) view.dispatch(tr)
          }
          return {}
        },
        appendTransaction: (transactions, _oldState, newState) => {
          if (!editor.isEditable) return null
          if (!transactions.some((tr) => tr.docChanged)) return null
          // PM's cut handler tags its delete with uiEvent:"cut". When that
          // empties the body, re-seed the caret into the new body line (the
          // pre-title cut behavior) rather than leaving it stranded in the title.
          const isCut = transactions.some((tr) => tr.getMeta("uiEvent") === "cut")
          return normalizeTitle(newState, { placeCaretInReseededBody: isCut })
        },
      }),
    ]
  },
})
