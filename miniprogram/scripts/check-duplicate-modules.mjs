#!/usr/bin/env node
/**
 * 分包内重复工具模块守卫（棘轮：只许减少）
 *
 * 背景（2026-09-17 全面审计 E2）：
 *   小程序分包里存在大量**同名且逐字节相同**的工具副本。实测 41 组同名文件（已剔除
 *   `index.js` 这种「同名不同模块」的噪声）中，31 组逐字节相同、10 组已分叉。
 *   逐字节相同者合计可省 321.8 KB，且全部落在分包内 —— 而分包有 2MB 硬上限
 *   （实测最大的 `subpackages/extra` 已到 1.742 MB，占上限 87%）。
 *
 *   本轮已把其中 **23 组 / 227.4 KB**（完全不含 `require` 的纯工具）下沉到主包
 *   `miniprogram/utils/`，分包内只留一句 `module.exports = require('…')` 再导出
 *   —— 零调用点改动，分包合计 -415.4 KB，主包 +187.9 KB，总量 -227.4 KB。
 *
 *   基线的 8 组是**含相对 require** 的（下沉需改写内部依赖），本轮刻意不动，留待人工。
 *
 * 本守卫做两件事：
 *   D1 棘轮：分包内「逐字节相同的重复」可省字节数**不得增长**（新增重复即失败）
 *   D2 再导出 shim 的**目标必须存在**（防止下沉后出现悬空 require）
 *
 * 用法：
 *   node miniprogram/scripts/check-duplicate-modules.mjs
 *   node miniprogram/scripts/check-duplicate-modules.mjs --update   # 收紧基线（改小后）
 *   node miniprogram/scripts/check-duplicate-modules.mjs --selftest
 */
'use strict'

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const MP = resolve(HERE, '..')
const ROOT = resolve(MP, '..')
const BASELINE = join(HERE, 'duplicate-modules-baseline.json')

const SKIP_DIRS = new Set(['cloudfunctions', 'minitest', 'scripts', 'docs', 'node_modules'])

/** 再导出 shim 的形态（与本轮下沉时写入的模板一致） */
const SHIM_RE = /^\s*module\.exports\s*=\s*require\(\s*(['"])(.+?)\1\s*\)\s*;?\s*$/m

export function sha1(text) {
  return createHash('sha1').update(text).digest('hex')
}

/** 递归收集 .js（排除 SKIP_DIRS） */
export function collectJs(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) collectJs(p, out)
    else if (e.name.endsWith('.js')) out.push(p)
  }
  return out
}

/**
 * 「主包未使用、改由各分包自行持有」的叶子工具白名单（2026-09-17）
 *
 * 冲突背景（两条规则对这批文件不可兼得）：
 *   · 微信「代码质量」判定：**主包内不应存在主包未使用的 JS**（主包 1536 KB 是硬约束，超了不能上传）；
 *   · 本守卫默认政策：实现下沉主包 utils/、分包只留再导出 shim。
 * 这批工具**只被分包使用、且零外部依赖**（自包含叶子模块）→ 留在主包就是那 26 个「未通过」项，
 * 搬走才能腾出体积。故**平台硬约束优先**，允许按分包各自持有，但设两道前提：
 *   ① 白名单内的文件在主包 `utils/` 下**必须已不存在**（此前提由调用方校验并传入，真搬走了才豁免）；
 *   ② 每个副本必须逐字节一致，由 `check:subpackage-refs` 的镜像清单保证（改一份必须同步改另一份）。
 * 其余重复（鉴权、账本等有语义的模块）**仍按棘轮收紧，不得放宽**。
 */
export const SUBPACKAGE_ONLY_LEAF_UTILS = new Set([
  'animalEthicsNotice.js', 'careDefaults.js', 'customDefaults.js', 'depositOrderDisplay.js',
  'financeDailyParse.js', 'giftScenes.js', 'legalContent.js', 'mallCommission.js',
  'onePercentPledge.js', 'payment.js', 'pledgeDue.js', 'productConcept.js', 'productTags.js',
  'qrcodeGen.js', 'signalLamp.js', 'studioInventoryParse.js', 'taxonomyZh.js', 'workspaceFeatures.js',
  // 第二批（2026-09-18）：主包未使用、零外部依赖的叶子工具，按分包各自持有
  'skuSize.js'
])

/**
 * 纯函数：算「分包内逐字节相同的重复」规模。
 * @param {Array<{path:string, size:number, hash:string}>} entries path 为相对 miniprogram 的路径
 * @returns {{ groups: Array, savableBytes: number, copies: number }}
 */
export function analyzeDuplicates(entries, opts = {}) {
  const exempt = opts.exemptLeafUtils || new Set()
  const byName = new Map()
  for (const e of entries) {
    const name = e.path.split('/').pop()
    if (name === 'index.js') continue // 同名不同模块，噪声
    if (!byName.has(name)) byName.set(name, [])
    byName.get(name).push(e)
  }
  const groups = []
  let savableBytes = 0
  let copies = 0
  for (const [name, list] of byName) {
    if (list.length < 2) continue
    if (new Set(list.map((x) => x.hash)).size !== 1) continue // 已分叉，不计入（需人工判语义）
    if (!list.every((x) => x.path.startsWith('subpackages/'))) continue // 只关心分包内的重复
    if (exempt.has(name)) continue // 主包未使用且已搬离主包的叶子工具：允许分包各自持有（见白名单注释）
    const size = list[0].size
    savableBytes += (list.length - 1) * size
    copies += list.length
    groups.push({ name, size, copies: list.length })
  }
  groups.sort((a, b) => b.size * b.copies - a.size * a.copies)
  return { groups, savableBytes, copies }
}

/** D2：分包内的再导出 shim 目标必须存在 */
export function checkShims(files, readFile, exists) {
  const problems = []
  let shims = 0
  for (const f of files) {
    let src
    try { src = readFile(f) } catch { continue }
    const m = src.match(SHIM_RE)
    if (!m) continue
    shims += 1
    const target = resolve(dirname(f), m[2])
    if (!exists(target) && !exists(`${target}.js`)) {
      problems.push(`${relative(MP, f)} 的再导出目标不存在：${m[2]}`)
    }
  }
  return { problems, shims }
}

function scanRepo() {
  const files = collectJs(MP)
  const entries = files.map((f) => {
    const src = readFileSync(f, 'utf8')
    return { path: relative(MP, f), size: Buffer.byteLength(src), hash: sha1(src) }
  })
  // 豁免前提（守卫自查）：白名单文件在主包 utils/ 下**确实已不存在**，才允许分包各自持有
  const exemptLeafUtils = new Set(
    [...SUBPACKAGE_ONLY_LEAF_UTILS].filter((name) => !existsSync(join(MP, 'utils', name)))
  )
  const dup = analyzeDuplicates(entries, { exemptLeafUtils })
  const shims = checkShims(files, (f) => readFileSync(f, 'utf8'), (p) => existsSync(p))
  return { dup, shims, total: entries.length }
}

function selftest() {
  let bad = 0
  const t = (n, ok) => { if (!ok) bad += 1; console.log(`${ok ? '✓' : '✗'} ${n}`) }
  const e = (path, content) => ({ path, size: content.length, hash: sha1(content) })

  const same = analyzeDuplicates([
    e('subpackages/a/utils/x.js', 'AAA'),
    e('subpackages/b/utils/x.js', 'AAA'),
  ])
  t('★ 分包内逐字节相同 → 计入可省', same.groups.length === 1 && same.savableBytes === 3)

  const diverged = analyzeDuplicates([
    e('subpackages/a/utils/x.js', 'AAA'),
    e('subpackages/b/utils/x.js', 'BBB'),
  ])
  t('  已分叉 → 不计入（需人工判语义）', diverged.groups.length === 0)

  const indexed = analyzeDuplicates([
    e('subpackages/a/index.js', 'AAA'),
    e('subpackages/b/index.js', 'AAA'),
  ])
  t('  index.js 同名不同模块 → 不计入', indexed.groups.length === 0)

  const mainCopy = analyzeDuplicates([
    e('utils/x.js', 'AAA'),
    e('subpackages/a/utils/x.js', 'AAA'),
  ])
  t('  主包+分包各一份（下沉完成形态）→ 不计入', mainCopy.groups.length === 0)

  const two = analyzeDuplicates([
    e('subpackages/a/utils/x.js', 'AAAA'),
    e('subpackages/b/utils/x.js', 'AAAA'),
    e('subpackages/c/utils/x.js', 'AAAA'),
  ])
  t('  三份相同 → 可省 2×size', two.savableBytes === 8)

  // D2
  const fakeFiles = ['/mp/subpackages/a/utils/x.js']
  const readOk = () => "module.exports = require('../../../utils/x')"
  t('★ shim 目标存在 → 通过',
    checkShims(fakeFiles, readOk, (p) => p.endsWith('/utils/x.js') || p === '/mp/subpackages/a/utils/x.js').problems.length === 0)
  t('★ shim 目标缺失 → 检出',
    checkShims(fakeFiles, readOk, () => false).problems.length === 1)

  if (bad) {
    console.error(`\n自检失败 ${bad} 项 —— 守卫不可信，请先修它`)
    process.exit(1)
  }
  console.log('\n自检通过：相同/分叉/同名不同模块/下沉完成形态判定正确，悬空 shim 会检出')
}

if (process.argv.includes('--selftest')) {
  selftest()
  process.exit(0)
}

const { dup, shims, total } = scanRepo()

if (process.argv.includes('--update')) {
  writeFileSync(BASELINE, `${JSON.stringify({
    updatedAt: new Date().toISOString().slice(0, 10),
    note: '分包内逐字节相同的重复工具：可省字节数只许减少（棘轮）。--update 收紧后不得再放宽。',
    savableBytes: dup.savableBytes,
    groups: dup.groups.map((g) => `${g.name} ×${g.copies}`),
  }, null, 2)}\n`, 'utf8')
  console.log(`已写入基线：可省 ${(dup.savableBytes / 1024).toFixed(1)} KB（${dup.groups.length} 组）`)
  process.exit(0)
}

let fail = 0
if (dup.savableBytes > 0) {
  console.log(`分包内逐字节相同的重复：${dup.groups.length} 组，可省 ${(dup.savableBytes / 1024).toFixed(1)} KB`)
  for (const g of dup.groups.slice(0, 10)) {
    console.log(`  · ${g.name.padEnd(24)} ${String(g.size).padStart(6)}B ×${g.copies}`)
  }
}

let baseline = null
if (existsSync(BASELINE)) {
  try { baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) } catch { baseline = null }
}
if (baseline && typeof baseline.savableBytes === 'number') {
  if (dup.savableBytes > baseline.savableBytes) {
    console.error(`\n✗ 分包内重复可省字节增长：基线 ${(baseline.savableBytes / 1024).toFixed(1)} KB → 本次 ${(dup.savableBytes / 1024).toFixed(1)} KB`)
    console.error('  新增了重复工具模块。修法：把实现下沉到主包 utils/，分包内只留再导出 shim（见 E2 处置）。')
    fail += 1
  } else {
    console.log(`\n✓ 棘轮未恶化（基线 ${(baseline.savableBytes / 1024).toFixed(1)} KB / 本次 ${(dup.savableBytes / 1024).toFixed(1)} KB）`)
    if (dup.savableBytes < baseline.savableBytes) {
      console.log('  已低于基线 —— 可跑 --update 收紧')
    }
  }
} else {
  console.log('（未找到基线，跑 --update 生成）')
}

if (dup.groups.length && !baseline) fail += 1

if (shims.problems.length) {
  console.error(`✗ 再导出 shim 悬空 ${shims.problems.length} 处：`)
  shims.problems.forEach((p) => console.error(`  - ${p}`))
  fail += shims.problems.length
} else {
  console.log(`✓ 再导出 shim 目标全部有效（${shims.shims} 个 shim / 共 ${total} 个 .js）`)
}

if (fail) process.exit(1)
console.log('通过了：分包内重复已被棘轮守住，shim 无悬空。')
