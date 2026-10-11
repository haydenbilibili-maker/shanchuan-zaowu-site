#!/usr/bin/env node
/**
 * 礼赠 · 证书与养护闭环守卫（gift-print 域；蓝图 miniprogram/docs/礼赠_证书与养护闭环_2026-09-28.md）
 *
 * 用**真源码** + 桩数据库/桩 wx 跑以下判据（不联网、不写盘）：
 *   A 判据副本逐字同源：giftHolder.js（business + 两个云函数）、defaults.js（getCareSpecimens ↔ sendCareReminder）
 *   B 证书身份矩阵：送礼人 ≠ 受礼人；未签收 pending、退款/取消 void；非礼赠恒为 holder
 *   C 证书收藏夹（extra）的分类与 B 同口径
 *   D 证书页 + certDraw：送礼人画「赠予凭证」、受礼人画「收藏证书 + 由 X 赠予」；**非礼赠证书与改动前金样逐条相同**
 *     证书日期取固化签发时间（certMeta.issuedAt → 签收时间），不取 now；已固化且签名一致 → 直接展示图，不重绘；
 *     首次签发上传并 saveCertificate；矮屏按 560 设计高等比缩放（金样尺寸不变）
 *   E sendCareReminder：养护提醒只排/只发持有人；未绑定不排；终态作废；历史排给送礼人的改投持有人；
 *     补扫只补 14 日内；普通单（自动收货/自提核销）补排给下单人、券类不排；幂等（手动签收排过的不重排）；非礼赠 schedule 行为不变
 *   F getCareSpecimens：受礼人能读养护上下文、我的藏品含受赠、不含送出；非礼赠原样；
 *     saveCertificate 按证书身份鉴权、签发日首写固化为签收时间、同签名幂等
 *   G 触达点接线：订单详情 / 签收弹层 / 我的礼赠 / 领取页 / 送礼成功页 / 「我的」证书角标 / 领取页核验面板
 *   H confirmOrderReceipt（N1）：送礼人代点签收发「赠予凭证已签发」，不走「收藏证书已生成」；受礼人/普通单原样；覆盖失败回退原消息
 *   I manageGift 领取核验（N3）：设了号的礼赠未核验不得 bind/accept/submitAddress；失败不泄露号码；5 次/小时限次；
 *     送礼人不能核验/绑定；分享与列表数据无明文号码/哈希、未核验不出自提领取码；只有送礼人、只在领取前可设号；未设号的礼赠行为不变
 *   J 强制填写受礼人手机号（2026-09-28 拍板）：发起礼赠的入口只有送礼页（其它结算入口不得带 giftMeta）；送礼页必填 + 定位报错；
 *     确认页缺号退回、带能力标记与号码；makeOrder 新版标记缺号拒（GIFT_RECEIVER_PHONE_REQUIRED）、旧版不带标记不拒、
 *     「全量强制」开关默认关（常量 / 环境变量）；号码只进核验集合；未设号的送出礼赠有「建议补填」强提示
 *
 * 用法：node miniprogram/scripts/check-gift-holder.mjs [--selftest]
 * --selftest：对真源做**内存注入**（不改文件），每条注入都必须被检出。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadCjsModule } from './lib/cjs-loader.mjs'
import { makeRecorderCtx, makeStubCanvas } from './lib/canvas-recorder.mjs'

const NODE_CRYPTO = createRequire(import.meta.url)('crypto')
const HERE = dirname(fileURLToPath(import.meta.url))
const MP = resolve(HERE, '..')
const P = {
  holder: resolve(MP, 'subpackages/business/utils/giftHolder.js'),
  holderCopies: [
    resolve(MP, 'cloudfunctions/sendCareReminder/giftHolder.js'),
    resolve(MP, 'cloudfunctions/getCareSpecimens/giftHolder.js')
  ],
  defaultsSrc: resolve(MP, 'cloudfunctions/getCareSpecimens/defaults.js'),
  defaultsCopy: resolve(MP, 'cloudfunctions/sendCareReminder/defaults.js'),
  certDraw: resolve(MP, 'subpackages/business/certificate/certDraw.js'),
  certPage: resolve(MP, 'subpackages/business/certificate/index.js'),
  certList: resolve(MP, 'subpackages/extra/user/certificates/index.js'),
  reminder: resolve(MP, 'cloudfunctions/sendCareReminder/index.js'),
  specimens: resolve(MP, 'cloudfunctions/getCareSpecimens/index.js'),
  golden: resolve(HERE, 'fixtures/certHolderGolden.json'),
  orderDetailWxml: resolve(MP, 'subpackages/business/order-detail/index.wxml'),
  orderDetailJs: resolve(MP, 'subpackages/business/order-detail/index.js'),
  careHelper: resolve(MP, 'subpackages/business/utils/careHelper.js'),
  myGifts: resolve(MP, 'subpackages/feature/gift/my-gifts/index.js'),
  receiveJs: resolve(MP, 'subpackages/feature/gift/receive/index.js'),
  receiveWxml: resolve(MP, 'subpackages/feature/gift/receive/index.wxml'),
  successJs: resolve(MP, 'subpackages/feature/gift/success/index.js'),
  successWxml: resolve(MP, 'subpackages/feature/gift/success/index.wxml'),
  userPage: resolve(MP, 'pages/user/index.js'),
  confirmReceipt: resolve(MP, 'cloudfunctions/confirmOrderReceipt/index.js'),
  gift: resolve(MP, 'cloudfunctions/manageGift/index.js'),
  makeOrder: resolve(MP, 'cloudfunctions/makeOrder/index.js'),
  phoneLib: resolve(MP, 'cloudfunctions/makeOrder/giftReceiverPhone.js'),
  phoneLibCopy: resolve(MP, 'cloudfunctions/manageGift/giftReceiverPhone.js'),
  composeJs: resolve(MP, 'subpackages/feature/gift/compose/index.js'),
  composeWxml: resolve(MP, 'subpackages/feature/gift/compose/index.wxml'),
  confirmOrder: resolve(MP, 'subpackages/business/confirm-order/index.js'),
  cartJs: resolve(MP, 'pages/cart/index.js'),
  myGiftsWxml: resolve(MP, 'subpackages/feature/gift/my-gifts/index.wxml')
}

// ---------------------------------------------------------------- 桩数据库
function toMs(v) {
  if (!v) return 0
  if (typeof v === 'number') return v
  if (v instanceof Date) return v.getTime()
  const t = new Date(v).getTime()
  return Number.isFinite(t) ? t : 0
}
const _ = {
  in: (v) => ({ $op: 'in', v }),
  lte: (v) => ({ $op: 'lte', v }),
  gte: (v) => ({ $op: 'gte', v }),
  exists: (v) => ({ $op: 'exists', v }),
  remove: () => ({ $op: 'remove' }),
  or: (list) => ({ $or: list })
}
function setPath(doc, path, v) {
  const ks = path.split('.')
  let o = doc
  ks.slice(0, -1).forEach((k) => { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k] })
  if (v && v.$op === 'remove') delete o[ks[ks.length - 1]]
  else o[ks[ks.length - 1]] = v
}
function pick(doc, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), doc)
}
function match(doc, where) {
  if (where && where.$or) return where.$or.some((w) => match(doc, w))
  return Object.entries(where || {}).every(([k, c]) => {
    const val = pick(doc, k)
    if (c && c.$op === 'in') return c.v.includes(val)
    if (c && c.$op === 'lte') return val != null && toMs(val) <= toMs(c.v)
    if (c && c.$op === 'gte') return val != null && toMs(val) >= toMs(c.v)
    if (c && c.$op === 'exists') return (val !== undefined) === c.v
    return val === c
  })
}
function makeDb(seed = {}) {
  const store = {}
  for (const [k, rows] of Object.entries(seed)) store[k] = rows.map((r) => ({ ...r }))
  let seq = 0
  const col = (name) => {
    store[name] = store[name] || []
    const rows = store[name]
    const query = (where, sort, lim, off = 0) => ({
      where: (w) => query(w, sort, lim, off),
      orderBy: (f, dir) => query(where, { f, dir }, lim, off),
      limit: (n) => query(where, sort, n, off),
      skip: (n) => query(where, sort, lim, n),
      field: () => query(where, sort, lim, off),
      async get() {
        let list = rows.filter((r) => match(r, where))
        if (sort) list = list.slice().sort((a, b) => (toMs(pick(a, sort.f)) - toMs(pick(b, sort.f))) * (sort.dir === 'desc' ? -1 : 1))
        if (off) list = list.slice(off)
        if (lim) list = list.slice(0, lim)
        return { data: list.map((r) => ({ ...r })) }
      },
      async count() { return { total: rows.filter((r) => match(r, where)).length } }
    })
    return {
      ...query(null, null, 0),
      doc: (id) => ({
        async get() {
          const r = rows.find((x) => x._id === id)
          if (!r) throw new Error('document not exist')
          return { data: { ...r } }
        },
        async update({ data }) {
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

// ---------------------------------------------------------------- 夹具
const DAY = 24 * 60 * 60 * 1000
const GIVER = 'o_giver'
const RECV = 'o_recv'
const STRANGER = 'o_stranger'
const product = { id: 'p1', title: '光明女神闪蝶', latin: 'Morpho helena', image: 'https://example.com/a.jpg', rootCategoryName: '昆虫' }
function giftOrder(over = {}, meta = {}) {
  return {
    _id: 'g1', _openid: GIVER, openid: GIVER, source: 'gift', orderNo: 'SH20260928001', status: 'received',
    receiveTime: new Date(Date.now() - 1 * DAY), products: [product],
    giftMeta: { deliveryType: 'invite_address', receiverOpenid: RECV, cardSignature: '阿山', cardBody: '生日快乐', recipientName: '小满', ...meta },
    ...over
  }
}
const RECV2 = 'o_recv2'
const PHONE = '13800001234'
const plainOrder = (over = {}) => ({ _id: 'n1', _openid: GIVER, openid: GIVER, orderNo: 'SH20260928001', status: 'received', receiveTime: new Date(), products: [product], ...over })

// ---------------------------------------------------------------- 源码读取（注入点）
let INJECT = null
/** 注入可同时打到多份逐字副本（证明判据本身会红，而不是只被「副本漂移」拦下） */
function transform(file, src) {
  const targets = INJECT ? [].concat(INJECT.file) : []
  if (!targets.includes(file)) return src
  if (!src.includes(INJECT.find)) throw new Error(`注入锚点失效：${INJECT.name}`)
  return src.split(INJECT.find).join(INJECT.replace)
}
const UNHANDLED = []
process.on('unhandledRejection', (e) => { UNHANDLED.push(e) })
const read = (file) => transform(file, readFileSync(file, 'utf8'))
const load = (file, opts = {}) => loadCjsModule(file, { transform, ...opts })

// ---------------------------------------------------------------- 判据
async function runChecks() {
  const fails = []
  const ok = (cond, msg) => { if (!cond) fails.push(msg) }

  // A 副本
  const holderSrc = read(P.holder)
  P.holderCopies.forEach((f) => ok(read(f) === holderSrc, `A 副本漂移：${f.replace(MP, 'miniprogram')} 与 business/utils/giftHolder.js 不一致`))
  ok(read(P.defaultsCopy) === read(P.defaultsSrc), 'A 副本漂移：sendCareReminder/defaults.js 与 getCareSpecimens/defaults.js 不一致')

  // B 矩阵
  const H = load(P.holder)
  const role = (o, who) => H.resolveCertRole(o, who)
  ok(role(giftOrder(), GIVER) === 'giver', 'B 已签收礼赠：送礼人应为 giver（赠予凭证）')
  ok(role(giftOrder(), RECV) === 'holder', 'B 已签收礼赠：受礼人应为 holder（收藏证书）')
  ok(role(giftOrder(), GIVER) !== role(giftOrder(), RECV), 'B 送礼人与受礼人证书身份必须不同')
  ok(role(giftOrder({}, { receiverOpenid: '' }), GIVER) === 'giver', 'B 已签收未绑定：送礼人仍为 giver，不因无受礼人而变成持有人')
  ok(role(giftOrder({ status: 'shipped' }), GIVER) === 'pending' && role(giftOrder({ status: 'paid_awaiting_address' }), RECV) === 'pending', 'B 未签收礼赠：应为 pending')
  ok(['refunded', 'cancelled', 'void', 'expired_refunding'].every((s) => role(giftOrder({ status: s }), GIVER) === 'void' && role(giftOrder({ status: s }), RECV) === 'void'), 'B 退款/取消/过期：双方均为 void')
  ok(role(giftOrder(), STRANGER) === 'none', 'B 无关者应为 none')
  ok(['received', 'shipped', 'refunded', 'pending_pay'].every((s) => role(plainOrder({ status: s }), GIVER) === 'holder'), 'B 非礼赠单：下单人恒为 holder（与改动前一致）')
  ok(role(giftOrder({}, { receiverOpenid: GIVER }), GIVER) === 'holder', 'B 异常数据 receiverOpenid=送礼人：视为本人持有')
  ok(H.resolveHolderOpenid(giftOrder()) === RECV && H.resolveHolderOpenid(giftOrder({}, { receiverOpenid: '' })) === '' && H.resolveHolderOpenid(plainOrder()) === GIVER, 'B 持有人推导：礼赠=受礼人 / 未绑定=空 / 非礼赠=下单人')

  // C 收藏夹分类
  {
    let page = null
    const mod = loadCjsModule(P.certList, {
      transform: (f, s) => transform(f, s) + '\nmodule.exports.__certKindOf = certKindOf',
      stubs: { '../../../../config/cloudEnv': { cdnPath: (x) => x }, '../../utils/pageNav': { getPageNavInsets: () => ({}) } },
      globals: { getApp: () => ({ globalData: {} }), wx: { cloud: { database: () => ({}) } }, Page: (o) => { page = o } }
    })
    const kind = mod.__certKindOf
    ok(!!page && typeof kind === 'function', 'C 证书收藏夹页未能加载')
    if (kind) {
      ok(kind(plainOrder(), GIVER) === 'holder', 'C 非礼赠 → 收藏证书')
      ok(kind(giftOrder(), RECV) === 'gift_holder', 'C 受礼人 → 受赠收藏证书')
      ok(kind(giftOrder(), GIVER) === 'gift_voucher' && kind(giftOrder({}, { receiverOpenid: '' }), GIVER) === 'gift_voucher', 'C 送礼人（含未绑定）→ 赠予凭证')
    }
  }

  // D 证书页 + 绘制
  const golden = JSON.parse(readFileSync(P.golden, 'utf8'))
  const normDate = (ops) => ops.map((op) => op.map((a) => (typeof a === 'string' && /^\d{1,4}\.\d{1,2}\.\d{1,4}$/.test(a) ? 'DATE' : a)))
  const texts = (ops) => ops.filter((op) => op[0] === 'fillText').map((op) => op[1])
  const draw = load(P.certDraw)
  {
    const { ctx, ops } = makeRecorderCtx()
    await draw.drawHolderCert(ctx, golden.fixture.w, golden.fixture.h, golden.fixture.data, makeStubCanvas(), async (s) => s)
    ok(JSON.stringify(ops) === JSON.stringify(golden.ops), 'D 非礼赠收藏证书绘制与改动前金样不一致（非礼赠行为必须不变）')
  }
  async function renderPage(order, viewer) {
    const { db } = makeDb({ orders: [order], users: [{ _openid: viewer, nickName: viewer === RECV ? '林间小满' : '山海收藏家', level: 2 }] })
    let page = null
    let drawn = false
    const cloudCalls = []
    const { ctx, ops } = makeRecorderCtx()
    const canvas = { ...makeStubCanvas(), getContext: () => ctx }
    const wx = {
      cloud: {
        database: () => db,
        getTempFileURL: async ({ fileList }) => ({ fileList: fileList.filter((f) => /^cloud:\/\/certs\//.test(f)).map((f) => ({ fileID: f, tempFileURL: `https://tmp/${f.slice(8)}` })) }),
        uploadFile: async ({ cloudPath }) => { cloudCalls.push({ upload: cloudPath }); return { fileID: `cloud://env/${cloudPath}` } },
        callFunction: async ({ name, data }) => { cloudCalls.push({ name, ...data }); return { result: { success: true } } }
      },
      vibrateShort() {}, vibrateLong() {}, showToast() {}, navigateBack() {},
      getSystemInfoSync: () => ({ statusBarHeight: 20, pixelRatio: 1 }),
      createSelectorQuery: () => ({ select: () => ({ fields: () => ({ exec: (cb) => cb([{ node: canvas, width: golden.fixture.w, height: golden.fixture.h }]) }) }) }),
      canvasToTempFilePath: (o) => { drawn = true; if (o && o.success) o.success({ tempFilePath: '/tmp/cert.png' }) }
    }
    const app = { globalData: { openid: viewer } }
    load(P.certPage, {
      stubs: { './userSession': { isLocalLoggedOut: () => false } },
      globals: { getApp: () => app, wx, Page: (o) => { page = o } }
    })
    const inst = { ...page, data: { ...page.data }, setData(p) { Object.assign(this.data, p) } }
    const g = globalThis
    const prevWx = g.wx
    const prevGetApp = g.getApp
    g.wx = wx
    g.getApp = () => app
    try {
      inst.onLoad({ id: order._id })
      // 画完（canvasToTempFilePath）或落到「不签发」状态即停；上限 1.5s
      for (let t = 0; t < 150 && !drawn && !inst.data.certState && !inst.data.certImageUrl; t += 1) {
        await new Promise((r) => setTimeout(r, 10))
      }
      await new Promise((r) => setTimeout(r, 20))
      return { data: inst.data, ops: ops.filter((op) => op[0] !== 'scale'), drawn, cloudCalls }
    } finally {
      g.wx = prevWx
      g.getApp = prevGetApp
    }
  }
  {
    const plain = await renderPage(plainOrder({ status: 'received' }), GIVER)
    ok(plain.data.certKind === 'holder' && plain.drawn, 'D 证书页：非礼赠应画收藏证书')
    ok(JSON.stringify(normDate(plain.ops)) === JSON.stringify(normDate(golden.ops)), 'D 证书页：非礼赠整页绘制与改动前金样不一致')
    const giver = await renderPage(giftOrder(), GIVER)
    const recv = await renderPage(giftOrder(), RECV)
    const gt = texts(giver.ops)
    const rt = texts(recv.ops)
    ok(giver.data.certKind === 'gift_voucher' && gt.includes('山海造物 · 赠予凭证'), 'D 证书页：送礼人应画「赠予凭证」')
    ok(!gt.some((t) => /珍藏证书|馆藏证书/.test(String(t))), 'D 赠予凭证不得出现持有证书字样（送礼人不是持有人）')
    ok(gt.some((t) => String(t).includes('小满')), 'D 赠予凭证应写明赠予对象')
    ok(!giver.data.careGuideUrl, 'D 赠予凭证不承接养护入口')
    ok(recv.data.certKind === 'gift_holder' && rt.includes('山海造物 · 珍藏证书'), 'D 证书页：受礼人应画「收藏证书」')
    ok(rt.includes('林间小满') && rt.some((t) => /由「阿山」赠予/.test(String(t))), 'D 受礼人证书：持有人为受礼人本人，并注明「由 X 赠予」')
    ok(JSON.stringify(gt) !== JSON.stringify(rt), 'D 送礼人与受礼人的证书内容必须不同')
    const pending = await renderPage(giftOrder({ status: 'shipped' }), RECV)
    const voided = await renderPage(giftOrder({ status: 'refunded' }), GIVER)
    ok(pending.data.certState === 'pending' && !pending.drawn, 'D 未签收礼赠：不签发，显示待签发')
    ok(voided.data.certState === 'void' && !voided.drawn, 'D 退款礼赠：不签发，显示已结束')

    // N5 证书日期 = 固化签发时间（不是打开当天）；已固化 → 直接展示；首次 → 上传固化
    const recvAt = new Date(2026, 0, 5, 10, 0, 0)
    const dated = await renderPage(plainOrder({ receiveTime: recvAt }), GIVER)
    ok(texts(dated.ops).includes('2026.01.05'), 'D 普通证书日期须取签收时间（历史单读时推导），不得取打开当天')
    const fixed = await renderPage(plainOrder({ receiveTime: recvAt, certMeta: { issuedAt: new Date(2025, 11, 1, 9, 0, 0) } }), GIVER)
    ok(texts(fixed.ops).includes('2025.12.01'), 'D 证书日期须优先取固化的 certMeta.issuedAt')
    const save = dated.cloudCalls.find((c) => c.action === 'saveCertificate')
    ok(dated.cloudCalls.some((c) => c.upload && c.upload.startsWith('certificates/n1/holder-')) && save && save.name === 'getCareSpecimens' &&
      save.kind === 'holder' && save.sig === 'holder|2026.01.05|v2' && /^cloud:\/\//.test(save.fileID), 'D 首次签发须上传证书图并 saveCertificate(kind, sig) 固化')
    const cachedOrder = plainOrder({ receiveTime: recvAt, certMeta: { issuedAt: recvAt, holder: { fileID: 'cloud://certs/n1.png', openid: GIVER, sig: 'holder|2026.01.05|v2' } } })
    const cached = await renderPage(cachedOrder, GIVER)
    ok(cached.data.certImageUrl === 'https://tmp/certs/n1.png' && !cached.drawn && !texts(cached.ops).length && cached.data.showCert,
      'D 已固化且签名一致：直接展示已生成的证书图，不再重绘')
    const stale = await renderPage({ ...cachedOrder, certMeta: { ...cachedOrder.certMeta, holder: { ...cachedOrder.certMeta.holder, openid: STRANGER } } }, GIVER)
    ok(!stale.data.certImageUrl && stale.drawn, 'D 固化图不属于本人（openid 不符）时须现场绘制，不得展示他人的图')
  }
  {
    const { ctx, ops } = makeRecorderCtx()
    await draw.drawHolderCert(ctx, 300, 480, golden.fixture.data, makeStubCanvas(), async (s) => s)
    const sc = ops.find((op) => op[0] === 'scale')
    ok(!!sc && Math.abs(Number(sc[1]) - 480 / 560) < 0.01 && JSON.stringify(texts(ops)) === JSON.stringify(texts(golden.ops)),
      'D 矮屏普通证书须按 560 设计高等比缩放（文字内容不变），底部不再挤压')
  }

  // E 养护提醒
  async function reminder({ orders, queue = [], caller = '', fromClient = true, event }) {
    const { store, db } = makeDb({ orders, care_reminder_queue: queue })
    const calls = []
    const sdk = {
      init() {}, DYNAMIC_CURRENT_ENV: 'env',
      database: () => db,
      getWXContext: () => ({ OPENID: caller }),
      callFunction: async ({ name, data }) => { calls.push({ name, ...data }); return { result: { success: true, messageId: 'm1' } } }
    }
    const main = load(P.reminder, {
      stubs: { 'wx-server-sdk': sdk, './sourceOrigin': { isClientSource: () => fromClient, isNonClientSource: () => !fromClient } }
    }).main
    const res = await main(event)
    return { res, queue: store.care_reminder_queue, calls }
  }
  const sched = (orderId) => ({ action: 'schedule', orderId, openid: GIVER, category: 'INSECT', productTitle: '光明女神闪蝶' })
  {
    const r = await reminder({ orders: [plainOrder()], caller: GIVER, event: sched('n1') })
    ok(r.res.success && r.queue.length === 1 && r.queue[0].openid === GIVER, 'E 非礼赠 schedule：仍排给调用者本人（行为不变）')
  }
  {
    const r = await reminder({ orders: [giftOrder()], caller: GIVER, event: sched('g1') })
    ok(r.queue.length === 1 && r.queue[0].openid === RECV, 'E 送礼人代点签收：养护提醒必须排给持有人（受礼人）')
    ok(!r.queue.some((q) => q.openid === GIVER), 'E 送礼人不得被排养护提醒')
    ok(r.calls.some((c) => c.eventType === 'order_received' && c.openid === RECV && /归你珍藏/.test(c.title || '')), 'E 送礼人代点签收：应告知受礼人「已归你珍藏」')
  }
  {
    const r = await reminder({ orders: [giftOrder()], caller: RECV, event: sched('g1') })
    ok(r.queue.length === 1 && r.queue[0].openid === RECV && !r.calls.length, 'E 受礼人自己签收：排给自己，不重复发持有人信')
  }
  {
    const r = await reminder({ orders: [giftOrder({}, { receiverOpenid: '' })], caller: GIVER, event: sched('g1') })
    ok(r.res.success && r.res.skipped && r.res.reason === 'gift_holder_pending' && !r.queue.length, 'E 未绑定受礼人：不排提醒（持有人未定），归属明确为挂起')
  }
  {
    const r = await reminder({ orders: [giftOrder()], caller: STRANGER, event: sched('g1') })
    ok(!r.res.success && !r.queue.length, 'E 无关者不得为礼赠单排提醒')
  }
  const dueItem = (over) => ({ _id: 'q1', type: 'care_tip', status: 'pending', scheduledAt: Date.now() - 1000, orderId: 'g1', openid: GIVER, productTitle: 'x', ...over })
  const timer = { Type: 'Timer' }
  {
    const r = await reminder({ orders: [giftOrder()], queue: [dueItem()], fromClient: false, event: timer })
    const tips = r.calls.filter((c) => c.eventType === 'care_tip')
    ok(tips.length === 1 && tips[0].openid === RECV, 'E 历史排给送礼人的提醒：发送时必须改投持有人')
  }
  {
    const r = await reminder({ orders: [giftOrder({ status: 'refunded' })], queue: [dueItem({ openid: RECV })], fromClient: false, event: timer })
    ok(!r.calls.some((c) => c.eventType === 'care_tip') && r.queue[0].status === 'cancelled', 'E 礼赠已退款：待发提醒必须作废')
  }
  {
    const r = await reminder({ orders: [plainOrder({ status: 'refunded' })], queue: [dueItem({ orderId: 'n1' })], fromClient: false, event: timer })
    const tips = r.calls.filter((c) => c.eventType === 'care_tip')
    ok(tips.length === 1 && tips[0].openid === GIVER, 'E 非礼赠提醒：按原样发给队列收件人（行为不变）')
  }
  {
    const fresh = giftOrder({ _id: 'g2', receiveTime: new Date(Date.now() - 2 * DAY) })
    const old = giftOrder({ _id: 'g3', receiveTime: new Date(Date.now() - 30 * DAY) })
    const unbound = giftOrder({ _id: 'g4' }, { receiverOpenid: '' })
    const plainFresh = plainOrder({ _id: 'n2', receiveTime: new Date(Date.now() - 2 * DAY), autoReceivedAt: new Date() })
    const plainOld = plainOrder({ _id: 'n3', receiveTime: new Date(Date.now() - 30 * DAY) })
    const voucherOnly = plainOrder({ _id: 'n4', products: [{ id: 'c1', title: '体验券', latin: 'VOUCHER' }] })
    const exchange = plainOrder({ _id: 'n5', source: 'exchange' })
    const signedBefore = plainOrder({ _id: 'n6' })
    const cancelledBefore = plainOrder({ _id: 'n7' })
    const r = await reminder({
      orders: [fresh, old, unbound, plainFresh, plainOld, voucherOnly, exchange, signedBefore, cancelledBefore],
      queue: [
        { _id: 'q_n6', type: 'care_tip', status: 'sent', orderId: 'n6', openid: GIVER, scheduledAt: Date.now() - DAY },
        { _id: 'q_n7', type: 'care_tip', status: 'cancelled', orderId: 'n7', openid: GIVER, scheduledAt: Date.now() - DAY }
      ],
      fromClient: false,
      event: timer
    })
    ok(r.queue.some((q) => q.orderId === 'g2' && q.openid === RECV), 'E 补扫：近期签收的礼赠应补排持有人提醒（兜住自动收货/自提核销）')
    ok(!r.queue.some((q) => q.orderId === 'g3' || q.orderId === 'n3'), 'E 补扫：超出 14 日窗口的历史订单不得补排')
    ok(!r.queue.some((q) => q.orderId === 'g4' || (/^g/.test(q.orderId) && q.openid === GIVER)), 'E 补扫：未绑定礼赠 / 送礼人均不得被补排')
    ok(r.queue.some((q) => q.orderId === 'n2' && q.openid === GIVER && q.status === 'pending'), 'E 补扫（N2）：自动收货/自提核销的普通单应补排给下单人')
    ok(!r.queue.some((q) => q.orderId === 'n4' || q.orderId === 'n5'), 'E 补扫（N2）：券类 / 积分兑换单无养护对象，不得补排')
    ok(r.queue.filter((q) => q.orderId === 'n6').length === 1 && r.queue.filter((q) => q.orderId === 'n7').length === 1, 'E 补扫（N2）幂等：手动签收已排过（任一状态，含已发/已取消）的普通单不得重排')
    ok(!r.calls.some((c) => c.eventType === 'order_received' && /^n/.test(c.relatedId || '')), 'E 补扫（N2）：普通单不发「已归你珍藏」持有人信')
    ok(r.calls.some((c) => c.eventType === 'order_received' && c.relatedId === 'g2' && c.openid === RECV), 'E 补扫：应给持有人发「已归你珍藏」')
    const again = await reminder({ orders: [fresh, plainFresh], queue: r.queue, fromClient: false, event: timer })
    ok(again.queue.filter((q) => q.orderId === 'g2').length === 1, 'E 补扫须幂等（已有持有人队列不再补）')
    ok(again.queue.filter((q) => q.orderId === 'n2').length === 1, 'E 补扫（N2）须幂等：普通单补过不再补')
    ok(!again.calls.some((c) => c.eventType === 'order_received'), 'E 补扫须幂等：已补过的礼赠不得再发「已归你珍藏」')
  }

  // F 我的藏品 / 养护上下文
  async function specimens(caller, event, orders) {
    const { db } = makeDb({ orders, products: [] })
    const sdk = { init() {}, DYNAMIC_CURRENT_ENV: 'env', database: () => db, getWXContext: () => ({ OPENID: caller }) }
    return load(P.specimens, { stubs: { 'wx-server-sdk': sdk } }).main(event)
  }
  {
    const orders = [giftOrder(), plainOrder({ _id: 'n1', _openid: RECV, openid: RECV })]
    const ctxRecv = await specimens(RECV, { action: 'orderContext', orderId: 'g1' }, orders)
    ok(ctxRecv.success, 'F 受礼人打开养护指南（带 orderId）必须能读上下文，不得被「无权查看」踢回')
    const ctxStranger = await specimens(STRANGER, { action: 'orderContext', orderId: 'g1' }, orders)
    ok(!ctxStranger.success, 'F 无关者不得读养护上下文')
    const listRecv = await specimens(RECV, { action: 'list' }, orders)
    ok(listRecv.data.some((x) => x.orderId === 'g1') && listRecv.data.some((x) => x.orderId === 'n1'), 'F 受礼人的我的藏品：含受赠藏品与自己的订单')
    const listGiver = await specimens(GIVER, { action: 'list' }, [giftOrder(), plainOrder({ _id: 'n9' })])
    ok(!listGiver.data.some((x) => x.orderId === 'g1'), 'F 送礼人的我的藏品：不含送出的礼赠')
    ok(listGiver.data.some((x) => x.orderId === 'n9'), 'F 非礼赠：我的藏品原样列出')
    const ctxGiver = await specimens(GIVER, { action: 'orderContext', orderId: 'n9' }, [plainOrder({ _id: 'n9' })])
    ok(ctxGiver.success, 'F 非礼赠：下单人读养护上下文原样可用')
  }
  {
    const recvAt = new Date(2026, 0, 5, 10, 0, 0)
    const { store, db } = makeDb({ orders: [giftOrder({ receiveTime: recvAt }), plainOrder({ _id: 'n1', receiveTime: recvAt })], products: [] })
    let who = ''
    const sdk = { init() {}, DYNAMIC_CURRENT_ENV: 'env', database: () => db, getWXContext: () => ({ OPENID: who }) }
    const main = load(P.specimens, { stubs: { 'wx-server-sdk': sdk } }).main
    const save = (caller, ev) => { who = caller; return main({ action: 'saveCertificate', fileID: 'cloud://env/c.png', sig: 's1', ...ev }) }
    const g = () => store.orders.find((o) => o._id === 'g1')
    ok(!(await save(GIVER, { orderId: 'g1', kind: 'gift_holder' })).success, 'F saveCertificate：送礼人不得固化受礼人的收藏证书')
    ok(!(await save(STRANGER, { orderId: 'g1', kind: 'gift_voucher' })).success, 'F saveCertificate：无关者不得固化证书')
    ok(!(await save(RECV, { orderId: 'g1', kind: 'gift_holder', fileID: 'https://evil/x.png' })).success, 'F saveCertificate：只接受云存储 fileID')
    const r1 = await save(RECV, { orderId: 'g1', kind: 'gift_holder' })
    ok(r1.success && g().certMeta && g().certMeta.gift_holder && g().certMeta.gift_holder.openid === RECV, 'F saveCertificate：受礼人固化收藏证书')
    ok(toMs(g().certMeta && g().certMeta.issuedAt) === recvAt.getTime(), 'F saveCertificate：签发日首写固化为签收时间（不是 now）')
    const r2 = await save(GIVER, { orderId: 'g1', kind: 'gift_voucher', sig: 's2' })
    ok(r2.success && toMs(g().certMeta.issuedAt) === recvAt.getTime() && g().certMeta.gift_holder.fileID, 'F saveCertificate：后续签发不改签发日、不覆盖对方证书')
    const r3 = await save(RECV, { orderId: 'g1', kind: 'gift_holder' })
    ok(r3.success && r3.already, 'F saveCertificate：同签名幂等')
    const rp = await save(GIVER, { orderId: 'n1', kind: 'holder' })
    ok(rp.success && toMs(store.orders.find((o) => o._id === 'n1').certMeta.issuedAt) === recvAt.getTime(), 'F saveCertificate：普通单下单人固化，签发日为签收时间')
  }

  // H 送礼人代点签收的消息（N1）
  async function receipt(order, caller, { voucherOk = true } = {}) {
    const { db } = makeDb({ orders: [order] })
    const calls = []
    const inApp = []
    const sdk = {
      init() {}, DYNAMIC_CURRENT_ENV: 'env', database: () => db, getWXContext: () => ({ OPENID: caller }),
      callFunction: async ({ name, data }) => { calls.push({ name, ...data }); return { result: { success: name === 'dispatchMessage' ? voucherOk : true, pointsGranted: 0 } } }
    }
    const res = await load(P.confirmReceipt, {
      stubs: { 'wx-server-sdk': sdk, './messageWrite': { dispatchInAppMessage: async (_db, p) => { inApp.push(p); return { success: true } } } }
    }).main({ orderId: order._id })
    return { res, calls, inApp }
  }
  {
    const shipped = giftOrder({ status: 'shipped', receiveTime: null })
    const byGiver = await receipt(shipped, GIVER)
    const voucher = byGiver.calls.find((c) => c.name === 'dispatchMessage')
    ok(byGiver.res.success && voucher && voucher.openid === GIVER && voucher.title === '赠予凭证已签发' && /归受礼人所有/.test(voucher.content || ''), 'H 送礼人代点签收：发「赠予凭证已签发」')
    ok(!byGiver.inApp.some((m) => m.eventType === 'order_received' && m.openid === GIVER), 'H 送礼人代点签收：不得再发「藏品已签收 / 收藏证书已生成」')
    const byRecv = await receipt(shipped, RECV)
    ok(byRecv.inApp.some((m) => m.eventType === 'order_received' && m.openid === RECV) && !byRecv.calls.some((c) => c.name === 'dispatchMessage'), 'H 受礼人自己签收：原消息不变')
    const plain = await receipt(plainOrder({ status: 'shipped', receiveTime: null }), GIVER)
    ok(plain.inApp.some((m) => m.eventType === 'order_received' && m.openid === GIVER) && !plain.calls.some((c) => c.name === 'dispatchMessage'), 'H 普通单签收：原消息不变')
    const fallback = await receipt(shipped, GIVER, { voucherOk: false })
    ok(fallback.inApp.some((m) => m.eventType === 'order_received' && m.openid === GIVER), 'H 赠予凭证文案下发失败：回退原消息，不丢通知')
  }

  // I 领取核验（N3）
  function giftEnv(orders, extra = {}) {
    const { store, db } = makeDb({ orders, content_display_flags: [{ _id: 'f1', status: 'active', priority: 1, showGift: true }], ...extra })
    let who = ''
    const sdk = { init() {}, DYNAMIC_CURRENT_ENV: 'env', database: () => db, getWXContext: () => ({ OPENID: who }), callFunction: async () => ({ result: { success: true } }) }
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
    return { store, call: (caller, ev) => { who = caller; return main(ev) } }
  }
  const vOrder = (over = {}, meta = {}) => ({
    _id: 'v1', _openid: GIVER, openid: GIVER, source: 'gift', orderNo: 'SH20260928009', status: 'paid', products: [product], createTime: new Date(),
    giftMeta: { deliveryType: 'store_pickup', shareToken: 'tok1', claimCode: '246810', storeName: '山海造物', cardSignature: '阿山', ...meta },
    ...over
  })
  const leak = (x) => { const j = JSON.stringify(x || {}); return j.includes(PHONE) || j.includes('phoneHash') || /[0-9a-f]{64}/.test(j) }
  {
    const env = giftEnv([vOrder()])
    ok(!(await env.call(STRANGER, { action: 'setReceiverPhone', orderId: 'v1', phone: PHONE })).success, 'I 只有送礼人可以设置受礼人手机号')
    const set = await env.call(GIVER, { action: 'setReceiverPhone', orderId: 'v1', phone: PHONE })
    const o = () => env.store.orders.find((x) => x._id === 'v1')
    ok(set.success && set.phoneTail === '1234' && !leak(set), 'I 送礼人设号：出参只含尾号')
    ok(o().giftMeta.receiverVerify === true && !leak(o()), 'I 订单上只留布尔标记：orders 不得出现明文号码或其哈希（orders 登录可读）')
    const vdoc = (env.store.gift_receiver_verify || [])[0]
    ok(vdoc && vdoc.phoneHash && !JSON.stringify(vdoc).includes(PHONE), 'I 核验集合只存加盐哈希 + 尾号，不存明文')
    const share = await env.call(RECV, { action: 'getShare', token: 'tok1' })
    ok(share.success && !leak(share) && share.gift && !share.gift.claimCode && !share.gift.claimQrPayload, 'I 分享数据：不含明文号码/哈希；未核验不出自提领取码')
    const giverShare = await env.call(GIVER, { action: 'getShare', token: 'tok1' })
    ok(!leak(giverShare), 'I 送礼人视角的分享数据也不含明文号码/哈希')
    const bind = await env.call(RECV, { action: 'bindReceiver', token: 'tok1' })
    ok(!bind.success && bind.code === 'VERIFY_REQUIRED' && !o().giftMeta.receiverOpenid, 'I 设了号的礼赠：未核验不得绑定为持有人')
    const gv = await env.call(GIVER, { action: 'verifyReceiver', token: 'tok1', method: 'manual', phone: PHONE })
    const gb = await env.call(GIVER, { action: 'bindReceiver', token: 'tok1' })
    ok(!gv.success && !gb.success && !o().giftMeta.receiverOpenid, 'I 送礼人打开礼笺：不得核验通过、不得被绑定为受礼人')
    const fails = []
    for (let i = 0; i < 5; i += 1) fails.push(await env.call(RECV, { action: 'verifyReceiver', token: 'tok1', method: 'manual', phone: '13900009999' }))
    ok(fails.every((f) => !f.success && f.code === 'VERIFY_MISMATCH') && fails[0].remaining === 4, 'I 号码不一致：拒绝并告知剩余次数')
    ok(!fails.some((f) => { const j = JSON.stringify(f); return j.includes('1234') || j.includes('138') || leak(f) }), 'I 核验失败不得泄露正确号码的任何片段')
    const locked = await env.call(RECV, { action: 'verifyReceiver', token: 'tok1', method: 'manual', phone: PHONE })
    ok(!locked.success && locked.code === 'VERIFY_LOCKED' && !o().giftMeta.receiverOpenid, 'I 每人每单每小时 5 次：超限锁定，锁定期内正确号码也不放行')
    const acc = await env.call(RECV2, { action: 'verifyReceiver', token: 'tok1', method: 'account' })
    ok(!acc.success && acc.code === 'NEED_PHONE', 'I 微信手机号比对：未经微信授权绑定手机号 → 引导授权/手输，不放行')
    const okv = await env.call(RECV2, { action: 'verifyReceiver', token: 'tok1', method: 'manual', phone: `+86 ${PHONE}` })
    ok(okv.success && o().giftMeta.receiverOpenid === RECV2 && o().giftMeta.receiverBoundSource === 'phone_verify_manual', 'I 核验通过：绑定为持有人')
    const share2 = await env.call(RECV2, { action: 'getShare', token: 'tok1' })
    ok(share2.gift && share2.gift.claimCode === '246810', 'I 核验通过后：持有人可见自提领取码')
    ok(!(await env.call(GIVER, { action: 'setReceiverPhone', orderId: 'v1', phone: '13700001111' })).success, 'I TA 已领取后送礼人不得再改号')
  }
  {
    const env = giftEnv([vOrder()], { users: [{ _id: 'u1', _openid: RECV, phone: PHONE, phoneVerifiedAt: new Date() }] })
    await env.call(GIVER, { action: 'setReceiverPhone', orderId: 'v1', phone: PHONE })
    const acc = await env.call(RECV, { action: 'verifyReceiver', token: 'tok1', method: 'account' })
    ok(acc.success && env.store.orders[0].giftMeta.receiverBoundSource === 'phone_verify_account', 'I 微信手机号授权比对（优先路径）：一致即绑定')
    const list = await env.call(GIVER, { action: 'listMine', role: 'sender' })
    const item = ((list && (list.list || list.data)) || []).find((x) => x.orderId === 'v1')
    ok(list && list.success && !leak(list) && item && item.verifyPhoneTail === '1234', 'I 我的礼赠：只给尾号，不含明文号码/哈希')
  }
  {
    const env = giftEnv([vOrder({ status: 'paid_awaiting_address' }, { deliveryType: 'invite_address', addressTimeoutDays: 7 })])
    await env.call(GIVER, { action: 'setReceiverPhone', orderId: 'v1', phone: PHONE })
    const a = await env.call(RECV, { action: 'accept', token: 'tok1' })
    const s2 = await env.call(RECV, { action: 'submitAddress', token: 'tok1', address: { name: '小满', phone: '13900001111', region: ['上海市', '上海市'], detail: '一号' } })
    ok(a.code === 'VERIFY_REQUIRED' && s2.code === 'VERIFY_REQUIRED' && !env.store.orders[0].giftMeta.receiverOpenid, 'I 先付后填址：未核验不得收下 / 填址')
  }
  {
    const env = giftEnv([vOrder()])
    const b = await env.call(RECV, { action: 'bindReceiver', token: 'tok1' })
    const share = await env.call(RECV, { action: 'getShare', token: 'tok1' })
    ok(b.success && env.store.orders[0].giftMeta.receiverOpenid === RECV && share.gift && !share.gift.verifyRequired, 'I 未设号的礼赠（含历史礼赠）：领取行为不变')
  }

  // G 触达点接线（静态：这些是 WXML/页面数据流，行为已由 B–F 覆盖）
  const odW = read(P.orderDetailWxml)
  ok(/received-actions" wx:if="\{\{order\.status === 'received' && showCare && certRole !== 'giver'\}\}"/.test(odW), 'G 订单详情：送礼人不得出现「标本养护 + 收藏证书」')
  ok(odW.includes("certRole === 'giver' ? '查看赠予凭证' : '查看收藏证书'"), 'G 订单详情：送礼人按钮应为「查看赠予凭证」')
  ok(/certRole: resolveCertRole\(data, openid\)/.test(read(P.orderDetailJs)), 'G 订单详情：certRole 须由 giftHolder.resolveCertRole 推导')
  const ch = read(P.careHelper)
  ok(/giverView = resolveCertRole\([^\n]*\) === 'giver'\n/.test(ch) && ch.includes("'查看赠予凭证'"), 'G 签收弹层：送礼人代点签收只给「查看赠予凭证」')
  const mg = read(P.myGifts)
  ok(/progressKey === 'done'/.test(mg) && mg.includes("flowTab === 'received' ? '收藏证书' : '赠予凭证'"), 'G 我的礼赠：已完成卡出证书/凭证入口')
  ok(read(P.receiveWxml).includes('goHolderCert') && /holderReady: gift\.status === 'received'/.test(read(P.receiveJs)), 'G 领取页：持有期服务卡与收藏证书入口')
  ok(read(P.successWxml).includes('goVoucher') && /voucherReady: gift\.status === 'received'/.test(read(P.successJs)), 'G 送礼成功页：签收后出「查看赠予凭证」')
  const rvW = read(P.receiveWxml)
  const rvJ = read(P.receiveJs)
  ok(rvW.includes('bindtap="verifyByAccount"') && rvW.includes('holderCard && !verifyNeeded') && rvW.includes('bindconfirm="onManualVerify"') &&
    rvJ.includes("this._verifyNeeded = !br.success && br.code === 'VERIFY_REQUIRED'") && rvJ.includes("data: { action: 'verifyReceiver', token: this.data.token || this._token"), 'G 领取页：待核验时出核验面板（微信手机号优先 / 手输备选），隐藏持有期服务卡')
  const up = read(P.userPage)
  ok(/'giftMeta\.receiverOpenid': openid, status: 'received' \}\)\.count\(\)/.test(up) && up.includes('(certRes.total || 0) + (giftCertRes.total || 0)'), 'G 「我的」证书角标：须计入受赠证书')

  // J 强制填写受礼人手机号
  ok(read(P.phoneLib) === read(P.phoneLibCopy), 'J 副本漂移：manageGift/giftReceiverPhone.js 与 makeOrder/giftReceiverPhone.js 不一致')
  {
    // 入口取证：客户端里带 giftMeta 进结算的只能是送礼页（其它入口不走必填校验就会绕过）
    const roots = ['pages', 'subpackages', 'utils', 'components'].map((d) => resolve(MP, d))
    const files = []
    const walk = (d) => readdirSync(d).forEach((n) => {
      const f = resolve(d, n)
      if (statSync(f).isDirectory()) walk(f)
      else if (n.endsWith('.js')) files.push(f)
    })
    roots.forEach((r) => { try { walk(r) } catch (e) { /* 目录不存在 */ } })
    const creators = files.filter((f) => /giftMeta:\s*\{/.test(read(f))).map((f) => f.replace(MP + '/', ''))
    ok(creators.length === 1 && creators[0] === 'subpackages/feature/gift/compose/index.js',
      `J 发起礼赠的入口只能是送礼页（必填校验在那里）；发现：${creators.join(', ') || '无'}`)
  }
  const cjs = read(P.composeJs)
  const cw = read(P.composeWxml)
  // 2026-10-11 起：填址 / 自提可选「凭礼笺领取」免填号（判据见 check:gift-claim-link），其余交付方式仍必填
  ok(/if \(!claimLink && !\/\^1\\d\{10\}\$\/\.test\(receiverPhone\)\) \{\n\s+this\.flagReceiverPhone\(/.test(cjs) &&
    cjs.includes('const claimLink = !!this.data.claimLink && CLAIM_LINK_DELIVERY.indexOf(deliveryType) !== -1'), 'J 送礼页：未填号且未选凭礼笺领取（或交付方式不允许免填）不得进入确认页，并定位到该字段')
  ok(cw.includes('id="receiverPhoneField"') && cw.includes('scroll-into-view="{{phoneScrollId}}"') && cw.includes('focus="{{receiverPhoneFocus}}"') &&
    cw.includes('* 必填') && cw.includes('用于受礼人领取时核验身份，防止礼笺被他人领走；仅存加密值与尾号'), 'J 送礼页：必填标注 + 用途说明 + 滚动聚焦到字段')
  ok(!/wx\.show(Toast|Modal)\([^)]*手机号/.test(cjs), 'J 送礼页：手机号报错不得用原生弹窗')
  const co = read(P.confirmOrder)
  const PL = load(P.phoneLib, { stubs: { crypto: NODE_CRYPTO } })
  ok(co.includes(`clientCaps: this.data.isGiftOrder ? ['${PL.GIFT_PHONE_CAP}', '${PL.GIFT_CLAIM_LINK_CAP}'] : undefined,`) && co.includes('giftReceiverPhone: giftReceiverPhone || undefined,'), 'J 确认页：礼赠单须携带能力标记与受礼人手机号')
  ok(/if \(this\.data\.isGiftOrder && !giftReceiverPhone && !giftClaimLink\) \{\n\s+this\.backToGiftPhone\(\)/.test(co) && co.includes("result.code === 'GIFT_RECEIVER_PHONE_REQUIRED'"), 'J 确认页：缺号不下单，退回送礼页定位字段')
  ok(PL.ENFORCE_ALL_DEFAULT === false && (delete process.env.GIFT_PHONE_ENFORCE_ALL, PL.enforceAllGiftPhone() === false), 'J 「对所有请求强制」开关默认必须关')
  async function makeOrder(event, { env } = {}) {
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
    if (env) process.env.GIFT_PHONE_ENFORCE_ALL = env
    try {
      const res = await main({ items: [{ productId: 'p1', count: 1 }], ...event })
      return { res, store }
    } finally {
      delete process.env.GIFT_PHONE_ENFORCE_ALL
    }
  }
  const giftEv = { source: 'gift', giftMeta: { deliveryType: 'invite_address', recipientName: '小满', cardBody: '生日快乐' } }
  const CAP = { clientCaps: [PL.GIFT_PHONE_CAP] }
  {
    const miss = await makeOrder({ ...giftEv, ...CAP })
    ok(!miss.res.success && miss.res.code === 'GIFT_RECEIVER_PHONE_REQUIRED' && !miss.store.orders.length, 'J makeOrder：新版客户端（带标记）缺受礼人手机号 → 拒绝建礼赠单')
    const bad = await makeOrder({ ...giftEv, ...CAP, giftReceiverPhone: '12345' })
    ok(!bad.res.success && bad.res.code === 'GIFT_RECEIVER_PHONE_REQUIRED', 'J makeOrder：新版客户端号码不合法 → 拒绝')
    const legacy = await makeOrder({ ...giftEv })
    ok(legacy.res.success && legacy.store.orders.length === 1 && !legacy.store.orders[0].giftMeta.receiverVerify && !(legacy.store.gift_receiver_verify || []).length,
      'J makeOrder：旧版客户端（不带标记）缺号暂不拒绝，行为不变')
    const forced = await makeOrder({ ...giftEv }, { env: '1' })
    ok(!forced.res.success && forced.res.code === 'GIFT_RECEIVER_PHONE_REQUIRED', 'J makeOrder：开关打开（GIFT_PHONE_ENFORCE_ALL=1）后旧版缺号也拒绝')
    const good = await makeOrder({ ...giftEv, ...CAP, giftReceiverPhone: PHONE })
    const o = good.store.orders[0] || {}
    const vd = (good.store.gift_receiver_verify || [])[0] || {}
    ok(good.res.success && good.res.receiverVerify === true && o.giftMeta && o.giftMeta.receiverVerify === true, 'J makeOrder：带号下单 → 订单标记领取核验')
    ok(!leak(o) && !leak(good.res), 'J makeOrder：订单与出参不得含明文号码或其哈希')
    ok(vd._id === o._id && vd.phoneTail === '1234' && vd.phoneHash === PL.hashPhone(vd.salt, PHONE) && !JSON.stringify(vd).includes(PHONE), 'J makeOrder：号码只以加盐哈希 + 尾号进核验集合')
    const plain = await makeOrder({ ...CAP, address: { name: '阿山', phone: '13900001111', region: ['上海市', '上海市'], detail: '一号' } })
    ok(plain.res.success && plain.res.receiverVerify === undefined, 'J makeOrder：普通单不受影响（出参不变）')
    const preview = await makeOrder({ ...giftEv, ...CAP, previewOnly: true })
    ok(preview.res.success && preview.res.preview, 'J makeOrder：确认页计价预览不校验手机号')
  }
  ok(read(P.myGiftsWxml).includes("'建议补填受礼人手机号，防礼笺被他人领走'") && read(P.successWxml).includes("'建议补填受礼人手机号'"), 'J 未设号且未领取的送出礼赠：我的礼赠 / 送礼成功页须强提示补填')

  // 页面异步回调里抛错（真机上是白屏/铸造中断）同样算失败
  await new Promise((r) => setTimeout(r, 20))
  UNHANDLED.splice(0).forEach((e) => fails.push(`页面异步异常：${(e && e.message) || e}`))
  return fails
}

// ---------------------------------------------------------------- 自检注入
const INJECTIONS = [
  { name: '未绑定礼赠的持有人被推成送礼人', file: [P.holder, ...P.holderCopies], find: "  return receiverOf(order)\n}", replace: "  return receiverOf(order) || String(order._openid || '')\n}" },
  { name: '判据把送礼人也判成持有人', file: [P.holder, ...P.holderCopies], find: "return isReceiver ? 'holder' : 'giver'", replace: "return 'holder'" },
  { name: '判据副本漂移', file: P.holderCopies[0], find: "var VOID_STATUS = { refunded: 1, cancelled: 1, void: 1, expired_refunding: 1 }", replace: "var VOID_STATUS = { refunded: 1, cancelled: 1, void: 1 }" },
  { name: '退款礼赠仍签发证书', file: [P.holder, ...P.holderCopies], find: "if (VOID_STATUS[order.status]) return 'void'", replace: '' },
  { name: '收藏夹把送出的礼赠当持有证书', file: P.certList, find: "return receiver === openid ? 'gift_holder' : 'gift_voucher'", replace: "return 'gift_holder'" },
  { name: '赠予凭证写成珍藏证书', file: P.certDraw, find: "ctx.fillText('山海造物 · 赠予凭证', cx, 62 * k)", replace: "ctx.fillText('山海造物 · 珍藏证书', cx, 62 * k)" },
  { name: '非礼赠证书被改版式', file: P.certDraw, find: "ctx.fillText('以表彰其对以下自然瑰宝的永久珍藏：', w / 2, y);", replace: "ctx.fillText('以表彰其永久珍藏：', w / 2, y);" },
  { name: '证书页送礼人走持有证书', file: P.certPage, find: "(role === 'giver' ? 'gift_voucher' : 'gift_holder')", replace: "'gift_holder'" },
  { name: '证书页非礼赠走礼赠版式', file: P.certPage, find: "const certKind = !gift ? 'holder' :", replace: "const certKind = !gift ? 'gift_holder' :" },
  { name: '送礼人代点签收仍排给送礼人', file: P.reminder, find: 'next.openid = gift.holder', replace: 'next.openid = caller' },
  { name: '未绑定礼赠也排给送礼人', file: P.reminder, find: "if (!holder) return { skip: 'gift_holder_pending' }\n  return { order, holder, notify: holder !== caller }", replace: "return { order, holder: holder || caller, notify: false }" },
  { name: '发送时不改投持有人', file: P.reminder, find: "  if (!holder) return { skip: 'gift_holder_pending' }\n  return { openid: holder }", replace: "  return { openid: item.openid }" },
  { name: '退款礼赠提醒不作废', file: P.reminder, find: "if (isVoidGift(order)) return { cancel: 'gift_closed' }", replace: '' },
  { name: '非礼赠提醒被新判据拦截', file: P.reminder, find: "if (!order || !isGiftOrder(order)) return { openid: item.openid }", replace: "if (!order) return { openid: item.openid }\n  if (order.status === 'refunded') return { cancel: 'closed' }" },
  { name: '补扫不限窗口', file: P.reminder, find: 'const RECEIVED_SWEEP_DAYS = 14', replace: 'const RECEIVED_SWEEP_DAYS = 3650' },
  { name: '普通单不补扫（N2 回退）', file: P.reminder, find: "  if (!isCareEligible(order)) return ''\n  return String(order._openid || order.openid || '')", replace: "  return ''" },
  { name: '券类单也补扫', file: P.reminder, find: 'return products.some((p) => !isVoucherLikeProduct(p))', replace: 'return true' },
  { name: '补扫幂等只认待发（手动签收已发的被重排）', file: P.reminder, find: ".where({ orderId: order._id, openid: target, type: 'care_tip' })", replace: ".where({ orderId: order._id, openid: target, type: 'care_tip', status: 'pending' })" },
  { name: '补扫给普通单发持有人信', file: P.reminder, find: '      if (isGiftOrder(order)) {\n        await notifyGiftHolder(order, target)', replace: '      if (true) {\n        await notifyGiftHolder(order, target)' },
  { name: '证书日期回到打开当天', file: P.certPage, find: 'date: formatCertDay(certIssuedAt(order)),', replace: 'date: formatCertDay(Date.now()),' },
  { name: '签发日推导丢了签收时间', file: [P.holder, ...P.holderCopies], find: 'return toMillis(cm.issuedAt) || toMillis(order.receiveTime) ||', replace: 'return toMillis(cm.issuedAt) ||' },
  { name: '已固化证书仍重绘', file: P.certPage, find: 'if (saved && saved.fileID && saved.openid === openid && saved.sig === sig) {', replace: 'if (false) {' },
  { name: '展示他人固化的证书图', file: P.certPage, find: 'saved.fileID && saved.openid === openid && saved.sig', replace: 'saved.fileID && saved.sig' },
  { name: '首次签发不固化', file: P.certPage, find: '            this.persistCert(r.tempFilePath);\n', replace: '' },
  { name: '矮屏证书不缩放', file: P.certDraw, find: 'if (s >= 1) return drawHolderLayout', replace: 'if (true) return drawHolderLayout' },
  { name: '证书固化不校验身份', file: P.specimens, find: 'if (!order || certKindOf(order, openid) !== kind)', replace: 'if (!order)' },
  { name: '签发日取 now', file: P.specimens, find: "data['certMeta.issuedAt'] = issuedAt ? new Date(issuedAt) : db.serverDate()", replace: "data['certMeta.issuedAt'] = db.serverDate()" },
  { name: '送礼人代签仍发收藏证书已生成（N1 回退）', file: P.confirmReceipt, find: 'const voucherSent = giverSigned && await', replace: 'const voucherSent = false && await' },
  { name: '受礼人签收也被改成赠予凭证', file: P.confirmReceipt, find: "const giverSigned = isGiftOrder(order) && openid === giverOpenid(order) &&\n      String((order.giftMeta && order.giftMeta.receiverOpenid) || '') !== openid", replace: 'const giverSigned = isGiftOrder(order)' },
  { name: '绑定不过核验门', file: P.gift, find: '  const bindGate = await receiverVerifyGate(order, openid)\n  if (bindGate) return bindGate\n', replace: '' },
  { name: '收下不过核验门', file: P.gift, find: '  const acceptGate = await receiverVerifyGate(order, openid)\n  if (acceptGate) return acceptGate\n', replace: '' },
  { name: '填址不过核验门', file: P.gift, find: '  const addressGate = await receiverVerifyGate(order, openid)\n  if (addressGate) return addressGate\n', replace: '' },
  { name: '核验不限次', file: P.gift, find: 'if (mine.length >= VERIFY_MAX_PER_HOUR || failures.length >= VERIFY_ORDER_MAX_PER_HOUR) {', replace: 'if (false) {' },
  { name: '核验失败回显尾号', file: P.gift, find: '`与送礼人预留的手机号不一致，还可尝试 ${remaining} 次`', replace: '`与尾号 ${doc.phoneTail} 不一致，还可尝试 ${remaining} 次`' },
  { name: '送礼人可核验自己的礼赠', file: P.gift, find: "if (isGiverOfOrder(order, openid)) return { success: false, code: 'IS_GIVER'", replace: "if (false) return { success: false, code: 'IS_GIVER'" },
  { name: '明文手机号落订单', file: P.gift, find: "update({ data: { 'giftMeta.receiverVerify': true } })", replace: "update({ data: { 'giftMeta.receiverVerify': true, 'giftMeta.receiverPhone': phone } })" },
  { name: '未核验也出自提领取码', file: P.gift, find: "    if (order.giftMeta && order.giftMeta.receiverVerify && !isBoundReceiver) {\n      gift.claimCode = ''", replace: "    if (false) {\n      gift.claimCode = ''" },
  { name: '非送礼人可设号', file: P.gift, find: "  if (!isGiverOfOrder(order, openid)) return { success: false, code: 'FORBIDDEN', msg: '只有送礼人可以设置领取核验' }\n", replace: '' },
  { name: '领取后仍可改号', file: P.gift, find: "  if (meta.receiverOpenid) return { success: false, code: 'ALREADY_BOUND', msg: 'TA 已领取，核验手机号不能再改' }\n", replace: '' },
  { name: '未设号的礼赠也被拦', file: P.gift, find: '  if (!meta.receiverVerify) return null\n  if (meta.receiverOpenid && meta.receiverOpenid === openid) return null\n  const doc = await loadVerifyDoc(order._id)\n  if (!doc || !doc.phoneHash) return null', replace: "  const doc = await loadVerifyDoc(order._id)\n  if (!doc || !doc.phoneHash) return { success: false, code: 'VERIFY_REQUIRED' }" },
  { name: '送礼页手机号又变选填', file: P.composeJs, find: 'if (!claimLink && !/^1\\d{10}$/.test(receiverPhone)) {', replace: 'if (!claimLink && receiverPhone && !/^1\\d{10}$/.test(receiverPhone)) {' },
  { name: '送礼页去掉必填标注', file: P.composeWxml, find: '* 必填', replace: '选填' },
  { name: '确认页不带能力标记', file: P.confirmOrder, find: "clientCaps: this.data.isGiftOrder ? ['gift_receiver_phone_v1', 'gift_claim_link_v1'] : undefined,", replace: 'clientCaps: undefined,' },
  { name: '确认页缺号仍下单', file: P.confirmOrder, find: 'if (this.data.isGiftOrder && !giftReceiverPhone && !giftClaimLink) {', replace: 'if (false) {' },
  { name: '新礼赠入口绕过送礼页', file: P.cartJs, find: "source: 'cart',", replace: "source: 'cart', giftMeta: { deliveryType: 'invite_address' }," },
  { name: 'makeOrder 不校验手机号', file: P.makeOrder, find: 'if (giftPhone.required && !giftPhone.phone) {', replace: 'if (false) {' },
  { name: '忽略新版能力标记', file: [P.phoneLib, P.phoneLibCopy], find: 'required: (clientHasGiftPhoneCap(event) || enforceAllGiftPhone()) && !claimLink,', replace: 'required: enforceAllGiftPhone() && !claimLink,' },
  { name: '旧版客户端也被拒', file: [P.phoneLib, P.phoneLibCopy], find: 'required: (clientHasGiftPhoneCap(event) || enforceAllGiftPhone()) && !claimLink,', replace: 'required: true,' },
  { name: '全量强制开关默认开', file: [P.phoneLib, P.phoneLibCopy], find: 'const ENFORCE_ALL_DEFAULT = false', replace: 'const ENFORCE_ALL_DEFAULT = true' },
  { name: '环境变量开关失效', file: [P.phoneLib, P.phoneLibCopy], find: "String(process.env.GIFT_PHONE_ENFORCE_ALL || '') === '1'", replace: 'false' },
  { name: '下单把明文号码写进订单', file: P.makeOrder, find: '{ ...giftMeta, receiverVerify: true }', replace: '{ ...giftMeta, receiverVerify: true, receiverPhone: giftPhone.phone }' },
  { name: '核验库副本漂移', file: P.phoneLibCopy, find: "const GIFT_PHONE_CAP = 'gift_receiver_phone_v1'", replace: "const GIFT_PHONE_CAP = 'gift_receiver_phone_v2'" },
  { name: '我的礼赠去掉补填强提示', file: P.myGiftsWxml, find: "'建议补填受礼人手机号，防礼笺被他人领走'", replace: "'设领取核验'" },
  { name: '领取页核验面板被移除', file: P.receiveJs, find: "this._verifyNeeded = !br.success && br.code === 'VERIFY_REQUIRED'", replace: 'this._verifyNeeded = false' },
  { name: '补扫不做幂等', file: P.reminder, find: "      if (existing.data && existing.data.length) continue\n", replace: '' },
  { name: '养护上下文仍只认下单人', file: P.specimens, find: " && !(isGiftOrder(order) && resolveHolderOpenid(order) === openid)", replace: '' },
  { name: '我的藏品漏查受赠', file: P.specimens, find: "gifted = await queryReceived({ 'giftMeta.receiverOpenid': openid, status: 'received' }, cap)", replace: 'gifted = []' },
  { name: '我的藏品仍含送出的礼赠', file: P.specimens, find: 'return !isGiftOrder(o) || resolveHolderOpenid(o) === openid', replace: 'return true' },
  { name: '订单详情送礼人仍见养护', file: P.orderDetailWxml, find: " && certRole !== 'giver'}}", replace: '}}' },
  { name: '签收弹层不区分送礼人', file: P.careHelper, find: "=== 'giver'\n", replace: "=== 'nobody'\n" },
  { name: '「我的」角标不计受赠', file: P.userPage, find: "(certRes.total || 0) + (giftCertRes.total || 0)", replace: 'certRes.total || 0' }
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
      if (fails.length) console.log(`  ✓ 检出「${inj.name}」→ ${fails[0]}`)
      else { missed += 1; console.error(`  ✗ 未检出「${inj.name}」`) }
      if (fails.some((f) => f.startsWith('运行异常：注入锚点失效'))) { missed += 1; console.error(`  ✗ 锚点失效「${inj.name}」`) }
    }
    if (missed) {
      console.error(`✗ check:gift-holder 自检：${missed} 条注入未检出`)
      process.exit(1)
    }
    console.log(`✓ check:gift-holder 自检通过（${INJECTIONS.length} 条内存注入全部检出，未写盘）`)
    return
  }
  const fails = await runChecks()
  if (fails.length) {
    console.error('✗ 礼赠证书与养护闭环守卫失败：\n  ' + fails.join('\n  '))
    process.exit(1)
  }
  console.log('✓ 礼赠证书与养护闭环：送礼人赠予凭证 ≠ 受礼人收藏证书 · 养护只归持有人（普通单自动收货/自提补排、幂等）· 证书日期取固化签发时间 · 领取核验未通过不绑定、限次、不泄号 · 送礼强制填受礼人手机号（新版标记缺号拒、旧版兼容、全量开关默认关） · 非礼赠行为不变（金样逐条一致）')
}

// 被测云函数代码留下的定时器会让进程白挂约 1.7s；判定已全部完成，冲刷输出后退出（保留 exitCode）
main().then(
  () => process.stdout.write('', () => process.exit()),
  (e) => { console.error(e); process.exit(1) },
)
