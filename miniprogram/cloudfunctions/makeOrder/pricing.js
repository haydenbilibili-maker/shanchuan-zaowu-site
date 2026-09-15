const cloud = require('wx-server-sdk')
const shipping = require('./shipping')
const { hasSkus, sumSkuStock } = require('./stockUtils')
const {
  loadMemberLevels,
  resolveMemberLevel,
  resolveProjectedUpgrade,
  orderGrowthContribution
} = require('./memberLevels')
const { loadWalletAvailableFen } = require('./walletBenefit')
const { couponChannelAllows } = require('./couponChannel')
const { clampCouponAgainstOriginal, couponDiscountMultiplier: discountMultiplierFromRules, MIN_PAY_RATIO } = require('./couponDiscountRules')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const _ = cloud.database().command

function resolveUnitPrice(product, skuId) {
  if (hasSkus(product)) {
    if (!skuId) throw new Error(`「${product.title}」请选择规格`)
    const sku = product.skus.find((s) => s && s.id === skuId)
    if (!sku) throw new Error(`「${product.title}」规格不存在`)
    return {
      unitPrice: parseFloat(sku.price) || 0,
      skuLabel: sku.specLabel || '',
      skuStock: parseInt(sku.stock, 10) || 0,
      skuImage: sku.image || ''
    }
  }
  return {
    unitPrice: parseFloat(product.price) || 0,
    skuLabel: '',
    skuStock: parseInt(product.stock, 10) || 0,
    skuImage: ''
  }
}

function resolveStock(product, skuId, skuStock) {
  if (hasSkus(product)) return skuStock
  return parseInt(product.stock, 10) || 0
}

/** 缺省或未写字段视为参与会员折扣（兼容历史商品） */
function isMemberDiscountEnabled(product) {
  return !product || product.memberDiscountEnabled !== false
}

function couponDiscountMultiplier(value) {
  return discountMultiplierFromRules(value)
}

function couponExpireTime(coupon) {
  if (!coupon) return null
  return coupon.expireTime || coupon.expire_time || coupon.validUntil || null
}

function isCouponUsableStatus(status) {
  const s = String(status || '').trim().toLowerCase()
  return !s || s === 'unused' || s === 'available'
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

function isCouponUnexpired(coupon, now) {
  const raw = couponExpireTime(coupon)
  if (!raw) return true
  const t = new Date(raw)
  if (Number.isNaN(t.getTime())) return true
  return t > (now || new Date())
}

/**
 * 读取用户当前成长与折扣（不含本单预估定级）。
 * openid 缺失时按游客 Lv1 处理，避免 where(_openid: undefined) 抛错导致预览整单失败。
 */
async function getUserDiscountRate(db, openid) {
  const { levels } = await loadMemberLevels(db)
  if (!openid) {
    const resolved = resolveMemberLevel(levels, 0, false)
    return {
      discountRate: resolved.discountRate,
      level: resolved.level,
      levelName: resolved.levelName,
      growthValue: 0,
      orderGrowth: 0,
      storeGrowth: 0,
      isHonorary: false,
      levels,
      points: 0
    }
  }

  let orderGrowth = 0
  let bonusPoints = 0
  let usedPoints = 0
  let storeGrowth = 0
  let isHonorary = false
  let levelOverride = null

  try {
    const userRes = await db.collection('users').where({ _openid: openid }).get()
    if (userRes.data && userRes.data.length > 0) {
      const u = userRes.data[0]
      isHonorary = u.isHonorary === true
      bonusPoints = u.bonusPoints || 0
      usedPoints = u.usedPoints || 0
      storeGrowth = Math.max(0, Math.floor(Number(u.storeGrowthValue) || 0))
      levelOverride = u.levelOverride || null
    }
  } catch (e) {
    console.warn('getUserDiscountRate users lookup failed:', e && e.message)
  }

  const PAGE = 100
  const MAX_SKIP = 1000
  let skip = 0
  try {
    while (skip <= MAX_SKIP) {
      const orderRes = await db.collection('orders')
        .where({ _openid: openid, status: _.in(['paid', 'shipped', 'received']) })
        .skip(skip)
        .limit(PAGE)
        .get()
      const orders = Array.isArray(orderRes.data) ? orderRes.data : []
      orders.forEach((order) => {
        orderGrowth += orderGrowthContribution(order)
      })
      if (orders.length < PAGE) break
      skip += PAGE
    }
  } catch (e) {
    console.warn('getUserDiscountRate orders lookup failed:', e && e.message)
  }

  orderGrowth = Math.floor(orderGrowth)
  // 等级含门店成长；可用积分 = 线上成长 + bonusPoints（门店分已在 bonusPoints）
  const growthValue = orderGrowth + storeGrowth
  const resolved = resolveMemberLevel(levels, growthValue, isHonorary, levelOverride)

  return {
    discountRate: resolved.discountRate,
    level: resolved.level,
    levelName: resolved.levelName,
    growthValue,
    orderGrowth,
    storeGrowth,
    isHonorary,
    levelOverride,
    levels,
    points: orderGrowth + bonusPoints - usedPoints
  }
}

function applyCoupon(vipTotal, coupon, shippingContext, shippingBaseAmount) {
  if (!coupon) return { final: vipTotal, couponValue: 0 }

  const type = coupon.type || 'cash'
  let couponValue = 0
  let final = vipTotal
  // 包邮判定与运费估算均用优惠前商品合计，与「标本满 ¥x 包邮」文案一致
  const shipBase = shippingBaseAmount != null ? shippingBaseAmount : vipTotal

  switch (type) {
    case 'discount': {
      // 折扣券倍率不得低于 7.5 折地板
      const rate = Math.max(MIN_PAY_RATIO, couponDiscountMultiplier(coupon.value))
      couponValue = vipTotal * (1 - rate)
      final = vipTotal * rate
      break
    }
    case 'freeShipping':
      // 免邮券节省额 = 本单本应支付的运费（已达门槛/限时免邮时为 0）
      couponValue = shipping.calcShipping(shipBase, shippingContext)
      final = vipTotal
      break
    default:
      couponValue = coupon.value || 0
      final = vipTotal - couponValue
  }

  if (final < 0) final = 0
  return {
    final: Math.round(final * 100) / 100,
    couponValue: Math.round(couponValue * 100) / 100
  }
}

/**
 * 计成长值口径：会员折扣前应付（商品折后前 + 券后 + 运费）。
 * 与历史「实付 totalPrice」在无会员折时一致；首单预估定级用此值避免折后循环。
 */
function computeGrowthBasePayable({
  originalPrice,
  discountedSubtotal,
  nonDiscounted,
  extra,
  coupon,
  shippingContext,
  shippingBase,
  storePickup = false
}) {
  const vipTotalNoMember = Math.round((discountedSubtotal * 1 + nonDiscounted) * 100) / 100
  const { final } = applyCoupon(vipTotalNoMember, coupon, shippingContext, shippingBase)
  let shippingFee = storePickup ? 0 : shipping.calcShipping(shippingBase, shippingContext)
  if (storePickup || (coupon && coupon.type === 'freeShipping')) {
    shippingFee = 0
  }
  return Math.round((final + extra + shippingFee) * 100) / 100
}

async function calculateOrderPricing(db, openid, rawItems, couponId, customExtraPrice = 0, options = {}) {
  if (!rawItems || !rawItems.length) {
    throw new Error('订单商品不能为空')
  }

  const useWalletPay = !!options.useWalletPay
  const depositIntentId = String(options.depositIntentId || '').trim()
  // 门店自取：服务端强制运费为 0，忽略前端传入与运费规则
  const storePickup = !!options.storePickup

  await shipping.loadFromDb(db)
  const { calcShipping, resolveShippingKind } = shipping
  const THRESHOLDS = shipping.getThresholds()
  const DEFAULT_CARRIER = shipping.getDefaultCarrier()

  const items = rawItems.map((item) => ({
    productId: item.productId || item.id,
    skuId: item.skuId || '',
    count: Math.max(1, parseInt(item.count, 10) || 1),
    collectionId: item.collectionId || null
  }))

  const productIds = items.map((i) => i.productId)
  const productsRes = await db.collection('products').where({ _id: _.in(productIds) }).get()
  const productMap = {}
  productsRes.data.forEach((p) => { productMap[p._id] = p })

  let originalPrice = 0
  let discountedSubtotal = 0
  let totalCount = 0
  const orderProducts = []

  for (const item of items) {
    const p = productMap[item.productId]
    if (!p) throw new Error('商品不存在或已下架')
    if (p.isOffShelf) throw new Error(`「${p.title}」已下架`)

    // 定金优先锁：尾款窗口内仅锁定用户可购
    const lockOpenid = String(p.depositLockOpenid || '').trim()
    const lockUntil = p.depositLockUntil ? new Date(p.depositLockUntil).getTime() : 0
    if (lockOpenid && lockUntil && Date.now() < lockUntil && lockOpenid !== openid) {
      throw new Error(`「${p.title}」定金优先期内仅候补用户可购，请稍后再试`)
    }

    const { unitPrice, skuLabel, skuStock, skuImage } = resolveUnitPrice(p, item.skuId)
    const stock = resolveStock(p, item.skuId, skuStock)
    if (stock < item.count) throw new Error(`「${p.title}」库存不足`)

    const lineTotal = unitPrice * item.count
    originalPrice += lineTotal
    totalCount += item.count
    const joinMemberDiscount = isMemberDiscountEnabled(p)
    if (joinMemberDiscount) discountedSubtotal += lineTotal

    const shippingKind = resolveShippingKind(p)
    orderProducts.push({
      id: p._id,
      skuId: item.skuId || '',
      skuLabel,
      title: p.title,
      image: skuImage || (p.images && p.images[0]) || '',
      price: unitPrice,
      latin: p.latinName || '',
      count: item.count,
      isTreasure: !!p.isTreasure,
      isUnique: !!p.isUnique,
      // 退款损耗判定（refundOrder/refundPolicy.isTreasureLike）同时看 title 与 tags，
      // 快照缺 tags 会让「仅靠 tags 标孤品」的商品退款时漏扣 30%
      tags: Array.isArray(p.tags) ? p.tags.slice(0, 20) : [],
      memberDiscountEnabled: joinMemberDiscount,
      shippingKind,
      categoryType: p.categoryType || '',
      categoryId: p.categoryId || '',
      rootCategoryId: p.rootCategoryId || '',
      rootCategoryName: p.rootCategoryName || '',
      category: p.category || p.categoryName || '',
      craftType: p.craftType || '',
      craftProcess: p.craftProcess || '',
      framerId: p.framerId || '',
      framerName: p.framerName || '',
      protectionType: p.protectionType || 'none'
    })
  }

  const member = await getUserDiscountRate(db, openid)
  let memberDiscountRate = member.discountRate
  let levelName = member.levelName
  let level = member.level
  let provisionalMemberLevel = null

  let coupon = null
  if (couponId) {
    const couponRes = await db.collection('user_coupons').doc(couponId).get()
    coupon = couponRes.data
    if (!coupon || coupon._openid !== openid || !isCouponUsableStatus(coupon.status)) {
      throw new Error('优惠券无效或已使用')
    }
    const expireAt = couponExpireTime(coupon)
    if (expireAt && new Date(expireAt) <= new Date()) {
      throw new Error('优惠券已过期')
    }
    // 线上商城下单仅可用 online / all；门店券走店员核销
    if (!couponChannelAllows(coupon, 'online')) {
      throw new Error('该券仅限门店使用，请到店出示会员码核销')
    }
  }

  const extra = Math.max(0, parseFloat(customExtraPrice) || 0)
  const nonDiscounted = originalPrice - discountedSubtotal
  const shippingContext = orderProducts
  const shippingBase = Math.round((originalPrice + extra) * 100) / 100

  const growthBasePayable = computeGrowthBasePayable({
    originalPrice,
    discountedSubtotal,
    nonDiscounted,
    extra,
    coupon,
    shippingContext,
    shippingBase,
    storePickup
  })
  const estimatedOrderGrowth = Math.floor(growthBasePayable)

  const projectedUpgrade = resolveProjectedUpgrade(
    member.levels,
    member.growthValue,
    estimatedOrderGrowth,
    {
      level: member.level,
      levelName: member.levelName,
      discountRate: member.discountRate
    },
    member.isHonorary,
    member.levelOverride
  )
  if (projectedUpgrade) {
    memberDiscountRate = projectedUpgrade.discountRate
    level = projectedUpgrade.level
    levelName = projectedUpgrade.levelName
    provisionalMemberLevel = projectedUpgrade
  }

  // 折扣仅来自会员等级（含本单预估定级）；钱包只作余额支付手段，无独立折扣
  const discountRate = memberDiscountRate
  const walletAvailableFen = await loadWalletAvailableFen(db, openid)

  // 计价：目录价 → 会员折扣 → 优惠券 → 定制加价/运费 →（可选）钱包余额抵扣
  const vipTotal = Math.round((discountedSubtotal * discountRate + nonDiscounted) * 100) / 100
  if (coupon) {
    const minSpend = parseMinSpend(coupon)
    if (vipTotal < minSpend) throw new Error('未达到优惠券使用门槛')
  }

  const { final: rawFinal, couponValue: rawCouponValue } = applyCoupon(
    vipTotal,
    coupon,
    shippingContext,
    shippingBase
  )
  // 会员价 + 券叠加后，商品实付仍不得低于原价 75%（7.5 折地板）
  let final = rawFinal
  let couponValue = rawCouponValue
  if (coupon && (coupon.type || 'cash') !== 'freeShipping') {
    const clamped = clampCouponAgainstOriginal(vipTotal, rawCouponValue, originalPrice)
    final = clamped.final
    couponValue = clamped.couponValue
    // 会员折已顶满 75% 地板：现金/折扣券无效，勿锁券、勿记 couponId
    if (!(couponValue > 0)) {
      coupon = null
      couponValue = 0
      final = vipTotal
    }
  }
  let shippingFee = storePickup ? 0 : calcShipping(shippingBase, shippingContext)

  if (storePickup || (coupon && coupon.type === 'freeShipping')) {
    shippingFee = 0
  }

  const totalPriceBeforeDeposit = Math.round((final + extra + shippingFee) * 100) / 100

  // 定金抵扣（尾款）：仅当意向属于本人且状态为 awaiting_balance，且商品匹配
  let depositCredit = 0
  let depositIntent = null
  let depositProductId = ''
  if (depositIntentId) {
    const { STATUS } = require('./depositDefaults')
    const intentRes = await db.collection('deposit_intents').doc(depositIntentId).get()
    const intent = intentRes.data
    if (!intent || intent._openid !== openid) {
      throw new Error('定金意向无效')
    }
    if (intent.status !== STATUS.AWAITING_BALANCE) {
      throw new Error('当前定金状态不可付尾款')
    }
    const matchProduct = orderProducts.some((p) => p.id === intent.productId)
    if (!matchProduct) {
      throw new Error('订单商品与定金意向不一致')
    }
    // 尾款窗口校验
    if (intent.balanceDueAt && new Date(intent.balanceDueAt).getTime() < Date.now()) {
      throw new Error('尾款已逾期，商品已对所有人开放')
    }
    depositCredit = Math.max(0, Number(intent.depositAmount) || 0)
    depositIntent = intent
    depositProductId = intent.productId
  }

  const totalPrice = Math.max(0, Math.round((totalPriceBeforeDeposit - depositCredit) * 100) / 100)
  const totalFen = Math.round(totalPrice * 100)
  const walletPayFenEstimate = useWalletPay
    ? Math.min(walletAvailableFen, totalFen)
    : 0
  const wxpayFenEstimate = Math.max(0, totalFen - walletPayFenEstimate)

  const collectionIds = items.map((i) => i.collectionId).filter(Boolean)
  const hasSpecimen = shippingContext.some((p) => resolveShippingKind(p) === 'specimen')
  const freeShippingThreshold = hasSpecimen ? THRESHOLDS.specimen : THRESHOLDS.accessory

  const growthAmount = provisionalMemberLevel ? estimatedOrderGrowth : null

  return {
    originalPrice: Math.round((originalPrice + extra) * 100) / 100,
    vipTotal,
    goodsPrice: final + extra,
    customExtraPrice: extra,
    shippingFee,
    shippingKind: hasSpecimen ? 'specimen' : 'accessory',
    freeShippingThreshold,
    carrier: DEFAULT_CARRIER,
    totalPrice,
    totalPriceBeforeDeposit,
    depositCredit,
    depositIntentId: depositIntent ? depositIntentId : null,
    depositProductId: depositProductId || null,
    discountRate,
    memberDiscountRate,
    level,
    levelName,
    growthAmount,
    provisionalMemberLevel,
    couponValue,
    couponId: coupon ? coupon._id : null,
    count: totalCount,
    products: orderProducts,
    collectionIds,
    useWalletPay,
    walletAvailableFen,
    walletBenefitSnapshot: {
      rule: 'member_level',
      description: '用钱包支付时，按本单可达的会员等级享受专属支付折扣。'
    },
    paymentBreakdown: {
      totalFen,
      walletPayFen: walletPayFenEstimate,
      wxpayFen: wxpayFenEstimate,
      depositCreditFen: Math.round(depositCredit * 100)
    }
  }
}

module.exports = {
  calculateOrderPricing,
  getUserDiscountRate,
  applyCoupon,
  isMemberDiscountEnabled,
  computeGrowthBasePayable
}
