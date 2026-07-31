F6 — a list item packs its block children onto consecutive lines. CommonMark's
lazy continuation then reads the next plain-text line as part of the construct
above it, so these four families lost a block entirely. Exactly these boundaries
get a blank line, and only these.

Family 1 — list followed by paragraph (the measured content loss):

- item
  - nested

  tail paragraph must survive as its own block

Family 2 — blockquote followed by paragraph:

- item
  > quoted

  tail after quote

Family 3 — two blockquotes in a row must not merge:

- item
  > first quote

  > second quote

Family 4 — paragraph followed by a thematic break. The hazard runs backwards
here: `---` directly under a paragraph is a setext underline, so the PARAGRAPH is
what needs separating.

- item
  paragraph text

  ---

Tight shapes must stay byte-for-byte tight — these are the guardrails against a
coarse rule:

- item
  - nested
    - deeper

1. one
2. two
