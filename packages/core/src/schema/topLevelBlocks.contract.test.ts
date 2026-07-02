// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Node built-ins for this source-boundary contract. @types/node isn't a
// devDependency of core (it stays runtime-agnostic — no Node-shaped APIs leak
// into the published types), and vitest resolves these at run time, so silence tsc.
// @ts-expect-error -- node:fs has no types in this package
import { readFileSync, readdirSync } from "node:fs"
// @ts-expect-error -- node:url has no types in this package
import { fileURLToPath } from "node:url"
// @ts-expect-error -- node:path has no types in this package
import { dirname, join, relative, sep } from "node:path"
import { describe, expect, it } from "vitest"
import * as core from "../index"

/**
 * `schema/topLevelBlocks.ts` holds ROOT-ONLY helpers — they walk `doc.child(i)`
 * and are blind to body blocks nested inside `columnLayout > column`. The
 * column-aware layer is `schema/bodySurface.ts` (`resolveBodyBlockById`,
 * `forEachBodyBlock`, `forEachBodySurface`, `surfaceChildrenAt`, ...). A column-
 * blind consumer that reaches for a `topLevelBlock*` helper silently misregisters
 * every in-column block, so this contract PINS the importer set: only files whose
 * root-only usage is justified by design may import from `topLevelBlocks`.
 *
 * Enforced by scanning source (node fs, no glob dep) rather than a runtime probe
 * because the failure mode is a WRONG IMPORT at authoring time, not a value shape.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
// HERE = packages/core/src/schema → PACKAGES_ROOT = packages
const PACKAGES_ROOT = join(HERE, "..", "..", "..")
const SCAN_ROOTS = [
  join(PACKAGES_ROOT, "core", "src"),
  join(PACKAGES_ROOT, "react", "src"),
]

// An `import ... from "…topLevelBlocks"` / `export … from "…topLevelBlocks"` /
// dynamic `import("…topLevelBlocks")` — catches EVERY specifier that ends in the
// module (relative or barrel path), never a bare mention in a comment (those read
// `topLevelBlockPosById`, with no preceding `from "`/`import "`).
const IMPORTS_TOP_LEVEL_BLOCKS =
  /(?:from\s+|import\s*\(?\s*)["'][^"']*topLevelBlocks(?:\.[jt]sx?)?["']/

/**
 * Files that may import `topLevelBlocks`, each with WHY its root-only usage is
 * correct. Keyed by path relative to `packages/` (package-qualified, so a react
 * importer would be representable too). Verified by reading each file's usage.
 */
const ALLOWLIST = new Map<string, string>([
  // The surface-aware wrapper itself: `resolveBodyBlockById`'s fast path delegates
  // the root-surface id→pos/index walk here, then recurses nested surfaces. Its job.
  ["core/src/schema/bodySurface.ts", "wraps the helpers into the column-aware layer"],
  // Root-surface caret-landing ONLY: `resolveDeleteRanges` addresses blocks via
  // `resolveBodyBlockById`; the `topLevelBlock*` calls sit in `setSelectionAfterDelete`
  // strictly AFTER the `!rootSurface` early-return (column deletes use `Selection.near`).
  ["core/src/api/commands/deleteBlocks.ts", "root-surface caret placement, guarded by a rootSurface branch"],
  // Root MBS paint path with explicit column-aware branches alongside: in-column
  // grip-clicks route to `applyInColumnGripClick`, dropdown existence uses
  // `resolveBodyBlockById`, and `topLevelBlockStartPos` runs only in the
  // `surface === doc` branch of the decoration paint.
  ["core/src/extensions/block-selection/plugin.ts", "root MBS paint, column cases branch to bodySurface helpers"],
])

/** The root-only helpers `topLevelBlocks.ts` exports — must stay package-internal. */
const ROOT_ONLY_HELPERS = [
  "topLevelBlockIndexById",
  "topLevelBlockPosById",
  "topLevelBlockStartPos",
  "topLevelBlockStartPosBefore",
  "topLevelBlockEndPos",
  "topLevelBlockIndexAtBoundaryPos",
  "topLevelBlockTextBounds",
  "topLevelBlockTextBoundsAtPos",
]

function collectSourceFiles(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "dist" || entry.name === "node_modules") continue
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) {
      collectSourceFiles(abs, out)
      continue
    }
    if (!/\.tsx?$/.test(entry.name)) continue
    if (/\.(test|spec)\.tsx?$/.test(entry.name) || entry.name.endsWith(".d.ts")) continue
    out.push(abs)
  }
}

/** Package-relative key (`core/src/...`), separators normalized to `/`. */
function keyOf(abs: string): string {
  return relative(PACKAGES_ROOT, abs).split(sep).join("/")
}

function topLevelBlocksImporters(): Set<string> {
  const files: string[] = []
  for (const root of SCAN_ROOTS) collectSourceFiles(root, files)
  const importers = new Set<string>()
  for (const abs of files) {
    if (IMPORTS_TOP_LEVEL_BLOCKS.test(readFileSync(abs, "utf8"))) importers.add(keyOf(abs))
  }
  return importers
}

describe("schema/topLevelBlocks import contract", () => {
  it("no file outside the allowlist imports the root-only helpers", () => {
    const importers = topLevelBlocksImporters()
    const violators = [...importers].filter((f) => !ALLOWLIST.has(f)).sort()
    expect(
      violators,
      violators.length
        ? `${violators.join(", ")} import(s) from schema/topLevelBlocks — use ` +
            `resolveBodyBlockById / the bodySurface.ts surface-aware helpers instead; ` +
            `blocks inside columns are invisible to topLevelBlocks helpers`
        : undefined,
    ).toEqual([])
  })

  it("every allowlist entry still imports it (stale entries get cleaned up)", () => {
    const importers = topLevelBlocksImporters()
    for (const entry of ALLOWLIST.keys()) {
      expect(
        importers.has(entry),
        `${entry} is allowlisted for schema/topLevelBlocks but no longer imports it — ` +
          `remove the stale allowlist entry`,
      ).toBe(true)
    }
  })

  it("keeps the root-only helpers out of the public barrel", () => {
    for (const name of ROOT_ONLY_HELPERS) {
      expect(
        name in core,
        `${name} leaked to the public barrel — root-only topLevelBlocks helpers must ` +
          `stay internal so consumers reach for the column-aware bodySurface layer`,
      ).toBe(false)
    }
  })
})
