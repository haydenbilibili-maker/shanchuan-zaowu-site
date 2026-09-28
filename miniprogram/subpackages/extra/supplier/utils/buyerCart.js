/**
 * 采购商本地购物车（旁路 · 仅本机）
 * 选品 → 下单页写入 purchase_orders；不碰 C 端 cart 集合。
 */
const STORAGE_KEY = 'b2b_buyer_cart_v1'
const CONTACT_KEY = 'b2b_buyer_contact_v1'

function safeParse(raw) {
  try {
    const o = JSON.parse(raw)
    return o && typeof o === 'object' ? o : null
  } catch (e) {
    return null
  }
}

function readCart() {
  try {
    const raw = wx.getStorageSync(STORAGE_KEY)
    if (!raw) return { items: [], updatedAt: 0 }
    if (typeof raw === 'object' && Array.isArray(raw.items)) {
      return { items: raw.items, updatedAt: Number(raw.updatedAt) || 0 }
    }
    if (typeof raw === 'string') {
      const o = safeParse(raw)
      if (o && Array.isArray(o.items)) {
        return { items: o.items, updatedAt: Number(o.updatedAt) || 0 }
      }
    }
  } catch (e) { /* ignore */ }
  return { items: [], updatedAt: 0 }
}

function writeCart(items) {
  const payload = {
    items: Array.isArray(items) ? items : [],
    updatedAt: Date.now()
  }
  try {
    wx.setStorageSync(STORAGE_KEY, payload)
  } catch (e) {
    console.warn('buyerCart write', e)
  }
  return payload
}

function upsertItem(item) {
  const cart = readCart()
  const skuId = String((item && item.skuId) || '').trim()
  if (!skuId) return cart
  const qty = Math.max(1, Math.min(999, parseInt(item.quantity, 10) || 1))
  const next = (cart.items || []).slice()
  const idx = next.findIndex((x) => String(x.skuId) === skuId)
  const row = {
    skuId,
    name: String((item && item.name) || '未命名').trim(),
    packText: String((item && item.packText) || '').trim(),
    unitPrice: item && item.unitPrice != null && Number.isFinite(Number(item.unitPrice))
      ? Number(item.unitPrice)
      : null,
    priceLabel: String((item && item.priceLabel) || '').trim() || null,
    thumbUrl: String((item && item.thumbUrl) || '').trim(),
    quantity: qty
  }
  if (idx >= 0) {
    next[idx] = { ...next[idx], ...row, quantity: Math.min(999, (next[idx].quantity || 0) + qty) }
  } else {
    next.push(row)
  }
  return writeCart(next)
}

function setQuantity(skuId, quantity) {
  const id = String(skuId || '').trim()
  const cart = readCart()
  const q = Math.max(0, Math.min(999, parseInt(quantity, 10) || 0))
  let next = (cart.items || []).slice()
  if (q <= 0) {
    next = next.filter((x) => String(x.skuId) !== id)
  } else {
    const idx = next.findIndex((x) => String(x.skuId) === id)
    if (idx >= 0) next[idx] = { ...next[idx], quantity: q }
  }
  return writeCart(next)
}

function removeItem(skuId) {
  return setQuantity(skuId, 0)
}

function clearCart() {
  return writeCart([])
}

function cartCount(cart) {
  const items = (cart && cart.items) || readCart().items || []
  return items.reduce((n, it) => n + (Math.max(0, parseInt(it.quantity, 10) || 0)), 0)
}

function cartTotalYuan(cart) {
  const items = (cart && cart.items) || readCart().items || []
  let sum = 0
  let any = false
  for (const it of items) {
    if (it.unitPrice == null || !Number.isFinite(Number(it.unitPrice))) continue
    const q = Math.max(1, parseInt(it.quantity, 10) || 1)
    sum += Number(it.unitPrice) * q
    any = true
  }
  return any ? Math.round(sum * 100) / 100 : null
}

function readContact() {
  try {
    const raw = wx.getStorageSync(CONTACT_KEY)
    if (raw && typeof raw === 'object') {
      return {
        contactName: String(raw.contactName || '').trim(),
        contactPhone: String(raw.contactPhone || '').trim(),
        company: String(raw.company || '').trim(),
        shipToAddress: String(raw.shipToAddress || '').trim()
      }
    }
  } catch (e) { /* ignore */ }
  return { contactName: '', contactPhone: '', company: '', shipToAddress: '' }
}

function writeContact(fields) {
  const next = {
    contactName: String((fields && fields.contactName) || '').trim(),
    contactPhone: String((fields && fields.contactPhone) || '').trim(),
    company: String((fields && fields.company) || '').trim(),
    shipToAddress: String((fields && fields.shipToAddress) || '').trim()
  }
  try {
    wx.setStorageSync(CONTACT_KEY, next)
  } catch (e) { /* ignore */ }
  return next
}

function qtyInCart(skuId) {
  const id = String(skuId || '').trim()
  if (!id) return 0
  const hit = (readCart().items || []).find((x) => String(x.skuId) === id)
  return hit ? Math.max(0, parseInt(hit.quantity, 10) || 0) : 0
}

module.exports = {
  STORAGE_KEY,
  CONTACT_KEY,
  readCart,
  writeCart,
  upsertItem,
  setQuantity,
  removeItem,
  clearCart,
  cartCount,
  cartTotalYuan,
  readContact,
  writeContact,
  qtyInCart
}
