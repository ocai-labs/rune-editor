# @ocai/rune-react

## 0.18.0

### Minor Changes

- 2ad0807: The inline `:` emoji picker is now a keyboard-navigable grid. Typing `:` followed by a query renders a 9-column glyph grid you can move through with ←→↑↓ and select with Enter, with the matched emoji's name shown below the grid. Search runs off a self-owned `emojiSearch` index (replacing frimousse for the inline picker), and the grid scrolls with a native styled scrollbar (draggable, `scrollbar-gutter: stable`) instead of a custom JS overlay.

  No public API change — the `RuneEmojiPicker` preset used for the callout/title grid pickers is unchanged.

### Patch Changes

- 9e94ad8: Lazy-load KaTeX so it no longer ships in consumers' initial bundle. The math NodeViews now load KaTeX (~77 KB gzip) via dynamic import on first math-node mount, showing the raw LaTeX as a brief placeholder until the chunk resolves. Documents without equations never download KaTeX, and bundlers split it into its own async chunk — measured at **−77 KB gzip (−15%)** off the playground's initial JS.

  No public API change. KaTeX rendering becomes asynchronous on first use only (cached thereafter); the rendered output is unchanged.

- d0c5416: Remove dead code and an unused dependency. Dropped the unused `@tiptap/extension-horizontal-rule` dependency from both packages (the divider is a custom `Divider` block — StarterKit's built-in horizontal rule stays disabled), trimming the install footprint. Also pruned internal dead code surfaced by `tsc --noUnusedLocals`: unused imports, a dead constant, a never-read NodeView field, and dead test helpers. No public API or runtime behavior change.
- bcab9c2: Floating TOC hover-card rows no longer let long heading labels spill past the row edge. The label is now clipped with a gentle right-edge fade mask (matching the sidebar row-label treatment) instead of `truncate` — which never worked here because the row `Button` is `inline-flex`, so `text-overflow: ellipsis` had no inline box to act on. Short labels are unaffected; the current/hover row keeps a crisp background fill.
- Updated dependencies [d0c5416]
- Updated dependencies [d0c5416]
  - @ocai/rune-core@0.18.0

## 0.17.0

### Patch Changes

- Updated dependencies [1c8dcb5]
- Updated dependencies [e951aff]
  - @ocai/rune-core@0.17.0

## 0.16.0

### Minor Changes

- 58484f1: Add an opt-in in-document page title (`TitleKit`).

  The page title can now live as a real block inside rune's single ProseMirror
  document instead of a separate host-managed `<h1>`, so title↔body caret flow
  (Enter, Backspace/merge-up, arrow/select-all) feels seamless like Notion. It is
  opt-in: `createRuneKit({ plugins: [TitleKit] })`. The title is kept
  first/singleton/non-deletable by self-healing normalization (no hard
  doc-schema change), excluded from the slash menu, side-menu drag, and block
  selection, and rune-react ships its default styling + "New page" placeholder.

  The title is plain text (node spec `marks: ""`): no bold/italic/color/link can
  be applied or pasted into it, and rune-react's InlineToolbar stays closed over a
  selection wholly inside it — matching Notion, where the page title takes no
  inline formatting.

  The title is `agentHidden`: rune-ai never hands the model the title id and
  refuses every tool that would target it — across the read tools
  (`list_blocks` / `get_editor_context` outline + schema + selection,
  `get_selection`), the id-based write tools, and `replace_selection` (which
  operates on the live selection). The model can still READ the title text; it
  just has no way to mutate it.

### Patch Changes

- 2eb60dd: Tighten the divider and heading vertical rhythm to Notion's authored values.

  The divider row now reserves ~13px of height (a 1px rule centered in 6px of
  breathing room top and bottom) instead of the universal 3/3 block rhythm, and
  its line drops from 12% to 9% of the editor foreground to match Notion's border
  token (`--ca-borPriTra`, ≈ rgba(55,53,47,.09)). Headings gain 2px of bottom
  padding (6px → 8px) so the bottom now folds in Notion's 2px leaf padding
  symmetrically with the per-level top totals.

- Updated dependencies [58484f1]
- Updated dependencies [2eb60dd]
  - @ocai/rune-core@0.16.0

## 0.15.1

### Patch Changes

- e2ec867: fix(task-list): match the to-do checkbox to Notion (accent fill + 16px box)

  - Checked state now paints a solid `--editor-accent` fill with a white check, replacing the transparent box + currentColor glyph.
  - Box is a true 16px `border-box` square with a 1.5px border and 1.5px radius (was `1em` + 1px + 0.2em radius); empty-box border reads from a new `--rune-checkbox-border` token (a mid-gray off the editor fg) instead of `currentColor`.
  - Vertical alignment switches to `flex-start` + a line-height-derived `margin-top`, dropping the font-tuned `::after` baseline-ghost hack so the square centers on the first text line without per-font tuning.
  - @ocai/rune-core@0.15.1

## 0.15.0

### Minor Changes

- daab3c8: feat(callout): add Notion-parity callout block with an emoji-picker UI

  - New `callout` built-in block — a rounded, tinted box with a leading emoji and inline text — pixel-matched to Notion Cloud (DevTools-measured): box `border-radius: 10px`, `1px` transparent border, `12px` padding, `8px` outer rhythm, `24px` icon / `21.6px` emoji, and the 66px single-line height (Notion's nested text-block inset reproduced via `--rune-callout-content-pad-y`). The colored box is `.rune-block-content`, so it rides the existing background-color palette for every Notion color and flips light/dark automatically; the default (no color) is gray.
  - Click the emoji to change it: a searchable picker (reusing the existing `frimousse` `EmojiPicker`) opens anchored to the icon. Selection writes the `icon` attribute via `setNodeAttribute` (content-safe — the text is never rebuilt). Adds the core `CalloutEmojiPopover` plugin with `openCalloutEmojiPopover` / `closeCalloutEmojiPopover` / `setCalloutIcon` commands and `getCalloutEmojiPopoverBlockId`, plus the React `CalloutEmojiPicker` mounted in `RuneEditor`.
  - Exposes `Callout` and `RuneCalloutBlock` from `@ocai/rune-core` (previously the block was only registered via the kit and wasn't importable).

- cdc05e4: feat(callout): forward `emojibaseUrl` from `RuneEditor` to the built-in callout emoji picker

  The callout icon picker (`CalloutEmojiPicker`) is mounted internally by `RuneEditor`, so a host had no way to point it at a self-hosted Emojibase copy. Add an `emojibaseUrl` prop on `RuneEditor` that threads through to the picker — set it when the default jsdelivr CDN is unreachable (e.g. an Electron renderer with a strict `connect-src 'self'` CSP). Mirrors the existing `EmojiPickerProps.emojibaseUrl`.

- 3909138: feat(layout): expose `--rune-block-inset` so hosts can align their own chrome to body text

  A top-level block's content starts at 8px from the `.rune-editor` edge (the block's `padding-inline` plus `--block-content-pad-x`), matching Notion. Until now the `padding-inline` half of that was a hardcoded `6px` literal, so a host couldn't track the full inset — e.g. a page-title row above the editor had to guess at `8px` and would silently drift if rune ever retuned the value.

  Add a public `--rune-block-inset` token (default `8px`) and make the block `padding-inline` derive from it (`calc(var(--rune-block-inset) - var(--block-content-pad-x))`), so it's the single source of truth. The token lives on `:root` (like `--editor-accent`) so a host's title row — which per the doc-level title contract renders as a sibling of the editor, outside `.rune-editor` — can read it: `padding-inline: var(--rune-block-inset)`. Computed values are unchanged for existing consumers.

### Patch Changes

- ddf00e3: fix(typography): match Notion's heading + paragraph vertical rhythm

  - Heading top padding is now graduated per level (UI H1/H2/H3/H4 → `32 / 28 / 24 / 20px` via `--block-pad-top`) instead of a flat 18px, so larger headings get more air above them and read as section breaks — Notion's measured per-level totals (its outer-wrapper `padding-top` + the 2px leaf inset it stacks on every block).
  - UI H1 (`<h2>`) drops from `font-weight: 700` to `600`; every in-content heading level now shares weight 600 + `line-height: 1.3`, matching Notion (only the 40px page title stays 700, and that's host chrome, not an editor heading).
  - UI H4 (`<h5>`) gets its OWN step (`1.125em` / `20px` top) instead of cloning H3 — Notion renders a distinct Heading 4.
  - Paragraphs (and the list / toggle blocks that share the `<p>`-content selector) gain `line-height: 1.5`, Notion's body-text value.

- 751c431: fix(toggle): center caret + title in the block and align the toggle with body text (Notion pixel parity)

  - Symmetric 6px top/bottom padding (was 1px/6px) so the caret + title row is vertically centered in the block (center 20px == block center) instead of sitting 2.5px high.
  - Side-menu grip tracks that center via `--rune-side-menu-top` so grip == caret == title.
  - Base block `padding-inline` is 6px (was 2px), landing every top-level block's content-left at 8px — the toggle caret now sits flush with body text, matching how Notion aligns them.

- Updated dependencies [daab3c8]
  - @ocai/rune-core@0.15.0

## 0.14.1

### Patch Changes

- 9d2d6bf: The inline toolbar's link insert/edit panel is no longer clipped by the
  toolbar's fixed-width `overflow-hidden` box. It now opens as a body-portaled
  dropdown below the toolbar (the same construction as the color palette),
  replacing the `absolute top-full` child that was sliced both horizontally
  (a `w-80` form inside the `w-48` toolbar) and vertically. `LinkMenu` /
  `LinkEditForm` became pure content with the chrome supplied by the wrapper, so
  the link hover card's edit mode (which shares `LinkEditForm`) now renders
  in-flow inside the card instead of as a detached floating box.
- a2e00a9: Pasting a single paragraph copied from Notion no longer fragments into multiple
  blocks. Notion serialises a paragraph as a flat run of top-level text nodes
  interleaved with inline elements (a `<span>` for colored text, a
  `<div style="display:inline">` for inline code) with no wrapping `<p>`. The
  paste preprocessor degraded those inline elements to block `<p>`s, which split
  the surrounding text into a paragraph each (one paragraph → N blocks).

  `transformPastedHTML` now leaves inline-level top-level elements in place
  (genuine inline tags are kept as-is; a block tag forced inline via
  `display:inline` is unwrapped to its children), so PM folds the whole inline run
  into one paragraph. Notion's inline-code container is additionally rewritten to
  a real `<code>` element, so it stays inline AND is matched by the code mark
  (previously it pasted as plain text).

- d796da7: The editor now matches Notion's measured typography baseline (read from Notion's
  DevTools console, not screenshots). Bold text renders at `font-weight: 600`
  (semibold) instead of the browser-default 700 that a bare `<strong>` ships, and
  the default body-text color softens to Notion's tone in both themes: light moves
  from near-pure black to `oklch(0.293 0 0)` (≈ Notion `#2c2c2b`), dark from
  near-pure white to `oklch(0.952 0 0)` (≈ Notion `#f0efed`).

  The text color is the shared `--foreground` seed, so the whole chrome (popovers,
  toolbars, muted text, borders — all derived from it) softens consistently with
  the body text. Bold is plain CSS on the PM-DOM `<strong>`/`<b>`, so clipboard
  `text/html` stays semantic with no inline weight (pasting elsewhere reads as that
  app's bold, not a hardcoded 600).

- Updated dependencies [a2e00a9]
  - @ocai/rune-core@0.14.1

## 0.14.0

### Minor Changes

- 158fb38: Inline `code` mark now renders as a Notion-style pill: monospace font, a faint
  neutral background, small rounded padding, and a code-specific red foreground
  (`--rune-inline-code-fg`, distinct from the palette `data-text-color="red"`).

  The mark is re-registered at low priority so it nests inside an inline color
  span, and its `excludes` is narrowed from Tiptap's blanket `"_"` to the
  navigation/reference marks only (`link wikiLink internalRef`). As a result an
  inline text/background color now overrides the code's default red/grey — the
  chosen text color flows through and the chosen background fills the whole pill
  (corners included) — while code can also combine with bold/italic/strike/
  underline, matching Notion. Code still cannot also be a link/wikiLink.

### Patch Changes

- Updated dependencies [158fb38]
  - @ocai/rune-core@0.14.0

## 0.13.0

### Minor Changes

- 4dc1858: Wire up the inline toolbar's "More options" (`•••`) button: it now opens the
  same block-actions dropdown (Turn into / Color / Duplicate / Delete / …) that
  the side-menu grip produces, anchored just below the selected text rather than
  out at the gutter.

  `openBlockActionsDropdown` gains an optional frozen-rect argument and a new
  `"toolbar"` anchor kind (`BlockActionsDropdownAnchor`), with a matching
  `DropdownAnchorRect` type — needed because setting the block selection unmounts
  the toolbar, so its button rect is captured up front instead of read live like
  the grip / media-bar anchors.

### Patch Changes

- Updated dependencies [4dc1858]
- Updated dependencies [4dc1858]
  - @ocai/rune-core@0.13.0

## 0.12.3

### Patch Changes

- 2b4b298: fix(emoji-picker): don't focus a destroyed editor on popover close

  `RuneEmojiPicker`'s `onCloseAutoFocus` called `editor.commands.focus()`
  unconditionally. Radix fires that handler on unmount, which can run after the
  editor has been torn down — tiptap's `commands` getter throws on a destroyed
  editor, surfacing as an uncaught exception. Guard the call with
  `!editor.isDestroyed`.

- Updated dependencies [da4e374]
- Updated dependencies [2b4b298]
  - @ocai/rune-core@0.12.3

## 0.12.2

### Patch Changes

- f342ea7: feat(react): floating-TOC dropdown background is its own themeable token

  The heading dropdown that opens off the floating TOC minimap now fills with a
  dedicated `--rune-toc-card-bg` variable (defined on `:root` so it reaches the
  Radix-portaled card) instead of the generic `bg-popover`. It defaults to the
  page/editor background (`var(--background)`), so the card reads flush with the
  canvas rather than as a lifted popover — most visible in dark mode, where the
  popover token was lifted 7% above the background. Hosts can retint just the TOC
  dropdown by overriding `--rune-toc-card-bg`.

- f342ea7: fix(react): floating TOC no longer hides over a narrow table's empty bleed padding

  The collision-hide sampler counted any hit inside the ProseMirror DOM as an
  overlap, but a table's `.rune-table-scroll` viewport always reserves ~96px of
  bleed padding (`--rune-table-bleed-right`) that extends into the right gutter
  whether the table is wide or narrow. A hit on that empty padding was misread
  as content, so the TOC hid for ANY table that scrolled into the bar band —
  not just oversized ones. The sampler now ignores hits on the table's bleed
  chrome and only treats hits inside `.rune-table-frame` (the actual `<table>`)
  as an overlap, restoring the intended "hide only when a wide table visually
  overlaps the TOC" behavior.

  - @ocai/rune-core@0.12.2

## 0.12.1

### Patch Changes

- Republish the caret-comfort and table extend-button fixes that were present on `main` but absent from the previously published `0.12.0` tarballs.

  The `0.12.0` package metadata and changelog included the caret-comfort off-screen guard and the table `+col` / `+row` caret-reveal fix, but the GitHub Packages tarballs were cut before those commits. This patch release publishes the intended built artifacts so downstream apps receive those fixes.

- Updated dependencies
  - @ocai/rune-core@0.12.1

## 0.12.0

### Minor Changes

- 4c09988: feat(react): inline color palette as a portaled dropdown + "Recently used" row

  The inline-toolbar color palette now opens as a body-portaled sibling popover
  (mirroring `TurnIntoSuggestionMenu`) instead of an `absolute top-full` child, so
  it no longer breaks after a window-blur / display-switch reflow. A session-scoped
  "Recently used" row surfaces the most-recent text/background picks (snapshot
  taken at open, suggestion-menu parity). New public helpers:
  `recordColorUse` / `getRecentColors` / `getColorFrequency` / `RECENT_COLORS_LIMIT`
  and the `RecentColor` / `ColorKind` types, for host-owned persistence.

  `getRecentColors` now drops names absent from the current palette, so stale
  recents rehydrated by a host (e.g. a since-renamed color) can't crash the row.

### Patch Changes

- 1106f47: fix(table): extend (+col / +row) buttons now reveal from the caret, not only mouse hover

  The +col / +row extend buttons were hover-only: the CSS reveal also listed
  `:has(tbody tr …:focus-within)`, intended to show a button when the caret sat
  in the last column / last row, but `:focus-within` is dead in a single
  contenteditable editor — the focused element is always the `.ProseMirror` root
  (an ancestor of every cell), so `td:focus-within` never matches a caret. Net
  effect: if your cursor was in the last cell but your mouse wasn't hovering
  there, the button wouldn't appear ("sometimes can't summon it").

  `TableExtendButtons` now derives "selection is in the last column / last row"
  from the PM selection (caret `TextSelection` or `CellSelection`) and marks the
  owning `.rune-table-frame` with `data-rune-extend-col-active` /
  `data-rune-extend-row-active`; the CSS reveal reads those attributes and the
  dead `:focus-within` selectors are removed. Mouse-hover reveal is unchanged.

  Known limitation (unchanged, tracked separately): on a table wide enough to
  overflow horizontally, `+col` is anchored to the table's right edge and sits
  outside the clipped scroll viewport — reaching it still requires scrolling the
  table right. Making it reachable without scrolling is separate "sticky +col"
  work.

- Updated dependencies [5f21561]
- Updated dependencies [377e987]
- Updated dependencies [1106f47]
- Updated dependencies [a7daf28]
  - @ocai/rune-core@0.12.0

## 0.11.2

### Patch Changes

- Updated dependencies
  - @ocai/rune-core@0.11.2

## 0.11.1

### Patch Changes

- Updated dependencies
  - @ocai/rune-core@0.11.1

## 0.11.0

### Minor Changes

- c8f437c: feat(react): add a generic `renderExtraSection` slot to `InlineToolbar` (and `renderInlineToolbarSection` on `RuneEditor`).

  Restores a host injection point into the built-in selection toolbar. The previous AI-specific slot (`InlineToolbar`'s `renderAiSection`, keyed on the now-removed `useRuneAi` state machine) came down with the default AI UX in the prior release, leaving hosts with only the all-or-nothing `inlineToolbar={false}` escape hatch — i.e. rebuild the entire formatting toolbar just to add one entry.

  The new slot is content-agnostic:

  ```tsx
  <RuneEditor
    renderInlineToolbarSection={({ editor, from, to }) => (
      <EditWithAiButton editor={editor} from={from} to={to} />
    )}
  />
  ```

  - `InlineToolbar` gains `renderExtraSection?: (ctx: { editor; from; to }) => ReactNode`; `RuneEditor` forwards it as `renderInlineToolbarSection`.
  - rune owns **when** (the same non-collapsed-text-selection gate the toolbar already uses); the host owns **what**. No AI coupling — render an "Edit with AI" entry, a quick-action menu, or anything else.
  - `from`/`to` are the captured selection range; read the text with `editor.state.doc.textBetween(from, to)`.
  - Interactive elements inside MUST `preventDefault` on mousedown to keep the PM selection alive (same rule the formatting buttons follow).

  New exported types: `InlineToolbarSectionContext`, `RenderInlineToolbarSection`.

### Patch Changes

- @ocai/rune-core@0.11.0

## 0.10.0

### Minor Changes

- 1ed303f: feat(react): floating TOC hides while a wide block overlaps the gutter

  The floating table-of-contents now hides itself (and reappears) Notion-style
  when an editor block wide enough to bleed into the right gutter — today, an
  overflowing table — scrolls into the bar column's vertical band. Previously
  the heading bars rendered on top of that block's text, hurting readability.

  Keyed on geometry, not block type: a scroll/resize-throttled sampler checks
  whether real editor content (inside the ProseMirror DOM, so gutter chrome
  doesn't count) has bled under the bar column, and toggles `visibility`
  (not `display`, so the same sampler can detect when the overlap clears) with
  a short fade. Matches Notion's verified `.notion-floating-table-of-contents`
  behavior. No public API change.

- b3a010c: refactor(react): remove the default AI UX from `@rune-react`, and the AI generate trigger from `@rune-core`.

  The batteries-included AI surface is gone — downstream apps already ship their own AI UI, so a default product UX in the library carried cost without benefit and forced AI logic to straddle two packages. Removed:

  - **react:** `useRuneAi`, `RuneAiBar`, `AiBlockPopover`, the in-place inline-diff preview (`RuneAiDiffPreview` + `setAiDiffPreview` / `clearAiDiffPreview` / `selectionTextSpans` / `diffSegmentsToRanges` / `isAiDiffPreviewAvailable` / `isAiDiffPreviewActive`), `diffWords`, and all related types. `RuneEditor` no longer accepts an `ai` prop (`RuneAiConfig` removed), `InlineToolbar` no longer accepts `ai` / `renderAiSection`, and `useRuneEditor` no longer registers the diff-preview extension. The "Press Space for AI" placeholder is gone.
  - **core:** the `AiTrigger` keymap (Space-in-empty-paragraph → generate) and its surface — `aiTriggerPluginKey`, `readAiGenerateRequest`, `canRequestAiGenerate`, `AiGenerateRequest`, `AiTriggerOptions` — plus the `kit.ai.generate` option. Also `insertGeneratedBlocks`, whose only caller was the removed generate flow.

  **Kept** (headless safe-write primitives, still used by `rune-ai`): `getSelectionSnapshot`, `replaceSelectionText`, `RuneSelectionSnapshot`, `RuneBlockInput`. The `rune-ai` headless tool package is unaffected.

  Hosts that want AI compose it on the core primitives (+ `rune-ai` tools) with their own hook and UI.

### Patch Changes

- Updated dependencies [be7c9a7]
- Updated dependencies [789b334]
- Updated dependencies [b3a010c]
  - @ocai/rune-core@0.10.0

## 0.9.0

### Minor Changes

- 41c808d: feat(react): unify the AI generate + rewrite surfaces into one `RuneAiBar`. A
  single block-anchored floating bar now hosts both flows (shared shell, width,
  padding, side, focus policy), with one `renderBar(ai)` slot — branch on
  `ai.mode` + `ai.phase` — filling the content for every phase; rune's DefaultBar
  drives generate's input + submit too. Generate's only difference is its `menu`
  phase (the input). Breaking: `RuneAiRewritePanel` and `RuneAiGeneratePopover`
  (and their prop types) are removed in favour of `RuneAiBar` / `RuneAiBarProps`;
  `RuneAiConfig.renderSection` is now optional and rewrite-only (generate's input
  moved into `renderBar`).
- de64139: feat(core): complete the structured block-input contract for agents. `table` now
  advertises its POPULATED `rows: RuneTableRow[]` shape (not only the blank-grid
  dimensions sugar) and builds a filled table from it via `fromInput`; `columnLayout`
  advertises a nested `columns: [{ width, children }]` input example. A new
  all-blocks guard test asserts every declared `schemaContext.input.examples` is
  accepted by its `fromInput` and that `fromInput ∘ toRuneBlock` round-trips — so
  an agent can author any block type (incl. tables/columns) through the existing
  tools without a Markdown round-trip.

  Hardens the rich-block `fromInput` paths against malformed agent input so they
  honour the contract (build a node, or return `null` for the caller to reject)
  instead of throwing out of the `insertBlocks` command: `createNodeFromBlockInput`
  shape-gates a null / non-object / type-less entry; `buildTableContentFromRows`
  degrades a row with missing/non-array `cells` (or a null row) to an empty row and
  coerces non-string cell `text` (a number no longer builds a `nodeSize:undefined`
  TextNode); and `columnLayout.fromInput` rejects an array column entry and a
  nested `columnLayout` child (the no-nested-layouts v1 invariant) rather than
  silently seeding a blank column or flattening the inner layout.

### Patch Changes

- Updated dependencies [41c808d]
- Updated dependencies [de64139]
- Updated dependencies [c9a3209]
- Updated dependencies [c9a3209]
  - @ocai/rune-core@0.9.0

## 0.8.1

### Patch Changes

- Updated dependencies [96f7b15]
  - @ocai/rune-core@0.8.1

## 0.8.0

### Minor Changes

- d64b2fc: AI diff preview: add a `"committed"` mode to `setAiDiffPreview` /
  `diffSegmentsToRanges` (`AiDiffPreviewPayload.mode`, default `"pending"`).

  The existing renderer assumes the document holds the **original** text — `del`
  runs paint as inline strikes over real text, `ins` runs are widget pills. That's
  right for rune's own inline bar, which previews before `accept` writes. A host
  that **applies** the rewrite first and then shows the diff over the committed
  result (escalate-to-chat, Notion's model) needs the mirror: `mode: "committed"`
  renders `ins` runs as inline highlights over the live result text and `del` runs
  as struck `<del>` widget pills. The diff segments are unchanged
  (`diffWords(original, result)`); only the rendering roles swap. The shared
  `.rune-ai-ins` / `.rune-ai-del` styles now work as either an inline decoration or
  a widget pill.

### Patch Changes

- @ocai/rune-core@0.8.0

## 0.7.4

### Patch Changes

- AI rewrite bar: keep the active rewrite session open across focus churn such
  as window blur, DevTools focus changes, and focus moving outside the floating
  bar. Radix focus-outside dismissal is now prevented; explicit actions like
  Accept, Discard, Stop, Retry, or starting a new selection still own teardown.
  - @ocai/rune-core@0.7.4

## 0.7.3

### Patch Changes

- AI rewrite bar: cap the in-place / loading / error bar at a reading-width max
  (`--rune-ai-bar-max-width`, default `720px`) instead of stretching to the full
  anchor-block width. Notion pins its AI bar to ~720px regardless of page width —
  the previous behaviour let the bar run edge-to-edge on full-width pages. The bar
  still tracks the block width (so it fills the column and stays left-aligned) but
  never exceeds the cap. Hosts whose reading column differs can retune the cap via
  the `--rune-ai-bar-max-width` CSS variable; set it on a portal-visible scope
  (e.g. `:root`), since the bar's PopoverContent portals to `<body>`.
  - @ocai/rune-core@0.7.3

## 0.7.2

### Patch Changes

- 0ffbd29: Export the in-place AI diff-preview primitives from the package barrel so a
  downstream host can drive the in-editor inline diff with its own AI bar/card
  (without `RuneAiRewritePanel`).

  New exports — all already implemented behind `RuneAiDiffPreview` + `useRuneAi`,
  this only widens the public surface (no behavior change):

  - `setAiDiffPreview` / `clearAiDiffPreview` — paint the Notion-style diff inside
    the selected block(s) and edit-lock the view, then clear + restore editability
    and the captured selection. ("Show changes" → `setAiDiffPreview`; "Hide" /
    "Insert" → `clearAiDiffPreview`.)
  - `selectionTextSpans` / `diffSegmentsToRanges` — derive the per-block text spans
    from the live doc, and map `diffWords` segments onto absolute PM positions.
  - `isAiDiffPreviewAvailable` / `isAiDiffPreviewActive` — gate the flow (the
    extension must be registered; a preview must be open).
  - types `AiDiffPreviewPayload` / `AiDiffSpan`.

  Edit-lock contract: while a preview is active the view is edit-locked
  (`editor.isEditable` reads `false`), so a host driving its own controls must call
  `clearAiDiffPreview` synchronously before any doc write or `focus()` — a command
  dispatched under the lock silently no-ops.

- 0ffbd29: Fix floating chrome detaching from its anchor when an inner `overflow:auto`
  container scrolls (only window scroll repositioned before). Editor-anchored
  popovers now tag their virtual element with a `contextElement` (the editor DOM),
  so floating-ui's `autoUpdate` discovers the real scroll ancestors and
  repositions on inner-container scroll too.

  - `useStableVirtualElement(getClientRect, contextElement?)` now sets
    `contextElement` on the virtual element — passed explicitly, or carried on a
    `RuneAnchor` getter (the producer-hook path).
  - `useBlockAnchor` / `useSelectionAnchor` and the new `useRangeAnchor` bake in the
    editor DOM, so downstream hosts driving their own Popover get the fix for free.
    New exports: `useRangeAnchor`, `editorViewDom`; `RuneAnchor` gains an optional
    `contextElement`.
  - The AI rewrite bar + generate popover, inline toolbar, link hover card, table /
    block action dropdowns, slash / emoji menus, media + math popovers, and the
    block-link paste menu all follow their anchor on inner-container scroll now.
    The three surfaces that carried a manual window-scroll handler
    (InlineToolbar / LinkHoverCard / TableActionsDropdown) were migrated to live
    anchors and their handlers removed.

  Note: `BlockLinkPasteMenu` now takes an `editor` prop (and `BlockLinkPasteState`
  no longer carries `rect`) — internal wiring updated.

- 0ffbd29: Tighten the side-menu (+ / grip) button padding so the grey hover highlight hugs
  the icon instead of leaving a tall box.
- Updated dependencies [0ffbd29]
  - @ocai/rune-core@0.7.2

## 0.7.1

### Patch Changes

- a7652b8: Strip develop-stage back-compat shims, widen the AI rewrite bar, and align the selection toolbar's open direction with Notion.

  **Breaking — removed deprecated / duplicate-name exports** (no aliases kept; internal up/downstream, pre-1.0):

  - `renderPreviewBar` → use `renderBar` (one slot spanning loading / preview / error; branch on `ai.phase`).
  - `RuneAiAnchor` → use `RuneAnchor` (identical type).
  - Image-named media aliases → use the `Media*` canonicals: `ImageImport`→`MediaImport`, `ImagePopover`→`MediaPopover`, `getImageImportState`→`getMediaImportState`, `getImagePopoverBlockId`→`getMediaPopoverBlockId`, `imageImportPluginKey`→`mediaImportPluginKey`, `imagePopoverPluginKey`→`mediaPopoverPluginKey`, plus the `ImageImport{Input,Map,Options,State}` / `ImagePopoverState` type aliases. The `imageImport` storage key / extension name and the real image command/hook API (`insertImage`, `startImageUrlImport`, `openImagePopover`, `RuneImportImage*`, `InsertImageOptions`) are unchanged.

  **AI rewrite bar** (`RuneAiRewritePanel`): the bar-only panel now spans the anchor block's width instead of `w-max`, so a host's `renderBar` can pin its controls to the block's left/right edges (Notion's wide bar). The card-preview body keeps its fixed text column.

  **Selection toolbar** (`InlineToolbar`): now defaults to opening BELOW the selection (`side="bottom"`, matching Notion), flipping above only when it can't fit near the viewport bottom. The selection-height anchor keeps the toolbar off the selected text in either direction (#74).

- Updated dependencies [a7652b8]
  - @ocai/rune-core@0.7.1

## 0.7.0

### Minor Changes

- 39383a9: Consolidate the AI rewrite floating bar into ONE host slot spanning all phases,
  so its height/width/side stay consistent loading → preview → error instead of
  drifting between rune (loading/error) and the host (preview).

  - New `renderBar?: (ai) => ReactNode` on the AI config / `RuneAiRewritePanel` —
    the host branches on `ai.phase` and returns one component for loading, preview
    (both shapes), and error. Wire Stop → `ai.cancel()`, Retry → `ai.retry()`
    alongside the existing Accept/Undo/Insert-below.
  - `renderPreviewBar` is **deprecated** but still works: when `renderBar` is
    absent it keeps the legacy split (rune renders loading/error, the host renders
    preview).
  - New `UseRuneAiResult.inPlaceBound` — the phase-independent half of
    `inlineDiff`, known from loading, so the bar's side (above vs below the block)
    is chosen once and doesn't flip when the result lands.
  - rune's `DefaultBar` is now phase-switched with consistent 28px rows; the bar
    sizes to its content (`w-max`) so loading/preview don't jump width.

  No breaking change — existing `renderPreviewBar` hosts are unaffected. The
  keyboard handling (`usePreviewKeys`) stays in the panel; moving it into the hook
  for fully-headless hosts is a separate follow-up.

- 1f829b3: Expose the editor-grade floating-panel "shadow box" chrome as a themeable
  surface, so a downstream host can put rune's exact popover look on its own
  popover (Layer C of the floating-primitives spec).

  New public API:

  - `runeChromeClass(opts?)` + `RUNE_CHROME_CLASS` — the canonical Tailwind class
    string for the chrome (rounded corners, popover bg/fg, hairline ring, drop
    shadow, open/close animation). `opts` varies `shadow` ("md" | "lg") and
    `animation` ("popover" | "native" | "none"). Returns chrome only — the caller
    adds layout and merges via `cn()`.
  - `.rune-chrome` (+ `.rune-chrome--strong`) plain-CSS class — the non-Tailwind
    path: one className + `style.css` gives the same look with no Tailwind utility
    resolution. The two paths are an either/or.
  - `--rune-chrome-*` CSS tokens on `:root` (`bg`/`fg`/`radius` alias the existing
    popover/radius tokens; `ring`/`shadow`/`shadow-strong` hold the literal ring +
    shadow values) — override to retheme; a portaled panel outside `.rune-editor`
    still resolves them.

  `PopoverContent` and the native-menu surface now consume `runeChromeClass()` as
  the single source instead of two copied inline strings — a parity test asserts
  the helper reproduces their previous utilities exactly, so this is
  zero-visual-change. The scattered `shadow-lg` panels and `MediaFloatingBar` are
  left for a follow-up (collapsing them changes shadow weight).

- 4de88f3: Export the two floating-UI positioning bridges so downstream apps can anchor
  their own popovers to the editor with rune's behavior:

  - `useStableVirtualElement` (+ `VirtualElementRef`) — wraps a lazy
    `() => DOMRect | null` getter into a Radix virtual element with live-rect
    re-reads and last-good-rect fallback during close transitions.
  - `useLockedPopoverSide` (+ `PopoverSide`, `LockedPopoverSide`) — pins the side
    Radix picks on first open so content-size changes don't flip the panel over
    the anchor mid-life.

  Both already shipped internally (13+ surfaces depend on them); this only makes
  them public. No behavior change, no new code — purely additive surface area.
  Note: these signatures are now semver-public.

- 92e36f6: Expose the editor anchor computation so a host can position its own popovers
  against the editor — the positioning math lifted out of the AI flow into a
  sessionless, unit-tested `positioning` module (Layer B of the floating-primitives
  spec).

  New public exports:

  - Pure getters (imperative, React-free): `pointAnchorAtHead` (zero- or
    selection-height point at the selection head), `rangeToRect` (start-origin
    bbox of a text range), `rectForBlockId` (a block's rect by `data-id`, CSS.escape
    baked in), `unionBlockRect` (union bbox over several blocks).
  - React hooks with the last-good-rect fallback baked in: `useSelectionAnchor`,
    `useBlockAnchor` — return a `RuneAnchor` (`() => DOMRect | null`) to feed
    straight into `useStableVirtualElement`.
  - Types: `RuneAnchor`, `PointAnchorOptions`. `RuneAiAnchor` is now an alias of
    `RuneAnchor` (back-compat preserved).

  Internally, `useRuneAi`, `InlineToolbar`, and the block-link paste menu now
  delegate to these shared getters instead of three near-identical inline
  `coordsAtPos` copies (the three were NOT byte-identical — different point shapes
  and clamps; parity is locked by `positioning/anchors.test.ts`). No behavior
  change on the success path; the only difference is the toolbar anchor now returns
  null (and InlineToolbar's existing null-guard runs) instead of throwing on a rare
  DOM-desync read, which is strictly safer. The paste anchor keeps its non-null 1×1
  fallback unchanged.

### Patch Changes

- @ocai/rune-core@0.7.0

## 0.6.1

### Patch Changes

- 2921b68: Compact the rewrite "Rewriting…" loading bar to a single 24px row (was 28px),
  so the loading → preview transition no longer jumps the popover height and the
  floating bar tracks Notion's ~40px. Purely visual; no API change.
  - @ocai/rune-core@0.6.1

## 0.6.0

### Minor Changes

- 213eb18: Export `diffWords` (and the `DiffSegment` / `DiffSegmentType` types) from the
  public API. The AI rewrite preview already computes this Notion-style word diff
  internally; exposing it lets a host render the **same** diff outside the editor
  — e.g. a chat result card after escalating the rewrite into a thread — off the
  original/result text pair, without re-implementing the LCS. (Segment data only:
  the editor's ins/del styles are scoped under `.rune-editor`, so an external
  surface brings its own styling.)

  `diffWords` is also hardened for large inputs: identical inputs short-circuit
  to a single `same` segment (a verbatim model echo reads as "no change", never
  as a wholesale replacement), common leading/trailing tokens are trimmed in
  O(n+m) before the LCS (a localized edit inside a huge selection stays
  word-level regardless of total size), and only when the **differing** region
  exceeds ~4M token-pairs — roughly 1 000 _changed_ words on each side — does
  that region degrade to a coarse `del`+`ins` instead of allocating the O(n·m)
  matrix, so a wholesale section-sized rewrite can't spike renderer heap.
  Reconstruction of both sides stays exact in every branch.

### Patch Changes

- 213eb18: AI rewrite **loading** control is now a square **Stop** button (Notion-style)
  instead of a text "Cancel". Same gesture — it abandons the in-flight rewrite via
  `ai.cancel` — only the affordance changes, matching the preview/accept controls
  and a chat composer's streaming stop.
  - @ocai/rune-core@0.6.0

## 0.5.0

### Minor Changes

- a97836b: AI rewrite in-place preview v2: **multi-block selections** now paint the
  inline diff in place too, instead of falling back to the card. The mapping
  derives per-block text spans from the live doc (`selectionTextSpans`) and
  validates them by reconstructing the captured text — stale ranges and
  selections crossing a non-text leaf block (divider, media) still degrade to
  the card. Deletion runs crossing a block boundary split into one decoration
  per block; insertion runs keep their `\n` inside one pill (`white-space:
pre-wrap`, re-rounded per line) and accept materialises the real block split.
  The preview bar now anchors above the FIRST selected block and the
  loading/error/card surfaces below the LAST, regardless of drag direction.

  Breaking (pre-publish, ships together with v1): `AiDiffPreviewPayload` takes
  `spans: AiDiffSpan[]` instead of `from`/`to`, and `diffSegmentsToRanges`
  walks spans.

- eed1f38: AI rewrite preview is now Notion-style **in-place** for single-block
  selections: the word-diff paints inside the paragraph as PM decorations
  (deletions struck through, insertions as `--editor-accent` pills) while the
  view is edit-locked, with only a floating control bar above the block. The
  document is never mutated until Accept; Enter accepts, Esc/⌘Z discard.
  Multi-block selections and editors without the new `RuneAiDiffPreview`
  extension (auto-registered by `useRuneEditor`) keep the card preview.

  New API (react):

  - `RuneAiConfig.renderPreviewBar?: (ai) => ReactNode` — host render slot for
    the preview control bar (both shapes), mirroring `renderSection`. Omitted →
    rune renders a minimal Accept/Undo default bar.
  - `ai.insertBelow()` — keep the original and insert the rewrite as new
    block(s) after the selection's last block, then close.
  - `ai.inlineDiff` — whether the open preview is rendering in place.
  - `RuneAiDiffPreview` export — for hosts composing their own editor from the
    core kit who want the in-place preview.

  Fixes: `retry()` now replays the last _submitted_ instruction (preset-click
  runs could previously retry an empty string and silently no-op), and the
  preview restores the captured selection on every exit.

### Patch Changes

- 8e0ffb1: Visual polish: paragraph blocks get a roomier vertical rhythm (6px block
  padding, up from the 3px baseline — lists/toggle/heading keep their own
  values), and the table side-menu grip now centers on the header row's first
  text line instead of floating ~11px above it (the old formula targeted the
  cell text's top edge).
- Updated dependencies [eed1f38]
  - @ocai/rune-core@0.5.0

## 0.4.0

### Minor Changes

- 47e950a: Columns Phase 2 (drag-to-create columns, F6): dropping a dragged block on
  another block's edge creates columns.

  The edge zone starts at the target block's CONTENT edge and extends outward
  (`--rune-col-dropzone`, default 40px; mouse-X keyed). Dropping on a root
  block's left/right edge wraps target + dragged run into a new 2-column layout
  (both `width: 1`) — drop side = dragged-block side. Dropping on an existing
  layout's outer edges or between columns inserts a new column at that boundary
  (width = mean of the existing column widths); at 5 columns the zone simply
  does not arm. A multi-block (MBS) drag run becomes the new column's children.

  New public command: `editor.commands.wrapIntoColumns(ids, target)` with
  `WrapIntoColumnsTarget` = `{ id, side: "left" | "right" }` (wrap) or
  `{ layoutId, index }` (add column). One transaction — one undo step; the F2
  emptied-source-column removal composes (dragging a column's last block into a
  new layout elsewhere collapses the source column / unwraps its layout).

  While a zone is armed the drop indicator renders as a vertical bar (full
  target-block height for a wrap, full layout height for an add-column). Zones
  never arm on the dragged blocks themselves, on blocks inside a column, or for
  a dragged run containing a layout (no nesting), and only in the target row's
  middle half — row edges stay plain reorder territory.

- ad833c0: Slash menu: the single "Columns" item is now four items — "2 columns" /
  "3 columns" / "4 columns" / "5 columns" (keys `columns_2`..`columns_5`,
  matching the schema's `column{2,5}` bound via `MAX_COLUMNS`).

  - **core:** `ColumnLayout.slashMenuItems` generates one item per count;
    every item keeps the no-nesting insert guard and carries a `block`
    descriptor, so all four also surface as Turn-into targets. The shared
    `"columns"` alias means typing `/columns` lists every count, with
    2 columns ranked first — `/columns` + Enter still inserts the 2-col
    default.
  - **react:** new `Columns3Icon` / `Columns4Icon` / `Columns5Icon`
    (rectangleSplit3/4/5 glyphs); the existing `ColumnsIcon` stays as the
    2-column glyph. Icon map keys follow the new item keys.
  - **Breaking-ish:** the old item key `columns` is gone; recently-used
    frequency recorded under it restarts at zero for the new keys.

- dd709e6: Centralize the gesture claim/release protocol (GS-3) — the central gesture
  registry's claim / release / lost-mouseup-watchdog dance, previously
  hand-copied across all seven gesture implementations (block-drag, media
  resize, drag-extend, marquee, column-resize, cell-drag, table-select), now
  lives in `extensions/shared/gesture-state.ts` as `claimGesture()` returning a
  `GestureClaim` handle (`owned`, `canCommit`, `release()`, `releaseInto(tr)`)
  plus the `isPrimaryRelease` / `primaryLost` predicates. All four protocol
  copies' drift bugs are fixed in the same pass:

  - **GS-2:** drag-extend, column-resize, cell-drag and table-select no longer
    end the gesture on a right/middle-button release, and the sites missing the
    lost-mouseup watchdog (`buttons` no longer holding primary mid-move) now
    abort instead of committing on a button-less mousemove.
  - **GS-6:** a refused claim (another gesture owns the registry) now runs the
    gesture's full local cleanup everywhere — no armed listeners survive to
    process phantom events.
  - **AV-2:** `editor.setEditable(false)` mid-gesture no longer commits the
    final doc mutation — every doc-mutating commit path gates on
    `claim.canCommit` and takes the gesture's abort path instead.
  - **GS-4** (unguarded registry release in resize cleanup) was probed and found
    already resolved by the post-8075e00 P1 fixes; the probe is kept as a pin.

  New public exports from `@ocai/rune-core`: `claimGesture`,
  `GestureClaim`, `GestureName`, `isPrimaryRelease`, `primaryLost`.

- 249e186: In-place attrs / resize follow-ups (deferred from the #317 review):

  - The resizable-media DOM shape is now spec-declared: `BlockSpecConfig`
    gains `resizeMediaSelector`, consumed by the factory atom NodeView's
    resize-handle gate (`syncResizeSlot`) and by the resize gesture's
    pointer-events suppression. Core no longer hardcodes the
    img/video/audio/iframe selector list (the same block-knows-its-DOM
    inversion `inPlaceAttrs` fixed for attrs).

    **Migration**: a block declaring `supports.resize` must now also declare
    `resizeMediaSelector` — `createBlockSpec` throws at registration when it
    is missing (previously the handles silently keyed off a core-owned media
    list that plugin blocks could not extend).

  - `createBlockSpec` validates `inPlaceAttrs` at registration: each pair's
    `attr` must name a declared prop (or the shared `id`/`depth` attrs). A
    typo now throws at construction instead of silently disabling absorption
    (every change rebuilding the NodeView and unmounting portaled chrome).
  - Parity tests pin "absorbed DOM === freshly rendered DOM" for the media
    in-place pairs, including the default-elision removal paths and the
    empty-state no-op.
  - The factory atom NodeView captures its spec's `inPlaceAttrs` once at
    construction instead of rebuilding the registry record per update.
  - New real-mouse e2e covers the posAtCoords atom inside-preference premise
    (pointer over an image's right half) end-to-end.

- 0d9c96e: InternalRef mentions learn Notion's live-label model via a new opt-in
  `syncLabel` option (default `false`). When enabled together with `resolve`,
  an `addToHistory: false` appendTransaction keeps each mention's visible text
  in sync with `resolve().displayText` — renames at the source heal the chip
  on the next doc change or `refreshEntityRefs("internalRef")`, while
  `null`/empty resolver results never touch the doc, so the existing text acts
  as the cached fallback for deleted or not-yet-loaded targets (plus
  `data-broken` styling via the existing decoration pipeline).

  Consumer contract: `resolve` stays synchronous and O(1); the host calls
  `refreshEntityRefs()` after its title cache mutates. Resolvers that derive
  labels from the editor doc itself must refresh post-commit
  (`editor.on("update", …)`) because the sync pass runs during
  `appendTransaction`, before the triggering edit lands in `editor.state`.
  Off by default — collab apps should enable it on a single authority client.

  Also exports `internalRefLabelSyncKey` (sync transactions are tagged with it
  for downstream dirty-tracking) and `isTargetedRefresh` from entity-refs.

- 1295950: Media floating bar follow-ups (deferred from the #316 review):

  - `headIndexAtY` now carries the posAtCoords atom inside-preference: a hit
    over an atom block's right half resolves to THAT atom's row index instead
    of the next block's, and strict mode no longer rejects a right-half hit on
    a last-child atom as void-below-last-block. Drag-extend, marquee, and the
    block-drag padding-press gate inherit the fix through the shared resolver.
    (Block-drag drop targeting computes its index from snapshot rect bands and
    never had the caret bias.)
  - Media floating bar buttons are one size step smaller (24px boxes,
    glyphs unchanged at 14px), matching Notion's compact hover bar.
  - Atom NodeView in-place attrs are now spec-declared: `BlockSpecConfig`
    gains optional `inPlaceAttrs` (`{ attr, applyToDOM }` pairs; `applyToDOM`
    returns `false` to decline and force a rebuild). New public types
    `RuneInPlaceAttr` / `RuneInPlaceAttrTarget`. The previously hardcoded
    contentWidth/align handling moved into the media blocks' own declarations;
    behavior is unchanged for built-in blocks, and the value-equal
    attrs-rewrite absorb remains global.

    **Migration — plugin/consumer atom blocks**: the absorb set used to be
    hardcoded (`contentWidth`/`align`) and applied to every atom NodeView.
    It is now opt-in per spec: an atom block that relied on those attrs
    being absorbed must declare its own `inPlaceAttrs`, or its NodeView is
    rebuilt on every such attr change (remounting media elements and
    unmounting any chrome portaled inside the view).

- bbe7081: Media blocks — Notion-style hover floating bar + alignment
  (spec 2026-06-11-media-blocks-notion-floating-bar-diff):

  - **`MediaFloatingBar`** (rune-react): hover-only toolbar absolutely
    positioned inside the top-right corner of a filled image / video block
    (Notion's authored structure — not a floating popover; audio is
    excluded). Wide blocks show Alignment · quick action · `•••`; narrow
    blocks collapse to `•••` alone. Alignment opens a horizontal
    three-icon row; `•••` opens the SAME BlockActionsDropdown the side-menu
    grip opens (new core `openBlockActionsDropdown` + plugin
    `dropdownAnchor`), anchored at the bar. Mounted by `RuneEditor`; also
    exported for custom hosts.
  - **`align` attr** (`"left" | "center" | "right"`, default center) on image
    and video — marshalled as `data-align` on the block chrome, mapped to
    `text-align` in CSS, surfaced in `getDocument()` / `insertBlocks` /
    `updateBlock`. Audio stays full-width and omits it. Media now defaults to
    **centered** (Notion parity; previously left-aligned in flow).
  - **Expanded media blockActions**: image gains **Download** (fetch → blob
    with new-tab fallback), video/audio gain **View original** — shared
    between the side-menu dropdown and the floating bar via the new
    `quickAction` flag on `RuneBlockAction`.
  - **Empty states match Notion**: audio's empty pill becomes the shared
    full-width 10px-radius bar, label "Add an audio file".
  - **Side-menu atom hover fix**: `posAtCoords` caret bias on atom leaves
    (image/video/divider) resolved the right half of an atom to the NEXT
    block; the hover probe now prefers `hit.inside` for draggable atoms, so
    the grip and the floating bar target the block actually under the pointer.

- f677a5c: Slash menu adopts the Notion session model (reference behavior probed and
  documented in internal design notes).
  Three divergences fixed, each reproduced by a probe test first:

  - **Sticky session (new `slashMatcher`):** once open, the menu stays
    anchored to its `/` — spaces and further slashes typed after it are query
    text (`/a /` queries `a /`; backspacing the second slash restores the
    results). Previously @tiptap/suggestion's default matcher re-anchored to
    the LAST slash, popping a fresh browse session mid-query. The prefix gate
    (block start / whitespace before `/`) is now evaluated on the whole
    textblock, so non-inclusive mark boundaries (wiki-link, link) can no
    longer fake a block start and open the menu after a word character.
  - **Keystroke-only session start (new `TriggerConfig.requireTypedTrigger`,
    on for `/`):** a session only opens on a transaction that actually
    inserted the trigger char at the anchor. Placing the caret into a dead
    `/query` run — click, arrow keys, or a loaded doc that contains one —
    never reopens the menu, and typing non-trigger text there doesn't revive
    it. `:` and `[[` keep their existing behavior (their sessions
    legitimately start on later keystrokes).
  - **Whitespace-tolerant filtering (react):** the filter query is trimmed —
    `/ta ` matches like `/ta`, and `/ ` shows the full default list instead
    of silently dropping every single-word title.

### Patch Changes

- 69ccfd6: Gesture edge-discipline hardening (#297, #307) — probe-first, all seven
  reported items reproduced with real-mouse Playwright probes before fixing:

  - **block-drag:** cancel handlers (Escape / pointercancel / window blur) now
    register at mousedown instead of threshold-cross, so a mouseup lost during
    the pending stage (alt-tab, OS dialog) can no longer leave a phantom drag
    armed; mousemoves with the primary button no longer held cancel the gesture.
    Grip and padding presses, and the gesture-ending mouseup, are gated to the
    primary button — right-click no longer toggles a block selection or starts
    a drag.
  - **block-drag (#307):** any document-changing transaction landing mid-drag
    (e.g. a future collab edit) now aborts the gesture instead of dropping with
    stale positions, which could move or wrap the wrong block.
  - **marquee:** cancel handlers register at arm time; a lost mouseup while
    armed no longer wedges the next sweep into selecting from a stale anchor.
    A non-primary release mid-sweep no longer ends the marquee.
  - **drag-extend:** entry is gated to the primary button — a right press in a
    block's padding no longer rewrites an existing multi-block selection.
  - **image resize:** adopts the shared cancel handlers (blur / pointercancel /
    Escape all revert); lost-mouseup moves no longer keep resizing; right-button
    press or release no longer claims the gesture or commits a width.

- 3618f30: P2 backlog sweep — the remaining review items after the GS-3 centralization,
  probe-first throughout:

  - **Table mouse selection** now cancels on Escape, window blur and
    pointercancel via the shared drag-cancel handlers (RC-3).
  - **Toggle ArrowDown** over a collapsed toggle's hidden body lands via
    `Selection.near`, fixing an invalid caret when the next block is a
    `columnLayout` boundary (COL-5 — reproduced, was filed as theoretical).
  - **Markdown export** separates adjacent ordered-list runs at column-layout
    boundaries (inter-column, leading and trailing edges) with an HTML-comment
    separator so CommonMark renderers don't merge and renumber them (AV-1).
  - **InternalRef label sync** intersects marks across multi-segment mention
    labels instead of spreading the first segment's formatting over the whole
    rewritten label (IR-4).
  - **moveBlocks** drop-on-self is pinned as a successful idempotent no-op
    (returns true, doc byte-identical) — genuine refusals already return false
    (COL-6 resolution).
  - **Media block CSS** `--block-pad-top` now reads the `--rune-media-pad-top`
    token instead of a drift-prone literal (RC-2).
  - Test-quality fixes: vacuous determinism assert replaced with explicit
    expected targets (TA-1), slash-menu icon asserts pin component identity
    (TA-2), disjunctive asserts pinned to exact fixture values (TA-4).

- c07266f: Multi-agent review fixes for the gesture-hardening / columns-phase-2 /
  slash-session range — 1 P0 + 14 P1, every fix probe-reproduced first and
  pinned by a regression test proven to fail on revert:

  - **turnInto × containers (P0):** `classifyKind` classifies structurally
    instead of name-matching `table`. Paragraph → columns seeds the text into
    column 1 (was: silent delete); layout → paragraph refuses (was: persisted
    schema-invalid doc); container sources refuse generally; `buildTextblock`
    validates content before creating. Code targets flatten inline content
    first (hardBreak → newline, inlineMath → latex), so soft-wrapped
    paragraph → code block keeps working.
  - **Slash menu:** in-column Turn-into resolves the surface-local block, not
    the whole layout, via `nearestBodyBlock`; an open slash session never
    re-anchors onto a dead `/` run on caret-only moves — it continues on its
    own anchor or closes (committing could previously delete committed text).
  - **moveBlocks / drag:** layout-into-column moves refuse via a shared
    no-nesting predicate; the drag pipeline no longer offers a column drop
    slot for a run containing a layout.
  - **Selection in columns:** snapshot frames resolve innermost-first
    (in-column carets report the column child; in-column NodeSelections are
    supported); outside-click dismissal of a column-local multi-block
    selection no longer throws or teleports the caret; caret-based
    Mod-ArrowUp/Down and Mod-D act on the column child within its column.
  - **Gestures:** drag-extend cancels on a lost mouseup like its siblings;
    column-resize ignores non-primary mouseups (right-click no longer commits
    a half-finished resize) and cancels with revert on a lost mouseup; the
    padding-drag entry gates on `view.editable` (a read-only editor could be
    mutated); list-chain drag walks its own surface, so dragging an indented
    list parent out of a column takes its children along instead of orphaning
    them.
  - **EmptyBlockBackspace:** the previous-block gate resolves on the caret's
    own surface — in-column Backspace no longer teleports the caret into the
    sibling column or inverts the empty-heading protection.
  - **Columns text projections:** Markdown export flattens column content
    through the normal per-block pipeline (was: silently dropped); plain-text
    projection separates a column's blocks with newlines.

- 69ccfd6: Table pill dropdown fixes (surfaced by the previously-red e2e suites in #302):

  - **react:** picking a color in the pill dropdown's Color submenu works again.
    Since the Popover migration (#272) the portaled submenu was treated as an
    outside click — the menu unmounted on swatch pointerdown and the pick never
    committed.

  - **core:** a cancelled pill drag (Escape / pointercancel / blur /
    drop-on-source) restores the pill's `is-active` highlight again — the class
    is now baked into the widget at creation, surviving the destroy/recreate
    cycle the drag causes. Starting a cell drag also closes the pill dropdown,
    so its capture-phase Escape listener no longer swallows the Escape meant to
    cancel the drag (which previously let the drop apply instead of aborting).

- a7dc65d: TOC side-menu host + media pad-top token (#301, #298):

  - **react:** hovering a Table of Contents block now shows the side-menu
    grip / add button. TOC is an atom, so SideMenu only emits a node
    decoration and relies on the NodeView mounting the widget into a
    `.rune-side-menu-host` via `syncMenuSlot` — the TOC NodeView rendered
    neither (#301). The NodeView also now emits the `.rune-block-content`
    inner wrapper that core `renderDOM` produces, so `data-text-color` /
    `data-background-color` land on the same element live and serialized
    (the color pill hugs the content rectangle in both).

  - **core/react:** the media-family `--block-pad-top` value (`0.75rem`,
    image / video / audio / block equation) is now a single token,
    `--rune-media-pad-top` on `.rune-editor` — previously declared as a
    literal at 5 sites across both packages, where the core and React
    render paths of the same block could drift and silently break the
    side-menu gutter alignment contract (#298). Consumers can override the
    token to retune all media blocks at once.

- eb2e040: Three interaction fixes:

  - **Inline toolbar** hides the "Turn into" row (and its divider) entirely for
    table selections instead of rendering it disabled — tables have no
    conversion targets.
  - **TOC block** declares `--rune-side-menu-top` at the first entry's text
    offset (block padding + entry padding-top), so the side-menu grip lines up
    with the first visible entry. `--block-pad-top` stays truthful to the
    block's real padding per the gutter contract.
  - **Slash menu** sticky sessions now track their run as a positionally
    mapped range (mapped through every transaction) instead of truncating at
    the caret. A caret-only move back into `/query` no longer splits the
    trigger decoration, re-shows the "Type to search" ghost mid-run, or drops
    query text; text typed inside the run stays contiguous; pre-existing text
    right of the run can never be absorbed into the query; and moving the
    caret out of the run dismisses the session.

- Updated dependencies [f6fb434]
- Updated dependencies [47e950a]
- Updated dependencies [f6fb434]
- Updated dependencies [ad833c0]
- Updated dependencies [69ccfd6]
- Updated dependencies [dd709e6]
- Updated dependencies [249e186]
- Updated dependencies [0d9c96e]
- Updated dependencies [1295950]
- Updated dependencies [bbe7081]
- Updated dependencies [3618f30]
- Updated dependencies [c07266f]
- Updated dependencies [f677a5c]
- Updated dependencies [69ccfd6]
- Updated dependencies [a7dc65d]
- Updated dependencies [eb2e040]
  - @ocai/rune-core@0.4.0

## 0.3.0

### Minor Changes

- 8d448ce: feat: copy link to block (host-configurable URL builder + onCopyLink callback) and new scrollToBlock helper. <RuneEditor> / <BlockActionsDropdown> accept buildBlockLink and onCopyLink; default builder stamps ?block=<id>. Multi-block selection disables the action in v1.
- 9093815: Inline AI rewrite now lives in the selection toolbar instead of a separate ⌘J popover. `InlineToolbar` grows a Quick-action preset list and a free-text instruction input below the formatting grid whenever a rewritable text selection is active; the loading/preview/error surface (`RuneAiRewritePanel`) still anchors below the block. Wire it via the new `RuneEditor` `selectionRewrite={{ rewrite, available, presets }}` prop — the toolbar captures the selection session on selection change and re-arms after discard/accept.

  **Breaking:** `RuneAiSelectionToolbar` (and its `⌘J` keybinding) is removed. Hosts that mounted it as a child of `RuneEditor` should pass `selectionRewrite` to `RuneEditor` instead. The headless `useRuneAiRewrite` hook is unchanged and still exported.

- 51c0146: The inline AI rewrite **section** (Quick-action presets + instruction input,
  below the formatting grid) is now **host-rendered**, not shipped by rune. The
  `RuneEditor` `selectionRewrite` config gains a required
  `renderSection: (ai) => ReactNode` that receives the live `useRuneAiRewrite`
  handle; rune owns the gate (eligible selection, not mid-flight), positioning,
  anchoring, selection capture, stale-guard, undo-coalesced replace and abort, and
  still ships the default loading/preview/error panel (`RuneAiRewritePanel`). This
  lets consumers iterate the section UI without a rune release. Interactive
  elements inside `renderSection` must `preventDefault` on mousedown to keep the PM
  selection alive.

  **Breaking:**

  - `selectionRewrite.renderSection` is now **required**; rune renders no default
    section UI. Move your presets list + instruction input into it, wired to the
    `ai` handle (`instruction` / `setInstruction` / `submit` / `available`).
  - `selectionRewrite.presets` is **removed** (the host owns the section, so it
    owns its presets).
  - The `RuneAiPreset` type is **removed** from the public surface — define your
    own preset shape.
  - `InlineToolbar` swaps its `aiPresets` prop for `renderAiSection`.

  The headless `useRuneAiRewrite` hook and `RuneAiRewritePanel` are unchanged.

- 6473e75: feat(ai): introduce rune-ai — headless agent-tool surface for the Rune
  editor. Ships neutral tool descriptors (Zod-described) + editor executors for the V1
  batch: read_document, list_blocks, get_block, get_editor_context, get_selection,
  replace_selection, insert_blocks, update_block, delete_blocks, move_blocks, turn_into,
  indent_block, outdent_block. Transport (MCP/IPC) stays in the consuming app.

### Patch Changes

- 49d304e: Add `useRuneAiRewrite` headless hook + `RuneAiSelectionToolbar` default UI for AI text rewrite over a top-level text selection. The hook owns the hard parts (selection snapshot capture, phase state machine, stale guard, abort, two lazy anchors); the toolbar is a thin, product-logic-free default shell that hosts only supply a model-bound `rewrite` function to. Hosts wanting custom input/preview UI consume the hook directly and still get the machinery and anchors for free.

  `RuneSelectionSnapshot` gains a `containsInlineAtoms` flag (set when the range covers a non-text inline atom such as inline math or a node-form ref). These nodes carry no text and can't survive a plain-text round trip, so the AI toolbar keeps the menu open but disables submit with a reason rather than silently destroying them.

- b93c318: fix(block-drag): indicator no longer drifts when the editor scrolls inside a non-window scroll container (#209).
- 86a6d67: Add Notion-style paste handling for copied block links. RuneEditor can now recognize pasted block links, offer Mention/URL paste choices, and delegate cross-document block-link navigation to host apps.
- 86a6d67: Keep keyboard-created carets out of the viewport bottom comfort zone. Continuous Enter through empty paragraph blocks now scrolls the same way click placement does, so the active empty block stays visibly above the bottom edge while using Rune's existing tail scroll room.
- fb8b86a: Drop the `emptyDocument` placeholder special case.

  An empty document now resolves to the same `default` placeholder (`"/" for commands`) as any other focused empty block — no more "New page" page-title hint with `text-2xl font-semibold` typography. Consumers that embed Rune in their own page chrome (with their own title input above the editor) were getting a duplicate "New page" label inside the editor body. The simplest fix is to remove the special case rather than re-style around it.

  Removed: `PlaceholderConfig.emptyDocument`, the `"empty-document"` member of `PlaceholderState`, the `[data-placeholder-state="empty-document"]` CSS rule, and the `RuneEditor` default that set `emptyDocument: "New page"`.

  Per-type placeholders (e.g. empty-heading copy) are unchanged.

- b0766eb: chore: drop stale `VERSION` export from both package roots. The constant was hard-coded to `"0.2.2-alpha.0"` and never updated across 12 alpha bumps — the actual package version lives in `package.json`. No internal or external consumers were reading it; removed rather than wiring up build-time injection.
- 6f8e2a7: `<EmojiPicker>` and `<RuneEmojiPicker>` now accept an `emojibaseUrl` prop, forwarded to frimousse's `Picker.Root`. Lets host apps self-host the Emojibase JSON data instead of hitting the default jsdelivr CDN — useful for Electron renderers with strict `connect-src 'self'` CSPs, air-gapped deploys, or networks where jsdelivr is blocked. Bundle `emojibase-data` with your app and serve `{locale}/data.json` / `{locale}/messages.json` from the base URL you pass in. Defaults to `https://cdn.jsdelivr.net/npm/emojibase-data` when omitted, so existing call sites are unchanged.
- e79c4d4: `<EmojiPicker>` and `<RuneEmojiPicker>` now surface a failure state instead of hanging on "Loading…" when the Emojibase data fetch errors (frimousse otherwise swallows the error to the console). A HEAD probe runs alongside frimousse's loader; on failure the picker renders a default "Couldn't load emoji data" message with a Retry button. Override the UI via the new `renderError` prop, which receives `{ error, retry }`.

  Also adds `@ocai/rune-react/vite` — a Vite plugin that self-hosts the Emojibase JSON for the picker. It serves `<base>/<locale>/{data,messages}.json` via dev middleware and emits the same files as build assets, so a consumer just installs `emojibase-data`, adds `emojibase()` to their Vite plugins, and passes `emojibaseUrl="/emojibase"` (or whatever `base` they choose) to the picker. `vite` and `emojibase-data` are declared as optional peer dependencies.

- b239b3b: Add a macOS-style emoji picker (Frimousse + Emojibase, locally cached) exposed as a generic `<EmojiPicker>` from `@ocai/rune-react` for downstream reuse (e.g. document-title "Add icon" UI), composed in `<RuneEmojiPicker>` for the editor's `:` suggestion trigger. The popover never steals focus — filtering is driven by the trigger's typed query so the caret stays in the editor (Notion pattern). Slash-menu `Emoji` swaps the typed `/query` for `:` and force-opens the picker at that position. Trigger-store gains `forceOpenAt` (one-shot `shouldShow` bypass for programmatic spawns) and `dismissedAt` (per-position re-open gate so `:[char] → delete` stays closed until the `:` itself is removed or whitespace is inserted), giving the `:`-then-delete-and-retype flow Notion-style dismissal that `@tiptap/suggestion`'s own `dismissedRange` doesn't track (it only triggers on explicit Escape). Emoji popover shares the slash menu's transparent-track scrollbar style.
- 7872c9f: Add the EntityRefs decoration primitive and reactive wiki-link hooks for host-owned broken/title/icon state, plus broken wiki-link styling.
- d996959: Add block equation: Notion-style `T_EX` placeholder, KaTeX display
  rendering, auto-saving popover, turn-into integration (paragraph →
  equation block preserves inline math / text as LaTeX). Also polishes
  the slash menu ("Block Equation" + new icon), grip alignment, and the
  popover textarea sizing (76px → 373px auto-grow with a muted gray
  scrollbar matching the side menu).
- b02804d: `FloatingTableOfContents` — click-to-navigate now enters a real single-block `MultiBlockSelection` on the target heading instead of a 1.4s transient flash. Reasons: the prior flash raced against `scrollIntoView({behavior:"smooth"})` on long jumps (timer expired before the browser settled, so the user landed without visible feedback); MBS gives the same blue halo, persists until the user's next action, and slots into the existing keyboard-exit paths (Esc / arrow / click). The companion `data-rune-block-flash` attribute and its CSS co-selector are removed; the halo is now driven solely by the block-selection plugin's `data-block-selected` decoration.

  New props on `FloatingTableOfContentsProps`:

  - `position?: "fixed" | "absolute" | "sticky" | "none"` (default `"fixed"`). Use `"absolute"` / `"sticky"` inside a multi-pane shell where each editor has its own scroll root — otherwise multiple instances all pin to the same viewport corner. `"none"` emits no positioning utilities at all so the consumer fully owns layout.
  - `scrollOffset?: number` — pixels subtracted from the heading's top after `scrollIntoView`, deferred via `requestAnimationFrame` to avoid fighting the in-flight smooth-scroll. Use this when the scroll container has a sticky header / toolbar that would otherwise occlude the target.
  - `onJump?: (heading: TocHeading) => void` — called after the MBS dispatch. Use to sync external state (URL hash, breadcrumb, analytics).

  New barrel export: `extractHeadings(editor) → TocHeading[]`. Downstream consumers building their own outline / command-palette / breadcrumb UI no longer need to re-implement the top-level doc walk + heading-level filter.

- 5aa4360: feat(toc): add `<FloatingTableOfContents>` — a Notion-style right-edge minimap with a rune-specific hover card for click-to-navigate. Bars render the heading outline (geometry lifted from Notion's devtools snapshot); hovering the column opens a Popover listing every heading as a clickable row. Clicking a row scroll-anchors the block, drops the caret into the heading, and briefly flashes the target via a new `data-rune-block-flash` attribute that piggybacks on the existing `.rune-block::before` opacity transition (same visual token as block-selection, without entering MultiBlockSelection). Idle column opacity 0.15, state-driven hover (no CSS `:hover` flicker across the column→card gap), 150ms safe-travel grace timer.

  Exports: `FloatingTableOfContents`, `FloatingTableOfContentsProps`, `TocHeading`.

- 4907eb9: feat(heading): add Heading 4 (UI H4 → `<h5>`, internal level 5). Slash menu, `Mod-Alt-4` shortcut and `####` markdown rule all wired in. Visually H4 shares H3's CSS step (1.25em / 600 weight) — extra outline depth for SEO/a11y, not a new visual rhythm.
- 2da1cfa: fix(block-selection): leading-atom NodeSelection on initial mount.

  PM's `EditorState.create` defaults selection to `Selection.atStart(doc)`, which lands a `NodeSelection` on a selectable leaf atom (e.g. divider) when it is the first block — PM auto-applies `.ProseMirror-selectednode` and the atom paints with the selected background on a fresh, never-interacted-with editor (including read-only previews like version-history snapshots).

  Same root cause as the outside-click dismissal fix (8e1aecf); that commit covered one callback. This fixes the mount-time entry point with the same `textOnly findFrom` bias. `setContent` was investigated and does not reproduce — Tiptap's transaction maps the prior caret position through the replace, never landing a `NodeSelection` on the new leading atom.

- 45af935: Render bullet and numbered list markers with CSS pseudo-elements instead of marker DOM nodes, fixing marker-origin text drag selection.
- 3169260: Fix list placeholder overlap (#183): empty bullet/numbered/task blocks no longer paint the focus placeholder over the marker glyph or task checkbox. The placeholder text now renders as a `<span class="rune-placeholder-text">` widget inside the textblock's contentDOM, so flex layout pushes it after the marker. Bullet and numbered lists opt out of placeholder text by default (the painted marker is sufficient cue); task lists keep "To-do" copy. Outer `is-empty` / `data-placeholder` decoration attrs are unchanged for downstream consumers.
- fe37897: Add flat bullet, numbered, and task list blocks with depth-based marker rendering, decoration-driven numbered indices, GitHub-flavored task clipboard output, and nested-list flattening on paste.
- 4bd0100: Add blockquote and code block as basic blocks. Blockquote has the standard
  left-rule styling and the `> ` input rule. Code block stores `language`
  on the node (set via ` ```lang ` input rule) without runtime UI; Tab inserts
  two spaces, Enter is a soft newline. Syntax highlighting, language picker,
  caption, and wrap-toggle UI are deferred to follow-up issues.

  Factory addition: `createBlockExtension` accepts an optional `priority`,
  threaded through to the inner `Extension.create` so block-owned keymaps
  can outrank generic editor extensions like M8.5 `Indent`.

- 7409020: Table interactions foundation (M8.4e-c1): findCellContext / findCellBefore utilities, CellSelectionEdges decoration plugin (`.sel-edge-*` borders on CellSelection), TableMouseSelection plugin (cross-cell drag → CellSelection with same-table guard, native-text-drag suppression, pill / resize-cursor gates; no global appendTransaction coercion), PinColumnWidths (idempotent rAF-based column-width pin, `addToHistory: false`, retry-once on zero widths), and Enter-in-cell keymap (next-row same-column jump; defensive swallow of cross-cell / outside↔inside TextSelections).
- 18a8f3c: Add keyboard indent support: Tab / Shift-Tab on paragraph (numeric cap) and lists (structural, predecessor-driven), Enter / Backspace outdent on indented blocks, exit-to-paragraph on empty depth-0 list items, MBS batch indent, and `editor.commands.indentBlock` / `outdentBlock`. Also patches the M8.4a marker-cycle gap (decimal-only → kind-aware bullet/numbered cycle).
- 2953a7a: createBlockSpec gains opt-in `nodeView?` and `meta?` slots.

  - `nodeView` lets block specs provide a raw-DOM ProseMirror NodeView for the live editor while keeping `renderDOM` as the SSR and clipboard path.
  - `meta` exposes NodeSpec flags previously fixed by the factory: `selectable`, `code`, `isolating`, `defining`, and `hardBreakShortcut`. `defining` still defaults to `true`; Divider now opts into `defining: false`.

- 37a368e: fix(marquee): restore `.rune-editor` as default marquee zone, plus pending-replay for early `setMarqueeZone` calls

  After PR #195 retired `.rune-editor-surface`, marquee became strictly host-opt-in — without `<RuneMarqueeZone>` (or `setMarqueeZone(editor, …)`), marquee block-selection silently disappeared. Downstream consumers who upgraded to `0.3.0-alpha.13` and don't wrap their page in `<RuneMarqueeZone>` saw their drag-from-padding gesture stop producing the blue rect overlay + MBS.

  This change restores the editor's own padding as a default marquee zone, while keeping `<RuneMarqueeZone>` for hosts who need to widen the zone past `.rune-editor` (e.g. Notion-style page gutters and title rows).

  ### Behavior

  - The plugin auto-installs `.rune-editor` as the default marquee zone (data-rune-marquee-zone attribute, mousedown listener, the works). React + Tiptap mount timing is handled with a one-frame rAF retry, mirroring `shared/wrapper-listener.ts`.
  - `<RuneMarqueeZone>` / `setMarqueeZone(editor, element)` still **replaces** the default with a wider host element when registered. Unmounting / disposing the host zone reverts to the default rather than disabling marquee.
  - `setMarqueeZone(editor, null)` now reverts to the default zone (previously: disabled marquee entirely). If you were calling this to deliberately turn marquee off, switch to ignoring the editor padding via CSS or filter on `isMarqueeEligibleTarget` in your own handlers.
  - `setMarqueeZone(editor, element)` is now safe to call before the marquee plugin's `view()` has installed its attacher — calls land in a pending queue and replay automatically. Hosts no longer need `requestAnimationFrame` workarounds to time their registration.
  - Marquee now respects `view.editable`: read-only editors no longer arm marquee on padding mousedown (matches the AGENTS rule for gesture entries).

  ### Drag-extend interaction

  `drag-extend`'s entry B still owns in-block vertical padding (`.rune-block` interior, outside `.rune-block-content`). Marquee owns `.rune-editor` / `.ProseMirror` empty-area padding. The boundary is exactly `isMarqueeEligibleTarget`'s `.rune-block` exclusion — no double-dispatch.

  ### Migration

  - If you wrap your page in `<RuneMarqueeZone>` to widen the marquee region, nothing changes.
  - If you don't, marquee now works inside `.rune-editor` padding — the pre-PR-#195 behavior is restored.
  - If you were relying on `setMarqueeZone(editor, null)` to disable marquee, that no longer disables; please file an issue if you need an explicit disable API.

  Closes the regression introduced by #195.

- d3ed9ef: fix(marquee): register host wrapper after async editor handoff

  `<RuneMarqueeZone>` now uses a state-tracked callback ref so its
  registration effect re-runs when either `editor` becomes non-null OR the
  DOM node mounts — whichever lands last. The previous `useRef +
useEffect([editor])` shape could miss the host registration entirely
  when a host page hands the editor over asynchronously (e.g.
  `queueMicrotask(() => setEditor(ed))` inside `onReady`, the common
  pattern for hosts that need the editor as state for sibling components
  like the slash menu, link menu, floating TOC, etc.) under React 19 +
  React Compiler. Symptom: `[data-rune-marquee-zone]` stays on
  `.rune-editor` instead of moving to the host wrapper, so marquee only
  fires inside the editor and drags from host gutters / title rows / cover
  area do nothing.

  No public API change — host code keeps using `<RuneMarqueeZone editor={editor}>`
  as before.

- d1c57a8: fix(marquee): restore host-zone marquee starts from page-shape siblings

  Wider `<RuneMarqueeZone>` / `setMarqueeZone()` host zones now treat page-shape siblings of `.rune-editor` (title, cover, icon, controls rows) as marquee territory again. This restores the Notion-style page wrapper behavior where dragging from a page title row or other host-owned document chrome can select body blocks.

  Host UI that lives inside the wider zone but should not start marquee can opt out by adding `data-rune-marquee-skip` to the chrome root.

- 7f9b1d7: fix(block-selection): keep marquee MBS stable across user scroll and
  restore PM focus after a committed marquee so Delete/Backspace work.
- ed3773a: Add React math rendering and editing UX for inline math and equation blocks.
- 0dd7d86: Add video and audio media blocks with shared upload/link source picking, provider embed support, and side-menu Replace actions.
- 75e7078: Clarify image, media, and shared source block naming across styles and exported types.
- f0e459b: Block-selection visual polish: MBS highlight is now an inset `::before` halo (inset 2px, radius 4px) with a 200ms opacity fade, matching Notion's `.notion-selectable-halo`. Adjacent selected blocks read as separate rounded pills with a 4px gap instead of one fused slab. Marquee overlay loses its border and gains a matching 4px radius.
- 0945d62: feat(block-selection,suggestion-menu): outside-click MBS dismissal + Notion-style suggestion menu polish.

  `block-selection`: document-level pointerdown listener clears MBS on clicks anywhere outside the selected blocks — not only inside `.rune-editor`. Bails when target is `.rune-block` (PM owns), a Radix portal, the side-menu grip, or a different `.rune-editor` (nested-editor isolation). Tail-click bails while MBS is active so a tail click only clears the selection — no incidental paragraph append.

  `suggestion-menu`: popover sizing aligned with Notion (`w-[324px]`, `min-w-45`, `max-w-[calc(100vw-24px)]`, `max-h-[min(40vh,28rem)]`). Inner scroller with symmetric top/bottom mask-image fade keeps the popover ring/shadow intact. Shortcut hint uses lighter `text-muted-foreground/60`; thin (6px) low-contrast scrollbar via color-mix over `--muted-foreground`.

- d9105d0: Tighten `PlaceholderConfig` so typo'd block names fail loudly instead of silently no-op'ing.

  The open index signature `[blockType: string]: PlaceholderResolver | undefined` accepted any key — `paragrahp`, an unshipped block name, etc. — and `resolve.ts` then fell through to `default` at runtime with no warning. Consumers had no signal their per-type override wasn't taking effect.

  - **Compile-time guard**: per-type keys are now constrained to the new `RuneBlockTypeName` union (the 10 built-in block names). Misspelled built-in keys are a TS error.
  - **Runtime guard**: at editor init the Placeholder plugin scans `placeholders` keys and `console.warn`s for any that don't match `schema.nodes`. Covers downstream blocks registered via `createBlockSpec` (not in the union) and any consumer who casts past the type.

  No behavior change for correct configurations. `RuneBlockTypeName` is exported from `@ocai/rune-core` for downstream typing.

  Closes #178.

- 0a26432: Re-export `Extension`, `Node`, `Mark` from `@tiptap/core` as values. Lets downstream apps wrap a raw ProseMirror `Plugin` in a Tiptap Extension (e.g. to install a decoration plugin reactive to host data) without taking a direct `@tiptap/core` dependency. `@tiptap/react` doesn't surface these constructors itself, so previously consumers had to add `@tiptap/core` alongside `@ocai/rune-react` just to author one plugin — defeating the single-package contract the existing `EditorContent` / `EditorProvider` / `useCurrentEditor` re-exports already establish.
- 4957386: docs(readme): widen quick-start version range from pinned `0.2.2-alpha.3` to `^0.2.2-alpha.0`. The pinned example was hard-coded and went stale every alpha bump (most recently the real published version was `0.2.2-alpha.12`). The caret-prerelease form picks up successive alphas of the `0.2.2` line automatically; consumers who want to pin can still override.
- 0945d62: docs(readme): rewrite Quick start to match the current playground shape, document 0.x changeset convention.

  Quick start: adds a "Page-shaped layout" section that wraps the editor in `<RuneMarqueeZone>` and wires `RuneSlashMenu` + `RuneEmojiPicker` + `RuneLinkMenu` — the recommended setup for Notion-style pages where marquee block-selection needs to start in the gutters or below the document, not just over the `.rune-editor` content column. The minimum example is kept for the simpler embed case. Links to the playground's `Root.tsx` and `page-layout.css` for the full grid layout.

  Working with changesets: documents the 0.x semver convention — default to `patch` for all non-breaking changes (incl. features), reserve `minor` for breaking API changes, `major` unused until 1.0.0. Aligns with npm's pre-1.0 guidance.

- 441da93: feat(readonly): honor `editor.setEditable(false)` across rune's own gesture and popover surfaces — side-menu, block-drag, block-selection drag-extend, table cell-handle / extend buttons / pills, inline toolbar, block-actions dropdown, and link hover card (keeps URL+Copy+Open, drops Edit). Block contents already inherit `contenteditable=false` from PM. New invariant: no NodeView may render `contenteditable="true"` (would pierce the inheritance). See the React package README's "Read-only mode" section.
- cfec81e: Add Delete and Duplicate items to the side-menu grip dropdown, with a "Text" / "Table" section label and a shared `NativeMenuLabel` primitive (also adopted by `ColorMenu`). New upstream helpers for downstream button-triggered copy: `serializeBlocksForClipboard` (core, pure) and `copyBlocksToClipboard` (react, synchronous multi-MIME write). Both honor `clipboardRenderDOM`, so the HTML matches Cmd+C output (no `.rune-block` / `data-id` / `data-depth` chrome leaks). Also re-exports `blockSelectionCommands` from core so consumers see `editor.commands.deleteBlockSelection` / `duplicateBlocks` on the typed Commands surface.
- 2678ea8: Drive side-menu block actions from block support metadata.
- f500058: feat(slash-menu): markdown-style punch-key shortcuts. Headings, blockquote, divider and code block now have symbol aliases (`#`/`##`/`###`, `>`, `---`, ` ``` `) so typing `/#` or `/>` filters to the right block. The slash menu shows the symbol alias on the right of each item in muted text.
- f005e37: feat(slash-menu): "Recently used" group on empty query. Tracks per-editor-instance usage of slash-menu items and pins the top 5 most recent to the head of the panel under a "Recently used" group; the original groups stay intact (items appear in both, like Notion). Frequency state lives at `editor.storage.suggestionMenus.frequency` keyed by trigger char and is exposed via `recordSuggestionUse` / `getSuggestionFrequency` / `pickRecentlyUsed` from `@ocai/rune-core` so hosts can serialize/rehydrate if they want session-spanning persistence. `DefaultReactSuggestionItem` now keeps `key` (was previously `Omit<..., "key">`); custom `getItems` callbacks must include a stable `key` per item.
- 95f3818: M8.2 follow-up: spec-driven CRUD API.

  createBlockSpec gains opt-in `toRuneBlock?` (read-side projection)
  and `fromInput?` (write-side construction). The api/ layer
  (getDocument / findBlocks / getBlockById / insertBlocks /
  updateBlock) is now type-agnostic - it dispatches via storage
  instead of switching on type names.

  Behavior change: `commands.updateBlock(id, { type: "heading" })`
  without a `level` now returns `false` (was: silently coerced level
  to 2). Pass `{ type: "heading", level }` explicitly.

  `RuneBlockInput` widened from a closed three-way union to
  distribute over `RuneBlock` - no api/types.ts edit needed when
  adding M8.4 blocks.

- 816eccc: Fix table drag previews, extend button hit areas, and side-menu alignment for indented tables.
- 00f708d: Table: header row / header column toggle in the per-pill dropdown.

  Adds two Tiptap commands and two pure read helpers:

  - `editor.commands.toggleTableHeaderRow({ tableStart, rowIndex })` — flips row 0's cells between `tableCell` and `tableHeader`. Mixed rows normalise to all-header on the first toggle. Rejects `rowIndex !== 0`.
  - `editor.commands.toggleTableHeaderColumn({ tableStart, colIndex })` — symmetric for column 0.
  - `isTableHeaderRow(table, rowIndex)` / `isTableHeaderColumn(table, colIndex)` — pure helpers exported from `@ocai/rune-core`, used by the switch's checked state.

  UI: the row pill dropdown shows a "Header row" switch only when the active pill is on row 0; the column pill dropdown shows "Header column" only on col 0. Toggling does not close the dropdown, so colour can be picked immediately afterward. Existing colour, insert, duplicate, clear, and delete actions are unchanged.

  Cell attrs (colwidth, textColor, backgroundColor) and inline content are preserved across toggles in either direction.

  Also adds a `NativeMenuSwitchItem` primitive in `@ocai/rune-react`'s `native-menu` barrel, for menu rows that hold a Radix-backed switch instead of an action button.

- 816eccc: Keep indented table block vertical spacing inside the table chrome instead of the outer block padding.
- f31bbd7: Add Turn-into block conversion support. Core now exposes a block
  conversion command backed by slash-menu target metadata, and React adds
  Turn-into controls to the block-actions dropdown and inline toolbar.
- 8733abc: Preserve toggle body indentation when converting toggles through Turn-into, and stop showing the task-list `[]` alias as a slash-menu shortcut hint.
- 31d818f: Add `iconText` slot to WikiLink `resolve()` for emoji / glyph page icons. The existing `icon` field stays mono-color via `mask-image`; the new `iconText` renders as CSS `content` so multi-color emoji keep their native color. When both are returned, `iconText` wins. Broken-state glyphs dim via `opacity + grayscale` instead of color override.
- 557db7d: Add the WikiLink inline mark for `[[...]]` syntax, including the `commitWikiLink` helper, input and paste rules, a ProseMirror click plugin that respects read-only behavior, kit-level URL link mutex/configuration, default React styles, and opaque host-owned targets.
- Updated dependencies [49d304e]
- Updated dependencies [b93c318]
- Updated dependencies [86a6d67]
- Updated dependencies [e79c4d4]
- Updated dependencies [8d448ce]
- Updated dependencies [fb8b86a]
- Updated dependencies [b0766eb]
- Updated dependencies [b239b3b]
- Updated dependencies [7872c9f]
- Updated dependencies [d996959]
- Updated dependencies [4802cdb]
- Updated dependencies [6232eab]
- Updated dependencies [4907eb9]
- Updated dependencies [8397320]
- Updated dependencies [2da1cfa]
- Updated dependencies [3379be2]
- Updated dependencies [5ffa8cb]
- Updated dependencies [45af935]
- Updated dependencies [3169260]
- Updated dependencies [fe37897]
- Updated dependencies [4bd0100]
- Updated dependencies [7409020]
- Updated dependencies [18a8f3c]
- Updated dependencies [e9de110]
- Updated dependencies [2953a7a]
- Updated dependencies [37a368e]
- Updated dependencies [d3ed9ef]
- Updated dependencies [d1c57a8]
- Updated dependencies [7f9b1d7]
- Updated dependencies [48a0c5a]
- Updated dependencies [ed3773a]
- Updated dependencies [ed3773a]
- Updated dependencies [0dd7d86]
- Updated dependencies [75e7078]
- Updated dependencies [629a6ee]
- Updated dependencies [f0e459b]
- Updated dependencies [0945d62]
- Updated dependencies [d9105d0]
- Updated dependencies [c1b9ea5]
- Updated dependencies [4957386]
- Updated dependencies [0945d62]
- Updated dependencies [441da93]
- Updated dependencies [6a65be2]
- Updated dependencies [6473e75]
- Updated dependencies [cfec81e]
- Updated dependencies [2678ea8]
- Updated dependencies [f500058]
- Updated dependencies [f005e37]
- Updated dependencies [95f3818]
- Updated dependencies [816eccc]
- Updated dependencies [00f708d]
- Updated dependencies [f31bbd7]
- Updated dependencies [8733abc]
- Updated dependencies [31d818f]
- Updated dependencies [557db7d]
  - @ocai/rune-core@0.3.0

## 0.3.0-alpha.25

### Minor Changes

- 51c0146: The inline AI rewrite **section** (Quick-action presets + instruction input,
  below the formatting grid) is now **host-rendered**, not shipped by rune. The
  `RuneEditor` `selectionRewrite` config gains a required
  `renderSection: (ai) => ReactNode` that receives the live `useRuneAiRewrite`
  handle; rune owns the gate (eligible selection, not mid-flight), positioning,
  anchoring, selection capture, stale-guard, undo-coalesced replace and abort, and
  still ships the default loading/preview/error panel (`RuneAiRewritePanel`). This
  lets consumers iterate the section UI without a rune release. Interactive
  elements inside `renderSection` must `preventDefault` on mousedown to keep the PM
  selection alive.

  **Breaking:**

  - `selectionRewrite.renderSection` is now **required**; rune renders no default
    section UI. Move your presets list + instruction input into it, wired to the
    `ai` handle (`instruction` / `setInstruction` / `submit` / `available`).
  - `selectionRewrite.presets` is **removed** (the host owns the section, so it
    owns its presets).
  - The `RuneAiPreset` type is **removed** from the public surface — define your
    own preset shape.
  - `InlineToolbar` swaps its `aiPresets` prop for `renderAiSection`.

  The headless `useRuneAiRewrite` hook and `RuneAiRewritePanel` are unchanged.

### Patch Changes

- @ocai/rune-core@0.3.0-alpha.25

## 0.3.0-alpha.24

### Minor Changes

- 9093815: Inline AI rewrite now lives in the selection toolbar instead of a separate ⌘J popover. `InlineToolbar` grows a Quick-action preset list and a free-text instruction input below the formatting grid whenever a rewritable text selection is active; the loading/preview/error surface (`RuneAiRewritePanel`) still anchors below the block. Wire it via the new `RuneEditor` `selectionRewrite={{ rewrite, available, presets }}` prop — the toolbar captures the selection session on selection change and re-arms after discard/accept.

  **Breaking:** `RuneAiSelectionToolbar` (and its `⌘J` keybinding) is removed. Hosts that mounted it as a child of `RuneEditor` should pass `selectionRewrite` to `RuneEditor` instead. The headless `useRuneAiRewrite` hook is unchanged and still exported.

### Patch Changes

- @ocai/rune-core@0.3.0-alpha.24

## 0.3.0-alpha.23

### Patch Changes

- 49d304e: Add `useRuneAiRewrite` headless hook + `RuneAiSelectionToolbar` default UI for AI text rewrite over a top-level text selection. The hook owns the hard parts (selection snapshot capture, phase state machine, stale guard, abort, two lazy anchors); the toolbar is a thin, product-logic-free default shell that hosts only supply a model-bound `rewrite` function to. Hosts wanting custom input/preview UI consume the hook directly and still get the machinery and anchors for free.

  `RuneSelectionSnapshot` gains a `containsInlineAtoms` flag (set when the range covers a non-text inline atom such as inline math or a node-form ref). These nodes carry no text and can't survive a plain-text round trip, so the AI toolbar keeps the menu open but disables submit with a reason rather than silently destroying them.

- Updated dependencies [49d304e]
- Updated dependencies [6a65be2]
  - @ocai/rune-core@0.3.0-alpha.23

## 0.3.0-alpha.22

### Patch Changes

- Updated dependencies [4802cdb]
  - @ocai/rune-core@0.3.0-alpha.22

## 0.3.0-alpha.21

### Minor Changes

- 6473e75: feat(ai): introduce rune-ai — headless agent-tool surface for the Rune
  editor. Ships neutral tool descriptors (Zod-described) + editor executors for the V1
  batch: read_document, list_blocks, get_block, get_editor_context, get_selection,
  replace_selection, insert_blocks, update_block, delete_blocks, move_blocks, turn_into,
  indent_block, outdent_block. Transport (MCP/IPC) stays in the consuming app.

### Patch Changes

- 86a6d67: Add Notion-style paste handling for copied block links. RuneEditor can now recognize pasted block links, offer Mention/URL paste choices, and delegate cross-document block-link navigation to host apps.
- 86a6d67: Keep keyboard-created carets out of the viewport bottom comfort zone. Continuous Enter through empty paragraph blocks now scrolls the same way click placement does, so the active empty block stays visibly above the bottom edge while using Rune's existing tail scroll room.
- 0dd7d86: Add video and audio media blocks with shared upload/link source picking, provider embed support, and side-menu Replace actions.
- 75e7078: Clarify image, media, and shared source block naming across styles and exported types.
- 2678ea8: Drive side-menu block actions from block support metadata.
- Updated dependencies [86a6d67]
- Updated dependencies [0dd7d86]
- Updated dependencies [75e7078]
- Updated dependencies [c1b9ea5]
- Updated dependencies [6473e75]
- Updated dependencies [2678ea8]
  - @ocai/rune-core@0.3.0-alpha.21

## 0.3.0-alpha.18

### Patch Changes

- 0a26432: Re-export `Extension`, `Node`, `Mark` from `@tiptap/core` as values. Lets downstream apps wrap a raw ProseMirror `Plugin` in a Tiptap Extension (e.g. to install a decoration plugin reactive to host data) without taking a direct `@tiptap/core` dependency. `@tiptap/react` doesn't surface these constructors itself, so previously consumers had to add `@tiptap/core` alongside `@ocai/rune-react` just to author one plugin — defeating the single-package contract the existing `EditorContent` / `EditorProvider` / `useCurrentEditor` re-exports already establish.
  - @ocai/rune-core@0.3.0-alpha.18

## 0.3.0-alpha.17

### Patch Changes

- Updated dependencies [48a0c5a]
  - @ocai/rune-core@0.3.0-alpha.17

## 0.3.0-alpha.16

### Patch Changes

- fix(marquee): register host wrapper after async editor handoff

  `<RuneMarqueeZone>` now uses a state-tracked callback ref so its
  registration effect re-runs when either `editor` becomes non-null OR the
  DOM node mounts — whichever lands last. The previous `useRef +
useEffect([editor])` shape could miss the host registration entirely
  when a host page hands the editor over asynchronously (e.g.
  `queueMicrotask(() => setEditor(ed))` inside `onReady`, the common
  pattern for hosts that need the editor as state for sibling components
  like the slash menu, link menu, floating TOC, etc.) under React 19 +
  React Compiler. Symptom: `[data-rune-marquee-zone]` stays on
  `.rune-editor` instead of moving to the host wrapper, so marquee only
  fires inside the editor and drags from host gutters / title rows / cover
  area do nothing.

  No public API change — host code keeps using `<RuneMarqueeZone editor={editor}>`
  as before.

- Updated dependencies
  - @ocai/rune-core@0.3.0-alpha.16

## 0.3.0-alpha.15

### Patch Changes

- fix(marquee): restore host-zone marquee starts from page-shape siblings

  Wider `<RuneMarqueeZone>` / `setMarqueeZone()` host zones now treat page-shape siblings of `.rune-editor` (title, cover, icon, controls rows) as marquee territory again. This restores the Notion-style page wrapper behavior where dragging from a page title row or other host-owned document chrome can select body blocks.

  Host UI that lives inside the wider zone but should not start marquee can opt out by adding `data-rune-marquee-skip` to the chrome root.

- Updated dependencies
  - @ocai/rune-core@0.3.0-alpha.15

## 0.3.0-alpha.14

### Patch Changes

- 37a368e: fix(marquee): restore `.rune-editor` as default marquee zone, plus pending-replay for early `setMarqueeZone` calls

  After PR #195 retired `.rune-editor-surface`, marquee became strictly host-opt-in — without `<RuneMarqueeZone>` (or `setMarqueeZone(editor, …)`), marquee block-selection silently disappeared. Downstream consumers who upgraded to `0.3.0-alpha.13` and don't wrap their page in `<RuneMarqueeZone>` saw their drag-from-padding gesture stop producing the blue rect overlay + MBS.

  This change restores the editor's own padding as a default marquee zone, while keeping `<RuneMarqueeZone>` for hosts who need to widen the zone past `.rune-editor` (e.g. Notion-style page gutters and title rows).

  ### Behavior

  - The plugin auto-installs `.rune-editor` as the default marquee zone (data-rune-marquee-zone attribute, mousedown listener, the works). React + Tiptap mount timing is handled with a one-frame rAF retry, mirroring `shared/wrapper-listener.ts`.
  - `<RuneMarqueeZone>` / `setMarqueeZone(editor, element)` still **replaces** the default with a wider host element when registered. Unmounting / disposing the host zone reverts to the default rather than disabling marquee.
  - `setMarqueeZone(editor, null)` now reverts to the default zone (previously: disabled marquee entirely). If you were calling this to deliberately turn marquee off, switch to ignoring the editor padding via CSS or filter on `isMarqueeEligibleTarget` in your own handlers.
  - `setMarqueeZone(editor, element)` is now safe to call before the marquee plugin's `view()` has installed its attacher — calls land in a pending queue and replay automatically. Hosts no longer need `requestAnimationFrame` workarounds to time their registration.
  - Marquee now respects `view.editable`: read-only editors no longer arm marquee on padding mousedown (matches the AGENTS rule for gesture entries).

  ### Drag-extend interaction

  `drag-extend`'s entry B still owns in-block vertical padding (`.rune-block` interior, outside `.rune-block-content`). Marquee owns `.rune-editor` / `.ProseMirror` empty-area padding. The boundary is exactly `isMarqueeEligibleTarget`'s `.rune-block` exclusion — no double-dispatch.

  ### Migration

  - If you wrap your page in `<RuneMarqueeZone>` to widen the marquee region, nothing changes.
  - If you don't, marquee now works inside `.rune-editor` padding — the pre-PR-#195 behavior is restored.
  - If you were relying on `setMarqueeZone(editor, null)` to disable marquee, that no longer disables; please file an issue if you need an explicit disable API.

  Closes the regression introduced by #195.

- Updated dependencies [37a368e]
  - @ocai/rune-core@0.3.0-alpha.14

## 0.3.0-alpha.13

### Minor Changes

- 8d448ce: feat: copy link to block (host-configurable URL builder + onCopyLink callback) and new scrollToBlock helper. <RuneEditor> / <BlockActionsDropdown> accept buildBlockLink and onCopyLink; default builder stamps ?block=<id>. Multi-block selection disables the action in v1.

### Patch Changes

- b0766eb: chore: drop stale `VERSION` export from both package roots. The constant was hard-coded to `"0.2.2-alpha.0"` and never updated across 12 alpha bumps — the actual package version lives in `package.json`. No internal or external consumers were reading it; removed rather than wiring up build-time injection.
- d996959: Add block equation: Notion-style `T_EX` placeholder, KaTeX display
  rendering, auto-saving popover, turn-into integration (paragraph →
  equation block preserves inline math / text as LaTeX). Also polishes
  the slash menu ("Block Equation" + new icon), grip alignment, and the
  popover textarea sizing (76px → 373px auto-grow with a muted gray
  scrollbar matching the side menu).
- 45af935: Render bullet and numbered list markers with CSS pseudo-elements instead of marker DOM nodes, fixing marker-origin text drag selection.
- ed3773a: Add React math rendering and editing UX for inline math and equation blocks.
- d9105d0: Tighten `PlaceholderConfig` so typo'd block names fail loudly instead of silently no-op'ing.

  The open index signature `[blockType: string]: PlaceholderResolver | undefined` accepted any key — `paragrahp`, an unshipped block name, etc. — and `resolve.ts` then fell through to `default` at runtime with no warning. Consumers had no signal their per-type override wasn't taking effect.

  - **Compile-time guard**: per-type keys are now constrained to the new `RuneBlockTypeName` union (the 10 built-in block names). Misspelled built-in keys are a TS error.
  - **Runtime guard**: at editor init the Placeholder plugin scans `placeholders` keys and `console.warn`s for any that don't match `schema.nodes`. Covers downstream blocks registered via `createBlockSpec` (not in the union) and any consumer who casts past the type.

  No behavior change for correct configurations. `RuneBlockTypeName` is exported from `@ocai/rune-core` for downstream typing.

  Closes #178.

- 4957386: docs(readme): widen quick-start version range from pinned `0.2.2-alpha.3` to `^0.2.2-alpha.0`. The pinned example was hard-coded and went stale every alpha bump (most recently the real published version was `0.2.2-alpha.12`). The caret-prerelease form picks up successive alphas of the `0.2.2` line automatically; consumers who want to pin can still override.
- 816eccc: Fix table drag previews, extend button hit areas, and side-menu alignment for indented tables.
- 816eccc: Keep indented table block vertical spacing inside the table chrome instead of the outer block padding.
- f31bbd7: Add Turn-into block conversion support. Core now exposes a block
  conversion command backed by slash-menu target metadata, and React adds
  Turn-into controls to the block-actions dropdown and inline toolbar.
- 8733abc: Preserve toggle body indentation when converting toggles through Turn-into, and stop showing the task-list `[]` alias as a slash-menu shortcut hint.
- Updated dependencies [8d448ce]
- Updated dependencies [b0766eb]
- Updated dependencies [d996959]
- Updated dependencies [6232eab]
- Updated dependencies [3379be2]
- Updated dependencies [45af935]
- Updated dependencies [ed3773a]
- Updated dependencies [ed3773a]
- Updated dependencies [d9105d0]
- Updated dependencies [4957386]
- Updated dependencies [816eccc]
- Updated dependencies [f31bbd7]
- Updated dependencies [8733abc]
  - @ocai/rune-core@0.3.0-alpha.13

## 0.2.2-alpha.12

### Patch Changes

- b02804d: `FloatingTableOfContents` — click-to-navigate now enters a real single-block `MultiBlockSelection` on the target heading instead of a 1.4s transient flash. Reasons: the prior flash raced against `scrollIntoView({behavior:"smooth"})` on long jumps (timer expired before the browser settled, so the user landed without visible feedback); MBS gives the same blue halo, persists until the user's next action, and slots into the existing keyboard-exit paths (Esc / arrow / click). The companion `data-rune-block-flash` attribute and its CSS co-selector are removed; the halo is now driven solely by the block-selection plugin's `data-block-selected` decoration.

  New props on `FloatingTableOfContentsProps`:

  - `position?: "fixed" | "absolute" | "sticky" | "none"` (default `"fixed"`). Use `"absolute"` / `"sticky"` inside a multi-pane shell where each editor has its own scroll root — otherwise multiple instances all pin to the same viewport corner. `"none"` emits no positioning utilities at all so the consumer fully owns layout.
  - `scrollOffset?: number` — pixels subtracted from the heading's top after `scrollIntoView`, deferred via `requestAnimationFrame` to avoid fighting the in-flight smooth-scroll. Use this when the scroll container has a sticky header / toolbar that would otherwise occlude the target.
  - `onJump?: (heading: TocHeading) => void` — called after the MBS dispatch. Use to sync external state (URL hash, breadcrumb, analytics).

  New barrel export: `extractHeadings(editor) → TocHeading[]`. Downstream consumers building their own outline / command-palette / breadcrumb UI no longer need to re-implement the top-level doc walk + heading-level filter.

  - @ocai/rune-core@0.2.2-alpha.12

## 0.2.2-alpha.11

### Patch Changes

- 5aa4360: feat(toc): add `<FloatingTableOfContents>` — a Notion-style right-edge minimap with a rune-specific hover card for click-to-navigate. Bars render the heading outline (geometry lifted from Notion's devtools snapshot); hovering the column opens a Popover listing every heading as a clickable row. Clicking a row scroll-anchors the block, drops the caret into the heading, and briefly flashes the target via a new `data-rune-block-flash` attribute that piggybacks on the existing `.rune-block::before` opacity transition (same visual token as block-selection, without entering MultiBlockSelection). Idle column opacity 0.15, state-driven hover (no CSS `:hover` flicker across the column→card gap), 150ms safe-travel grace timer.

  Exports: `FloatingTableOfContents`, `FloatingTableOfContentsProps`, `TocHeading`.

- Updated dependencies [8397320]
  - @ocai/rune-core@0.2.2-alpha.11

## 0.2.2-alpha.10

### Patch Changes

- 31d818f: Add `iconText` slot to WikiLink `resolve()` for emoji / glyph page icons. The existing `icon` field stays mono-color via `mask-image`; the new `iconText` renders as CSS `content` so multi-color emoji keep their native color. When both are returned, `iconText` wins. Broken-state glyphs dim via `opacity + grayscale` instead of color override.
- Updated dependencies [31d818f]
  - @ocai/rune-core@0.2.2-alpha.10

## 0.2.2-alpha.9

### Patch Changes

- e79c4d4: `<EmojiPicker>` and `<RuneEmojiPicker>` now surface a failure state instead of hanging on "Loading…" when the Emojibase data fetch errors (frimousse otherwise swallows the error to the console). A HEAD probe runs alongside frimousse's loader; on failure the picker renders a default "Couldn't load emoji data" message with a Retry button. Override the UI via the new `renderError` prop, which receives `{ error, retry }`.

  Also adds `@ocai/rune-react/vite` — a Vite plugin that self-hosts the Emojibase JSON for the picker. It serves `<base>/<locale>/{data,messages}.json` via dev middleware and emits the same files as build assets, so a consumer just installs `emojibase-data`, adds `emojibase()` to their Vite plugins, and passes `emojibaseUrl="/emojibase"` (or whatever `base` they choose) to the picker. `vite` and `emojibase-data` are declared as optional peer dependencies.

- Updated dependencies [e79c4d4]
  - @ocai/rune-core@0.2.2-alpha.9

## 0.2.2-alpha.8

### Patch Changes

- 6f8e2a7: `<EmojiPicker>` and `<RuneEmojiPicker>` now accept an `emojibaseUrl` prop, forwarded to frimousse's `Picker.Root`. Lets host apps self-host the Emojibase JSON data instead of hitting the default jsdelivr CDN — useful for Electron renderers with strict `connect-src 'self'` CSPs, air-gapped deploys, or networks where jsdelivr is blocked. Bundle `emojibase-data` with your app and serve `{locale}/data.json` / `{locale}/messages.json` from the base URL you pass in. Defaults to `https://cdn.jsdelivr.net/npm/emojibase-data` when omitted, so existing call sites are unchanged.
  - @ocai/rune-core@0.2.2-alpha.8

## 0.2.2-alpha.7

### Patch Changes

- b239b3b: Add a macOS-style emoji picker (Frimousse + Emojibase, locally cached) exposed as a generic `<EmojiPicker>` from `@ocai/rune-react` for downstream reuse (e.g. document-title "Add icon" UI), composed in `<RuneEmojiPicker>` for the editor's `:` suggestion trigger. The popover never steals focus — filtering is driven by the trigger's typed query so the caret stays in the editor (Notion pattern). Slash-menu `Emoji` swaps the typed `/query` for `:` and force-opens the picker at that position. Trigger-store gains `forceOpenAt` (one-shot `shouldShow` bypass for programmatic spawns) and `dismissedAt` (per-position re-open gate so `:[char] → delete` stays closed until the `:` itself is removed or whitespace is inserted), giving the `:`-then-delete-and-retype flow Notion-style dismissal that `@tiptap/suggestion`'s own `dismissedRange` doesn't track (it only triggers on explicit Escape). Emoji popover shares the slash menu's transparent-track scrollbar style.
- 7872c9f: Add the EntityRefs decoration primitive and reactive wiki-link hooks for host-owned broken/title/icon state, plus broken wiki-link styling.
- Updated dependencies [b239b3b]
- Updated dependencies [7872c9f]
  - @ocai/rune-core@0.2.2-alpha.7

## 0.2.2-alpha.6

### Patch Changes

- cfec81e: Add Delete and Duplicate items to the side-menu grip dropdown, with a "Text" / "Table" section label and a shared `NativeMenuLabel` primitive (also adopted by `ColorMenu`). New upstream helpers for downstream button-triggered copy: `serializeBlocksForClipboard` (core, pure) and `copyBlocksToClipboard` (react, synchronous multi-MIME write). Both honor `clipboardRenderDOM`, so the HTML matches Cmd+C output (no `.rune-block` / `data-id` / `data-depth` chrome leaks). Also re-exports `blockSelectionCommands` from core so consumers see `editor.commands.deleteBlockSelection` / `duplicateBlocks` on the typed Commands surface.
- 557db7d: Add the WikiLink inline mark for `[[...]]` syntax, including the `commitWikiLink` helper, input and paste rules, a ProseMirror click plugin that respects read-only behavior, kit-level URL link mutex/configuration, default React styles, and opaque host-owned targets.
- Updated dependencies [cfec81e]
- Updated dependencies [557db7d]
  - @ocai/rune-core@0.2.2-alpha.6

## 0.2.2-alpha.5

### Patch Changes

- fix(block-selection): leading-atom NodeSelection on initial mount.

  PM's `EditorState.create` defaults selection to `Selection.atStart(doc)`, which lands a `NodeSelection` on a selectable leaf atom (e.g. divider) when it is the first block — PM auto-applies `.ProseMirror-selectednode` and the atom paints with the selected background on a fresh, never-interacted-with editor (including read-only previews like version-history snapshots).

  Same root cause as the outside-click dismissal fix (8e1aecf); that commit covered one callback. This fixes the mount-time entry point with the same `textOnly findFrom` bias. `setContent` was investigated and does not reproduce — Tiptap's transaction maps the prior caret position through the replace, never landing a `NodeSelection` on the new leading atom.

- Updated dependencies
  - @ocai/rune-core@0.2.2-alpha.5

## 0.2.2-alpha.4

### Patch Changes

- 441da93: feat(readonly): honor `editor.setEditable(false)` across rune's own gesture and popover surfaces — side-menu, block-drag, block-selection drag-extend, table cell-handle / extend buttons / pills, inline toolbar, block-actions dropdown, and link hover card (keeps URL+Copy+Open, drops Edit). Block contents already inherit `contenteditable=false` from PM. New invariant: no NodeView may render `contenteditable="true"` (would pierce the inheritance). See the React package README's "Read-only mode" section.
- Updated dependencies [441da93]
  - @ocai/rune-core@0.2.2-alpha.4

## 0.2.2-alpha.3

### Patch Changes

- 4907eb9: feat(heading): add Heading 4 (UI H4 → `<h5>`, internal level 5). Slash menu, `Mod-Alt-4` shortcut and `####` markdown rule all wired in. Visually H4 shares H3's CSS step (1.25em / 600 weight) — extra outline depth for SEO/a11y, not a new visual rhythm.
- 0945d62: feat(block-selection,suggestion-menu): outside-click MBS dismissal + Notion-style suggestion menu polish.

  `block-selection`: document-level pointerdown listener clears MBS on clicks anywhere outside the selected blocks — not only inside `.rune-editor`. Bails when target is `.rune-block` (PM owns), a Radix portal, the side-menu grip, or a different `.rune-editor` (nested-editor isolation). Tail-click bails while MBS is active so a tail click only clears the selection — no incidental paragraph append.

  `suggestion-menu`: popover sizing aligned with Notion (`w-[324px]`, `min-w-45`, `max-w-[calc(100vw-24px)]`, `max-h-[min(40vh,28rem)]`). Inner scroller with symmetric top/bottom mask-image fade keeps the popover ring/shadow intact. Shortcut hint uses lighter `text-muted-foreground/60`; thin (6px) low-contrast scrollbar via color-mix over `--muted-foreground`.

- 0945d62: docs(readme): rewrite Quick start to match the current playground shape, document 0.x changeset convention.

  Quick start: adds a "Page-shaped layout" section that wraps the editor in `<RuneMarqueeZone>` and wires `RuneSlashMenu` + `RuneEmojiPicker` + `RuneLinkMenu` — the recommended setup for Notion-style pages where marquee block-selection needs to start in the gutters or below the document, not just over the `.rune-editor` content column. The minimum example is kept for the simpler embed case. Links to the playground's `Root.tsx` and `page-layout.css` for the full grid layout.

  Working with changesets: documents the 0.x semver convention — default to `patch` for all non-breaking changes (incl. features), reserve `minor` for breaking API changes, `major` unused until 1.0.0. Aligns with npm's pre-1.0 guidance.

- f500058: feat(slash-menu): markdown-style punch-key shortcuts. Headings, blockquote, divider and code block now have symbol aliases (`#`/`##`/`###`, `>`, `---`, ` ``` `) so typing `/#` or `/>` filters to the right block. The slash menu shows the symbol alias on the right of each item in muted text.
- f005e37: feat(slash-menu): "Recently used" group on empty query. Tracks per-editor-instance usage of slash-menu items and pins the top 5 most recent to the head of the panel under a "Recently used" group; the original groups stay intact (items appear in both, like Notion). Frequency state lives at `editor.storage.suggestionMenus.frequency` keyed by trigger char and is exposed via `recordSuggestionUse` / `getSuggestionFrequency` / `pickRecentlyUsed` from `@ocai/rune-core` so hosts can serialize/rehydrate if they want session-spanning persistence. `DefaultReactSuggestionItem` now keeps `key` (was previously `Omit<..., "key">`); custom `getItems` callbacks must include a stable `key` per item.
- Updated dependencies [4907eb9]
- Updated dependencies [0945d62]
- Updated dependencies [0945d62]
- Updated dependencies [f500058]
- Updated dependencies [f005e37]
  - @ocai/rune-core@0.2.2-alpha.3

## 0.2.2-alpha.2

### Patch Changes

- fix(block-drag): indicator no longer drifts when the editor scrolls inside a non-window scroll container (#209).
- 00f708d: Table: header row / header column toggle in the per-pill dropdown.

  Adds two Tiptap commands and two pure read helpers:

  - `editor.commands.toggleTableHeaderRow({ tableStart, rowIndex })` — flips row 0's cells between `tableCell` and `tableHeader`. Mixed rows normalise to all-header on the first toggle. Rejects `rowIndex !== 0`.
  - `editor.commands.toggleTableHeaderColumn({ tableStart, colIndex })` — symmetric for column 0.
  - `isTableHeaderRow(table, rowIndex)` / `isTableHeaderColumn(table, colIndex)` — pure helpers exported from `@ocai/rune-core`, used by the switch's checked state.

  UI: the row pill dropdown shows a "Header row" switch only when the active pill is on row 0; the column pill dropdown shows "Header column" only on col 0. Toggling does not close the dropdown, so colour can be picked immediately afterward. Existing colour, insert, duplicate, clear, and delete actions are unchanged.

  Cell attrs (colwidth, textColor, backgroundColor) and inline content are preserved across toggles in either direction.

  Also adds a `NativeMenuSwitchItem` primitive in `@ocai/rune-react`'s `native-menu` barrel, for menu rows that hold a Radix-backed switch instead of an action button.

- Updated dependencies
- Updated dependencies [00f708d]
  - @ocai/rune-core@0.2.2-alpha.2

## 0.2.2-alpha.1

### Patch Changes

- 3169260: Fix list placeholder overlap (#183): empty bullet/numbered/task blocks no longer paint the focus placeholder over the marker glyph or task checkbox. The placeholder text now renders as a `<span class="rune-placeholder-text">` widget inside the textblock's contentDOM, so flex layout pushes it after the marker. Bullet and numbered lists opt out of placeholder text by default (the painted marker is sufficient cue); task lists keep "To-do" copy. Outer `is-empty` / `data-placeholder` decoration attrs are unchanged for downstream consumers.
- fe37897: Add flat bullet, numbered, and task list blocks with depth-based marker rendering, decoration-driven numbered indices, GitHub-flavored task clipboard output, and nested-list flattening on paste.
- 4bd0100: Add blockquote and code block as basic blocks. Blockquote has the standard
  left-rule styling and the `> ` input rule. Code block stores `language`
  on the node (set via ` ```lang ` input rule) without runtime UI; Tab inserts
  two spaces, Enter is a soft newline. Syntax highlighting, language picker,
  caption, and wrap-toggle UI are deferred to follow-up issues.

  Factory addition: `createBlockExtension` accepts an optional `priority`,
  threaded through to the inner `Extension.create` so block-owned keymaps
  can outrank generic editor extensions like M8.5 `Indent`.

- 7409020: Table interactions foundation (M8.4e-c1): findCellContext / findCellBefore utilities, CellSelectionEdges decoration plugin (`.sel-edge-*` borders on CellSelection), TableMouseSelection plugin (cross-cell drag → CellSelection with same-table guard, native-text-drag suppression, pill / resize-cursor gates; no global appendTransaction coercion), PinColumnWidths (idempotent rAF-based column-width pin, `addToHistory: false`, retry-once on zero widths), and Enter-in-cell keymap (next-row same-column jump; defensive swallow of cross-cell / outside↔inside TextSelections).
- 18a8f3c: Add keyboard indent support: Tab / Shift-Tab on paragraph (numeric cap) and lists (structural, predecessor-driven), Enter / Backspace outdent on indented blocks, exit-to-paragraph on empty depth-0 list items, MBS batch indent, and `editor.commands.indentBlock` / `outdentBlock`. Also patches the M8.4a marker-cycle gap (decimal-only → kind-aware bullet/numbered cycle).
- 7f9b1d7: fix(block-selection): keep marquee MBS stable across user scroll and
  restore PM focus after a committed marquee so Delete/Backspace work.
- Block-selection visual polish: MBS highlight is now an inset `::before` halo (inset 2px, radius 4px) with a 200ms opacity fade, matching Notion's `.notion-selectable-halo`. Adjacent selected blocks read as separate rounded pills with a 4px gap instead of one fused slab. Marquee overlay loses its border and gains a matching 4px radius.
- 95f3818: M8.2 follow-up: spec-driven CRUD API.

  createBlockSpec gains opt-in `toRuneBlock?` (read-side projection)
  and `fromInput?` (write-side construction). The api/ layer
  (getDocument / findBlocks / getBlockById / insertBlocks /
  updateBlock) is now type-agnostic - it dispatches via storage
  instead of switching on type names.

  Behavior change: `commands.updateBlock(id, { type: "heading" })`
  without a `level` now returns `false` (was: silently coerced level
  to 2). Pass `{ type: "heading", level }` explicitly.

  `RuneBlockInput` widened from a closed three-way union to
  distribute over `RuneBlock` - no api/types.ts edit needed when
  adding M8.4 blocks.

- Updated dependencies [5ffa8cb]
- Updated dependencies [3169260]
- Updated dependencies [fe37897]
- Updated dependencies [4bd0100]
- Updated dependencies [7409020]
- Updated dependencies [18a8f3c]
- Updated dependencies [7f9b1d7]
- Updated dependencies [629a6ee]
- Updated dependencies
- Updated dependencies [95f3818]
  - @ocai/rune-core@0.2.2-alpha.1

## 0.2.2-alpha.0

### Patch Changes

- fb8b86a: Drop the `emptyDocument` placeholder special case.

  An empty document now resolves to the same `default` placeholder (`"/" for commands`) as any other focused empty block — no more "New page" page-title hint with `text-2xl font-semibold` typography. Consumers that embed Rune in their own page chrome (with their own title input above the editor) were getting a duplicate "New page" label inside the editor body. The simplest fix is to remove the special case rather than re-style around it.

  Removed: `PlaceholderConfig.emptyDocument`, the `"empty-document"` member of `PlaceholderState`, the `[data-placeholder-state="empty-document"]` CSS rule, and the `RuneEditor` default that set `emptyDocument: "New page"`.

  Per-type placeholders (e.g. empty-heading copy) are unchanged.

- 2953a7a: createBlockSpec gains opt-in `nodeView?` and `meta?` slots.

  - `nodeView` lets block specs provide a raw-DOM ProseMirror NodeView for the live editor while keeping `renderDOM` as the SSR and clipboard path.
  - `meta` exposes NodeSpec flags previously fixed by the factory: `selectable`, `code`, `isolating`, `defining`, and `hardBreakShortcut`. `defining` still defaults to `true`; Divider now opts into `defining: false`.

- Updated dependencies [fb8b86a]
- Updated dependencies [e9de110]
- Updated dependencies [2953a7a]
  - @ocai/rune-core@0.2.2-alpha.0

## 0.2.1

### Patch Changes

- f3721aa: Add body block bleed support through BlockSpecConfig. The playground now demonstrates a Notion-like host page shell where the page title lives outside the ProseMirror body document while preserving Rune's existing side-menu hit-test surface.

  Also keep block color dropdown close transactions out of undo history and update playground e2e coverage for the current block selection behavior.

- Updated dependencies [f3721aa]
  - @ocai/rune-core@0.2.1

## 0.2.0

### Minor Changes

- 5b32273: Add keyboard block-move shortcuts (`Mod-ArrowUp/Down`, `Mod-Shift-ArrowUp/Down`) and mouse drag-extend multi-block selection. Drag from inside a block across into another block promotes to a `MultiBlockSelection`; auto-scroll engages near the viewport edges. Empty-area gutter-click entry is wired in code but its e2e is `fixme` pending a multi-editor playground layout fix. (#41, #44)
- 8643c4f: Inline color (M4b): drag-select text → floating toolbar → text/background color picker. Stores attrs on the textStyle mark via addGlobalAttributes; one <span> carries both attrs (no nesting). Closes #70.
- f5b122c: Light/dark color palette (M4c): default mode is now light; `.dark` on `<html>` or `<body>` flips backgrounds. Foregrounds are theme-invariant per Notion's design. Existing dark-mode documents render with darker, less-saturated text colors (Notion-aligned values; v1's were ~24–48 RGB units lighter). Closes #79; closes #35.

  Breaking — `COLORS[name].text` / `.background` / `.idleRing` / `.activeRing` (in `@ocai/rune-core`) renamed/removed:

  - `text` → `fg`
  - `background` → `bg`
  - `idleRing` / `activeRing` removed; rings now derive in CSS via `color-mix(in oklch, var(--rune-color-X-fg) ...)`

  Breaking — `<ColorIndicator>` (in `@ocai/rune-react`) prop signature changed:

  - now: `{ name, variant, bgName?, active?, size?, className? }`
  - was: `{ variant, textColor, bgColor, idleRing, activeRing, active?, size?, className? }`

- 89b4225: Placeholder hints for empty blocks. Adds consumer-injected kit placeholders,
  Notion-style defaults in RuneEditor, a PM decoration plugin, and CSS rendering
  for "New page", "/" command hints, and level-aware heading hints.
- ee68c45: Add Divider as the third built-in block. Divider is the first block built
  end-to-end through createBlockSpec + the M3 declarative-extension slot,
  replacing the previous @tiptap/extension-horizontal-rule wrapper. Pure-cursor
  navigation skips dividers (Q4); Backspace/Delete preserve them (Q5); only
  click -> NodeSelect -> Backspace deletes one (Q6). Plain-text serialization is
  deferred to the future Markdown export.
- 6263424: Multi-block drag: grip-drag a MultiBlockSelection to move all selected blocks as a contiguous run. Drop rebuilds the MBS over the moved range. Grip on a block outside the active MBS eagerly switches to a single-block drag and clears the MBS at mousedown (Notion behavior). Internal API: createPreview accepts sources: HTMLElement[]; executeReorder accepts {from, to, selectionMode}; BlockDrag plugin state holds draggingRange. (#40)

### Patch Changes

- f181e0e: Padding-drag reorder: dragging from the editor padding/gutter on a block already inside an active `MultiBlockSelection` now reorders the whole selected range (Notion-compat) instead of restarting drag-extend. Closes #97.
- 11bf6ab: Fix InlineToolbar's color trigger and ColorMenu active swatch when the selection doesn't start at a textblock's first position (#87). Previously `readActive` read `$pos.marks()` at `selection.from`, which at a boundary defaults to the LEFT-side text node's marks — missing a just-applied textStyle when the selection starts mid-text. Now uses `editor.getAttributes("textStyle")`, which scans the selection range and returns the leading mark's attrs.
- a0cf7af: Link color follows surrounding text color (#88).

  - Drop Tiptap Link mark priority below TextStyle so the rendered DOM nests `<span data-text-color><a>...</a></span>` instead of the reverse — applying an inline text color to a link now tints both the anchor glyph and its underline.
  - `<a>` defaults to `color: inherit`; new shared `:is(a, u)` rule uses `text-decoration-color: currentColor` with thickness/offset tokens shared by the link and underline marks.
  - Side fix: StarterKit 3.22 bundles `Underline` + `Link`; explicitly disable both in the StarterKit config so our copies own registration. Previously the duplicate names emitted a Tiptap warning and silently shadowed the priority override.
  - InlineToolbar: Link button glyph turns `--editor-accent` when the selection covers a link (v1 affordance preserved); LinkMenu popover row keeps its accent text. `--editor-accent` moved to `:root` so portaled toolbar UI can read it.

- Updated dependencies [5b32273]
- Updated dependencies [f181e0e]
- Updated dependencies [2e1dc3b]
- Updated dependencies [a0cf7af]
- Updated dependencies [9fd1282]
- Updated dependencies [8643c4f]
- Updated dependencies [f5b122c]
- Updated dependencies [89b4225]
- Updated dependencies [ee68c45]
- Updated dependencies [16e90e5]
- Updated dependencies [6263424]
  - @ocai/rune-core@0.2.0
