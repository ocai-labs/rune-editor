A2b — raw carriers inside a container, where mdast offsets stop describing the bytes the writer will produce.

This fixture is in `BYTE_EXACT`, and that is the point of it. Its prose is written as single unwrapped lines and its examples use fences rather than four-space indentation, so the only thing that can move a byte here is the codec's handling of the carriers below. A structural comparison cannot see this defect: doubled indentation re-reads as the same tree, so `same` stays true while the file drifts a little further on every save.

The source slice that A2 introduced is only sound at the root. Inside a list item, a blockquote or a table cell the offsets still point at the ORIGINAL source, which carries the container's own prefix — and the writer then adds that prefix again. Measured before the slice became context-aware:

```
- before <X\n  prop\n  /> after     → continuation lines indented FOUR spaces
> before <X\n> prop                 → continuation lines gained `> > `
```

A multi-line component inside a list item:

- before <CustomComponent
  prop={value}
  /> after
- an ordinary sibling item

The same inside a blockquote:

> before <CustomComponent
> prop={value}
> /> after

Single-line inline HTML nested in both, which has no continuation lines and so was never affected either way:

- an item with <span class="x">tags</span> in it

> a quote with <span class="y">tags</span> in it

Nested positions fall back to `node.value`, which CommonMark has already stripped to exactly what the writer will re-prefix. That is a degrade, not a guess: the indentation an author wrote inside a nested multi-line tag is not recoverable from a tree that never held it, and inventing bytes would be worse than normalizing them.

At ROOT level the slice is still taken, and the indentation still survives:

<CustomComponent
  prop={value}
/>
