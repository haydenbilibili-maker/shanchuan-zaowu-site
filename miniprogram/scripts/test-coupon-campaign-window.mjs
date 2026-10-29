#!/usr/bin/env node
/**
 * 券模板「领取时间窗 + 固定到期日」守卫（2026-10-29 双十一八折券，产品负责人点名）
 *
 * 真跑云函数真源（receiveCoupon / makeOrder / verifyStoreCoupon 的临时副本 + 桩 wx-server-sdk + 内存库），
 * 进程时区固定 UTC（与云函数运行时一致），用假时钟逐个时刻验：
 *   T  模板常量（create-double11-coupon.mjs）：三个时刻是北京时间 10-30 00:00:00 / 11-15 23:59:59 的绝对时刻；
 *      八折（倍率 0.8）、limitPerUser=1、channel=all、active、无 stackable / totalStock、expireDays=0
 *   E  ERP 换算（admin/src/utils/couponWindow.js）：北京墙钟 ↔ 绝对时刻在 UTC 进程里不漂移
 *   W  时间窗：10-29 23:59:59 不可领、10-30 00:00:00 可领、11-16 00:00:00 不可领
 *   X  领到的券 expireTime = 11-15 23:59:59（+08:00）；fixedExpireTime 与 expireDays 并存取较早者
 *   L  每人限 1：第 2 次被拒；第 1 张锁在待支付单（locked）时也被拒；并发双击只落 1 张
 *   O  旧模板行为不变：expireDays → 领取后 N 天；无 expireDays 有模板 expireTime → 用它；都没有 → 30 天
 *   P  makeOrder 计价预览：¥299 非会员 → 239.2；会员价 269.1（0.9）叠加 → 卡在地板 224.25；礼赠单同样可用
 *   S  门店核销 verifyStoreCoupon：有效期内可核销（status→used）；11-16 00:00 拒「已过期」
 *   A  自动发放 issueCampaignCoupon（产品负责人 2026-10-29 改口「直接发到券夹」）：10-29 23:59:59 / 11-16 00:00 空转
 *      （模板 startTime 被改早也不发）；只发未注销会员（含员工）；手动领过 / 已用过的不再发；重跑与并发只落 1 张；
 *      文档与 receiveCoupon 同构（同 _id 规则，receiveType=auto_campaign）；到期 11-15 23:59:59；只认定时触发器，dryRun 仅超管
 *
 *   node miniprogram/scripts/test-coupon-campaign-window.mjs
 *   node miniprogram/scripts/test-coupon-campaign-window.mjs --selftest   # 临时副本里逐条注入回归 → 必须检出（不写工作区）
 */
process.env.TZ = 'UTC'

import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '../..')
const FN_ROOT = join(ROOT, 'miniprogram/cloudfunctions')
const FNS = ['receiveCoupon', 'makeOrder', 'verifyStoreCoupon', 'issueCampaignCoupon']
const SCRIPT_REL = 'miniprogram/scripts/create-double11-coupon.mjs'
const ERP_REL = 'admin/src/utils/couponWindow.js'
const require = createRequire(import.meta.url)

const BJ = (s) => new Date(`${s}+08:00`).getTime()
const T_BEFORE = BJ('2026-10-29T23:59:59')
const T_START = BJ('2026-10-30T00:00:00')
const T_MID = BJ('2026-11-05T12:00:00')
const T_LAST = BJ('2026-11-15T23:59:59')
const T_AFTER = BJ('2026-11-16T00:00:00')

// ───────────────────────── 桩 SDK + 内存库 ─────────────────────────
const SDK = `
const S = new Proxy({}, { get: (_, k) => global.__CW[k] })
const CMD = (op) => (v) => ({ __op: op, v })
const clone = (x) => (x === undefined ? undefined : structuredClone(x))
function pick(doc, k) { return k.split('.').reduce((o, p) => (o == null ? undefined : o[p]), doc) }
function matchOne(doc, cond) {
  if (cond && cond.__op === 'or') return cond.v.some((c) => matchOne(doc, c))
  if (cond && cond.__op === 'and') return cond.v.every((c) => matchOne(doc, c))
  return Object.keys(cond || {}).every((k) => {
    const want = cond[k]
    const got = pick(doc, k)
    if (want && want.__op === 'in') return want.v.indexOf(got) !== -1
    if (want && want.__op === 'nin') return want.v.indexOf(got) === -1
    if (want && want.__op === 'neq') return got !== want.v
    if (want && want.__op === 'exists') return (got !== undefined) === want.v
    if (want && want.__op === 'gte') return got >= want.v
    if (want && want.__op === 'gt') return got > want.v
    if (want && want.__op === 'lte') return got <= want.v
    if (want && want.__op === 'lt') return got < want.v
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
    else if (v && v.__op === 'inc') o[last] = (Number(o[last]) || 0) + v.v
    else if (v && v.__op === 'serverDate') o[last] = new Date()
    else if (v && v.__op === 'set') o[last] = clone(v.v)
    else if (v && v.__op) o[last] = v.v
    else o[last] = clone(v)
  }
}
async function tick() { await new Promise((r) => setImmediate(r)) }
function table(name) { return (S.db[name] = S.db[name] || []) }
function query(name, conds, opts) {
  const rows = () => {
    let r = table(name).filter((d) => conds.every((c) => matchOne(d, c)))
    if (opts.skip) r = r.slice(opts.skip)
    if (opts.limit != null) r = r.slice(0, opts.limit)
    return r
  }
  const q = {
    where: (c) => query(name, conds.concat([c]), opts),
    orderBy: () => q,
    field: () => q,
    limit: (n) => query(name, conds, { ...opts, limit: n }),
    skip: (n) => query(name, conds, { ...opts, skip: n }),
    async get() { await tick(); return { data: rows().map(clone) } },
    async count() { await tick(); return { total: rows().length } },
    async update({ data }) { await tick(); const r = rows(); r.forEach((d) => applyPatch(d, data)); return { stats: { updated: r.length } } },
    async remove() { const r = rows(); S.db[name] = table(name).filter((d) => r.indexOf(d) === -1); return { stats: { removed: r.length } } }
  }
  return q
}
let seq = 0
function collection(name) {
  return {
    ...query(name, [], {}),
    doc(id) {
      return {
        async get() {
          await tick()
          const d = table(name).find((x) => x._id === id)
          if (!d) throw new Error('document.get:fail document with _id ' + id + ' does not exist')
          return { data: clone(d) }
        },
        async update({ data }) { await tick(); const d = table(name).find((x) => x._id === id); if (d) applyPatch(d, data); return { stats: { updated: d ? 1 : 0 } } },
        async set({ data }) { const t = table(name); const i = t.findIndex((x) => x._id === id); const row = { ...clone(data), _id: id }; if (i >= 0) t[i] = row; else t.push(row); return { stats: { updated: 1 } } },
        async remove() { S.db[name] = table(name).filter((x) => x._id !== id); return { stats: { removed: 1 } } }
      }
    },
    async add({ data }) {
      await tick()
      const row = clone(data)
      for (const [k, v] of Object.entries(row)) if (v && v.__op === 'serverDate') row[k] = new Date()
      row._id = row._id || ('auto_' + (++seq))
      if (table(name).some((x) => x._id === row._id)) throw new Error('E11000 duplicate key error: _id ' + row._id)
      table(name).push(row)
      return { _id: row._id }
    }
  }
}
const command = {
  in: CMD('in'), nin: CMD('nin'), neq: CMD('neq'), exists: CMD('exists'), gte: CMD('gte'), gt: CMD('gt'),
  lte: CMD('lte'), lt: CMD('lt'), inc: CMD('inc'), set: CMD('set'),
  remove: () => ({ __op: 'remove' }),
  or: (...a) => ({ __op: 'or', v: a.flat() }), and: (...a) => ({ __op: 'and', v: a.flat() })
}
module.exports = {
  DYNAMIC_CURRENT_ENV: 'test',
  init() {},
  getWXContext: () => ({ OPENID: S.openid }),
  database: () => ({ collection, command, serverDate: () => ({ __op: 'serverDate' }), RegExp: (o) => o }),
  callFunction: async () => ({ result: { success: true, pending: true } })
}
`

const STAFF_STUB = `module.exports = { assertStaff: async () => ({ ok: true, actor: { name: '测试店员', openid: 'staff_1' } }) }\n`
const SUPER_STUB = `module.exports = { assertStaff: async (db, openid, o) => (global.__CW.superAdmin && o && o.requireSuperAdmin ? { ok: true } : { ok: false, msg: '无权限' }) }\n`

// ───────────────────────── 假时钟 ─────────────────────────
const RealDate = Date
function installClock() {
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(global.__CW_NOW); else super(...a) }
    static now() { return global.__CW_NOW }
  }
  globalThis.Date = FakeDate
}
const setNow = (ms) => { global.__CW_NOW = ms }

// ───────────────────────── 准备临时副本 ─────────────────────────
function prepare(inject) {
  const dir = mkdtempSync(join(tmpdir(), 'coupon-window-'))
  for (const fn of FNS) {
    const dst = join(dir, fn)
    cpSync(join(FN_ROOT, fn), dst, { recursive: true, filter: (p) => !p.includes('node_modules') })
    mkdirSync(join(dst, 'node_modules/wx-server-sdk'), { recursive: true })
    writeFileSync(join(dst, 'node_modules/wx-server-sdk/index.js'), SDK)
  }
  writeFileSync(join(dir, 'verifyStoreCoupon/staffGuard.js'), STAFF_STUB)
  writeFileSync(join(dir, 'issueCampaignCoupon/staffGuard.js'), SUPER_STUB)
  mkdirSync(join(dir, 'extra'), { recursive: true })
  cpSync(join(ROOT, SCRIPT_REL), join(dir, 'extra/create-double11-coupon.mjs'))
  cpSync(join(ROOT, ERP_REL), join(dir, 'extra/couponWindow.mjs'))
  if (inject) {
    const p = join(dir, inject.file)
    const src = readFileSync(p, 'utf8')
    if (!src.includes(inject.from)) throw new Error(`注入锚点不存在：${inject.name}`)
    writeFileSync(p, inject.all ? src.split(inject.from).join(inject.to) : src.replace(inject.from, inject.to))
  }
  return dir
}

// ───────────────────────── 用例 ─────────────────────────
async function runSuite(dir) {
  const quiet = { error: console.error, warn: console.warn, log: console.log }
  console.error = () => {}
  console.warn = () => {}
  console.log = () => {}
  try {
    return await runCases(dir)
  } finally {
    console.error = quiet.error
    console.warn = quiet.warn
    console.log = quiet.log
    globalThis.Date = RealDate
  }
}

async function runCases(dir) {
  const fails = []
  const ok = (cond, msg) => { if (!cond) fails.push(msg) }
  const tpl = await import(pathToFileURL(join(dir, 'extra/create-double11-coupon.mjs')).href)
  const erp = await import(pathToFileURL(join(dir, 'extra/couponWindow.mjs')).href)
  const rules = require(join(dir, 'makeOrder/couponDiscountRules.js'))

  // T 模板常量
  const doc = tpl.buildCouponDoc(tpl.DOUBLE11_TEMPLATE, T_BEFORE)
  ok(doc.startTime.getTime() === T_START, `T1 startTime 应为北京 10-30 00:00:00，实为 ${doc.startTime.toISOString()}`)
  ok(doc.endTime.getTime() === T_LAST, `T2 endTime 应为北京 11-15 23:59:59，实为 ${doc.endTime.toISOString()}`)
  ok(doc.fixedExpireTime.getTime() === T_LAST, `T3 fixedExpireTime 应为北京 11-15 23:59:59，实为 ${doc.fixedExpireTime.toISOString()}`)
  ok(doc.type === 'discount' && Math.abs(rules.couponDiscountMultiplier(doc.value) - 0.8) < 1e-9, 'T4 应为八折折扣券')
  ok(rules.validateDiscountCoupon(doc.value).ok, 'T4b 折扣须过 7.5 折地板校验')
  ok(doc.limitPerUser === 1 && doc.channel === 'all' && doc.active === true && !doc.expireDays && (Number(doc.minSpend) || 0) === 0, 'T5 limitPerUser=1 / channel=all / active / expireDays=0 / 无门槛')
  ok(!('stackable' in doc) && !('totalStock' in doc), 'T6 不得设 stackable / totalStock')

  // E ERP 换算（进程时区 UTC）
  ok(erp.bjWallToDate('2026-10-30 00:00:00') && erp.bjWallToDate('2026-10-30 00:00:00').getTime() === T_START, 'E1 ERP 北京墙钟 → 绝对时刻在 UTC 进程漂移')
  ok(erp.dateToBjWall(new Date(T_LAST)) === '2026-11-15 23:59:59', `E2 ERP 绝对时刻 → 北京墙钟应为 2026-11-15 23:59:59，实为 ${erp.dateToBjWall(new Date(T_LAST))}`)
  ok(erp.dateToBjWall({ $date: T_START }) === '2026-10-30 00:00:00', 'E3 ERP 读 {$date} 形状')
  ok(erp.bjWallToDate('') === null && erp.bjWallToDate('2026/10/30') === null, 'E4 空 / 非法墙钟返回 null')

  installClock()
  const receive = require(join(dir, 'receiveCoupon/index.js')).main
  const makeOrder = require(join(dir, 'makeOrder/index.js')).main
  const verify = require(join(dir, 'verifyStoreCoupon/index.js')).main
  const C_ID = 'tpl_double11'
  const freshDb = () => ({
    coupons: [
      { _id: C_ID, ...doc },
      { _id: 'legacy_days', name: '旧券·天数', type: 'cash', value: 10, minSpend: 100, expireDays: 7, limitPerUser: 0, channel: 'all', active: true, expireTime: new RealDate(BJ('2026-11-06T00:00:00')) },
      { _id: 'legacy_limit1', name: '旧券·限 1', type: 'cash', value: 10, minSpend: 100, expireDays: 7, limitPerUser: 1, channel: 'all', active: true },
      { _id: 'fixed_no_end', name: '固定到期·无截止', type: 'discount', value: 9, minSpend: 0, limitPerUser: 0, channel: 'all', active: true, fixedExpireTime: new RealDate(T_LAST) },
      { _id: 'legacy_tplexp', name: '旧券·模板到期', type: 'cash', value: 10, minSpend: 100, limitPerUser: 0, channel: 'all', active: true, expireTime: new RealDate(BJ('2026-12-01T00:00:00')) },
      { _id: 'legacy_none', name: '旧券·默认', type: 'cash', value: 10, minSpend: 100, limitPerUser: 0, channel: 'all', active: true },
      { _id: 'mixed', name: '固定+天数', type: 'discount', value: 9, minSpend: 0, expireDays: 3, limitPerUser: 0, channel: 'all', active: true, fixedExpireTime: new RealDate(T_LAST) }
    ]
  })
  global.__CW = { db: freshDb(), openid: 'u_alice' }
  const userCoupons = (openid) => (global.__CW.db.user_coupons || []).filter((c) => c._openid === openid && c.couponId === C_ID)

  // W 时间窗
  setNow(T_BEFORE)
  let r = await receive({ couponId: C_ID, receiveType: 'manual' })
  ok(r && r.success === false && /尚未开始/.test(r.msg || ''), `W1 10-29 23:59:59 应「尚未开始」，实为 ${JSON.stringify(r)}`)
  setNow(T_START)
  r = await receive({ couponId: C_ID, receiveType: 'manual' })
  ok(r && r.success === true, `W2 10-30 00:00:00 应可领，实为 ${JSON.stringify(r)}`)
  // X 到期
  const got = userCoupons('u_alice')[0]
  const exp = got && new RealDate(got.expireTime).getTime()
  ok(exp === T_LAST, `X1 用户券应在 11-15 23:59:59（+08:00）到期，实为 ${got && new RealDate(got.expireTime).toISOString()}`)
  // L 限 1
  r = await receive({ couponId: C_ID, receiveType: 'manual' })
  ok(r && r.success === false && /限领/.test(r.msg || ''), `L1 第 2 次领取应被拒，实为 ${JSON.stringify(r)}`)
  if (got) got.status = 'locked'
  r = await receive({ couponId: C_ID, receiveType: 'manual' })
  ok(r && r.success === false, `L2 第 1 张锁在待支付单时再领应被拒，实为 ${JSON.stringify(r)}`)
  if (got) got.status = 'unused'
  ok(userCoupons('u_alice').length === 1, `L3 alice 只应有 1 张，实为 ${userCoupons('u_alice').length}`)
  global.__CW.openid = 'u_bob'
  const both = await Promise.all([receive({ couponId: C_ID, receiveType: 'manual' }), receive({ couponId: C_ID, receiveType: 'manual' })])
  ok(userCoupons('u_bob').length === 1, `L4 并发双击只应落 1 张，实为 ${userCoupons('u_bob').length}（${JSON.stringify(both.map((x) => x && x.success))}）`)
  global.__CW.openid = 'u_carol'
  setNow(T_AFTER)
  r = await receive({ couponId: C_ID, receiveType: 'manual' })
  ok(r && r.success === false, `W3 11-16 00:00:00 应不可领，实为 ${JSON.stringify(r)}`)
  setNow(T_LAST - 1000)
  r = await receive({ couponId: 'mixed', receiveType: 'manual' })
  const mixed = (global.__CW.db.user_coupons || []).find((c) => c._openid === 'u_carol' && c.couponId === 'mixed')
  ok(mixed && new RealDate(mixed.expireTime).getTime() === T_LAST, `X2 固定到期与 3 天并存应取较早者（固定），实为 ${mixed && new RealDate(mixed.expireTime).toISOString()}`)
  global.__CW.openid = 'u_dave'
  setNow(T_START)
  r = await receive({ couponId: 'mixed', receiveType: 'manual' })
  const mixed2 = (global.__CW.db.user_coupons || []).find((c) => c._openid === 'u_dave' && c.couponId === 'mixed')
  ok(mixed2 && new RealDate(mixed2.expireTime).getTime() === T_START + 3 * 86400e3, `X3 领取后 3 天早于固定到期时应取 3 天，实为 ${mixed2 && new RealDate(mixed2.expireTime).toISOString()}`)

  // L5 非活动券（无固定到期）限 1：第 1 张锁在待支付单时也算已领
  global.__CW.openid = 'u_lim'
  setNow(T_MID)
  await receive({ couponId: 'legacy_limit1', receiveType: 'manual' })
  const lim = (global.__CW.db.user_coupons || []).find((c) => c._openid === 'u_lim' && c.couponId === 'legacy_limit1')
  if (lim) lim.status = 'locked'
  r = await receive({ couponId: 'legacy_limit1', receiveType: 'manual' })
  ok(lim && r && r.success === false && /限领/.test(r.msg || ''), `L5 限 1 券锁在待支付单时再领应被拒，实为 ${JSON.stringify(r && { s: r.success, msg: r.msg })}`)
  // W4 无领取截止但已过固定到期：不得再发一张「领到即过期」的券
  setNow(T_AFTER)
  r = await receive({ couponId: 'fixed_no_end', receiveType: 'manual' })
  ok(r && r.success === false && /过期/.test(r.msg || ''), `W4 过了固定到期应拒领，实为 ${JSON.stringify(r && { s: r.success, msg: r.msg })}`)

  // O 旧模板行为
  global.__CW.openid = 'u_old'
  setNow(T_MID)
  const legacyExp = async (id) => {
    await receive({ couponId: id, receiveType: 'manual' })
    const row = (global.__CW.db.user_coupons || []).find((c) => c._openid === 'u_old' && c.couponId === id)
    return row ? new RealDate(row.expireTime).getTime() : NaN
  }
  ok(await legacyExp('legacy_days') === T_MID + 7 * 86400e3, 'O1 旧券有 expireDays → 领取后 N 天（模板 expireTime 更早也不参与）')
  ok(await legacyExp('legacy_tplexp') === BJ('2026-12-01T00:00:00'), 'O2 旧券无 expireDays 有模板 expireTime → 用模板 expireTime')
  ok(await legacyExp('legacy_none') === T_MID + 30 * 86400e3, 'O3 旧券都没有 → 领取后 30 天')
  ok(!(global.__CW.db.user_coupons || []).some((c) => c._openid === 'u_old' && String(c._id).startsWith('cw_')), 'O4 旧券不得用活动券的确定性 _id')

  // P 计价（makeOrder 预览：普通单 + 礼赠单）
  const LEVELS = [
    { level: 1, name: '原木·见习者', threshold: 100, discountRate: 1 },
    { level: 2, name: '秘银·采集家', threshold: 1000, discountRate: 0.95 },
    { level: 3, name: '流金·研究员', threshold: 2000, discountRate: 0.9 },
    { level: 4, name: '曜石·策展人', threshold: 10000, discountRate: 0.85 },
    { level: 5, name: '星陨·守护者', threshold: 30000, discountRate: 0.8 },
    { level: 6, name: '星耀·博物官', threshold: 100000, discountRate: 0.7 },
    { level: 99, name: '荣誉馆长', threshold: 0, discountRate: 0.7 }
  ]
  setNow(T_MID)
  global.__CW.db.member_levels = LEVELS
  global.__CW.db.products = [{ _id: 'p299', title: '测试藏品', price: 299, stock: 5, craftType: 'frame', images: [] }]
  global.__CW.db.users = [{ _openid: 'u_member', storeGrowthValue: 2500 }]
  const bobCoupon = userCoupons('u_bob')[0]
  const memberCoupon = { ...structuredClone(bobCoupon), _id: 'uc_member', _openid: 'u_member' }
  global.__CW.db.user_coupons.push(memberCoupon)
  const preview = async (openid, couponId, gift) => {
    global.__CW.openid = openid
    return makeOrder({
      previewOnly: true,
      items: [{ productId: 'p299', count: 1 }],
      couponId,
      ...(gift ? { source: 'gift', giftMeta: { deliveryType: 'express', relation: 'friend' } } : {})
    })
  }
  const near = (a, b) => Math.abs(Number(a) - b) < 0.005
  r = await preview('u_bob', bobCoupon && bobCoupon._id, false)
  ok(r && r.success && near(r.vipTotal, 299) && near(r.goodsPrice, 239.2), `P1 ¥299 非会员券后商品应付 239.2，实为 ${JSON.stringify(r && { vip: r.vipTotal, goods: r.goodsPrice, coupon: r.couponValue, msg: r.msg })}`)
  r = await preview('u_member', 'uc_member', false)
  ok(r && r.success && near(r.vipTotal, 269.1) && near(r.goodsPrice, 224.25) && near(r.couponValue, 44.85), `P2 会员价 269.1 叠加应卡在地板 224.25（券抵 44.85），实为 ${JSON.stringify(r && { vip: r.vipTotal, goods: r.goodsPrice, coupon: r.couponValue, msg: r.msg })}`)
  r = await preview('u_bob', bobCoupon && bobCoupon._id, true)
  ok(r && r.success && near(r.goodsPrice, 239.2) && near(r.couponValue, 59.8), `P3 礼赠单可用八折券，实为 ${JSON.stringify(r && { goods: r.goodsPrice, coupon: r.couponValue, msg: r.msg })}`)
  setNow(T_AFTER)
  r = await preview('u_bob', bobCoupon && bobCoupon._id, false)
  ok(r && r.success === false && /过期/.test(r.msg || ''), `P4 11-16 下单用券应「已过期」，实为 ${JSON.stringify(r && { s: r.success, msg: r.msg })}`)

  // S 门店核销
  global.__CW.openid = 'staff_1'
  const redeem = (id, req) => verify({ action: 'redeem', storeId: 'store_1', clientRequestId: req, userCouponId: id, amount: 299, receiptImages: ['cloud://env/receipt.jpg'] })
  setNow(T_AFTER)
  r = await redeem('uc_member', 'req_late')
  ok(r && r.success === false && /过期/.test(r.msg || ''), `S1 11-16 门店核销应「已过期」，实为 ${JSON.stringify(r && { s: r.success, msg: r.msg })}`)
  setNow(T_LAST - 60e3)
  r = await redeem('uc_member', 'req_ok')
  const used = global.__CW.db.user_coupons.find((c) => c._id === 'uc_member')
  ok(r && r.success === true && used && used.status === 'used' && used.usedChannel === 'store', `S2 有效期内门店可核销八折券，实为 ${JSON.stringify(r && { s: r.success, msg: r.msg })}`)

  await runAutoIssueCases(dir, doc, receive, ok)

  globalThis.Date = RealDate
  return fails
}

// A 自动发放（issueCampaignCoupon）：窗口外空转 / 只发注册会员 / 不重发 / 与 receiveCoupon 同构 / 只认定时触发器
async function runAutoIssueCases(dir, doc, receive, ok) {
  const issue = require(join(dir, 'issueCampaignCoupon/index.js')).main
  const AUTO_ID = '40407fa6e7f8342ac6a47201bfc92a15'
  const timer = () => { global.__CW.openid = ''; return issue({ Type: 'Timer', TriggerName: 'issueCampaignCouponRun' }) }
  global.__CW = {
    db: {
      coupons: [{ _id: AUTO_ID, ...structuredClone(doc) }],
      users: [
        { _id: 'a1', _openid: 'm_one' },
        { _id: 'a2', _openid: 'm_two', status: 'active' },
        { _id: 'a3', _openid: 'm_staff', staffRole: 'staff' },
        { _id: 'a4', _openid: 'm_gone', status: 'cancelled' },
        { _id: 'a5', _openid: 'm_claimed' }
      ]
    },
    openid: ''
  }
  const ucs = () => (global.__CW.db.user_coupons || []).filter((c) => c.couponId === AUTO_ID)
  const of = (openid) => ucs().filter((c) => c._openid === openid)
  const tplRow = global.__CW.db.coupons[0]

  setNow(T_BEFORE)
  let r = await timer()
  ok(ucs().length === 0 && r && r.results && r.results[0] && r.results[0].skipped, `A1 10-29 23:59:59 定时触发不得发券，实为 ${ucs().length} 张`)
  tplRow.startTime = new RealDate(BJ('2026-10-01T00:00:00'))
  r = await timer()
  ok(ucs().length === 0, `A1b 模板 startTime 被改早，10-29 23:59:59 仍不得发（活动常量兜底），实为 ${ucs().length} 张`)
  tplRow.startTime = new RealDate(T_MID)
  setNow(T_START)
  r = await timer()
  ok(ucs().length === 0, `A2 模板 startTime 晚于活动开始时以模板为准不发，实为 ${ucs().length} 张`)
  tplRow.startTime = new RealDate(T_START)

  global.__CW.superAdmin = false
  global.__CW.openid = 'm_one'
  r = await issue({ action: 'dryRun' })
  ok(r && r.success === false && ucs().length === 0, `A3 非超管 dryRun 应被拒，实为 ${JSON.stringify(r)}`)
  r = await issue({ Type: 'Timer' })
  ok(r && r.success === false && ucs().length === 0, `A4 小程序端伪造定时事件应被拒，实为 ${JSON.stringify(r)}`)
  global.__CW.superAdmin = true
  setNow(T_BEFORE)
  r = await issue({ action: 'dryRun' })
  const dr = r && r.results && r.results[0]
  ok(dr && dr.wouldIssue === 4 && dr.windowOpen === false && ucs().length === 0, `A5 超管 dryRun（窗口外）应报将发 4 人且不写库，实为 ${JSON.stringify(r)}`)
  global.__CW.superAdmin = false

  setNow(T_START)
  global.__CW.openid = 'm_claimed'
  await receive({ couponId: AUTO_ID, receiveType: 'manual' })
  r = await timer()
  const run = r && r.results && r.results[0]
  ok(run && run.issued === 3 && run.dup === 0 && run.failed === 0 && run.members === 4,
    `A6 10-30 00:00:00 应发给 3 位未持券会员（含员工、不含已注销、手动领过的跳过），实为 ${JSON.stringify(run)}`)
  ok(of('m_one').length === 1 && of('m_two').length === 1 && of('m_staff').length === 1 && of('m_gone').length === 0 && of('m_claimed').length === 1,
    `A7 每位会员恰 1 张、已注销 0 张，实为 ${JSON.stringify(['m_one', 'm_two', 'm_staff', 'm_gone', 'm_claimed'].map((o) => of(o).length))}`)

  const manual = of('m_claimed')[0]
  const auto = of('m_one')[0]
  const strip = (d) => { const o = { ...d }; delete o._id; delete o._openid; delete o.receiveType; delete o.createTime; return o }
  ok(manual && auto && JSON.stringify(Object.keys(manual)) === JSON.stringify(Object.keys(auto)) && JSON.stringify(strip(manual)) === JSON.stringify(strip(auto)),
    `A8 自动发放文档须与 receiveCoupon 同构，手动 ${JSON.stringify(manual && strip(manual))} / 自动 ${JSON.stringify(auto && strip(auto))}`)
  ok(auto && auto._id === `cw_${AUTO_ID}_m_one` && auto.receiveType === 'auto_campaign' && auto.status === 'unused',
    `A9 _id 同 receiveCoupon 活动券规则、receiveType=auto_campaign、未使用，实为 ${JSON.stringify(auto && { id: auto._id, rt: auto.receiveType, s: auto.status })}`)
  ok(auto && new RealDate(auto.expireTime).getTime() === T_LAST, `A10 自动发放券应在 11-15 23:59:59（+08:00）到期，实为 ${auto && new RealDate(auto.expireTime).toISOString()}`)

  r = await timer()
  ok(ucs().length === 4 && r.results[0].issued === 0, `A11 重跑不得重发，实为 ${ucs().length} 张 / ${JSON.stringify(r.results[0])}`)
  if (auto) auto.status = 'used'
  r = await timer()
  ok(of('m_one').length === 1, `A12 已用掉的券不得补发，实为 ${of('m_one').length} 张`)

  setNow(T_MID)
  global.__CW.db.users.push({ _id: 'a6', _openid: 'm_new' })
  await Promise.all([timer(), timer()])
  ok(of('m_new').length === 1, `A13 新注册会员下一轮到账且并发两轮只落 1 张，实为 ${of('m_new').length}`)

  setNow(T_AFTER)
  global.__CW.db.users.push({ _id: 'a7', _openid: 'm_late' })
  r = await timer()
  ok(of('m_late').length === 0, `A14 11-16 00:00:00 不得再发，实为 ${of('m_late').length}`)
  tplRow.endTime = new RealDate(BJ('2026-11-30T23:59:59'))
  tplRow.fixedExpireTime = new RealDate(BJ('2026-11-30T23:59:59'))
  r = await timer()
  ok(of('m_late').length === 0, `A14b 模板截止被改晚，11-16 00:00:00 仍不得发（活动常量兜底），实为 ${of('m_late').length}`)

  const same = (rel) => readFileSync(join(FN_ROOT, 'receiveCoupon', rel), 'utf8') === readFileSync(join(dir, 'issueCampaignCoupon', rel), 'utf8')
  ok(same('couponDiscountRules.js') && same('couponChannel.js'), 'A15 issueCampaignCoupon 的 couponDiscountRules.js / couponChannel.js 须与 receiveCoupon 逐字一致')
}

const INJECTIONS = [
  { name: '去掉固定到期（只按天数 / 30 天）', file: 'receiveCoupon/index.js', from: 'const fixed = toInstant(coupon.fixedExpireTime)\n  if (fixed) {', to: 'const fixed = null\n  if (fixed) {' },
  { name: '时区写错：模板时刻改成 UTC（Z）', file: 'extra/create-double11-coupon.mjs', from: '+08:00', to: 'Z', all: true },
  { name: '时区写错：模板时刻不带时区（按运行时区解析）', file: 'extra/create-double11-coupon.mjs', from: '+08:00\'', to: '\'', all: true },
  { name: '时区写错：ERP 墙钟换算丢了 +08:00', file: 'extra/couponWindow.mjs', from: "}+08:00`)", to: '}`)' },
  { name: '旧券行为被改：模板 expireTime 也当固定到期', file: 'receiveCoupon/index.js', from: 'toInstant(coupon.fixedExpireTime)\n  if (fixed)', to: 'toInstant(coupon.fixedExpireTime || coupon.expireTime)\n  if (fixed)' },
  { name: '旧券行为被改：无 expireDays 时不再读模板 expireTime', file: 'receiveCoupon/index.js', from: '(coupon.expireTime || new Date(nowMs + 30 * DAY_MS))', to: '(new Date(nowMs + 30 * DAY_MS))' },
  { name: '固定与天数并存不取较早者', file: 'receiveCoupon/index.js', from: 'return byDays.getTime() < fixed.getTime() ? byDays : fixed', to: 'return byDays' },
  { name: '过了固定到期仍可领', file: 'receiveCoupon/index.js', from: "if (fixed.getTime() <= now.getTime()) return { success: false, msg: '优惠券已过期' }", to: '' },
  { name: '限领不计 locked', file: 'receiveCoupon/index.js', from: "const HELD_STATUSES = ['unused', 'available', 'locked', 'used']", to: "const HELD_STATUSES = ['unused', 'used']" },
  { name: '并发双击不再用确定性 _id', file: 'receiveCoupon/index.js', from: "      ? campaignUserCouponId(couponId, openid)\n      : ''", to: "      ? ''\n      : ''" },
  { name: '领取窗开始判据反了', file: 'receiveCoupon/index.js', from: 'if (coupon.startTime && new Date(coupon.startTime) > now)', to: 'if (coupon.startTime && new Date(coupon.startTime) > now.getTime() + 1000)' },
  { name: '模板改成九折', file: 'extra/create-double11-coupon.mjs', from: '  value: 8,', to: '  value: 9,' },
  { name: '自动发放：活动时刻写成 UTC（时区错 8 小时）', file: 'issueCampaignCoupon/index.js', from: '+08:00', to: 'Z', all: true },
  { name: '自动发放：去掉活动常量窗口（只看模板）', file: 'issueCampaignCoupon/index.js', from: "if (nowMs < from.getTime()) return { open: false, reason: '未到发放时间' }", to: '' },
  { name: '自动发放：不看模板 startTime', file: 'issueCampaignCoupon/index.js', from: "if (coupon.startTime && (!start || nowMs < start.getTime())) return { open: false, reason: '模板未开始' }", to: '' },
  { name: '自动发放：过了截止仍发', file: 'issueCampaignCoupon/index.js', from: "if (nowMs > until.getTime()) return { open: false, reason: '已过发放时间' }", to: '' },
  { name: '自动发放：不跳过已持券的人', file: 'issueCampaignCoupon/index.js', from: '    if (held.has(openid)) return\n', to: '' },
  { name: '自动发放：不用确定性 _id', file: 'issueCampaignCoupon/index.js', from: 'openid, nowMs), _id } })', to: 'openid, nowMs) } })' },
  { name: '自动发放：已注销也发', file: 'issueCampaignCoupon/index.js', from: "{ status: _.neq('cancelled') }", to: '{}' },
  { name: '自动发放：字段与 receiveCoupon 不同构（丢 stackable）', file: 'issueCampaignCoupon/index.js', from: '    stackable: coupon.stackable === true\n', to: '' },
  { name: '自动发放：到期改成领取后 30 天', file: 'issueCampaignCoupon/index.js', from: '  return fixed\n}', to: '  return new Date(nowMs + 30 * DAY_MS)\n}' },
  { name: '自动发放：小程序端可触发发放', file: 'issueCampaignCoupon/index.js', from: "if (openid || ev.Type !== 'Timer')", to: "if (ev.Type !== 'Timer')" },
  { name: '自动发放：dryRun 不鉴权', file: 'issueCampaignCoupon/index.js', from: "if (!guard || !guard.ok) return", to: 'if (false) return' },
  { name: '自动发放：折扣规则副本漂移', file: 'issueCampaignCoupon/couponDiscountRules.js', from: 'function', to: 'function /* drift */' },
  { name: '模板设了 stackable', file: 'extra/create-double11-coupon.mjs', from: "  campaignKey: CAMPAIGN_KEY\n}", to: "  campaignKey: CAMPAIGN_KEY,\n  stackable: true\n}" }
]

async function main() {
  const selftest = process.argv.includes('--selftest')
  if (!selftest) {
    const dir = prepare(null)
    try {
      const fails = await runSuite(dir)
      if (fails.length) {
        console.error(`✗ test:coupon-campaign-window：${fails.length} 项不通过`)
        fails.forEach((f) => console.error('  - ' + f))
        process.exitCode = 1
      } else {
        console.log('✓ test:coupon-campaign-window：模板常量 / ERP 换算 / 领取窗三时刻 / 固定到期 / 限 1 含锁定与并发 / 旧券三种到期 / 普通·会员地板·礼赠计价 / 门店核销与过期 / 自动发放 全部通过')
      }
    } finally { rmSync(dir, { recursive: true, force: true }) }
    return
  }
  let missed = 0
  const base = prepare(null)
  try {
    const clean = await runSuite(base)
    if (clean.length) { console.error('✗ 自检前提失败：干净副本不通过', clean); process.exitCode = 1; return }
  } finally { rmSync(base, { recursive: true, force: true }) }
  for (const inj of INJECTIONS) {
    const dir = prepare(inj)
    try {
      const fails = await runSuite(dir)
      if (fails.length) console.log(`  ✓ 检出「${inj.name}」：${fails[0]}`)
      else { missed++; console.error(`  ✗ 未检出「${inj.name}」`) }
    } catch (e) {
      console.log(`  ✓ 检出「${inj.name}」（抛错：${e.message}）`)
    } finally {
      globalThis.Date = RealDate
      rmSync(dir, { recursive: true, force: true })
    }
  }
  if (missed) { console.error(`✗ 自检：${missed}/${INJECTIONS.length} 条注入未检出`); process.exitCode = 1 }
  else console.log(`✓ test:coupon-campaign-window --selftest：${INJECTIONS.length} 条注入全部检出`)
}

main().then(() => process.exit()).catch((e) => { console.error(e); process.exit(1) })
