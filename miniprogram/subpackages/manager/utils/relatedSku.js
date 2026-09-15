/**
 * 专题/内容关联商品 SKU
 * relatedSkus: [{ productId, skuId, skuLabel }]
 * 无规格商品：skuId / skuLabel 为空字符串
 */

function skuKey(productId, skuId) {
  const pid = String(productId || '').trim()
  const sid = String(skuId || '').trim()
  if (!pid) return ''
  return sid ? `${pid}::${sid}` : pid
}

function parseSkuKey(key) {
  const raw = String(key || '').trim()
  if (!raw) return { productId: '', skuId: '' }
  const idx = raw.indexOf('::')
  if (idx === -1) return { productId: raw, skuId: '' }
  return {
    productId: raw.slice(0, idx).trim(),
    skuId: raw.slice(idx + 2).trim()
  }
}

function relatedIdsFromSkus(relatedSkus) {
  const ids = []
  const seen = {}
  ;(Array.isArray(relatedSkus) ? relatedSkus : []).forEach((item) => {
    const id = String((item && item.productId) || '').trim()
    if (!id || seen[id]) return
    seen[id] = true
    ids.push(id)
  })
  return ids
}

function normalizeRelatedSkus(skus, productIds) {
  const list = []
  const seen = {}
  const push = (productId, skuId, skuLabel) => {
    const pid = String(productId || '').trim()
    if (!pid) return
    const sid = String(skuId || '').trim()
    const key = skuKey(pid, sid)
    if (!key || seen[key]) return
    seen[key] = true
    list.push({
      productId: pid,
      skuId: sid,
      skuLabel: String(skuLabel || '').trim()
    })
  }

  if (Array.isArray(skus) && skus.length) {
    skus.forEach((item) => {
      if (!item) return
      push(item.productId, item.skuId, item.skuLabel)
    })
  } else if (Array.isArray(productIds)) {
    productIds.forEach((id) => push(id, '', ''))
  }

  return list
}

module.exports = {
  skuKey,
  parseSkuKey,
  relatedIdsFromSkus,
  normalizeRelatedSkus
}
