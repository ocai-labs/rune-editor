A2 + source slice — a tag whose opening spans lines.

CommonMark only starts an HTML block on a KNOWN tag name, so a custom component
with a multi-line opening tag arrives as `paragraph[html]`: an INLINE html node,
which is why it needs `rawInline` rather than `rawBlock`.

It also needs the source slice. CommonMark strips the leading whitespace of a
paragraph's continuation lines before mdast is built, so the node's `value` never
held the indentation — only `position` does. This file was a known gap until the
slice landed; the indentation now survives.

    源            "<Custom\n  prop={v}\n/>\n"
    html.value    "<Custom\nprop={v}\n/>"        ← 缩进不在 value 里
    position 切片  "<Custom\n  prop={v}\n/>"      ← 只有切片有

Claiming it is still strictly better than the previous behaviour, which read the
SAME `value` — so it lost the indentation too AND added `\<` escapes on top.
This fixture stays here so the residue is reported rather than passing as success.

**This is the case that gives the step-8 source foundation a real consumer.** It
was deferred on the finding that root-level `node.value` is already byte-exact;
that finding holds, and this one is the counter-example that brings it back.

<CustomComponent
  prop={value}
  other="literal"
/>

<custom-thing
  prop="v"
/>

Single-line shapes are already byte-exact and must stay that way — they have no
continuation lines, so nothing is stripped:

<Custom prop={value} />

text <span class="x">middle</span> more
