#!/usr/bin/env node
/**
 * 支付「超时后才付款」与回调 / 客户端确认竞态守卫（2026-10-08 C 流点名修复 A/B/C）
 *
 * 真跑 confirmPayment / payCallback 两个云函数真源（隔离副本 + 桩 wx-server-sdk + 内存库，
 * 每次读写库随机让出 0–3 个事件循环，制造真实交错）。订单：微信 70 + 钱包 30（held）、孤品预占 1 件、锁券、已过期 5 分钟。
 *   S0  两份 fulfillOrder.js 逐字节一致（调用方差异只走 opts）
 *   N1–N3 正常（未过期）：回调先到 / 确认先到 / 全额钱包 —— 行为不变
 *   S1  回调先到 → 确认：paid + paidAfterTimeout，库存只消费一次，钱包不回账
 *   S2  确认先到（AWAITING_CALLBACK）→ 回调：同 S1
 *   S3  回调写完流水号、履约前确认插入：确认按已付款履约，不作废
 *   S4  两路真正并发：
 *       4a 确认刚进超时分支时回调跑完整个履约（原 S4：已付款被覆盖成作废）
 *       4b 超管补履约 × 回调 随机交错 24 轮
 *       4c 全额钱包过期单两次确认 随机交错 12 轮（只能放一次库存、退一次钱包）
 *       4d 确认 × 回调 随机交错 12 轮
 *       回调本次没返回 SUCCESS 时按微信重试再投递一次，再判最终状态
 *       不变式：库存 + 销量 = 1（不多放 / 不多扣）；钱包回账 ≤ 1 且只在作废时；作废则必有退款路径（钱包回账或待人工退款标记）；
 *       已付款不会被改成作废；返回值与最终状态一致；云函数不得抛未捕获异常
 *   S5  定时清扫作废后才付款：确认拒绝、回调写 manualRefundRequired 后返回成功
 *   S6  超管补履约过期单：不抛异常，返回「订单已过期作废，请走退款」，订单作废、库存 / 券释放（语义不变）
 *   S7  全额钱包过期：作废 + 钱包回账 1 次 + 释放库存 / 券
 *
 * 用法：
 *   node miniprogram/scripts/test-pay-timeout-race.mjs                   # 跑工作区代码
 *   node miniprogram/scripts/test-pay-timeout-race.mjs --ref origin/main # 跑某个提交的代码（修复前对照，应判红）
 *   node miniprogram/scripts/test-pay-timeout-race.mjs --selftest        # 在临时副本里逐条注入回归 → 必须检出（不写工作区）
 */
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '../..')
const FN_ROOT = join(ROOT, 'miniprogram/cloudfunctions')
const FNS = ['confirmPayment', 'payCallback']
const require = createRequire(import.meta.url)

const SDK = `
const S = new Proxy({}, { get: (_, k) => global.__PT[k] })
const clone = (x) => JSON.parse(JSON.stringify(x === undefined ? null : x))
const CMD = (op) => (v) => ({ __op: op, v })
async function tick() {
  const n = S.rand ? Math.floor(S.rand() * 4) : 0
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r))
}
function matchOne(doc, cond) {
  if (cond && cond.__op === 'or') return cond.v.some((c) => matchOne(doc, c))
  return Object.keys(cond || {}).every((k) => {
    const want = cond[k]
    const got = k.split('.').reduce((o, p) => (o == null ? undefined : o[p]), doc)
    if (want && want.__op === 'exists') return (got !== undefined) === want.v
    if (want && want.__op === 'in') return want.v.indexOf(got) !== -1
    if (want && want.__op === 'neq') return got !== want.v
    if (want && want.__op === 'gte') return Number(got) >= want.v
    if (want && typeof want === 'object' && want.__op) return true
    return got === want
  })
}
function applyPatch(doc, data) {
  for (const [k, v] of Object.entries(data || {})) {
    const parts = k.split('.')
    let o = doc
    for (const p of parts.slice(0, -1)) o = o[p] = o[p] || {}
    const last = parts[parts.length - 1]
    if (v && v.__op === 'remove') delete o[last]
    else if (v && v.__op === 'inc') o[last] = (o[last] || 0) + v.v
    else if (v && v.__op === 'serverDate') o[last] = new Date().toISOString()
    else if (v && v.__op) o[last] = v.v
    else o[last] = v
  }
}
async function beforeWrite(name, data) {
  if (S.beforeWrite) await S.beforeWrite(name, data)
}
function query(name, conds) {
  const rows = () => (S.db[name] = S.db[name] || []).filter((d) => conds.every((c) => matchOne(d, c)))
  const api = {
    where: (c) => query(name, conds.concat([c])),
    orderBy: () => api, field: () => api, skip: () => api, limit: () => api,
    get: async () => { await tick(); return { data: clone(rows()) } },
    count: async () => { await tick(); return { total: rows().length } },
    update: async ({ data }) => {
      await tick(); await beforeWrite(name, data)
      const r = rows(); r.forEach((d) => applyPatch(d, data)); return { stats: { updated: r.length } }
    },
    remove: async () => ({ stats: { removed: 0 } })
  }
  return api
}
const db = {
  command: { exists: CMD('exists'), in: CMD('in'), neq: CMD('neq'), inc: CMD('inc'), remove: () => ({ __op: 'remove' }), eq: (v) => v, gt: CMD('gt'), gte: CMD('gte'), lt: CMD('lt'), lte: CMD('lte'), and: CMD('and'), or: CMD('or'), set: CMD('set'), push: CMD('push') },
  serverDate: () => ({ __op: 'serverDate' }),
  collection(name) {
    const list = () => (S.db[name] = S.db[name] || [])
    return Object.assign(query(name, []), {
      doc: (id) => ({
        get: async () => { await tick(); const d = list().find((r) => r._id === id); if (!d) throw new Error('document not exists'); return { data: clone(d) } },
        update: async ({ data }) => {
          await tick(); await beforeWrite(name, data)
          const d = list().find((r) => r._id === id); if (d) applyPatch(d, data); return { stats: { updated: d ? 1 : 0 } }
        },
        set: async () => ({}),
        remove: async () => ({})
      }),
      add: async ({ data }) => { await tick(); const _id = name + '_' + (list().length + 1); list().push(Object.assign({ _id }, clone(data))); return { _id } }
    })
  }
}
module.exports = {
  DYNAMIC_CURRENT_ENV: 'x', init() {},
  getWXContext: () => ({ OPENID: S.ctx.openid, SOURCE: S.ctx.source }),
  database: () => db,
  callFunction: async (req) => {
    await tick()
    S.calls.push(req.name + ':' + ((req.data && req.data.action) || ''))
    return S.onCall ? S.onCall(req) : { result: { success: true } }
  },
  cloudPay: { refund: async () => { throw new Error('退款已桩掉') } },
  openapi: new Proxy({}, { get: () => new Proxy({}, { get: () => async () => { throw new Error('openapi 已桩掉') } }) })
}`

// ── 源码装载：工作区或 git 提交 → 临时副本（可注入变异）──
function readSources(ref) {
  const out = {}
  for (const fn of FNS) {
    const files = {}
    if (ref) {
      const list = execFileSync('git', ['ls-tree', '-r', '--name-only', ref, '--', `miniprogram/cloudfunctions/${fn}`], { cwd: ROOT, encoding: 'utf8' })
        .split('\n').filter(Boolean)
      for (const p of list) {
        files[p.slice(`miniprogram/cloudfunctions/${fn}/`.length)] = execFileSync('git', ['show', `${ref}:${p}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 })
      }
    } else {
      const walk = (dir, rel = '') => {
        for (const name of readdirSync(dir)) {
          if (name === 'node_modules' || name.startsWith('.')) continue
          const p = join(dir, name)
          if (statSync(p).isDirectory()) walk(p, rel + name + '/')
          else files[rel + name] = readFileSync(p, 'utf8')
        }
      }
      walk(join(FN_ROOT, fn))
    }
    out[fn] = files
  }
  return out
}

function materialize(sources) {
  const base = mkdtempSync(join(tmpdir(), 'pay-timeout-race-'))
  const mods = {}
  for (const fn of FNS) {
    const dir = join(base, fn)
    for (const [rel, text] of Object.entries(sources[fn])) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true })
      writeFileSync(join(dir, rel), text)
    }
    writeFileSync(join(dir, 'package.json'), '{"type":"commonjs"}')
    mkdirSync(join(dir, 'node_modules/wx-server-sdk'), { recursive: true })
    writeFileSync(join(dir, 'node_modules/wx-server-sdk/index.js'), SDK)
    mods[fn] = require(join(dir, 'index.js'))
  }
  return { base, confirm: mods.confirmPayment, callback: mods.payCallback }
}

// ── 场景 ──
const BUYER = 'buyer_openid_x1'
const TXN = '4200001234567890'
const OUT_TRADE_NO = 'SH20261008TEST01'
const cbEvent = { returnCode: 'SUCCESS', resultCode: 'SUCCESS', outTradeNo: OUT_TRADE_NO, transactionId: TXN, totalFee: 7000 }
const DONE = ['paid', 'paid_awaiting_address', 'ready_pickup', 'shipped', 'received']

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function reset(extra = {}, { expired = true, seed = 0 } = {}) {
  const payExpireTime = new Date(Date.now() + (expired ? -5 : 25) * 60 * 1000).toISOString()
  global.__PT = {
    db: {
      orders: [Object.assign({
        _id: 'o1', _openid: BUYER, orderNo: OUT_TRADE_NO, status: 'pending_pay',
        payExpireTime, totalPrice: 100,
        paymentBreakdown: { wxpayFen: 7000, walletPayFen: 3000 }, walletPaidFen: 3000, walletDebitStatus: 'held',
        stockHeld: true, stockHoldItems: [{ productId: 'p1', skuId: '', count: 1 }],
        products: [{ id: 'p1', title: '孤品标本', count: 1, price: 100 }],
        couponId: 'c1', address: { name: '张三', phone: '13800000000' }
      }, extra)],
      products: [{ _id: 'p1', title: '孤品标本', stock: 0, soldCount: 0 }],
      user_coupons: [{ _id: 'c1', status: 'locked', lockedOrderId: 'o1' }]
    },
    calls: [], ctx: { openid: '', source: '' }, onCall: null, beforeWrite: null,
    rand: seed ? mulberry32(seed) : null
  }
}
const asClient = () => (global.__PT.ctx = { openid: BUYER, source: 'wx_client' })
const asPlatform = () => (global.__PT.ctx = { openid: BUYER, source: '' })

async function safe(fn) {
  try {
    return await fn()
  } catch (e) {
    return { __thrown: String((e && e.message) || e) }
  }
}
function callConfirm(m, event = { orderId: 'o1' }) { asClient(); return safe(() => m.confirm.main(event)) }
function callCallback(m) { asPlatform(); return safe(() => m.callback.main(cbEvent)) }
function callAdmin(m) {
  asPlatform()
  return safe(() => m.confirm.main({ action: 'adminFulfill', adminOpsKey: 'ops-local', orderId: 'o1', transactionId: '4200009999999999' }))
}

function state() {
  const S = global.__PT
  const o = S.db.orders[0]
  return {
    status: o.status,
    paidAfterTimeout: !!o.paidAfterTimeout,
    manual: !!o.manualRefundRequired,
    walletDebitStatus: o.walletDebitStatus,
    stock: S.db.products[0].stock,
    sold: S.db.products[0].soldCount,
    coupon: S.db.user_coupons[0].status,
    walletRefund: S.calls.filter((x) => x === 'manageStoredValue:refundWalletForOrder').length
  }
}

/** 并发不变式：返回问题列表 */
function raceInvariants(st, results, { walletOnly = false } = {}) {
  const p = []
  for (const [name, r] of Object.entries(results)) {
    if (r && r.__thrown) p.push(`${name} 抛出未捕获异常：${r.__thrown}`)
  }
  if (st.stock + st.sold !== 1) p.push(`库存 + 销量 = ${st.stock + st.sold}（应为 1：库存被多放或多扣）`)
  if (st.walletRefund > 1) p.push(`钱包回账 ${st.walletRefund} 次（重复退钱包）`)
  if (DONE.includes(st.status)) {
    if (st.sold !== 1 || st.stock !== 0) p.push(`已付款但库存 ${st.stock} / 销量 ${st.sold}`)
    if (st.walletRefund) p.push('已付款却回账了钱包')
    if (st.coupon !== 'used') p.push(`已付款但券为 ${st.coupon}`)
    if (st.manual) p.push('已付款却打了待人工退款标记')
  } else if (st.status === 'void') {
    if (st.sold !== 0 || st.stock !== 1) p.push(`已作废但库存 ${st.stock} / 销量 ${st.sold}（已履约的单被覆盖成作废？）`)
    if (st.coupon !== 'unused') p.push(`已作废但券为 ${st.coupon}`)
    if (st.walletRefund !== 1) p.push(`已作废但钱包回账 ${st.walletRefund} 次（应恰好 1 次）`)
    if (!walletOnly && !st.manual) p.push('已作废、微信已收款，却没有待人工退款标记')
  } else {
    p.push(`最终状态 ${st.status}（应收束为已付款或作废）`)
  }
  for (const [name, r] of Object.entries(results)) {
    if (!r || r.__thrown) continue
    if (r.code === 'ORDER_EXPIRED_VOID' && st.status !== 'void') p.push(`${name} 返回「已过期作废」但订单实为 ${st.status}`)
    if (r.success === true && !r.manualRefundRequired && r.errcode === undefined && st.status === 'void') {
      p.push(`${name} 返回成功但订单实为作废`)
    }
  }
  return p
}

function paidOk(st, { afterTimeout }) {
  const p = []
  if (st.status !== 'paid') p.push(`状态 ${st.status}（应 paid）`)
  if (st.paidAfterTimeout !== afterTimeout) p.push(`paidAfterTimeout=${st.paidAfterTimeout}（应 ${afterTimeout}）`)
  if (st.stock !== 0 || st.sold !== 1) p.push(`库存 ${st.stock} / 销量 ${st.sold}（应 0 / 1）`)
  if (st.coupon !== 'used') p.push(`券 ${st.coupon}（应 used）`)
  if (st.walletRefund) p.push(`钱包回账 ${st.walletRefund} 次（应 0）`)
  if (st.manual) p.push('不应有待人工退款标记')
  return p
}
function voidOk(st, { walletRefund, manual, stock = 1, coupon = 'unused' }) {
  const p = []
  if (st.status !== 'void') p.push(`状态 ${st.status}（应 void）`)
  if (st.stock !== stock || st.sold !== 0) p.push(`库存 ${st.stock} / 销量 ${st.sold}（应 ${stock} / 0）`)
  if (st.coupon !== coupon) p.push(`券 ${st.coupon}（应 ${coupon}）`)
  if (st.walletRefund !== walletRefund) p.push(`钱包回账 ${st.walletRefund} 次（应 ${walletRefund}）`)
  if (st.manual !== manual) p.push(`待人工退款标记 ${st.manual}（应 ${manual}）`)
  return p
}
const thrown = (label, r) => (r && r.__thrown ? [`${label} 抛出未捕获异常：${r.__thrown}`] : [])

async function runAll(m, sources) {
  const results = []
  const rec = (id, problems) => results.push({ id, problems })

  // S0
  rec('S0 两份 fulfillOrder.js 逐字节一致',
    sources.confirmPayment['fulfillOrder.js'] === sources.payCallback['fulfillOrder.js'] ? [] : ['confirmPayment/fulfillOrder.js 与 payCallback/fulfillOrder.js 不一致'])

  // N1 正常：回调先到 → 确认
  reset({}, { expired: false })
  { const a = await callCallback(m); const b = await callConfirm(m)
    rec('N1 正常付款·回调先到', [...thrown('回调', a), ...thrown('确认', b), ...paidOk(state(), { afterTimeout: false }),
      ...(a.errcode === 0 ? [] : [`回调返回 ${JSON.stringify(a)}`]), ...(b.alreadyPaid ? [] : [`确认应 alreadyPaid，实为 ${JSON.stringify(b)}`])]) }

  // N2 正常：确认先到 → 回调
  reset({}, { expired: false })
  { const a = await callConfirm(m); const b = await callCallback(m)
    rec('N2 正常付款·确认先到', [...thrown('确认', a), ...thrown('回调', b), ...paidOk(state(), { afterTimeout: false }),
      ...(a.code === 'AWAITING_CALLBACK' ? [] : [`确认应 AWAITING_CALLBACK，实为 ${JSON.stringify(a)}`])]) }

  // N3 正常：全额钱包
  reset({ wxPayMode: 'wallet', walletPaidFen: 10000, paymentBreakdown: { wxpayFen: 0, walletPayFen: 10000 } }, { expired: false })
  { const a = await callConfirm(m); const st = state()
    rec('N3 正常付款·全额钱包', [...thrown('确认', a), ...paidOk(st, { afterTimeout: false }),
      ...(a.success ? [] : [`确认返回 ${JSON.stringify(a)}`]), ...(st.walletDebitStatus === 'consumed' ? [] : [`walletDebitStatus=${st.walletDebitStatus}（应 consumed）`])]) }

  // S1
  reset()
  { const a = await callCallback(m); const b = await callConfirm(m)
    rec('S1 过期·回调先到 → 确认', [...thrown('回调', a), ...thrown('确认', b), ...paidOk(state(), { afterTimeout: true }),
      ...(b.alreadyPaid ? [] : [`确认应 alreadyPaid，实为 ${JSON.stringify(b)}`])]) }

  // S2
  reset()
  { const a = await callConfirm(m); const b = await callCallback(m)
    rec('S2 过期·确认先到 → 回调', [...thrown('确认', a), ...thrown('回调', b), ...paidOk(state(), { afterTimeout: true }),
      ...(a.code === 'AWAITING_CALLBACK' ? [] : [`确认应 AWAITING_CALLBACK，实为 ${JSON.stringify(a)}`])]) }

  // S3：回调已写流水号、履约未开始 → 确认插入 → 回调继续
  reset({ wxTransactionId: TXN, wxPayMode: 'wechat' })
  { const a = await callConfirm(m); const b = await callCallback(m)
    rec('S3 过期·回调写流水号后确认插入', [...thrown('确认', a), ...thrown('回调', b), ...paidOk(state(), { afterTimeout: true }),
      ...(a.success ? [] : [`确认应按已付款履约，实为 ${JSON.stringify(a)}`])]) }

  // S4a：确认一旦要做超时作废的任何副作用（回账钱包 / 写 void），先让回调完整跑完
  reset({ wxTransactionId: TXN, wxPayMode: 'wechat' })
  {
    let inner = null
    let firing = false
    const fireCallback = async () => {
      if (inner || firing) return
      firing = true
      const saved = global.__PT.ctx
      inner = await callCallback(m)
      global.__PT.ctx = saved
    }
    global.__PT.onCall = async (req) => {
      if (req.name === 'manageStoredValue') await fireCallback()
      return { result: { success: true } }
    }
    global.__PT.beforeWrite = async (name, data) => {
      if (name === 'orders' && data && data.status === 'void') await fireCallback()
    }
    const a = await callConfirm(m)
    global.__PT.onCall = null
    global.__PT.beforeWrite = null
    if (!inner) inner = await callCallback(m)
    rec('S4a 并发·确认进超时分支时回调完成履约', raceInvariants(state(), { 确认: a, 回调: inner }))
  }

  // S4b–4d：随机交错
  const fuzz = async (id, rounds, seed0, setup, runners, opts) => {
    const problems = []
    for (let i = 0; i < rounds; i++) {
      setup(seed0 + i)
      const entries = Object.entries(runners)
      const rs = await Promise.all(entries.map(([, fn]) => fn()))
      const named = Object.fromEntries(entries.map(([k], j) => [k, rs[j]]))
      // 回调没拿到 SUCCESS 时微信会重试（抢 fulfilling 输给另一路作废时本次返回 -1，重试才写待人工退款标记）
      if (named.回调 && !named.回调.__thrown && named.回调.errcode !== 0) {
        global.__PT.rand = null
        named.回调 = await callCallback(m)
      }
      const p = raceInvariants(state(), named, opts)
      if (p.length) { problems.push(`第 ${i + 1} 轮（seed ${seed0 + i}）：${p.join('；')}`); if (problems.length >= 3) break }
    }
    rec(id, problems)
  }
  await fuzz('S4b 并发·超管补履约 × 回调（24 轮随机交错）', 24, 1000,
    (s) => reset({ walletPaidFen: 3000 }, { seed: s }), { 超管: () => callAdmin(m), 回调: () => callCallback(m) })
  await fuzz('S4c 并发·全额钱包过期单两次确认（12 轮随机交错）', 12, 2000,
    (s) => reset({ wxPayMode: 'wallet', walletPaidFen: 10000, paymentBreakdown: { wxpayFen: 0, walletPayFen: 10000 } }, { seed: s }),
    { 确认1: () => callConfirm(m), 确认2: () => callConfirm(m) }, { walletOnly: true })
  await fuzz('S4d 并发·确认 × 回调（12 轮随机交错）', 12, 3000,
    (s) => reset({}, { seed: s }), { 确认: () => callConfirm(m), 回调: () => callCallback(m) })

  // S5
  reset({ status: 'void', cancelReason: 'expired_sweep', stockHoldReleased: true, walletDebitStatus: 'refunded' })
  global.__PT.db.products[0].stock = 1
  global.__PT.db.user_coupons[0] = { _id: 'c1', status: 'unused' }
  { const a = await callConfirm(m); const b = await callCallback(m)
    rec('S5 清扫作废后才付款', [...thrown('确认', a), ...thrown('回调', b), ...voidOk(state(), { walletRefund: 0, manual: true }),
      ...(a.success === false ? [] : [`确认应拒绝，实为 ${JSON.stringify(a)}`]), ...(b.errcode === 0 ? [] : [`回调应 SUCCESS（停止微信重试），实为 ${JSON.stringify(b)}`])]) }

  // S6
  reset({ walletPaidFen: 0, walletDebitStatus: '', paymentBreakdown: { wxpayFen: 10000 } })
  { const a = await callAdmin(m)
    rec('S6 超管补履约过期单', [...thrown('补履约', a), ...voidOk(state(), { walletRefund: 0, manual: false }),
      ...(a.__thrown || (a.success === false && /请走退款/.test(a.msg || '')) ? [] : [`应返回「订单已过期作废，请走退款」，实为 ${JSON.stringify(a)}`])]) }

  // S7
  reset({ wxPayMode: 'wallet', walletPaidFen: 10000, paymentBreakdown: { wxpayFen: 0, walletPayFen: 10000 } })
  { const a = await callConfirm(m)
    rec('S7 全额钱包过期', [...thrown('确认', a), ...voidOk(state(), { walletRefund: 1, manual: false }),
      ...(a.success === false && /超时/.test(a.msg || '') ? [] : [`确认应返回超时失败，实为 ${JSON.stringify(a)}`])]) }

  return results
}

async function runOnce(sources) {
  const realSetTimeout = global.setTimeout
  global.setTimeout = (fn, ms, ...args) => realSetTimeout(fn, Math.ceil((Number(ms) || 0) / 35), ...args)
  const realWarn = console.warn
  const realErr = console.error
  const realLog = console.log
  console.warn = () => {}
  console.error = () => {}
  console.log = () => {}
  const m = materialize(sources)
  try {
    return await runAll(m, sources)
  } finally {
    console.warn = realWarn
    console.error = realErr
    console.log = realLog
    global.setTimeout = realSetTimeout
    rmSync(m.base, { recursive: true, force: true })
  }
}

Object.assign(process.env, { WX_PAY_SUB_MCH_ID: '1234567890', ADMIN_OPS_KEY: 'ops-local', STORED_VALUE_CALLBACK_KEY: 'local-key' })
delete process.env.ALLOW_MOCK_PAY

// ── 自检：在内存源码上注入回归（不写工作区）──
const BOTH = ['confirmPayment', 'payCallback']
const MUTATIONS = [
  { name: 'B 回退：超时作废改回无条件写', files: BOTH, file: 'fulfillOrder.js',
    from: "const res = await db.collection('orders').where({\n    _id: orderId,\n    status: 'pending_pay'\n  }).update({\n    data: {\n      status: 'void',",
    to: "const res = await db.collection('orders').doc(orderId).update({\n    data: {\n      status: 'void'," },
  { name: 'B 回退：作废前先用旧快照放库存 / 退钱包', files: BOTH, file: 'fulfillOrder.js',
    from: "async function claimPayTimeoutVoid(db, _, orderId) {\n",
    to: "async function claimPayTimeoutVoid(db, _, orderId) {\n  { const pre = (await db.collection('orders').doc(orderId).get()).data; await releaseHeldWalletOnPayTimeout(orderId, pre); await releaseOrderStockHold(db, _, { ...pre, _id: orderId }) }\n" },
  { name: 'B 回退：条件没命中不重读最新状态，直接报超时', files: BOTH, file: 'fulfillOrder.js',
    from: "if (depth >= 2) throw new Error('订单状态不可支付')", to: "throw new Error('订单已超时，请重新下单')" },
  { name: 'A 回退：超时不看微信流水号', files: BOTH, file: 'fulfillOrder.js',
    from: "const paidEvidence = honorPaidEvidence ? String(order.wxTransactionId || '').trim() : ''", to: "const paidEvidence = ''" },
  { name: 'A 回退：作废后到账不写待人工退款标记', files: BOTH, file: 'fulfillOrder.js',
    from: 'if (evidence) {', to: 'if (false) {' },
  { name: 'A 回退：两份 fulfillOrder.js 不再一致', files: ['confirmPayment'], file: 'fulfillOrder.js',
    from: 'postCommissionForOrder(db, _, latest, { source })', to: "postCommissionForOrder(db, _, latest, { source: 'confirmPayment' })" },
  { name: 'C 回退：超管补履约不捕获异常', files: ['confirmPayment'], file: 'index.js',
    from: "  } catch (e) {\n    const msg = String((e && e.message) || e || '')", to: "  } catch (e) {\n    throw e\n    const msg = String((e && e.message) || e || '')" },
  { name: 'C 语义：超管补履约改成按流水号强制履约过期单', files: ['confirmPayment'], file: 'index.js',
    from: 'honorPaidEvidenceOnTimeout: false', to: 'honorPaidEvidenceOnTimeout: true' }
]

function report(results) {
  let bad = 0
  for (const r of results) {
    if (r.problems.length) {
      bad += 1
      console.log(`✗ ${r.id}`)
      for (const p of r.problems) console.log(`    · ${p}`)
    } else {
      console.log(`✓ ${r.id}`)
    }
  }
  return bad
}

async function main() {
  const t0 = Date.now()
  const refIdx = process.argv.indexOf('--ref')
  const ref = refIdx > -1 ? process.argv[refIdx + 1] : ''
  const sources = readSources(ref)

  if (process.argv.includes('--selftest')) {
    const base = await runOnce(sources)
    if (base.some((r) => r.problems.length)) {
      report(base)
      console.error('✗ selftest 前置：基线本身不通过')
      process.exit(1)
    }
    let missed = 0
    for (const mu of MUTATIONS) {
      const mutated = JSON.parse(JSON.stringify(sources))
      let anchored = true
      for (const fn of mu.files) {
        const src = mutated[fn][mu.file]
        if (!src || src.indexOf(mu.from) === -1) { anchored = false; break }
        mutated[fn][mu.file] = src.replace(mu.from, mu.to)
      }
      if (!anchored) { missed += 1; console.log(`✗ 注入锚点失配：${mu.name}`); continue }
      const res = await runOnce(mutated)
      const hit = res.filter((r) => r.problems.length).map((r) => r.id.split(' ')[0])
      if (hit.length) console.log(`✓ ${mu.name} → 检出（${hit.join(' / ')}）`)
      else { missed += 1; console.log(`✗ ${mu.name} → 未检出`) }
    }
    if (missed) {
      console.error(`✗ selftest：${missed}/${MUTATIONS.length} 条注入未检出`)
      process.exit(1)
    }
    console.log(`✓ selftest：${MUTATIONS.length} 条回归注入全部检出（内存源码注入，未写工作区；${Date.now() - t0}ms）`)
    return
  }

  const results = await runOnce(sources)
  const bad = report(results)
  const label = ref ? `提交 ${ref}` : '工作区'
  if (bad) {
    console.error(`\n✗ test:pay-timeout-race（${label}）：${bad}/${results.length} 个场景不通过（${Date.now() - t0}ms）`)
    process.exit(1)
  }
  console.log(`\n✓ test:pay-timeout-race（${label}）：${results.length} 个场景全部通过（${Date.now() - t0}ms）`)
}

main().catch((e) => {
  console.error('✗ test:pay-timeout-race 运行异常：', e)
  process.exit(1)
})
