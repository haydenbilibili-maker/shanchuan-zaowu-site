/**
 * 优惠券展示 / 门槛 / 过期判断（前后端口径对齐）
 *
 * 库内既有字段（exchangeCoupon / receiveCoupon / makeOrder）：
 *   status: unused | used | locked
 *   expireTime / minSpend
 * 页面与部分结算逻辑曾用 unused / expireTime / minSpend，这里统一兼容。
 */

const USED_STATUS = { used: 1, redeemed: 1 }
const LOCKED_STATUS = { locked: 1, occupied: 1 }
const COUPON_STATUS_RANK = { unused: 0, locked: 1, used: 2, expired: 3 }

function couponExpireTime(coupon) {
  if (!coupon) return null
  return coupon.expireTime || coupon.expire_time || coupon.validUntil || null
}

function isCouponUnexpired(coupon, now) {
  const raw = couponExpireTime(coupon)
  if (!raw) return true
  const t = new Date(raw)
  if (Number.isNaN(t.getTime())) return true
  return t > (now || new Date())
}

function normalizeCouponStatus(status) {
  const s = String(status || '').trim().toLowerCase()
  if (USED_STATUS[s]) return 'used'
  if (LOCKED_STATUS[s]) return 'locked'
  if (s === 'expired') return 'expired'
  if (s === 'available') return 'unused'
  return 'unused'
}

function resolveCouponStatus(coupon, now) {
  if (!coupon) return 'unused'
  const s = normalizeCouponStatus(coupon.status)
  if (s === 'used' || s === 'locked' || s === 'expired') return s
  if (!isCouponUnexpired(coupon, now)) return 'expired'
  return 'unused'
}

function couponTimeMs(raw) {
  if (raw == null || raw === '') return 0
  if (typeof raw === 'number') return raw
  if (typeof raw === 'object') {
    if (raw.$date != null) return couponTimeMs(raw.$date)
    if (typeof raw.getTime === 'function') {
      const t = raw.getTime()
      return Number.isNaN(t) ? 0 : t
    }
  }
  const t = new Date(raw).getTime()
  return Number.isNaN(t) ? 0 : t
}

function couponDisplayRank(coupon) {
  if (!coupon) return 9
  if (coupon.canUse === true) return COUPON_STATUS_RANK.unused
  return COUPON_STATUS_RANK[coupon.status] ?? 9
}

/** 我的券夹 / 选券弹层统一排序：可用 > 占用 > 已用 > 过期；可用券按到期升序 */
function compareCouponsForDisplay(a, b) {
  const ra = couponDisplayRank(a)
  const rb = couponDisplayRank(b)
  if (ra !== rb) return ra - rb

  if (ra === COUPON_STATUS_RANK.unused) {
    const ea = a.expireTime ? couponTimeMs(a.expireTime) : Number.MAX_SAFE_INTEGER
    const eb = b.expireTime ? couponTimeMs(b.expireTime) : Number.MAX_SAFE_INTEGER
    if (ea !== eb) return ea - eb
  }

  return couponTimeMs(b.createTime) - couponTimeMs(a.createTime)
}

function sortCouponCards(cards) {
  return (cards || []).slice().sort(compareCouponsForDisplay)
}

function isCouponAvailable(coupon, now) {
  return resolveCouponStatus(coupon, now) === 'unused'
}

/** 实付地板：≥原价 75%（与 makeOrder/couponDiscountRules 一致） */
const MIN_PAY_RATIO = 0.75

/** 折扣券 value：85→8.5折，8.5→8.5折，0.85→8.5折 */
function couponDiscountMultiplier(value) {
  const v = Number(value)
  if (!Number.isFinite(v) || v <= 0) return 1
  if (v > 10) return Math.min(1, v / 100)
  if (v > 1) return Math.min(1, v / 10)
  return Math.min(1, v)
}

/**
 * 会员价 + 券叠加后，商品实付不得低于原价 × 0.75
 * 若会员价已低于地板：券不再加码，但也不得把实付抬回地板（避免「选券反而更贵」）。
 * @returns {{ final: number, couponValue: number, clamped: boolean }}
 */
function clampCouponAgainstOriginal(vipTotal, couponValue, originalPrice) {
  const vip = Math.max(0, Number(vipTotal) || 0)
  let saved = Math.max(0, Number(couponValue) || 0)
  const original = Math.max(0, Number(originalPrice) || 0)
  let final = Math.round((vip - saved) * 100) / 100
  if (final < 0) {
    saved = vip
    final = 0
  }
  if (!(original > 0)) {
    return { final, couponValue: Math.round(saved * 100) / 100, clamped: false }
  }
  const floor = Math.round(original * MIN_PAY_RATIO * 100) / 100
  // 会员折已达/低于地板：保持会员价，券抵扣记 0
  if (vip + 1e-9 <= floor) {
    return { final: vip, couponValue: 0, clamped: saved > 0 }
  }
  if (final + 1e-9 >= floor) {
    return { final, couponValue: Math.round(saved * 100) / 100, clamped: false }
  }
  const clampedFinal = floor
  const clampedSaved = Math.max(0, Math.round((vip - clampedFinal) * 100) / 100)
  return { final: clampedFinal, couponValue: clampedSaved, clamped: true }
}

function couponTitle(coupon) {
  if (!coupon) return '礼券'
  return coupon.title || coupon.name || '礼券'
}

function couponFaceLabel(coupon) {
  if (!coupon) return ''
  const type = coupon.type || 'cash'
  const value = coupon.value || 0
  if (type === 'freeShipping') return '免邮'
  if (type === 'discount') {
    const fold = (couponDiscountMultiplier(value) * 10).toFixed(1).replace(/\.0$/, '')
    return `${fold}折`
  }
  return `¥${value}`
}

function parseMinSpend(coupon) {
  if (!coupon) return 0
  const raw = coupon.minSpend != null && coupon.minSpend !== ''
    ? coupon.minSpend
    : coupon.min_spend
  if (raw != null && raw !== '') {
    const n = parseFloat(raw)
    if (!Number.isNaN(n)) return n
  }
  if (coupon.condition) {
    const n = parseFloat(String(coupon.condition).replace(/[^0-9.]/g, ''))
    if (!Number.isNaN(n)) return n
  }
  return 0
}

/**
 * 适用渠道（热更新字段，禁止前端写死门槛/面额）
 * online | store | all
 * 缺省 / 空 / 未知 → all（门店+线上皆可；兼容旧券无 channel）
 */
function normalizeCouponChannel(raw) {
  if (raw == null || raw === '') return 'all'
  const s = String(raw).trim().toLowerCase()
  if (s === 'store' || s === 'offline' || s === 'in_store') return 'store'
  if (s === 'online' || s === 'mall') return 'online'
  if (s === 'all' || s === 'both' || s === 'any') return 'all'
  return 'all'
}

function couponChannelAllows(couponOrChannel, useAt) {
  const ch = typeof couponOrChannel === 'string'
    ? normalizeCouponChannel(couponOrChannel)
    : normalizeCouponChannel(couponOrChannel && couponOrChannel.channel)
  const at = String(useAt || '').trim().toLowerCase()
  if (at === 'store' || at === 'offline') return ch === 'store' || ch === 'all'
  if (at === 'online' || at === 'mall') return ch === 'online' || ch === 'all'
  return true
}

function couponChannelLabel(couponOrChannel) {
  const ch = typeof couponOrChannel === 'string'
    ? normalizeCouponChannel(couponOrChannel)
    : normalizeCouponChannel(couponOrChannel && couponOrChannel.channel)
  if (ch === 'store') return '仅门店'
  if (ch === 'online') return '仅线上'
  return '门店+线上'
}

module.exports = {
  MIN_PAY_RATIO,
  couponExpireTime,
  isCouponUnexpired,
  normalizeCouponStatus,
  resolveCouponStatus,
  isCouponAvailable,
  couponDiscountMultiplier,
  clampCouponAgainstOriginal,
  couponTitle,
  couponFaceLabel,
  parseMinSpend,
  couponTimeMs,
  couponDisplayRank,
  compareCouponsForDisplay,
  sortCouponCards,
  normalizeCouponChannel,
  couponChannelAllows,
  couponChannelLabel
}
