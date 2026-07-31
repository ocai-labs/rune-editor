// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { useEffect, useRef } from "react"
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type ReactNodeViewProps,
} from "@tiptap/react"
import { syncMenuSlot } from "@ocai/rune-core"
import { extractHeadings } from "../floating-toc/extractHeadings"
import type { TocHeading } from "../floating-toc/types"
import { scrollToBlock } from "../lib/scrollToBlock"
import { mergeNodeViewHTMLAttributes } from "../nodeview/htmlAttributes"
import { useRuneEditorState } from "../useRuneEditorState"

// Placeholder for v1. Forks live as a separate constant in downstream
// apps that ship their own help URL — exposing this as a kit prop is
// premature until there's a second real consumer.
const RUNE_TOC_HELP_URL = "#"

function TableOfContentsNodeView({
  editor,
  decorations,
  getPos,
  HTMLAttributes,
}: ReactNodeViewProps<HTMLDivElement>) {
  const { className, style, rest } = mergeNodeViewHTMLAttributes(HTMLAttributes)

  const hostRef = useRef<HTMLDivElement>(null)

  // Side-menu host sync — TOC is an atom, so SideMenu only emits a node
  // decoration on hover; the NodeView mounts the widget itself. Same
  // contract as EquationBlockNodeView / AudioBlockNodeView (syncMenuSlot
  // JSDoc at packages/core/src/schema/blocks/atomNodeView.ts).
  useEffect(() => {
    if (hostRef.current) {
      syncMenuSlot(hostRef.current, decorations, editor, getPos)
    }
  }, [decorations, editor, getPos])

  const headings = useRuneEditorState<TocHeading[]>(editor, extractHeadings, {
    events: ["update"],
  })

  // Indent rule: relative to the shallowest heading currently in the
  // doc, matching Notion. If only H3+H4 exist, H3 sits at 0px and H4 at
  // 24px — the TOC stays flush-left instead of starting at depth-2's
  // offset.
  const minLevel =
    headings.length === 0 ? 1 : Math.min(...headings.map((h) => h.level))

  return (
    <NodeViewWrapper
      as="div"
      className={className}
      style={style}
      {...rest}
    >
      <div
        className="rune-block-content"
        data-rune-toc=""
      >
        {headings.length === 0 ? (
          <div className="rune-toc-empty">
            Add headings to create a table of contents.{" "}
            <a
              href={RUNE_TOC_HELP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="rune-toc-empty-link"
            >
              Learn more
            </a>
            .
          </div>
        ) : (
          <div className="rune-toc-list">
            {headings.map((h) => (
              <a
                key={h.id}
                href={`#${h.id}`}
                className="rune-toc-entry"
                style={{
                  marginInlineStart: `calc(${
                    h.level - minLevel
                  } * var(--rune-toc-indent-step, 24px))`,
                }}
                onClick={(e) => {
                  e.preventDefault()
                  scrollToBlock(editor, h.id, { select: true })
                }}
              >
                {h.text || "Untitled"}
              </a>
            ))}
          </div>
        )}
      </div>
      <div ref={hostRef} className="rune-side-menu-host" />
    </NodeViewWrapper>
  )
}

// Decorations (block-selection paint, etc.) land on the outer
// ReactRenderer element. Setting className: "rune-block" here keeps
// the existing .rune-block-targeted CSS applicable to TOC blocks
// (memory project_react_nodeview_decoration_renderer_element).
export const tableOfContentsReactNodeView = ReactNodeViewRenderer(
  TableOfContentsNodeView,
  { className: "rune-block" },
)
