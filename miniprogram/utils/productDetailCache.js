/**
 * 商品详情 SWR 缓存：列表预填 + 短 TTL 关键字段（价/库存）静默刷新。
 * 键：sc_cache_PRODUCT_DETAIL_{id}
 */

const { peekCache, setCache, invalidate, TTL, STALE_WINDOW } = require('./cache')

const KEY_PREFIX = 'PRODUCT_DETAIL_'

/** 完整详情 fresh 窗口：库存/价格以服务端为准，宜短 */
const DETAIL_TTL = TTL.DETAIL // 60s
/** 过期后仍可先展示，再后台刷新 */
const DETAIL_STALE = STALE_WINDOW.DETAIL // 10min
/** 列表卡片预填：仅作瞬时首屏 */
const PREVIEW_TTL = 2 * 60 * 1000

function productDetailKey(id) {
  const pid = String(id || '').trim()
  return pid ? KEY_PREFIX + pid : ''
}

function isPartialPayload(data) {
  return !!(data && data._cacheMeta && data._cacheMeta.partial)
}

function normalizeImages(item) {
  if (!item) return []
  if (Array.isArray(item.images) && item.images.length) {
    return item.images.filter(Boolean)
  }
  const one = item.displayImage || item.coverImage || item.image || item.cover || ''
  return one ? [one] : []
}

/**
 * 从列表/卡片构造可首屏渲染的预览（不冒充完整档案）
 */
function buildPreviewFromListItem(item) {
  if (!item || typeof item !== 'object') return null
  const id = String(item._id || item.id || '').trim()
  if (!id) return null
  const images = normalizeImages(item)
  const price = item.price != null
    ? item.price
    : (item.displayPrice != null ? item.displayPrice : null)
  const stock = item.stock != null
    ? item.stock
    : (item.displayStock != null ? item.displayStock : null)
  return {
    _id: id,
    title: item.title || item.name || '',
    latinName: item.latinName || item.latin || item.scientificName || '',
    category: item.category || '',
    images,
    price,
    stock,
    soldOut: item.soldOut === true,
    skus: Array.isArray(item.skus) ? item.skus : undefined,
    isOneOfAKind: !!(item.isOneOfAKind || item.isUnique),
    isUnique: !!(item.isUnique || item.isOneOfAKind),
    isTreasure: !!item.isTreasure,
    protectionType: item.protectionType || 'none',
    giftEligible: item.giftEligible,
    depositEligible: item.depositEligible,
    craftType: item.craftType,
    craftProcess: item.craftProcess,
    origin: item.origin,
    size: item.size,
    framerName: item.framerName,
    framerId: item.framerId,
    _cacheMeta: { partial: true, seededAt: Date.now() }
  }
}

function peekProductDetail(id) {
  const key = productDetailKey(id)
  if (!key) return null
  return peekCache(key, { staleMs: DETAIL_STALE })
}

function setProductDetail(id, data, options) {
  const key = productDetailKey(id)
  if (!key || data == null) return false
  const opts = options || {}
  let expiry = opts.expiry
  if (expiry == null) {
    expiry = isPartialPayload(data) ? PREVIEW_TTL : DETAIL_TTL
  }
  return setCache(key, data, expiry)
}

/**
 * 列表进详情预填：有完整 fresh 缓存时不覆盖
 */
function seedProductPreview(item) {
  const preview = buildPreviewFromListItem(item)
  if (!preview) return false
  const peeked = peekProductDetail(preview._id)
  if (peeked && peeked.data && !isPartialPayload(peeked.data)) {
    return false
  }
  return setProductDetail(preview._id, preview, { expiry: PREVIEW_TTL })
}

function invalidateProductDetail(id) {
  if (id) {
    const key = productDetailKey(id)
    if (key) invalidate(key)
    return
  }
  invalidate('PRODUCT_DETAIL_*')
}

/**
 * 是否需要在下单前强制拉最新库存/价格
 */
function needsCriticalRefresh(id) {
  const peeked = peekProductDetail(id)
  if (!peeked || !peeked.data) return true
  if (isPartialPayload(peeked.data)) return true
  return !peeked.fresh
}

module.exports = {
  productDetailKey,
  peekProductDetail,
  setProductDetail,
  seedProductPreview,
  buildPreviewFromListItem,
  invalidateProductDetail,
  isPartialPayload,
  needsCriticalRefresh,
  DETAIL_TTL,
  DETAIL_STALE,
  PREVIEW_TTL,
  KEY_PREFIX
}
