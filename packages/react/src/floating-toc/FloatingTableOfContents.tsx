// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Notion-style floating minimap with a rune-specific hover affordance.
// Bars on the right edge show heading outline; hovering the bar column
// opens TocHoverCard, which is the sole click target for navigation.
//
// Notion's actual TOC has no expand-to-text card (verified via
// notion-toc-snapshot.js) — we add one on top of the Notion visual
// because it's the affordance the product wants.
//
// Column opacity is state-driven (not CSS :hover) so it stays at 1 the
// entire time the user is interacting with EITHER the column OR the card.
// A CSS-only :hover would drop the column to 0.4 the moment the pointer
// crossed the 8px gap into the card, causing a visible flicker.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react"
import type { Editor } from "@tiptap/core"
import { cn } from "../lib/utils"
import { scrollToBlock } from "../lib/scrollToBlock"
import { useRuneEditorState } from "../useRuneEditorState"
import { extractHeadings } from "./extractHeadings"
import type { TocHeading } from "./types"
import { TocItem } from "./TocItem"
import { TocHoverCard } from "./TocHoverCard"

const GRACE_MS = 150
const CARD_SELECTOR = "[data-rune-toc-hover-card]"
const COLUMN_SELECTOR = "[data-rune-toc-column]"

// Is a collision-sampler hit REAL block content (a wide block actually
// bleeding into the gutter), or just empty table chrome?
//
// A table's `.rune-table-scroll` viewport always reserves
// `--rune-table-bleed-right` (96px) of padding that extends past the
// content column into the gutter (see blocks/table.css) — present whether
// the table is wide or narrow, EMPTY unless a wide table actually fills it.
// A hit landing on that empty padding resolves to the scroll/chrome
// wrappers themselves, not to real table geometry; counting it would hide
// the TOC for ANY table that scrolls into the bar band, regardless of
// width — exactly the over-eager hide we don't want.
//
// Real overlap inside a table = the hit lands inside `.rune-table-frame`,
// the element that wraps the actual `<table>` (frame/table/cell/text all
// match). Hits on `.rune-table-scroll` / `.rune-table-content` /
// `.rune-table-chrome-padding`'s bleed padding do not. Content outside any
// table has no bleed wrapper, so it always counts.
function isRealContentHit(el: Element): boolean {
  if (el.closest(".rune-table-scroll")) {
    return el.closest(".rune-table-frame") !== null
  }
  return true
}

export interface FloatingTableOfContentsProps {
  editor: Editor | null
  /**
   * Scroll container that hosts the editor. Defaults to the window. Active
   * detection observes intersections against this root. Pass the inner
   * scroller when the editor lives inside an `overflow:auto` ancestor
   * (e.g. fixed-height main pane).
   */
  scrollRoot?: HTMLElement | null
  /**
   * CSS position strategy for the floating column.
   * - `"fixed"` (default): pins to viewport top-right (`top-32 right-0`).
   *   Right for a full-viewport editor.
   * - `"absolute"` / `"sticky"`: same top-right anchor but resolves
   *   against the nearest positioned ancestor / its scroll root. Use
   *   inside a multi-pane shell where each editor has its own scroller
   *   — otherwise multiple TOCs all pin to the same viewport corner.
   * - `"none"`: emits no position / top / right utilities at all. The
   *   consumer is fully responsible for layout via `className` or a
   *   wrapping element. Use this for custom shells (sidebar slot,
   *   bottom sheet, etc.).
   */
  position?: "fixed" | "absolute" | "sticky" | "none"
  /**
   * Pixels to subtract from the heading's top after `scrollIntoView`.
   * Use this when the scroll container has a sticky header / toolbar
   * that would otherwise occlude the target. Applied as an additional
   * `scrollBy` after the smooth scroll completes — no offset by default.
   */
  scrollOffset?: number
  /**
   * Called after navigation lands. Receives the clicked heading. Use to
   * sync external state (URL hash, breadcrumb, analytics). Runs after
   * the MBS dispatch but does not block it.
   */
  onJump?: (heading: TocHeading) => void
  /** Appended to the outer nav element. `tailwind-merge` resolves conflicts with the default position utilities. */
  className?: string
}

export function FloatingTableOfContents({
  editor,
  scrollRoot,
  position = "fixed",
  scrollOffset,
  onJump,
  className,
}: FloatingTableOfContentsProps) {
  const headings = useRuneEditorState(editor, extractHeadings, {
    events: ["update"],
  }) ?? []
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [hoverOpen, setHoverOpen] = useState(false)
  const [columnRect, setColumnRect] = useState<DOMRect | null>(null)
  const [collisionHidden, setCollisionHidden] = useState(false)
  const hasHeadings = headings.length > 0

  const columnRef = useRef<HTMLDivElement | null>(null)
  const overColumnRef = useRef(false)
  const overCardRef = useRef(false)
  const closeTimerRef = useRef<number | null>(null)
  // Live mirror of `hoverOpen` for pointer handlers that must not start
  // tracking a card that is already closing (see onCardEnter).
  const hoverOpenRef = useRef(false)
  useEffect(() => {
    hoverOpenRef.current = hoverOpen
  }, [hoverOpen])

  // Current heading — topmost heading whose top edge has scrolled past a
  // ~120px band, matching docs.google / Notion's "what's currently being
  // read" heuristic. "Current" is scroll-driven, not hover/click.
  useEffect(() => {
    if (!editor || headings.length === 0) {
      setCurrentId(null)
      return
    }
    const root = scrollRoot ?? null
    const elements: HTMLElement[] = []
    for (const h of headings) {
      const selector = `[data-id="${h.id.replace(/[^a-zA-Z0-9_-]/g, "\\$&")}"]`
      const el = editor.view.dom.querySelector<HTMLElement>(selector)
      if (el) elements.push(el)
    }
    if (elements.length === 0) return

    const recompute = () => {
      const rootTop = root ? root.getBoundingClientRect().top : 0
      const threshold = rootTop + 120
      let current: string | null = null
      for (const el of elements) {
        const top = el.getBoundingClientRect().top
        if (top <= threshold) current = el.getAttribute("data-id")
        else break
      }
      setCurrentId(current ?? elements[0]?.getAttribute("data-id") ?? null)
    }

    recompute()
    const scrollTarget: EventTarget = root ?? window
    scrollTarget.addEventListener("scroll", recompute, { passive: true })
    window.addEventListener("resize", recompute)
    return () => {
      scrollTarget.removeEventListener("scroll", recompute)
      window.removeEventListener("resize", recompute)
    }
  }, [editor, headings, scrollRoot])

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }, [])

  const scheduleClose = useCallback(() => {
    cancelClose()
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null
      if (!overColumnRef.current && !overCardRef.current) {
        setHoverOpen(false)
      }
    }, GRACE_MS)
  }, [cancelClose])

  const forceClose = useCallback(() => {
    cancelClose()
    overColumnRef.current = false
    overCardRef.current = false
    setHoverOpen(false)
  }, [cancelClose])

  // Notion-parity collision hide. When a block wide enough to bleed into
  // the right gutter (today: an overflowing table) scrolls into the bar
  // column's vertical band, the heading bars would sit on top of that
  // block's text. Notion hides the whole floating TOC for as long as the
  // overlap lasts and restores it once the wide block scrolls clear
  // (verified in Notion's app: it flips visibility:hidden on
  // .notion-floating-table-of-contents). We key this on geometry, not
  // block type — sample just left of the bar column down its height and
  // hide if real editor content (inside the ProseMirror DOM, so chrome
  // sitting in the gutter doesn't count) has bled that far right. A table's
  // scroll viewport always reserves empty bleed padding in the gutter, so a
  // hit there is filtered out unless it lands on the actual table (see
  // isRealContentHit) — otherwise a NARROW table would hide the TOC just by
  // scrolling into the bar band.
  //
  // visibility — not display — so the column keeps its box while hidden
  // and this same sampler can tell when the wide block has moved on.
  useEffect(() => {
    if (!editor || !hasHeadings) return
    const root = scrollRoot ?? null
    const dom = editor.view.dom
    let frame = 0
    const check = () => {
      frame = 0
      const col = columnRef.current
      if (!col) return
      const rect = col.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      const x = rect.left - 1
      // Only meaningful in the gutter to the RIGHT of the editor's content
      // box. A wide block bleeds OUT of that box (overflow:visible) into the
      // gutter; a normal block ends at the box's right edge. If the bar
      // column overlaps the content box itself (a narrow/zero gutter — e.g.
      // a full-width or left-aligned editor), a hit inside the editor can't
      // be told apart from a normal full-width block, so we must NOT hide —
      // otherwise the TOC would vanish permanently with no wide block present.
      if (x <= dom.getBoundingClientRect().right) {
        setCollisionHidden(false)
        return
      }
      let overlap = false
      for (let i = 0; i <= 6; i++) {
        const el = document.elementFromPoint(x, rect.top + (rect.height * i) / 6)
        // dom.contains → the hit is editor content (gutter chrome ignored);
        // isRealContentHit → it's a wide block actually bleeding here, not a
        // table's always-present empty bleed padding (see isRealContentHit).
        if (el && dom.contains(el) && isRealContentHit(el)) {
          overlap = true
          break
        }
      }
      if (overlap) forceClose()
      setCollisionHidden(overlap)
    }
    const schedule = () => {
      if (frame) return
      frame = window.requestAnimationFrame(check)
    }
    check()
    const scrollTarget: EventTarget = root ?? window
    scrollTarget.addEventListener("scroll", schedule, { passive: true })
    window.addEventListener("resize", schedule)
    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      scrollTarget.removeEventListener("scroll", schedule)
      window.removeEventListener("resize", schedule)
    }
  }, [editor, hasHeadings, scrollRoot, forceClose])

  // Filter to mouse pointers — touch / pen open a popover the user can't
  // dismiss naturally (deferred a11y work).
  const onColumnEnter = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.pointerType !== "mouse") return
      overColumnRef.current = true
      cancelClose()
      if (columnRef.current) {
        setColumnRect(columnRef.current.getBoundingClientRect())
      }
      setHoverOpen(true)
    },
    [cancelClose],
  )

  const onColumnLeave = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.pointerType !== "mouse") return
      // instanceof, NOT a bare cast: when the pointer exits the window
      // (this column hugs the window's right edge, so that's a routine
      // move), React's synthesized leave carries `window` as relatedTarget.
      // Calling .closest on it threw mid-handler, skipping scheduleClose and
      // wedging the card open until an outside click (the stuck-open bug).
      const related = e.relatedTarget instanceof Element ? e.relatedTarget : null
      if (related && related.closest(CARD_SELECTOR)) {
        overColumnRef.current = false
        return
      }
      overColumnRef.current = false
      scheduleClose()
    },
    [scheduleClose],
  )

  const onCardEnter = useCallback(() => {
    // Ignore enters on a closed (exit-animating) card: Radix Presence keeps
    // it mounted through the close animation, so sweeping the pointer across
    // it still fires pointerenter — but its eventual unmount delivers NO
    // matching pointerleave. Tracking that enter would wedge overCardRef at
    // true forever, and every later scheduleClose would no-op — the card
    // could then only be dismissed by clicking outside.
    if (!hoverOpenRef.current) return
    overCardRef.current = true
    cancelClose()
  }, [cancelClose])

  const onCardLeave = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      // Same non-Element relatedTarget guard as onColumnLeave — the card
      // also sits flush against the window edge.
      const related = e.relatedTarget instanceof Element ? e.relatedTarget : null
      if (related && related.closest(COLUMN_SELECTOR)) {
        overCardRef.current = false
        return
      }
      overCardRef.current = false
      scheduleClose()
    },
    [scheduleClose],
  )

  const onSelect = useCallback(
    (item: TocHeading) => {
      if (!editor) return
      scrollToBlock(editor, item.id, {
        scrollRoot: scrollRoot ?? null,
        scrollOffset,
        select: true,
      })
      onJump?.(item)
      forceClose()
    },
    [editor, scrollOffset, scrollRoot, onJump, forceClose],
  )

  // Window deactivation (Cmd-Tab, a click into another window or app)
  // delivers no pointerleave for whatever the pointer was resting on, so the
  // over* refs would stay true with no follow-up event to ever clear them —
  // the card survives the window switch and, worse, those stale refs veto
  // every later grace-timer close ("it only closes when I click something").
  // Blur is the one reliable deactivation signal, so treat it as a hard close.
  useEffect(() => {
    const onWindowBlur = () => forceClose()
    window.addEventListener("blur", onWindowBlur)
    return () => window.removeEventListener("blur", onWindowBlur)
  }, [forceClose])

  useEffect(() => () => cancelClose(), [cancelClose])

  if (!editor || headings.length === 0) return null

  return (
    <>
      <nav
        data-rune-floating-toc=""
        aria-label="Table of contents"
        className={cn(
          "pointer-events-none z-30 flex flex-col transition-[opacity,visibility] duration-150",
          // Geometry-driven hide while a wide block overlaps the gutter —
          // keep layout (visibility, not display) so the sampler above can
          // detect when the overlap clears. See the collision effect.
          collisionHidden && "invisible opacity-0",
          position === "fixed" && "fixed top-32 right-0",
          position === "absolute" && "absolute top-32 right-0",
          position === "sticky" && "sticky top-32 right-0",
          className,
        )}
      >
        <div
          ref={columnRef}
          data-rune-toc-column=""
          onPointerEnter={onColumnEnter}
          onPointerLeave={onColumnLeave}
          // Column itself is always at full opacity. The current heading's
          // bar carries a permanent foreground+halo glow (see TocItem) so
          // the reader can see "where they are" without hovering; non-
          // current bars use `bg-muted-foreground` for the dim outline.
          // We deliberately diverge from Notion's near-invisible idle
          // state because product wants the scroll-position indicator
          // always readable.
          // Mirrors Notion's nested-column padding when merged into one
          // div: pl-5 (20px padding-inline-start), pr-2 (8px padding-
          // inline-end), pb-3 (12px padding-bottom), NO padding-top.
          // gap-3 (12px) between bars. NO items-end — bars left-align in
          // the slot and offset themselves via margin-inline-start.
          className="pointer-events-auto flex w-14 flex-col gap-3 pb-3 pr-2 pl-5"
        >
          {headings.map((h) => (
            <TocItem key={h.id} item={h} current={h.id === currentId} />
          ))}
        </div>
      </nav>
      {/* Always-mounted so Radix Popover owns the open→closed state
          transition and can play the data-open / data-closed CSS
          animations. Conditionally rendering on `hoverOpen` (the prior
          shape) destroyed the Popover on each close, killing both the
          exit animation and — empirically — the entry animation on the
          subsequent reopen. TocHoverCard itself bails out internally
          before the first hover (no anchorRect yet). */}
      <TocHoverCard
        open={hoverOpen}
        headings={headings}
        currentId={currentId}
        anchorRect={columnRect}
        onSelect={onSelect}
        onClose={forceClose}
        onPointerEnter={onCardEnter}
        onPointerLeave={onCardLeave}
      />
    </>
  )
}
