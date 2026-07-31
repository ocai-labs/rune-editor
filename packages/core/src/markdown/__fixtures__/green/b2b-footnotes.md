B2b — footnotes. remark-gfm parses both halves; PM has a node for neither, so
the definition used to flatten into a plain paragraph and the reference hit the
`default:` branch, where `mdastText` returns "" for a node with no text children.
The `[^1]` marker therefore VANISHED — content loss, not byte damage.

Both halves now take a raw carrier, recovered through the source slice: a
`footnoteDefinition` has children but no `value`, so nothing short of the slice
could reproduce it. First-class footnote nodes remain tracked as D12; because the
bytes are untouched, the same file will simply promote itself when that lands.

正文里有一个引用[^1],以及第二个[^note].

[^1]: 单段定义内容。

[^note]: 多段定义的第一段。

    多段定义的第二段,缩进四格。
