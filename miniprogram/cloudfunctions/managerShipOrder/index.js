const cloud = require('wx-server-sdk')
const { dispatchInAppMessage } = require('./messageWrite')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event) => {
  const { orderId, carrier = '顺丰速运', trackingNumber = '' } = event
  const tracking = String(trackingNumber || '').trim().replace(/\s/g, '')

  if (!orderId) {
    return { success: false, msg: '缺少订单 ID' }
  }
  if (!tracking || tracking.length < 6) {
    return { success: false, msg: '请填写有效快递单号' }
  }

  try {
    const orderRes = await db.collection('orders').doc(orderId).get()
    const order = orderRes.data
    if (!order) {
      return { success: false, msg: '订单不存在' }
    }
    if (order.status !== 'paid' && order.status !== 'shipped') {
      return { success: false, msg: '当前订单状态不可发货' }
    }

    const buyerOpenid = order._openid || order.openid
    if (!buyerOpenid) {
      return { success: false, msg: '订单缺少买家信息，无法通知' }
    }

    await db.collection('orders').doc(orderId).update({
      data: {
        status: 'shipped',
        logistics: {
          carrier: String(carrier || '快递').trim(),
          trackingNumber: tracking,
          shipTime: db.serverDate()
        }
      }
    })

    const msgRes = await dispatchInAppMessage(db, {
      eventType: 'order_shipped',
      openid: buyerOpenid,
      relatedId: orderId,
      vars: {
        orderNo: order.orderNo || '',
        carrier: String(carrier || '快递').trim(),
        trackingNo: tracking
      }
    })

    return {
      success: true,
      orderId,
      messageSent: !!(msgRes && msgRes.success && !msgRes.skipped),
      messageDetail: msgRes
    }
  } catch (err) {
    console.error('managerShipOrder error:', err)
    return { success: false, msg: err.message || '发货失败' }
  }
}
