Component({
  properties: {
    /** wallet | coupons */
    active: {
      type: String,
      value: 'wallet'
    },
    /** 可用券张数；>0 时在「券夹」角标显示 */
    couponCount: {
      type: Number,
      value: 0
    }
  },

  methods: {
    onTap(e) {
      const tab = (e.currentTarget.dataset && e.currentTarget.dataset.tab) || ''
      if (!tab || tab === this.data.active) return
      try {
        wx.vibrateShort({ type: 'light' })
      } catch (err) { /* ignore */ }

      const url = tab === 'coupons'
        ? '/subpackages/business/coupons/index'
        : '/subpackages/extra/user/stored-value/index'

      wx.redirectTo({
        url,
        fail: () => {
          wx.navigateTo({
            url,
            fail: () => wx.showToast({ title: '页面暂不可用', icon: 'none' })
          })
        }
      })
    }
  }
})
