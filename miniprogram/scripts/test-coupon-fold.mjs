/**
 * 礼券夹（subpackages/business/coupons）分组 / 折叠 行为断言
 *
 * 需求 7：已核销 / 已过期礼券折叠成券包，券面打眼 + 盖核销章。
 * 这件事有三处「静态扫不出来、上线才炸」的风险：
 *
 *   1. **`locked`（下单占用中）被当成失效**：上一版折叠口径是 `!canUse`，
 *      把「正在被未支付订单占用、付完/取消还会回来」的券塞进「已失效礼券」，
 *      等于对顾客谎报一张还会回来的券。折叠口径必须只收终态（used / expired）。
 *   2. **`usableCouponCount` 被顺手改口径**：它同时喂 WalletHubBar 角标与空态判断。
 *      一旦把 locked 或失效券算进「可用」，角标就会虚高。
 *   3. **失效券同时出状态胶囊和斜章**：券面右侧会打成一片（原草稿的真实缺陷）。
 *      失效券必须只由章承载状态。
 *
 * 做法与 test-atelier-grid.mjs 一致：**加载真源码**（new Function + require/wx 打桩），
 * 直接跑页面里的纯函数，而不是在测试里重抄一遍表达式。
 *
 * 用法：
 *   node miniprogram/scripts/test-coupon-fold.mjs
 *   node miniprogram/scripts/test-coupon-fold.mjs --selftest   # 注入回归，证明守卫会失败
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')

/**
 * 仓根 package.json 是 "type": "module"，而小程序源码是 CJS（module.exports）——
 * 直接 require 会被 Node 当成 ESM 报错。这里按 test-detail-image-grading.mjs 的既有做法，
 * 自己喂 module/exports 执行真源码。
 */
function loadCjs(file, deps = {}) {
  const src = readFileSync(resolve(ROOT, file), 'utf8')
  const module = { exports: {} }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', src)(
    module,
    module.exports,
    (id) => {
      const key = String(id)
      for (const [needle, value] of Object.entries(deps)) {
        if (key.includes(needle)) return value
      }
      throw new Error(`${file} 出现未打桩的 require：${id}`)
    }
  )
  return module.exports
}

let passed = 0
let failed = 0
const failures = []
function check(name, cond, extra) {
  if (cond) passed += 1
  else {
    failed += 1
    failures.push(`${name}${extra ? ' — ' + extra : ''}`)
  }
}
function eq(name, got, want) {
  check(name, got === want, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`)
}

const INJECTIONS = {
  // 退回上一版口径：`!canUse` 全折叠 → 占用中的券被谎报成「已失效」
  'fold-everything-not-usable': {
    file: 'miniprogram/subpackages/business/components/WalletPanelCoupons/index.js',
    from: "    if (DEAD_STATUS[item.status]) {\n      dead.push(item)\n      return\n    }",
    to: "    dead.push(item)\n    if (true) return"
  },
  // 把 locked 也算成可用 → 角标虚高、用户点进去用不了
  'locked-counted-usable': {
    file: 'miniprogram/subpackages/business/components/WalletPanelCoupons/index.js',
    from: '    if (item.canUse === true) {',
    to: "    if (item.canUse === true || item.status === 'locked') {"
  },
  // 临期窗口写反 → 所有券都挂临期标（或都不挂）
  'expiry-hint-always': {
    file: 'miniprogram/subpackages/business/components/WalletPanelCoupons/index.js',
    from: "  if (days <= EXPIRING_SOON_DAYS) return `${days} 天后过期`\n  return ''",
    to: "  return `${days} 天后过期`"
  },
  // 失效券又补回状态胶囊 → 与斜章在券面右侧重叠（原草稿缺陷）
  'stamp-and-chip': {
    file: 'miniprogram/subpackages/business/components/WalletPanelCoupons/index.wxml',
    from: '      <view class="c-status muted" wx:elif="{{item.status === \'locked\'}}">占用中</view>',
    to: '      <view class="c-status muted" wx:else>{{item.voidLabel || \'已失效\'}}</view>'
  },
  // 临期标塞回「渠道 + 有效期」那一行 → 日期被挤到第二行（浏览器实测抓到的真实回归）
  'hint-into-meta-row': {
    file: 'miniprogram/subpackages/business/components/WalletPanelCoupons/index.wxml',
    from: '        <view class="c-sub-row" wx:if="{{item.sourceLabel || item.expiryHint}}">',
    to: '        <view class="c-meta-row" wx:if="{{item.sourceLabel || item.expiryHint}}">'
  },
  // 券包折叠丢失 aria / 只看文案 → 收起态与展开态在可访问性上不可辨
  'drop-pouch-aria': {
    file: 'miniprogram/subpackages/business/components/WalletPanelCoupons/index.wxml',
    from: '      aria-expanded="{{closedExpanded}}"',
    to: '      aria-expanded="true"'
  }
}

const INJECT = String(process.env.COUPON_FOLD_INJECT || '').trim()

function readSrc(file) {
  const raw = readFileSync(resolve(ROOT, file), 'utf8')
  if (!INJECT) return raw
  const inj = INJECTIONS[INJECT]
  if (!inj) throw new Error('unknown injection ' + INJECT)
  if (inj.file !== file) return raw
  if (raw.indexOf(inj.from) === -1) throw new Error('injection anchor missing: ' + INJECT)
  return raw.replace(inj.from, inj.to)
}

/* ------------------------------------------------------------------ *
 * 加载真源码：捕获 Page 配置 + 取出模块级纯函数
 * ------------------------------------------------------------------ */

const pageSrc = readSrc('miniprogram/subpackages/business/components/WalletPanelCoupons/index.js')
const captured = { config: null }
const noop = () => {}
const wxStub = {
  vibrateShort: noop,
  showToast: noop,
  showLoading: noop,
  hideLoading: noop,
  switchTab: noop,
  navigateTo: noop,
  cloud: { callFunction: async () => ({ result: {} }) },
  setScreenBrightness: noop,
  getScreenBrightness: noop
}
const requireStub = (id) => {
  const key = String(id)
  if (key.includes('couponService')) return { fetchMyCoupons: async () => ({ ok: true, list: [] }) }
  if (key.includes('couponHelper')) {
    // 真实现（被 index.js 复用于解析 expireTime 的各种历史形态）
    return loadCjs('miniprogram/utils/couponHelper.js')
  }
  if (key.includes('orderScope')) return { ensureOpenId: async () => 'openid' }
  if (key.includes('userSession')) {
    return {
      isLocalLoggedOut: () => false,
      resumeLocalSession: noop,
      ensureSession: async () => ({}),
      needsOnboarding: () => false,
      navigateToOnboarding: noop
    }
  }
  if (key.includes('passRedeemFeedback')) {
    return {
      REDEEM_POLL_MS: 1000,
      REDEEM_ANIM_MS: 1000,
      softVibrate: noop,
      pollMemberPassRedeem: async () => ({}),
      shouldAcceptRedeem: () => false,
      formatRedeemValueText: () => ''
    }
  }
  // 2026-09-18：到店亮码改为**同步** require 同分包的 qrCanvas（事故前写的是
  // require.async('../utils/qrCanvas.js')，路径还不存在 —— 见 check:qr-draw）
  if (key.includes('qrCanvas')) return { drawMemberQr: () => Promise.resolve(true) }
  throw new Error('unexpected require ' + id)
}

// eslint-disable-next-line no-new-func
const factory = new Function(
  'Page',
  'Component',
  'require',
  'wx',
  `${pageSrc}\n;return { SOURCE_LABELS, EXPIRING_SOON_DAYS, splitCouponGroups, couponExpiryHint, decorateCoupon, useLabelForChannel }`
)
// 2026-09-17：券页已并入钱包枢纽（PanelCoupons 组件）—— 配置改由 Component({...}) 承载，
// methods 摊平回页面顶层形态，断言口径不变。
const exported = factory(
  (cfg) => { captured.config = cfg },
  (cfg) => { captured.config = cfg },
  requireStub,
  wxStub
)
const pageConfig = { ...captured.config, ...(captured.config.methods || {}) }
const {
  EXPIRING_SOON_DAYS,
  splitCouponGroups,
  couponExpiryHint,
  decorateCoupon,
  useLabelForChannel
} = exported

const NOW = new Date('2026-09-16T10:00:00+08:00')
const day = (n) => new Date(NOW.getTime() + n * 86400000).toISOString()

function card(over) {
  return decorateCoupon(
    {
      canUse: true,
      status: 'unused',
      expireTime: day(90),
      expireDate: '2026.12.15',
      ...over
    },
    NOW
  )
}

/* ------------------------------------------------------------------ *
 * 1) 三分组口径：usable / locked / dead
 * ------------------------------------------------------------------ */

check('EXPIRING_SOON_DAYS 是 7 天窗口（与页面文案 {{expiringDays}} 同源）', EXPIRING_SOON_DAYS === 7)

{
  const g = splitCouponGroups([
    card({ status: 'unused', canUse: true }),
    card({ status: 'used', canUse: false }),
    card({ status: 'expired', canUse: false }),
    card({ status: 'locked', canUse: false })
  ])
  eq('可用 = 1', g.usable.length, 1)
  eq('★ 占用中 = 1（不是失效）', g.locked.length, 1)
  eq('★ 已失效 = 2（只收 used / expired）', g.dead.length, 2)
  eq('★ 三类互斥且总数守恒', g.usable.length + g.locked.length + g.dead.length, 4)
}

{
  const g = splitCouponGroups([card({ status: 'locked', canUse: false })])
  eq('★ 只有占用中时，券包必须是空的（不能显示「已失效礼券 1 张」）', g.dead.length, 0)
  eq('占用中仍被单独列出', g.locked.length, 1)
}

{
  const g = splitCouponGroups([])
  eq('空券包 0/0/0', `${g.usable.length}/${g.locked.length}/${g.dead.length}`, '0/0/0')
}

{
  const g = splitCouponGroups(null)
  eq('null 入参安全', `${g.usable.length}/${g.locked.length}/${g.dead.length}`, '0/0/0')
}

{
  const g = splitCouponGroups([null, undefined, card({ status: 'expired', canUse: false })])
  eq('脏数据（null/undefined）被跳过', g.dead.length, 1)
  eq('脏数据不进任何其它组', g.usable.length + g.locked.length, 0)
}

{
  // 未知状态：既不谎报可用，也不谎报失效 → 落到「占用中」这种中性组
  const g = splitCouponGroups([card({ status: 'weird_state', canUse: false })])
  eq('未知状态不谎报可用', g.usable.length, 0)
  eq('未知状态不谎报失效', g.dead.length, 0)
  eq('未知状态落中性组', g.locked.length, 1)
}

/* ------------------------------------------------------------------ *
 * 2) 角标口径：usableCouponCount 只能来自 canUse
 * ------------------------------------------------------------------ */

{
  const list = [
    card({ status: 'unused', canUse: true }),
    card({ status: 'unused', canUse: true }),
    card({ status: 'locked', canUse: false }),
    card({ status: 'used', canUse: false }),
    card({ status: 'expired', canUse: false })
  ]
  const g = splitCouponGroups(list)
  // 页面里 usableCouponCount 就是 groups.usable.length（同一表达式）
  check(
    '★ 角标口径 = usable 组',
    /usableCouponCount:\s*groups\.usable\.length/.test(pageSrc),
    '页面未用 groups.usable.length 喂 usableCouponCount'
  )
  eq('★ 5 张里只有 2 张算可用（占用/已核销/已过期都不算）', g.usable.length, 2)
}

/* ------------------------------------------------------------------ *
 * 3) 打眼章文案与类型
 * ------------------------------------------------------------------ */

{
  eq('已核销 → 章文案', decorateCoupon({ status: 'used', canUse: false }, NOW).voidLabel, '已核销')
  eq('已核销 → 章型别', decorateCoupon({ status: 'used', canUse: false }, NOW).voidKind, 'is-used')
  eq('已过期 → 章文案', decorateCoupon({ status: 'expired', canUse: false }, NOW).voidLabel, '已过期')
  eq('已过期 → 章型别（灰章，与核销金章区分）', decorateCoupon({ status: 'expired', canUse: false }, NOW).voidKind, 'is-expired')
  eq('占用中 → 不盖章', decorateCoupon({ status: 'locked', canUse: false }, NOW).voidLabel, '')
  eq('可用 → 不盖章', decorateCoupon({ status: 'unused', canUse: true }, NOW).voidLabel, '')
}

/* ------------------------------------------------------------------ *
 * 4) 临期提示：只在窗口内、且只在可用券上出现
 * ------------------------------------------------------------------ */

eq('90 天后到期 → 不提醒', couponExpiryHint(card({ expireTime: day(90) }), NOW), '')
eq('8 天后到期 → 不提醒（窗口外一天）', couponExpiryHint(card({ expireTime: day(8) }), NOW), '')
eq('7 天后到期 → 提醒', couponExpiryHint(card({ expireTime: day(7) }), NOW), '7 天后过期')
eq('3 天后到期 → 提醒', couponExpiryHint(card({ expireTime: day(3) }), NOW), '3 天后过期')
eq('正好 1 天后 → 明日到期', couponExpiryHint(card({ expireTime: day(1) }), NOW), '明日到期')
eq('已过点但 status 仍 unused → 今日到期', couponExpiryHint(card({ expireTime: day(-0.5) }), NOW), '今日到期')
eq('无 expireTime → 长期有效，不提醒', couponExpiryHint(card({ expireTime: null }), NOW), '')
eq('脏 expireTime → 不提醒也不崩', couponExpiryHint(card({ expireTime: 'not-a-date' }), NOW), '')
eq(
  '★ 失效券不挂临期标（章才是它的状态）',
  couponExpiryHint({ canUse: false, expireTime: day(3) }, NOW),
  ''
)
eq(
  '→ 派生字段同步为空',
  decorateCoupon({ status: 'expired', canUse: false, expireTime: day(3) }, NOW).expiringSoon,
  false
)
// 历史形态：expireTime 可能是 {$date} / 数字时间戳（couponTimeMs 兼容）
eq(
  '兼容 {$date} 形态',
  decorateCoupon({ status: 'unused', canUse: true, expireTime: { $date: day(2) } }, NOW).expiryHint,
  '2 天后过期'
)

/* ------------------------------------------------------------------ *
 * 5) 可用券按钮文案（渠道口径，保持原行为）
 * ------------------------------------------------------------------ */

eq('双渠道 → 去使用', useLabelForChannel({ canUse: true, canUseOnline: true, canUseStore: true }), '去使用')
eq('仅门店 → 到店亮码', useLabelForChannel({ canUse: true, canUseOnline: false, canUseStore: true }), '到店亮码')
eq('仅线上 → 线上使用', useLabelForChannel({ canUse: true, canUseOnline: true, canUseStore: false }), '线上使用')
eq('不可用 → 空串（不渲染按钮）', useLabelForChannel({ canUse: false, canUseOnline: true, canUseStore: true }), '')

/* ------------------------------------------------------------------ *
 * 6) WXML / WXSS 结构：折叠件、打眼、章不重叠、无死样式
 * ------------------------------------------------------------------ */

const wxml = readSrc('miniprogram/subpackages/business/components/WalletPanelCoupons/index.wxml')
const wxss = readFileSync(resolve(ROOT, 'miniprogram/subpackages/business/components/WalletPanelCoupons/index.wxss'), 'utf8')

check('券卡抽为 template，可用/占用/失效共用一份标记', /<template name="coupon-card">/.test(wxml))
check('失效券走打眼孔', /class="punch-line"/.test(wxml))
eq('★ 打眼孔是 7 个定孔', (wxml.match(/class="punch-hole"/g) || []).length, 7)
check('失效券盖斜章', /class="void-stamp \{\{item\.voidKind\}\}"/.test(wxml))
{
  // 券面右侧只允许两个状态节点：可用券的「去使用」按钮、占用中的「占用中」胶囊。
  // 失效券若再补一个胶囊，就会与斜章在右侧重叠（原草稿的真实缺陷）。
  const chips = wxml.match(/<view\s+class="c-status[^>]*>[\s\S]*?<\/view>/g) || []
  eq('★ 状态节点只有 2 个（可用按钮 + 占用中胶囊）', chips.length, 2)
  eq('★ 失效券的状态只由斜章承载，胶囊里不得再出现 voidLabel', chips.filter((c) => c.includes('voidLabel')).length, 0)
  check('第 2 个状态节点是占用中', /locked/.test(chips[1] || ''))
}
{
  // 信息行分工：第一行 = 渠道 + 有效期；第二行 = 临期标 + 来源。
  // 浏览器实测发现过：把临期标塞进第一行会把日期挤到第二行，卡片多出一行、层级也散了。
  const rows = wxml.match(/<view class="c-[a-z-]*row"[\s\S]*?<\/view>/g) || []
  const metaRows = rows.filter((r) => r.startsWith('<view class="c-meta-row"'))
  const hintRows = rows.filter((r) => r.includes('c-hint'))
  eq('★ 临期标不得出现在「渠道 + 有效期」行', metaRows.filter((r) => r.includes('c-hint')).length, 0)
  eq('临期标只出现一次', hintRows.length, 1)
  check('★ 临期标与来源同在第二行', /^<view class="c-sub-row"/.test(hintRows[0] || '') && (hintRows[0] || '').includes('c-source'))
  check('第一行仍是渠道 + 有效期', /c-tag[\s\S]*?c-date/.test(metaRows[0] || ''))
}
check('★ 失效券文字区为章让位', /\.coupon-card\.is-void \.c-right\s*\{[^}]*padding-right/.test(wxss))
check('券包折叠件存在', /class="pouch"/.test(wxml))
eq('★ 券包堆叠 = 3 张错位迷你券', (wxml.match(/class="pouch-ticket t\d"/g) || []).length, 3)
check('券包展开态由 closedExpanded 驱动', /wx:if="\{\{closedExpanded\}\}"/.test(wxml))
check('★ 折叠件带 aria-expanded（不只看文案）', /aria-expanded="\{\{closedExpanded\}\}"/.test(wxml))
check('折叠箭头随状态旋转', /pouch-arrow \{\{closedExpanded \? 'open' : ''\}\}/.test(wxml))
check('占用中单独成分组，不混进券包', /locked-block/.test(wxml) && /group-title">使用中/.test(wxml))
check('无可用券但有失效券时给内联出口', /class="inline-cta"/.test(wxml))
check('展开动画已定义', /@keyframes pouch-in/.test(wxss))
eq('★ 旧版 .disabled 死样式已清掉（改由 is-void / is-locked 承载）', (wxss.match(/\.coupon-card\.disabled/g) || []).length, 0)
eq('★ 旧版 stamp-void 命名残留为 0', (wxss.match(/stamp-void/g) || []).length, 0)
check('占用中为虚线描边（进行时而非终态）', /\.coupon-card\.is-locked\s*\{[^}]*border-style:\s*dashed/.test(wxss))

/* ------------------------------------------------------------------ *
 * 7) 折叠开关：软震动 + 纯取反
 * ------------------------------------------------------------------ */

{
  const ctx = {
    data: { closedExpanded: false },
    setData(patch) { Object.assign(this.data, patch) }
  }
  pageConfig.toggleClosedCoupons.call(ctx)
  eq('展开', ctx.data.closedExpanded, true)
  pageConfig.toggleClosedCoupons.call(ctx)
  eq('再点收起', ctx.data.closedExpanded, false)
}

{
  // 游客态必须清空三分组：退出登录后不能残留上一位用户的券包
  const ctx = {
    data: {},
    setData(patch) { Object.assign(this.data, patch) },
    stopPassTimer: noop,
    stopRedeemPoll: noop,
    restorePassBrightness: noop
  }
  pageConfig.applyGuestCouponsState.call(ctx)
  eq('游客态清空可用数', ctx.data.usableCouponCount, 0)
  eq('游客态清空占用中', ctx.data.lockedCount, 0)
  eq('游客态清空失效券包', ctx.data.closedCount, 0)
  eq('游客态收起券包', ctx.data.closedExpanded, false)
}

/* ------------------------------------------------------------------ */

if (process.argv.includes('--selftest') && !INJECT) {
  const { spawnSync } = await import('node:child_process')
  let bad = 0
  for (const name of Object.keys(INJECTIONS)) {
    const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
      env: { ...process.env, COUPON_FOLD_INJECT: name },
      encoding: 'utf8'
    })
    if (run.status !== 0) console.log(`  ✓ 注入 ${name} 被检出`)
    else {
      bad += 1
      console.error(`  ✗ 注入 ${name} 未被检出（断言不会失败 = 守卫无效）`)
    }
  }
  const clean = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8' })
  if (clean.status !== 0) {
    bad += 1
    console.error('  ✗ 未注入时本应通过，实际失败：')
    console.error(clean.stdout || clean.stderr)
  } else {
    console.log('  ✓ 未注入时通过（无假阳性）')
  }
  if (bad) {
    console.error(`\n✗ selftest 失败 ${bad} 项`)
    process.exit(1)
  }
  console.log(`\n✓ selftest 通过：${Object.keys(INJECTIONS).length} 个回归注入全部被检出，且无假阳性`)
  process.exit(0)
}

console.log(`\n礼券夹分组/折叠断言：通过 ${passed} / ${passed + failed}`)
if (failed) {
  failures.forEach((f) => console.error('  ✗ ' + f))
  console.error(`✗ 失败 ${failed} 项`)
  process.exit(1)
}
console.log('✓ 礼券夹通过（占用中不被谎报失效 / 角标口径 / 打眼章不重叠 / 折叠件与 a11y 齐备）')
