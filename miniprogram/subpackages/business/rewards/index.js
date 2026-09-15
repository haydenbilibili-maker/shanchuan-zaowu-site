const { pickWalletTab, urlForTab } = require('../../../utils/rewardsNav')

Page({
  data: {},

  onLoad(options) {
    this._route(options || {})
  },

  async _route(options) {
    // 旧「积分与券」路由：默认进钱包枢纽（有可用券则券夹）
    const tab = await pickWalletTab({ tab: options.tab })
    const url = urlForTab(tab === 'points' ? 'wallet' : tab)
    wx.redirectTo({
      url,
      fail: () => {
        wx.navigateTo({
          url,
          fail: () => {
            wx.showToast({ title: '页面暂不可用', icon: 'none' })
            setTimeout(() => wx.navigateBack({ fail: () => {} }), 400)
          }
        })
      }
    })
  }
})
