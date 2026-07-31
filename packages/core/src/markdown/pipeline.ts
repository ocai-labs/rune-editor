// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The storage-format markdown pipeline (markdown-storage PRD §5.3): remark →
// mdast → PM and back, replacing the divergent markdown-it → HTML → DOM →
// PM transport. Pure JS, no DOM — every function in this directory must stay
// stateless and document-free (PRD §7.1: no caching, no doc ownership, no
// file I/O), so any host — single process, local server, future CRDT — can
// call it.
//
// NOT wired into the package export surface yet: the paste path and the
// legacy exporter stay on the old transport until step 4's per-block
// contracts land (PRD §9). The only consumer today is the roundtrip test
// suite next door.
import { unified, type Processor } from "unified"
import remarkParse from "remark-parse"
import remarkStringify from "remark-stringify"
import remarkGfm from "remark-gfm"
import remarkFrontmatter from "remark-frontmatter"
import remarkMath from "remark-math"
import type { Root, RootContent } from "mdast"

/**
 * `singleDollarTextMath: false` — a lone `$5 and $6` must not become inline
 * math in prose notes. Block math (`$$…$$`) is unaffected. Revisit with D5 if
 * Obsidian-style single-`$` inline math turns out to matter.
 */
const MATH_OPTIONS = { singleDollarTextMath: false }

/**
 * `singleTilde: false` — GitHub tolerates `~one~` as strikethrough; prose
 * with `~paths~` must not. `tablePipeAlign: false` — pipe-padding alignment
 * makes one longer cell rewrite every row of the column (G3 diff noise).
 */
const GFM_OPTIONS = { singleTilde: false, tablePipeAlign: false }

/**
 * Drops GFM's *transform-time* autolinking, keeping its parse-time syntax.
 *
 * GFM autolinks in two passes — `micromark-extension-gfm-autolink-literal`'s
 * readme is explicit that "GitHub employs different algorithms to autolink: one
 * at parse time and one at transform time … This difference can be observed
 * because character references and escapes are handled differently."
 *
 * Only the first pass is markdown SYNTAX: micromark matches source bytes, so
 * `<`, `&lt;`, and `\<` are three different things and the prefix rules apply.
 * The second pass is a `findAndReplace` over the mdast, i.e. over text that has
 * already been DECODED, and it is the one a storage codec cannot keep:
 *
 *   src    &lt;tonyg@lshift.net&gt;      literal <…> per CommonMark
 *   doc    "<" + link(mailto:…) + ">"    ← the transform linkified decoded text
 *   write  <<tonyg@lshift.net>>          ← baked in; now a REAL autolink to
 *                                          every reader, and the `&lt;` is gone
 *
 * Writing that link back has no lossless form. The link is a rendering
 * affordance GitHub applies on display — the bytes on disk stay `&lt;…&gt;` —
 * so modelling it forces a choice between corrupting the source (above) and
 * dropping a mark. Not modelling it is the only stable option, and it makes the
 * PM document say what the file says: a literal `<…>`, no link mark.
 *
 * Parse-time autolinks are untouched: `<a@b.com>` (CommonMark), `a@b.com` and
 * `www.example.com` after whitespace (GFM) all still become links, and the
 * `@` / `.` / `:` escapes `gfmAutolinkLiteralToMarkdown` adds keep plain text
 * from turning into one on the way back out.
 *
 * Matched by shape (`enter.literalAutolink`) rather than by function identity so
 * it survives a remark refactor; if the token is ever renamed the guard stops
 * firing, which `roundtrip.headless.test.ts` asserts against directly.
 */
function dropTransformTimeAutolinks(this: Processor): undefined {
  const data = this.data()
  const rewrite = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(rewrite)
    const extension = value as { enter?: Record<string, unknown>; transforms?: unknown }
    if (value && typeof value === "object" && extension.enter?.literalAutolink) {
      const { transforms: _transformTime, ...rest } = extension
      return rest
    }
    return value
  }
  data.fromMarkdownExtensions = rewrite(
    data.fromMarkdownExtensions ?? [],
  ) as typeof data.fromMarkdownExtensions
}

/** md string → mdast. Position info is preserved (fidelity work needs it). */
export function parseToMdast(markdown: string): Root {
  return unified()
    .use(remarkParse)
    .use(remarkGfm, GFM_OPTIONS)
    .use(dropTransformTimeAutolinks)
    .use(remarkFrontmatter)
    .use(remarkMath, MATH_OPTIONS)
    .parse(markdown) as Root
}

// Inside a list item, `mdast-util-to-markdown` packs block children onto
// consecutive lines unless the item is `spread`. That is not always reversible:
// CommonMark's lazy continuation reads the next plain-text line as part of the
// construct above it, so a paragraph written directly after a nested list is
// swallowed by that list's last item and the block DISAPPEARS.
//
//   - item          →   - item          →   - item
//                         - nested            - nested\
//     - nested            tail                  tail        ← one block, not two
//
//     tail
//
// The fix is a boundary-specific join rule rather than `listItem.spread = true`,
// because `spread` is an ITEM-level switch: turning it on to protect one
// boundary blank-lines every OTHER boundary in the same item, which rewrites the
// very common tight `- item / - nested` shape for no reason.
//
// Which boundaries are unsafe was measured, not guessed — every left×right pair
// of the constructs a list item can hold was round-tripped, and exactly these
// fail. The matrix was run twice: first over ten constructs, then re-run over
// eleven once `html` became one of them (see the type-7 rule at the bottom).
const ABSORBS_NEXT_LINE = new Set(["list", "blockquote", "table", "footnoteDefinition"])
const OPENS_WITH_PLAIN_LINE = new Set(["paragraph", "table", "definition"])
const MERGES_WITH_ITSELF = new Set(["blockquote", "table"])

/** `1` = force a blank line; `undefined` = defer to the default rules. */
function separateUnsafeBoundary(
  left: RootContent,
  right: RootContent,
  parent: RootContent | Root,
): 1 | undefined {
  // Only list items pack children tightly; root and blockquote already use
  // blank lines, and a `list` parent joins ITEMS, which this must not touch.
  if (!("spread" in parent)) return undefined
  // `> a` + `> b` become one blockquote; two tables become one table.
  if (left.type === right.type && MERGES_WITH_ITSELF.has(left.type)) return 1
  // Lazy continuation: the right block's opening line joins the left block.
  if (ABSORBS_NEXT_LINE.has(left.type) && OPENS_WITH_PLAIN_LINE.has(right.type)) return 1
  // `---` directly under a paragraph is a setext underline, not a rule — the
  // hazard runs backwards here, so the paragraph is what needs separating.
  if (left.type === "paragraph" && right.type === "thematicBreak") return 1
  // An html block whose tag is outside CommonMark's block whitelist is a TYPE 7
  // block (§4.6), and a type-7 block ends only at a BLANK LINE — not at the next
  // construct. `<video>` and `<audio>` are exactly that, which is why the media
  // contracts made `html` a shape a list item can hold; F6's matrix predates
  // them and could not have covered it.
  //
  // Re-running that matrix with html included: 15 of 100 pairs fail and every
  // one involves html, in two different ways —
  //
  //   html on the LEFT    swallows whatever follows, whatever it is (10 pairs)
  //   html on the RIGHT   cannot interrupt an open paragraph, so the paragraph
  //                       swallows IT (5 pairs)
  //
  // Measured damage: three `<video>` blocks in the VS Code changelog stopped
  // being blocks — the bytes survived as inline source inside the list item, and
  // the file drifted again on the next save.
  if (left.type === "html") return 1
  if (right.type === "html" && (left.type === "paragraph" || ABSORBS_NEXT_LINE.has(left.type))) {
    return 1
  }
  return undefined
}

/**
 * mdast → md string. Stringify style is pinned here — bullet `-`, rule `---`,
 * `*` emphasis — so the serialized form is deterministic and diffs stay
 * quiet (G3). These are the only style knobs; block shape is decided by the
 * mdast the converter builds, never by post-processing the string.
 */
export function stringifyMdast(root: Root): string {
  const processor = unified()
    .use(remarkStringify, {
      bullet: "-",
      rule: "-",
      emphasis: "*",
      strong: "*",
      fence: "`",
      fences: true,
      listItemIndent: "one",
      // Appended after the defaults, and `between()` consults the list from the
      // end, so this runs first and the defaults still handle everything else.
      join: [separateUnsafeBoundary],
    })
    .use(remarkGfm, GFM_OPTIONS)
    .use(remarkFrontmatter)
    .use(remarkMath, MATH_OPTIONS) as Processor<undefined, undefined, undefined, Root, string>
  return processor.stringify(root)
}
