// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// LinkPanelPopover — positioning chrome for the inline toolbar's link
// composer / editor forms (LinkMenu / LinkEditForm). Mirrors InlineColorMenu:
// a body-portaled sibling popover anchored to the toolbar, dropping the form
// BELOW it (side="bottom", left-aligned) — the placement the old
// `absolute top-full left-0` child reproduced, but immune to the toolbar's
// `overflow-hidden` clip and window-blur reflow. (Anchors to the whole toolbar
// rather than the formatting-area wrapper the color menu uses, so the taller
// form clears the renderExtraSection slot instead of overlapping it.)
//
// Why a portaled sibling, not an `absolute top-full` child: the toolbar's
// PopoverContent is a fixed-width (w-48) `overflow-hidden` box. A `w-80` link
// form hung inside it as an absolute child was clipped both horizontally
// (320px form sliced to 192px) and vertically (the part below the box cut
// off). #352 moved the color palette out of that box for the same reason and
// deferred the link forms; this is the deferred half.
//
// Esc is deliberately NOT forwarded here. The mounted form's input owns Esc:
// LinkEditForm discards its draft (shouldSaveOnUnmountRef=false) before
// closing, so letting Radix's DismissableLayer unmount the form first would
// commit the edit the user just discarded. SuggestionMenuPopover already
// preventDefaults Radix's escape (so it can't dismiss the toolbar); we simply
// don't pass an onEscapeKeyDown and let the form's onKeyDown run. Mirrors
// LinkHoverCard's edit-mode `onEscapeKeyDown={(e) => isEdit && preventDefault}`.

import { useCallback, type ReactNode, type RefObject } from "react"
import { SuggestionMenuPopover } from "../suggestion-menu"

export interface LinkPanelPopoverProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The toolbar content the form drops below (its PopoverContent). It
   *  contains the Link trigger button, so a pointerdown anywhere on the toolbar
   *  reads as "inside the anchor" and is a no-op here — the trigger's own
   *  mousedown owns the toggle, and the other buttons already set the panel
   *  closed themselves. */
  anchorRef: RefObject<HTMLElement | null>
  /** The active form (LinkMenu or LinkEditForm), or null when closed. Gating
   *  the children on `open` upstream preserves the original mount/unmount
   *  timing so LinkEditForm's save-on-unmount fires exactly when the panel
   *  closes. */
  children: ReactNode
}

export function LinkPanelPopover({
  open,
  onOpenChange,
  anchorRef,
  children,
}: LinkPanelPopoverProps) {
  const close = useCallback(() => onOpenChange(false), [onOpenChange])

  const getAnchorRect = useCallback(
    () => anchorRef.current?.getBoundingClientRect() ?? null,
    [anchorRef],
  )

  // Outside-click inside the toolbar (the anchor) is a no-op: the Link trigger
  // lives there and its own mousedown toggles the panel, so without this the
  // dismissable layer would close on the same pointerdown the trigger then
  // reopens. A click truly outside closes the panel — for LinkEditForm that
  // unmounts the form and its save-on-unmount commits the edit (the intended
  // "click away to save" behavior). Mirrors InlineColorMenu.
  const handlePointerDownOutside = useCallback(
    (target: EventTarget | null) => {
      if (target instanceof Node && anchorRef.current?.contains(target)) return
      close()
    },
    [close, anchorRef],
  )

  return (
    <SuggestionMenuPopover
      open={open}
      getClientRect={getAnchorRect}
      // Anchor lives inside the body-portaled toolbar (not the editor), so
      // contextElement is the anchor element itself: floating-ui's observeMove
      // then re-positions the panel whenever the toolbar moves on inner-
      // container scroll, not just window.
      contextElement={anchorRef.current}
      popover={{
        // Dropdown BELOW the formatting area (Notion-style), left-aligned —
        // reproducing the old `top-full left-0` placement. Radix flips
        // bottom → top via avoidCollisions near the viewport bottom.
        side: "bottom",
        align: "start",
        sideOffset: 2,
        // The form owns its width (w-80); drop the suggestion-menu default
        // (w-81 / min-w-45) so the popover sizes to the form.
        className: "w-auto min-w-0",
      }}
      onPointerDownOutside={handlePointerDownOutside}
      onClose={close}
      // A link form is a focused input, not a list — no "Close menu" footer.
      showCloseFooter={false}
    >
      {children}
    </SuggestionMenuPopover>
  )
}
