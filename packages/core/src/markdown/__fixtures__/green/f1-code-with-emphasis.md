F1 — a run carrying `code` together with bold / italic / strike used to drop the
emphasis mark entirely. The code span stays verbatim-innermost and the native
syntax wraps around it.

**`bold code`** and *`italic code`* and ~~`struck code`~~ and ***`both`***.

Mixed into prose: the **`format`** keeps asserting its own shape, which is the
exact run whose escape count doubled every save before the fix.

Marks that ride HTML carriers were never affected and must stay that way. Each
sits in its own single-line paragraph on purpose — a hard break immediately
followed by one of these wrappers hits a SEPARATE, still-open defect, covered by
`known-gaps/hard-break-before-html-carrier.md`.

<u>`underline code`</u> keeps both marks.

==`highlighted code`== keeps both marks.

<span data-text-color="red">`red code`</span> keeps both marks.
