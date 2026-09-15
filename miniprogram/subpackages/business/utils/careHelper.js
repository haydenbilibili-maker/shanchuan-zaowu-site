/**
 * 标本养护 — 订单上下文解析（business 分包专用）
 */
const db = wx.cloud.database()
const {
  resolveCareCategory,
  CARE_CATEGORY_FIELDS,
  getGuideByCategory,
  getCategoryMeta,
  getCareSummary,
  isVoucherLikeProduct,
  buildGuideUrl
} = require('./careDefaults')

async function resolveProductCategory(productId) {
  if (!productId) return 'GENERAL'
  try {
    const res = await db.collection('products').doc(productId).get()
    return resolveCareCategory(res.data)
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
    if (CARE_CATEGORY_FIELDS.some((key) => p[key])) {
      category = resolveCareCategory(p)
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
    category = resolveCareCategory(order.customMeta.specimen)
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

function buildCommentUrl(orderId, careContext) {
  const ctx = careContext || {}
  const productId = ctx.productId || ''
  let url = `/subpackages/feature/comment/index?targetType=product&orderId=${encodeURIComponent(orderId || '')}`
  if (productId) url += `&targetId=${encodeURIComponent(productId)}`
  return url
}

function showPostReceiptCareSheet(orderId, careContext) {
  const ctx = careContext || {}
  const url = ctx.guideUrl || buildGuideUrl({ orderId, category: ctx.category || 'GENERAL', from: 'receipt' })
  const commentUrl = buildCommentUrl(orderId, ctx)

  wx.showActionSheet({
    itemList: ['写一条评价', '查看养护指南', '查看收藏证书', '稍后再说'],
    success: (res) => {
      if (res.tapIndex === 0) {
        wx.navigateTo({
          url: commentUrl,
          fail: () => wx.showToast({ title: '无法打开评价页', icon: 'none' })
        })
      } else if (res.tapIndex === 1) {
        wx.navigateTo({
          url,
          fail: () => wx.showToast({ title: '无法打开养护指南', icon: 'none' })
        })
      } else if (res.tapIndex === 2) {
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

  // orders 集合 write:false — 必须经云函数写状态
  const call = await wx.cloud.callFunction({
    name: 'confirmOrderReceipt',
    data: { orderId }
  })
  const result = (call && call.result) || {}
  if (!result.success) {
    throw new Error(result.msg || '确认收货失败')
  }

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
  const buyerOpenid = (orderSnapshot && orderSnapshot._openid) || (order && order._openid) || ''
  // 确认收货赠分结果（云函数 best-effort 返回，供页面提示）
  careContext.pointsGranted = Number(result.pointsGranted) || 0
  careContext.pointsMsg = result.pointsMsg || ''

  if (buyerOpenid && careContext.showCare) {
    const orderNo = (orderSnapshot && orderSnapshot.orderNo) || order.orderNo || result.orderNo || ''
    wx.cloud.callFunction({
      name: 'sendCareReminder',
      data: {
        action: 'schedule',
        orderId,
        openid: buyerOpenid,
        category: careContext.category,
        productId: careContext.productId,
        productTitle: careContext.productTitle,
        orderNo,
        careSummary: careContext.careSummary,
        categoryLabel: careContext.categoryLabel
      }
    }).catch((err) => console.warn('schedule care reminder failed:', err))
  }

  if (prompt) {
    try { wx.hideLoading() } catch (e) { /* ignore */ }
    setTimeout(() => {
      if (careContext.showCare) {
        showPostReceiptCareSheet(orderId, careContext)
      } else {
        // 无养护上下文时，仍引导评价
        wx.showActionSheet({
          itemList: ['写一条评价', '稍后再说'],
          success: (res) => {
            if (res.tapIndex === 0) {
              wx.navigateTo({
                url: buildCommentUrl(orderId, careContext),
                fail: () => wx.showToast({ title: '无法打开评价页', icon: 'none' })
              })
            }
          },
          fail: () => wx.showToast({ title: '已签收', icon: 'success' })
        })
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
