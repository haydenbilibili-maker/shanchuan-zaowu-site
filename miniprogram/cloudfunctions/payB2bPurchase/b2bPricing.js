/**
 * B2B 采购单服务端定价：唯一价格来源 = price_list_items（status=active）。
 * 客户端传来的 unitPrice / totalAmount / payFen 一律不采信。
 *
 * 区间价 / 议价 / 已下架：pricingMode = 'quote_required'，不支持在线支付（走待对公或总部报价确认）。
 */

const PRICE_COL = 'price_list_items'
const MAX_ITEMS = 50
const MAX_QTY = 999

/** 仅「单一固定价」可在线支付；区间价 {min,max}、空价、非正数 → null */
function fixedUnitFen(row) {
  if (!row) return null
  let p = row.price
  if (p && typeof p === 'object') {
    if (p.min == null || p.max == null || Number(p.min) !== Number(p.max)) return null
    p = p.min
  }
  if (p == null || p === '') return null
  const n = Number(p)
  if (!Number.isFinite(n) || n <= 0) return null
  const fen = Math.round(n * 100)
  return fen > 0 ? fen : null
}

function priceLabelOf(row) {
  if (!row) return null
  const p = row.price
  if (p != null && typeof p === 'object') {
    if (p.min != null && p.max != null) return `¥${p.min}–${p.max}`
    if (p.min != null) return `¥${p.min}起`
  }
  if (p != null && p !== '') return `¥${p}`
  return row.priceLabel ? String(row.priceLabel) : null
}

function rowKeys(row) {
  return [row && row.skuId, row && row.id, row && row._id]
    .map((x) => String(x || '').trim())
    .filter(Boolean)
}

function buildPriceIndex(rows) {
  const idx = new Map()
  for (const row of rows || []) {
    if (!row || String(row.status || '') !== 'active') continue
    for (const k of rowKeys(row)) {
      if (!idx.has(k)) idx.set(k, row)
    }
  }
  return idx
}

/** 客户端明细只取 skuId + quantity（+ 展示用缩略图） */
function normalizeRequestItems(rawItems) {
  const out = []
  for (const it of Array.isArray(rawItems) ? rawItems : []) {
    const skuId = String((it && it.skuId) || '').trim()
    if (!skuId) continue
    const quantity = Math.max(1, Math.min(MAX_QTY, parseInt(it && it.quantity, 10) || 1))
    const thumbUrl = String((it && it.thumbUrl) || '').trim().slice(0, 500) || null
    out.push({ skuId, quantity, thumbUrl })
    if (out.length >= MAX_ITEMS) break
  }
  return out
}

/**
 * @param {Array<{skuId:string, quantity:number, thumbUrl?:string|null}>} reqItems
 * @param {Map<string, object>} priceIndex
 * @returns {{ items:object[], payFen:number|null, totalAmount:number|null,
 *             pricingMode:'fixed'|'quote_required', unavailable:string[], quoteSkus:string[] }}
 */
function priceItems(reqItems, priceIndex) {
  const items = []
  const unavailable = []
  const quoteSkus = []
  let sumFen = 0
  for (const req of reqItems || []) {
    const row = priceIndex.get(req.skuId)
    if (!row) {
      unavailable.push(req.skuId)
      continue
    }
    const unitFen = fixedUnitFen(row)
    if (unitFen == null) quoteSkus.push(req.skuId)
    else sumFen += unitFen * req.quantity
    items.push({
      skuId: req.skuId,
      productId: row.productId || null,
      name: String(row.name || '').trim() || req.skuId,
      quantity: req.quantity,
      unitPrice: unitFen == null ? null : unitFen / 100,
      priceLabel: priceLabelOf(row),
      packText: String(row.packaging || row.packagingFilter || '').trim() || null,
      thumbUrl: req.thumbUrl || null
    })
  }
  const fixed = items.length > 0 && !unavailable.length && !quoteSkus.length
  return {
    items,
    payFen: fixed ? sumFen : null,
    totalAmount: fixed ? sumFen / 100 : null,
    pricingMode: fixed ? 'fixed' : 'quote_required',
    unavailable,
    quoteSkus
  }
}

async function loadActivePriceIndex(db) {
  const rows = []
  const page = 100
  for (let skip = 0; skip < 500; skip += page) {
    const res = await db.collection(PRICE_COL).where({ status: 'active' }).skip(skip).limit(page).get()
    const batch = (res && res.data) || []
    rows.push(...batch)
    if (batch.length < page) break
  }
  return buildPriceIndex(rows)
}

module.exports = {
  PRICE_COL,
  MAX_ITEMS,
  fixedUnitFen,
  priceLabelOf,
  buildPriceIndex,
  normalizeRequestItems,
  priceItems,
  loadActivePriceIndex
}
