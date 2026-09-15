/**
 * 店长/超管查物流专用页（business 分包声明 logisticsPlugin）
 * 不走 C 端订单详情所有权校验，凭 waybillToken 或 orderId+ensureWxExpress 打开官方轨迹。
 */
let logisticsPlugin = null;
try {
  logisticsPlugin = requirePlugin('logisticsPlugin');
} catch (err) {
  console.warn('[logistics-track] logisticsPlugin 未就绪', err);
}

Page({
  data: {
    statusTitle: '正在打开物流轨迹…',
    statusSub: '',
    trackingNumber: '',
    carrier: '',
    showFallback: false
  },

  onLoad(options) {
    const token = decodeURIComponent(String((options && options.token) || '').trim());
    const orderId = String((options && options.orderId) || (options && options.id) || '').trim();
    const trackingNumber = decodeURIComponent(String((options && options.no) || '').trim());
    const carrier = decodeURIComponent(String((options && options.carrier) || '').trim());
    this.setData({
      trackingNumber,
      carrier: carrier || '快递'
    });
    this._boot({ token, orderId, trackingNumber, carrier });
  },

  async _boot({ token, orderId, trackingNumber, carrier }) {
    let waybillToken = String(token || '').trim();

    if (!waybillToken && orderId && wx.cloud) {
      this.setData({ statusTitle: '同步物流凭证…', statusSub: '请稍候' });
      try {
        const res = await wx.cloud.callFunction({
          name: 'managerShipOrder',
          data: { action: 'ensureWxExpress', orderId, force: true }
        });
        const result = (res && res.result) || {};
        if (result.msg === '无权操作' || /无权限|无权/.test(String(result.msg || ''))) {
          this._fail('暂无查件权限', '请确认当前账号为店长或超管后重试。');
          return;
        }
        waybillToken = String(result.waybillToken || '').trim();
        if (!trackingNumber && result.trackingNumber) {
          this.setData({ trackingNumber: String(result.trackingNumber) });
        }
      } catch (err) {
        console.warn('[logistics-track] ensureWxExpress', err);
        this._fail(
          '同步物流失败',
          (err && (err.errMsg || err.message)) || '请稍后重试，或复制运单号到快递服务查询。'
        );
        return;
      }
    }

    if (waybillToken && logisticsPlugin && typeof logisticsPlugin.openWaybillTracking === 'function') {
      try {
        logisticsPlugin.openWaybillTracking({ waybillToken });
        this.setData({
          statusTitle: '已打开物流轨迹',
          statusSub: '若未自动弹出，请返回后重试。',
          showFallback: !!this.data.trackingNumber
        });
        return;
      } catch (err) {
        console.warn('[logistics-track] openWaybillTracking', err);
      }
    }

    if (waybillToken && !logisticsPlugin) {
      this._fail(
        '轨迹组件未加载',
        '请确认小程序已添加物流查询插件（wx9ad912bf20548d92）并开通查询组件。'
      );
      return;
    }

    const brand = String(carrier || this.data.carrier || '快递').trim() || '快递';
    this._fail(
      '暂无法打开官方轨迹',
      this.data.trackingNumber
        ? `单号可复制后到「${brand}」服务查询。`
        : '缺少运单凭证，请返回订单管理核对运单号。'
    );
  },

  _fail(title, sub) {
    this.setData({
      statusTitle: title,
      statusSub: sub,
      showFallback: true
    });
  },

  copyTracking() {
    const no = String(this.data.trackingNumber || '').trim();
    if (!no) {
      wx.showToast({ title: '暂无运单号', icon: 'none' });
      return;
    }
    wx.setClipboardData({
      data: no,
      success: () => wx.showToast({ title: '已复制运单号', icon: 'none' })
    });
  },

  goBack() {
    wx.navigateBack({
      delta: 1,
      fail: () => {
        wx.redirectTo({ url: '/subpackages/manager/manager/index' });
      }
    });
  }
});
