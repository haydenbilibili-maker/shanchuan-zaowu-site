/**
 * Museum Mode 页面窗口底色 — 降低 iOS switchTab 白闪
 * backgroundColor* 控制窗口回弹区；配合页面 json 的 backgroundColorContent
 */
const MUSEUM_BG = '#1A1814';

function applyMuseumPageChrome() {
  try {
    if (typeof wx.setBackgroundColor === 'function') {
      wx.setBackgroundColor({
        backgroundColor: MUSEUM_BG,
        backgroundColorTop: MUSEUM_BG,
        backgroundColorBottom: MUSEUM_BG
      });
    }
  } catch (e) {
    /* ignore */
  }
}

module.exports = {
  MUSEUM_BG,
  applyMuseumPageChrome
};
