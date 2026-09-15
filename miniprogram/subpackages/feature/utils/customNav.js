/**
 * 自定义导航栏布局 — 避让微信小程序右上角胶囊
 */
const { getWindowInfo } = require('../../../utils/systemInfo')

function getMenuRect(windowWidth) {
  try {
    const menu = wx.getMenuButtonBoundingClientRect()
    if (menu && menu.width) return menu
  } catch (e) { /* ignore */ }
  const w = windowWidth || 375
  return { left: w - 96, top: 48, height: 32, width: 87, right: w - 9, bottom: 80 }
}

function getCustomNavLayout() {
  const windowInfo = getWindowInfo()
  const statusBarHeight = windowInfo.statusBarHeight || 0
  const windowWidth = windowInfo.windowWidth || 375
  const menu = getMenuRect(windowWidth)
  const rpx = (n) => Math.round((n / 750) * windowWidth)

  // 与胶囊左缘对齐：自定义右侧控件不得越过 menu.left
  const navPaddingRight = Math.max(16, windowWidth - menu.left + 8)
  const navBarHeight = menu.height
    ? Math.max(32, (menu.top - statusBarHeight) * 2 + menu.height)
    : 44

  // 说明文案 + 全宽步骤条
  const mottoHeight = rpx(88)
  const stepBarHeight = rpx(148)
  const headerHeight = statusBarHeight + navBarHeight + mottoHeight + stepBarHeight

  return {
    statusBarHeight,
    navPaddingRight,
    navBarHeight,
    menuTop: menu.top || statusBarHeight,
    menuHeight: menu.height || 32,
    mottoHeight,
    stepBarHeight,
    headerHeight
  }
}

module.exports = { getCustomNavLayout, getMenuRect }
