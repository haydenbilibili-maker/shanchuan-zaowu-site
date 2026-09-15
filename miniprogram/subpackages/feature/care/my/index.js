// subpackages/feature/care/my/index.js
const app = getApp()
const { getPageNavInsets } = require('../../utils/pageNav')
const { trackBehavior } = require('../../../../utils/trackBehavior')
const { buildGuideUrl } = require('../../utils/careDefaults')
const { loadUserSpecimens } = require('../../utils/careSpecimens')
const { measureFixedScroll } = require('../../../../utils/scrollArea')

Page({
  data: {
    statusBarHeight: 20,
    navPaddingRight: 96,
    navBarHeight: 44,
    scrollTopPx: 100,
    scrollHeightPx: 500,
    specimens: [],
    loading: true,
    loadError: false,
    pageReady: false
  },

  onLoad(options) {
    const nav = getPageNavInsets({ nativeNav: true })
    this.setData({
      statusBarHeight: nav.statusBarHeight || 0,
      navPaddingRight: nav.navPaddingRight,
      navBarHeight: nav.navBarHeight
    })
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
    this.setData({ loading: true, loadError: false })
    try {
      const specimens = await loadUserSpecimens(app, { limit: 50 })
      this.setData({ specimens, loadError: false })
    } catch (e) {
      console.warn('care/my loadList', e)
      this.setData({ specimens: [], loadError: true })
      wx.showToast({ title: '藏品加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
      this.remeasureScroll()
      setTimeout(() => this.setData({ pageReady: true }), 50)
    }
  },

  retryLoad() {
    this.loadList()
  },

  openSpecimen(e) {
    wx.vibrateShort({ type: 'light' })
    const { category, orderId, productId } = e.currentTarget.dataset
    trackBehavior('care_my_specimen_tap', 'orderId', orderId || '')
    wx.navigateTo({
      url: buildGuideUrl({ category, orderId, productId, from: 'my' }),
      fail: () => wx.showToast({ title: '指南暂不可用', icon: 'none' })
    })
  },

  goToHub() {
    wx.redirectTo({
      url: '/subpackages/feature/care/index?from=my',
      fail: () => wx.showToast({ title: '无法打开养护页', icon: 'none' })
    })
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.redirectTo({ url: '/subpackages/feature/care/index' }) })
  }
})
