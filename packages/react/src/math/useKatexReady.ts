// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { useEffect, useState } from "react"
import { isKatexLoaded, loadKatex } from "./renderKatex"

/**
 * Returns `true` once the lazily-imported KaTeX module is available.
 *
 * Calling this on a math NodeView's first mount triggers the dynamic
 * import (so KaTeX only loads when a document actually contains math),
 * then re-renders the caller when the chunk resolves. Subsequent math
 * nodes — and every node after the first per session — read the resolved
 * module synchronously (initial state is already `true`).
 */
export function useKatexReady(): boolean {
  const [ready, setReady] = useState(isKatexLoaded)
  useEffect(() => {
    if (ready) return
    let active = true
    void loadKatex().then(() => {
      if (active) setReady(true)
    })
    return () => {
      active = false
    }
  }, [ready])
  return ready
}
