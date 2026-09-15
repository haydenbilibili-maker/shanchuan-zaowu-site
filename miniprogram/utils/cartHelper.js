/**
 * 购物车 Tab 与列表刷新辅助
 */
const { ensureOpenId } = require('./orderScope')

function markCartDirty(app) {
  const target = app || getApp()
  if (target && target.globalData) {
    target.globalData.refreshCart = true
  }
}

function getTabBarInstance() {
  const pages = getCurrentPages()
  for (let i = pages.length - 1; i >= 0; i -= 1) {
    const page = pages[i]
    if (page && typeof page.getTabBar === 'function') {
      const tabBar = page.getTabBar()
      if (tabBar) return tabBar
    }
  }
  return null
}

function updateCartTabBadge(count) {
  const n = Math.max(0, parseInt(count, 10) || 0)
  try {
    const app = getApp()
    if (app.globalData) app.globalData.cartBadgeCount = n
  } catch (e) { /* ignore */ }

  const tabBar = getTabBarInstance()
  if (tabBar && typeof tabBar.setCartBadge === 'function') {
    tabBar.setCartBadge(n)
  }
}

async function fetchCartCount(app) {
  if (!wx.cloud) return 0
  try {
    const res = await wx.cloud.callFunction({
      name: 'getCartList',
      data: { action: 'count' }
    })
    if (res.result && res.result.success) {
      return res.result.total || 0
    }
  } catch (e) {
    console.warn('fetchCartCount cloud failed', e)
  }

  const openid = await ensureOpenId(app || getApp())
  if (!openid) return 0
  try {
    const db = wx.cloud.database()
    const res = await db.collection('collections').where({ _openid: openid }).limit(100).get()
    const list = (res.data || []).filter((item) => {
      if (!item || item.type === 'wishlist' || item.type === 'favorite') return false
      return !item.type || item.type === 'product' || item.type === 'activity' || item.type === 'course'
    })
    return list.length
  } catch (e) {
    console.warn('fetchCartCount failed', e)
    return 0
  }
}

async function refreshCartTabBadge(app) {
  const count = await fetchCartCount(app)
  updateCartTabBadge(count)
  return count
}

module.exports = {
  ensureOpenId,
  markCartDirty,
  updateCartTabBadge,
  fetchCartCount,
  refreshCartTabBadge
}
