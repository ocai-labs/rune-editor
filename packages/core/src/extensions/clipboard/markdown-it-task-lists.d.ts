// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// markdown-it-task-lists ships no type declarations.
declare module "markdown-it-task-lists" {
  import type MarkdownIt from "markdown-it"

  interface TaskListsOptions {
    /** Render checkboxes as interactive (no `disabled` attr). Default false. */
    enabled?: boolean
    /** Wrap the item text in a `<label>`. Default false. */
    label?: boolean
    /** Place the `<label>` after the checkbox. Default false. */
    labelAfter?: boolean
  }

  const taskLists: (md: MarkdownIt, options?: TaskListsOptions) => void
  export default taskLists
}
