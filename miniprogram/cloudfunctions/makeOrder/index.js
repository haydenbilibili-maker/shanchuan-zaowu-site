const cloud = require('wx-server-sdk')
const { calculateOrderPricing } = require('./pricing')
const { dispatchInAppMessage } = require('./inAppMessage')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const PAY_TIMEOUT_MS = 30 * 60 * 1000

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  const {
    products,
    items,
    couponId,
    address,
    remark,
    invoice,
    collectionIds: extraCollectionIds,
    customMeta,
    customExtraPrice
  } = event

  if (!address || !address.name || !address.phone) {
    return { success: false, msg: '请填写完整收货地址' }
  }

  let rawItems = items
  if (!rawItems || !rawItems.length) {
    if (!products || !products.length) {
      return { success: false, msg: '订单商品不能为空' }
    }
    rawItems = products.map((p) => ({
      productId: p.id || p.productId,
      skuId: p.skuId || '',
      count: p.count || 1,
      collectionId: p.collectionId || null
    }))
  }

  try {
    const pricing = await calculateOrderPricing(
      db,
      openid,
      rawItems,
      couponId || null,
      customExtraPrice || (customMeta && customMeta.customExtraPrice) || 0
    )

    let collectionIds = [...pricing.collectionIds]
    if (Array.isArray(extraCollectionIds)) {
      extraCollectionIds.forEach((id) => {
        if (id && !collectionIds.includes(id)) collectionIds.push(id)
      })
    }

    const orderNo = 'ORD' + Date.now() + Math.floor(Math.random() * 1000)
    const payExpireTime = new Date(Date.now() + PAY_TIMEOUT_MS)

    const orderRes = await db.collection('orders').add({
      data: {
        _openid: openid,
        products: pricing.products,
        totalPrice: pricing.totalPrice,
        goodsPrice: pricing.goodsPrice,
        shippingFee: pricing.shippingFee,
        originalPrice: pricing.originalPrice,
        discountRate: pricing.discountRate,
        couponId: pricing.couponId,
        couponValue: pricing.couponValue,
        count: pricing.count,
        address,
        remark: (remark || '').slice(0, 200),
        invoice: invoice && invoice.title ? {
          type: invoice.type || 'personal',
          title: String(invoice.title).slice(0, 100),
          taxNo: String(invoice.taxNo || '').slice(0, 32),
          email: String(invoice.email || '').slice(0, 80)
        } : null,
        collectionIds,
        status: 'pending_pay',
        createTime: db.serverDate(),
        payExpireTime,
        orderNo,
        source: customMeta && customMeta.isCustom ? 'custom' : 'cart',
        customMeta: customMeta && customMeta.isCustom ? customMeta : null,
        customExtraPrice: pricing.customExtraPrice || 0,
        productionStatus: customMeta && customMeta.isCustom ? 'pending_make' : null
      }
    })

    const productNames = pricing.products.map((p) => p.title || p.name).filter(Boolean).slice(0, 2).join('、')
    await dispatchInAppMessage(db, {
      eventType: 'order_created',
      openid,
      relatedId: orderRes._id,
      vars: {
        productNames: productNames || '藏品订单',
        totalPrice: pricing.totalPrice
      }
    }).catch((err) => console.warn('order_created message failed:', err))

    return {
      success: true,
      orderId: orderRes._id,
      orderNo,
      totalPrice: pricing.totalPrice,
      status: 'pending_pay'
    }
  } catch (err) {
    console.error('makeOrder error:', err)
    return { success: false, msg: err.message || '下单失败' }
  }
}
