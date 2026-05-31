const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/** 云环境 ID，与 app.js 中 wx.cloud.init env 一致；接入真实支付时在云开发控制台配置商户号 */
const ENV_ID = process.env.TCB_ENV || process.env.SCF_NAMESPACE || 'cloud1-8gnkty5bfff9f0bf'
const SUB_MCH_ID = process.env.WX_PAY_SUB_MCH_ID || ''

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const { orderId } = event

  if (!orderId) {
    return { success: false, msg: '缺少订单 ID' }
  }

  try {
    const orderRes = await db.collection('orders').doc(orderId).get()
    const order = orderRes.data

    if (!order || order._openid !== openid) {
      return { success: false, msg: '订单不存在' }
    }
    if (order.status !== 'pending_pay') {
      return { success: false, msg: '订单不可支付', status: order.status }
    }

    if (order.payExpireTime && new Date(order.payExpireTime).getTime() < Date.now()) {
      return { success: false, msg: '订单已过期，请重新下单' }
    }

    const totalFee = Math.round(parseFloat(String(order.totalPrice).replace(/,/g, '')) * 100)
    if (!totalFee || totalFee <= 0) {
      return { success: false, msg: '订单金额异常' }
    }

    if (SUB_MCH_ID) {
      try {
        const res = await cloud.cloudPay.unifiedOrder({
          body: '山海造物·标本藏品',
          outTradeNo: order.orderNo,
          spbillCreateIp: '127.0.0.1',
          subMchId: SUB_MCH_ID,
          totalFee,
          envId: ENV_ID,
          functionName: 'payCallback',
          tradeType: 'JSAPI',
          openid
        })

        return {
          success: true,
          orderId,
          payment: res.payment
        }
      } catch (payErr) {
        console.error('cloudPay.unifiedOrder failed:', payErr)
      }
    }

    return {
      success: true,
      orderId,
      mockPay: true,
      msg: '开发模式：将模拟支付（配置 WX_PAY_SUB_MCH_ID 后启用真实微信支付）'
    }
  } catch (err) {
    console.error('payOrder error:', err)
    return { success: false, msg: err.message || '发起支付失败' }
  }
}
