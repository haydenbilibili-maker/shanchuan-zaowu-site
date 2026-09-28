/**
 * 兼容旧路径：原材料独立页 → 跳转库存管理 · 原材料 Tab
 * 体验收口：真实空错态在 inventory-ops；本页仅跳转壳。
 */
Page({
  data: {
    tipTone: 'warn',
    tipText: ''
  },

  onLoad() {
    const url = '/subpackages/extra/inventory-ops/index?tab=raw'
    wx.redirectTo({
      url,
      fail: () => {
        wx.navigateTo({
          url,
          fail: () => {
            this.setData({
              tipText: '库存管理暂不可用：请从超管工作台打开「库存管理」→ 明细 → 原材料'
            })
          }
        })
      }
    })
  },

  onRetry() {
    this.setData({ tipText: '' })
    this.onLoad()
  }
})
