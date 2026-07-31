// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// TableActionsDropdown — opens from a table column/row pill grip when
// CellHandlePills' plugin state signals `dropdown !== null`. Mirrors the
// pattern of BlockActionsDropdown (sibling chrome under RuneEditor.tsx):
// PM plugin owns open/close state; this component subscribes via
// useRuneEditorState, self-renders via Radix Popover for
// collision-aware positioning (flip + viewport clamping), and owns its
// own outside-click + Esc listeners.
//
// Lifecycle:
//   * Open / close: CellHandlePills' click handler dispatches
//     PILL_DROPDOWN_META { open / close }. We render reactively.
//   * Outside-click: capture-phase document pointerdown closes the
//     dropdown when the target is neither the dropdown content nor a
//     pill (the pill click handler in core owns its re-click toggle).
//   * Esc: capture-phase document keydown closes the dropdown without
//     letting other handlers see it.
//   * Pick an item: close the dropdown FIRST (so the pill DOM is no
//     longer being anchored to before the action's transaction
//     potentially re-renders it), THEN run the action command. The
//     two transactions are deliberately separate; merging them would
//     require rewriting the underlying action commands.
import { useEffect, useCallback, useRef } from "react"
import type { Editor } from "@tiptap/core"
import {
  cellHandlePillsKey,
  PILL_DROPDOWN_META,
  isTableHeaderRow,
  isTableHeaderColumn,
  type PillDropdownState,
} from "@ocai/rune-core"
import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  CircleXIcon,
  CopyIcon,
  PaintRollerIcon,
  TableHeaderIcon,
  TrashIcon,
} from "../icons"
import { cn } from "../lib/utils"
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "../components/ui/popover"
import { useStableVirtualElement } from "../components/ui/useStableVirtualElement"
import { editorViewDom, type RuneAnchor } from "../positioning"
import {
  nativeMenuContentClass,
  NativeMenuItem,
  NativeMenuSwitchItem,
} from "../native-menu"
import { useRuneEditorState } from "../useRuneEditorState"

export interface TableActionsDropdownProps {
  editor: Editor
}

const CONTENT_ATTR = "data-rune-table-actions-content"
const PILL_SELECTOR = ".rune-col-pill, .rune-row-pill"

export function TableActionsDropdown({ editor }: TableActionsDropdownProps) {
  const dropdown = useRuneEditorState(
    editor,
    (e) => cellHandlePillsKey.getState(e.state)?.dropdown ?? null,
    { events: ["transaction"], isEqual: samePillDropdown },
  )

  // Outside-click → close. Skip when target is inside the menu (so item
  // clicks land) and when target is a pill (CellHandlePills owns the
  // pill-click toggle).
  useEffect(() => {
    if (!dropdown) return
    const handler = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null
      if (!target) return
      if (target.closest(`[${CONTENT_ATTR}]`)) return
      if (target.closest(PILL_SELECTOR)) return
      editor.view.dispatch(
        editor.state.tr.setMeta(PILL_DROPDOWN_META, { close: true }),
      )
    }
    document.addEventListener("pointerdown", handler, true)
    return () => document.removeEventListener("pointerdown", handler, true)
  }, [dropdown, editor])

  // Esc → close. Capture + stopPropagation so block-selection's
  // Esc-clears-MBS handler (M1) doesn't ALSO fire.
  useEffect(() => {
    if (!dropdown) return
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      e.stopPropagation()
      e.preventDefault()
      editor.view.dispatch(
        editor.state.tr.setMeta(PILL_DROPDOWN_META, { close: true }),
      )
    }
    document.addEventListener("keydown", handler, true)
    return () => document.removeEventListener("keydown", handler, true)
  }, [dropdown, editor])

  const onPick = useCallback(
    (action: () => boolean) => {
      // Close FIRST — unmounts the menu before the action's transaction
      // (potentially) re-renders the source pill widget. See spec
      // 2026-05-06-m8-4e-d-table-pill-dropdown.md §"Risk: Pill DOM
      // unmounts mid-dropdown".
      //
      // Scope: applies to position-shifting commands (insert/delete/
      // duplicate row/column) where the pill widget's keyed position
      // changes and PM may replace its DOM. Size-preserving commands
      // that only flip node types in place (e.g. toggleTableHeaderRow
      // via setNodeMarkup) keep the same widget key + DOM, so callers
      // may legitimately bypass onPick to keep the menu open — see
      // ColMenuItems / RowMenuItems' header switch.
      editor.view.dispatch(
        editor.state.tr.setMeta(PILL_DROPDOWN_META, { close: true }),
      )
      action()
    },
    [editor],
  )

  // Live anchor over the source pill — re-queries the DOM on every floating-ui
  // measurement (the pill may be re-decorated mid-life by PM) and carries the
  // editor DOM as contextElement, so the dropdown re-positions on inner-
  // container scroll without a manual scroll/resize handler.
  const lastPillRectRef = useRef<DOMRect | null>(null)
  const pillAnchor = useCallback<RuneAnchor>(() => {
    if (!dropdown) return lastPillRectRef.current
    const rect = findPillRect(editor, dropdown)
    if (rect) lastPillRectRef.current = rect
    return rect ?? lastPillRectRef.current
  }, [editor, dropdown])
  pillAnchor.contextElement = editorViewDom(editor)
  const pillVirtualRef = useStableVirtualElement(pillAnchor)

  if (!dropdown || !pillVirtualRef) return null

  const isCol = dropdown.axis === "col"

  return (
    <Popover open={true} modal={false} onOpenChange={() => {}}>
      <PopoverAnchor virtualRef={pillVirtualRef} />
      <PopoverContent
        side={isCol ? "bottom" : "right"}
        align={isCol ? "center" : "start"}
        sideOffset={4}
        collisionPadding={8}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        onFocusOutside={(e) => e.preventDefault()}
        className={cn(nativeMenuContentClass("popover"), "gap-0 rune-table-actions-menu")}
        role="menu"
        data-axis={dropdown.axis}
        {...{ [CONTENT_ATTR]: "" }}
      >
        {isCol ? (
          <ColMenuItems
            editor={editor}
            onPick={onPick}
            tableStart={dropdown.tableStart}
            index={dropdown.index}
          />
        ) : (
          <RowMenuItems
            editor={editor}
            onPick={onPick}
            tableStart={dropdown.tableStart}
            index={dropdown.index}
          />
        )}
      </PopoverContent>
    </Popover>
  )
}

interface ItemsProps {
  editor: Editor
  onPick: (action: () => boolean) => void
  tableStart: number
  index: number
}

function InlineColorOnlyRow() {
  return (
    <NativeMenuItem icon={PaintRollerIcon} disabled data-rune-inline-color-only="">
      <span>Color</span>
      <span className="ml-auto text-xs text-muted-foreground">Inline text only</span>
    </NativeMenuItem>
  )
}

function ColMenuItems({ editor, onPick, tableStart, index }: ItemsProps) {
  // Own subscription — the parent's samePillDropdown compare only tracks
  // {tableStart, axis, index}, which toggleTableHeaderColumn's setNodeMarkup
  // (size-preserving, deliberately keeps the menu open) never changes, so a
  // prop-only read would freeze the switch on the toggle transaction.
  // Reading isHeader through its own useRuneEditorState re-runs the selector
  // on every transaction; deps re-derives it when the dropdown re-anchors to
  // a different pill without an intervening transaction.
  const isHeader = useRuneEditorState(
    editor,
    (e) => {
      const tableNode = e.state.doc.nodeAt(tableStart - 1)
      return tableNode && tableNode.type.name === "table"
        ? isTableHeaderColumn(tableNode, index)
        : false
    },
    { deps: [tableStart, index] },
  )

  // Bypasses onPick deliberately: toggleTableHeaderColumn uses
  // setNodeMarkup (size-preserving), so the pill widget's keyed position
  // is unchanged and the dropdown stays correctly anchored — letting the
  // user pick a colour immediately after flipping. See onPick's "Scope"
  // note above.
  const toggleHeader = useCallback(() => {
    editor.commands.toggleTableHeaderColumn({ tableStart, colIndex: index })
  }, [editor, tableStart, index])

  return (
    <>
      {index === 0 ? (
        <NativeMenuSwitchItem
          icon={TableHeaderIcon}
          checked={isHeader}
          onCheckedChange={toggleHeader}
        >
          Header column
        </NativeMenuSwitchItem>
      ) : null}
      <NativeMenuItem
        icon={ArrowLeftIcon}
        onClick={() => onPick(() => editor.commands.addTableColumnBefore())}
      >
        Insert left
      </NativeMenuItem>
      <NativeMenuItem
        icon={ArrowRightIcon}
        onClick={() => onPick(() => editor.commands.addTableColumnAfter())}
      >
        Insert right
      </NativeMenuItem>
      <NativeMenuItem
        icon={CopyIcon}
        onClick={() => onPick(() => editor.commands.duplicateTableColumn())}
      >
        Duplicate column
      </NativeMenuItem>
      <NativeMenuItem
        icon={CircleXIcon}
        onClick={() => onPick(() => editor.commands.clearTableColumn())}
      >
        Clear contents
      </NativeMenuItem>
      <InlineColorOnlyRow />
      <NativeMenuItem
        icon={TrashIcon}
        onClick={() => onPick(() => editor.commands.deleteTableColumn())}
        variant="destructive"
      >
        Delete column
      </NativeMenuItem>
    </>
  )
}

function RowMenuItems({ editor, onPick, tableStart, index }: ItemsProps) {
  // See ColMenuItems for the own-subscription rationale.
  const isHeader = useRuneEditorState(
    editor,
    (e) => {
      const tableNode = e.state.doc.nodeAt(tableStart - 1)
      return tableNode && tableNode.type.name === "table"
        ? isTableHeaderRow(tableNode, index)
        : false
    },
    { deps: [tableStart, index] },
  )

  // See ColMenuItems for the onPick-bypass rationale.
  const toggleHeader = useCallback(() => {
    editor.commands.toggleTableHeaderRow({ tableStart, rowIndex: index })
  }, [editor, tableStart, index])

  return (
    <>
      {index === 0 ? (
        <NativeMenuSwitchItem
          icon={TableHeaderIcon}
          checked={isHeader}
          onCheckedChange={toggleHeader}
        >
          Header row
        </NativeMenuSwitchItem>
      ) : null}
      <NativeMenuItem
        icon={ArrowUpIcon}
        onClick={() => onPick(() => editor.commands.addTableRowBefore())}
      >
        Insert above
      </NativeMenuItem>
      <NativeMenuItem
        icon={ArrowDownIcon}
        onClick={() => onPick(() => editor.commands.addTableRowAfter())}
      >
        Insert below
      </NativeMenuItem>
      <NativeMenuItem
        icon={CopyIcon}
        onClick={() => onPick(() => editor.commands.duplicateTableRow())}
      >
        Duplicate row
      </NativeMenuItem>
      <NativeMenuItem
        icon={CircleXIcon}
        onClick={() => onPick(() => editor.commands.clearTableRow())}
      >
        Clear contents
      </NativeMenuItem>
      <InlineColorOnlyRow />
      <NativeMenuItem
        icon={TrashIcon}
        onClick={() => onPick(() => editor.commands.deleteTableRow())}
        variant="destructive"
      >
        Delete row
      </NativeMenuItem>
    </>
  )
}

// Locate the source pill's DOM rect. Scoped to the active table's frame
// so a same-axis pill in a different table doesn't match. PM's nodeDOM
// returns the .rune-block wrapper; descend to .rune-table-frame.
function findPillRect(
  editor: Editor,
  dropdown: PillDropdownState,
): DOMRect | null {
  const blockDom = editor.view.nodeDOM(
    dropdown.tableStart - 1,
  ) as HTMLElement | null
  const frame = blockDom?.querySelector(
    ".rune-table-frame",
  ) as HTMLElement | null
  if (!frame) return null
  const selector =
    dropdown.axis === "col"
      ? `.rune-col-pill[data-col="${dropdown.index}"]`
      : `.rune-row-pill[data-row="${dropdown.index}"]`
  const pill = frame.querySelector(selector) as HTMLElement | null
  return pill ? pill.getBoundingClientRect() : null
}

function samePillDropdown(
  a: PillDropdownState | null,
  b: PillDropdownState | null,
): boolean {
  if (a === null || b === null) return a === b
  return a.tableStart === b.tableStart && a.axis === b.axis && a.index === b.index
}
