// pages/custom/pet/list/index.js
const { mapOrderListItem } = require('../../../../utils/petMemorialHelper')
const { trackBehavior } = require('../../../../utils/trackBehavior')

Page({
  data: {
    statusBarHeight: 0,
    loading: true,
    orders: []
  },

  onLoad(options) {
    const systemInfo = wx.getSystemInfoSync()
    this.setData({ statusBarHeight: systemInfo.statusBarHeight || 0 })
    trackBehavior('pet_memorial_list_enter', 'from', options.from || 'direct')
  },

  onShow() {
    this.loadOrders()
  },

  async loadOrders() {
    this.setData({ loading: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'petMemorialOrder',
        data: { action: 'list' }
      })
      const list = (res.result && res.result.list) || []
      this.setData({
        loading: false,
        orders: list.map(mapOrderListItem).filter(Boolean)
      })
    } catch (e) {
      console.error('loadOrders', e)
      this.setData({ loading: false, orders: [] })
    }
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({ url: `/pages/custom/pet/status/index?id=${id}` })
  },

  goApply() {
    wx.navigateTo({ url: '/pages/custom/pet/index?from=list' })
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/user/index' }) })
  }
})
