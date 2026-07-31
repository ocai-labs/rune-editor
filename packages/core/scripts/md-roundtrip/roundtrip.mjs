// SPDX-License-Identifier: MPL-2.0
// Copyright (c) 2026 Ocean AI, LLC
//
// Step-1 baseline harness (markdown-storage PRD §9 第 1 步). MEASURES current
// round-trip fidelity — it changes nothing and asserts nothing. Run it after
// building core:
//
//   pnpm --filter @ocai/rune-core build
//   node packages/core/scripts/md-roundtrip/roundtrip.mjs
//
// Three directions:
//   A  fidelity-test.md → PM → md ×3   whole-corpus drift, fixpoint, divergence
//   B  per-block PM seed → md → PM     block identity verdicts
//   C  per-mark  PM seed → md → PM     mark identity verdicts
//
// Drives ONLY public exports of the built package — zero src imports — so it
// measures exactly what a consumer gets. In step 4 (双向契约) each implemented
// block graduates from "measured" to "asserted" by porting its verdict here
// into a real vitest expectation.
import { createRequire } from "node:module"
import { pathToFileURL, fileURLToPath } from "node:url"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"

const HERE = dirname(fileURLToPath(import.meta.url))
const req = createRequire(import.meta.url)
const { DOMParser: LinkedomDOMParser } = await import(pathToFileURL(req.resolve("linkedom")))
const core = await import(pathToFileURL(join(HERE, "../../dist/index.js")))

const { markdownToDoc, exportMarkdownFromDoc, createHeadlessEditor } = core

const parseHTML = (html) =>
  new LinkedomDOMParser().parseFromString(`<html><body>${html}</body></html>`, "text/html")

const ed = createHeadlessEditor({ type: "doc", content: [{ type: "paragraph" }] })
const schema = ed.schema

const toMd = (blocks) =>
  exportMarkdownFromDoc({ type: "doc", content: blocks }, undefined, { dialect: "styled" })
const toPM = (md) => markdownToDoc(md, schema, parseHTML)

const text = (n) => n.text ?? (n.content ?? []).map(text).join("")
const typeSeq = (doc) => (doc.content ?? []).map((b) => b.type)

/** Directional compare: does everything the SEED declared survive in OUT?
 *  Only attrs the seed set explicitly are compared (id excluded — regenerated). */
function compareNode(seed, out, path, issues) {
  if (!out) return void issues.push(`${path}: 块消失`)
  if (seed.type !== out.type) return void issues.push(`${path}: ${seed.type} → ${out.type}`)
  for (const [k, v] of Object.entries(seed.attrs ?? {})) {
    if (k === "id") continue
    const got = out.attrs?.[k]
    if (JSON.stringify(got) !== JSON.stringify(v))
      issues.push(`${path}.${k}: ${JSON.stringify(v)} → ${JSON.stringify(got)}`)
  }
  const [st, ot] = [text(seed), text(out)]
  if (st !== ot) issues.push(`${path} 文本: ${JSON.stringify(st)} → ${JSON.stringify(ot)}`)
  const [sc, oc] = [seed.content ?? [], out.content ?? []]
  if (seed.type !== "doc" && sc.some((c) => c.type) && sc.length !== oc.length)
    issues.push(`${path} 子块数: ${sc.length} → ${oc.length}`)
  else if (sc.some((c) => c.type && c.type !== "text"))
    sc.forEach((c, i) => c.type !== "text" && compareNode(c, oc[i], `${path}[${i}]`, issues))
}

function verdict(name, seedBlocks) {
  const md = toMd(seedBlocks)
  if (md.trim() === "") return { name, verdict: "消失(导不出)", md }
  const out = toPM(md)
  const issues = []
  const [a, b] = [seedBlocks.map((x) => x.type), typeSeq(out)]
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    return { name, verdict: `变成了别的块: [${a}] → [${b}]`, md, issues }
  }
  seedBlocks.forEach((sb, i) => compareNode(sb, out.content[i], `#${i} ${sb.type}`, issues))
  const fix = toMd(out.content) === md
  if (issues.length === 0 && fix) return { name, verdict: "一模一样", md }
  if (issues.length === 0) return { name, verdict: "变了形(块无损,序列化不收敛)", md }
  return { name, verdict: "变了形", md, issues }
}

const p = (t, attrs) => ({ type: "paragraph", ...(attrs && { attrs }), content: [{ type: "text", text: t }] })
const inline = (type, t, attrs, content) => ({ type, ...(attrs && { attrs }), content: content ?? [{ type: "text", text: t }] })
const cell = (kind, texts, attrs) => ({
  type: kind, ...(attrs && { attrs }),
  content: texts.map((t) => ({ type: "tableParagraph", content: [{ type: "text", text: t }] })),
})
const row = (cells) => ({ type: "tableRow", content: cells })

// ── Direction B seeds: one canonical instance per body block ────────────────
const BLOCK_SEEDS = [
  ["paragraph", [p("plain paragraph")]],
  ["heading L2-L5", [2, 3, 4, 5].map((l) => inline("heading", `H${l}`, { level: l }))],
  ["divider", [{ type: "divider" }]],
  ["blockquote", [inline("blockquote", "quoted text")]],
  ["codeBlock(ts)", [inline("codeBlock", 'const x = "a"', { language: "ts" })]],
  ["bulletList nested", [inline("bulletList", "one"), inline("bulletList", "child", { depth: 1 })]],
  ["numberedList start=3", [inline("numberedList", "third", { start: 3 })]],
  ["taskList checked", [inline("taskList", "done", { checked: true }), inline("taskList", "open", { checked: false })]],
  ["paragraph depth=2 (缩进)", [p("root"), p("indented", { depth: 2 })]],
  ["table plain", [{ type: "table", content: [
    row([cell("tableHeader", ["a"]), cell("tableHeader", ["b"])]),
    row([cell("tableCell", ["1"]), cell("tableCell", ["2"])]),
  ] }]],
  ["table width+multi-paragraph", [{ type: "table", content: [
    row([cell("tableHeader", ["h1"], { colwidth: [200] }), cell("tableHeader", ["h2"])]),
    row([cell("tableCell", ["para one", "para two"]), cell("tableCell", ["x"])]),
  ] }]],
  ["equationBlock", [{ type: "equationBlock", attrs: { latex: "E = mc^2" } }]],
  ["image src", [{ type: "image", attrs: { src: "https://example.com/pic.png" } }]],
  ["image width+align", [{ type: "image", attrs: { src: "https://example.com/pic.png", width: 300, align: "center" } }]],
  ["callout 默认icon", [inline("callout", "callout body")]],
  ["callout 自定义icon", [inline("callout", "hot take", { icon: "🔥" })]],
  ["toggle + child", [inline("toggle", "toggle head", { level: 0, expanded: true }), p("hidden child", { depth: 1 }), p("sibling after")]],
  ["toggle heading L2 + child", [inline("toggle", "toggle heading", { level: 2 }), p("its child", { depth: 1 })]],
  ["video src", [{ type: "video", attrs: { src: "https://example.com/v.mp4" } }]],
  ["audio src", [{ type: "audio", attrs: { src: "https://example.com/a.mp3" } }]],
  ["tableOfContents", [{ type: "tableOfContents" }]],
]

// ── Direction C seeds: one paragraph per mark ───────────────────────────────
const MARK_SEEDS = [
  ["bold", { type: "bold" }],
  ["italic", { type: "italic" }],
  ["strike", { type: "strike" }],
  ["code", { type: "code" }],
  ["link", { type: "link", attrs: { href: "https://example.com" } }],
  ["wikiLink", { type: "wikiLink", attrs: { target: "Some Page" } }],
  ["underline", { type: "underline" }],
  ["textStyle textColor", { type: "textStyle", attrs: { textColor: "red" } }],
  ["textStyle backgroundColor", { type: "textStyle", attrs: { backgroundColor: "blue" } }],
  ["internalRef page", { type: "internalRef", attrs: { kind: "page", target: "abc123" } }],
]

function markVerdict(name, mark) {
  const seedText = name.replace(/\s/g, "-")
  const md = toMd([{ type: "paragraph", content: [
    { type: "text", text: "lead " },
    { type: "text", text: seedText, marks: [mark] },
    { type: "text", text: " tail" },
  ] }])
  const out = toPM(md)
  const found = (out.content ?? []).flatMap((b) => b.content ?? [])
    .find((t) => (t.marks ?? []).some((m) => m.type === mark.type))
  const mdLine = md.trim()
  if (!found) return { name, verdict: "mark 丢失", md: mdLine }
  const got = found.marks.find((m) => m.type === mark.type)
  const issues = Object.entries(mark.attrs ?? {})
    .filter(([k, v]) => JSON.stringify(got.attrs?.[k]) !== JSON.stringify(v))
    .map(([k, v]) => `${k}: ${JSON.stringify(v)} → ${JSON.stringify(got.attrs?.[k])}`)
  return { name, verdict: issues.length ? "变了形" : "一模一样", md: mdLine, issues }
}

// ── Run ─────────────────────────────────────────────────────────────────────
console.log("═══ Direction A — 整篇语料 md→PM→md ×3(漂移/收敛)═══\n")
const md1 = readFileSync(join(HERE, "fidelity-test.md"), "utf8")
const d1 = toPM(md1)
const md2 = toMd(d1.content)
const d2 = toPM(md2)
const md3 = toMd(d2.content)
const md4 = toMd(toPM(md3).content)
console.log("块序列(首轮):", typeSeq(d1).join(" "))
console.log("\n类型稳定性(1↔2 轮):", JSON.stringify(typeSeq(d1)) === JSON.stringify(typeSeq(d2)) ? "稳定" : "变化")
console.log("md2==md3:", md2 === md3, " md3==md4:", md3 === md4, md3 === md4 && md2 !== md3 ? "(第 2 轮后收敛)" : md2 === md3 ? "(1 轮即收敛)" : "(发散)")
if (md2 !== md3) {
  const [l2, l3] = [md2.split("\n"), md3.split("\n")]
  console.log("\nmd2 → md3 逐行漂移:")
  l2.forEach((l, i) => l !== (l3[i] ?? "") && console.log(`  ${i + 1}: ${JSON.stringify(l)}\n     ${JSON.stringify(l3[i] ?? "")}`))
}

console.log("\n═══ Direction B — 逐块身份判定(PM→md→PM)═══\n")
const results = BLOCK_SEEDS.map(([name, blocks]) => verdict(name, blocks))
for (const r of results) {
  console.log(`■ ${r.name} — ${r.verdict}`)
  console.log(`  存成: ${JSON.stringify(r.md.trim().slice(0, 120))}`)
  for (const i of r.issues ?? []) console.log(`  · ${i}`)
}

console.log("\n═══ Direction C — 逐 mark 判定(PM→md→PM)═══\n")
for (const [name, mark] of MARK_SEEDS) {
  const r = markVerdict(name, mark)
  console.log(`■ ${r.name} — ${r.verdict}`)
  console.log(`  存成: ${JSON.stringify(r.md.slice(0, 120))}`)
  for (const i of r.issues ?? []) console.log(`  · ${i}`)
}

const tally = results.reduce((m, r) => ((m[r.verdict.split(":")[0]] = (m[r.verdict.split(":")[0]] ?? 0) + 1), m), {})
console.log("\n═══ 汇总(Direction B)═══")
console.log(JSON.stringify(tally, null, 1))

ed.destroy()
