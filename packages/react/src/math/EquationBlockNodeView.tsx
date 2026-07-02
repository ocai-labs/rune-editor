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
import { syncMenuSlot } from "@ocai/rune-core"
import { cn } from "../lib/utils"
import { useStableVirtualElement } from "../components/ui/useStableVirtualElement"
import { editorViewDom } from "../positioning"
import { MathBlockEmptyState } from "./MathBlockEmptyState"
import { MathPopover } from "./MathPopover"
import { renderKatexSafe, type RenderKatexResult } from "./renderKatex"
import { useKatexReady } from "./useKatexReady"
import { deleteNode, mathAnchorRect, selectNode } from "./nodeViewShared"
import { useMathIntent } from "./useMathIntent"
import { mergeNodeViewHTMLAttributes } from "../nodeview/htmlAttributes"

// Body slot — three mutually exclusive states (empty placeholder /
// rendered KaTeX / parse-error banner). Split as early-return branches
// inside a dedicated component so the main render isn't a three-arm
// ternary chain.
function EquationBlockBody({
  isEmpty,
  loading,
  latex,
  result,
}: {
  isEmpty: boolean
  loading: boolean
  latex: string
  result: RenderKatexResult | null
}) {
  if (isEmpty) return <MathBlockEmptyState />
  // KaTeX chunk not resolved yet — show the raw LaTeX rather than the
  // error banner (result is null during loading, same as empty).
  if (loading) return <div className="rune-equation-loading">{latex}</div>
  if (result?.ok) {
    return (
      <div
        className="rune-equation-render"
        dangerouslySetInnerHTML={{ __html: result.html }}
      />
    )
  }
  return (
    <div className="rune-equation-error" role="alert">
      {result?.message ?? "Invalid equation"}
    </div>
  )
}

function EquationBlockNodeView(props: ReactNodeViewProps<HTMLDivElement>) {
  const {
    editor,
    node,
    getPos,
    selected,
    decorations,
    updateAttributes,
    HTMLAttributes,
  } = props
  // Merge inherited HTMLAttributes (factory-injected `--rune-block-depth`,
  // `data-id`, `data-depth`, …) with this NodeView's own additions in one
  // shot. `mergeNodeViewHTMLAttributes` injects `rune-block`, dedups class
  // tokens, and lets our `--block-pad-top` win over any conflicting key.
  const { className, style: outerStyle, rest } = mergeNodeViewHTMLAttributes(
    HTMLAttributes,
    { styleVars: { "--block-pad-top": "var(--rune-media-pad-top)" } },
  )
  const [open, setOpen] = useState(false)
  const [draftLatex, setDraftLatex] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const suppressNextMouseDownRef = useRef(false)

  const latex = String(node.attrs.latex ?? "")
  const renderedLatex = draftLatex ?? latex
  const isEmpty = !renderedLatex.trim()
  // KaTeX is lazy-loaded on first math mount; `result` stays null until the
  // chunk resolves, and EquationBlockBody renders a raw-LaTeX placeholder.
  const katexReady = useKatexReady()
  const result = useMemo(
    () =>
      isEmpty || !katexReady
        ? null
        : renderKatexSafe(renderedLatex, { displayMode: true }),
    [isEmpty, katexReady, renderedLatex],
  )
  const virtualRef = useStableVirtualElement(
    open ? () => mathAnchorRect(rootRef.current) : null,
    // contextElement = editor DOM so the editor popover re-positions on inner-
    // container scroll (rootRef lives inside the editor), not just window.
    editorViewDom(editor),
  )

  // Side-menu host sync — see `syncMenuSlot` JSDoc at
  // packages/core/src/schema/blocks/atomNodeView.ts which explicitly
  // lists the React-backed equation block as the consumer.
  useEffect(() => {
    if (hostRef.current) {
      syncMenuSlot(hostRef.current, decorations, editor, getPos)
    }
  }, [decorations, editor, getPos])

  const openPopover = useCallback(() => {
    // the architecture notes readonly contract (entry-gate): no popover entry path
    // may fire while the editor is not editable. Mirrors
    // InlineMathNodeView's gate on the commit path.
    if (!editor.isEditable) return
    const currentLatex = String(node.attrs.latex ?? "")
    setDraftLatex(currentLatex)
    setOpen(true)
  }, [editor, node])

  // The boolean from useMathIntent (=fresh-insert flag for inline math)
  // is irrelevant here — block equation auto-saves on every close path
  // regardless, so the popover doesn't need to know if this was a fresh
  // insert or an existing-block edit.
  useMathIntent(editor, getPos, () => openPopover())

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

  const markSuppressIfOwnRoot = useCallback((event: PointerEvent) => {
    const root = rootRef.current
    const target = event.target
    if (!(target instanceof Node) || !root?.contains(target)) return
    suppressNextMouseDownRef.current = true
    window.setTimeout(() => {
      suppressNextMouseDownRef.current = false
    }, 0)
  }, [])

  // Native mousedown listener — same rationale as InlineMathNodeView:
  // React's synthetic stopPropagation runs after .rune-editor's
  // drag-extend listener. Going through addEventListener puts us
  // upstream so stopPropagation actually short-circuits.
  //
  // Readonly gate: `!editor.isEditable` short-circuits BEFORE
  // selectNode/openPopover so readonly users can still click for
  // selection/scroll without entering edit. preventDefault is also
  // skipped so the browser's native caret behavior stays available.
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    // The side-menu host (.rune-side-menu-host) is a child of root, so
    // grip / add-block clicks bubble through these listeners. Bail when
    // the event originated inside the host — block-drag/gesture and the
    // add-block button own those gestures, and swallowing them here
    // would (a) re-open the popover on every grip click and (b) suppress
    // drag-extend so the grip becomes click-only.
    const isFromMenuHost = (e: Event) => {
      const target = e.target
      return (
        target instanceof Node && hostRef.current?.contains(target) === true
      )
    }
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0 || !suppressNextMouseDownRef.current) return
      if (isFromMenuHost(e)) return
      e.preventDefault()
      e.stopPropagation()
    }
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return
      if (!editor.isEditable) return
      if (isFromMenuHost(e)) return
      if (suppressNextMouseDownRef.current) {
        suppressNextMouseDownRef.current = false
        e.preventDefault()
        e.stopPropagation()
        return
      }
      e.preventDefault()
      e.stopPropagation()
      if (!selectNode(editor, getPos)) return
      openPopover()
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
        {...rest}
        ref={rootRef}
        as="div"
        contentEditable={false}
        style={outerStyle}
        className={className}
      >
        <div
          className={cn(
            "rune-equation-block",
            selected && "rune-equation-selected",
          )}
          data-type="equation-block"
          data-latex={latex}
        >
          <EquationBlockBody
            isEmpty={isEmpty}
            loading={!isEmpty && !katexReady}
            latex={renderedLatex}
            result={result}
          />
        </div>
        <div ref={hostRef} className="rune-side-menu-host" />
      </NodeViewWrapper>
      {open && (
        <MathPopover
          virtualRef={virtualRef}
          initialLatex={draftLatex ?? latex}
          variant="block"
          deleteOnEmptyCommit={false}
          errorMessage={result && !result.ok ? result.message : undefined}
          onLiveUpdate={setDraftLatex}
          onCancelRevert={cancelRevert}
          onCommit={commit}
          onDelete={remove}
          onClose={() => setOpen(false)}
          onPointerDownOutside={markSuppressIfOwnRoot}
        />
      )}
    </>
  )
}

export const equationBlockReactNodeView = ReactNodeViewRenderer(
  EquationBlockNodeView,
  // See project_react_nodeview_decoration_renderer_element memory —
  // decorations land on the outer ReactRenderer element. Setting
  // className: "rune-block" here lets .rune-block-targeted CSS apply.
  { className: "rune-block" },
)
