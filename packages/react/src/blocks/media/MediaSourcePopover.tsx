// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { useCallback, useEffect, useRef, useState } from "react"
import type { ChangeEvent, FormEvent } from "react"
import type { Editor } from "@tiptap/core"
import {
  getMediaImportState,
  getMediaPopoverBlockId,
} from "@ocai/rune-core"
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "../../components/ui/popover"
import { Button } from "../../components/ui/button"
import { Input } from "../../components/ui/input"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../../components/ui/tabs"
import { useStableVirtualElement } from "../../components/ui/useStableVirtualElement"
import { editorViewDom } from "../../positioning"
import { useRuneEditorState } from "../../useRuneEditorState"
import {
  DEFAULT_SOURCE_BLOCK_CONFIGS,
  type ReactSourceBlockConfig,
  type ReactSourceBlockKind,
} from "./config"

type SourcePopoverTab = "upload" | "embed"

interface ActiveSourceAnchor {
  blockId: string
  element: HTMLElement
  config: ReactSourceBlockConfig
  isReplace: boolean
}

interface SourcePopoverSnapshot {
  active: ActiveSourceAnchor | null
  editable: boolean
}

export interface SourceBlockPopoverProps {
  editor: Editor
  configs?: readonly ReactSourceBlockConfig[]
  dataAttribute?: string
}

export type MediaSourcePopoverProps = SourceBlockPopoverProps

const BLOCKED_URL_PROTOCOLS = new Set(["javascript:", "vbscript:"])
const BLOCKED_URL_REFERENCE_SYNTAX = /[<>\u0000-\u001F\u007F]/
const URL_PARSE_BASE = "https://rune.local/"

function activeAnchor(
  editor: Editor,
  configs: readonly ReactSourceBlockConfig[],
): ActiveSourceAnchor | null {
  const blockId = getMediaPopoverBlockId(editor)
  if (!blockId) return null
  const importState = getMediaImportState(editor, blockId)
  if (importState?.phase === "importing") return null

  for (const config of configs) {
    const anchors = editor.view.dom.querySelectorAll<HTMLElement>(
      config.blockSelector,
    )
    for (const element of Array.from(anchors)) {
      if (element.getAttribute("data-id") === blockId) {
        return {
          blockId,
          element,
          config,
          isReplace:
            importState?.phase === "error" ||
            !element.classList.contains(config.emptyClassName),
        }
      }
    }
  }

  return null
}

function sameSourcePopoverSnapshot(
  a: SourcePopoverSnapshot,
  b: SourcePopoverSnapshot,
): boolean {
  if (a.editable !== b.editable) return false
  if (a.active === null || b.active === null) return a.active === b.active
  return (
    a.active.blockId === b.active.blockId &&
    a.active.element === b.active.element &&
    a.active.config === b.active.config &&
    a.active.isReplace === b.active.isReplace
  )
}

function isValidMediaUrl(value: string): boolean {
  if (!value) return false
  if (BLOCKED_URL_REFERENCE_SYNTAX.test(value)) return false

  try {
    const parsed = new URL(value, URL_PARSE_BASE)
    return !BLOCKED_URL_PROTOCOLS.has(parsed.protocol.toLowerCase())
  } catch {
    return false
  }
}

function hasSourceFileImport(editor: Editor, kind: ReactSourceBlockKind): boolean {
  const storage = editor.storage.imageImport
  return (
    typeof storage?.importMediaFile === "function" ||
    (kind === "image" && typeof storage?.importImageFile === "function")
  )
}

export function SourceBlockPopover({
  editor,
  configs = DEFAULT_SOURCE_BLOCK_CONFIGS,
  dataAttribute = "data-rune-source-popover",
}: SourceBlockPopoverProps) {
  const [tab, setTab] = useState<SourcePopoverTab>("upload")
  const [urlDraft, setUrlDraft] = useState("")
  const [urlError, setUrlError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const { active, editable } = useRuneEditorState(
    editor,
    (current) => ({
      active: activeAnchor(current, configs),
      editable: current.isEditable,
    }),
    {
      deps: [configs],
      isEqual: sameSourcePopoverSnapshot,
    },
  )
  const getRect = useCallback(
    () => active?.element.getBoundingClientRect() ?? null,
    [active],
  )
  // contextElement = editor DOM so floating-ui re-positions on inner-container
  // scroll (the anchor element lives inside the editor), not just window.
  const virtualRef = useStableVirtualElement(active ? getRect : null, editorViewDom(editor))
  const canUpload =
    editable &&
    !!active &&
    hasSourceFileImport(editor, active.config.kind)

  useEffect(() => {
    if (active && !editable) {
      editor.commands.closeMediaPopover()
    }
  }, [active, editable, editor])

  useEffect(() => {
    setTab("upload")
    setUrlDraft("")
    setUrlError(null)
  }, [active?.blockId])

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    const file = input.files?.[0]
    input.value = ""
    if (!active || !file || !canUpload) return

    const started = editor.commands.startMediaFileImport(
      active.blockId,
      file,
      "picker",
    )
    if (started) editor.commands.closeMediaPopover()
  }

  const submitUrl = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!active || !editable) return

    const next = urlDraft.trim()
    if (!isValidMediaUrl(next)) {
      setUrlError(active.config.labels.invalidUrl)
      return
    }

    setUrlError(null)
    const started = editor.commands.startMediaUrlImport(
      active.blockId,
      next,
      "embed",
    )
    if (started) editor.commands.closeMediaPopover()
  }

  if (!active || !virtualRef || !editable) return null

  const Icon = active.config.icon
  const labels = active.config.labels
  const dataAttrs = {
    [dataAttribute]: "",
    "data-rune-media-popover": "",
  }

  return (
    <Popover open={true} modal={false} onOpenChange={() => {}}>
      <PopoverAnchor virtualRef={virtualRef} />
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={8}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => {
          event.preventDefault()
          editor.commands.closeMediaPopover()
        }}
        onFocusOutside={(event) => event.preventDefault()}
        onKeyDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        className="w-[min(360px,calc(100vw-24px))] gap-3 p-3"
        {...dataAttrs}
      >
        <div className="flex items-center gap-2 text-sm font-medium">
          <Icon className="size-4 text-muted-foreground" />
          <span>{active.isReplace ? labels.replaceTitle : labels.addTitle}</span>
        </div>
        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as SourcePopoverTab)}
          aria-label={`${active.config.kind} source`}
        >
          <TabsList className="w-full">
            <TabsTrigger value="upload">Upload</TabsTrigger>
            <TabsTrigger value="embed">Embed link</TabsTrigger>
          </TabsList>
          {/* Both panels carry the same min-height so switching tabs cannot
              change the popover's size. Without it "Embed link" is 40px taller
              than "Upload" — an `Input` (h-8) plus a gap-2 above the same lg
              Button — and near the bottom of the viewport that growth
              re-triggers Radix's collision check, flipping the whole popover
              above the block on a tab click. Flipping is right when the popover
              genuinely does not fit; making the size constant is what confines
              that decision to open time, so a tab click only swaps the input.

              min-h-19 = 76px = Input h-8 (32) + gap-2 (8) + Button lg h-9 (36),
              the taller panel's base. The optional hint and error lines grow
              past it in both panels alike. */}
          <TabsContent value="upload" className="flex min-h-19 flex-col gap-2">
            <input
              ref={fileInputRef}
              aria-label={labels.fileInput}
              type="file"
              accept={active.config.accept}
              disabled={!canUpload}
              className="sr-only"
              onChange={onFileChange}
            />
            <Button
              type="button"
              size="lg"
              disabled={!canUpload}
              onClick={() => fileInputRef.current?.click()}
            >
              {labels.uploadButton}
            </Button>
            {!hasSourceFileImport(editor, active.config.kind) && (
              <p className="text-xs text-muted-foreground">
                {labels.missingFileHook}
              </p>
            )}
          </TabsContent>
          <TabsContent value="embed" className="min-h-19">
            <form className="flex flex-col gap-2" onSubmit={submitUrl}>
              <Input
                aria-label={labels.urlInput}
                value={urlDraft}
                placeholder={`https://example.com/${active.config.kind}`}
                onChange={(event) => {
                  setUrlDraft(event.currentTarget.value)
                  setUrlError(null)
                }}
              />
              {urlError && (
                <p className="text-xs text-destructive" role="alert">
                  {urlError}
                </p>
              )}
              <Button type="submit" size="lg">
                {labels.embedButton}
              </Button>
            </form>
          </TabsContent>
        </Tabs>
      </PopoverContent>
    </Popover>
  )
}

export const MediaSourcePopover = SourceBlockPopover
