const cloud = require('wx-server-sdk')
const { fulfillOrder } = require('./fulfillOrder')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

/**
 * 微信支付结果回调（cloudPay unifiedOrder 的 functionName）
 * event 结构见微信云开发支付文档
 */
exports.main = async (event) => {
  console.log('payCallback event:', JSON.stringify(event))

  const returnCode = event.returnCode || event.return_code
  const resultCode = event.resultCode || event.result_code
  const outTradeNo = event.outTradeNo || event.out_trade_no

  if (returnCode !== 'SUCCESS' || resultCode !== 'SUCCESS') {
    return { errcode: 0, errmsg: 'FAIL' }
  }

  if (!outTradeNo) {
    return { errcode: -1, errmsg: 'missing outTradeNo' }
  }

  try {
    const orderRes = await db.collection('orders').where({ orderNo: outTradeNo }).limit(1).get()
    if (!orderRes.data.length) {
      console.error('payCallback: order not found', outTradeNo)
      return { errcode: 0, errmsg: 'SUCCESS' }
    }

    const order = orderRes.data[0]
    const transactionId = event.transactionId || event.transaction_id || ''

    if (transactionId) {
      await db.collection('orders').doc(order._id).update({
        data: {
          wxTransactionId: transactionId,
          wxPayMode: 'wechat'
        }
      })
    }

    await fulfillOrder(db, _, order._id, order._openid)
    return { errcode: 0, errmsg: 'SUCCESS' }
  } catch (err) {
    console.error('payCallback fulfill error:', err)
    return { errcode: -1, errmsg: err.message }
  }
}
