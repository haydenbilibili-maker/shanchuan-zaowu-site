/**
 * 商品 SKU 工具（客户端）
 * product.skus = [{ id, specLabel, specs?, price, stock, image? }]
 * product.skuDimensions = ['尺寸', '装裱']  // 可选，多维度规格
 */

function hasSkus(product) {
  return !!(product && product.hasSku && Array.isArray(product.skus) && product.skus.length > 0)
}

function getSkuList(product) {
  if (!hasSkus(product)) return []
  return product.skus.filter((s) => s && s.id)
}

function getSkuDimensions(product) {
  if (!hasSkus(product)) return []
  if (Array.isArray(product.skuDimensions) && product.skuDimensions.length) {
    return product.skuDimensions
  }
  const first = getSkuList(product)[0]
  if (first && first.specs && typeof first.specs === 'object') {
    return Object.keys(first.specs)
  }
  return ['规格']
}

function isMultiDimension(product) {
  return getSkuDimensions(product).length > 1
}

function findSku(product, skuId) {
  if (!skuId || !hasSkus(product)) return null
  return product.skus.find((s) => s.id === skuId) || null
}

function resolveSkuFromSpecs(product, selectedSpecs) {
  const skus = getSkuList(product)
  if (!skus.length) return null
  const keys = Object.keys(selectedSpecs || {})
  if (!keys.length) return null

  return skus.find((sku) => {
    const specs = sku.specs || {}
    if (keys.length === 1 && keys[0] === '规格' && !sku.specs) {
      return sku.specLabel === selectedSpecs['规格']
    }
    return keys.every((k) => specs[k] === selectedSpecs[k])
  }) || null
}

function getDimensionValues(product, dimName, selectedSpecs = {}) {
  const skus = getSkuList(product)
  const values = new Set()

  skus.forEach((sku) => {
    const specs = sku.specs || {}
    const matchOthers = Object.keys(selectedSpecs).every((k) => {
      if (k === dimName) return true
      if (!sku.specs) return sku.specLabel === selectedSpecs[k]
      return specs[k] === selectedSpecs[k]
    })
    if (!matchOthers) return

    const val = specs[dimName] || (dimName === '规格' ? sku.specLabel : '')
    if (val) values.add(val)
  })

  return Array.from(values)
}

function isDimensionValueAvailable(product, dimName, value, selectedSpecs = {}) {
  const trial = { ...selectedSpecs, [dimName]: value }
  return getSkuList(product).some((sku) => {
    const specs = sku.specs || {}
    const stock = parseInt(sku.stock, 10) || 0
    if (stock <= 0) return false
    if (!sku.specs && dimName === '规格') {
      return sku.specLabel === value
    }
    return Object.keys(trial).every((k) => specs[k] === trial[k])
  })
}

function getDisplayPrice(product) {
  if (!product) return 0
  const skus = getSkuList(product)
  if (skus.length) {
    const prices = skus.map((s) => parseFloat(s.price) || 0).filter((p) => p > 0)
    return prices.length ? Math.min(...prices) : parseFloat(product.price) || 0
  }
  return parseFloat(product.price) || 0
}

function getDisplayPriceLabel(product) {
  const price = getDisplayPrice(product)
  if (hasSkus(product) && getSkuList(product).length > 1) {
    return `${price}起`
  }
  return String(price)
}

function getTotalStock(product) {
  if (!product) return 0
  const skus = getSkuList(product)
  if (skus.length) {
    return skus.reduce((sum, s) => sum + (parseInt(s.stock, 10) || 0), 0)
  }
  return parseInt(product.stock, 10) || 0
}

function getSkuStock(product, skuId) {
  const sku = findSku(product, skuId)
  if (sku) return parseInt(sku.stock, 10) || 0
  return getTotalStock(product)
}

function getEffectivePrice(product, skuId) {
  const sku = findSku(product, skuId)
  if (sku) return parseFloat(sku.price) || 0
  return parseFloat(product.price) || 0
}

function getFirstAvailableSku(product) {
  const skus = getSkuList(product)
  return skus.find((s) => (parseInt(s.stock, 10) || 0) > 0) || skus[0] || null
}

function initSelectedSpecs(product, sku) {
  const dims = getSkuDimensions(product)
  const selectedSpecs = {}
  if (!sku) return selectedSpecs

  if (sku.specs && typeof sku.specs === 'object') {
    dims.forEach((d) => {
      if (sku.specs[d]) selectedSpecs[d] = sku.specs[d]
    })
  } else if (dims.length === 1) {
    selectedSpecs[dims[0]] = sku.specLabel || ''
  }
  return selectedSpecs
}

function normalizeSkuId(skuId) {
  return skuId || ''
}

function buildCollectionKey(productId, skuId) {
  return `${productId}::${normalizeSkuId(skuId)}`
}

module.exports = {
  hasSkus,
  getSkuList,
  getSkuDimensions,
  isMultiDimension,
  findSku,
  resolveSkuFromSpecs,
  getDimensionValues,
  isDimensionValueAvailable,
  getDisplayPrice,
  getDisplayPriceLabel,
  getTotalStock,
  getSkuStock,
  getEffectivePrice,
  getFirstAvailableSku,
  initSelectedSpecs,
  normalizeSkuId,
  buildCollectionKey
}
