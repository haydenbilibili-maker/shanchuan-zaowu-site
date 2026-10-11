#!/usr/bin/env node
/**
 * 礼赠 · 凭礼笺领取守卫（蓝图 miniprogram/docs/礼赠凭礼笺领取_2026-10-11.md）
 *
 * 用**真源码** + 桩数据库跑 makeOrder / manageGift（不联网、不写盘）：
 *   A 下单：只有新版客户端（带 gift_claim_link_v1）+ 填址 / 自提才可免填号；直寄 / 寄给自己仍必填；带号即走手机号核验；
 *     旧版客户端行为不变；口令只进核验集合（orders 登录可读）
 *   B 领取：打开不算领取（getShare 不绑定、不出自提领取码）；bindReceiver 不带 confirm 不绑定；填址前须先收下；
 *     收下**不要求注册**（无 users 记录也能收）；一份礼只一个微信身份（含并发两人同时收下只一人成功）
 *   C 口令：未过口令不得收下；错口令不绑定、限次；口令不出现在受礼人可见数据里；口令通过不等于收下
 *   D 作废并换新链接：旧链接即刻失效、原领取人解绑、口令重置；对方填址 / 到店领取后不可作废；只有送礼人可作废
 *   E 送礼人看到领取人：称呼 / 「未留名的微信用户」+ 收下时间；不出完整号码
 *   F 「不设核验」后门已改为「转为凭礼笺领取」：只限填址 / 自提，其它交付方式拒绝清号；设号即回到手机号核验
 *   G 客户端接线：送礼页免填号交付方式与云端同值；凭礼笺领取不发朋友圈（成功页 / 订单详情）；领取页收下不走注册门；
 *     注册引导卡只给未注册者、可关、在协议勾选守卫名单内；7 个新埋点双端登记
 *
 * 用法：node miniprogram/scripts/check-gift-claim-link.mjs [--selftest]
 * --selftest：对真源做**内存注入**（不改文件），每条注入都必须被检出。
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadCjsModule } from './lib/cjs-loader.mjs'

const NODE_CRYPTO = createRequire(import.meta.url)('crypto')
const HERE = dirname(fileURLToPath(import.meta.url))
const MP = resolve(HERE, '..')
const ROOT = resolve(MP, '..')
const P = {
  gift: resolve(MP, 'cloudfunctions/manageGift/index.js'),
  makeOrder: resolve(MP, 'cloudfunctions/makeOrder/index.js'),
  phoneLib: resolve(MP, 'cloudfunctions/makeOrder/giftReceiverPhone.js'),
  phoneLibCopy: resolve(MP, 'cloudfunctions/manageGift/giftReceiverPhone.js'),
  composeJs: resolve(MP, 'subpackages/feature/gift/compose/index.js'),
  confirmOrder: resolve(MP, 'subpackages/business/confirm-order/index.js'),
  receiverVerify: resolve(MP, 'subpackages/feature/gift/receiverVerify.js'),
  successJs: resolve(MP, 'subpackages/feature/gift/success/index.js'),
  orderDetailJs: resolve(MP, 'subpackages/business/order-detail/index.js'),
  receiveJs: resolve(MP, 'subpackages/feature/gift/receive/index.js'),
  receiveWxml: resolve(MP, 'subpackages/feature/gift/receive/index.wxml'),
  regCardJs: resolve(MP, 'subpackages/feature/gift/reg-card/index.js'),
  privacyGuard: resolve(MP, 'scripts/check-privacy-consent.mjs'),
  mpSchema: resolve(MP, 'utils/analytics/eventSchema.js'),
  adminSchema: resolve(ROOT, 'admin/src/utils/analyticsSchema.js')
}
const EVENTS = ['gift_receive_open', 'gift_receive_verify', 'gift_receive_passcode', 'gift_receive_accept',
  'gift_reg_guide_expose', 'gift_reg_guide_click', 'gift_reg_guide_done']

// ---------------------------------------------------------------- 桩数据库（支持条件更新：并发收下 / 作废换链接靠它）
const _ = {
  in: (v) => ({ $op: 'in', v }),
  neq: (v) => ({ $op: 'neq', v }),
  exists: (v) => ({ $op: 'exists', v }),
  lte: (v) => ({ $op: 'lte', v }),
  gte: (v) => ({ $op: 'gte', v }),
  or: (...list) => ({ $op: 'or', v: list.flat() }),
  remove: () => ({ $op: 'remove' })
}
const pick = (doc, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), doc)
function setPath(doc, path, v) {
  const ks = path.split('.')
  let o = doc
  ks.slice(0, -1).forEach((k) => { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k] })
  if (v && v.$op === 'remove') delete o[ks[ks.length - 1]]
  else o[ks[ks.length - 1]] = v
}
function cond(val, c) {
  if (c && c.$op === 'in') return c.v.some((x) => (x === null ? val == null : x === val))
  if (c && c.$op === 'neq') return val !== c.v
  if (c && c.$op === 'exists') return (val !== undefined) === c.v
  if (c && c.$op === 'or') return c.v.some((x) => cond(val, x))
  if (c && (c.$op === 'lte' || c.$op === 'gte')) return true
  return val === c
}
const match = (doc, where) => Object.entries(where || {}).every(([k, c]) => cond(pick(doc, k), c))
const tick = () => new Promise((r) => setImmediate(r))
function makeDb(seed = {}) {
  const store = {}
  for (const [k, rows] of Object.entries(seed)) store[k] = rows.map((r) => JSON.parse(JSON.stringify(r)))
  let seq = 0
  const col = (name) => {
    store[name] = store[name] || []
    const rows = store[name]
    const query = (where, lim) => ({
      where: (w) => query(w, lim),
      orderBy: () => query(where, lim),
      limit: (n) => query(where, n),
      skip: () => query(where, lim),
      field: () => query(where, lim),
      async get() {
        await tick()
        let list = rows.filter((r) => match(r, where))
        if (lim) list = list.slice(0, lim)
        return { data: list.map((r) => JSON.parse(JSON.stringify(r))) }
      },
      async count() { return { total: rows.filter((r) => match(r, where)).length } },
      async update({ data }) {
        await tick()
        const hit = rows.filter((r) => match(r, where))
        hit.forEach((r) => Object.entries(data).forEach(([k, v]) => setPath(r, k, v)))
        return { stats: { updated: hit.length } }
      }
    })
    return {
      ...query(null, 0),
      doc: (id) => ({
        async get() {
          await tick()
          const r = rows.find((x) => x._id === id)
          if (!r) throw new Error('document not exist')
          return { data: JSON.parse(JSON.stringify(r)) }
        },
        async update({ data }) {
          await tick()
          const r = rows.find((x) => x._id === id)
          if (r) Object.entries(data).forEach(([k, v]) => setPath(r, k, v))
          return { stats: { updated: r ? 1 : 0 } }
        },
        async set({ data }) {
          const i = rows.findIndex((x) => x._id === id)
          if (i >= 0) rows.splice(i, 1)
          rows.push({ _id: id, ...data })
          return { _id: id }
        }
      }),
      async add({ data }) {
        const _id = `${name}_${++seq}`
        rows.push({ _id, ...data })
        return { _id }
      }
    }
  }
  return { store, db: { collection: col, command: _, serverDate: () => new Date() } }
}

// ---------------------------------------------------------------- 注入
let INJECT = null
function transform(file, src) {
  const targets = INJECT ? [].concat(INJECT.file) : []
  if (!targets.includes(file)) return src
  if (!src.includes(INJECT.find)) throw new Error(`注入锚点失效：${INJECT.name}`)
  return src.split(INJECT.find).join(INJECT.replace)
}
const read = (file) => transform(file, readFileSync(file, 'utf8'))
const load = (file, opts = {}) => loadCjsModule(file, { transform, ...opts })
function fnBody(src, name) {
  const m = new RegExp(`\\n( +)(async )?${name}\\(`).exec(src)
  if (!m) return ''
  const j = src.indexOf(`\n${m[1]}},`, m.index)
  return src.slice(m.index, j < 0 ? undefined : j)
}

// ---------------------------------------------------------------- 夹具
const GIVER = 'o_giver'
const RECV = 'o_recv'
const RECV2 = 'o_recv2'
const PHONE = '13800001234'
const product = { id: 'p1', productId: 'p1', title: '光明女神闪蝶', image: 'https://example.com/a.jpg' }
const linkOrder = (meta = {}, over = {}) => ({
  _id: 'L1', _openid: GIVER, openid: GIVER, source: 'gift', orderNo: 'SH20261011001', status: 'paid_awaiting_address', products: [product], createTime: new Date(),
  giftMeta: { deliveryType: 'invite_address', shareToken: 'tokA', claimMode: 'link', claimPasscode: false, acceptStatus: 'none', addressStatus: 'none', cardSignature: '阿山', expireAt: new Date(Date.now() + 7 * 864e5), ...meta },
  ...over
})

async function runChecks() {
  const fails = []
  const ok = (c, msg) => { if (!c) fails.push(msg) }

  // ---------------- A 下单
  const PL = load(P.phoneLib, { stubs: { crypto: NODE_CRYPTO } })
  ok(read(P.phoneLib) === read(P.phoneLibCopy), 'A 副本漂移：manageGift/giftReceiverPhone.js 与 makeOrder/giftReceiverPhone.js 不一致')
  ok(JSON.stringify(PL.CLAIM_LINK_DELIVERY) === JSON.stringify(['invite_address', 'store_pickup']), 'A 免填号的交付方式只能是「邀请 TA 填地址」与「门店自提」')
  async function makeOrder(event) {
    const { store, db } = makeDb({ orders: [], gift_settings: [] })
    const sdk = { init() {}, DYNAMIC_CURRENT_ENV: 'env', database: () => db, getWXContext: () => ({ OPENID: GIVER }) }
    const pricing = { totalPrice: 100, goodsPrice: 100, shippingFee: 0, originalPrice: 100, discountRate: 1, products: [product], collectionIds: [], count: 1 }
    const main = load(P.makeOrder, {
      stubs: {
        'wx-server-sdk': sdk,
        crypto: NODE_CRYPTO,
        './pricing': { calculateOrderPricing: async () => pricing },
        './inAppMessage': { dispatchInAppMessage: async () => ({}) },
        './refundPolicy': { snapshotFromOrderContext: () => ({}) },
        './shipping': { getDefaultCarrier: () => 'sf' },
        './stockUtils': { holdOrderProducts: async () => [], releaseOrderStockHold: async () => {} }
      }
    }).main
    const res = await main({ items: [{ productId: 'p1', count: 1 }], ...event })
    return { res, store }
  }
  const gEv = (deliveryType) => ({ source: 'gift', giftMeta: { deliveryType, recipientName: '小满', cardBody: '生日快乐', ...(deliveryType === 'store_pickup' ? { storeId: 's1', storeName: '山海造物' } : {}) } })
  const BOTH = { clientCaps: [PL.GIFT_PHONE_CAP, PL.GIFT_CLAIM_LINK_CAP] }
  {
    const a = await makeOrder({ ...gEv('invite_address'), ...BOTH, giftClaimMode: 'link' })
    const o = a.store.orders[0] || {}
    ok(a.res.success && a.res.claimMode === 'link' && o.giftMeta && o.giftMeta.claimMode === 'link' && !o.giftMeta.receiverVerify,
      'A 新版 + 邀请填址 + 凭礼笺领取：不填号也能下单，订单标为凭礼笺领取')
    ok(!(a.store.gift_receiver_verify || []).length, 'A 未加口令：不写核验集合')
    const pk = await makeOrder({ ...gEv('store_pickup'), ...BOTH, giftClaimMode: 'link', giftClaimPasscode: true })
    const po = pk.store.orders[0] || {}
    const vd = (pk.store.gift_receiver_verify || [])[0] || {}
    ok(pk.res.success && po.giftMeta && po.giftMeta.claimMode === 'link' && po.giftMeta.claimPasscode === true && /^\d{6}$/.test(vd.passcode || ''),
      'A 门店自提 + 口令：订单只记「有口令」，6 位口令进核验集合')
    ok(!JSON.stringify(po).includes(vd.passcode) && !JSON.stringify(pk.res).includes(vd.passcode), 'A 口令不得出现在订单（登录可读）与下单出参里')
    for (const dt of ['ship_to_receiver', 'ship_to_self']) {
      const r = await makeOrder({ ...gEv(dt), ...BOTH, giftClaimMode: 'link' })
      ok(!r.res.success && r.res.code === 'GIFT_RECEIVER_PHONE_REQUIRED' && !r.store.orders.length, `A ${dt}：仍必须填受礼人手机号`)
    }
    const noCap = await makeOrder({ ...gEv('invite_address'), clientCaps: [PL.GIFT_PHONE_CAP], giftClaimMode: 'link' })
    ok(!noCap.res.success && noCap.res.code === 'GIFT_RECEIVER_PHONE_REQUIRED', 'A 不带凭礼笺领取能力标记：不得免填号')
    const both = await makeOrder({ ...gEv('invite_address'), ...BOTH, giftClaimMode: 'link', giftReceiverPhone: PHONE })
    const bo = both.store.orders[0] || {}
    ok(both.res.success && bo.giftMeta.receiverVerify === true && !bo.giftMeta.claimMode, 'A 填了号：走手机号核验，不是凭礼笺领取（手机号定向礼赠完全不变）')
    const old = await makeOrder({ ...gEv('invite_address') })
    ok(old.res.success && !(old.store.orders[0] || {}).giftMeta.claimMode && old.res.claimMode === undefined, 'A 旧版客户端（不带标记）：行为不变')
  }

  // ---------------- B~F manageGift
  function giftEnv(orders, users = []) {
    const { store, db } = makeDb({ orders, users, gift_receiver_verify: [], content_display_flags: [{ _id: 'f1', status: 'active', priority: 1, showGift: true }] })
    const sdk = { init() {}, DYNAMIC_CURRENT_ENV: 'env', database: () => db, getWXContext: () => ({ OPENID: '' }), callFunction: async () => ({ result: { success: true } }) }
    const main = load(P.gift, {
      stubs: {
        'wx-server-sdk': sdk,
        crypto: NODE_CRYPTO,
        './sourceOrigin': { isNonClientSource: () => false, isClientSource: () => true },
        './inAppMessage': { dispatchInAppMessage: async () => ({ success: true }) },
        './staffGuard': { assertStaff: async () => ({ ok: false }) },
        './giftSubscribe': { notifyGiftSubscribe: async () => ({}) }
      }
    }).main
    // 每次调用独立的身份（并发用例需要）
    const call = (who, ev) => {
      sdk.getWXContext = () => ({ OPENID: who })
      const p = main(ev)
      return p
    }
    const o = (id = 'L1') => store.orders.find((x) => x._id === id)
    return { store, call, o }
  }

  // B 打开不算领取 / 主动收下 / 不要求注册 / 一人一份
  {
    const env = giftEnv([linkOrder()])
    const share = await env.call(RECV, { action: 'getShare', token: 'tokA', orderId: 'L1' })
    ok(share.success && share.gift && share.gift.claimMode === 'link' && share.gift.claimPending === true && !env.o().giftMeta.receiverOpenid,
      'B 打开礼笺不算领取：getShare 不绑定，标「待收下」')
    const bind = await env.call(RECV, { action: 'bindReceiver', token: 'tokA', orderId: 'L1', source: 'receive_page' })
    ok(!bind.success && bind.code === 'CLAIM_CONFIRM_REQUIRED' && !env.o().giftMeta.receiverOpenid, 'B 进页自动绑定（不带 confirm）不得把礼记到访客名下')
    const addr = await env.call(RECV, { action: 'submitAddress', token: 'tokA', orderId: 'L1', address: { name: '王小满', phone: PHONE, detail: 'x' } })
    ok(!addr.success && env.o().giftMeta.addressStatus !== 'submitted', 'B 没点「收下」不能直接留地址')
    const acc = await env.call(RECV, { action: 'accept', token: 'tokA', orderId: 'L1', claimName: '  小  满 ' })
    const m = env.o().giftMeta
    ok(acc.success && m.receiverOpenid === RECV && m.acceptStatus === 'accepted' && m.receiverBoundSource === 'claim_link' && m.claimName === '小 满',
      'B 未注册（无 users 记录）也能主动收下；称呼去多余空白后记下')
    const acc2 = await env.call(RECV2, { action: 'accept', token: 'tokA', orderId: 'L1' })
    const bind2 = await env.call(RECV2, { action: 'bindReceiver', token: 'tokA', orderId: 'L1', confirm: true })
    ok(!acc2.success && !bind2.success && env.o().giftMeta.receiverOpenid === RECV, 'B 一份礼只能一个微信身份收下：第二人收下 / 确认绑定均被拒')
    const info = await env.call(GIVER, { action: 'getReceiverVerify', orderId: 'L1' })
    ok(info.success && info.claimMode === 'link' && info.claimer && info.claimer.label.startsWith('小 满') && !!info.claimer.at, 'E 送礼人看到领取人：称呼 + 收下时间')
    const self = await env.call(GIVER, { action: 'accept', token: 'tokA', orderId: 'L1' })
    ok(!self.success, 'B 送礼人不能收下自己的礼')
  }
  {
    // 并发：两人同时点「收下」只一人成功
    const env = giftEnv([linkOrder()])
    const [r1, r2] = await Promise.all([
      env.call(RECV, { action: 'accept', token: 'tokA', orderId: 'L1' }),
      env.call(RECV2, { action: 'accept', token: 'tokA', orderId: 'L1' })
    ])
    const winners = [r1, r2].filter((r) => r && r.success).length
    const owner = env.o().giftMeta.receiverOpenid
    ok(winners === 1 && ((r1.success && owner === RECV) || (r2.success && owner === RECV2)), 'B 并发收下：两人同时点只一人成功，礼记在成功者名下')
    const env2 = giftEnv([linkOrder({ deliveryType: 'store_pickup', claimCode: '135790' }, { status: 'paid' })])
    const [p1, p2] = await Promise.all([
      env2.call(RECV, { action: 'bindReceiver', token: 'tokA', orderId: 'L1', confirm: true }),
      env2.call(RECV2, { action: 'bindReceiver', token: 'tokA', orderId: 'L1', confirm: true })
    ])
    ok([p1, p2].filter((r) => r && r.success).length === 1, 'B 并发收下（门店自提）：只一人成功')
  }
  {
    // 自提：收下前不出领取码；未注册者也能收下
    const env = giftEnv([linkOrder({ deliveryType: 'store_pickup', claimCode: '135790' }, { status: 'paid' })])
    const s1 = await env.call(RECV, { action: 'getShare', token: 'tokA', orderId: 'L1' })
    ok(s1.success && !s1.gift.claimCode && !JSON.stringify(s1).includes('135790'), 'B 自提：收下前不出门店领取码')
    const b = await env.call(RECV, { action: 'bindReceiver', token: 'tokA', orderId: 'L1', confirm: true, claimName: '' })
    const s2 = await env.call(RECV, { action: 'getShare', token: 'tokA', orderId: 'L1' })
    ok(b.success && s2.gift.claimCode === '135790', 'B 自提：主动收下后出领取码')
    const info = await env.call(GIVER, { action: 'getReceiverVerify', orderId: 'L1' })
    ok(info.claimer && info.claimer.label === '未留名的微信用户', 'E 没留称呼、未注册：送礼人看到「未留名的微信用户」')
  }

  // C 口令
  {
    const env = giftEnv([linkOrder()])
    const set = await env.call(GIVER, { action: 'setClaimPasscode', orderId: 'L1', enable: true })
    const code = set.passcode
    ok(set.success && /^\d{6}$/.test(code || '') && env.o().giftMeta.claimPasscode === true && !JSON.stringify(env.o()).includes(code),
      'C 送礼人加口令：订单只记布尔，口令只回给送礼人')
    const share = await env.call(RECV, { action: 'getShare', token: 'tokA', orderId: 'L1' })
    ok(share.gift.passcodeRequired === true && !JSON.stringify(share).includes(code), 'C 受礼人看到「需要口令」，但拿不到口令本身')
    const skip = await env.call(RECV, { action: 'accept', token: 'tokA', orderId: 'L1' })
    ok(!skip.success && skip.code === 'VERIFY_REQUIRED' && skip.verifyKind === 'passcode' && !env.o().giftMeta.receiverOpenid, 'C 未过口令不得收下')
    const wrong = code === '000000' ? '000001' : '000000'
    const bad = await env.call(RECV, { action: 'verifyReceiver', token: 'tokA', orderId: 'L1', method: 'passcode', passcode: wrong })
    ok(!bad.success && bad.code === 'PASSCODE_MISMATCH' && !env.o().giftMeta.receiverOpenid && !JSON.stringify(bad).includes(code), 'C 口令错：不绑定、不回显口令')
    const env2 = giftEnv([linkOrder({ claimPasscode: true })])
    env2.store.gift_receiver_verify.push({ _id: 'L1', orderId: 'L1', passcode: '424242', attempts: [], verifiedOpenid: '' })
    for (let i = 0; i < 5; i++) await env2.call(RECV2, { action: 'verifyReceiver', token: 'tokA', orderId: 'L1', method: 'passcode', passcode: '111111' })
    const locked = await env2.call(RECV2, { action: 'verifyReceiver', token: 'tokA', orderId: 'L1', method: 'passcode', passcode: '424242' })
    ok(!locked.success && locked.code === 'VERIFY_LOCKED', 'C 口令连错 5 次锁 1 小时（与手机号核验同一套限次）')
    const good = await env.call(RECV, { action: 'verifyReceiver', token: 'tokA', orderId: 'L1', method: 'passcode', passcode: code })
    ok(good.success && !env.o().giftMeta.receiverOpenid, 'C 口令通过只记核验人，不等于收下（仍须点「收下」）')
    const other = await env.call(RECV2, { action: 'accept', token: 'tokA', orderId: 'L1' })
    ok(!other.success && other.code === 'VERIFY_REQUIRED', 'C 别人过了口令，不等于我也过了')
    const acc = await env.call(RECV, { action: 'accept', token: 'tokA', orderId: 'L1' })
    ok(acc.success && env.o().giftMeta.receiverOpenid === RECV, 'C 口令通过后点收下 → 收下成功')
    const late = await env.call(GIVER, { action: 'setClaimPasscode', orderId: 'L1', enable: false })
    ok(!late.success, 'C 对方收下后口令不能再改')
  }

  // D 作废并换新链接
  {
    const env = giftEnv([linkOrder({ claimPasscode: true })])
    env.store.gift_receiver_verify.push({ _id: 'L1', orderId: 'L1', passcode: '424242', attempts: [], verifiedOpenid: RECV })
    await env.call(RECV, { action: 'accept', token: 'tokA', orderId: 'L1', claimName: '冒领者' })
    ok(env.o().giftMeta.receiverOpenid === RECV, 'D 前置：已有人收下')
    const stranger = await env.call(RECV2, { action: 'resetShareLink', orderId: 'L1' })
    ok(!stranger.success && env.o().giftMeta.shareToken === 'tokA', 'D 只有送礼人可以作废链接')
    const r = await env.call(GIVER, { action: 'resetShareLink', orderId: 'L1' })
    const m = env.o().giftMeta
    ok(r.success && r.shareToken && r.shareToken !== 'tokA' && m.shareToken === r.shareToken && r.sharePath.includes(r.shareToken), 'D 作废后发新链接')
    ok(!m.receiverOpenid && m.acceptStatus === 'none' && !m.claimName, 'D 作废后原领取人解绑')
    const vd = env.store.gift_receiver_verify.find((x) => x._id === 'L1') || {}
    ok(/^\d{6}$/.test(r.passcode || '') && vd.passcode === r.passcode && !vd.verifiedOpenid, 'D 有口令的礼：作废时换新口令，旧核验记录清空')
    const oldTok = await env.call(RECV, { action: 'accept', token: 'tokA', orderId: 'L1' })
    const oldShare = await env.call(RECV, { action: 'getShare', token: 'tokA', orderId: 'L1' })
    ok(!oldTok.success && !env.o().giftMeta.receiverOpenid && !(oldShare.success && oldShare.gift && oldShare.gift.shareToken === r.shareToken), 'D 旧链接即刻失效：不能再收下，也拿不到新链接')
    await env.call(RECV2, { action: 'verifyReceiver', token: r.shareToken, orderId: 'L1', method: 'passcode', passcode: r.passcode })
    const nw = await env.call(RECV2, { action: 'accept', token: r.shareToken, orderId: 'L1' })
    ok(nw.success && env.o().giftMeta.receiverOpenid === RECV2, 'D 新链接 + 新口令可正常收下')
    env.o().giftMeta.addressStatus = 'submitted'
    const late = await env.call(GIVER, { action: 'resetShareLink', orderId: 'L1' })
    ok(!late.success && late.code === 'NOT_RESETTABLE' && env.o().giftMeta.receiverOpenid === RECV2, 'D 对方已留地址：不可再作废')
    const pick = giftEnv([linkOrder({ deliveryType: 'store_pickup', claimCode: '135790', claimStatus: 'claimed' }, { status: 'ready_pickup' })])
    ok(!(await pick.call(GIVER, { action: 'resetShareLink', orderId: 'L1' })).success, 'D 已到店领取：不可再作废')
    const phoneGift = giftEnv([linkOrder({ claimMode: '', receiverVerify: true })])
    ok(!(await phoneGift.call(GIVER, { action: 'resetShareLink', orderId: 'L1' })).success, 'D 手机号定向礼赠不走作废换链接（行为不变）')
  }

  // F 清号 = 转为凭礼笺领取（只限填址 / 自提）
  {
    const env = giftEnv([linkOrder({ claimMode: '', receiverVerify: true })])
    const clr = await env.call(GIVER, { action: 'setReceiverPhone', orderId: 'L1', phone: '' })
    ok(clr.success && env.o().giftMeta.claimMode === 'link' && env.o().giftMeta.receiverVerify === false, 'F 邀请填址清号 → 转为凭礼笺领取（不再是谁先打开谁领）')
    const after = await env.call(RECV, { action: 'bindReceiver', token: 'tokA', orderId: 'L1', source: 'receive_page' })
    ok(!after.success && !env.o().giftMeta.receiverOpenid, 'F 转为凭礼笺领取后，打开礼笺仍不自动领取')
    const set = await env.call(GIVER, { action: 'setReceiverPhone', orderId: 'L1', phone: PHONE })
    ok(set.success && env.o().giftMeta.receiverVerify === true && !env.o().giftMeta.claimMode, 'F 再填号 → 回到手机号核验')
    const ship = giftEnv([linkOrder({ claimMode: '', receiverVerify: true, deliveryType: 'ship_to_receiver' }, { status: 'paid' })])
    const no = await ship.call(GIVER, { action: 'setReceiverPhone', orderId: 'L1', phone: '' })
    ok(!no.success && no.code === 'PHONE_REQUIRED' && ship.o().giftMeta.receiverVerify === true, 'F 直寄 TA：不允许清号')
  }

  // ---------------- G 客户端接线
  const cjs = read(P.composeJs)
  const cm = cjs.match(/const CLAIM_LINK_DELIVERY = (\[[^\]]*\])/)
  ok(!!cm && JSON.stringify(eval(cm[1])) === JSON.stringify(PL.CLAIM_LINK_DELIVERY), 'G 送礼页免填号的交付方式须与云端 CLAIM_LINK_DELIVERY 同值')
  const co = read(P.confirmOrder)
  ok(co.includes("giftClaimMode: giftClaimLink ? 'link' : undefined,") && co.includes("if (dt !== 'invite_address' && dt !== 'store_pickup') return null"), 'G 确认页：只在填址 / 自提时带「凭礼笺领取」')
  const succ = read(P.successJs)
  ok(/if \(gift\.claimMode === 'link'\) wx\.hideShareMenu\(\{ menus: \['shareTimeline'\] \}\)/.test(succ) && succ.includes("const token = this.data.claimLink ? '' :"), 'G 送礼成功页：凭礼笺领取不发朋友圈，朋友圈卡不带领取凭证')
  const od = read(P.orderDetailJs)
  ok(od.includes("if (this.data.giftClaimLink) wx.hideShareMenu({ menus: ['shareTimeline'] });") && od.includes("const token = this.data.giftClaimLink ? '' :"), 'G 订单详情：凭礼笺领取不发朋友圈，朋友圈卡不带领取凭证')
  const rv = read(P.receiveJs)
  const abl = fnBody(rv, 'acceptByLink')
  ok(abl.length > 0 && !/requirePhone|requireRegistered|navigateToOnboarding/.test(abl) && abl.includes("action: 'accept', claimName") && abl.includes("action: 'bindReceiver', confirm: true"), 'G 领取页：凭礼笺领取的「收下」不走注册门、主动确认')
  const reg = fnBody(rv, '_maybeShowRegCard')
  ok(/if \(registered\) return\n\s+this\.setData\(\{ regCardShow: true \}\)/.test(reg) && reg.includes('REG_CARD_OFF_KEY') && rv.includes('wx.setStorageSync(REG_CARD_OFF_KEY'), 'G 注册引导卡：只给未注册者，「先不注册」后不再出现')
  ok(read(P.receiveWxml).includes('bindclose="onRegCardClose"'), 'G 注册引导卡：可关闭')
  ok(read(P.privacyGuard).includes("js: 'miniprogram/subpackages/feature/gift/reg-card/index.js'"), 'G 注册引导卡须在协议主动勾选守卫名单内（check:privacy-consent）')
  const rc = read(P.regCardJs)
  ok(!/registerWithPhone\(/.test(rc.replace(fnBody(rc, 'onGetPhoneNumber'), '')), 'G 注册引导卡：注册只能发生在用户点授权按钮之后（不得静默注册）')
  {
    const RV = load(P.receiverVerify, { globals: { wx: {}, getApp: () => ({}) } })
    ok(RV.sheetCopy({ receiverVerify: true, phoneTail: '1234', linkEligible: true }).clearText.includes('凭礼笺领取') &&
      RV.sheetCopy({ receiverVerify: true, phoneTail: '1234', linkEligible: false }).clearText === '', 'G 「不设核验」入口改为「改为凭礼笺领取」，只在填址 / 自提出现')
  }
  const mp = read(P.mpSchema)
  const ad = read(P.adminSchema)
  EVENTS.forEach((e) => ok(mp.includes(`  ${e}: {`) && ad.includes(`  ${e}: {`), `G 埋点 ${e} 须在小程序与 ERP 两份 schema 登记`))
  ok(EVENTS.every((e) => rv.includes(`'${e}'`) || rc.includes(`'${e}'`)), 'G 领取页 / 注册引导卡须实际上报 7 个新埋点')
  return fails
}

const INJECTIONS = [
  { name: '进页自动绑定不再要求确认', file: P.gift, find: 'if (claimLink && event.confirm !== true) {', replace: 'if (false) {' },
  { name: '收下不做条件写入（并发两人都成功）', file: P.gift, find: ",\n    'giftMeta.receiverOpenid': _.or(_.exists(false), _.in(['', null]))", replace: '' },
  { name: '口令门失效', file: P.gift, find: 'if (isClaimLink(order)) return passcodeGate(order, openid)', replace: 'if (isClaimLink(order)) return null' },
  { name: '口令不比对', file: P.gift, find: 'if (given !== doc.passcode) {', replace: 'if (false) {' },
  { name: '口令通过即绑定', file: P.gift, find: "data: { verifiedOpenid: openid, verifiedAt: db.serverDate(), verifyMethod: 'passcode', attempts: failures }\n  })", replace: "data: { verifiedOpenid: openid, verifiedAt: db.serverDate(), verifyMethod: 'passcode', attempts: failures }\n  })\n  await db.collection('orders').doc(order._id).update({ data: { 'giftMeta.receiverOpenid': openid } })" },
  { name: '作废不换令牌', file: P.gift, find: "'giftMeta.shareToken': shareToken,", replace: "'giftMeta.shareToken': oldToken," },
  { name: '作废不解绑原领取人', file: P.gift, find: "    'giftMeta.receiverOpenid': '',\n    'giftMeta.receiverBoundAt': null,", replace: "    'giftMeta.receiverBoundAt': null," },
  { name: '作废不重置口令核验记录', file: P.gift, find: '  if (meta.claimPasscode) passcode = createPasscode()\n  await db.collection(GIFT_VERIFY_COL)', replace: '  if (meta.claimPasscode) passcode = createPasscode()\n  if (false) await db.collection(GIFT_VERIFY_COL)' },
  { name: '收下前也出自提领取码', file: P.gift, find: "      gift.claimCode = ''\n      gift.claimQrPayload = ''\n      gift.claimPending = true", replace: '      gift.claimPending = true' },
  { name: '直寄也可清号', file: P.gift, find: "    if (!claimLinkAllowed(meta.deliveryType)) {\n      return { success: false, code: 'PHONE_REQUIRED'", replace: "    if (false) {\n      return { success: false, code: 'PHONE_REQUIRED'" },
  { name: '免填号放开到所有交付方式', file: [P.phoneLib, P.phoneLibCopy], find: 'return CLAIM_LINK_DELIVERY.indexOf(deliveryType) !== -1', replace: 'return true' },
  { name: '口令写进订单', file: P.makeOrder, find: "claimMode: 'link', claimPasscode: !!claimPasscode }", replace: "claimMode: 'link', claimPasscode: claimPasscode }" },
  { name: '送礼页免填号多了直寄', file: P.composeJs, find: "const CLAIM_LINK_DELIVERY = ['invite_address', 'store_pickup']", replace: "const CLAIM_LINK_DELIVERY = ['invite_address', 'store_pickup', 'ship_to_receiver']" },
  { name: '成功页朋友圈仍带领取凭证', file: P.successJs, find: "const token = this.data.claimLink ? '' : String", replace: 'const token = String' },
  { name: '订单详情不隐藏朋友圈', file: P.orderDetailJs, find: "if (this.data.giftClaimLink) wx.hideShareMenu({ menus: ['shareTimeline'] });", replace: '' },
  { name: '凭礼笺收下前强制注册', file: P.receiveJs, find: '  async acceptByLink() {\n', replace: "  async acceptByLink() {\n    if (!(await require('../../../../utils/userSession').requirePhone(getApp(), {}))) return\n" },
  { name: '已注册者也弹注册引导', file: P.receiveJs, find: '    if (registered) return\n    this.setData({ regCardShow: true })', replace: '    this.setData({ regCardShow: true })' },
  { name: '注册引导卡静默注册', file: P.regCardJs, find: '    onClose() {\n', replace: "    onClose() {\n      registerWithPhone({ app: getApp(), phoneCode: 'x' })\n" },
  { name: '「不设核验」在直寄也出现', file: P.receiverVerify, find: 'clearText: on && state.linkEligible ?', replace: 'clearText: on ?' },
  { name: 'ERP 漏登记注册引导完成事件', file: P.adminSchema, find: '  gift_reg_guide_done: {', replace: '  gift_reg_guide_done_x: {' }
]

async function main() {
  if (process.argv.includes('--selftest')) {
    const base = await runChecks()
    if (base.length) {
      console.error('✗ 自检前置：基线本身不通过\n  ' + base.join('\n  '))
      process.exit(1)
    }
    let missed = 0
    for (const inj of INJECTIONS) {
      INJECT = inj
      let fails
      try {
        fails = await runChecks()
      } catch (e) {
        fails = [`运行异常：${e.message}`]
      }
      INJECT = null
      if (fails.some((f) => f.startsWith('运行异常：注入锚点失效'))) { missed += 1; console.error(`  ✗ 锚点失效「${inj.name}」`) } else if (fails.length) console.log(`  ✓ 检出「${inj.name}」→ ${fails[0]}`)
      else { missed += 1; console.error(`  ✗ 未检出「${inj.name}」`) }
    }
    if (missed) {
      console.error(`✗ check:gift-claim-link 自检：${missed} 条注入未检出`)
      process.exit(1)
    }
    console.log(`✓ check:gift-claim-link 自检通过（${INJECTIONS.length} 条内存注入全部检出，未写盘）`)
    return
  }
  const fails = await runChecks()
  if (fails.length) {
    console.error('✗ 礼赠凭礼笺领取守卫失败：\n  ' + fails.join('\n  '))
    process.exit(1)
  }
  console.log('✓ 礼赠凭礼笺领取：免填号只限填址 / 自提（直寄仍必填、旧版不变）· 打开不算领取、须主动收下、不要求注册 · 一份一人（含并发）· 口令门与限次 · 作废换链接旧链即失效 · 送礼人见领取人不见完整号码 · 不发朋友圈 · 注册引导可关且守协议勾选 · 7 个埋点双端登记')
}

main().then(
  () => process.stdout.write('', () => process.exit()),
  (e) => { console.error(e); process.exit(1) }
)
