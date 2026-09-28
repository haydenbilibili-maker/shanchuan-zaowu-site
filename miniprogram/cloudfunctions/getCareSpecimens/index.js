/**
 * 标本养护 — 我的藏品 / 订单上下文（云函数侧，真机 openid 可靠）
 * action:
 *   list（默认）/ orderContext
 *   saveCertificate —— 证书首次签发后固化：签发时间 certMeta.issuedAt + 本人那一版证书图 fileID（之后打开直接展示，不再重绘）
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
const { isGiftOrder, resolveHolderOpenid, certIssuedAt, certKindOf } = require('./giftHolder')

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

async function queryReceived(where, cap) {
  try {
    const res = await db.collection('orders')
      .where(where)
      .orderBy('receiveTime', 'desc')
      .limit(cap)
      .get()
    return res.data || []
  } catch (err) {
    console.warn('getCareSpecimens orderBy fallback', err)
    const res = await db.collection('orders')
      .where(where)
      .limit(cap)
      .get()
    return res.data || []
  }
}

/**
 * 我的藏品 = 我持有的已签收订单（礼赠 2026-09-28）：
 * 自己下的非礼赠单（原口径）+ 我作为已绑定受礼人收到的礼赠；我送出的礼赠归受礼人，不在此列
 */
async function fetchReceivedOrders(openid, limit) {
  const cap = Math.min(Math.max(1, limit || 50), 50)
  const own = await queryReceived({ _openid: openid, status: 'received' }, cap)
  let gifted = []
  try {
    gifted = await queryReceived({ 'giftMeta.receiverOpenid': openid, status: 'received' }, cap)
  } catch (e) {
    console.warn('getCareSpecimens gifted query failed', e && e.message)
  }
  const seen = {}
  const rows = own.concat(gifted).filter((o) => {
    if (!o || seen[o._id]) return false
    seen[o._id] = true
    return !isGiftOrder(o) || resolveHolderOpenid(o) === openid
  })
  return rows.sort((a, b) => {
    const ta = pickReceiveTime(a)
    const tb = pickReceiveTime(b)
    return new Date(tb || 0).getTime() - new Date(ta || 0).getTime()
  }).slice(0, cap)
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
  // 下单人（原口径）或礼赠持有人（已绑定受礼人）可读养护上下文
  if (!order || (order._openid !== openid && !(isGiftOrder(order) && resolveHolderOpenid(order) === openid))) {
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

const CERT_KINDS = { holder: 1, gift_holder: 1, gift_voucher: 1 }

/**
 * 固化证书：只收「调用者自己的那一版」（普通单下单人=holder；礼赠受礼人=gift_holder；送礼人=gift_voucher）。
 * 签发时间首次写入后不再变（存量单取最接近的真实签收时间）；同 sig 重复保存幂等，sig 变了（如赠予凭证的状态）才覆盖。
 */
async function saveCertificate(openid, event) {
  const orderId = String(event.orderId || '').trim()
  const kind = String(event.kind || '')
  const fileID = String(event.fileID || '').trim()
  const sig = String(event.sig || '').slice(0, 160)
  if (!orderId || !CERT_KINDS[kind]) return { success: false, msg: '参数不完整' }
  if (!/^cloud:\/\//.test(fileID) || fileID.length > 512) return { success: false, msg: '证书文件无效' }

  const res = await db.collection('orders').doc(orderId).get().catch(() => ({ data: null }))
  const order = res && res.data
  if (!order || certKindOf(order, openid) !== kind) return { success: false, code: 'FORBIDDEN', msg: '无权签发此证书' }

  const cm = order.certMeta || {}
  const prev = cm[kind] || null
  if (prev && prev.openid === openid && prev.sig === sig && prev.fileID) {
    return { success: true, already: true, fileID: prev.fileID, issuedAt: certIssuedAt(order) }
  }
  const data = {}
  data[`certMeta.${kind}`] = { fileID, sig, openid, savedAt: db.serverDate() }
  let issuedAt = certIssuedAt(order)
  if (!cm.issuedAt) {
    data['certMeta.issuedAt'] = issuedAt ? new Date(issuedAt) : db.serverDate()
    if (!issuedAt) issuedAt = Date.now()
  }
  await db.collection('orders').doc(orderId).update({ data })
  return { success: true, fileID, issuedAt }
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
    if (action === 'saveCertificate') {
      return await saveCertificate(openid, event || {})
    }

    const data = await loadSpecimenList(openid, limit)
    return { success: true, data, total: data.length }
  } catch (e) {
    console.error('getCareSpecimens', e)
    return { success: false, msg: e.message || '加载失败', data: [] }
  }
}
