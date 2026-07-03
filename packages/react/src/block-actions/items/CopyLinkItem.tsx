// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// CopyLinkItem — the "Copy link to block" row in BlockActionsDropdown.
// Disabled when the side-menu's target spans more than one block (MBS) —
// a single URL fragment can only point at one block, so multi-block
// targets have no meaningful link to copy.
//
// Wiring contract: the host app supplies `buildBlockLink({ editor, blockId })`
// (the only place that knows the URL shape — see issue #46). We write the
// returned URL to the clipboard and notify via `onCopyLink` so the host
// can render a toast / log telemetry. `onAfterCopy` fires synchronously
// after the dispatch so the parent dropdown can close without waiting on
// the clipboard promise (clipboard write may settle after the menu closes;
// the host's onCopyLink still fires either way).

import type { Editor } from "@tiptap/core"
import { LinkIcon } from "../../icons"
import { cn } from "../../lib/utils"
import { NativeMenuItem } from "../../native-menu"

export interface BuildBlockLinkContext {
  editor: Editor
  blockId: string
}
export type BuildBlockLink = (ctx: BuildBlockLinkContext) => string

export interface OnCopyLinkResult {
  ok: boolean
  blockId: string
  url?: string
  error?: unknown
}
export type OnCopyLink = (result: OnCopyLinkResult) => void

export interface CopyLinkItemProps {
  editor: Editor
  blockId: string
  mbsBlockCount: number
  buildBlockLink?: BuildBlockLink
  onCopyLink?: OnCopyLink
  onAfterCopy?: () => void
}

export function CopyLinkItem({
  editor,
  blockId,
  mbsBlockCount,
  buildBlockLink,
  onCopyLink,
  onAfterCopy,
}: CopyLinkItemProps) {
  const disabled = mbsBlockCount > 1 || !buildBlockLink

  const handleClick = () => {
    if (disabled || !buildBlockLink) return
    const url = buildBlockLink({ editor, blockId })
    if (!navigator.clipboard) {
      onCopyLink?.({ ok: false, blockId, url, error: new Error("Clipboard API unavailable") })
    } else {
      navigator.clipboard
        .writeText(url)
        .then(() => {
          onCopyLink?.({ ok: true, blockId, url })
        })
        .catch((error: unknown) => {
          onCopyLink?.({ ok: false, blockId, url, error })
        })
    }
    onAfterCopy?.()
  }

  return (
    <NativeMenuItem
      icon={LinkIcon}
      onClick={handleClick}
      aria-disabled={disabled || undefined}
      className={cn(disabled && "pointer-events-none opacity-50")}
    >
      Copy link to block
    </NativeMenuItem>
  )
}
