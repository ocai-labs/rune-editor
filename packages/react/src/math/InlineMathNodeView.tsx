// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type ReactNodeViewProps,
} from "@tiptap/react"
import { cn } from "../lib/utils"
import { useStableVirtualElement } from "../components/ui/useStableVirtualElement"
import { editorViewDom } from "../positioning"
import { MathEmptyState } from "./MathEmptyState"
import { MathPopover } from "./MathPopover"
import { renderKatexToString } from "./renderKatex"
import { useKatexReady } from "./useKatexReady"
import {
  deleteNode,
  mathAnchorRect,
  replaceNodeWithText,
  selectNode,
} from "./nodeViewShared"
import { useMathIntent } from "./useMathIntent"

function InlineMathNodeView(props: ReactNodeViewProps<HTMLSpanElement>) {
  const { editor, node, getPos, selected, updateAttributes, HTMLAttributes } =
    props
  // Drop `class` from the spread — cn() below owns the className and folds
  // HTMLAttributes.class back in so decoration / color / data-* class
  // contributions still survive (per the NodeView class-merge contract).
  const { class: htmlClass, ...restHTMLAttributes } = HTMLAttributes
  const [open, setOpen] = useState(false)
  const [deleteEmptyOnCancel, setDeleteEmptyOnCancel] = useState(false)
  const [draftLatex, setDraftLatex] = useState<string | null>(null)
  const rootRef = useRef<HTMLSpanElement | null>(null)
  const suppressNextMouseDownRef = useRef(false)
  // Snapshot of node.attrs.latex at the moment the popover opens. For a
  // wrap-from-selection session this equals the originally selected
  // text, which we need to put back if the user dismisses without
  // committing. Kept in a ref so live-update / re-renders don't
  // overwrite it.
  const wrapOriginalLatexRef = useRef<string>("")
  const latex = String(node.attrs.latex ?? "")
  const renderedLatex = draftLatex ?? latex
  const isEmpty = !renderedLatex.trim()
  // KaTeX is lazy-loaded on first math mount; until the chunk resolves we
  // show the raw LaTeX (see the loading branch below).
  const katexReady = useKatexReady()
  const rendered = useMemo(
    () =>
      isEmpty || !katexReady
        ? ""
        : renderKatexToString(renderedLatex, { displayMode: false }),
    [isEmpty, katexReady, renderedLatex],
  )
  const virtualRef = useStableVirtualElement(
    open ? () => mathAnchorRect(rootRef.current) : null,
    // contextElement = editor DOM so the editor popover re-positions on inner-
    // container scroll (rootRef lives inside the editor), not just window.
    editorViewDom(editor),
  )

  const openPopover = useCallback(
    (deleteIfCanceled: boolean) => {
      const currentLatex = String(node.attrs.latex ?? "")
      setDraftLatex(currentLatex)
      setDeleteEmptyOnCancel(deleteIfCanceled)
      wrapOriginalLatexRef.current = currentLatex
      setOpen(true)
    },
    [node],
  )
  useMathIntent(editor, getPos, openPopover)

  const commit = useCallback(
    (nextLatex: string) => {
      if (!editor.isEditable) return
      updateAttributes({ latex: nextLatex })
      setDraftLatex(null)
    },
    [editor, updateAttributes],
  )
  const cancelRevert = useCallback(() => setDraftLatex(null), [])
  const remove = useCallback(
    () => deleteNode(editor, node, getPos),
    [editor, getPos, node],
  )
  const discardInserted = useCallback(
    () => deleteNode(editor, node, getPos, { addToHistory: false }),
    [editor, getPos, node],
  )
  // Wrap-from-selection cancel: put the originally selected text back
  // in place of the inline math node. We don't add this to history —
  // the wrap step is already in the undo stack, so an Undo after the
  // restore lands cleanly on text==text (no-op step) and the selection
  // bookmark still snaps back to the original range.
  const discardWrapped = useCallback(() => {
    replaceNodeWithText(editor, node, getPos, wrapOriginalLatexRef.current, {
      addToHistory: false,
    })
  }, [editor, getPos, node])
  const markSuppressIfOwnRoot = useCallback((event: PointerEvent) => {
    const root = rootRef.current
    const target = event.target
    if (!(target instanceof Node) || !root?.contains(target)) return
    suppressNextMouseDownRef.current = true
    window.setTimeout(() => {
      suppressNextMouseDownRef.current = false
    }, 0)
  }, [])

  // Native mousedown listener (not React onMouseDown) — fires during the
  // native bubble phase BEFORE the event reaches `.rune-editor`'s
  // drag-extend listener. React 17+ delegates synthetic events to the
  // React root, so React's onMouseDown runs AFTER all intermediate
  // native listeners; calling stopPropagation there is too late to keep
  // drag-extend from arming its pending block/text gesture (which would
  // promote to MBS on the slightest mouse movement). Reaching directly
  // for addEventListener on rootRef puts us upstream of `.rune-editor`
  // in the bubble path, so stopPropagation actually short-circuits
  // drag-extend's listener. preventDefault stops the browser from
  // putting a caret next to the atom; selectNode + openPopover then
  // happen synchronously so one click = bg + popover in one frame.
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0 || !suppressNextMouseDownRef.current) return
      e.preventDefault()
      e.stopPropagation()
    }
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return
      if (suppressNextMouseDownRef.current) {
        suppressNextMouseDownRef.current = false
        e.preventDefault()
        e.stopPropagation()
        return
      }
      e.preventDefault()
      e.stopPropagation()
      if (!selectNode(editor, getPos)) return
      openPopover(false)
    }
    root.addEventListener("pointerdown", onPointerDown)
    root.addEventListener("mousedown", onMouseDown)
    return () => {
      root.removeEventListener("pointerdown", onPointerDown)
      root.removeEventListener("mousedown", onMouseDown)
    }
  }, [editor, getPos, openPopover])

  return (
    <>
      <NodeViewWrapper
        {...restHTMLAttributes}
        ref={rootRef}
        as="span"
        contentEditable={false}
        aria-label={`Inline math: ${renderedLatex}`}
        data-type="inline-math"
        data-latex={latex}
        className={cn(
          "rune-inline-math",
          selected && "rune-math-selected",
          htmlClass,
        )}
      >
        {isEmpty ? (
          <MathEmptyState />
        ) : !katexReady ? (
          <span className="rune-math-loading">{renderedLatex}</span>
        ) : (
          <span dangerouslySetInnerHTML={{ __html: rendered }} />
        )}
      </NodeViewWrapper>
      {open && (
        <MathPopover
          virtualRef={virtualRef}
          initialLatex={draftLatex ?? latex}
          deleteEmptyOnCancel={deleteEmptyOnCancel}
          onLiveUpdate={setDraftLatex}
          onCancelRevert={cancelRevert}
          onCommit={commit}
          onDelete={remove}
          onDiscardInserted={discardInserted}
          onDiscardWrapped={discardWrapped}
          onClose={() => setOpen(false)}
          onPointerDownOutside={markSuppressIfOwnRoot}
        />
      )}
    </>
  )
}

export const inlineMathReactNodeView = ReactNodeViewRenderer(InlineMathNodeView)
