/**
 * 定位：未授权时不主动弹窗（提审要求：勿在启动时无说明地索取位置）。
 * 仅当用户已授权 scope.userLocation 时读取坐标。
 */
function getAuthorizedLocation(options = {}) {
  const type = options.type || 'gcj02'
  return new Promise((resolve) => {
    wx.getSetting({
      success: (setting) => {
        const granted = setting.authSetting && setting.authSetting['scope.userLocation'] === true
        if (!granted) {
          resolve(null)
          return
        }
        wx.getLocation({
          type,
          success: (res) => resolve(res),
          fail: () => resolve(null)
        })
      },
      fail: () => resolve(null)
    })
  })
}

module.exports = { getAuthorizedLocation }
