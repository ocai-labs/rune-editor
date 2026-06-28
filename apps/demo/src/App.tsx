import { useEffect, useState } from "react"
import {
  RuneEditor,
  RuneSlashMenu,
  RuneEmojiPicker,
  RuneLinkMenu,
  FloatingTableOfContents,
  type Editor,
} from "@ocai/rune-react"
import { TitleKit } from "@ocai/rune-core"
import "@ocai/rune-react/style.css"
import "./demo.css"
import { SEED } from "./seed"

export function App() {
  const [editor, setEditor] = useState<Editor | null>(null)
  const [dark, setDark] = useState(
    () =>
      typeof matchMedia === "function" &&
      matchMedia("(prefers-color-scheme: dark)").matches,
  )

  // The chrome themes off `.dark` on the document element.
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark)
  }, [dark])

  return (
    <div className="demo">
      <header className="demo-header">
        <span className="demo-title">Rune</span>
        <nav className="demo-nav">
          <a
            href="https://www.npmjs.com/package/@ocai/rune-react"
            target="_blank"
            rel="noreferrer"
          >
            npm
          </a>
          <button type="button" onClick={() => setDark((d) => !d)}>
            {dark ? "Light" : "Dark"}
          </button>
        </nav>
      </header>

      <main className="demo-main">
        <RuneEditor
          content={SEED}
          kit={{ plugins: [TitleKit] }}
          onReady={setEditor}
          className="demo-editor"
        >
          <RuneSlashMenu editor={editor} />
          <RuneEmojiPicker editor={editor} />
          <RuneLinkMenu editor={editor} getItems={async () => []} />
        </RuneEditor>
        <FloatingTableOfContents editor={editor} />
      </main>
    </div>
  )
}
