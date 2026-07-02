// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { SuggestionOptions } from "@tiptap/suggestion";

type MatcherConfig = Parameters<
  NonNullable<SuggestionOptions["findSuggestionMatch"]>
>[0];
type SuggestionMatch = ReturnType<
  NonNullable<SuggestionOptions["findSuggestionMatch"]>
>;

/**
 * Notion-model matcher for the `/` trigger (reference behavior captured in
 * internal design notes).
 * Replaces @tiptap/suggestion's default `findSuggestionMatch`, which has two
 * divergences from the observed Notion model:
 *
 * 1. **Prefix gate is evaluated on the whole textblock, not the local text
 *    node.** The default matcher only sees `$position.nodeBefore`'s text, so
 *    a `/` typed right after a mark boundary (link / wiki-link / any
 *    `inclusive: false` mark splits the text node) looks like it sits at
 *    "position 0" and opens the menu even though the character before it is
 *    a word character. Notion's gate: the char before `/` must be block
 *    start or whitespace — `hello/world`, `6/11`, `[[page]]/` all stay
 *    inert.
 *
 * 2. **An open session is sticky to its anchor.** The default matcher
 *    re-runs its regex and takes the LAST match, so typing `/a /` re-anchors
 *    the menu to the second slash as a fresh empty-query session. In Notion
 *    the popup is one live instance tied to the first `/`: everything typed
 *    after it — spaces and further slashes included — is query text until
 *    the session is dismissed (pick / click away / Esc / delete past the
 *    `/`).
 *
 * The sticky branch reads the live session run, which `createTriggerPlugin`
 * passes as the second argument. The run is a positionally-tracked range
 * owned by the trigger store (`sessionRun`): anchored when the wrapped
 * `shouldShow` approves a match, mapped through every transaction by the
 * session-run mapper plugin (registered before @tiptap/suggestion, so the
 * coordinates are already current for the transaction being applied),
 * cleared on exit. While a session is open the sticky branch is exhaustive:
 * either the anchored run still matches, or the session closes (null). It
 * never re-anchors. The fresh-anchor branch runs only when no session is
 * open (the opening transaction); it scans the textblock for the LAST `/`
 * with a legal prefix, so a literal slash committed earlier in the line
 * (e.g. a dismissed session's leftovers) never shadows a newly typed
 * trigger.
 */
export function slashMatcher(
  config: MatcherConfig,
  sessionRun?: { from: number; to: number } | null,
): SuggestionMatch {
  const { char, $position } = config;
  if (!$position.parent.isTextblock) return null;

  const blockStart = $position.start();
  const caret = $position.pos;

  // Sticky session: the run IS the match — anchor to mapped end, no
  // content inference. Two rejected alternatives, both field-tested:
  //   - Truncating the run at the caret made the trigger decoration chase
  //     a caret-only move back into the run (visible seam), emptied the
  //     query right after the `/` (so the "Type to search" ghost
  //     re-appeared mid-run), and split the decoration when the user
  //     typed inside the run.
  //   - Extending past the caret by CONTENT (longest suffix of the
  //     previous query still sitting at the caret) cannot distinguish old
  //     query text from pre-existing text that coincidentally equals it:
  //     `/b` typed right before `bob` swallowed the `b`, over-extending
  //     the range into user text that an item pick would then delete.
  // Positional mapping has neither failure: the mapper extends the run
  // exactly when content is inserted inside/at its right edge.
  //
  // While a session is OPEN this branch is exhaustive: if any sticky check
  // fails, the session CLOSES (return null) — it must never fall through
  // to the fresh-anchor scan below. Falling through would silently
  // re-anchor the live menu onto an unrelated dead `/` run (caret-only
  // move past it, ArrowLeft onto the anchor, Backspace deleting the live
  // `/` with an earlier run in the block), and picking an item would then
  // delete committed text. Per the Notion model (spec case 10) a session
  // only ever STARTS on the `/` keystroke itself, and the
  // `requireTypedTrigger` gate in createTriggerPlugin is bypassed while a
  // session is alive — so this null is the only thing standing between an
  // open session and an untyped re-anchor.
  if (sessionRun) {
    const { from } = sessionRun;
    // Exhaustive while open (SM-1): any failed check CLOSES the session —
    // never fall through to the fresh-anchor scan.
    if (from < blockStart) return null; // anchor left this textblock
    const blockEnd = blockStart + $position.parent.content.size;
    const to = Math.min(sessionRun.to, blockEnd);
    if (to <= from) return null;
    // The caret must sit inside the run — after the anchor, at or before
    // the end. Caret ON the anchor (ArrowLeft onto the `/`) or past the
    // run's right edge (ArrowRight into text that was never query)
    // dismisses, per the Notion model.
    if (caret <= from || caret > to) return null;
    const anchorOffset = from - blockStart;
    // "￼" (object replacement char) for inline leaves, mirroring
    // wikiLinkMatcher: each leaf is nodeSize 1, so string offsets stay
    // aligned with document positions.
    const fullText = $position.parent.textBetween(
      0,
      $position.parent.content.size,
      undefined,
      "￼",
    );
    // Anchor position no longer holds the trigger char (e.g. a
    // same-length programmatic replace over the `/`) — session over.
    if (fullText.slice(anchorOffset, anchorOffset + char.length) !== char) {
      return null;
    }
    return {
      range: { from, to },
      query: fullText.slice(anchorOffset + char.length, to - blockStart),
      text: fullText.slice(anchorOffset, to - blockStart),
    };
  }

  const textBefore = $position.parent.textBetween(
    0,
    $position.parentOffset,
    undefined,
    "￼",
  );

  // Fresh anchor (no open session — opening transaction only): the LAST
  // `/` whose preceding character is block start or whitespace. Evaluated
  // on the full textblock string so mark / inline-node boundaries can't
  // fake a block start.
  for (
    let i = textBefore.lastIndexOf(char);
    i >= 0;
    i = i === 0 ? -1 : textBefore.lastIndexOf(char, i - 1)
  ) {
    const prev = i === 0 ? "" : textBefore[i - 1]!;
    if (prev === "" || /\s/.test(prev)) {
      return {
        range: { from: blockStart + i, to: caret },
        query: textBefore.slice(i + char.length),
        text: textBefore.slice(i),
      };
    }
  }
  return null;
}
