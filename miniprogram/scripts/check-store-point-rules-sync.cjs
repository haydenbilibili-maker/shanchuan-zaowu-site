#!/usr/bin/env node
/**
 * 门店积分规则默认值一致性检查
 *
 * 背景（2026-09-16）：
 *   ERP「门店积分规则」页(`admin/src/utils/storePointRules.js`)是
 *   云端 `miniprogram/cloudfunctions/getStorePointRules/defaults.js` 的手工平行副本。
 *   云端已升到 v4（每满 ¥1 赠 1 分），ERP 副本仍停在 v3（每满 ¥10 赠 1 分），
 *   于是 ERP 页显示/回写的是旧口径 —— 「ERP 里一直是修改之前的老数据」。
 *
 * 同时守住 6 个自带 defaults.js 副本的结构漂移（earnPoints 那份 share 已知不一致）。
 *
 * 用法：
 *   node miniprogram/scripts/check-store-point-rules-sync.cjs
 *   node miniprogram/scripts/check-store-point-rules-sync.cjs --selftest
 */
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')

const ROOT = path.resolve(__dirname, '..', '..')
const CLOUD_CANON = path.join(ROOT, 'miniprogram', 'cloudfunctions', 'getStorePointRules', 'defaults.js')
const ERP_DEFAULTS = path.join(ROOT, 'admin', 'src', 'utils', 'storePointRules.js')

/** 读取线上规则的自带 defaults.js 副本 */
const CLOUD_COPIES = [
  'getStorePointRules',
  'grantStorePoints',
  'getPointRecords',
  'earnPoints',
  'bindPlatformOrder',
  'claimStoreReceipt'
].map((fn) => path.join(ROOT, 'miniprogram', 'cloudfunctions', fn, 'defaults.js'))

/**
 * 已知且需人工决策的副本差异。
 * earnPoints 把 share 关掉（合规考虑），但另外 5 份是 true，且线上库当前是 false。
 * 只报不判失败，避免在未决策前悄悄改变兜底行为。
 */
const KNOWN_DIVERGENCE = [
  { file: 'earnPoints/defaults.js', key: 'modules.share', note: '合规动机关闭分享奖励，未同步到其他 5 份' }
]

/** 必须逐字一致的结构性字段 */
const STRUCT_FIELDS = [
  'ruleId', 'name', 'status', 'priority', 'mode', 'threshold', 'pointsPerThreshold',
  'ratio', 'minAmount', 'maxAmountPerRecord', 'roundMode', 'applyMemberMultiplier',
  'dailyPointsCapPerUser', 'dailyPointsCapPerStore', 'dailyRecordCapPerUser',
  'revokeWindowDays', 'notifyUser', 'remark'
]

const failures = []
const warnings = []
let passCount = 0

function check(name, condition, detail) {
  if (condition) passCount += 1
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
}

function warn(text) {
  warnings.push(text)
}

function get(obj, dotted) {
  return dotted.split('.').reduce((acc, k) => (acc == null ? acc : acc[k]), obj)
}

/**
 * 取一份可比对的扁平快照。
 * 嵌套对象必须扁平到「逐键」粒度，否则 modules 里某个开关被关掉这种差异
 * 会被整个对象比较吞掉（曾漏检 earnPoints 的 share:false）。
 */
function snapshot(cfg) {
  const out = {}
  STRUCT_FIELDS.forEach((k) => { out[k] = cfg[k] })
  Object.keys(cfg.modules || {}).sort().forEach((k) => { out[`modules.${k}`] = cfg.modules[k] })
  Object.keys(cfg.moduleRewards || {}).sort().forEach((k) => {
    const row = cfg.moduleRewards[k] || {}
    out[`moduleRewards.${k}.points`] = row.points
    out[`moduleRewards.${k}.dailyLimit`] = row.dailyLimit
  })
  const platforms = (cfg.platformOrderBind && cfg.platformOrderBind.platforms) || []
  platforms.forEach((p) => { out[`platforms.${p.id}`] = p.name })
  out['platformOrderBind.requireAmount'] = cfg.platformOrderBind && cfg.platformOrderBind.requireAmount
  out['platformOrderBind.requireManagerConfirm'] = cfg.platformOrderBind && cfg.platformOrderBind.requireManagerConfirm
  return out
}

function describeDiff(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  const diffs = []
  keys.forEach((k) => {
    const av = JSON.stringify(a[k])
    const bv = JSON.stringify(b[k])
    if (av !== bv) diffs.push(`${k}: ${av} vs ${bv}`)
  })
  return diffs
}

async function runChecks(canonFile, erpFile, copies) {
  delete require.cache[require.resolve(canonFile)]
  const canon = require(canonFile)
  const canonCfg = canon.getDefaultConfig()

  // 1) ERP 平行副本必须与云端 defaults 逐字一致
  const erp = await import('file://' + erpFile)
  const erpCfg = erp.getDefaultStorePointConfig()
  const erpDiff = describeDiff(snapshot(canonCfg), snapshot(erpCfg))
  check('ERP storePointRules.js 与云端 defaults.js 一致', erpDiff.length === 0, erpDiff.join(' | '))
  check('ERP DEFAULT_MODULES 含 receiptClaim', erp.DEFAULT_MODULES.receiptClaim === true,
    `keys=${Object.keys(erp.DEFAULT_MODULES).join(',')}`)
  check('ERP 默认版次为 v4', erpCfg.ruleId === 'store_points_default_v4', String(erpCfg.ruleId))
  check('ERP 默认门槛为 1 元', Number(erpCfg.threshold) === 1, String(erpCfg.threshold))

  // 2) 每个模块键都要有中文标签（否则 UI 会漏显示开关）
  const missingLabels = Object.keys(erp.DEFAULT_MODULES).filter((k) => !erp.MODULE_LABELS[k])
  check('ERP 每个模块开关都有标签', missingLabels.length === 0, missingLabels.join(','))

  // 3) 6 份云端副本结构一致
  const canonSnap = snapshot(canonCfg)
  copies.forEach((file) => {
    const rel = path.relative(path.join(ROOT, 'miniprogram', 'cloudfunctions'), file)
    if (path.resolve(file) === path.resolve(canonFile)) return
    delete require.cache[require.resolve(file)]
    let cfg
    try {
      cfg = require(file).getDefaultConfig()
    } catch (e) {
      check(`副本可加载 ${rel}`, false, e.message)
      return
    }
    const d = describeDiff(canonSnap, snapshot(cfg))
    if (!d.length) { passCount += 1; return }

    const known = KNOWN_DIVERGENCE.filter((k) => rel.endsWith(k.file))
    const structural = d.filter((row) => !known.some((k) => row.startsWith(`${k.key}:`)))
    check(`云端副本与基准一致 ${rel}`, structural.length === 0, structural.join(' | '))
    d.filter((row) => known.some((k) => row.startsWith(`${k.key}:`)))
      .forEach((row) => warn(`【需人工决策】${rel} 的 ${row} —— ${known[0].note}`))
  })
}

function mutate(sourceFile, mutator) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spr-selftest-'))
  const target = path.join(tmp, path.basename(sourceFile))
  fs.writeFileSync(target, mutator(fs.readFileSync(sourceFile, 'utf8')), 'utf8')
  return target
}

async function runSelfTest() {
  console.log('自检：确认检查在「副本被改回旧口径」时确实会失败\n')
  const cases = [
    ['ERP 门槛被改回 v3（threshold 10）', (s) => s.replace(/threshold: 1,/, 'threshold: 10,')],
    ['ERP 版次被改回 v3', (s) => s.replace("store_points_default_v4", "store_points_default_v3")],
    ['ERP 丢掉 receiptClaim 开关', (s) => s.replace(/,\n  receiptClaim: true/, '')]
  ]
  let allDetected = true
  for (const [label, mutator] of cases) {
    const dir = mutate(ERP_DEFAULTS, mutator)
    failures.length = 0
    warnings.length = 0
    try {
      await runChecks(CLOUD_CANON, dir, [])
    } catch (e) {
      failures.push(`执行异常：${e.message}`)
    }
    const detected = failures.length > 0
    allDetected = allDetected && detected
    console.log(`${detected ? '✓' : '✗'} ${label} → ${detected ? '已检出' : '【漏检】'}`)
    if (detected) failures.slice(0, 1).forEach((f) => console.log(`    · ${f}`))
    fs.rmSync(dir, { recursive: true, force: true })
  }
  console.log()
  if (!allDetected) {
    console.error('自检失败：存在漏检用例，检查本身不可信。')
    process.exit(1)
  }
  console.log('自检通过：三个破坏用例均被检出。\n')
}

;(async () => {
  if (process.argv.includes('--selftest')) await runSelfTest()

  failures.length = 0
  warnings.length = 0
  passCount = 0
  try {
    await runChecks(CLOUD_CANON, ERP_DEFAULTS, CLOUD_COPIES)
  } catch (e) {
    failures.push(`检查执行异常：${e.message}`)
  }

  console.log(`门店积分规则默认值检查：${passCount} 项通过，${failures.length} 项失败`)
  if (warnings.length) {
    console.log('\n待人工决策：')
    warnings.forEach((w) => console.log(`  ⚠ ${w}`))
  }
  if (failures.length) {
    console.error('\n失败明细：')
    failures.forEach((f) => console.error(`  ✗ ${f}`))
    process.exit(1)
  }
  console.log('全部通过：ERP 平行副本与云端 defaults 结构一致，6 份副本无结构性漂移。')
})()
