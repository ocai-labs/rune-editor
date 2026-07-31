// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// @vitest-environment node
//
// STORAGE FIDELITY GATE — step 7 of
// docs/2026-07-30-storage-fidelity-gate-and-fix-plan.md (§4.1).
//
// This is the CORPUS gate, not a feature suite. `roundtrip.headless.test.ts`
// next door asserts per-feature behaviour with inline strings; this file runs
// whole vendored FILES through the codec and asserts file-level properties.
// Both are needed: a feature assertion cannot see a defect that only appears
// when constructs sit next to each other, which is how F6 and the
// hard-break-before-carrier defect were found.
//
// The corpus is VENDORED under `__fixtures__/`. It deliberately does not point
// at the sibling `open-knowledge` / `vscode` / `tiptap` / `BlockNote` trees the
// probe script measures — those do not exist in CI, so a gate aimed at them
// would fail on day one. Use `pnpm probe:markdown` for the 1151-file numbers;
// use this gate to stop regressions.
//
// Two groups, two different jobs:
//
//   green/       Every fixture MUST satisfy every assertion. One fixture per
//                closed defect (F1 family, F2 ①, F6, F7) plus the vendored MVP
//                acceptance document.
//
//   known-gaps/  Each fixture's CURRENT failure signature is frozen as an exact
//                object. This is the §4.1 fifth-assertion allowlist made
//                mechanical: it fails on regression AND on accidental
//                improvement, so a fix has to come with a deliberate update
//                here and in §3.9. A plain "these files are allowed to fail"
//                list would silently absorb both.
//
// Runs in bare Node with NO DOM — that absence is itself an assertion (§5.3).
import { describe, expect, it } from "vitest"
import {
  countDuplicateMarks,
  parseMarkdown,
  sameDocument,
  serializeMarkdown,
} from "./index"

// Fixtures are loaded with Vite's compile-time `import.meta.glob` rather than
// `node:fs`. core's tsconfig sets `"types": []` on purpose — no DOM and no Node
// ambient types, so that a stray `fs` or `document` reference cannot compile.
// Reading the corpus must not be the thing that punches a hole in that boundary.
//
// Both arguments must be literals at the call site: `vite:import-glob` resolves
// them statically and rejects an identifier ("Expected the second argument to be
// an object literal"). Hoisting the options object into a const does not work.
const GREEN_FILES = import.meta.glob("./__fixtures__/green/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
})
const GAP_FILES = import.meta.glob("./__fixtures__/known-gaps/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
})

/** `./__fixtures__/green/f1-abutting-runs.md` → `f1-abutting-runs.md` */
const basename = (key: string) => key.slice(key.lastIndexOf("/") + 1)

/** Vite types the eager `?raw` result as `unknown`; assert it at this one seam. */
const corpus = (files: Record<string, unknown>) =>
  Object.entries(files)
    .map(([key, markdown]) => ({ name: basename(key), markdown: markdown as string }))
    .sort((a, b) => a.name.localeCompare(b.name))

/** Upper bound from §4.1 assertion 2 — the worst measured value is 2. */
const MAX_ROUNDS = 3

const save = (markdown: string) => {
  const parsed = parseMarkdown(markdown)
  return { parsed, text: serializeMarkdown(parsed.doc, parsed.frontmatter) }
}

const occurrences = (text: string, needle: string) => text.split(needle).length - 1

/**
 * Raw-carrier sources that must appear in the saved file verbatim.
 *
 * The carriers make one promise — bytes rune could not represent come back
 * unchanged — and it is the one property the structural comparator cannot see.
 * `sameDocument` is happy as long as both sides agree, so a carrier that
 * degraded to escaped text on the way out and re-read as that same escaped text
 * on the way back in passes `same` while the file is quietly damaged.
 *
 * Only UNPREFIXED positions are collected. A carrier inside a list item or a
 * blockquote deliberately holds the STRIPPED bytes — CommonMark removed the
 * container's indentation and `> ` before rune saw the tree, and the writer adds
 * them back — so "appears verbatim in the file" is false there by design, not by
 * defect. Those positions are covered by `BYTE_EXACT` on
 * `a2b-nested-raw-context.md`, where whole-file byte identity is the assertion.
 */
const PREFIXED = new Set(["bulletList", "numberedList", "taskList", "blockquote"])

interface MaybeCarrier {
  type?: string
  attrs?: Record<string, unknown>
  content?: unknown
}

function carriedSources(doc: { content?: unknown }): string[] {
  const out: string[] = []
  // Recurses to ANY depth. Walking one inline level was a real blind spot: a
  // `rawInline` inside a table cell lives under tableRow → tableCell →
  // tableParagraph, so the gate reported an empty list for a document that did
  // carry one, and would have called a lost carrier a pass.
  const walk = (nodes: unknown): void => {
    if (!Array.isArray(nodes)) return
    for (const node of nodes as MaybeCarrier[]) {
      if (
        (node.type === "rawBlock" || node.type === "rawInline") &&
        typeof node.attrs?.source === "string"
      ) {
        out.push(node.attrs.source)
      }
      walk(node.content)
    }
  }
  const blocks = Array.isArray(doc.content) ? doc.content : []
  for (const b of blocks as MaybeCarrier[]) {
    const depth = typeof b.attrs?.depth === "number" ? b.attrs.depth : 0
    if (depth > 0 || PREFIXED.has(b.type ?? "")) continue
    if (b.type === "rawBlock" && typeof b.attrs?.source === "string") {
      out.push(b.attrs.source)
      continue
    }
    walk(b.content)
  }
  return out
}

interface Signature {
  /** Saves needed to reach a fixpoint; -1 = never within MAX_ROUNDS. */
  fixpoint: number
  /** `sameDocument(parse(x), parse(serialize(parse(x))))` — §4.1 assertion 3. */
  same: boolean
  /** Health invariant, asserted separately so it cannot hide inside `same`. */
  dupes: number
  /** First save produced identical bytes. */
  byteSame: boolean
  /** First save introduced a `\<` escape it did not have — the C3 signature. */
  gainedLtEscape: boolean
  /** Frontmatter bytes, fences included, survived the save. */
  frontmatterByteStable: boolean
  /** Raw-carrier sources the first save failed to reproduce verbatim. */
  strandedCarriers: string[]
  /** Frontmatter survived the first save byte-for-byte — §4.1 assertion 4. */
  frontmatterStable: boolean
}

function measure(markdown: string): Signature {
  const first = save(markdown)

  const seq = [first.text]
  let current = first.text
  let fixpoint = -1
  for (let round = 1; round < MAX_ROUNDS + 1; round += 1) {
    current = save(current).text
    seq.push(current)
    if (seq[round] === seq[round - 1]) {
      fixpoint = round
      break
    }
  }

  const second = parseMarkdown(first.text)
  return {
    fixpoint,
    same: sameDocument(first.parsed.doc, second.doc),
    dupes: countDuplicateMarks(first.parsed.doc) + countDuplicateMarks(second.doc),
    byteSame: first.text === markdown,
    // A MULTISET of contexts, not a global tally. A bare count let an escape
    // appear in one place and vanish in another and still report no change; an
    // absolute index is the opposite problem — it shifts whenever any earlier
    // byte does. Fingerprinting what each escape sits in front of is stable
    // against unrelated edits and still notices one arriving or leaving.
    gainedLtEscape: gainedAnEscape(markdown, first.text),
    strandedCarriers: carriedSources(first.parsed.doc).filter(
      (source) => !first.text.includes(source),
    ),
    // Across the SAVE: what the file held vs what reading the saved file gives
    // back. Comparing `parseMarkdown(markdown)` with `first.parsed` — which is
    // that same parse — was tautological and could never fail.
    frontmatterStable: (first.parsed.frontmatter ?? null) === (second.frontmatter ?? null),
    // `frontmatterStable` compares the mdast `yaml` node's VALUE, which is the
    // text between the fences. That is the content, but not the whole block:
    // the fence spelling and the line endings around it are outside it, and a
    // CRLF file passed `frontmatterStable` while its bytes changed. This is the
    // full-block check, which is what §4.1 assertion 4 actually claims.
    frontmatterByteStable: frontmatterBlock(first.text) === frontmatterBlock(markdown),
  }
}

/** What each `\<` in the text sits in front of, sorted — position-independent. */
const escapeContexts = (text: string): string[] => {
  const out: string[] = []
  for (let at = text.indexOf("\\<"); at !== -1; at = text.indexOf("\\<", at + 1)) {
    out.push(text.slice(at, at + 14))
  }
  return out.sort()
}

/** True when the save introduced an escape in a context the source lacked. */
function gainedAnEscape(before: string, after: string): boolean {
  const had = new Map<string, number>()
  for (const context of escapeContexts(before)) had.set(context, (had.get(context) ?? 0) + 1)
  for (const context of escapeContexts(after)) {
    const left = had.get(context) ?? 0
    if (left === 0) return true
    had.set(context, left - 1)
  }
  return false
}

/** The frontmatter block INCLUDING its fences, or null when there is none. */
const frontmatterBlock = (text: string): string | null => {
  if (!text.startsWith("---")) return null
  const end = text.indexOf("\n---", 3)
  return end === -1 ? null : text.slice(0, end + 4)
}

// ─── green: everything must pass ─────────────────────────────────────────────

/**
 * Green fixtures whose first save must reproduce the file byte-for-byte.
 *
 * Most green fixtures are narrative — several paragraphs of prose explaining the
 * defect, wrapped around the construct under test — and that prose legitimately
 * renormalizes (`*` bullets become `-`, `_em_` becomes `*em*`). Structural
 * stability is the right bar for those, and `strandedCarriers` is what holds
 * their actual subject to byte exactness.
 *
 * This set names the files where the WHOLE document is the claim. Membership is
 * asserted in both directions, so the `byteSame` measurement can no longer be
 * computed and then ignored: a fixture that starts saving byte-for-byte fails
 * until it is added here, and one that stops fails until it is removed.
 */
const BYTE_EXACT = new Set([
  "acceptance-mvp.md",
  "a2b-nested-raw-context.md",
  // Gained byte-exactness when soft wraps stopped becoming hard breaks (C5).
  // Their prose is wrapped, so every paragraph used to pick up a trailing `\`.
  "a1-raw-html-block.md",
  "b1-inline-math.md",
  "f6-list-item-boundaries.md",
])

describe("storage fidelity gate — green corpus", () => {
  const green = corpus(GREEN_FILES)

  it("the corpus is non-empty and every closed defect has a fixture", () => {
    // Guards against a silently emptied directory making the whole group vacuous.
    expect(green.length).toBeGreaterThanOrEqual(13)
    for (const stem of [
      "f1-", "f2-", "f6-", "f7-", "f7b-",
      "b1-", "b2b-", "a1-", "a2-", "a3-",
      "acceptance-",
    ]) {
      expect(green.some(({ name }) => name.startsWith(stem))).toBe(true)
    }
  })

  for (const { name, markdown } of green) {
    describe(name, () => {
      it("does not crash, and reaches a fixpoint within 3 saves", () => {
        const { fixpoint } = measure(markdown)
        expect(fixpoint).toBeGreaterThan(0)
        expect(fixpoint).toBeLessThanOrEqual(MAX_ROUNDS)
      })

      it("survives one save with an identical document structure", () => {
        // §4.1 assertion 3 — the only one that catches F1 / F2. Byte identity is
        // deliberately NOT asserted: a soft-wrapped paragraph legitimately gains
        // backslashes on the first save (see the F2② note in §3.9).
        expect(measure(markdown).same).toBe(true)
      })

      it("carries no duplicate marks on any run, in every round", () => {
        // Separate from `same` on purpose: folding it into the comparator would
        // mask the very defect it exists to catch (§3 F1's second lesson).
        expect(measure(markdown).dupes).toBe(0)
      })

      it("keeps its frontmatter byte-for-byte across a save", () => {
        const signature = measure(markdown)
        expect(signature.frontmatterStable).toBe(true)
        // Fences and line endings too, not just the text between them.
        expect(signature.frontmatterByteStable).toBe(true)
      })

      it("writes every unprefixed raw carrier's source into the file verbatim", () => {
        // The carriers' whole reason to exist, and invisible to `same` — see
        // `carriedSources` for why nested positions are excluded.
        expect(measure(markdown).strandedCarriers).toEqual([])
      })

      it("does not gain a `\\<` escape — the C3 regression signature", () => {
        // Universal for green: a construct that stops being claimed falls back
        // to a paragraph of literal text, and the writer must then escape its
        // `<`. Measured false for all 13 fixtures today.
        expect(measure(markdown).gainedLtEscape).toBe(false)
      })

      it(
        BYTE_EXACT.has(name)
          ? "saves byte-for-byte"
          : "renormalizes rather than saving byte-for-byte (declared)",
        () => {
          expect(measure(markdown).byteSame).toBe(BYTE_EXACT.has(name))
        },
      )
    })
  }
})

// ─── known gaps: frozen signatures ───────────────────────────────────────────

/**
 * Measured 2026-07-30. Each entry is the EXACT current behaviour of a known,
 * deliberately-unfixed gap. Changing codec behaviour here must be accompanied by
 * a decision recorded in the step-8 design and §3.9 — not by editing a number
 * until the suite goes green.
 *
 * Note which gaps pass `same`: C1 and C4 lose identity/content that the
 * STRUCTURAL criterion cannot see, which is exactly why §3.9 exists and why
 * these two carry an extra bespoke assertion below.
 */
const KNOWN_GAPS: Record<string, Signature & { because: string }> = {
  // EMPTY as of 2026-07-30 — every gap this corpus tracked has been closed
  // (B1, F7b, A1, A2, the source foundation, B2b, A3). The machinery stays: the
  // next construct rune cannot represent losslessly gets frozen here rather than
  // quietly degrading, and the two assertions below still guard the empty case.
}

describe("storage fidelity gate — known gaps (frozen signatures)", () => {
  const gaps = corpus(GAP_FILES)

  it("every known-gap fixture has a frozen signature, and vice versa", () => {
    expect(gaps.map(({ name }) => name)).toEqual(Object.keys(KNOWN_GAPS).sort())
  })

  for (const { name, markdown } of gaps) {
    const expected = KNOWN_GAPS[name]
    if (!expected) continue

    it(`${name} — signature unchanged`, () => {
      const { because: _because, ...signature } = expected
      expect(measure(markdown)).toEqual(signature)
    })
  }

})
