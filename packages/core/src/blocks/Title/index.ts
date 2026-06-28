// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Opt-in in-document page-title surface, packaged as a `RunePlugin` so a
// consumer enables it with `createRuneKit({ plugins: [TitleKit] })`. The title
// is NOT a default body block (it's absent from RUNE_BODY_BLOCKS): a page
// title is a deliberate, structural opt-in, not a block every editor carries.
//
// BlockId comes for free: kit.ts derives BlockId.options.types from
// `[...RUNE_BODY_BLOCKS, ...pluginBlocks]`, and `TitleBlock` is a
// factory-built block extension, so it's auto-included.
import type { RunePlugin } from "../../kit"
import { TitleBlock } from "./block"

export { TITLE_TYPE } from "./constants"
export { TitleBlock } from "./block"
export type { RuneTitleBlock } from "./block"
export { TitleBoundary, setTitleText } from "./boundary"

export const TitleKit: RunePlugin = {
  id: "title",
  blockExtensions: [TitleBlock],
}
