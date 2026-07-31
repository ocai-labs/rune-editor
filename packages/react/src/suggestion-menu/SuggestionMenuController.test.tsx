// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// packages/react/src/suggestion-menu/SuggestionMenuController.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, act, waitFor, fireEvent } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Text from "@tiptap/extension-text";
import Paragraph from "@tiptap/extension-paragraph";
import {
  Heading,
  Paragraph as RuneParagraph,
  SuggestionMenus,
  getSuggestionMenus,
  recordSuggestionUse,
} from "@ocai/rune-core";
import { ComponentsContext, defaultComponents } from "./ComponentsContext";
import {
  SuggestionMenuController,
  sourceBlockAtPos,
} from "./SuggestionMenuController";

function mkEditor() {
  return new Editor({
    element: document.createElement("div"),
    extensions: [
      Document, Paragraph, Text,
      SuggestionMenus.configure({ triggers: [{ char: "/" }] }),
    ],
  });
}

function mkRuneEditor() {
  return new Editor({
    element: document.createElement("div"),
    extensions: [
      Document, RuneParagraph, Heading, Text,
      SuggestionMenus.configure({ triggers: [{ char: "/" }] }),
    ],
    content: "<p></p>",
  });
}

describe("sourceBlockAtPos", () => {
  it("resolves a root caret to its top-level block", () => {
    const editor = mkRuneEditor();
    const expectedId = editor.state.doc.firstChild?.attrs.id;
    const block = sourceBlockAtPos(editor, 1);
    expect(block?.type.name).toBe("paragraph");
    expect(block?.attrs.id).toBe(expectedId);
    editor.destroy();
  });
});

describe("SuggestionMenuController", () => {
  it("returns null when editor is null", () => {
    const { container } = render(
      <ComponentsContext.Provider value={defaultComponents}>
        <SuggestionMenuController editor={null} triggerCharacter="/" />
      </ComponentsContext.Provider>,
    );
    expect(container.textContent).toBe("");
  });

  it("renders items when the trigger opens", async () => {
    const editor = mkEditor();
    const items = [
      { key: "alpha", title: "Alpha", onItemClick: () => {} },
      { key: "beta", title: "Beta", onItemClick: () => {} },
    ];

    render(
      <ComponentsContext.Provider value={defaultComponents}>
        <SuggestionMenuController
          editor={editor}
          triggerCharacter="/"
          getItems={async () => items}
        />
      </ComponentsContext.Provider>,
    );

    act(() => {
      getSuggestionMenus(editor).triggers["/"]!._setState({
        show: true, query: "", range: { from: 1, to: 2 },
        getClientRect: () => new DOMRect(0, 0, 0, 16),
      });
    });

    expect(await screen.findByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    editor.destroy();
  });

  it("connects the editor root to the listbox with ARIA while open", async () => {
    const editor = mkEditor();
    const items = [
      { key: "alpha", title: "Alpha", onItemClick: () => {} },
      { key: "beta", title: "Beta", onItemClick: () => {} },
    ];

    render(
      <ComponentsContext.Provider value={defaultComponents}>
        <SuggestionMenuController
          editor={editor}
          triggerCharacter="/"
          getItems={async () => items}
        />
      </ComponentsContext.Provider>,
    );

    const slot = getSuggestionMenus(editor).triggers["/"]!;
    act(() => {
      slot._setState({
        show: true, query: "", range: { from: 1, to: 2 },
        getClientRect: () => new DOMRect(0, 0, 0, 16),
      });
    });

    await screen.findByText("Alpha");
    const controls = editor.view.dom.getAttribute("aria-controls");
    expect(editor.view.dom).toHaveAttribute("aria-expanded", "true");
    expect(editor.view.dom).toHaveAttribute("aria-haspopup", "listbox");
    expect(controls).toBeTruthy();
    expect(screen.getByRole("listbox")).toHaveAttribute("id", controls);
    expect(editor.view.dom.getAttribute("aria-activedescendant")).toBe(
      `${controls}-item-0`,
    );

    act(() => {
      slot.keyHandler.current!({
        key: "ArrowDown",
      } as unknown as KeyboardEvent);
    });
    await waitFor(() =>
      expect(editor.view.dom.getAttribute("aria-activedescendant")).toBe(
        `${controls}-item-1`,
      ),
    );

    act(() => {
      slot._setState({
        show: false, query: "", range: null, getClientRect: null,
      });
    });

    await waitFor(() => {
      expect(editor.view.dom).toHaveAttribute("aria-expanded", "false");
      expect(editor.view.dom).not.toHaveAttribute("aria-controls");
      expect(editor.view.dom).not.toHaveAttribute("aria-activedescendant");
      expect(editor.view.dom).not.toHaveAttribute("aria-haspopup");
    });

    editor.destroy();
  });

  it("does not let an inactive controller clear the active controller ARIA", async () => {
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: [
        Document, Paragraph, Text,
        SuggestionMenus.configure({ triggers: [{ char: "/" }, { char: "[[" }] }),
      ],
    });

    render(
      <ComponentsContext.Provider value={defaultComponents}>
        <SuggestionMenuController
          editor={editor}
          triggerCharacter="/"
          getItems={async () => [
            { key: "alpha", title: "Alpha", onItemClick: () => {} },
          ]}
        />
        <SuggestionMenuController
          editor={editor}
          triggerCharacter="[["
          getItems={async () => [
            { key: "home", title: "Home", onItemClick: () => {} },
          ]}
        />
      </ComponentsContext.Provider>,
    );

    act(() => {
      getSuggestionMenus(editor).triggers["/"]!._setState({
        show: true, query: "", range: { from: 1, to: 2 },
        getClientRect: () => new DOMRect(0, 0, 0, 16),
      });
    });

    await screen.findByText("Alpha");
    const controls = editor.view.dom.getAttribute("aria-controls");
    expect(controls).toBeTruthy();
    expect(editor.view.dom).toHaveAttribute("aria-expanded", "true");

    act(() => {
      getSuggestionMenus(editor).triggers["[["]!._setState({
        show: false, query: "", range: null, getClientRect: null,
      });
    });

    await waitFor(() => {
      expect(editor.view.dom).toHaveAttribute("aria-expanded", "true");
      expect(editor.view.dom).toHaveAttribute("aria-controls", controls);
    });

    editor.destroy();
  });

  it("uses the visual group order for selection, ARIA, and Enter commit", async () => {
    const editor = mkEditor();
    const onItemClick = vi.fn();

    render(
      <ComponentsContext.Provider value={defaultComponents}>
        <SuggestionMenuController
          editor={editor}
          triggerCharacter="/"
          getItems={async () => [
            { key: "image", title: "Image", group: "Media" },
            { key: "paragraph", title: "Paragraph", group: "Basic blocks" },
          ]}
          onItemClick={onItemClick}
        />
      </ComponentsContext.Provider>,
    );

    const slot = getSuggestionMenus(editor).triggers["/"]!;
    act(() => {
      slot._setState({
        show: true, query: "", range: { from: 1, to: 2 },
        getClientRect: () => new DOMRect(0, 0, 0, 16),
      });
    });

    await screen.findByText("Paragraph");
    const options = screen.getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "Paragraph",
      "Image",
    ]);
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(editor.view.dom.getAttribute("aria-activedescendant")).toBe(
      options[0]!.id,
    );

    act(() => {
      slot.keyHandler.current!({
        key: "Enter",
        preventDefault: () => {},
      } as unknown as KeyboardEvent);
    });

    expect(onItemClick).toHaveBeenCalledWith(
      expect.objectContaining({ key: "paragraph" }),
    );

    editor.destroy();
  });

  it("keeps the aria-controls listbox mounted during loading and empty states", async () => {
    const editor = mkEditor();
    let resolveItems!: (items: never[]) => void;
    const getItems = vi.fn(
      () =>
        new Promise<never[]>((resolve) => {
          resolveItems = resolve;
        }),
    );

    render(
      <ComponentsContext.Provider value={defaultComponents}>
        <SuggestionMenuController
          editor={editor}
          triggerCharacter="/"
          getItems={getItems}
        />
      </ComponentsContext.Provider>,
    );

    const slot = getSuggestionMenus(editor).triggers["/"]!;
    act(() => {
      slot._setState({
        show: true, query: "", range: { from: 1, to: 2 },
        getClientRect: () => new DOMRect(0, 0, 0, 16),
      });
    });

    await waitFor(() => {
      const controls = editor.view.dom.getAttribute("aria-controls");
      expect(controls).toBeTruthy();
      expect(document.getElementById(controls!)).toHaveAttribute(
        "role",
        "listbox",
      );
    });
    expect(screen.getByText("Loading…")).toBeInTheDocument();

    await act(async () => {
      resolveItems([]);
    });

    await waitFor(() => expect(screen.queryByText("Loading…")).toBeNull());
    expect(screen.queryByText("No results")).toBeNull();
    expect(screen.getByRole("button", { name: /Close menu/i })).toBeInTheDocument();
    const controls = editor.view.dom.getAttribute("aria-controls");
    expect(controls).toBeTruthy();
    expect(document.getElementById(controls!)).toHaveAttribute("role", "listbox");

    editor.destroy();
  });

  it("Escape dismisses the menu without deleting typed slash text", async () => {
    const editor = mkEditor();

    render(
      <ComponentsContext.Provider value={defaultComponents}>
        <SuggestionMenuController
          editor={editor}
          triggerCharacter="/"
          getItems={async () => [
            { key: "alpha", title: "Alpha", onItemClick: () => {} },
          ]}
        />
      </ComponentsContext.Provider>,
    );

    const slot = getSuggestionMenus(editor).triggers["/"]!;
    act(() => {
      editor.commands.setContent("<p>/to</p>");
      slot._setState({
        show: true,
        query: "to",
        range: { from: 1, to: 4 },
        getClientRect: () => new DOMRect(0, 0, 0, 16),
      });
    });

    await screen.findByText("Alpha");
    expect(editor.state.doc.textContent).toBe("/to");

    act(() => {
      slot.keyHandler.current!({
        key: "Escape",
        preventDefault: vi.fn(),
      } as unknown as KeyboardEvent);
    });

    expect(editor.state.doc.textContent).toBe("/to");
    await waitFor(() => expect(slot.getSnapshot().show).toBe(false));
    expect(slot.suppressedAt.current).toBe(1);

    editor.destroy();
  });

  it("the Close menu footer dismisses without deleting typed slash text", async () => {
    const editor = mkEditor();

    render(
      <ComponentsContext.Provider value={defaultComponents}>
        <SuggestionMenuController
          editor={editor}
          triggerCharacter="/"
          getItems={async () => []}
        />
      </ComponentsContext.Provider>,
    );

    const slot = getSuggestionMenus(editor).triggers["/"]!;
    act(() => {
      editor.commands.setContent("<p>/missing</p>");
      slot._setState({
        show: true,
        query: "missing",
        range: { from: 1, to: 9 },
        getClientRect: () => new DOMRect(0, 0, 0, 16),
      });
    });

    await screen.findByRole("button", { name: /Close menu/i });
    expect(editor.state.doc.textContent).toBe("/missing");

    fireEvent.mouseDown(screen.getByRole("button", { name: /Close menu/i }));

    expect(editor.state.doc.textContent).toBe("/missing");
    await waitFor(() => expect(slot.getSnapshot().show).toBe(false));
    expect(slot.suppressedAt.current).toBe(1);

    editor.destroy();
  });

  it("reloads empty-query items on a new session so recents appear after a commit", async () => {
    const editor = mkRuneEditor();

    render(
      <ComponentsContext.Provider value={defaultComponents}>
        <SuggestionMenuController editor={editor} triggerCharacter="/" />
      </ComponentsContext.Provider>,
    );

    const slot = getSuggestionMenus(editor).triggers["/"]!;
    const open = (from: number) =>
      act(() => {
        slot._setState({
          show: true,
          query: "",
          range: { from, to: from + 1 },
          getClientRect: () => new DOMRect(0, 0, 0, 16),
        });
      });

    open(1);
    await screen.findByText("Heading 1");
    expect(screen.queryByText("Recently used")).toBeNull();

    recordSuggestionUse(editor, "/", "heading_1", 1000);
    act(() => {
      slot._setState({
        show: false, query: "", range: null, getClientRect: null,
      });
    });

    open(2);
    await screen.findByText("Recently used");
    expect(
      screen
        .getAllByRole("option")
        .filter((option) => option.textContent?.includes("Heading 1")),
    ).toHaveLength(1);

    editor.destroy();
  });

  it("resets selectedIndex when the menu re-opens with the same empty query", async () => {
    const editor = mkEditor();
    const items = [
      { key: "alpha", title: "Alpha", onItemClick: () => {} },
      { key: "beta", title: "Beta", onItemClick: () => {} },
      { key: "gamma", title: "Gamma", onItemClick: () => {} },
    ];

    render(
      <ComponentsContext.Provider value={defaultComponents}>
        <SuggestionMenuController
          editor={editor}
          triggerCharacter="/"
          getItems={async () => items}
        />
      </ComponentsContext.Provider>,
    );

    const slot = getSuggestionMenus(editor).triggers["/"]!;
    const openRect = () => new DOMRect(0, 0, 0, 16);

    // First open
    act(() => {
      slot._setState({
        show: true, query: "", range: { from: 1, to: 2 },
        getClientRect: openRect,
      });
    });
    await screen.findByText("Alpha");

    const row = (title: string) =>
      screen.getByText(title).closest('[role="option"]')!;

    expect(row("Alpha")).toHaveAttribute("aria-selected", "true");

    // ArrowDown → Beta highlighted (index 0 → 1)
    act(() => {
      slot.keyHandler.current!({
        key: "ArrowDown",
      } as unknown as KeyboardEvent);
    });
    expect(row("Beta")).toHaveAttribute("aria-selected", "true");
    expect(row("Alpha")).not.toHaveAttribute("aria-selected");

    // Close (simulates @tiptap/suggestion's onExit after commit)
    act(() => {
      slot._setState({
        show: false, query: "", range: null, getClientRect: null,
      });
    });

    // Re-open with the same empty query — regression guard: previously
    // useEffect depended only on state.query, so the index from the
    // previous session (Beta) stuck when query was "" both times.
    act(() => {
      slot._setState({
        show: true, query: "", range: { from: 3, to: 4 },
        getClientRect: openRect,
      });
    });

    expect(row("Alpha")).toHaveAttribute("aria-selected", "true");
    expect(row("Beta")).not.toHaveAttribute("aria-selected");

    editor.destroy();
  });

  it("does not scroll the menu on mouse hover, but still reveals keyboard navigation", async () => {
    const scrollIntoView = vi.fn();
    const original = HTMLElement.prototype.scrollIntoView;
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });

    const editor = mkEditor();
    const items = [
      { key: "alpha", title: "Alpha", onItemClick: () => {} },
      { key: "beta", title: "Beta", onItemClick: () => {} },
      { key: "gamma", title: "Gamma", onItemClick: () => {} },
    ];

    try {
      render(
        <ComponentsContext.Provider value={defaultComponents}>
          <SuggestionMenuController
            editor={editor}
            triggerCharacter="/"
            getItems={async () => items}
          />
        </ComponentsContext.Provider>,
      );

      const slot = getSuggestionMenus(editor).triggers["/"]!;
      act(() => {
        slot._setState({
          show: true,
          query: "",
          range: { from: 1, to: 2 },
          getClientRect: () => new DOMRect(0, 0, 0, 16),
        });
      });
      await screen.findByText("Alpha");
      scrollIntoView.mockClear();

      const row = (title: string) =>
        screen.getByText(title).closest('[role="option"]')!;

      fireEvent.mouseEnter(row("Beta"));
      await waitFor(() => expect(row("Beta")).toHaveAttribute("aria-selected", "true"));
      expect(scrollIntoView).not.toHaveBeenCalled();

      act(() => {
        slot.keyHandler.current!({
          key: "ArrowDown",
        } as unknown as KeyboardEvent);
      });
      await waitFor(() => expect(row("Gamma")).toHaveAttribute("aria-selected", "true"));
      expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    } finally {
      editor.destroy();
      if (original) {
        Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
          configurable: true,
          value: original,
        });
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
      }
    }
  });
});
