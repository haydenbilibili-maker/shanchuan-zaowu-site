/**
 * 购物车列表 — 云函数侧读取，避免真机 openid / 数据库权限 / 索引差异
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const CART_TYPES = ['product', 'activity', 'course']

function isCartItem(item) {
  if (!item || item.type === 'wishlist') return false
  if (!item.type || CART_TYPES.includes(item.type)) return true
  return false
}

function filterByFolder(list, folder) {
  if (folder === 'all') return list.filter(isCartItem)
  if (folder === 'product') {
    return list.filter((i) => !i.type || i.type === 'product')
  }
  if (folder === 'activity' || folder === 'course') {
    return list.filter((i) => i.type === folder)
  }
  return list.filter((i) => i.folderId === folder)
}

function sortByCreateTime(list) {
  return list.slice().sort((a, b) => {
    const ta = a.createTime ? new Date(a.createTime).getTime() : 0
    const tb = b.createTime ? new Date(b.createTime).getTime() : 0
    return tb - ta
  })
}

async function fetchUserCollections(openid) {
  try {
    const res = await db.collection('collections')
      .where({ _openid: openid })
      .orderBy('createTime', 'desc')
      .limit(100)
      .get()
    return res.data || []
  } catch (err) {
    console.warn('getCartList orderBy fallback', err)
    const res = await db.collection('collections')
      .where({ _openid: openid })
      .limit(100)
      .get()
    return sortByCreateTime(res.data || [])
  }
}

async function fetchProductMap(productIds) {
  const map = {}
  const ids = [...new Set(productIds.filter(Boolean))]
  for (let i = 0; i < ids.length; i += 20) {
    const chunk = ids.slice(i, i + 20)
    const res = await db.collection('products')
      .where({ _id: _.in(chunk) })
      .field({ _id: true, stock: true, hasSku: true, skus: true, price: true, title: true })
      .get()
    ;(res.data || []).forEach((p) => { map[p._id] = p })
  }
  return map
}

function enrichList(list, productMap) {
  const hasProducts = Object.keys(productMap).length > 0
  return list.map((item) => {
    const row = { ...item }
    const p = productMap[item.productId]
    row.invalid = false
    row.invalidReason = ''

    if (!p) {
      if (hasProducts) {
        row.invalid = true
        row.invalidReason = '商品已下架'
        row.stock = 0
      } else {
        row.stock = parseInt(row.stock, 10)
        if (Number.isNaN(row.stock) || row.stock <= 0) row.stock = 99
        row.invalid = false
      }
    } else if (p.hasSku && item.skuId && Array.isArray(p.skus)) {
      const sku = p.skus.find((s) => s.id === item.skuId)
      if (!sku) {
        row.invalid = true
        row.invalidReason = '规格已失效'
        row.stock = 0
      } else {
        row.stock = parseInt(sku.stock, 10) || 0
        if (sku.price != null) row.price = sku.price
        if (sku.specLabel) row.skuLabel = sku.specLabel
      }
    } else if (p.hasSku && item.skuId) {
      row.invalid = true
      row.invalidReason = '规格已失效'
      row.stock = 0
    } else {
      row.stock = parseInt(p.stock, 10) || 0
      if (p.price != null) row.price = p.price
    }

    if (!row.count) row.count = 1
    row.selected = false
    row.id = row._id || row.productId
    row.isTouchMove = false
    return row
  })
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const { folder = 'all', action = 'list' } = event || {}

  if (!openid) {
    return { success: false, msg: '未登录', data: [], total: 0 }
  }

  try {
    const raw = await fetchUserCollections(openid)
    const filtered = filterByFolder(raw, folder)

    if (action === 'count') {
      const allCart = filterByFolder(raw, 'all')
      return { success: true, total: allCart.length }
    }

    let list = filtered
    if (list.length > 0) {
      try {
        const productMap = await fetchProductMap(list.map((i) => i.productId))
        list = enrichList(list, productMap)
      } catch (enrichErr) {
        console.warn('getCartList enrich failed', enrichErr)
        list = enrichList(list, {})
      }
    }

    const invalidCount = list.filter((i) => i.invalid).length
    return { success: true, data: list, invalidCount, total: list.length }
  } catch (e) {
    console.error('getCartList', e)
    return { success: false, msg: e.message || '加载失败', data: [], total: 0 }
  }
}
