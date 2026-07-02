# @ocai/rune-core

## 0.18.0

### Minor Changes

- d0c5416: rune-ai now edits through a styling-aware markdown round-trip instead of character offsets.

  **Read == write.** `exportMarkdown` and the AI read tools (`read_document`, `get_block`, `get_editor_context`) now serialize a styling-aware markdown dialect — inline color (`<span data-text-color="…">`), `<u>` underline, wiki links, and inline math all round-trip, produced from the same registry-driven walk the write path parses back. Inline `textColor`/`backgroundColor` and `underline`, previously dropped on export, are preserved. Plain text that looks like markdown is now escaped on serialize. `exportMarkdown(editor, { dialect: "styled" | "plain" })` — default `"styled"`; pass `"plain"` for user-facing export menus to drop the raw-HTML emissions.

  **New `apply_edits({ oldStr, newStr, blockId? })`.** The everyday text-edit tool: markdown find/replace, quote-don't-compute. The model copies `oldStr` verbatim from what a read tool showed and supplies replacement markdown — no offsets. A batch is one transaction / one undo step. Structured errors (`no-match`, `ambiguous-match`, `not-editable-lossless`) with recovery hints; a normalization ladder tolerates whitespace/quote drift.

  **New `apply_matching({ where, set })`.** Declarative bulk op with engine-guaranteed completeness for "all X → Y" (e.g. recolor every code span). Predicate vocabulary (`mark`/`blockType`/`hasTextColor`/`textMatches`) and transforms are schema-derived; enumerates every match itself, including text inside table cells, in one transaction.

  **Retirements (no back-compat).** `format_text` and `replace_selection` are removed (subsumed by `apply_edits`); `update_block`'s text-content path is removed (props/type/depth by id remain). Content-affecting `turn_into` is steered to `apply_edits`; `turn_into` stays for pure type flips. The AI tool surface is now 15 tools.

### Patch Changes

- d0c5416: Remove dead code and an unused dependency. Dropped the unused `@tiptap/extension-horizontal-rule` dependency from both packages (the divider is a custom `Divider` block — StarterKit's built-in horizontal rule stays disabled), trimming the install footprint. Also pruned internal dead code surfaced by `tsc --noUnusedLocals`: unused imports, a dead constant, a never-read NodeView field, and dead test helpers. No public API or runtime behavior change.

## 0.17.0

### Minor Changes

- 1c8dcb5: Paste Markdown text as blocks. Plain-text paste that looks like Markdown (and carries no rich `text/html`) is now rendered to HTML via `markdown-it` and run through the existing `transformPastedHTML` → DOMParser pipeline, so headings, GFM tables, fenced code (with language), bullet/numbered/task lists, blockquotes and dividers become real blocks instead of one literal paragraph per line.

  - HTML on the clipboard always wins, so Notion / Google Docs paste is unchanged; the Markdown path only runs for pure `text/plain` that passes a conservative `isMarkdown()` gate. Skipped inside tables and code blocks.
  - The heading axis is shifted down one tag (`#` → Heading level 2 … clamped at `<h5>`) to mirror rune's heading `toMarkdown` and keep `<h1>` reserved for the page title.

- e951aff: Add `markdownToDoc(markdown, schema, parseHTML?)` — an editor-less Markdown → rune doc JSON converter for one-click import (e.g. migrating an Obsidian vault: convert each `.md` file to a new page without mounting an editor).

  It reuses the same conversion core as Markdown paste (`markdownToHtml` → the schema-only `transformPastedHTMLDoc` → PM's DOMParser), so heading-axis shift, GFM tables, fenced code, lists and inline marks map identically to paste. Images keep their original `src` (no upload — local/relative paths are left for the importing app to re-host); a standalone image lands as a clean top-level block (no stray leading paragraph).

  It is editor-less, not DOM-less: the HTML→DOM step needs a DOM. In the browser this is automatic; in a Node/worker migration script pass the optional `parseHTML` backed by a headless DOM (e.g. linkedom). The transform uses only tag/nodeType checks, so any standards-compliant Document works — no global-DOM shim required. `markdownToHtml` and the `ParseHTML` type are also exported.

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

## 0.15.1

## 0.15.0

### Minor Changes

- daab3c8: feat(callout): add Notion-parity callout block with an emoji-picker UI

  - New `callout` built-in block — a rounded, tinted box with a leading emoji and inline text — pixel-matched to Notion Cloud (DevTools-measured): box `border-radius: 10px`, `1px` transparent border, `12px` padding, `8px` outer rhythm, `24px` icon / `21.6px` emoji, and the 66px single-line height (Notion's nested text-block inset reproduced via `--rune-callout-content-pad-y`). The colored box is `.rune-block-content`, so it rides the existing background-color palette for every Notion color and flips light/dark automatically; the default (no color) is gray.
  - Click the emoji to change it: a searchable picker (reusing the existing `frimousse` `EmojiPicker`) opens anchored to the icon. Selection writes the `icon` attribute via `setNodeAttribute` (content-safe — the text is never rebuilt). Adds the core `CalloutEmojiPopover` plugin with `openCalloutEmojiPopover` / `closeCalloutEmojiPopover` / `setCalloutIcon` commands and `getCalloutEmojiPopoverBlockId`, plus the React `CalloutEmojiPicker` mounted in `RuneEditor`.
  - Exposes `Callout` and `RuneCalloutBlock` from `@ocai/rune-core` (previously the block was only registered via the kit and wasn't importable).

## 0.14.1

### Patch Changes

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

- 4dc1858: Fix to-do (task list) clipboard serialization crashing the whole copy. The
  block's `clipboardRenderDOM` placed ProseMirror's content hole (`0`) as a
  sibling of the `<input>` and spacing inside `<li>`, which violates the
  `renderSpec` rule that a hole must be the only child of its immediate parent.
  This threw `RangeError: Content hole must be the only child of its parent
node` mid-serialize, aborting the entire clipboard write — so any Cmd-C (or
  button-triggered "copy page content") over a selection containing a checkbox
  silently produced nothing. The hole is now wrapped in a `<span>`.

  Bug was present since the to-do block was introduced; the existing test only
  asserted the spec array shape and never ran it through the serializer, so it
  codified the broken output. Added serialize-through regression tests that
  exercise the real `buildClipboardSerializer` path.

## 0.12.3

### Patch Changes

- da4e374: fix(core): to-do Tab indent no longer shifts left + markdown conversions keep indent

  Two independent indent bugs around the flat-depth model:

  - **Tab on a to-do moved the row left instead of indenting right.** The TaskList
    NodeView hand-rolls its DOM, and its `update()` rebuilt the root attributes
    with only `data-depth`, dropping the `--rune-block-depth` CSS variable that
    `editor-chrome.css` multiplies into the indent step. As soon as a to-do's
    depth changed (pressing Tab fires a NodeView update), the `[data-depth]` rule
    overrode the base padding with `calc(0 * step)` and pulled the row ~2px left.
    The NodeView now emits the variable too — concatenated with any decoration
    styles rather than clobbered — matching the factory's `depth.renderHTML`.
  - **Markdown conversions reset indentation to 0.** Converting an indented block
    via a block input rule (`[]`, `-`, `1.`, `#`, …) went through a bare
    `setBlockType`, which replaces a node's attributes wholesale, so `depth` (plus
    block color and id) snapped back to defaults. The conversion now merges the
    source block's attributes under the rule's props, preserving indent.

- 2b4b298: fix(toggle): use a portable selector when detecting a pasted toggle's body

  `extractTitleAndBody` located the toggle body container with
  `[id]:not(:scope > [id])`. `:scope` nested inside `:not()` is rejected by some
  selector engines (e.g. nwsapi, which jsdom uses) and throws at paste-import
  time. Replaced it with an explicit `querySelectorAll("[id]")` walk that picks
  the first id'd element which isn't a direct child of the root — equivalent, and
  portable across selector engines and browsers.

## 0.12.2

## 0.12.1

### Patch Changes

- Republish the caret-comfort and table extend-button fixes that were present on `main` but absent from the previously published `0.12.0` tarballs.

  The `0.12.0` package metadata and changelog included the caret-comfort off-screen guard and the table `+col` / `+row` caret-reveal fix, but the GitHub Packages tarballs were cut before those commits. This patch release publishes the intended built artifacts so downstream apps receive those fixes.

## 0.12.0

### Minor Changes

- 377e987: fix(core): pasting copied table cells no longer corrupts the table.

  Copying a cell selection inside the editor and pasting it into another cell mangled the grid — columns multiplied and only the first copied row landed (e.g. copy rows 15–30 of a table, widen it, paste into the new columns → only row 15's content appeared, plus stray extra rows/columns).

  Root cause: Rune's clipboard `handlePaste` runs FIRST in the `handlePaste` plugin chain and intercepted any clipboard carrying the internal `application/x-rune-doc` MIME (which every in-editor copy sets), doing a blanket `replaceSelection`. A cell-selection slice is `tableRow`/cell nodes opened at both ends; dropping that into a target cell via `replaceSelection` scrambles the table and short-circuits prosemirror-tables' cell-aware paste, which never got to run.

  - **core:** `handlePaste` now defers (`return false`) when the selection is inside a table (`isInTable`), letting prosemirror-tables' `clipCells`/`insertCells` tile the copied rectangle from the target cell. The `application/x-rune-doc` lossless path is unchanged outside tables; it's irrelevant in-cell anyway since cells hold `tableParagraph`, not body blocks (no id/depth to preserve). Pasting external tables (no rune-doc MIME) was already handled correctly and is unaffected.

- a7daf28: fix(core, ai): table block-writes recover or reject malformed input instead of silently dropping content

  An agent that authored a table through `insert_blocks` / `turn_into` / `update_block`
  with anything but the exact `rows: [{ cells: [{ text }], isHeader }]` shape got a
  **blank table reported as success** — the content vanished and the model was told it
  succeeded, which could send it into a blind retry loop. This was the only structured
  block missing the reject discipline `columnLayout` already had.

  **core — `table.fromInput` now honors a near-miss or rejects it:**

  - Recovers the deviations a model reliably emits: bare-string cells
    (`cells: ["a","b"]`), array-of-arrays rows (`rows: [["a","b"]]` — no `cells`
    wrapper), and a `content` cell key instead of `text`.
  - Parses a flat `|`/newline markdown table supplied in the `text` field (with
    header-separator detection).
  - Rejects (returns `null`) a populated attempt that carried content under a shape it
    can't map, and prose put in `text` — so `insert_blocks` surfaces
    `explainBlockInputRejection`'s actionable reason (the table's input description)
    instead of a silent blank. A genuinely-empty populated request still builds.

  **ai — write-tool descriptors now convey per-block content shape:** `insert_blocks`
  and `turn_into` (and the shared block-input schema) state that structured blocks
  carry content in nested fields (a table is `rows[].cells[].text`, a column layout is
  `columns[].children[]`) and point to `get_editor_context` for the exact shape — so
  the model emits the right shape at the source.

  A new `blockInputContract.test.ts` section asserts the invariant for every structured
  block: a near-miss must RECOVER or REJECT, never silently emit a content-less node.

### Patch Changes

- 5f21561: fix(core): caret-comfort no longer scrolls back to an off-screen caret on a blank-region click

  When the collapsed caret had been scrolled out of view below the fold (e.g. the
  caret sits in the last block and the user scrolls up), clicking a non-editable
  blank region that doesn't move the selection — a wide table's right overflow, the
  side-menu gutter widget — fired the `mouseup` comfort observer against the stale
  off-screen caret. `distanceFromBottom` went negative, so the deficit
  (`CARET_COMFORT_PX - distanceFromBottom`) ballooned into a large _downward_ scroll
  that yanked the viewport back down to the caret.

  `scrollCaretBottomIntoComfort` now bails when `distanceFromBottom < 0`: comfort is
  only ever a small upward nudge for a caret that's visible but riding the bottom
  edge, never a chase toward a caret below the fold. ProseMirror's own
  `scrollIntoView` already keeps a genuinely placed caret visible, so a real
  near-bottom caret is always `>= 0` by the time comfort runs.

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

## 0.11.2

### Patch Changes

- fix(core): text blocks parse a safe inline-markdown subset in their `text` input

  An AI/agent tool (or generate) habitually writes markdown into the plain `text`
  field — `**bold**`, `*italic*`, `` `code` ``, `~~strike~~`, `[label](url)`.
  Every text block rendered those as literal delimiter characters because
  `fromInput` built a plain `schema.text(text)` node.

  Text blocks (Paragraph, Heading, Blockquote, Bullet/Numbered/Task list, Toggle)
  now run the new `inlineContentFromText(schema, text)` instead, which parses a
  deliberately conservative inline-markdown subset into real marks. CodeBlock is
  unchanged — code stays literal. This covers `insert_blocks`, `update_block`,
  `turn_into`, and generate, since all route through `fromInput`.

  Conservative by design (a false positive on plain prose is worse than a missed
  mark): emphasis delimiters must hug non-space text (`2 * 3` is untouched), `_`
  only fires at word boundaries (`snake_case` stays literal), unclosed delimiters
  stay literal, code-span interiors are literal, `\*` escapes, links require a
  safe href scheme (http(s)/mailto/relative — never `javascript:`), and a mark
  absent from the schema falls back to literal text.

## 0.11.1

### Patch Changes

- fix(ai): an agent write that inserts a `/` no longer pops the slash menu

  When an AI/agent tool (`insert_blocks`, `update_block`, `turn_into`, `replace_selection`, …) inserted block text containing a `/` and left the caret after it, the document's slash suggestion menu opened — the user never typed the trigger, but the `requireTypedTrigger` gate's `transactionInsertedAt` check can't tell a programmatic insert from a keystroke.

  `runTool` now stamps `AGENT_WRITE_META` (newly exported from `@ocai/rune-core`) on every transaction a tool dispatches, by scoping an override on `editor.view.dispatch` for the duration of `execute` — one place that catches both `editor.commands.*` (block tools) and direct `editor.view.dispatch` (selection tools). The suggestion-menu trigger gate treats that meta exactly like a paste: no fresh session opens, and once-per-trigger suppression is armed at the anchor so a trailing caret-move there doesn't reopen it. User-typed triggers are unaffected.

## 0.11.0

## 0.10.0

### Minor Changes

- be7c9a7: fix(ai): `turn_into` now honors and validates the block fields it advertises.

  The `turn_into` agent tool advertises a FLAT block descriptor (`{ type, level, text, … }`, the same shape as `insert_blocks` / `update_block`), but the core `turnInto` command takes a NESTED `{ type, props?, content? }` shape. The tool cast between the two without translating, so `level` / `text` were silently dropped — a `turn_into` to a heading produced a default-level, source-text heading while reporting success, which could send an agent into a retry loop. Even a same-type conversion (heading → heading) dropped the requested level, and an illegal `level:1` produced a schema-invalid `<h1>` rather than being rejected.

  - **ai:** a single `toTurnIntoBlockInput()` translator maps the flat descriptor to the command's nested shape (replacing the raw cast). A `text`/`content` string — including `""` (clears) — overrides the block's content; an absent field preserves the source; every other key (e.g. heading `level`) becomes a validated prop.
  - **core:** every `turnInto` adapter (`buildTextblock` and `sameTypeAdapter`) now validates explicit props via `fromInput` — so an illegal heading `level` is rejected consistently with `insert_blocks` / `update_block` — and honors an explicit content override.
  - **core:** the Heading input schema now documents the 2–5 level range (level 1 is reserved for the page title; the UI's "Heading 1" = level 2), surfaced to agents via `get_editor_context`.

- 789b334: feat(ai): block-write tools now explain WHY an input was rejected, instead of an opaque "Command rejected the given input."

  `insert_blocks` / `update_block` / `turn_into` routed every failure through one opaque message, so an agent that sent e.g. an illegal heading `level:1` was told only "rejected" — no reason, no valid range — and tended to retry blindly. They now return an actionable reason drawn from the block's advertised input description (the same `schemaContext.input.description` that `get_editor_context` exposes), so the constraint lives in ONE place.

  - **core:** new `explainBlockInputRejection` / `explainBlockInputsRejection`. Given a block input that `fromInput` refuses, they surface that block's input description (e.g. heading's "level 2–5; level 1 is the page title"). They return `null` when the input IS constructible — the rejection was for another reason (e.g. placement / nesting) — so callers don't mis-attribute the cause.
  - **ai:** `runBlockCommand` accepts an optional `diagnose` callback invoked on rejection; `insert_blocks` / `update_block` / `turn_into` wire it. `update_block` also names an id-write attempt explicitly.

- b3a010c: refactor(react): remove the default AI UX from `@rune-react`, and the AI generate trigger from `@rune-core`.

  The batteries-included AI surface is gone — downstream apps already ship their own AI UI, so a default product UX in the library carried cost without benefit and forced AI logic to straddle two packages. Removed:

  - **react:** `useRuneAi`, `RuneAiBar`, `AiBlockPopover`, the in-place inline-diff preview (`RuneAiDiffPreview` + `setAiDiffPreview` / `clearAiDiffPreview` / `selectionTextSpans` / `diffSegmentsToRanges` / `isAiDiffPreviewAvailable` / `isAiDiffPreviewActive`), `diffWords`, and all related types. `RuneEditor` no longer accepts an `ai` prop (`RuneAiConfig` removed), `InlineToolbar` no longer accepts `ai` / `renderAiSection`, and `useRuneEditor` no longer registers the diff-preview extension. The "Press Space for AI" placeholder is gone.
  - **core:** the `AiTrigger` keymap (Space-in-empty-paragraph → generate) and its surface — `aiTriggerPluginKey`, `readAiGenerateRequest`, `canRequestAiGenerate`, `AiGenerateRequest`, `AiTriggerOptions` — plus the `kit.ai.generate` option. Also `insertGeneratedBlocks`, whose only caller was the removed generate flow.

  **Kept** (headless safe-write primitives, still used by `rune-ai`): `getSelectionSnapshot`, `replaceSelectionText`, `RuneSelectionSnapshot`, `RuneBlockInput`. The `rune-ai` headless tool package is unaffected.

  Hosts that want AI compose it on the core primitives (+ `rune-ai` tools) with their own hook and UI.

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

- c9a3209: feat(ai): `format_text` inline-mark tool + `setInlineMark` core command

  Agents can now apply or remove an inline mark (bold/italic/strike/code/
  underline/link/textStyle colour…) over a text range addressed by block-local
  character offsets — the same units `get_block` / `get_selection` return. No
  absolute ProseMirror positions cross the tool boundary.

  - core: `setInlineMark(editor, { blockId, from, to, mark, attrs?, unset?, expect? })`
    returning `RuneCommandResult`, plus the `posAtBlockOffset` resolver (the
    inverse of the read tools' offsets). One transaction = one undo step. Mark
    validity is decided by `editor.schema.marks` (unknown → `unsupported`), so new
    marks are supported with no change here; the optional `expect` echo rejects
    stale offsets instead of formatting the wrong span.
  - ai: registers the 14th tool `format_text`; `mark` is an open string (no enum)
    validated by core, `attrs` is freeform and validated by the mark's own schema.

- c9a3209: feat(ai): `set_block_color` tool + `setBlockColor` core command + schema palette

  Agents can now set or clear a block's text or background colour by id.

  - core: `setBlockColor(editor, { blockId, kind, name })` → `RuneCommandResult`, a
    thin block-id wrapper over the existing pos-addressed colour commands. One
    transaction = one undo. Colour-name validity by `COLOR_NAMES` (unknown →
    `invalid-input`); `"default"` clears; capability gated by the block spec's
    declared `supports` (so an Image rejects text colour even though it carries the
    attr at runtime) → `unsupported`.
  - core: `getRuneSchemaContext` now exposes a top-level `palette: ColorName[]` —
    the one shared colour vocabulary every colour surface draws from (block colour,
    the `textStyle` colour mark, future table cells). `supports.textColor` /
    `.backgroundColor` say which blocks can be coloured; `palette` says with which
    names.
  - ai: registers the 15th tool `set_block_color` (`kind` enum, `name` an open
    string validated by core).

  Also aligns `format_text`'s non-textblock rejection to `unsupported` (matching
  `replaceSelectionText` and `set_block_color`).

## 0.8.1

### Patch Changes

- 96f7b15: fix(ai): advertise `text` on block-write descriptors + accept `content` as a fallback

  The `insert_blocks` / `turn_into` / `update_block` tools modeled block content as
  an opaque `{ type, ...catchall }`, so the derived JSON Schema descriptor never
  mentioned `text`. Agents (especially smaller models) guessed `content`, which
  passed catchall validation and was then dropped by every text block's
  `fromInput` — inserting structurally-correct but **empty** blocks.

  - **rune-ai:** name `text` explicitly (optional, described) on the block-input
    and `update` schemas so the descriptor tells the model the canonical content
    field. `catchall` still keeps every other per-type prop open.
  - **rune-core:** as a defensive belt, every text block's `fromInput` (paragraph,
    heading, blockquote, bullet/numbered/task list, toggle, code) now accepts a
    string `content` as a fallback for `text`.

## 0.8.0

## 0.7.4

## 0.7.3

## 0.7.2

### Patch Changes

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

## 0.7.1

### Patch Changes

- a7652b8: Strip develop-stage back-compat shims, widen the AI rewrite bar, and align the selection toolbar's open direction with Notion.

  **Breaking — removed deprecated / duplicate-name exports** (no aliases kept; internal up/downstream, pre-1.0):

  - `renderPreviewBar` → use `renderBar` (one slot spanning loading / preview / error; branch on `ai.phase`).
  - `RuneAiAnchor` → use `RuneAnchor` (identical type).
  - Image-named media aliases → use the `Media*` canonicals: `ImageImport`→`MediaImport`, `ImagePopover`→`MediaPopover`, `getImageImportState`→`getMediaImportState`, `getImagePopoverBlockId`→`getMediaPopoverBlockId`, `imageImportPluginKey`→`mediaImportPluginKey`, `imagePopoverPluginKey`→`mediaPopoverPluginKey`, plus the `ImageImport{Input,Map,Options,State}` / `ImagePopoverState` type aliases. The `imageImport` storage key / extension name and the real image command/hook API (`insertImage`, `startImageUrlImport`, `openImagePopover`, `RuneImportImage*`, `InsertImageOptions`) are unchanged.

  **AI rewrite bar** (`RuneAiRewritePanel`): the bar-only panel now spans the anchor block's width instead of `w-max`, so a host's `renderBar` can pin its controls to the block's left/right edges (Notion's wide bar). The card-preview body keeps its fixed text column.

  **Selection toolbar** (`InlineToolbar`): now defaults to opening BELOW the selection (`side="bottom"`, matching Notion), flipping above only when it can't fit near the viewport bottom. The selection-height anchor keeps the toolbar off the selected text in either direction (#74).

## 0.7.0

## 0.6.1

## 0.6.0

## 0.5.0

### Minor Changes

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

## 0.4.0

### Minor Changes

- f6fb434: Columns Phase 2 (cross-surface block drag): block drag is now multi-surface.

  A block can be dragged between the page root and a column, between columns, or
  reordered within a column; dragging a column's last block out collapses the
  column / unwraps the layout (F2, "content stays put"). The drag gesture tracks
  the surface under the cursor and re-snapshots that surface's blocks on the fly,
  so the drop indicator spans the column it is over. Root↔root drag is unchanged.

  Selection after a column-touching drop lands a text caret (multi-block
  selection inside columns is a later phase); pure root→root drops keep the
  multi-block selection on the moved run, as before.

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

- f6fb434: Columns Phase 2 (F1/F2): unify the block-move execution path and change
  move-out-of-column behavior.

  - **F1 (internal):** drag-drop (`executeReorder`) and the `moveBlocks` command
    now share one move-execution core, `executeMoveSlice` (slice → delete →
    mapped insert → surface-local depth re-base). The old boundary-slice `throw`
    in `executeReorder` is retired in favor of a `console.warn` + `null` return.

  - **F2 (observable behavior change):** `moveBlocks` of a column's only block —
    or all of a column's blocks — OUT of that column now removes the emptied
    source column in the same transaction. If the layout drops below 2 columns it
    unwraps, splicing the surviving column's children to the layout's original
    root position ("content stays put"). Previously the emptied column was kept
    with a normalization-seeded empty paragraph. `deleteBlocks` is unchanged —
    deleting a column's last block still leaves the seeded empty paragraph
    (deleting content is not relocating it).

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

## 0.3.0

### Minor Changes

- 8d448ce: feat: copy link to block (host-configurable URL builder + onCopyLink callback) and new scrollToBlock helper. <RuneEditor> / <BlockActionsDropdown> accept buildBlockLink and onCopyLink; default builder stamps ?block=<id>. Multi-block selection disables the action in v1.
- 4802cdb: feat(core): `exportMarkdownFromDoc(content, options?)` — convert stored ProseMirror doc JSON to Markdown without a pre-existing editor or DOM. Internally builds a throwaway headless `Editor` with the full rune kit and destroys it after serializing, so non-browser consumers (Electron main process, servers, CLIs) get doc→markdown with zero direct `@tiptap/core` dependency.
- 6473e75: feat(ai): introduce rune-ai — headless agent-tool surface for the Rune
  editor. Ships neutral tool descriptors (Zod-described) + editor executors for the V1
  batch: read_document, list_blocks, get_block, get_editor_context, get_selection,
  replace_selection, insert_blocks, update_block, delete_blocks, move_blocks, turn_into,
  indent_block, outdent_block. Transport (MCP/IPC) stays in the consuming app.

### Patch Changes

- 49d304e: Add `useRuneAiRewrite` headless hook + `RuneAiSelectionToolbar` default UI for AI text rewrite over a top-level text selection. The hook owns the hard parts (selection snapshot capture, phase state machine, stale guard, abort, two lazy anchors); the toolbar is a thin, product-logic-free default shell that hosts only supply a model-bound `rewrite` function to. Hosts wanting custom input/preview UI consume the hook directly and still get the machinery and anchors for free.

  `RuneSelectionSnapshot` gains a `containsInlineAtoms` flag (set when the range covers a non-text inline atom such as inline math or a node-form ref). These nodes carry no text and can't survive a plain-text round trip, so the AI toolbar keeps the menu open but disables submit with a reason rather than silently destroying them.

- b93c318: fix(block-drag): indicator no longer drifts when the editor scrolls inside a non-window scroll container (#209).
- 86a6d67: Keep keyboard-created carets out of the viewport bottom comfort zone. Continuous Enter through empty paragraph blocks now scrolls the same way click placement does, so the active empty block stays visibly above the bottom edge while using Rune's existing tail scroll room.
- e79c4d4: `:` trigger now reopens the emoji picker when the user deletes the query down to the lone `:` and starts typing again. Previously a per-position dismissal kept the picker closed until the `:` itself was removed or a whitespace was inserted, which made the "delete and retype" flow feel broken. The `shouldShow` gate is now re-evaluated on every transaction, so flipping the query length back above zero re-opens the menu. Slash-menu → Emoji's `forceOpenAt` bypass for programmatic `:` inserts is unchanged.
- fb8b86a: Drop the `emptyDocument` placeholder special case.

  An empty document now resolves to the same `default` placeholder (`"/" for commands`) as any other focused empty block — no more "New page" page-title hint with `text-2xl font-semibold` typography. Consumers that embed Rune in their own page chrome (with their own title input above the editor) were getting a duplicate "New page" label inside the editor body. The simplest fix is to remove the special case rather than re-style around it.

  Removed: `PlaceholderConfig.emptyDocument`, the `"empty-document"` member of `PlaceholderState`, the `[data-placeholder-state="empty-document"]` CSS rule, and the `RuneEditor` default that set `emptyDocument: "New page"`.

  Per-type placeholders (e.g. empty-heading copy) are unchanged.

- b0766eb: chore: drop stale `VERSION` export from both package roots. The constant was hard-coded to `"0.2.2-alpha.0"` and never updated across 12 alpha bumps — the actual package version lives in `package.json`. No internal or external consumers were reading it; removed rather than wiring up build-time injection.
- b239b3b: Add a macOS-style emoji picker (Frimousse + Emojibase, locally cached) exposed as a generic `<EmojiPicker>` from `@ocai/rune-react` for downstream reuse (e.g. document-title "Add icon" UI), composed in `<RuneEmojiPicker>` for the editor's `:` suggestion trigger. The popover never steals focus — filtering is driven by the trigger's typed query so the caret stays in the editor (Notion pattern). Slash-menu `Emoji` swaps the typed `/query` for `:` and force-opens the picker at that position. Trigger-store gains `forceOpenAt` (one-shot `shouldShow` bypass for programmatic spawns) and `dismissedAt` (per-position re-open gate so `:[char] → delete` stays closed until the `:` itself is removed or whitespace is inserted), giving the `:`-then-delete-and-retype flow Notion-style dismissal that `@tiptap/suggestion`'s own `dismissedRange` doesn't track (it only triggers on explicit Escape). Emoji popover shares the slash menu's transparent-track scrollbar style.
- 7872c9f: Add the EntityRefs decoration primitive and reactive wiki-link hooks for host-owned broken/title/icon state, plus broken wiki-link styling.
- d996959: Add block equation: Notion-style `T_EX` placeholder, KaTeX display
  rendering, auto-saving popover, turn-into integration (paragraph →
  equation block preserves inline math / text as LaTeX). Also polishes
  the slash menu ("Block Equation" + new icon), grip alignment, and the
  popover textarea sizing (76px → 373px auto-grow with a muted gray
  scrollbar matching the side menu).
- 6232eab: Add `follow-prev` indent mode and make it the default for non-list blocks (paragraph / heading / blockquote / toggle). Tab on such a block now indents up to `(previous top-level block's depth) + 1` — letting a paragraph inserted between list items column-align with the surrounding list's text content (matches Notion's visual). Also fixes a caret-placement bug where Backspace-exiting an empty nested list item before a child block left the cursor in the wrong paragraph.
- 4907eb9: feat(heading): add Heading 4 (UI H4 → `<h5>`, internal level 5). Slash menu, `Mod-Alt-4` shortcut and `####` markdown rule all wired in. Visually H4 shares H3's CSS step (1.25em / 600 weight) — extra outline depth for SEO/a11y, not a new visual rhythm.
- 8397320: Expose `INTERNAL_NORMALIZATION_META` so consumers can detect user edits vs. rune's internal bookkeeping.

  - New constant `INTERNAL_NORMALIZATION_META` (`"rune/internal-normalization"`). Set on every rune-internal transaction that mutates the doc for housekeeping rather than user intent: `BlockId` id-backfill, `PinColumnWidths` colwidth pin, and `TableMergedCellsGuard` clamp. Downstream apps watching for "did the user edit" should filter `tr.docChanged && !tr.getMeta(INTERNAL_NORMALIZATION_META)`.
  - Bug fix: `TableMergedCellsGuard`'s appendTransaction now correctly tags its output with `addToHistory:false`. Previously the merged-cell clamp + `fixTables` rectangularization could land in the undo stack and was indistinguishable from a user edit, causing downstream "recent edits" trackers to fire on initial-load programmatic content (Notion paste via `setContent`, collab sync, etc.).

- 2da1cfa: fix(block-selection): leading-atom NodeSelection on initial mount.

  PM's `EditorState.create` defaults selection to `Selection.atStart(doc)`, which lands a `NodeSelection` on a selectable leaf atom (e.g. divider) when it is the first block — PM auto-applies `.ProseMirror-selectednode` and the atom paints with the selected background on a fresh, never-interacted-with editor (including read-only previews like version-history snapshots).

  Same root cause as the outside-click dismissal fix (8e1aecf); that commit covered one callback. This fixes the mount-time entry point with the same `textOnly findFrom` bias. `setContent` was investigated and does not reproduce — Tiptap's transaction maps the prior caret position through the replace, never landing a `NodeSelection` on the new leading atom.

- 3379be2: List drag now brings a list item's trailing deeper-depth chain with it, normalizes the moved chain's depth attributes to the drop site, and aligns the drop indicator with the resulting visible indent. No schema changes.
- 5ffa8cb: Enter on a non-empty list block (bullet / numbered / task) now creates a new same-kind sibling carrying the suffix content, instead of dropping the user out of the list to a paragraph. New `editor.commands.splitListBlock()`. Numbered list items get `start: null` on the new sibling (ListNumbering plugin auto-continues); task list items get `checked: false`. Heading and paragraph behavior unchanged. Closes #188.
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
- e9de110: Add the first public block CRUD API.

  - `createRuneKit()` now registers block commands for inserting, updating, deleting, and moving top-level Rune blocks without wrapping Tiptap's `Editor`.
  - `getDocument`, `getBlockById`, and `findBlocks` expose pure read APIs for the built-in block union.

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
- 48a0c5a: Host-registered marquee zones now survive `editor.registerPlugin(...)` (and any other state.reconfigure path). Previously, calling `editor.registerPlugin` from a downstream app — e.g. to install a wiki-link decoration plugin reactive to host data — destroyed every PM plugin view including marquee's, whose `destroy()` aggressively cleared the host's `setMarqueeZone` registration: `data-rune-marquee-zone` was stripped from the host wrapper and the mousedown listener was detached. The new plugin view then re-installed the `.rune-editor` default, silently degrading marquee away from the host's wider zone (or killing it entirely when the host wrapper covered title gutters / page-shape siblings that were the whole reason for the override). Downstream useEffects don't re-fire on PM reconfigure, so hosts had no way to recover without a workaround.

  Fixed by relocating the zone registry's lifetime from "plugin view" to "editor". The marquee plugin's `view().destroy()` is now listener-only; the registry entry + DOM `data-rune-marquee-zone` attribute persist across reconfigure cycles, and the new plugin view's init re-attaches the mousedown listener via a new persisted-registry branch (`zoneRegistry.get(view)` populated → reuse it, skip pending-replay and default-install). Terminal teardown is anchored to editor lifetime via `BlockSelection.onDestroy`, which calls the new `teardownMarqueeView(view)` helper before Tiptap unmounts the PM view — so `data-rune-marquee-zone` is still removed from host DOM when the editor itself goes away. Net: `setMarqueeZone(editor, hostEl)` is now a true register-once API, robust to any PM plugin lifecycle event downstream apps trigger.

- ed3773a: Math-aware clipboard text: `serializeBlocksForClipboard` now computes `text/plain` from the explicit slice via each node's `renderText`, so button-copy (and any other explicit-slice caller) round-trips equation LaTeX. Inline math `renderHTML` emits the `$latex$` source as text content so the default clipboard `text/html` is never an empty span.
- ed3773a: Add React math rendering and editing UX for inline math and equation blocks.
- 0dd7d86: Add video and audio media blocks with shared upload/link source picking, provider embed support, and side-menu Replace actions.
- 75e7078: Clarify image, media, and shared source block naming across styles and exported types.
- 629a6ee: Fix mixed-wrapper paste (#182): pasted HTML where a list shares a block-level wrapper with non-list siblings (e.g. `<div><p>intro</p><ul><li>a</li></ul></div>`) no longer drops the list kind on the way through `transformPastedHTML`. The post-flatten unwrap pass now splices children: flattened list wrappers are hoisted whole, known-block siblings are kept, unknown siblings are degraded in place. Order is preserved.
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

- c1b9ea5: fix: three correctness fixes in the AI-facing API surface. `getRuneSchemaContext` now clones the projected `indent` field instead of returning the editor's live config by reference, so mutating the descriptor can no longer corrupt the runtime indent cap. `replaceSelectionText` now reports the ids of every resulting top-level block for multiline input (previously it returned a stale original id and omitted interior new blocks). `createBlockSpec`'s JSON sanitizers use path-based cycle detection, so a shared-but-acyclic object reused across sibling `schemaContext` positions is preserved instead of being dropped as a cycle.
- 4957386: docs(readme): widen quick-start version range from pinned `0.2.2-alpha.3` to `^0.2.2-alpha.0`. The pinned example was hard-coded and went stale every alpha bump (most recently the real published version was `0.2.2-alpha.12`). The caret-prerelease form picks up successive alphas of the `0.2.2` line automatically; consumers who want to pin can still override.
- 0945d62: docs(readme): rewrite Quick start to match the current playground shape, document 0.x changeset convention.

  Quick start: adds a "Page-shaped layout" section that wraps the editor in `<RuneMarqueeZone>` and wires `RuneSlashMenu` + `RuneEmojiPicker` + `RuneLinkMenu` — the recommended setup for Notion-style pages where marquee block-selection needs to start in the gutters or below the document, not just over the `.rune-editor` content column. The minimum example is kept for the simpler embed case. Links to the playground's `Root.tsx` and `page-layout.css` for the full grid layout.

  Working with changesets: documents the 0.x semver convention — default to `patch` for all non-breaking changes (incl. features), reserve `minor` for breaking API changes, `major` unused until 1.0.0. Aligns with npm's pre-1.0 guidance.

- 441da93: feat(readonly): honor `editor.setEditable(false)` across rune's own gesture and popover surfaces — side-menu, block-drag, block-selection drag-extend, table cell-handle / extend buttons / pills, inline toolbar, block-actions dropdown, and link hover card (keeps URL+Copy+Open, drops Edit). Block contents already inherit `contenteditable=false` from PM. New invariant: no NodeView may render `contenteditable="true"` (would pierce the inheritance). See the React package README's "Read-only mode" section.
- 6a65be2: `replaceSelectionText` now refuses (returns an `unsupported` error) when the selection contains a non-text inline atom such as inline math or a node-form ref, instead of silently deleting it. These nodes carry no text — they never reached the replacement string — so a plain-text replacement would destroy them. The check uses the snapshot's `containsInlineAtoms` flag, making the core primitive safe on its own rather than relying on every caller to gate up front.
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

- f31bbd7: Add Turn-into block conversion support. Core now exposes a block
  conversion command backed by slash-menu target metadata, and React adds
  Turn-into controls to the block-actions dropdown and inline toolbar.
- 8733abc: Preserve toggle body indentation when converting toggles through Turn-into, and stop showing the task-list `[]` alias as a slash-menu shortcut hint.
- 31d818f: Add `iconText` slot to WikiLink `resolve()` for emoji / glyph page icons. The existing `icon` field stays mono-color via `mask-image`; the new `iconText` renders as CSS `content` so multi-color emoji keep their native color. When both are returned, `iconText` wins. Broken-state glyphs dim via `opacity + grayscale` instead of color override.
- 557db7d: Add the WikiLink inline mark for `[[...]]` syntax, including the `commitWikiLink` helper, input and paste rules, a ProseMirror click plugin that respects read-only behavior, kit-level URL link mutex/configuration, default React styles, and opaque host-owned targets.

## 0.3.0-alpha.25

## 0.3.0-alpha.24

## 0.3.0-alpha.23

### Patch Changes

- 49d304e: Add `useRuneAiRewrite` headless hook + `RuneAiSelectionToolbar` default UI for AI text rewrite over a top-level text selection. The hook owns the hard parts (selection snapshot capture, phase state machine, stale guard, abort, two lazy anchors); the toolbar is a thin, product-logic-free default shell that hosts only supply a model-bound `rewrite` function to. Hosts wanting custom input/preview UI consume the hook directly and still get the machinery and anchors for free.

  `RuneSelectionSnapshot` gains a `containsInlineAtoms` flag (set when the range covers a non-text inline atom such as inline math or a node-form ref). These nodes carry no text and can't survive a plain-text round trip, so the AI toolbar keeps the menu open but disables submit with a reason rather than silently destroying them.

- 6a65be2: `replaceSelectionText` now refuses (returns an `unsupported` error) when the selection contains a non-text inline atom such as inline math or a node-form ref, instead of silently deleting it. These nodes carry no text — they never reached the replacement string — so a plain-text replacement would destroy them. The check uses the snapshot's `containsInlineAtoms` flag, making the core primitive safe on its own rather than relying on every caller to gate up front.

## 0.3.0-alpha.22

### Minor Changes

- 4802cdb: feat(core): `exportMarkdownFromDoc(content, options?)` — convert stored ProseMirror doc JSON to Markdown without a pre-existing editor or DOM. Internally builds a throwaway headless `Editor` with the full rune kit and destroys it after serializing, so non-browser consumers (Electron main process, servers, CLIs) get doc→markdown with zero direct `@tiptap/core` dependency.

## 0.3.0-alpha.21

### Minor Changes

- 6473e75: feat(ai): introduce rune-ai — headless agent-tool surface for the Rune
  editor. Ships neutral tool descriptors (Zod-described) + editor executors for the V1
  batch: read_document, list_blocks, get_block, get_editor_context, get_selection,
  replace_selection, insert_blocks, update_block, delete_blocks, move_blocks, turn_into,
  indent_block, outdent_block. Transport (MCP/IPC) stays in the consuming app.

### Patch Changes

- 86a6d67: Keep keyboard-created carets out of the viewport bottom comfort zone. Continuous Enter through empty paragraph blocks now scrolls the same way click placement does, so the active empty block stays visibly above the bottom edge while using Rune's existing tail scroll room.
- 0dd7d86: Add video and audio media blocks with shared upload/link source picking, provider embed support, and side-menu Replace actions.
- 75e7078: Clarify image, media, and shared source block naming across styles and exported types.
- c1b9ea5: fix: three correctness fixes in the AI-facing API surface. `getRuneSchemaContext` now clones the projected `indent` field instead of returning the editor's live config by reference, so mutating the descriptor can no longer corrupt the runtime indent cap. `replaceSelectionText` now reports the ids of every resulting top-level block for multiline input (previously it returned a stale original id and omitted interior new blocks). `createBlockSpec`'s JSON sanitizers use path-based cycle detection, so a shared-but-acyclic object reused across sibling `schemaContext` positions is preserved instead of being dropped as a cycle.
- 2678ea8: Drive side-menu block actions from block support metadata.

## 0.3.0-alpha.18

## 0.3.0-alpha.17

### Patch Changes

- 48a0c5a: Host-registered marquee zones now survive `editor.registerPlugin(...)` (and any other state.reconfigure path). Previously, calling `editor.registerPlugin` from a downstream app — e.g. to install a wiki-link decoration plugin reactive to host data — destroyed every PM plugin view including marquee's, whose `destroy()` aggressively cleared the host's `setMarqueeZone` registration: `data-rune-marquee-zone` was stripped from the host wrapper and the mousedown listener was detached. The new plugin view then re-installed the `.rune-editor` default, silently degrading marquee away from the host's wider zone (or killing it entirely when the host wrapper covered title gutters / page-shape siblings that were the whole reason for the override). Downstream useEffects don't re-fire on PM reconfigure, so hosts had no way to recover without a workaround.

  Fixed by relocating the zone registry's lifetime from "plugin view" to "editor". The marquee plugin's `view().destroy()` is now listener-only; the registry entry + DOM `data-rune-marquee-zone` attribute persist across reconfigure cycles, and the new plugin view's init re-attaches the mousedown listener via a new persisted-registry branch (`zoneRegistry.get(view)` populated → reuse it, skip pending-replay and default-install). Terminal teardown is anchored to editor lifetime via `BlockSelection.onDestroy`, which calls the new `teardownMarqueeView(view)` helper before Tiptap unmounts the PM view — so `data-rune-marquee-zone` is still removed from host DOM when the editor itself goes away. Net: `setMarqueeZone(editor, hostEl)` is now a true register-once API, robust to any PM plugin lifecycle event downstream apps trigger.

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

## 0.3.0-alpha.15

### Patch Changes

- fix(marquee): restore host-zone marquee starts from page-shape siblings

  Wider `<RuneMarqueeZone>` / `setMarqueeZone()` host zones now treat page-shape siblings of `.rune-editor` (title, cover, icon, controls rows) as marquee territory again. This restores the Notion-style page wrapper behavior where dragging from a page title row or other host-owned document chrome can select body blocks.

  Host UI that lives inside the wider zone but should not start marquee can opt out by adding `data-rune-marquee-skip` to the chrome root.

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
- 6232eab: Add `follow-prev` indent mode and make it the default for non-list blocks (paragraph / heading / blockquote / toggle). Tab on such a block now indents up to `(previous top-level block's depth) + 1` — letting a paragraph inserted between list items column-align with the surrounding list's text content (matches Notion's visual). Also fixes a caret-placement bug where Backspace-exiting an empty nested list item before a child block left the cursor in the wrong paragraph.
- 3379be2: List drag now brings a list item's trailing deeper-depth chain with it, normalizes the moved chain's depth attributes to the drop site, and aligns the drop indicator with the resulting visible indent. No schema changes.
- 45af935: Render bullet and numbered list markers with CSS pseudo-elements instead of marker DOM nodes, fixing marker-origin text drag selection.
- ed3773a: Math-aware clipboard text: `serializeBlocksForClipboard` now computes `text/plain` from the explicit slice via each node's `renderText`, so button-copy (and any other explicit-slice caller) round-trips equation LaTeX. Inline math `renderHTML` emits the `$latex$` source as text content so the default clipboard `text/html` is never an empty span.
- ed3773a: Add React math rendering and editing UX for inline math and equation blocks.
- d9105d0: Tighten `PlaceholderConfig` so typo'd block names fail loudly instead of silently no-op'ing.

  The open index signature `[blockType: string]: PlaceholderResolver | undefined` accepted any key — `paragrahp`, an unshipped block name, etc. — and `resolve.ts` then fell through to `default` at runtime with no warning. Consumers had no signal their per-type override wasn't taking effect.

  - **Compile-time guard**: per-type keys are now constrained to the new `RuneBlockTypeName` union (the 10 built-in block names). Misspelled built-in keys are a TS error.
  - **Runtime guard**: at editor init the Placeholder plugin scans `placeholders` keys and `console.warn`s for any that don't match `schema.nodes`. Covers downstream blocks registered via `createBlockSpec` (not in the union) and any consumer who casts past the type.

  No behavior change for correct configurations. `RuneBlockTypeName` is exported from `@ocai/rune-core` for downstream typing.

  Closes #178.

- 4957386: docs(readme): widen quick-start version range from pinned `0.2.2-alpha.3` to `^0.2.2-alpha.0`. The pinned example was hard-coded and went stale every alpha bump (most recently the real published version was `0.2.2-alpha.12`). The caret-prerelease form picks up successive alphas of the `0.2.2` line automatically; consumers who want to pin can still override.
- 816eccc: Fix table drag previews, extend button hit areas, and side-menu alignment for indented tables.
- f31bbd7: Add Turn-into block conversion support. Core now exposes a block
  conversion command backed by slash-menu target metadata, and React adds
  Turn-into controls to the block-actions dropdown and inline toolbar.
- 8733abc: Preserve toggle body indentation when converting toggles through Turn-into, and stop showing the task-list `[]` alias as a slash-menu shortcut hint.

## 0.2.2-alpha.12

## 0.2.2-alpha.11

### Patch Changes

- 8397320: Expose `INTERNAL_NORMALIZATION_META` so consumers can detect user edits vs. rune's internal bookkeeping.

  - New constant `INTERNAL_NORMALIZATION_META` (`"rune/internal-normalization"`). Set on every rune-internal transaction that mutates the doc for housekeeping rather than user intent: `BlockId` id-backfill, `PinColumnWidths` colwidth pin, and `TableMergedCellsGuard` clamp. Downstream apps watching for "did the user edit" should filter `tr.docChanged && !tr.getMeta(INTERNAL_NORMALIZATION_META)`.
  - Bug fix: `TableMergedCellsGuard`'s appendTransaction now correctly tags its output with `addToHistory:false`. Previously the merged-cell clamp + `fixTables` rectangularization could land in the undo stack and was indistinguishable from a user edit, causing downstream "recent edits" trackers to fire on initial-load programmatic content (Notion paste via `setContent`, collab sync, etc.).

## 0.2.2-alpha.10

### Patch Changes

- 31d818f: Add `iconText` slot to WikiLink `resolve()` for emoji / glyph page icons. The existing `icon` field stays mono-color via `mask-image`; the new `iconText` renders as CSS `content` so multi-color emoji keep their native color. When both are returned, `iconText` wins. Broken-state glyphs dim via `opacity + grayscale` instead of color override.

## 0.2.2-alpha.9

### Patch Changes

- e79c4d4: `:` trigger now reopens the emoji picker when the user deletes the query down to the lone `:` and starts typing again. Previously a per-position dismissal kept the picker closed until the `:` itself was removed or a whitespace was inserted, which made the "delete and retype" flow feel broken. The `shouldShow` gate is now re-evaluated on every transaction, so flipping the query length back above zero re-opens the menu. Slash-menu → Emoji's `forceOpenAt` bypass for programmatic `:` inserts is unchanged.

## 0.2.2-alpha.8

## 0.2.2-alpha.7

### Patch Changes

- b239b3b: Add a macOS-style emoji picker (Frimousse + Emojibase, locally cached) exposed as a generic `<EmojiPicker>` from `@ocai/rune-react` for downstream reuse (e.g. document-title "Add icon" UI), composed in `<RuneEmojiPicker>` for the editor's `:` suggestion trigger. The popover never steals focus — filtering is driven by the trigger's typed query so the caret stays in the editor (Notion pattern). Slash-menu `Emoji` swaps the typed `/query` for `:` and force-opens the picker at that position. Trigger-store gains `forceOpenAt` (one-shot `shouldShow` bypass for programmatic spawns) and `dismissedAt` (per-position re-open gate so `:[char] → delete` stays closed until the `:` itself is removed or whitespace is inserted), giving the `:`-then-delete-and-retype flow Notion-style dismissal that `@tiptap/suggestion`'s own `dismissedRange` doesn't track (it only triggers on explicit Escape). Emoji popover shares the slash menu's transparent-track scrollbar style.
- 7872c9f: Add the EntityRefs decoration primitive and reactive wiki-link hooks for host-owned broken/title/icon state, plus broken wiki-link styling.

## 0.2.2-alpha.6

### Patch Changes

- cfec81e: Add Delete and Duplicate items to the side-menu grip dropdown, with a "Text" / "Table" section label and a shared `NativeMenuLabel` primitive (also adopted by `ColorMenu`). New upstream helpers for downstream button-triggered copy: `serializeBlocksForClipboard` (core, pure) and `copyBlocksToClipboard` (react, synchronous multi-MIME write). Both honor `clipboardRenderDOM`, so the HTML matches Cmd+C output (no `.rune-block` / `data-id` / `data-depth` chrome leaks). Also re-exports `blockSelectionCommands` from core so consumers see `editor.commands.deleteBlockSelection` / `duplicateBlocks` on the typed Commands surface.
- 557db7d: Add the WikiLink inline mark for `[[...]]` syntax, including the `commitWikiLink` helper, input and paste rules, a ProseMirror click plugin that respects read-only behavior, kit-level URL link mutex/configuration, default React styles, and opaque host-owned targets.

## 0.2.2-alpha.5

### Patch Changes

- fix(block-selection): leading-atom NodeSelection on initial mount.

  PM's `EditorState.create` defaults selection to `Selection.atStart(doc)`, which lands a `NodeSelection` on a selectable leaf atom (e.g. divider) when it is the first block — PM auto-applies `.ProseMirror-selectednode` and the atom paints with the selected background on a fresh, never-interacted-with editor (including read-only previews like version-history snapshots).

  Same root cause as the outside-click dismissal fix (8e1aecf); that commit covered one callback. This fixes the mount-time entry point with the same `textOnly findFrom` bias. `setContent` was investigated and does not reproduce — Tiptap's transaction maps the prior caret position through the replace, never landing a `NodeSelection` on the new leading atom.

## 0.2.2-alpha.4

### Patch Changes

- 441da93: feat(readonly): honor `editor.setEditable(false)` across rune's own gesture and popover surfaces — side-menu, block-drag, block-selection drag-extend, table cell-handle / extend buttons / pills, inline toolbar, block-actions dropdown, and link hover card (keeps URL+Copy+Open, drops Edit). Block contents already inherit `contenteditable=false` from PM. New invariant: no NodeView may render `contenteditable="true"` (would pierce the inheritance). See the React package README's "Read-only mode" section.

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

## 0.2.2-alpha.1

### Patch Changes

- 5ffa8cb: Enter on a non-empty list block (bullet / numbered / task) now creates a new same-kind sibling carrying the suffix content, instead of dropping the user out of the list to a paragraph. New `editor.commands.splitListBlock()`. Numbered list items get `start: null` on the new sibling (ListNumbering plugin auto-continues); task list items get `checked: false`. Heading and paragraph behavior unchanged. Closes #188.
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
- 629a6ee: Fix mixed-wrapper paste (#182): pasted HTML where a list shares a block-level wrapper with non-list siblings (e.g. `<div><p>intro</p><ul><li>a</li></ul></div>`) no longer drops the list kind on the way through `transformPastedHTML`. The post-flatten unwrap pass now splices children: flattened list wrappers are hoisted whole, known-block siblings are kept, unknown siblings are degraded in place. Order is preserved.
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

## 0.2.2-alpha.0

### Patch Changes

- fb8b86a: Drop the `emptyDocument` placeholder special case.

  An empty document now resolves to the same `default` placeholder (`"/" for commands`) as any other focused empty block — no more "New page" page-title hint with `text-2xl font-semibold` typography. Consumers that embed Rune in their own page chrome (with their own title input above the editor) were getting a duplicate "New page" label inside the editor body. The simplest fix is to remove the special case rather than re-style around it.

  Removed: `PlaceholderConfig.emptyDocument`, the `"empty-document"` member of `PlaceholderState`, the `[data-placeholder-state="empty-document"]` CSS rule, and the `RuneEditor` default that set `emptyDocument: "New page"`.

  Per-type placeholders (e.g. empty-heading copy) are unchanged.

- e9de110: Add the first public block CRUD API.

  - `createRuneKit()` now registers block commands for inserting, updating, deleting, and moving top-level Rune blocks without wrapping Tiptap's `Editor`.
  - `getDocument`, `getBlockById`, and `findBlocks` expose pure read APIs for the built-in block union.

- 2953a7a: createBlockSpec gains opt-in `nodeView?` and `meta?` slots.

  - `nodeView` lets block specs provide a raw-DOM ProseMirror NodeView for the live editor while keeping `renderDOM` as the SSR and clipboard path.
  - `meta` exposes NodeSpec flags previously fixed by the factory: `selectable`, `code`, `isolating`, `defining`, and `hardBreakShortcut`. `defining` still defaults to `true`; Divider now opts into `defining: false`.

## 0.2.1

### Patch Changes

- f3721aa: Add body block bleed support through BlockSpecConfig. The playground now demonstrates a Notion-like host page shell where the page title lives outside the ProseMirror body document while preserving Rune's existing side-menu hit-test surface.

  Also keep block color dropdown close transactions out of undo history and update playground e2e coverage for the current block selection behavior.

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
- 16e90e5: MultiBlockSelection: Backspace/Delete remove selected blocks (#42); Cmd/Ctrl+D duplicates the selection or containing block with fresh ids (#45).

  - `Backspace` / `Delete` on a `MultiBlockSelection` deletes the range in a single transaction, lands the caret at the end of the previous block (or the start of the new first block if the range started at index 0), or inserts a fresh paragraph if the doc would be empty. Replaces the M1 noop guard.
  - `Mod-d` (`Cmd-d` mac / `Ctrl-d` other) duplicates the selection: `TextSelection` clones the containing top-level block with the caret preserved at the same intra-block offset; `MultiBlockSelection` clones the range and the new selection covers the duplicates.
  - Block ids on duplicates are freshly minted (`nanoid(8)`) at insert time. This sidesteps a stepmap-vs-selection-mapping issue where letting `BlockId.appendTransaction` regenerate colliding ids after the fact would have downgraded the new MBS anchor to a TextSelection.
  - `MultiBlockSelection` now overrides `getBookmark()` so prosemirror-history round-trips the selection across undo/redo (previously undo restored the doc but downgraded the selection to TextSelection).

- 6263424: Multi-block drag: grip-drag a MultiBlockSelection to move all selected blocks as a contiguous run. Drop rebuilds the MBS over the moved range. Grip on a block outside the active MBS eagerly switches to a single-block drag and clears the MBS at mousedown (Notion behavior). Internal API: createPreview accepts sources: HTMLElement[]; executeReorder accepts {from, to, selectionMode}; BlockDrag plugin state holds draggingRange. (#40)

### Patch Changes

- f181e0e: Padding-drag reorder: dragging from the editor padding/gutter on a block already inside an active `MultiBlockSelection` now reorders the whole selected range (Notion-compat) instead of restarting drag-extend. Closes #97.
- 2e1dc3b: Scope drag-extend's initial `mousedown` listener to the owning `.rune-editor` instead of `document`, and document that page-gutter clicks outside the editor root are intentionally out of scope. This keeps entry B inside the editor wrapper while avoiding always-on document listeners. Closes #100.
- a0cf7af: Link color follows surrounding text color (#88).

  - Drop Tiptap Link mark priority below TextStyle so the rendered DOM nests `<span data-text-color><a>...</a></span>` instead of the reverse — applying an inline text color to a link now tints both the anchor glyph and its underline.
  - `<a>` defaults to `color: inherit`; new shared `:is(a, u)` rule uses `text-decoration-color: currentColor` with thickness/offset tokens shared by the link and underline marks.
  - Side fix: StarterKit 3.22 bundles `Underline` + `Link`; explicitly disable both in the StarterKit config so our copies own registration. Previously the duplicate names emitted a Tiptap warning and silently shadowed the priority override.
  - InlineToolbar: Link button glyph turns `--editor-accent` when the selection covers a link (v1 affordance preserved); LinkMenu popover row keeps its accent text. `--editor-accent` moved to `:root` so portaled toolbar UI can read it.

- 9fd1282: `MultiBlockBookmark` now uses `mapping.mapResult()` and tracks per-side `anchorDeleted` / `headDeleted` flags, falling back to `Selection.near` of the _surviving_ boundary — fully matching `MultiBlockSelection.map`'s shape for deleted ranges. Previously the bookmark used `mapping.map()` (no `deleted` flag), so a deletion that consumed the anchor block would silently produce an MBS over whatever incidentally survived; now those undos/redos collapse to a TextSelection like the live `.map()` path, near the side that wasn't inside the deleted range. Closes #92.
