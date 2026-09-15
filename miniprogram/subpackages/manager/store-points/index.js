/**
 * 门店积分管理（店长 / 超管）
 * 今日汇总 / 赠分规则（仅超管）
 * 积分流水 · 小票认领 · 外部订单 · 待审 → 统一审批中心
 */
const { guardStaffPage, STAFF_PERMISSIONS_PATH, goApprovals } = require('../utils/staffAuth');
const { formatCloudFnError } = require('../utils/memberScan');
const { fetchStoreCatalog, mapStoreOptions } = require('../../../utils/storeCatalog');
const { displayStoreName } = require('../../../utils/storeName');
const { getPreferredStoreId } = require('../../../utils/storeHelper');
const {
  RULE_TEXT_FALLBACK,
  MODE_OPTIONS,
  MODULE_OPTIONS
} = require('../utils/storePoints');

/* showWhenMode / hideWhenMode 仅控制表单展示，不影响保存字段 */
const RULE_FIELDS = [
  { key: 'threshold', label: '门槛金额（元）', type: 'digit' },
  { key: 'pointsPerThreshold', label: '每档赠送积分', type: 'number', hideWhenMode: 'ratio' },
  { key: 'ratio', label: '比例（0.1 = 10%）', type: 'digit', showWhenMode: 'ratio' },
  { key: 'minAmount', label: '按比例的起赠金额', type: 'digit', showWhenMode: 'ratio' },
  { key: 'maxAmountPerRecord', label: '单笔金额上限', type: 'digit' },
  { key: 'dailyPointsCapPerUser', label: '单用户单日积分上限', type: 'number' },
  { key: 'dailyRecordCapPerUser', label: '单用户单日笔数上限', type: 'number' },
  { key: 'dailyPointsCapPerStore', label: '单店单日积分上限', type: 'number' },
  { key: 'revokeWindowDays', label: '撤销窗口（天）', type: 'number' }
];

Page({
  data: {
    ready: false,
    role: '',
    superAdmin: false,
    curTab: 0,

    storeNames: [],
    storeOptions: [],
    storeIndex: 0,
    storeId: '',
    storeName: '',

    ruleText: RULE_TEXT_FALLBACK,
    summary: { count: 0, amount: 0, points: 0, avgTicket: 0, remaining: 0, cap: 0 },

    modeOptions: MODE_OPTIONS,
    modeLabels: MODE_OPTIONS.map((m) => m.label),
    modeIndex: 0,
    moduleOptions: MODULE_OPTIONS,
    ruleFields: RULE_FIELDS,
    ruleForm: {},
    ruleDocId: '',
    ruleDefault: true,
    ruleSaving: false,

    canManageRules: false,
    workspaceRole: ''
  },

  async onLoad(query) {
    const role = await guardStaffPage('manager');
    if (!role) return;

    const isSuperAdmin = !!(role.isSuperAdmin || role.superAdmin || role.workspaceRole === 'super_admin');
    const canManageRules = isSuperAdmin;
    const catalog = await fetchStoreCatalog();
    const options = mapStoreOptions(catalog);
    const preferred = getPreferredStoreId();
    const index = Math.max(0, options.findIndex((s) => s.storeId === preferred));
    const tabRaw = parseInt(query && query.tab, 10);
    if (Number.isFinite(tabRaw) && tabRaw === 4) {
      wx.redirectTo({ url: STAFF_PERMISSIONS_PATH });
      return;
    }

    // 旧深链：1=流水 → 审批中心积分流水；3=审核 → 审批中心；2=规则 → 新 Tab 1
    if (Number.isFinite(tabRaw) && tabRaw === 1) {
      wx.redirectTo({ url: '/subpackages/manager/approvals/index?hub=flow' });
      return;
    }
    if (Number.isFinite(tabRaw) && tabRaw === 3) {
      wx.redirectTo({ url: '/subpackages/manager/approvals/index' });
      return;
    }

    let curTab = 0;
    if (Number.isFinite(tabRaw) && tabRaw === 2) {
      if (canManageRules) curTab = 1;
      else wx.showToast({ title: '仅超管可配置积分规则', icon: 'none' });
    } else if (query && String(query.tab || '').toLowerCase() === 'rules') {
      if (canManageRules) curTab = 1;
      else wx.showToast({ title: '仅超管可配置积分规则', icon: 'none' });
    }

    this.setData({
      ready: true,
      role: role.role,
      workspaceRole: role.workspaceRole || '',
      superAdmin: isSuperAdmin,
      canManageRules,
      storeOptions: options,
      storeNames: options.map((s) => s.name),
      storeIndex: index,
      storeId: (options[index] && options[index].storeId) || '',
      storeName: displayStoreName(options[index]),
      curTab
    });

    if (curTab === 1) this.loadRule();
    else this.loadSummary();
  },

  onPullDownRefresh() {
    const task = this.data.curTab === 1 ? this.loadRule() : this.loadSummary();
    Promise.resolve(task).then(() => wx.stopPullDownRefresh());
  },

  switchTab(e) {
    const idx = parseInt(e.currentTarget.dataset.idx, 10) || 0;
    if (idx === 1 && !this.data.canManageRules) {
      wx.showToast({ title: '仅超管可配置积分规则', icon: 'none' });
      return;
    }
    wx.vibrateShort({ type: 'light' });
    this.setData({ curTab: idx });
    if (idx === 0) this.loadSummary();
    if (idx === 1) this.loadRule();
  },

  goApprovalsHub() {
    goApprovals({ hub: 'flow' });
  },

  onStoreChange(e) {
    const index = parseInt(e.detail.value, 10) || 0;
    const store = this.data.storeOptions[index];
    if (!store) return;
    this.setData({ storeIndex: index, storeId: store.storeId, storeName: store.name });
    if (this.data.curTab === 1) this.loadRule();
    else this.loadSummary();
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
      this.setData({ summary: result.today || this.data.summary, ruleText: result.ruleText || RULE_TEXT_FALLBACK });
    } catch (e) {
      console.warn('loadSummary', e);
    }
  },

  // ------------------------------------------------------------ 规则

  async loadRule() {
    if (!this.data.canManageRules) {
      wx.showToast({ title: '仅超管可配置积分规则', icon: 'none' });
      return;
    }
    try {
      const res = await wx.cloud.callFunction({
        name: 'getStorePointRules',
        data: { action: 'get', storeId: this.data.storeId }
      });
      const result = (res && res.result) || {};
      if (!result.success) {
        wx.showToast({ title: formatCloudFnError(result, result.msg || '规则加载失败'), icon: 'none' });
        return;
      }
      const config = result.config || {};
      const modeIndex = Math.max(0, MODE_OPTIONS.findIndex((m) => m.value === config.mode));
      this.setData({
        ruleForm: {
          ...config,
          modules: {
            storePurchase: true,
            share: true,
            review: true,
            checkIn: true,
            browse: true,
            orderBind: true,
            ...(config.modules || {})
          }
        },
        ruleDocId: result.ruleDocId || '',
        ruleDefault: result.default !== false,
        ruleText: result.ruleText || RULE_TEXT_FALLBACK,
        modeIndex
      });
    } catch (e) {
      wx.showToast({ title: formatCloudFnError(e, '规则加载失败'), icon: 'none' });
    }
  },

  onModeChange(e) {
    const index = parseInt(e.detail.value, 10) || 0;
    this.setData({ modeIndex: index, 'ruleForm.mode': MODE_OPTIONS[index].value });
  },

  onRuleInput(e) {
    const key = e.currentTarget.dataset.key;
    if (!key) return;
    this.setData({ [`ruleForm.${key}`]: e.detail.value });
  },

  toggleModule(e) {
    const key = String((e.currentTarget.dataset && e.currentTarget.dataset.key) || '').trim();
    if (!key) return;
    const modules = { ...(this.data.ruleForm.modules || {}) };
    modules[key] = modules[key] === false;
    this.setData({ 'ruleForm.modules': modules });
  },

  async saveRule() {
    if (!this.data.canManageRules) {
      wx.showToast({ title: '仅超管可配置积分规则', icon: 'none' });
      return;
    }
    if (this.data.ruleSaving) return;
    this.setData({ ruleSaving: true });
    wx.showLoading({ title: '保存中…' });
    try {
      const config = { ...(this.data.ruleForm || {}) };
      if (!this.data.ruleDocId && this.data.storeId) {
        const existingIds = Array.isArray(config.storeIds) ? config.storeIds.filter(Boolean) : [];
        if (!existingIds.length) config.storeIds = [this.data.storeId];
      }
      const res = await wx.cloud.callFunction({
        name: 'getStorePointRules',
        data: { action: 'save', ruleDocId: this.data.ruleDocId, config }
      });
      wx.hideLoading();
      this.setData({ ruleSaving: false });
      const result = (res && res.result) || {};
      if (!result.success) {
        wx.showModal({ title: '保存失败', content: formatCloudFnError(result, result.msg || '请稍后重试'), showCancel: false, confirmColor: '#C4A76C' });
        return;
      }
      wx.showToast({
        title: result.pendingApproval ? (result.msg || '已提交超管审核') : '规则已保存',
        icon: result.pendingApproval ? 'none' : 'success'
      });
      if (!result.pendingApproval) {
        this.setData({ ruleDocId: result.ruleDocId || this.data.ruleDocId, ruleText: result.ruleText || this.data.ruleText });
        this.loadRule();
      }
    } catch (e) {
      wx.hideLoading();
      this.setData({ ruleSaving: false });
      wx.showToast({ title: formatCloudFnError(e, '保存失败'), icon: 'none' });
    }
  }
});
