const db = wx.cloud.database()
const {
  prepareWalletCoupon,
  sortWalletCoupons,
} = require('../../../utils/couponHelper')

Page({
  data: {
    coupons: [],
    usableCount: 0,
    loading: true,
  },

  onShow() {
    this.loadCoupons()
  },

  async loadCoupons() {
    wx.showLoading({ title: '加载中...' })
    try {
      let rows = []
      try {
        const res = await db.collection('user_coupons')
          .orderBy('status', 'asc')
          .orderBy('createTime', 'desc')
          .get()
        rows = res.data || []
      } catch (indexErr) {
        console.warn('user_coupons 索引降级', indexErr)
        const res = await db.collection('user_coupons').get()
        rows = res.data || []
      }

      const now = Date.now()
      const list = sortWalletCoupons(
        rows.map((item) => prepareWalletCoupon(item, now)),
      )
      const usableCount = list.filter((item) => item.isUsable).length

      this.setData({ coupons: list, usableCount, loading: false })
    } catch (err) {
      console.error('加载优惠券失败', err)
      if (err.errMsg && err.errMsg.includes('Collection not found')) {
        console.warn('请去云开发控制台创建 user_coupons 集合')
      }
      this.setData({ loading: false })
    } finally {
      wx.hideLoading()
    }
  },

  useCoupon(e) {
    const idx = e.currentTarget.dataset.index
    const coupon = this.data.coupons[idx]
    if (!coupon || !coupon.isUsable) {
      return wx.showToast({ title: '该礼券不可用', icon: 'none' })
    }

    wx.vibrateShort({ type: 'light' })
    wx.switchTab({
      url: '/pages/cart/index',
      success: () => {
        wx.showToast({
          title: '请先选择商品',
          icon: 'none',
          duration: 2000,
        })
      },
    })
  },

  goPoints() {
    wx.navigateTo({ url: '/subpackages/business/points/index' })
  },
})
