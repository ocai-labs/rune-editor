// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// InlineToolbar — floats above a non-collapsed TextSelection. Hosts a
// block-type Turn-into pill plus inline-formatting actions (Color / Bold /
// Italic / Underline / Strikethrough / Code / Link plus stub buttons matching v1's layout).
// Mounted as a sibling of BlockActionsDropdown in RuneEditor; mutual
// exclusion is by-construction (BlockActionsDropdown gates on the block-
// selection plugin's dropdownBlockId; this gates on `selection instanceof
// TextSelection && from !== to`).
//
// Anchoring uses Radix Popover with virtualRef → a getBoundingClientRect
// computed from PM coordsAtPos. Three Radix workarounds are required:
//   * modal={false} — toolbar is non-modal.
//   * onOpenAutoFocus={preventDefault} — Radix's default would focus the
//     popover content on open, blurring PM and collapsing the selection.
//   * onFocusOutside / onPointerDownOutside guards — without these,
//     DismissableLayer fires onOpenChange(false) on window blur (tab
//     switch), even when the PM selection visibly persists. See #72.
//   * Each swatch / formatting button's onMouseDown={preventDefault} —
//     same focus-preservation reason at button level.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react"
import type { Editor } from "@tiptap/core"
import type { EditorView } from "@tiptap/pm/view"
import { TextSelection } from "@tiptap/pm/state"
import { getMarkRange } from "@tiptap/core"
// Side-effect imports: bring in the `declare module "@tiptap/core"` Commands<>
// augmentations these mark extensions ship, so editor.chain().toggleBold()
// etc. are typed inside this consumer package. Required because @ocai/rune-react
// doesn't otherwise import these mark packages directly — their runtime is
// pulled in by @ocai/rune-core's createRuneKit, but TS doesn't see those
// augmentations through the workspace dist boundary.
import "@tiptap/extension-bold"
import "@tiptap/extension-italic"
import "@tiptap/extension-underline"
import "@tiptap/extension-strike"
import "@tiptap/extension-code"
import "@tiptap/extension-link"
import {
  openBlockActionsDropdown,
  type ColorName,
} from "@ocai/rune-core"
import { Button } from "../components/ui/button"
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "../components/ui/popover"
import { useStableVirtualElement } from "../components/ui/useStableVirtualElement"
import { pointAnchorAtHead, useSelectionAnchor } from "../positioning"
import {
  ColorIndicator,
  recordColorUse,
  getRecentColors,
  RECENT_COLORS_LIMIT,
} from "../color"
import {
  BoldIcon,
  ItalicIcon,
  UnderlineIcon,
  StrikethroughIcon,
  CodeIcon,
  LinkIcon,
  MathIcon,
  MoreHorizontalIcon,
  TextIcon,
  ClearFormatIcon,
  ChevronRightIcon,
  type IconProps,
} from "../icons"
import { cn } from "../lib/utils"
import { useRuneEditorState } from "../useRuneEditorState"
import { LinkMenu } from "./LinkMenu"
import { LinkEditForm } from "./LinkEditForm"
import { LinkPanelPopover } from "./LinkPanelPopover"
import { TurnIntoSuggestionMenu } from "./TurnIntoSuggestionMenu"
import { InlineColorMenu } from "./InlineColorMenu"
import { useTurnIntoTargets } from "../turn-into"
import { getDefaultReactSlashMenuItems } from "../suggestion-menu"

/** Context handed to a host-rendered inline-toolbar section. `from`/`to` are
 *  the captured TextSelection the toolbar is anchored to — pass them to
 *  commands or read the selected text with
 *  `editor.state.doc.textBetween(from, to)`. */
export interface InlineToolbarSectionContext {
  editor: Editor
  from: number
  to: number
}

/** Renders a host-owned section below the formatting grid. See
 *  `InlineToolbarProps.renderExtraSection`. */
export type RenderInlineToolbarSection = (
  ctx: InlineToolbarSectionContext,
) => ReactNode

export interface InlineToolbarProps {
  editor: Editor
  /** Host-rendered section placed below the formatting grid, shown for the
   *  same non-collapsed text selection that opens the toolbar. rune owns WHEN
   *  (an eligible selection — the gate the whole toolbar already uses); the
   *  host owns WHAT (e.g. an "Edit with AI" / quick-action entry). This slot is
   *  content-agnostic and carries no AI coupling — it replaces the AI-specific
   *  `renderAiSection` removed in #344. Interactive elements inside MUST
   *  `preventDefault` on mousedown to keep the PM selection alive (same rule
   *  the formatting buttons follow). Omit → the toolbar is formatting-only. */
  renderExtraSection?: RenderInlineToolbarSection
}

const CONTENT_ATTR = "data-rune-inline-toolbar-content"
const COLOR_TRIGGER_ATTR = "data-rune-inline-toolbar-color-trigger"
const LINK_TRIGGER_ATTR = "data-rune-inline-toolbar-link-trigger"

interface ActiveState {
  textColor: ColorName | null
  backgroundColor: ColorName | null
  isBold: boolean
  isItalic: boolean
  isUnderline: boolean
  isStrike: boolean
  isCode: boolean
  isLink: boolean
}

function sameActiveState(a: ActiveState, b: ActiveState): boolean {
  return (
    a.textColor === b.textColor &&
    a.backgroundColor === b.backgroundColor &&
    a.isBold === b.isBold &&
    a.isItalic === b.isItalic &&
    a.isUnderline === b.isUnderline &&
    a.isStrike === b.isStrike &&
    a.isCode === b.isCode &&
    a.isLink === b.isLink
  )
}

export function InlineToolbar({
  editor,
  renderExtraSection,
}: InlineToolbarProps) {
  const [open, setOpen] = useState(false)
  // The captured selection the toolbar is anchored to. A live anchor
  // (useSelectionAnchor) reads its rect on every floating-ui measurement, so
  // the toolbar tracks inner-container scroll without a manual handler — the
  // contextElement on the anchor lets autoUpdate find the real scroll ancestor.
  const [range, setRange] = useState<{ from: number; to: number; head: number } | null>(null)
  const active = useRuneEditorState(editor, readActive, {
    isEqual: sameActiveState,
  })
  const [colorOpen, setColorOpen] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const [turnIntoOpen, setTurnIntoOpen] = useState(false)
  const turnIntoButtonRef = useRef<HTMLButtonElement | null>(null)
  // The color palette opens as a dropdown BELOW the formatting area, so it's
  // anchored to the .relative wrapper that holds the turn-into + formatting
  // rows — reproducing the original `top-full left-0` placement, but as a
  // portaled popover immune to the toolbar's overflow / window-blur reflow.
  const colorAnchorRef = useRef<HTMLDivElement | null>(null)
  // The link form is taller than the color grid, so it anchors to the WHOLE
  // toolbar (PopoverContent) and drops below it — anchoring to the
  // formatting-area wrapper like the color menu would land the form on top of
  // the renderExtraSection slot that sits below the formatting rows.
  const toolbarContentRef = useRef<HTMLDivElement | null>(null)
  const currentBlock = useCurrentTextSelectionBlock(editor)
  const currentBlockId = currentBlock?.id ?? null
  // A table source has no conversion targets at all — hide the row entirely
  // (a permanently-disabled control reads as broken; Notion hides it). The
  // transient unresolved-id state only disables: the id settles within a
  // frame and hiding would make the panel jump.
  const turnIntoHidden = currentBlock?.type === "table"
  const canTurnIntoCurrentBlock = currentBlockId !== null && !turnIntoHidden
  // Stale-open guard: a drag-extend can land the selection in a table while
  // the menu is open; the row unmounts, the open flag must not survive it.
  useEffect(() => {
    if (turnIntoHidden) setTurnIntoOpen(false)
  }, [turnIntoHidden])

  // Resolve the current block's turn-into identity (icon + title) from the
  // SAME source the dropdown renders: useTurnIntoTargets marks the matching
  // item `active` (exact type + props match, so heading levels / list kinds
  // resolve correctly), and getDefaultReactSlashMenuItems supplies the icon.
  // This keeps the trigger in lockstep with the slash menu — a new block
  // type lights up here automatically — and replaces the old static label
  // map. Falls back to Text when the source isn't resolvable yet (transient
  // selection) or has no exact match.
  const { groups: turnIntoGroups } = useTurnIntoTargets(
    editor,
    currentBlockId ? [currentBlockId] : [],
  )
  const blockTypeIconByKey = useMemo(() => {
    const map = new Map<string, ReactNode>()
    for (const item of getDefaultReactSlashMenuItems(editor)) {
      map.set(item.key, item.icon)
    }
    return map
  }, [editor])
  const currentBlockType = useMemo(() => {
    for (const g of turnIntoGroups) {
      for (const item of g.items) {
        if (item.active) {
          return { icon: blockTypeIconByKey.get(item.key), title: item.title }
        }
      }
    }
    return null
  }, [turnIntoGroups, blockTypeIconByKey])
  const pointerDownRef = useRef(false)
  // Track the last selection range that opened the toolbar. If a
  // selectionUpdate fires with the SAME range (e.g. PM dispatches a
  // selection-sync transaction when focus leaves the editor on
  // outside-click), don't reopen — the user dismissed deliberately,
  // and a NEW selection is the only signal that should reopen us.
  const lastRangeRef = useRef<{ from: number; to: number } | null>(null)

  // selectionUpdate fires on every selection change AND on mark transactions
  // whose range covers the selection. During a drag-select, mousemove drives
  // continuous selectionUpdates — opening the toolbar mid-drag is jittery
  // (anchor rect chases the cursor) and visually wrong (the user hasn't
  // finished selecting yet). Gate opening on pointer-up: while the pointer
  // is down we still allow the close branch (selection collapsed) but skip
  // setOpen(true). On pointerup we re-run update() so the toolbar appears
  // at the final selection rect. Keyboard selection (shift+arrow) has no
  // pointer-down phase, so it opens immediately as before.
  useEffect(() => {
    // selectionUpdate is the only signal that should toggle the open
    // state. We deliberately do NOT subscribe to "transaction" for the
    // open path — PM dispatches selection-sync transactions when DOM
    // focus leaves the editor, and re-running this in that path
    // re-opens the toolbar moments after Radix DismissableLayer
    // dismissed it via outside-click. The active-state path below
    // handles transactions for the button "isActive" highlights only.
    const update = () => {
      if (!editor.isEditable) {
        setOpen(false)
        setColorOpen(false)
        setLinkOpen(false)
        setTurnIntoOpen(false)
        lastRangeRef.current = null
        return
      }
      const sel = editor.state.selection
      const isText = sel instanceof TextSelection
      const collapsed = sel.from === sel.to
      // A plain-text block (node spec `marks: ""`, e.g. the page title) has no
      // inline marks to format. When the selection sits WHOLLY inside one such
      // block, keep the toolbar closed rather than float a grid of no-op
      // formatting buttons (and a Turn-into / color menu) over a field that
      // can't take any of them. A selection that merely STARTS in the title and
      // extends into the body still opens — its body run is formattable.
      const marksFree =
        isText &&
        sel.$from.parent === sel.$to.parent &&
        sel.$from.parent.type.spec.marks === ""
      if (!isText || collapsed || marksFree) {
        setOpen(false)
        setColorOpen(false)
        setLinkOpen(false)
        setTurnIntoOpen(false)
        lastRangeRef.current = null
        return
      }
      if (pointerDownRef.current) return
      // Skip reopen when range is unchanged. selectionUpdate fires on
      // any new state.selection object (PM dispatches one when DOM
      // focus moves out of the editor — the range is logically the
      // same but the object identity changed), and without this guard
      // we'd undo a deliberate Esc / outside-click dismissal.
      const last = lastRangeRef.current
      if (last && last.from === sel.from && last.to === sel.to) return
      // Probe measurability at open time; the live anchor below owns tracking.
      const next = selectionAnchorRect(editor.view, sel.from, sel.to, sel.head)
      if (!next) {
        setOpen(false)
        return
      }
      lastRangeRef.current = { from: sel.from, to: sel.to }
      setRange({ from: sel.from, to: sel.to, head: sel.head })
      setOpen(true)
    }
    const onPointerDown = () => {
      pointerDownRef.current = true
    }
    const onPointerUp = () => {
      pointerDownRef.current = false
      update()
    }
    update()
    // selectionUpdate/update are imperative gates here — open/close is
    // guarded by pointerDownRef and lastRangeRef (see
    // feedback_floating_toolbar_pointerup_gate). Don't migrate this to
    // useRuneEditorState; the gates are not pure derived state. Active
    // mark state (button highlights) is derived separately via the
    // `active` hook above.
    editor.on("selectionUpdate", update)
    // setEditable() emits 'update' (not 'transaction') — subscribe so the
    // toolbar closes when readonly is toggled on with an active selection.
    editor.on("update", update)
    document.addEventListener("pointerdown", onPointerDown, true)
    document.addEventListener("pointerup", onPointerUp, true)
    return () => {
      editor.off("selectionUpdate", update)
      editor.off("update", update)
      document.removeEventListener("pointerdown", onPointerDown, true)
      document.removeEventListener("pointerup", onPointerUp, true)
    }
  }, [editor])

  // Esc closes the toolbar (capture + stopPropagation so M1's Esc-clears-MBS
  // keybinding doesn't fire — defense-in-depth; MBS isn't active during
  // text selection but cheap to be safe).
  //
  // When a link panel (LinkMenu / LinkEditForm) is mounted, its input's
  // onKeyDown owns Esc — it sets shouldSaveOnUnmountRef.current=false
  // (LinkEditForm) and calls onClose. If we ran first in capture and
  // stopPropagation'd, that ref-flip would never happen and the form
  // would commit edits the user just discarded — see PR #75 review and
  // the related toolbar-reopen feedback loop in #77. So: defer to the
  // panel when it's open. The panel's onClose only flips linkOpen, not
  // open; a second Esc reaches this handler and closes the toolbar.
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      if (linkOpen) return
      // TurnIntoSuggestionMenu binds its own Esc (capture) when open and
      // calls preventDefault+stopPropagation, so this handler never fires
      // while it's open. After it closes, Esc reaches us and closes the
      // toolbar — matches link panel ordering.
      if (turnIntoOpen) return
      e.stopPropagation()
      setOpen(false)
      setColorOpen(false)
    }
    document.addEventListener("keydown", handler, true)
    return () => document.removeEventListener("keydown", handler, true)
  }, [open, linkOpen, turnIntoOpen])

  // Cmd+K (or Ctrl+K) opens LinkMenu / LinkEditForm depending on whether
  // the selection already carries a link mark. Only fires while the
  // toolbar is showing.
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      if (e.key.toLowerCase() !== "k") return
      if (!editor.isEditable) return
      e.preventDefault()
      setColorOpen(false)
      setLinkOpen((v) => !v)
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [open, editor])

  const onApplyText = useCallback(
    (name: ColorName) => {
      editor.chain().setRuneTextColor(name).run()
      recordColorUse(editor, "text", name)
    },
    [editor],
  )
  const onApplyBackground = useCallback(
    (name: ColorName) => {
      editor.chain().setRuneBackgroundColor(name).run()
      recordColorUse(editor, "background", name)
    },
    [editor],
  )
  // Recents are a SNAPSHOT taken when the palette opens — picks made while it's
  // open are recorded (recordColorUse above) but DON'T appear until the next
  // open. Mirrors the suggestion menu, whose recents load once per open session
  // and whose commit closes the menu, so a freshly-used item only surfaces on
  // reopen. Keying the memo on `colorOpen` freezes the list for one open's
  // lifetime; re-picking the same color (which doesn't change `active`) can't
  // sneak it in either.
  const recentColors = useMemo(
    () => getRecentColors(editor, RECENT_COLORS_LIMIT),
    [editor, colorOpen],
  )

  // editor.schema.marks.link is typed as `MarkType | undefined` because the
  // schema is generic over registered extensions. createRuneKit always
  // includes Link, so the runtime guarantee holds — narrow with a guard.
  const linkMarkType = editor.schema.marks.link
  const linkRange =
    active.isLink && linkMarkType
      ? getMarkRange(editor.state.selection.$from, linkMarkType)
      : null
  const linkHref = active.isLink
    ? (editor.getAttributes("link").href as string | undefined) ?? ""
    : ""

  // The active link form, mounted inside LinkPanelPopover (a body-portaled
  // sibling of the toolbar — see the sibling render below). Gated on linkOpen
  // so the form mounts/unmounts exactly when the panel toggles, preserving
  // LinkEditForm's save-on-unmount timing.
  let linkPopover: ReactNode = null
  if (linkOpen) {
    linkPopover =
      active.isLink && linkRange ? (
        <LinkEditForm
          key={`${linkRange.from}-${linkRange.to}`}
          editor={editor}
          href={linkHref}
          range={linkRange}
          onClose={() => setLinkOpen(false)}
        />
      ) : (
        <LinkMenu editor={editor} onClose={() => setLinkOpen(false)} />
      )
  }

  // Live anchor over the captured selection — "selection" height so a flipped
  // (side="top") toolbar lands above the lines, not on them. Carries the editor
  // DOM as contextElement, so floating-ui re-positions on inner-container scroll.
  const selectionAnchor = useSelectionAnchor(editor, range, { height: "selection" })
  const virtualRef = useStableVirtualElement(selectionAnchor)

  if (!open || !virtualRef) return null

  const activeTextName = active.textColor ?? "default"
  const activeBgName = active.backgroundColor ?? "default"

  return (
    <Popover
      open={open}
      modal={false}
      onOpenChange={(next) => {
        if (!next) {
          setOpen(false)
          setColorOpen(false)
          setLinkOpen(false)
          setTurnIntoOpen(false)
        }
      }}
    >
      <PopoverAnchor virtualRef={virtualRef} />
      <PopoverContent
        ref={toolbarContentRef}
        side="bottom"
        align="start"
        sideOffset={10}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        // Esc is owned by LinkEditForm (it discards its draft, then closes
        // only the panel) — letting Radix's default unmount the popover would
        // commit the discarded edit. focusOutside override is #72: survive
        // window blur / Cmd-Tab when the PM selection visibly persists.
        onEscapeKeyDown={(e) => e.preventDefault()}
        onFocusOutside={(e) => e.preventDefault()}
        // Turn-into menu opens as a sibling Radix popover (its own portal),
        // so clicks inside it look "outside" to this toolbar's
        // DismissableLayer and would dismiss us before the menu item's
        // click handler fires. Suppress when the pointerdown is inside the
        // .rune-suggestion-popover marker. Other portaled sub-popovers
        // (e.g. future ones) should set the same marker class or be added
        // here explicitly.
        onPointerDownOutside={(e) => {
          const target = e.target as HTMLElement | null
          if (target?.closest(".rune-suggestion-popover")) e.preventDefault()
        }}
        className="flex w-48 flex-col gap-1 overflow-hidden rounded-lg p-2 shadow-lg ring-1 ring-foreground/10"
        {...{ [CONTENT_ATTR]: "" }}
      >
        {/* The formatting-area wrapper. Its getBoundingClientRect anchors the
            two body-portaled sibling dropdowns that open below it — the color
            palette (InlineColorMenu) and the link forms (LinkPanelPopover) —
            reproducing the old `top-full left-0` placement without the
            overflow-hidden clip an absolute child suffered. */}
        <div ref={colorAnchorRef} className="flex flex-col">
          {/* Turn-into row — promoted to a full-width labeled row (Notion-style):
              current block type + a chevron. Opens TurnIntoSuggestionMenu
              anchored to this button. Hidden (row + divider) when the source
              is a table — no conversion targets exist; disabled only while
              no block id is resolvable yet (mid-transient selection). */}
          {!turnIntoHidden && (
            <>
              <Button
                ref={turnIntoButtonRef}
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Turn into"
                aria-expanded={turnIntoOpen}
                disabled={!canTurnIntoCurrentBlock}
                className="w-full justify-start gap-1.5 px-1.5 font-normal"
                onMouseDown={(e) => {
                  e.preventDefault()
                  if (!canTurnIntoCurrentBlock) return
                  setColorOpen(false)
                  setLinkOpen(false)
                  setTurnIntoOpen((v) => !v)
                }}
              >
                <span className="flex size-[18px] shrink-0 items-center justify-center">
                  {currentBlockType?.icon ?? <TextIcon className="size-4" />}
                </span>
                <span className="flex-1 truncate text-left">
                  {currentBlockType?.title ?? "Text"}
                </span>
                <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
              </Button>
              <div className="h-px bg-foreground/10 m-1" />
            </>
          )}
          {/* Formatting buttons — fixed-width panel, so they wrap within the
              192px column instead of driving its width. */}
          <div className="flex flex-wrap gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Color"
              aria-expanded={colorOpen}
              {...{ [COLOR_TRIGGER_ATTR]: "" }}
              onMouseDown={(e) => {
                e.preventDefault()
                setLinkOpen(false)
                setTurnIntoOpen(false)
                setColorOpen((v) => !v)
              }}
            >
              <ColorIndicator
                name={activeTextName}
                variant="text"
                bgName={activeBgName}
                // Notion-style (1,1) chip: 20px square, 6px corners. The
                // persistent 1px inset border already comes from the idle ring
                // in color-palette.css; only the size/radius differ from the
                // smaller swatch chips used inside ColorMenu.
                className="size-5"
              />
            </Button>
            <IconBtn
              icon={BoldIcon}
              label="Bold"
              active={active.isBold}
              onClick={() => editor.chain().focus().toggleBold().run()}
            />
            <IconBtn
              icon={ItalicIcon}
              label="Italic"
              active={active.isItalic}
              onClick={() => editor.chain().focus().toggleItalic().run()}
            />
            <IconBtn
              icon={UnderlineIcon}
              label="Underline"
              active={active.isUnderline}
              onClick={() => editor.chain().focus().toggleUnderline().run()}
            />
            {/* Clear format — strips all inline marks over the selection,
                including the textStyle color/background mark. Stateless action,
                so no `active`. */}
            <IconBtn
              icon={ClearFormatIcon}
              label="Clear format"
              iconClassName="size-5"
              onClick={() => editor.chain().focus().unsetAllMarks().run()}
            />
            {/* Link button has TWO independent visual states:
                - active.isLink → glyph in --editor-accent (same uniform
                  "mark is on" affordance Bold / Italic / Underline /
                  Strike / Code share via IconBtn).
                - linkOpen → aria-expanded styling from Button, the standard
                  trigger-open treatment shared with Turn-into and Color.
                Order matters: isLink is listed AFTER linkOpen so twMerge
                keeps `text-[var(--editor-accent)]` when both are active.
                Otherwise the trigger-open text color wins the slot and the
                affordance evaporates exactly when
                the user opens the popover over a link. */}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Link"
              aria-expanded={linkOpen}
              {...{ [LINK_TRIGGER_ATTR]: "" }}
              className={cn(
                active.isLink &&
                  "text-[var(--editor-accent)] hover:text-[var(--editor-accent)]",
              )}
              onMouseDown={(e) => {
                e.preventDefault()
                setColorOpen(false)
                setTurnIntoOpen(false)
                setLinkOpen((v) => !v)
              }}
            >
              <LinkIcon className="size-4.5" />
            </Button>
            <IconBtn
              icon={StrikethroughIcon}
              label="Strikethrough"
              active={active.isStrike}
              onClick={() => editor.chain().focus().toggleStrike().run()}
            />
            <IconBtn
              icon={CodeIcon}
              label="Code"
              active={active.isCode}
              onClick={() => editor.chain().focus().toggleCode().run()}
            />
            <IconBtn
              icon={MathIcon}
              label="Math"
              onClick={() => {
                editor.commands.wrapSelectionAsInlineMath()
              }}
            />
            <IconBtn
              icon={MoreHorizontalIcon}
              label="More options"
              onClick={(e) => {
                if (!currentBlockId) return
                // Open the same block-actions dropdown the side-menu grip
                // produces, anchored to THIS toolbar. Setting the block
                // selection unmounts the toolbar (it gates on a
                // TextSelection), so we capture a frozen anchor now — there's
                // nothing live to re-query once we render.
                //
                // Vertical: anchor to the SELECTED TEXT's bottom, NOT the •••
                // button (which sits a toolbar-row below the text). The
                // dropdown adds its own small gap, so the menu lands just
                // under the block — close to the text like Notion — regardless
                // of how tall the toolbar is. Horizontal: keep the button's x
                // so the menu stays right-aligned to the •••.
                const btn = e.currentTarget.getBoundingClientRect()
                const sel = range
                  ? selectionAnchorRect(
                      editor.view,
                      range.from,
                      range.to,
                      range.head,
                    )
                  : null
                openBlockActionsDropdown(editor.view, currentBlockId, "toolbar", {
                  top: sel?.bottom ?? btn.top,
                  left: btn.left,
                  width: btn.width,
                  height: 0,
                })
              }}
            />
          </div>
        </div>
        {/* Host-rendered section slot — below the formatting grid, for the
            same non-collapsed selection that opened the toolbar (gate already
            enforced by the `!open` early-return + range capture above). rune
            owns WHEN, the host owns WHAT. Content-agnostic: replaces the
            AI-coupled `renderAiSection` removed in #344, so a host can add an
            "Edit with AI" / quick-action entry without rebuilding the toolbar. */}
        {renderExtraSection && range ? (
          <>
            {/* No margin on the divider — PopoverContent's own `gap-1`
                provides the spacing; an extra `m-1` here would double it. */}
            <div className="h-px bg-foreground/10" />
            {renderExtraSection({ editor, from: range.from, to: range.to })}
          </>
        ) : null}
      </PopoverContent>
      {/* Sibling — not nested — to the toolbar's PopoverContent. Radix
          portals each popover separately; nesting works for some surfaces
          but DismissableLayer's outside-click stack gets noisy. The
          turn-into menu anchors to its own button rect (a stable child of
          the toolbar's PopoverContent), so its rect stays correct on
          scroll the same way the toolbar's selection-anchor does. */}
      {canTurnIntoCurrentBlock ? (
        <TurnIntoSuggestionMenu
          editor={editor}
          sourceBlockId={currentBlockId}
          open={turnIntoOpen}
          onOpenChange={setTurnIntoOpen}
          anchorRef={turnIntoButtonRef}
        />
      ) : null}
      {/* Color palette — sibling (not nested) portaled popover anchored to the
          formatting-area wrapper, same construction as TurnIntoSuggestionMenu.
          Opens as a dropdown below it (with collision flip), replacing the old
          embedded `absolute top-full` child that broke after window-blur
          reflows. */}
      <InlineColorMenu
        open={colorOpen}
        onOpenChange={setColorOpen}
        anchorRef={colorAnchorRef}
        activeText={active.textColor}
        activeBg={active.backgroundColor}
        onApplyText={onApplyText}
        onApplyBackground={onApplyBackground}
        recent={recentColors}
      />
      {/* Link form — same construction as the color palette (a body-portaled
          sibling popover), but anchored to the WHOLE toolbar so the tall form
          drops below it instead of landing on the renderExtraSection slot.
          Replaces the old `absolute top-full` child that the toolbar's w-48
          overflow-hidden box clipped (#352 fixed color the same way; the link
          forms were the deferred half). */}
      <LinkPanelPopover
        open={linkOpen}
        onOpenChange={setLinkOpen}
        anchorRef={toolbarContentRef}
      >
        {linkPopover}
      </LinkPanelPopover>
    </Popover>
  )
}

interface IconBtnProps {
  icon: ComponentType<IconProps>
  label: string
  active?: boolean
  /** Receives the originating mouse event so callers can read the button rect
   *  (e.g. the More button anchors the block-actions dropdown to itself). */
  onClick?: (event: ReactMouseEvent<HTMLButtonElement>) => void
  /** Override the icon glyph size (default size-4.5). Merged over the default,
   *  so e.g. "size-5" nudges a single icon a touch larger. */
  iconClassName?: string
}

// Active mark gets --editor-accent glyph (same blue as the Link button and
// the color trigger swatch). One uniform "this mark is on" affordance across
// Bold / Italic / Underline / Strikethrough / Code — users can confirm from
// the toolbar without re-reading the text. Hover override keeps the blue
// when the pointer is over the active button (otherwise the hover variant
// would flip it to accent-foreground and the affordance disappears exactly
// when the user is about to click).
function IconBtn({
  icon: Icon,
  label,
  active,
  onClick,
  iconClassName,
}: IconBtnProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      aria-pressed={active}
      className={cn(
        active &&
          "text-[var(--editor-accent)] hover:text-[var(--editor-accent)]",
      )}
      onMouseDown={(e) => {
        e.preventDefault()
        onClick?.(e)
      }}
    >
      <Icon className={cn("size-4.5", iconClassName)} />
    </Button>
  )
}

function useCurrentTextSelectionBlock(
  editor: Editor,
): { id: string; type: string } | null {
  return useRuneEditorState(editor, readCurrentTextSelectionBlock, {
    isEqual: sameCurrentTextSelectionBlock,
  })
}

function readCurrentTextSelectionBlock(
  editor: Editor,
): { id: string; type: string } | null {
  const selection = editor.state.selection
  if (!(selection instanceof TextSelection)) return null

  const node = selection.$from.depth >= 1 ? selection.$from.node(1) : null
  const id = node?.attrs.id
  return node && typeof id === "string" ? { id, type: node.type.name } : null
}

function sameCurrentTextSelectionBlock(
  a: { id: string; type: string } | null,
  b: { id: string; type: string } | null,
): boolean {
  if (a === null || b === null) return a === b
  return a.id === b.id && a.type === b.type
}

function selectionAnchorRect(
  view: EditorView,
  from: number,
  to: number,
  head: number,
): DOMRect | null {
  // Anchor y spans the selection bbox (top→bottom, "selection" shape), x at the
  // selection HEAD so it tracks the cursor end the user is looking at. Default
  // side="bottom" (matches Notion) places the toolbar below ALL selection lines;
  // when it can't fit below (near the viewport bottom) and Radix flips it to
  // side="top", the non-zero height keeps it ABOVE the text instead of on it
  // (#74 — the multi-line "don't cover the lines" guarantee holds either way).
  // Width 0 + align="start" pins the left edge to head x. The rect math is the
  // shared getter (../positioning); the `from === to` guard stays here.
  if (from === to) return null
  return pointAnchorAtHead(view, from, to, head, { height: "selection" })
}

// Exported for unit testing. #87: $pos.marks() at selection.from defaults
// to the LEFT-side text node's marks at a boundary, missing a just-applied
// mark when the selection doesn't start at the textblock's first position.
// editor.getAttributes("textStyle") iterates nodesBetween(from, to) and
// returns the leading textStyle's attrs, which catches the mark regardless
// of where the selection starts. Mirrors typical floating toolbars
// (Notion, Google Docs) which show the leading run's state.
export function readActive(editor: Editor): ActiveState {
  const ts = editor.getAttributes("textStyle")
  return {
    textColor: (ts.textColor ?? null) as ColorName | null,
    backgroundColor: (ts.backgroundColor ?? null) as ColorName | null,
    isBold: editor.isActive("bold"),
    isItalic: editor.isActive("italic"),
    isUnderline: editor.isActive("underline"),
    isStrike: editor.isActive("strike"),
    isCode: editor.isActive("code"),
    isLink: editor.isActive("link"),
  }
}
