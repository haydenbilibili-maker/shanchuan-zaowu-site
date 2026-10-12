#!/usr/bin/env node
/**
 * 礼赠 · 凭礼笺领取守卫（蓝图 miniprogram/docs/礼赠凭礼笺领取_2026-10-11.md）
 *
 * 用**真源码** + 桩数据库跑 makeOrder / manageGift（不联网、不写盘）：
 *   A 下单：只有新版客户端（带 gift_claim_link_v1）+ 填址 / 自提 / 寄给我才可免填号；直寄 TA 仍必填；带号即走手机号核验；
 *     旧版客户端行为不变；口令只进核验集合（orders 登录可读）
 *   B 领取：打开不算领取（getShare 不绑定、不出自提领取码）；bindReceiver 不带 confirm 不绑定；填址前须先收下；
 *     收下**不要求注册**（无 users 记录也能收）；一份礼只一个微信身份（含并发两人同时收下只一人成功）
 *   C 口令：未过口令不得收下；错口令不绑定、限次；口令不出现在受礼人可见数据里；口令通过不等于收下
 *   D 作废并换新链接：旧链接即刻失效、原领取人解绑、口令重置；对方填址 / 到店领取后不可作废；只有送礼人可作废
 *   E 送礼人看到领取人：称呼 / 「未留名的微信用户」+ 收下时间；不出完整号码
 *   F 「不设核验」后门已改为「转为凭礼笺领取」：只限填址 / 自提 / 寄给我，直寄 TA 拒绝清号；设号即回到手机号核验
 *   S 寄给我（第三轮 §10）：同一套收下规则；作废 / 口令窗口放宽到订单结束前（含已签收），其它交付方式窗口不变
 *   G 客户端接线：送礼页免填号交付方式与云端同值；凭礼笺领取不发朋友圈（成功页 / 订单详情）；领取页收下不走注册门；
 *     注册引导卡只给未注册者、可关、在协议勾选守卫名单内；7 个新埋点双端登记
 *   H 犒劳自己：交付固定寄给我，与「寄给我」同一块地址卡（第五轮起在送礼页第 3 步选地址，号码 = 收货手机号）
 *   R 交付方式重排（2026-10-12 第五轮，蓝图 §14）：带 gift_delivery_v2 时自提不核验（订单照常有自提码、持链接的 TA 看得到）、
 *     直寄 TA 号码取收货地址手机号、寄给我不带号即凭礼笺领取、只有邀请填址仍要核验；不带新标记的旧版客户端一律照旧；
 *     确认页带出送礼页选好的地址（不被默认地址覆盖，直寄 TA 不套用我的默认地址），号码取收货手机号
 *   P 代填收货地址（2026-10-12 旁路 proxySubmitAddress）：只有店长及以上 / 下单人本人能代填；代填后按普通待发货可发货；
 *     不认定受礼人、留痕；过期不可代填；受礼人原填址路径不变；送礼成功页按核验号码 = 本人判定「犒劳自己」
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
  composeWxml: resolve(MP, 'subpackages/feature/gift/compose/index.wxml'),
  claimSheetWxml: resolve(MP, 'subpackages/feature/gift/claim-sheet/index.wxml'),
  confirmOrder: resolve(MP, 'subpackages/business/confirm-order/index.js'),
  receiverVerify: resolve(MP, 'subpackages/feature/gift/receiverVerify.js'),
  shipGiftMeta: resolve(MP, 'cloudfunctions/managerShipOrder/giftMeta.js'),
  proxySheetJs: resolve(MP, 'subpackages/feature/gift/proxy-address-sheet/index.js'),
  managerWxml: resolve(MP, 'subpackages/manager/manager/workspace/_subviews.wxml'),
  managerPageJson: resolve(MP, 'subpackages/manager/manager/workspace/index.json'),
  successWxml: resolve(MP, 'subpackages/feature/gift/success/index.wxml'),
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
  remove: () => ({ $op: 'remove' }),
  set: (v) => v
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
const STAFF = 'o_staff'
/** 店员权限校验时可挂起：用来确定性地复现「店员读单后、写入前，受礼人先交了地址」 */
let STAFF_GATE = null
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
  ok(JSON.stringify(PL.CLAIM_LINK_DELIVERY) === JSON.stringify(['invite_address', 'store_pickup', 'ship_to_self']), 'A 免填号的交付方式只能是「邀请 TA 填地址」「门店自提」「寄给我」（直寄 TA 必填）')
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
  const gEv = (deliveryType) => ({ source: 'gift', giftMeta: { deliveryType, recipientName: '小满', cardBody: '生日快乐', ...(deliveryType === 'store_pickup' ? { storeId: 's1', storeName: '山海造物' } : {}) },
    ...(deliveryType.startsWith('ship_') ? { address: { name: '阿山', phone: '13900002222', region: ['上海市', '上海市', '静安区'], detail: '某路 1 号' } } : {}) })
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
    const direct = await makeOrder({ ...gEv('ship_to_receiver'), ...BOTH, giftClaimMode: 'link' })
    ok(!direct.res.success && direct.res.code === 'GIFT_RECEIVER_PHONE_REQUIRED' && !direct.store.orders.length, 'A 直寄 TA：仍必须填受礼人手机号')
    const selfLink = await makeOrder({ ...gEv('ship_to_self'), ...BOTH, giftClaimMode: 'link' })
    const so = selfLink.store.orders[0] || {}
    ok(selfLink.res.success && so.giftMeta && so.giftMeta.claimMode === 'link' && !so.giftMeta.receiverVerify && !so.giftMeta.expireAt,
      'A 寄给我 + 凭礼笺领取：不填号也能下单，不带过期时间（货在送礼人手里，不退款）')
    const selfNoCap = await makeOrder({ ...gEv('ship_to_self'), clientCaps: [PL.GIFT_PHONE_CAP], giftClaimMode: 'link' })
    ok(!selfNoCap.res.success && selfNoCap.res.code === 'GIFT_RECEIVER_PHONE_REQUIRED', 'A 寄给我 + 不带凭礼笺能力标记：仍必须填号（旧版行为不变）')
    const selfPhone = await makeOrder({ ...gEv('ship_to_self'), ...BOTH, giftReceiverPhone: PHONE })
    const sp = selfPhone.store.orders[0] || {}
    ok(selfPhone.res.success && sp.giftMeta.receiverVerify === true && !sp.giftMeta.claimMode, 'A 寄给我 + 填了号：仍是手机号定向（行为不变）')
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
    // 站内信出口：记下每次 dispatchMessage / writeDirect；mode 可改成 'fail'（派发返回失败）/ 'throw'（派发与直写都抛错）
    const msg = { fn: [], direct: [], mode: 'ok' }
    const sdk = {
      init() {}, DYNAMIC_CURRENT_ENV: 'env', database: () => db, getWXContext: () => ({ OPENID: '' }),
      callFunction: async (req) => {
        msg.fn.push(req)
        if (msg.mode === 'throw') throw new Error('dispatchMessage 不可用')
        return { result: { success: msg.mode !== 'fail' } }
      }
    }
    const main = load(P.gift, {
      stubs: {
        'wx-server-sdk': sdk,
        crypto: NODE_CRYPTO,
        './sourceOrigin': { isNonClientSource: () => false, isClientSource: () => true },
        './inAppMessage': {
          dispatchInAppMessage: async () => ({ success: true }),
          writeDirect: async (_db, payload) => {
            msg.direct.push(payload)
            if (msg.mode === 'throw') throw new Error('直写失败')
            return { success: true, fallback: true }
          }
        },
        './staffGuard': {
          assertStaff: async (_db, who, opts) => (STAFF_GATE ? await STAFF_GATE : null, who === STAFF && opts && opts.role === 'manager'
            ? { ok: true, actor: { openid: STAFF, name: '店长甲', workspaceRole: 'manager' } }
            : { ok: false, code: 'FORBIDDEN', msg: '该操作仅店长可用' })
        },
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
    const notices = () => msg.fn.filter((r) => r && r.name === 'dispatchMessage' && r.data && r.data.eventType === 'gift_address_proxied')
    return { store, call, o, msg, notices }
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

  // S 寄给我 + 凭礼笺领取（第三轮，蓝图 §10）：同一套收下规则，作废 / 口令窗口放宽到订单结束前
  {
    const env = giftEnv([linkOrder({ deliveryType: 'ship_to_self', expireAt: null }, { status: 'shipped' })])
    const bind = await env.call(RECV, { action: 'bindReceiver', token: 'tokA', orderId: 'L1', source: 'receive_page' })
    ok(!bind.success && bind.code === 'CLAIM_CONFIRM_REQUIRED' && !env.o().giftMeta.receiverOpenid, 'S 寄给我：打开礼笺不算领取')
    const pc = await env.call(GIVER, { action: 'setClaimPasscode', orderId: 'L1', enable: true })
    ok(pc.success && /^\d{6}$/.test(pc.passcode || ''), 'S 寄给我：已发货仍可加口令（无人收下前）')
    await env.call(RECV, { action: 'verifyReceiver', token: 'tokA', orderId: 'L1', method: 'passcode', passcode: pc.passcode })
    const [b1, b2] = await Promise.all([
      env.call(RECV, { action: 'bindReceiver', token: 'tokA', orderId: 'L1', confirm: true, claimName: '小满' }),
      env.call(RECV2, { action: 'bindReceiver', token: 'tokA', orderId: 'L1', confirm: true })
    ])
    ok(b1.success && !b2.success && env.o().giftMeta.receiverOpenid === RECV, 'S 寄给我：过口令 + 主动收下才记在名下，一份只一人')
    env.o().status = 'received'
    const info = await env.call(GIVER, { action: 'getReceiverVerify', orderId: 'L1' })
    ok(info.success && info.canReset === true && info.linkEligible === true && /订单结束前/.test(info.resetHint || '') && info.claimer && info.claimer.label.startsWith('小满'),
      'S 寄给我：签收后送礼人仍可作废（货在送礼人手里），面板给出作废时限说明并看到领取人')
    const r = await env.call(GIVER, { action: 'resetShareLink', orderId: 'L1' })
    ok(r.success && !env.o().giftMeta.receiverOpenid && env.o().giftMeta.shareToken !== 'tokA', 'S 寄给我：签收后作废换链接，原领取人解绑')
    env.o().status = 'refunded'
    ok(!(await env.call(GIVER, { action: 'resetShareLink', orderId: 'L1' })).success, 'S 寄给我：订单已结束（退款）不可再作废')
    const pick = giftEnv([linkOrder({ deliveryType: 'store_pickup', claimCode: '135790' }, { status: 'received' })])
    const pinfo = await pick.call(GIVER, { action: 'getReceiverVerify', orderId: 'L1' })
    ok(!(await pick.call(GIVER, { action: 'resetShareLink', orderId: 'L1' })).success && pinfo.canReset === false && !pinfo.resetHint,
      'S 自提 / 填址的作废窗口不随寄给我放宽（签收后不可作废，无寄给我说明）')
    const selfPhone = giftEnv([linkOrder({ claimMode: '', receiverVerify: true, deliveryType: 'ship_to_self' }, { status: 'paid' })])
    const clr = await selfPhone.call(GIVER, { action: 'setReceiverPhone', orderId: 'L1', phone: '' })
    ok(clr.success && selfPhone.o().giftMeta.claimMode === 'link', 'S 寄给我清号 → 转为凭礼笺领取（不是谁先打开谁领）')
  }

  // F 清号 = 转为凭礼笺领取（只限填址 / 自提 / 寄给我）
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
  ok(co.includes("giftClaimMode: giftClaimLink ? 'link' : undefined,") && co.includes("if (dt !== 'invite_address' && dt !== 'store_pickup' && dt !== 'ship_to_self') return null"), 'G 确认页：只在填址 / 自提 / 寄给我时带「凭礼笺领取」')
  const cw = read(P.composeWxml)
  ok(cw.includes("<view id=\"receiverPhoneField\" class=\"verify-set {{receiverPhoneError ? 'is-error' : ''}}\" wx:if=\"{{deliveryType === 'invite_address'}}\">") &&
    cw.includes('<text class="claim-switch" bindtap="toggleClaimLink">不知道号码？凭礼笺领取 ›</text>') && cw.includes('受礼人手机号 <text class="verify-set-tip">推荐填写</text>'),
    'G 送礼页：领取核验只在邀请填址出现（手机号推荐填写，可切凭礼笺领取）')
  ok(read(P.claimSheetWxml).includes("{{state.resetHint || "), 'G 管理面板：作废时限说明取云端 resetHint（寄给我与其它交付方式不同）')
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
  ok(/patch: nickName \? \{ nickName, agreedTermsAt \} : \{ agreedTermsAt \}/.test(rc) && rc.includes("patch: { agreedTermsAt }, completeOnboarding: true"), 'G 注册引导卡：两条建档路径都留协议同意时间（与注册页同口径）')
  {
    const RV = load(P.receiverVerify, { globals: { wx: {}, getApp: () => ({}) } })
    ok(RV.sheetCopy({ receiverVerify: true, phoneTail: '1234', linkEligible: true }).clearText.includes('凭礼笺领取') &&
      RV.sheetCopy({ receiverVerify: true, phoneTail: '1234', linkEligible: false }).clearText === '', 'G 「不设核验」入口改为「改为凭礼笺领取」，只在可免填号的交付方式出现')
  }
  const mp = read(P.mpSchema)
  const ad = read(P.adminSchema)
  EVENTS.forEach((e) => ok(mp.includes(`  ${e}: {`) && ad.includes(`  ${e}: {`), `G 埋点 ${e} 须在小程序与 ERP 两份 schema 登记`))
  ok(EVENTS.every((e) => rv.includes(`'${e}'`) || rc.includes(`'${e}'`)), 'G 领取页 / 注册引导卡须实际上报 7 个新埋点')

  // ---------------- H 犒劳自己：交付固定寄给我，地址与手机号按普通下单在确认页填（2026-10-12）
  const methods = (src, names, globals) => {
    const body = names.map((n) => { const b = fnBody(src, n); return b ? `${b}\n  },` : '' }).join('\n')
    try {
      return new Function(...Object.keys(globals), `return {${body}\n}`)(...Object.values(globals))
    } catch (e) {
      return null
    }
  }
  {
    const page = methods(cjs, ['enterSelfTreat', 'exitSelfTreat', '_syncShipAddress'], {})
    const st = { selfTreat: false, deliveryType: 'store_pickup', storePickupEnabled: true, claimLink: true, claimPasscode: true, showOtherDelivery: true, activeNotePresetId: 'self',
      receiverAddress: { name: 'TA' }, selfAddress: { name: '我' }, shipAddress: null }
    const ctx = page && Object.assign(Object.create(page), { data: st, setData(p) { Object.assign(st, p) } })
    if (ctx) ctx.enterSelfTreat()
    ok(!!ctx && st.selfTreat === true && st.deliveryType === 'ship_to_self' && st.claimLink === false && st.claimPasscode === false,
      'H 选「犒劳自己」：交付须固定为寄给我，并关掉凭礼笺领取')
    ok(!!ctx && st.shipAddress === st.selfAddress, 'H 选「犒劳自己」：地址卡显示我的收货地址（与寄给我同一份）')
    if (ctx) ctx.exitSelfTreat()
    ok(!!ctx && st.selfTreat === false && st.deliveryType === 'store_pickup' && st.shipAddress === null, 'H 退出「犒劳自己」：恢复原来的交付方式（门店自提不显示地址）')
  }
  ok(/<block wx:if="\{\{selfTreat\}\}">[\s\S]*?<\/block>\s*<block wx:else>[\s\S]*?data-type="invite_address"[\s\S]*?id="receiverPhoneField"[\s\S]*?<\/block>\s*<!--[\s\S]*?-->\s*<view id="shipAddressField"[^>]*wx:if="\{\{selfTreat \|\| deliveryType === 'ship_to_receiver' \|\| deliveryType === 'ship_to_self'\}\}">/.test(cw),
    'H 送礼页：「犒劳自己」时不显示邀请填址与受礼人手机号，与寄给我共用同一块地址卡')
  const gp = fnBody(cjs, 'goPay')
  ok(gp.includes("const deliveryType = selfTreat ? 'ship_to_self'") && gp.includes('selfTreat, productId: p._id') &&
    gp.includes("      : deliveryType === 'ship_to_self' && !selfTreat\n") && gp.includes("const receiverPhone = invite && !claimLink ? String(this.data.receiverPhone || '') : ''"),
    'H 送礼页下单：「犒劳自己」走寄给我、免填受礼人手机号并把标记交给确认页；寄给我送给别人自动凭礼笺领取')
  {
    let g = null
    const co2 = methods(co, ['pendingGiftReceiverPhone', 'pendingGiftSelfTreat', 'giftUsesAddressPhone'], { getApp: () => ({ globalData: { giftReceiverPhone: g } }) })
    const mk = (dt, phone) => co2 && Object.assign(Object.create(co2), { _giftMeta: { deliveryType: dt }, data: { isGiftOrder: true, address: phone ? { name: '阿山', phone } : null } })
    g = { phone: '', claimLink: false, selfTreat: true, at: Date.now() }
    ok(!!co2 && mk('ship_to_self', '139 0000 2222').pendingGiftReceiverPhone() === '13900002222', 'H 确认页：「犒劳自己」的领取核验号码取收货地址手机号')
    ok(!!co2 && mk('ship_to_self', '').pendingGiftReceiverPhone() === '', 'H 确认页：「犒劳自己」未填收货手机号不得放行')
    ok(!!co2 && mk('invite_address', '13900002222').pendingGiftSelfTreat() === false, 'H 确认页：「犒劳自己」标记只对寄给我生效')
    g = { phone: '13700001111', claimLink: false, selfTreat: false, at: Date.now() }
    ok(!!co2 && mk('ship_to_self', '13900002222').pendingGiftReceiverPhone() === '13700001111', 'H 确认页：普通寄给我仍用送礼页填的受礼人手机号')
    g = { phone: '', claimLink: false, selfTreat: false, at: Date.now() }
    ok(!!co2 && mk('ship_to_receiver', '139-0000-3333').pendingGiftReceiverPhone() === '13900003333' && mk('ship_to_receiver', '021-6666666').pendingGiftReceiverPhone() === '',
      'R 确认页：快递给 TA 的领取核验号码取收货地址手机号（非 11 位手机号不得放行）')
    ok(!!co2 && mk('store_pickup', '13900002222').pendingGiftReceiverPhone() === '' && mk('store_pickup', '').giftUsesAddressPhone() === false, 'R 确认页：门店自提不取号码')
  }
  const dso = fnBody(co, 'doSubmitOrder')
  const sbo = fnBody(co, 'submitOrder')
  ok(dso.indexOf('!giftReceiverPhone && this.giftUsesAddressPhone()) return') !== -1 && dso.indexOf('!giftReceiverPhone && this.giftUsesAddressPhone()) return') < dso.indexOf('this.backToGiftPhone()') &&
    sbo.includes("const shipPhoneBad = !!(address && address.phone) && this.giftUsesAddressPhone() && !this.pendingGiftReceiverPhone()") && sbo.includes('|| shipPhoneBad)) {'),
    'H 确认页：「犒劳自己」/ 快递给 TA 缺收货手机号就地提示，不退回送礼页找受礼人手机号')
  ok(/if \(this\.data\.isGiftInvite\) \{\n\s+this\.backToGiftPhone\(\)\n\s+\} else \{\n\s+this\.modal\(/.test(dso),
    'R 确认页：云端判缺号时只有邀请填址退回送礼页，其余交付方式就地提示改收货手机号')

  // ---------------- P 代填收货地址（旁路 proxySubmitAddress）
  {
    const SG = load(P.shipGiftMeta, { stubs: { crypto: NODE_CRYPTO } })
    const ADDR = { name: '王小满', phone: '139 0000 2222', region: ['上海市', '上海市', '静安区'], detail: '某路 1 号' }
    const inviteOrder = (meta = {}, over = {}) => linkOrder({ claimMode: '', receiverVerify: false, ...meta }, over)
    const env = giftEnv([inviteOrder()])
    const no1 = await env.call(RECV, { action: 'proxySubmitAddress', by: 'staff', orderId: 'L1', address: ADDR })
    const no2 = await env.call(GIVER, { action: 'proxySubmitAddress', by: 'staff', orderId: 'L1', address: ADDR })
    ok(!no1.success && !no2.success && no1.code === 'FORBIDDEN' && env.o().giftMeta.addressStatus !== 'submitted' && env.o().status === 'paid_awaiting_address',
      'P 非店员（含下单人冒充店员）不能以店员身份代填')
    const no3 = await env.call(RECV, { action: 'proxySubmitAddress', by: 'giver', orderId: 'L1', address: ADDR })
    const no4 = await env.call(STAFF, { action: 'proxySubmitAddress', by: 'giver', orderId: 'L1', address: ADDR })
    ok(!no3.success && !no4.success && no3.code === 'NOT_GIVER' && env.o().giftMeta.addressStatus !== 'submitted', 'P 非下单人不能以下单人身份代填')
    ok(SG.needsAddressBeforeShip(env.o()), 'P 前置：未填址的礼赠发货端判「待填址禁发货」')
    const st = await env.call(STAFF, { action: 'proxySubmitAddress', by: 'staff', orderId: 'L1', address: ADDR, reason: '顾客到店口述' })
    const o = env.o()
    ok(st.success && o.status === 'paid' && o.giftMeta.addressStatus === 'submitted' && o.address && o.address.phone === '13900002222' && o.address.region.length === 3 &&
      !SG.needsAddressBeforeShip(o), 'P 店员代填后：订单回到待发货、发货端不再拦截（可填快递单号）')
    ok(!o.giftMeta.receiverOpenid && o.giftMeta.acceptStatus === 'none', 'P 代填不认定受礼人（不写 receiverOpenid / acceptStatus）')
    const pr = o.giftMeta.addressProxy || {}
    const log = (env.store.staff_audit_logs || [])[0] || {}
    ok(pr.by === 'staff' && pr.openid === STAFF && pr.reason === '顾客到店口述' && !!pr.at && log.action === 'gift_proxy_address' && log.relatedId === 'L1' && log.openid === STAFF,
      'P 店员代填留痕：订单记谁 / 何时 / 原因，并写操作记录')
    const again = await env.call(STAFF, { action: 'proxySubmitAddress', by: 'staff', orderId: 'L1', address: { ...ADDR, name: '别人' } })
    ok(again.success && again.already && env.o().address.name === '王小满', 'P 已有地址：再次代填不覆盖')
    const late = await env.call(RECV, { action: 'submitAddress', token: 'tokA', orderId: 'L1', address: { ...ADDR, name: '受礼人' } })
    ok(late.success && late.already && env.o().address.name === '王小满', 'P 代填后受礼人再填：按「已提交」处理，不覆盖')
    const acc = await env.call(RECV, { action: 'accept', token: 'tokA', orderId: 'L1' })
    ok(acc.success && env.o().giftMeta.receiverOpenid === RECV, 'P 代填后 TA 仍可凭礼笺收下（礼记在 TA 名下）')

    const g = giftEnv([inviteOrder()])
    const gv = await g.call(GIVER, { action: 'proxySubmitAddress', by: 'giver', orderId: 'L1', address: ADDR })
    ok(gv.success && g.o().status === 'paid' && g.o().giftMeta.addressStatus === 'submitted' && (g.o().giftMeta.addressProxy || {}).by === 'giver' && !g.o().giftMeta.receiverOpenid,
      'P 下单人本人可填写收货地址，记为本人代填')
    const ex = giftEnv([inviteOrder({ expireAt: new Date(Date.now() - 1000) })])
    const exr = await ex.call(STAFF, { action: 'proxySubmitAddress', by: 'staff', orderId: 'L1', address: ADDR })
    ok(!exr.success && exr.code === 'EXPIRED' && ex.o().giftMeta.addressStatus !== 'submitted', 'P 已过填址期限：不可代填（等退款，不偷偷改发货）')
    const ship = giftEnv([inviteOrder({ deliveryType: 'ship_to_receiver' }, { status: 'paid' })])
    ok(!(await ship.call(STAFF, { action: 'proxySubmitAddress', by: 'staff', orderId: 'L1', address: ADDR })).success, 'P 只对「邀请 TA 填地址」的礼赠开放')

    const race = giftEnv([inviteOrder()])
    let open
    STAFF_GATE = new Promise((res) => { open = res })
    const pending = race.call(STAFF, { action: 'proxySubmitAddress', by: 'staff', orderId: 'L1', address: { ...ADDR, name: '店员录入' } })
    await tick(); await tick()
    const recv = await race.call(RECV, { action: 'submitAddress', token: 'tokA', orderId: 'L1', address: { ...ADDR, name: '受礼人' } })
    open(); STAFF_GATE = null
    const pr2 = await pending
    ok(recv.success && pr2.success && pr2.already && (race.o().address || {}).name === '受礼人' && !race.o().giftMeta.addressProxy,
      'P 并发：店员读单后受礼人先交了地址 → 代填不覆盖（条件写入）')

    const r = giftEnv([inviteOrder()])
    const rs = await r.call(RECV, { action: 'submitAddress', token: 'tokA', orderId: 'L1', address: { ...ADDR, phone: '13900002222' } })
    ok(rs.success && r.o().status === 'paid' && r.o().giftMeta.addressStatus === 'submitted' && r.o().giftMeta.receiverOpenid === RECV &&
      r.o().giftMeta.acceptStatus === 'accepted' && !r.o().giftMeta.addressProxy, 'P 受礼人原填址路径不变：仍认定受礼人、不记代填')

    const selfEnv = giftEnv([inviteOrder({ receiverVerify: true })], [{ _id: 'u1', _openid: GIVER, phone: '13800001234' }])
    selfEnv.store.gift_receiver_verify.push({ _id: 'L1', ...PL.buildVerifyDoc('L1', GIVER, PHONE, new Date()) })
    const sv = await selfEnv.call(GIVER, { action: 'getGiverShare', orderId: 'L1' })
    const other = giftEnv([inviteOrder({ receiverVerify: true })], [{ _id: 'u1', _openid: GIVER, phone: '13700009999' }])
    other.store.gift_receiver_verify.push({ _id: 'L1', ...PL.buildVerifyDoc('L1', GIVER, PHONE, new Date()) })
    const ov = await other.call(GIVER, { action: 'getGiverShare', orderId: 'L1' })
    ok(sv.success && sv.gift.selfTreat === true && ov.success && ov.gift.selfTreat === false, 'P 犒劳自己判定：核验号码 = 下单人手机才算自己收')
  }
  ok(/wx:elif="\{\{item\.giftAwaitingAddress\}\}">\s*<view[^>]*catchtap="openProxyAddress"[^>]*>代填地址<\/view>/.test(read(P.managerWxml)) &&
    read(P.managerPageJson).includes('"proxy-address-sheet": "/subpackages/feature/gift/proxy-address-sheet/index"'), 'P 店员订单管理：待填址订单有「代填地址」按钮与代填面板')
  ok(read(P.proxySheetJs).includes("action: 'proxySubmitAddress',") && /<proxy-address-sheet[\s\S]*?by="giver"/.test(read(P.successWxml)) &&
    /bindtap="openProxySheet"\s*wx:if="\{\{canProxyAddress && selfTreat\}\}"/.test(read(P.successWxml)), 'P 送礼成功页：犒劳自己时「填写我的收货地址」为主按钮，走代填旁路')

  // ---------------- Q 店员代填成功 → 给送礼人一条站内信（2026-10-12 产品负责人点名，旁路）
  {
    const ADDR = { name: '王小满', phone: '139 0000 2222', region: ['上海市', '上海市', '静安区'], detail: '某路 1 号' }
    const inviteOrder = (meta = {}, over = {}) => linkOrder({ claimMode: '', receiverVerify: false, ...meta }, over)
    const env = giftEnv([inviteOrder()])
    await env.call(STAFF, { action: 'proxySubmitAddress', by: 'staff', orderId: 'L1', address: ADDR, reason: '顾客到店口述' })
    const n = env.notices()
    const d = (n[0] && n[0].data) || {}
    ok(n.length === 1 && d.action === 'dispatch' && d.openid === GIVER && d.relatedId === 'L1' && d.category === 'order' &&
      d.title === '收货地址已由客服代填' && d.content.startsWith('礼物收货地址已由客服代为填写，即将安排发货') && d.content.includes('SH20261011001') && d.content.includes('光明女神闪蝶') &&
      d.actionUrl === 'subpackages/business/order-detail/index?id=L1' && Array.isArray(d.vars && d.vars.products) && env.msg.direct.length === 0,
      'Q 店员代填成功：经现有 dispatchMessage 给送礼人发一条站内信（显式标题 / 正文 / 跳订单详情，带商品卡）')
    await env.call(STAFF, { action: 'proxySubmitAddress', by: 'staff', orderId: 'L1', address: { ...ADDR, name: '别人' } })
    ok(env.notices().length === 1, 'Q 同一订单重复代填（已提交）不再发第二条')
    const g = giftEnv([inviteOrder()])
    await g.call(GIVER, { action: 'proxySubmitAddress', by: 'giver', orderId: 'L1', address: ADDR })
    ok(g.notices().length === 0 && g.msg.direct.length === 0, 'Q 送礼人本人填写：不给自己发')
    const deny = giftEnv([inviteOrder({ expireAt: new Date(Date.now() - 1000) })])
    await deny.call(STAFF, { action: 'proxySubmitAddress', by: 'staff', orderId: 'L1', address: ADDR })
    await deny.call(RECV, { action: 'proxySubmitAddress', by: 'staff', orderId: 'L1', address: ADDR })
    ok(deny.notices().length === 0 && deny.msg.direct.length === 0, 'Q 代填未成功（过期 / 非店员）不发')
    const fb = giftEnv([inviteOrder()])
    fb.msg.mode = 'fail'
    const warn0 = console.warn
    console.warn = () => {}
    let fr = {}
    try { fr = await fb.call(STAFF, { action: 'proxySubmitAddress', by: 'staff', orderId: 'L1', address: ADDR }) } finally { console.warn = warn0 }
    const w = fb.msg.direct[0] || {}
    ok(fr.success && fb.notices().length === 1 && fb.msg.direct.length === 1 && w.eventType === 'gift_address_proxied' && w.openid === GIVER && w.relatedId === 'L1' &&
      w.title === '收货地址已由客服代填' && w.actionUrl === 'subpackages/business/order-detail/index?id=L1',
      'Q 消息分发不可用：退回共享件 writeDirect 直写同一条（同一去重键）')
    const bad = giftEnv([inviteOrder()])
    bad.msg.mode = 'throw'
    const quiet = { error: console.error, warn: console.warn }
    console.error = console.warn = () => {}
    let br = {}
    try { br = await bad.call(STAFF, { action: 'proxySubmitAddress', by: 'staff', orderId: 'L1', address: ADDR }) } finally { Object.assign(console, quiet) }
    ok(br.success && !br.already && bad.o().giftMeta.addressStatus === 'submitted' && bad.o().status === 'paid', 'Q 站内信发送失败（含兜底也失败）不影响代填结果')
    ok(!['manageGift', 'makeOrder', 'payCallback', 'confirmPayment'].some((f) => read(resolve(MP, `cloudfunctions/${f}/inAppMessage.js`)).includes('gift_address_proxied')) &&
      !read(resolve(MP, 'cloudfunctions/dispatchMessage/templates.js')).includes('gift_address_proxied'),
      'Q 新增旁路：不往共享件 inAppMessage / dispatchMessage 模板里加类型（显式标题直发）')
  }

  // ---------------- R 交付方式重排（2026-10-12 第五轮，蓝图 §14）：新标记 gift_delivery_v2
  {
    const V2 = { clientCaps: [PL.GIFT_PHONE_CAP, PL.GIFT_CLAIM_LINK_CAP, PL.GIFT_DELIVERY_V2_CAP] }
    ok(PL.GIFT_DELIVERY_V2_CAP === 'gift_delivery_v2', 'R 新能力标记须为 gift_delivery_v2')
    const pk = await makeOrder({ ...gEv('store_pickup'), ...V2 })
    const po = pk.store.orders[0] || {}
    ok(pk.res.success && po.giftMeta && !po.giftMeta.receiverVerify && !po.giftMeta.claimMode && !(pk.store.gift_receiver_verify || []).length,
      'R 门店自提（新版）：不要号码、不走凭礼笺，不写核验集合')
    ok(/^[0-9A-F]{10}$/.test(po.giftMeta.claimCode || '') && po.giftMeta.claimStatus === 'ready', 'R 门店自提（新版）：下单即有自提码（与主单自取码同格式）')
    const pkLink = await makeOrder({ ...gEv('store_pickup'), ...V2, giftClaimMode: 'link', giftClaimPasscode: true })
    ok(pkLink.res.success && !(pkLink.store.orders[0] || {}).giftMeta.claimMode && !(pkLink.store.gift_receiver_verify || []).length, 'R 门店自提（新版）：即使带了凭礼笺参数也不核验')
    const ship = await makeOrder({ ...gEv('ship_to_receiver'), ...V2 })
    const so = ship.store.orders[0] || {}
    const vd = (ship.store.gift_receiver_verify || [])[0] || {}
    ok(ship.res.success && so.giftMeta.receiverVerify === true && !so.giftMeta.claimMode && vd.phoneHash === PL.hashPhone(vd.salt, '13900002222'),
      'R 快递给 TA（新版）：不传受礼人手机号也能下单，领取核验号码 = 收货地址手机号')
    const badPhone = await makeOrder({ ...gEv('ship_to_receiver'), ...V2, address: { name: '阿山', phone: '021-66666666', region: ['上海市', '上海市', '静安区'], detail: '某路 1 号' } })
    ok(!badPhone.res.success && badPhone.res.code === 'GIFT_RECEIVER_PHONE_REQUIRED' && !badPhone.store.orders.length, 'R 快递给 TA（新版）：收货电话不是 11 位手机号 → 拒绝（确认页就地提示）')
    const self = await makeOrder({ ...gEv('ship_to_self'), ...V2 })
    const sfo = self.store.orders[0] || {}
    ok(self.res.success && sfo.giftMeta.claimMode === 'link' && !sfo.giftMeta.receiverVerify, 'R 寄给我（新版）：不带号自动凭礼笺领取（TA 收下才记在 TA 名下）')
    const treat = await makeOrder({ ...gEv('ship_to_self'), ...V2, giftReceiverPhone: '13900002222' })
    ok(treat.res.success && (treat.store.orders[0] || {}).giftMeta.receiverVerify === true, 'R 犒劳自己（新版）：号码 = 收货手机号，手机号核验')
    const inv = await makeOrder({ ...gEv('invite_address'), ...V2 })
    ok(!inv.res.success && inv.res.code === 'GIFT_RECEIVER_PHONE_REQUIRED', 'R 邀请填址（新版）：仍要领取核验（手机号或凭礼笺领取）')
    const invLink = await makeOrder({ ...gEv('invite_address'), ...V2, giftClaimMode: 'link' })
    ok(invLink.res.success && (invLink.store.orders[0] || {}).giftMeta.claimMode === 'link', 'R 邀请填址（新版）：凭礼笺领取照旧')
    // 旧版客户端（不带 gift_delivery_v2）：判定一字不变
    const oldPk = await makeOrder({ ...gEv('store_pickup'), ...BOTH })
    ok(!oldPk.res.success && oldPk.res.code === 'GIFT_RECEIVER_PHONE_REQUIRED', 'R 旧版：门店自提不带号也不带凭礼笺 → 照旧拒绝')
    const oldPkPhone = await makeOrder({ ...gEv('store_pickup'), ...BOTH, giftReceiverPhone: PHONE })
    ok(oldPkPhone.res.success && (oldPkPhone.store.orders[0] || {}).giftMeta.receiverVerify === true, 'R 旧版：门店自提带号 → 照旧手机号核验')
    const oldShip = await makeOrder({ ...gEv('ship_to_receiver'), ...BOTH })
    ok(!oldShip.res.success && oldShip.res.code === 'GIFT_RECEIVER_PHONE_REQUIRED', 'R 旧版：快递给 TA 不带号 → 照旧拒绝（不偷偷取地址手机号）')
    const oldSelf = await makeOrder({ ...gEv('ship_to_self'), ...BOTH })
    ok(!oldSelf.res.success && oldSelf.res.code === 'GIFT_RECEIVER_PHONE_REQUIRED', 'R 旧版：寄给我不带号也不带凭礼笺 → 照旧拒绝')
    const oldShipPhone = await makeOrder({ ...gEv('ship_to_receiver'), ...BOTH, giftReceiverPhone: PHONE })
    ok(oldShipPhone.res.success && (oldShipPhone.store.orders[0] || {}).giftMeta.receiverVerify === true, 'R 旧版：快递给 TA 带号 → 照旧下单')

    // 新版自提单：持有效链接的 TA 看得到自提码（可转交）；没有链接看不到
    const env = giftEnv([linkOrder({ deliveryType: 'store_pickup', claimMode: '', receiverVerify: false, claimCode: 'A1B2C3D4E5', claimStatus: 'ready', storeId: 's1', storeName: '山海造物' }, { status: 'paid' })])
    const withTok = await env.call(RECV, { action: 'getShare', token: 'tokA', orderId: 'L1' })
    const noTok = await env.call(RECV2, { action: 'getShare', token: '', orderId: 'L1' })
    ok(withTok.success && withTok.gift.claimCode === 'A1B2C3D4E5' && withTok.gift.claimQrPayload === 'GIFT:A1B2C3D4E5' && !noTok.gift.claimCode,
      'R 门店自提（新版）：自提码随礼笺转交——持有效链接可见，无链接不可见')
    const old = giftEnv([linkOrder({ deliveryType: 'store_pickup', claimMode: '', receiverVerify: true, claimCode: 'A1B2C3D4E5', claimStatus: 'ready' }, { status: 'paid' })])
    ok(!(await old.call(RECV, { action: 'getShare', token: 'tokA', orderId: 'L1' })).gift.claimCode, 'R 历史自提单（带手机号核验）：核验通过前仍不出码（历史订单不变）')

    // 确认页：送礼页第 3 步选好的地址
    let gsa = null
    const co3 = methods(co, ['pendingGiftShipAddress'], { getApp: () => ({ globalData: { giftShipAddress: gsa } }) })
    const A = { name: '王小满', phone: '13900002222', region: ['上海市'], detail: 'x' }
    const items = [{ productId: 'p1' }]
    gsa = { address: A, deliveryType: 'ship_to_receiver', productId: 'p1', at: Date.now() }
    ok(!!co3 && co3.pendingGiftShipAddress('ship_to_receiver', items) === A, 'R 确认页：带出送礼页选好的地址')
    ok(!!co3 && co3.pendingGiftShipAddress('ship_to_self', items) === null && co3.pendingGiftShipAddress('ship_to_receiver', [{ productId: 'p2' }]) === null,
      'R 确认页：交付方式或藏品对不上不带地址')
    gsa = { ...gsa, at: Date.now() - 3 * 3600e3 }
    ok(!!co3 && co3.pendingGiftShipAddress('ship_to_receiver', items) === null, 'R 确认页：超过 2 小时不带地址')
    const init = fnBody(co, 'initPayload')
    const lda = fnBody(co, 'loadDefaultAddress')
    ok(init.includes('...(presetAddress ? { address: this.formatAddress(presetAddress) } : {}),') &&
      init.includes("this._giftAddressPreset = !!presetAddress || (isGiftOrder && deliveryType === 'ship_to_receiver')") &&
      /async loadDefaultAddress\(\) \{\n\s+if \(this\._giftAddressPreset\) return\n/.test(lda) && lda.includes('if (!result.success || this._giftAddressPreset) return'),
      'R 确认页：带来的地址不被默认地址覆盖；快递给 TA 不套用我的默认地址')
    ok(init.includes('支付后生成自提码，可转交 TA，到店出示由专员核销') && init.includes("ship_to_receiver: '快递给 TA'") && init.includes("'犒劳自己 · 寄给我'"),
      'R 确认页：门店自提说明自提码；交付标签与送礼页一致')
  }
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
  { name: '送礼页免填号多了直寄', file: P.composeJs, find: "const CLAIM_LINK_DELIVERY = ['invite_address', 'store_pickup', 'ship_to_self']", replace: "const CLAIM_LINK_DELIVERY = ['invite_address', 'store_pickup', 'ship_to_self', 'ship_to_receiver']" },
  { name: '寄给我免填号被撤回（云端）', file: [P.phoneLib, P.phoneLibCopy], find: "const CLAIM_LINK_DELIVERY = ['invite_address', 'store_pickup', 'ship_to_self']", replace: "const CLAIM_LINK_DELIVERY = ['invite_address', 'store_pickup']" },
  { name: '确认页寄给我不带凭礼笺', file: P.confirmOrder, find: " && dt !== 'ship_to_self') return null", replace: ") return null" },
  { name: '领取核验又对所有交付方式出现', file: P.composeWxml, find: "class=\"verify-set {{receiverPhoneError ? 'is-error' : ''}}\" wx:if=\"{{deliveryType === 'invite_address'}}\">", replace: "class=\"verify-set {{receiverPhoneError ? 'is-error' : ''}}\">" },
  { name: '寄给我作废窗口退回发货前', file: P.gift, find: "const SELF_CLAIM_OPEN_STATUS = ['paid', 'shipped', 'received']", replace: "const SELF_CLAIM_OPEN_STATUS = ['paid']" },
  { name: '作废窗口对所有交付方式放宽', file: P.gift, find: '(self ? SELF_CLAIM_OPEN_STATUS : CLAIM_OPEN_STATUS)', replace: 'SELF_CLAIM_OPEN_STATUS' },
  { name: '寄给我作废窗口含已退款', file: P.gift, find: "const SELF_CLAIM_OPEN_STATUS = ['paid', 'shipped', 'received']", replace: "const SELF_CLAIM_OPEN_STATUS = ['paid', 'shipped', 'received', 'refunded']" },
  { name: '面板不取 resetHint', file: P.claimSheetWxml, find: "{{state.resetHint || ", replace: "{{" },
  { name: '成功页朋友圈仍带领取凭证', file: P.successJs, find: "const token = this.data.claimLink ? '' : String", replace: 'const token = String' },
  { name: '订单详情不隐藏朋友圈', file: P.orderDetailJs, find: "if (this.data.giftClaimLink) wx.hideShareMenu({ menus: ['shareTimeline'] });", replace: '' },
  { name: '凭礼笺收下前强制注册', file: P.receiveJs, find: '  async acceptByLink() {\n', replace: "  async acceptByLink() {\n    if (!(await require('../../../../utils/userSession').requirePhone(getApp(), {}))) return\n" },
  { name: '已注册者也弹注册引导', file: P.receiveJs, find: '    if (registered) return\n    this.setData({ regCardShow: true })', replace: '    this.setData({ regCardShow: true })' },
  { name: '注册引导卡静默注册', file: P.regCardJs, find: '    onClose() {\n', replace: "    onClose() {\n      registerWithPhone({ app: getApp(), phoneCode: 'x' })\n" },
  { name: '「不设核验」在直寄也出现', file: P.receiverVerify, find: 'clearText: on && state.linkEligible ?', replace: 'clearText: on ?' },
  { name: '注册引导卡不留协议同意时间', file: P.regCardJs, find: "patch: { agreedTermsAt }, completeOnboarding: true", replace: "patch: {}, completeOnboarding: true" },
  { name: 'ERP 漏登记注册引导完成事件', file: P.adminSchema, find: '  gift_reg_guide_done: {', replace: '  gift_reg_guide_done_x: {' },
  { name: '犒劳自己仍走邀请填址', file: P.composeJs, find: "      selfTreat: true,\n      deliveryType: 'ship_to_self',", replace: '      selfTreat: true,' },
  { name: '犒劳自己仍显示受礼人手机号', file: P.composeWxml, find: '      </view>\n      </block>\n', replace: '      </view>\n' },
  { name: '寄给我送给别人不再自动凭礼笺', file: P.composeJs, find: "      : deliveryType === 'ship_to_self' && !selfTreat\n", replace: '      : false\n' },
  { name: '快递 / 寄给我又要填受礼人手机号', file: P.composeJs, find: "const receiverPhone = invite && !claimLink ? String(this.data.receiverPhone || '') : ''", replace: "const receiverPhone = !claimLink ? String(this.data.receiverPhone || '') : ''" },
  { name: '犒劳自己地址卡显示成 TA 的地址', file: P.composeJs, find: "type === 'ship_to_receiver' ? this.data.receiverAddress : (type === 'ship_to_self' ? this.data.selfAddress : null)", replace: "type === 'ship_to_receiver' || type === 'ship_to_self' ? this.data.receiverAddress : null" },
  { name: '确认页犒劳自己不取收货手机号', file: P.confirmOrder, find: "      return /^1\\d{10}$/.test(addrPhone) ? addrPhone : ''", replace: "      return ''" },
  { name: '确认页犒劳自己缺号退回送礼页', file: P.confirmOrder, find: '    if (this.data.isGiftOrder && !giftReceiverPhone && this.giftUsesAddressPhone()) return\n', replace: '' },
  { name: '确认页犒劳自己收货手机号不校验', file: P.confirmOrder, find: ' || shipPhoneBad)) {', replace: ')) {' },
  { name: '确认页快递给 TA 不取收货手机号', file: P.confirmOrder, find: "    return this.pendingGiftSelfTreat() || ((this._giftMeta && this._giftMeta.deliveryType) || '') === 'ship_to_receiver'", replace: '    return this.pendingGiftSelfTreat()' },
  { name: '确认页云端缺号一律退回送礼页', file: P.confirmOrder, find: '        if (this.data.isGiftInvite) {\n          this.backToGiftPhone()', replace: '        if (true) {\n          this.backToGiftPhone()' },
  { name: '新版自提仍要核验', file: [P.phoneLib, P.phoneLibCopy], find: "    if (deliveryType === 'store_pickup') return { required: false, phone: '', claimLink: false }\n", replace: '' },
  { name: '新版快递不取地址手机号', file: [P.phoneLib, P.phoneLibCopy], find: ' || normalizeCnPhone(event.address && event.address.phone)', replace: '' },
  { name: '新版寄给我不自动凭礼笺', file: [P.phoneLib, P.phoneLibCopy], find: 'return { required: false, phone: selfPhone, claimLink: !selfPhone }', replace: 'return { required: !selfPhone, phone: selfPhone, claimLink: false }' },
  { name: '新版邀请填址也免核验', file: [P.phoneLib, P.phoneLibCopy], find: "    if (deliveryType === 'store_pickup') return { required: false, phone: '', claimLink: false }\n", replace: "    if (deliveryType === 'store_pickup' || deliveryType === 'invite_address') return { required: false, phone: '', claimLink: false }\n" },
  { name: '旧版也按新规则（不看标记）', file: [P.phoneLib, P.phoneLibCopy], find: '  if (clientHasDeliveryV2(event)) {', replace: '  if (true) {' },
  { name: '确认页不带出送礼页地址', file: P.confirmOrder, find: '      ...(presetAddress ? { address: this.formatAddress(presetAddress) } : {}),\n', replace: '' },
  { name: '确认页默认地址覆盖带来的地址', file: P.confirmOrder, find: '    if (this._giftAddressPreset) return\n    try {', replace: '    try {' },
  { name: '确认页快递给 TA 套用我的默认地址', file: P.confirmOrder, find: "this._giftAddressPreset = !!presetAddress || (isGiftOrder && deliveryType === 'ship_to_receiver')", replace: 'this._giftAddressPreset = !!presetAddress' },
  { name: '确认页带地址不比对交付方式', file: P.confirmOrder, find: '    if (g.deliveryType !== deliveryType) return null\n', replace: '' },
  { name: '确认页带地址不限时', file: P.confirmOrder, find: "    if (!g || !g.address || !g.address.name || !g.address.phone) return null\n    if (Date.now() - Number(g.at || 0) > 2 * 60 * 60 * 1000) return null\n", replace: "    if (!g || !g.address || !g.address.name || !g.address.phone) return null\n" },
  { name: '代填不校验店员', file: P.gift, find: "    if (!guard.ok) return { success: false, code: guard.code || 'FORBIDDEN', msg: guard.msg || '无操作权限' }\n    actor = guard.actor || {}", replace: '    actor = guard.actor || {}' },
  { name: '代填不校验下单人', file: P.gift, find: "    if (!isGiverOfOrder(order, openid)) {\n      return { success: false, code: 'NOT_GIVER'", replace: "    if (false) {\n      return { success: false, code: 'NOT_GIVER'" },
  { name: '代填后仍是待填址（不可发货）', file: P.gift, find: "        address: _.set(addressDoc),\n        'giftMeta.addressStatus': 'submitted',\n", replace: '        address: _.set(addressDoc),\n' },
  { name: '代填冒充受礼人', file: P.gift, find: "        'giftMeta.receiverPhoneMasked': maskPhone(addressDoc.phone),\n", replace: "        'giftMeta.receiverPhoneMasked': maskPhone(addressDoc.phone),\n        'giftMeta.receiverOpenid': openid,\n" },
  { name: '代填不留痕', file: P.gift, find: '        ...proxy\n', replace: '' },
  { name: '店员代填不写操作记录', file: P.gift, find: "      action: 'gift_proxy_address',", replace: "      action: '',"  },
  { name: '代填不判过期', file: P.gift, find: "  if (isExpired(order)) {\n    return { success: false, code: 'EXPIRED', msg: '填址期限已过", replace: "  if (false) {\n    return { success: false, code: 'EXPIRED', msg: '填址期限已过" },
  { name: '代填覆盖已提交地址', file: P.gift, find: "      'giftMeta.addressStatus': _.neq('submitted')\n    }).update({", replace: '    }).update({' },
  { name: '代填前清空地址不带条件（会抹掉受礼人刚交的地址）', file: P.gift, find: "await db.collection('orders').where({ _id: order._id, 'giftMeta.addressStatus': _.neq('submitted') })\n        .update({ data: { address: _.remove() } })", replace: "await db.collection('orders').doc(order._id).update({ data: { address: _.remove() } })" },
  { name: '受礼人填址不再认定受礼人', file: P.gift, find: "\n    'giftMeta.receiverOpenid': openid,\n    'giftMeta.addressStatus': 'submitted',", replace: "\n    'giftMeta.addressStatus': 'submitted'," },
  { name: '犒劳自己判定失效', file: P.gift, find: 'return phones.filter(Boolean).some((p) => hashPhone(doc.salt, p) === doc.phoneHash)', replace: 'return false' },
  { name: '店员端没有代填入口', file: P.managerWxml, find: 'catchtap="openProxyAddress"', replace: 'catchtap="noop"' },
  { name: '代填面板不走旁路动作', file: P.proxySheetJs, find: "action: 'proxySubmitAddress',", replace: "action: 'submitAddress'," },
  { name: '犒劳自己没有本人填址主按钮', file: P.successWxml, find: 'wx:if="{{canProxyAddress && selfTreat}}"', replace: 'wx:if="{{false}}"' },
  { name: '店员代填成功不发站内信', file: P.gift, find: '    await notifyGiverAddressProxied(order, openid)\n', replace: '' },
  { name: '送礼人本人填写也发', file: P.gift, find: '    await notifyGiverAddressProxied(order, openid)\n  }\n', replace: "  }\n  await notifyGiverAddressProxied(order, 'x')\n" },
  { name: '已提交仍重复发', file: P.gift, find: "    if (order.status === 'paid_awaiting_address') await ensureGiftAddressStatusPaid(order._id)\n    return { success: true, already: true, msg: '地址已提交' }", replace: "    if (order.status === 'paid_awaiting_address') await ensureGiftAddressStatusPaid(order._id)\n    if (by === 'staff') await notifyGiverAddressProxied(order, openid)\n    return { success: true, already: true, msg: '地址已提交' }" },
  { name: '分发失败不兜底直写', file: P.gift, find: '    return await writeDirect(db, {', replace: '    return null && writeDirect(db, {' },
  { name: '发送失败拖垮代填', file: P.gift, find: "    console.error('notifyGiverAddressProxied failed', order && order._id, e)\n    return { success: false }", replace: '    throw e' },
  { name: '站内信不跳订单详情', file: P.gift, find: 'actionUrl: `subpackages/business/order-detail/index?id=${order._id}`\n  }\n}', replace: "actionUrl: ''\n  }\n}" }
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
  console.log('✓ 礼赠凭礼笺领取：免填号只限填址 / 自提 / 寄给我（直寄仍必填、旧版不变）· 寄给我作废窗口到订单结束 · 打开不算领取、须主动收下、不要求注册 · 一份一人（含并发）· 口令门与限次 · 作废换链接旧链即失效 · 送礼人见领取人不见完整号码 · 不发朋友圈 · 注册引导可关且守协议勾选 · 7 个埋点双端登记 · 犒劳自己固定寄给我 · 交付重排（新标记 gift_delivery_v2）：只有邀请填址核验、快递号码取收货手机号、寄给我自动凭礼笺、自提不核验出自提码、确认页带出第 3 步地址、旧版一字不变')
}

main().then(
  () => process.stdout.write('', () => process.exit()),
  (e) => { console.error(e); process.exit(1) }
)
