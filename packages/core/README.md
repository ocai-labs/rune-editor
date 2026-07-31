# @ocai/rune-core

Headless Rune editor core — the Tiptap v3 schema, extensions, and block
factory that `@ocai/rune-react` is built on. **No React, no DOM, no CSS.**

Use this package when:

- You're building your own UI on top of Tiptap and want Rune's flat
  block schema + auxiliary extensions (drag, side menu, suggestion
  menus, clipboard, placeholder, block selection).
- You need editor logic in SSR / CLI / worker contexts where React or
  the DOM isn't available.

If you just want a working editor in a React app, install
[`@ocai/rune-react`](../react) instead — it depends on this package and
ships the default UI on top.

---

## Install

```bash
pnpm add @ocai/rune-core
```

---

## Quick start

```ts
import { Editor } from "@tiptap/core"
import { createRuneKit } from "@ocai/rune-core"

const editor = new Editor({
  element: document.querySelector("#editor")!,
  extensions: createRuneKit(),
  content: { type: "doc", content: [
    { type: "paragraph", content: [{ type: "text", text: "Hello." }] },
  ]},
})
```

`createRuneKit()` returns the Rune extension array — pass it directly
to Tiptap's `Editor` (or React's `useEditor`). Every option is optional:

```ts
createRuneKit({
  blockIdTypes: ["paragraph", "heading", "myCustomBlock"],
  suggestionMenus: false,                      // skip slash/emoji/wiki triggers
  placeholders: { default: "Type something…" },
})
```

The core kit includes headless math nodes: inline `$$x^2$$` input creates
an `inlineMath` atom, `/equation` inserts an `equationBlock`, and
clipboard text/HTML uses `$x^2$` / `$$x^2$$` LaTeX projections. KaTeX
rendering lives in `@ocai/rune-react`.

---

## Public API

Imports flow `@ocai/rune-react` → `@ocai/rune-core` → Tiptap. Anything in the
table below is a stable public export.

### Kit

| Export | What |
|---|---|
| `createRuneKit(options)` | Returns the default extension array. The entry point most consumers use. |
| `CreateRuneKitOptions`   | Type for the options object. |

### Block factory

| Export | What |
|---|---|
| `createBlockSpec(config)`        | Define a Tiptap node with Rune's flat-schema boilerplate (id, depth, group, defining) baked in. |
| `createBlockExtension(ext)`      | Compile per-block keyboard shortcuts + input rules into a Tiptap extension. |
| `BLOCK_ATTRIBUTES`               | `{ id: "data-id", depth: "data-depth" }` — the shared HTML-attribute map. |
| `BlockSpecConfig`, `BlockPropSchema`, `BlockPropSpec`, `DeclarativeBlockExtension`, `DeclarativeInputRule`, `ShortcutHandler` | Types for block authoring. |
| `forEachBlockSpec`, `getBlockSpecs`, `BlockSpecMetadata`, `BlockSideMenuSpec` | Introspection helpers for tooling that walks the schema. |

### Built-in blocks

| Export | What |
|---|---|
| `Paragraph`, `Heading`, `Divider`, `Equation` | Built-in block schema extensions. |
| `InlineMath` | Built-in inline math atom extension. |
| `RuneParagraphBlock`, `RuneHeadingBlock`, `RuneDividerBlock`, `RuneEquationBlock`, `RuneBlock`, `RuneBlockBase`, `HeadingLevel` | TS shapes for built-in blocks. |

### Extensions (registered by `createRuneKit` — re-exported for manual composition)

| Export | What |
|---|---|
| `BlockId`                                   | Auto-assigns stable `nanoid(8)` ids to every block. |
| `BlockDrag`, `blockDragKey`, `BlockDragState`, `BlockGeom`, `BlocksSnapshot`, `DropTarget` | Block-level drag-and-drop with PM widget decorations. |
| `BlockSelection`, `blockSelectionKey`, `MultiBlockSelection` | Per-block and multi-block selection (incl. marquee). |
| `SideMenu`, `sideMenuKey`, `SideMenuState`, `SideMenuStorage`, `SideMenuHoveredBlock`, `addBlockBelowAndOpenSlash`, `isDraggable` | Gutter / side-menu state + helpers. |
| `Clipboard`, `clipboardPluginKey`, `collectKnownBlockTags`, `serializeBlocksForClipboard` | Clipboard pipeline and explicit-slice serialization. |
| `CaretComfort`, `caretComfortKey`           | Caret behavior tweaks across atom blocks / dividers. |
| `Placeholder`, `placeholderPluginKey`, `PlaceholderConfig`, `PlaceholderHit`, `PlaceholderPluginState`, `PlaceholderResolver`, `PlaceholderOptions` | Placeholder text on empty blocks. |
| `SuggestionMenus`, `getSuggestionMenus`, `commitSuggestion`, `insertOrUpdateBlockForSlashMenu`, `wikiLinkMatcher`, `filterSuggestionItems`, `getDefaultSlashMenuItems`, `TriggerConfig`, `TriggerState`, `TriggerStore`, `TriggerKeyHandler`, `SuggestionMenusOptions`, `SuggestionMenusStorage`, `DefaultSuggestionItem`, `DefaultGridSuggestionItem`, `SuggestionCommitContext` | Multi-trigger suggestion menus on top of `@tiptap/suggestion`. |
| `GestureStatePlugin`, `gestureKey`, `ActiveGesture`, `GestureState` | Cross-extension pointer-gesture state. |

### Color tokens

| Export | What |
|---|---|
| `COLORS`, `COLOR_NAMES`, `ColorName`, `NamedColorEntry` | The Notion-style 9-color palette + name list. UI consumers iterate `COLOR_NAMES` to render swatches. |

Rune color commands apply to inline text and highlights only. Blocks and table
cells do not expose block-level color attributes.

---

## Architectural invariants (do not violate)

`@ocai/rune-core` is shaped by a few non-negotiable decisions. Read
the architecture notes before structural work; the short version:

1. **Flat PM schema** — blocks are top-level siblings; hierarchy is a
   `depth` attribute, not nested nodes. No `blockContainer` / `blockGroup`
   wrappers.
2. **No Editor wrapper class** — consumers get Tiptap's native `Editor`.
   Block-level operations are Tiptap commands or pure exported
   functions, never methods on a class that wraps `editor`.
3. **Schema via `createBlockSpec`** — block files never call
   `Node.create` directly. The factory owns shared id/depth attrs and
   their HTML marshalling.
4. **`BlockId` is runtime-only** — fills values via `appendTransaction`,
   does not define the `id` attribute (the factory does).
5. **PM-rendered DOM uses plain CSS** — no Tailwind classes in
   `renderDOM` output. Tailwind belongs in `@ocai/rune-react` chrome only.

---

## See also

- [`packages/react`](../react) — default React UI built on this package.
