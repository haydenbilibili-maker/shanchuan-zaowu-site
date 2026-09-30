#!/usr/bin/env node
/**
 * B2B 采购单支付 · 商户号（subMchId）配置守卫
 *
 * 起因（2026-09-30 真机）：「我的采购单」点微信支付报
 *   「微信支付暂不可用：输入源"/body/xml/sub_mch_id"…字节数 64，大于最大值 12」。
 *   根因：线上 payB2bPurchase 的 WX_PAY_SUB_MCH_ID 被误填成 64 位回调密钥（C 端 payOrder 上是 10 位商户号）；
 *   函数不校验就传给 cloudPay，再把微信内部报错原文直接透给门店。
 *
 * 真跑云函数真源（mock wx-server-sdk + 内存库）与小程序 buyerPurchaseOrder 真源：
 *   S1 来源：payB2bPurchase 与 payOrder 读同一个环境变量 WX_PAY_SUB_MCH_ID；每处 cloudPay 调用的 subMchId 都是它
 *   S2 前置校验：商户号填成 64 位十六进制 → pay / adminReconcile / adminRefund 均返回 B2B_PAY_CONFIG_INVALID，
 *      零次 cloudPay 调用、采购单不被改成 pending；日志写明原因但不含该值
 *   S3 正确 10 位商户号 → unifiedOrder 收到的 subMchId 就是该值，拿到 prepay 参数
 *   S4 统一下单失败 → 返回给门店的文案不含微信原文（/body/xml、sub_mch_id…）
 *   S5 小程序端：PAY_UNAVAILABLE / B2B_PAY_CONFIG_INVALID / 带微信原文的未知码 → 大白话；requestPayment 失败不透出 errMsg
 *
 * 用法：
 *   node miniprogram/scripts/check-b2b-pay-submch.mjs
 *   node miniprogram/scripts/check-b2b-pay-submch.mjs --selftest   # 内存注入回归 → 必须检出（不写盘）
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadCjsModule } from './lib/cjs-loader.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '../..')
const PAY_FN = join(ROOT, 'miniprogram/cloudfunctions/payB2bPurchase/index.js')
const C_PAY_FN = join(ROOT, 'miniprogram/cloudfunctions/payOrder/index.js')
const CLIENT = join(ROOT, 'miniprogram/subpackages/extra/supplier/utils/buyerPurchaseOrder.js')

const GOOD_MCH = '1900000109'
const BAD_MCH = 'b6' + 'a1f0'.repeat(15) + '4f' // 64 位十六进制，模拟误填的回调密钥
const OPS_KEY = 'test-ops-key-submch'
const WX_RAW = '输入源"/body/xml/sub_mch_id"映射到值字段"子商户号"字符串规则校验失败，字节数 64，大于最大值 12'
const WX_LEAK_RE = /\/body\/xml|sub_mch_id|规则校验失败|字节数/i

function createDb() {
  const store = {
    staff_members: [{ _id: 's1', openid: 'buyer1', status: 'active', roles: ['buyer'], name: '采购甲' }],
    price_list_items: [{ _id: 'p1', skuId: 'SKU-A', name: '爱神凤蝶玻璃罩', price: 180, status: 'active' }],
    purchase_orders: [
      {
        _id: 'po1', orderNo: 'PO-1', source: 'buyer_workbench', _openid: 'buyer1', buyerOpenid: 'buyer1',
        paymentStatus: 'unpaid', status: 'submitted', items: [{ skuId: 'SKU-A', quantity: 1 }], payFen: 18000
      }
    ]
  }
  const writes = []
  const rows = (n) => (store[n] = store[n] || [])
  const match = (doc, where) => Object.entries(where || {}).every(([k, v]) => doc[k] === v)
  const query = (name, where, skip = 0, lim = 1000) => ({
    where: (w) => query(name, w, skip, lim),
    orderBy: () => query(name, where, skip, lim),
    skip: (n) => query(name, where, n, lim),
    limit: (n) => query(name, where, skip, n),
    async get() {
      return { data: rows(name).filter((d) => match(d, where)).slice(skip, skip + lim).map((d) => ({ ...d })) }
    },
    async update({ data }) {
      writes.push([name, where, data])
      let n = 0
      for (const d of rows(name)) if (match(d, where)) { Object.assign(d, data); n++ }
      return { stats: { updated: n } }
    }
  })
  const db = {
    command: { in: (a) => a, nin: (a) => a, neq: (v) => v, push: (a) => a },
    serverDate: () => new Date(),
    collection: (name) => ({
      ...query(name, {}),
      doc: (id) => ({
        async get() {
          const d = rows(name).find((x) => x._id === id)
          if (!d) throw new Error('not found')
          return { data: { ...d } }
        },
        async update({ data }) {
          writes.push([name, { _id: id }, data])
          const d = rows(name).find((x) => x._id === id)
          if (d) Object.assign(d, data)
          return { stats: { updated: d ? 1 : 0 } }
        }
      })
    })
  }
  return { db, store, writes }
}

async function runPayFn(transform, subMch, unifiedImpl) {
  const { db, store, writes } = createDb()
  const calls = []
  const ctx = { OPENID: '' }
  const cloud = {
    DYNAMIC_CURRENT_ENV: 'test-env',
    init() {},
    database: () => db,
    getWXContext: () => ({ ...ctx }),
    cloudPay: {
      unifiedOrder: async (p) => (calls.push(['unifiedOrder', p]), unifiedImpl(p)),
      queryOrder: async (p) => (calls.push(['queryOrder', p]), { returnCode: 'SUCCESS', resultCode: 'SUCCESS', tradeState: 'NOTPAY' }),
      refund: async (p) => (calls.push(['refund', p]), { returnCode: 'SUCCESS', resultCode: 'SUCCESS' })
    }
  }
  const prev = { sub: process.env.WX_PAY_SUB_MCH_ID, ops: process.env.ADMIN_OPS_KEY, mock: process.env.ALLOW_MOCK_PAY }
  process.env.WX_PAY_SUB_MCH_ID = subMch
  process.env.ADMIN_OPS_KEY = OPS_KEY
  delete process.env.ALLOW_MOCK_PAY
  const logs = []
  const quiet = { log: console.log, warn: console.warn, error: console.error }
  console.log = console.warn = console.error = (...a) => logs.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '))
  try {
    const fn = loadCjsModule(PAY_FN, { stubs: { 'wx-server-sdk': cloud }, transform })
    const as = (openid) => { ctx.OPENID = openid }
    as('buyer1')
    const pay = await fn.main({ action: 'pay', purchaseOrderId: 'po1' })
    const poAfterPay = { ...store.purchase_orders[0] }
    as('')
    const reconcile = await fn.main({ action: 'adminReconcile', purchaseOrderId: 'po1', adminOpsKey: OPS_KEY })
    const refund = await fn.main({ action: 'adminRefund', purchaseOrderId: 'po1', adminOpsKey: OPS_KEY, confirmOrderNo: 'PO-1', reason: '测试' })
    return { pay, reconcile, refund, calls, logs, writes, poAfterPay }
  } finally {
    Object.assign(console, quiet)
    for (const [k, v] of [['WX_PAY_SUB_MCH_ID', prev.sub], ['ADMIN_OPS_KEY', prev.ops], ['ALLOW_MOCK_PAY', prev.mock]]) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

const okUnified = async () => ({
  returnCode: 'SUCCESS', resultCode: 'SUCCESS',
  payment: { timeStamp: '1', nonceStr: 'n', package: 'prepay_id=wx2026093000001', paySign: 's', signType: 'MD5' }
})
const failUnified = async () => ({ returnCode: 'FAIL', returnMsg: WX_RAW })

async function runChecks(transform) {
  const failures = []
  const check = (id, ok, detail) => { if (!ok) failures.push(`${id}${detail ? ` · ${detail}` : ''}`) }
  const read = (p) => (transform ? transform(p, readFileSync(p, 'utf8')) : readFileSync(p, 'utf8'))

  // —— S1 来源 ——
  const paySrc = read(PAY_FN)
  const cSrc = read(C_PAY_FN)
  check('S1.c-end-var', /process\.env\.WX_PAY_SUB_MCH_ID\b/.test(cSrc), 'payOrder 不再读 WX_PAY_SUB_MCH_ID（来源基线变了，需复核）')
  check('S1.b2b-same-var', /const SUB_MCH_ID = process\.env\.WX_PAY_SUB_MCH_ID\b/.test(paySrc), 'payB2bPurchase 商户号必须读与 C 端同名的 WX_PAY_SUB_MCH_ID')
  const subArgs = [...paySrc.matchAll(/subMchId\s*:\s*([^,}\n]+)/g)].map((m) => m[1].trim())
  check('S1.all-calls-use-const', subArgs.length >= 4 && subArgs.every((a) => a === 'SUB_MCH_ID'), `subMchId 实参：${subArgs.join(' / ')}`)

  // —— S2 误填 64 位密钥 ——
  const bad = await runPayFn(transform, BAD_MCH, okUnified)
  check('S2.pay-code', bad.pay && bad.pay.code === 'B2B_PAY_CONFIG_INVALID', JSON.stringify(bad.pay && bad.pay.code))
  check('S2.pay-msg', bad.pay && /联系总部/.test(String(bad.pay.msg || '')) && !WX_LEAK_RE.test(String(bad.pay.msg || '')), bad.pay && bad.pay.msg)
  check('S2.reconcile-code', bad.reconcile && bad.reconcile.code === 'B2B_PAY_CONFIG_INVALID', JSON.stringify(bad.reconcile && bad.reconcile.code))
  check('S2.refund-code', bad.refund && bad.refund.code === 'B2B_PAY_CONFIG_INVALID', JSON.stringify(bad.refund && bad.refund.code))
  check('S2.no-cloudpay', bad.calls.length === 0, `cloudPay 被调用 ${bad.calls.length} 次`)
  check('S2.no-pending', bad.poAfterPay.paymentStatus === 'unpaid' && !bad.poAfterPay.payOutTradeNo, `paymentStatus=${bad.poAfterPay.paymentStatus}`)
  const badLog = bad.logs.join('\n')
  check('S2.log-reason', /WX_PAY_SUB_MCH_ID/.test(badLog) && /len=64/.test(badLog), '日志须写明是商户号格式错误（含长度）')
  check('S2.log-no-value', !badLog.includes(BAD_MCH) && !badLog.includes(BAD_MCH.slice(4, 40)), '日志不得打印误填的值')

  // —— S3 正确商户号 ——
  const good = await runPayFn(transform, GOOD_MCH, okUnified)
  const uo = good.calls.find((c) => c[0] === 'unifiedOrder')
  check('S3.pass-value', uo && uo[1].subMchId === GOOD_MCH, uo ? `subMchId=${uo[1].subMchId}` : '未调用 unifiedOrder')
  check('S3.prepay', good.pay && good.pay.success && good.pay.payment && /^prepay_id=/.test(good.pay.payment.package), JSON.stringify(good.pay && good.pay.code))

  // —— S4 微信原文不透出 ——
  const wxFail = await runPayFn(transform, GOOD_MCH, failUnified)
  check('S4.code', wxFail.pay && wxFail.pay.code === 'PAY_UNAVAILABLE', JSON.stringify(wxFail.pay && wxFail.pay.code))
  check('S4.no-leak', wxFail.pay && !WX_LEAK_RE.test(JSON.stringify(wxFail.pay)), wxFail.pay && wxFail.pay.msg)
  check('S4.logged', wxFail.logs.some((l) => l.includes('sub_mch_id')), '微信原文应进日志便于排查')

  // —— S5 小程序端文案 ——
  const client = loadCjsModule(CLIENT, { transform, globals: { wx: {} } })
  const f1 = client.friendlyPayError({ code: 'PAY_UNAVAILABLE', msg: `微信支付暂不可用：${WX_RAW}` })
  check('S5.pay-unavailable', !WX_LEAK_RE.test(f1.msg), f1.msg)
  const f2 = client.friendlyPayError({ code: 'B2B_PAY_CONFIG_INVALID', msg: '' })
  check('S5.config-invalid', /联系总部/.test(f2.msg), f2.msg)
  const f3 = client.friendlyPayError({ code: 'SOMETHING', msg: WX_RAW })
  check('S5.unknown-with-raw', !WX_LEAK_RE.test(f3.msg), f3.msg)
  const f4 = client.friendlyPayError({ code: 'B2B_PAY_NOT_CONFIGURED', msg: '' })
  check('S5.not-configured-plain', !/WX_PAY_|payB2bPurchase/.test(f4.msg), f4.msg)
  const clientSrc = read(CLIENT)
  const failBlock = (clientSrc.match(/wx\.requestPayment\(\{[\s\S]*?\n\s{8}\}\)/) || [''])[0]
  check('S5.request-payment-no-errmsg', failBlock && !/new Error\(\s*raw\b/.test(failBlock), 'requestPayment 失败不得把 errMsg 原文当提示')
  return failures
}

const INJECTIONS = [
  ['来源改成别的变量', PAY_FN, (s) => s.replace('process.env.WX_PAY_SUB_MCH_ID ||', 'process.env.WX_PAY_API_KEY ||')],
  ['统一下单 subMchId 传错字段', PAY_FN, (s) => s.replace(/subMchId: SUB_MCH_ID,\n(\s+)totalFee: payFen/, 'subMchId: openid,\n$1totalFee: payFen')],
  ['去掉 pay 的前置校验', PAY_FN, (s) => s.replace("const cfgErr = subMchConfigError('pay')", 'const cfgErr = null')],
  ['去掉查单的前置校验', PAY_FN, (s) => s.replace("const cfgErr = subMchConfigError('adminReconcile')", 'const cfgErr = null')],
  ['去掉退款的前置校验', PAY_FN, (s) => s.replace("const cfgErr = subMchConfigError('adminRefund')", 'const cfgErr = null')],
  ['校验放宽成任意字符', PAY_FN, (s) => s.replace('/^\\d{8,12}$/.test(SUB_MCH_ID)', '/^.+$/.test(SUB_MCH_ID)')],
  ['日志打印了值', PAY_FN, (s) => s.replace('len=${SUB_MCH_ID.length}', 'len=${SUB_MCH_ID.length} v=${SUB_MCH_ID}')],
  ['统一下单失败又透出微信原文', PAY_FN, (s) => s.replace("fail('PAY_UNAVAILABLE', '微信支付暂时拉不起来", "fail('PAY_UNAVAILABLE', lastErr + '微信支付暂时拉不起来")],
  ['前端去掉 PAY_UNAVAILABLE 映射', CLIENT, (s) => s.replace("if (code === 'PAY_UNAVAILABLE' || looksLikeWxInternal(raw)) {", 'if (false) {')],
  ['前端去掉配置错误映射', CLIENT, (s) => s.replace("if (code === 'B2B_PAY_CONFIG_INVALID') {", "if (code === '__none__') {")],
  ['requestPayment 失败透出 errMsg', CLIENT, (s) => s.replace(/reject\(Object\.assign\(new Error\('微信支付没有完成[^']*'\)/, 'reject(Object.assign(new Error(raw || \'支付失败\')')]
]

async function selftest() {
  const base = await runChecks(null)
  if (base.length) {
    console.error('✗ 自检前提失败：真源本身不通过\n  ' + base.join('\n  '))
    process.exit(1)
  }
  let bad = 0
  for (const [name, file, fn] of INJECTIONS) {
    const orig = readFileSync(file, 'utf8')
    if (fn(orig) === orig) {
      console.log(`✗ ${name}：注入锚点失效（源码已变，自检需同步）`)
      bad++
      continue
    }
    const failures = await runChecks((p, src) => (p === file ? fn(src) : src))
    if (failures.length) console.log(`✓ ${name} → 检出：${failures[0]}`)
    else { console.log(`✗ ${name} → 未检出`); bad++ }
  }
  if (bad) {
    console.error(`\n自检失败 ${bad}/${INJECTIONS.length}`)
    process.exit(1)
  }
  console.log(`\n自检通过：${INJECTIONS.length} 个内存注入全部检出（不写盘）`)
}

async function main() {
  if (process.argv.includes('--selftest')) return selftest()
  const failures = await runChecks(null)
  if (failures.length) {
    console.error('✗ B2B 商户号配置守卫失败：\n  ' + failures.join('\n  '))
    process.exit(1)
  }
  console.log('✓ B2B 商户号：与 C 端同源 · 格式前置校验（pay/查单/退款）· 日志不打印值 · 门店看不到微信原文')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
