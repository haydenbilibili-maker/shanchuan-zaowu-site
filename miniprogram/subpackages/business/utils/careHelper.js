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
const { resolveCertRole } = require('./giftHolder')

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
  let url = `/subpackages/content/comment/index?targetType=product&orderId=${encodeURIComponent(orderId || '')}`
  if (productId) url += `&targetId=${encodeURIComponent(productId)}`
  return url
}

/** giverView：礼赠送礼人代点签收 —— 只给「赠予凭证」，养护与收藏证书归受礼人 */
function showPostReceiptCareSheet(orderId, careContext, giverView) {
  const ctx = careContext || {}
  const url = ctx.guideUrl || buildGuideUrl({ orderId, category: ctx.category || 'GENERAL', from: 'receipt' })
  const certUrl = `/subpackages/business/certificate/index?id=${orderId}`
  const entries = [{ label: '写一条评价', url: buildCommentUrl(orderId, ctx), failTitle: '无法打开评价页' }]
  if (giverView) {
    entries.push({ label: '查看赠予凭证', url: certUrl, failTitle: '证书暂不可用' })
  } else {
    entries.push({ label: '查看养护指南', url, failTitle: '无法打开养护指南' })
    entries.push({ label: '查看收藏证书', url: certUrl, failTitle: '证书暂不可用' })
  }

  wx.showActionSheet({
    itemList: entries.map((e) => e.label).concat('稍后再说'),
    success: (res) => {
      const entry = entries[res.tapIndex]
      if (!entry) return
      wx.navigateTo({
        url: entry.url,
        fail: () => wx.showToast({ title: entry.failTitle, icon: 'none' })
      })
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
      const app = getApp()
      const viewer = (app && app.globalData && app.globalData.openid) || ''
      const giverView = resolveCertRole({ ...order, status: 'received' }, viewer) === 'giver'
      if (careContext.showCare || giverView) {
        showPostReceiptCareSheet(orderId, careContext, giverView)
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
