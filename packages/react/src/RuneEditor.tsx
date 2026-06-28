// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { useEffect, useMemo, useRef } from "react"
import { useRuneEditor } from "./useRuneEditor"
import type { UseRuneEditorOptions } from "./useRuneEditor"
import { EditorContent } from "@tiptap/react"
import type { Editor } from "@tiptap/react"
import type { Node as PMNode } from "@tiptap/pm/model"
import type { CSSProperties, ReactNode } from "react"
import type { PlaceholderConfig, PlaceholderResolver } from "@ocai/rune-core"
import { ComponentsContext, defaultComponents } from "./suggestion-menu/ComponentsContext"
import { BlockActionsDropdown } from "./block-actions"
import type { BuildBlockLink, OnCopyLink } from "./block-actions"
import {
  InlineToolbar,
  LinkHoverCard,
  type RenderInlineToolbarSection,
} from "./inline-toolbar"
import { TableActionsDropdown } from "./table-actions"
import { MediaFloatingBar } from "./media-bar"
import { SourceBlockPopover } from "./blocks/media"
import { CalloutEmojiPicker } from "./blocks/callout/CalloutEmojiPicker"
import {
  BlockLinkPasteMenu,
  useInternalRefClick,
  useBlockLinkClick,
  useBlockLinkPaste,
} from "./block-link"
import type {
  OpenRuneBlockLink,
  OpenRuneRef,
  ParseRuneBlockLink,
  ResolveRuneRef,
} from "./block-link"

// Slash hint shown on an empty block.
const SLASH_PLACEHOLDER = '"/" for commands'

function buildDefaultPlaceholders(): PlaceholderConfig {
  const config: PlaceholderConfig = {
    default: SLASH_PLACEHOLDER,
    heading: (node: PMNode) => `Heading ${(node.attrs.level as number) - 1}`,
    // Toggle title is painted by ToggleBodyPlugin (always-on, every empty
    // title) rather than the generic focus-gated Placeholder. Per-key
    // undefined here opts the generic extension out so they don't both
    // render on the focused title.
    toggle: undefined,
    // Bullet / numbered lists opt out: the CSS-painted marker (• / 1.) is
    // sufficient cue for an empty item, and a placeholder string would
    // compete with it visually. Task lists keep "To-do" copy (v1 parity).
    // Per-key undefined opts out via resolve.ts (see hasOwn check).
    bulletList: undefined,
    numberedList: undefined,
    taskList: "To-do",
  }
  // The in-document page title (opt-in TitleKit) opts OUT of the generic
  // focus-gated Placeholder: its only empty-state hint is title.css's
  // always-on "New page" ::before (Notion-style), so a focused empty title
  // must not ALSO render rune's `default` slash hint. An explicit per-type
  // `undefined` is the opt-out (resolve.ts hasOwn check). `title` is not a
  // default body block, so it's absent from the typed key union — assign it
  // through the index-signature shape. Harmless when TitleKit is disabled:
  // placeholder/index.ts skips its unknown-key warning for explicit
  // `undefined` opt-outs, so consumers without TitleKit don't get a warning.
  ;(config as Record<string, PlaceholderResolver | undefined>).title = undefined
  return config
}

export interface RuneEditorProps extends UseRuneEditorOptions {
  /** If provided, RuneEditor does NOT create its own editor — it uses this one. */
  editor?: Editor | null
  /** Fires once the editor is ready (whether internal or external). */
  onReady?: (editor: Editor) => void
  className?: string
  style?: CSSProperties
  /** Placeholder strings merged over Rune's English defaults. */
  placeholders?: PlaceholderConfig
  /** Children render inside the default ComponentsContext provider. */
  children?: ReactNode
  /** Forwarded to <BlockActionsDropdown> for the Copy link action. */
  buildBlockLink?: BuildBlockLink
  /** Forwarded to <BlockActionsDropdown>; fires on clipboard resolve / reject. */
  onCopyLink?: OnCopyLink
  /** Recognizes host-owned block-link URLs for paste/click handling. */
  parseBlockLink?: ParseRuneBlockLink
  /** Resolves typed internal references for readable labels and metadata. */
  resolveRef?: ResolveRuneRef
  /** Host navigation callback for recognized block-link anchors. */
  openBlockLink?: OpenRuneBlockLink
  /** Host navigation callback for typed internal references. */
  openRef?: OpenRuneRef
  /** Mount the built-in selection `InlineToolbar`. Defaults to `true`. Set
   *  `false` to suppress it and supply your own selection toolbar via
   *  `children` — the editor's own escape hatch for hosts that fully own the
   *  formatting surface (e.g. the playground's standalone toolbar). */
  inlineToolbar?: boolean
  /** Host-rendered section for the built-in `InlineToolbar`, placed below the
   *  formatting grid and shown for the same non-collapsed selection. Forwarded
   *  to `InlineToolbar`'s `renderExtraSection` — use it to add an
   *  "Edit with AI" / quick-action entry without rebuilding the toolbar.
   *  Ignored when `inlineToolbar` is `false` (you own the toolbar). */
  renderInlineToolbarSection?: RenderInlineToolbarSection
  /**
   * Base URL for the Emojibase JSON data, forwarded to the built-in
   * `CalloutEmojiPicker` (the callout icon picker is mounted internally, so
   * this is the only way for a host to point it at a self-hosted copy).
   * Defaults to the jsdelivr CDN — set this when the host can't reach it
   * (e.g. an Electron renderer with a strict `connect-src 'self'` CSP). See
   * {@link EmojiPickerProps.emojibaseUrl}. */
  emojibaseUrl?: string
}

// v0.2 RuneEditor is intentionally bare: no toolbar, no menus. Those
// compose back in once the flat-list commands land. This exists to
// verify the wiring end-to-end (createRuneKit → useRuneEditor →
// EditorContent) and give the playground a real surface to type into.
//
// No outer wrapper div: <EditorContent> renders the .rune-editor box
// directly, and popovers (`BlockActionsDropdown`, `InlineToolbar`,
// `LinkHoverCard`) ship as siblings via a Fragment. They use
// position:fixed for placement, so DOM ancestry doesn't affect layout.
// `className` / `style` on RuneEditor are applied to .rune-editor — the
// only chrome layer the editor owns. Hosts that need a wider region
// (page-level marquee, page-wide gutters) wrap the editor in their own
// container and register it via <RuneMarqueeZone>.
export function RuneEditor(props: RuneEditorProps) {
  const {
    editor: externalEditor,
    placeholders,
    ...rest
  } = props

  if (externalEditor) {
    return (
      <RuneEditorSurface
        {...rest}
        editor={externalEditor}
      />
    )
  }

  return (
    <RuneEditorInternal
      {...rest}
      placeholders={placeholders}
    />
  )
}

function RuneEditorInternal(
  props: Omit<RuneEditorProps, "editor">,
) {
  const {
    onReady,
    className,
    style,
    children,
    placeholders,
    buildBlockLink,
    onCopyLink,
    parseBlockLink,
    resolveRef,
    openBlockLink,
    openRef,
    inlineToolbar,
    renderInlineToolbarSection,
    emojibaseUrl,
    ...options
  } = props
  const mergedPlaceholders = useMemo<PlaceholderConfig>(
    () => ({ ...buildDefaultPlaceholders(), ...placeholders }),
    [placeholders],
  )
  const mergedOptions: UseRuneEditorOptions = {
    ...options,
    kit: {
      ...options.kit,
      placeholders: mergedPlaceholders,
      toggleEmptyPlaceholder:
        options.kit?.toggleEmptyPlaceholder ??
        "Empty toggle. Click to add a block.",
    },
  }
  const editor = useRuneEditor(mergedOptions)
  return (
    <RuneEditorSurface
      editor={editor}
      onReady={onReady}
      className={className}
      style={style}
      buildBlockLink={buildBlockLink}
      onCopyLink={onCopyLink}
      parseBlockLink={parseBlockLink}
      resolveRef={resolveRef}
      openBlockLink={openBlockLink}
      openRef={openRef}
      inlineToolbar={inlineToolbar}
      renderInlineToolbarSection={renderInlineToolbarSection}
      emojibaseUrl={emojibaseUrl}
    >
      {children}
    </RuneEditorSurface>
  )
}

interface RuneEditorSurfaceProps
  extends Omit<RuneEditorProps, "editor" | "placeholders"> {
  editor: Editor | null
}

function RuneEditorSurface(props: RuneEditorSurfaceProps) {
  const {
    editor,
    onReady,
    className,
    style,
    children,
    buildBlockLink,
    onCopyLink,
    parseBlockLink,
    resolveRef,
    openBlockLink,
    openRef,
    inlineToolbar = true,
    renderInlineToolbarSection,
    emojibaseUrl,
  } = props

  const readyEditorRef = useRef<Editor | null>(null)
  const onReadyRef = useRef<typeof onReady>(onReady)
  onReadyRef.current = onReady

  const blockLinkPaste = useBlockLinkPaste({
    editor,
    parseBlockLink,
    resolveRef,
  })
  useBlockLinkClick({ editor, parseBlockLink, openBlockLink })
  useInternalRefClick({ editor, openRef })

  useEffect(() => {
    if (!editor) return
    if (readyEditorRef.current === editor) return
    readyEditorRef.current = editor
    onReadyRef.current?.(editor)
  }, [editor])

  const editorClassName = className ? `rune-editor ${className}` : "rune-editor"

  return (
    <ComponentsContext.Provider value={defaultComponents}>
      <EditorContent editor={editor} className={editorClassName} style={style} />
      {editor && (
        <BlockActionsDropdown
          editor={editor}
          buildBlockLink={buildBlockLink}
          onCopyLink={onCopyLink}
        />
      )}
      {editor && inlineToolbar && (
        <InlineToolbar
          editor={editor}
          renderExtraSection={renderInlineToolbarSection}
        />
      )}
      {editor && <LinkHoverCard editor={editor} />}
      {editor && <SourceBlockPopover editor={editor} />}
      {editor && (
        <CalloutEmojiPicker editor={editor} emojibaseUrl={emojibaseUrl} />
      )}
      {editor && <MediaFloatingBar editor={editor} />}
      {editor && <TableActionsDropdown editor={editor} />}
      {editor && (
        <BlockLinkPasteMenu
          editor={editor}
          state={blockLinkPaste.state}
          onMention={blockLinkPaste.chooseMention}
          onUrl={blockLinkPaste.chooseUrl}
          onClose={blockLinkPaste.close}
        />
      )}
      {children}
    </ComponentsContext.Provider>
  )
}
