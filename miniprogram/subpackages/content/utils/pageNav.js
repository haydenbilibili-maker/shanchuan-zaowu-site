/**
 * 页面导航避让 — 微信小程序右上角胶囊
 */
const { getWindowInfo } = require('../../../utils/systemInfo')

function getMenuRect() {
  try {
    const menu = wx.getMenuButtonBoundingClientRect()
    if (menu && menu.width) return menu
  } catch (e) { /* ignore */ }
  return { left: 281, top: 48, height: 32, width: 87, right: 368 }
}

function rpxToPx(rpx, windowWidth) {
  return Math.round((rpx / 750) * (windowWidth || 375))
}

function getPageNavInsets(options = {}) {
  const win = getWindowInfo()
  const menu = getMenuRect()
  const statusBarHeight = win.statusBarHeight || 0
  const windowWidth = win.windowWidth || 375
  const windowHeight = win.windowHeight || 667
  const safeBottom = (win.safeAreaInsets && win.safeAreaInsets.bottom) || 0

  const navPaddingRight = Math.max(16, windowWidth - menu.left + 8)
  const navContentHeight = menu.height
    ? Math.max(44, (menu.top - statusBarHeight) * 2 + menu.height)
    : 44

  const headerExtraRpx = options.headerExtraRpx || 0
  const headerExtraPx = rpxToPx(headerExtraRpx, windowWidth)
  const nativeNav = options.nativeNav === true
  const headerBlockPx = nativeNav
    ? Math.ceil(headerExtraPx)
    : Math.ceil(statusBarHeight + navContentHeight + headerExtraPx)

  const footerRpx = options.footerRpx || 0
  const footerPx = footerRpx ? rpxToPx(footerRpx, windowWidth) + safeBottom : safeBottom

  const scrollHeightPx = Math.max(200, windowHeight - headerBlockPx - footerPx)

  return {
    statusBarHeight,
    navPaddingRight,
    navBarHeight: navContentHeight,
    navMenuHeight: menu.height || 32,
    headerBlockPx,
    footerPx,
    scrollHeightPx,
    safeBottom,
    windowHeight
  }
}

module.exports = {
  getMenuRect,
  rpxToPx,
  getPageNavInsets
}
