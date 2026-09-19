#!/usr/bin/env node
/**
 * 工作室结算 · 写入路径守卫（`settlementDefaults.js`）
 *
 * 为什么需要：`test:studio-pricing` 守的是**算价**（读路径），
 * 而价目表**怎么被写进库**是另一条路径 —— 脏数据从写入方进来，算价方再正确也没用。
 * 两条路径共用 `pricingCore.js`（共享家族，由 `check:shared-modules` 守同源），
 * 但写入方自己还有一圈归一化与默认值，那圈没有任何守卫。
 *
 * 本守卫钉住的四条**安全性质**（每条都配注入证明不是恒真）：
 *   ① **`enabled` 缺字段默认「关」** —— 算价会影响门店要付多少钱，
 *      绝不能在价目表还没维护好时「因为没有配置所以自己开始算钱」。
 *      这条与仓库既有的 `showXxx` 先例同一原则（缺字段默认关，由超管显式开启）。
 *   ② 单价落库前**按分取整** —— 19.999 这类值不取整会在后续乘算里累积误差，对账说不清。
 *   ③ 别名**按归一化值去重**且有上限 —— 否则 `大蓝闪` 与 `大蓝闪 ` 会并存，
 *      或者一行塞进几百个别名把搜索拖慢。
 *   ④ **默认行标记只认布尔 true** —— 一旦每行都成默认行，
 *      「文本没写等级时用哪一行」就变成不确定（`validatePriceBook` 会报 MULTIPLE_DEFAULT）。
 *
 * 用法：
 *   node miniprogram/scripts/test-studio-settlement.mjs
 *   node miniprogram/scripts/test-studio-settlement.mjs --selftest
 * 退出码：断言失败 1；注入未被检出 1；全通过 0。
 */
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const FN_DIR = resolve(ROOT, 'miniprogram/cloudfunctions/manageStudioSettlement')
const DEFAULTS_PATH = join(FN_DIR, 'settlementDefaults.js')
const CORE_PATH = join(FN_DIR, 'pricingCore.js')

let passes = 0
const failures = []

function ok(label, cond, detail) {
  if (cond) passes += 1
  else failures.push(detail ? `${label} —— ${detail}` : label)
}
function eq(label, got, want) {
  ok(label, got === want, `期望 ${JSON.stringify(want)}，实际 ${JSON.stringify(got)}`)
}
function deepEq(label, got, want) {
  const a = JSON.stringify(got)
  const b = JSON.stringify(want)
  ok(label, a === b, `期望 ${b}，实际 ${a}`)
}

function runTests(D, CORE) {
  // ── A. buildRow：写入前归一化 ──
  const bad = (input, kind) => D.buildRow(input, kind || 'material').ok === false
  ok('A1 缺名称被拒', bad({ unitPrice: 10 }))
  ok('A2 负单价被拒', bad({ name: '负价料', unitPrice: -1 }))
  ok('A3 非数字单价被拒', bad({ name: '乱价料', unitPrice: 'abc' }))
  ok('A4 未知价目本被拒', bad({ name: 'x', unitPrice: 1 }, 'nope'))

  const m1 = D.buildRow({ name: '大蓝闪蝶', grade: 'A1', unitPrice: 300 }, 'material')
  ok('A5 正常材料行通过', m1.ok === true, JSON.stringify(m1))
  eq('A6 normName 已算好', m1.row.normName, CORE.normalizeName('大蓝闪蝶'))
  eq('A7 等级原样保留', m1.row.grade, 'A1')
  eq('A8 默认等级标记只认布尔 true（未传 → false）', m1.row.isDefaultGrade, false)

  const m2 = D.buildRow({ name: '大蓝闪蝶', unitPrice: 300, isDefaultGrade: true }, 'material')
  eq('A9 显式 true 才成为默认行', m2.row.isDefaultGrade, true)
  const m3 = D.buildRow({ name: '大蓝闪蝶', unitPrice: 300, isDefaultGrade: 'true' }, 'material')
  eq('A10 字符串 "true" 不算默认行', m3.row.isDefaultGrade, false)

  const m4 = D.buildRow({ name: '雅灰蝶', unitPrice: 80, grade: '   ' }, 'material')
  eq('A11 等级留空落「默认」', m4.row.grade, CORE.DEFAULT_GRADE)
  const p1 = D.buildRow({ name: '冰箱贴', unitPrice: 12, size: '' }, 'packaging')
  eq('A12 尺寸留空落「默认」', p1.row.size, CORE.DEFAULT_SIZE)

  const m5 = D.buildRow({ name: '全角料', unitPrice: 10 }, 'material')
  const m6 = D.buildRow({ name: '全角料', unitPrice: 10, grade: '' }, 'material')
  eq('A13 归一化后同名同等级 → 判重键一致', m5.row.normName + '|' + m5.row.grade, m6.row.normName + '|' + m6.row.grade)

  // ⚠️ 单价按分取整（19.999 → 20.00）
  const m7 = D.buildRow({ name: '零头料', unitPrice: 19.999 }, 'material')
  eq('A14 单价按分取整（19.999 → 20）', m7.row.unitPrice, 20)
  const m8 = D.buildRow({ name: '零头料2', unitPrice: 19.994 }, 'material')
  eq('A15 单价按分取整（19.994 → 19.99）', m8.row.unitPrice, 19.99)

  // qtyPerUnit：缺失/非法一律 1（蓝图裁决 19）
  eq('A16 qtyPerUnit 缺失 → 1', D.buildRow({ name: 'a', unitPrice: 1 }, 'material').row.qtyPerUnit, 1)
  eq('A17 qtyPerUnit=0 → 1', D.buildRow({ name: 'b', unitPrice: 1, qtyPerUnit: 0 }, 'material').row.qtyPerUnit, 1)
  eq('A18 qtyPerUnit=3 保留', D.buildRow({ name: 'c', unitPrice: 1, qtyPerUnit: 3 }, 'material').row.qtyPerUnit, 3)

  // 别名：按归一化去重 + 上限 20
  const m9 = D.buildRow({ name: '别名料', unitPrice: 1, aliases: ['大蓝闪', ' 大蓝闪 ', '大 蓝 闪', '闪蓝大'] }, 'material')
  deepEq('A19 别名按归一化值去重', m9.row.aliases, ['大蓝闪', '闪蓝大'])
  const many = []
  for (let i = 0; i < 40; i += 1) many.push('别名' + i)
  eq('A20 别名上限 20', D.buildRow({ name: '多别名料', unitPrice: 1, aliases: many }, 'material').row.aliases.length, 20)
  deepEq('A21 别名支持逗号分隔字符串', D.buildRow({ name: 'x', unitPrice: 1, aliases: '甲, 乙' }, 'material').row.aliases, ['甲', '乙'])

  // status
  eq('A22 非法 status 归为 active', D.buildRow({ name: 's', unitPrice: 1, status: '???' }, 'material').row.status, 'active')
  eq('A23 inactive 保留', D.buildRow({ name: 's', unitPrice: 1, status: 'inactive' }, 'material').row.status, 'inactive')

  // 分本专属字段
  eq('A24 材料行有 category', D.buildRow({ name: 'k', unitPrice: 1, category: '标本' }, 'material').row.category, '标本')
  eq('A25 非法 category 清空', D.buildRow({ name: 'k', unitPrice: 1, category: '乱写' }, 'material').row.category, '')
  ok('A26 包装行不带 category', D.buildRow({ name: 'p', unitPrice: 1 }, 'packaging').row.category === undefined)
  eq('A27 新行 deleted 为 false', D.buildRow({ name: 'd', unitPrice: 1 }, 'material').row.deleted, false)

  // ── B. normalizeConfig：安全默认 ──
  const empty = D.normalizeConfig(null)
  eq('B1 **缺配置时 enabled 默认关**（不能因为没配置就自己开始算钱）', empty.enabled, false)
  eq('B2 缺配置时费率取默认 30', empty.laborRatePct, 30)
  eq('B3 缺配置时要求写包装', empty.requirePackaging, true)
  eq('B4 enabled 显式 true 才开', D.normalizeConfig({ enabled: true }).enabled, true)
  eq('B5 enabled 字符串 "true" 不算开', D.normalizeConfig({ enabled: 'true' }).enabled, false)
  eq('B6 enabled 为 1 不算开', D.normalizeConfig({ enabled: 1 }).enabled, false)
  eq('B7 费率负数归 0', D.normalizeConfig({ laborRatePct: -5 }).laborRatePct, 0)
  eq('B8 费率超上限归 500', D.normalizeConfig({ laborRatePct: 9999 }).laborRatePct, 500)
  eq('B9 费率 0 是合法值（不回落默认 30）', D.normalizeConfig({ laborRatePct: 0 }).laborRatePct, 0)
  eq('B10 requirePackaging 仅显式 false 才关', D.normalizeConfig({ requirePackaging: false }).requirePackaging, false)
  eq('B11 requirePackaging 字符串 "false" 不算关', D.normalizeConfig({ requirePackaging: 'false' }).requirePackaging, true)

  // ── C. mapRow：往返一致 ──
  const round = D.mapRow(Object.assign({ kind: 'material' }, m1.row))
  eq('C1 往返后名称一致', round.name, '大蓝闪蝶')
  eq('C2 往返后等级一致', round.option, 'A1')
  eq('C3 往返后单价一致', round.unitPrice, 300)
  eq('C4 往返后 kind 一致', round.kind, 'material')
  ok('C5 往返带出默认标记', round.isDefaultOption === false)
  const roundP = D.mapRow(Object.assign({ kind: 'packaging' }, p1.row))
  eq('C6 包装往返尺寸一致', roundP.option, CORE.DEFAULT_SIZE)
  eq('C7 包装往返 kind 一致', roundP.kind, 'packaging')

  // ── D. 与共享内核同口径（写入口放行 = 算价口能匹配） ──
  const rows = [
    { name: '独角仙展翅', unitPrice: 180, isDefaultGrade: true, status: 'active' },
    { name: '独角仙展翅', unitPrice: 150, isDefaultGrade: true, status: 'active' }
  ]
  const viaDefaults = D.validateBooks(rows, [])
  const viaCore = CORE.validatePriceBook({ materials: rows, packagings: [] })
  eq('D1 写入方与算价方对「两个默认行」判定一致', viaDefaults.ok, viaCore.ok)
  eq('D2 两处报出的错误条数一致', viaDefaults.errors.length, viaCore.errors.length)
  ok('D3 两个默认行确实被判为不完整', viaDefaults.ok === false)
  const clean = D.validateBooks([{ name: 'x', unitPrice: 1, isDefaultGrade: true, status: 'active' }], [])
  eq('D4 干净数据通过校验', clean.ok, true)
}

/** 每条注入都必须让至少一条断言失败 */
const INJECTIONS = [
  [
    'enabled 默认变「开」（没配置就自己开始算钱）',
    (src) => src.replace('enabled: src.enabled === true,', 'enabled: src.enabled !== false,')
  ],
  ['单价不再按分取整', (src) => src.replace('return toYuan(toCents(n))', 'return n')],
  ['别名不再去重', (src) => src.replace('    if (!nk || seen[nk]) continue', '    if (!nk) continue')],
  ['每行都成为默认行', (src) => src.replace('  row[book.defaultFlagKey] = src[book.defaultFlagKey] === true', '  row[book.defaultFlagKey] = true')],
  ['status 永远 active（停用失效）', (src) => src.replace("  return s === STATUS.INACTIVE ? STATUS.INACTIVE : STATUS.ACTIVE", '  return STATUS.ACTIVE')],
  ['费率 0 被回落成默认 30', (src) => src.replace('  if (!Number.isFinite(n)) return fallback', '  if (!n) return fallback')]
]

function loadModules(dir) {
  const defaults = require(join(dir, 'settlementDefaults.js'))
  const core = require(join(dir, 'pricingCore.js'))
  return { defaults, core }
}

function runOnce(dir) {
  passes = 0
  failures.length = 0
  let mods
  try {
    mods = loadModules(dir)
  } catch (e) {
    failures.push(`加载模块失败：${e.message}`)
    return { failed: failures.length, failures: failures.slice() }
  }
  try {
    runTests(mods.defaults, mods.core)
  } catch (e) {
    failures.push(`断言执行抛异常：${e.message}`)
  }
  return { failed: failures.length, failures: failures.slice() }
}

function runSelfTest() {
  console.log('自检：确认「写入路径被破坏」时断言确实会失败\n')
  const original = readFileSync(DEFAULTS_PATH, 'utf8')
  let allDetected = true

  for (const [label, mutate] of INJECTIONS) {
    const dir = mkdtempSync(join(tmpdir(), 'studio-settlement-selftest-'))
    const mutated = mutate(original)
    if (mutated === original) {
      console.log(`✗ ${label} → 【注入锚点失效】（源码未改变，无法判定）`)
      allDetected = false
      rmSync(dir, { recursive: true, force: true })
      continue
    }
    writeFileSync(join(dir, 'settlementDefaults.js'), mutated, 'utf8')
    copyFileSync(CORE_PATH, join(dir, 'pricingCore.js'))
    const res = runOnce(dir)
    const detected = res.failed > 0
    allDetected = allDetected && detected
    console.log(
      `${detected ? '✓' : '✗'} 注入 ${label} → ${detected ? '已检出' : '【漏检】'}${detected ? `（${res.failed} 项失败）` : ''}`
    )
    if (detected) res.failures.slice(0, 2).forEach((f) => console.log(`    · ${f}`))
    rmSync(dir, { recursive: true, force: true })
  }

  const clean = runOnce(FN_DIR)
  console.log(`\n${clean.failed === 0 ? '✓' : '✗'} 未注入时通过（${clean.failed === 0 ? '无假阳性' : '有假阳性'}）`)
  if (clean.failed > 0) clean.failures.slice(0, 5).forEach((f) => console.log(`    · ${f}`))

  if (!allDetected || clean.failed > 0) {
    console.log('\n✗ 自检失败')
    process.exit(1)
  }
  console.log(`\n✓ selftest 通过：${INJECTIONS.length} 个注入全部被检出，且无假阳性`)
}

if (process.argv.includes('--selftest')) {
  runSelfTest()
} else {
  const res = runOnce(FN_DIR)
  console.log(`结算写入路径：通过 ${passes} / ${passes + res.failed}`)
  if (res.failed > 0) {
    console.log('')
    res.failures.forEach((f) => console.log(`  ✗ ${f}`))
    console.log(`\n✗ ${res.failed} 项失败`)
    process.exit(1)
  }
  console.log('✓ 写入路径断言全部通过（buildRow 归一化 / 别名去重与上限 / 单价按分取整 / enabled 缺字段默认关 / mapRow 往返 / 与算价方同口径）')
}
