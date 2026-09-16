#!/usr/bin/env node
/**
 * 财务**读路径**守卫（本轮新建）
 *
 * 守两件事，都是本轮实测出的缺陷：
 *
 * ① 成本率的**出处**必须能被区分。
 *    原本文案一律写「按财务设置成本率 X% 估算」，而在「本机没有财务设置」的设备上
 *    X 其实是兜底默认 25%。实测：配置 60% 的设备毛利 ¥820.07，清空 localStorage 的设备算
 *    ¥1,537.63 —— 差近一倍，而界面都写着「财务设置」。
 *
 * ② 读取数页面**不得回写云端**。
 *    ERP 里只有 Finance 页会主动 `autoSyncFinanceData()`；其余页面（驾驶舱/决策中心/监控大屏/
 *    自定义报表）都只读本机缓存。实测：清空 localStorage 后云端 finance_records 有 308 行，
 *    而监控大屏显示「财务账本暂无记录 / 今日营收 ¥0」。
 *    于是本轮让读路径**先只读拉取**云端权威（financialData.ensureLedgerFresh）。
 *    但 `syncFinanceRecords` 在「云端读失败」时会因 `mergedRecords.length > cloudRecords.length`
 *    把本机账本**反向推上云** —— 「读不到云端」不等于「云端为空」。
 *    所以读路径必须显式传 `readOnly: true`，本守卫静态拦住漏传的调用点。
 *
 * 用法：
 *   node admin/scripts/test-finance-read-path.mjs
 *   node admin/scripts/test-finance-read-path.mjs --selftest
 */
'use strict'

import { readFileSync, writeFileSync, unlinkSync, readdirSync, statSync } from 'node:fs'
import { dirname, resolve, relative, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ADMIN = resolve(HERE, '..')
const SRC = resolve(ADMIN, 'src')
const COST_RATE = resolve(SRC, 'utils', 'costRate.js')

/** 允许多次失败一起报 */
const failures = []
let pass = 0
const eq = (name, actual, expected) => {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) pass += 1
  else failures.push(`${name} — 期望 ${e}，实际 ${a}`)
}

// ─────────────────────── ① 成本率出处 ───────────────────────

async function runCostRateSuite(modulePath) {
  const mod = await import(`file://${modulePath}?t=${Date.now()}`)
  const { resolveCostRate, normalizeCostRate, DEFAULT_COST_RATE } = mod

  eq('无设置 → 用默认值且标注 default', resolveCostRate({}), { rate: DEFAULT_COST_RATE, source: 'default' })
  eq('settings 为 undefined → default', resolveCostRate(undefined), { rate: DEFAULT_COST_RATE, source: 'default' })
  eq('键存在但为空串 → default', resolveCostRate({ costRate: '' }), { rate: DEFAULT_COST_RATE, source: 'default' })
  eq('非法值（负）→ default', resolveCostRate({ costRate: -1 }), { rate: DEFAULT_COST_RATE, source: 'default' })
  eq('非法值（NaN）→ default', resolveCostRate({ costRate: 'abc' }), { rate: DEFAULT_COST_RATE, source: 'default' })
  eq('小数 0.6 → setting', resolveCostRate({ costRate: 0.6 }), { rate: 0.6, source: 'setting' })
  eq('百分数 60 → setting 且归一到 0.6', resolveCostRate({ costRate: 60 }), { rate: 0.6, source: 'setting' })
  eq('0 是合法设置（零成本）→ setting', resolveCostRate({ costRate: 0 }), { rate: 0, source: 'setting' })
  eq('兼容旧键名 setCostRate', resolveCostRate({ setCostRate: 0.35 }), { rate: 0.35, source: 'setting' })
  eq('normalizeCostRate 行为不变（兼容）', normalizeCostRate(undefined), DEFAULT_COST_RATE)
}

// ─────────────────────── ② 读路径不得回写云端 ───────────────────────

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (/\.(vue|js)$/.test(name)) out.push(p)
  }
  return out
}

/**
 * 找 `autoSyncFinanceData(` 的调用点，要求同一次调用里带 `readOnly: true`。
 *
 * 三类**不算**读路径，豁免：
 *  · `Finance.vue` —— 它就是「同步」这个功能本身的入口，双向同步是它的职责；
 *  · `financeSync.js` —— `autoSyncFinanceData` 的**定义处**，以及用户手动点「上传/下载」时走的
 *    `manualSyncFinanceData`（显式写操作，不是页面取数）；
 *  · 调用里已写 `forceDownload: true` —— 该分支本身就会跳过回推（`!forceDownload &&` 守卫）。
 */
const SYNC_WRITER_ALLOWLIST = new Set(['components/Finance.vue', 'utils/financeSync.js'])

function findNonReadOnlySyncs(files) {
  const bad = []
  for (const abs of files) {
    const rel = relative(SRC, abs).split('\\').join('/')
    if (SYNC_WRITER_ALLOWLIST.has(rel)) continue
    const txt = readFileSync(abs, 'utf8')
    // 去掉注释行，避免把「说明文字里提到 autoSyncFinanceData(...)」当成调用
    const code = txt
      .split('\n')
      .map((l) => (/^\s*(\/\/|\*|\/\*)/.test(l) ? '' : l))
      .join('\n')
    for (const m of code.matchAll(/autoSyncFinanceData\s*\(([^)]*)\)/g)) {
      const args = m[1]
      if (/readOnly\s*:\s*true/.test(args)) continue
      if (/forceDownload\s*:\s*true/.test(args)) continue
      const line = code.slice(0, m.index).split('\n').length
      bad.push(`${rel}:${line} autoSyncFinanceData(${args.trim()}) —— 读路径必须传 readOnly: true`)
    }
  }
  return bad
}

async function runStaticSuite(files) {
  const bad = findNonReadOnlySyncs(files)
  const expect = process.env.__EXPECT_SYNC_VIOLATION === '1' ? 1 : 0
  eq('读路径调用 autoSyncFinanceData 必须带 readOnly:true', bad.length, expect)
  if (bad.length && expect === 0) bad.forEach((b) => failures.push(b))
}

// ─────────────────────── 主流程 ───────────────────────

const selftest = process.argv.includes('--selftest')
const files = walk(SRC)

if (!selftest) {
  await runCostRateSuite(COST_RATE)
  await runStaticSuite(files)
  const label = '财务读路径守卫（成本率出处 + 读路径不回写）'
  console.log(`${label}：${pass} 项通过，${failures.length} 项失败`)
  if (failures.length) {
    failures.forEach((f) => console.error(`   ✗ ${f}`))
    process.exit(1)
  }
  console.log('全部通过：默认成本率可辨、读路径只读拉取、写入口白名单唯一。')
  process.exit(0)
}

// ── 自检：两件事各自破坏一次，必须都被检出，然后按字节还原 ──
console.log('自检 A：把「默认值」伪装成「财务设置」（回到原缺陷），必须检出\n')
const TMP = resolve(SRC, 'utils', '__selftest_costrate.js')
const origCost = readFileSync(COST_RATE, 'utf8')
try {
  writeFileSync(
    TMP,
    origCost.replace(
      "return { rate: DEFAULT_COST_RATE, source: 'default' }",
      "return { rate: DEFAULT_COST_RATE, source: 'setting' }",
    ),
  )
  const before = failures.length
  eq('自检A-破坏后：无设置必须仍是 default', (await import(`file://${TMP}?t=${Date.now()}`)).resolveCostRate({}), {
    rate: 0.25,
    source: 'default',
  })
  if (failures.length > before) console.log('✓ 已检出：把默认值标成 setting 会被本守卫判失败')
  else {
    console.error('✗ 未检出：注入「默认值伪装成财务设置」后守卫仍然通过')
    process.exit(1)
  }
} finally {
  try { unlinkSync(TMP) } catch { /* ignore */ }
}

console.log('\n自检 B：读路径漏传 readOnly:true，必须检出\n')
// 注入一个「读页面直接裸调 autoSyncFinanceData()」的临时模块，守卫必须报出来。
// 之所以是**注入**而不是「在仓库里找一个已有的违规」：修好之后仓库里就不该有违规了，
// 依赖「仓库里存在缺陷」的自检会在修好的那天变成永远失败（或被迫留着缺陷）。
const TMP_READER = resolve(SRC, 'utils', '__selftest_reader.js')
try {
  writeFileSync(
    TMP_READER,
    "'use strict'\nimport { autoSyncFinanceData } from './financeSync.js'\n"
      + 'export async function loadPage() {\n  await autoSyncFinanceData()\n  return 1\n}\n',
  )
  const bad = findNonReadOnlySyncs(walk(SRC))
  const hit = bad.filter((b) => b.includes('__selftest_reader.js'))
  if (hit.length === 1) {
    console.log('✓ 已检出注入的违规读路径：')
    hit.forEach((b) => console.log(`    · ${b}`))
  } else {
    console.error(`✗ 未检出：注入了裸调 autoSyncFinanceData() 的读模块，守卫却报 ${hit.length} 处`)
    process.exit(1)
  }
} finally {
  try { unlinkSync(TMP_READER) } catch { /* ignore */ }
}

// 源文件按字节还原确认
if (readFileSync(COST_RATE, 'utf8') !== origCost) {
  console.error('✗ 自检后源文件与原文不一致')
  process.exit(1)
}
console.log('\n自检通过：两类缺陷都能被破坏检出，且源文件按字节还原。')
