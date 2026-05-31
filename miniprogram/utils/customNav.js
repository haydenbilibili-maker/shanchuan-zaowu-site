/**
 * 自定义导航栏布局 — 避让微信小程序右上角胶囊
 */
const { getWindowInfo } = require('./systemInfo')

function getCustomNavLayout() {
  const windowInfo = getWindowInfo()
  const menu = wx.getMenuButtonBoundingClientRect()
  const statusBarHeight = windowInfo.statusBarHeight || 0
  const windowWidth = windowInfo.windowWidth || 375
  const rpx = (n) => Math.round((n / 750) * windowWidth)

  const navPaddingRight = Math.max(16, windowWidth - menu.left + 8)
  const navBarHeight = (menu.top - statusBarHeight) * 2 + menu.height

  // 说明文案 + 全宽步骤条
  const mottoHeight = rpx(88)
  const stepBarHeight = rpx(148)
  const headerHeight = statusBarHeight + navBarHeight + mottoHeight + stepBarHeight

  return {
    statusBarHeight,
    navPaddingRight,
    navBarHeight,
    mottoHeight,
    stepBarHeight,
    headerHeight
  }
}

module.exports = { getCustomNavLayout }
