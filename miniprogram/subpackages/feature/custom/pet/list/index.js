// subpackages/feature/custom/pet/list/index.js
const { mapOrderListItem } = require('../../../utils/petMemorialHelper')
const { trackBehavior } = require('../../../../../utils/trackBehavior')
const {
  fetchContentDisplayFlags,
  toastPetMemorialClosed
} = require('../../../../../utils/contentDisplayFlags')

Page({
  data: {
    statusBarHeight: 0,
    loading: true,
    allowed: true,
    canApply: true,
    orders: []
  },

  onLoad(options) {
    const systemInfo = wx.getSystemInfoSync()
    this.setData({ statusBarHeight: systemInfo.statusBarHeight || 0 })
    trackBehavior('pet_memorial_list_enter', 'from', options.from || 'direct')
    this.checkFlag()
  },

  onShow() {
    this.loadOrders()
  },

  async checkFlag() {
    try {
      const { flags } = await fetchContentDisplayFlags()
      const open = flags.showPetMemorial !== false
      this.setData({ allowed: open, canApply: open })
    } catch (e) {
      this.setData({ allowed: true, canApply: true })
    }
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
      wx.showToast({ title: '工单加载失败', icon: 'none' })
    }
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id
    if (!id) {
      wx.showToast({ title: '工单信息缺失', icon: 'none' })
      return
    }
    wx.navigateTo({
      url: `/subpackages/feature/custom/pet/status/index?id=${id}`,
      fail: () => wx.showToast({ title: '无法打开工单', icon: 'none' })
    })
  },

  goApply() {
    if (!this.data.canApply) {
      toastPetMemorialClosed()
      return
    }
    wx.navigateTo({
      url: '/subpackages/feature/custom/pet/index?from=list',
      fail: () => wx.showToast({ title: '无法打开申请页', icon: 'none' })
    })
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/atelier/index' }) })
  }
})
