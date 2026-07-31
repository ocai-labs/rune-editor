// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { EditorView } from "@tiptap/pm/view"

/** Sentinel `surfacePos` for the document root surface. */
const ROOT_SURFACE = -1

/**
 * Rune has one body-block surface: the document root.
 */
export interface SurfaceRef {
  /** Absolute PM pos of the surface node, or `-1` for the doc root. */
  surfacePos: number
}

/**
 * Return the sole root surface. Coordinates are accepted to preserve the
 * gesture helper contract.
 */
export function surfaceFromPoint(
  _view: EditorView,
  _x: number,
  _y: number,
): SurfaceRef {
  return { surfacePos: ROOT_SURFACE }
}
