// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// TocHoverCard — opens on column hover, lists every heading as a clickable
// text row, navigates on click. The bar column itself is visual-only; this
// card is the sole interaction surface.
//
// NOTE on design intent: Notion's actual floating TOC does NOT have an
// expand-to-text layer (verified via devtools snapshot, see
// notion-toc-snapshot.js). This card is a rune-specific affordance, not a
// Notion match — bars-as-visual + card-for-navigation is the desired UX.
//
// Pattern is the same Radix-Popover-with-virtualRef used by InlineToolbar
// and LinkHoverCard. We deliberately do NOT use Radix HoverCard:
//   * HoverCard is wired to a single trigger and its own openDelay /
//     closeDelay; we need a column-level hover region with a custom safe-
//     travel grace timer that survives the gap between column and card.
//   * HoverCard manages aria-tooltip semantics that fight the click-to-
//     navigate role we want for the rows.
//   * The focus-preservation incantations PM wants
//     (onOpenAutoFocus / onCloseAutoFocus / onFocusOutside =
//     preventDefault) are already proven in this codebase under Popover.

import type { PointerEvent as ReactPointerEvent } from "react"
import { Button } from "../components/ui/button"
import { Popover, PopoverAnchor, PopoverContent } from "../components/ui/popover"
import { useStableVirtualElement } from "../components/ui/useStableVirtualElement"
import { cn } from "../lib/utils"
import type { TocHeading } from "./types"

const CARD_ATTR = "data-rune-toc-hover-card"
const ROW_ATTR = "data-rune-toc-hover-card-row"

// Text indent step per level so the row list visually mirrors the bar
// column's outline. 2/3/4/5 → 0/8/16/24 px leading padding. Smaller than
// the earlier 12px step because the user flagged H2's 20px leading as too
// thick.
const ROW_INDENT_PX = 8

export interface TocHoverCardProps {
  /** Whether the card is currently visible. Driven by parent's hover/
   *  grace state. Must be a prop (not local) so Radix sees a true
   *  open→closed transition and runs the exit animation; if the card
   *  is conditionally mounted by the parent instead, the unmount races
   *  the exit animation and Radix never plays it. The entry animation
   *  benefits from the same continuity — Radix flips data-state from
   *  "closed" to "open" on the live element rather than first-painting
   *  it with data-state="open" (which not all CSS animation runners
   *  catch reliably). */
  open: boolean
  headings: TocHeading[]
  currentId: string | null
  /** getBoundingClientRect of the bar column — card anchors against it. */
  anchorRect: DOMRect | null
  onSelect: (item: TocHeading) => void
  onClose: () => void
  onPointerEnter: () => void
  onPointerLeave: (e: ReactPointerEvent<HTMLDivElement>) => void
}

export function TocHoverCard({
  open,
  headings,
  currentId,
  anchorRect,
  onSelect,
  onClose,
  onPointerEnter,
  onPointerLeave,
}: TocHoverCardProps) {
  // Anchor on a zero-width strip at the column's right edge so that
  // `side="left" + sideOffset=0` lands the card's right edge flush with
  // the column's right edge — the card lays directly on top of the bar
  // indicator, replacing it visually while open. Anchoring on the full
  // column rect would push the card 8px further left, leaving the bars
  // visible to its right.
  const virtualRef = useStableVirtualElement(
    anchorRect
      ? () =>
          ({
            x: anchorRect.right,
            y: anchorRect.top,
            left: anchorRect.right,
            right: anchorRect.right,
            top: anchorRect.top,
            bottom: anchorRect.bottom,
            width: 0,
            height: anchorRect.height,
            toJSON() {
              return this
            },
          }) as DOMRect
      : null,
  )
  if (!virtualRef || headings.length === 0) return null

  return (
    <Popover
      open={open}
      modal={false}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <PopoverAnchor virtualRef={virtualRef} />
      <PopoverContent
        side="left"
        align="start"
        sideOffset={16}
        // Current bar carries a `0 0 3px var(--foreground)` halo that
        // bleeds ~3px above the column-top. align="start" lands the card
        // top flush with column top, which leaves the halo's upper arc
        // peeking out. -4 lifts the card one extra pixel past the halo's
        // reach so it cleanly hides while open.
        alignOffset={-4}
        // PM focus preservation — same three guards as InlineToolbar.
        // Without onOpenAutoFocus the popover would steal focus from PM
        // on open and collapse any caret/selection. onFocusOutside
        // suppresses the spurious dismissal Radix triggers on window
        // blur / Cmd-Tab.
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onFocusOutside={(e) => e.preventDefault()}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        // bg-[var(--rune-toc-card-bg)] overrides the chrome's default bg-popover
        // (tailwind-merge, last-wins) so the dropdown's fill is its own themeable
        // token — defaults to the page background (see shadcn-tokens.css).
        className="w-fit min-w-45 max-w-xs rounded-lg bg-[var(--rune-toc-card-bg)] p-1 text-popover-foreground shadow-lg ring-1 ring-foreground/10"
        {...{ [CARD_ATTR]: "" }}
      >
        <ul className="flex max-h-[60vh] flex-col gap-0.5 overflow-y-auto">
          {headings.map((h) => (
            <li key={h.id}>
              <Button
                type="button"
                variant="ghost"
                {...{ [ROW_ATTR]: "" }}
                data-rune-toc-row-current={h.id === currentId ? "" : undefined}
                // onMouseDown preventDefault → PM doesn't blur. Navigation
                // runs in onClick so keyboard Enter / Space still works.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onSelect(h)}
                style={{ paddingInlineStart: 8 + (h.level - 2) * ROW_INDENT_PX }}
                // ghost variant flips text to `accent-foreground` on hover,
                // which would erase the current row's accent color exactly
                // when the pointer hovers it; pin the hover color back to
                // --editor-accent for current.
                className={cn(
                  "w-full cursor-pointer justify-start font-normal",
                  h.id === currentId
                    ? "text-(--editor-accent) hover:text-(--editor-accent)"
                    : "text-muted-foreground",
                )}
              >
                {/* Overflow treatment is a gentle right-edge fade mask,
                    not truncate's hard ellipsis — the same effect as the
                    sidebar row label (zyler RenamableRowLabel): at rest the
                    title stays fully readable and only the extreme right
                    edge softens. The mask lives on this inner span, not the
                    Button, so the ghost hover fill keeps a crisp edge;
                    flex-1 + min-w-0 lets it fill the row and shrink below
                    its content so overflow-hidden can clip the tail. */}
                <span className="min-w-0 flex-1 overflow-hidden whitespace-nowrap text-start [mask-image:linear-gradient(to_right,black_85%,transparent_99%)]">
                  {h.text || `Heading ${h.level}`}
                </span>
              </Button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
