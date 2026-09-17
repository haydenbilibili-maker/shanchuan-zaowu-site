Component({
  properties: {
    /** 页头大标题（三页共用同一份几何：标题在 tab 条之上，tab 条位置由构造保证一致） */
    title: { type: String, value: '我的钱包' },
    /** 页头小字（WALLET / COUPONS / POINTS） */
    overline: { type: String, value: 'WALLET' },
    /** wallet | coupons | points */
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

      // 三个并列 tab：钱包 / 礼券夹 / 积分
      const url = tab === 'coupons'
        ? '/subpackages/business/coupons/index'
        : (tab === 'points'
          ? '/subpackages/business/points/index'
          : '/subpackages/extra/user/stored-value/index')

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
