/**
 * 写后精准失效：下单 / 领券 / 改档案后清相关缓存，勿整库清光。
 */

const { invalidate } = require('../../../utils/cache')

function getAppSafe() {
  try {
    return getApp()
  } catch (e) {
    return null
  }
}

/** 下单/支付成功：列表与会话可能变，价格库存以服务端为准 */
function invalidateAfterOrder() {
  invalidate(['NEW_ARRIVALS', 'RECOMMENDATIONS', 'COLLECTIONS', 'PRODUCT_DETAIL_*'])
  try {
    const { invalidateProductDetail } = require('../../../utils/productDetailCache')
    invalidateProductDetail()
  } catch (e) { /* ignore */ }
  const app = getAppSafe()
  if (app && app.globalData) {
    app.globalData.userSession = null
    app.globalData.refreshCart = true
    app.globalData.forceUserRefresh = true
  }
  try {
    wx.removeStorageSync('member_vip_card_snapshot_v1')
  } catch (e) { /* ignore */ }
}

/** 领券/兑券成功 */
function invalidateAfterCoupon() {
  const app = getAppSafe()
  if (app && app.globalData) {
    app.globalData.userSession = null
    app.globalData.forceUserRefresh = true
  }
}

/** 改档案 / 头像 / 兴趣等 */
function invalidateAfterProfile() {
  const app = getAppSafe()
  if (app && app.globalData) {
    app.globalData.userSession = null
    app.globalData.forceUserRefresh = true
  }
  try {
    wx.removeStorageSync('member_vip_card_snapshot_v1')
  } catch (e) { /* ignore */ }
}

/** 门店配置后台变更后（一般 C 端不调；管理端可调） */
function invalidateStoreSide() {
  try {
    const { invalidateStoreCatalog } = require('../../../utils/storeCatalog')
    invalidateStoreCatalog()
  } catch (e) { /* ignore */ }
}

/** 内容开关后台变更后 */
function invalidateFlags() {
  try {
    const { invalidateContentDisplayFlags } = require('../../../utils/contentDisplayFlags')
    invalidateContentDisplayFlags()
  } catch (e) { /* ignore */ }
}

module.exports = {
  invalidateAfterOrder,
  invalidateAfterCoupon,
  invalidateAfterProfile,
  invalidateStoreSide,
  invalidateFlags
}
