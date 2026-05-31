/**
 * 真机 scroll-view 高度计算（避免 flex:1 + height:0 导致内容不可见）
 */
function getWindowInsets() {
  try {
    const sys = wx.getWindowInfo()
    return {
      windowHeight: sys.windowHeight || sys.screenHeight || 667,
      safeBottom: (sys.safeAreaInsets && sys.safeAreaInsets.bottom) || 0
    }
  } catch (e) {
    return { windowHeight: 667, safeBottom: 0 }
  }
}

function estimateTabBarPx() {
  const { safeBottom } = getWindowInsets()
  return 50 + safeBottom
}

function measureRect(page, selector) {
  return new Promise((resolve) => {
    wx.nextTick(() => {
      wx.createSelectorQuery()
        .in(page)
        .select(selector)
        .boundingClientRect((rect) => {
          resolve(rect && rect.height ? Math.ceil(rect.height) : 0)
        })
        .exec()
    })
  })
}

function measureRectFull(page, selector) {
  return new Promise((resolve) => {
    wx.nextTick(() => {
      wx.createSelectorQuery()
        .in(page)
        .select(selector)
        .boundingClientRect((rect) => {
          resolve(rect || null)
        })
        .exec()
    })
  })
}

async function measureFixedScroll(page, options = {}) {
  const {
    topSelector = '.scroll-anchor-top',
    bottomSelector = '',
    bottomPx = 0,
    fallbackTop = 120,
    fallbackBottom = 0
  } = options

  const { windowHeight } = getWindowInsets()
  const topHeight = await measureRect(page, topSelector)

  let scrollBottomPx = bottomPx
  if (bottomSelector) {
    const bottomRect = await measureRectFull(page, bottomSelector)
    if (bottomRect && bottomRect.top > 0) {
      scrollBottomPx = Math.max(0, windowHeight - Math.ceil(bottomRect.top))
    } else {
      const h = await measureRect(page, bottomSelector)
      if (h) scrollBottomPx += h
    }
  }

  const scrollTopPx = topHeight || fallbackTop
  if (!scrollBottomPx) scrollBottomPx = fallbackBottom
  const scrollHeightPx = Math.max(200, windowHeight - scrollTopPx - scrollBottomPx)

  return { scrollTopPx, scrollBottomPx, scrollHeightPx }
}

module.exports = {
  getWindowInsets,
  estimateTabBarPx,
  measureRect,
  measureRectFull,
  measureFixedScroll
}
