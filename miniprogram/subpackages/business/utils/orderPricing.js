/**
 * 前端订单核价（与 makeOrder/pricing.js 逻辑对齐）
 */
function applyCoupon(vipTotal, coupon) {
  if (!coupon) return { final: vipTotal, couponSaved: 0 }

  const type = coupon.type || 'cash'
  let couponSaved = 0
  let final = vipTotal

  switch (type) {
    case 'discount': {
      const rate = (coupon.value || 0) / 10
      couponSaved = vipTotal * (1 - rate)
      final = vipTotal * rate
      break
    }
    case 'freeShipping':
      couponSaved = 10
      final = vipTotal
      break
    default:
      couponSaved = coupon.value || 0
      final = vipTotal - couponSaved
  }

  if (final < 0) final = 0
  return {
    final: Math.round(final * 100) / 100,
    couponSaved: Math.round(couponSaved * 100) / 100
  }
}

function calculateClientPricing(items, discountRate, coupon, customExtraPrice = 0) {
  let original = 0
  items.forEach((item) => {
    original += (parseFloat(item.price) || 0) * (item.count || 1)
  })

  const extra = parseFloat(customExtraPrice) || 0
  const vipTotal = Math.round(original * discountRate * 100) / 100
  let currentCoupon = coupon

  if (currentCoupon && vipTotal < (currentCoupon.minSpend || 0)) {
    currentCoupon = null
  }

  const { final, couponSaved } = applyCoupon(vipTotal, currentCoupon)
  const finalWithExtra = Math.round((final + extra) * 100) / 100
  const vipSaved = original - vipTotal
  const totalSaved = original + extra - finalWithExtra

  return {
    originalPrice: original + extra,
    specimenOriginal: original,
    customExtra: extra,
    vipTotal,
    finalPrice: finalWithExtra,
    vipSaved: Math.round(vipSaved * 100) / 100,
    couponSaved,
    totalSaved: Math.round(totalSaved * 100) / 100,
    selectedCoupon: currentCoupon
  }
}

module.exports = { applyCoupon, calculateClientPricing }
