// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { Extension } from "@tiptap/core"
import { getRuneKeymap } from "../../keymap"
import { blockSelectionPlugin, blockSelectionKey } from "./plugin"
import { blockSelectionCommands } from "./commands"
import { blockSelectionKeymap } from "./keymap"
import { blockSelectionDragExtendPlugin } from "./drag-extend"
import { blockSelectionMarqueePlugin, teardownMarqueeView } from "./marquee"

export { blockSelectionKey }
export { openBlockActionsDropdown } from "./plugin"
export type {
  BlockActionsDropdownAnchor,
  BlockSelectionPluginState,
  DropdownAnchorRect,
} from "./plugin"
export { MultiBlockSelection } from "./MultiBlockSelection"
// Re-export the value so its `declare module "@tiptap/core"` augmentation
// stays reachable from `dist/index.d.ts`. tsc drops unused value imports
// during .d.ts emission, so without this consumers don't see
// `editor.commands.deleteBlockSelection` / `duplicateBlocks` / etc on the
// typed Commands surface even though the runtime impl is there.
export { blockSelectionCommands } from "./commands"

export const BlockSelection = Extension.create({
  name: "blockSelection",
  addProseMirrorPlugins() {
    return [
      blockSelectionPlugin(),
      blockSelectionDragExtendPlugin(),
      blockSelectionMarqueePlugin(),
    ]
  },
  onDestroy() {
    // Terminal marquee teardown. The marquee plugin's view().destroy()
    // is listener-only — it has to be, because PM destroys plugin views
    // on every state.reconfigure (incl. host's `editor.registerPlugin`
    // calls), and clearing the zone registry there would wipe host
    // setMarqueeZone() registrations. Editor destruction is the right
    // anchor for clearing the registry + ZONE_ATTR from host DOM.
    teardownMarqueeView(this.editor.view)
  },
  addCommands() {
    return blockSelectionCommands()
  },
  addKeyboardShortcuts() {
    return blockSelectionKeymap(getRuneKeymap(this.editor))
  },
})
