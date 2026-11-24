/**
 * 购物车 Tab 与列表刷新辅助
 */
const { ensureOpenId } = require('./orderScope')

/**
 * 购物车角标的本地兜底（2026-11-25 产品负责人：点底部「我的」时红色角标消失）
 * 各 tab 是**不同的 custom-tab-bar 实例**，切页时新实例只能读 globalData；只要有一次
 * 失败刷新把 globalData 写成 0，角标就在新页面上消失。这里把「最后一次确认过的数量」落本地：
 *   - 明确的更新（updateCartTabBadge）才写；失败 / 未知（null）一律不写；
 *   - 同步时 globalData 是 0 而本地有正数、且不是本机退出态 → 用本地值恢复。
 */
const BADGE_KEY = 'cart_badge_count_v1'

function readSavedBadge() {
  try {
    const n = Number(wx.getStorageSync(BADGE_KEY))
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
  } catch (e) {
    return 0
  }
}

function saveBadge(n) {
  try { wx.setStorageSync(BADGE_KEY, Math.max(0, parseInt(n, 10) || 0)) } catch (e) { /* ignore */ }
}

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
  // 数量未知（null / undefined）不改：宁可保留旧角标，也不要把「拉取失败」显示成 0 件
  if (count == null) return
  const n = Math.max(0, parseInt(count, 10) || 0)
  saveBadge(n)
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
  if (!openid) return null
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
    return null
  }
}

async function refreshCartTabBadge(app) {
  const count = await fetchCartCount(app)
  updateCartTabBadge(count)
  return count
}

module.exports = {
  BADGE_KEY,
  readSavedBadge,
  saveBadge,
  ensureOpenId,
  markCartDirty,
  updateCartTabBadge,
  fetchCartCount,
  refreshCartTabBadge
}
