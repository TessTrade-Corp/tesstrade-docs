#!/usr/bin/env node
// Generate the single-file documentation bundle served for download at
// /tesstrade-docs-completo.md (great for feeding the whole docs to an AI
// assistant). The page order is the sidebar order in .vitepress/config.mts,
// so this stays in sync with the rendered navigation automatically.
//
// Run standalone with `npm run docs:bundle`; it also runs as the first step
// of `npm run docs:build`, so the deployed bundle is never stale.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const gitbook = join(root, 'gitbook')
const configPath = join(root, '.vitepress', 'config.mts')
const outDir = join(gitbook, 'public')
const outPath = join(outDir, 'tesstrade-docs-completo.md')

// --- Page order: parse the sidebar from config.mts (single source of truth) ---
const cfg = readFileSync(configPath, 'utf8')
const sidebarIdx = cfg.indexOf('sidebar:')
if (sidebarIdx === -1) throw new Error('sidebar: not found in config.mts')
const region = cfg.slice(sidebarIdx)

const tokenRe = /(text|link):\s*'([^']*)'/g
const tokens = []
for (let m; (m = tokenRe.exec(region)); ) tokens.push({ key: m[1], val: m[2] })

// index.md is the site root and is not listed in the sidebar — prepend it.
const pages = [{ section: 'Introdução', title: null, path: 'index.md' }]
let section = null
for (let i = 0; i < tokens.length; i++) {
  if (tokens[i].key !== 'text') continue
  const next = tokens[i + 1]
  if (next && next.key === 'link') {
    pages.push({ section, title: tokens[i].val, path: next.val.replace(/^\//, '') + '.md' })
    i++ // consume the paired link token
  } else {
    section = tokens[i].val // a text with no following link is a section header
  }
}

// --- Helpers ---
const marker = (p) =>
  `<!-- ===== ${p.title === null ? p.section : `${p.section} ▸ ${p.title}`}  (${p.path}) ===== -->`

function body(p) {
  let c = readFileSync(join(gitbook, p.path), 'utf8')
  // Strip a leading YAML frontmatter block if a page ever grows one.
  if (c.startsWith('---\n') || c.startsWith('---\r\n')) {
    const end = c.indexOf('\n---', 3)
    if (end !== -1) c = c.slice(c.indexOf('\n', end + 1) + 1)
  }
  return c.trim()
}

// --- Table of contents ---
let toc = '## Índice\n\n'
let curSection
for (const p of pages) {
  if (p.title === null) {
    toc += `- ${p.section} — \`${p.path}\`\n`
  } else {
    if (p.section !== curSection) {
      curSection = p.section
      toc += `\n**${p.section}**\n\n`
    }
    toc += `- ${p.title} — \`${p.path}\`\n`
  }
}

const date = new Date().toISOString().slice(0, 10)
const preamble = `# TessTrade — Documentação completa (SDK de indicadores e estratégias)

> **Documento único** consolidando toda a documentação pública do TessTrade
> (learn.tesstrade.com), para uso como contexto em assistentes de IA.
> Gerado em ${date} a partir do gitbook. Fonte da verdade do contrato: o
> sandbox Python do TessTrade (\`strategy_sdk.py\`, \`runner.py\`, \`restrictions.py\`).
> A matemática dos indicadores é a dos kernels compartilhados \`tesstrade_core\`,
> os mesmos que o gráfico ao vivo usa (via \`import tesstrade_indicators as ti\`).
>
> As páginas estão concatenadas na ordem da navegação. Links internos do tipo
> \`../secao/pagina.md\` referem-se a outras seções **deste mesmo arquivo**.

${toc.trimEnd()}`

const blocks = pages.map((p) => `${marker(p)}\n\n${body(p)}`)
const out = `${preamble}\n\n\n---\n\n${blocks.join('\n\n---\n\n')}\n`

mkdirSync(outDir, { recursive: true })
writeFileSync(outPath, out)
console.log(`gen-completo: wrote ${pages.length} pages, ${out.length} bytes -> ${outPath}`)
