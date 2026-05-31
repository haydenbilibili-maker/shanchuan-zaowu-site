// pages/care/index.js
const app = getApp()
const { getWindowInfo } = require('../../utils/systemInfo')
const { trackBehavior } = require('../../utils/trackBehavior')
const { buildGuideUrl, CATEGORY_CARDS, GENERAL_TIPS } = require('../../utils/careDefaults')
const { loadUserSpecimens } = require('../../utils/careSpecimens')
const { fetchCareHub, getSeasonalTip } = require('../../utils/careApi')
const { measureFixedScroll } = require('../../utils/scrollArea')

Page({
  data: {
    statusBarHeight: 20,
    scrollTopPx: 100,
    scrollHeightPx: 500,
    categoryCards: [],
    generalTips: [],
    recentSpecimens: [],
    specimenTotal: 0,
    seasonalTip: null,
    loading: true,
    pageReady: false,
    expandedTip: 'light',
    scrollIntoView: ''
  },

  onLoad(options) {
    const win = getWindowInfo()
    this.setData({
      statusBarHeight: win.statusBarHeight || 0,
      seasonalTip: getSeasonalTip()
    })
    trackBehavior('care_hub_enter', 'from', options.from || 'direct')
    this.bootstrap()
  },

  onReady() {
    this.remeasureScroll()
  },

  async remeasureScroll() {
    const area = await measureFixedScroll(this, {
      topSelector: '.care-header',
      fallbackTop: 100
    })
    this.setData(area)
  },

  onShow() {
    this.refreshSpecimens()
  },

  async bootstrap() {
    this.setData({ loading: true })
    try {
      const hub = await fetchCareHub()
      this.setData({
        categoryCards: (hub.categoryCards && hub.categoryCards.length) ? hub.categoryCards : CATEGORY_CARDS,
        generalTips: (hub.generalTips && hub.generalTips.length) ? hub.generalTips : GENERAL_TIPS
      })
    } catch (e) {
      console.warn('care hub bootstrap', e)
      this.setData({ categoryCards: CATEGORY_CARDS, generalTips: GENERAL_TIPS })
    }
    await this.refreshSpecimens()
    this.setData({ loading: false })
    this.remeasureScroll()
    setTimeout(() => this.setData({ pageReady: true }), 50)
  },

  async refreshSpecimens() {
    try {
      const all = await loadUserSpecimens(app, { limit: 50 })
      this.setData({
        recentSpecimens: all.slice(0, 3),
        specimenTotal: all.length
      })
    } catch (e) {
      console.warn('refreshSpecimens', e)
      this.setData({ recentSpecimens: [], specimenTotal: 0 })
    }
  },

  openCategory(e) {
    wx.vibrateShort({ type: 'light' })
    const category = e.currentTarget.dataset.category
    wx.navigateTo({
      url: buildGuideUrl({ category, from: 'hub' })
    })
  },

  openSpecimenCare(e) {
    wx.vibrateShort({ type: 'light' })
    const { category, orderId, productId } = e.currentTarget.dataset
    wx.navigateTo({
      url: buildGuideUrl({ category, orderId, productId, from: 'hub_my' })
    })
  },

  toggleTip(e) {
    const key = e.currentTarget.dataset.key
    wx.vibrateShort({ type: 'light' })
    this.setData({ expandedTip: this.data.expandedTip === key ? '' : key })
  },

  scrollToCategories() {
    this.setData({ scrollIntoView: 'care-categories' })
    wx.vibrateShort({ type: 'light' })
  },

  goToMySpecimens() {
    wx.vibrateShort({ type: 'light' })
    trackBehavior('care_my_specimen_tap', 'from', 'hub')
    wx.navigateTo({ url: '/pages/care/my/index?from=hub' })
  },

  goToSupport() {
    wx.navigateTo({ url: '/pages/user/support/index?topic=specimen_care' })
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/user/index' }) })
  }
})
