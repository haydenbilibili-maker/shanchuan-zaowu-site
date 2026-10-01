/**
 * 弹窗/提示统一 · 棘轮守卫（W2）
 *
 * 背景（2026-09-19 v1.1.2 实测基线）：全站 `wx.showToast` **1834** 处、`wx.showModal` **170** 处，
 * 散在 **159** 个文件；统一组件 `AppToast` / `AppModal` 已备但未推广。
 * 一次性迁移风险大 ✗ → 先上**棘轮**：把今天的数字**冻结**，之后**只许降、不许涨**。
 *
 * 判据：
 *   ① 任一文件的原生调用数**不得超过**基线（防"边迁移边新增"）；
 *   ② **总量不得超过**基线（净变化必须为负或零）；
 *   ③ 基线里没有的文件**不得出现**原生调用（防新页面重新引入）。
 *
 * 用法：
 *   node miniprogram/scripts/check-dialog-ratchet.mjs            # 检查
 *   node miniprogram/scripts/check-dialog-ratchet.mjs --report   # 只报告（迁移优先级清单）
 *   node miniprogram/scripts/check-dialog-ratchet.mjs --update   # 迁移一批后重设基线
 *   node miniprogram/scripts/check-dialog-ratchet.mjs --selftest
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const MP = resolve(ROOT, 'miniprogram')
const BASELINE = resolve(HERE, 'dialog-ratchet-baseline.json')
const SKIP = new Set(['node_modules', '.git', 'miniprogram_npm', 'dist', 'scripts'])
const PATTERNS = [/wx\.showToast\s*\(/g, /wx\.showModal\s*\(/g]

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name) || name.startsWith('.')) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (name.endsWith('.js')) out.push(p)
  }
  return out
}

function scan() {
  const counts = {}
  let total = 0
  for (const abs of walk(MP)) {
    const src = readFileSync(abs, 'utf8')
    let n = 0
    for (const re of PATTERNS) n += (src.match(re) || []).length
    if (!n) continue
    counts[relative(ROOT, abs)] = n
    total += n
  }
  return { counts, total }
}

const now = scan()
const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : null

if (process.argv.includes('--update')) {
  writeFileSync(BASELINE, JSON.stringify({ at: new Date().toISOString(), total: now.total, counts: now.counts }, null, 1) + '\n')
  console.log(`✓ 棘轮基线已更新：${Object.keys(now.counts).length} 个文件 / 共 ${now.total} 处`)
  process.exit(0)
}

if (process.argv.includes('--report')) {
  const rows = Object.entries(now.counts).sort((a, b) => b[1] - a[1])
  console.log(`弹窗/提示现状：${rows.length} 个文件 / 共 ${now.total} 处（基线 ${base ? base.total : '—'}）`)
  console.log('迁移优先级（按存量）：')
  for (const [f, n] of rows.slice(0, 15)) console.log(`  ${String(n).padStart(4)}  ${f}`)
  process.exit(0)
}

if (process.argv.includes('--selftest')) {
  const target = join(MP, 'pages/index/index.js')
  const orig = readFileSync(target, 'utf8')
  // 基线只许降、不强制收紧：该文件实际数可能低于基线，探针数要盖过余量才必然越线
  const rel = relative(ROOT, target)
  const slack = Math.max(0, ((base && base.counts[rel]) || 0) - (now.counts[rel] || 0))
  writeFileSync(target, orig + "\nwx.showToast({ title: '棘轮自检探针', icon: 'none' })\n".repeat(slack + 1))
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8' })
  writeFileSync(target, orig)
  if (readFileSync(target, 'utf8') !== orig) { console.log('✗ 未能逐字还原'); process.exit(1) }
  if (r.status === 0) { console.log('✗ 注入未被检出：原生调用新增时应失败'); process.exit(1) }
  console.log('✓ 自检通过：新增原生调用被检出、源文件逐字还原')
  process.exit(0)
}

if (!base) { console.log('✗ 缺少基线文件（先跑 --update 生成）'); process.exit(1) }
const grew = []
for (const [f, n] of Object.entries(now.counts)) {
  const was = base.counts[f] || 0
  if (n > was) grew.push(`${f}: ${was} → ${n}（+${n - was}）` + (was === 0 ? '  ← 该文件此前无原生弹窗' : ''))
}
const problems = [...grew]
if (now.total > base.total) problems.push(`总量增长：${base.total} → ${now.total}（+${now.total - base.total}）`)

if (problems.length) {
  console.log('✗ 弹窗棘轮被突破（统一迁移中不得新增原生调用）：')
  for (const p of problems) console.log('  - ' + p)
  console.log('  说明：改用 components/AppToast 或 components/AppModal；确有必要请先 --update 并说明理由。')
  console.log(`✗ ${problems.length} 处越线（当前 ${now.total} / 基线 ${base.total}）`)
  process.exit(1)
}
console.log(`✓ 弹窗棘轮：当前 ${now.total} 处 ≤ 基线 ${base.total} 处（未新增原生调用；迁移进度见 --report）`)
