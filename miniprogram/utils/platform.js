/**
 * 运行平台判定
 *
 * ⚠️ 关于虚拟支付（重要历史，2026-09-16 更正）
 *
 * 本文件最初（commit b424752，2026-09-15 提审前自审）以「iOS 端小程序不得使用
 * 微信支付购买虚拟货币」为由，给储值充值加了**硬编码拦截**。但该自审报告自述
 * 「抓不到微信官方文档、依据待确认」—— 即该约束**未经核实，并非平台已确认硬规则**。
 *
 * 现状态：iOS 储值充值限制已改为**超管可控开关**
 *   content_display_flags.allowIosStoredValue（默认 true = 不限制）
 * 页面侧由 `stored-value/index.js#isRechargeAllowed()` 消费；本文件只提供平台判定原语。
 * `allowVirtualPayment()` 保留为「若需重新限制时的判定依据」，当前**无调用方**
 * （有意保留，勿当死代码删除）。
 *
 * 若后续合规复核确认虚拟支付确需限制，请优先用上述开关关闭，
 * 而不是把硬编码拦截重新加回页面。
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
