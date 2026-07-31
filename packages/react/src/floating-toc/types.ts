// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Carries `text` from MVP even though MVP renders bars only — keeps the
// hover-popover extension a pure render change, not a data-flow refactor.
export interface TocHeading {
  id: string
  level: 1 | 2 | 3 | 4 | 5 | 6
  text: string
  pos: number
}
