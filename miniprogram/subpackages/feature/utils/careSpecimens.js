/**
 * 标本养护 — 从已签收订单聚合「我的藏品」
 */
const { ensureOpenId } = require('../../../utils/orderScope')
const {
  resolveCareCategory,
  getCategoryMeta,
  getGuideByCategory,
  getCareSummary,
  isVoucherLikeProduct
} = require('./careDefaults')

function formatReceiveTime(ts) {
  if (!ts) return ''
  const d = ts instanceof Date ? ts : new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}.${m}.${day}`
}

function pickReceiveTime(order) {
  if (!order) return null
  if (order.receiveTime) return order.receiveTime
  if (order.updateTime) return order.updateTime
  if (order.createTime) return order.createTime
  return null
}

function buildSpecimenItem(order, product, index) {
  let category = resolveCareCategory(product)
  if (category === 'GENERAL' && order.customMeta && order.customMeta.specimen) {
    category = resolveCareCategory(order.customMeta.specimen)
  }
  const meta = getCategoryMeta(category)
  const framingName = (order.customMeta && order.customMeta.frame && order.customMeta.frame.name) || ''
  const guide = getGuideByCategory(category)
  const receiveTs = pickReceiveTime(order)

  return {
    key: `${order._id}_${index}`,
    orderId: order._id,
    orderNo: order.orderNo || '',
    productId: product.id || product.productId || '',
    title: product.title || '藏品',
    image: product.image || '',
    category,
    categoryLabel: meta.label,
    categoryColor: meta.color,
    categoryOverline: meta.overline,
    framingName,
    isCustom: !!(order.customMeta && order.customMeta.isCustom),
    careSummary: getCareSummary(guide, framingName),
    receiveTimeText: formatReceiveTime(receiveTs)
  }
}

function giftReceiverOf(order) {
  return (order && order.giftMeta && order.giftMeta.receiverOpenid) || ''
}

function isHeldGiftElsewhere(order, openid) {
  const gift = !!(order && (order.source === 'gift' || order.giftMeta))
  return gift && giftReceiverOf(order) !== openid
}

async function loadUserSpecimensClient(app, options = {}) {
  const limit = options.limit || 50
  const openid = await ensureOpenId(app)
  if (!openid) return []
  const baseWhere = { _openid: openid, status: 'received' }

  let orders = []
  try {
    const res = await wx.cloud.database().collection('orders')
      .where(baseWhere)
      .orderBy('receiveTime', 'desc')
      .limit(Math.min(limit, 20))
      .get()
    orders = res.data || []
  } catch (orderErr) {
    console.warn('loadUserSpecimens client orderBy fallback', orderErr)
    try {
      const res = await wx.cloud.database().collection('orders')
        .where(baseWhere)
        .limit(Math.min(limit, 20))
        .get()
      orders = (res.data || []).sort((a, b) => {
        const ta = pickReceiveTime(a)
        const tb = pickReceiveTime(b)
        return new Date(tb || 0).getTime() - new Date(ta || 0).getTime()
      })
    } catch (e) {
      console.warn('loadUserSpecimens client failed', e)
      return []
    }
  }

  const list = []
  for (const order of orders) {
    // 送出的礼赠归受礼人持有（与 getCareSpecimens 同口径）
    if (isHeldGiftElsewhere(order, openid)) continue
    const products = (order.products || []).filter((p) => !isVoucherLikeProduct(p))
    products.forEach((p, i) => {
      if (list.length >= limit) return
      list.push(buildSpecimenItem(order, p, i))
    })
  }
  return list
}

async function loadUserSpecimens(app, options = {}) {
  const limit = options.limit || 50

  try {
    const res = await wx.cloud.callFunction({
      name: 'getCareSpecimens',
      data: { action: 'list', limit }
    })
    const payload = res.result || {}
    if (payload.success && Array.isArray(payload.data)) {
      return payload.data
    }
  } catch (e) {
    console.warn('getCareSpecimens unavailable, client fallback', e)
  }

  return loadUserSpecimensClient(app, options)
}

async function loadCareOrderContext(app, orderId, productId) {
  try {
    const res = await wx.cloud.callFunction({
      name: 'getCareSpecimens',
      data: { action: 'orderContext', orderId, productId }
    })
    const payload = res.result || {}
    if (payload.success) return payload
  } catch (e) {
    console.warn('getCareSpecimens orderContext fallback', e)
  }

  const openid = await ensureOpenId(app)
  if (!openid) return { success: false }

  try {
    const res = await wx.cloud.database().collection('orders').doc(orderId).get()
    const order = res.data
    if (!order || (order._openid !== openid && giftReceiverOf(order) !== openid)) return { success: false, msg: '无权查看' }

    let contextTitle = ''
    const framingName = (order.customMeta && order.customMeta.frame && order.customMeta.frame.name) || ''
    if (productId && order.products) {
      const p = order.products.find((x) => (x.id || x.productId) === productId)
      if (p) contextTitle = p.title || ''
    }
    if (!contextTitle && order.products && order.products[0]) {
      contextTitle = order.products[0].title || ''
    }
    if (!contextTitle && order.customMeta && order.customMeta.specimen) {
      contextTitle = order.customMeta.specimen.title || ''
    }

    return {
      success: true,
      contextTitle,
      framingName,
      isCustom: !!(order.customMeta && order.customMeta.isCustom),
      customCategory: order.customMeta && order.customMeta.specimen
        ? resolveCareCategory(order.customMeta.specimen)
        : ''
    }
  } catch (e) {
    console.warn('loadCareOrderContext client failed', e)
    return { success: false }
  }
}

module.exports = {
  formatReceiveTime,
  buildSpecimenItem,
  loadUserSpecimens,
  loadCareOrderContext
}
