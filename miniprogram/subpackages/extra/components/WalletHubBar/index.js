Component({
  properties: {
    /** 页头大标题（三页共用同一份几何：标题在 tab 条之上，tab 条位置由构造保证一致） */
    title: { type: String, value: '我的钱包' },
    /** 页头小字（WALLET / COUPONS / POINTS） */
    overline: { type: String, value: 'WALLET' },
    /** 宿主页（钱包枢纽）内使用：true = 只派发 tabchange，由页面**页内切面板**（无转场）；
     *  false/未传 = 沿用原行为 redirectTo 跳对应页面（尚未并入枢纽的页面照旧可用） */
    inline: { type: Boolean, value: false },
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
      if (!tab || tab === this.properties.active) return
      try {
        wx.vibrateShort({ type: 'light' })
      } catch (err) { /* ignore */ }

      // 2026-09-17：枢纽页内 → 只派发事件，由页面切面板（丝滑无感，无页面转场）
      if (this.properties.inline) {
        this.triggerEvent('tabchange', { tab })
        return
      }

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
