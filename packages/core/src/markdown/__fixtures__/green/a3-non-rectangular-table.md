A3 — a GFM table whose rows do not all match the header's width.

NOT malformed: GFM explicitly permits body rows that differ from the header,
padding the short ones and dropping the extra cells. The source is legal and the
read side is correct. What it is not is RECTANGULAR, and rune's table node can
only hold a rectangle — so the damage was on the way out, and it invented
structure rather than merely reformatting:

    row wider   `| 1 | 2 | 3 |` under `| a | b |` → wrote `| a | b | |`
                (a THIRD COLUMN, appearing in the header)
    row narrower `| 1 |`         under `| a | b |` → wrote `| 1 | |`
                (an invented empty cell)

Truncating would throw away the user's bytes; merging into the last cell would
invent table semantics. The whole table is kept as raw source instead. The
predicate is exactly the measured shape — a width mismatch — so a table with
consistent widths is never touched.

| Desktop Component | Mobile Equivalent | How Accessed |
|---|---|---|
| **Titlebar** (3-section toolbar) | **MobileTitlebarPart** (☰ / title / +|👤) | Always visible at top |
| **Sidebar** (sessions list) | Drawer overlay (85% width) | Hamburger button (☰) |

Shape 2 — a literal two-character `\n` sequence written inside a row, so two
logical rows share one physical line. Real byte shape taken from
`vscode/src/vs/sessions/LAYOUT.md:713`:

| Date | Change |
| - | - |
| 2026-02-07 | Moved the action to avoid a layering violation |\n| 2026-02-07 | Added the menu IDs |
| 2026-02-06 | A well-formed row |
