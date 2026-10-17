// subpackages/feature/care/my/index.js
const app = getApp()
const { trackBehavior } = require('../../../../utils/trackBehavior')
const { buildGuideUrl } = require('../../utils/careDefaults')
const { loadUserSpecimens } = require('../../utils/careSpecimens')

Page({
  data: {
    specimens: [],
    loading: true,
    loadError: false,
    pageReady: false
  },

  onLoad(options) {
    trackBehavior('care_hub_enter', 'from', options.from ? `my_${options.from}` : 'my')
    this.loadList()
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
