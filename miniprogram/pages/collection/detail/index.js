// 复用鉴定结果页展示，直接重定向
Page({
  onLoad(options) {
    if (options.record_id) {
      wx.redirectTo({
        url: `/pages/identify/result/index?record_id=${options.record_id}`
      })
      return
    }
    wx.showToast({ title: '缺少记录', icon: 'none' })
    setTimeout(() => wx.navigateBack({ fail: () => wx.redirectTo({ url: '/pages/collection/index' }) }), 400)
  }
})
