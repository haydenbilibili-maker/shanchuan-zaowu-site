const cloud = require('wx-server-sdk')
const { couponChannelAllows } = require('./couponChannel')
const {
  maxCashSaveForAmount,
  couponDiscountMultiplier: discountMultiplierFromRules,
  MIN_PAY_RATIO
} = require('./couponDiscountRules')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// defaults；运行时由 shipping_rules 覆盖
let FREE_SHIPPING_THRESHOLD = 500
let DEFAULT_SHIPPING_FEE = 18
let ACCESSORY_THRESHOLD = 200
let FREE_SHIPPING_CAMPAIGN_ENABLED = false

async function loadShippingRules() {
  FREE_SHIPPING_THRESHOLD = 500
  DEFAULT_SHIPPING_FEE = 18
  ACCESSORY_THRESHOLD = 200
  FREE_SHIPPING_CAMPAIGN_ENABLED = false
  try {
    const res = await db.collection('shipping_rules')
      .where({ status: 'active' })
      .orderBy('priority', 'desc')
      .limit(1)
      .get()
    const row = res.data && res.data[0]
    if (!row) return
    const thresholds = row.thresholds || {}
    ACCESSORY_THRESHOLD = Number(
      row.accessoryFreeThreshold != null ? row.accessoryFreeThreshold : thresholds.accessory
    )
    if (!Number.isFinite(ACCESSORY_THRESHOLD)) ACCESSORY_THRESHOLD = 200
    FREE_SHIPPING_THRESHOLD = Number(
      row.specimenFreeThreshold != null
        ? row.specimenFreeThreshold
        : (thresholds.specimen != null ? thresholds.specimen : row.freeShippingThreshold)
    )
    if (!Number.isFinite(FREE_SHIPPING_THRESHOLD)) FREE_SHIPPING_THRESHOLD = 500
    DEFAULT_SHIPPING_FEE = Number(row.flatFee != null ? row.flatFee : row.shippingFee)
    if (!Number.isFinite(DEFAULT_SHIPPING_FEE)) DEFAULT_SHIPPING_FEE = 18
    FREE_SHIPPING_CAMPAIGN_ENABLED = !!(row.freeShippingCampaign && row.freeShippingCampaign.enabled === true)
  } catch (e) {
    console.warn('getBestCoupon shipping_rules fallback:', e.message)
  }
}

function isCouponUnexpired(coupon, now) {
  if (!coupon) return true
  const raw = coupon.expireTime || coupon.expire_time || coupon.validUntil
  if (!raw) return true
  const t = new Date(raw)
  if (Number.isNaN(t.getTime())) return true
  return t > now
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

function couponDiscountMultiplier(value) {
  return Math.max(MIN_PAY_RATIO, discountMultiplierFromRules(value))
}

/** 无品类上下文时按标本门槛估算（保守，少误免邮） */
function estimateFreeShippingSave(goodsAmount) {
  if (FREE_SHIPPING_CAMPAIGN_ENABLED) return 0
  const amount = parseFloat(goodsAmount) || 0
  if (amount <= 0) return 0
  if (amount >= FREE_SHIPPING_THRESHOLD) return 0
  // 金额已达饰品门槛但仍低于标本门槛时，仍可能收费（混合/标本单）
  if (amount >= ACCESSORY_THRESHOLD) return DEFAULT_SHIPPING_FEE
  return DEFAULT_SHIPPING_FEE
}

/**
 * 自动匹配最优优惠券
 * 根据订单金额，自动选择最优惠的可用券
 */
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  
  const { totalPrice, shippingBaseAmount, originalPrice } = event
  
  if (!totalPrice || totalPrice <= 0) {
    return {
      success: false,
      msg: '订单金额无效'
    }
  }

  const shipBase = shippingBaseAmount != null && shippingBaseAmount !== ''
    ? parseFloat(shippingBaseAmount)
    : parseFloat(totalPrice)
  const originalBase = originalPrice != null && originalPrice !== ''
    ? parseFloat(originalPrice)
    : parseFloat(totalPrice)

  try {
    await loadShippingRules()
    const now = new Date()
    
    // 1. 查询用户所有未使用的有效优惠券
    const res = await db.collection('user_coupons')
      .where({
        _openid: openid,
        status: _.in(['unused', 'available'])
      })
      .get()

    const liveCoupons = (res.data || []).filter((coupon) => isCouponUnexpired(coupon, now))

    if (!liveCoupons.length) {
      return {
        success: true,
        bestCoupon: null,
        savedAmount: 0
      }
    }

    // 2. 筛选可用券（满足使用门槛 + 线上渠道）
    const usableCoupons = liveCoupons.filter(coupon => {
      if (!couponChannelAllows(coupon, 'online')) return false
      const minSpend = parseMinSpend(coupon)
      return totalPrice >= minSpend
    })

    if (usableCoupons.length === 0) {
      return {
        success: true,
        bestCoupon: null,
        savedAmount: 0,
        msg: '暂无可用优惠券'
      }
    }

    // 3. 计算每张券的优惠金额，选择最优券
    let bestCoupon = null
    let maxSaved = 0

    usableCoupons.forEach(coupon => {
      let saved = 0
      const type = coupon.type || 'cash' // cash: 满减, discount: 折扣, freeShipping: 免邮, newUser: 新人券
      // 相对目录原价的可减上限（与 makeOrder 75% 地板一致）；无原价时回落订单金额
      const floorBase = Number.isFinite(originalBase) && originalBase > 0 ? originalBase : totalPrice
      const maxSave = maxCashSaveForAmount(floorBase)
      // 会员折后应付下，可减额还不得超过 vipTotal - floor
      const floorPay = Math.round(floorBase * MIN_PAY_RATIO * 100) / 100
      // vip 已低于地板时 maxSaveVsVip=0，不可回落成 maxSave（否则会推荐「抵扣为 0」的券）
      const maxSaveVsVip = Math.max(0, Math.round((totalPrice - floorPay) * 100) / 100)
      const cappedMax = Math.min(maxSave, maxSaveVsVip)

      switch (type) {
        case 'cash':
          saved = Math.min(coupon.value || 0, cappedMax)
          break
        case 'discount':
          saved = Math.min(
            totalPrice * (1 - couponDiscountMultiplier(coupon.value)),
            cappedMax
          )
          break
        case 'freeShipping':
          saved = estimateFreeShippingSave(
            Number.isFinite(shipBase) ? shipBase : totalPrice
          )
          break
        case 'newUser':
          saved = Math.min(coupon.value || 0, cappedMax)
          break
        default:
          saved = Math.min(coupon.value || 0, cappedMax)
      }

      if (saved > maxSaved) {
        maxSaved = saved
        bestCoupon = {
          ...coupon,
          minSpend: parseMinSpend(coupon),
          savedAmount: saved
        }
      }
    })

    return {
      success: true,
      bestCoupon: bestCoupon,
      savedAmount: maxSaved,
      allCoupons: usableCoupons.map(c => ({
        _id: c._id,
        title: c.title,
        type: c.type || 'cash',
        value: c.value,
        minSpend: parseMinSpend(c),
      }))
    }

  } catch (err) {
    console.error('获取最优优惠券失败:', err)
    return {
      success: false,
      msg: '系统繁忙，请稍后重试'
    }
  }
}





