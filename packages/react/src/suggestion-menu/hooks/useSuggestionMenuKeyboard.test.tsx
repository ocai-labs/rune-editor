// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// packages/react/src/suggestion-menu/hooks/useSuggestionMenuKeyboard.test.tsx
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Text from "@tiptap/extension-text";
import Paragraph from "@tiptap/extension-paragraph";
import { SuggestionMenus, getSuggestionMenus } from "@ocai/rune-core";
import {
  handleSuggestionNavKey,
  useSuggestionMenuKeyboard,
} from "./useSuggestionMenuKeyboard";

function mkEditor() {
  return new Editor({
    element: document.createElement("div"),
    extensions: [
      Document, Paragraph, Text,
      SuggestionMenus.configure({ triggers: [{ char: "/" }] }),
    ],
  });
}

function pressKey(handler: (e: KeyboardEvent) => boolean, key: string): boolean {
  return handler(new KeyboardEvent("keydown", { key }));
}

describe("useSuggestionMenuKeyboard", () => {
  it("registers a handler on mount and clears it on unmount", () => {
    const editor = mkEditor();
    const items = [{ a: 1 }, { a: 2 }];
    const setSelectedIndex = vi.fn();
    const commit = vi.fn();
    const close = vi.fn();

    const { unmount } = renderHook(() =>
      useSuggestionMenuKeyboard(editor, "/", {
        items, selectedIndex: 0, setSelectedIndex, commit, close,
      }),
    );
    const slot = getSuggestionMenus(editor).triggers["/"]!.keyHandler;
    expect(slot.current).not.toBeNull();
    unmount();
    expect(slot.current).toBeNull();
    editor.destroy();
  });

  it("ArrowDown wraps and calls setSelectedIndex; returns true", () => {
    const editor = mkEditor();
    const setSelectedIndex = vi.fn();
    renderHook(() =>
      useSuggestionMenuKeyboard(editor, "/", {
        items: [1, 2, 3], selectedIndex: 2, setSelectedIndex, commit: vi.fn(), close: vi.fn(),
      }),
    );
    const handler = getSuggestionMenus(editor).triggers["/"]!.keyHandler.current!;
    expect(pressKey(handler, "ArrowDown")).toBe(true);
    expect(setSelectedIndex).toHaveBeenCalledWith(0);
    editor.destroy();
  });

  it("Enter calls commit with the current item and returns true", () => {
    const editor = mkEditor();
    const commit = vi.fn();
    renderHook(() =>
      useSuggestionMenuKeyboard(editor, "/", {
        items: ["a", "b"], selectedIndex: 1, setSelectedIndex: vi.fn(), commit, close: vi.fn(),
      }),
    );
    const handler = getSuggestionMenus(editor).triggers["/"]!.keyHandler.current!;
    expect(pressKey(handler, "Enter")).toBe(true);
    expect(commit).toHaveBeenCalledWith("b");
    editor.destroy();
  });

  it("Escape calls close and returns true", () => {
    const editor = mkEditor();
    const close = vi.fn();
    renderHook(() =>
      useSuggestionMenuKeyboard(editor, "/", {
        items: ["a"], selectedIndex: 0, setSelectedIndex: vi.fn(), commit: vi.fn(), close,
      }),
    );
    const handler = getSuggestionMenus(editor).triggers["/"]!.keyHandler.current!;
    expect(pressKey(handler, "Escape")).toBe(true);
    expect(close).toHaveBeenCalled();
    editor.destroy();
  });

  it("returns false for unrelated keys", () => {
    const editor = mkEditor();
    renderHook(() =>
      useSuggestionMenuKeyboard(editor, "/", {
        items: ["a"], selectedIndex: 0,
        setSelectedIndex: vi.fn(), commit: vi.fn(), close: vi.fn(),
      }),
    );
    const handler = getSuggestionMenus(editor).triggers["/"]!.keyHandler.current!;
    expect(pressKey(handler, "a")).toBe(false);
    editor.destroy();
  });

  it("passes through modified chords (Cmd/Ctrl/Alt + key) so PM host keybindings fire", () => {
    const editor = mkEditor();
    const setSelectedIndex = vi.fn();
    const commit = vi.fn();
    renderHook(() =>
      useSuggestionMenuKeyboard(editor, "/", {
        items: ["a", "b"], selectedIndex: 0, setSelectedIndex, commit, close: vi.fn(),
      }),
    );
    const handler = getSuggestionMenus(editor).triggers["/"]!.keyHandler.current!;

    expect(handler(new KeyboardEvent("keydown", { key: "Enter", metaKey: true }))).toBe(false);
    expect(handler(new KeyboardEvent("keydown", { key: "ArrowDown", ctrlKey: true }))).toBe(false);
    expect(handler(new KeyboardEvent("keydown", { key: "Tab", altKey: true }))).toBe(false);
    expect(commit).not.toHaveBeenCalled();
    expect(setSelectedIndex).not.toHaveBeenCalled();

    // Shift alone is NOT a modifier — plain Enter still commits.
    expect(handler(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true }))).toBe(true);
    expect(commit).toHaveBeenCalledWith("a");
    editor.destroy();
  });

  it("does not commit Enter while an IME composition is active", () => {
    const commit = vi.fn();
    const consumed = handleSuggestionNavKey(
      new KeyboardEvent("keydown", { key: "Enter", isComposing: true }),
      {
        items: ["a"],
        selectedIndex: 0,
        setSelectedIndex: vi.fn(),
        commit,
        close: vi.fn(),
      },
    );

    expect(consumed).toBe(false);
    expect(commit).not.toHaveBeenCalled();
  });

  it("supports paging and edge navigation keys", () => {
    const setSelectedIndex = vi.fn();
    const binding = {
      items: ["a", "b", "c"],
      selectedIndex: 1,
      setSelectedIndex,
      commit: vi.fn(),
      close: vi.fn(),
    };

    expect(handleSuggestionNavKey(new KeyboardEvent("keydown", { key: "PageUp" }), binding)).toBe(true);
    expect(handleSuggestionNavKey(new KeyboardEvent("keydown", { key: "Home" }), binding)).toBe(true);
    expect(handleSuggestionNavKey(new KeyboardEvent("keydown", { key: "PageDown" }), binding)).toBe(true);
    expect(handleSuggestionNavKey(new KeyboardEvent("keydown", { key: "End" }), binding)).toBe(true);
    expect(setSelectedIndex).toHaveBeenNthCalledWith(1, 0);
    expect(setSelectedIndex).toHaveBeenNthCalledWith(2, 0);
    expect(setSelectedIndex).toHaveBeenNthCalledWith(3, 2);
    expect(setSelectedIndex).toHaveBeenNthCalledWith(4, 2);
  });
});
