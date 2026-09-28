/**
 * 供货价目选购（采购商）
 * 读取 price_list_items；缩略图；可加购 → 确认采购单。
 * 仍禁止跳转工作室机密页。
 */
const { guardManagerPage } = require('../../../../utils/managerAuth')
const { guardSupplierWorkspace } = require('../utils/supplierGate')
const { resolveCatalogImages } = require('../utils/catalogImage')
const { onImageError, probeSupport } = require('../../../../utils/imageUrl')
const { upsertItem, readCart, cartCount, qtyInCart } = require('../utils/buyerCart')

function formatPrice(row) {
  if (!row) return '—'
  const p = row.price
  if (p != null && typeof p === 'object') {
    if (p.min != null && p.max != null) return `¥${p.min}–${p.max}`
    if (p.min != null) return `¥${p.min}起`
  }
  if (p != null && p !== '') return `¥${p}`
  if (row.priceLabel) return String(row.priceLabel)
  return '—'
}

/** 仅单一固定价返回数字（与云函数 b2bPricing.fixedUnitFen 同口径）；区间价 → null（需总部报价） */
function resolveUnitPrice(row) {
  if (!row) return null
  const p = row.price
  if (p != null && typeof p === 'object') {
    if (p.min != null && p.max != null && Number(p.min) === Number(p.max) && Number.isFinite(Number(p.min))) {
      return Number(p.min)
    }
    return null
  }
  if (p != null && p !== '') {
    const n = Number(p)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function packLabel(row) {
  return String(
    (row && (row.packaging || row.packagingFilter || row.packType || row.category)) || ''
  ).trim()
}

function truncateNote(s, max) {
  const t = String(s || '').trim()
  if (!t) return ''
  const n = max || 72
  return t.length > n ? `${t.slice(0, n)}…` : t
}

function normalizeRow(row, idx) {
  const skuId = String((row && (row.skuId || row.id || row._id)) || '').trim() || `sku_${idx}`
  const pack = packLabel(row)
  const specs = String((row && (row.specs || row.spec || row.unit)) || '').trim()
  const species = String((row && row.species) || '').trim()
  const metaParts = []
  if (species) metaParts.push(species)
  if (specs) metaParts.push(specs)
  const imgs = resolveCatalogImages(row)
  const unitPrice = resolveUnitPrice(row)
  return {
    key: skuId,
    skuId,
    name: String((row && row.name) || '未命名').trim(),
    packText: pack || '包装待补充',
    meta: metaParts.join(' · '),
    priceText: formatPrice(row),
    priceLabel: formatPrice(row),
    unitPrice,
    orderable: unitPrice != null,
    note: truncateNote(row && row.note, 80),
    thumbUrl: imgs.thumbUrl,
    previewUrls: imgs.previewUrls,
    hasImage: imgs.hasImage,
    imgBroken: false,
    qty: 1
  }
}

Page({
  data: {
    ready: false,
    loading: false,
    loadError: false,
    isPreview: false,
    items: [],
    cartCount: 0,
    flash: '',
    flashKind: 'ok',
    emptyHint: '暂时没有可订购的商品。请稍后再试，或联系对接人确认价目是否已上架。',
    cartEmptyHint: '选数量后点「加入」'
  },

  onLoad() {
    this.bootstrap()
  },

  onShow() {
    if (!this.data.ready) return
    this.syncCartBadge()
  },

  onPullDownRefresh() {
    Promise.resolve(this.loadCatalog()).finally(() => wx.stopPullDownRefresh())
  },

  async bootstrap() {
    try {
      if (!guardManagerPage()) return
      const role = await guardSupplierWorkspace()
      if (!role) return
      this.setData({
        ready: true,
        isPreview: role.supplierMode === 'preview'
      })
      this.syncCartBadge()
      await this.loadCatalog()
    } catch (e) {
      console.warn('supplier catalog bootstrap', e)
      wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/user/index' }) })
    }
  },

  syncCartBadge() {
    const cart = readCart()
    const count = cartCount(cart)
    const items = (this.data.items || []).map((row) => {
      const inCart = qtyInCart(row.skuId)
      return {
        ...row,
        inCart,
        addLabel: !row.orderable ? '议价不可购' : inCart > 0 ? `再加 · 已${inCart}` : '加入采购车',
        justAdded: false,
        adding: false
      }
    })
    this.setData({ cartCount: count, items })
  },

  showFlash(text, kind) {
    this.setData({ flash: text || '', flashKind: kind || 'ok' })
    if (this._flashTimer) clearTimeout(this._flashTimer)
    this._flashTimer = setTimeout(() => this.setData({ flash: '' }), 2200)
  },

  async loadCatalog() {
    this.setData({ loading: true, loadError: false })
    try {
      const db = wx.cloud.database()
      const res = await db
        .collection('price_list_items')
        .where({ status: 'active' })
        .limit(100)
        .get()
      const rows = (res && res.data) || []
      const items = rows.map(normalizeRow).map((row) => {
        const inCart = qtyInCart(row.skuId)
        return {
          ...row,
          inCart,
          addLabel: !row.orderable ? '议价不可购' : inCart > 0 ? `再加 · 已${inCart}` : '加入采购车',
          justAdded: false,
          adding: false
        }
      })
      this.setData({
        items,
        loading: false,
        loadError: false,
        cartCount: cartCount(readCart())
      })
      const sample = items.find((it) => it.thumbUrl)
      if (sample && sample.thumbUrl) {
        try {
          probeSupport(sample.thumbUrl)
        } catch (e) { /* ignore */ }
      }
    } catch (e) {
      console.warn('loadCatalog', e)
      this.setData({ items: [], loading: false, loadError: true })
    }
  },

  onRetry() {
    this.loadCatalog()
  },

  onThumbError(e) {
    try {
      onImageError()
    } catch (err) { /* ignore */ }
    const idx = Number((e.currentTarget.dataset || {}).idx)
    if (!Number.isFinite(idx) || idx < 0) return
    const items = (this.data.items || []).slice()
    const row = items[idx]
    if (!row || row.imgBroken) return
    items[idx] = { ...row, imgBroken: true, thumbUrl: '' }
    this.setData({ items })
  },

  onPreview(e) {
    const idx = Number((e.currentTarget.dataset || {}).idx)
    const items = this.data.items || []
    const row = items[idx]
    if (!row || !row.hasImage || row.imgBroken) return
    const urls = Array.isArray(row.previewUrls) ? row.previewUrls.filter(Boolean) : []
    if (!urls.length) return
    wx.previewImage({
      current: urls[0],
      urls
    })
  },

  onQtyMinus(e) {
    const idx = Number((e.currentTarget.dataset || {}).idx)
    const items = (this.data.items || []).slice()
    const row = items[idx]
    if (!row || !row.orderable) return
    const q = Math.max(1, (row.qty || 1) - 1)
    items[idx] = { ...row, qty: q }
    this.setData({ items })
  },

  onQtyPlus(e) {
    const idx = Number((e.currentTarget.dataset || {}).idx)
    const items = (this.data.items || []).slice()
    const row = items[idx]
    if (!row || !row.orderable) return
    const q = Math.min(999, (row.qty || 1) + 1)
    items[idx] = { ...row, qty: q }
    this.setData({ items })
  },

  onAdd(e) {
    const idx = Number((e.currentTarget.dataset || {}).idx)
    const items = (this.data.items || []).slice()
    const row = items[idx]
    if (!row) return
    if (!row.orderable) {
      this.showFlash('区间/议价商品需总部确认单价后再下单', 'warn')
      return
    }
    if (row.adding) return
    items[idx] = { ...row, adding: true }
    this.setData({ items })
    upsertItem({
      skuId: row.skuId,
      name: row.name,
      packText: row.packText,
      unitPrice: row.unitPrice,
      priceLabel: row.priceLabel,
      thumbUrl: row.thumbUrl,
      quantity: row.qty || 1
    })
    const inCart = qtyInCart(row.skuId)
    items[idx] = {
      ...row,
      adding: false,
      justAdded: true,
      inCart,
      addLabel: `再加 · 已${inCart}`
    }
    this.setData({
      items,
      cartCount: cartCount(readCart())
    })
    this.showFlash(`已加入 ${row.name} ×${row.qty || 1}`, 'ok')
    if (this._addedTimer) clearTimeout(this._addedTimer)
    this._addedTimer = setTimeout(() => {
      const cur = (this.data.items || []).slice()
      if (!cur[idx]) return
      cur[idx] = { ...cur[idx], justAdded: false }
      this.setData({ items: cur })
    }, 900)
  },

  goCart() {
    if (!(this.data.cartCount > 0)) {
      this.showFlash('请先选择商品并加入采购车', 'warn')
      return
    }
    wx.navigateTo({ url: '/subpackages/extra/supplier/buyer-cart/index' })
  }
})
