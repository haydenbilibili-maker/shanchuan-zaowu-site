/**
 * 标本养护 — 订单上下文解析（business 分包专用）
 */
const db = wx.cloud.database()
const {
  normalizeCategory,
  getGuideByCategory,
  getCategoryMeta,
  getCareSummary,
  isVoucherLikeProduct,
  buildGuideUrl
} = require('../../../utils/careDefaults')

async function resolveProductCategory(productId) {
  if (!productId) return 'GENERAL'
  try {
    const res = await db.collection('products').doc(productId).get()
    return normalizeCategory(res.data && res.data.category)
  } catch (e) {
    return 'GENERAL'
  }
}

async function resolveCareContext(order) {
  if (!order || !order.products || !order.products.length) {
    return { showCare: false }
  }

  if (order.source === 'exchange') {
    return { showCare: false }
  }

  const specimenProducts = order.products.filter((p) => !isVoucherLikeProduct(p))
  if (!specimenProducts.length) {
    return { showCare: false }
  }

  let category = 'GENERAL'
  let productTitle = specimenProducts[0].title || '您的藏品'
  let productId = specimenProducts[0].id || specimenProducts[0].productId || ''

  for (const p of specimenProducts) {
    if (p.category) {
      category = normalizeCategory(p.category)
      productTitle = p.title || productTitle
      productId = p.id || p.productId || productId
      break
    }
    const pid = p.id || p.productId
    if (pid) {
      const cat = await resolveProductCategory(pid)
      if (cat !== 'GENERAL') {
        category = cat
        productTitle = p.title || productTitle
        productId = pid
        break
      }
    }
  }

  if (category === 'GENERAL' && order.customMeta && order.customMeta.specimen) {
    category = normalizeCategory(order.customMeta.specimen.category)
    productTitle = order.customMeta.specimen.title || productTitle
  }

  const framingName = (order.customMeta && order.customMeta.frame && order.customMeta.frame.name) || ''
  const guide = getGuideByCategory(category)
  const meta = getCategoryMeta(category)

  return {
    showCare: true,
    category,
    productId,
    productTitle,
    framingName,
    categoryLabel: meta.label,
    categoryColor: meta.color,
    careSummary: getCareSummary(guide, framingName),
    guideUrl: buildGuideUrl({
      category,
      orderId: order._id,
      productId,
      from: 'order'
    })
  }
}

function showPostReceiptCareSheet(orderId, careContext) {
  const ctx = careContext || {}
  const url = ctx.guideUrl || buildGuideUrl({ orderId, category: ctx.category || 'GENERAL', from: 'receipt' })

  wx.showActionSheet({
    itemList: ['查看养护指南', '查看收藏证书', '稍后再说'],
    success: (res) => {
      if (res.tapIndex === 0) {
        wx.navigateTo({ url })
      } else if (res.tapIndex === 1) {
        wx.navigateTo({
          url: `/subpackages/business/certificate/index?id=${orderId}`,
          fail: () => wx.showToast({ title: '证书暂不可用', icon: 'none' })
        })
      }
    },
    fail: (err) => {
      if (err && err.errMsg && err.errMsg.indexOf('cancel') >= 0) return
      wx.navigateTo({ url: `/subpackages/business/order-detail/index?id=${orderId}` })
    }
  })
}

async function confirmReceiptOnOrder(orderId, orderSnapshot, options = {}) {
  const { prompt = true } = options
  await db.collection('orders').doc(orderId).update({
    data: {
      status: 'received',
      receiveTime: db.serverDate()
    }
  })

  let order = orderSnapshot
  if (!order || !order.products) {
    try {
      const res = await db.collection('orders').doc(orderId).get()
      order = res.data
    } catch (e) {
      order = { _id: orderId, products: [] }
    }
  }

  const careContext = await resolveCareContext({ ...order, _id: orderId, status: 'received' })

  if (orderSnapshot && orderSnapshot._openid) {
    const orderNo = orderSnapshot.orderNo || order.orderNo || ''
    const careNote = careContext.showCare
      ? `三天后将提醒您查看「${careContext.productTitle}」养护指南`
      : '欢迎评价这次收藏体验'
    wx.cloud.callFunction({
      name: 'dispatchMessage',
      data: {
        action: 'dispatch',
        eventType: 'order_received',
        openid: orderSnapshot._openid,
        relatedId: orderId,
        vars: { orderNo, careNote }
      }
    }).catch((err) => console.warn('order_received message failed:', err))

    if (careContext.showCare) {
      wx.cloud.callFunction({
        name: 'sendCareReminder',
        data: {
          action: 'schedule',
          orderId,
          openid: orderSnapshot._openid,
          category: careContext.category,
          productId: careContext.productId,
          productTitle: careContext.productTitle,
          orderNo,
          careSummary: careContext.careSummary,
          categoryLabel: careContext.categoryLabel
        }
      }).catch((err) => console.warn('schedule care reminder failed:', err))
    }
  }

  if (prompt) {
    try { wx.hideLoading() } catch (e) { /* ignore */ }
    setTimeout(() => {
      if (careContext.showCare) {
        showPostReceiptCareSheet(orderId, careContext)
      } else {
        wx.showToast({ title: '已签收', icon: 'success' })
      }
    }, 80)
  }

  return careContext
}

module.exports = {
  resolveCareContext,
  resolveProductCategory,
  showPostReceiptCareSheet,
  confirmReceiptOnOrder
}
