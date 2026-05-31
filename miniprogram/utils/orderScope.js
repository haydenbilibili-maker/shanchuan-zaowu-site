/**
 * 用户订单数据隔离 — 客户端查询必须限定当前用户 _openid
 */

function ensureOpenId(app) {
  const target = app || getApp()
  return new Promise((resolve) => {
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
        const openid = (res.result && res.result.openid) || ''
        if (openid && target && target.globalData) {
          target.globalData.openid = openid
        }
        resolve(openid)
      },
      fail: () => {
        let tries = 0
        const timer = setInterval(() => {
          if (target && target.globalData && target.globalData.openid) {
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

function isOrderOwnedBy(order, openid) {
  return !!(order && openid && order._openid === openid)
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
  denyOrderAccess
}
