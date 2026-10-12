/**
 * 钱包账单流水（subpackages/extra/user/stored-value）时间轴 / 分页 行为断言
 *
 * 这次改动有四处「算错了看不出来」的风险，静态扫不出来：
 *
 *   1. **时间形态**：旧实现 `new Date(row.createTime)`，而云函数回包的日期可能是
 *      `{ $date: ... }`（本仓已有 4 处按此兼容）。该形态下每行时间**静默变空**、页面照常渲染。
 *   2. **分页边界的那一天**：当天可能还有更早的流水没加载，照样算「当日净额」就是谎报。
 *   3. **游标口径**：若按「去重后的可见条数」推进 offset，期间表头插入新流水就会重复拉同一页，
 *      「加载更多」永久卡住。
 *   4. **首屏闪空态**：`ledgerLoading` 之前不存在，进页面先渲染「暂无流水」再出流水。
 *
 * 做法与 test-coupon-fold.mjs 一致：**加载真源码**（new Function + require/wx 打桩），
 * 跑真函数、真分页，而不是在测试里重抄一遍表达式。
 *
 * 用法：
 *   node miniprogram/scripts/test-wallet-ledger.mjs
 *   node miniprogram/scripts/test-wallet-ledger.mjs --selftest   # 注入回归，证明守卫会失败
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')

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

const MODULE = 'miniprogram/subpackages/business/components/WalletPanelWallet/wallet-ledger.js'
const PAGE = 'miniprogram/subpackages/business/components/WalletPanelWallet/index.js'
const WXML = 'miniprogram/subpackages/business/components/WalletPanelWallet/index.wxml'

const INJECTIONS = {
  // 退回旧实现：不认 {$date} → 每行时间静默变空
  'date-shape-regression': {
    file: MODULE,
    from: '    if (raw.$date != null) return ledgerTimeMs(raw.$date)',
    to: '    if (raw.$date != null) return 0'
  },
  // 分页未完的那一天也算净额 → 谎报当日合计
  'open-tail-total': {
    file: MODULE,
    from: "  const openKey = hasMore && buckets.length ? buckets[buckets.length - 1].key : ''",
    to: "  const openKey = ''"
  },
  // 每个日组都插一条月带 → 月份重复
  'month-band-always': {
    file: MODULE,
    from: '    if (bucket.monthKey && bucket.monthKey !== lastMonth) {',
    to: '    if (true) {'
  },
  // 列表末尾不封口 → 轨道线悬在半空
  'rail-dangling-tail': {
    file: MODULE,
    from: '      timeline[i].rows[timeline[i].rows.length - 1].isLast = true',
    to: '      timeline[i].rows[timeline[i].rows.length - 1].isLast = false'
  },
  // 轨道线永不断 → 最后一行还往下画
  'rail-past-end': {
    file: MODULE,
    from: '      isLast: idx === bucket.rows.length - 1 && complete',
    to: '      isLast: false'
  },
  // 口径文案说谎：明明只加载了一页却说「共」
  'cap-lies': {
    file: MODULE,
    from: '  return hasMore ? `已加载 ${n} 笔` : `共 ${n} 笔`',
    to: '  return `共 ${n} 笔`'
  },
  // 游标按可见条数推进 → 表头插入新流水后重复拉同一页、永久卡住
  'cursor-by-visible-count': {
    file: PAGE,
    from: '      const cursor = this.data.ledgerOffset + page.rows.length',
    to: '      const cursor = this.data.ledgerOffset + fresh.length'
  },
  // 箭头不再受可点性约束 → 不可点的行也给假入口
  'chevron-always': {
    file: WXML,
    from: '                  <view class="sv-ledger-chevron" wx:if="{{row.tappable}}" aria-hidden="true"></view>',
    to: '                  <view class="sv-ledger-chevron" aria-hidden="true"></view>'
  },
  // 首屏先渲染空态 → 「暂无流水」闪现
  'skeleton-after-empty': {
    file: WXML,
    from: '        <view class="sv-ledger-skel" wx:if="{{ledgerLoading}}">',
    to: '        <view class="sv-ledger-skel" wx:if="{{false}}">'
  }
}

const INJECT = String(process.env.WALLET_LEDGER_INJECT || '').trim()

function readSrc(file) {
  const raw = readFileSync(resolve(ROOT, file), 'utf8')
  if (!INJECT) return raw
  const inj = INJECTIONS[INJECT]
  if (!inj) throw new Error('unknown injection ' + INJECT)
  if (inj.file !== file) return raw
  if (raw.indexOf(inj.from) === -1) throw new Error('injection anchor missing: ' + INJECT)
  return raw.replace(inj.from, inj.to)
}

function loadCjs(file, deps = {}, inject = {}) {
  let src = readSrc(file)
  Object.entries(inject).forEach(([from, to]) => {
    if (src.indexOf(from) !== -1) src = src.replace(from, to)
  })
  const module = { exports: {} }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', src)(module, module.exports, (id) => {
    const key = String(id)
    for (const [needle, value] of Object.entries(deps)) if (key.includes(needle)) return value
    throw new Error(`${file} 出现未打桩的 require：${id}`)
  })
  return module.exports
}

/* ───────────────────────── 1) 真模块：时间解析 ───────────────────────── */

const ledger = loadCjs(MODULE)

const NOW = new Date('2026-09-16T20:00:00+08:00').getTime()
const at = (dayBack, hh, mm) => {
  const d = new Date(NOW)
  d.setDate(d.getDate() - dayBack)
  d.setHours(hh, mm, 0, 0)
  return d
}

eq('时间：Date 对象', ledger.ledgerTimeMs(at(0, 14, 3)), at(0, 14, 3).getTime())
eq('时间：毫秒数', ledger.ledgerTimeMs(1758000000000), 1758000000000)
eq('时间：ISO 字符串', ledger.ledgerTimeMs(at(1, 9, 30).toISOString()), at(1, 9, 30).getTime())
eq('★ 时间：{$date: ms}', ledger.ledgerTimeMs({ $date: at(2, 8, 5).getTime() }), at(2, 8, 5).getTime())
eq('★ 时间：{$date: ISO}', ledger.ledgerTimeMs({ $date: at(3, 8, 5).toISOString() }), at(3, 8, 5).getTime())
eq('时间：{$date: {$date}}（双层）', ledger.ledgerTimeMs({ $date: { $date: at(4, 8, 5).getTime() } }), at(4, 8, 5).getTime())
eq('时间：空值 → 0', ledger.ledgerTimeMs(null), 0)
eq('时间：脏值 → 0（不抛错）', ledger.ledgerTimeMs('not-a-date'), 0)
eq('时间：无 getTime 的对象 → 0', ledger.ledgerTimeMs({ foo: 1 }), 0)
check(
  '★ {$date} 分支必须在（旧实现就是漏了它）',
  /if \(raw\.\$date != null\) return ledgerTimeMs\(raw\.\$date\)/.test(readSrc(MODULE))
)

eq('行内只留时分', ledger.formatClock(at(0, 14, 3).getTime()), '14:03')
eq('完整时间留给无障碍', ledger.formatDateTime(at(0, 14, 3).getTime()), '2026-09-16 14:03')
eq('无效时间 → 空串', ledger.formatClock(0), '')

/* ───────────────────────── 2) 日头 / 月带文案 ───────────────────────── */

eq('今天', ledger.dayLabel(at(0, 1, 0).getTime(), NOW), '今天')
eq('昨天', ledger.dayLabel(at(1, 23, 0).getTime(), NOW), '昨天')
eq('前天起用 MM.DD', ledger.dayLabel(at(2, 12, 0).getTime(), NOW), '09.14')
eq('跨月也是 MM.DD', ledger.dayLabel(at(20, 12, 0).getTime(), NOW), '08.27')
eq('星期', ledger.weekdayLabel(at(0, 12, 0).getTime()), '周三')
eq('月带', ledger.monthLabel(at(0, 12, 0).getTime()), '2026 年 9 月')

/* ───────────────────────── 3) 时间轴分组 ───────────────────────── */

function row(over) {
  const base = {
    id: 'r' + Math.random().toString(36).slice(2, 8),
    type: 'order_pay',
    typeLabel: '订单消费',
    subtitle: '订单支付扣款 · SV20260916',
    amountFen: -5000,
    amountYuan: '50.00',
    balanceAfterFen: 95000,
    balanceAfterYuan: '950.00',
    refType: 'order',
    refId: 'order_1',
    orderNo: 'SV20260916',
    createTime: at(0, 14, 3),
    isCredit: false,
    tone: 'debit'
  }
  return { ...base, ...over }
}

{
  const rows = [
    row({ id: 'a', createTime: at(0, 18, 10) }),
    row({ id: 'b', createTime: at(0, 12, 0), amountFen: -2000, amountYuan: '20.00' }),
    row({ id: 'c', createTime: at(0, 9, 0), amountFen: 10000, amountYuan: '100.00', isCredit: true, type: 'recharge', typeLabel: '充值' }),
    row({ id: 'd', createTime: at(1, 20, 0), amountFen: -3000, amountYuan: '30.00' }),
    row({ id: 'e', createTime: at(20, 11, 0), amountFen: -1000, amountYuan: '10.00' })
  ]
  const built = ledger.buildLedgerTimeline(rows, { hasMore: false, now: NOW })
  const months = built.timeline.filter((b) => b.kind === 'month')
  const days = built.timeline.filter((b) => b.kind === 'day')

  eq('行数守恒', days.reduce((n, d) => n + d.rows.length, 0), 5)
  eq('★ 日组按出现顺序共 3 组', days.length, 3)
  eq('日组标签', days.map((d) => d.label).join(','), '今天,昨天,08.27')
  eq('★ 跨月才插月带 → 2 条', months.length, 2)
  eq('月带标签', months.map((m) => m.label).join(','), '2026 年 9 月,2026 年 8 月')
  eq('月带出现在对应日组之前', built.timeline.map((b) => b.kind).join(','), 'month,day,day,month,day')
  eq('组内保持输入顺序（倒序）', days[0].rows.map((r) => r.id).join(','), 'a,b,c')
  eq('★ 当日净额 = +100.00 -20.00 -50.00', days[0].netText, '+¥30.00')
  eq('净额色调：正 → is-plus', days[0].netTone, 'is-plus')
  eq('当日净额：净支出', days[1].netText, '-¥30.00')
  eq('净额色调：负 → is-minus', days[1].netTone, 'is-minus')
  eq('全部加载完 → 每天 complete', days.every((d) => d.complete), true)
  eq('★ 每组最后一笔 isLast（轨道线到此为止）', days.map((d) => d.rows[d.rows.length - 1].isLast).join(','), 'true,true,true')
  eq('★ 全表最后一行一定封口（轨道线不悬在半空）', built.timeline.filter((b) => b.kind === 'day').slice(-1)[0].rows.slice(-1)[0].isLast, true)
  eq('组内非末笔不出 isLast', days[0].rows.filter((r) => r.isLast).length, 1)
  eq('行内只有时分（不再逐行重复日期）', days[0].rows[0].clockText, '18:10')
  eq('完整时间仍保留（无障碍）', days[0].rows[0].timeText, '2026-09-16 18:10')
}

{
  // ★ 核心：分页未完 → 最早那天不给净额
  const rows = [
    row({ id: 'x', createTime: at(0, 18, 0) }),
    row({ id: 'y', createTime: at(1, 18, 0) }),
    row({ id: 'z', createTime: at(2, 18, 0) })
  ]
  const built = ledger.buildLedgerTimeline(rows, { hasMore: true, now: NOW })
  const days = built.timeline.filter((b) => b.kind === 'day')
  eq('结尾那组标记为未完', days[2].complete, false)
  eq('★ 未完那天不给净额（不谎报）', days[2].netText, '')
  eq('未完那天的净额为空，但列表末尾那行仍封口（轨道不悬空）', days[2].rows[days[2].rows.length - 1].isLast, true)
  eq('未完只影响合计，不影响行数', days[2].rows.length, 1)
  eq('其余天照常给净额', days[0].netText + '/' + days[1].netText, '-¥50.00/-¥50.00')
  eq('其余天仍封口', days[0].rows[days[0].rows.length - 1].isLast, true)

  const done = ledger.buildLedgerTimeline(rows, { hasMore: false, now: NOW })
  eq('加载完后同一天补上净额', done.timeline.filter((b) => b.kind === 'day')[2].netText, '-¥50.00')
}

{
  // 脏数据：无时间 / null 行
  const rows = [null, row({ id: 'p', createTime: null }), undefined, row({ id: 'q', createTime: at(0, 10, 0) })]
  const built = ledger.buildLedgerTimeline(rows, { now: NOW })
  const days = built.timeline.filter((b) => b.kind === 'day')
  eq('null / undefined 行被跳过', built.count, 2)
  eq('无时间的行进「时间未知」组', days[0].label, '时间未知')
  eq('★ 时间未知组不给净额（跨天，算了就是错的）', days[0].netText, '')
  eq('时间未知组不插月带', built.timeline.some((b) => b.kind === 'month' && b.label === '时间未知'), false)
  eq('未知组不给星期', days[0].week, '')
}

{
  const built = ledger.buildLedgerTimeline([], { now: NOW })
  eq('空输入 → 空时间轴', built.timeline.length, 0)
  eq('空输入计数 0', built.count, 0)
  const built2 = ledger.buildLedgerTimeline(null, { now: NOW })
  eq('null 输入安全', built2.timeline.length, 0)
}

/* ───────────────────────── 4) 单行派生 ───────────────────────── */

{
  const r = ledger.buildLedgerTimeline([row({})], { now: NOW }).timeline[1].rows[0]
  eq('支出 → 减号', r.amountSign, '-')
  eq('金额取绝对值展示', r.amountYuan, '50.00')
  eq('色点：支出', r.toneClass, 'is-debit')
  eq('★ refType=order → 可点，带订单号', r.tappable && r.orderId, 'order_1')
}
{
  const credit = ledger.buildLedgerTimeline(
    [row({ type: 'recharge', amountFen: 10000, amountYuan: '100.00', isCredit: true, refType: 'recharge_order', refId: 'sv_1' })],
    { now: NOW }
  ).timeline[1].rows[0]
  eq('收入 → 加号', credit.amountSign, '+')
  eq('色点：收入', credit.toneClass, 'is-credit')
  eq('★ 充值单不可点（没有对应订单详情页）', credit.tappable, false)
  eq('不可点 → 不吐订单号', credit.orderId, '')
}
{
  const refund = ledger.buildLedgerTimeline(
    [row({ type: 'refund_credit', amountFen: 5000, amountYuan: '50.00', isCredit: true, refType: 'order', refId: 'order_9' })],
    { now: NOW }
  ).timeline[1].rows[0]
  eq('退款用独立色点', refund.toneClass, 'is-refund')
  eq('★ 退款行按订单可点', refund.tappable && refund.orderId, 'order_9')
}
{
  const noRef = ledger.buildLedgerTimeline([row({ refType: 'order', refId: '' })], { now: NOW }).timeline[1].rows[0]
  eq('refType=order 但没有 refId → 不可点', noRef.tappable, false)
}
{
  const adj = ledger.buildLedgerTimeline(
    [row({ type: 'adjust', typeLabel: '调账', remark: '人工补差', subtitle: '', amountFen: 2000, amountYuan: '20.00', isCredit: true })],
    { now: NOW }
  ).timeline[1].rows[0]
  eq('subtitle 兜底用 remark', adj.subtitle, '人工补差')
}
eq('金额文案：正', ledger.signedYuanText(3050), '+¥30.50')
eq('金额文案：负', ledger.signedYuanText(-3050), '-¥30.50')
eq('金额文案：零', ledger.signedYuanText(0), '¥0.00')

/* ───────────────────────── 5) 口径文案 ───────────────────────── */

eq('★ 还有更早的 → 说「已加载」', ledger.ledgerCapText(20, true), '已加载 20 笔')
eq('★ 已到最早 → 才说「共」', ledger.ledgerCapText(23, false), '共 23 笔')
eq('空列表不出文案', ledger.ledgerCapText(0, false), '')

/* ───────────────────────── 6) 真分页：去重 + 游标 ───────────────────────── */

const page = (() => {
  const noop = () => {}
  const captured = { config: null }
  const src = readSrc(PAGE)
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', 'Page', 'Component', 'wx', 'getApp', src)(
    { exports: {} },
    {},
    (id) => {
      const key = String(id)
      if (key.includes('wallet-ledger')) return ledger
      if (key.includes('walletCopy')) return { POINTS_RULE: '', PLATE_FOOTER: '', RECHARGE_HINT: '', SECURITY_NOTE: '', RECHARGE_LEAD: '', rechargeModalSuffix: '' }
      if (key.includes('contentDisplayFlags')) {
        return { fetchContentDisplayFlags: async () => ({ flags: {} }), getCachedContentDisplayFlags: () => null, toastStoredValueClosed: noop }
      }
      if (key.includes('pageNav')) return { getPageNavInsets: () => ({ statusBarHeight: 20, navPaddingRight: 16, headerBlockPx: 88 }) }
      if (key.includes('scrollArea')) return { measureFixedScroll: async () => ({ scrollTopPx: 88, scrollHeightPx: 600 }) }
      // 2026-10-13 弹层规范：充值确认改 openAppModal（与 wx.showModal 同入参）
      if (key.includes('utils/appModal')) return { openAppModal: (o) => undefined }
      if (key.includes('userSession')) return { isLocalLoggedOut: () => false, resumeLocalSession: noop, ensureSession: async () => ({}) }
      throw new Error('unstubbed require ' + id)
    },
    (cfg) => { captured.config = cfg },
    (cfg) => { captured.config = cfg },   // 2026-09-17：面板已改由 Component({...}) 承载
    {
      vibrateShort: noop,
      showToast: noop,
      showLoading: noop,
      hideLoading: noop,
      switchTab: noop,
      navigateBack: noop,
      stopPullDownRefresh: noop,
      showModal: noop,
      getStorageSync: () => null,
      setStorageSync: noop,
      removeStorageSync: noop,
      cloud: { callFunction: async () => ({ result: { list: [] } }) }
    },
    () => ({ globalData: { openid: 'o1' } })
  )
  return { config: { ...captured.config, ...(captured.config.methods || {}) } }
})()

function makeCtx(initial) {
  const ctx = { data: { ...page.config.data, ...initial } }
  ctx.setData = function (patch) { Object.assign(this.data, patch) }
  Object.keys(page.config).forEach((k) => {
    if (typeof page.config[k] === 'function') ctx[k] = page.config[k]
  })
  return ctx
}

{
  const day1 = Array.from({ length: 20 }, (_, i) => row({ id: `p0-${i}`, createTime: at(0, 20 - i, 0) }))
  // 第 2 页：表头期间插入了新流水 → 最后一条与第 1 页重复
  const day2 = [
    ...Array.from({ length: 19 }, (_, i) => row({ id: `p1-${i}`, createTime: at(1, 20 - i, 0) })),
    day1[day1.length - 1]
  ]
  const pages = { 0: day1, 20: day2, 40: [] }
  const calls = []
  const ctx = makeCtx({ ledgers: [], ledgerOffset: 0, ledgerHasMore: true, ledgerLoading: false })
  ctx.data.ledgers = day1
  ctx.data.ledgerOffset = 20

  const wxRef = globalThis.__walletLedgerWx
  void wxRef

  // 打桩：把 wx.cloud.callFunction 换成按 offset 出页
  const original = page.config
  void original
  const stubWx = {
    vibrateShort: () => {},
    showToast: (o) => { calls.push({ toast: o && o.title }) },
    cloud: {
      callFunction: async ({ data }) => {
        calls.push({ offset: data.offset, limit: data.limit })
        return { result: { list: pages[data.offset] || [] } }
      }
    }
  }
  // 重新加载一次页面，把 stubWx 注入闭包
  const src = readSrc(PAGE)
  const captured = { config: null }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', 'Page', 'Component', 'wx', 'getApp', src)(
    { exports: {} },
    {},
    (id) => {
      const key = String(id)
      if (key.includes('wallet-ledger')) return ledger
      if (key.includes('walletCopy')) return { POINTS_RULE: '', PLATE_FOOTER: '', RECHARGE_HINT: '', SECURITY_NOTE: '', RECHARGE_LEAD: '', rechargeModalSuffix: '' }
      if (key.includes('contentDisplayFlags')) {
        return { fetchContentDisplayFlags: async () => ({ flags: {} }), getCachedContentDisplayFlags: () => null, toastStoredValueClosed: () => {} }
      }
      if (key.includes('pageNav')) return { getPageNavInsets: () => ({ statusBarHeight: 20, navPaddingRight: 16, headerBlockPx: 88 }) }
      if (key.includes('scrollArea')) return { measureFixedScroll: async () => ({ scrollTopPx: 88, scrollHeightPx: 600 }) }
      // 2026-10-13 弹层规范：充值确认改 openAppModal（与 wx.showModal 同入参）
      if (key.includes('utils/appModal')) return { openAppModal: (o) => undefined }
      if (key.includes('userSession')) return { isLocalLoggedOut: () => false, resumeLocalSession: () => {}, ensureSession: async () => ({}) }
      throw new Error('unstubbed require ' + id)
    },
    (cfg) => { captured.config = cfg },
    (cfg) => { captured.config = cfg },   // 2026-09-17：面板已改由 Component({...}) 承载
    stubWx,
    () => ({ globalData: { openid: 'o1' } })
  )

  const cfgFlat = { ...captured.config, ...(captured.config.methods || {}) }
  const ctx2 = { data: { ...captured.config.data } }
  ctx2.data.ledgers = day1
  ctx2.data.ledgerOffset = 20
  ctx2.data.ledgerHasMore = true
  ctx2.data.ledgerLoading = false
  ctx2.setData = function (patch) { Object.assign(this.data, patch) }
  Object.keys(cfgFlat).forEach((k) => {
    if (typeof cfgFlat[k] === 'function') ctx2[k] = cfgFlat[k]
  })

  await ctx2.onLoadMoreLedgers()
  eq('★ 与上一页重复的那笔不被重复渲染', ctx2.data.ledgers.length, 39)
  eq('★ 游标按服务端页长推进（20 → 40），不会卡住', ctx2.data.ledgerOffset, 40)
  eq('去重后 id 唯一', new Set(ctx2.data.ledgers.map((r) => r.id)).size, 39)
  eq('仍有更早 → hasMore 保持', ctx2.data.ledgerHasMore, true)
  eq('加载中标记复位', ctx2.data.ledgerLoadingMore, false)
  eq('时间轴总行数 = 可见行数', ctx2.data.ledgerTimeline.filter((b) => b.kind === 'day').reduce((n, d) => n + d.rows.length, 0), 39)
  eq('口径文案 = 已加载 39 笔', ctx2.data.ledgerCap, '已加载 39 笔')

  await ctx2.onLoadMoreLedgers()
  eq('最后一页为空 → hasMore 收口', ctx2.data.ledgerHasMore, false)
  eq('★ 收口后口径改说「共」', ctx2.data.ledgerCap, '共 39 笔')
  eq('★ 收口后最早那天补上净额', ctx2.data.ledgerTimeline.filter((b) => b.kind === 'day').slice(-1)[0].complete, true)

  const before = ctx2.data.ledgers.length
  await ctx2.onLoadMoreLedgers()
  eq('已无更多时不再请求', ctx2.data.ledgers.length, before)
}

/* ───────────────────────── 7) 页面数据与结构 ───────────────────────── */

const pageSrc = readSrc(PAGE)
const wxml = readSrc(WXML)

check('★ 首屏 ledgerLoading 初值为 true（先骨架，不先空态）', /ledgerLoading: true/.test(pageSrc))
check('游客态把 ledgerLoading 收回 false', /ledgerLoading: false/.test(pageSrc))
check('★ 旧实现 formatLedgerTime 已移除（时间口径收敛到纯模块）', !/function formatLedgerTime/.test(pageSrc))
check('分页去重按 id', /new Set\(this\.data\.ledgers\.map\(\(r\) => r && r\.id\)/.test(pageSrc))
check('★ 点行开订单详情（带 encode）', /order-detail\/index\?id=\$\{encodeURIComponent\(orderId\)\}/.test(pageSrc))
check('不可点时不跳转（onLedgerTap 有守卫）', /const orderId = String\(ds\.orderId \|\| ''\)\.trim\(\)\s*\n\s*if \(!orderId\) return/.test(pageSrc))

// 2026-09-17：钱包页并入枢纽后不再用内部 scroll-view（改为普通内容流，滚动交给页面本身），
// 触底分页因此从 bindscrolltolower 换成**宿主页 onReachBottom 转发** → 面板必须暴露 onReachBottom。
// 两条一起断言：面板侧有入口、且不再残留内部滚动容器（残留会与页面滚动打架）。
check('★ 触底分页入口存在（宿主转发 onReachBottom → onLoadMoreLedgers）',
  /onReachBottom\(\)\s*\{[^}]*onLoadMoreLedgers/.test(pageSrc))
check('★ 不再保留内部滚动容器（滚动统一交给页面）', !/<scroll-view/.test(wxml))
check('保留「加载更多」兜底按钮', /class="sv-ledger-more"/.test(wxml))
{
  const skelIdx = wxml.indexOf('wx:if="{{ledgerLoading}}"')
  const emptyIdx = wxml.indexOf('wx:elif="{{ledgerEmpty}}"')
  check('★ 骨架排在空态之前（先骨架、后空态）', skelIdx > -1 && emptyIdx > -1 && skelIdx < emptyIdx, `skel=${skelIdx} empty=${emptyIdx}`)
}
check('时间轴由 ledgerTimeline 单层驱动', /wx:for="\{\{ledgerTimeline\}\}"/.test(wxml))
check('月带只在 kind=month 渲染', /wx:if="\{\{item\.kind === 'month'\}\}"/.test(wxml))
check('日头含日标签与星期', /sv-ledger-day-label/.test(wxml) && /sv-ledger-day-week/.test(wxml))
check('★ 未完那天文案独立分支', /wx:elif="\{\{!item\.complete\}\}">未完</.test(wxml))
check('轨道线以 isLast 收口', /sv-ledger-line" wx:if="\{\{!row\.isLast\}\}"/.test(wxml))
check('★ 行内不再重复完整日期', !/class="sv-ledger-time"/.test(wxml) && /sv-ledger-clock/.test(wxml))
check('可点行带 data-order-id', /data-order-id="\{\{row\.orderId\}\}"/.test(wxml))
check('★ 箭头只在可点行渲染（不给假入口）', /class="sv-ledger-chevron" wx:if="\{\{row\.tappable\}\}"/.test(wxml))
eq('旧的 sv-ledger-time 样式已清掉', (readFileSync(resolve(ROOT, 'miniprogram/subpackages/business/components/WalletPanelWallet/index.wxss'), 'utf8').match(/\.sv-ledger-time/g) || []).length, 0)

/* ------------------------------------------------------------------ */

if (process.argv.includes('--selftest') && !INJECT) {
  const { spawnSync } = await import('node:child_process')
  let bad = 0
  for (const name of Object.keys(INJECTIONS)) {
    const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
      env: { ...process.env, WALLET_LEDGER_INJECT: name },
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

console.log(`\n钱包账单流水断言：通过 ${passed} / ${passed + failed}`)
if (failed) {
  failures.forEach((f) => console.error('  ✗ ' + f))
  console.error(`✗ 失败 ${failed} 项`)
  process.exit(1)
}
console.log('✓ 账单流水通过（时间形态 / 日组与月带 / 边界日不谎报 / 去重与游标 / 首屏骨架 / 点行开订单）')
