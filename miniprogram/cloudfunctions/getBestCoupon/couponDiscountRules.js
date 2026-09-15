/**
 * 代金券折扣纪律
 * - 地板：有效实付比例 ≥ 0.75（不低于 7.5 折，即最多约 25% off）
 * - 推荐：门槛约面额 ×5～×10（约 8～9 折），勿轻易顶满地板
 * - 一单一券；可与会员价叠加，但叠加后仍须满足地板（按下单原价计）
 */
const MIN_PAY_RATIO = 0.75
const MAX_OFF_RATIO = 1 - MIN_PAY_RATIO // 0.25
/** 推荐门槛倍率（约 8 折） */
const RECOMMENDED_MIN_SPEND_MULTIPLIER = 5

function toFiniteNumber(value, fallback = NaN) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

/** 满减券门槛下限：ceil(value / 0.25) */
function cashCouponMinSpendFloor(value) {
  const v = Math.max(0, toFiniteNumber(value, 0))
  if (v <= 0) return 0
  return Math.ceil(v / MAX_OFF_RATIO)
}

/** 缺省门槛：推荐倍率与地板取较大 */
function defaultMinSpendForValue(value) {
  const v = Math.max(0, Math.floor(toFiniteNumber(value, 0)))
  if (v <= 0) return 0
  return Math.max(cashCouponMinSpendFloor(v), v * RECOMMENDED_MIN_SPEND_MULTIPLIER)
}

/**
 * 抬升过低门槛，使 value/minSpend ≤ 0.25
 */
function enforceCashMinSpend(value, minSpend) {
  const v = Math.max(0, Math.floor(toFiniteNumber(value, 0)))
  const raw = Math.max(0, Math.floor(toFiniteNumber(minSpend, 0)))
  const floor = cashCouponMinSpendFloor(v)
  if (v <= 0) return raw
  if (raw <= 0) return defaultMinSpendForValue(v)
  return Math.max(raw, floor)
}

function validateCashCoupon(value, minSpend) {
  const v = toFiniteNumber(value, 0)
  const m = toFiniteNumber(minSpend, 0)
  if (!(v > 0)) return { ok: false, msg: '代金券面额无效' }
  if (!(m > 0)) return { ok: false, msg: '代金券须设置使用门槛' }
  if (v / m > MAX_OFF_RATIO + 1e-9) {
    return {
      ok: false,
      msg: `优惠过猛：满${m}减${v}低于7.5折（实付须≥原价75%），请提高门槛或降低面额`,
      minSpendFloor: cashCouponMinSpendFloor(v)
    }
  }
  return { ok: true }
}

/** discount 券：value 为折扣倍率（0.75~1）或 7.5~10 / 75~100 写法 */
function couponDiscountMultiplier(value) {
  const v = toFiniteNumber(value, 0)
  if (!(v > 0)) return 1
  if (v > 10) return Math.min(1, v / 100)
  if (v > 1) return Math.min(1, v / 10)
  return Math.min(1, v)
}

function validateDiscountCoupon(value) {
  const rate = couponDiscountMultiplier(value)
  if (rate < MIN_PAY_RATIO - 1e-9) {
    return {
      ok: false,
      msg: `折扣券不得低于7.5折（当前约${(rate * 10).toFixed(1)}折）`,
      rate
    }
  }
  return { ok: true, rate }
}

/**
 * 下单侧：优惠后商品实付不得低于原价 × 0.75
 * 若会员价已低于地板：券不再加码，但也不得把实付抬回地板（避免「选券反而更贵」）。
 * @returns {{ final: number, couponValue: number, clamped: boolean }}
 */
function clampCouponAgainstOriginal(vipTotal, couponValue, originalPrice) {
  const vip = Math.max(0, toFiniteNumber(vipTotal, 0))
  let saved = Math.max(0, toFiniteNumber(couponValue, 0))
  const original = Math.max(0, toFiniteNumber(originalPrice, 0))
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

/** 相对订单金额的最大可减（券本身粗校验） */
function maxCashSaveForAmount(amount) {
  const a = Math.max(0, toFiniteNumber(amount, 0))
  return Math.round(a * MAX_OFF_RATIO * 100) / 100
}

module.exports = {
  MIN_PAY_RATIO,
  MAX_OFF_RATIO,
  RECOMMENDED_MIN_SPEND_MULTIPLIER,
  cashCouponMinSpendFloor,
  defaultMinSpendForValue,
  enforceCashMinSpend,
  validateCashCoupon,
  couponDiscountMultiplier,
  validateDiscountCoupon,
  clampCouponAgainstOriginal,
  maxCashSaveForAmount
}
