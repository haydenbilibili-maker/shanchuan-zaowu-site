// subpackages/extra/user/onboarding/done.js
/**
 * 旧「注册完成」页：2026-10-11 起完成页并入注册页成功态（全局注册简化 S3）。
 * 本路径保留（app.json 登记、运营位 / 旧链接 / 历史分享仍指向这里），只做**带原参数**重定向。
 */
Page({
  onLoad(options) {
    const q = Object.keys(options || {})
      .filter((k) => k !== 'done')
      // 小程序 onLoad 拿到的 query 值未解码（旧完成页自己 decodeURIComponent），原样转交、不二次编码
      .map((k) => `${k}=${options[k]}`)
    const url = `/subpackages/extra/user/onboarding/index?${['done=1'].concat(q).join('&')}`
    wx.redirectTo({
      url,
      fail: () => wx.switchTab({ url: '/pages/index/index' })
    })
  }
})
