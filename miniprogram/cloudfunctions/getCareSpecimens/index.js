/**
 * 标本养护 — 我的藏品 / 订单上下文（云函数侧，真机 openid 可靠）
 */
const cloud = require('wx-server-sdk')
const {
  normalizeCategory,
  getCategoryMeta,
  getGuideByCategory,
  getCareSummary,
  isVoucherLikeProduct
} = require('../getCareGuides/defaults')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

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
  return order.receiveTime || order.updateTime || order.createTime || null
}

function buildSpecimenItem(order, product, index) {
  let category = normalizeCategory(product.category)
  if (category === 'GENERAL' && order.customMeta && order.customMeta.specimen) {
    category = normalizeCategory(order.customMeta.specimen.category)
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

async function fetchReceivedOrders(openid, limit) {
  const cap = Math.min(Math.max(1, limit || 50), 50)
  try {
    const res = await db.collection('orders')
      .where({ _openid: openid, status: 'received' })
      .orderBy('receiveTime', 'desc')
      .limit(cap)
      .get()
    return res.data || []
  } catch (err) {
    console.warn('getCareSpecimens orderBy fallback', err)
    const res = await db.collection('orders')
      .where({ _openid: openid, status: 'received' })
      .limit(cap)
      .get()
    return (res.data || []).sort((a, b) => {
      const ta = pickReceiveTime(a)
      const tb = pickReceiveTime(b)
      return new Date(tb || 0).getTime() - new Date(ta || 0).getTime()
    })
  }
}

function buildSpecimenList(orders, limit) {
  const list = []
  for (const order of orders) {
    const products = (order.products || []).filter((p) => !isVoucherLikeProduct(p))
    products.forEach((p, i) => {
      if (list.length >= limit) return
      list.push(buildSpecimenItem(order, p, i))
    })
  }
  return list
}

async function loadSpecimenList(openid, limit) {
  const orders = await fetchReceivedOrders(openid, limit)
  return buildSpecimenList(orders, limit)
}

async function loadOrderContext(openid, orderId, productId) {
  const res = await db.collection('orders').doc(orderId).get()
  const order = res.data
  if (!order || order._openid !== openid) {
    return { success: false, msg: '无权查看' }
  }

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
      ? normalizeCategory(order.customMeta.specimen.category)
      : ''
  }
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const { action = 'list', limit = 50, orderId = '', productId = '' } = event || {}

  if (!openid) {
    return { success: false, msg: '未登录', data: [] }
  }

  try {
    if (action === 'orderContext') {
      if (!orderId) return { success: false, msg: '缺少 orderId' }
      return loadOrderContext(openid, orderId, productId)
    }

    const data = await loadSpecimenList(openid, limit)
    return { success: true, data, total: data.length }
  } catch (e) {
    console.error('getCareSpecimens', e)
    return { success: false, msg: e.message || '加载失败', data: [] }
  }
}
