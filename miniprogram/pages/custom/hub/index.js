// pages/custom/hub/index.js
const { trackBehavior } = require('../../../utils/trackBehavior')
const { xingchenCover } = require('../../../config/storeMediaCdn')

Page({
  data: {
    statusBarHeight: 0,
    heroImage: xingchenCover
  },

  onLoad(options) {
    const systemInfo = wx.getSystemInfoSync()
    this.setData({ statusBarHeight: systemInfo.statusBarHeight || 0 })
    trackBehavior('custom_hub_enter', 'from', options.from || 'direct')
  },

  goStandard() {
    trackBehavior('custom_hub_select', 'type', 'standard')
    wx.navigateTo({ url: '/pages/custom/index?from=hub' })
  },

  goPet() {
    trackBehavior('custom_hub_select', 'type', 'pet')
    wx.navigateTo({ url: '/pages/custom/pet/index?from=hub' })
  },

  goPetOrders() {
    wx.navigateTo({ url: '/pages/custom/pet/list/index?from=hub' })
  },

  goCustomOrders() {
    wx.navigateTo({ url: '/pages/custom/orders/index?from=hub' })
  },

  goBack() {
    wx.navigateBack({
      fail: () => wx.switchTab({ url: '/pages/index/index' })
    })
  }
})
