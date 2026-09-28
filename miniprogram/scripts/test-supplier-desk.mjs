#!/usr/bin/env node
/**
 * 供应商管理中心守卫（manager 域；2026-09-28 产品负责人点名「升级超管工作台·供应商预览」）
 * 蓝图：admin/docs/供应商管理中心_Phase2_技术蓝图_2026-09-28.md
 *
 * 钉住五件容易静默失效的事：
 *   ① 服务端权限：所有 admin* 动作只对超管放行（店长 / 伙伴 / 停用 / 未登录一律 FORBIDDEN 且零写入）；
 *      伙伴对账必须过功能项 statement；停用账号（status≠active）任何动作都拒绝；伙伴只看得到自己的单；
 *   ② 价目：写操作仅超管；**被单据引用的不硬删 → 停用**；引用查询失败按「有引用」处理；被引用的 skuId 不可改；
 *   ③ 追踪只读：云函数的读动作与追踪页对 purchase_orders / fulfillment_shipments **零写入**，页面不调支付 / 内容代理；
 *   ④ 口径：北京时间营业日（00:30 边界）、金额单位分（totalAmount 元 / payFen 分不混用）、验收标记不计入已收、
 *      账龄超期阈值；功能项缺省值（发货回传默认关）；
 *   ⑤ 接线：新分包已登记、磁贴跳到管理中心、Hub 按功能项隐藏「对账与物流」。
 *
 * 运行时部分用内存假库 + 假 wx-server-sdk 真跑 index.js（staffGuard 用权威副本，不打桩）。
 *
 * 用法：
 *   node miniprogram/scripts/test-supplier-desk.mjs
 *   node miniprogram/scripts/test-supplier-desk.mjs --selftest   （注入只写临时副本，真源码只读）
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const rootIdx = argv.indexOf('--root')
const ROOT = rootIdx >= 0 ? resolve(argv[rootIdx + 1]) : resolve(HERE, '../..')

const FN = 'miniprogram/cloudfunctions/manageSupplierDesk'
const CORE_REL = `${FN}/deskCore.js`
const INDEX_REL = `${FN}/index.js`
const ACCESS_REL = `${FN}/deskAccess.js`
const PKG = 'miniprogram/subpackages/b2bdesk'
const CENTER_JS = `${PKG}/center/index.js`
const ORDER_JS = `${PKG}/order/index.js`
const ORDER_WXML = `${PKG}/order/index.wxml`
const STMT_JS = `${PKG}/statement/index.js`
const STMT_WXML = `${PKG}/statement/index.wxml`
const API_JS = `${PKG}/utils/deskApi.js`
const HUB_JS = 'miniprogram/subpackages/extra/supplier/index.js'
const CFG_REL = 'miniprogram/subpackages/manager/manager/managerPageConfig.js'
const APP_JSON = 'miniprogram/app.json'
const FILES = [
  CORE_REL, INDEX_REL, ACCESS_REL, `${FN}/staffGuard.js`, `${FN}/auditLog.js`,
  CENTER_JS, ORDER_JS, ORDER_WXML, STMT_JS, STMT_WXML, API_JS,
  `${PKG}/partner/index.js`, `${PKG}/price-edit/index.js`,
  HUB_JS, CFG_REL, APP_JSON
]

if (argv.includes('--selftest')) selftest()

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')
let passed = 0
const failures = []
function t(name, fn) {
  let ok = false
  let err = ''
  try { ok = fn() === true } catch (e) { err = e.message }
  if (ok) passed += 1
  else failures.push(err ? `${name}（${err}）` : name)
}
async function ta(name, fn) {
  let ok = false
  let err = ''
  try { ok = (await fn()) === true } catch (e) { err = e.message }
  if (ok) passed += 1
  else failures.push(err ? `${name}（${err}）` : name)
}

/** 最小 CJS 加载器；`stubs` 拦截裸模块名（wx-server-sdk） */
function loadCjs(absPath, stubs = {}, cache = new Map()) {
  if (cache.has(absPath)) return cache.get(absPath).exports
  const mod = { exports: {} }
  cache.set(absPath, mod)
  const req = (id) => {
    if (Object.prototype.hasOwnProperty.call(stubs, id)) return stubs[id]
    for (const c of [resolve(dirname(absPath), id), `${resolve(dirname(absPath), id)}.js`]) {
      if (existsSync(c) && statSync(c).isFile()) return loadCjs(c, stubs, cache)
    }
    throw new Error('require 解析失败：' + id)
  }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', 'process', 'console', readFileSync(absPath, 'utf8'))(
    mod, mod.exports, req, { env: {} }, { log() {}, warn() {}, error() {}, info() {} }
  )
  return mod.exports
}

/* ───────────── ① 纯函数口径 ───────────── */
const core = loadCjs(join(ROOT, CORE_REL))
const access = loadCjs(join(ROOT, ACCESS_REL))
const bj = (iso) => Date.parse(`${iso}+08:00`)
const NOW = bj('2026-09-28T00:30:00')

t('营业日：北京时间 00:30 仍是当天（不能按 UTC / 设备时区取日）', () => core.bizDateKey(NOW) === '2026-09-28')
t('范围：近 7 天含今日、本月从 1 日起', () => {
  const r7 = core.resolveRange({ range: '7d' }, NOW)
  const rm = core.resolveRange({ range: 'month' }, NOW)
  return r7.startDate === '2026-09-22' && r7.endDate === '2026-09-28' && rm.startDate === '2026-09-01' &&
    r7.startTs === bj('2026-09-22T00:00:00') && r7.endTs === bj('2026-09-29T00:00:00') - 1
})
t('金额单位：totalAmount 元 → 分；只有 payFen 时按分取，不再乘 100', () =>
  core.amountFenOf({ totalAmount: 900, payFen: 90000 }) === 90000 && core.amountFenOf({ payFen: 18000 }) === 18000)
t('货款分档：paid/marked/offline/review/refund/due 与供货方单不适用', () => {
  const b = (x) => core.payBucketOf({ source: 'buyer_workbench', ...x })
  return b({ paymentStatus: 'paid' }) === 'received' && b({ paymentStatus: 'marked_paid' }) === 'marked' &&
    b({ paymentStatus: 'offline_pending' }) === 'offline' && b({ paymentStatus: 'pay_review' }) === 'review' &&
    b({ paymentStatus: 'paid', refund: { status: 'refunded' } }) === 'refunded' && b({}) === 'due' &&
    core.payBucketOf({ party: 'supplier_fulfillment', paymentStatus: 'paid' }) === 'na'
})
t('账龄：未收 10 天判超期；已收 / 已取消不计账龄', () => {
  const base = { source: 'buyer_workbench', status: 'submitted', submittedAt: bj('2026-09-18T10:00:00') }
  const a = core.agingOf(base, NOW)
  return a.open && a.days === 10 && a.overdue && a.band === '8-30' &&
    !core.agingOf({ ...base, paymentStatus: 'paid' }, NOW).open && !core.agingOf({ ...base, status: 'cancelled' }, NOW).open
})
t('时间线：已付已发货单 → 付款/确认/发货完成、签收进行中、运单号来自出货单', () => {
  const nodes = core.buildTimeline(
    { source: 'buyer_workbench', status: 'shipped', paymentStatus: 'paid', paymentChannel: 'wechat_jsapi', paidFen: 9000, transactionId: '4200001234567890', createdAt: bj('2026-09-20T10:00:00'), paidAt: bj('2026-09-20T10:05:00'), shippedAt: bj('2026-09-22T10:00:00') },
    [{ logistics: { carrier: '顺丰速运', trackingNumber: 'SF1234567890' } }], NOW)
  const st = Object.fromEntries(nodes.map((n) => [n.key, n.state]))
  const ship = nodes.find((n) => n.key === 'ship')
  return st.pay === 'done' && st.confirm === 'done' && st.ship === 'done' && st.receive === 'current' && st.settle === 'todo' &&
    ship.note.includes('SF1234567890') && nodes.find((n) => n.key === 'pay').note.includes('567890')
})
t('时间线：供货方单付款 / 结算节点标「未建模」而不是编造', () => {
  const nodes = core.buildTimeline({ party: 'supplier_fulfillment', status: 'shipped', createdAt: NOW }, [], NOW)
  return nodes.find((n) => n.key === 'pay').state === 'na' && nodes.find((n) => n.key === 'settle').state === 'na'
})
t('大盘：验收标记不计入已收；供货方单只进应付', () => {
  const d = core.buildDashboard([
    { _id: 'a', source: 'buyer_workbench', status: 'submitted', paymentStatus: 'paid', paidFen: 10000, totalAmount: 100, createdAt: NOW - 1000 },
    { _id: 'b', source: 'buyer_workbench', status: 'submitted', paymentStatus: 'marked_paid', totalAmount: 50, createdAt: NOW - 1000 },
    { _id: 'c', source: 'buyer_workbench', status: 'submitted', totalAmount: 30, createdAt: NOW - 1000 },
    { _id: 'd', party: 'supplier_fulfillment', supplierId: 'S1', status: 'shipped', totalAmount: 70, createdAt: NOW - 1000 },
    { _id: 'e', source: 'buyer_workbench', status: 'cancelled', totalAmount: 999, createdAt: NOW - 1000 }
  ], { range: 'today' }, NOW)
  return d.money.receivedFen === 10000 && d.money.markedFen === 5000 && d.money.dueFen === 3000 &&
    d.payable.amountFen === 7000 && d.orders.count === 4 && d.orders.cancelled === 1 && d.orders.amountFen === 25000
})
t('价目校验：非法 skuId / 负价 / 区间倒挂被拒；等值区间归一为单价', () => {
  const ok = { skuId: 'demo-1', name: '样', species: '样', packaging: '玻璃罩' }
  return !core.validatePriceItem({ ...ok, skuId: '中文' }).ok &&
    !core.validatePriceItem({ ...ok, price: -1 }).ok &&
    !core.validatePriceItem({ ...ok, price: { min: 20, max: 10 } }).ok &&
    core.validatePriceItem({ ...ok, price: { min: 20, max: 20 } }).data.price === 20 &&
    JSON.stringify(core.validatePriceItem({ ...ok, price: { min: 10, max: 20 } }).data.price) === '{"min":10,"max":20}' &&
    core.validatePriceItem({ ...ok, price: null }).data.price === null
})
t('删除决策：被引用 → 停用；无引用才删', () => core.removalPlan(2).mode === 'retire' && core.removalPlan(0).mode === 'remove')
t('排序：相邻交换且稀疏 sort 先补齐', () => {
  const p = core.planMove([{ _id: 'a', sort: 1 }, { _id: 'b', sort: 2 }, { _id: 'c', sort: 3 }], 'c', 'up')
  const q = core.planMove([{ _id: 'a' }, { _id: 'b', sort: 7 }], 'a', 'down')
  return JSON.stringify(p.writes) === '[{"_id":"c","sort":2},{"_id":"b","sort":3}]' &&
    q.writes.length === 2 && q.writes.find((w) => w._id === 'a').sort === 2
})
t('功能项缺省：发货回传默认关、其余默认开；非布尔一律视为关、目录外键丢弃', () => {
  const d = core.normalizeFeatures(undefined)
  const x = core.normalizeFeatures({ catalog: 'yes', ship: true, hack: true })
  return d.ship === false && d.catalog && d.order && d.demand && d.statement &&
    x.catalog === false && x.ship === true && !('hack' in x)
})
t('功能项判定：关 → FEATURE_OFF；停用 → FORBIDDEN；跨侧 → FORBIDDEN；超管恒开', () => {
  const actor = { ok: true, superAdmin: false }
  const row = { status: 'active', roles: ['buyer'], b2bDesk: { features: { statement: false } } }
  return access.hasDeskFeature(actor, row, 'statement').code === 'FEATURE_OFF' &&
    access.hasDeskFeature(actor, { ...row, status: 'disabled' }, 'catalog').code === 'FORBIDDEN' &&
    access.hasDeskFeature(actor, row, 'demand').code === 'FORBIDDEN' &&
    access.hasDeskFeature({ ok: true, superAdmin: true }, null, 'ship').ok === true
})

/* ───────────── ② 运行时：假库真跑 index.js ───────────── */
const SUPER = 'oa22s5ZcMY7xkQDlNW8X8jaYy46M'
const OID = { buyer: 'oBUYERaaaaaaaaaaaaaaaaaaaa01', buyerOff: 'oBUYERoffaaaaaaaaaaaaaaaaa02', supplier: 'oSUPPLIERaaaaaaaaaaaaaaaaa3', disabled: 'oDISABLEDaaaaaaaaaaaaaaaaa4', manager: 'oMANAGERaaaaaaaaaaaaaaaaaa5', mixed: 'oMIXEDaaaaaaaaaaaaaaaaaaaa6' }

function makeDb(seed) {
  const store = {}
  const writes = []
  let seq = 0
  const opts = { countThrowsFor: 'sku-err' }
  Object.keys(seed).forEach((col) => {
    store[col] = new Map(seed[col].map((d) => [d._id, JSON.parse(JSON.stringify(d))]))
  })
  const colMap = (name) => store[name] || (store[name] = new Map())
  const op = (o, v) => ({ __op: o, v })
  const command = {
    in: (v) => op('in', v), nin: (v) => op('nin', v), gte: (v) => op('gte', v), lte: (v) => op('lte', v),
    neq: (v) => op('neq', v), set: (v) => ({ __set: v }), exists: (v) => op('exists', v)
  }
  const getPath = (doc, path) => path.split('.').reduce((acc, k) => {
    if (acc === undefined || acc === null) return undefined
    if (Array.isArray(acc)) return acc.map((x) => (x == null ? undefined : x[k]))
    return acc[k]
  }, doc)
  const eq = (val, want) => (Array.isArray(val) ? val.some((x) => x === want) : val === want)
  const cond = (val, c) => {
    if (c && c.__op) {
      if (c.__op === 'in') return c.v.some((w) => eq(val, w))
      if (c.__op === 'nin') return !c.v.some((w) => eq(val, w))
      if (c.__op === 'gte') return val >= c.v
      if (c.__op === 'lte') return val <= c.v
      if (c.__op === 'neq') return val !== c.v
      if (c.__op === 'exists') return (val !== undefined) === !!c.v
    }
    return eq(val, c)
  }
  const match = (doc, where) => Object.keys(where || {}).every((k) => cond(getPath(doc, k), where[k]))
  const applyUpdate = (doc, data) => {
    Object.keys(data).forEach((k) => {
      const v = data[k]
      if (v && v.__set !== undefined) doc[k] = JSON.parse(JSON.stringify(v.__set))
      else if (v && typeof v === 'object' && !Array.isArray(v) && !v.__serverDate) {
        // CloudBase 语义：对象值按字段合并，不是整体替换（所以整体替换必须用 _.set）
        doc[k] = doc[k] && typeof doc[k] === 'object' && !Array.isArray(doc[k]) ? { ...doc[k], ...v } : { ...v }
      } else doc[k] = v
    })
  }
  function query(name, where = null, skip = 0, lim = 100) {
    return {
      where: (w) => query(name, w, skip, lim),
      skip: (n) => query(name, where, n, lim),
      limit: (n) => query(name, where, skip, n),
      orderBy: () => query(name, where, skip, lim),
      async get() {
        const rows = [...colMap(name).values()].filter((d) => match(d, where))
        return { data: JSON.parse(JSON.stringify(rows.slice(skip, skip + lim))) }
      },
      async count() {
        if (where && where['items.skuId'] === opts.countThrowsFor) throw new Error('count 超时（注入）')
        return { total: [...colMap(name).values()].filter((d) => match(d, where)).length }
      },
      doc: (id) => ({
        async get() {
          const d = colMap(name).get(id)
          if (!d) throw new Error('document not found')
          return { data: JSON.parse(JSON.stringify(d)) }
        },
        async update({ data }) {
          writes.push({ col: name, op: 'update', id })
          const d = colMap(name).get(id)
          if (!d) throw new Error('document not found')
          applyUpdate(d, data)
          return { stats: { updated: 1 } }
        },
        async remove() {
          writes.push({ col: name, op: 'remove', id })
          colMap(name).delete(id)
          return { stats: { removed: 1 } }
        },
        async set({ data }) {
          writes.push({ col: name, op: 'set', id })
          colMap(name).set(id, { ...data, _id: id })
          return {}
        }
      }),
      async add({ data }) {
        const id = `new_${++seq}`
        writes.push({ col: name, op: 'add', id })
        colMap(name).set(id, { ...data, _id: id })
        return { _id: id }
      }
    }
  }
  const db = { collection: (name) => query(name), command, serverDate: () => ({ __serverDate: true }) }
  return { db, store, writes, opts }
}

const DAY = 24 * 3600 * 1000
const REAL_NOW = Date.now()
function seedData() {
  return {
    staff_members: [
      { _id: 'st_buyer', openid: OID.buyer, name: '令狐采购', roles: ['buyer'], status: 'active' },
      { _id: 'st_off', openid: OID.buyerOff, name: '关账采购', roles: ['channel'], status: 'active', b2bDesk: { features: { statement: false } } },
      { _id: 'st_sup', openid: OID.supplier, name: '云南供货', roles: ['supplier'], status: 'active', supplierId: 'SUP1' },
      { _id: 'st_dis', openid: OID.disabled, name: '停用采购', roles: ['buyer'], status: 'disabled' },
      { _id: 'st_mgr', openid: OID.manager, name: '店长', roles: ['manager'], status: 'active', storeIds: ['store_shanhaizaowu'] },
      { _id: 'st_mix', openid: OID.mixed, name: '兼职', roles: ['staff', 'buyer'], status: 'active', storeIds: ['store_shanhaizaowu'] }
    ],
    purchase_orders: [
      { _id: 'po1', _openid: OID.buyer, source: 'buyer_workbench', orderNo: 'PO1', status: 'shipped', paymentStatus: 'paid', paymentChannel: 'wechat_jsapi', paidFen: 90000, totalAmount: 900, payFen: 90000, items: [{ skuId: 'sku-used', name: '血漪蛱蝶', quantity: 10, unitPrice: 90 }], createdAt: REAL_NOW - 3 * DAY, shippedAt: REAL_NOW - DAY },
      { _id: 'po2', _openid: OID.buyer, source: 'buyer_workbench', orderNo: 'PO2', status: 'submitted', paymentStatus: 'unpaid', totalAmount: 180, payFen: 18000, items: [{ skuId: 'sku-x', name: '天堂凤蝶', quantity: 1, unitPrice: 180 }], createdAt: REAL_NOW - 10 * DAY },
      { _id: 'po3', party: 'supplier_fulfillment', supplierId: 'SUP1', orderNo: 'PO3', status: 'shipped', totalAmount: 500, items: [{ skuId: 'sku-y', name: '原料', quantity: 5 }], createdAt: REAL_NOW - 2 * DAY },
      { _id: 'po4', source: 'store_manager', storeId: 'store_shanhaizaowu', orderNo: 'PO4', status: 'submitted', totalAmount: 66, items: [], createdAt: REAL_NOW - DAY },
      { _id: 'po5', _openid: OID.buyerOff, source: 'buyer_workbench', orderNo: 'PO5', status: 'submitted', totalAmount: 10, items: [], createdAt: REAL_NOW - DAY }
    ],
    fulfillment_shipments: [
      { _id: 'sh1', purchaseOrderId: 'po1', shipmentNo: 'FS1', status: 'shipped', items: [{ skuId: 'sku-used', quantity: 10 }], logistics: { carrier: '顺丰速运', trackingNumber: 'SF998877665544', shipTime: REAL_NOW - DAY } }
    ],
    price_list_items: [
      { _id: 'p1', skuId: 'sku-used', name: '血漪蛱蝶', species: '血漪蛱蝶', packaging: '玻璃罩', price: 90, status: 'active', sort: 1 },
      { _id: 'p2', skuId: 'sku-free', name: '空闲款', species: '样', packaging: '相框', price: { min: 10, max: 20 }, status: 'active', sort: 2 },
      { _id: 'p3', skuId: 'sku-err', name: '查询失败款', species: '样', packaging: '相框', price: 30, status: 'active', sort: 3 }
    ],
    users: [{ _id: 'u_buyer', _openid: OID.buyer, staffRole: 'buyer' }]
  }
}

function bootFn(seed) {
  const fake = makeDb(seed)
  let currentOpenid = ''
  const sdk = {
    DYNAMIC_CURRENT_ENV: 'test',
    init() {},
    database: () => fake.db,
    getWXContext: () => ({ OPENID: currentOpenid })
  }
  const mod = loadCjs(join(ROOT, INDEX_REL), { 'wx-server-sdk': sdk })
  const call = async (openid, event) => {
    currentOpenid = openid
    return mod.main(event)
  }
  return { ...fake, call }
}

const indexSrc = read(INDEX_REL)
const ADMIN_NAMES = [...new Set((indexSrc.match(/\badmin[A-Z]\w+(?=\s*:)/g) || []))]

await ta('admin* 动作全部登记且 ≥ 12 个（清单来自源码，不手抄）', async () => ADMIN_NAMES.length >= 12)
await ta('服务端权限：店长 / 伙伴 / 停用 / 未登录调用任一 admin* → FORBIDDEN 且零写入', async () => {
  const env = bootFn(seedData())
  const bad = []
  for (const who of [OID.manager, OID.buyer, OID.supplier, OID.disabled, OID.mixed, '']) {
    for (const action of ADMIN_NAMES) {
      const r = await env.call(who, { action, id: 'p2', staffId: 'st_buyer', status: 'disabled', data: { skuId: 'hack-1', name: 'x', species: 'x', packaging: 'x', price: 1 }, features: { ship: true } })
      if (!r || r.success !== false || r.code !== 'FORBIDDEN') bad.push(`${who || '未登录'}:${action}`)
    }
  }
  if (env.writes.length) bad.push(`写入 ${env.writes.length} 次`)
  if (bad.length) throw new Error(bad.slice(0, 4).join('、'))
  return true
})
await ta('价目：被引用的 SKU 删除 → 改为停用（文档仍在、status=inactive、无 remove）', async () => {
  const env = bootFn(seedData())
  const r = await env.call(SUPER, { action: 'adminRemovePriceItem', id: 'p1' })
  const doc = env.store.price_list_items.get('p1')
  return r.success && r.retired === true && r.removed === false && !!doc && doc.status === 'inactive' && !!doc.retiredAt &&
    !env.writes.some((w) => w.op === 'remove')
})
await ta('价目：引用查询失败按「有引用」处理（宁可停用不可误删）', async () => {
  const env = bootFn(seedData())
  const r = await env.call(SUPER, { action: 'adminRemovePriceItem', id: 'p3' })
  return r.success && r.retired === true && env.store.price_list_items.has('p3')
})
await ta('价目：无引用才真删', async () => {
  const env = bootFn(seedData())
  const r = await env.call(SUPER, { action: 'adminRemovePriceItem', id: 'p2' })
  return r.success && r.removed === true && !env.store.price_list_items.has('p2')
})
await ta('价目：被引用的 skuId 不可改、重复 skuId 被拒、区间价整体替换（_.set）', async () => {
  const env = bootFn(seedData())
  const base = { name: '血漪蛱蝶', species: '血漪蛱蝶', packaging: '玻璃罩' }
  const locked = await env.call(SUPER, { action: 'adminSavePriceItem', id: 'p1', data: { ...base, skuId: 'sku-renamed', price: 90 } })
  const dup = await env.call(SUPER, { action: 'adminSavePriceItem', data: { ...base, skuId: 'sku-free', price: 1 } })
  const single = await env.call(SUPER, { action: 'adminSavePriceItem', id: 'p2', data: { ...base, skuId: 'sku-free', price: 15 } })
  const p2 = { ...env.store.price_list_items.get('p2') }
  env.store.price_list_items.get('p2').price = { min: 1, max: 2, stale: 1 }
  const ranged = await env.call(SUPER, { action: 'adminSavePriceItem', id: 'p2', data: { ...base, skuId: 'sku-free', price: { min: 5, max: 8 } } })
  const p2r = env.store.price_list_items.get('p2')
  const created = await env.call(SUPER, { action: 'adminSavePriceItem', data: { ...base, skuId: 'sku-new', price: { min: 5, max: 8 } } })
  const n = env.store.price_list_items.get(created.id)
  return locked.code === 'SKU_LOCKED' && dup.code === 'DUP_SKU' && single.success && p2.price === 15 &&
    ranged.success && JSON.stringify(p2r.price) === '{"min":5,"max":8}' &&
    created.success && JSON.stringify(n.price) === '{"min":5,"max":8}' && n.sort === 4
})
await ta('追踪只读：全部读动作对 purchase_orders / fulfillment_shipments 零写入', async () => {
  const env = bootFn(seedData())
  const reads = [
    [SUPER, { action: 'adminDashboard', range: 'all' }],
    [SUPER, { action: 'adminListOrders', scope: 'all' }],
    [SUPER, { action: 'adminGetOrder', id: 'po1' }],
    [SUPER, { action: 'adminListPartners' }],
    [SUPER, { action: 'adminListPriceItems' }],
    [SUPER, { action: 'adminGetPriceItem', id: 'p1' }],
    [SUPER, { action: 'myStatement', partnerStaffId: 'st_buyer' }],
    [OID.buyer, { action: 'myStatement' }],
    [OID.buyer, { action: 'myAccess' }]
  ]
  for (const [who, ev] of reads) {
    const r = await env.call(who, ev)
    if (!r || r.success !== true) throw new Error(`${ev.action} 失败：${r && r.msg}`)
  }
  const bad = env.writes.filter((w) => w.col === 'purchase_orders' || w.col === 'fulfillment_shipments')
  return env.writes.length === 0 && bad.length === 0
})
await ta('订单详情：时间线含运单号、付款节点、货款标签（只读视图）', async () => {
  const env = bootFn(seedData())
  const r = await env.call(SUPER, { action: 'adminGetOrder', id: 'po1' })
  return r.success && r.logistics[0].trackingNo === 'SF998877665544' && r.order.payLabel === '已收款' &&
    r.timeline.find((n) => n.key === 'pay').state === 'done' && r.order.partnerName === '令狐采购'
})
await ta('大盘：已收 = paidFen、待收含未付单、超期 1 单、供货方应付单列', async () => {
  const env = bootFn(seedData())
  const r = await env.call(SUPER, { action: 'adminDashboard', range: 'all' })
  const d = r.dashboard
  return d.money.receivedFen === 90000 && d.money.dueFen === 18000 + 1000 && d.money.overdueCount === 1 &&
    d.payable.amountFen === 50000 && d.orders.count === 4 && r.partnerStats.buyers === 4 && r.partnerStats.disabled === 1
})
await ta('伙伴对账：功能项关 → FEATURE_OFF；停用 → FORBIDDEN；只看得到自己的单', async () => {
  const env = bootFn(seedData())
  const off = await env.call(OID.buyerOff, { action: 'myStatement' })
  const dis = await env.call(OID.disabled, { action: 'myStatement' })
  const mine = await env.call(OID.buyer, { action: 'myStatement' })
  const sup = await env.call(OID.supplier, { action: 'myStatement' })
  const ids = (r) => r.list.map((x) => x._id).sort().join(',')
  return off.code === 'FEATURE_OFF' && dis.success === false && dis.code !== undefined &&
    ids(mine) === 'po1,po2' && ids(sup) === 'po3'
})
await ta('启停：写真库 status，停用后该伙伴所有动作被拒；门店混合角色拒绝在此启停', async () => {
  const env = bootFn(seedData())
  const mgr = await env.call(SUPER, { action: 'adminSetPartnerStatus', staffId: 'st_mgr', status: 'disabled' })
  const mix = await env.call(SUPER, { action: 'adminSetPartnerStatus', staffId: 'st_mix', status: 'disabled' })
  const off = await env.call(SUPER, { action: 'adminSetPartnerStatus', staffId: 'st_buyer', status: 'disabled' })
  const after = await env.call(OID.buyer, { action: 'myAccess' })
  const on = await env.call(SUPER, { action: 'adminSetPartnerStatus', staffId: 'st_buyer', status: 'active' })
  const back = await env.call(OID.buyer, { action: 'myAccess' })
  return mgr.code === 'NOT_B2B' && mix.code === 'MIXED_ROLES' && off.success &&
    env.store.users.get('u_buyer').staffRole === 'buyer' && after.success === false && on.success && back.success === true
})
await ta('功能项保存：整体替换 + 服务端生效（关对账后本人被拒）；supplierId 重复被拒', async () => {
  const env = bootFn(seedData())
  env.store.staff_members.get('st_buyer').b2bDesk = { features: { statement: true }, legacyFlag: true }
  const save = await env.call(SUPER, { action: 'adminSavePartnerAccess', staffId: 'st_buyer', features: { catalog: true, order: true, statement: false } })
  const r = await env.call(OID.buyer, { action: 'myStatement' })
  const acc = await env.call(OID.buyer, { action: 'myAccess' })
  const dupSup = await env.call(SUPER, { action: 'adminSavePartnerAccess', staffId: 'st_sup', supplierId: 'SUP1', features: {} })
  env.store.staff_members.set('st_sup2', { _id: 'st_sup2', openid: 'oSUP2aaaaaaaaaaaaaaaaaaaaaa7', roles: ['supplier'], status: 'active' })
  const dup2 = await env.call(SUPER, { action: 'adminSavePartnerAccess', staffId: 'st_sup2', supplierId: 'SUP1', features: {} })
  const row = env.store.staff_members.get('st_buyer')
  return save.success && r.code === 'FEATURE_OFF' && acc.features.statement === false && acc.features.catalog === true &&
    row.b2bDesk.features.demand === true && row.b2bDesk.legacyFlag === undefined && dupSup.success === true && dup2.code === 'DUP_SUPPLIER_ID'
})

/* ───────────── ③⑤ 页面与接线（静态） ───────────── */
const callsOf = (src) => [...src.matchAll(/callDesk\(\s*['"](\w+)['"]/g)].map((m) => m[1])
const FORBIDDEN_CALLS = /payB2bPurchase|managePurchaseOrder|manageStoreContent|b2bPayCallback/
const DIRECT_DB = /\.collection\(|wx\.cloud\.database/
t('追踪页只读：订单详情只调 adminGetOrder，不直连集合 / 支付 / 内容代理', () => {
  const s = read(ORDER_JS)
  const calls = callsOf(s)
  return calls.length > 0 && calls.every((a) => a === 'adminGetOrder') && !FORBIDDEN_CALLS.test(s) && !DIRECT_DB.test(s)
})
t('伙伴对账页只读：只调 myStatement，不直连集合 / 支付', () => {
  const s = read(STMT_JS)
  const calls = callsOf(s)
  return calls.length > 0 && calls.every((a) => a === 'myStatement') && !FORBIDDEN_CALLS.test(s) && !DIRECT_DB.test(s)
})
t('管理中心 / 伙伴 / 价目页：只经 manageSupplierDesk，不直连集合、不调支付与内容代理', () => {
  return [CENTER_JS, `${PKG}/partner/index.js`, `${PKG}/price-edit/index.js`, API_JS].every((f) => {
    const s = read(f)
    return !FORBIDDEN_CALLS.test(s) && !DIRECT_DB.test(s)
  }) && /name:\s*'manageSupplierDesk'/.test(read(API_JS))
})
t('订单列表在管理中心也只读：center 不调任何订单写动作', () => {
  const calls = callsOf(read(CENTER_JS))
  return calls.includes('adminListOrders') && calls.includes('adminDashboard') && !calls.some((a) => /Order/.test(a) && a !== 'adminListOrders')
})
t('时间线真的渲染（订单页 / 对账页都有 timeline 循环）', () => /wx:for="\{\{timeline\}\}"/.test(read(ORDER_WXML)) && /timeline/.test(read(STMT_WXML)))
t('新分包 b2bdesk 已登记五个页面', () => {
  const app = JSON.parse(read(APP_JSON))
  const sp = (app.subpackages || app.subPackages || []).find((s) => s.root === 'subpackages/b2bdesk')
  const need = ['center/index', 'order/index', 'price-edit/index', 'partner/index', 'statement/index']
  return !!sp && need.every((p) => sp.pages.includes(p))
})
t('磁贴接线：供应商入口跳到管理中心（仍先过 canSeeMenu）', () => {
  const s = read(CFG_REL)
  const i = s.indexOf('goSupplierWorkbenchGuarded() {')
  const body = s.slice(i, s.indexOf('\n  },', i))
  return i > 0 && body.includes('canSeeMenu(') && body.includes('/subpackages/b2bdesk/center/index')
})
t('Hub：对账与物流入口按服务端功能项隐藏（myAccess.features.statement）', () => {
  const s = read(HUB_JS)
  return s.includes("action: 'myAccess'") && /features\.statement/.test(s) && s.includes('/subpackages/b2bdesk/statement/index')
})

if (failures.length) {
  console.error(`✗ supplier-desk：${failures.length} 条失败 / ${passed} 条通过`)
  failures.forEach((f) => console.error(`  - ${f}`))
  process.exit(1)
}
console.log(`✓ supplier-desk：${passed} 条断言全部通过（权限 / 价目 / 只读追踪 / 口径 / 接线）`)

function selftest() {
  const REAL = resolve(HERE, '../..')
  const INJECTS = [
    { name: '管理动作漏过超管门禁', file: INDEX_REL, from: 'const gate = await requireSuperAdmin(openid, ev.adminOpsKey)\n      if (!gate.ok) return gate.res', to: 'const gate = { ok: true, actor: { openid } }', expect: 'FORBIDDEN 且零写入' },
    { name: '门禁只认登录不认超管', file: INDEX_REL, from: 'if (!actor || !actor.ok || !actor.superAdmin) {', to: 'if (!actor || !actor.ok) {', expect: 'FORBIDDEN 且零写入' },
    { name: '被引用仍硬删', file: CORE_REL, from: "return n > 0 ? { mode: 'retire', refCount: n }", to: "return false ? { mode: 'retire', refCount: n }", expect: '改为停用' },
    { name: '引用查询失败当作无引用', file: INDEX_REL, from: "console.warn('manageSupplierDesk refCount', col, e && e.message)\n      return 1", to: "console.warn('manageSupplierDesk refCount', col, e && e.message)\n      return 0", expect: '宁可停用' },
    { name: '被引用的 skuId 允许改', file: INDEX_REL, from: 'if (old.skuId && old.skuId !== data.skuId && (await refCountOf(old.skuId)) > 0) {', to: 'if (false) {', expect: 'skuId 不可改' },
    { name: '区间价不用 _.set（被按字段合并）', file: INDEX_REL, from: "if (out[k] && typeof out[k] === 'object') out[k] = _.set(out[k])", to: '', expect: '区间价整体替换' },
    { name: '详情读路径顺手写了采购单', file: INDEX_REL, from: "  if (!po) return fail('NOT_FOUND', '订单不存在')\n", to: "  if (!po) return fail('NOT_FOUND', '订单不存在')\n  await db.collection(PO_COL).doc(id).update({ data: { viewedAt: now() } })\n", expect: '零写入' },
    { name: '对账不看功能项', file: INDEX_REL, from: '    if (!gate.ok) return fail(gate.code, gate.msg)\n', to: '', expect: 'FEATURE_OFF' },
    { name: '伙伴对账串单（不按本人过滤）', file: INDEX_REL, from: '{ source: core.SOURCE_BUYER, _openid: row.openid }', to: '{ source: core.SOURCE_BUYER }', expect: '只看得到自己的单' },
    { name: '停用只回显不写库', file: INDEX_REL, from: 'data: { status, updateTime: db.serverDate()', to: 'data: { updateTime: db.serverDate()', expect: '启停' },
    { name: '启停不限纯 B2B（误停门店角色）', file: INDEX_REL, from: '  if (!core.isB2bOnlyRoles(roles)) {\n', to: '  if (false) {\n', expect: '混合角色' },
    { name: '功能项保存按字段合并（关不掉）', file: INDEX_REL, from: "b2bDesk: _.set({ features, note, updatedAt: now(), updatedBy: actor.openid || 'admin_web' }),", to: "b2bDesk: { features, note, updatedAt: now(), updatedBy: actor.openid || 'admin_web' },", expect: '整体替换' },
    { name: '发货回传默认开', file: CORE_REL, from: "{ key: 'ship', label: '发货回传', side: 'supplier', def: false,", to: "{ key: 'ship', label: '发货回传', side: 'supplier', def: true,", expect: '默认关' },
    { name: '功能项接受非布尔值', file: CORE_REL, from: 'out[f.key] = src[f.key] === true', to: 'out[f.key] = !!src[f.key]', expect: '非布尔' },
    { name: '按 UTC 取营业日', file: CORE_REL, from: 'const s = new Date(t + TZ_SHANGHAI)\n  return `${s.getUTCFullYear()}', to: 'const s = new Date(t)\n  return `${s.getUTCFullYear()}', expect: '00:30' },
    { name: 'payFen 当成元再乘 100', file: CORE_REL, from: 'if (fen != null && fen > 0) return Math.round(fen)', to: 'if (fen != null && fen > 0) return Math.round(fen * 100)', expect: '金额单位' },
    { name: '验收标记算作已收', file: CORE_REL, from: "if (s === 'marked_paid') return 'marked'", to: "if (s === 'marked_paid') return 'received'", expect: '验收标记' },
    { name: '超期阈值被放宽到 30 天', file: CORE_REL, from: 'const PAY_TERM_DAYS = 7', to: 'const PAY_TERM_DAYS = 30', expect: '超期' },
    { name: '订单详情页调了写动作', file: ORDER_JS, from: "callDesk('adminGetOrder'", to: "callDesk('adminRemovePriceItem', {}); callDesk('adminGetOrder'", expect: '追踪页只读' },
    { name: '对账页直连集合', file: STMT_JS, from: "callDesk('myStatement'", to: "wx.cloud.database().collection('purchase_orders'); callDesk('myStatement'", expect: '对账页只读' },
    { name: '磁贴仍跳旧预览 Hub', file: CFG_REL, from: '/subpackages/b2bdesk/center/index', to: '/subpackages/extra/supplier/index', expect: '磁贴接线' },
    { name: 'Hub 不按功能项隐藏对账', file: HUB_JS, from: 'features.statement', to: 'true', expect: 'Hub' }
  ]
  let ok = true
  const snapshot = new Map(FILES.map((f) => [f, readFileSync(join(REAL, f), 'utf8')]))
  for (const inj of INJECTS) {
    const dir = mkdtempSync(join(tmpdir(), 'supplier-desk-selftest-'))
    try {
      for (const f of FILES) {
        mkdirSync(dirname(join(dir, f)), { recursive: true })
        cpSync(join(REAL, f), join(dir, f))
      }
      const target = join(dir, inj.file)
      let src = readFileSync(target, 'utf8')
      if (!src.includes(inj.from)) throw new Error(`锚点失效：${inj.from.slice(0, 60)}`)
      src = src.split(inj.from).join(inj.to)
      writeFileSync(target, src)
      const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--root', dir], { encoding: 'utf8' })
      const out = `${r.stdout}\n${r.stderr}`
      if (r.status !== 0 && out.includes(inj.expect)) console.log(`  ✓ 注入「${inj.name}」被检出`)
      else {
        ok = false
        console.error(`  ✗ 注入「${inj.name}」未被检出（期望命中「${inj.expect}」）\n${out}`)
      }
    } catch (e) {
      ok = false
      console.error(`  ✗ 注入「${inj.name}」无法施加：${e.message}`)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
  for (const [f, s] of snapshot) {
    if (readFileSync(join(REAL, f), 'utf8') !== s) {
      console.error(`✗ 自检改动了真源码：${f}`)
      process.exit(1)
    }
  }
  if (!ok) process.exit(1)
  console.log(`✓ selftest 通过：${INJECTS.length} 个注入全部被检出；真源码未被改动`)
  process.exit(0)
}
