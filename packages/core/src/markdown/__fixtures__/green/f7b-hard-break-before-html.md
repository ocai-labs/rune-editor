F7b — a hard break immediately followed by a raw `html` sibling. Found by this
gate's own fixture corpus (2026-07-30), fixed the same day.

`mdast-util-to-markdown` writes `\` + SPACE there instead of `\` + newline, and
`\ ` is a literal backslash in CommonMark — so the break was LOST on the next read
and a stray `\` was left in the text. That made it worse than F2②, which converges
and stays structurally stable.

The successor set was measured: `html` is the ONLY type that does this. Everything
else keeps the native form, so exactly these breaks take `<br>` — the same
resolution as F7's trailing-break rule, losslessness over the style default.

Each claimed carrier right after a soft-wrapped line. Before the fix these wrote
`alpha\ <u>bravo</u>` and lost the break:

alpha
<u>bravo</u>

charlie
==delta==

echo
<span data-text-color="red">foxtrot</span>

golf
<mark data-color="blue">hotel</mark>

A wiki link is a raw-html carrier too:

india
[[Some Note]]

Successors that must KEEP the native `\` form — these are the guardrails against
over-applying the rule:

juliet
kilo

lima
`code span`

mike
**bold**

november
*italic*

oscar
[a link](https://example.com)

papa
$$x^2$$

An html node NESTED inside a wrapper is safe, because the wrapper's own delimiter
comes between the break and the tag:

quebec
**<u>romeo</u>**
