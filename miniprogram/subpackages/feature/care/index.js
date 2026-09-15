// subpackages/feature/care/index.js
const app = getApp()
const { getPageNavInsets } = require('../utils/pageNav')
const { trackBehavior } = require('../../../utils/trackBehavior')
const { buildGuideUrl, CATEGORY_CARDS, GENERAL_TIPS } = require('../utils/careDefaults')
const { loadUserSpecimens } = require('../utils/careSpecimens')
const { fetchCareHub, getSeasonalTip } = require('../utils/careApi')
const { measureFixedScroll } = require('../../../utils/scrollArea')
const easterEggHost = require('../../../utils/easterEggHost')

Page({
  behaviors: [easterEggHost],
  data: {
    statusBarHeight: 20,
    navPaddingRight: 96,
    navBarHeight: 44,
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
    const nav = getPageNavInsets({ nativeNav: true })
    this.setData({
      statusBarHeight: nav.statusBarHeight || 0,
      navPaddingRight: nav.navPaddingRight,
      navBarHeight: nav.navBarHeight,
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
    if (!category) {
      wx.showToast({ title: '品类信息缺失', icon: 'none' })
      return
    }
    wx.navigateTo({
      url: buildGuideUrl({ category, from: 'hub' }),
      fail: () => wx.showToast({ title: '指南暂不可用', icon: 'none' })
    })
  },

  openSpecimenCare(e) {
    wx.vibrateShort({ type: 'light' })
    const { category, orderId, productId } = e.currentTarget.dataset
    wx.navigateTo({
      url: buildGuideUrl({ category, orderId, productId, from: 'hub_my' }),
      fail: () => wx.showToast({ title: '指南暂不可用', icon: 'none' })
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
    wx.navigateTo({
      url: '/subpackages/feature/care/my/index?from=hub',
      fail: () => wx.showToast({ title: '无法打开藏品列表', icon: 'none' })
    })
  },

  goToSupport() {
    wx.navigateTo({
      url: '/subpackages/feature/user/support/index?topic=specimen_care',
      fail: () => wx.showToast({ title: '客服页暂不可用', icon: 'none' })
    })
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/user/index' }) })
  }
})
