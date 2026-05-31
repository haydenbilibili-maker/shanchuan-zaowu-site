// pages/care/my/index.js
const app = getApp()
const { getWindowInfo } = require('../../../utils/systemInfo')
const { trackBehavior } = require('../../../utils/trackBehavior')
const { buildGuideUrl } = require('../../../utils/careDefaults')
const { loadUserSpecimens } = require('../../../utils/careSpecimens')
const { measureFixedScroll } = require('../../../utils/scrollArea')

Page({
  data: {
    statusBarHeight: 20,
    scrollTopPx: 100,
    scrollHeightPx: 500,
    specimens: [],
    loading: true,
    pageReady: false
  },

  onLoad(options) {
    const win = getWindowInfo()
    this.setData({ statusBarHeight: win.statusBarHeight || 0 })
    trackBehavior('care_hub_enter', 'from', options.from ? `my_${options.from}` : 'my')
    this.loadList()
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
    this.loadList()
  },

  async loadList() {
    this.setData({ loading: true })
    try {
      const specimens = await loadUserSpecimens(app, { limit: 50 })
      this.setData({ specimens })
    } catch (e) {
      console.warn('care/my loadList', e)
      this.setData({ specimens: [] })
    } finally {
      this.setData({ loading: false })
      this.remeasureScroll()
      setTimeout(() => this.setData({ pageReady: true }), 50)
    }
  },

  openSpecimen(e) {
    wx.vibrateShort({ type: 'light' })
    const { category, orderId, productId } = e.currentTarget.dataset
    trackBehavior('care_my_specimen_tap', 'orderId', orderId || '')
    wx.navigateTo({
      url: buildGuideUrl({ category, orderId, productId, from: 'my' })
    })
  },

  goToHub() {
    wx.redirectTo({ url: '/pages/care/index?from=my' })
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.redirectTo({ url: '/pages/care/index' }) })
  }
})
