#!/usr/bin/env node
/**
 * B2B 采购单支付安全守卫（供应商工作台 · 2026-09-28 修 R1–R8）
 *
 * 真跑云函数真源（mock wx-server-sdk + 内存库），不看注释、不猜结构：
 *   R1  规则文件：purchase_orders / price_list_items 客户端不可写；读仅 ERP 匿名 或 本人
 *       小程序 supplier 分包不得直连写 purchase_orders；manageStoreContent 对两集合仅超管、禁写支付字段
 *   R2  服务端按 price_list_items 重算金额：客户端 payFen/unitPrice 不采信；单内金额与现价不一致 → PRICE_CHANGED 且不下单
 *   R3  回调：returnCode/resultCode 缺失即失败；核对 totalFee；记录 transactionId；写库异常返回非 0；并发回调只处理一次
 *   R4  发起支付 / 待对公：归属人 + 采购类角色；无归属人的单拒绝
 *   R5  回调能匹配该单历次商户单号
 *   R6  超管查单补记：金额一致才标已付，否则 pay_review
 *   R7  区间价 → quote_required，不可在线支付
 *   R8  退款：仅超管 + 回填单号二次确认 + 原因必填 + 记录操作人 + 重试沿用退款单号
 *
 * 用法：
 *   node miniprogram/scripts/test-b2b-pay.mjs
 *   node miniprogram/scripts/test-b2b-pay.mjs --selftest   # 逐条内存注入回归 → 必须检出（不写盘）
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadCjsModule } from './lib/cjs-loader.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '../..')
const FN = (name) => join(ROOT, 'miniprogram/cloudfunctions', name, 'index.js')
const PAY_FN = FN('payB2bPurchase')
const CB_FN = FN('b2bPayCallback')
const SC_FN = FN('manageStoreContent')
const RULE_PO = join(ROOT, 'cloudbase/rules/purchase_orders.json')
const RULE_PRICE = join(ROOT, 'cloudbase/rules/price_list_items.json')
const SUPPLIER_DIR = join(ROOT, 'miniprogram/subpackages/extra/supplier')
const B2B_FULFILL = join(ROOT, 'admin/src/utils/b2bFulfillment.js')
const PO_VIEW = join(ROOT, 'admin/src/components/PurchaseOrders.vue')

const SUPER = 'oa22s5ZcMY7xkQDlNW8X8jaYy46M'
const OPS_KEY = 'test-ops-key-b2b'
const SUB_MCH = '1900000109'

// ———————————————————————— 内存库 ————————————————————————

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))
const tick = () => new Promise((r) => setImmediate(r))

function getPath(obj, path) {
  return String(path).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj)
}
function setPath(obj, path, val) {
  const keys = String(path).split('.')
  let o = obj
  for (let i = 0; i < keys.length - 1; i++) {
    if (o[keys[i]] == null || typeof o[keys[i]] !== 'object') o[keys[i]] = {}
    o = o[keys[i]]
  }
  o[keys[keys.length - 1]] = val
}

function createDb() {
  const store = {}
  const state = { failOnce: null, paidWrites: 0, seq: 0 }
  const rows = (name) => (store[name] = store[name] || [])
  const command = {
    in: (arr) => ({ $op: 'in', arr }),
    nin: (arr) => ({ $op: 'nin', arr }),
    neq: (v) => ({ $op: 'neq', v }),
    push: (arr) => ({ $op: 'push', arr })
  }
  function maybeFail(op) {
    if (state.failOnce && state.failOnce(op)) {
      state.failOnce = null
      throw new Error(`mock db failure on ${op}`)
    }
  }
  function match(doc, where) {
    for (const [k, cond] of Object.entries(where || {})) {
      const val = getPath(doc, k)
      if (cond && typeof cond === 'object' && cond.$op) {
        if (cond.$op === 'in' && cond.arr.indexOf(val) === -1) return false
        if (cond.$op === 'nin' && cond.arr.indexOf(val) !== -1) return false
        if (cond.$op === 'neq' && val === cond.v) return false
      } else if (Array.isArray(val)) {
        if (val.indexOf(cond) === -1) return false
      } else if (val !== cond) return false
    }
    return true
  }
  function applyUpdate(doc, data) {
    for (const [k, v] of Object.entries(data || {})) {
      if (v && typeof v === 'object' && v.$op === 'push') {
        setPath(doc, k, (getPath(doc, k) || []).concat(v.arr))
      } else setPath(doc, k, clone(v))
    }
    if (data && data.paymentStatus === 'paid') state.paidWrites++
  }
  function query(name, where) {
    const q = { _skip: 0, _limit: 100 }
    q.orderBy = () => q
    q.skip = (n) => ((q._skip = n), q)
    q.limit = (n) => ((q._limit = n), q)
    q.get = async () => {
      await tick()
      maybeFail(`${name}.get`)
      const data = rows(name).filter((d) => match(d, where)).slice(q._skip, q._skip + q._limit)
      return { data: clone(data) }
    }
    q.update = async ({ data }) => {
      await tick()
      maybeFail(`${name}.update`)
      const hit = rows(name).filter((d) => match(d, where))
      hit.forEach((d) => applyUpdate(d, data))
      return { stats: { updated: hit.length } }
    }
    q.count = async () => ({ total: rows(name).filter((d) => match(d, where)).length })
    return q
  }
  const db = {
    command,
    serverDate: () => new Date(),
    collection(name) {
      const base = query(name, null)
      return {
        ...base,
        where: (w) => query(name, w),
        doc: (id) => ({
          async get() {
            await tick()
            maybeFail(`${name}.doc.get`)
            const d = rows(name).find((x) => x._id === id)
            if (!d) throw new Error('document.get:fail document not exists')
            return { data: clone(d) }
          },
          async update({ data }) {
            await tick()
            maybeFail(`${name}.doc.update`)
            const d = rows(name).find((x) => x._id === id)
            if (d) applyUpdate(d, data)
            return { stats: { updated: d ? 1 : 0 } }
          },
          async remove() {
            await tick()
            const list = rows(name)
            const i = list.findIndex((x) => x._id === id)
            if (i !== -1) list.splice(i, 1)
            return { stats: { removed: i !== -1 ? 1 : 0 } }
          },
          async set({ data }) {
            await tick()
            const list = rows(name)
            const i = list.findIndex((x) => x._id === id)
            const doc = { ...clone(data), _id: id }
            if (i === -1) list.push(doc)
            else list[i] = doc
            return { stats: { updated: 1 } }
          }
        }),
        async add({ data }) {
          await tick()
          maybeFail(`${name}.add`)
          const _id = `${name}_${++state.seq}`
          rows(name).push({ ...clone(data), _id })
          return { _id }
        }
      }
    }
  }
  return { db, store, state, rows }
}

function createCloud(db) {
  const ctx = { OPENID: '', SOURCE: '' }
  const calls = []
  const pay = {
    unifiedOrder: async () => ({
      returnCode: 'SUCCESS',
      resultCode: 'SUCCESS',
      payment: { timeStamp: '1', nonceStr: 'n', package: 'prepay_id=wx2026092800001', paySign: 's', signType: 'MD5' }
    }),
    queryOrder: async () => ({ returnCode: 'SUCCESS', resultCode: 'SUCCESS', tradeState: 'NOTPAY' }),
    refund: async () => ({ returnCode: 'SUCCESS', resultCode: 'SUCCESS', refundId: 'R1' })
  }
  const cloud = {
    DYNAMIC_CURRENT_ENV: 'test-env',
    init() {},
    database: () => db,
    getWXContext: () => ({ ...ctx }),
    cloudPay: {
      unifiedOrder: (p) => (calls.push(['unifiedOrder', p]), pay.unifiedOrder(p)),
      queryOrder: (p) => (calls.push(['queryOrder', p]), pay.queryOrder(p)),
      refund: (p) => (calls.push(['refund', p]), pay.refund(p))
    }
  }
  return { cloud, ctx, calls, pay }
}

function seed(rows) {
  rows('price_list_items').push(
    { _id: 'p1', skuId: 'SKU-A', name: '蓝闪蝶', price: 120, status: 'active' },
    { _id: 'p2', skuId: 'SKU-R', name: '区间价', price: { min: 80, max: 150 }, status: 'active' },
    { _id: 'p3', skuId: 'SKU-OFF', name: '下架', price: 50, status: 'inactive' }
  )
  rows('staff_members').push(
    { _id: 's1', openid: 'buyer1', status: 'active', roles: ['buyer'], name: '采购甲' },
    { _id: 's2', openid: 'buyer2', status: 'active', roles: ['buyer'], name: '采购乙' },
    { _id: 's3', openid: 'mgr1', status: 'active', roles: ['manager'], name: '店长' },
    { _id: 's4', openid: 'sup1', status: 'active', roles: ['supplier'], supplierId: 'SUP-1', name: '供货方' }
  )
  rows('purchase_orders').push(
    { _id: 'po_noowner', orderNo: 'PO-NOOWNER', source: 'buyer_workbench', paymentStatus: 'unpaid', items: [{ skuId: 'SKU-A', quantity: 1 }], payFen: 12000 },
    { _id: 'po_sup_a', orderNo: 'PO-SUPA', party: 'supplier_fulfillment', supplierId: 'SUP-1', status: 'submitted', items: [] },
    { _id: 'po_sup_b', orderNo: 'PO-SUPB', party: 'supplier_fulfillment', supplierId: 'SUP-2', status: 'submitted', items: [] }
  )
}

// ———————————————————————— 行为用例 ————————————————————————

async function runBehavior(transform) {
  const failures = []
  const check = (id, ok, detail) => {
    if (!ok) failures.push(`${id}${detail ? ` · ${detail}` : ''}`)
  }
  const prevEnv = { sub: process.env.WX_PAY_SUB_MCH_ID, ops: process.env.ADMIN_OPS_KEY, mock: process.env.ALLOW_MOCK_PAY }
  process.env.WX_PAY_SUB_MCH_ID = SUB_MCH
  process.env.ADMIN_OPS_KEY = OPS_KEY
  delete process.env.ALLOW_MOCK_PAY
  const quiet = { log: console.log, warn: console.warn, error: console.error }
  console.log = console.warn = console.error = () => {}
  try {
    const { db, rows, state } = createDb()
    seed(rows)
    const { cloud, ctx, calls, pay } = createCloud(db)
    const stubs = { 'wx-server-sdk': cloud }
    const payFn = loadCjsModule(PAY_FN, { stubs, transform })
    const cbFn = loadCjsModule(CB_FN, { stubs, transform })
    const scFn = loadCjsModule(SC_FN, { stubs, transform })
    const as = (openid) => {
      ctx.OPENID = openid
      ctx.SOURCE = openid ? 'wx_client' : ''
    }
    const callPay = (openid, ev) => (as(openid), payFn.main(ev))
    const callCb = (ev) => (as(''), cbFn.main(ev))
    const po = (id) => rows('purchase_orders').find((d) => d._id === id)
    const unifiedCount = () => calls.filter((c) => c[0] === 'unifiedOrder').length

    // —— R1/R2 建单：客户端价格不采信 ——
    const c1 = await callPay('buyer1', {
      action: 'create',
      contactName: '甲',
      payFen: 1,
      totalAmount: 0.01,
      items: [{ skuId: 'SKU-A', quantity: 2, unitPrice: 0.01, name: '伪造' }]
    })
    check('R2.create-server-price', c1.success && c1.payFen === 24000 && po(c1._id) && po(c1._id).payFen === 24000,
      `payFen=${c1.payFen}`)
    check('R2.create-item-price', c1.success && po(c1._id).items[0].unitPrice === 120)
    check('R4.create-owner', c1.success && po(c1._id)._openid === 'buyer1' && po(c1._id).buyerOpenid === 'buyer1')

    const c2 = await callPay('mgr1', { action: 'create', contactName: '店长', items: [{ skuId: 'SKU-A', quantity: 1 }] })
    check('R4.create-needs-buyer-role', !c2.success && c2.code === 'NOT_BUYER', c2.code)

    const c3 = await callPay('buyer1', { action: 'create', contactName: '甲', items: [{ skuId: 'SKU-OFF', quantity: 1 }] })
    check('R2.create-reject-inactive', !c3.success && c3.code === 'ITEM_UNAVAILABLE', c3.code)

    // —— R7 区间价 ——
    const c4 = await callPay('buyer1', { action: 'create', contactName: '甲', items: [{ skuId: 'SKU-R', quantity: 1 }] })
    check('R7.range-quote-required', c4.success && c4.pricingMode === 'quote_required' && c4.payFen == null,
      `mode=${c4.pricingMode} fen=${c4.payFen}`)
    const before4 = unifiedCount()
    const p4 = await callPay('buyer1', { action: 'pay', purchaseOrderId: c4._id })
    check('R7.range-no-online-pay', !p4.success && p4.code === 'QUOTE_REQUIRED' && unifiedCount() === before4, p4.code)

    // —— R4 归属 / 角色 ——
    const beforeOther = unifiedCount()
    const p5 = await callPay('buyer2', { action: 'pay', purchaseOrderId: c1._id })
    check('R4.pay-other-owner-denied', !p5.success && p5.code === 'FORBIDDEN' && unifiedCount() === beforeOther, p5.code)
    const p6 = await callPay('buyer1', { action: 'pay', purchaseOrderId: 'po_noowner' })
    check('R4.pay-no-owner-denied', !p6.success && p6.code === 'NO_OWNER', p6.code)
    const o1 = await callPay('buyer2', { action: 'markOfflinePending', purchaseOrderId: c1._id })
    check('R4.offline-other-owner-denied', !o1.success && po(c1._id).paymentStatus === 'unpaid', o1.code)

    // —— R2 单内金额被篡改 / 价目调整 → PRICE_CHANGED，不下单 ——
    po(c1._id).payFen = 1
    const beforeTamper = unifiedCount()
    const p7 = await callPay('buyer1', { action: 'pay', purchaseOrderId: c1._id })
    check('R2.pay-reprice-reject', !p7.success && p7.code === 'PRICE_CHANGED' && unifiedCount() === beforeTamper, p7.code)
    check('R2.pay-reprice-writeback', po(c1._id).payFen === 24000, `payFen=${po(c1._id).payFen}`)

    // —— 正常支付：totalFee = 服务端金额，attach = 单 id，历次单号累积（R5） ——
    const p8 = await callPay('buyer1', { action: 'pay', purchaseOrderId: c1._id })
    const u8 = calls.filter((c) => c[0] === 'unifiedOrder').pop()
    check('R2.pay-total-fee', p8.success && u8 && u8[1].totalFee === 24000 && u8[1].attach === c1._id,
      u8 ? `totalFee=${u8[1].totalFee}` : 'no unifiedOrder')
    const firstTrade = p8.outTradeNo
    const p9 = await callPay('buyer1', { action: 'pay', purchaseOrderId: c1._id })
    check('R5.trade-nos-accumulate', p9.success && (po(c1._id).payOutTradeNos || []).length === 2 &&
      po(c1._id).payOutTradeNos.indexOf(firstTrade) !== -1)

    // —— R4 角色被撤销后不可支付 ——
    rows('staff_members').find((s) => s.openid === 'buyer1').roles = ['staff']
    const p10 = await callPay('buyer1', { action: 'pay', purchaseOrderId: c1._id })
    check('R4.pay-needs-buyer-role', !p10.success && p10.code === 'NOT_BUYER', p10.code)
    rows('staff_members').find((s) => s.openid === 'buyer1').roles = ['buyer']

    // —— 下单失败回滚 ——
    const c11 = await callPay('buyer1', { action: 'create', contactName: '甲', items: [{ skuId: 'SKU-A', quantity: 1 }] })
    const savedUnified = pay.unifiedOrder
    pay.unifiedOrder = async () => ({ returnCode: 'FAIL', returnMsg: '商户号未开通' })
    const p11 = await callPay('buyer1', { action: 'pay', purchaseOrderId: c11._id })
    pay.unifiedOrder = savedUnified
    check('pay.fail-rollback', !p11.success && po(c11._id).paymentStatus === 'unpaid', po(c11._id).paymentStatus)

    // —— R3/R5 回调 ——
    const cbBase = { returnCode: 'SUCCESS', resultCode: 'SUCCESS', totalFee: 24000, transactionId: 'TX-1' }
    const r0 = await (async () => {
      ctx.OPENID = 'buyer1'
      ctx.SOURCE = 'wx_client'
      return cbFn.main({ ...cbBase, outTradeNo: firstTrade })
    })()
    check('R3.cb-reject-client', r0.errmsg === 'IGNORED' && po(c1._id).paymentStatus !== 'paid')

    const r1 = await callCb({ returnCode: 'SUCCESS', totalFee: 24000, outTradeNo: firstTrade })
    check('R3.cb-missing-result-code', r1.errcode === 0 && po(c1._id).paymentStatus !== 'paid', po(c1._id).paymentStatus)
    const r2 = await callCb({ resultCode: 'SUCCESS', totalFee: 24000, outTradeNo: firstTrade })
    check('R3.cb-missing-return-code', r2.errcode === 0 && po(c1._id).paymentStatus !== 'paid', po(c1._id).paymentStatus)

    state.failOnce = (op) => op.startsWith('purchase_orders')
    const r3 = await callCb({ ...cbBase, outTradeNo: firstTrade })
    check('R3.cb-db-error-retry', r3.errcode !== 0 && po(c1._id).paymentStatus !== 'paid', `errcode=${r3.errcode}`)

    state.paidWrites = 0
    const [r4a, r4b] = await Promise.all([
      callCb({ ...cbBase, outTradeNo: firstTrade }),
      callCb({ ...cbBase, outTradeNo: firstTrade })
    ])
    check('R5.cb-older-trade-no', po(c1._id).paymentStatus === 'paid', po(c1._id).paymentStatus)
    check('R3.cb-transaction-id', po(c1._id).transactionId === 'TX-1' && po(c1._id).paidFen === 24000)
    check('R3.cb-idempotent', r4a.errcode === 0 && r4b.errcode === 0 && state.paidWrites === 1, `paidWrites=${state.paidWrites}`)

    // 金额不一致 / 缺金额 → pay_review
    const c12 = await callPay('buyer1', { action: 'create', contactName: '甲', items: [{ skuId: 'SKU-A', quantity: 1 }] })
    const p12 = await callPay('buyer1', { action: 'pay', purchaseOrderId: c12._id })
    await callCb({ ...cbBase, totalFee: 1, outTradeNo: p12.outTradeNo, transactionId: 'TX-2' })
    check('R3.cb-amount-mismatch', po(c12._id).paymentStatus === 'pay_review' && !!po(c12._id).payAnomaly,
      po(c12._id).paymentStatus)
    const c13 = await callPay('buyer1', { action: 'create', contactName: '甲', items: [{ skuId: 'SKU-A', quantity: 1 }] })
    const p13 = await callPay('buyer1', { action: 'pay', purchaseOrderId: c13._id })
    await callCb({ returnCode: 'SUCCESS', resultCode: 'SUCCESS', outTradeNo: p13.outTradeNo, transactionId: 'TX-3' })
    check('R3.cb-missing-amount', po(c13._id).paymentStatus === 'pay_review', po(c13._id).paymentStatus)

    // —— R6 查单补记 ——
    const c14 = await callPay('buyer1', { action: 'create', contactName: '甲', items: [{ skuId: 'SKU-A', quantity: 3 }] })
    const p14 = await callPay('buyer1', { action: 'pay', purchaseOrderId: c14._id })
    const q1 = await callPay('buyer1', { action: 'adminReconcile', purchaseOrderId: c14._id })
    check('R6.reconcile-super-only', !q1.success && q1.code === 'FORBIDDEN', q1.code)
    pay.queryOrder = async (p) => ({
      returnCode: 'SUCCESS', resultCode: 'SUCCESS', tradeState: 'SUCCESS',
      totalFee: p.outTradeNo === p14.outTradeNo ? 36000 : 0, transactionId: 'TX-Q'
    })
    const q2 = await callPay('', { action: 'adminReconcile', purchaseOrderId: c14._id, adminOpsKey: OPS_KEY })
    check('R6.reconcile-paid', q2.success && q2.paid && po(c14._id).paymentStatus === 'paid' &&
      po(c14._id).transactionId === 'TX-Q', q2.msg)
    const c15 = await callPay('buyer1', { action: 'create', contactName: '甲', items: [{ skuId: 'SKU-A', quantity: 1 }] })
    await callPay('buyer1', { action: 'pay', purchaseOrderId: c15._id })
    pay.queryOrder = async () => ({ returnCode: 'SUCCESS', resultCode: 'SUCCESS', tradeState: 'SUCCESS', totalFee: 100, transactionId: 'TX-Z' })
    await callPay('', { action: 'adminReconcile', purchaseOrderId: c15._id, adminOpsKey: OPS_KEY })
    check('R6.reconcile-mismatch-review', po(c15._id).paymentStatus === 'pay_review', po(c15._id).paymentStatus)

    // —— R8 退款 ——
    pay.queryOrder = async () => ({ returnCode: 'SUCCESS', resultCode: 'SUCCESS', tradeState: 'SUCCESS', totalFee: 36000, transactionId: 'TX-Q' })
    const refundCount = () => calls.filter((c) => c[0] === 'refund').length
    const f0 = await callPay('buyer1', { action: 'adminRefund', purchaseOrderId: c14._id, confirmOrderNo: po(c14._id).orderNo, reason: 'x' })
    check('R8.refund-super-only', !f0.success && refundCount() === 0, f0.code)
    const f1 = await callPay('', { action: 'adminRefund', purchaseOrderId: c14._id, adminOpsKey: OPS_KEY, confirmOrderNo: 'WRONG', reason: '退货' })
    check('R8.refund-confirm-order-no', !f1.success && f1.code === 'CONFIRM_MISMATCH' && refundCount() === 0, f1.code)
    const f2 = await callPay('', { action: 'adminRefund', purchaseOrderId: c14._id, adminOpsKey: OPS_KEY, confirmOrderNo: po(c14._id).orderNo, reason: '' })
    check('R8.refund-reason-required', !f2.success && f2.code === 'MISSING_REASON' && refundCount() === 0, f2.code)
    pay.refund = async () => ({ returnCode: 'SUCCESS', resultCode: 'FAIL', errCodeDes: '余额不足' })
    await callPay('', { action: 'adminRefund', purchaseOrderId: c14._id, adminOpsKey: OPS_KEY, confirmOrderNo: po(c14._id).orderNo, reason: '退货' })
    const firstRefundNo = po(c14._id).refund && po(c14._id).refund.outRefundNo
    pay.refund = async () => ({ returnCode: 'SUCCESS', resultCode: 'SUCCESS', refundId: 'RF-1' })
    const f3 = await callPay('', { action: 'adminRefund', purchaseOrderId: c14._id, adminOpsKey: OPS_KEY, confirmOrderNo: po(c14._id).orderNo, reason: '退货' })
    const lastRefund = calls.filter((c) => c[0] === 'refund').pop()
    check('R8.refund-reuse-refund-no', lastRefund && lastRefund[1].outRefundNo === firstRefundNo && !!firstRefundNo)
    check('R8.refund-done', f3.success && po(c14._id).paymentStatus === 'refunded' && lastRefund[1].refundFee === 36000)
    check('R8.refund-operator', !!(po(c14._id).refund && po(c14._id).refund.refundedBy && po(c14._id).refund.reason === '退货'))

    // —— 对公确认仅 offline_pending ——
    const c16 = await callPay('buyer1', { action: 'create', contactName: '甲', items: [{ skuId: 'SKU-A', quantity: 1 }] })
    const k1 = await callPay('', { action: 'adminConfirmOffline', purchaseOrderId: c16._id, adminOpsKey: OPS_KEY })
    check('offline.confirm-needs-pending', !k1.success && po(c16._id).paymentStatus === 'unpaid', k1.code)
    await callPay('buyer1', { action: 'markOfflinePending', purchaseOrderId: c16._id })
    const k2 = await callPay('', { action: 'adminConfirmOffline', purchaseOrderId: c16._id, adminOpsKey: OPS_KEY })
    check('offline.confirm-paid', k2.success && po(c16._id).paymentStatus === 'paid' && po(c16._id).paymentChannel === 'offline')

    // —— ERP 列表经云函数（规则不放行匿名读）——
    const al1 = await callPay('buyer1', { action: 'adminList' })
    check('R1.admin-list-super-only', !al1.success && !al1.list, al1.code)
    const al2 = await callPay('', { action: 'adminList', adminOpsKey: OPS_KEY })
    check('R1.admin-list-all-rows', al2.success && Array.isArray(al2.list) && al2.list.length === rows('purchase_orders').length,
      al2.list && al2.list.length)

    // —— 供货方列表：supplierId 取花名册 ——
    const s1 = await callPay('sup1', { action: 'supplierList', supplierId: 'SUP-2', tab: 'pending_confirm' })
    const ids = (s1.list || []).map((r) => r._id)
    check('R1.supplier-id-from-roster', s1.success && ids.indexOf('po_sup_a') !== -1 && ids.indexOf('po_sup_b') === -1, ids.join(','))
    const l1 = await callPay('buyer2', { action: 'list' })
    check('R1.list-own-only', l1.success && (l1.list || []).length === 0, `n=${(l1.list || []).length}`)

    // —— manageStoreContent：两集合仅超管、禁写支付字段 ——
    const callSc = (openid, ev) => (as(openid), scFn.main(ev))
    const m1 = await callSc('mgr1', { action: 'update', collection: 'purchase_orders', id: c16._id, data: { note: 'x' } })
    check('R1.proxy-super-only', !m1.success && m1.code === 'SUPER_ADMIN_ONLY', m1.code || m1.msg)
    const m2 = await callSc('mgr1', { action: 'update', collection: 'price_list_items', id: 'p1', data: { price: 1 } })
    check('R1.proxy-price-super-only', !m2.success && rows('price_list_items')[0].price === 120, m2.code || m2.msg)
    const m3 = await callSc('', { action: 'update', collection: 'purchase_orders', id: c11._id, adminOpsKey: OPS_KEY, data: { paymentStatus: 'paid' } })
    check('R1.proxy-deny-pay-field', !m3.success && po(c11._id).paymentStatus === 'unpaid', m3.code || m3.msg)
    const m4 = await callSc('', { action: 'update', collection: 'purchase_orders', id: c11._id, adminOpsKey: OPS_KEY, data: { 'refund.status': 'refunded' } })
    check('R1.proxy-deny-dotted-pay-field', !m4.success, m4.code || m4.msg)
    const m5 = await callSc('', { action: 'remove', collection: 'purchase_orders', id: c11._id, adminOpsKey: OPS_KEY })
    check('R1.proxy-deny-remove', !m5.success && !!po(c11._id), m5.code || m5.msg)
    const m6 = await callSc('', { action: 'update', collection: 'purchase_orders', id: c11._id, adminOpsKey: OPS_KEY, data: { status: 'confirmed' } })
    check('R1.proxy-erp-status-ok', m6.success && po(c11._id).status === 'confirmed', m6.msg)
    const m7 = await callSc('mgr1', { action: 'batchUpsertByField', collection: 'banners', matchField: 'skuId', items: [{ collection: 'price_list_items', matchValue: 'SKU-A', data: { price: 1 } }] })
    check('R1.proxy-batch-collection-gate', !m7.success && rows('price_list_items')[0].price === 120, m7.code || m7.msg)
  } catch (e) {
    failures.push(`behavior.crash · ${e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e}`)
  } finally {
    Object.assign(console, quiet)
    if (prevEnv.sub === undefined) delete process.env.WX_PAY_SUB_MCH_ID
    else process.env.WX_PAY_SUB_MCH_ID = prevEnv.sub
    if (prevEnv.ops === undefined) delete process.env.ADMIN_OPS_KEY
    else process.env.ADMIN_OPS_KEY = prevEnv.ops
    if (prevEnv.mock !== undefined) process.env.ALLOW_MOCK_PAY = prevEnv.mock
  }
  return failures
}

// ———————————————————————— 静态断言 ————————————————————————

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.js$/.test(name)) out.push(p)
  }
  return out
}

function loadStaticSources() {
  const supplier = {}
  for (const f of walk(SUPPLIER_DIR)) supplier[f] = readFileSync(f, 'utf8')
  return {
    rulePo: readFileSync(RULE_PO, 'utf8'),
    rulePrice: readFileSync(RULE_PRICE, 'utf8'),
    supplier,
    fulfill: readFileSync(B2B_FULFILL, 'utf8'),
    poView: readFileSync(PO_VIEW, 'utf8')
  }
}

function clientWritable(rule) {
  const keys = ['write', 'create', 'update', 'delete']
  return keys.some((k) => rule[k] !== undefined && rule[k] !== false)
}

function runStatic(src) {
  const failures = []
  const check = (id, ok, detail) => {
    if (!ok) failures.push(`${id}${detail ? ` · ${detail}` : ''}`)
  }
  let po = null
  let price = null
  try {
    po = JSON.parse(src.rulePo)
  } catch (e) {
    failures.push('R1.rule-po-json')
  }
  try {
    price = JSON.parse(src.rulePrice)
  } catch (e) {
    failures.push('R1.rule-price-json')
  }
  if (po) {
    check('R1.rule-po-no-client-write', !clientWritable(po), JSON.stringify(po))
    const read = String(po.read || '')
    check('R1.rule-po-read-scoped', /doc\._openid\s*==\s*auth\.openid/.test(read) && !/^\s*auth\s*!=\s*null\s*$/.test(read) &&
      !/auth\s*!=\s*null/.test(read), read)
    check('R1.rule-po-no-anonymous', !/ANONYMOUS/i.test(JSON.stringify(po)), read)
  }
  check('R1.erp-list-via-fn', /listPurchaseOrdersAdmin\(/.test(src.poView) &&
    !/fetchCollectionSorted\(\s*COLLECTION\b/.test(src.poView) && /action:\s*'adminList'/.test(src.fulfill))
  if (price) check('R1.rule-price-no-client-write', !clientWritable(price), JSON.stringify(price))

  for (const [file, text] of Object.entries(src.supplier)) {
    const rel = file.slice(ROOT.length + 1)
    const direct = /collection\(\s*(['"]purchase_orders['"]|COL)\s*\)\s*\.(add|doc|where|update|remove|set)\b/.test(text)
    check('R1.mp-no-direct-po-access', !direct, rel)
  }
  const confirmFn = (src.fulfill.match(/export async function confirmOfflinePaid[\s\S]*?\n}\n/) || [''])[0]
  check('R1.erp-confirm-offline-via-fn', /adminConfirmOffline/.test(confirmFn) && !/cdnUpdate\(/.test(confirmFn))
  return failures
}

async function runAll({ transform = null, staticSrc = null } = {}) {
  const behavior = await runBehavior(transform)
  const stat = runStatic(staticSrc || loadStaticSources())
  return behavior.concat(stat)
}

// ———————————————————————— 自检注入 ————————————————————————

function replaceIn(fileSuffix, from, to) {
  return (abs, src) => {
    if (!abs.endsWith(fileSuffix)) return src
    if (src.indexOf(from) === -1) throw new Error(`selftest 锚点失配：${fileSuffix} :: ${from.slice(0, 60)}`)
    return src.replace(from, to)
  }
}

const PAY = 'payB2bPurchase/index.js'
const PRICING = 'payB2bPurchase/b2bPricing.js'
const CB = 'b2bPayCallback/index.js'
const SC = 'manageStoreContent/index.js'

const MUTATIONS = [
  { name: '建单采信客户端 payFen', expect: 'R2.create-server-price',
    transform: replaceIn(PAY, 'payFen: priced.payFen,\n    pricingMode', 'payFen: fenOf(event.payFen) || priced.payFen,\n    pricingMode') },
  { name: '支付不比对单内金额', expect: 'R2.pay-reprice-reject',
    transform: replaceIn(PAY, 'if (storedFen !== priced.payFen) {', 'if (false) {') },
  { name: '区间价按 min 计价', expect: 'R7.range-quote-required',
    transform: replaceIn(PRICING, "if (p.min == null || p.max == null || Number(p.min) !== Number(p.max)) return null\n", '') },
  { name: '无归属人的单放行', expect: 'R4.pay-no-owner-denied',
    transform: replaceIn(PAY, "if (!owner) return { ok: false, res: fail('NO_OWNER'", "if (false) return { ok: false, res: fail('NO_OWNER'") },
  { name: '支付不校验归属', expect: 'R4.pay-other-owner-denied',
    transform: replaceIn(PAY, "if (owner !== openid) return", 'if (false) return') },
  { name: '支付不校验采购角色', expect: 'R4.pay-needs-buyer-role',
    transform: replaceIn(PAY, "async function handlePay(purchaseOrderId, openid) {\n  const role = await requireBuyer(openid)\n  if (!role.ok) return role.res",
      'async function handlePay(purchaseOrderId, openid) {') },
  { name: '回调不核额', expect: 'R3.cb-amount-mismatch',
    transform: replaceIn(CB, 'if (paidFen == null || expectedFen == null || paidFen !== expectedFen) {', 'if (false) {') },
  { name: '回调缺 resultCode 当成功', expect: 'R3.cb-missing-result-code',
    transform: replaceIn(CB, "const resultCode = str(event, 'resultCode', 'result_code').toUpperCase()",
      "const resultCode = (str(event, 'resultCode', 'result_code') || 'SUCCESS').toUpperCase()") },
  { name: '回调写库异常仍回成功', expect: 'R3.cb-db-error-retry',
    transform: replaceIn(CB, 'return RETRY', 'return ACK') },
  { name: '回调无条件更新（并发重复处理）', expect: 'R3.cb-idempotent',
    transform: replaceIn(CB, '.where({ _id: po._id, paymentStatus: _.nin(FINAL_STATUSES) })', '.where({ _id: po._id })') },
  { name: '回调不记 transactionId', expect: 'R3.cb-transaction-id',
    transform: replaceIn(CB, 'transactionId: transactionId || null,\n          paidOutTradeNo', 'paidOutTradeNo') },
  { name: '回调只认最近一次单号', expect: 'R5.cb-older-trade-no',
    transform: replaceIn(CB, 'let po = await firstRow({ payOutTradeNos: outTradeNo })\n  if (po) return po\n  po = await', 'let po = await') },
  { name: '查单补记不限超管', expect: 'R6.reconcile-super-only',
    transform: replaceIn(PAY, 'if (!actor || !actor.ok || !actor.superAdmin) {', 'if (!actor || !actor.ok) {') },
  { name: '查单金额不一致也标已付', expect: 'R6.reconcile-mismatch-review',
    transform: replaceIn(PAY, 'if (paidFen == null || expected == null || paidFen !== expected) {', 'if (false) {') },
  { name: '退款不做单号二次确认', expect: 'R8.refund-confirm-order-no',
    transform: replaceIn(PAY, "if (pickStr(event.confirmOrderNo, 40) !== String(po.orderNo || '')) {", 'if (false) {') },
  { name: '退款重试换新退款单号', expect: 'R8.refund-reuse-refund-no',
    transform: replaceIn(PAY, 'const outRefundNo = (refund && refund.outRefundNo) || buildRefundNo()', 'const outRefundNo = buildRefundNo()') },
  { name: '供货方采信客户端 supplierId', expect: 'R1.supplier-id-from-roster',
    transform: replaceIn(PAY, 'if (actor.superAdmin) {\n    supplierId = pickStr(event.supplierId, 80)', 'if (true) {\n    supplierId = pickStr(event.supplierId, 80)') },
  { name: '内容代理去掉集合门禁', expect: 'R1.proxy-super-only',
    transform: replaceIn(SC, 'const gate = gateCollections(event, action, guard.actor)\n  if (!gate.ok) return fail(gate.msg, { code: gate.code })', '') },
  { name: '内容代理不拦点路径支付字段', expect: 'R1.proxy-deny-dotted-pay-field',
    transform: replaceIn(SC, "const root = key.split('.')[0]", 'const root = key') },
  { name: '规则回退为登录可写', expect: 'R1.rule-po-no-client-write',
    static: (s) => ({ ...s, rulePo: '{"read":"auth != null","create":"auth != null","update":"auth != null","delete":false}' }) },
  { name: '采购单读规则放行 Web 匿名', expect: 'R1.rule-po-no-anonymous',
    static: (s) => ({ ...s, rulePo: `{"read":"auth.loginType == 'ANONYMOUS' || doc._openid == auth.openid","write":false}` }) },
  { name: 'ERP 列表回退为匿名直读', expect: 'R1.erp-list-via-fn',
    static: (s) => ({ ...s, poView: s.poView.replace('await listPurchaseOrdersAdmin(300)', 'await fetchCollectionSorted(COLLECTION, { limit: 300 })') }) },
  { name: 'adminList 不限超管', expect: 'R1.admin-list-super-only',
    transform: replaceIn(PAY, "if (!admin.ok) return admin.res\n      if (action === 'adminList')",
      "if (action === 'adminList') return await handleAdminList(ev)\n      if (!admin.ok) return admin.res\n      if (action === 'adminList')") },
  { name: '价目规则回退为登录可写', expect: 'R1.rule-price-no-client-write',
    static: (s) => ({ ...s, rulePrice: '{"read":"auth != null","write":"auth != null"}' }) },
  { name: '小程序恢复直写 purchase_orders', expect: 'R1.mp-no-direct-po-access',
    static: (s) => {
      const key = Object.keys(s.supplier).find((f) => f.endsWith('buyerPurchaseOrder.js'))
      return { ...s, supplier: { ...s.supplier, [key]: `${s.supplier[key]}\nwx.cloud.database().collection('purchase_orders').add({ data: {} })\n` } }
    } },
  { name: 'ERP 确认到账回退为直写', expect: 'R1.erp-confirm-offline-via-fn',
    static: (s) => ({ ...s, fulfill: s.fulfill.replace("const res = await callB2bPayAdmin('adminConfirmOffline', orderId, {", "await cdnUpdate(PO_COL, orderId, { paymentStatus: 'paid' })\n  const res = await callB2bPayAdmin('x', orderId, {") }) }
]

async function main() {
  const selftest = process.argv.includes('--selftest')
  if (!selftest) {
    const failures = await runAll()
    if (failures.length) {
      console.error(`✗ B2B 支付安全守卫：${failures.length} 项失败`)
      failures.forEach((f) => console.error(`  - ${f}`))
      process.exit(1)
    }
    console.log('✓ B2B 支付安全守卫通过（R1 规则/代理门禁 · R2 服务端定价 · R3 回调核额/幂等/重试 · R4 归属与角色 · R5 历次单号 · R6 查单 · R7 区间价 · R8 退款）')
    return
  }

  const baseline = await runAll()
  if (baseline.length) {
    console.error('✗ selftest 前置：基线本身不通过')
    baseline.forEach((f) => console.error(`  - ${f}`))
    process.exit(1)
  }
  const staticBase = loadStaticSources()
  let bad = 0
  for (const m of MUTATIONS) {
    let failures
    try {
      failures = await runAll({ transform: m.transform || null, staticSrc: m.static ? m.static(staticBase) : staticBase })
    } catch (e) {
      console.error(`✗ 注入「${m.name}」执行异常：${e.message}`)
      bad++
      continue
    }
    const hit = failures.some((f) => f.startsWith(m.expect))
    if (hit) console.log(`✓ 注入「${m.name}」→ 检出 ${m.expect}`)
    else {
      bad++
      console.error(`✗ 注入「${m.name}」未被检出（期望 ${m.expect}；实际 ${failures.join(' ; ') || '全部通过'}）`)
    }
  }
  if (bad) {
    console.error(`✗ selftest：${bad}/${MUTATIONS.length} 条注入未检出`)
    process.exit(1)
  }
  console.log(`✓ selftest：${MUTATIONS.length} 条回归注入全部检出（内存注入，未写盘）`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
