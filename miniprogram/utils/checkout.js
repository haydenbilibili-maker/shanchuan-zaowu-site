const CHECKOUT_KEY = 'checkoutPayload'

function saveCheckoutPayload(payload) {
  wx.setStorageSync(CHECKOUT_KEY, payload)
}

function peekCheckoutPayload() {
  try {
    return wx.getStorageSync(CHECKOUT_KEY) || null
  } catch (e) {
    return null
  }
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
    wx.showToast({ title: '请选择藏品', icon: 'none' })
    return
  }
  const validItems = items.filter((item) => item && item.productId)
  if (!validItems.length) {
    wx.showToast({ title: '藏品信息异常', icon: 'none' })
    return
  }
  saveCheckoutPayload({
    source: options.source || 'cart',
    items: validItems,
    couponId: options.couponId || null,
    customMeta: options.customMeta || null,
    customExtraPrice: options.customExtraPrice || 0,
    // 礼赠编排半接通：确认页暂忽略，下刀履约时消费
    giftMeta: options.giftMeta || null,
    depositIntentId: options.depositIntentId || null
  })
  wx.navigateTo({
    url: '/subpackages/business/confirm-order/index',
    fail: () => wx.showToast({ title: '无法进入结算', icon: 'none' })
  })
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
  peekCheckoutPayload,
  consumeCheckoutPayload,
  navigateToConfirmOrder,
  navigateToCustomCheckout
}
