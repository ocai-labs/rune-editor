// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// LinkEditForm — shown when the Link button is clicked over a selection that
// already has a link mark (inline toolbar) or via the link hover card's Edit.
// Edits href + text in place, or removes the link. Save-on-unmount with a
// dirty check so "open and close without changes" doesn't pollute undo
// history. Pure content (no chrome / positioning): the call site wraps it —
// LinkPanelPopover (inline toolbar) or LinkHoverCard's own PopoverContent.
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react"
import type { Editor } from "@tiptap/core"
// Side-effect: load Link's Commands<> augmentation so setLink / unsetLink
// are typed in this file. Runtime is provided by core's createRuneKit.
import "@tiptap/extension-link"
import { Button } from "../components/ui/button"
import { Input } from "../components/ui/input"
import { TrashIcon } from "../icons"
import { looksLikeUrl, normalizeHref } from "./link-utils"

export interface LinkEditFormProps {
  editor: Editor
  href: string
  range: { from: number; to: number }
  onClose: () => void
}

export function LinkEditForm({
  editor,
  href,
  range,
  onClose,
}: LinkEditFormProps) {
  const [url, setUrl] = useState(href)
  const [text, setText] = useState(() =>
    editor.state.doc.textBetween(range.from, range.to),
  )

  // Snapshot for the unmount cleanup — refs because the cleanup runs with the
  // first-render closure but needs latest values.
  const stateRef = useRef({ url, text })
  stateRef.current = { url, text }
  // Set to false from Enter / Esc / trash so the cleanup doesn't double-apply
  // a save that already happened (or, for Esc, was deliberately discarded).
  const shouldSaveOnUnmountRef = useRef(true)

  const isValid = looksLikeUrl(url)

  // Returns true if the chain ran (i.e. there were real changes to commit).
  const applyChanges = (nextUrl: string, nextText: string): boolean => {
    if (!looksLikeUrl(nextUrl)) return false
    const newHref = normalizeHref(nextUrl)
    const currentText = editor.state.doc.textBetween(range.from, range.to)
    const finalText = nextText || nextUrl.trim()
    // Dirty check: skip no-op transactions so opening the form and
    // dismissing it without changes doesn't pollute the undo history.
    if (newHref === href && finalText === currentText) return false

    let chain = editor.chain().focus().setTextSelection(range)

    if (finalText === currentText) {
      chain = chain.setLink({ href: newHref })
    } else {
      // Capture marks (other than link) at the range start so bold / color /
      // etc. survive the text replacement — otherwise insertContent's new
      // text node would carry only the link mark and silently drop them.
      const $from = editor.state.doc.resolve(range.from)
      const otherMarks = $from
        .marks()
        .filter((m) => m.type.name !== "link")
        .map((m) => ({ type: m.type.name, attrs: m.attrs }))
      chain = chain.insertContent({
        type: "text",
        text: finalText,
        marks: [...otherMarks, { type: "link", attrs: { href: newHref } }],
      })
    }

    return chain.run()
  }

  const remove = () => {
    shouldSaveOnUnmountRef.current = false
    editor.chain().focus().setTextSelection(range).unsetLink().run()
    onClose()
  }

  const handleKey = (e: ReactKeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault()
      if (isValid) applyChanges(url, text)
      shouldSaveOnUnmountRef.current = false
      onClose()
    }
    if (e.key === "Escape") {
      e.preventDefault()
      shouldSaveOnUnmountRef.current = false
      onClose()
    }
  }

  // Save-on-close: any path that unmounts the form (outside-click, scroll
  // dismiss, link-button toggle) runs this cleanup. The dirty check inside
  // applyChanges keeps StrictMode's dev double-cleanup and "opened-but-
  // untouched" closes from creating noise transactions.
  useEffect(() => {
    return () => {
      if (!shouldSaveOnUnmountRef.current) return
      const snapshot = stateRef.current
      applyChanges(snapshot.url, snapshot.text)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      data-rune-inline-toolbar-link-panel=""
      className="w-80 space-y-3 p-3 select-none"
    >
      <label
        htmlFor="rune-link-url-input"
        className="block text-xs font-medium text-muted-foreground"
      >
        Page or URL
      </label>
      <Input
        id="rune-link-url-input"
        autoFocus
        type="text"
        placeholder="Paste link"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={handleKey}
      />
      <label
        htmlFor="rune-link-text-input"
        className="block text-xs font-medium text-muted-foreground"
      >
        Link title
      </label>
      <Input
        id="rune-link-text-input"
        type="text"
        placeholder="Link text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKey}
      />
      <div className="flex justify-end border-t pt-2">
        <Button
          type="button"
          variant="ghost"
          onClick={remove}
        >
          <TrashIcon className="size-3.5" />
          Remove link
        </Button>
      </div>
    </div>
  )
}
