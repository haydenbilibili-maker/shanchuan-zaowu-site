const CHECKOUT_KEY = 'checkoutPayload'

function saveCheckoutPayload(payload) {
  wx.setStorageSync(CHECKOUT_KEY, payload)
}

function consumeCheckoutPayload() {
  try {
    const payload = wx.getStorageSync(CHECKOUT_KEY)
    if (payload) wx.removeStorageSync(CHECKOUT_KEY)
    return payload
  } catch (e) {
    return null
  }
}

function navigateToConfirmOrder(items, options = {}) {
  if (!items || !items.length) {
    wx.showToast({ title: '请选择商品', icon: 'none' })
    return
  }
  saveCheckoutPayload({
    source: options.source || 'cart',
    items,
    couponId: options.couponId || null,
    customMeta: options.customMeta || null,
    customExtraPrice: options.customExtraPrice || 0
  })
  wx.navigateTo({ url: '/subpackages/business/confirm-order/index' })
}

function navigateToCustomCheckout(customMeta, productItem) {
  if (!customMeta || !productItem) {
    wx.showToast({ title: '定制信息不完整', icon: 'none' })
    return
  }
  navigateToConfirmOrder([productItem], {
    source: 'custom',
    customMeta,
    customExtraPrice: customMeta.customExtraPrice || 0
  })
}

module.exports = {
  CHECKOUT_KEY,
  saveCheckoutPayload,
  consumeCheckoutPayload,
  navigateToConfirmOrder,
  navigateToCustomCheckout
}
