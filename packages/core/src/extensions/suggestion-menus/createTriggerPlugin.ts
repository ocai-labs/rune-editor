// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// packages/core/src/extensions/suggestion-menus/createTriggerPlugin.ts
import type { Editor } from "@tiptap/core";
import Suggestion, { type SuggestionOptions, type SuggestionProps } from "@tiptap/suggestion";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { runePluginKeyName } from "../plugin-key-name";
import { AGENT_WRITE_META } from "../agent-write-meta";
import { createTriggerStore } from "./createTriggerStore";
import type { SuggestionMenusStorage, TriggerConfig, TriggerStore } from "./types";

// Window during which the .rune-trigger pill is held in the DOM with the
// `rune-trigger--exiting` class so CSS can animate it out. Bumping this
// must also update the matching duration on `.rune-trigger--exiting` in
// `packages/react/src/suggestion-menu/suggestion.css`.
const FADE_DURATION_MS = 150;
const IME_COMPOSING_CLASS = "rune-ime-composing";
const IME_COMPOSING_SETTLE_MS = 50;

type FadeRange = { from: number; to: number };
type FadeState = { range: FadeRange | null; expiresAt: number };

// Did this transaction REPLACE the whole document? `setContent` (host
// document swaps: an external/remote sync landing, a snapshot restore, a
// tab rehydrate) lowers to a single ReplaceStep spanning [0, docSize], and
// ProseMirror maps the old selection to the END of the inserted content —
// so the trigger matcher then scans the last text block of the incoming
// document and happily anchors on any `/` that was already in the prose.
// A document swap is never a user input event, so no trigger may open a
// session on it. Checked per step against `tr.docs[i]` (the doc BEFORE that
// step), since only step 0 shares coordinates with `tr.before`.
function replacesEntireDoc(tr: Transaction): boolean {
  if (!tr.docChanged) return false;
  let whole = false;
  tr.steps.forEach((step, i) => {
    if (whole) return;
    const size = (tr.docs[i] ?? tr.before).content.size;
    step.getMap().forEach((oldStart, oldEnd) => {
      if (oldStart === 0 && oldEnd === size) whole = true;
    });
  });
  return whole;
}

// Did this transaction INSERT content covering `pos` (final-doc coords)?
// Walks each step's inserted ranges and maps them through the remaining
// steps. Typing is a single ReplaceStep, so this is cheap in practice.
function transactionInsertedAt(tr: Transaction, pos: number): boolean {
  if (!tr.docChanged) return false;
  let hit = false;
  tr.steps.forEach((step, i) => {
    if (hit) return;
    step.getMap().forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      if (hit || newStart === newEnd) return;
      let from = newStart;
      let to = newEnd;
      for (let j = i + 1; j < tr.steps.length; j++) {
        const m = tr.steps[j]!.getMap();
        from = m.map(from, 1);
        to = m.map(to, -1);
      }
      if (pos >= from && pos < to) hit = true;
    });
  });
  return hit;
}

export function createTriggerPlugin(
  editor: Editor,
  storage: SuggestionMenusStorage,
  cfg: TriggerConfig,
): Plugin[] {
  if (storage.triggers[cfg.char]) {
    throw new Error(
      `SuggestionMenus: duplicate trigger char "${cfg.char}". ` +
        `Each trigger in the \`triggers\` array must have a unique \`char\`.`,
    );
  }
  const suggestionPluginKey = new PluginKey(runePluginKeyName("suggestion", cfg.char));
  const store: TriggerStore = createTriggerStore(suggestionPluginKey);
  storage.triggers[cfg.char] = store;

  // True from the moment a session is APPROVED by the wrapped shouldShow
  // until the suggestion render lifecycle exits (onExit). Used by the
  // `requireTypedTrigger` gate to tell "query keystrokes inside an open
  // session" (allowed) apart from "a fresh open attempt" (must come from
  // a transaction that inserted the trigger char at the anchor). Tracked
  // here rather than via the React-facing store snapshot because the
  // snapshot only updates on view render — appended transactions in the
  // SAME dispatch cycle as the opening keystroke would still read
  // show=false and wrongly re-run the fresh-open gate.
  //
  // SAFETY [SM-1]: while `sessionAlive` is true the typed-trigger gate is
  // skipped, so the matcher MUST only ever produce the session's own
  // anchored run (or null) while `sessionRun` holds an open session — a
  // session-sticky matcher that fell through to a fresh-anchor scan
  // would get its re-anchored match approved here without a typed
  // trigger. `slashMatcher` upholds this: open session → the anchored
  // run or null, never a re-anchor.
  let sessionAlive = false;

  const options: SuggestionOptions = {
    // Each trigger needs its own PluginKey so ProseMirror can register
    // multiple @tiptap/suggestion instances without a "keyed plugin" conflict.
    pluginKey: suggestionPluginKey,
    editor,
    char: cfg.char,
    allow: cfg.allow,
    allowSpaces: cfg.allowSpaces,
    allowedPrefixes: cfg.allowedPrefixes,
    startOfLine: cfg.startOfLine,
    // Hand the matcher the live session run. `sessionRunMapper` below is
    // registered FIRST in the returned plugin array, so its state.apply
    // has already mapped the run through the transaction being applied by
    // the time @tiptap/suggestion's own apply invokes this matcher — the
    // coordinates are always current, never a render cycle stale.
    findSuggestionMatch: cfg.matcher
      ? (config) => cfg.matcher!(config, store.sessionRun.current)
      : undefined,
    // Wrap the user's gate in three layers:
    //   1. Suppression gate (Notion once-per-trigger): explicit dismiss
    //      paths write `suppressedAt = range.from` before exiting.
    //      While set, any future match at that same `range.from` is
    //      rejected. Cleared by `suppressionGuard` below when the
    //      trigger char at that position is removed from the doc.
    //   2. Force-open bypass: slash-menu / Emoji writes `forceOpenAt`
    //      to permit a lone `:` at the inserted position; wins over the
    //      user's gate so a programmatic `:` insert opens the picker.
    //   3. User's own `cfg.shouldShow`.
    //   4. `requireTypedTrigger` (Notion session-start model): a FRESH
    //      session only opens when this transaction inserted the trigger
    //      char at the anchor. Caret placement into a dead `/query` run
    //      (click, arrow keys, doc load) never reopens the menu. Known
    //      accepted edge: an undo that re-inserts the run also re-opens —
    //      the undo transaction genuinely inserts the anchor char.
    shouldShow: (props) => {
      // A paste, an AGENT_WRITE and a whole-document swap all put content in
      // the doc programmatically — the user did not type the trigger char, so
      // none of them opens a fresh session (Notion treats paste the same).
      // Without the agent-write branch an AI tool that inserts block text
      // containing a `/` trips the `requireTypedTrigger` gate below
      // (`transactionInsertedAt` can't tell a programmatic insert from a
      // keystroke) and pops the slash menu; without the whole-doc branch a
      // host `setContent` does the same, and worse — its full-doc ReplaceStep
      // covers EVERY position, so `transactionInsertedAt` is true no matter
      // where the matcher anchored. Arm once-per-trigger suppression at the
      // anchor like paste so a trailing caret-move there doesn't reopen it
      // either — the caret restore hosts run right after a `setContent` is
      // exactly such a move, and triggers without `requireTypedTrigger`
      // (`:`, `[[`) have nothing else standing in its way.
      if (
        props.transaction.getMeta("uiEvent") === "paste" ||
        props.transaction.getMeta(AGENT_WRITE_META) ||
        replacesEntireDoc(props.transaction)
      ) {
        store.suppressedAt.current = props.range.from;
        store.suppressedAtIsCurrentDocPos.current = true;
        return false;
      }
      const suppressed = store.suppressedAt.current;
      if (suppressed !== null && props.range.from === suppressed) {
        return false;
      }
      const forced = store.forceOpenAt.current;
      if (forced !== null && props.range.from === forced) {
        sessionAlive = true;
        // `props.range` is the fresh match range in post-transaction
        // coordinates — anchor the session run on it.
        store.sessionRun.current = { from: props.range.from, to: props.range.to };
        return true;
      }
      if (cfg.shouldShow && !cfg.shouldShow(props)) {
        return false;
      }
      if (
        cfg.requireTypedTrigger &&
        !sessionAlive &&
        !transactionInsertedAt(props.transaction, props.range.from)
      ) {
        return false;
      }
      sessionAlive = true;
      store.sessionRun.current = { from: props.range.from, to: props.range.to };
      return true;
    },
    // `rune-trigger` wraps the matched range while the suggestion is
    // active; `rune-trigger--placeholder` is added only while the query
    // is empty (@tiptap/suggestion toggles decorationEmptyClass on
    // `!query.length`). The CSS `::after` rule in @ocai/rune-react reads
    // `data-decoration-content` via `attr()` to render the ghost text.
    decorationClass: "rune-trigger",
    decorationEmptyClass: "rune-trigger--placeholder",
    decorationContent: cfg.placeholder ?? "",
    // React owns the item pipeline. Keep Tiptap's empty.
    items: () => [],
    command: () => {},
    render: () => ({
      onStart: (props: SuggestionProps) =>
        store._setState({
          show: true,
          query: props.query,
          range: props.range,
          getClientRect: props.clientRect ?? null,
        }),
      onUpdate: (props: SuggestionProps) =>
        store._setState({
          show: true,
          query: props.query,
          range: props.range,
          getClientRect: props.clientRect ?? null,
        }),
      onKeyDown: ({ event }) => store.keyHandler.current?.(event) ?? false,
      onExit: () => {
        // Clear the single-shot force-open bypass so a future organic
        // occurrence at the same position falls back to the regular gate.
        //
        // No suppressedAt write here on purpose. An earlier pass used
        // "trigger char still in doc on natural exit" as the dismissal
        // signal, but that conflated typing-a-terminator (intent: stop)
        // with typing-a-space-as-filter (intent: continue, e.g. the
        // query "heading 1"). The genuine "user typed past every match"
        // signal is items.length === 0 under a non-empty query, visible
        // only to the React controller; that's where suppression is now
        // armed.
        store.forceOpenAt.current = null;
        store.sessionRun.current = null;
        sessionAlive = false;
        store._setState({ show: false, query: "", range: null, getClientRect: null });
      },
    }),
  };

  // Sibling guard: maps `suppressedAt` across doc edits and clears it as
  // soon as the trigger character at that position is gone. Without this
  // the suppression would persist past a fresh `/` typed at the same
  // absolute position after deletion, silently blocking the new session.
  let clearImeTimer: ReturnType<typeof setTimeout> | null = null;
  const suppressionGuard = new Plugin({
    key: new PluginKey(runePluginKeyName("suggestion-suppress", cfg.char)),
    props: {
      handleDOMEvents: {
        compositionstart(view) {
          if (!view.editable) return false;
          if (clearImeTimer) {
            clearTimeout(clearImeTimer);
            clearImeTimer = null;
          }
          view.dom.classList.add(IME_COMPOSING_CLASS);
          return false;
        },
        compositionend(view) {
          if (clearImeTimer) clearTimeout(clearImeTimer);
          clearImeTimer = setTimeout(() => {
            clearImeTimer = null;
            if (!view.isDestroyed) view.dom.classList.remove(IME_COMPOSING_CLASS);
          }, IME_COMPOSING_SETTLE_MS);
          return false;
        },
      },
    },
    view(view) {
      return {
        destroy() {
          if (clearImeTimer) {
            clearTimeout(clearImeTimer);
            clearImeTimer = null;
          }
          view.dom.classList.remove(IME_COMPOSING_CLASS);
        },
      };
    },
    appendTransaction(transactions, _oldState, newState) {
      if (store.suppressedAt.current === null) return null;
      let pos = store.suppressedAt.current;
      const skipMapping = store.suppressedAtIsCurrentDocPos.current;
      store.suppressedAtIsCurrentDocPos.current = false;
      for (const tr of transactions) {
        if (tr.docChanged && !skipMapping) pos = tr.mapping.map(pos);
      }
      const docSize = newState.doc.content.size;
      if (pos < 0 || pos >= docSize) {
        store.suppressedAt.current = null;
        return null;
      }
      const end = Math.min(pos + cfg.char.length, docSize);
      const ch = newState.doc.textBetween(pos, end, " ", " ");
      if (ch !== cfg.char) {
        store.suppressedAt.current = null;
      } else {
        store.suppressedAt.current = pos;
      }
      return null;
    },
  });

  // Fade-out plugin: holds the `.rune-trigger` pill in the DOM for
  // FADE_DURATION_MS after @tiptap/suggestion removes its own decoration,
  // so CSS can animate the background/halo away instead of vanishing.
  // Implementation:
  //   - `view.update` watches the React-facing store for a show:true →
  //     show:false transition and dispatches a meta to seed the fade
  //     decoration at the previous range. A trailing setTimeout fires a
  //     second dispatch that clears the decoration once the animation
  //     completes.
  //   - The fade is skipped when the underlying text at the range is gone
  //     (item-select deletes the trigger range — there's nothing to fade),
  //     and when the leading char is no longer the
  //     trigger char (e.g. the user deleted just the `/` itself).
  //   - `apply` maps the fade range through every doc edit so the
  //     animation tracks the text even if the user keeps editing during
  //     the 150ms window.
  const fadeKey = new PluginKey<FadeState>(runePluginKeyName("suggestion-fade", cfg.char));
  const fadePlugin = new Plugin<FadeState>({
    key: fadeKey,
    state: {
      init() {
        return { range: null, expiresAt: 0 };
      },
      apply(tr, prev) {
        const meta = tr.getMeta(fadeKey) as Partial<FadeState> | undefined;
        let next = prev;
        if (meta !== undefined) {
          next = {
            range: meta.range !== undefined ? meta.range : prev.range,
            expiresAt: meta.expiresAt !== undefined ? meta.expiresAt : prev.expiresAt,
          };
        }
        if (tr.docChanged && next.range) {
          next = {
            ...next,
            range: {
              from: tr.mapping.map(next.range.from),
              to: tr.mapping.map(next.range.to),
            },
          };
        }
        return next;
      },
    },
    view(view) {
      let lastShow = false;
      let lastRange: FadeRange | null = null;
      let timer: ReturnType<typeof setTimeout> | null = null;
      return {
        update(currentView) {
          const snap = store.getSnapshot();
          const armFade = lastShow && !snap.show && lastRange;
          // Snapshot what we need, then update `lastShow`/`lastRange`
          // BEFORE dispatching the fade-arming tr. PM fires nested
          // view.update calls synchronously inside the inner dispatch,
          // and if we leave the watchers in their pre-update values, the
          // condition `lastShow && !snap.show` stays true and we re-arm
          // → unbounded recursion. Capturing first + advancing the
          // watchers breaks the loop on the first nested fire.
          const fadeRange = lastRange;
          lastShow = snap.show;
          lastRange = snap.range ? { from: snap.range.from, to: snap.range.to } : null;
          if (!armFade || !fadeRange) return;
          const doc = currentView.state.doc;
          const docSize = doc.content.size;
          const { from, to } = fadeRange;
          if (from < 0 || to > docSize || from >= to) return;
          // item-select paths delete the trigger range outright; if the
          // leading char is no longer the trigger char,
          // there's nothing to fade.
          const head = doc.textBetween(
            from,
            Math.min(from + cfg.char.length, docSize),
            " ",
            " ",
          );
          if (head !== cfg.char) return;
          currentView.dispatch(
            currentView.state.tr.setMeta(fadeKey, {
              range: { from, to },
              expiresAt: Date.now() + FADE_DURATION_MS,
            }),
          );
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => {
            timer = null;
            if (currentView.isDestroyed) return;
            currentView.dispatch(
              currentView.state.tr.setMeta(fadeKey, { range: null, expiresAt: 0 }),
            );
          }, FADE_DURATION_MS + 16);
        },
        destroy() {
          if (timer) {
            clearTimeout(timer);
            timer = null;
          }
        },
      };
    },
    props: {
      decorations(state) {
        const s = fadeKey.getState(state);
        if (!s || !s.range) return null;
        const docSize = state.doc.content.size;
        const from = Math.max(0, Math.min(s.range.from, docSize));
        const to = Math.max(from, Math.min(s.range.to, docSize));
        if (from === to) return null;
        return DecorationSet.create(state.doc, [
          Decoration.inline(from, to, {
            class: "rune-trigger rune-trigger--exiting",
            nodeName: "span",
          }),
        ]);
      },
    },
  });

  // Session-run mapper: keeps `store.sessionRun` in CURRENT doc
  // coordinates by mapping it through every doc-changing transaction.
  // Registered FIRST in the returned array — ProseMirror applies plugin
  // state fields in registration order, so this apply runs before
  // @tiptap/suggestion's apply for the same transaction, and the matcher
  // always reads an already-mapped run. Same per-transaction mapping
  // pattern as fadePlugin's state.apply above.
  const sessionRunMapper = new Plugin({
    key: new PluginKey(runePluginKeyName("suggestion-run", cfg.char)),
    state: {
      init: () => null,
      apply(tr) {
        const run = store.sessionRun.current;
        if (run && tr.docChanged) {
          // assoc 1 on both ends: content inserted at the anchor pushes the
          // run right (the `/` itself moves); content typed exactly at the
          // run's right edge JOINS the query — the Notion model: everything
          // typed after the `/` until dismissal is query text.
          const from = tr.mapping.map(run.from, 1);
          const to = tr.mapping.map(run.to, 1);
          // A collapsed run (the whole `/query` text deleted) is KEPT, not
          // nulled: the sticky branch must own the closing transaction
          // (`to <= from` → null → exit). Nulling here would hand this
          // same transaction to the matcher's fresh-anchor scan with the
          // typed-trigger gate still bypassed (`sessionAlive`) — an open
          // session would silently re-anchor onto an earlier dead `/` run
          // in the block (SM-1 violation). `onExit` does the actual clear.
          store.sessionRun.current = { from, to };
        }
        return null;
      },
    },
  });

  return [sessionRunMapper, Suggestion(options), suppressionGuard, fadePlugin];
}
