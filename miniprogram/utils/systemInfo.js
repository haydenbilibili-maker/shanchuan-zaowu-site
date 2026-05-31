/**
 * 系统信息 — 兼容新 API，降级 getSystemInfoSync
 */
function getWindowInfo() {
  try {
    if (wx.getWindowInfo) return wx.getWindowInfo();
  } catch (e) {}
  try {
    const s = wx.getSystemInfoSync();
    return {
      statusBarHeight: s.statusBarHeight || 0,
      windowWidth: s.windowWidth || s.screenWidth || 375,
      windowHeight: s.windowHeight || s.screenHeight || 667,
      pixelRatio: s.pixelRatio || 2,
      safeArea: s.safeArea
    };
  } catch (e) {
    return { statusBarHeight: 0, windowWidth: 375, windowHeight: 667, pixelRatio: 2 };
  }
}

function getDeviceInfo() {
  try {
    if (wx.getDeviceInfo) return wx.getDeviceInfo();
  } catch (e) {}
  try {
    const s = wx.getSystemInfoSync();
    return { platform: s.platform || '', model: s.model || '', system: s.system || '' };
  } catch (e) {
    return { platform: '', model: '', system: '' };
  }
}

function getAppBaseInfo() {
  try {
    if (wx.getAppBaseInfo) return wx.getAppBaseInfo();
  } catch (e) {}
  try {
    const s = wx.getSystemInfoSync();
    return { version: s.version || '', SDKVersion: s.SDKVersion || '' };
  } catch (e) {
    return { version: '', SDKVersion: '' };
  }
}

function getSystemSnapshot() {
  const win = getWindowInfo();
  const dev = getDeviceInfo();
  const app = getAppBaseInfo();
  return {
    statusBarHeight: win.statusBarHeight || 0,
    windowWidth: win.windowWidth || 375,
    windowHeight: win.windowHeight || 667,
    pixelRatio: win.pixelRatio || 2,
    platform: dev.platform || '',
    model: dev.model || '',
    version: app.version || '',
    SDKVersion: app.SDKVersion || ''
  };
}

module.exports = {
  getWindowInfo,
  getDeviceInfo,
  getAppBaseInfo,
  getSystemSnapshot
};
