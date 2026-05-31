const cloud = require('wx-server-sdk')
const { dispatchInAppMessage } = require('./inAppMessage')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const { orderId, reason } = event

  if (!orderId) {
    return { success: false, msg: '订单 ID 无效' }
  }

  try {
    const orderRes = await db.collection('orders').doc(orderId).get()
    const order = orderRes.data

    if (!order || order._openid !== openid) {
      return { success: false, msg: '订单不存在' }
    }

    if (order.status !== 'pending_pay') {
      return { success: false, msg: '当前状态不可取消' }
    }

    if (reason !== 'expired' && order.payExpireTime) {
      const expireAt = new Date(order.payExpireTime).getTime()
      if (Date.now() > expireAt) {
        return { success: false, msg: '订单已过期，请刷新列表' }
      }
    }

    await db.collection('orders').doc(orderId).update({
      data: {
        status: 'void',
        cancelTime: db.serverDate(),
        cancelReason: reason || 'user'
      }
    })

    await dispatchInAppMessage(db, {
      eventType: 'order_cancelled',
      openid,
      relatedId: orderId,
      vars: {
        orderNo: order.orderNo || '',
        reason: reason === 'expired' ? '支付超时自动取消' : '您已取消订单'
      }
    }).catch((err) => console.warn('order_cancelled message failed:', err))

    return { success: true }
  } catch (err) {
    console.error('cancelOrder error:', err)
    return { success: false, msg: err.message || '取消失败' }
  }
}
