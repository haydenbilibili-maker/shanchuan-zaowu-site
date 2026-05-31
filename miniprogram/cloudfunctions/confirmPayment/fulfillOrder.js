/**
 * 支付成功后履约：扣库存、核销券、更新订单、清理购物车
 */
const { deductStock } = require('./stockUtils')
const cloud = require('wx-server-sdk')
const { dispatchInAppMessage } = require('./inAppMessage')

async function fulfillOrder(db, _, orderId, openid) {
  const orderRes = await db.collection('orders').doc(orderId).get()
  const order = orderRes.data

  if (!order) throw new Error('订单不存在')
  if (order._openid !== openid) throw new Error('无权操作此订单')
  if (order.status === 'paid' || order.status === 'shipped' || order.status === 'received') {
    return { success: true, alreadyPaid: true, orderId }
  }
  if (order.status !== 'pending_pay') throw new Error('订单状态不可支付')

  if (order.payExpireTime && new Date(order.payExpireTime) < new Date()) {
    await db.collection('orders').doc(orderId).update({
      data: { status: 'void', cancelReason: '支付超时' }
    })
    throw new Error('订单已超时，请重新下单')
  }

  for (const item of order.products) {
    const productId = item.id || item.productId
    await deductStock(db, _, productId, item.skuId || '', item.count || 1)
  }

  if (order.couponId) {
    const couponRes = await db.collection('user_coupons').doc(order.couponId).get()
    if (couponRes.data && couponRes.data.status === 'unused') {
      await db.collection('user_coupons').doc(order.couponId).update({
        data: {
          status: 'used',
          usedTime: db.serverDate(),
          usedOrder: orderId
        }
      })
    }
  }

  await db.collection('orders').doc(orderId).update({
    data: {
      status: 'paid',
      paidTime: db.serverDate(),
      wxPayMode: order.wxPayMode || (order.wxTransactionId ? 'wechat' : 'mock')
    }
  })

  const collectionIds = order.collectionIds || []
  if (collectionIds.length) {
    await Promise.all(
      collectionIds.map((cid) =>
        db.collection('collections').doc(cid).remove().catch(() => null)
      )
    )
  }

  const productNames = (order.products || []).map((p) => p.title || p.name).filter(Boolean).slice(0, 2).join('、')
  await dispatchInAppMessage(db, {
    eventType: 'order_paid',
    openid,
    relatedId: orderId,
    vars: {
      orderNo: order.orderNo || '',
      totalPrice: order.totalPrice || '0.00',
      productNames
    }
  }).catch((err) => console.warn('order_paid message failed:', err))

  return { success: true, orderId }
}

module.exports = { fulfillOrder }
