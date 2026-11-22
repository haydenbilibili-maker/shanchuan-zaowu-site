/**
 * 券夹「可领取」列表（只读旁路，2026-10-29 产品负责人点名「券夹可领取区块」）
 *
 * 为什么不复用 getProductCoupons 的 claimableCoupons：它不返回 limitPerUser / 有效期，
 * 不按 fixedExpireTime 过滤，且「已领满」只数 unused/used —— 与 receiveCoupon 的 HELD_STATUSES 口径不一致，
 * 会出现「列出来能领、点了却报限领」。本函数的可领判定逐条对齐 receiveCoupon 的拒绝分支，**不发券**：
 * 发券只走客户端点击 → receiveCoupon(receiveType=manual)。
 *
 * action:
 *   list  （默认）→ { success, list }；expose=true 且列表非空时记一条曝光（user_behaviors）
 *   track         → 记一条领取点击结果（user_behaviors）；不读写券
 * 埋点由服务端直写 user_behaviors（与 receiveCoupon 记 receive_coupon 同法），不进客户端 eventSchema。
 */
const cloud = require('wx-server-sdk')
const { couponChannelAllows, normalizeCouponChannel } = require('./couponChannel')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

/** 与 receiveCoupon 同口径：locked（挂在待支付单上）也算已领 */
const HELD_STATUSES = ['unused', 'available', 'locked', 'used']
const TEMPLATE_SCAN_LIMIT = 100
const EXPOSE_ACTION = 'wallet_claim_expose'
const TAP_ACTION = 'wallet_claim_tap'
const WALLET_PAGE = 'subpackages/business/wallet-hub/index'

function toInstant(raw) {
  if (raw == null || raw === '') return null
  const v = raw && typeof raw === 'object' && !(raw instanceof Date) && raw.$date != null ? raw.$date : raw
  const d = v instanceof Date ? new Date(v.getTime()) : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

function parseMinSpend(coupon) {
  if (coupon.minSpend != null && coupon.minSpend !== '') {
    const n = parseFloat(coupon.minSpend)
    if (!Number.isNaN(n)) return n
  }
  if (coupon.condition) {
    const n = parseFloat(String(coupon.condition).replace(/[^0-9.]/g, ''))
    if (!Number.isNaN(n)) return n
  }
  return 0
}

function cleanFrom(raw) {
  const s = String(raw || '').trim()
  return /^[A-Za-z0-9_-]{1,32}$/.test(s) ? s : ''
}

/**
 * 模板本身是否「此刻可领」（不含用户维度）。逐条对应 receiveCoupon 的拒绝分支：
 * active / startTime / endTime / fixedExpireTime（无法解析也算不可领）/ totalStock；另加线上渠道。
 */
function templateOpen(c, now) {
  if (!c || !c._id || c.active !== true) return false
  const start = toInstant(c.startTime)
  if (c.startTime && start && start > now) return false
  const end = toInstant(c.endTime)
  if (c.endTime && end && end < now) return false
  if (c.fixedExpireTime != null && c.fixedExpireTime !== '') {
    const fixed = toInstant(c.fixedExpireTime)
    if (!fixed || fixed.getTime() <= now.getTime()) return false
  }
  if (c.totalStock !== undefined && c.totalStock <= 0) return false
  if (!couponChannelAllows(c, 'online')) return false
  return true
}

/**
 * 纯函数：模板 + 用户持有数 → 可领列表（已领满 / 新人券对老客 一律不列）。
 * @param {object[]} templates coupons 模板
 * @param {{ now: Date, heldCounts: Record<string, number>, hasPaidOrder: boolean }} ctx
 */
function buildClaimable(templates, ctx) {
  const now = ctx.now
  const held = ctx.heldCounts || {}
  return (templates || [])
    .filter((c) => templateOpen(c, now))
    .filter((c) => !(c.type === 'newUser' && ctx.hasPaidOrder))
    .map((c) => {
      const limitPerUser = Number(c.limitPerUser) > 0 ? Number(c.limitPerUser) : 0
      const heldCount = Number(held[c._id]) || 0
      return { c, limitPerUser, heldCount }
    })
    .filter(({ limitPerUser, heldCount }) => !(limitPerUser > 0 && heldCount >= limitPerUser))
    .map(({ c, limitPerUser, heldCount }) => {
      const fixed = toInstant(c.fixedExpireTime)
      const end = toInstant(c.endTime)
      const exp = toInstant(c.expireTime)
      return {
        _id: c._id,
        title: c.name || c.title || '优惠券',
        type: c.type || 'cash',
        value: Number(c.value) || 0,
        minSpend: parseMinSpend(c),
        channel: normalizeCouponChannel(c.channel),
        limitPerUser,
        heldCount,
        fixedExpireTime: fixed ? fixed.toISOString() : '',
        expireDays: Number(c.expireDays) > 0 ? Number(c.expireDays) : 0,
        expireTime: exp ? exp.toISOString() : '',
        claimEndTime: end ? end.toISOString() : ''
      }
    })
}

async function countHeld(openid, couponIds) {
  const out = {}
  if (!openid) return out
  await Promise.all(couponIds.map(async (id) => {
    const r = await db.collection('user_coupons')
      .where({ _openid: openid, couponId: id, status: _.in(HELD_STATUSES) })
      .count()
    out[id] = r.total || 0
  }))
  return out
}

/** 与 receiveCoupon 新人券判定同口径 */
async function hasPaidOrder(openid) {
  if (!openid) return false
  const res = await db.collection('orders')
    .where({ _openid: openid, status: _.in(['paid', 'shipped', 'received']) })
    .limit(100)
    .get()
  return (res.data || []).some((order) => {
    if (order.source === 'exchange') return false
    const price = parseFloat(String(order.totalPrice || 0).replace(/,/g, ''))
    return !Number.isNaN(price) && price > 0
  })
}

function dateKeyOf(ts) {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function writeBehavior(openid, action, targetId, from, properties) {
  const ts = Date.now()
  try {
    await db.collection('user_behaviors').add({
      data: {
        _openid: openid,
        userId: openid,
        action,
        targetType: 'coupon',
        targetId: String(targetId),
        module: 'commerce',
        page: WALLET_PAGE,
        from: from || '',
        properties: { ...properties, from: from || '' },
        timestamp: ts,
        dateKey: dateKeyOf(ts),
        serverTime: db.serverDate()
      }
    })
  } catch (e) {
    console.warn('getClaimableCoupons behavior skip', e && e.message)
  }
}

exports.main = async (event = {}) => {
  const openid = (cloud.getWXContext() || {}).OPENID || ''
  const from = cleanFrom(event.from)

  if (event.action === 'track') {
    const couponId = String(event.couponId || '')
    if (!openid || !/^[\w-]{1,64}$/.test(couponId)) return { success: false, msg: '参数错误' }
    await writeBehavior(openid, TAP_ACTION, couponId, from, {
      ok: event.ok === true,
      msg: String(event.msg || '').slice(0, 40)
    })
    return { success: true }
  }

  try {
    const now = new Date()
    const res = await db.collection('coupons').where({ active: true }).limit(TEMPLATE_SCAN_LIMIT).get()
    const open = (res.data || []).filter((c) => templateOpen(c, now))
    if (!open.length) return { success: true, list: [] }
    const [heldCounts, paid] = await Promise.all([
      countHeld(openid, open.map((c) => c._id)),
      open.some((c) => c.type === 'newUser') ? hasPaidOrder(openid) : Promise.resolve(false)
    ])
    const list = buildClaimable(open, { now, heldCounts, hasPaidOrder: paid })
    if (event.expose === true && openid && list.length) {
      await writeBehavior(openid, EXPOSE_ACTION, list[0]._id, from, {
        couponIds: list.map((c) => c._id),
        count: list.length
      })
    }
    return { success: true, list }
  } catch (err) {
    console.error('getClaimableCoupons failed', err)
    return { success: false, msg: '可领礼券加载失败', list: [] }
  }
}

exports._test = { buildClaimable, templateOpen, cleanFrom, HELD_STATUSES }
