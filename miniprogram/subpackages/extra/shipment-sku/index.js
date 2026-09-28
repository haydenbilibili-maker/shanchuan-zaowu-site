/**
 * 旧「出货开单」路径 —— 重定向壳（2026-09-28 并入出货中心，见 admin/docs/出货中心_融合_2026-09-28.md）
 *
 * 路径保留在 app.json（冻结文件）里，旧书签 / 旧消息 / 旧转发仍能打开：
 * 一进来就 redirectTo 出货中心「开单」页签的「选 SKU」方式；权限由目标页 guardStaffPage 判定，
 * 店长落到「开单」的「粘贴识别」方式（SKU 开单仅超管），无写权限者落到「单据」。
 */
const TARGET = '/subpackages/extra/shipment-ops/index?tab=create&mode=sku'

Page({
  data: { failed: false },

  onLoad() {
    wx.redirectTo({
      url: TARGET,
      fail: () => this.setData({ failed: true })
    })
  },

  goCenter() {
    wx.redirectTo({ url: TARGET })
  },

  goBack() {
    wx.navigateBack({ delta: 1 })
  }
})
