// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useLoadSuggestionMenuItems } from "./useLoadSuggestionMenuItems";

describe("useLoadSuggestionMenuItems", () => {
  it("emits loading-initial → loaded with the resolved items", async () => {
    const getItems = vi.fn(async (q: string) => [`${q}-a`, `${q}-b`]);
    const { result } = renderHook(
      ({ q }: { q: string }) => useLoadSuggestionMenuItems(q, getItems),
      { initialProps: { q: "foo" } },
    );
    expect(result.current.loadingState).toBe("loading-initial");
    await waitFor(() => expect(result.current.loadingState).toBe("loaded"));
    expect(result.current.items).toEqual(["foo-a", "foo-b"]);
    expect(result.current.usedQuery).toBe("foo");
  });

  it("discards stale results when query changes mid-flight", async () => {
    const pending: Array<() => void> = [];
    const getItems = (q: string) => new Promise<string[]>((r) => {
      pending.push(() => r([q]));
    });
    const { result, rerender } = renderHook(
      ({ q }: { q: string }) => useLoadSuggestionMenuItems(q, getItems),
      { initialProps: { q: "a" } },
    );
    rerender({ q: "b" });
    // Resolve "a" (stale) then "b" (current).
    pending[0]!(); pending[1]!();
    await waitFor(() => expect(result.current.loadingState).toBe("loaded"));
    expect(result.current.items).toEqual(["b"]);
    expect(result.current.usedQuery).toBe("b");
  });

  it("second-load enters 'loading' (not 'loading-initial')", async () => {
    const getItems = vi.fn(async (q: string) => [q]);
    const { result, rerender } = renderHook(
      ({ q }: { q: string }) => useLoadSuggestionMenuItems(q, getItems),
      { initialProps: { q: "a" } },
    );
    await waitFor(() => expect(result.current.loadingState).toBe("loaded"));
    rerender({ q: "b" });
    expect(result.current.loadingState).toBe("loading");
    await waitFor(() => expect(result.current.items).toEqual(["b"]));
  });

  it("settles out of 'loading' when getItems rejects (no unhandled rejection)", async () => {
    const getItems = vi.fn(async (_q: string) => {
      throw new Error("network error");
    });
    const { result } = renderHook(
      ({ q }: { q: string }) => useLoadSuggestionMenuItems(q, getItems),
      { initialProps: { q: "foo" } },
    );
    expect(result.current.loadingState).toBe("loading-initial");
    await waitFor(() => expect(result.current.loadingState).not.toBe("loading-initial"));
    expect(result.current.loadingState).toBe("loaded");
  });

  it("reloads when reloadKey changes even if the query is unchanged", async () => {
    const pending: Array<() => void> = [];
    const getItems = vi.fn(
      (q: string) =>
        new Promise<string[]>((resolve) => {
          const call = getItems.mock.calls.length;
          pending.push(() => resolve([`${q}-${call}`]));
        }),
    );
    const { result, rerender } = renderHook(
      ({ q, session }: { q: string; session: string }) =>
        useLoadSuggestionMenuItems(q, getItems, session),
      { initialProps: { q: "", session: "1:2" } },
    );

    pending[0]!();
    await waitFor(() => expect(result.current.items).toEqual(["-1"]));

    rerender({ q: "", session: "3:4" });
    expect(result.current.loadingState).toBe("loading");
    pending[1]!();

    await waitFor(() => expect(result.current.items).toEqual(["-2"]));
    expect(getItems).toHaveBeenCalledTimes(2);
    expect(result.current.usedQuery).toBe("");
  });
});
