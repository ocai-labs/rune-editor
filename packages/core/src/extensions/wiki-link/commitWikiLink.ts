// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { SuggestionCommitContext } from "../suggestion-menus"

/**
 * Commit a `[[target]]` suggestion into the document, replacing the trigger
 * range with a single marked text run.
 *
 * `alias` and `label` both set the run's initial display text, but they mean
 * different things to the `internalRef` mark's `alias` attr — and, through
 * it, to the label-sync plugin (see `InternalRefAttrs.alias` in
 * `extensions/internal-ref/index.ts` and `labelSyncPlugin.ts`):
 * - `alias`: the user's own deliberate, fixed override — e.g. `[[Target|Alias]]`
 *   syntax. Lands as `internalRef.alias = true`; syncLabel skips this run
 *   FOREVER, even after the target note is renamed.
 * - `label`: just an initial display text to show before/instead of a
 *   resolve() lookup (e.g. a suggestion menu seeding the note's current
 *   title). Lands as `internalRef.alias = false`; syncLabel keeps this run
 *   following the target's title on every future rename.
 *
 * If both are given, `alias` wins — a fixed user alias is the stronger
 * signal. If neither is given, `target` itself is the display text (current
 * behavior, `alias = false`).
 */
export function commitWikiLink(
  ctx: SuggestionCommitContext,
  attrs: { target: string; alias?: string; label?: string },
): void {
  if (!attrs.target) return

  const { editor, range } = ctx
  const hasAlias = !!(attrs.alias && attrs.alias.length > 0)
  const hasLabel = !!(attrs.label && attrs.label.length > 0)
  const text = hasAlias ? attrs.alias! : hasLabel ? attrs.label! : attrs.target
  const markType = editor.schema.marks.internalRef ?? editor.schema.marks.wikiLink
  if (!markType) return
  const markAttrs =
    markType.name === "internalRef"
      ? { kind: "page", target: attrs.target, ...(hasAlias ? { alias: true } : {}) }
      : { target: attrs.target }

  editor
    .chain()
    .focus(range.from)
    .deleteRange(range)
    .insertContent({
      type: "text",
      text,
      marks: [{ type: markType.name, attrs: markAttrs }],
    })
    .run()
}
