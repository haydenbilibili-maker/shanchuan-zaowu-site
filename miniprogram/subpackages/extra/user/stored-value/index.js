/**
 * 旧「我的钱包」页 —— 2026-09-17 起并入钱包枢纽（subpackages/business/wallet-hub）。
 * 本页保留为**薄跳转壳**：pages/user 的「我的钱包」入口、站内信 / 分享 / 收藏 / 历史链接
 * 里的旧路径落点都不失效。
 */
Page({
  onLoad(options) {
    const q = []
    Object.keys(options || {}).forEach((k) => {
      if (k === 'tab') return
      q.push(`${encodeURIComponent(k)}=${encodeURIComponent(options[k])}`)
    })
    q.unshift('tab=wallet')
    wx.redirectTo({
      url: `/subpackages/business/wallet-hub/index?${q.join('&')}`,
      fail: () => wx.showToast({ title: '页面暂不可用', icon: 'none' })
    })
  }
})
