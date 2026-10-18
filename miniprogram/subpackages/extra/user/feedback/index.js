// subpackages/extra/user/feedback/index.js
const { trackBehavior } = require('../../../../utils/trackBehavior')
const { getPageNavInsets } = require('../../utils/pageNav')
const { measureFixedScroll } = require('../../../../utils/scrollArea')
const { MAX_TICKET_IMAGES, ticketImageState, ticketImageMethods } = require('../../utils/ticketImages')

const CATEGORIES = [
  { id: 'feature', label: '功能建议' },
  { id: 'experience', label: '体验问题' },
  { id: 'content', label: '内容纠错' },
  { id: 'other', label: '其他' }
]

Page({
  data: {
    // 仪式感（2026-10-18）：提交成功的纸质回执（编号 / 类型 / 去处 + 「已收」朱印），约 1.8s 后照原路去山海有信
    receipt: { show: false, no: '', label: '' },
    statusBarHeight: 20,
    navPaddingRight: 16,
    headerBlockPx: 88,
    scrollHeightPx: 500,
    categories: CATEGORIES,
    activeCategory: 'feature',
    messageText: '',
    contactPhone: '',
    ticketImages: [],
    ticketImgBusy: false,
    ticketImgFailed: 0,
    maxTicketImages: MAX_TICKET_IMAGES,
    submitting: false
  },

  onLoad() {
    const nav = getPageNavInsets({ nativeNav: true })
    this.setData({
      statusBarHeight: nav.statusBarHeight,
      navPaddingRight: nav.navPaddingRight,
      headerBlockPx: nav.headerBlockPx
    })
  },

  onReady() {
    this.remeasureScroll()
  },

  async remeasureScroll() {
    const fallback = getPageNavInsets({ nativeNav: true }).headerBlockPx
    const area = await measureFixedScroll(this, {
      topSelector: '.account-nav',
      bottomSelector: '.account-footer',
      fallbackTop: fallback
    })
    this.setData({
      headerBlockPx: area.scrollTopPx,
      scrollHeightPx: area.scrollHeightPx
    })
  },

  selectCategory(e) {
    this.setData({ activeCategory: e.currentTarget.dataset.id })
  },

  onMessageInput(e) {
    this.setData({ messageText: e.detail.value })
  },

  onPhoneInput(e) {
    this.setData({ contactPhone: e.detail.value })
  },

  openLegal(e) {
    const type = e.currentTarget.dataset.type || 'terms'
    wx.navigateTo({
      url: `/subpackages/content/user/legal/index?type=${type}`,
      fail: () => wx.showToast({ title: '无法打开协议', icon: 'none' })
    })
  },

  goSupport() {
    wx.navigateTo({
      url: '/subpackages/extra/user/support/index',
      fail: () => wx.showToast({ title: '无法打开专员页', icon: 'none' })
    })
  },

  ...ticketImageMethods(),

  async submitFeedback() {
    if (this.data.submitting || this.data.ticketImgBusy) return
    const message = (this.data.messageText || '').trim()
    if (message.length < 5) {
      wx.showToast({ title: '请至少输入 5 个字', icon: 'none' })
      return
    }

    const category = CATEGORIES.find((c) => c.id === this.data.activeCategory)
    const prefix = category ? `【${category.label}】` : ''
    const payload = `${prefix}${message}`
    const phone = (this.data.contactPhone || '').trim()
    if (phone && !/^1\d{10}$/.test(phone)) {
      wx.showToast({ title: '请填写 11 位手机号', icon: 'none' })
      return
    }

    const imageIDs = ticketImageState(this.data.ticketImages).fileIDs
    this.setData({ submitting: true })
    wx.showLoading({ title: '提交中', mask: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'submitSupportTicket',
        data: {
          topic: 'feedback',
          message: payload,
          contactPhone: phone,
          ...(imageIDs.length ? { images: imageIDs } : {})
        }
      })
      wx.hideLoading()
      const result = res.result || {}
      if (result.success) {
        trackBehavior('feedback_submit', 'category', this.data.activeCategory)
        this.setData({
          messageText: '',
          ticketImages: [],
          ticketImgBusy: false,
          ticketImgFailed: 0,
          receipt: {
            show: true,
            no: `FB-${String(result.ticketId || '').slice(-6).toUpperCase() || '------'}`,
            label: category ? category.label : '建议'
          }
        })
        try { wx.vibrateShort({ type: 'light' }) } catch (e) { /* 低版本基础库无 type 参数 */ }
        setTimeout(() => {
          wx.redirectTo({
            url: '/subpackages/extra/user/messages/index?category=system',
            fail: () => wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/user/index' }) })
          })
        }, 1800)
      } else {
        wx.showToast({ title: result.msg || '提交失败', icon: 'none' })
      }
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: '网络异常，请稍后重试', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  },

  goBack() {
    wx.navigateBack({
      fail: () => wx.switchTab({ url: '/pages/user/index' })
    })
  }
})
