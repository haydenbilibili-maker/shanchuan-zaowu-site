#!/usr/bin/env node
/**
 * 单一账本守卫 —— **结算状态只能由账单流程写**
 *
 * 为什么需要（蓝图 §4.5，本升级最关键的架构决定）：
 *   产品负责人裁决 10 给出货单加了「结算状态」，裁决 11 又要独立账单集合。
 *   若两处都能写结算状态，就是**两个账本** —— 以后必然出现
 *   「出货单说没结、账单说结了」且无法判定谁对。
 *
 *   所以定死：**账单是唯一权威，出货单的 `settleStatus` 是派生字段**。
 *   这条不能只写在文档里靠人记得，必须机器可判定：
 *
 *   判据 A · **唯一写入方**：全仓对 `settleStatus:` 的**赋值**只允许出现在
 *            `manageStudioSettlement/billCore.js`。
 *   判据 B · **出货侧只继承**：`manageStoreShipment` 的 `normalizePayload` 必须
 *            从 `prev`（库里已有值）取结算字段，**不得从 `src`（入参）取** ——
 *            否则调用方可以自己把单标成「已结清」，账就烂了。
 *   判据 C · **终结副作用三件套齐全**：`confirmSettlePatch` 必须同时给出
 *            `settleStatus: settled`、`status: TERMINAL_SHIPMENT_STATUS`（裁决 13
 *            「确认收款=订单终结」）与要终结的单据 id 列表。
 *
 * 证不了什么（写清楚，免得被当成万能）：
 *   · 不证明云端数据真的没被手工改过（那靠数据库权限：三张集合都是 `read:false/write:false`）。
 *   · 不证明 `prev` 一定来自库（若有人把整份入参当 existing 传进来，本守卫看不出）——
 *     这条由调用点约定 + 代码评审兜底，本守卫不假装能证明。
 *
 * 用法：
 *   node miniprogram/scripts/check-settlement-single-ledger.mjs
 *   node miniprogram/scripts/check-settlement-single-ledger.mjs --selftest
 * 退出码：违例 1。
 */
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const FN_ROOT = join(ROOT, 'miniprogram', 'cloudfunctions')

/**
 * 允许写 `settleStatus:` 的**文件**（= 「账单流程」这一方，含它的 db 层）。
 * 白名单只许变小；加进来必须说明为什么它属于账单流程。
 *   · billCore.js  —— 纯函数：算出该写什么
 *   · index.js     —— db 层：把 patch 写下去（patchShipments）
 */
const ALLOWED_WRITERS = ['manageStudioSettlement/billCore.js', 'manageStudioSettlement/index.js']

/**
 * 从匹配位置往前找**最近的具名函数**，用于区分「写库」与「读取派生」。
 * 本仓库云函数以 `function name()` / `async function name()` 声明为主。
 */
function enclosingFunction(src, index) {
  const before = src.slice(0, index)
  const re = /\n\s*(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/g
  let last = ''
  let m
  while ((m = re.exec(before))) last = m[1]
  return last
}

/**
 * 「读取派生」= 在 `mapXxx` 这类映射函数里把库里的值搬给调用方看，
 * **不是写库**。出货运维里 `mapRow` 就属于这种：
 * `settleStatus: normalizeSettleStatus(doc.settleStatus)` 只是把派生结果回传。
 * 这类不算违例 —— 但**只认 map 前缀**，别的函数名一律按写库处理（宁可误报）。
 */
function isDeriveMapper(name) {
  return /^map[A-Z_]/.test(String(name || ''))
}

/** 出货侧：这些键必须从 prev 继承，且**禁止出现在 src. 前缀下** */
const INHERIT_KEYS = [
  'settleStatus',
  'billId',
  'billNo',
  'paidMarkedAt',
  'paidMarkedBy',
  'settledAt',
  'settledBy'
]

/** 列出目录下所有 .js（跳过 node_modules） */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (name.endsWith('.js')) out.push(full)
  }
  return out
}

/** 去注释：避免把注释里的示例当成真的写入点（本仓库历史上被锚点从注释回抄坑过） */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

function readMaybe(path) {
  try {
    return stripComments(readFileSync(path, 'utf8'))
  } catch (e) {
    return null
  }
}

/**
 * 在指定云函数根上跑全部判据，返回问题列表（空数组 = 通过）。
 * 参数化根目录是为了自检能指向临时副本。
 */
function collectProblems(fnRoot) {
  const problems = []
  const files = walk(fnRoot)
  const relOf = (f) => f.slice(fnRoot.length + 1).split('\\').join('/')

  // ── 判据 A：唯一写入方（**排除读取派生**）──
  const writeSites = []
  for (const f of files) {
    const relPath = relOf(f)
    const src = stripComments(readFileSync(f, 'utf8'))
    const re = /\bsettleStatus\s*:/g
    let m
    while ((m = re.exec(src))) {
      const line = src.slice(0, m.index).split('\n').length
      const fn = enclosingFunction(src, m.index)
      writeSites.push({ file: relPath, line, fn, derive: isDeriveMapper(fn) })
    }
  }
  for (const site of writeSites) {
    if (site.derive) continue // 读取派生（mapXxx）不算写库
    if (ALLOWED_WRITERS.indexOf(site.file) === -1) {
      problems.push(
        `判据 A 违例：${site.file}:${site.line}（函数 ${site.fn || '?'}）在写 settleStatus —— ` +
          `结算状态**只能由账单流程**写（白名单：${ALLOWED_WRITERS.join(', ')}）`
      )
    }
  }
  if (!writeSites.some((s) => s.file === 'manageStudioSettlement/billCore.js')) {
    problems.push('判据 A 无法判定：billCore.js 里找不到任何 settleStatus 赋值 —— 白名单可能已失效（E16：无法判定必须报错）')
  }
  if (!writeSites.some((s) => s.derive)) {
    problems.push(
      '判据 A 无法判定：全仓找不到任何「读取派生」的 settleStatus（mapXxx 里应该有）—— ' +
        '派生豁免可能已经不再需要，或 mapRow 被改名（E16）'
    )
  }

  // ── 判据 B：出货侧只继承、绝不出现在 src. 前缀下 ──
  const defaultsSrc = readMaybe(join(fnRoot, 'manageStoreShipment', 'shipmentDefaults.js'))
  if (defaultsSrc === null) {
    problems.push('判据 B 无法判定：读不到 manageStoreShipment/shipmentDefaults.js')
  } else {
    for (const key of INHERIT_KEYS) {
      // 只要出现 src.<key>（不论取值形式）就是违例 —— 出货云函数不该从入参读结算字段
      if (new RegExp(`\\bsrc\\.${key}\\b`).test(defaultsSrc)) {
        problems.push(
          `判据 B 违例：shipmentDefaults.js 出现 src.${key} —— 调用方将能自己把单据标成已结清（结算字段只能从 prev 继承）`
        )
      }
      if (!new RegExp(`\\bprev\\.${key}\\b`).test(defaultsSrc)) {
        problems.push(
          `判据 B 无法判定：shipmentDefaults.js 里找不到 prev.${key} —— 继承被删或被改名（E16：无法判定必须报错）`
        )
      }
    }
  }

  // ── 判据 C：终结副作用三件套 ──
  const billSrc = readMaybe(join(fnRoot, 'manageStudioSettlement', 'billCore.js'))
  if (billSrc === null) {
    problems.push('判据 C 无法判定：读不到 manageStudioSettlement/billCore.js')
  } else {
    const idx = billSrc.indexOf('function confirmSettlePatch')
    if (idx === -1) {
      problems.push('判据 C 无法判定：billCore.js 里找不到 confirmSettlePatch')
    } else {
      const rest = billSrc.slice(idx)
      const nextFn = rest.indexOf('\nfunction ', 10)
      const body = nextFn === -1 ? rest : rest.slice(0, nextFn)
      if (!/settleStatus:\s*SETTLE_STATUS\.SETTLED/.test(body)) {
        problems.push('判据 C 违例：confirmSettlePatch 没有把单据写成 settleStatus=settled')
      }
      if (!/status:\s*TERMINAL_SHIPMENT_STATUS/.test(body)) {
        problems.push('判据 C 违例：confirmSettlePatch 没有写物流终态（裁决 13「确认收款=订单终结」）')
      }
      // ⚠️ 必须查**返回语句里带 shipmentIds**，不能只查函数体里出现过这个词 ——
      //    `const ids = Array.isArray(b.shipmentIds)` 也会命中，那样漏掉返回值就检不出来
      //    （本守卫第一次自检就漏检了这条注入）。
      if (!/shipmentIds:\s*ids/.test(body)) {
        problems.push('判据 C 违例：confirmSettlePatch 没有返回要终结的单据 id 列表（调用方拿不到就改不了那些单）')
      }
    }
  }

  return problems
}

const INJECTIONS = [
  [
    '出货侧开始写 settleStatus（出现第二个账本）',
    'manageStoreShipment/shipmentDefaults.js',
    (src) => src.replace('    settleStatus,\n', '    settleStatus: normalizeSettleStatus(src.settleStatus),\n')
  ],
  [
    '结算字段改为从入参取（调用方可自己标已结清）',
    'manageStoreShipment/shipmentDefaults.js',
    (src) => src.replace('const settleStatus = normalizeSettleStatus(prev.settleStatus)', 'const settleStatus = normalizeSettleStatus(src.settleStatus)')
  ],
  [
    '终结时不再写物流终态（订单不终结）',
    'manageStudioSettlement/billCore.js',
    (src) => src.replace('    status: TERMINAL_SHIPMENT_STATUS,\n', '')
  ],
  [
    '终结时不再写单据结算状态',
    'manageStudioSettlement/billCore.js',
    (src) => src.replace('    settleStatus: SETTLE_STATUS.SETTLED,\n', '')
  ],
  [
    '终结不再返回要终结的单据列表',
    'manageStudioSettlement/billCore.js',
    (src) => src.replace('  return { ok: true, billPatch, shipmentPatch, shipmentIds: ids, msg:', '  return { ok: true, billPatch, shipmentPatch, msg:')
  ]
]

function makeTempTree() {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-selftest-'))
  mkdirSync(join(dir, 'manageStoreShipment'), { recursive: true })
  mkdirSync(join(dir, 'manageStudioSettlement'), { recursive: true })
  copyFileSync(
    join(FN_ROOT, 'manageStoreShipment', 'shipmentDefaults.js'),
    join(dir, 'manageStoreShipment', 'shipmentDefaults.js')
  )
  copyFileSync(
    join(FN_ROOT, 'manageStudioSettlement', 'billCore.js'),
    join(dir, 'manageStudioSettlement', 'billCore.js')
  )
  return dir
}

function runSelfTest() {
  console.log('自检：确认「单一账本被破坏」时守卫确实会失败\n')
  let allDetected = true
  for (const [label, target, mutate] of INJECTIONS) {
    const dir = makeTempTree()
    const full = join(dir, target)
    const before = readFileSync(full, 'utf8')
    const after = mutate(before)
    if (after === before) {
      console.log(`✗ ${label} → 【注入锚点失效】（源码未改变，无法判定）`)
      allDetected = false
      rmSync(dir, { recursive: true, force: true })
      continue
    }
    writeFileSync(full, after, 'utf8')
    const found = collectProblems(dir)
    const detected = found.length > 0
    allDetected = allDetected && detected
    console.log(`${detected ? '✓' : '✗'} 注入 ${label} → ${detected ? '已检出' : '【漏检】'}`)
    if (detected) found.slice(0, 2).forEach((f) => console.log(`    · ${f}`))
    rmSync(dir, { recursive: true, force: true })
  }

  const clean = collectProblems(FN_ROOT)
  console.log(`\n${clean.length === 0 ? '✓' : '✗'} 未注入时通过（${clean.length === 0 ? '无假阳性' : '有假阳性'}）`)
  if (clean.length) clean.slice(0, 5).forEach((f) => console.log(`    · ${f}`))

  if (!allDetected || clean.length) {
    console.log('\n✗ 自检失败')
    process.exit(1)
  }
  console.log(`\n✓ selftest 通过：${INJECTIONS.length} 个注入全部被检出，且无假阳性`)
}

if (process.argv.includes('--selftest')) {
  runSelfTest()
} else {
  const found = collectProblems(FN_ROOT)
  if (found.length) {
    console.log(`✗ 单一账本违例 ${found.length} 处：\n`)
    found.forEach((p) => console.log(`  ✗ ${p}`))
    process.exit(1)
  }
  console.log(
    '✓ 单一账本成立：settleStatus 只由账单流程写（billCore.js）、出货侧只从 prev 继承、终结副作用三件套齐全'
  )
}
