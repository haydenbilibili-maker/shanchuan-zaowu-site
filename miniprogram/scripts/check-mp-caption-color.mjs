#!/usr/bin/env node
/**
 * 说明文字配色守卫 · `check:mp-caption-color`
 *
 * 规则（2026-10-01 共享层口径，见 miniprogram/docs/细节雕刻_A流_2026-10.md 第 4 轮）：
 *   **说明文字最低用 `--color-text-secondary`（#A09A90）**。`--color-text-muted`（#6B6560）在深色面上只有 2.7–3.1:1，
 *   只留给：禁用 / 占位 / 失效 / 删除线原价等 WCAG 1.4.3 豁免态，以及边框、圆点等非文字用途。
 *   不调 muted 本身：它在浅色面（工作台浅底卡、会员卡等）上是 5.1–5.7:1，调亮会让那些用法变差。
 *
 * 判据：
 *   1. 每个 wxss 里「`color:` 取 muted（令牌或 #6B6560 字面量）」且选择器不属于豁免态的声明数，逐文件只许减（棘轮）；
 *      新文件出现即红。存量在基线里，迁移后跑 `--update` 收紧。
 *   2. `app.wxss` 的 `--color-text-muted` 仍为 #6B6560、`--color-text-secondary` 仍为 #A09A90（改令牌值须先重评浅色面）。
 *
 * 用法：node miniprogram/scripts/check-mp-caption-color.mjs [--update | --report | --selftest]
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const MP = resolve(HERE, '..')
const BASELINE = join(HERE, 'caption-color-baseline.json')
const SKIP = new Set(['node_modules', 'miniprogram_npm', 'scripts', 'docs', '.tmp'])
const EXEMPT = /disabled|placeholder|inactive|soldout|sold-out|claimed|expired|strike|is-off|\.muted\b|\.off\b/i
const MUTED_COLOR = /(?:^|[;{\s])color:\s*(?:var\(--color-text-muted\b[^;}]*\)|#6b6560\b)/i

function listWxss(dir, out = []) {
  for (const n of readdirSync(dir)) {
    if (SKIP.has(n) || n.startsWith('.')) continue
    const p = join(dir, n)
    if (statSync(p).isDirectory()) listWxss(p, out)
    else if (n.endsWith('.wxss')) out.push(p)
  }
  return out
}

function countFile(css) {
  let n = 0
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (/@keyframes|^\s*(from|to|\d+%)/.test(m[1])) continue
    if (!MUTED_COLOR.test('{' + m[2])) continue
    const sels = m[1].split(',').map((s) => s.trim()).filter(Boolean)
    if (sels.length && sels.every((s) => EXEMPT.test(s))) continue
    n += 1
  }
  return n
}

function scan(files) {
  const counts = {}
  let total = 0
  for (const [rel, css] of Object.entries(files)) {
    const n = countFile(css)
    if (n) { counts[rel] = n; total += n }
  }
  return { counts, total }
}

function tokenOk(appWxss) {
  return /--color-text-muted:\s*#6B6560;/i.test(appWxss) && /--color-text-secondary:\s*#A09A90;/i.test(appWxss)
}

function judge(files, base) {
  const now = scan(files)
  const problems = []
  for (const [f, n] of Object.entries(now.counts)) {
    const was = base.counts[f] || 0
    if (n > was) problems.push(`${f}: ${was} → ${n}` + (was === 0 ? '（该文件此前没有 muted 说明字）' : ''))
  }
  if (!tokenOk(files['app.wxss'] || '')) problems.push('app.wxss 的 --color-text-muted / --color-text-secondary 令牌值被改（先重评浅色面用法）')
  return { now, problems }
}

const readAll = () => Object.fromEntries(listWxss(MP).map((p) => [relative(MP, p), readFileSync(p, 'utf8')]))

if (process.argv.includes('--selftest')) {
  const files = readAll()
  const base = scan(files)
  const target = 'pages/index/index.wxss'
  const cases = [
    ['已有文件新增一条 muted 说明字', { ...files, [target]: files[target] + '\n.probe-caption { color: var(--color-text-muted); }\n' }, true],
    ['新文件出现 muted 说明字（字面量写法）', { ...files, 'pages/probe/index.wxss': '.x { font-size: 22rpx; color: #6b6560; }' }, true],
    ['muted 令牌被调亮', { ...files, 'app.wxss': files['app.wxss'].replace('--color-text-muted: #6B6560;', '--color-text-muted: #8C867D;') }, true],
    ['豁免态（disabled）不误报', { ...files, [target]: files[target] + '\n.probe-btn.disabled { color: var(--color-text-muted); }\n' }, false],
    ['非文字用途（边框）不误报', { ...files, [target]: files[target] + '\n.probe-ring { border-color: var(--color-text-muted); }\n' }, false]
  ]
  let ok = judge(files, base).problems.length === 0
  console.log(`${ok ? '✓' : '✗'} 基线：真源码对自身基线为绿`)
  for (const [name, mutated, expectRed] of cases) {
    const red = judge(mutated, base).problems.length > 0
    const pass = red === expectRed
    if (!pass) ok = false
    console.log(`${pass ? '✓' : '✗'} ${name} → ${red ? '红' : '绿'}`)
  }
  console.log(ok ? '✓ selftest 通过' : '✗ selftest 失败')
  process.exit(ok ? 0 : 1)
}

const files = readAll()
if (process.argv.includes('--update')) {
  const now = scan(files)
  writeFileSync(BASELINE, JSON.stringify({ at: new Date().toISOString().slice(0, 10), total: now.total, counts: now.counts }, null, 1) + '\n')
  console.log(`✓ 基线已更新：${Object.keys(now.counts).length} 个文件 / 共 ${now.total} 处`)
  process.exit(0)
}
if (process.argv.includes('--report')) {
  const now = scan(files)
  console.log(`muted 说明字存量：${Object.keys(now.counts).length} 个文件 / 共 ${now.total} 处`)
  for (const [f, n] of Object.entries(now.counts).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${f}`)
  process.exit(0)
}
if (!existsSync(BASELINE)) { console.log('✗ 缺少基线（先跑 --update）'); process.exit(1) }
const { now, problems } = judge(files, JSON.parse(readFileSync(BASELINE, 'utf8')))
if (problems.length) {
  console.log('✗ 说明文字配色越线（说明文字最低用 --color-text-secondary；muted 只留给禁用/占位/失效态与非文字用途）：')
  for (const p of problems) console.log('  - ' + p)
  process.exit(1)
}
console.log(`✓ 说明文字配色：muted 作文字色 ${now.total} 处，逐文件未增长（规则与豁免见脚本头注）`)
