/**
 * 运行平台判定
 *
 * 用途：iOS 端小程序不得使用微信支付购买虚拟货币/虚拟物品
 * （储值余额、虚拟权益等），需要在**前端**拦截（云函数不感知平台）。
 * 参考：《微信小程序平台运营规范》虚拟支付相关条款。
 */

let cachedPlatform = ''

/** 取运行平台字符串（ios / android / devtools / windows / mac …） */
function getPlatform() {
  if (cachedPlatform) return cachedPlatform
  try {
    if (typeof wx.getDeviceInfo === 'function') {
      const info = wx.getDeviceInfo()
      cachedPlatform = String((info && info.platform) || '')
    }
  } catch (e) {
    /* 旧基础库回退 */
  }
  if (!cachedPlatform) {
    try {
      const info = wx.getSystemInfoSync()
      cachedPlatform = String((info && info.platform) || '')
    } catch (e) {
      cachedPlatform = ''
    }
  }
  return cachedPlatform
}

/** 是否 iOS（含 iPadOS） */
function isIOS() {
  return /ios|ipad|iphone/i.test(getPlatform())
}

/**
 * 虚拟类交易是否允许当前平台发起。
 * 目前仅 iOS 受限；开发者工具按允许处理，便于开发调试。
 */
function allowVirtualPayment() {
  const p = getPlatform()
  if (!p || p === 'devtools') return true
  return !/ios|ipad|iphone/i.test(p)
}

module.exports = {
  getPlatform,
  isIOS,
  allowVirtualPayment
}
