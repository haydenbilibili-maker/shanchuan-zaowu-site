const cloud = require('wx-server-sdk')
const { couponChannelAllows, normalizeCouponChannel } = require('./couponChannel')
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
    console.warn('getProductCoupons shipping_rules fallback:', e.message)
  }
}

function couponDiscountMultiplier(value) {
  return Math.max(MIN_PAY_RATIO, discountMultiplierFromRules(value))
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

function formatMoneyLabel(amount) {
  const n = Math.round((Number(amount) || 0) * 100) / 100
  if (!n) return '0'
  return Number.isInteger(n) ? String(n) : String(n)
}

function formatCouponLabel(coupon) {
  const type = coupon.type || 'cash'
  const minSpend = parseMinSpend(coupon)
  const value = coupon.value || 0

  if (type === 'discount') {
    const fold = (couponDiscountMultiplier(value) * 10).toFixed(1).replace(/\.0$/, '')
    return `${fold}折`
  }
  if (type === 'freeShipping') return minSpend > 0 ? `满${minSpend}免邮` : '免邮券'
  if (type === 'newUser') return minSpend > 0 ? `新人满${minSpend}减${value}` : `新人减${value}`
  if (minSpend > 0) return `满${minSpend}减${value}`
  return `${value}元券`
}

/** 本单不可用原因：渠道 / 门槛（与确认页 _disabled 口径一致） */
function formatUnavailableReason(coupon, productPrice) {
  if (!couponChannelAllows(coupon, 'online')) return '仅门店可用'
  const minSpend = parseMinSpend(coupon)
  if (!(minSpend > 0)) return '暂不可用'
  const shortfall = Math.round((minSpend - productPrice) * 100) / 100
  if (shortfall > 0) return `差 ¥${formatMoneyLabel(shortfall)} 可用`
  return `满 ¥${formatMoneyLabel(minSpend)} 可用`
}

function mapHeldCoupon(coupon, extra = {}) {
  return {
    _id: coupon._id,
    title: coupon.title || coupon.name || '优惠券',
    type: coupon.type || 'cash',
    value: coupon.value || 0,
    minSpend: parseMinSpend(coupon),
    label: formatCouponLabel(coupon),
    channel: normalizeCouponChannel(coupon.channel),
    ...extra
  }
}

/**
 * 展示「可省」：与 makeOrder 75% 地板对齐，避免详情页夸大优惠
 * @param {number} goodsPrice 现价（详情页通常已含会员展示价）
 * @param {number} originalPrice 目录原价；缺省用 goodsPrice
 * @param {number} shippingThreshold 本单适用的包邮门槛（编码了档位与费率）
 */
function calcSaved(coupon, goodsPrice, shippingBaseAmount, originalPrice, shippingThreshold) {
  const type = coupon.type || 'cash'
  const value = coupon.value || 0
  const original = Number.isFinite(originalPrice) && originalPrice > 0 ? originalPrice : goodsPrice
  const floorPay = Math.round(original * MIN_PAY_RATIO * 100) / 100
  const maxSaveVsGoods = Math.max(0, Math.round((goodsPrice - floorPay) * 100) / 100)
  const cappedMax = Math.min(maxCashSaveForAmount(original), maxSaveVsGoods)

  switch (type) {
    case 'discount': {
      const raw = goodsPrice * (1 - couponDiscountMultiplier(value))
      return Math.min(raw, cappedMax)
    }
    case 'freeShipping':
      return estimateFreeShippingSave(
        shippingBaseAmount != null ? shippingBaseAmount : goodsPrice,
        shippingThreshold
      )
    default:
      return Math.min(value, cappedMax)
  }
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const productPrice = parseFloat(event.productPrice) || 0
  const originalRaw = event.originalPrice
  const originalPrice = originalRaw != null && originalRaw !== ''
    ? parseFloat(originalRaw)
    : productPrice
  const shippingBaseRaw = event.shippingBaseAmount
  const shippingBaseAmount = shippingBaseRaw != null && shippingBaseRaw !== ''
    ? parseFloat(shippingBaseRaw)
    : productPrice
  // 本单适用的包邮门槛（客户端用 resolveThreshold 算好传入：299=含收费类档 / 39=其它档）
  // 门槛为 0/缺失 → 券省额一律不报（见 estimateFreeShippingSave 的注释）
  const shippingThreshold = Number(event.shippingThreshold)
  const now = new Date()

  try {
    await loadShippingRules()
    let claimable = []
    try {
      const res = await db.collection('coupons').where({ active: true }).limit(30).get()
      claimable = (res.data || []).filter((c) => {
        if (c.totalStock !== undefined && c.totalStock <= 0) return false
        if (c.startTime && new Date(c.startTime) > now) return false
        if (c.endTime && new Date(c.endTime) < now) return false
        if (!couponChannelAllows(c, 'online')) return false
        return true
      })
    } catch (e) {
      console.warn('coupons 集合读取失败', e)
    }

    const claimableCoupons = []
    for (const coupon of claimable) {
      let claimed = false
      if (openid && coupon.limitPerUser) {
        const countRes = await db.collection('user_coupons').where({
          _openid: openid,
          couponId: coupon._id,
          status: _.in(['unused', 'used'])
        }).count()
        claimed = countRes.total >= coupon.limitPerUser
      }
      claimableCoupons.push({
        _id: coupon._id,
        title: coupon.name || coupon.title || '优惠券',
        type: coupon.type || 'cash',
        value: coupon.value || 0,
        minSpend: parseMinSpend(coupon),
        label: formatCouponLabel(coupon),
        channel: normalizeCouponChannel(coupon.channel),
        claimed
      })
    }

    let bestCoupon = null
    let savedAmount = 0
    let usableCount = 0
    const availableCoupons = []
    const unavailableCoupons = []

    // 有登录即可列出持有券；金额用于本单门槛判断（0 时全部视为未达门槛）
    if (openid) {
      const userRes = await db.collection('user_coupons').where({
        _openid: openid,
        status: _.in(['unused', 'available'])
      }).get()

      const held = (userRes.data || []).filter((c) => isCouponUnexpired(c, now))

      held.forEach((coupon) => {
        const onlineOk = couponChannelAllows(coupon, 'online')
        const minSpend = parseMinSpend(coupon)
        const meetsThreshold = productPrice > 0 && productPrice >= minSpend

        if (onlineOk && meetsThreshold) {
          const saved = calcSaved(coupon, productPrice, shippingBaseAmount, originalPrice, shippingThreshold)
          const mapped = mapHeldCoupon(coupon, {
            usable: true,
            savedAmount: Math.round(saved * 100) / 100
          })
          availableCoupons.push(mapped)
          if (saved > savedAmount) {
            savedAmount = saved
            bestCoupon = { ...mapped }
          }
        } else {
          unavailableCoupons.push(mapHeldCoupon(coupon, {
            usable: false,
            unavailableReason: formatUnavailableReason(coupon, productPrice)
          }))
        }
      })

      usableCount = availableCoupons.length
      // 达门槛但可省为 0（如已触达 75% 地板）时仍展示「本单可用」，并挑一张作推荐
      if (!bestCoupon && availableCoupons.length) {
        bestCoupon = { ...availableCoupons[0] }
      }
    }

    return {
      success: true,
      claimableCoupons,
      bestCoupon,
      savedAmount: Math.round(savedAmount * 100) / 100,
      usableCount,
      availableCoupons,
      unavailableCoupons
    }
  } catch (err) {
    console.error('getProductCoupons failed', err)
    return { success: false, msg: '加载优惠券失败' }
  }
}
