const cloud = require('wx-server-sdk')
const { restoreStock } = require('./stockUtils')
const { ENV_ID, SUB_MCH_ID, parseYuanToFen, isUserAdmin } = require('./payConfig')
const { dispatchInAppMessage } = require('./inAppMessage')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event) => {
  const { orderId } = event
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  if (!orderId) {
    return { success: false, msg: '缺少订单 ID' }
  }

  try {
    const orderRes = await db.collection('orders').doc(orderId).get()
    const order = orderRes.data
    const admin = await isUserAdmin(db, openid)

    if (!order) {
      return { success: false, msg: '订单不存在' }
    }

    if (!admin && order._openid !== openid) {
      return { success: false, msg: '无权操作此订单' }
    }

    if (!['refunding', 'aftersales'].includes(order.status)) {
      return { success: false, msg: '订单状态不正确' }
    }

    const refundFee = parseYuanToFen(order.totalPrice)
    if (!refundFee) {
      return { success: false, msg: '退款金额异常' }
    }

    let refundNo = `MOCK_REF_${Date.now()}`
    let refundMock = true
    let wxRefundResult = null

    if (SUB_MCH_ID && order.wxPayMode === 'wechat' && order.orderNo) {
      refundNo = `REF${String(order.orderNo).slice(-12)}${Date.now()}`.slice(0, 32)
      try {
        wxRefundResult = await cloud.cloudPay.refund({
          envId: ENV_ID,
          subMchId: SUB_MCH_ID,
          outTradeNo: order.orderNo,
          outRefundNo: refundNo,
          totalFee: refundFee,
          refundFee
        })
        refundMock = false
      } catch (payErr) {
        console.error('cloudPay.refund failed:', payErr)
        return {
          success: false,
          msg: payErr.message || '微信退款接口调用失败，请稍后重试'
        }
      }
    }

    for (const item of order.products || []) {
      await restoreStock(db, _, item.id, item.skuId || '', item.count || 1)
    }

    await db.collection('orders').doc(orderId).update({
      data: {
        status: 'refunded',
        refundTime: db.serverDate(),
        refundNo,
        refundFee: order.totalPrice,
        refundMock,
        wxRefundResult: wxRefundResult || null
      }
    })

    await dispatchInAppMessage(db, {
      eventType: 'order_refunded',
      openid: order._openid,
      relatedId: orderId,
      vars: {
        orderNo: order.orderNo || '',
        refundAmount: order.totalPrice || '0.00'
      }
    }).catch((err) => console.warn('order_refunded message failed:', err))

    cloud.callFunction({
      name: 'sendCareReminder',
      data: { action: 'cancel', orderId, openid: order._openid }
    }).catch((err) => console.warn('cancel care reminder failed:', err))

    return {
      success: true,
      refundNo,
      refundMock,
      msg: refundMock ? '已完成退款（开发模式，未调用微信支付）' : '微信退款已提交'
    }
  } catch (err) {
    console.error(err)
    return { success: false, msg: err.message || '退款失败' }
  }
}
