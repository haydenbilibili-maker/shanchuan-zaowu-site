#!/usr/bin/env node
/**
 * 静默吞错守卫（棘轮：只许减少，不许新增）
 *
 * 背景（2026-09-16 ERP 审计）：
 * `.catch(() => {})` / `.catch(() => [])` 这类写法会让写失败彻底消失 ——
 * 运营点了「批准」，界面没有任何反应，数据也没变（审计 §0 P0-8 / P1「写失败被当成成功」）。
 * 全仓曾累计 74 处；逐个人工改成「显式报错」需要多轮，但要**防止边改边新增**。
 *
 * 做法：把当前每文件的处数写进基线 JSON。之后：
 *   · 任何文件处数**上升** → 失败（新增了静默吞错）
 *   · 处数**下降** → 提示更新基线（说明有进展，把棘轮拧紧）
 *   · 新文件带入静默吞错 → 失败
 *
 * 用法：
 *   node admin/scripts/check-silent-catch.mjs            # 校验
 *   node admin/scripts/check-silent-catch.mjs --update   # 拧紧棘轮（改完后重算基线）
 *   node admin/scripts/check-silent-catch.mjs --selftest # 证明新增一处会被判失败
 */
'use strict'

import { readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { dirname, resolve, relative, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..')
const DEFAULT_ROOT = resolve(REPO, 'admin', 'src')
const DEFAULT_BASELINE = resolve(HERE, 'silent-catch-baseline.json')

/**
 * 被判定为「静默吞错」的写法。
 *
 * 注意：**必须在 stripComments 之后匹配**，且三种形态互斥，不能重叠 ——
 * 否则同一个 `catch (e) { /* 忽略 *\/ }` 会被多条正则同时命中而重复计数（第一版就这样，实测 134 vs 151）。
 * 过滤注释后，「仅注释的空块」自然退化成「空块」，所以不再需要单独一条。
 */
const PATTERNS = [
  ['箭头 catch 空块', /\.catch\(\s*\([^)]*\)\s*=>\s*\{\s*\}\s*\)/g],
  ['try/catch 空块', /\bcatch\s*\(\s*[^)]*\)\s*\{\s*\}/g],
  ['箭头 catch 返回空数组', /\.catch\(\s*\([^)]*\)\s*=>\s*\[\s*\]\s*\)/g],
]

function listSourceFiles(root) {
  const out = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      const p = join(dir, entry.name)
      if (entry.isDirectory()) walk(p)
      else if (/\.(vue|js)$/.test(entry.name)) out.push(p)
    }
  }
  walk(root)
  return out
}

/**
 * 去掉注释后再匹配。
 *
 * ⚠️ 不过滤注释会造假阳性：本仓有大量「不再 .catch(() => {})：……」这类说明性注释，
 * 它们描述历史写法，并不是真的静默吞错。第一版没过滤，导致基线把注释算进去（当天实测）。
 * 先用等长空白替换注释，保持字符偏移不变，便于以后要定位行号。
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length))
}

/** 返回 { '相对路径': 处数 } */
export function scanSilentCatches(root) {
  const counts = {}
  for (const file of listSourceFiles(root)) {
    const src = stripComments(readFileSync(file, 'utf8'))
    let n = 0
    for (const [, re] of PATTERNS) n += (src.match(re) || []).length
    if (n > 0) counts[relative(REPO, file)] = n
  }
  return counts
}

function loadBaseline(path) {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function compare(current, baseline) {
  const failures = []
  const improvements = []
  let totalNow = 0
  let totalBefore = 0

  for (const [file, n] of Object.entries(current)) totalNow += n
  for (const n of Object.values(baseline)) totalBefore += n

  for (const [file, n] of Object.entries(current)) {
    const before = baseline[file]
    if (before === undefined) {
      failures.push(`新增了静默吞错：${file}（${n} 处）`)
    } else if (n > before) {
      failures.push(`静默吞错变多：${file} ${before} → ${n} 处`)
    } else if (n < before) {
      improvements.push(`${file} ${before} → ${n} 处`)
    }
  }
  for (const file of Object.keys(baseline)) {
    if (current[file] === undefined) improvements.push(`${file} 已清零（基线 ${baseline[file]} 处）`)
  }
  return { failures, improvements, totalNow, totalBefore }
}

function runSelfTest() {
  console.log('自检：新增一处静默吞错必须被判失败\n')
  const tmp = join(tmpdir(), `silent-catch-selftest-${Date.now()}`)
  const root = join(tmp, 'src')
  mkdirSync(root, { recursive: true })
  const baselinePath = join(tmp, 'baseline.json')
  let detected = false
  let cleanedUp = false
  try {
    writeFileSync(join(root, 'ok.vue'), 'const a = () => p.catch((e) => { console.error(e) })\n', 'utf8')
    const baseline = scanSilentCatches(root)
    writeFileSync(baselinePath, JSON.stringify(baseline, null, 1), 'utf8')

    // 干净状态应通过
    let r = compare(scanSilentCatches(root), baseline)
    const cleanPasses = r.failures.length === 0

    // 引入一处新的静默吞错
    writeFileSync(join(root, 'bad.vue'), 'const b = () => p.catch(() => {})\n', 'utf8')
    r = compare(scanSilentCatches(root), baseline)
    detected = r.failures.length > 0 && r.failures.some((f) => /新增了静默吞错/.test(f))

    console.log(`${cleanPasses ? '✓' : '✗'} 基线状态下通过`)
    console.log(`${detected ? '✓' : '✗'} 新增静默吞错 → ${detected ? '已检出' : '【漏检】'}`)
    if (detected) r.failures.forEach((f) => console.log(`    · ${f}`))
  } finally {
    rmSync(tmp, { recursive: true, force: true })
    cleanedUp = !existsSync(tmp)
  }
  console.log(`${cleanedUp ? '✓' : '✗'} 自检临时目录已清理\n`)
  if (!detected || !cleanedUp) {
    console.error('自检失败：守卫无法阻止新增，或临时文件未清理。')
    process.exit(1)
  }
  console.log('自检通过：棘轮能阻止新增静默吞错。\n')
}

// ---------- main ----------
const argv = process.argv.slice(2)
if (argv.includes('--selftest')) runSelfTest()

const argVal = (flag, fallback) => {
  const i = argv.indexOf(flag)
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback
}
const root = resolve(REPO, argVal('--root', DEFAULT_ROOT))
const baselinePath = resolve(REPO, argVal('--baseline', DEFAULT_BASELINE))
const current = scanSilentCatches(root)

if (argv.includes('--update')) {
  writeFileSync(baselinePath, JSON.stringify(current, null, 1) + '\n', 'utf8')
  const total = Object.values(current).reduce((a, b) => a + b, 0)
  console.log(`基线已更新：${Object.keys(current).length} 个文件 / ${total} 处 → ${relative(REPO, baselinePath)}`)
  process.exit(0)
}

const baseline = loadBaseline(baselinePath)
if (!baseline) {
  console.error(`找不到基线文件：${relative(REPO, baselinePath)}（首次请跑 --update）`)
  process.exit(1)
}

const { failures, improvements, totalNow, totalBefore } = compare(current, baseline)
console.log(`静默吞错守卫：当前 ${totalNow} 处 / 基线 ${totalBefore} 处（${Object.keys(current).length} 个文件）`)
if (improvements.length) {
  console.log('\n有进展（请跑 --update 拧紧棘轮）：')
  improvements.slice(0, 20).forEach((s) => console.log(`  ↓ ${s}`))
}
if (failures.length) {
  console.error('\n失败明细：')
  failures.forEach((f) => console.error(`  ✗ ${f}`))
  console.error('\n请把静默吞错改成显式错误提示（参考 Refunds.vue / CRM.vue 的处理方式），')
  console.error('确认是「可忽略」的场景时，也请在 catch 里写 console.warn 说明原因。')
  process.exit(1)
}
console.log('通过：没有新增静默吞错。')
