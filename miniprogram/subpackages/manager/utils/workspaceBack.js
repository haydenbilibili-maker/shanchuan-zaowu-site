/**
 * 独立工作台根页 / 子页统一离开逻辑（对齐 manager leaveWorkbench + guardStaffPage 回退）
 * 栈深 > 1：navigateBack；否则 switchTab/reLaunch 到「我的」或指定 Tab。
 */
const DEFAULT_FALLBACK = '/pages/user/index'

function fallbackLeaveWorkbench(fallbackUrl) {
  const url = fallbackUrl || DEFAULT_FALLBACK
  wx.switchTab({
    url,
    fail: () => {
      wx.reLaunch({ url })
    }
  })
}

/**
 * @param {{ fallbackUrl?: string, vibrate?: boolean }} [options]
 */
function leaveWorkbench(options = {}) {
  const { fallbackUrl = DEFAULT_FALLBACK, vibrate = true } = options
  if (vibrate) {
    try {
      wx.vibrateShort({ type: 'light' })
    } catch (e) { /* ignore */ }
  }
  const stack = typeof getCurrentPages === 'function' ? getCurrentPages() : []
  if (stack && stack.length > 1) {
    wx.navigateBack({
      delta: 1,
      fail: () => fallbackLeaveWorkbench(fallbackUrl)
    })
    return
  }
  fallbackLeaveWorkbench(fallbackUrl)
}

module.exports = {
  DEFAULT_FALLBACK,
  leaveWorkbench,
  fallbackLeaveWorkbench
}
