const cloud = require('wx-server-sdk')
const { fulfillOrder } = require('./fulfillOrder')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const { orderId } = event

  if (!orderId) {
    return { success: false, msg: '缺少订单 ID' }
  }

  try {
    const result = await fulfillOrder(db, _, orderId, openid)
    return result
  } catch (err) {
    console.error('confirmPayment error:', err)
    return { success: false, msg: err.message || '支付确认失败' }
  }
}
