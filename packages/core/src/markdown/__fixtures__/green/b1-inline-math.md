B1 — inline math. Both sides of this mapping already existed and were simply
never connected: mdast has `inlineMath`, and rune has an `inlineMath` atom whose
input rule is `$$latex$$` (`inlines/InlineMath/node.ts`). The codec used to throw
it into text alongside `html`, which dropped the `$$` delimiters on the way in and
had no case for the PM node at all on the way out.

The write side was the severe half: a formula the USER typed in the editor was
deleted outright on save, not merely downgraded.

Reading keeps the formula's identity:

行内公式 $$x^2$$ 混在文字里。

多个公式:$$a + b$$ 和 $$\frac{1}{2}$$ 在同一段。

Marks survive around the atom:

带 mark 的公式:**$$E = mc^2$$** 保住 bold。

*$$\alpha$$* 保住 italic,~~$$\beta$$~~ 保住 strike。

Block math was already supported and must stay unchanged:

$$
\int_0^1 x^2 dx
$$

A lone `$` is deliberately NOT math — `singleDollarTextMath: false` keeps prose
prices from being eaten:

价格是 $5 和 $6。
