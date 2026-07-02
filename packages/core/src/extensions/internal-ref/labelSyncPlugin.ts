// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { Plugin, PluginKey } from "@tiptap/pm/state"
import type { Mark, Node as ProseMirrorNode } from "@tiptap/pm/model"
import type { EditorState, Selection, Transaction } from "@tiptap/pm/state"
import { isTargetedRefresh } from "../entity-refs"
import { runePluginKeyName } from "../plugin-key-name"
import type { InternalRefAttrs, InternalRefOptions } from "."

/**
 * Meta tag stamped on every transaction this plugin appends. Downstream
 * dirty-tracking can treat transactions carrying this meta as non-user
 * edits (the rewrite is derived from `resolve`, not typed by anyone).
 */
export const internalRefLabelSyncKey = new PluginKey(
  runePluginKeyName("internal-ref-label-sync"),
)

interface LabelRun {
  from: number
  to: number
  attrs: InternalRefAttrs
  /**
   * Intersection of marks across every text node in the run — only marks
   * present on ALL segments survive. The internalRef mark spans the whole
   * run by construction so it always survives; partial bold/italic is
   * dropped rather than wrongly spread over the rewritten label.
   */
  marks: readonly Mark[]
  /** Rewrites only apply to pure-text runs; an inline atom inside disqualifies. */
  textOnly: boolean
}

/**
 * Contiguous-run accumulation over `markName`, mirroring the decoration
 * plugin's traversal (`createRefDecorationPlugin.ts` — adjacent inline
 * nodes whose mark attrs are equal form one run).
 */
function collectRuns(doc: ProseMirrorNode, markName: string): LabelRun[] {
  const runs: LabelRun[] = []
  let active: LabelRun | null = null

  const flush = () => {
    if (active) runs.push(active)
    active = null
  }

  doc.descendants((node, pos) => {
    if (!node.isInline) {
      flush()
      return true
    }

    const mark = node.marks.find((candidate) => candidate.type.name === markName)
    if (!mark) {
      flush()
      return false
    }

    const from = pos
    const to = pos + node.nodeSize
    const attrs = mark.attrs as InternalRefAttrs

    if (
      active &&
      active.to === from &&
      active.attrs.kind === attrs.kind &&
      active.attrs.target === attrs.target
    ) {
      active.to = to
      active.textOnly = active.textOnly && node.isText
      // Intersect marks: keep only marks present on every node in the run.
      active.marks = active.marks.filter((m) =>
        node.marks.some((nm) => nm.eq(m)),
      )
      return false
    }

    flush()
    active = {
      from,
      to,
      attrs,
      marks: node.marks,
      textOnly: node.isText,
    }
    return false
  })
  flush()

  return runs
}

function intersectsSelection(selection: Selection, run: LabelRun): boolean {
  return selection.from < run.to && selection.to > run.from
}

/**
 * The option (b) live-label pass (design:
 * internal design notes).
 * Rewrites each ref run's text to `resolve().displayText` when they
 * differ; `null`/`undefined`/`""` from the resolver never touches the
 * doc — the existing text IS the cached fallback for unresolvable
 * targets. Runs under the caret are skipped and heal on the next pass.
 */
export function createLabelSyncPlugin({
  markName,
  refType,
  resolve,
}: {
  markName: string
  refType: string
  resolve: (attrs: InternalRefAttrs) => ReturnType<
    NonNullable<InternalRefOptions["resolve"]>
  >
}): Plugin {
  /**
   * Compute the sync transaction for `state`, or `null` when every run is
   * already in sync (the no-rewrite-loop guarantee). Shared by the mount
   * pass (`view`) and the steady-state pass (`appendTransaction`).
   */
  const buildSyncTransaction = (state: EditorState): Transaction | null => {
    const runs = collectRuns(state.doc, markName)
    if (runs.length === 0) return null

    const tr = state.tr
    let mutated = false

    // Right-to-left so earlier runs' positions stay valid as we rewrite.
    for (let i = runs.length - 1; i >= 0; i--) {
      const run = runs[i]
      if (!run || !run.textOnly) continue

      // Alias-exempt: the author deliberately chose a custom display text
      // (e.g. [[Target|Alias]] syntax). Only the text rewrite is suppressed;
      // broken-target / icon / title decorations still fire normally.
      if (run.attrs.alias) continue

      const label = resolve(run.attrs)?.displayText
      if (!label) continue

      const current = state.doc.textBetween(run.from, run.to)
      if (current === label) continue

      // Skip-and-defer: never rewrite under the user's selection; the
      // run heals on the next docChanged / refreshEntityRefs pass.
      if (intersectsSelection(state.selection, run)) continue

      tr.replaceWith(run.from, run.to, state.schema.text(label, [...run.marks]))
      mutated = true
    }

    if (!mutated) return null
    tr.setMeta(internalRefLabelSyncKey, true)
    tr.setMeta("addToHistory", false)
    return tr
  }

  return new Plugin({
    key: internalRefLabelSyncKey,
    // view() fires once right after the editor view is mounted. The
    // initial EditorState arrives via EditorState.create (no transaction),
    // so appendTransaction never sees seed content — stored docs would
    // stay stale until the first edit. Dispatch a one-time sync here
    // instead (same pattern as BlockId's id backfill in
    // extensions/block-id.ts). If `resolve` isn't warm yet this is a
    // no-op; the consumer's later refreshEntityRefs() heals it.
    view(view) {
      const tr = buildSyncTransaction(view.state)
      if (tr) view.dispatch(tr)
      return {}
    },
    appendTransaction(transactions, _oldState, newState) {
      const triggered = transactions.some(
        (tr) => tr.docChanged || isTargetedRefresh(tr, refType),
      )
      if (!triggered) return null

      return buildSyncTransaction(newState)
    },
  })
}
