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
let ACCESSORY_SHIPPING_FEE = 10
let FREE_SHIPPING_CAMPAIGN_ENABLED = false

async function loadShippingRules() {
  FREE_SHIPPING_THRESHOLD = 500
  DEFAULT_SHIPPING_FEE = 18
  ACCESSORY_SHIPPING_FEE = 10
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
    FREE_SHIPPING_THRESHOLD = Number(
      row.specimenFreeThreshold != null
        ? row.specimenFreeThreshold
        : (thresholds.specimen != null ? thresholds.specimen : row.freeShippingThreshold)
    )
    if (!Number.isFinite(FREE_SHIPPING_THRESHOLD)) FREE_SHIPPING_THRESHOLD = 500
    DEFAULT_SHIPPING_FEE = Number(row.flatFee != null ? row.flatFee : row.shippingFee)
    if (!Number.isFinite(DEFAULT_SHIPPING_FEE)) DEFAULT_SHIPPING_FEE = 18
    ACCESSORY_SHIPPING_FEE = Number(
      row.accessoryFlatFee != null ? row.accessoryFlatFee : row.accessoryShippingFee
    )
    if (!Number.isFinite(ACCESSORY_SHIPPING_FEE)) ACCESSORY_SHIPPING_FEE = 10
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

/**
 * 免邮券能省多少 —— 取决于「本单适用门槛」落在哪一档（裁决 48 起是两档）：
 *   含相框/玻璃罩 → 门槛 ¥299、券最多省 ¥18
 *   其它类型       → 门槛 ¥39、券最多省 ¥10
 *
 * 为什么必须由调用方传 `shippingThreshold` 而不是只看金额：
 *   「金额 < 某门槛」不再等于「会被收运费」—— ¥250 的挂件单本来就免邮（≥39），
 *   免邮券对它省 0；而旧实现只看金额会报「省 ¥18」→ 券列表虚高、还会把免邮券推荐成"最优券"。
 *
 * ⚠️ 门槛未知（老客户端 / 漏参 / 0）→ 一律 0：不声称能省，宁可少报不虚高。
 *    真实收多少钱由 `makeOrder` 服务端按 craftType 独立算，与此展示估算无关。
 */
function estimateFreeShippingSave(goodsAmount, shippingThreshold) {
  if (FREE_SHIPPING_CAMPAIGN_ENABLED) return 0
  const amount = parseFloat(goodsAmount) || 0
  if (amount <= 0) return 0
  const threshold = Number(shippingThreshold)
  if (!Number.isFinite(threshold) || threshold <= 0) return 0
  if (amount >= threshold) return 0
  return threshold >= FREE_SHIPPING_THRESHOLD ? DEFAULT_SHIPPING_FEE : ACCESSORY_SHIPPING_FEE
}

/**
 * 自动匹配最优优惠券
 * 根据订单金额，自动选择最优惠的可用券
 */
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  
  const { totalPrice, shippingBaseAmount, originalPrice } = event
  // 本单适用的包邮门槛（客户端用 resolveThreshold 算好传入：299=含收费类档 / 39=其它档）
  const shippingThreshold = Number(event.shippingThreshold)
  
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
            Number.isFinite(shipBase) ? shipBase : totalPrice,
            shippingThreshold
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





