// pages/user/legal/index.js
const { getLegalDoc } = require('../../../utils/legalContent')
const { getPageNavInsets } = require('../../../utils/pageNav')
const { measureFixedScroll } = require('../../../utils/scrollArea')

Page({
  data: {
    statusBarHeight: 20,
    navPaddingRight: 16,
    headerBlockPx: 88,
    scrollHeightPx: 500,
    doc: {
      title: '用户服务协议',
      subtitle: 'TERMS OF SERVICE',
      updatedAt: '',
      sections: []
    }
  },

  onLoad(options) {
    const type = options.type === 'privacy' ? 'privacy' : 'terms'
    const doc = getLegalDoc(type)
    this.setData({ doc })
    wx.setNavigationBarTitle({ title: doc.title })

    const nav = getPageNavInsets()
    this.setData({
      statusBarHeight: nav.statusBarHeight,
      navPaddingRight: nav.navPaddingRight,
      headerBlockPx: nav.headerBlockPx
    })
  },

  onReady() {
    this.remeasureScroll()
  },

  async remeasureScroll() {
    const fallback = getPageNavInsets().headerBlockPx
    const area = await measureFixedScroll(this, {
      topSelector: '.account-nav',
      fallbackTop: fallback
    })
    this.setData({
      headerBlockPx: area.scrollTopPx,
      scrollHeightPx: area.scrollHeightPx
    })
  },

  goBack() {
    wx.navigateBack({
      fail: () => wx.switchTab({ url: '/pages/user/index' })
    })
  }
})
