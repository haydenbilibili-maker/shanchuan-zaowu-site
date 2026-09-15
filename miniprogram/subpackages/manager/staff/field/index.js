/**
 * 店员后台 —— 只保留门店高频操作
 * 消费赠分、核销（会员码 / 预约票）、我的赠分流水、到店签到统计
 * 财务、库存、商品、内容、数据看板等核心功能留在店长后台
 */
const db = wx.cloud.database();
const { hasPermission, goApprovals } = require('../../utils/staffAuth');
const { classifyScan, formatCloudFnError, takePendingScan } = require('../../utils/memberScan');
const { LEVEL_BENEFITS } = require('../../../../utils/profileConstants');
const { collectCurrentPerkItems, formatDiscount } = require('../../../../utils/profileHelper');
const { RULE_TEXT_FALLBACK, PURCHASE_STATUS_TEXT, IDENTIFY_METHOD_TEXT } = require('../../utils/storePoints');
const { initStaffStores, applyStoreChange, resolveStoreFromQuery } = require('../utils/pageSetup');

const EMPTY_GRANT_FORM = {
  amount: '',
  receiptNo: '',
  remark: ''
};

/** iPhone：scroll-view 必须用明确 px 高度；calc(vh+rpx) / flex / enhanced 嵌套在真机常滑不动 */
function getWindowMetrics() {
  try {
    if (typeof wx.getWindowInfo === 'function') {
      const info = wx.getWindowInfo();
      if (info && info.windowHeight) {
        const safeBottom = info.safeArea
          ? Math.max(0, info.windowHeight - info.safeArea.bottom)
          : (info.safeAreaInsets && info.safeAreaInsets.bottom) || 0;
        return { windowHeight: info.windowHeight, safeBottom };
      }
    }
  } catch (e) {
    /* 旧基础库 */
  }
  try {
    const info = wx.getSystemInfoSync();
    const windowHeight = (info && info.windowHeight) || 0;
    let safeBottom = 0;
    if (info.safeArea && windowHeight) {
      safeBottom = Math.max(0, windowHeight - info.safeArea.bottom);
    } else if (info.safeAreaInsets) {
      safeBottom = info.safeAreaInsets.bottom || 0;
    }
    return { windowHeight, safeBottom };
  } catch (e) {
    return { windowHeight: 667, safeBottom: 0 };
  }
}

function newRequestId() {
  return `sp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function looksLikeBookingRef(bookingId, ticketCode) {
  if (String(ticketCode || '').trim()) return true;
  return /^[a-zA-Z0-9_-]{8,64}$/.test(String(bookingId || '').trim());
}

function parseGrantAmount(raw) {
  const text = String(raw == null ? '' : raw).trim();
  if (!text) return { ok: false, msg: '请输入消费金额' };
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return { ok: false, msg: '金额须为数字，最多两位小数' };
  const amount = Math.round(Number(text) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, msg: '请输入大于 0 的金额' };
  // 该校验被「现场赠分」与「券核销」共用：券核销环节还没有小票，故文案不写「核对小票」
  if (amount > 999999) return { ok: false, msg: '单笔金额过大，请核对金额' };
  return { ok: true, amount };
}

function isRetryableError(e) {
  const raw = String((e && (e.errMsg || e.message || e.msg)) || '');
  return /timeout|TIMEOUT|超时|network|NETWORK|request:fail|连接|unavailable|504003/i.test(raw);
}

function formatTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** UI 顺序：0 消费赠分 | 1 核销 | 2 流水 | 3 到店 */
const TAB_GRANT = 0;
const TAB_VERIFY = 1;
const TAB_RECORDS = 2;
const TAB_VISIT = 3;

/** 核销页顶部「本店可核 …」文案：按能力点拼装，避免 WXML 里嵌套三元 */
function buildVerifyScopeText(flags) {
  const f = flags || {};
  const parts = [];
  if (f.member) parts.push('会员码');
  if (f.pickup) parts.push('门店自取');
  if (f.booking) parts.push('预约票');
  if (f.coupon) parts.push('门店礼券');
  if (f.gift) parts.push('礼赠');
  return parts.length ? parts.join(' · ') : '暂无权限';
}

/**
 * 解析 ?tab= 深链。
 * - 具名：grant / verify / records / visit（推荐）
 * - 数字：按「调换前」旧映射迁移（0 核销→1，1 赠分→0，2/3 不变），避免旧链接错位
 * - 缺省 / 非法：默认消费赠分
 */
function resolveStaffTab(tabQuery) {
  if (tabQuery == null || tabQuery === '') return TAB_GRANT;
  const key = String(tabQuery).trim().toLowerCase();
  const named = {
    grant: TAB_GRANT,
    points: TAB_GRANT,
    verify: TAB_VERIFY,
    records: TAB_RECORDS,
    visit: TAB_VISIT,
    checkin: TAB_VISIT
  };
  if (Object.prototype.hasOwnProperty.call(named, key)) return named[key];
  const n = parseInt(key, 10);
  if (!Number.isFinite(n) || n < 0 || n > 3) return TAB_GRANT;
  // 旧 UI：0 核销 | 1 赠分 | 2 流水 | 3 到店
  const legacyToNew = [TAB_VERIFY, TAB_GRANT, TAB_RECORDS, TAB_VISIT];
  return legacyToNew[n];
}

Page({
  data: {
    ready: false,
    role: '',
    roleText: '',
    staffName: '',
    canRevoke: false,
    canDirectGrant: false,
    canVerifyMember: false,
    canVerifyBooking: false,
    canVerifyCoupon: false,
    canVerifyGift: false,
    canVerifyPickup: false,
    /** 核销页顶部文案：本店可核 …（onLoad 按能力点拼装） */
    verifyScopeText: '',
    curTab: 0,
    lastVerify: null,
    scanFail: null,
    showBookingVerifyResult: false,
    bookingVerifyResult: {},
    // 门店自取核销：待自取列表 + 二次确认 + 结果回执
    pendingPickups: [],
    pickupsLoading: false,
    pickupsError: '',
    pickupCodeInput: '',
    showPickupConfirm: false,
    pickupConfirm: {},
    pickupConfirmBusy: false,
    showPickupVerifyResult: false,
    pickupVerifyResult: {},
    lastGrant: null,
    amountError: '',

    storeOptions: [],
    storeNames: [],
    storeIndex: 0,
    storeId: '',
    storeName: '',

    ruleText: RULE_TEXT_FALLBACK,
    summary: { count: 0, amount: 0, points: 0, avgTicket: 0, remaining: 0, cap: 0 },
    mineSummary: { count: 0, points: 0, amount: 0 },

    // 核销
    bookings: [],
    bookingsLoading: false,
    bookingsError: '',
    showMemberPassResult: false,
    memberPassClosing: false,
    memberPassResult: {},
    memberPassStep: 'pass',
    passPerksExpanded: false,
    /** 核销态整段 scroll-view 的行内高度（px），由 layoutPassRedeemScroll 写入 */
    passRedeemScrollStyle: 'height:420px;',
    showCouponRedeemResult: false,
    couponRedeemResult: {},
    couponReceiptPaths: [],
    couponRedeemForm: { userCouponId: '', title: '', value: 0, minSpend: 0, amount: '', memberOpenid: '', memberToken: '' },
    couponRedeeming: false,

    // 赠分
    member: null,
    memberOpenid: '',
    memberToken: '',
    identifyMethod: '',
    phoneTail: '',
    candidates: [],
    grantForm: { ...EMPTY_GRANT_FORM },
    clientRequestId: '',
    previewPoints: null,
    previewMsg: '',
    previewing: false,
    quotaOk: true,
    granting: false,

    // 流水
    records: [],
    recordsLoading: false,

    // 签到
    visitStats: { total: 0, byStore: {} },
    visitStatsError: ''
  },

  async onLoad(options) {
    try {
      const setup = await initStaffStores('staff');
      if (!setup) return;
      const role = setup.role;
      const store = resolveStoreFromQuery(options, setup);
      const curTab = resolveStaffTab(options && options.tab);
      const autoScanRaw = options && (options.autoScan != null ? options.autoScan : options.scan);
      const autoScan = /^(1|true|yes)$/i.test(String(autoScanRaw == null ? '' : autoScanRaw).trim());
      const pendingScanFlag = /^(1|true|yes)$/i.test(
        String((options && options.pendingScan) == null ? '' : options.pendingScan).trim()
      );
      // 与 staff/index 一致：核销动作读 this._role，勿只写 data.role（那是 role 字符串）
      this._role = role;

      const verifyFlags = {
        member: hasPermission(role, 'verifyMemberPass'),
        booking: hasPermission(role, 'verifyBooking'),
        coupon: hasPermission(role, 'verifyStoreCoupon'),
        gift: hasPermission(role, 'verifyGiftPickup'),
        // 与云函数一致：除能力点外，店长/超管始终可核销门店自取
        pickup: hasPermission(role, 'verifyOrderPickup') || !!(role.isManager || role.isSuperAdmin)
      };

      this.setData({
        ready: true,
        role: role.role,
        workspaceRole: role.workspaceRole || '',
        roleText: setup.roleText,
        staffName: setup.staffName,
        canRevoke: hasPermission(role, 'revokeStorePoints'),
        canDirectGrant: !!(role.isManager || role.isSuperAdmin),
        canVerifyMember: verifyFlags.member,
        canVerifyBooking: verifyFlags.booking,
        canVerifyCoupon: verifyFlags.coupon,
        canVerifyGift: verifyFlags.gift,
        canVerifyPickup: verifyFlags.pickup,
        verifyScopeText: buildVerifyScopeText(verifyFlags),
        storeOptions: setup.storeOptions,
        storeNames: setup.storeNames,
        storeIndex: store.storeIndex,
        storeId: store.storeId,
        storeName: store.storeName,
        clientRequestId: newRequestId(),
        curTab
      });

      this.refreshAll();

      // 工作台已直扫：消费挂起结果，不再二次拉起相机
      if (pendingScanFlag) {
        const pending = takePendingScan();
        if (pending && pending.raw != null) {
          const purpose = pending.purpose || (curTab === TAB_GRANT ? 'grant' : 'verify');
          setTimeout(() => this.applyScanResult(pending.raw, purpose), 50);
          return;
        }
      }

      // 其它深链：进入后自动拉起与页内主 CTA 相同的扫码（仅 onLoad 一次）
      if (autoScan) {
        const purpose = curTab === TAB_GRANT ? 'grant' : 'verify';
        setTimeout(() => {
          this.handleScan({ currentTarget: { dataset: { purpose } } });
        }, 280);
      }
    } catch (e) {
      console.warn('staff field onLoad', e);
      wx.showToast({ title: '现场服务加载失败', icon: 'none' });
    }
  },

  onShow() {
    if (this.data.ready) this.refreshAll();
  },

  onPullDownRefresh() {
    this.refreshAll().then(() => wx.stopPullDownRefresh());
  },

  async refreshAll() {
    await this.loadSummary();
    if (this.data.curTab === TAB_VERIFY) {
      this.loadBookings();
      this.loadPendingPickups();
    }
    if (this.data.curTab === TAB_RECORDS) this.loadRecords();
    if (this.data.curTab === TAB_VISIT) this.loadVisitStats();
  },

  switchTab(e) {
    const idx = parseInt(e.currentTarget.dataset.idx, 10) || 0;
    wx.vibrateShort({ type: 'light' });
    this.setData({ curTab: idx });
    if (idx === TAB_VERIFY) {
      this.loadBookings();
      this.loadPendingPickups();
    }
    if (idx === TAB_RECORDS) this.loadRecords();
    if (idx === TAB_VISIT) this.loadVisitStats();
  },

  onStoreChange(e) {
    applyStoreChange(this, parseInt(e.detail.value, 10) || 0);
    this.refreshAll();
  },

  // ------------------------------------------------------------ 汇总

  async loadSummary() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'grantStorePoints',
        data: { action: 'dailySummary', storeId: this.data.storeId }
      });
      const result = (res && res.result) || {};
      if (!result.success) {
        if (result.msg) wx.showToast({ title: formatCloudFnError(result, result.msg), icon: 'none' });
        return;
      }
      this.setData({
        summary: result.today || this.data.summary,
        mineSummary: result.mine || this.data.mineSummary,
        ruleText: result.ruleText || RULE_TEXT_FALLBACK
      });
    } catch (e) {
      console.warn('loadSummary', e);
    }
  },

  // ------------------------------------------------------------ 核销

  mapBookingRow(item) {
    const status = String(item.status || '');
    let statusLabel = '待核销';
    let statusClass = 'pending';
    if (status === 'used') {
      statusLabel = '已核销';
      statusClass = 'approved';
    } else if (status === 'pending') {
      statusLabel = '待确认';
      statusClass = 'pending';
    } else if (status === 'cancelled' || status === 'canceled') {
      statusLabel = '已取消';
      statusClass = 'rejected';
    }
    const guest = item.name || item.contactName || item.nickName || '';
    const people = item.people ? `${item.people}人` : '';
    return {
      ...item,
      timeText: `${item.date || ''} ${item.time || ''}`.trim(),
      guestText: [guest, people].filter(Boolean).join(' · '),
      statusLabel,
      statusClass
    };
  },

  async loadBookings() {
    this.setData({ bookingsLoading: true, bookingsError: '' });
    const storeId = this.data.storeId || '';
    try {
      let rows = [];
      try {
        const res = await db.collection('bookings')
          .where({ status: db.command.in(['confirmed', 'pending']) })
          .orderBy('createTime', 'desc')
          .limit(40)
          .get();
        rows = res.data || [];
      } catch (inner) {
        const res = await db.collection('bookings')
          .where({ status: 'confirmed' })
          .orderBy('createTime', 'desc')
          .limit(30)
          .get();
        rows = res.data || [];
      }
      const filtered = rows.filter((item) => {
        if (!storeId || !item.storeId) return true;
        return item.storeId === storeId;
      });
      this.setData({
        bookingsLoading: false,
        bookingsError: '',
        bookings: filtered.map((item) => this.mapBookingRow(item))
      });
    } catch (e) {
      this.setData({
        bookingsLoading: false,
        bookings: [],
        bookingsError: '预约列表加载失败，请下拉刷新'
      });
    }
  },

  setScanFail(purpose, title, msg) {
    const nextPurpose = purpose || 'verify';
    const patch = {
      scanFail: { purpose: nextPurpose, title: title || '扫码失败', msg: msg || '请再试一次' }
    };
    // 失败条只挂在对应 Tab；跨 Tab 扫码时切过去，避免看不见提示
    if (nextPurpose === 'verify' && this.data.curTab !== TAB_VERIFY) patch.curTab = TAB_VERIFY;
    if (nextPurpose === 'grant' && this.data.curTab !== TAB_GRANT) patch.curTab = TAB_GRANT;
    this.setData(patch);
  },

  retryScan() {
    const purpose = (this.data.scanFail && this.data.scanFail.purpose) || 'verify';
    this.setData({ scanFail: null });
    this.handleScan({ currentTarget: { dataset: { purpose } } });
  },

  retryLastVerify() {
    const last = this.data.lastVerify || {};
    this.setData({ showMemberPassResult: false, showBookingVerifyResult: false, showCouponRedeemResult: false });
    if (last.retryKind === 'member' && this._retryMemberPayload) {
      this.verifyMemberPass(this._retryMemberPayload);
      return;
    }
    if (last.retryKind === 'booking' && this._retryBooking) {
      this.verifyBookingById(this._retryBooking.id, this._retryBooking.code, { skipConfirm: true });
      return;
    }
    if (last.retryKind === 'gift' && this._retryGiftClaim) {
      this.verifyGiftPickup(this._retryGiftClaim);
      return;
    }
    if (last.retryKind === 'pickup' && this._retryPickupCode) {
      this.verifyOrderPickup(this._retryPickupCode, 'manual');
      return;
    }
    this.handleScan({ currentTarget: { dataset: { purpose: 'verify' } } });
  },

  handleScan(e) {
    const purpose = (e && e.currentTarget && e.currentTarget.dataset.purpose) || 'verify';
    this.setData({ scanFail: null });
    wx.scanCode({
      scanType: ['qrCode'],
      success: (res) => this.applyScanResult(res && res.result, purpose),
      fail: (err) => {
        const msg = (err && err.errMsg) || '';
        if (msg.indexOf('cancel') !== -1) return;
        this.setScanFail(purpose, '扫码失败', isRetryableError(err) ? '相机或网络异常，请再试。' : '无法打开扫码，请检查相机权限后重试。');
      }
    });
  },

  /** 解析扫码原文并分流（页内扫码 / 工作台直扫挂起结果共用） */
  applyScanResult(raw, purpose) {
    const nextPurpose = purpose || 'verify';
    this.setData({ scanFail: null });
    const parsed = classifyScan(raw);
    if (parsed.kind === 'member') {
      // 消费赠分 Tab：统一扫码仍优先进赠分录入；其它 Tab：走会员码核销
      const grantFirst = nextPurpose === 'grant' || (nextPurpose === 'verify' && this.data.curTab === TAB_GRANT);
      if (grantFirst) this.identifyByToken(parsed.payload.token);
      else this.verifyMemberPass(parsed.payload);
      return;
    }
    if (nextPurpose === 'grant') {
      this.setScanFail('grant', '请扫顾客会员码', '消费赠分只认会员码。预约票或订单码无法录入金额。');
      return;
    }
    if (parsed.kind === 'coupon') {
      this.redeemStoreCouponById(parsed.payload.userCouponId);
      return;
    }
    if (parsed.kind === 'gift') {
      this.verifyGiftPickup(parsed.payload.claimCode);
      return;
    }
    if (parsed.kind === 'pickup') {
      this.verifyOrderPickup(parsed.payload.pickupCode, 'scan');
      return;
    }
    if (parsed.kind === 'redeem') {
      this.setScanFail('verify', '这是订单核销码', '会员码用于核验权益与门店礼券，预约票用于入场核销。订单码请走订单认领。');
      return;
    }
    if (parsed.kind === 'booking') {
      const bookingId = (parsed.payload && parsed.payload.bookingId) || '';
      const ticketCode = (parsed.payload && parsed.payload.ticketCode) || '';
      if (!looksLikeBookingRef(bookingId, ticketCode)) {
        this.setScanFail('verify', '未识别到会员码或预约票', '请对准顾客「我的 → 会员码」，或预约确认里的票码。');
        return;
      }
      this.verifyBookingById(bookingId, ticketCode);
      return;
    }
    this.setScanFail('verify', '未识别到内容', '请再扫一次会员码或预约票。');
  },

  async verifyMemberPass(payload) {
    this._retryMemberPayload = payload || {};
    wx.showLoading({ title: '核验中…' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'getMemberPass',
        data: { action: 'verify', token: payload.token, memberNo: payload.memberNo || '' }
      });
      wx.hideLoading();
      const result = (res && res.result) || {};
      if (!result.success) {
        const retryable = isRetryableError(result);
        this.setData({
          lastVerify: {
            ok: false,
            kind: 'member',
            kindLabel: '会员码核验',
            title: '会员码核验失败',
            sub: result.msg || '请让顾客刷新会员码后再试',
            badge: '失败',
            canRetry: true,
            retryKind: retryable ? 'member' : 'scan'
          }
        });
        wx.showModal({
          title: '会员码核验失败',
          content: result.msg || '核验失败。会员码 60 秒过期，请让顾客刷新后再扫。',
          confirmText: '再扫一次',
          confirmColor: '#C4A76C',
          success: (m) => {
            if (m.confirm) this.handleScan({ currentTarget: { dataset: { purpose: 'verify' } } });
          }
        });
        return;
      }
      const valid = !!result.valid;
      const expired = !!result.expired;
      const preferredCouponId = String(result.preferredCouponId || '').trim();
      this._preferredCouponId = preferredCouponId;
      this.setData({
        showMemberPassResult: true,
        memberPassClosing: false,
        memberPassStep: 'pass',
        passPerksExpanded: false,
        couponRedeemForm: {
          userCouponId: '',
          title: '',
          value: 0,
          minSpend: 0,
          amount: '',
          memberOpenid: result.memberOpenid || '',
          memberToken: payload.token || ''
        },
        memberPassResult: {
          valid,
          expired,
          kindLabel: '会员码核验 · 不消耗、不入场',
          msg: result.msg || (valid ? '核验通过' : (expired ? '会员码已过期' : '核验未通过')),
          memberNo: result.memberNo || payload.memberNo || '',
          nickName: result.nickName || '',
          levelName: result.levelName || '',
          discountText: formatDiscount(result.discountRate),
          perks: valid ? collectCurrentPerkItems(LEVEL_BENEFITS, result.level || 1) : [],
          preferredCouponId,
          couponPrefill: !!preferredCouponId,
          storeCoupons: [],
          storeCouponsLoaded: false,
          storeCouponError: ''
        },
        lastVerify: {
          ok: valid,
          kind: 'member',
          kindLabel: '会员码核验',
          title: valid ? '会员码核验通过' : (expired ? '会员码已过期' : '会员码核验未通过'),
          sub: [result.nickName, result.memberNo || payload.memberNo].filter(Boolean).join(' · ') || (result.msg || ''),
          badge: valid ? '通过' : (expired ? '过期' : '未通过'),
          canRetry: !valid,
          retryKind: expired ? 'scan' : 'member'
        }
      }, () => {
        this.schedulePassRedeemLayout();
      });
      if (valid) {
        this.loadStoreCouponsForMember({
          token: payload.token || '',
          memberOpenid: result.memberOpenid || '',
          preferredCouponId
        });
      }
    } catch (e) {
      wx.hideLoading();
      this.setData({
        lastVerify: {
          ok: false,
          kind: 'member',
          kindLabel: '会员码核验',
          title: '核验请求失败',
          sub: formatCloudFnError(e, '网络异常，请再试'),
          badge: '失败',
          canRetry: true,
          retryKind: 'member'
        }
      });
      wx.showModal({
        title: '核验请求失败',
        content: formatCloudFnError(e, '网络异常，请再试'),
        confirmText: '再试',
        confirmColor: '#C4A76C',
        success: (m) => {
          if (m.confirm) this.verifyMemberPass(this._retryMemberPayload || payload);
        }
      });
    }
  },

  closeMemberPassResult() {
    if (this.data.memberPassClosing || !this.data.showMemberPassResult) return;
    this.setData({ memberPassClosing: true });
    setTimeout(() => {
      this._preferredCouponId = '';
      this.setData({
        showMemberPassResult: false,
        memberPassClosing: false,
        memberPassStep: 'pass',
        passPerksExpanded: false,
        couponReceiptPaths: [],
        couponRedeemForm: { userCouponId: '', title: '', value: 0, minSpend: 0, amount: '', memberOpenid: '', memberToken: '' }
      });
    }, 180);
  },

  togglePassPerks() {
    this.setData({ passPerksExpanded: !this.data.passPerksExpanded }, () => {
      this.schedulePassRedeemLayout();
    });
  },

  /**
   * 进入核销步：优先顾客亮码已选券，其次仅一张券时预选
   */
  applyCouponPrefill(list, preferredId, formBase) {
    const coupons = list || [];
    const base = formBase || this.data.couponRedeemForm || {};
    const want = String(preferredId || this._preferredCouponId || '').trim();
    let pick = want ? coupons.find((c) => c && c._id === want) : null;
    if (!pick && coupons.length === 1) pick = coupons[0];
    if (!pick) {
      return {
        memberPassStep: 'redeem',
        passPerksExpanded: false,
        couponRedeemForm: {
          ...base,
          userCouponId: '',
          title: '',
          value: 0,
          minSpend: 0,
          amount: ''
        },
        'memberPassResult.couponPrefill': false
      };
    }
    return {
      memberPassStep: 'redeem',
      passPerksExpanded: false,
      couponRedeemForm: {
        ...base,
        userCouponId: pick._id || '',
        title: pick.title || '',
        value: Number(pick.value) || 0,
        minSpend: Number(pick.minSpend) || 0,
        amount: ''
      },
      'memberPassResult.couponPrefill': !!(want && pick._id === want)
    };
  },

  openStoreCouponRedeem() {
    const list = (this.data.memberPassResult && this.data.memberPassResult.storeCoupons) || [];
    if (!list.length) {
      return wx.showToast({ title: '暂无门店可用礼券', icon: 'none' });
    }
    const preferredId =
      (this.data.memberPassResult && this.data.memberPassResult.preferredCouponId) ||
      this._preferredCouponId ||
      '';
    this.setData(this.applyCouponPrefill(list, preferredId), () => {
      this.schedulePassRedeemLayout();
    });
  },

  /** 核销弹层：量顶栏后给唯一 scroll-view 写死 px 高度（避免嵌套 enhanced / calc 失效） */
  schedulePassRedeemLayout() {
    if (this._passRedeemLayoutTimer) clearTimeout(this._passRedeemLayoutTimer);
    this._passRedeemLayoutToken = (this._passRedeemLayoutToken || 0) + 1;
    const token = this._passRedeemLayoutToken;
    const run = (delay) => {
      setTimeout(() => {
        if (token !== this._passRedeemLayoutToken) return;
        this.layoutPassRedeemScroll();
      }, delay);
    };
    // 两帧：等 wx:if 切换后量高，再补一次防底栏高度未稳定
    run(48);
    run(160);
  },

  layoutPassRedeemScroll() {
    if (!this.data.showMemberPassResult) return;
    const valid = !!(this.data.memberPassResult && this.data.memberPassResult.valid);
    const isRedeem = valid && this.data.memberPassStep === 'redeem';
    const { windowHeight } = getWindowMetrics();
    const fallbackModalH = Math.floor((windowHeight || 667) * 0.88);
    wx.createSelectorQuery()
      .select('.modal-pass')
      .boundingClientRect()
      .select('.modal-pass .pass-head')
      .boundingClientRect()
      .select('.modal-pass .pass-foot')
      .boundingClientRect()
      .exec((rects) => {
        if (!this.data.showMemberPassResult) return;
        const modal = rects && rects[0];
        const head = rects && rects[1];
        const foot = rects && rects[2];
        const modalH = (modal && modal.height) || fallbackModalH;
        const headH = (head && head.height) || 56;
        // 核销态金额/CTA 已并入 scroll；摘要态底栏在外，需扣除
        const footH = isRedeem ? 0 : (foot && foot.height) || (valid ? 88 : 72);
        const pad = 8;
        const h = Math.max(280, Math.floor(modalH - headH - footH - pad));
        const style = `height:${h}px;`;
        if (style !== this.data.passRedeemScrollStyle) {
          this.setData({ passRedeemScrollStyle: style });
        }
      });
  },

  backToPassSummary() {
    this.setData({
      memberPassStep: 'pass',
      couponRedeemForm: {
        ...this.data.couponRedeemForm,
        userCouponId: '',
        title: '',
        value: 0,
        minSpend: 0,
        amount: ''
      }
    }, () => {
      this.schedulePassRedeemLayout();
    });
  },

  retryLoadStoreCoupons() {
    const form = this.data.couponRedeemForm || {};
    this.setData({
      'memberPassResult.storeCouponsLoaded': false,
      'memberPassResult.storeCouponError': '',
      'memberPassResult.storeCoupons': []
    });
    this.loadStoreCouponsForMember({
      token: form.memberToken || '',
      memberOpenid: form.memberOpenid || '',
      preferredCouponId: this._preferredCouponId || ''
    });
  },

  closeCouponRedeemResult() {
    this.setData({ showCouponRedeemResult: false });
  },

  goCouponRedeemGrantTab() {
    this.setData({
      showCouponRedeemResult: false,
      curTab: TAB_GRANT
    });
  },

  chooseCouponReceipt() {
    if (!(this.data.couponRedeemForm && this.data.couponRedeemForm.userCouponId)) {
      return wx.showToast({ title: '请先选择礼券', icon: 'none' });
    }
    const current = this.data.couponReceiptPaths || [];
    const remain = Math.max(0, 3 - current.length);
    if (remain <= 0) {
      return wx.showToast({ title: '最多上传 3 张商品图', icon: 'none' });
    }
    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (res) => {
        const paths = (res.tempFiles || []).map((f) => f.tempFilePath).filter(Boolean);
        this.setData({
          couponReceiptPaths: current.concat(paths).slice(0, 3)
        });
      }
    });
  },

  removeCouponReceipt(e) {
    const idx = parseInt(e.currentTarget.dataset.idx, 10);
    if (!Number.isFinite(idx)) return;
    const list = (this.data.couponReceiptPaths || []).slice();
    list.splice(idx, 1);
    this.setData({ couponReceiptPaths: list });
  },

  previewCouponReceipt(e) {
    const idx = parseInt(e.currentTarget.dataset.idx, 10) || 0;
    const urls = this.data.couponReceiptPaths || [];
    if (!urls.length) return;
    wx.previewImage({ current: urls[idx], urls });
  },

  async uploadCouponReceiptImages() {
    const locals = this.data.couponReceiptPaths || [];
    if (!locals.length) return [];
    const storeId = String(this.data.storeId || 'store').slice(0, 24);
    const fileIds = [];
    for (let i = 0; i < locals.length; i += 1) {
      const cloudPath = `store-coupon-receipts/${storeId}/${Date.now()}_${i}.jpg`;
      const up = await wx.cloud.uploadFile({
        cloudPath,
        filePath: locals[i]
      });
      if (!up || !up.fileID) throw new Error('商品图上传失败');
      fileIds.push(up.fileID);
    }
    return fileIds;
  },

  async loadStoreCouponsForMember(opts) {
    const options = typeof opts === 'string' ? { token: opts } : (opts || {});
    const token = String(options.token || '').trim();
    const memberOpenid = String(options.memberOpenid || '').trim();
    const preferredHint = String(
      options.preferredCouponId || this._preferredCouponId || ''
    ).trim();
    if (!this.data.storeId) {
      if (this.data.showMemberPassResult) {
        this.setData({
          'memberPassResult.storeCoupons': [],
          'memberPassResult.storeCouponsLoaded': true,
          'memberPassResult.storeCouponError': '请先选择门店后再核销'
        });
      }
      return;
    }
    if (!token && !memberOpenid) {
      if (this.data.showMemberPassResult) {
        this.setData({
          'memberPassResult.storeCoupons': [],
          'memberPassResult.storeCouponsLoaded': true,
          'memberPassResult.storeCouponError': '未识别到会员，请重新扫码'
        });
      }
      return;
    }
    try {
      const res = await wx.cloud.callFunction({
        name: 'verifyStoreCoupon',
        data: {
          action: 'listByMember',
          storeId: this.data.storeId,
          memberToken: token || undefined,
          memberOpenid: memberOpenid || undefined,
          preferredCouponId: preferredHint || undefined
        }
      });
      const result = (res && res.result) || {};
      if (!this.data.showMemberPassResult) return;
      if (!result.success) {
        this.setData({
          'memberPassResult.storeCoupons': [],
          'memberPassResult.storeCouponsLoaded': true,
          'memberPassResult.storeCouponError': result.msg || '查询门店礼券失败'
        });
        return;
      }
      const coupons = result.coupons || [];
      const preferredCouponId = String(
        result.preferredCouponId || preferredHint || ''
      ).trim();
      if (preferredCouponId) this._preferredCouponId = preferredCouponId;

      const formBase = {
        ...(this.data.couponRedeemForm || {}),
        memberOpenid: result.memberOpenid || memberOpenid || '',
        memberToken: token
      };

      const patch = {
        'memberPassResult.storeCoupons': coupons,
        'memberPassResult.storeCouponsLoaded': true,
        'memberPassResult.storeCouponError': '',
        'memberPassResult.preferredCouponId': preferredCouponId,
        couponRedeemForm: formBase
      };

      // 顾客已选券：自动进入确认核销态（仍可返回改选）
      if (preferredCouponId && coupons.some((c) => c && c._id === preferredCouponId)) {
        Object.assign(patch, this.applyCouponPrefill(coupons, preferredCouponId, formBase));
      }

      this.setData(patch, () => {
        if (patch.memberPassStep === 'redeem') {
          this.schedulePassRedeemLayout();
        }
      });
    } catch (e) {
      console.warn('loadStoreCouponsForMember', e);
      if (this.data.showMemberPassResult) {
        this.setData({
          'memberPassResult.storeCoupons': [],
          'memberPassResult.storeCouponsLoaded': true,
          'memberPassResult.storeCouponError': formatCloudFnError(e, '查询门店礼券失败')
        });
      }
    }
  },

  pickStoreCoupon(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    const id = ds.id || '';
    const preferred =
      (this.data.memberPassResult && this.data.memberPassResult.preferredCouponId) ||
      this._preferredCouponId ||
      '';
    this.setData({
      couponRedeemForm: {
        ...this.data.couponRedeemForm,
        userCouponId: id,
        title: ds.title || '',
        value: Number(ds.value) || 0,
        minSpend: Number(ds.min) || 0
      },
      'memberPassResult.couponPrefill': !!(preferred && id && preferred === id)
    });
  },

  onCouponAmountInput(e) {
    this.setData({ 'couponRedeemForm.amount': (e.detail && e.detail.value) || '' });
  },

  async redeemStoreCoupon() {
    if (this.data.couponRedeeming) return;
    if (!hasPermission(this._role || {}, 'verifyStoreCoupon')) {
      return wx.showToast({ title: '无门店礼券核销权限', icon: 'none' });
    }
    const form = this.data.couponRedeemForm || {};
    if (!form.userCouponId) {
      return wx.showToast({ title: '请先选择礼券', icon: 'none' });
    }
    const amountText = String(form.amount || '').trim();
    if (form.minSpend > 0 && !amountText) {
      return wx.showToast({ title: '请填写消费金额以校验门槛', icon: 'none' });
    }
    const amountParsed = amountText ? parseGrantAmount(amountText) : null;
    if (amountText && amountParsed && !amountParsed.ok) {
      return wx.showToast({ title: amountParsed.msg || '金额无效', icon: 'none' });
    }
    const willSubmitPoints = !!(amountParsed && amountParsed.ok && amountParsed.amount > 0);
    const receiptPaths = this.data.couponReceiptPaths || [];
    if (willSubmitPoints && !receiptPaths.length) {
      return wx.showToast({ title: '请上传商品照片', icon: 'none' });
    }

    const confirmed = await new Promise((resolve) => {
      wx.showModal({
        title: '确认核销',
        content: willSubmitPoints
          ? `将核销「${form.title || '礼券'}」，并按消费 ¥${amountParsed.amount} 提交线下积分（待店长审核）。请确认商品图已上传。`
          : `将核销「${form.title || '礼券'}」。未填消费金额，本次不提交积分。`,
        confirmText: '确认核销',
        confirmColor: '#C4A76C',
        success: (m) => resolve(!!m.confirm),
        fail: () => resolve(false)
      });
    });
    if (!confirmed) return;

    this.setData({ couponRedeeming: true });
    wx.showLoading({ title: willSubmitPoints ? '上传商品图…' : '核销中…', mask: true });
    try {
      let receiptImages = [];
      if (receiptPaths.length) {
        receiptImages = await this.uploadCouponReceiptImages();
        wx.showLoading({ title: '核销中…', mask: true });
      }
      const res = await wx.cloud.callFunction({
        name: 'verifyStoreCoupon',
        data: {
          action: 'redeem',
          storeId: this.data.storeId,
          storeName: this.data.storeName || '',
          userCouponId: form.userCouponId,
          memberOpenid: form.memberOpenid || '',
          memberToken: form.memberToken || '',
          amount: amountText || undefined,
          receiptImages: receiptImages.length ? receiptImages : undefined,
          clientRequestId: newRequestId()
        }
      });
      wx.hideLoading();
      const result = (res && res.result) || {};
      if (!result.success) {
        wx.showToast({ title: result.msg || '核销失败', icon: 'none' });
        return;
      }

      let pointsStatus = 'skipped';
      let pointsTitle = '未填金额，未提交积分';
      let pointsLamp = '';
      let tip = '';
      let showGrantLink = false;
      if (result.pointsGrantFailed) {
        pointsStatus = 'failed';
        pointsTitle = '积分申请失败';
        pointsLamp = 'danger';
        tip = result.pointsGrantTip || result.pointsGrantMsg || '可到消费赠分补录';
        showGrantLink = true;
      } else if (result.pointsGrantPending || result.pointsGrantSubmitted) {
        pointsStatus = 'pending';
        pointsTitle = result.pointsGrantMsg
          || (result.previewPoints > 0
            ? `积分已提交待审（预计 +${result.previewPoints}）`
            : '积分已提交待店长审核');
        pointsLamp = 'warn';
        tip = '';
      } else if (willSubmitPoints) {
        pointsStatus = 'failed';
        pointsTitle = '积分未提交';
        pointsLamp = 'danger';
        tip = '请到消费赠分补录';
        showGrantLink = true;
      }

      this.setData({
        showMemberPassResult: false,
        memberPassStep: 'pass',
        passPerksExpanded: false,
        showCouponRedeemResult: true,
        couponReceiptPaths: [],
        couponRedeemResult: {
          ok: true,
          kindLabel: result.kindLabel || '门店礼券 · 已核销',
          title: '核销成功',
          titleLamp: 'blink',
          sub: [
            result.title,
            result.value != null ? `抵 ¥${result.value}` : ''
          ].filter(Boolean).join(' · '),
          pointsStatus,
          pointsTitle,
          pointsLamp,
          tip,
          showGrantLink
        },
        lastVerify: {
          ok: true,
          kind: 'coupon',
          kindLabel: '门店礼券核销',
          title: result.title || '礼券已核销',
          sub: result.pointsGrantMsg || result.msg || '',
          badge: result.pointsGrantPending
            ? '积分待审'
            : (result.pointsGrantFailed ? '积分失败' : '已核销'),
          canRetry: false
        },
        couponRedeemForm: { userCouponId: '', title: '', value: 0, minSpend: 0, amount: '', memberOpenid: '', memberToken: '' }
      });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: formatCloudFnError(e, '核销失败'), icon: 'none' });
    } finally {
      this.setData({ couponRedeeming: false });
    }
  },

  async redeemStoreCouponById(userCouponId) {
    if (!userCouponId) return;
    if (!this.data.storeId) {
      return wx.showToast({ title: '请先选择门店', icon: 'none' });
    }
    this.setData({
      couponRedeemForm: {
        ...this.data.couponRedeemForm,
        userCouponId,
        amount: '',
        minSpend: 0
      }
    });
    await this.redeemStoreCoupon();
  },

  verifyGiftPickup(claimCode) {
    const code = String(claimCode || '').trim().toUpperCase();
    if (!code) {
      this.setScanFail('verify', '未识别到礼赠领取码', '请扫顾客礼赠页上的 GIFT 二维码。');
      return;
    }
    if (!hasPermission(this._role || {}, 'verifyGiftPickup')) {
      return wx.showToast({ title: '无礼赠自提核销权限', icon: 'none' });
    }
    if (!this.data.storeId) {
      return wx.showToast({ title: '请先选择门店', icon: 'none' });
    }
    this._retryGiftClaim = code;
    wx.showModal({
      title: '核销礼赠自提',
      content: `领取码 ${code}\n确认顾客已取走标本？`,
      confirmText: '确认领取',
      confirmColor: '#C4A76C',
      success: async (m) => {
        if (!m.confirm) return;
        wx.showLoading({ title: '核销中…', mask: true });
        try {
          const call = await wx.cloud.callFunction({
            name: 'manageGift',
            data: {
              action: 'verifyPickup',
              claimCode: code,
              storeId: this.data.storeId || ''
            }
          });
          wx.hideLoading();
          const result = (call && call.result) || {};
          if (!result.success) {
            this.setData({
              lastVerify: {
                ok: false,
                kind: 'gift',
                kindLabel: '礼赠自提核销',
                title: '礼赠无法核销',
                sub: formatCloudFnError(result, result.msg || '核销失败'),
                badge: '失败',
                canRetry: true,
                retryKind: 'gift'
              }
            });
            wx.showModal({
              title: '礼赠无法核销',
              content: formatCloudFnError(result, result.msg || '核销失败'),
              confirmText: '再扫一次',
              confirmColor: '#C4A76C',
              success: (r) => {
                if (r.confirm) this.handleScan({ currentTarget: { dataset: { purpose: 'verify' } } });
              }
            });
            return;
          }
          const titles = (result.products || []).map((p) => p.title || p.name).filter(Boolean).slice(0, 2).join('、');
          this.setData({
            lastVerify: {
              ok: !result.already,
              kind: 'gift',
              kindLabel: '礼赠自提核销',
              title: result.already ? '此前已领取' : '已确认领取',
              sub: [result.orderNo, titles, result.storeName].filter(Boolean).join(' · '),
              badge: result.already ? '已核' : '完成',
              canRetry: false,
              retryKind: ''
            }
          });
          wx.showToast({ title: result.already ? '此前已领取' : '已确认领取', icon: 'success' });
        } catch (e) {
          wx.hideLoading();
          this.setScanFail('verify', '礼赠核销失败', formatCloudFnError(e, '网络异常，请再试'));
        }
      }
    });
  },

  /**
   * 门店自取核销（普通买单自取）：店员 / 店长扫顾客订单详情里的自取码。
   * 与礼赠自提分开：走 managerShipOrder.verifyPickup，订单状态 ready_pickup → received。
   * 两段式动线：先预查订单（preview）→ 弹卡片核对单号/藏品/买家 → 再确认交付。
   */
  async verifyOrderPickup(rawCode, channel) {
    const code = String(rawCode || '').trim().toUpperCase().replace(/^PICKUP:?/, '');
    if (!code) {
      this.setScanFail('verify', '未识别到自取码', '请扫顾客订单详情里的自取二维码，或让顾客报出自取码。');
      return;
    }
    if (!this.data.canVerifyPickup) {
      return wx.showToast({ title: '无门店自取核销权限', icon: 'none' });
    }
    if (!this.data.storeId) {
      return wx.showToast({ title: '请先选择门店', icon: 'none' });
    }
    const chan = channel === 'manual' || channel === 'list' ? channel : 'scan';
    this._retryPickupCode = code;
    this._pickupChannel = chan;
    // 重试场景：先收起上一轮回执，避免确认卡被结果弹层挡住
    if (this.data.showPickupVerifyResult) this.setData({ showPickupVerifyResult: false });
    wx.showLoading({ title: '核对订单…', mask: true });
    try {
      const call = await wx.cloud.callFunction({
        name: 'managerShipOrder',
        data: { action: 'verifyPickup', code, channel: chan, preview: true }
      });
      wx.hideLoading();
      const result = (call && call.result) || {};
      if (!result.success) {
        this.onPickupBlocked(result, code, chan);
        return;
      }
      const info = result.order || {};
      if (result.already) {
        this.setData({
          showPickupConfirm: false,
          showPickupVerifyResult: true,
          pickupVerifyResult: this.buildPickupReceipt({ info, already: true, code, points: result.pointsGranted })
        });
        this.setPickupLastVerify(info, { ok: false, badge: '已核', title: '此前已核销' });
        return;
      }
      // 云端尚未升级（不识别 preview）：本次调用已直接核销，按完成回执展示，避免二次核销
      if (result.preview !== true) {
        this.setData({
          showPickupConfirm: false,
          showPickupVerifyResult: true,
          pickupVerifyResult: this.buildPickupReceipt({ info, already: false, code, points: result.pointsGranted })
        });
        this.setPickupLastVerify(info, { ok: true, badge: '完成', title: '已确认交付' });
        wx.vibrateShort({ type: 'medium' });
        this.loadPendingPickups();
        return;
      }
      if (result.canVerify === false) {
        this.onPickupBlocked({ msg: result.blockReason || '当前订单状态不可核销', code: 'BLOCKED' }, code, chan);
        return;
      }
      this._pickupConfirmCode = code;
      this.setData({
        showPickupConfirm: true,
        pickupConfirm: {
          ...info,
          codeText: String(info.pickupCode || code || '').toUpperCase(),
          channel: chan,
          payTimeText: formatTime(info.payTime || info.createTime)
        }
      });
    } catch (e) {
      wx.hideLoading();
      this.setScanFail('verify', '自取核销失败', formatCloudFnError(e, '网络异常，请再试'));
    }
  },

  /** 预查失败（找不到码 / 非本店 / 状态不可核销）：统一回执 + 可重试 */
  onPickupBlocked(result, code, chan) {
    const msg = formatCloudFnError(result, (result && result.msg) || '核销失败');
    const notFound = !!(result && result.code === 'NOT_FOUND');
    const gift = !!(result && result.code === 'GIFT_PICKUP');
    this.setData({
      showPickupConfirm: false,
      showPickupVerifyResult: true,
      pickupVerifyResult: {
        ok: false,
        kindLabel: '门店自取核销',
        title: notFound ? '未找到此自取码' : gift ? '请改扫礼赠领取码' : '自取无法核销',
        sub: msg,
        claimedText: '',
        msg: gift ? '礼赠自提请切到「礼赠」核销，或让顾客打开礼赠领取页。' : '',
        canRetry: !notFound,
        retryText: '再试一次'
      }
    });
    this.setPickupLastVerify(null, {
      ok: false,
      badge: '失败',
      title: notFound ? '未找到自取码' : '自取无法核销',
      sub: msg,
      canRetry: !notFound
    });
  },

  /** 结果回执模型：单号 / 藏品 / 买家 / 核销时间一次说清 */
  buildPickupReceipt({ info, already, code, points }) {
    const o = info || {};
    const pts = Number(points) || 0;
    return {
      ok: !already,
      already: !!already,
      kindLabel: '门店自取核销',
      title: already ? '此前已核销' : '已确认交付',
      pointsText: pts > 0 ? `顾客获赠 ${pts} 积分，已计入线上消费累计` : '',
      name: o.title || '藏品',
      sub: [o.orderNo, o.storeName].filter(Boolean).join(' · '),
      phone: o.buyerPhoneMasked ? `买家手机 ${o.buyerPhoneMasked}` : '',
      claimedText: formatTime(o.claimedAt) ? `${formatTime(o.claimedAt)} 已核销` : '',
      codeText: String(o.pickupCode || code || '').toUpperCase(),
      msg: already
        ? '请勿重复交付；如确认误核销，请联系店长在后台发起冲正。'
        : '请把藏品交给顾客，本次门店自取已完成。',
      canRetry: false,
      retryText: ''
    };
  },

  /** 写入「最近一次核销」卡片（Tab 内可见，失败可重试） */
  setPickupLastVerify(info, extra) {
    const o = info || {};
    const base = extra || {};
    this.setData({
      lastVerify: {
        ok: !!base.ok,
        kind: 'pickup',
        kindLabel: '门店自取核销',
        title: base.title || (base.ok ? '已确认交付' : '自取无法核销'),
        sub: base.sub || [o.orderNo, o.title, o.storeName].filter(Boolean).join(' · '),
        badge: base.badge || (base.ok ? '完成' : '失败'),
        canRetry: !!base.canRetry,
        retryKind: base.canRetry ? 'pickup' : ''
      }
    });
  },

  /** 二次确认卡：确认交付（真正写入核销） */
  async confirmPickupDelivery() {
    const confirm = this.data.pickupConfirm || {};
    const code = String(confirm.codeText || confirm.pickupCode || this._pickupConfirmCode || '').trim();
    if (!code) {
      wx.showToast({ title: '自取码已失效，请重新扫码', icon: 'none' });
      this.setData({ showPickupConfirm: false });
      return;
    }
    if (this.data.pickupConfirmBusy) return;
    this.setData({ pickupConfirmBusy: true });
    try {
      const call = await wx.cloud.callFunction({
        name: 'managerShipOrder',
        data: { action: 'verifyPickup', code, channel: this._pickupChannel || confirm.channel || 'scan' }
      });
      const result = (call && call.result) || {};
      this.setData({ pickupConfirmBusy: false, showPickupConfirm: false });
      if (!result.success) {
        this.onPickupBlocked(result, code, this._pickupChannel || 'scan');
        return;
      }
      const info = result.order || {};
      this.setData({
        showPickupVerifyResult: true,
        pickupVerifyResult: this.buildPickupReceipt({ info, already: !!result.already, code, points: result.pointsGranted })
      });
      this.setPickupLastVerify(info, {
        ok: !result.already,
        badge: result.already ? '已核' : '完成',
        title: result.already ? '此前已核销' : '已确认交付'
      });
      wx.vibrateShort({ type: result.already ? 'light' : 'medium' });
      if (!result.already) this.loadPendingPickups();
    } catch (e) {
      this.setData({ pickupConfirmBusy: false });
      this.setScanFail('verify', '自取核销失败', formatCloudFnError(e, '网络异常，请再试'));
    }
  },

  closePickupConfirm() {
    if (this.data.pickupConfirmBusy) return;
    this.setData({ showPickupConfirm: false });
  },

  closePickupVerifyResult() {
    this.setData({ showPickupVerifyResult: false, pickupCodeInput: '' });
  },

  onPickupCodeInput(e) {
    this.setData({ pickupCodeInput: String((e.detail && e.detail.value) || '').toUpperCase() });
  },

  /** 手输自取码（顾客口头报码）：与扫码同一套预查 + 确认流程 */
  submitPickupCode() {
    const code = String(this.data.pickupCodeInput || '').trim();
    if (!code) {
      wx.showToast({ title: '请输入自取码', icon: 'none' });
      return;
    }
    // 礼赠自提：领取人常常单独到店且只有领取码（此前手输框只认 PICKUP，
    // 导致「扫码才行、报码不行」）。GIFT 前缀改走礼赠核销通道。
    if (/^GIFT[:：]/i.test(code)) {
      this.verifyGiftPickup(code.replace(/^GIFT[:：]/i, ''), 'manual');
      return;
    }
    this.verifyOrderPickup(code, 'manual');
  },

  /** 列表里直接交接：复用预查 + 确认卡 */
  verifyPickupFromList(e) {
    const code = (e.currentTarget.dataset && e.currentTarget.dataset.code) || '';
    if (!String(code).trim()) {
      wx.showToast({ title: '该订单暂无自取码，请让顾客出示凭证', icon: 'none' });
      return;
    }
    this.verifyOrderPickup(code, 'list');
  },

  /** 待自取订单（本店）：店员可不依赖顾客出示凭证直接交付 */
  async loadPendingPickups() {
    if (!this.data.canVerifyPickup || !this.data.storeId) {
      this.setData({ pendingPickups: [], pickupsLoading: false, pickupsError: '' });
      return;
    }
    this.setData({ pickupsLoading: true, pickupsError: '' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'managerShipOrder',
        data: { action: 'listPendingPickups', storeId: this.data.storeId, limit: 20 }
      });
      const result = (res && res.result) || {};
      if (!result.success) {
        const rawMsg = String(result.msg || '');
        // 云端未升级时该 action 会落到发货分支并报「缺少订单 ID」
        const notDeployed = /缺少订单 ID|未知的?action|not supported/i.test(rawMsg);
        this.setData({
          pickupsLoading: false,
          pendingPickups: [],
          pickupsError: notDeployed
            ? '待自取列表需先更新云端版本，暂可扫顾客自取码核销'
            : formatCloudFnError(result, rawMsg || '加载待自取订单失败')
        });
        return;
      }
      const list = (result.list || []).map((item) => ({
        ...item,
        timeText: formatTime(item.payTime || item.createTime),
        metaText: [item.productCount ? `${item.productCount} 件` : '', item.buyerPhoneMasked].filter(Boolean).join(' · ')
      }));
      this.setData({ pendingPickups: list, pickupsLoading: false, pickupsError: '' });
    } catch (e) {
      this.setData({
        pickupsLoading: false,
        pendingPickups: [],
        pickupsError: formatCloudFnError(e, '加载待自取订单失败')
      });
    }
  },

  verifyBooking(e) {
    this.verifyBookingById(e.currentTarget.dataset.id, '');
  },

  verifyBookingById(bookingId, ticketCode, options) {
    const id = String(bookingId || '').trim();
    const code = String(ticketCode || '').trim();
    if (!id && !code) {
      this.setScanFail('verify', '未识别到票号', '请再扫预约票，或从待核销列表点核销。');
      return;
    }
    this._retryBooking = { id, code };
    const run = async () => {
      wx.showLoading({ title: '核销中…', mask: true });
      try {
        const call = await wx.cloud.callFunction({
          name: 'verifyBooking',
          data: {
            bookingId: id || undefined,
            ticketCode: code || undefined,
            storeId: this.data.storeId || ''
          }
        });
        wx.hideLoading();
        const result = (call && call.result) || {};
        if (!result.success) {
          const retryable = isRetryableError(result);
          this.setData({
            lastVerify: {
              ok: false,
              kind: 'booking',
              kindLabel: '预约票核销',
              title: '预约票无法核销',
              sub: formatCloudFnError(result, result.msg || '核销失败'),
              badge: '失败',
              canRetry: true,
              retryKind: retryable ? 'booking' : 'scan'
            }
          });
          wx.showModal({
            title: '预约票无法核销',
            content: formatCloudFnError(result, result.msg || '核销失败'),
            confirmText: retryable ? '再试' : '再扫一次',
            confirmColor: '#C4A76C',
            success: (m) => {
              if (!m.confirm) return;
              if (retryable) this.verifyBookingById(id, code, { skipConfirm: true });
              else this.handleScan({ currentTarget: { dataset: { purpose: 'verify' } } });
            }
          });
          return;
        }
        if (result.already) {
          this.setData({
            showBookingVerifyResult: true,
            bookingVerifyResult: {
              ok: false,
              already: true,
              canRetry: false,
              kindLabel: '预约票核销 · 入场消耗',
              title: '此前已核销',
              msg: '该预约已核销过，未重复入场。可申请冲正恢复为未核销。',
              name: result.name || '',
              ticketCode: result.ticketCode || code,
              bookingTitle: result.title || ''
            },
            lastVerify: {
              ok: false,
              kind: 'booking',
              kindLabel: '预约票核销',
              title: '预约票此前已核销',
              sub: [result.name, result.ticketCode || code].filter(Boolean).join(' · '),
              badge: '已核销',
              canRetry: false
            }
          });
          this._pendingReverse = { id: id || result.bookingId, code: code || result.ticketCode };
          return;
        }
        this.setData({
          showBookingVerifyResult: true,
          bookingVerifyResult: {
            ok: true,
            already: false,
            canRetry: false,
            kindLabel: '预约票核销 · 入场消耗',
            title: '已核销入场',
            msg: result.msg || '访客已核销，可入场。',
            name: result.name || '',
            ticketCode: result.ticketCode || code,
            bookingTitle: result.title || '',
            people: result.people || 0
          },
          lastVerify: {
            ok: true,
            kind: 'booking',
            kindLabel: '预约票核销',
            title: '预约票已核销入场',
            sub: [result.name || result.title, result.ticketCode || code].filter(Boolean).join(' · '),
            badge: '已入场',
            canRetry: false
          }
        });
        this.loadBookings();
      } catch (err) {
        wx.hideLoading();
        this.setData({
          lastVerify: {
            ok: false,
            kind: 'booking',
            kindLabel: '预约票核销',
            title: '核销请求失败',
            sub: formatCloudFnError(err, '网络异常，请再试'),
            badge: '失败',
            canRetry: true,
            retryKind: 'booking'
          }
        });
        wx.showModal({
          title: '核销请求失败',
          content: formatCloudFnError(err, '网络异常，请再试'),
          confirmText: '再试',
          confirmColor: '#C4A76C',
          success: (m) => {
            if (m.confirm) this.verifyBookingById(id, code, { skipConfirm: true });
          }
        });
      }
    };
    if (options && options.skipConfirm) {
      run();
      return;
    }
    wx.vibrateShort({ type: 'heavy' });
    wx.showModal({
      title: '确认核销预约票',
      content: '确认该访客已到店入场？核销后不可重复使用。',
      confirmColor: '#C4A76C',
      success: (res) => {
        if (res.confirm) run();
      }
    });
  },

  closeBookingVerifyResult() {
    this.setData({ showBookingVerifyResult: false });
  },

  requestBookingReverse() {
    const pending = this._pendingReverse || {};
    this.setData({ showBookingVerifyResult: false });
    this.reverseBookingById(pending.id, pending.code);
  },

  async reverseBookingById(bookingId, ticketCode) {
    const id = String(bookingId || '').trim();
    const code = String(ticketCode || '').trim();
    if (!id && !code) return;
    wx.showLoading({ title: '提交冲正…', mask: true });
    try {
      const call = await wx.cloud.callFunction({
        name: 'verifyBooking',
        data: {
          action: 'reverse',
          bookingId: id || undefined,
          ticketCode: code || undefined,
          storeId: this.data.storeId || ''
        }
      });
      const result = (call && call.result) || {};
      wx.hideLoading();
      if (!result.success) {
        wx.showToast({ title: formatCloudFnError(result, result.msg || '冲正失败'), icon: 'none' });
        return;
      }
      wx.showToast({
        title: result.pendingApproval ? (result.msg || '已提交审批') : (result.msg || '已冲正'),
        icon: 'none'
      });
      this.loadBookings();
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: formatCloudFnError(err, '冲正失败'), icon: 'none' });
    }
  },

  // ------------------------------------------------------------ 赠分

  async identifyByToken(token) {
    wx.showLoading({ title: '识别顾客…' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'grantStorePoints',
        data: { action: 'identifyMember', memberToken: token, storeId: this.data.storeId }
      });
      wx.hideLoading();
      const result = (res && res.result) || {};
      if (!result.success || !result.member) {
        wx.showModal({ title: '识别失败', content: result.msg || '请让顾客刷新会员码', showCancel: false, confirmColor: '#C4A76C' });
        return;
      }
      this.setData({
        member: result.member,
        memberOpenid: result.member.openid || '',
        memberToken: token,
        identifyMethod: 'scan_member_code',
        candidates: [],
        previewPoints: null,
        previewMsg: '',
        clientRequestId: newRequestId(),
        grantForm: { ...EMPTY_GRANT_FORM }
      });
    } catch (e) {
      wx.hideLoading();
      wx.showModal({
        title: '识别失败',
        content: formatCloudFnError(e, '网络异常，请再扫会员码'),
        confirmText: '再扫一次',
        confirmColor: '#C4A76C',
        success: (m) => {
          if (m.confirm) this.handleScan({ currentTarget: { dataset: { purpose: 'grant' } } });
        }
      });
    }
  },

  onPhoneTailInput(e) {
    this.setData({ phoneTail: e.detail.value.replace(/\D/g, '').slice(0, 4) });
  },

  async searchByPhone() {
    const tail = this.data.phoneTail;
    if (!/^\d{4}$/.test(tail)) {
      wx.showToast({ title: '请输入手机号后 4 位', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '查找中…' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'grantStorePoints',
        data: { action: 'identifyMember', phoneTail: tail, storeId: this.data.storeId }
      });
      wx.hideLoading();
      const result = (res && res.result) || {};
      if (!result.success) {
        wx.showToast({ title: result.msg || '未找到顾客', icon: 'none' });
        return;
      }
      this.setData({ candidates: result.candidates || [], member: null, memberOpenid: '' });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: formatCloudFnError(e, '查找失败'), icon: 'none' });
    }
  },

  pickCandidate(e) {
    const openid = String((e.currentTarget.dataset && e.currentTarget.dataset.openid) || '').trim();
    if (!openid) return;
    this.identifyByOpenid(openid);
  },

  async identifyByOpenid(openid) {
    if (!openid) return;
    wx.showLoading({ title: '加载会员…' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'grantStorePoints',
        data: {
          action: 'identifyMember',
          targetOpenid: openid,
          identifyMethod: 'phone_search',
          storeId: this.data.storeId
        }
      });
      wx.hideLoading();
      const result = (res && res.result) || {};
      if (!result.success || !result.member) {
        wx.showToast({ title: result.msg || '加载失败', icon: 'none' });
        return;
      }
      this.setData({
        member: result.member,
        memberOpenid: result.member.openid || openid,
        memberToken: '',
        identifyMethod: 'phone_search',
        candidates: [],
        previewPoints: null,
        previewMsg: '',
        clientRequestId: newRequestId(),
        grantForm: { ...EMPTY_GRANT_FORM }
      });
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: formatCloudFnError(err, '加载失败'), icon: 'none' });
    }
  },

  resetMember() {
    this.setData({
      member: null,
      memberOpenid: '',
      memberToken: '',
      identifyMethod: '',
      candidates: [],
      phoneTail: '',
      previewPoints: null,
      previewMsg: '',
      amountError: '',
      granting: false,
      grantForm: { ...EMPTY_GRANT_FORM }
    });
  },

  onGrantInput(e) {
    const field = e.currentTarget.dataset.field;
    if (!field) return;
    let value = e.detail.value;
    const patch = {};
    if (field === 'amount') {
      value = String(value || '').replace(/[^\d.]/g, '');
      const parts = value.split('.');
      if (parts.length > 2) value = `${parts[0]}.${parts.slice(1).join('')}`;
      if (parts[1] && parts[1].length > 2) value = `${parts[0]}.${parts[1].slice(0, 2)}`;
      patch.previewPoints = null;
      patch.previewMsg = '';
      const parsed = parseGrantAmount(value);
      patch.amountError = value && !parsed.ok ? parsed.msg : '';
    }
    if (field === 'receiptNo') value = String(value || '').trim().slice(0, 40);
    if (field === 'remark') value = String(value || '').slice(0, 200);
    patch[`grantForm.${field}`] = value;
    this.setData(patch);
  },

  buildTargetPayload() {
    // 会员码 60 秒过期，优先用 token；过期后退回 openid（已当面确认过身份）
    return this.data.memberToken
      ? { memberToken: this.data.memberToken }
      : { targetOpenid: this.data.memberOpenid, identifyMethod: this.data.identifyMethod || 'phone_search' };
  },

  async previewGrant() {
    if (this.data.previewing) return;
    const parsed = parseGrantAmount(this.data.grantForm.amount);
    if (!this.data.memberOpenid && !this.data.memberToken) {
      wx.showToast({ title: '请先识别顾客', icon: 'none' });
      return;
    }
    if (!parsed.ok) {
      this.setData({ amountError: parsed.msg, previewPoints: null });
      wx.showToast({ title: parsed.msg, icon: 'none' });
      return;
    }
    const amount = parsed.amount;

    this.setData({ previewing: true, amountError: '' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'grantStorePoints',
        data: {
          action: 'preview',
          storeId: this.data.storeId,
          amount,
          ...this.buildTargetPayload()
        }
      });
      const result = (res && res.result) || {};
      if (!result.success) {
        this.setData({ previewing: false, previewPoints: null, previewMsg: result.msg || '试算失败' });
        // token 过期后退回 openid 再试一次
        if (result.expired && this.data.memberOpenid) {
          this.setData({ memberToken: '' });
        }
        return;
      }
      this.setData({
        previewing: false,
        previewPoints: result.points,
        previewMsg: result.quotaOk ? result.ruleText : result.quotaMsg,
        quotaOk: result.quotaOk !== false,
        ruleText: result.ruleText || this.data.ruleText,
        member: result.member ? { ...this.data.member, ...result.member } : this.data.member,
        memberOpenid: result.memberOpenid || this.data.memberOpenid
      });
    } catch (e) {
      this.setData({ previewing: false, previewMsg: formatCloudFnError(e, '试算失败') });
    }
  },

  submitGrant() {
    if (this.data.granting) return;
    const parsed = parseGrantAmount(this.data.grantForm.amount);
    if (!parsed.ok) {
      this.setData({ amountError: parsed.msg });
      wx.showToast({ title: parsed.msg, icon: 'none' });
      return;
    }
    if (this.data.previewPoints === null) {
      wx.showToast({ title: '请先试算应赠积分', icon: 'none' });
      return;
    }
    if (this.data.quotaOk === false) {
      wx.showToast({ title: this.data.previewMsg || '超出额度，无法提交', icon: 'none' });
      return;
    }

    const amount = parsed.amount;
    const member = this.data.member || {};
    const canDirect = this.data.canDirectGrant;
    this.setData({ granting: true });
    wx.showModal({
      title: canDirect ? '确认赠分' : '提交店长审核',
      content: canDirect
        ? `${member.nickName || '顾客'}（${member.memberNo || ''}）\n消费 ¥${amount}，赠送 ${this.data.previewPoints} 积分`
        : `${member.nickName || '顾客'}（${member.memberNo || ''}）\n消费 ¥${amount}，预计 ${this.data.previewPoints} 积分\n提交后需店长审核通过才入账`,
      confirmColor: '#C4A76C',
      success: (res) => {
        if (res.confirm) this.doGrant(amount);
        else this.setData({ granting: false });
      }
    });
  },

  async doGrant(amount) {
    wx.showLoading({ title: '提交中…', mask: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'grantStorePoints',
        data: {
          action: 'grant',
          storeId: this.data.storeId,
          storeName: this.data.storeName,
          amount,
          receiptNo: String(this.data.grantForm.receiptNo || '').trim().slice(0, 40),
          remark: String(this.data.grantForm.remark || '').trim().slice(0, 200),
          clientRequestId: this.data.clientRequestId,
          ...this.buildTargetPayload()
        }
      });
      wx.hideLoading();
      const result = (res && res.result) || {};
      if (!result.success) {
        this.setData({ granting: false });
        wx.showModal({
          title: '赠分失败',
          content: result.msg || '请稍后重试',
          confirmText: '再试',
          confirmColor: '#C4A76C',
          success: (m) => {
            if (m.confirm) {
              this.setData({ granting: true });
              this.doGrant(amount);
            }
          }
        });
        return;
      }
      const member = this.data.member || {};
      const points = result.pointsGranted || result.previewPoints || this.data.previewPoints || 0;
      // 未达赠分门槛：消费已记录并计入门店累计，只是没有积分可赠，文案不能写成「赠分成功」
      const belowThreshold = !result.duplicated && !result.pendingApproval && !(result.pointsGranted > 0);
      const lastGrant = {
        duplicated: !!result.duplicated,
        pending: !!result.pendingApproval,
        title: result.duplicated
          ? '该笔已录入，未重复赠分'
          : (result.pendingApproval ? '已提交店长审核' : (belowThreshold ? '已记录消费' : '赠分成功')),
        sub: [
          member.nickName || member.memberNo || '顾客',
          `¥${amount}`,
          points ? `+${points} 积分` : '',
          belowThreshold ? '未达赠分门槛，已计入门店累计' : ''
        ].filter(Boolean).join(' · '),
        badge: result.duplicated ? '未重复' : (result.pendingApproval ? '待审' : (belowThreshold ? '已记录' : '已入账')),
        ok: !result.duplicated
      };
      this.resetMember();
      this.setData({
        lastGrant,
        clientRequestId: newRequestId()
      });
      wx.showModal({
        title: lastGrant.title,
        content: result.msg || lastGrant.sub,
        showCancel: false,
        confirmColor: '#C4A76C'
      });
      this.loadSummary();
    } catch (e) {
      wx.hideLoading();
      this.setData({ granting: false });
      wx.showModal({
        title: '赠分请求失败',
        content: formatCloudFnError(e, '网络异常，请再试。同一笔不会重复提交。'),
        confirmText: '再试',
        confirmColor: '#C4A76C',
        success: (m) => {
          if (m.confirm) {
            this.setData({ granting: true });
            this.doGrant(amount);
          }
        }
      });
    }
  },

  // ------------------------------------------------------------ 流水

  async loadRecords() {
    this.setData({ recordsLoading: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'grantStorePoints',
        data: { action: 'listRecords', storeId: this.data.storeId, mine: !this.data.canRevoke, page: 1, pageSize: 30 }
      });
      const result = (res && res.result) || {};
      if (!result.success) {
        this.setData({ recordsLoading: false, records: [] });
        if (result.msg) wx.showToast({ title: result.msg, icon: 'none' });
        return;
      }
      this.setData({
        recordsLoading: false,
        records: (result.list || []).map((row) => ({
          ...row,
          timeText: formatTime(row.createTime),
          statusText: PURCHASE_STATUS_TEXT[row.status] || row.status,
          methodText: IDENTIFY_METHOD_TEXT[row.identifyMethod] || ''
        }))
      });
    } catch (e) {
      this.setData({ recordsLoading: false, records: [] });
      wx.showToast({ title: formatCloudFnError(e, '流水加载失败'), icon: 'none' });
    }
  },

  goStorePoints() {
    goApprovals({ hub: 'flow' });
  },

  goApprovals() {
    goApprovals({ mine: true });
  },

  // ------------------------------------------------------------ 签到

  async loadVisitStats() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'storeCheckIn',
        data: { action: 'getTodayStats', storeId: this.data.storeId }
      });
      const result = (res && res.result) || {};
      if (!result.success) {
        this.setData({ visitStatsError: result.msg || '签到统计不可用' });
        return;
      }
      const data = result.data || { total: 0, byStore: {} };
      this.setData({
        visitStatsError: '',
        visitStats: {
          total: data.total || 0,
          storeCount: (data.byStore && data.byStore[this.data.storeId]) || 0,
          storeName: this.data.storeName || '门店'
        }
      });
    } catch (e) {
      this.setData({ visitStatsError: formatCloudFnError(e, '签到统计不可用') });
    }
  },

  noop() {}
});
