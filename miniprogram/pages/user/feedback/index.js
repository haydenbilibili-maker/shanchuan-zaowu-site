// pages/user/feedback/index.js
const { trackBehavior } = require('../../../utils/trackBehavior')
const { getPageNavInsets } = require('../../../utils/pageNav')
const { measureFixedScroll } = require('../../../utils/scrollArea')

const CATEGORIES = [
  { id: 'feature', label: '功能建议' },
  { id: 'experience', label: '体验问题' },
  { id: 'content', label: '内容纠错' },
  { id: 'other', label: '其他' }
]

Page({
  data: {
    statusBarHeight: 20,
    navPaddingRight: 16,
    headerBlockPx: 88,
    scrollHeightPx: 500,
    categories: CATEGORIES,
    activeCategory: 'feature',
    messageText: '',
    contactPhone: '',
    submitting: false
  },

  onLoad() {
    const nav = getPageNavInsets()
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
    const fallback = getPageNavInsets().headerBlockPx
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
    wx.navigateTo({ url: `/pages/user/legal/index?type=${type}` })
  },

  goSupport() {
    wx.navigateTo({ url: '/pages/user/support/index' })
  },

  async submitFeedback() {
    if (this.data.submitting) return
    const message = (this.data.messageText || '').trim()
    if (message.length < 5) {
      wx.showToast({ title: '请至少输入 5 个字', icon: 'none' })
      return
    }

    const category = CATEGORIES.find((c) => c.id === this.data.activeCategory)
    const prefix = category ? `【${category.label}】` : ''
    const payload = `${prefix}${message}`

    this.setData({ submitting: true })
    wx.showLoading({ title: '提交中', mask: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'submitSupportTicket',
        data: {
          topic: 'feedback',
          message: payload,
          contactPhone: this.data.contactPhone
        }
      })
      wx.hideLoading()
      const result = res.result || {}
      if (result.success) {
        trackBehavior('feedback_submit', 'category', this.data.activeCategory)
        this.setData({ messageText: '' })
        wx.showToast({ title: '感谢反馈', icon: 'success' })
        setTimeout(() => {
          wx.navigateTo({ url: '/pages/user/messages/index?category=system' })
        }, 1200)
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
