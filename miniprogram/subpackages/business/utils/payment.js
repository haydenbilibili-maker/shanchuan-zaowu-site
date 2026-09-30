/**
 * 统一支付入口：真实微信支付；仅当云函数显式返回 mockPay 时才模拟（需 ALLOW_MOCK_PAY=1）
 * 支持「我的钱包」：全额钱包 / 余额+微信；用户取消或失败时回账。
 */

async function refundWalletForOrder(orderId) {
  if (!orderId) return { success: false }
  try {
    const res = await wx.cloud.callFunction({
      name: 'manageStoredValue',
      data: {
        action: 'refundWalletForOrder',
        orderId,
        remark: '用户取消或支付失败·钱包回账'
      }
    })
    return (res && res.result) || { success: false }
  } catch (e) {
    console.warn('refundWalletForOrder', e)
    return { success: false, msg: e.message || '回账失败' }
  }
}

async function payForOrder(orderId, options = {}) {
  const { onMockHint } = options

  if (!orderId) {
    throw new Error('订单 ID 无效')
  }

  wx.showLoading({ title: '唤起支付…', mask: true })

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
    const err = new Error(result.msg || '无法发起支付')
    err.code = result.code
    err.walletRefunded = !!result.walletRefunded
    throw err
  }

  // 全额钱包：直接确认履约
  if (result.paidByWallet === true) {
    wx.showLoading({ title: '确认支付…', mask: true })
    try {
      const confirmRes = await wx.cloud.callFunction({
        name: 'confirmPayment',
        data: { orderId }
      })
      wx.hideLoading()
      if (confirmRes.result && confirmRes.result.success) {
        return Object.assign({}, confirmRes.result, {
          paidByWallet: true,
          walletPayFen: result.walletPayFen || 0
        })
      }
      throw new Error((confirmRes.result && confirmRes.result.msg) || '钱包支付确认失败')
    } catch (e) {
      wx.hideLoading()
      // 扣款已完成但履约失败：不自动回账（避免与异步履约竞态）；提示用户刷新订单
      throw new Error(e.message || '钱包已扣款，订单确认中，请稍后查看订单')
    }
  }

  if (result.payment) {
    const payment = result.payment
    const pkg = String(payment.package || '')
    if (!pkg.startsWith('prepay_id=') || pkg.length <= 'prepay_id='.length + 2) {
      // 微信在 package 无效时会误报「缺少 total_fee」，此处提前拦截
      throw new Error(
        result.msg ||
          '支付参数无效，请稍后重试。若反复出现请联系门店（预支付单未生成）。'
      )
    }
    const walletHeld = !!(result.walletHeld || (result.walletPayFen > 0))
    try {
      await new Promise((resolve, reject) => {
        wx.requestPayment({
          timeStamp: String(payment.timeStamp || ''),
          nonceStr: payment.nonceStr,
          package: payment.package,
          signType: payment.signType || 'MD5',
          paySign: payment.paySign,
          success: resolve,
          fail: (err) => {
            const raw = (err && err.errMsg) || ''
            if (raw.includes('cancel')) {
              reject(new Error('已取消支付'))
            } else if (/total_fee/i.test(raw)) {
              reject(
                new Error(
                  '支付参数异常（预支付单无效），请返回订单后再次「立即支付」'
                )
              )
            } else {
              console.warn('[payment] requestPayment fail', raw)
              reject(new Error('微信支付没有完成，请稍后再试'))
            }
          }
        })
      })
    } catch (payErr) {
      if (walletHeld) {
        const refund = await refundWalletForOrder(orderId)
        const base = payErr.message || '支付失败'
        if (base === '已取消支付') {
          const err = new Error(
            refund && refund.success
              ? '已取消支付，钱包余额已退回'
              : '已取消支付；若钱包已扣款请稍后下拉刷新或联系专员'
          )
          err.cancelled = true
          err.walletRefunded = !!(refund && refund.success)
          throw err
        }
        const err = new Error(
          refund && refund.success
            ? `${base}，钱包余额已退回`
            : `${base}；钱包扣款回账异常，请联系专员`
        )
        err.walletRefunded = !!(refund && refund.success)
        throw err
      }
      throw payErr
    }

    wx.showLoading({ title: '确认支付结果…', mask: true })
    try {
      // 支付回调可能有延迟（或历史事故期间缺失）：短轮询重试，避免「已付款仍显示待支付」
      let lastResult = null
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const confirmRes = await wx.cloud.callFunction({
          name: 'confirmPayment',
          data: { orderId }
        })
        const result = (confirmRes && confirmRes.result) || {}
        if (result.success) {
          wx.hideLoading()
          return result
        }
        lastResult = result
        const pending =
          result.pendingConfirm === true || result.code === 'AWAITING_CALLBACK'
        if (!pending || attempt === 2) break
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
      wx.hideLoading()
      return { success: true, orderId, pendingConfirm: true, lastResult }
    } catch (e) {
      wx.hideLoading()
      return { success: true, orderId, pendingConfirm: true }
    }
  }

  if (result.mockPay === true) {
    if (typeof onMockHint === 'function') {
      onMockHint(result.msg)
    }
    wx.showLoading({ title: '模拟支付中…', mask: true })
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

  throw new Error(result.msg || '支付未开通')
}

module.exports = { payForOrder, refundWalletForOrder }
