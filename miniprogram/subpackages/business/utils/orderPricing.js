/**
 * 前端订单核价（与 makeOrder/pricing.js 逻辑对齐）
 */
const { estimateFreeShippingCouponSave } = require('./mallShipping')
const {
  couponDiscountMultiplier,
  isCouponUnexpired,
  parseMinSpend,
  clampCouponAgainstOriginal,
  MIN_PAY_RATIO
} = require('../../../utils/couponHelper')

function isMemberDiscountEnabled(item) {
  return !item || item.memberDiscountEnabled !== false
}

function applyCoupon(vipTotal, coupon, shippingContext, shippingBaseAmount, originalPrice) {
  if (!coupon) return { final: vipTotal, couponSaved: 0 }
  if (!isCouponUnexpired(coupon)) return { final: vipTotal, couponSaved: 0 }

  const type = coupon.type || 'cash'
  let couponSaved = 0
  let final = vipTotal
  const shipBase = shippingBaseAmount != null ? shippingBaseAmount : vipTotal

  switch (type) {
    case 'discount': {
      // 折扣券倍率不得低于 7.5 折地板（与 makeOrder 一致）
      const rate = Math.max(MIN_PAY_RATIO, couponDiscountMultiplier(coupon.value))
      couponSaved = vipTotal * (1 - rate)
      final = vipTotal * rate
      break
    }
    case 'freeShipping':
      // 与确认页/makeOrder 一致：按优惠前合计估算本应运费
      couponSaved = estimateFreeShippingCouponSave(shipBase, shippingContext)
      final = vipTotal
      break
    default:
      couponSaved = coupon.value || 0
      final = vipTotal - couponSaved
  }

  if (final < 0) final = 0
  // 会员价 + 券叠加后，商品实付仍不得低于原价 75%
  if (type !== 'freeShipping') {
    const clamped = clampCouponAgainstOriginal(vipTotal, couponSaved, originalPrice != null ? originalPrice : vipTotal)
    final = clamped.final
    couponSaved = clamped.couponValue
  }
  return {
    final: Math.round(final * 100) / 100,
    couponSaved: Math.round(couponSaved * 100) / 100
  }
}

function calculateClientPricing(items, discountRate, coupon, customExtraPrice = 0) {
  let original = 0
  let discountedSubtotal = 0
  items.forEach((item) => {
    const line = (parseFloat(item.price) || 0) * (item.count || 1)
    original += line
    if (isMemberDiscountEnabled(item)) discountedSubtotal += line
  })

  const extra = parseFloat(customExtraPrice) || 0
  const nonDiscounted = original - discountedSubtotal
  const vipTotal = Math.round((discountedSubtotal * discountRate + nonDiscounted) * 100) / 100
  let currentCoupon = coupon

  if (currentCoupon && vipTotal < parseMinSpend(currentCoupon)) {
    currentCoupon = null
  }

  const shippingBase = original + extra
  const { final, couponSaved } = applyCoupon(vipTotal, currentCoupon, items, shippingBase, original)
  const finalWithExtra = Math.round((final + extra) * 100) / 100
  const vipSaved = original - vipTotal
  const totalSaved = original + extra - finalWithExtra
  const couponType = currentCoupon ? (currentCoupon.type || 'cash') : ''
  // 现金/折扣券抵扣被 75% 地板吃光；免邮券省运费为 0（已包邮）另计
  const couponNoGoodsSave = !!(
    currentCoupon &&
    couponType !== 'freeShipping' &&
    !(couponSaved > 0)
  )
  const goodsFloor = original > 0 ? Math.round(original * MIN_PAY_RATIO * 100) / 100 : 0
  const goodsFloorHit = original > 0 && vipTotal <= goodsFloor + 1e-9

  return {
    originalPrice: shippingBase,
    specimenOriginal: original,
    customExtra: extra,
    vipTotal,
    finalPrice: finalWithExtra,
    vipSaved: Math.round(vipSaved * 100) / 100,
    couponSaved,
    totalSaved: Math.round(totalSaved * 100) / 100,
    selectedCoupon: currentCoupon,
    couponDroppedForMinSpend: !!(coupon && !currentCoupon),
    couponNoGoodsSave,
    goodsFloorHit
  }
}

module.exports = { applyCoupon, calculateClientPricing, isMemberDiscountEnabled }
