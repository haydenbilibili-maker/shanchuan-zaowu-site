/**
 * 荣誉馆长名单维护（仅超管）
 * 与 Admin / manageHonoraryCurators 同源：
 * list | lookupByPhone | add | remove | recentOps
 *
 * 双模式：
 * - find：找会员授予（查 users）
 * - roster：筛选馆长名单（查 honorary_curators）
 */
const { guardStaffPage } = require('../utils/staffAuth');
const { formatCloudFnError } = require('../utils/memberScan');

const FN = 'manageHonoraryCurators';
const STATUS_OPTIONS = ['生效中', '已移出', '全部'];
const STATUS_VALUES = ['active', 'removed', 'all'];
const PAGE_SIZE = 20;
const MODE_FIND = 'find';
const MODE_ROSTER = 'roster';

const OVERVIEW_TABS = [
  { key: 'active', label: '生效' },
  { key: 'roster', label: '名单' },
  { key: 'recent', label: '近况' }
];

function formatTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

function mapRow(row) {
  const nickNames = Array.isArray(row.nickNames) ? row.nickNames : [];
  return {
    ...row,
    timeText: formatTime(row.createTime),
    removedText: formatTime(row.removedAt),
    nickPreview: nickNames.slice(0, 2).join('、'),
    statusClass: row.status === 'active' ? 'active' : 'removed'
  };
}

function mapOps(row) {
  return {
    ...row,
    timeText: formatTime(row.createTime),
    actionClass: row.action === 'add' ? 'add' : 'remove'
  };
}

function mapCandidate(row) {
  const avatar = String((row && row.avatarUrl) || '').trim();
  const initial = String((row && row.nickName) || '藏').slice(0, 1);
  return {
    ...row,
    hasAvatar: !!avatar,
    avatarUrl: avatar,
    avatarInitial: initial,
    statusClass: row.onRoster ? 'on' : row.canGrant ? 'ok' : 'muted'
  };
}

function mapBar(row) {
  return {
    ...row,
    barStyle: `width: ${Math.min(100, Number(row.pct) || 0)}%;`
  };
}

function mapOverview(result) {
  const active = result.active || {};
  const roster = result.roster || {};
  const recent = result.recent || {};
  return {
    definitions: result.definitions || {},
    dataCapped: !!result.dataCapped,
    totalLoaded: result.totalLoaded || 0,
    fetchCap: result.fetchCap || 500,
    active: {
      count: active.count || 0,
      bound: active.bound || 0,
      unbound: active.unbound || 0,
      bindBars: (active.bindBars || []).map(mapBar)
    },
    roster: {
      active: roster.active || 0,
      removed: roster.removed || 0,
      total: roster.total || 0,
      bars: (roster.bars || []).map(mapBar)
    },
    recent: {
      days: recent.days || 30,
      grants: recent.grants || 0,
      removals: recent.removals || 0,
      bars: (recent.bars || []).map(mapBar)
    }
  };
}

function overviewHintFor(overview, tab) {
  if (!overview) return '';
  let hint = '';
  if (tab === 'active') hint = (overview.definitions && overview.definitions.active) || '';
  else if (tab === 'roster') hint = (overview.definitions && overview.definitions.roster) || '';
  else hint = (overview.definitions && overview.definitions.recent) || '';
  if (overview.dataCapped) hint = `${hint} · 采样达上限 ${overview.fetchCap}`;
  return hint;
}

Page({
  data: {
    ready: false,
    mode: MODE_FIND,
    modeFind: true,
    modeRoster: false,

    // find mode
    findPhone: '',
    findLoading: false,
    findSearched: false,
    findMsg: '',
    findExact: false,
    findCanGrantWithoutUser: false,
    findPhoneMasked: '',
    findOnRoster: false,
    candidates: [],

    // roster mode
    list: [],
    listError: false,
    tipTone: 'info',
    tipText: '',
    loading: false,
    page: 1,
    hasMore: false,
    total: 0,
    statusOptions: STATUS_OPTIONS,
    statusValues: STATUS_VALUES,
    statusIndex: 0,
    filterStatus: 'active',
    rosterPhone: '',

    opsList: [],
    opsLoading: false,
    submitting: false,

    overviewTabs: OVERVIEW_TABS,
    overviewTab: 'active',
    overviewTabActive: true,
    overviewTabRoster: false,
    overviewTabRecent: false,
    overviewLoading: false,
    overviewReady: false,
    overview: null,
    overviewHint: '',

    showAddModal: false,
    showRemoveModal: false,
    addForm: { phone: '', note: '', password: '' },
    addHint: '',
    removeTarget: null,
    removePassword: ''
  },

  async onLoad() {
    const role = await guardStaffPage('super_admin');
    if (!role) return;
    this.setData({ ready: true });
    this.loadOps();
    this.loadList(true);
    this.ensureOverview();
  },

  onPullDownRefresh() {
    const tasks = [this.loadOps()];
    if (this.data.mode === MODE_FIND && String(this.data.findPhone || '').replace(/\D/g, '').length >= 3) {
      tasks.push(this.searchMembers());
    }
    if (this.data.mode === MODE_ROSTER) {
      tasks.push(this.loadList(true));
    }
    if (this.data.overviewReady || this.data.overviewLoading) {
      tasks.push(this.loadOverview(true));
    }
    Promise.all(tasks).finally(() => wx.stopPullDownRefresh());
  },

  switchOverviewTab(e) {
    const key = String((e.currentTarget.dataset && e.currentTarget.dataset.tab) || 'active');
    if (!OVERVIEW_TABS.some((t) => t.key === key)) return;
    if (this.data.overviewTab !== key) {
      this.setData({
        overviewTab: key,
        overviewTabActive: key === 'active',
        overviewTabRoster: key === 'roster',
        overviewTabRecent: key === 'recent',
        overviewHint: overviewHintFor(this.data.overview, key)
      });
    }
    this.ensureOverview();
  },

  ensureOverview() {
    if (this.data.overviewReady || this.data.overviewLoading) return;
    this.loadOverview(false);
  },

  onRefreshOverview() {
    this.loadOverview(true);
  },

  async loadOverview(force) {
    if (this.data.overviewLoading) return;
    if (this.data.overviewReady && !force) return;
    this.setData({ overviewLoading: true });
    try {
      const result = await this.callFn({ action: 'overview' });
      const overview = mapOverview(result);
      this.setData({
        overviewLoading: false,
        overviewReady: true,
        overview,
        overviewHint: overviewHintFor(overview, this.data.overviewTab)
      });
    } catch (e) {
      this.setData({
        overviewLoading: false,
        tipTone: 'warn',
        tipText: formatCloudFnError(e, e.msg || '概览加载失败')
      });
    }
  },

  switchMode(e) {
    const mode = String((e.currentTarget.dataset && e.currentTarget.dataset.mode) || MODE_FIND);
    if (mode !== MODE_FIND && mode !== MODE_ROSTER) return;
    this.setData({
      mode,
      modeFind: mode === MODE_FIND,
      modeRoster: mode === MODE_ROSTER
    });
    if (mode === MODE_ROSTER && !this.data.list.length && !this.data.loading) {
      this.loadList(true);
    }
  },

  async callFn(data) {
    const res = await wx.cloud.callFunction({ name: FN, data: data || {} });
    const result = (res && res.result) || {};
    if (!result.success) {
      const err = new Error(result.msg || '操作失败');
      err.code = result.code;
      err.msg = result.msg;
      throw err;
    }
    return result;
  },

  // —— 找会员授予 ——
  onFindPhoneInput(e) {
    this.setData({ findPhone: String((e.detail && e.detail.value) || '') });
  },

  clearFind() {
    this.setData({
      findPhone: '',
      findSearched: false,
      findMsg: '',
      findExact: false,
      findCanGrantWithoutUser: false,
      findPhoneMasked: '',
      findOnRoster: false,
      candidates: []
    });
  },

  async searchMembers() {
    if (this.data.findLoading) return;
    const phone = String(this.data.findPhone || '').replace(/\D/g, '');
    if (phone.length < 3) {
      this.setData({ tipTone: 'warn', tipText: '请输入至少 3 位手机号' });
      return;
    }
    this.setData({ findLoading: true, tipText: '' });
    try {
      const result = await this.callFn({ action: 'lookupByPhone', phone });
      this.setData({
        findLoading: false,
        findSearched: true,
        findMsg: result.msg || '',
        findExact: !!result.exact,
        findCanGrantWithoutUser: !!result.canGrantWithoutUser,
        findPhoneMasked: result.phoneMasked || '',
        findOnRoster: !!result.onRoster,
        candidates: (result.candidates || []).map(mapCandidate)
      });
    } catch (e) {
      this.setData({
        findLoading: false,
        findSearched: true,
        findMsg: e.msg || e.message || '查找失败',
        candidates: [],
        findCanGrantWithoutUser: false,
        tipTone: 'warn',
        tipText: formatCloudFnError(e, e.msg || '查找失败')
      });
    }
  },

  openGrantFromCandidate(e) {
    const phone = String((e.currentTarget.dataset && e.currentTarget.dataset.phone) || '').replace(/\D/g, '');
    const item = (this.data.candidates || []).find((c) => c.phone === phone);
    if (!item) return;
    if (item.onRoster || !item.canGrant) {
      this.setData({ tipTone: 'info', tipText: '该号码已是荣誉馆长' });
      return;
    }
    this.openAdd(phone, item.nickName ? `会员：${item.nickName}` : '');
  },

  openGrantWithoutUser() {
    const phone = String(this.data.findPhone || '').replace(/\D/g, '');
    if (!/^1\d{10}$/.test(phone)) {
      this.setData({ tipTone: 'warn', tipText: '请输入完整 11 位手机号' });
      return;
    }
    if (this.data.findOnRoster) {
      this.setData({ tipTone: 'info', tipText: '该号码已在名单中' });
      return;
    }
    this.openAdd(phone, '暂无绑定用户，对方授权手机号后自动生效');
  },

  // —— 筛选馆长名单 ——
  onStatusChange(e) {
    const index = parseInt(e.detail.value, 10) || 0;
    this.setData({
      statusIndex: index,
      filterStatus: STATUS_VALUES[index] || 'active'
    });
    this.loadList(true);
  },

  onRosterPhoneInput(e) {
    this.setData({ rosterPhone: String((e.detail && e.detail.value) || '') });
  },

  onRosterSearch() {
    this.loadList(true);
  },

  clearRosterSearch() {
    this.setData({ rosterPhone: '' });
    this.loadList(true);
  },

  async loadList(reset) {
    if (this.data.loading) return;
    const page = reset ? 1 : this.data.page + 1;
    this.setData({ loading: true, listError: false, tipText: reset ? '' : this.data.tipText });
    try {
      const result = await this.callFn({
        action: 'list',
        status: this.data.filterStatus,
        phone: String(this.data.rosterPhone || '').trim(),
        page,
        pageSize: PAGE_SIZE
      });
      const list = (result.list || []).map(mapRow);
      const total = result.total || 0;
      this.setData({
        loading: false,
        listError: false,
        page,
        total,
        hasMore: page * PAGE_SIZE < total,
        list: reset ? list : this.data.list.concat(list)
      });
    } catch (e) {
      // 失败不清空名单、不伪装「暂无匹配」
      this.setData({
        loading: false,
        listError: true,
        tipTone: 'warn',
        tipText: formatCloudFnError(e, e.msg || '名单加载失败')
      });
    }
  },

  loadMore() {
    if (this.data.hasMore && !this.data.loading) this.loadList(false);
  },

  onRetryList() {
    this.loadList(true);
  },

  async loadOps() {
    this.setData({ opsLoading: true });
    try {
      const result = await this.callFn({ action: 'recentOps', limit: 20 });
      this.setData({
        opsLoading: false,
        opsList: (result.list || []).map(mapOps)
      });
    } catch (e) {
      this.setData({ opsLoading: false, opsList: [] });
    }
  },

  openAdd(phone, hint) {
    const prefill = typeof phone === 'string' ? phone : '';
    this.setData({
      showAddModal: true,
      addForm: { phone: prefill, note: '', password: '' },
      addHint: hint || (prefill ? `将授予 ${prefill.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')}` : '')
    });
  },

  openManualAdd() {
    this.openAdd('', '请填写完整 11 位手机号');
  },

  openRemove(e) {
    const id = String((e.currentTarget.dataset && e.currentTarget.dataset.id) || '');
    const item = (this.data.list || []).find((row) => row._id === id);
    if (!item || item.status !== 'active') return;
    this.setData({
      showRemoveModal: true,
      removeTarget: item,
      removePassword: ''
    });
  },

  closeModals() {
    this.setData({
      showAddModal: false,
      showRemoveModal: false,
      removeTarget: null,
      submitting: false,
      addHint: ''
    });
  },

  onAddPhoneInput(e) {
    this.setData({ 'addForm.phone': e.detail.value });
  },

  onAddNoteInput(e) {
    this.setData({ 'addForm.note': e.detail.value });
  },

  onAddPasswordInput(e) {
    this.setData({ 'addForm.password': e.detail.value });
  },

  onRemovePasswordInput(e) {
    this.setData({ removePassword: e.detail.value });
  },

  async confirmAdd() {
    if (this.data.submitting) return;
    const phone = String(this.data.addForm.phone || '').replace(/\D/g, '');
    if (!/^1\d{10}$/.test(phone)) {
      this.setData({ addHint: '请输入有效的 11 位手机号' });
      return;
    }
    if (!String(this.data.addForm.password || '').trim()) {
      this.setData({ addHint: '请输入授权密码' });
      return;
    }
    this.setData({ submitting: true, addHint: '正在授予…' });
    try {
      const result = await this.callFn({
        action: 'add',
        phone,
        note: this.data.addForm.note,
        confirmPassword: this.data.addForm.password
      });
      this.closeModals();
      this.setData({
        findPhone: phone,
        mode: MODE_FIND,
        modeFind: true,
        modeRoster: false,
        tipTone: 'info',
        tipText: result.msg || '已授予'
      });
      await Promise.all([this.searchMembers(), this.loadList(true), this.loadOps()]);
      if (this.data.overviewReady) await this.loadOverview(true);
    } catch (e) {
      this.setData({
        submitting: false,
        addHint: formatCloudFnError(e, e.msg || '授予失败')
      });
    }
  },

  async confirmRemove() {
    if (this.data.submitting || !this.data.removeTarget) return;
    if (!String(this.data.removePassword || '').trim()) {
      this.setData({ tipTone: 'warn', tipText: '请输入授权密码' });
      return;
    }
    this.setData({ submitting: true });
    try {
      const result = await this.callFn({
        action: 'remove',
        id: this.data.removeTarget._id,
        phone: this.data.removeTarget.phone,
        confirmPassword: this.data.removePassword
      });
      this.closeModals();
      this.setData({ tipTone: 'info', tipText: result.msg || '已移出' });
      await Promise.all([this.loadList(true), this.loadOps()]);
      if (this.data.overviewReady) await this.loadOverview(true);
      if (this.data.findSearched) this.searchMembers();
    } catch (e) {
      this.setData({
        submitting: false,
        tipTone: 'warn',
        tipText: formatCloudFnError(e, e.msg || '移出失败')
      });
    }
  },

  noop() {}
});
