const db = wx.cloud.database()
const { formatPrice } = require('../../../utils/util')
const { calculateClientPricing } = require('../utils/orderPricing')
const { calcShipping, getShippingRuleText } = require('../../../utils/shipping')
const { consumeCheckoutPayload } = require('../../../utils/checkout')
const { payForOrder } = require('../utils/payment')
const { buildPreviewSummary } = require('../../../utils/customHelper')

Page({
  data: {
    items: [],
    source: 'cart',
    address: null,
    coupons: [],
    selectedCoupon: null,
    showCouponModal: false,
    originalPrice: '0.00',
    finalPrice: '0.00',
    savedAmount: '0.00',
    vipSaved: 0,
    couponSaved: 0,
    shippingFee: 0,
    shippingFeeDisplay: '0.00',
    shippingRuleText: getShippingRuleText(),
    remark: '',
    needInvoice: false,
    invoiceType: 'personal',
    invoiceTitle: '',
    invoiceTaxNo: '',
    invoiceEmail: '',
    discountRate: 1.0,
    levelName: '会员',
    submitting: false,
    customMeta: null,
    customExtraPrice: 0,
    customPreviewLines: [],
    isCustomOrder: false,
    showSpecimenNotice: false
  },

  onLoad() {
    this.initPayload()
    this.loadUserDiscount()
    this.loadCoupons()
    this.loadDefaultAddress()
  },

  initPayload() {
    const payload = consumeCheckoutPayload()
    if (!payload || !payload.items || !payload.items.length) {
      wx.showToast({ title: '结算信息无效', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 1500)
      return
    }

    this._prefCouponId = payload.couponId || null
    this._customMeta = payload.customMeta || null
    this._customExtraPrice = payload.customExtraPrice || 0
    this.setData({
      items: payload.items,
      source: payload.source || 'cart',
      customMeta: payload.customMeta || null,
      customExtraPrice: payload.customExtraPrice || 0,
      customPreviewLines: payload.customMeta ? buildPreviewSummary(payload.customMeta) : [],
      isCustomOrder: payload.source === 'custom' || !!(payload.customMeta && payload.customMeta.isCustom)
    })
    this.recalculate()
  },

  recalculate() {
    const pricing = calculateClientPricing(
      this.data.items,
      this.data.discountRate,
      this.data.selectedCoupon,
      this.data.customExtraPrice
    )

    let shippingFee = calcShipping(pricing.finalPrice)
    if (this.data.selectedCoupon && this.data.selectedCoupon.type === 'freeShipping') {
      shippingFee = 0
    }
    const finalWithShipping = pricing.finalPrice + shippingFee

    this.setData({
      selectedCoupon: pricing.selectedCoupon,
      originalPrice: formatPrice(pricing.originalPrice),
      finalPrice: formatPrice(finalWithShipping),
      savedAmount: formatPrice(pricing.totalSaved),
      vipSaved: pricing.vipSaved,
      couponSaved: pricing.couponSaved,
      shippingFee,
      shippingFeeDisplay: formatPrice(shippingFee)
    })
  },

  onRemarkInput(e) {
    this.setData({ remark: (e.detail.value || '').slice(0, 200) })
  },

  toggleInvoice(e) {
    this.setData({ needInvoice: e.detail.value })
  },

  switchInvoiceType(e) {
    this.setData({ invoiceType: e.currentTarget.dataset.type })
  },

  onInvoiceInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [field]: (e.detail.value || '').slice(0, 100) })
  },

  loadUserDiscount() {
    wx.cloud.callFunction({
      name: 'getUserStats',
      success: (res) => {
        if (res.result) {
          this.setData({
            discountRate: res.result.discountRate || 1.0,
            levelName: res.result.levelName || '普通会员'
          })
          this.recalculate()
        }
      }
    })
  },

  async loadDefaultAddress() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageAddress',
        data: { action: 'list' }
      })
      const result = res.result || {}
      if (!result.success) return

      const list = result.data || []
      const record = list.find((a) => a.isDefault) || list[0]
      if (record) {
        this.setData({ address: this.formatAddress(record) })
      }
    } catch (e) {
      console.error('loadDefaultAddress', e)
      try {
        const local = wx.getStorageSync('user_addresses_local') || []
        const record = local.find((a) => a.isDefault) || local[0]
        if (record) {
          this.setData({ address: this.formatAddress(record) })
        }
      } catch (err) {}
    }
  },

  formatAddress(record) {
    return {
      _id: record._id,
      name: record.name,
      phone: record.phone,
      region: record.region || [],
      detail: record.detail || ''
    }
  },

  async loadCoupons() {
    try {
      const res = await db.collection('user_coupons')
        .where({ status: 'unused' })
        .orderBy('value', 'desc')
        .get()

      const now = new Date()
      const vipTotal = this.data.items.reduce((sum, item) => {
        return sum + (parseFloat(item.price) || 0) * (item.count || 1)
      }, 0) * this.data.discountRate

      const list = res.data
        .filter((c) => new Date(c.expireTime) > now)
        .map((c) => ({
          ...c,
          _disabled: vipTotal < (c.minSpend || 0)
        }))

      this.setData({ coupons: list })

      if (this._prefCouponId) {
        const found = list.find((c) => c._id === this._prefCouponId && !c._disabled)
        if (found) this.setData({ selectedCoupon: found })
      } else if (list.length > 0 && vipTotal > 0) {
        await this.autoSelectBestCoupon(vipTotal)
      }

      this.recalculate()
    } catch (e) {
      console.error('loadCoupons', e)
      this.recalculate()
    }
  },

  async autoSelectBestCoupon(vipTotal) {
    try {
      const res = await wx.cloud.callFunction({
        name: 'getBestCoupon',
        data: { totalPrice: vipTotal }
      })
      if (res.result && res.result.success && res.result.bestCoupon) {
        this.setData({ selectedCoupon: res.result.bestCoupon })
      }
    } catch (e) {
      console.error('autoSelectBestCoupon', e)
    }
  },

  chooseAddress() {
    wx.navigateTo({
      url: '/subpackages/business/address/index?mode=select',
      events: {
        addressSelected: (addr) => {
          if (addr) this.setData({ address: addr })
        }
      }
    })
  },

  openCouponModal() {
    this.setData({ showCouponModal: true })
  },

  closeCouponModal() {
    this.setData({ showCouponModal: false })
  },

  selectCoupon(e) {
    const idx = parseInt(e.currentTarget.dataset.index, 10)
    if (idx === -1) {
      this.setData({ selectedCoupon: null })
    } else {
      const coupon = this.data.coupons[idx]
      if (coupon && coupon._disabled) return
      this.setData({ selectedCoupon: coupon })
    }
    this.recalculate()
    this.closeCouponModal()
  },

  async submitOrder() {
    if (this.data.submitting) return

    const address = this.data.address
    if (!address || !address.name || !address.phone) {
      wx.showToast({ title: '请选择收货地址', icon: 'none' })
      return
    }

    const { requirePhone } = require('../../../utils/userSession')
    const phoneOk = await requirePhone(getApp(), {
      content: '下单需绑定手机号，以便接收订单与物流通知。',
      contactPhone: address.phone,
    })
    if (!phoneOk) return

    if (this.data.needInvoice) {
      if (!this.data.invoiceTitle.trim()) {
        wx.showToast({ title: '请填写发票抬头', icon: 'none' })
        return
      }
      if (this.data.invoiceType === 'company' && !this.data.invoiceTaxNo.trim()) {
        wx.showToast({ title: '请填写企业税号', icon: 'none' })
        return
      }
    }

    if (!this._specimenNoticeConfirmed) {
      this.setData({ showSpecimenNotice: true })
      return
    }
    this._specimenNoticeConfirmed = false

    await this.doSubmitOrder()
  },

  closeSpecimenNotice() {
    this.setData({ showSpecimenNotice: false })
  },

  confirmSpecimenNotice() {
    this.setData({ showSpecimenNotice: false })
    this._specimenNoticeConfirmed = true
    this.submitOrder()
  },

  async doSubmitOrder() {
    if (this.data.submitting) return

    const address = this.data.address
    wx.vibrateShort({ type: 'heavy' })
    this.setData({ submitting: true })

    const orderItems = this.data.items.map((item) => ({
      productId: item.productId,
      skuId: item.skuId || '',
      count: item.count || 1,
      collectionId: item.collectionId || null
    }))
    const collectionIds = this.data.items
      .map((item) => item.collectionId)
      .filter(Boolean)

    try {
      const res = await wx.cloud.callFunction({
        name: 'makeOrder',
        data: {
          items: orderItems,
          collectionIds,
          couponId: this.data.selectedCoupon ? this.data.selectedCoupon._id : null,
          remark: this.data.remark,
          invoice: this.data.needInvoice ? {
            type: this.data.invoiceType,
            title: this.data.invoiceTitle.trim(),
            taxNo: this.data.invoiceType === 'company' ? this.data.invoiceTaxNo.trim() : '',
            email: this.data.invoiceEmail.trim()
          } : null,
          address: {
            name: address.name,
            phone: address.phone,
            region: address.region,
            detail: address.detail
          },
          customMeta: this._customMeta,
          customExtraPrice: this._customExtraPrice
        }
      })

      const result = res.result
      if (!result || !result.success) {
        wx.showModal({
          title: '下单失败',
          content: (result && result.msg) || '请稍后重试',
          showCancel: false,
          confirmColor: '#C4A76C'
        })
        this.setData({ submitting: false })
        return
      }

      wx.showLoading({ title: '支付中...', mask: true })
      try {
        await payForOrder(result.orderId)
        wx.hideLoading()

        if (collectionIds.length > 0) {
          this.removeBoughtCollections(collectionIds)
        }

        wx.showToast({ title: '支付成功', icon: 'success' })
        setTimeout(() => {
          wx.redirectTo({
            url: '/subpackages/business/orders/index?type=paid'
          })
        }, 1200)
      } catch (payErr) {
        wx.hideLoading()
        if (payErr.message === '已取消支付') {
          wx.showModal({
            title: '待付款',
            content: '订单已创建，可在「我的订单-待付款」中继续支付',
            confirmText: '去支付',
            confirmColor: '#C4A76C',
            success: (m) => {
              if (m.confirm) {
                wx.redirectTo({
                  url: `/subpackages/business/order-detail/index?id=${result.orderId}`
                })
              } else {
                wx.navigateBack()
              }
            }
          })
        } else {
          wx.showToast({ title: payErr.message || '支付失败', icon: 'none' })
        }
      }
    } catch (err) {
      wx.showToast({ title: '网络异常', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  },

  removeBoughtCollections(ids) {
    ids.forEach((id) => {
      db.collection('collections').doc(id).remove().catch(() => {})
    })
  }
})
