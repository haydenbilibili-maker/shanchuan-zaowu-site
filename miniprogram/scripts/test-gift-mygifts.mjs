/**
 * 我的礼赠（subpackages/feature/gift/my-gifts）「我送出的」展示逻辑 行为断言
 *
 * 需求 31：整体交互设计优化，重点「我送出的」——已退款 / 已取消折叠展示。
 *
 * 本轮钉住四类「不报错但用户看得见」的问题：
 *
 *   1. **模板作用域**：WXML `<template>` 只能读到 `data` 传进去的值。卡片模板里写
 *      `{{flowTab}}`（页面 data）会永远解析成 undefined —— 「致 XX」那一行**从不显示**、
 *      收到侧角标也不变色，而 WXML 不会因此报任何错。
 *      本守卫**全仓扫描**所有非组件 WXML 的模板体，禁止引用未传入的标识符。
 *   2. **失效口径**：云端 `buildMineProgressSteps` 只对 refunded / cancelled 返回
 *      `mode: 'terminal'`；口径若写成「terminal 之外也折」会把已完成礼赠一起折进去。
 *   3. **折叠计数**：分页未到底时，已加载页里的失效笔数 ≠ 总笔数，说成「共 N 笔」就是谎报。
 *   4. **失效卡出口**：云端 `buildMineActions` 对 refunded / cancelled 不派发动作，
 *      卡片上会一个按钮都没有 —— 需要客户端兜底，但不得覆盖服务端已给的动作。
 *
 * 用法：
 *   node miniprogram/scripts/test-gift-mygifts.mjs
 *   node miniprogram/scripts/test-gift-mygifts.mjs --selftest   # 注入回归，证明守卫会失败
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
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

const PAGE = 'miniprogram/subpackages/feature/gift/my-gifts/index.js'
const WXML = 'miniprogram/subpackages/feature/gift/my-gifts/index.wxml'
const WXSS = 'miniprogram/subpackages/feature/gift/my-gifts/index.wxss'

const INJECTIONS = {
  // 退回旧写法：模板里引用页面 data → 「致 XX」永不显示（本轮修掉的真 bug）
  'template-scope-regression': {
    file: WXML,
    from: "          <view class=\"role-chip {{item.flowTab}}\">{{item.roleLabel}}</view>",
    to: "          <view class=\"role-chip {{flowTab}}\">{{item.roleLabel}}</view>"
  },
  // 失效口径放宽到「已完成」→ 折叠区把已完成的礼赠也收进去
  'fold-done-too': {
    file: PAGE,
    from: "    progressSteps.mode === 'terminal'",
    to: "    progressSteps.mode === 'terminal' ||\n    progressKey === 'done'"
  },
  // 失效卡不再兜底动作 → 折叠区卡片上没有任何出口
  'no-fallback-action': {
    file: PAGE,
    from: '  const fallback = inactive && !actions.length && item.deepLink',
    to: '  const fallback = false && item.deepLink'
  },
  // 兜底动作不再受「失效 + 云端没给动作」约束 → 在途卡也被塞上假入口
  'fallback-for-everyone': {
    file: PAGE,
    from: '  const fallback = inactive && !actions.length && item.deepLink',
    to: '  const fallback = item.deepLink ? [{ key: \'order\', label: \'订单详情\', type: \'nav\', path: item.deepLink }] : []'
  },
  // 计数口径说谎：只加载了一页也说「共」
  'cap-lies': {
    file: PAGE,
    from: '  return hasMore ? `已加载 ${n} 笔` : `共 ${n} 笔`',
    to: '  return `共 ${n} 笔`'
  },
  // 换段位不收回折叠区 → 保留上一次的展开态与计数
  'segment-keeps-fold': {
    file: PAGE,
    from: '      ...this.foldedResetPatch(),\n      page: 1,\n      hasMore: false,\n      errorMsg: \'\',\n      ...copy',
    to: '      page: 1,\n      hasMore: false,\n      errorMsg: \'\',\n      ...copy'
  },
  // 券包退回 v1 的券背（与券夹语言漂移）
  'pouch-v1-layer': {
    file: WXML,
    from: '              <view class="pouch-ticket t1">',
    to: '              <view class="pouch-layer l1">'
  },
  // 折叠件丢 aria → 收起/展开对读屏不可辨
  'pouch-no-aria': {
    file: WXML,
    from: '            aria-expanded="{{foldedExpanded}}"',
    to: '            aria-expanded="true"'
  },
  // 「致 XX」退回 elif 链 → 有礼笺摘句时又不显示受赠人
  'recipient-shadowed-by-snippet': {
    file: WXML,
    from: '          <text class="meta recipient" wx:if="{{item.flowTab === \'sent\' && item.recipientName}}">致 {{item.recipientName}}</text>\n          <text class="snippet" wx:if="{{item.cardSnippet}}">「{{item.cardSnippet}}」</text>',
    to: '          <text class="snippet" wx:if="{{item.cardSnippet}}">「{{item.cardSnippet}}」</text>\n          <text class="meta recipient" wx:elif="{{item.flowTab === \'sent\' && item.recipientName}}">致 {{item.recipientName}}</text>'
  },
  // 折叠区被挪出 .list → 刷新态不跟列表一起 dim，页脚顺序也乱
  'pouch-outside-list': {
    file: WXML,
    from: '        <!-- 需求 31：已退款 / 已取消折叠进券包（与礼券夹 #7 同一套语言） -->',
    to: '        </view>\n        <!-- 需求 31：已退款 / 已取消折叠进券包（与礼券夹 #7 同一套语言） -->'
  }
}

const INJECT = String(process.env.GIFT_MYGIFTS_INJECT || '').trim()

function readSrc(file) {
  const raw = readFileSync(resolve(ROOT, file), 'utf8')
  if (!INJECT) return raw
  const inj = INJECTIONS[INJECT]
  if (!inj) throw new Error('unknown injection ' + INJECT)
  if (inj.file !== file) return raw
  if (raw.indexOf(inj.from) === -1) throw new Error('injection anchor missing: ' + INJECT)
  return raw.replace(inj.from, inj.to)
}

/* ───────────────────── 1) 全仓模板作用域守卫 ───────────────────── */

function walkWxml(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      if (name === 'node_modules') continue
      walkWxml(full, out)
    } else if (name.endsWith('.wxml')) {
      out.push(full)
    }
  }
  return out
}

const RESERVED = new Set([
  'true', 'false', 'null', 'undefined', 'typeof', 'instanceof', 'in', 'of', 'new', 'void',
  'Math', 'Date', 'Number', 'String', 'Boolean', 'JSON', 'parseInt', 'parseFloat', 'isNaN',
  'index', 'item'
])

/** 模板块内：本模板自己声明的循环变量（wx:for-item / wx:for-index） */
function declaredLocals(block) {
  const names = new Set()
  const re = /wx:for-(item|index)\s*=\s*"([A-Za-z_$][\w$]*)"/g
  let m
  while ((m = re.exec(block))) names.add(m[2])
  if (/wx:for\s*=/.test(block) && !/wx:for-item\s*=/.test(block)) names.add('item')
  if (/wx:for\s*=/.test(block) && !/wx:for-index\s*=/.test(block)) names.add('index')
  return names
}

/** 抽取一段 WXML 里 mustache 表达式的**根标识符**（跳过属性访问、字符串、对象键） */
function rootIdentifiers(fragment) {
  const out = new Set()
  const exprs = fragment.match(/\{\{[\s\S]*?\}\}/g) || []
  for (const raw of exprs) {
    let s = raw.slice(2, -2)
    s = s.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""')
    const re = /([A-Za-z_$][\w$]*)/g
    let m
    while ((m = re.exec(s))) {
      const name = m[1]
      const before = s.slice(0, m.index)
      // 跳过 .foo 这种属性访问
      if (/[.\w$]$/.test(before)) continue
      // 跳过对象字面量的键（{key: ...}）
      if (/^\s*:/.test(s.slice(m.index + name.length))) continue
      out.add(name)
    }
  }
  return out
}

{
  // 组件目录豁免：组件 WXML 的作用域含自身 data，与页面模板不是一回事
  const files = walkWxml(join(ROOT, 'miniprogram')).filter((f) => !/[/\\]components[/\\]/.test(f))
  // 2026-09-17：钱包枢纽把三个**页面**搬进了 subpackages/business/components/WalletPanel*/（组件目录）。
  // 它们承载的是页面模板（券卡 template 与调用点同文件），上面那句通用排除会静默丢掉这份覆盖
  // —— 原来这个检查能挡住「模板调用点少传了字段」，正是靠券页那份模板。故显式纳入。
  for (const extra of walkWxml(join(ROOT, 'miniprogram/subpackages/business/components'))) {
    if (/WalletPanel/.test(extra) && !files.includes(extra)) files.push(extra)
  }
  check('扫描到非组件 WXML', files.length > 100, `${files.length} 个文件`)
  const violations = []
  let tplCount = 0
  for (const file of files) {
    const src = readFileSync(file, 'utf8')
    const re = /<template\s+name="([^"]+)"\s*>([\s\S]*?)<\/template>/g
    let m
    while ((m = re.exec(src))) {
      tplCount += 1
      const locals = declaredLocals(m[2])
      // 模板调用点传入的键（data="{{a: ..., b: ...}}" 或 data="{{item}}"）
      const callRe = /<template[^>]*\bis="([^"]+)"[^>]*\bdata="([^"]*)"[^>]*\/?>/g
      let c
      const passed = new Set()
      while ((c = callRe.exec(src))) {
        if (c[1] !== m[1]) continue
        const inner = c[2].replace(/^\{\{/, '').replace(/\}\}$/, '')
        inner.split(/,(?![^(){}]*[)}])/).forEach((pair) => {
          const k = pair.split(':')[0].trim()
          if (k) passed.add(k)
        })
      }
      const allowed = new Set([...locals, ...passed])
      const used = rootIdentifiers(m[2])
      const bad = [...used].filter((n) => !allowed.has(n) && !RESERVED.has(n))
      if (bad.length) violations.push(`${file.replace(ROOT, '')} <${m[1]}> → ${bad.join(',')}`)
    }
  }
  check('仓内存在模板定义（守卫不是空转）', tplCount >= 2, `${tplCount} 个模板`)
  eq(
    '★ 模板体不得引用未传入的标识符（模板作用域隔离）',
    violations.join(' | '),
    ''
  )
}

/* ───────────────────── 2) 加载真页面 JS ───────────────────── */

const noop = () => {}
let listMineRows = []
let listMineResp = {}
const wxStub = {
  vibrateShort: noop,
  showToast: noop,
  showLoading: noop,
  hideLoading: noop,
  navigateTo: noop,
  showModal: noop,
  cloud: {
    callFunction: async ({ data }) => {
      if (data && data.action === 'listMine') {
        return { result: { success: true, list: listMineRows, hasMore: false, counts: {}, segmentCounts: {}, ...listMineResp } }
      }
      return { result: { success: true } }
    }
  }
}
const requireStub = (id) => {
  const key = String(id)
  if (key.includes('contentDisplayFlags')) {
    return { fetchContentDisplayFlags: async () => ({ flags: {} }), toastGiftClosed: noop }
  }
  if (key.includes('utils/util')) return { batchTempFileURLs: async () => ({}) }
  if (key.includes('trackBehavior')) return { trackBehavior: noop }
  if (key.includes('userSession')) return { ensureSession: async () => ({}) }
  if (key.includes('giftSubscribe')) return { requestGiftSubscribe: async () => {} }
  if (key.includes('giftSignalLamp')) {
    return {
      giftFlowSignal: () => 'lamp-idle',
      giftDateSignal: () => 'lamp-idle',
      giftLedgerHeadSignal: () => 'lamp-idle',
      giftDatesPaneSignal: () => 'lamp-idle'
    }
  }
  throw new Error('unstubbed require ' + id)
}

/** 真源码一次性执行：既拿到 Page 配置，也拿到模块级纯函数 */
function loadPage() {
  const captured = { config: null }
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    'module',
    'exports',
    'require',
    'Page',
    'wx',
    'getApp',
    `${readSrc(PAGE)}\n;return { decorateFlowItem, fallbackProgressSteps, foldedCapText }`
  )
  const exported = factory(
    { exports: {} },
    {},
    requireStub,
    (cfg) => { captured.config = cfg },
    wxStub,
    () => ({ globalData: {} })
  )
  return { config: captured.config, ...exported }
}
const loaded = loadPage()
const page = loaded.config
const { decorateFlowItem, foldedCapText } = loaded

/* ───────────────────── 3) 失效口径 ───────────────────── */

function flowItem(over) {
  return {
    orderId: 'o1',
    role: 'giver',
    progressKey: 'awaiting_open',
    progressLabel: '待启封',
    segment: 'awaiting_open',
    deliveryType: 'invite_address',
    productTitle: '黄铜标本牌',
    deepLink: '/subpackages/business/order-detail/index?id=o1',
    actions: [],
    primaryAction: null,
    secondaryAction: null,
    ...over
  }
}

eq('★ 已取消 → 失效', decorateFlowItem(flowItem({ progressKey: 'cancelled', progressLabel: '已取消' }), 'sent').inactive, true)
eq('★ 已退款 → 失效', decorateFlowItem(flowItem({ progressKey: 'refunded', progressLabel: '已退款' }), 'sent').inactive, true)
eq(
  '过期退款中（云端同样映射为 refunded → terminal）→ 失效',
  decorateFlowItem(flowItem({ progressKey: 'refunded', progressLabel: '过期退款中' }), 'sent').inactive,
  true
)
eq(
  '云端 terminal 兜底：未知 key + mode=terminal → 失效',
  decorateFlowItem(flowItem({ progressKey: 'closed', progressSteps: { mode: 'terminal', current: -1, steps: [] } }), 'sent').inactive,
  true
)
;['awaiting_open', 'awaiting_address', 'pickup_verify', 'shipping', 'awaiting_ship', 'pending_pay', 'done'].forEach((key) => {
  eq(`★ 「${key}」不得被折叠`, decorateFlowItem(flowItem({ progressKey: key }), 'sent').inactive, false)
})
eq('失效卡不出履约微轨', decorateFlowItem(flowItem({ progressKey: 'cancelled' }), 'sent').showRail, false)
eq('在途卡出履约微轨', decorateFlowItem(flowItem({ progressKey: 'awaiting_address' }), 'sent').showRail, true)

/* ───────────────────── 4) flowTab 必须随 item 进模板 ───────────────────── */

eq('★ item 携带 flowTab（模板作用域隔离，只能这么传）', decorateFlowItem(flowItem({}), 'received').flowTab, 'received')
eq('送出侧 flowTab', decorateFlowItem(flowItem({}), 'sent').flowTab, 'sent')

/* ───────────────────── 5) 失效卡出口兜底 ───────────────────── */

{
  const dead = decorateFlowItem(flowItem({ progressKey: 'refunded', deepLink: '/x/order?id=o9' }), 'sent')
  check('★ 云端没给动作时，失效卡兜底一个「订单详情」', !!dead.primaryAction && dead.primaryAction.label === '订单详情', JSON.stringify(dead.primaryAction))
  eq('兜底动作指向本单 deepLink', dead.primaryAction.path, '/x/order?id=o9')
  eq('兜底动作类型是 nav', dead.primaryAction.type, 'nav')
}
{
  const withServer = decorateFlowItem(
    flowItem({ progressKey: 'refunded', actions: [{ key: 'refund', label: '查看退款', type: 'nav', path: '/r' }], primaryAction: { key: 'refund', label: '查看退款', type: 'nav', path: '/r' } }),
    'sent'
  )
  eq('★ 服务端已给动作时不被兜底覆盖', withServer.primaryAction.label, '查看退款')
  eq('actions 不被兜底追加', withServer.actions.length, 1)
}
{
  const active = decorateFlowItem(flowItem({ progressKey: 'awaiting_open' }), 'sent')
  eq('在途卡不给兜底动作（没动作就是没动作）', active.primaryAction, null)
}
{
  const noLink = decorateFlowItem(flowItem({ progressKey: 'cancelled', deepLink: '' }), 'sent')
  eq('没有 deepLink 时不造动作', noLink.primaryAction, null)
}

/* ───────────────────── 6) 折叠计数口径 ───────────────────── */

eq('★ 分页未到底 → 只说「已加载」', foldedCapText(3, true), '已加载 3 笔')
eq('★ 已到最早 → 才说「共」', foldedCapText(3, false), '共 3 笔')
eq('空折叠区不出文案', foldedCapText(0, false), '')

/* ───────────────────── 7) 真 loadList：拆分与分页契约 ───────────────────── */

function makeCtx(initial) {
  const ctx = { data: { ...page.data, allowed: true, ...initial } }
  ctx.setData = function (patch) { Object.assign(this.data, patch) }
  Object.keys(page).forEach((k) => { if (typeof page[k] === 'function') ctx[k] = page[k] })
  return ctx
}
/**
 * 云端 `manageGift.classifyMineProgress` 的等价桩：夹具必须带上服务端派生的
 * progressKey / progressSteps，否则测的就不是「客户端拆分」，而是「客户端猜状态」。
 */
function progressFor(status) {
  if (status === 'cancelled' || status === 'void') {
    return { progressKey: 'cancelled', progressLabel: '已取消', segment: 'done', progressSteps: { mode: 'terminal', current: -1, steps: [] } }
  }
  if (status === 'refunded' || status === 'expired_refunding') {
    return { progressKey: 'refunded', progressLabel: status === 'expired_refunding' ? '过期退款中' : '已退款', segment: 'done', progressSteps: { mode: 'terminal', current: -1, steps: [] } }
  }
  if (status === 'received') {
    return { progressKey: 'done', progressLabel: '已完成', segment: 'done', progressSteps: { mode: 'rail', current: 4, steps: [] } }
  }
  return { progressKey: 'awaiting_open', progressLabel: '待启封', segment: 'awaiting_open', progressSteps: { mode: 'rail', current: 1, steps: [{ label: '备妥', state: 'done' }, { label: '启封', state: 'current' }] } }
}

function serverRow(id, over) {
  const status = (over && over.status) || 'paid'
  return {
    _id: id,
    orderNo: 'SV' + id,
    _openid: 'me',
    source: 'gift',
    products: [{ title: '标本牌 ' + id, image: '', price: 100 }],
    totalPrice: 100,
    paidTime: '2026-09-10 10:00',
    // 云端 mapMineItem 一定会给 deepLink（卡片点击与失效卡兜底出口都依赖它）
    deepLink: `/subpackages/business/order-detail/index?id=${id}`,
    giftMeta: { deliveryType: 'invite_address', recipientName: '阿宁' },
    ...progressFor(status),
    ...over
  }
}

{
  listMineRows = [
    serverRow('a', { status: 'paid' }),
    serverRow('b', { status: 'cancelled' }),
    serverRow('c', { status: 'paid' }),
    serverRow('d', { status: 'refunded' })
  ]
  listMineResp = { hasMore: true, total: 4, counts: { sent: 4, received: 0 }, segmentCounts: { all: 4, done: 2 } }
  const ctx = makeCtx({ flowTab: 'sent', loading: false })
  await ctx.loadList(true)
  eq('在途 2 笔', ctx.data.activeList.length, 2)
  eq('★ 失效 2 笔（已取消 + 已退款）', ctx.data.foldedList.length, 2)
  eq('折叠计数 = 失效数', ctx.data.foldedCount, 2)
  eq('★ list 本体保持全量（分页 concat 依赖它）', ctx.data.list.length, 4)
  eq('★ 未到底 → 口径说「已加载 2 笔」', ctx.data.foldedCap, '已加载 2 笔')
  eq('在途卡不是 inactive', ctx.data.activeList.every((it) => !it.inactive), true)
  eq('折叠卡全是 inactive', ctx.data.foldedList.every((it) => it.inactive), true)
  eq('★ 折叠卡都有出口按钮', ctx.data.foldedList.every((it) => !!(it.primaryAction && it.primaryAction.label)), true)
  eq('★ 卡片模板能拿到 flowTab', ctx.data.activeList[0].flowTab, 'sent')
}

{
  // 分页追加：第二页全是在途
  const ctx = makeCtx({ flowTab: 'sent', loading: false })
  listMineRows = [serverRow('a', { status: 'cancelled' }), serverRow('b', { status: 'paid' })]
  listMineResp = { hasMore: true, total: 4, counts: { sent: 4 }, segmentCounts: { all: 4 } }
  await ctx.loadList(true)
  eq('第一页：在途 1 / 失效 1', `${ctx.data.activeList.length}/${ctx.data.foldedList.length}`, '1/1')
  listMineRows = [serverRow('c', { status: 'refunded' }), serverRow('d', { status: 'shipped' })]
  listMineResp = { hasMore: false, total: 4, counts: { sent: 4 }, segmentCounts: { all: 4 } }
  await ctx.loadList(false)
  eq('第二页追加后：在途 2 / 失效 2', `${ctx.data.activeList.length}/${ctx.data.foldedList.length}`, '2/2')
  eq('list 仍是全量 4', ctx.data.list.length, 4)
  eq('★ 到底后口径改说「共 2 笔」', ctx.data.foldedCap, '共 2 笔')
}

/* ───────────────────── 8) 折叠态重置 ───────────────────── */

{
  const ctx = makeCtx({ flowTab: 'sent', activeSegment: 'all', foldedExpanded: true, foldedCount: 3, foldedCap: '共 3 笔', foldedList: [1], activeList: [1] })
  listMineRows = []
  listMineResp = { hasMore: false, counts: { sent: 0 }, segmentCounts: {} }
  ctx.onSegmentTap({ currentTarget: { dataset: { key: 'done' } } })
  eq('★ 换段位收回折叠态', ctx.data.foldedExpanded, false)
  eq('换段位清空失效列表', ctx.data.foldedList.length, 0)
  eq('换段位清空折叠计数', ctx.data.foldedCount, 0)
  eq('换段位清空口径文案', ctx.data.foldedCap, '')
  eq('换段位清空在途列表', ctx.data.activeList.length, 0)
}
{
  const ctx = makeCtx({ flowTab: 'sent', activeSegment: 'all', recipientFilter: '阿宁', filterLabel: '仅看 阿宁', foldedExpanded: true, foldedCount: 1, foldedList: [1] })
  listMineRows = []
  listMineResp = { hasMore: false, counts: {}, segmentCounts: {} }
  ctx.clearRecipientFilter()
  eq('★ 清筛选也收回折叠态', ctx.data.foldedExpanded, false)
  eq('清筛选清空折叠计数', ctx.data.foldedCount, 0)
  eq('清筛选清空标签', ctx.data.filterLabel, '')
}
{
  const ctx = makeCtx({ foldedExpanded: false })
  ctx.toggleFolded()
  eq('展开', ctx.data.foldedExpanded, true)
  ctx.toggleFolded()
  eq('再点收起', ctx.data.foldedExpanded, false)
}

/* ───────────────────── 9) WXML / WXSS 结构 ───────────────────── */

const wxml = readSrc(WXML)
const wxss = readFileSync(resolve(ROOT, WXSS), 'utf8')
const tplBlock = (wxml.match(/<template name="gift-card">[\s\S]*?<\/template>/) || [''])[0]

check('★ 卡片模板用 item.flowTab（不再引用页面 data）', /class="role-chip \{\{item\.flowTab\}\}"/.test(tplBlock))
check('★ 「致 XX」用 item.flowTab 判定送出侧', /item\.flowTab === 'sent' && item\.recipientName/.test(tplBlock))
eq('模板体内不再出现裸 {{flowTab}}', (tplBlock.match(/\{\{flowTab\}\}/g) || []).length, 0)
{
  // 礼笺摘句不得再把「致 XX」顶掉：摘句用 wx:if，致 XX 是独立的 wx:if（不是同一链的 elif）
  const snippetAt = tplBlock.indexOf('class="snippet"')
  const metaAt = tplBlock.indexOf('class="meta recipient"')
  const snippetTag = tplBlock.slice(Math.max(0, snippetAt - 60), snippetAt)
  check('★ 「致 XX」排在礼笺摘句之前', metaAt > -1 && snippetAt > -1 && metaAt < snippetAt)
  check('★ 礼笺摘句不再与「致 XX」互斥（摘句是 wx:if，不是 elif）', /wx:if="\{\{item\.cardSnippet\}\}"/.test(tplBlock) && !/wx:elif="\{\{item\.cardSnippet/.test(tplBlock))
  check('摘句所在链没有把致 XX 收进 elif', !/wx:elif[^>]*recipientName/.test(tplBlock))
  void snippetTag
}

/**
 * .list 容器的标签区间：折叠件与页脚都必须在里面
 * （手工扫描，遇到引号内的 > 不当作标签结束）
 */
function viewSpan(src, marker) {
  const start = src.indexOf(marker)
  if (start === -1) return null
  let i = src.indexOf('>', start) + 1
  let depth = 1
  while (i < src.length && depth > 0) {
    const lt = src.indexOf('<', i)
    if (lt === -1) break
    let j = lt + 1
    let inQuote = null
    while (j < src.length) {
      const ch = src[j]
      if (inQuote) { if (ch === inQuote) inQuote = null } else if (ch === '"' || ch === "'") inQuote = ch
      else if (ch === '>') break
      j += 1
    }
    const tag = src.slice(lt, j + 1)
    if (/^<view[\s>]/.test(tag) && !/\/>$/.test(tag)) depth += 1
    else if (/^<\/view>/.test(tag)) depth -= 1
    i = j + 1
  }
  return { start, end: i }
}
{
  const span = viewSpan(wxml, '<view class="list ')
  check('.list 容器可定位', !!span)
  const pouchAt = wxml.indexOf('<view class="pouch"')
  const footAt = wxml.indexOf('class="list-foot"')
  const headAt = wxml.indexOf('class="flow-section-head"')
  check('★ 折叠件在 .list 内（跟随列表一起 dim、页脚顺序正确）', !!span && pouchAt > span.start && pouchAt < span.end)
  check('★ 页脚也在 .list 内', !!span && footAt > span.start && footAt < span.end)
  check('★ 分层小标题在在途列表之前', !!span && headAt > span.start && headAt < pouchAt)
}
check('★ 分层小标题只在「既有在途又有失效」时出现', /class="flow-section-head" wx:if="\{\{foldedCount && activeList\.length\}\}"/.test(wxml))
check('★ 在途清空时给内联说明', /class="flow-empty-note" wx:if="\{\{!activeList\.length && foldedCount\}\}"/.test(wxml))
check('折叠件 v2：券包容器', /class="pouch" wx:if="\{\{foldedCount\}\}"/.test(wxml))
eq('折叠件 v2：3 张错位迷你券', (wxml.match(/class="pouch-ticket t\d"/g) || []).length, 3)
eq('折叠件 v2：最前一张 3 个打眼孔', (wxml.match(/class="pouch-hole"/g) || []).length, 3)
check('折叠件 v2：CSS 折角箭头（不再用字符箭头）', /class="pouch-arrow \{\{foldedExpanded \? 'open' : ''\}\}"/.test(wxml))
check('★ 折叠件带 aria', /aria-expanded="\{\{foldedExpanded\}\}"/.test(wxml) && /aria-role="button"/.test(wxml) && /aria-label="已退款已取消/.test(wxml))
check('折叠件用诚实口径文案', /\{\{foldedCap\}\} · \{\{foldedExpanded \? '收起' : '展开查看'\}\}/.test(wxml))
check('展开区有收尾说明', /class="pouch-foot"/.test(wxml))
eq('★ v1 券背语言已清零（WXML）', (wxml.match(/pouch-layer/g) || []).length, 0)
eq('★ v1 券背语言已清零（WXSS）', (wxss.match(/pouch-layer/g) || []).length, 0)
eq('旧 .folded-pouch 类已清零', (wxss.match(/folded-pouch/g) || []).length, 0)
check('折叠区动画已定义', /@keyframes pouch-in/.test(wxss))
check('失效卡在折叠区内仍整体降调', /\.card-hit\.is-folded\s*\{[^}]*opacity/.test(wxss))

/* ------------------------------------------------------------------ */

if (process.argv.includes('--selftest') && !INJECT) {
  const { spawnSync } = await import('node:child_process')
  let bad = 0
  for (const name of Object.keys(INJECTIONS)) {
    const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
      env: { ...process.env, GIFT_MYGIFTS_INJECT: name },
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

console.log(`\n我的礼赠「我送出的」断言：通过 ${passed} / ${passed + failed}`)
if (failed) {
  failures.forEach((f) => console.error('  ✗ ' + f))
  console.error(`✗ 失败 ${failed} 项`)
  process.exit(1)
}
console.log('✓ 我的礼赠通过（模板作用域 / 失效口径 / 折叠计数 / 失效卡出口 / 折叠态重置 / v2 券包结构）')
