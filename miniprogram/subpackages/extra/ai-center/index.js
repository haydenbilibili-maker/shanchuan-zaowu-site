/**
 * 旧地址跳转（2026-11-23 智能运营中心迁到独立分包 subpackages/ai）：
 * 已发出的工作信息、旧版入口仍指向 subpackages/extra/ai-center，这里原样带参数转到新地址，避免旧链接失效。
 * 不改受保护的 utils/messageHelper（其 remapMovedSubpackage 不动）。
 */
Page({
  onLoad(options) {
    const q = Object.keys(options || {}).map((k) => `${k}=${encodeURIComponent(options[k])}`).join('&')
    wx.redirectTo({ url: `/subpackages/ai/ai-center/index${q ? '?' + q : ''}` })
  }
})
