// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// MediaFloatingBar — Notion-style hover toolbar pinned inside the
// top-right corner of a FILLED image / video block (audio is excluded —
// the player surface is too small to overlay chrome on).
// Spec: internal design notes.
//
// Structure mirrors Notion's authored DOM: the bar is an absolutely
// positioned child (`top: 4px; inset-inline-end: 4px; z-index: 2`) of the
// block's `.rune-block-content` (position: relative), portaled there by
// React — NOT a floating popover repositioned by JS on scroll. The
// alignment control opens a horizontal three-icon row hung at `top: 100%`
// below the bar, again Notion's shape.
//
// Trigger is HOVER ONLY (locked decision 3): visibility derives from the
// side-menu plugin's hoveredPos — the same hover model that mounts the
// grip. While the block-actions dropdown is open the bar PINS to the
// dropdown's block (mirroring the side-menu's own pin) so the `•••`
// anchor stays alive.
//
// `•••` does not render its own menu: it opens the SAME
// BlockActionsDropdown the side-menu grip opens, via core's
// openBlockActionsDropdown (single-block MBS + openDropdownFor meta with
// `dropdownAnchor: "media-bar"`); the dropdown anchors itself to the
// `[data-rune-media-bar-more]` button.
//
// PM interplay: the bar lives inside the atom NodeView's DOM —
// createAtomNodeView's stopEvent() makes PM ignore events originating in
// `[data-rune-media-floating-bar]`, and the side-menu's mousemove ignores
// `data-rune-editor-chrome`, so hovering/clicking the bar neither moves
// the caret nor re-resolves the hover.

import { Fragment, useEffect, useState } from "react"
import { createPortal } from "react-dom"
import type { ComponentProps, ComponentType } from "react"
import type { Editor } from "@tiptap/core"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import {
  blockSelectionKey,
  getBlockSpecs,
  getMediaPopoverBlockId,
  isGestureActive,
  normalizeMediaAlign,
  openBlockActionsDropdown,
  resolveBodyBlockById,
  sideMenuKey,
  type MediaAlign,
  type RuneBlockAction,
  type RuneBlockActionRuntimeContext,
} from "@ocai/rune-core"
import { Button } from "../components/ui/button"
import {
  AlignCenterIcon,
  AlignLeftIcon,
  AlignRightIcon,
  EllipsisIcon,
  type IconProps,
} from "../icons"
import { cn } from "../lib/utils"
import { resolveBlockActionIcon } from "../block-actions/actionIcons"
import { useRuneEditorState } from "../useRuneEditorState"

export interface MediaFloatingBarProps {
  editor: Editor
}

const BAR_ATTR = "data-rune-media-floating-bar"
export const MEDIA_BAR_MORE_SELECTOR = "[data-rune-media-bar-more]"

// Below this content width the icon row collapses to `•••` alone.
const COLLAPSE_MIN_WIDTH_PX = 160

const ALIGN_OPTIONS: ReadonlyArray<{
  value: MediaAlign
  label: string
  icon: ComponentType<IconProps>
}> = [
  { value: "left", label: "Left alignment", icon: AlignLeftIcon },
  { value: "center", label: "Center alignment", icon: AlignCenterIcon },
  { value: "right", label: "Right alignment", icon: AlignRightIcon },
]

interface MediaBarTarget {
  pos: number
  /** The PM node itself — compared by REFERENCE in sameTarget, so ANY
   *  attr change (src swap, dimension backfill, collab edit) re-renders
   *  and re-resolves the portal container. PM nodes are persistent:
   *  unrelated doc edits keep this object's identity. */
  node: ProseMirrorNode
  blockId: string | null
  type: string
  align: MediaAlign
  /** The block-actions dropdown is open for this block (bar is pinned). */
  dropdownOpen: boolean
}

function readMediaBarTarget(editor: Editor): MediaBarTarget | null {
  if (!editor.isEditable) return null
  const state = editor.state
  if (isGestureActive(state)) return null
  if (getMediaPopoverBlockId(editor)) return null

  // Pin to the dropdown's block while it is open (the `•••` anchor must
  // stay mounted); otherwise follow the side-menu hover.
  const bs = blockSelectionKey.getState(state)
  let pos: number | null = null
  let dropdownOpen = false
  if (bs?.dropdownBlockId) {
    const pinned = resolveBodyBlockById(state.doc, bs.dropdownBlockId)
    if (!pinned) return null
    pos = pinned.pos
    dropdownOpen = true
  } else {
    pos = sideMenuKey.getState(state)?.hoveredPos ?? null
  }
  if (pos === null) return null

  const node = state.doc.nodeAt(pos)
  if (!node) return null

  // supports.align doubles as the bar gate: image + video declare it,
  // audio (full-width player, no alignment) opts out of the bar entirely.
  const spec = getBlockSpecs(editor)[node.type.name]
  if (!spec?.supports?.mediaSource || spec.supports.align !== true) return null

  // "Filled" across both media shapes: an asset src or an embed URL.
  const { src, embedUrl } = node.attrs as Record<string, unknown>
  const filled =
    (typeof src === "string" && src !== "") ||
    (typeof embedUrl === "string" && embedUrl !== "")
  if (!filled) return null

  return {
    pos,
    node,
    blockId: typeof node.attrs.id === "string" ? node.attrs.id : null,
    type: node.type.name,
    align: normalizeMediaAlign(node.attrs.align),
    dropdownOpen,
  }
}

function sameTarget(
  a: MediaBarTarget | null,
  b: MediaBarTarget | null,
): boolean {
  if (a === null || b === null) return a === b
  // `node` by reference subsumes blockId/type/align — and crucially makes
  // every attr change re-render, so a NodeView rebuild (non-in-place attr)
  // can never strand the portal in the destroyed .rune-block-content.
  return (
    a.pos === b.pos && a.node === b.node && a.dropdownOpen === b.dropdownOpen
  )
}

function mediaContentElement(editor: Editor, pos: number): HTMLElement | null {
  const dom = editor.view.nodeDOM(pos)
  if (!(dom instanceof HTMLElement)) return null
  // Media blocks are atoms — the first .rune-block-content is theirs.
  return dom.querySelector<HTMLElement>(".rune-block-content")
}

export function MediaFloatingBar({ editor }: MediaFloatingBarProps) {
  const target = useRuneEditorState(editor, readMediaBarTarget, {
    events: ["transaction", "update"],
    isEqual: sameTarget,
  })
  const [alignOpen, setAlignOpen] = useState(false)

  // Re-anchoring to a different block closes the alignment row.
  const targetKey = target ? `${target.pos}:${target.blockId}` : null
  useEffect(() => {
    setAlignOpen(false)
  }, [targetKey])

  // Hand-rolled dismissal for the alignment row (no Radix layer here):
  // outside pointerdown or Esc. Capture phase + stopPropagation on Esc so
  // the MBS keymap / other chrome never see it.
  useEffect(() => {
    if (!alignOpen) return
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target
      if (t instanceof Element && t.closest(`[${BAR_ATTR}]`)) return
      setAlignOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      e.stopPropagation()
      e.preventDefault()
      setAlignOpen(false)
    }
    document.addEventListener("pointerdown", onPointerDown, true)
    document.addEventListener("keydown", onKeyDown, true)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true)
      document.removeEventListener("keydown", onKeyDown, true)
    }
  }, [alignOpen])

  if (!target) return null
  const contentEl = mediaContentElement(editor, target.pos)
  if (!contentEl) return null

  const collapsed =
    contentEl.getBoundingClientRect().width < COLLAPSE_MIN_WIDTH_PX

  const spec = getBlockSpecs(editor)[target.type]
  const runtime: RuneBlockActionRuntimeContext = {
    editor,
    node: target.node,
    blockId: target.blockId,
    pos: target.pos,
    isSingleBlock: true,
  }
  const quickActions = (spec?.blockActions?.({ editor }) ?? []).filter(
    (action) =>
      action.quickAction === true && (action.isVisible?.(runtime) ?? true),
  )

  const runAction = (action: RuneBlockAction) => {
    setAlignOpen(false)
    action.run(runtime)
  }

  const setAlign = (align: MediaAlign) => {
    // Re-clicking the pressed option is a no-op — just close the row.
    // (Dispatching anyway would be harmless — the atom NodeView absorbs a
    // value-equal attrs rewrite without rebuilding — but it would still
    // push a useless step onto the undo stack.)
    if (align === target.align) {
      setAlignOpen(false)
      return
    }
    const current = editor.state.doc.nodeAt(target.pos)
    if (!current) return
    const tr = editor.state.tr.setNodeAttribute(target.pos, "align", align)
    // The side-menu plugin resets hoveredPos on ANY doc change; restore
    // it in the same transaction (meta wins over the docChanged reset)
    // so the bar — and the grip — survive the click and the user can
    // keep adjusting. An attr-only change leaves positions stable.
    tr.setMeta(sideMenuKey, { hoveredPos: target.pos })
    editor.view.dispatch(tr)
    setAlignOpen(false)
  }

  const toggleDropdown = () => {
    setAlignOpen(false)
    if (target.dropdownOpen) {
      editor.view.dispatch(
        editor.state.tr.setMeta(blockSelectionKey, { closeDropdown: true }),
      )
      return
    }
    if (target.blockId) {
      openBlockActionsDropdown(editor.view, target.blockId, "media-bar")
    }
  }

  const activeAlignIcon =
    ALIGN_OPTIONS.find((option) => option.value === target.align)?.icon ??
    AlignCenterIcon

  return createPortal(
    <div
      {...{ [BAR_ATTR]: "" }}
      data-rune-editor-chrome=""
      contentEditable={false}
      // The content box carries 4px padding around the media, so 12px from
      // the box = 8px inside the image's own edge — far enough in to clear
      // the image's rounded corner (the bar must sit ON the media, not in
      // the padding gutter or over the corner radius).
      className="absolute end-3 top-3 z-2 cursor-default animate-in fade-in-0 duration-200"
    >
      <div
        aria-label="Block actions"
        className="flex w-fit items-center gap-0.5 rounded-md bg-popover p-0.5 text-(--rune-gutter-fg) shadow-md ring-1 ring-foreground/10"
      >
        {!collapsed && (
          <BarIconButton
            icon={activeAlignIcon}
            label="Set block alignment"
            expanded={alignOpen}
            onPress={() => setAlignOpen((v) => !v)}
          />
        )}
        {!collapsed &&
          quickActions.map((action) => (
            <BarIconButton
              key={action.id}
              icon={resolveBlockActionIcon(action.icon) ?? EllipsisIcon}
              label={action.label}
              disabled={action.isDisabled?.(runtime) ?? false}
              onPress={() => runAction(action)}
            />
          ))}
        <BarIconButton
          {...{ "data-rune-media-bar-more": "" }}
          icon={EllipsisIcon}
          label="Open block actions menu"
          expanded={target.dropdownOpen}
          onPress={toggleDropdown}
        />
      </div>
      {alignOpen && !collapsed && (
        <div
          role="dialog"
          aria-label="Set block alignment"
          className="absolute end-0 top-full mt-1 flex w-fit items-center rounded-md bg-popover p-0.5 text-(--rune-gutter-fg) shadow-md ring-1 ring-foreground/10 animate-in fade-in-0 zoom-in-95 duration-150"
        >
          {ALIGN_OPTIONS.map((option, index) => (
            <Fragment key={option.value}>
              {index > 0 && (
                <div className="mx-1 h-4 w-px rounded-xs bg-border" />
              )}
              <BarIconButton
                icon={option.icon}
                label={option.label}
                pressed={target.align === option.value}
                onPress={() => setAlign(option.value)}
              />
            </Fragment>
          ))}
        </div>
      )}
    </div>,
    contentEl,
  )
}

interface BarIconButtonProps extends ComponentProps<"button"> {
  icon: ComponentType<IconProps>
  label: string
  expanded?: boolean
  pressed?: boolean
  onPress: () => void
}

// mousedown (not click) + preventDefault: act before the editor loses
// focus / selection, mirroring every other floating chrome surface.
function BarIconButton({
  icon: Icon,
  label,
  disabled,
  expanded,
  pressed,
  onPress,
  className,
  ...rest
}: BarIconButtonProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={label}
      disabled={disabled}
      {...(expanded !== undefined ? { "aria-expanded": expanded } : {})}
      {...(pressed !== undefined ? { "aria-pressed": pressed } : {})}
      className={cn(
        // Icons stay the gutter gray (same color as the side-menu grip)
        // in every state — the ghost variant's hover/expanded
        // accent-foreground flip reads too bright over media.
        "rounded-[4px] text-(--rune-gutter-fg) hover:text-(--rune-gutter-fg) aria-expanded:text-(--rune-gutter-fg)",
        pressed && "bg-accent",
        className,
      )}
      onMouseDown={(e) => {
        e.preventDefault()
        if (disabled) return
        onPress()
      }}
      {...rest}
    >
      <Icon className="size-3.5" />
    </Button>
  )
}
