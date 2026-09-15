/**
 * 真机 scroll-view 高度计算（避免 flex:1 + height:0 导致内容不可见）
 */
function getWindowInsets() {
  try {
    const sys = wx.getWindowInfo()
    return {
      windowHeight: sys.windowHeight || sys.screenHeight || 667,
      windowWidth: sys.windowWidth || 375,
      safeBottom: (sys.safeAreaInsets && sys.safeAreaInsets.bottom) || 0
    }
  } catch (e) {
    return { windowHeight: 667, windowWidth: 375, safeBottom: 0 }
  }
}

function rpxToPx(rpx) {
  const { windowWidth } = getWindowInsets()
  return Math.ceil((Number(rpx) || 0) * windowWidth / 750)
}

/** 与 app.wxss --tabbar-offset 对齐：120rpx 内容区 + 安全区 */
function estimateTabBarPx() {
  const { safeBottom } = getWindowInsets()
  return rpxToPx(120) + safeBottom
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

/**
 * 计算 fixed scroll-view 的 top / height。
 * top 必须用顶部锚点的 viewport bottom（不能只用 height），
 * 否则会漏掉父级 padding-top（状态栏/胶囊避让），导致顶底同时错位。
 */
async function measureFixedScroll(page, options = {}) {
  const {
    topSelector = '.scroll-anchor-top',
    bottomSelector = '',
    bottomPx = 0,
    bottomOverhangPx = 0,
    fallbackTop = 120,
    fallbackBottom = 0
  } = options

  const { windowHeight } = getWindowInsets()
  const topRect = await measureRectFull(page, topSelector)

  let scrollTopPx = fallbackTop
  if (topRect) {
    if (topRect.bottom > 0) {
      scrollTopPx = Math.ceil(topRect.bottom)
    } else if (topRect.height) {
      scrollTopPx = Math.ceil(topRect.height)
    }
  }

  let scrollBottomPx = bottomPx
  if (bottomSelector) {
    const bottomRect = await measureRectFull(page, bottomSelector)
    if (bottomRect && bottomRect.top > 0) {
      // overhang：底栏上方绝对定位凸出物（如礼券 chip）
      scrollBottomPx = Math.max(
        0,
        windowHeight - Math.ceil(bottomRect.top) + (bottomOverhangPx || 0)
      )
    } else {
      const h = await measureRect(page, bottomSelector)
      if (h) scrollBottomPx += h + (bottomOverhangPx || 0)
    }
  }

  if (!scrollBottomPx) scrollBottomPx = fallbackBottom
  const scrollHeightPx = Math.max(200, windowHeight - scrollTopPx - scrollBottomPx)

  return { scrollTopPx, scrollBottomPx, scrollHeightPx }
}

module.exports = {
  getWindowInsets,
  estimateTabBarPx,
  rpxToPx,
  measureRect,
  measureRectFull,
  measureFixedScroll
}
