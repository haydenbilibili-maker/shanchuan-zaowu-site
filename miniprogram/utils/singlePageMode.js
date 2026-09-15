/**
 * 微信朋友圈「单页模式」检测与交互守卫。
 * 官方：从朋友圈打开分享页会进入单页预览（scene=1154），
 * 需点底部「前往小程序」才进入完整会话（scene=1155）。
 * @see https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/share-timeline.html
 */

const SINGLE_PAGE_SCENE = 1154;
const FROM_SINGLE_PAGE_SCENE = 1155;

function readEnterOptions() {
  try {
    if (typeof wx.getEnterOptionsSync === 'function') {
      return wx.getEnterOptionsSync() || {};
    }
  } catch (e) { /* ignore */ }
  try {
    if (typeof wx.getLaunchOptionsSync === 'function') {
      return wx.getLaunchOptionsSync() || {};
    }
  } catch (e) { /* ignore */ }
  return {};
}

function resolveScene(options) {
  if (options && options.scene != null && options.scene !== '') {
    const n = Number(options.scene);
    if (!Number.isNaN(n)) return n;
  }
  const enter = readEnterOptions();
  const n = Number(enter && enter.scene);
  return Number.isNaN(n) ? 0 : n;
}

function isSinglePageMode(options) {
  return resolveScene(options) === SINGLE_PAGE_SCENE;
}

function toastOpenFullMiniProgram() {
  wx.showToast({
    title: '请点击下方「前往小程序」使用完整服务',
    icon: 'none',
    duration: 2200
  });
}

/** @returns {boolean} true = 已拦截，调用方应直接 return */
function blockIfSinglePage(options) {
  if (!isSinglePageMode(options)) return false;
  toastOpenFullMiniProgram();
  return true;
}

module.exports = {
  SINGLE_PAGE_SCENE,
  FROM_SINGLE_PAGE_SCENE,
  readEnterOptions,
  resolveScene,
  isSinglePageMode,
  blockIfSinglePage,
  toastOpenFullMiniProgram
};
