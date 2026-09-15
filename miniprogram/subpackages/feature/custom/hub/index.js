// subpackages/feature/custom/hub/index.js
// 兼容旧路径：标本工坊已提升为主包 Tab（pages/atelier）
Page({
  onLoad(options) {
    const from = (options && options.from) ? String(options.from) : 'legacy_hub'
    const q = from ? `?from=${encodeURIComponent(from)}` : ''
    wx.switchTab({
      url: '/pages/atelier/index',
      success: () => {
        // switchTab 无法带 query，用全局轻量标记供 onShow 统计（可选）
        try {
          const app = getApp()
          if (app && app.globalData) app.globalData.atelierEnterFrom = from
        } catch (e) { /* ignore */ }
      },
      fail: () => {
        wx.reLaunch({
          url: `/pages/atelier/index${q}`,
          fail: () => wx.showToast({ title: '无法打开标本工坊', icon: 'none' })
        })
      }
    })
  }
})
