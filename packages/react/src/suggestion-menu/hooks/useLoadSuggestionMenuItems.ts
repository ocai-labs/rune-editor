// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { useEffect, useRef, useState } from "react";

export type LoadingState = "loading-initial" | "loading" | "loaded";

export function useLoadSuggestionMenuItems<T>(
  query: string,
  getItems: (query: string) => Promise<T[]>,
  reloadKey?: unknown,
): { items: T[]; usedQuery: string | undefined; loadingState: LoadingState } {
  const [items, setItems] = useState<T[]>([]);
  const [usedQuery, setUsedQuery] = useState<string | undefined>(undefined);
  const [loadingState, setLoadingState] = useState<LoadingState>("loading-initial");
  const currentRequest = useRef(0);
  const hasLoaded = useRef(false);

  useEffect(() => {
    const requestId = currentRequest.current + 1;
    currentRequest.current = requestId;
    setLoadingState(hasLoaded.current ? "loading" : "loading-initial");

    getItems(query)
      .then((result) => {
        if (currentRequest.current !== requestId) return; // stale — drop
        setItems(result);
        setUsedQuery(query);
        hasLoaded.current = true;
        setLoadingState("loaded");
      })
      .catch(() => {
        if (currentRequest.current !== requestId) return; // stale — drop
        // A rejected load (e.g. host getItems network error) settles into
        // "loaded" with whatever items are already on screen rather than
        // spinning forever — mirrors RuneEmojiPicker's fall-back contract.
        hasLoaded.current = true;
        setLoadingState("loaded");
      });
    // Intentionally not cleaning up — stale-request guard in the .then
    // handles races; a manual AbortController would double-guard.
  }, [query, getItems, reloadKey]);

  return { items, usedQuery, loadingState };
}
