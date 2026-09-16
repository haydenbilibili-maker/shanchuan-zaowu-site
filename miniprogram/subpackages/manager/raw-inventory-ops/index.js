/**
 * 兼容旧路径：原材料独立页 → 跳转库存管理 · 原材料 Tab
 */
Page({
  onLoad() {
    wx.redirectTo({
      url: '/subpackages/extra/inventory-ops/index?tab=raw',
      fail: () => {
        wx.navigateTo({
          url: '/subpackages/extra/inventory-ops/index?tab=raw',
          fail: () => wx.showToast({ title: '库存管理暂不可用', icon: 'none' })
        })
      }
    })
  }
})
