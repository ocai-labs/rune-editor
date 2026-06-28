// Initial document. RuneEditor accepts an HTML string for `content` and parses
// it through the schema (headings UI 1/2/3 = h2/h3/h4, lists, quote, code).
export const SEED = `
<h1>Welcome to Rune</h1>
<p>Rune is a Tiptap v3 / ProseMirror editor wrapper with product-grade block
behaviors. This page is a live editor — type, drag, and try the menus.</p>

<h3>Try it</h3>
<ul>
  <li>Type <code>/</code> for the slash menu (headings, lists, quote, code, …).</li>
  <li>Type <code>:</code> for the emoji picker.</li>
  <li>Select text to reveal the inline toolbar (bold, italic, color, link).</li>
  <li>Hover the left gutter to drag or add blocks.</li>
</ul>

<blockquote>Flat schema, native ProseMirror primitives, no overlay drag handles.</blockquote>

<p>Install both packages:</p>
<pre><code>npm install @ocai/rune-core @ocai/rune-react</code></pre>
`
