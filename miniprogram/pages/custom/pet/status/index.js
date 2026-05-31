// pages/custom/pet/status/index.js
const {
  buildSummaryLines,
  buildQuoteDisplay,
  getStatusLabel,
  formatQuoteAmount
} = require('../../../../utils/petMemorialHelper')
const { trackBehavior } = require('../../../../utils/trackBehavior')

Page({
  data: {
    statusBarHeight: 0,
    loading: true,
    orderId: '',
    order: null,
    statusLabel: '',
    summaryLines: [],
    quoteLines: [],
    quoteAmountText: '',
    history: [],
    canConfirmQuote: false,
    canBookIntake: false,
    hasBooking: false,
    bookingText: '',
    confirming: false
  },

  onLoad(options) {
    const systemInfo = wx.getSystemInfoSync()
    this.setData({ statusBarHeight: systemInfo.statusBarHeight || 0 })
    if (options.id) {
      this.setData({ orderId: options.id })
      this.loadOrder(options.id)
    } else {
      this.setData({ loading: false })
    }
  },

  onShow() {
    if (this.data.orderId) {
      this.loadOrder(this.data.orderId)
    }
  },

  applyOrder(order) {
    if (!order) return
    const intake = order.intake || {}
    const canBookIntake = ['accepted', 'awaiting_intake'].includes(order.status)
      && intake.method === 'store'
      && !intake.bookingId
    const hasBooking = !!intake.bookingId
    let bookingText = ''
    if (hasBooking) {
      bookingText = [intake.bookingDate, intake.bookingTime].filter(Boolean).join(' ')
      if (intake.bookingTicketCode) bookingText += ` · ${intake.bookingTicketCode}`
    }
    this.setData({
      loading: false,
      order,
      statusLabel: getStatusLabel(order.status),
      summaryLines: buildSummaryLines(order),
      quoteLines: buildQuoteDisplay(order.quote) || [],
      quoteAmountText: order.quote ? formatQuoteAmount(order.quote.amount) : '',
      history: order.productionLog || [],
      canConfirmQuote: order.status === 'quoted' && order.quote && order.quote.amount != null,
      canBookIntake,
      hasBooking,
      bookingText
    })
  },

  async loadOrder(orderId) {
    try {
      const res = await wx.cloud.callFunction({
        name: 'petMemorialOrder',
        data: { action: 'get', orderId }
      })
      const order = res.result && res.result.order
      if (!order) {
        wx.showToast({ title: '工单不存在', icon: 'none' })
        this.setData({ loading: false })
        return
      }
      this.applyOrder(order)
    } catch (e) {
      this.setData({ loading: false })
    }
  },

  async confirmQuote() {
    if (!this.data.canConfirmQuote || this.data.confirming) return
    wx.showModal({
      title: '确认报价',
      content: `确认接受 ${this.data.quoteAmountText} 的报价？确认后工坊将安排后续交接。`,
      success: async (res) => {
        if (!res.confirm) return
        this.setData({ confirming: true })
        try {
          const result = await wx.cloud.callFunction({
            name: 'petMemorialOrder',
            data: { action: 'confirmQuote', orderId: this.data.orderId }
          })
          if (!result.result || !result.result.success) {
            wx.showToast({ title: (result.result && result.result.msg) || '确认失败', icon: 'none' })
            return
          }
          trackBehavior('pet_memorial_quote_confirm', 'order', this.data.order.orderNo)
          wx.showToast({ title: '已确认报价' })
          this.loadOrder(this.data.orderId)
        } catch (e) {
          wx.showToast({ title: '确认失败', icon: 'none' })
        } finally {
          this.setData({ confirming: false })
        }
      }
    })
  },

  goBookIntake() {
    if (!this.data.canBookIntake) return
    trackBehavior('pet_intake_book', 'order', this.data.order.orderNo)
    wx.navigateTo({
      url: `/subpackages/business/booking/index?from=pet&orderId=${this.data.orderId}`
    })
  },

  goMyOrders() {
    wx.navigateTo({ url: '/pages/custom/pet/list/index' })
  },

  goSupport() {
    wx.navigateTo({ url: '/pages/user/support/index?topic=pet_memorial' })
  },

  goHub() {
    wx.redirectTo({ url: '/pages/custom/hub/index' })
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/user/index' }) })
  }
})
