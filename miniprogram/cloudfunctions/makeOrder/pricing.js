/**
 * 服务端订单核价（与前端 calculateTotal 逻辑对齐）
 */
const cloud = require('wx-server-sdk')
const { calcShipping } = require('./shipping')
const { hasSkus, sumSkuStock } = require('./stockUtils')
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

async function getUserDiscountRate(db, openid) {
  let discountRate = 1.0
  let growthValue = 0
  let bonusPoints = 0
  let usedPoints = 0
  let isHonorary = false

  const userRes = await db.collection('users').where({ _openid: openid }).get()
  if (userRes.data.length > 0) {
    const u = userRes.data[0]
    isHonorary = u.isHonorary === true
    bonusPoints = u.bonusPoints || 0
    usedPoints = u.usedPoints || 0
  }

  const orderRes = await db.collection('orders')
    .where({ _openid: openid, status: _.in(['paid', 'shipped', 'received']) })
    .get()

  orderRes.data.forEach((order) => {
    if (order.totalPrice) {
      const price = parseFloat(String(order.totalPrice).replace(/,/g, ''))
      if (!isNaN(price)) growthValue += price
    }
  })

  growthValue = Math.floor(growthValue)

  if (isHonorary) {
    discountRate = 0.85
  } else if (growthValue >= 30000) {
    discountRate = 0.85
  } else if (growthValue >= 10000) {
    discountRate = 0.9
  } else if (growthValue >= 3000) {
    discountRate = 0.95
  } else if (growthValue >= 500) {
    discountRate = 0.98
  }

  return { discountRate, growthValue, points: growthValue + bonusPoints - usedPoints }
}

function applyCoupon(vipTotal, coupon) {
  if (!coupon) return { final: vipTotal, couponValue: 0 }

  const type = coupon.type || 'cash'
  let couponValue = 0
  let final = vipTotal

  switch (type) {
    case 'discount': {
      const rate = (coupon.value || 0) / 10
      couponValue = vipTotal * (1 - rate)
      final = vipTotal * rate
      break
    }
    case 'freeShipping':
      couponValue = 10
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

async function calculateOrderPricing(db, openid, rawItems, couponId, customExtraPrice = 0) {
  if (!rawItems || !rawItems.length) {
    throw new Error('订单商品不能为空')
  }

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
  let totalCount = 0
  const orderProducts = []

  for (const item of items) {
    const p = productMap[item.productId]
    if (!p) throw new Error('商品不存在或已下架')
    if (p.isOffShelf) throw new Error(`「${p.title}」已下架`)

    const { unitPrice, skuLabel, skuStock, skuImage } = resolveUnitPrice(p, item.skuId)
    const stock = resolveStock(p, item.skuId, skuStock)
    if (stock < item.count) throw new Error(`「${p.title}」库存不足`)

    originalPrice += unitPrice * item.count
    totalCount += item.count

    orderProducts.push({
      id: p._id,
      skuId: item.skuId || '',
      skuLabel,
      title: p.title,
      image: skuImage || (p.images && p.images[0]) || '',
      price: unitPrice,
      latin: p.latinName || '',
      count: item.count
    })
  }

  const { discountRate } = await getUserDiscountRate(db, openid)
  const vipTotal = Math.round(originalPrice * discountRate * 100) / 100

  let coupon = null
  if (couponId) {
    const couponRes = await db.collection('user_coupons').doc(couponId).get()
    coupon = couponRes.data
    if (!coupon || coupon._openid !== openid || coupon.status !== 'unused') {
      throw new Error('优惠券无效或已使用')
    }
    const minSpend = coupon.minSpend || 0
    if (vipTotal < minSpend) throw new Error('未达到优惠券使用门槛')
    if (coupon.expireTime && new Date(coupon.expireTime) <= new Date()) {
      throw new Error('优惠券已过期')
    }
  }

  const { final, couponValue } = applyCoupon(vipTotal, coupon)
  const extra = Math.max(0, parseFloat(customExtraPrice) || 0)
  let shippingFee = calcShipping(final + extra)

  if (coupon && coupon.type === 'freeShipping') {
    shippingFee = 0
  }

  const totalPrice = Math.round((final + extra + shippingFee) * 100) / 100
  const collectionIds = items.map((i) => i.collectionId).filter(Boolean)

  return {
    originalPrice: Math.round((originalPrice + extra) * 100) / 100,
    vipTotal,
    goodsPrice: final + extra,
    customExtraPrice: extra,
    shippingFee,
    totalPrice,
    discountRate,
    couponValue,
    couponId: coupon ? coupon._id : null,
    count: totalCount,
    products: orderProducts,
    collectionIds
  }
}

module.exports = {
  calculateOrderPricing,
  getUserDiscountRate,
  applyCoupon
}
