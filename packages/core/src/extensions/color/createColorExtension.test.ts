// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, expect, it } from "vitest"
import { createColorExtension } from "./createColorExtension"

describe("createColorExtension", () => {
  it("creates the four public color extension names from kind + scope", () => {
    expect(createColorExtension({ kind: "text" }).name).toBe(
      "runeTextColor",
    )
    expect(createColorExtension({ kind: "background" }).name).toBe(
      "runeBackgroundColor",
    )
  })
})
