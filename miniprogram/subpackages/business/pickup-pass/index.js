/**
 * 门店自取凭证（独立页）—— 与订单详情解耦，专门用于到店出示
 *
 * 设计要点：
 * - 进页面即把屏幕调到最亮（柜台扫码场景），离开自动恢复
 * - 自取码 / 订单号可由 query 直接带入 → 秒出二维码，不等待网络
 * - 订单数据仅用于补状态、领取门店与核销时间；读取失败不影响出示凭证
 * - **核销联动**：待领取期间静默轮询自己的订单（顾客直读 orders，无需新云函数），
 *   店员核销成功后顾客端自动收口为「本次自取已完成」并给二维码盖上「已自提」水印
 */
const app = getApp();
const db = wx.cloud.database();
const { buildPickupPass, formatPickupTime } = require('../utils/pickupPass');
const { drawMemberQr } = require('../utils/qrCanvas');
const { fetchStoreCatalog, findCatalogStore } = require('../../../utils/storeCatalog');
const { ensureOpenId, canAccessOrder, denyOrderAccess } = require('../../../utils/orderScope');
const { canUserRequestRefund } = require('../utils/refundPolicy');

/** 店员核销后顾客端不必手动下拉：待领取期间每 3s 静默核对一次订单状态 */
const PASS_POLL_MS = 3000;
/** 轮询上限（15 分钟）：顾客把页面晾在柜台后不再空耗，超时回落下拉刷新 / 重新进入 */
const PASS_POLL_MAX_MS = 15 * 60 * 1000;
/** 回到本页时的静默补拉节流：避开 onLoad 后的首个 onShow，防止同一动作拉两次 */
const PASS_RESUME_MS = 1500;

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
    claimLive: false,
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
    /** 核销联动：轮询定时器 / 读库去重 / 状态跃迁标记 */
    this._pollTimer = null;
    this._pollStartedAt = 0;
    this._loadingOrder = null;
    this._sawPending = false;
    this._announced = false;
    this._hydratedStoreId = '';

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
      // 只有自取码、没有订单号时无法核对状态：状态交由专员现场核实
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
    if (Date.now() - this._lastLoadAt >= PASS_RESUME_MS) this.loadOrder(id, { silent: true });
    this.startWatching();
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
    this.stopWatching();
    this.restoreBrightness();
  },

  onUnload() {
    this.stopWatching();
    this.restoreBrightness();
  },

  // ------------------------------------------------------------ 核销联动（自动刷新）

  /**
   * 待领取期间轮询自己的订单：店员扫顾客自取码核销后（orders.status → received /
   * pickupStatus → claimed），顾客端自动收口成「已自提」，不要求手动下拉。
   * 无订单号（只有历史自取码）、已交付、已失效时都不轮询。
   */
  startWatching() {
    if (this._pollTimer) return;
    if (!this.data.orderId || !this.canWatch()) return;
    this._pollStartedAt = Date.now();
    this._pollTimer = setInterval(() => this.pollOrderStatus(), PASS_POLL_MS);
  },

  stopWatching() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  },

  /** 只有「待领取」值得盯：已交付 / 已退款取消都无需再查 */
  canWatch() {
    const tone = this.data.pass && this.data.pass.statusTone;
    return tone !== 'done' && tone !== 'closed';
  },

  pollOrderStatus() {
    if (!this.data.orderId || !this.canWatch()) {
      this.stopWatching();
      return;
    }
    if (Date.now() - this._pollStartedAt > PASS_POLL_MAX_MS) {
      this.stopWatching();
      return;
    }
    this.loadOrder(this.data.orderId, { silent: true });
  },

  /** 现场核销成功的顾客端反馈：震动 + 轻提示，并停止维持最亮屏（凭证已无需出示） */
  announceClaimed() {
    // 仪式感（2026-10-18 产品负责人点名）：柜台当场核销 → 「已自提」印当场盖下、二维码褪灰（历史已核销的直接静态）
    this.setData({ claimLive: true });
    try {
      wx.vibrateShort({ type: 'medium' });
    } catch (e) { /* 旧基础库 */ }
    wx.showToast({ title: '门店自取已完成', icon: 'success', duration: 1800 });
    this.restoreBrightness();
  },

  /**
   * 订单详情：补齐状态 / 领取门店 / 核销时间（失败不阻塞出示）
   * 轮询 / onShow / 下拉刷新可能同时到达：同一时刻只保留一次读库。
   */
  loadOrder(orderId, options) {
    if (this._loadingOrder) return this._loadingOrder;
    const task = this.runLoadOrder(orderId, options);
    this._loadingOrder = task;
    const release = () => {
      if (this._loadingOrder === task) this._loadingOrder = null;
    };
    task.then(release, release);
    return task;
  },

  async runLoadOrder(orderId, options) {
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
      const claimedNow = pass.statusTone === 'done';
      const closedNow = pass.statusTone === 'closed';
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

      // 状态跃迁：待领取 → 已交付 = 店员刚在柜台核销，停轮询并给顾客明确回执
      if (claimedNow) {
        this.stopWatching();
        if (this._sawPending && !this._announced) {
          this._announced = true;
          this.announceClaimed();
        }
      } else if (closedNow) {
        this.stopWatching();
      } else {
        this._sawPending = true;
      }

      if (!this.data.qrReady && code) this.drawQr();
      // 轮询每 3s 都会走到这里：门店信息只补一次（同店不重复查目录缓存）
      const storeId = order.storeId || '';
      if (this._hydratedStoreId !== storeId) {
        this._hydratedStoreId = storeId;
        this.hydrateStore(storeId);
      }
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
      '/subpackages/extra/user/support/index' +
      buildSupportQuery({
        topic: 'order',
        orderId: this.data.orderId,
        orderNo: this.data.orderNo,
        productName: '门店自取'
      });
    wx.navigateTo({
      url,
      fail: () => wx.showToast({ title: '无法打开联系专员', icon: 'none' })
    });
  },

  noop() {}
});
