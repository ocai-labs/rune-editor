// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// BlockActionsDropdown — opens from the side-menu grip when the
// block-selection plugin signals dropdownBlockId. Pure plugin-state
// driven: no internal open state for the main panel, no Radix.
// Render-or-not is decided solely by `dropdownBlockId !== null &&
// gripRect !== null`.
//
// Lifecycle:
//   * Open / close / re-anchor: gesture.ts → applyGripClick dispatches
//     openDropdownFor / closeDropdown meta. We render reactively.
//   * Outside-click: a document pointerdown listener (capture phase)
//     closes the dropdown when the target is neither the dropdown
//     content nor a grip (the grip is owned by gesture.ts —
//     applyGripClick at mouseup is the single arbiter of grip-driven
//     lifecycle).
//   * Esc: a document keydown listener (capture phase + stopPropagation)
//     closes the dropdown without letting M1's Esc binding clear MBS.
// We previously wrapped Radix DropdownMenu, but its menu behaviours fight
// the grip's dual role (drives MBS + drives dropdown). This component uses
// Radix Popover only for positioning / collision; PM plugin state and the
// document listeners below remain the sole close owners.

import { useCallback, useEffect, useRef } from "react"
import type { ComponentType } from "react"
import type { Editor } from "@tiptap/core"
import {
  MultiBlockSelection,
  blockSelectionKey,
  getBlockSpecs,
  type BlockActionsDropdownAnchor,
  type DropdownAnchorRect,
} from "@ocai/rune-core"
import { Popover, PopoverAnchor, PopoverContent } from "../components/ui/popover"
import { useStableVirtualElement } from "../components/ui/useStableVirtualElement"
import { editorViewDom, type RuneAnchor } from "../positioning"
import {
  CopyIcon,
  type IconProps,
  PaintRollerIcon,
  TrashIcon,
} from "../icons"
import { resolveBlockActionIcon } from "./actionIcons"
import { MEDIA_BAR_MORE_SELECTOR } from "../media-bar/MediaFloatingBar"
import { cn } from "../lib/utils"
import { useRuneEditorState } from "../useRuneEditorState"
import {
  NativeMenuItem,
  NativeMenuLabel,
  NativeMenuSeparator,
  nativeMenuContentClass,
} from "../native-menu"
import {
  TurnIntoSubmenu,
  TURN_INTO_SUBMENU_ATTR,
} from "./items/TurnIntoSubmenu"
import { CopyLinkItem } from "./items/CopyLinkItem"
import type {
  BuildBlockLink,
  OnCopyLink,
} from "./items/CopyLinkItem"

export interface BlockActionsDropdownProps {
  editor: Editor
  /** Host-supplied URL builder. If omitted under a browser, the default
   *  stamps `?block=<id>` into `location.pathname`. Omitted + SSR → the
   *  Copy link item is disabled. */
  buildBlockLink?: BuildBlockLink
  /** Fires after a clipboard write resolves or rejects. Host owns toast UX. */
  onCopyLink?: OnCopyLink
}

function defaultBuildBlockLink({ blockId }: { editor: Editor; blockId: string }): string {
  const { pathname, search, hash } = window.location
  const params = new URLSearchParams(search)
  params.set("block", blockId)
  const qs = params.toString()
  return `${pathname}${qs ? `?${qs}` : ""}${hash}`
}

interface MbsRead {
  blockStartPositions: number[]
  firstPos: number | null
}

interface BlockActionsSnapshot {
  dropdownBlockId: string | null
  mbs: MbsRead
  /** Which element the dropdown anchors to — the grip by default, the media
   *  floating bar's `•••`, or the inline toolbar's `•••` (plugin
   *  `dropdownAnchor`). For grip / media-bar the rect is read live by
   *  `gripAnchor` (findAnchorRect); for `toolbar` it's the frozen
   *  `dropdownAnchorRect` (the toolbar button is gone by the time we render). */
  anchorKind: BlockActionsDropdownAnchor
  /** Frozen anchor rect, set only for `anchorKind: "toolbar"`. */
  anchorRect: DropdownAnchorRect | null
}

interface BlockActionContext {
  editor: Editor
  blockSpecs: ReturnType<typeof getBlockSpecs>
  nodeName: string | null
  firstBlockId: string | null
  firstPos: number | null
  isSingleBlock: boolean
  closeDropdown: () => void
}

interface BlockActionSection {
  label: string
  actions: BlockActionRowModel[]
}

interface BlockActionRowModel {
  key: string
  label: string
  icon?: ComponentType<IconProps>
  disabled?: boolean
  onAction: () => void
}

const DEFAULT_BLOCK_ACTION_SECTION: BlockActionSection = {
  label: "Text",
  actions: [],
}

/** Gap (px) between the selected text's bottom and the dropdown when opened
 *  from the inline toolbar's `•••`. Small so the menu hugs the block, the way
 *  Notion drops its selection menu close to the text. */
const TOOLBAR_MENU_GAP = 8

const CONTENT_ATTR = "data-rune-block-actions-content"
const GRIP_SELECTOR = '[data-rune-side-menu-button="grip"]'
const OUTSIDE_CLICK_SAFE_SELECTOR = [
  `[${CONTENT_ATTR}]`,
  `[${TURN_INTO_SUBMENU_ATTR}]`,
].join(",")

export function BlockActionsDropdown({
  editor,
  buildBlockLink,
  onCopyLink,
}: BlockActionsDropdownProps) {
  const { dropdownBlockId, mbs, anchorKind, anchorRect } = useRuneEditorState(
    editor,
    readBlockActionsSnapshot,
    {
      events: ["transaction", "update"],
      isEqual: sameBlockActionsSnapshot,
    },
  )
  // Live anchor over the grip (or media-bar `•••`) — re-queries the DOM on every
  // floating-ui measurement and carries the editor DOM as contextElement, so the
  // dropdown re-positions on inner-container scroll without a manual handler.
  const lastGripRectRef = useRef<DOMRect | null>(null)
  const gripAnchor = useCallback<RuneAnchor>(() => {
    if (!dropdownBlockId) return lastGripRectRef.current
    // `toolbar` anchors to a frozen rect captured at open time — its source
    // button (the inline toolbar's `•••`) has already unmounted, so there's
    // nothing live to re-query.
    if (anchorKind === "toolbar") {
      const rect = anchorRect
        ? new DOMRect(
            anchorRect.left,
            anchorRect.top,
            anchorRect.width,
            anchorRect.height,
          )
        : lastGripRectRef.current
      if (rect) lastGripRectRef.current = rect
      return rect
    }
    const rect = findAnchorRect(editor, dropdownBlockId, anchorKind)
    if (rect) lastGripRectRef.current = rect
    return rect ?? lastGripRectRef.current
  }, [editor, dropdownBlockId, anchorKind, anchorRect])
  gripAnchor.contextElement = editorViewDom(editor)
  const gripVirtualRef = useStableVirtualElement(gripAnchor)

  // Outside-click → close. Capture phase so we run before any handler
  // that might stopPropagation. We skip when the target is inside the
  // dropdown content (so swatches work) and when the target is a grip
  // (gesture.ts owns grip-driven lifecycle).
  useEffect(() => {
    if (!dropdownBlockId) return
    const handler = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null
      if (!target) return
      if (target.closest(OUTSIDE_CLICK_SAFE_SELECTOR)) return
      if (target.closest(GRIP_SELECTOR)) return
      // Only the bar's `•••` toggle owns the dropdown lifecycle (its
      // mousedown handler closes/reopens) — clicks on the REST of the bar
      // (Alignment, quick actions) are outside clicks and must close the
      // menu, or two popovers stack at the same corner.
      if (target.closest(MEDIA_BAR_MORE_SELECTOR)) return
      editor.view.dispatch(
        editor.state.tr.setMeta(blockSelectionKey, { closeDropdown: true }),
      )
    }
    document.addEventListener("pointerdown", handler, true)
    return () => document.removeEventListener("pointerdown", handler, true)
  }, [dropdownBlockId, editor])

  // Esc → close dropdown only, preserve MBS. Capture + stopPropagation
  // so M1's Esc-clears-MBS keybinding doesn't fire.
  useEffect(() => {
    if (!dropdownBlockId) return
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      e.stopPropagation()
      e.preventDefault()
      editor.view.dispatch(
        editor.state.tr.setMeta(blockSelectionKey, { closeDropdown: true }),
      )
    }
    document.addEventListener("keydown", handler, true)
    return () => document.removeEventListener("keydown", handler, true)
  }, [dropdownBlockId, editor])

  const firstNode =
    mbs.firstPos !== null ? editor.state.doc.nodeAt(mbs.firstPos) : null
  const firstBlockId =
    mbs.blockStartPositions.length === 1
      ? readFirstMbsBlockId(editor, mbs)
      : null
  const blockSpecs = getBlockSpecs(editor)
  // Close dropdown in a separate tr after the action's own tr — keeping
  // them separate lets each command emit its own history step (so
  // Cmd+Z reverses the delete/duplicate without also re-opening the
  // dropdown).
  const closeDropdown = () => {
    editor.view.dispatch(
      editor.state.tr.setMeta(blockSelectionKey, { closeDropdown: true }),
    )
  }

  const blockActionSection = buildBlockActionSection({
    editor,
    blockSpecs,
    nodeName: firstNode?.type.name ?? null,
    firstBlockId,
    firstPos: mbs.firstPos,
    isSingleBlock: mbs.blockStartPositions.length === 1,
    closeDropdown,
  })

  const handleDelete = () => {
    // deleteBlockSelection sets a TextSelection at the seam, which is
    // the right post-action selection — the user is "done with this
    // block range, where would I land if I hit backspace there".
    editor.commands.deleteBlockSelection()
    closeDropdown()
    editor.view.focus()
  }

  const handleDuplicate = () => {
    // duplicateBlocks preserves the MBS but re-anchors it on the new
    // copies; that's intentional so the user can immediately apply a
    // follow-up action (color, delete, drag) to the duplicates.
    editor.commands.duplicateBlocks()
    closeDropdown()
    editor.view.focus()
  }

  const copyLinkBlockId =
    mbs.blockStartPositions.length === 1
      ? readFirstMbsBlockId(editor, mbs) ?? dropdownBlockId
      : dropdownBlockId

  const resolvedBuildBlockLink: BuildBlockLink | undefined =
    buildBlockLink ??
    (typeof window !== "undefined" ? defaultBuildBlockLink : undefined)

  const handleCopyLinkAfter = () => {
    closeDropdown()
  }

  if (!dropdownBlockId || !gripVirtualRef) return null

  return (
    <Popover open={true} modal={false} onOpenChange={() => {}}>
      <PopoverAnchor virtualRef={gripVirtualRef} />
      <PopoverContent
        side="bottom"
        align={anchorKind === "grip" ? "start" : "end"}
        // grip / media-bar drop 6px below their (persistent) anchor. The
        // toolbar anchor is a zero-height line at the selected text's bottom
        // (frozen in InlineToolbar), so this gap is measured straight from the
        // block — tune it to sit the menu closer to / further from the text.
        sideOffset={anchorKind === "toolbar" ? TOOLBAR_MENU_GAP : 6}
        collisionPadding={8}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        onFocusOutside={(e) => e.preventDefault()}
        className={cn(nativeMenuContentClass("popover"), "gap-0")}
        {...{ [CONTENT_ATTR]: "" }}
      >
        <NativeMenuLabel>{blockActionSection.label}</NativeMenuLabel>
        {blockActionSection.actions.map((action) => (
          <BlockActionRow key={action.key} action={action} />
        ))}
        <InlineColorOnlyRow />
        <TurnIntoSubmenu
          editor={editor}
          sourceBlockIds={mbsBlockIds(editor, dropdownBlockId, mbs)}
          onAfterApply={closeDropdown}
        />
        {copyLinkBlockId && (
          <CopyLinkItem
            editor={editor}
            blockId={copyLinkBlockId}
            mbsBlockCount={mbs.blockStartPositions.length}
            buildBlockLink={resolvedBuildBlockLink}
            onCopyLink={onCopyLink}
            onAfterCopy={handleCopyLinkAfter}
          />
        )}
        <NativeMenuSeparator />
        <NativeMenuItem icon={CopyIcon} onClick={handleDuplicate}>
          Duplicate
        </NativeMenuItem>
        <NativeMenuItem
          icon={TrashIcon}
          variant="destructive"
          onClick={handleDelete}
        >
          <span>Delete</span>
          <span className="ml-auto text-xs text-muted-foreground">Del</span>
        </NativeMenuItem>
      </PopoverContent>
    </Popover>
  )
}

function readMbs(editor: Editor): MbsRead {
  const sel = editor.state.selection
  if (!(sel instanceof MultiBlockSelection)) {
    return { blockStartPositions: [], firstPos: null }
  }
  // Surface-agnostic: `sel.from` is the absolute boundary before the first
  // selected block and `sel.blockNodes` are the selected nodes in order, so
  // accumulating nodeSizes yields the absolute pos-before of each selected
  // block on its OWN surface (root OR a column). The old root walk
  // (`doc.child(i)` by surface-LOCAL index) returned root blocks' positions
  // for a column-local MBS, so turn-into / color / duplicate acted on the
  // wrong block.
  const positions: number[] = []
  let pos = sel.from
  for (const node of sel.blockNodes) {
    positions.push(pos)
    pos += node.nodeSize
  }
  return { blockStartPositions: positions, firstPos: positions[0] ?? null }
}

function readBlockActionsSnapshot(editor: Editor): BlockActionsSnapshot {
  if (!editor.isEditable) {
    return {
      dropdownBlockId: null,
      mbs: { blockStartPositions: [], firstPos: null },
      anchorKind: "grip",
      anchorRect: null,
    }
  }

  const ps = blockSelectionKey.getState(editor.state)
  const dropdownBlockId = ps?.dropdownBlockId ?? null
  const anchorKind = ps?.dropdownAnchor ?? "grip"
  return {
    dropdownBlockId,
    mbs: readMbs(editor),
    anchorKind,
    anchorRect: ps?.dropdownAnchorRect ?? null,
  }
}

function sameBlockActionsSnapshot(
  a: BlockActionsSnapshot,
  b: BlockActionsSnapshot,
): boolean {
  return (
    a.dropdownBlockId === b.dropdownBlockId &&
    a.anchorKind === b.anchorKind &&
    sameAnchorRect(a.anchorRect, b.anchorRect) &&
    sameMbsRead(a.mbs, b.mbs)
  )
}

function sameAnchorRect(
  a: DropdownAnchorRect | null,
  b: DropdownAnchorRect | null,
): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return (
    a.top === b.top &&
    a.left === b.left &&
    a.width === b.width &&
    a.height === b.height
  )
}

function sameMbsRead(a: MbsRead, b: MbsRead): boolean {
  if (a.firstPos !== b.firstPos) return false
  if (a.blockStartPositions.length !== b.blockStartPositions.length) return false
  return a.blockStartPositions.every(
    (pos, index) => pos === b.blockStartPositions[index],
  )
}

function findAnchorRect(
  editor: Editor,
  blockId: string,
  anchor: "grip" | "media-bar",
): DOMRect | null {
  const root = editor.view.dom
  const block = Array.from(
    root.querySelectorAll<HTMLElement>(".rune-block[data-id]"),
  ).find((candidate) => candidate.getAttribute("data-id") === blockId)
  if (!block) return null
  if (anchor === "media-bar") {
    const more = block.querySelector<HTMLElement>(MEDIA_BAR_MORE_SELECTOR)
    // Bar not mounted (yet) — fall through to the grip so the dropdown
    // never strands itself without an anchor.
    if (more) return more.getBoundingClientRect()
  }
  const grip = block.querySelector<HTMLElement>(GRIP_SELECTOR)
  return grip?.getBoundingClientRect() ?? null
}

function readFirstMbsBlockId(editor: Editor, mbs: MbsRead): string | null {
  const pos = mbs.blockStartPositions[0]
  if (pos === undefined) return null
  const node = editor.state.doc.nodeAt(pos)
  return typeof node?.attrs.id === "string" ? node.attrs.id : null
}

function mbsBlockIds(
  editor: Editor,
  anchorId: string | null,
  mbs: MbsRead,
): string[] {
  if (mbs.blockStartPositions.length === 0) {
    return anchorId ? [anchorId] : []
  }

  const ids: string[] = []
  for (const pos of mbs.blockStartPositions) {
    const node = editor.state.doc.nodeAt(pos)
    if (typeof node?.attrs.id === "string") ids.push(node.attrs.id)
  }
  return ids
}

function buildBlockActionSection(
  context: BlockActionContext,
): BlockActionSection {
  if (!context.nodeName || context.firstPos === null)
    return DEFAULT_BLOCK_ACTION_SECTION

  const spec = context.blockSpecs[context.nodeName]
  const node = context.editor.state.doc.nodeAt(context.firstPos)
  if (!spec?.blockActions || !node) return DEFAULT_BLOCK_ACTION_SECTION

  const runtime = {
    editor: context.editor,
    node,
    blockId: context.firstBlockId,
    pos: context.firstPos,
    isSingleBlock: context.isSingleBlock,
  }
  const actions = spec
    .blockActions({ editor: context.editor })
    .filter((action) => action.isVisible?.(runtime) ?? true)
    .map((action) => ({
      key: action.id,
      label: action.label,
      icon: resolveBlockActionIcon(action.icon),
      disabled: action.isDisabled?.(runtime) ?? false,
      onAction: () => {
        const handled = action.run(runtime)
        if (handled !== false) context.closeDropdown()
      },
    }))

  return {
    label:
      actions.length > 0
        ? formatBlockActionLabel(context.nodeName)
        : DEFAULT_BLOCK_ACTION_SECTION.label,
    actions,
  }
}

function formatBlockActionLabel(nodeName: string): string {
  const spaced = nodeName.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase()
}

function BlockActionRow({ action }: { action: BlockActionRowModel }) {
  return (
    <NativeMenuItem
      icon={action.icon}
      disabled={action.disabled}
      onClick={action.disabled ? undefined : action.onAction}
    >
      {action.label}
    </NativeMenuItem>
  )
}

function InlineColorOnlyRow() {
  return (
    <NativeMenuItem icon={PaintRollerIcon} disabled data-rune-inline-color-only="">
      <span>Color</span>
      <span className="ml-auto text-xs text-muted-foreground">Inline text only</span>
    </NativeMenuItem>
  )
}
