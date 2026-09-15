/**
 * 用户订单数据隔离 — 客户端查询必须限定当前用户
 * 礼赠：送礼人（_openid）与已绑定受赠人（giftMeta.receiverOpenid）均可查看履约/物流
 */

function isLocalLoggedOutSafe() {
  try {
    const { isLocalLoggedOut } = require('./userSession')
    return !!isLocalLoggedOut()
  } catch (e) {
    return false
  }
}

function ensureOpenId(app) {
  const target = app || getApp()
  return new Promise((resolve) => {
    // 本机已退出：不得静默 login 回填 OPENID，否则券夹/亮码等仍会识别账号
    if (isLocalLoggedOutSafe()) {
      resolve('')
      return
    }
    if (target && target.globalData && target.globalData.openid) {
      resolve(target.globalData.openid)
      return
    }
    if (!wx.cloud) {
      resolve('')
      return
    }
    wx.cloud.callFunction({
      name: 'login',
      success: (res) => {
        if (isLocalLoggedOutSafe()) {
          resolve('')
          return
        }
        const openid = (res.result && res.result.openid) || ''
        if (openid && target && target.globalData) {
          target.globalData.openid = openid
        }
        resolve(openid)
      },
      fail: () => {
        let tries = 0
        const timer = setInterval(() => {
          if (isLocalLoggedOutSafe()) {
            clearInterval(timer)
            resolve('')
          } else if (target && target.globalData && target.globalData.openid) {
            clearInterval(timer)
            resolve(target.globalData.openid)
          } else if (++tries >= 50) {
            clearInterval(timer)
            resolve('')
          }
        }, 100)
      }
    })
  })
}

/** 下单人 / 付款人 */
function isOrderOwnedBy(order, openid) {
  return !!(
    order &&
    openid &&
    (order._openid === openid || order.openid === openid)
  )
}

/** 礼赠已绑定的受赠人 */
function isGiftReceiverOf(order, openid) {
  if (!order || !openid) return false
  const meta = order.giftMeta || {}
  return !!(meta.receiverOpenid && meta.receiverOpenid === openid)
}

/** 可查看订单详情 / 物流 / 证书（送礼人或受赠人） */
function canAccessOrder(order, openid) {
  return isOrderOwnedBy(order, openid) || isGiftReceiverOf(order, openid)
}

function denyOrderAccess() {
  wx.showToast({ title: '无权查看此订单', icon: 'none' })
  setTimeout(() => {
    wx.navigateBack({
      delta: 1,
      fail: () => {
        wx.redirectTo({ url: '/subpackages/business/orders/index' })
      }
    })
  }, 1500)
}

module.exports = {
  ensureOpenId,
  isOrderOwnedBy,
  isGiftReceiverOf,
  canAccessOrder,
  denyOrderAccess
}
