import { defineConfig } from "vite"
import dts from "vite-plugin-dts"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// @ocai/rune-core is headless. No React plugin, no Tailwind. Bundled as ESM
// library, with Tiptap + ProseMirror kept EXTERNAL so the consumer
// resolves a single copy shared with `@tiptap/react` (and with
// `@ocai/rune-react`, which already externalizes them). Bundling them in
// here produces a second PM instance whose `PluginKey` counter starts
// at 0 alongside `@tiptap/react`'s bundled copy — both mint key
// `"plugin$"` for their first unnamed Plugin (keymap /
// inputRulesPlugin / pasteRulesPlugin), and `EditorState.Configuration`
// rejects the collision with
// `RangeError: Adding different instances of a keyed plugin (plugin$)`.
export default defineConfig({
  plugins: [
    dts({
      tsconfigPath: "./tsconfig.json",
      entryRoot: "src",
      include: ["src"],
      outDir: "dist",
    }),
  ],
  build: {
    lib: {
      // Two entries: the editor root, and the markdown storage codec at
      // `@ocai/rune-core/markdown` — a subpath ON PURPOSE so consumers who
      // never touch markdown don't pull the unified/remark family into
      // their bundle. Shared code (blocks, color tokens) becomes common
      // chunks imported by both entries — still a single copy at runtime.
      entry: {
        index: path.resolve(__dirname, "src/index.ts"),
        "markdown/index": path.resolve(__dirname, "src/markdown/index.ts"),
      },
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      external: [
        /^@tiptap\//,
        /^prosemirror-/,
        "orderedmap",
        "rope-sequence",
        "w3c-keyname",
        "nanoid",
        // The markdown codec's parser/serializer stack — declared package
        // dependencies, resolved by the consumer's package manager.
        "unified",
        /^remark-/,
        // Lazily `require`d by `api/headlessDom.ts` — only reached in a bare
        // Node process missing a global `DOMParser` (a browser/jsdom host
        // never touches this). Kept external + dynamically required so it
        // never inflates `dist/index.js` for the common (mounted) case.
        "linkedom",
        "node:module",
      ],
    },
    sourcemap: "hidden",
    copyPublicDir: false,
    emptyOutDir: true,
  },
  test: { environment: "jsdom" },
})
