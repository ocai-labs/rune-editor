// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

/**
 * `createHeadlessEditor` (`element: null`, no DOM at all) still needs a
 * couple of browser globals some core commands assume are ambient:
 *
 * - `apply_edits`' markdown-diff engine parses replacement markdown by
 *   rendering it to HTML and handing that to the global `DOMParser` (see
 *   `extensions/clipboard/aiMarkdown.ts`'s `browserParseHTML` default — that
 *   file's own `ParseHTML` parameter already anticipates "a headless DOM in
 *   Node/worker contexts"; this installs one automatically instead of
 *   threading a `parseHTML` override through every write command's public
 *   options).
 * - a prior prototype of this factory hit a `requestAnimationFrame is not
 *   defined` ReferenceError from a different command path.
 *
 * Installs onto `globalThis` ONLY when the real thing is missing — a
 * browser or jsdom host already has both and is left completely untouched.
 * Self-contained: the caller of `createHeadlessEditor` never has to inject
 * anything.
 *
 * `require` (not a static `import`) keeps `linkedom` out of every
 * consumer's module graph unless this branch actually runs — safe here
 * specifically because reaching it already proves the runtime is Node (no
 * environment lacks a global `DOMParser` while also having a real `window`).
 * The require itself comes from `process.getBuiltinModule` rather than a
 * static `import "node:module"` so core's browser-facing dist carries no
 * `node:` builtin import at all (bundlers would warn on it; Node >= 22.3
 * always has `getBuiltinModule`).
 */
export function ensureHeadlessGlobals(): void {
  if (typeof globalThis.requestAnimationFrame === "undefined") {
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
      setTimeout(() => cb(Date.now()), 0) as unknown as number) as typeof requestAnimationFrame
    globalThis.cancelAnimationFrame = ((id: number) =>
      clearTimeout(id)) as typeof cancelAnimationFrame
  }

  if (typeof globalThis.DOMParser === "undefined") {
    // @types/node isn't a devDependency of core (it stays runtime-agnostic),
    // so `process` gets a local shape here; mirrors turnInto.test.ts's
    // suppression for its own node builtin probe.
    const nodeProcess = (
      globalThis as unknown as {
        process: { getBuiltinModule(id: string): unknown }
      }
    ).process
    const { createRequire } = nodeProcess.getBuiltinModule("node:module") as {
      createRequire(url: string): (id: string) => unknown
    }
    const require = createRequire(import.meta.url)
    const { DOMParser: LinkedomDOMParser } = require("linkedom") as {
      DOMParser: new () => { parseFromString(html: string, mimeType: string): Document }
    }
    // linkedom's DOMParser, unlike the browser's, does NOT auto-wrap a bare
    // fragment into <html><body>… — every caller here reads `.body`
    // expecting that browser normalization, so wrap it ourselves.
    class HeadlessDOMParser {
      parseFromString(html: string, mimeType: string): Document {
        return new LinkedomDOMParser().parseFromString(`<html><body>${html}</body></html>`, mimeType)
      }
    }
    globalThis.DOMParser = HeadlessDOMParser as unknown as typeof DOMParser
  }
}
