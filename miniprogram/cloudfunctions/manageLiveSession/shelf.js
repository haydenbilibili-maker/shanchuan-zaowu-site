/**
 * 直播挂车：从 products 组装摘要；挂车 id 存 live_sessions.shelfProductIds
 */
const SHELF_MAX = 20

function normalizeProductIds(raw) {
  const list = Array.isArray(raw) ? raw : []
  const out = []
  const seen = new Set()
  list.forEach((id) => {
    const s = String(id || '').trim()
    if (!s || seen.has(s)) return
    seen.add(s)
    out.push(s)
  })
  return out.slice(0, SHELF_MAX)
}

function moveProductId(ids, productId, dir) {
  const list = normalizeProductIds(ids)
  const id = String(productId || '').trim()
  const idx = list.indexOf(id)
  if (idx < 0) return list
  const delta = dir === 'down' || dir === 1 ? 1 : -1
  const next = idx + delta
  if (next < 0 || next >= list.length) return list
  const copy = list.slice()
  const tmp = copy[idx]
  copy[idx] = copy[next]
  copy[next] = tmp
  return copy
}

function firstImage(images) {
  if (!Array.isArray(images) || !images.length) return ''
  const first = images[0]
  if (typeof first === 'string') return first
  if (first && typeof first === 'object') {
    return first.url || first.fileID || first.src || ''
  }
  return ''
}

function stockOf(product) {
  if (!product) return 0
  if (product.hasSku && Array.isArray(product.skus) && product.skus.length) {
    return product.skus.reduce((sum, sku) => sum + (parseInt(sku && sku.stock, 10) || 0), 0)
  }
  return Math.max(0, parseInt(product.stock, 10) || 0)
}

function priceOf(product) {
  if (!product) return 0
  if (product.hasSku && Array.isArray(product.skus) && product.skus.length) {
    const prices = product.skus
      .map((s) => Number(s && s.price))
      .filter((n) => Number.isFinite(n) && n >= 0)
    if (prices.length) return Math.min(...prices)
  }
  const n = Number(product.price)
  return Number.isFinite(n) ? n : 0
}

function emptyShelf(purchasable) {
  return {
    items: [],
    spotlightProductId: '',
    count: 0,
    purchasable: !!purchasable,
    updatedAt: 0
  }
}

function summarizeProduct(product, spotlightId) {
  if (!product || !product._id) return null
  const stock = stockOf(product)
  const onShelf = product.isOffShelf !== true
  const soldOut = stock <= 0
  const hasSku = !!(product.hasSku && Array.isArray(product.skus) && product.skus.length)
  const cover = firstImage(product.images)
  const price = priceOf(product)
  const missingCover = !cover
  const missingPrice = !(Number.isFinite(price) && price > 0)
  const skus = hasSku
    ? product.skus.slice(0, 40).map((s) => ({
      id: String((s && (s.id || s._id || s.skuId)) || ''),
      price: Number(s && s.price) || 0,
      stock: Math.max(0, parseInt(s && s.stock, 10) || 0),
      specLabel: String((s && (s.specLabel || s.label || s.name)) || '').slice(0, 48),
      image: (s && (s.image || s.cover)) || ''
    })).filter((s) => s.id)
    : []
  return {
    _id: product._id,
    title: String(product.title || '未命名藏品').slice(0, 48),
    price,
    priceLabel: missingPrice ? '价格待核' : `¥${price}${hasSku ? ' 起' : ''}`,
    cover,
    missingCover,
    missingPrice,
    stock,
    onShelf,
    soldOut,
    hasSku,
    skus,
    skuDimensions: Array.isArray(product.skuDimensions)
      ? product.skuDimensions.slice(0, 6).map((d) => String(d || '').slice(0, 24)).filter(Boolean)
      : [],
    isTreasure: !!product.isTreasure,
    isUnique: !!(product.isUnique || product.isOneOfAKind),
    latinName: product.latinName || '',
    memberDiscountEnabled: product.memberDiscountEnabled !== false,
    categoryType: product.categoryType || '',
    // 运费 v2（蓝图 §19）：直播挂车下单也要带 craftType，
    // 否则确认页会按「未标注 = 免邮」显示、而 makeOrder 按收费类实收（页面显示 ≠ 实际收钱）
    craftType: product.craftType || '',
    shippingKind: product.shippingKind || '',
    spotlight: String(spotlightId || '') === String(product._id),
    buyable: onShelf && !soldOut
  }
}

/**
 * @param {object} db cloud.database()
 * @param {object} doc live_sessions doc
 * @param {{ purchasable?: boolean }} opts
 */
async function buildShelfSummary(db, doc, opts) {
  const purchasable = !!(opts && opts.purchasable)
  const ids = normalizeProductIds(doc && doc.shelfProductIds)
  const spotlightProductId = String((doc && doc.spotlightProductId) || '').trim()
  const updatedAt = Number((doc && doc.shelfUpdatedAt) || 0) || 0
  if (!ids.length) {
    return {
      ...emptyShelf(purchasable),
      spotlightProductId: ids.includes(spotlightProductId) ? spotlightProductId : '',
      updatedAt
    }
  }

  const byId = {}
  try {
    const _ = db.command
    // 云开发 where _id in 一次最多约 20
    const res = await db.collection('products').where({ _id: _.in(ids) }).limit(SHELF_MAX).get()
    ;(res.data || []).forEach((p) => {
      if (p && p._id) byId[p._id] = p
    })
  } catch (e) {
    // 逐条兜底
    await Promise.all(
      ids.map(async (id) => {
        try {
          const got = await db.collection('products').doc(id).get()
          if (got.data) byId[id] = got.data
        } catch (err) { /* skip */ }
      })
    )
  }

  const spot = ids.includes(spotlightProductId) ? spotlightProductId : ''
  const items = ids
    .map((id) => summarizeProduct(byId[id], spot))
    .filter(Boolean)

  return {
    items,
    spotlightProductId: spot,
    count: items.length,
    purchasable,
    updatedAt
  }
}

module.exports = {
  SHELF_MAX,
  normalizeProductIds,
  moveProductId,
  emptyShelf,
  buildShelfSummary,
  summarizeProduct
}
