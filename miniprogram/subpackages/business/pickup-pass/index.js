/**
 * 门店自取凭证（独立页）—— 与订单详情解耦，专门用于到店出示
 *
 * 设计要点：
 * - 进页面即把屏幕调到最亮（柜台扫码场景），离开自动恢复
 * - 自取码 / 订单号可由 query 直接带入 → 秒出二维码，不等待网络
 * - 订单数据仅用于补状态、领取门店与核销时间；读取失败不影响出示凭证
 */
const app = getApp();
const db = wx.cloud.database();
const { buildPickupPass, formatPickupTime } = require('../utils/pickupPass');
const { drawMemberQr } = require('../utils/qrCanvas');
const { fetchStoreCatalog, findCatalogStore } = require('../../../utils/storeCatalog');
const { ensureOpenId, canAccessOrder, denyOrderAccess } = require('../../../utils/orderScope');
const { canUserRequestRefund } = require('../utils/refundPolicy');

Page({
  data: {
    orderId: '',
    orderNo: '',
    code: '',
    codeText: '',
    pass: { statusLabel: '', statusTone: 'wait', headline: '', hint: '', steps: [] },
    storeName: '山川造物',
    storeInfo: null,
    claimedAtText: '',
    qrReady: false,
    /** 二维码绘制失败：降级为口报自取码，不影响交付 */
    qrFailed: false,
    /** 订单状态暂未取到（仅凭 query 的自取码出示）：隐藏状态章与进度 */
    statusUnknown: false,
    loading: true,
    error: '',
    showRefundEntry: false
  },

  onLoad(options) {
    const orderId = String((options && (options.id || options.orderId)) || '').trim();
    const code = String((options && options.code) || '').replace(/\s+/g, '').toUpperCase();
    this._prevBrightness = null;
    this._lastLoadAt = 0;

    // 凭证带自取码：关闭转发入口，避免自取码被转发给他人到店冒领
    if (wx.hideShareMenu) wx.hideShareMenu();

    if (!orderId && !code) {
      this.setData({ loading: false, error: '凭证信息缺失，请从订单详情进入' });
      return;
    }

    this.setData({
      orderId,
      code,
      codeText: code,
      pass: buildPickupPass({ pickupCode: code, status: 'paid' }),
      // 只有自取码、没有订单号时无法核对状态：状态交由馆长现场核实
      statusUnknown: !orderId
    });

    if (code) {
      setTimeout(() => this.drawQr(), 60);
    }
    if (orderId) {
      this._lastLoadAt = Date.now();
      this.loadOrder(orderId);
    } else {
      this.setData({ loading: false });
    }
  },

  onShow() {
    this.boostBrightness();
    // 从柜台走回、或核销后回到本页：静默核对一次最新状态
    const id = this.data.orderId;
    if (!id) return;
    if (Date.now() - this._lastLoadAt < 15000) return;
    this.loadOrder(id, { silent: true });
  },

  onPullDownRefresh() {
    const id = this.data.orderId;
    if (!id) {
      wx.stopPullDownRefresh();
      return;
    }
    this.loadOrder(id, { silent: true }).then(
      () => wx.stopPullDownRefresh(),
      () => wx.stopPullDownRefresh()
    );
  },

  onHide() {
    this.restoreBrightness();
  },

  onUnload() {
    this.restoreBrightness();
  },

  /** 订单详情：补齐状态 / 领取门店 / 核销时间（失败不阻塞出示） */
  async loadOrder(orderId, options) {
    const silent = !!(options && options.silent);
    this._lastLoadAt = Date.now();
    try {
      const openid = await ensureOpenId(app);
      if (!openid) {
        denyOrderAccess();
        return;
      }
      const res = await db.collection('orders').doc(orderId).get();
      const order = (res && res.data) || null;
      if (!order) {
        this.setData({ loading: false, error: '订单不存在' });
        return;
      }
      if (!canAccessOrder(order, openid)) {
        denyOrderAccess();
        return;
      }

      const pass = buildPickupPass(order);
      this._order = order;
      const code = pass.code || this.data.code;
      const claimedAt = order.pickupClaimedAt || order.receiveTime || null;
      this.setData({
        orderNo: order.orderNo || '',
        code,
        codeText: pass.codeText || this.data.codeText,
        storeName: order.storeName || this.data.storeName,
        pass,
        claimedAtText: order.pickupStatus === 'claimed' || order.status === 'received'
          ? formatPickupTime(claimedAt)
          : '',
        statusUnknown: false,
        loading: false,
        error: '',
        showRefundEntry: order.pickupStatus !== 'claimed' && canUserRequestRefund(order).ok &&
          (order.status === 'paid' || order.status === 'ready_pickup')
      });

      if (!this.data.qrReady && code) this.drawQr();
      this.hydrateStore(order.storeId || '');
    } catch (e) {
      console.warn('[pickup-pass] 订单读取失败', e);
      // 静默刷新失败：保留上一次已核对的状态，不打断出示
      if (silent) return;
      // 已经用 query 里的自取码渲染好了：保留可出示状态，仅提示信息可能不完整
      this.setData({
        loading: false,
        statusUnknown: true,
        error: this.data.code ? '' : '凭证加载失败，请稍后重试'
      });
    }
  },

  /** 领取门店信息（楼层 / 营业时间 / 地址 / 坐标），走本地缓存，失败静默 */
  async hydrateStore(storeId) {
    try {
      const stores = await fetchStoreCatalog();
      const s = findCatalogStore(storeId, stores);
      if (!s) return;
      const hours = s.hours && s.hours.open ? `${s.hours.open}–${s.hours.close}` : '';
      this.setData({
        storeName: this.data.storeName || s.name || '',
        storeInfo: {
          name: s.name || '',
          floor: s.floor || s.locationLabel || '',
          address: s.address || '',
          hours,
          latitude: Number(s.latitude) || 0,
          longitude: Number(s.longitude) || 0,
          canNavigate: !!(s.latitude && s.longitude)
        }
      });
    } catch (e) {
      console.warn('[pickup-pass] 门店信息补齐失败', e);
    }
  },

  drawQr() {
    const code = this.data.code;
    if (!code) return;
    // 静区留足，保证柜台扫码一次成功
    drawMemberQr('#passQrCanvas', `PICKUP:${code}`, this, 640, { margin: 44 })
      .then((ok) => this.setData({ qrReady: !!ok, qrFailed: !ok }))
      .catch(() => this.setData({ qrReady: false, qrFailed: true }));
  },

  boostBrightness() {
    try {
      wx.getScreenBrightness({
        success: (r) => { this._prevBrightness = r.value; },
        complete: () => {
          try {
            wx.setScreenBrightness({ value: 1 });
          } catch (e) { /* ignore */ }
        }
      });
    } catch (e) { /* 旧基础库 */ }
  },

  restoreBrightness() {
    const prev = this._prevBrightness;
    this._prevBrightness = null;
    if (prev == null) return;
    try {
      wx.setScreenBrightness({ value: prev });
    } catch (e) { /* ignore */ }
  },

  copyCode() {
    const code = this.data.code;
    if (!code) return;
    wx.setClipboardData({
      data: code,
      success: () => wx.vibrateShort({ type: 'light' })
    });
  },

  goStore() {
    const s = this.data.storeInfo;
    if (!s || !s.canNavigate) {
      wx.showToast({ title: '门店位置暂不可用', icon: 'none' });
      return;
    }
    wx.openLocation({
      latitude: s.latitude,
      longitude: s.longitude,
      name: s.name || this.data.storeName || '领取门店',
      address: s.address || '',
      scale: 16,
      fail: () => wx.showToast({ title: '打开地图失败', icon: 'none' })
    });
  },

  goOrderDetail() {
    const id = this.data.orderId;
    if (!id) {
      wx.showToast({ title: '订单信息缺失', icon: 'none' });
      return;
    }
    const pages = getCurrentPages();
    const previous = pages[pages.length - 2];
    if (previous && previous.route === 'subpackages/business/order-detail/index') {
      wx.navigateBack({ delta: 1 });
    } else {
      wx.navigateTo({
        url: `/subpackages/business/order-detail/index?id=${encodeURIComponent(id)}`,
        fail: () => wx.showToast({ title: '无法打开订单详情', icon: 'none' })
      });
    }
  },

  requestRefund() {
    const order = this._order;
    const id = this.data.orderId;
    if (!order || !id || order.pickupStatus === 'claimed' || !canUserRequestRefund(order).ok) return;
    wx.navigateTo({
      url: `/subpackages/business/aftersale-apply/index?id=${encodeURIComponent(id)}`,
      fail: () => wx.showToast({ title: '无法打开申请页', icon: 'none' })
    });
  },

  goSupport() {
    const { buildSupportQuery } = require('../utils/supportHelper');
    const url =
      '/subpackages/feature/user/support/index' +
      buildSupportQuery({
        topic: 'order',
        orderId: this.data.orderId,
        orderNo: this.data.orderNo,
        productName: '门店自取'
      });
    wx.navigateTo({
      url,
      fail: () => wx.showToast({ title: '无法打开联系馆长', icon: 'none' })
    });
  },

  noop() {}
});
