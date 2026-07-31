A2 — bare HTML sitting INSIDE a paragraph, carried by `rawInline`.

mdast represents `<span class="x">middle</span>` as three independently
positioned nodes — html / text / html. An atom preserves that topology: the tags
are quarantined and the middle text stays ordinary editable content. Before A2 the
three merged into one text run, so the tags became literal text and the writer had
to escape them — the 201-file (17.5%) byte-damage class.

An atom rather than a mark, because a mark could do neither job: editing splits
and extends a mark, so one authored span would become several generated ones and
the source boundaries would be gone; and the unmatched and self-closing shapes
below have no text to attach a mark to at all.

An unrecognised paired tag, with the readable middle still editable text:

前面 <span class="x">中间</span> 后面.

An inline comment:

text <!-- inline note --> more text.

A self-closing tag with no rune meaning:

before <custom-thing /> after.

An UNMATCHED closing tag:

dangling </div> here.

An unmatched OPENING tag of a shape rune otherwise claims — it must stay source,
not become an underline:

broken <u> tag.

Raw source inside a mark run must not split the run:

**bold with <span class="y">tags</span> still bold** and *italic <b> too*.

Tags that rune DOES claim keep their first-class mapping and must NOT become raw
atoms — these are the collision guards:

<u>underline</u>, <mark data-color="blue">blue</mark>,
<span data-text-color="red">red</span>, and a hard break<br>after it.
