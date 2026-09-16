const {
  RULE_TEXT_FALLBACK,
  STORE_RULE_FALLBACK,
  buildEarnRuleText,
  EXCHANGE_RULE_TEXT,
  STORE_POINTS_NOTICE,
  POINT_TYPE_TEXT,
  EXCHANGE_CONFIRM_HINT
} = require('../utils/storePoints');
const { ensureOpenId } = require('../../../utils/orderScope');
const { fetchUserSession } = require('../../../utils/userSession');
const { drawMemberQr } = require('../utils/qrCanvas');
const app = getApp();
const db = wx.cloud.database();

function parsePoints(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

function newRequestId() {
  return `ex_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function formatRecordTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

Page({
  data: {
    curTab: 0,
    points: 0,
    pointsText: '—',
    pointsReady: false,
    pointsError: false,
    levelName: '加载中',
    rewards: [],
    myRewards: [],
    loading: true,
    loadError: false,
    myRewardsError: false,
    showQrModal: false,
    currentCode: '',
    currentTitle: '',

    // 积分明细
    records: [],
    recordsLoading: false,
    recordsError: false,
    storeRuleText: RULE_TEXT_FALLBACK,
    storeNotice: STORE_POINTS_NOTICE,
    storeSpendTotal: 0,
    storePointsTotal: 0,
    /** 线上消费累计（确认收货赠分口径，与门店消费分列） */
    onlineSpendTotal: 0,
    /** 外部平台订单累计（绑定兑积分口径，不计入门店消费） */
    platformSpendTotal: 0,
    /** 规则结构化（云端 storeRule；缺省用兜底），用于分别展示线上/门店两条规则 */
    storeRule: STORE_RULE_FALLBACK,
    /** 通用赠分句式：线上与门店同规则，仅前置场景词不同 */
    earnRuleText: buildEarnRuleText(STORE_RULE_FALLBACK),
    /** 线上口径补充：确认收货后到账 */
    onlineEarnRuleText: `${buildEarnRuleText(STORE_RULE_FALLBACK)}，确认收货后到账`,
    /** 兑换说明 */
    exchangeRuleText: EXCHANGE_RULE_TEXT,
    /** 资产卡翻转态：正面=积分余额，背面=积分规则 */
    cardFlipped: false,

    exchanging: false,

    // 兑换二次确认
    showExchangeConfirm: false,
    exchangeTarget: null,
    exchangeConfirmHint: EXCHANGE_CONFIRM_HINT,

    // 兑券成功打印动效
    showCouponPrint: false,
    printCoupon: {
      title: '',
      value: 0,
      minSpend: 0,
      expireDate: '',
      channel: 'all'
    }
  },

  onShow() {
    this.refreshAll();
  },

  onPullDownRefresh() {
    this.refreshAll().then(() => wx.stopPullDownRefresh());
  },

  switchTab(e) {
    const idx = parseInt(e.currentTarget.dataset.idx, 10);
    this.setData({ curTab: idx });
    if (idx === 1 && this.data.myRewards.length === 0) this.loadMyRewards();
    if (idx === 2 && this.data.records.length === 0) this.loadRecords();
  },

  /** 顶部资产卡：轻触翻转（正面积分余额 → 背面积分规则），与预约票据卡同一交互 */
  toggleCard() {
    wx.vibrateShort({ type: 'light' });
    this.setData({ cardFlipped: !this.data.cardFlipped });
  },

  async refreshAll() {
    await this.loadData();
    await this.loadRewards();
    this.loadRecords();
    if (this.data.curTab === 1) await this.loadMyRewards();
  },

  /**
   * 积分明细与门店累计。getPointRecords 按 userOpenid 归属过滤，
   * 门店赠分的 _openid 是店员，不能靠前端直查 point_records。
   */
  async loadRecords() {
    if (this.data.recordsLoading) return;
    this.setData({ recordsLoading: true });
    try {
      const res = await wx.cloud.callFunction({ name: 'getPointRecords', data: { page: 1, pageSize: 30 } });
      const result = (res && res.result) || {};
      if (!result.success) {
        this.setData({ recordsLoading: false, recordsError: true });
        return;
      }
      const summary = result.summary || {};
      const storeRule = result.storeRule || STORE_RULE_FALLBACK;
      this.setData({
        recordsLoading: false,
        recordsError: false,
        records: (result.list || []).map((row) => ({
          ...row,
          timeText: formatRecordTime(row.createTime),
          typeText: POINT_TYPE_TEXT[row.type] || '',
          pointsText: row.points > 0 ? `+${row.points}` : String(row.points)
        })),
        storeSpendTotal: summary.storeSpendTotal || 0,
        storePointsTotal: summary.storePointsTotal || 0,
        onlineSpendTotal: summary.onlineSpendTotal || 0,
        platformSpendTotal: summary.platformSpendTotal || 0,
        storeRuleText: result.storeRuleText || RULE_TEXT_FALLBACK,
        storeRule,
        earnRuleText: buildEarnRuleText(storeRule),
        onlineEarnRuleText: `${buildEarnRuleText(storeRule)}，确认收货后到账`
      });
    } catch (e) {
      console.warn('loadRecords', e);
      this.setData({ recordsLoading: false, recordsError: true });
    }
  },

  async loadData() {
    this.setData({
      pointsReady: false,
      pointsError: false,
      pointsText: '—',
      levelName: '加载中'
    });

    try {
      const session = await fetchUserSession(app);
      if (session && session.success && session.stats) {
        this.applyStats(session.stats);
        return;
      }

      const statsRes = await wx.cloud.callFunction({ name: 'getUserStats' });
      const stats = (statsRes && statsRes.result) || {};
      if (!stats.error && (stats.levelName || Number.isFinite(Number(stats.points)))) {
        this.applyStats(stats);
        return;
      }

      this.setData({
        pointsReady: false,
        pointsError: true,
        pointsText: '—',
        levelName: session && session.msg === '未登录' ? '未登录' : '加载失败'
      });
    } catch (e) {
      console.warn('loadData points', e);
      this.setData({
        pointsReady: false,
        pointsError: true,
        pointsText: '—',
        levelName: '加载失败'
      });
    }
  },

  applyStats(stats) {
    const points = parsePoints(stats.points);
    this.setData({
      points,
      pointsText: String(points),
      pointsReady: true,
      pointsError: false,
      levelName: stats.levelName || '原木·见习者'
    });
  },

  retryPoints() {
    this.loadData();
  },

  async loadRewards() {
    try {
      // 不用 where+orderBy 复合查询（缺 isOffShelf+cost 索引会整表失败）。
      // isOffShelf !== true：兼容缺字段的旧文档 / Admin 新建后尚未回填的文档。
      const res = await db.collection('rewards').limit(100).get();
      const rewards = (res.data || [])
        .filter((row) => row && row.isOffShelf !== true)
        .sort((a, b) => (Number(a.cost) || 0) - (Number(b.cost) || 0));
      this.setData({ rewards, loading: false, loadError: false });
    } catch (err) {
      console.error(err);
      this.setData({ rewards: [], loading: false, loadError: true });
      wx.showToast({ title: '权益加载失败', icon: 'none' });
    }
  },

  async loadMyRewards() {
    try {
      const openid = await ensureOpenId(app);
      if (!openid) {
        this.setData({ myRewards: [], myRewardsError: true });
        return;
      }

      const res = await db.collection('orders')
        .where({ _openid: openid, source: 'exchange' })
        .orderBy('createTime', 'desc')
        .get();
      const list = res.data.map(item => ({
        ...item,
        formatTime: new Date(item.createTime).toLocaleDateString()
      }));
      this.setData({ myRewards: list, myRewardsError: false });
    } catch (e) {
      console.error(e);
      this.setData({ myRewards: [], myRewardsError: true });
      wx.showToast({ title: '兑换记录加载失败', icon: 'none' });
    }
  },

  goToWallet() {
    wx.navigateTo({
      url: '/subpackages/business/coupons/index',
      fail: () => wx.showToast({ title: '礼券夹暂不可用', icon: 'none' })
    });
  },

  goWalletHub() {
    try {
      const { openWalletHub } = require('../../../utils/rewardsNav');
      openWalletHub({});
    } catch (e) {
      wx.navigateTo({
        url: '/subpackages/extra/user/stored-value/index',
        fail: () => this.goToWallet()
      });
    }
  },

  closeCouponPrint() {
    this.setData({ showCouponPrint: false });
  },

  goWalletFromPrint() {
    this.setData({ showCouponPrint: false });
    this.goToWallet();
  },

  goOrderClaim() {
    wx.navigateTo({
      url: '/subpackages/business/order-claim/index',
      fail: () => wx.showToast({ title: '页面暂不可用', icon: 'none' })
    });
  },

  redeem(e) {
    const { id, cost, type, title, image } = e.currentTarget.dataset;
    if (!id) {
      wx.showToast({ title: '权益信息缺失', icon: 'none' });
      return;
    }
    if (!this.data.pointsReady) {
      wx.showToast({ title: '积分加载中', icon: 'none' });
      return;
    }
    const rewardRow = (this.data.rewards || []).find((row) => row._id === id) || {};
    // 已售罄：此前仅用 CSS class 表现 disabled，点击仍会走到兑换并且弹「积分不足」，
    // 与卡片上显示的 SOLD OUT 自相矛盾
    if (Number(rewardRow.stock) <= 0) {
      wx.showToast({ title: '该权益已兑完', icon: 'none' });
      return;
    }
    if (this.data.points < Number(cost)) {
      wx.showToast({ title: '积分不足', icon: 'none' });
      return;
    }
    // 代金券：二次确认后再走 exchangeCoupon
    if (type === 'coupon') {
      const reward = (this.data.rewards || []).find((row) => row._id === id) || {};
      const expireDays = parseInt(reward.expireDays, 10) > 0 ? parseInt(reward.expireDays, 10) : 30;
      const value = Number(reward.value) || 0;
      const minSpend = Number(reward.minSpend);
      const safeMin = Number.isFinite(minSpend) && minSpend >= 0 ? minSpend : (Number.isFinite(value) ? value : 0);
      this.setData({
        showExchangeConfirm: true,
        exchangeTarget: {
          id,
          title: title || reward.title || '礼券',
          cost: Number(cost) || 0,
          value,
          minSpend: safeMin,
          expireDays,
          usageText: String(reward.description || reward.usageNote || '').trim(),
          clientRequestId: newRequestId()
        }
      });
      return;
    }
    this.doRedeem(id, cost, type, title, image);
  },

  closeExchangeConfirm() {
    this.setData({ showExchangeConfirm: false, exchangeTarget: null });
  },

  confirmExchangeCoupon() {
    const target = this.data.exchangeTarget;
    if (!target || !target.id) return;
    this.setData({ showExchangeConfirm: false });
    this.doExchangeCoupon(target.id, target.title, target.clientRequestId);
  },

  async doExchangeCoupon(rewardId, title, clientRequestId) {
    if (this.data.exchanging) return;
    this.setData({ exchanging: true });
    wx.showLoading({ title: '兑换中…' });
    try {
      const requestId = String(clientRequestId || '').trim() || newRequestId();
      const res = await wx.cloud.callFunction({
        name: 'exchangeCoupon',
        data: { rewardId, clientRequestId: requestId }
      });
      wx.hideLoading();
      this.setData({ exchanging: false });
      const result = (res && res.result) || {};
      if (!result.success) {
        // 失败保留 requestId，便于用户再次确认时幂等重试
        const prev = this.data.exchangeTarget;
        if (prev && prev.id === rewardId) {
          this.setData({
            showExchangeConfirm: true,
            exchangeTarget: { ...prev, clientRequestId: requestId }
          });
        }
        wx.showModal({
          title: '兑换失败',
          content: result.msg || '请稍后重试',
          showCancel: false,
          confirmColor: '#C4A76C'
        });
        return;
      }
      this.setData({ exchangeTarget: null });
      try {
        const { invalidateAfterCoupon } = require('../utils/cacheInvalidate');
        invalidateAfterCoupon();
      } catch (err) { /* ignore */ }
      const coupon = result.coupon || {};
      const reward = (this.data.rewards || []).find((row) => row._id === rewardId) || {};
      this.setData({
        showCouponPrint: true,
        printCoupon: {
          title: title || coupon.title || reward.title || '礼券',
          value: Number(coupon.value != null ? coupon.value : reward.value) || 0,
          minSpend: Number(coupon.minSpend != null ? coupon.minSpend : reward.minSpend) || 0,
          expireDate: coupon.expireDate || '',
          channel: coupon.channel || reward.channel || 'all'
        }
      });
      this.refreshAll();
    } catch (e) {
      wx.hideLoading();
      this.setData({ exchanging: false });
      const prev = this.data.exchangeTarget;
      if (prev && prev.id === rewardId) {
        this.setData({
          showExchangeConfirm: true,
          exchangeTarget: {
            ...prev,
            clientRequestId: String(clientRequestId || prev.clientRequestId || '').trim() || newRequestId()
          }
        });
      }
      wx.showToast({ title: '网络错误', icon: 'none' });
    }
  },

  async doRedeem(id, cost, type, title, image, address) {
    // 在途守卫：同类兑换请求未返回前不再受理，避免双击重复扣分/重复发货
    if (this._redeeming) return;
    this._redeeming = true;
    // 幂等键：网络重试复用同一个 key，云端据此去重
    if (!this._redeemRequestId) this._redeemRequestId = newRequestId();
    wx.showLoading({ title: '兑换中…', mask: true });
    wx.cloud.callFunction({
      name: 'redeemReward',
      data: { rewardId: id, cost: cost, type: type, title: title, image: image, address: address, clientRequestId: this._redeemRequestId },
      success: (res) => {
        wx.hideLoading();
        const result = (res && res.result) || {};
        if (result.success) {
          this._redeemRequestId = '';
          wx.showToast({ title: '兑换成功', icon: 'success' });
          this.refreshAll();
          this.setData({ curTab: 1 });
        } else {
          wx.showToast({ title: result.msg || '兑换失败', icon: 'none' });
        }
      },
      fail: () => { wx.hideLoading(); wx.showToast({ title: '网络错误', icon: 'none' }); },
      complete: () => { this._redeeming = false; }
    });
  },

  showCode(e) {
    const code = e.currentTarget.dataset.id;
    const title = e.currentTarget.dataset.title;
    this.setData({ showQrModal: true, currentCode: code, currentTitle: title }, () => {
      drawMemberQr('#redeemQrCanvas', `REDEEM:${code}`, this, 200).catch(() => {});
    });
  },
  closeCode() { this.setData({ showQrModal: false }); },
  goToOrder(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) {
      wx.showToast({ title: '订单信息缺失', icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: `/subpackages/business/order-detail/index?id=${id}`,
      fail: () => wx.showToast({ title: '无法打开订单', icon: 'none' })
    });
  },

  noop() {}
});
