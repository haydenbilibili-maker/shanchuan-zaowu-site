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
const UPSERT_INDEX = path.join(UPSERT_DIR, 'index.js')
const ERP_WELCOME_GIFT = path.join(ROOT, 'admin', 'src', 'utils', 'welcomeGift.js')
const ERP_COMPONENT = path.join(ROOT, 'admin', 'src', 'components', 'WelcomeGiftConfig.vue')
const RULE_FILE = path.join(ROOT, 'cloudbase', 'rules', 'member_welcome_gift.json')
const PROXY_SERVER = path.join(ROOT, 'functions', '_lib', 'cloudbaseCallFn.mjs')
const PROXY_ADMIN = path.join(ROOT, 'admin', 'src', 'utils', 'cloudbaseCdnDb.js')

/**
 * 产品口径（2026-09-16 老板确认）：**超管工作台-新会员礼包配置是唯一权威入口**，
 * ERP 只是同一逻辑的另一个入口（能力保留），不得再直写集合。
 * 这三条断言把「约定」钉成「约束」，任何一条被改回去都会立刻失败。
 */
function erpGoesThroughCloudFn(compSrc) {
  return !/cdn(Update|UpsertSingleton)\s*\(\s*COLLECTIONS\.MEMBER_WELCOME_GIFT/.test(compSrc)
    && /callCloudFunction\(\s*FN\b/.test(compSrc)
}

/** 规则形状：**写必须关闭**（写只能走云函数）；读不得完全公开（`false` 或 `auth != null`） */
function giftRuleShape(text) {
  try {
    const r = JSON.parse(text)
    if (!r) return { writeClosed: false, readScoped: false }
    return { writeClosed: r.write === false, readScoped: r.read === false || r.read === 'auth != null' }
  } catch (e) {
    return { writeClosed: false, readScoped: false }
  }
}

function proxyAllowsManageWelcomeGift(src) {
  return /'manageWelcomeGift'/.test(src)
}

/**
 * 「所有前端展示都以超管工作台配置为准」的三条接线断言（2026-09-16 专项核查）。
 *
 * 展示面共 6 处，唯一合规的来源只有两种：① 云函数 preview/已发券；② 与配置同源的代码兜底。
 * 这条守卫钉住最容易回流的三种写法：注册页改回读死档位、完成页改回显示兜底张数、C 端出现第二份档位表。
 */
const ONBOARDING_PAGE = path.join(ROOT, 'miniprogram', 'subpackages', 'extra', 'user', 'onboarding', 'index.js')
const ONBOARDING_DONE = path.join(ROOT, 'miniprogram', 'subpackages', 'extra', 'user', 'onboarding', 'done.js')

/** 注册页「新客礼」预告必须来自云函数 preview（配置派生），而不是本地档位 */
function previewIsSourceOfTruth(src) {
  return /name:\s*'manageWelcomeGift'/.test(src) && /action:\s*'preview'/.test(src)
}

/** 注册完成页必须展示「实发结果」（路由参数 options.coupons / 补领返回 gift.couponCount） */
function doneShowsActualGrant(src) {
  return /options\.coupons/.test(src) && /gift\.couponCount/.test(src)
}

/** C 端只允许一份档位兜底（profileConstants.REGISTER_GIFT） */
function ladderDefinitionFiles(dirs) {
  const out = []
  const walk = (d) => {
    let entries
    try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch (e) { return }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) { walk(p); continue }
      if (!p.endsWith('.js')) continue
      if (/^\s*(?:const|let|var)\s+REGISTER_GIFT\s*=/m.test(fs.readFileSync(p, 'utf8'))) {
        out.push(path.relative(ROOT, p))
      }
    }
  }
  dirs.forEach(walk)
  return out.sort()
}

/**
 * 源级签名断言（用于「逻辑分散在多个文件、无法直接 require」的两处保护）：
 *  - ERP 是**直写** member_welcome_gift 的，它的拦截只能在 admin 侧；
 *  - 注册发券的「异常留痕」写在 upsertUserProfile/index.js 里。
 * 这两处一旦被删，静态档位检查仍然全绿，事故会照样复发，故必须单独钉住。
 */
function erpGuardSignature(src) {
  return /export function validateWelcomeGiftActivatable/.test(src)
    && /return validateWelcomeGiftActivatable\(src, coupons\)/.test(src)
}

function upsertAnomalySignature(src) {
  return /const couponsConfiguredButEmpty = !!\s*\(\s*config\.couponsEnabled && !couponSlots\.length\s*\)/.test(src)
    && (src.match(/\|\|\s*couponsConfiguredButEmpty/g) || []).length >= 2
}

/** 线上权威档位（小程序-我的-超管工作台-新会员礼包）——变更须同步改此断言 */
const SSOT_LADDER = [
  { value: 5, minSpend: 49 },
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

/** 生产事故 fixture：这些券必须被纠正，且只纠正未使用的（面额口径随线上权威档位，现为满49减5） */
function planFixtures() {
  return [
    // [说明, 券, 期望 patch.minSpend | null, 期望是否进入 items]
    ['未使用 5元券门槛50 → 49（本次线上事故）',
      { _id: 'a1', source: 'register_gift', status: 'unused', value: 5, minSpend: 50, slotKey: 'c5:0', title: '新会员礼券 · 5元' }, 49, true],
    ['未使用 5元券门槛0（穿底券）→ 49',
      { _id: 'a2', source: 'register_gift', status: 'unused', value: 5, minSpend: 0, slotKey: 'c5:0', title: '新会员礼券 · 5元' }, 49, true],
    ['未使用 30元券门槛300 → 299',
      { _id: 'a3', source: 'register_gift', status: 'unused', value: 30, minSpend: 300, slotKey: 'c30:0', title: '新会员礼券 · 30元' }, 299, true],
    ['未使用 50元券门槛500 → 499',
      { _id: 'a4', source: 'register_gift', status: 'unused', value: 50, minSpend: 500, slotKey: 'c50:0', title: '新会员礼券 · 50元' }, 499, true],
    ['未使用 100元券门槛1000 → 999',
      { _id: 'a5', source: 'register_gift', status: 'unused', value: 100, minSpend: 1000, slotKey: 'c100:0', title: '新会员礼券 · 100元' }, 999, true],
    ['已使用券门槛50 → 不动（历史凭证）',
      { _id: 'b1', source: 'register_gift', status: 'used', value: 5, minSpend: 50, slotKey: 'c5:0', title: '新会员礼券 · 5元' }, null, false],
    ['已过期券门槛50 → 不动',
      { _id: 'b2', source: 'register_gift', status: 'expired', value: 5, minSpend: 50, slotKey: 'c5:0', title: '新会员礼券 · 5元' }, null, false],
    ['已锁定券门槛50 → 不动',
      { _id: 'b3', source: 'register_gift', status: 'locked', value: 5, minSpend: 50, slotKey: 'c5:0', title: '新会员礼券 · 5元' }, null, false],
    ['档位已从配置删除 → 不猜，不动',
      { _id: 'c1', source: 'register_gift', status: 'unused', value: 20, minSpend: 50, slotKey: 'c20:0', title: '旧档位券' }, null, false],
    ['档位 id 被复用于不同面额 → 视为另一张券，不动',
      { _id: 'c2', source: 'register_gift', status: 'unused', value: 66, minSpend: 50, slotKey: 'c5:0', title: '异常券' }, null, false],
    ['非礼包来源券 → 不动',
      { _id: 'd1', source: 'birthday_gift', status: 'unused', value: 5, minSpend: 50, slotKey: 'c5:0', title: '生日礼券' }, null, false],
    ['已对齐的券 → 幂等无写入',
      { _id: 'e1', source: 'register_gift', status: 'unused', value: 5, minSpend: 49, slotKey: 'c5:0', title: '新会员礼券 · 5元' }, null, false]
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

  // 9. 保存拦截：「券总开关开 + 全部券行停用」必须被拒（2026-09-15 / 09-16 两次事故形态）
  const allOff = defaults.validateConfigCoupons({
    couponsEnabled: true,
    coupons: [
      { id: 'c5', enabled: false, value: 5, minSpend: 49, count: 1 },
      { id: 'c30', enabled: false, value: 30, minSpend: 299, count: 1 }
    ]
  })
  check('保存校验拒绝「总开关开 + 全部券行停用」', allOff && allOff.ok === false, `实际 ${JSON.stringify(allOff)}`)
  const oneOn = defaults.validateConfigCoupons({
    couponsEnabled: true,
    coupons: [
      { id: 'c5', enabled: false, value: 5, minSpend: 49, count: 1 },
      { id: 'c30', enabled: true, value: 30, minSpend: 299, count: 1 }
    ]
  })
  check('保存校验放行「至少一条券行启用」', oneOn && oneOn.ok === true, `实际 ${JSON.stringify(oneOn)}`)
  const switchOff = defaults.validateConfigCoupons({
    couponsEnabled: false,
    coupons: [{ id: 'c5', enabled: false, value: 5, minSpend: 49, count: 1 }]
  })
  check('保存校验放行「礼券总开关整体关闭」', switchOff && switchOff.ok === true, `实际 ${JSON.stringify(switchOff)}`)

  // 10. 摘要显式告警：否则 ERP/超管工作台只显示「100 积分」，看不出已经停发
  const warnText = defaults.describeConfig({
    enabled: true, couponsEnabled: true, pointsEnabled: true, points: 100, expireDays: 90, stackable: false,
    coupons: [{ id: 'c5', enabled: false, value: 5, minSpend: 49, count: 1 }]
  })
  check('摘要对「券行全停」显式告警', /⚠️/.test(warnText), warnText)

  // 11. ERP 是直写 member_welcome_gift 的（不经云函数），拦截必须自己有一份
  const erpSrc = fs.readFileSync(ERP_WELCOME_GIFT, 'utf8')
  check('ERP validateWelcomeGiftCoupons 调用券行可发校验', erpGuardSignature(erpSrc),
    '未找到 return validateWelcomeGiftActivatable(src, coupons)')
  check('ERP 保存按钮走同一校验', /validateWelcomeGiftCoupons\(form\)/.test(fs.readFileSync(ERP_COMPONENT, 'utf8')),
    'WelcomeGiftConfig.vue 未调用 validateWelcomeGiftCoupons')

  // 12. 注册发券异常留痕：否则用户只到账积分、没有券，页面上也没有补领入口
  check('upsertUserProfile 对「总开关开却 0 张券」留痕为待补领', upsertAnomalySignature(fs.readFileSync(UPSERT_INDEX, 'utf8')),
    '未找到 couponsConfiguredButEmpty → registerGiftIncomplete 的留痕')

  // 13. 唯一权威入口：超管工作台云函数 = 唯一写入路径（ERP 能力保留但走同一条路）
  const compSrc = fs.readFileSync(ERP_COMPONENT, 'utf8')
  check('ERP 新会员礼包页不再 CDN 直写集合，改走云函数 manageWelcomeGift', erpGoesThroughCloudFn(compSrc),
    '仍存在 cdnUpdate/cdnUpsertSingleton 直写，或未调用 callCloudFunction(FN, …)')
  check('代理白名单（服务端 functions/_lib）含 manageWelcomeGift', proxyAllowsManageWelcomeGift(fs.readFileSync(PROXY_SERVER, 'utf8')),
    '未加入 ALLOWED_FUNCTIONS → ERP 调用会被 403')
  check('代理白名单（ERP 镜像 cloudbaseCdnDb.js）含 manageWelcomeGift', proxyAllowsManageWelcomeGift(fs.readFileSync(PROXY_ADMIN, 'utf8')),
    '未加入 ADMIN_PROXY_FUNCTIONS → ERP 会走浏览器匿名 callFunction 而被拒')
  const giftRule = giftRuleShape(fs.readFileSync(RULE_FILE, 'utf8'))
  check('member_welcome_gift 写对客户端关闭（写只能走云函数）', giftRule.writeClosed,
    'write 不是 false → 任意登录态客户端可直写配置')
  check('member_welcome_gift 读不放给完全匿名（read=false 或 auth != null）', giftRule.readScoped,
    'read 为 true → 未登录也能读整份配置')

  // 14. 前端展示口径：6 个展示面里，档位只能来自「云函数 preview / 已发券 / 同源兜底」
  check('注册页「新客礼」预告唯一来源是云函数 preview',
    previewIsSourceOfTruth(fs.readFileSync(ONBOARDING_PAGE, 'utf8')),
    '未调用 manageWelcomeGift{action:"preview"} → 预告可能不再随配置变化')
  check('注册完成页展示的是实发结果（options.coupons / gift.couponCount）',
    doneShowsActualGrant(fs.readFileSync(ONBOARDING_DONE, 'utf8')),
    '未消费实发结果 → 完成页会退化成兜底档位张数')
  const ladders = ladderDefinitionFiles([
    path.join(ROOT, 'miniprogram', 'utils'),
    path.join(ROOT, 'miniprogram', 'pages'),
    path.join(ROOT, 'miniprogram', 'subpackages'),
    path.join(ROOT, 'miniprogram', 'components')
  ])
  check('C 端只有一份档位兜底（profileConstants.REGISTER_GIFT）', ladders.length === 1,
    `实际 ${ladders.length} 份：${ladders.join(', ')}`)
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
    ['兜底档位被改成另一个门槛（满49减5 → 满200减5）', (src) => src
      .replace("{ id: 'c5', enabled: true, value: 5, minSpend: 49", "{ id: 'c5', enabled: true, value: 5, minSpend: 200")],
    ['保存校验被摘掉（券行全停也放行）', (src) => src
      .replace('return validateCouponsActivatable(src, coupons)', 'return { ok: true }')],
    ['摘要告警被移除（券行全停不再提示）', (src) => src
      .replace('const warn = allCouponsOff ?', 'const warn = false ?')],
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

  // 源级签名断言的自检：直接喂「被破坏」的源码文本，证明这两个断言不是恒真。
  const signatureCases = [
    ['ERP 直写拦截被摘掉',
      () => erpGuardSignature('export function validateWelcomeGiftCoupons(c) { return { ok: true } }')],
    ['注册异常留痕被摘掉（partial 不再包含 anomaly）',
      () => upsertAnomalySignature('const couponsConfiguredButEmpty = !!(config.couponsEnabled && !couponSlots.length)\nconst partial = !couponMeta.complete')],
    ['ERP 又退回 CDN 直写（唯一入口被破）',
      () => erpGoesThroughCloudFn('await cdnUpdate(COLLECTIONS.MEMBER_WELCOME_GIFT, id, payload)')],
    ['规则被改回「登录即可读写」（写口被打开）',
      () => giftRuleShape('{"read":true,"write":"auth != null"}').writeClosed],
    ['规则被改回完全公开可读',
      () => giftRuleShape('{"read":true,"write":false}').readScoped],
    ['代理白名单漏掉 manageWelcomeGift',
      () => proxyAllowsManageWelcomeGift("export const ALLOWED_FUNCTIONS = ['manageBirthdayGift']")],
    ['注册页预告改回读本地档位（不再问配置）',
      () => previewIsSourceOfTruth("const GIFT_COUPONS = REGISTER_GIFT.coupons || []")],
    ['完成页改回只显示兜底张数（不消费实发结果）',
      () => doneShowsActualGrant("giftCoupons: (REGISTER_GIFT.coupons || []).length")]
  ]
  for (const [label, probe] of signatureCases) {
    const detected = probe() === false
    allDetected = allDetected && detected
    console.log(`${detected ? '✓' : '✗'} ${label} → ${detected ? '已检出' : '【漏检】'}`)
  }

  console.log()
  if (!allDetected) {
    console.error('自检失败：存在漏检用例，检查本身不可信。')
    process.exit(1)
  }
  console.log(`自检通过：${cases.length + signatureCases.length} 个破坏用例均被检出。\n`)
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
