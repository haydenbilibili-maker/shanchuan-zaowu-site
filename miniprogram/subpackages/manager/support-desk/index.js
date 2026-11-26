/**
 * 客服工作台旧路径跳转壳（2026-11-27）：页面已迁到 subpackages/ai/support-desk（manager 分包余量不足）。
 * 已经发出去的「工作信息」「留言还没回复」深链仍指向这里 —— 原样带上参数跳到新页，不让旧消息点进来是空白。
 */
const NEW_PATH = '/subpackages/ai/support-desk/index'

Page({
  onLoad(options) {
    const qs = Object.keys(options || {}).map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(options[k])}`).join('&')
    const url = qs ? `${NEW_PATH}?${qs}` : NEW_PATH
    wx.redirectTo({ url, fail: () => wx.navigateTo({ url, fail: () => wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/user/index' }) }) }) })
  }
})
