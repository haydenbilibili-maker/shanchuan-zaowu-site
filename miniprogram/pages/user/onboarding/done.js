// pages/user/onboarding/done.js
const { getPageNavInsets, rpxToPx } = require('../../../utils/pageNav')
const { getWindowInfo } = require('../../../utils/systemInfo')

Page({
  data: {
    hasReward: false,
    displayName: '',
    pagePadTop: 80,
    pagePadBottom: 32,
    pagePadX: 32
  },

  onLoad(options) {
    const nav = getPageNavInsets()
    const win = getWindowInfo()
    const rawName = options.name ? decodeURIComponent(options.name) : ''
    this.setData({
      hasReward: options.reward === '1',
      displayName: rawName && rawName !== '未登录用户' ? rawName : '',
      pagePadTop: nav.headerBlockPx + rpxToPx(48, win.windowWidth),
      pagePadBottom: nav.safeBottom + rpxToPx(32, win.windowWidth),
      pagePadX: rpxToPx(32, win.windowWidth)
    })
  },

  goProfile() {
    wx.redirectTo({ url: '/pages/user/profile/index' })
  },

  goHome() {
    wx.switchTab({ url: '/pages/user/index' })
  }
})
