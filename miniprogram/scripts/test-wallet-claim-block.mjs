#!/usr/bin/env node
/**
 * 券夹「可领取」区块守卫（2026-10-29 产品负责人点名；双十一八折券是第一个用例，做成通用）
 *
 * 真跑真源码（全部在内存里加载，不写盘）：
 *   组件 WalletPanelCoupons（假 Component + 假 wx.cloud）、云函数 getClaimableCoupons（桩 SDK + 内存库）、
 *   纯模块 subpackages/business/utils/claimableCoupons.js。
 *
 *   W  WXML：区块只在 claimables.length 时渲染；「领取」按钮只在 !item.claimed 时出现且绑 onClaimTap；已领取走 wx:else
 *   N  不静默发券：组件 JS 里 receiveCoupon 只出现在 onClaimTap；onShow / ready / 加载可领列表全程零 receiveCoupon 调用；
 *      宿主页不得出现 receiveCoupon
 *   T  点击领取：receiveCoupon({ couponId, receiveType: 'manual' })；成功 → 就地「已领取」+ 刷新下方券夹 + AppToast；
 *      失败 → 就地 claimError 不标已领取；「每人限领」→ 就地标已领取；已领取的卡再点零调用；并发双击只调 1 次
 *   Q  就地提示：可领区块的加载 / 领取路径不得新增 wx.showToast / wx.showModal
 *   E  埋点：首次有可领券时 expose=true、之后 false；from 透传；本机退出登录零调用、区块清空
 *   C  云函数：可领判定对齐 receiveCoupon（未开始 / 已结束 / 固定到期已过或无法解析 / 库存 0 / 仅门店 / 已领满含 locked /
 *      新人券对已付款老客）→ 一律不列；HELD_STATUSES 与 receiveCoupon 逐项一致；只写 user_behaviors（不写券、不调云函数）；
 *      expose 且非空才记 1 条曝光；from 只收短标识
 *   D  展示派生：固定到期日显示具体日期；限领文案；折扣面额
 *
 *   node miniprogram/scripts/test-wallet-claim-block.mjs
 *   node miniprogram/scripts/test-wallet-claim-block.mjs --selftest   # 内存注入回归 → 必须检出（不写盘）
 */
process.env.TZ = 'Asia/Shanghai'

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const MP = join(ROOT, 'miniprogram')
const P = {
  js: 'subpackages/business/components/WalletPanelCoupons/index.js',
  wxml: 'subpackages/business/components/WalletPanelCoupons/index.wxml',
  host: 'subpackages/business/wallet-hub/index.js',
  util: 'subpackages/business/utils/claimableCoupons.js',
  fn: 'cloudfunctions/getClaimableCoupons/index.js',
  recv: 'cloudfunctions/receiveCoupon/index.js'
}
const read = (rel) => readFileSync(join(MP, rel), 'utf8')

/** 仓库根 package.json 是 type:module，小程序 .js 不能直接 require → 按路径以 CJS 递归装载 */
const cjsCache = new Map()
function cjsFile(abs) {
  const file = abs.endsWith('.js') ? abs : abs + '.js'
  if (!cjsCache.has(file)) {
    const mod = { exports: {} }
    cjsCache.set(file, mod)
    // eslint-disable-next-line no-new-func
    new Function('module', 'exports', 'require', readFileSync(file, 'utf8'))(mod, mod.exports, (id) => cjsFile(resolve(dirname(file), id)))
  }
  return cjsCache.get(file).exports
}
const realRequire = (id) => cjsFile(resolve(join(MP, dirname(P.util)), id))

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
}

/** 取对象方法体：`name(...) {` 或 `async name(...) {` 到配平的 `}` */
function methodBody(src, name) {
  const m = new RegExp(`\\n\\s*(?:async\\s+)?${name}\\s*\\([^)]*\\)\\s*\\{`).exec(src)
  if (!m) return null
  let i = m.index + m[0].length
  let depth = 1
  for (; i < src.length && depth; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') depth--
  }
  return src.slice(m.index, i)
}

function loadCjs(src, requireFn, globals = {}) {
  const module = { exports: {} }
  const saved = new Map()
  for (const [k, v] of Object.entries(globals)) {
    saved.set(k, Object.prototype.hasOwnProperty.call(globalThis, k) ? globalThis[k] : undefined)
    globalThis[k] = v
  }
  try {
    // eslint-disable-next-line no-new-func
    new Function('module', 'exports', 'require', src)(module, module.exports, requireFn)
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete globalThis[k]
      else globalThis[k] = v
    }
  }
  return module.exports
}

// ───────────────────────── 组件：假 Component + 假 wx ─────────────────────────
function loadPanel(srcs, opts) {
  const calls = []
  const counters = { fetchMyCoupons: 0, showToast: 0, showModal: 0 }
  const responders = opts.responders
  const wx = {
    cloud: {
      callFunction: (req) => {
        calls.push(JSON.parse(JSON.stringify(req)))
        const fn = responders[req.name]
        return fn ? Promise.resolve(fn(req.data || {})) : Promise.resolve({ result: { success: true } })
      }
    },
    showToast: () => { counters.showToast++ },
    showModal: () => { counters.showModal++ },
    showLoading: () => {},
    hideLoading: () => {},
    switchTab: () => {},
    navigateTo: () => {},
    getScreenBrightness: () => {},
    setScreenBrightness: () => {}
  }
  const utilExports = loadCjs(srcs.util, (id) => realRequire(id))
  const deps = {
    claimableCoupons: utilExports,
    couponService: { fetchMyCoupons: async () => { counters.fetchMyCoupons++; return { ok: true, list: [] } } },
    couponHelper: { couponTimeMs: () => 0 },
    orderScope: { ensureOpenId: async () => 'o1' },
    userSession: {
      isLocalLoggedOut: () => !!opts.loggedOut,
      resumeLocalSession: () => {},
      ensureSession: async () => ({}),
      needsOnboarding: () => false,
      navigateToOnboarding: () => {}
    },
    passRedeemFeedback: {
      REDEEM_POLL_MS: 1000, REDEEM_ANIM_MS: 1000, softVibrate: () => {},
      pollMemberPassRedeem: async () => ({}), shouldAcceptRedeem: () => false, formatRedeemValueText: () => ''
    },
    qrCanvas: { drawMemberQr: () => Promise.resolve(true) }
  }
  let cfg = null
  loadCjs(srcs.js, (id) => {
    for (const [k, v] of Object.entries(deps)) if (String(id).endsWith(k)) return v
    throw new Error('未打桩的依赖 ' + id)
  }, { wx, Component: (c) => { cfg = c }, getApp: () => ({ globalData: {} }) })
  const inst = {
    data: Object.assign(JSON.parse(JSON.stringify(cfg.data || {})), { from: opts.from || '' }),
    setData(patch) {
      for (const [k, v] of Object.entries(patch || {})) {
        const m = /^(\w+)\[(\d+)\]\.(\w+)$/.exec(k)
        if (m) this.data[m[1]][Number(m[2])][m[3]] = v
        else this.data[k] = v
      }
    },
    triggerEvent() {}
  }
  Object.assign(inst, cfg.methods)
  globalThis.wx = wx
  return { inst, cfg, calls, counters, wx }
}

const tick = () => new Promise((r) => setTimeout(r, 0))
async function settle(n = 6) { for (let i = 0; i < n; i++) await tick() }

const TPL = {
  _id: 'c11', title: '双十一 · 全场八折券', type: 'discount', value: 8, minSpend: 0, channel: 'all',
  limitPerUser: 1, heldCount: 0, fixedExpireTime: '2026-11-15T15:59:59.000Z', expireDays: 0, expireTime: '', claimEndTime: ''
}

async function panelChecks(srcs, fail) {
  // N：首屏 ready / 回页 onShow 全程零 receiveCoupon
  {
    const h = loadPanel(srcs, { from: 'sms1111', responders: { getClaimableCoupons: () => ({ result: { success: true, list: [TPL] } }) } })
    h.cfg.lifetimes.ready.call(h.inst)
    await settle()
    h.inst.onShow()
    await settle()
    if (h.calls.some((c) => c.name === 'receiveCoupon')) fail('N1 onShow / ready 自动调用了 receiveCoupon（静默发券）')
    const lists = h.calls.filter((c) => c.name === 'getClaimableCoupons')
    if (lists.length !== 2) fail(`E1 两次显示应各拉一次可领列表，实际 ${lists.length}`)
    if (!lists[0] || lists[0].data.expose !== true || lists[0].data.from !== 'sms1111') fail('E2 首次拉取应 expose=true 且透传 from')
    if (lists[1] && lists[1].data.expose !== false) fail('E3 已曝光后再拉取应 expose=false（不重复记曝光）')
    if ((h.inst.data.claimables || []).length !== 1) fail('T0 有可领券时 claimables 应有 1 张')
    const card = (h.inst.data.claimables || [])[0] || {}
    if (card.expireText !== '有效期至 2026.11.15') fail(`D1 固定到期日应显示具体日期，实际「${card.expireText}」`)
    if (card.limitText !== '每人限领 1 张') fail('D2 限领文案缺失')
    if (card.faceLabel !== '8折') fail(`D3 折扣面额应为 8折，实际 ${card.faceLabel}`)
  }
  // 无可领券 → 区块数据为空
  {
    const h = loadPanel(srcs, { responders: { getClaimableCoupons: () => ({ result: { success: true, list: [] } }) } })
    h.inst.onShow()
    await settle()
    if ((h.inst.data.claimables || []).length !== 0) fail('E4 无可领券时 claimables 应为空')
    const fh = loadPanel(srcs, { responders: { getClaimableCoupons: () => { throw new Error('net') } } })
    fh.inst.onShow()
    await settle()
    if ((fh.inst.data.claimables || []).length !== 0) fail('E5 拉取失败时区块应不显示')
  }
  // 本机退出登录：零调用、清空
  {
    const h = loadPanel(srcs, { loggedOut: true, responders: { getClaimableCoupons: () => ({ result: { success: true, list: [TPL] } }) } })
    h.inst.data.claimables = [{ ...TPL, claimed: false }]
    await h.inst.loadClaimables()
    if (h.calls.length) fail('E6 本机退出登录时不应拉取可领列表')
    if ((h.inst.data.claimables || []).length) fail('E7 本机退出登录时区块应清空')
  }
  // T：成功
  {
    const h = loadPanel(srcs, {
      from: 'sms1111',
      responders: {
        getClaimableCoupons: () => ({ result: { success: true, list: [TPL] } }),
        receiveCoupon: () => ({ result: { success: true, userCouponId: 'u1' } })
      }
    })
    h.inst.onShow()
    await settle()
    const before = h.counters.fetchMyCoupons
    const p1 = h.inst.onClaimTap({ currentTarget: { dataset: { id: 'c11' } } })
    const p2 = h.inst.onClaimTap({ currentTarget: { dataset: { id: 'c11' } } })
    await Promise.all([p1, p2])
    await settle()
    const recv = h.calls.filter((c) => c.name === 'receiveCoupon')
    if (recv.length !== 1) fail(`T1 并发双击应只调 1 次 receiveCoupon，实际 ${recv.length}`)
    if (!recv[0] || recv[0].data.couponId !== 'c11' || recv[0].data.receiveType !== 'manual') fail('T2 receiveCoupon 入参应为 { couponId, receiveType: manual }')
    const card = h.inst.data.claimables[0] || {}
    if (card.claimed !== true) fail('T3 领取成功后应就地标「已领取」')
    if (h.counters.fetchMyCoupons <= before) fail('T4 领取成功后应刷新下方券夹（loadCoupons）')
    if (h.inst.data.toastShow !== true) fail('T5 领取成功应用 AppToast 就地提示')
    const track = h.calls.filter((c) => c.name === 'getClaimableCoupons' && c.data.action === 'track')
    if (track.length !== 1 || track[0].data.ok !== true || track[0].data.from !== 'sms1111') fail('E8 领取应记 1 条 track（ok=true、带 from）')
    await h.inst.onClaimTap({ currentTarget: { dataset: { id: 'c11' } } })
    if (h.calls.filter((c) => c.name === 'receiveCoupon').length !== 1) fail('T6 已领取的卡再点不应再调 receiveCoupon')
    if (h.counters.showToast || h.counters.showModal) fail('Q1 可领区块不应调用 wx.showToast / wx.showModal')
  }
  // T：失败 / 限领
  for (const [msg, wantClaimed, label] of [['优惠券已领完', false, 'T7'], ['每人限领1张', true, 'T8']]) {
    const h = loadPanel(srcs, {
      responders: {
        getClaimableCoupons: () => ({ result: { success: true, list: [TPL] } }),
        receiveCoupon: () => ({ result: { success: false, msg } })
      }
    })
    h.inst.onShow()
    await settle()
    await h.inst.onClaimTap({ currentTarget: { dataset: { id: 'c11' } } })
    await settle()
    const card = h.inst.data.claimables[0] || {}
    if (card.claimed !== wantClaimed) fail(`${label} 「${msg}」后 claimed 应为 ${wantClaimed}`)
    if (!wantClaimed && card.claimError !== msg) fail(`${label} 失败应就地显示原因`)
    if (h.inst.data.claimingId !== '') fail(`${label} 失败后应复位 claimingId`)
    if (h.counters.showToast || h.counters.showModal) fail(`Q2 ${label} 失败提示不应走 wx.showToast / wx.showModal`)
  }
}

function staticChecks(srcs, fail) {
  const wxml = srcs.wxml
  const block = /<view class="claim-block"[^>]*>/.exec(wxml)
  if (!block || !/wx:if="\{\{claimables\.length\}\}"/.test(block[0])) fail('W1 可领区块必须 wx:if="{{claimables.length}}"（无可领券不渲染）')
  const btn = /<view[^>]*bindtap="onClaimTap"[^>]*>/.exec(wxml)
  if (!btn) fail('W2 缺少绑定 onClaimTap 的领取按钮')
  else if (!/wx:if="\{\{!item\.claimed\}\}"/.test(btn[0])) fail('W3 领取按钮必须只在 !item.claimed 时出现（已领满不显示领取）')
  if (!/wx:else[^>]*>已领取</.test(wxml)) fail('W4 已领取态缺失')

  const js = stripComments(srcs.js)
  const hits = js.split('receiveCoupon').length - 1
  const claim = methodBody(js, 'onClaimTap') || ''
  if (!claim.includes("name: 'receiveCoupon'")) fail('N2 onClaimTap 必须调用 receiveCoupon')
  if (hits !== (claim.split('receiveCoupon').length - 1)) fail('N3 组件里 receiveCoupon 只能出现在 onClaimTap（不得在加载 / 生命周期里发券）')
  if (/receiveCoupon/.test(stripComments(srcs.host))) fail('N4 宿主页不得调用 receiveCoupon')
  for (const name of ['onClaimTap', 'loadClaimables']) {
    const body = methodBody(js, name) || ''
    if (/wx\.show(Toast|Modal)\s*\(/.test(body)) fail(`Q3 ${name} 不得新增 wx.showToast / wx.showModal`)
  }
}

// ───────────────────────── 云函数：桩 SDK + 内存库 ─────────────────────────
function makeDb(seed) {
  const store = JSON.parse(JSON.stringify(seed))
  const writes = []
  const IN = (arr) => ({ __in: arr })
  const match = (doc, q) => Object.entries(q || {}).every(([k, v]) =>
    v && v.__in ? v.__in.includes(doc[k]) : doc[k] === v)
  const coll = (name) => {
    const rows = () => (store[name] = store[name] || [])
    const q = (cond, lim) => ({
      where: (c) => q(c, lim),
      limit: (n) => q(cond, n),
      get: async () => ({ data: rows().filter((d) => match(d, cond)).slice(0, lim || 100).map((d) => ({ ...d })) }),
      count: async () => ({ total: rows().filter((d) => match(d, cond)).length })
    })
    return {
      ...q({}, 0),
      add: async ({ data }) => { writes.push({ name, op: 'add', data }); rows().push(data); return { _id: 'new' } },
      doc: () => ({
        get: async () => ({ data: null }),
        update: async () => { writes.push({ name, op: 'update' }) },
        remove: async () => { writes.push({ name, op: 'remove' }) },
        set: async () => { writes.push({ name, op: 'set' }) }
      })
    }
  }
  return { db: { collection: coll, command: { in: IN }, serverDate: () => new Date() }, writes, store }
}

function loadFn(src, seed, openid) {
  const { db, writes } = makeDb(seed)
  let invoked = 0
  const sdk = {
    init: () => {},
    DYNAMIC_CURRENT_ENV: 'x',
    database: () => db,
    getWXContext: () => ({ OPENID: openid }),
    callFunction: () => { invoked++ }
  }
  const fnRequire = createRequire(join(MP, P.fn))
  const mod = loadCjs(src, (id) => (id === 'wx-server-sdk' ? sdk : fnRequire(id)))
  return { mod, writes, invokedCount: () => invoked }
}

const NOW = Date.now()
const iso = (ms) => new Date(NOW + ms).toISOString()
const H = 3600e3
const SEED = {
  coupons: [
    { _id: 'ok', active: true, name: '可领', type: 'discount', value: 8, limitPerUser: 1, channel: 'all', startTime: iso(-H), endTime: iso(H), fixedExpireTime: iso(2 * H) },
    { _id: 'full', active: true, name: '已领满(含锁定)', type: 'cash', value: 10, minSpend: 100, limitPerUser: 1 },
    { _id: 'future', active: true, name: '未开始', type: 'cash', value: 10, minSpend: 100, startTime: iso(H) },
    { _id: 'ended', active: true, name: '已结束', type: 'cash', value: 10, minSpend: 100, endTime: iso(-H) },
    { _id: 'fixedPast', active: true, name: '固定到期已过', type: 'cash', value: 10, minSpend: 100, fixedExpireTime: iso(-H) },
    { _id: 'fixedBad', active: true, name: '固定到期无法解析', type: 'cash', value: 10, minSpend: 100, fixedExpireTime: 'not-a-date' },
    { _id: 'store', active: true, name: '仅门店', type: 'cash', value: 10, minSpend: 100, channel: 'store' },
    { _id: 'stock0', active: true, name: '库存 0', type: 'cash', value: 10, minSpend: 100, totalStock: 0 },
    { _id: 'newbie', active: true, name: '新人券', type: 'newUser', value: 10, minSpend: 100 },
    { _id: 'off', active: false, name: '已下架', type: 'cash', value: 10, minSpend: 100 },
    { _id: 'multi', active: true, name: '限 2 已领 1', type: 'cash', value: 5, minSpend: 50, limitPerUser: 2 }
  ],
  user_coupons: [
    { _openid: 'u', couponId: 'full', status: 'locked' },
    { _openid: 'u', couponId: 'multi', status: 'used' }
  ],
  orders: [{ _openid: 'u', status: 'paid', totalPrice: '199' }]
}

async function cloudChecks(srcs, fail) {
  const recvHeld = /const HELD_STATUSES = (\[[^\]]*\])/.exec(srcs.recv)
  const fnHeld = /const HELD_STATUSES = (\[[^\]]*\])/.exec(srcs.fn)
  if (!recvHeld || !fnHeld || recvHeld[1].replace(/\s/g, '') !== fnHeld[1].replace(/\s/g, '')) {
    fail('C1 HELD_STATUSES 必须与 receiveCoupon 逐项一致（否则「列出来能领、点了报限领」）')
  }
  const code = stripComments(srcs.fn)
  if (/callFunction\s*\(/.test(code)) fail('C2 云函数不得调用其它云函数（发券只走客户端 → receiveCoupon）')
  if (/collection\(\s*['"](user_coupons|coupons)['"]\s*\)[\s\S]{0,200}?\.(add|update|remove|set)\s*\(/.test(code)) fail('C3 云函数不得写 coupons / user_coupons')

  {
    const { mod, writes, invokedCount } = loadFn(srcs.fn, SEED, 'u')
    const r = await mod.main({ action: 'list', expose: true, from: 'sms1111' })
    const ids = (r.list || []).map((c) => c._id).sort()
    if (JSON.stringify(ids) !== JSON.stringify(['multi', 'ok'])) fail(`C4 可领判定与 receiveCoupon 不一致：应只列 multi/ok，实际 ${ids.join(',')}`)
    const ok = (r.list || []).find((c) => c._id === 'ok') || {}
    if (ok.limitPerUser !== 1 || !ok.fixedExpireTime) fail('C5 出参缺 limitPerUser / fixedExpireTime')
    const nonBehavior = writes.filter((w) => w.name !== 'user_behaviors')
    if (nonBehavior.length || invokedCount()) fail('C6 list 只许写 user_behaviors：' + JSON.stringify(nonBehavior))
    const exp = writes.filter((w) => w.name === 'user_behaviors')
    if (exp.length !== 1 || exp[0].data.action !== 'wallet_claim_expose' || exp[0].data.from !== 'sms1111' || exp[0].data._openid !== 'u') {
      fail('C7 expose 且非空应记恰好 1 条曝光（带 from / openid）')
    }
    await mod.main({ action: 'list', expose: false })
    if (writes.filter((w) => w.name === 'user_behaviors').length !== 1) fail('C8 expose=false 不应记曝光')
    await mod.main({ action: 'track', couponId: 'ok', from: 'a b<script>', ok: true })
    const tap = writes.filter((w) => w.name === 'user_behaviors').slice(-1)[0] || { data: {} }
    if (tap.data.action !== 'wallet_claim_tap' || tap.data.from !== '') fail('C9 track 应记 wallet_claim_tap 且 from 只收短标识')
    if (writes.some((w) => w.name !== 'user_behaviors')) fail('C10 track 不得写券')
  }
  {
    const { mod } = loadFn(srcs.fn, { ...SEED, orders: [] }, 'u')
    const r = await mod.main({})
    if (!(r.list || []).some((c) => c._id === 'newbie')) fail('C11 无付款单的用户应能看到新人券')
  }
  {
    const { mod, writes } = loadFn(srcs.fn, { coupons: [SEED.coupons[1]], user_coupons: SEED.user_coupons }, 'u')
    const r = await mod.main({ expose: true })
    if (r.success !== true || (r.list || []).length || writes.length) fail('C12 无可领券时应成功返回空列表且不记曝光')
  }
}

async function runAll(srcs) {
  const errs = []
  const fail = (m) => errs.push(m)
  staticChecks(srcs, fail)
  await panelChecks(srcs, fail)
  await cloudChecks(srcs, fail)
  return errs
}

const SRC = {
  js: read(P.js), wxml: read(P.wxml), host: read(P.host), util: read(P.util), fn: read(P.fn), recv: read(P.recv)
}

const INJECTIONS = [
  ['区块去掉空列表门控', 'wxml', 'class="claim-block" wx:if="{{claimables.length}}"', 'class="claim-block"'],
  ['领取按钮去掉已领门控', 'wxml', 'wx:if="{{!item.claimed}}"\n            bindtap="onClaimTap"', 'bindtap="onClaimTap"'],
  ['onShow 里静默发券', 'js', '    this.loadClaimables()\n    this.refreshEmptyCta()', "    this.loadClaimables()\n    wx.cloud.callFunction({ name: 'receiveCoupon', data: { couponId: 'c11', receiveType: 'auto' } })\n    this.refreshEmptyCta()"],
  ['领取改成 auto', 'js', "data: { couponId: id, receiveType: 'manual' }", "data: { couponId: id, receiveType: 'auto' }"],
  ['成功后不刷新券夹', 'js', "      if (this._loadingCoupons) setTimeout(() => this.loadCoupons(), 800)\n      else this.loadCoupons()", '      void 0'],
  ['失败改走 showToast', 'js', "    this.setData(patch)\n    if (ok) {", "    if (!ok) wx.showToast({ title: msg, icon: 'none' })\n    this.setData(patch)\n    if (ok) {"],
  ['去掉防重入', 'js', 'if (!id || !item || item.claimed || this._claiming) return', 'if (!id || !item || item.claimed) return'],
  ['每次都记曝光', 'js', 'const expose = !this._claimExposed', 'const expose = true'],
  ['云函数不过滤已领满', 'fn', '.filter(({ limitPerUser, heldCount }) => !(limitPerUser > 0 && heldCount >= limitPerUser))', ''],
  ['HELD_STATUSES 漏 locked', 'fn', "const HELD_STATUSES = ['unused', 'available', 'locked', 'used']", "const HELD_STATUSES = ['unused', 'available', 'used']"],
  ['固定到期无法解析也放行', 'fn', 'if (!fixed || fixed.getTime() <= now.getTime()) return false', 'if (fixed && fixed.getTime() <= now.getTime()) return false'],
  ['云函数顺手发券', 'fn', "    const list = buildClaimable(open, { now, heldCounts, hasPaidOrder: paid })", "    const list = buildClaimable(open, { now, heldCounts, hasPaidOrder: paid })\n    for (const c of list) await db.collection('user_coupons').add({ data: { _openid: openid, couponId: c._id } })"],
  ['曝光不看列表是否为空', 'fn', 'if (event.expose === true && openid && list.length) {', 'if (event.expose === true && openid) {'],
  ['固定到期日不显示日期', 'util', 'if (fixed) return `有效期至 ${fixed}`', "if (fixed) return '限时有效'"]
]

async function main() {
  if (process.argv.includes('--selftest')) {
    const base = await runAll(SRC)
    if (base.length) {
      console.error('selftest 前置失败（真源本身不通过）：\n- ' + base.join('\n- '))
      process.exit(1)
    }
    let bad = 0
    for (const [label, key, from, to] of INJECTIONS) {
      if (!SRC[key].includes(from)) {
        console.error(`✗ 注入锚点失效：${label}`)
        bad++
        continue
      }
      const errs = await runAll({ ...SRC, [key]: SRC[key].replace(from, to) })
      if (!errs.length) {
        console.error(`✗ 未检出：${label}`)
        bad++
      } else {
        console.log(`✓ 检出：${label} → ${errs[0]}`)
      }
    }
    if (bad) process.exit(1)
    console.log(`selftest 通过：${INJECTIONS.length} 个内存注入全部检出（不写盘）`)
    return
  }
  const errs = await runAll(SRC)
  if (errs.length) {
    console.error('✗ 券夹可领取区块：\n- ' + errs.join('\n- '))
    process.exit(1)
  }
  console.log('✓ 券夹可领取区块：渲染门控 / 不静默发券 / 领取就地反馈 / 埋点 / 云函数可领口径与 receiveCoupon 一致 / 只写行为表')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
