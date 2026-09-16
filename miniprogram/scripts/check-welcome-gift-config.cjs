#!/usr/bin/env node
/**
 * 新会员礼包配置一致性 + 券条款对齐回归检查
 *
 * 背景（线上事故 2026-09-16）：
 *   超管工作台配置为「满49减10 / 满299减30 / 满499减50 / 满999减100」，
 *   但确认订单页礼券选择器仍显示「满50可用」。原因是三重漂移：
 *     1. 代码兜底档位（welcomeGiftDefaults.getDefaultConfig）与线上配置不一致；
 *     2. 客户端断网兜底 profileConstants.REGISTER_GIFT 又是另一套档位；
 *     3. 券在发放时把条款拍成快照，且旧 grantWelcomeCoupons 在「券已齐」时
 *        直接 return，改配置后老会员永远停留在旧门槛。
 *
 * 本脚本同时守住这三处，并回归 buildCouponAlignPlan 的安全边界。
 *
 * 用法：
 *   node miniprogram/scripts/check-welcome-gift-config.cjs
 *   node miniprogram/scripts/check-welcome-gift-config.cjs --selftest   # 证明检查会失败
 */
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')

const ROOT = path.resolve(__dirname, '..', '..')
const FN_DIR = path.join(ROOT, 'miniprogram', 'cloudfunctions')
const UPSERT_DIR = path.join(FN_DIR, 'upsertUserProfile')
const MANAGE_DIR = path.join(FN_DIR, 'manageWelcomeGift')
const CLIENT_CONSTANTS = path.join(ROOT, 'miniprogram', 'utils', 'profileConstants.js')

/** 线上权威档位（小程序-我的-超管工作台-新会员礼包）——变更须同步改此断言 */
const SSOT_LADDER = [
  { value: 10, minSpend: 49 },
  { value: 30, minSpend: 299 },
  { value: 50, minSpend: 499 },
  { value: 100, minSpend: 999 }
]
const MAX_OFF_RATIO = 0.25

const failures = []
const passes = []

function check(name, condition, detail) {
  if (condition) {
    passes.push(name)
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function ladderOf(coupons) {
  return (coupons || []).map((c) => ({ value: Number(c.value), minSpend: Number(c.minSpend) }))
}

function sameLadder(a, b) {
  if (a.length !== b.length) return false
  return a.every((row, i) => row.value === b[i].value && row.minSpend === b[i].minSpend)
}

function describeLadder(ladder) {
  return ladder.map((r) => `满${r.minSpend}减${r.value}`).join(' / ') || '(空)'
}

/** 载入被测模块；dir 可指向临时副本以做自检 */
function loadDefaults(dir) {
  delete require.cache[require.resolve(path.join(dir, 'welcomeGiftDefaults.js'))]
  delete require.cache[require.resolve(path.join(dir, 'couponDiscountRules.js'))]
  return require(path.join(dir, 'welcomeGiftDefaults.js'))
}

/**
 * 小程序端 utils/*.js 是 CommonJS，但仓库根 package.json 为 "type": "module"，
 * 直接 require 会被当成 ESM 而报错；此处显式按 CJS 求值。
 */
function loadMiniProgramCjs(file) {
  const src = fs.readFileSync(file, 'utf8')
  const mod = { exports: {} }
  const localRequire = (spec) => require(require.resolve(spec, { paths: [path.dirname(file)] }))
  const fn = new Function('module', 'exports', 'require', '__filename', '__dirname', src)
  fn(mod, mod.exports, localRequire, file, path.dirname(file))
  return mod.exports
}

/** 生产事故 fixture：这些券必须被纠正，且只纠正未使用的 */
function planFixtures() {
  return [
    // [说明, 券, 期望 patch.minSpend | null, 期望是否进入 items]
    ['未使用 10元券门槛50 → 49（本次线上事故）',
      { _id: 'a1', source: 'register_gift', status: 'unused', value: 10, minSpend: 50, slotKey: 'c10:0', title: '新会员礼券 · 10元' }, 49, true],
    ['未使用 10元券门槛0（穿底券）→ 49',
      { _id: 'a2', source: 'register_gift', status: 'unused', value: 10, minSpend: 0, slotKey: 'c10:0', title: '新会员礼券 · 10元' }, 49, true],
    ['未使用 30元券门槛300 → 299',
      { _id: 'a3', source: 'register_gift', status: 'unused', value: 30, minSpend: 300, slotKey: 'c30:0', title: '新会员礼券 · 30元' }, 299, true],
    ['未使用 50元券门槛500 → 499',
      { _id: 'a4', source: 'register_gift', status: 'unused', value: 50, minSpend: 500, slotKey: 'c50:0', title: '新会员礼券 · 50元' }, 499, true],
    ['未使用 100元券门槛1000 → 999',
      { _id: 'a5', source: 'register_gift', status: 'unused', value: 100, minSpend: 1000, slotKey: 'c100:0', title: '新会员礼券 · 100元' }, 999, true],
    ['已使用券门槛50 → 不动（历史凭证）',
      { _id: 'b1', source: 'register_gift', status: 'used', value: 10, minSpend: 50, slotKey: 'c10:0', title: '新会员礼券 · 10元' }, null, false],
    ['已过期券门槛50 → 不动',
      { _id: 'b2', source: 'register_gift', status: 'expired', value: 10, minSpend: 50, slotKey: 'c10:0', title: '新会员礼券 · 10元' }, null, false],
    ['已锁定券门槛50 → 不动',
      { _id: 'b3', source: 'register_gift', status: 'locked', value: 10, minSpend: 50, slotKey: 'c10:0', title: '新会员礼券 · 10元' }, null, false],
    ['档位已从配置删除 → 不猜，不动',
      { _id: 'c1', source: 'register_gift', status: 'unused', value: 20, minSpend: 50, slotKey: 'c20:0', title: '旧档位券' }, null, false],
    ['档位 id 被复用于不同面额 → 视为另一张券，不动',
      { _id: 'c2', source: 'register_gift', status: 'unused', value: 66, minSpend: 50, slotKey: 'c10:0', title: '异常券' }, null, false],
    ['非礼包来源券 → 不动',
      { _id: 'd1', source: 'birthday_gift', status: 'unused', value: 10, minSpend: 50, slotKey: 'c10:0', title: '生日礼券' }, null, false],
    ['已对齐的券 → 幂等无写入',
      { _id: 'e1', source: 'register_gift', status: 'unused', value: 10, minSpend: 49, slotKey: 'c10:0', title: '新会员礼券 · 10元' }, null, false]
  ]
}

function runChecks(defaults) {
  const cfg = defaults.getDefaultConfig()
  const upsertCfg = loadDefaults(UPSERT_DIR).getDefaultConfig()

  // 1. 两份云函数副本必须逐字一致
  check('两份 welcomeGiftDefaults 兜底配置完全一致',
    JSON.stringify(cfg) === JSON.stringify(upsertCfg),
    `manage=${describeLadder(ladderOf(cfg.coupons))} upsert=${describeLadder(ladderOf(upsertCfg.coupons))}`)

  // 2. 兜底档位 == 线上权威档位
  check('云函数兜底档位 == 线上权威档位',
    sameLadder(ladderOf(cfg.coupons), SSOT_LADDER),
    `实际 ${describeLadder(ladderOf(cfg.coupons))}，期望 ${describeLadder(SSOT_LADDER)}`)

  // 3. 客户端断网兜底 == 线上权威档位
  const client = loadMiniProgramCjs(CLIENT_CONSTANTS)
  check('客户端 profileConstants.REGISTER_GIFT == 线上权威档位',
    sameLadder(ladderOf(client.REGISTER_GIFT && client.REGISTER_GIFT.coupons), SSOT_LADDER),
    `实际 ${describeLadder(ladderOf(client.REGISTER_GIFT && client.REGISTER_GIFT.coupons))}`)

  // 4. 券数与文案一致性
  check('客户端礼券张数 == 权威档位数',
    ((client.REGISTER_GIFT && client.REGISTER_GIFT.coupons) || []).length === SSOT_LADDER.length,
    `客户端 ${((client.REGISTER_GIFT && client.REGISTER_GIFT.coupons) || []).length} 张 / 权威 ${SSOT_LADDER.length} 档`)

  // 5. 折扣纪律：任何档位都不得穿底
  const violations = ladderOf(cfg.coupons).filter((r) => r.minSpend > 0 && r.value / r.minSpend > MAX_OFF_RATIO + 1e-9)
  check('所有档位满足 7.5 折地板（value/minSpend ≤ 0.25）',
    violations.length === 0,
    violations.map((r) => `满${r.minSpend}减${r.value}`).join(' / '))

  // 6. 展开槽位：一张券一个 slotKey
  const slots = defaults.expandSlots(cfg)
  check('expandSlots 展开数 == 档位张数合计',
    slots.length === ladderOf(cfg.coupons).length,
    `slots=${slots.length}`)
  check('expandSlots 的 slotKey 与线上格式一致（c10:0）',
    slots.every((s) => /^c\d+:\d+$/.test(String(s.slotKey))),
    slots.map((s) => s.slotKey).join(','))

  // 7. 对齐计划安全边界
  const plan = defaults.buildCouponAlignPlan(cfg, planFixtures().map((f) => f[1]))
  const byId = new Map(plan.items.map((it) => [it._id, it.patch]))
  planFixtures().forEach(([label, coupon, expectMinSpend, expectTouched]) => {
    const patch = byId.get(coupon._id)
    if (expectTouched) {
      check(`对齐：${label}`, !!patch && Number(patch.minSpend) === Number(expectMinSpend),
        `patch=${JSON.stringify(patch)}`)
    } else {
      check(`不越界：${label}`, !patch, `却被改写为 ${JSON.stringify(patch)}`)
    }
    if (expectTouched) {
      check(`不改面额：${label}`, !patch || patch.value === undefined, 'patch 中出现 value')
    }
  })

  // 8. 幂等：对已对齐集合再跑一次应为空（必须应用完整 patch，含 channel）
  const alignedSet = planFixtures().map((f) => f[1]).map((c) => {
    const patch = byId.get(c._id)
    return patch ? { ...c, ...patch } : c
  })
  const second = defaults.buildCouponAlignPlan(cfg, alignedSet)
  check('对齐计划幂等（二次执行无写入）', second.items.length === 0,
    `二次仍有 ${second.items.length} 项：${JSON.stringify(second.items.slice(0, 3))}`)
}

function collect(dir) {
  runChecks(loadDefaults(dir))
}

function mutate(sourceDir, mutator) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wgc-selftest-'))
  for (const file of ['welcomeGiftDefaults.js', 'couponDiscountRules.js']) {
    fs.copyFileSync(path.join(sourceDir, file), path.join(tmp, file))
  }
  const target = path.join(tmp, 'welcomeGiftDefaults.js')
  fs.writeFileSync(target, mutator(fs.readFileSync(target, 'utf8')), 'utf8')
  return tmp
}

function runSelfTest() {
  console.log('自检：确认检查在「实现被破坏」时确实会失败\n')
  const cases = [
    ['兜底档位被改回旧值（满100减10）', (src) => src
      .replace("{ id: 'c10', enabled: true, value: 10, minSpend: 49", "{ id: 'c10', enabled: true, value: 10, minSpend: 100")],
    ['对齐计划被停用（永远返回空计划）', (src) => src
      .replace('function buildCouponAlignPlan(config, coupons) {', 'function buildCouponAlignPlan(config, coupons) {\n  if (true) return { items: [], skipped: 0, unchanged: 0 }')],
    ['安全边界失效（已使用券也被改写）', (src) => src
      .replace("if (status !== 'unused' && status !== 'available') { skipped += 1; return }", '')]
  ]

  let allDetected = true
  for (const [label, mutator] of cases) {
    const dir = mutate(MANAGE_DIR, mutator)
    failures.length = 0
    passes.length = 0
    try {
      collect(dir)
    } catch (e) {
      failures.push(`加载失败：${e.message}`)
    }
    const detected = failures.length > 0
    allDetected = allDetected && detected
    console.log(`${detected ? '✓' : '✗'} ${label} → ${detected ? '已检出' : '【漏检】'}${detected ? `（${failures.length} 项）` : ''}`)
    if (detected) failures.slice(0, 2).forEach((f) => console.log(`    · ${f}`))
    fs.rmSync(dir, { recursive: true, force: true })
  }
  console.log()
  if (!allDetected) {
    console.error('自检失败：存在漏检用例，检查本身不可信。')
    process.exit(1)
  }
  console.log('自检通过：三个破坏用例均被检出。\n')
}

const selftest = process.argv.includes('--selftest')
if (selftest) runSelfTest()

failures.length = 0
passes.length = 0
try {
  collect(MANAGE_DIR)
} catch (e) {
  failures.push(`检查执行异常：${e.message}`)
}

console.log(`新会员礼包配置检查：${passes.length} 项通过，${failures.length} 项失败`)
if (failures.length) {
  console.error('\n失败明细：')
  failures.forEach((f) => console.error(`  ✗ ${f}`))
  process.exit(1)
}
console.log('全部通过：兜底档位、客户端兜底、折扣地板、对齐安全边界均一致。')
