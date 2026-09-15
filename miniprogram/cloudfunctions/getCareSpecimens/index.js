/**
 * 标本养护 — 我的藏品 / 订单上下文（云函数侧，真机 openid 可靠）
 */
const cloud = require('wx-server-sdk')
const {
  resolveCareCategory,
  CARE_CATEGORY_FIELDS,
  getCategoryMeta,
  getGuideByCategory,
  getCareSummary,
  isVoucherLikeProduct
} = require('./defaults')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

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

/** 早期订单快照未落 category/rootCategoryName，需回查 products 才能归类 */
function lacksCategorySignal(product) {
  if (!product) return true
  return !CARE_CATEGORY_FIELDS.some((key) => product[key])
}

async function loadProductCategoryMap(ids) {
  const map = {}
  const unique = [...new Set(ids.filter(Boolean))]
  if (!unique.length) return map
  const CHUNK = 20
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK)
    try {
      const res = await db.collection('products')
        .where({ _id: _.in(chunk) })
        .field({
          category: true,
          categoryName: true,
          categoryId: true,
          rootCategoryName: true,
          rootCategoryId: true,
          careCategory: true
        })
        .get()
      ;(res.data || []).forEach((p) => { map[p._id] = p })
    } catch (err) {
      console.warn('getCareSpecimens loadProductCategoryMap', err)
    }
  }
  return map
}

async function buildSpecimenList(orders, limit) {
  const picked = []
  for (const order of orders) {
    const products = (order.products || []).filter((p) => !isVoucherLikeProduct(p))
    for (let i = 0; i < products.length; i += 1) {
      if (picked.length >= limit) break
      picked.push({ order, product: products[i], index: i })
    }
    if (picked.length >= limit) break
  }

  const needBackfill = picked.filter((x) => lacksCategorySignal(x.product))
  if (needBackfill.length) {
    const categoryMap = await loadProductCategoryMap(
      needBackfill.map((x) => x.product.id || x.product.productId)
    )
    needBackfill.forEach((x) => {
      const doc = categoryMap[x.product.id || x.product.productId]
      if (!doc) return
      const patch = {}
      CARE_CATEGORY_FIELDS.forEach((key) => {
        if (doc[key]) patch[key] = doc[key]
      })
      x.product = { ...x.product, ...patch }
    })
  }

  return picked.map((x) => buildSpecimenItem(x.order, x.product, x.index))
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
      ? resolveCareCategory(order.customMeta.specimen)
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
