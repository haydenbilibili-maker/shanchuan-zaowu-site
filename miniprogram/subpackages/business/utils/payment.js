/**
 * 统一支付入口：真实微信支付 / 开发环境模拟支付
 */
async function payForOrder(orderId, options = {}) {
  const { onMockHint } = options

  if (!orderId) {
    throw new Error('订单 ID 无效')
  }

  wx.showLoading({ title: '唤起支付...', mask: true })

  let payRes
  try {
    payRes = await wx.cloud.callFunction({
      name: 'payOrder',
      data: { orderId }
    })
  } catch (e) {
    wx.hideLoading()
    throw new Error('支付服务不可用')
  }

  const result = payRes.result || {}
  wx.hideLoading()

  if (!result.success) {
    throw new Error(result.msg || '无法发起支付')
  }

  if (result.payment) {
    await new Promise((resolve, reject) => {
      wx.requestPayment({
        ...result.payment,
        success: resolve,
        fail: (err) => {
          if (err.errMsg && err.errMsg.includes('cancel')) {
            reject(new Error('已取消支付'))
          } else {
            reject(new Error(err.errMsg || '支付失败'))
          }
        }
      })
    })

    wx.showLoading({ title: '确认支付结果...', mask: true })
    try {
      const confirmRes = await wx.cloud.callFunction({
        name: 'confirmPayment',
        data: { orderId }
      })
      wx.hideLoading()
      if (confirmRes.result && confirmRes.result.success) {
        return confirmRes.result
      }
      return { success: true, orderId, pendingConfirm: true }
    } catch (e) {
      wx.hideLoading()
      return { success: true, orderId, pendingConfirm: true }
    }
  }

  if (result.mockPay) {
    if (typeof onMockHint === 'function') {
      onMockHint(result.msg)
    }
    wx.showLoading({ title: '模拟支付中...', mask: true })
    const confirmRes = await wx.cloud.callFunction({
      name: 'confirmPayment',
      data: { orderId }
    })
    wx.hideLoading()
    if (!confirmRes.result || !confirmRes.result.success) {
      throw new Error((confirmRes.result && confirmRes.result.msg) || '支付确认失败')
    }
    return confirmRes.result
  }

  throw new Error('支付参数异常')
}

module.exports = { payForOrder }
