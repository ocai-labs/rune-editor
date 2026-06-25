// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// LinkMenu — inline link insertion form. Shown by InlineToolbar when the
// Link button is clicked over a selection that has no link mark. Pure content
// (no chrome / positioning): the call site supplies both — LinkPanelPopover
// for the inline toolbar (a body-portaled dropdown below the toolbar, so the
// form stays exposed and the Link button can toggle it closed).
import { useEffect, useRef, useState } from "react"
import type { Editor } from "@tiptap/core"
// Side-effect: load Link's Commands<> augmentation so setLink / unsetLink
// are typed in this file. Runtime is provided by core's createRuneKit.
import "@tiptap/extension-link"
import { Button } from "../components/ui/button"
import { Input } from "../components/ui/input"
import { GlobeIcon } from "../icons"
import { cn } from "../lib/utils"
import { looksLikeUrl, normalizeHref } from "./link-utils"

export interface LinkMenuProps {
  editor: Editor
  onClose: () => void
}

export function LinkMenu({ editor, onClose }: LinkMenuProps) {
  const [link, setLink] = useState("")
  const savedRange = useRef<{ from: number; to: number } | null>(null)

  useEffect(() => {
    const { from, to } = editor.state.selection
    savedRange.current = { from, to }
  }, [editor])

  const isValid = looksLikeUrl(link)

  const apply = () => {
    if (!isValid || !savedRange.current) return
    const ok = editor
      .chain()
      .focus()
      .setTextSelection(savedRange.current)
      .setLink({ href: normalizeHref(link) })
      .run()
    if (ok) onClose()
  }

  return (
    <div
      data-rune-inline-toolbar-link-panel=""
      className="w-80 space-y-2 p-2 select-none"
      // Block focus shift away from PM when interacting with the panel
      // chrome (the input itself still focuses normally).
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) e.preventDefault()
      }}
    >
        <Input
          autoFocus
          type="text"
          placeholder="Paste link or search pages"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && isValid) {
              e.preventDefault()
              apply()
            }
            if (e.key === "Escape") {
              e.preventDefault()
              onClose()
            }
          }}
        />
  
        <Button
          type="button"
          variant="ghost"
          disabled={!isValid}
          onMouseDown={(e) => {
            e.preventDefault()
            apply()
          }}
          className={cn(
            "h-auto w-full items-start justify-start gap-2 p-2 text-left text-primary",
            isValid && "bg-muted hover:bg-muted/80",
          )}
        >
          <GlobeIcon className="mt-1 size-4 shrink-0" />
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium">{link || "Link"}</span>
            <span className="text-xs text-muted-foreground">
              {!isValid ? "Type a complete URL to link" : "Link to web page"}
            </span>
          </div>
        </Button>
      
    </div>
  )
}
