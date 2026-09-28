/**
 * 采购商 · 确认采购单 → 云函数 payB2bPurchase 建单（服务端定价）→ 可选拉起支付
 * 购物车内单价仅作预估展示，实付以服务端按当前价目计算为准。
 */
const { guardManagerPage } = require('../../../../utils/managerAuth')
const { guardSupplierWorkspace } = require('../utils/supplierGate')
const {
  readCart,
  setQuantity,
  clearCart,
  cartTotalYuan,
  readContact,
  writeContact
} = require('../utils/buyerCart')
const {
  createBuyerPurchaseOrder,
  payBuyerOrder
} = require('../utils/buyerPurchaseOrder')

function fmtYuan(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  return `¥${Number(n)}`
}

function goOrders(id, result) {
  const q = []
  if (id) q.push(`highlight=${id}`)
  if (result) q.push(`result=${result}`)
  wx.redirectTo({
    url: `/subpackages/extra/supplier/buyer-orders/index${q.length ? `?${q.join('&')}` : ''}`
  })
}

Page({
  data: {
    ready: false,
    isPreview: false,
    items: [],
    totalText: '—',
    itemCount: 0,
    canSubmit: false,
    contactName: '',
    contactPhone: '',
    company: '',
    shipToAddress: '',
    note: '',
    submitting: false,
    banner: '',
    bannerKind: ''
  },

  onLoad() {
    this.bootstrap()
  },

  onShow() {
    if (!this.data.ready) return
    this.refreshCart()
  },

  async bootstrap() {
    try {
      if (!guardManagerPage()) return
      const role = await guardSupplierWorkspace()
      if (!role) return
      const saved = readContact()
      const name =
        saved.contactName || String(role.name || role.staffName || '').trim()
      this.setData({
        ready: true,
        isPreview: role.supplierMode === 'preview',
        contactName: name,
        contactPhone: saved.contactPhone,
        company: saved.company,
        shipToAddress: saved.shipToAddress
      })
      this.refreshCart()
    } catch (e) {
      console.warn('buyer-cart bootstrap', e)
      wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/user/index' }) })
    }
  },

  refreshCart() {
    const cart = readCart()
    const items = (cart.items || []).map((it) => {
      const q = Math.max(1, parseInt(it.quantity, 10) || 1)
      const unit = it.unitPrice != null && Number.isFinite(Number(it.unitPrice))
        ? Number(it.unitPrice)
        : null
      const line = unit != null ? Math.round(unit * q * 100) / 100 : null
      return {
        ...it,
        quantity: q,
        unitText: unit != null ? `单价 ¥${unit}` : '议价',
        lineTotalText: line != null ? `¥${line}` : '—'
      }
    })
    const total = cartTotalYuan(cart)
    const itemCount = items.reduce((n, it) => n + (it.quantity || 0), 0)
    this.setData({
      items,
      itemCount,
      totalText: fmtYuan(total),
      canSubmit: items.length > 0
    })
  },

  onField(e) {
    const key = String((e.currentTarget.dataset || {}).key || '')
    if (!key) return
    this.setData({ [key]: e.detail.value })
  },

  persistContact() {
    writeContact({
      contactName: this.data.contactName,
      contactPhone: this.data.contactPhone,
      company: this.data.company,
      shipToAddress: this.data.shipToAddress
    })
  },

  onQtyMinus(e) {
    const skuId = String((e.currentTarget.dataset || {}).sku || '')
    const items = this.data.items || []
    const row = items.find((x) => x.skuId === skuId)
    if (!row) return
    setQuantity(skuId, (row.quantity || 1) - 1)
    this.refreshCart()
  },

  onQtyPlus(e) {
    const skuId = String((e.currentTarget.dataset || {}).sku || '')
    const items = this.data.items || []
    const row = items.find((x) => x.skuId === skuId)
    if (!row) return
    setQuantity(skuId, (row.quantity || 1) + 1)
    this.refreshCart()
  },

  onRemove(e) {
    const skuId = String((e.currentTarget.dataset || {}).sku || '')
    setQuantity(skuId, 0)
    this.refreshCart()
  },

  setBanner(kind, text) {
    this.setData({ bannerKind: kind || '', banner: text || '' })
  },

  buildPayload() {
    this.persistContact()
    return {
      items: this.data.items,
      contactName: this.data.contactName,
      contactPhone: this.data.contactPhone,
      company: this.data.company,
      storeName: this.data.company || '渠道采购商',
      shipToAddress: this.data.shipToAddress,
      note: this.data.note
    }
  },

  validateBeforeSubmit() {
    const items = this.data.items || []
    if (!items.length) {
      this.setBanner('err', '采购车为空，请先从价目选品。')
      return false
    }
    const name = String(this.data.contactName || '').trim()
    if (!name) {
      this.setBanner('err', '请填写联系人，便于总部对接。')
      return false
    }
    const phone = String(this.data.contactPhone || '').trim()
    if (phone && !/^1\d{10}$/.test(phone) && !/^0\d{2,3}-?\d{7,8}$/.test(phone)) {
      this.setBanner('warn', '手机号格式可能不正确，仍可提交；建议核对。')
    }
    return true
  },

  async onSubmit() {
    if (this.data.submitting || !this.data.canSubmit) return
    if (!this.validateBeforeSubmit()) return
    this.setData({ submitting: true })
    this.setBanner('', '')
    wx.showLoading({ title: '提交采购单…', mask: true })
    let created
    try {
      created = await createBuyerPurchaseOrder(this.buildPayload())
      clearCart()
    } catch (e) {
      wx.hideLoading()
      this.setData({ submitting: false })
      const { createErrorFriendly } = require('../utils/buyerPurchaseOrder')
      this.setBanner('err', createErrorFriendly(e))
      return
    }
    wx.hideLoading()

    if (created.pricingMode === 'quote_required') {
      this.setData({ submitting: false })
      goOrders(created._id, 'quote')
      return
    }

    wx.showLoading({ title: '准备支付…', mask: true })
    let payResult
    try {
      payResult = await payBuyerOrder(created._id, { action: 'pay' })
    } catch (e) {
      const { friendlyPayError } = require('../utils/buyerPurchaseOrder')
      const f = friendlyPayError(e)
      payResult = {
        success: false,
        code: f.code,
        msg: f.msg,
        paymentStatus: 'unpaid'
      }
    }
    wx.hideLoading()
    this.setData({ submitting: false })

    if (payResult && payResult.code === 'CANCELLED') {
      goOrders(created._id, 'cancelled')
      return
    }

    if (payResult && payResult.success && payResult.via === 'preview_mark') {
      goOrders(created._id, 'marked')
      return
    }

    if (payResult && payResult.success && (payResult.paid || payResult.payment)) {
      goOrders(created._id, 'paid')
      return
    }

    if (payResult && payResult.code === 'PRICE_CHANGED') {
      goOrders(created._id, 'price_changed')
      return
    }
    if (payResult && payResult.code === 'QUOTE_REQUIRED') {
      goOrders(created._id, 'quote')
      return
    }

    goOrders(created._id, 'pay_pending')
  },

  async onSubmitOnly() {
    if (this.data.submitting || !this.data.canSubmit) return
    if (!this.validateBeforeSubmit()) return
    this.setData({ submitting: true })
    wx.showLoading({ title: '提交采购单…', mask: true })
    try {
      const created = await createBuyerPurchaseOrder(this.buildPayload())
      clearCart()
      wx.hideLoading()
      this.setData({ submitting: false })
      goOrders(created._id, 'created')
    } catch (e) {
      wx.hideLoading()
      this.setData({ submitting: false })
      const { createErrorFriendly } = require('../utils/buyerPurchaseOrder')
      this.setBanner('err', createErrorFriendly(e))
    }
  },

  goCatalog() {
    wx.navigateBack({
      fail: () =>
        wx.redirectTo({ url: '/subpackages/extra/supplier/catalog/index' })
    })
  }
})
