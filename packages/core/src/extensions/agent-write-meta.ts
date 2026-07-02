// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

/**
 * Transaction meta key tagged on every transaction an AI/agent tool dispatches
 * (the AI agent-tool layer's `runTool` wraps `execute` and stamps this on whatever the tool
 * dispatches: insert_blocks / update_block / turn_into / apply_edits, …).
 *
 * Unlike `INTERNAL_NORMALIZATION_META`, an agent write IS a real user-visible
 * edit — it persists, counts as "document modified", and is one undo step. The
 * one thing it is NOT is a USER INPUT EVENT: the user did not type these chars.
 *
 * Consumer contract — input-driven affordances that key off "the user just
 * typed the trigger char" must skip an agent write, the same way they skip a
 * paste. Today the only consumer is the suggestion-menu trigger gate
 * (`createTriggerPlugin`): without this, an agent that inserts block text
 * containing a `/` (and leaves the caret after it) trips `requireTypedTrigger`
 * — `transactionInsertedAt` can't tell a programmatic insert from a keystroke —
 * and the slash menu pops open in the document.
 *
 *     shouldShow: (props) => {
 *       if (props.transaction.getMeta(AGENT_WRITE_META)) return false // not a typed trigger
 *       …
 *     }
 *
 * Producers are AI agent tools only. User-driven commands (slash menu, keymaps,
 * direct `editor.commands.*` calls outside the agent loop) must NOT tag this —
 * those ARE user input and should drive suggestions normally.
 */
export const AGENT_WRITE_META = "rune/agent-write"
