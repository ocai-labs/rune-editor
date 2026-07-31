A1 — block-level bare HTML is claimed by `rawBlock` and kept byte-for-byte.

Before A1 this degraded to a paragraph of text: the `\n` inside that text re-read
as a hardBreak, so the STRUCTURE needed two saves to settle, and the bytes were
rewritten with `\<` escapes on the way out. It was the largest single class of
round-trip failure in the corpus.

The README badge family, which is what most of that class actually was:

<div align="center">
  <img src="logo.png" width="200">
</div>

<p align="center">
  <img src="https://img.shields.io/badge/build-passing-green.svg">
</p>

<picture>
  <source srcset="dark.svg" media="(prefers-color-scheme: dark)">
  <img src="light.svg">
</picture>

A tag whose attributes span lines is still one html node:

<div
  align="center">
inner
</div>

A standalone block comment:

<!-- a standalone block comment -->

`node.value` is used rather than a `position` slice, and this is why: at root
level the two agree byte-for-byte, and `value` is the more robust of the pair —
with a BOM, mdast offsets are computed against the stripped string, so slicing
the original source would be off by one.

HTML that rune DOES claim must keep its first-class mapping and must NOT become a
raw block — the fallback runs only after every contract has declined:

<video src="clip.mp4" controls></video>

<audio src="track.mp3" controls></audio>

```toc
```
