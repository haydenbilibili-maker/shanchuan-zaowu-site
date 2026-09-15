/**
 * 兼容旧「我的预约」路由：合并进预约参观页「我的预约」Tab，避免断链。
 * 深度链接 / 站内信 / 票据返回仍可打开本页，随即 redirect。
 */
Page({
  onLoad(options) {
    const histRaw = options && options.historyTab;
    const histIdx = histRaw != null && histRaw !== '' ? parseInt(histRaw, 10) : 0;
    const historyTab = !isNaN(histIdx) && histIdx >= 0 && histIdx <= 1 ? histIdx : 0;

    let storeQ = '';
    try {
      const { getPreferredStoreId } = require('../../../utils/storeHelper');
      const storeId = getPreferredStoreId();
      if (storeId) storeQ = `&storeId=${encodeURIComponent(storeId)}`;
    } catch (e) {
      // ignore
    }

    const url = `/subpackages/business/booking/index?tab=3&historyTab=${historyTab}&from=my-bookings${storeQ}`;
    wx.redirectTo({
      url,
      fail: () => {
        wx.reLaunch({
          url,
          fail: () => wx.switchTab({ url: '/pages/user/index' })
        });
      }
    });
  }
});
