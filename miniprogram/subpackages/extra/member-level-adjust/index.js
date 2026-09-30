/**
 * 会员等级调整（仅超管）
 * 与 Admin MemberLevelAdjust / manageMemberLevelAdjust 同源：
 * listLevels | search | adjust | clearOverride | recentOps
 *
 * 定级：levelOverride floor（成长下限，保留自动升级）/ exact（强制锁定）
 * 不授予 Lv99；调离荣誉馆长与现网互斥规则一致
 */
const { guardStaffPage } = require('../utils/staffAuth');
const { formatCloudFnError } = require('../utils/memberScan');

const FN = 'manageMemberLevelAdjust';

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

function mapMember(row) {
  const avatar = String((row && row.avatarUrl) || '').trim();
  let overrideLabel = '';
  let overrideClass = '';
  if (row.isHonorary) {
    overrideLabel = '荣誉馆长';
    overrideClass = 'honor';
  } else if (row.overrideMode === 'exact') {
    overrideLabel = '锁定';
    overrideClass = 'exact';
  } else if (row.overrideMode === 'floor') {
    overrideLabel = '下限';
    overrideClass = 'floor';
  }
  return {
    ...row,
    hasAvatar: !!avatar,
    avatarInitial: String((row && row.nickName) || '藏').slice(0, 1),
    overrideLabel,
    overrideClass,
    hasOverride: !!(row.levelOverride && row.levelOverride.level),
    levelLine: `${row.levelName || ''} · ${row.discountLabel || ''}`,
    naturalLine: `自然 Lv${row.naturalLevel || 1} ${row.naturalLevelName || ''} · 成长 ${row.growthValue || 0}`
  };
}

function mapOps(row) {
  return {
    ...row,
    timeText: formatTime(row.createTime),
    actionClass: row.action === 'adjust' ? 'add' : 'remove',
    changeText: `${row.fromLevelName || `Lv${row.fromLevel || ''}`} → ${row.toLevelName || `Lv${row.toLevel || ''}`}${
      row.mode ? `（${row.mode}）` : ''
    }`
  };
}

function mapLevelOption(row, index) {
  return {
    ...row,
    pickerLabel: `Lv${row.level} ${row.name} · 门槛 ${row.threshold} · ${row.discountLabel}`,
    index
  };
}

Page({
  data: {
    ready: false,
    levelsLoading: false,
    paidLevels: [],
    levelPickerLabels: [],
    levelsSource: '',
    ruleHint: '',
    honoraryName: '',

    keyword: '',
    searching: false,
    searched: false,
    searchMsg: '',
    members: [],

    opsList: [],
    opsLoading: false,
    submitting: false,

    showAdjustModal: false,
    showClearModal: false,
    adjustTarget: null,
    clearTarget: null,
    adjustForm: {
      levelIndex: 0,
      targetLevel: 0,
      mode: 'floor',
      modeFloor: true,
      modeExact: false,
      note: '',
      password: ''
    },
    clearPassword: ''
  },

  async onLoad() {
    const role = await guardStaffPage('super_admin');
    if (!role) return;
    this.setData({ ready: true });
    await Promise.all([this.loadLevels(), this.loadOps()]);
  },

  onPullDownRefresh() {
    const tasks = [this.loadLevels(), this.loadOps()];
    if (this.data.searched && String(this.data.keyword || '').trim()) {
      tasks.push(this.doSearch());
    }
    Promise.all(tasks).finally(() => wx.stopPullDownRefresh());
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

  async loadLevels() {
    this.setData({ levelsLoading: true });
    try {
      const res = await this.callFn({ action: 'listLevels' });
      const paid = (res.paidLevels || (res.levels || []).filter((l) => l.level !== 99)).map(mapLevelOption);
      this.setData({
        paidLevels: paid,
        levelPickerLabels: paid.map((l) => l.pickerLabel),
        levelsSource: res.source || '',
        ruleHint: res.ruleHint || '',
        honoraryName: (res.honorary && res.honorary.name) || '荣誉馆长'
      });
    } catch (e) {
      wx.showToast({ title: formatCloudFnError(e) || '等级加载失败', icon: 'none' });
    } finally {
      this.setData({ levelsLoading: false });
    }
  },

  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value || '' });
  },

  clearKeyword() {
    this.setData({
      keyword: '',
      searched: false,
      searchMsg: '',
      members: []
    });
  },

  async doSearch() {
    const keyword = String(this.data.keyword || '').trim();
    if (!keyword) {
      wx.showToast({ title: '请输入手机号 / openid / 昵称', icon: 'none' });
      return;
    }
    this.setData({ searching: true, searched: true });
    try {
      const res = await this.callFn({ action: 'search', keyword });
      this.setData({
        members: (res.list || []).map(mapMember),
        searchMsg: res.msg || ''
      });
    } catch (e) {
      this.setData({ members: [], searchMsg: formatCloudFnError(e) || '搜索失败' });
      wx.showToast({ title: formatCloudFnError(e) || '搜索失败', icon: 'none' });
    } finally {
      this.setData({ searching: false });
    }
  },

  async loadOps() {
    this.setData({ opsLoading: true });
    try {
      const res = await this.callFn({ action: 'recentOps', limit: 30 });
      this.setData({ opsList: (res.list || []).map(mapOps) });
    } catch (e) {
      this.setData({ opsList: [] });
    } finally {
      this.setData({ opsLoading: false });
    }
  },

  openAdjust(e) {
    const idx = Number(e.currentTarget.dataset.index);
    const row = this.data.members[idx];
    if (!row) return;
    const paid = this.data.paidLevels || [];
    if (!paid.length) {
      wx.showToast({ title: '等级列表未加载', icon: 'none' });
      return;
    }
    let levelIndex = paid.findIndex((l) => l.level === row.level && !row.isHonorary);
    if (levelIndex < 0) levelIndex = 0;
    this.setData({
      showAdjustModal: true,
      showClearModal: false,
      adjustTarget: row,
      adjustForm: {
        levelIndex,
        targetLevel: paid[levelIndex].level,
        mode: 'floor',
        modeFloor: true,
        modeExact: false,
        note: '',
        password: ''
      }
    });
  },

  openClear(e) {
    const idx = Number(e.currentTarget.dataset.index);
    const row = this.data.members[idx];
    if (!row || !row.hasOverride) return;
    this.setData({
      showClearModal: true,
      showAdjustModal: false,
      clearTarget: row,
      clearPassword: ''
    });
  },

  closeModals() {
    this.setData({
      showAdjustModal: false,
      showClearModal: false,
      adjustTarget: null,
      clearTarget: null,
      clearPassword: '',
      adjustForm: {
        levelIndex: 0,
        targetLevel: 0,
        mode: 'floor',
        modeFloor: true,
        modeExact: false,
        note: '',
        password: ''
      }
    });
  },

  noop() {},

  onLevelPick(e) {
    const levelIndex = Number(e.detail.value) || 0;
    const paid = this.data.paidLevels || [];
    const row = paid[levelIndex] || paid[0];
    this.setData({
      'adjustForm.levelIndex': levelIndex,
      'adjustForm.targetLevel': row ? row.level : 0
    });
  },

  onLevelCardTap(e) {
    const level = Number(e.currentTarget.dataset.level);
    const levelIndex = Number(e.currentTarget.dataset.index);
    if (!Number.isFinite(level) || level < 1) return;
    this.setData({
      'adjustForm.levelIndex': Number.isFinite(levelIndex) ? levelIndex : 0,
      'adjustForm.targetLevel': level
    });
  },

  setModeFloor() {
    this.setData({
      'adjustForm.mode': 'floor',
      'adjustForm.modeFloor': true,
      'adjustForm.modeExact': false
    });
  },

  setModeExact() {
    this.setData({
      'adjustForm.mode': 'exact',
      'adjustForm.modeFloor': false,
      'adjustForm.modeExact': true
    });
  },

  onAdjustNoteInput(e) {
    this.setData({ 'adjustForm.note': e.detail.value || '' });
  },

  onAdjustPasswordInput(e) {
    this.setData({ 'adjustForm.password': e.detail.value || '' });
  },

  onClearPasswordInput(e) {
    this.setData({ clearPassword: e.detail.value || '' });
  },

  async confirmAdjust() {
    const target = this.data.adjustTarget;
    const form = this.data.adjustForm || {};
    if (!target) return;
    if (!form.targetLevel) {
      wx.showToast({ title: '请选择目标等级', icon: 'none' });
      return;
    }
    if (!String(form.password || '').trim()) {
      wx.showToast({ title: '请输入授权密码', icon: 'none' });
      return;
    }
    if (this.data.submitting) return;
    this.setData({ submitting: true });
    try {
      const res = await this.callFn({
        action: 'adjust',
        userId: target._id,
        openid: target.openid,
        targetLevel: form.targetLevel,
        mode: form.mode || 'floor',
        note: form.note || '',
        confirmPassword: form.password
      });
      if (res.warning) {
        wx.showToast({ title: res.warning.slice(0, 40), icon: 'none', duration: 2800 });
      } else {
        wx.showToast({ title: res.msg || '已调整', icon: 'success' });
      }
      this.closeModals();
      await Promise.all([this.doSearch(), this.loadOps()]);
    } catch (e) {
      wx.showToast({ title: formatCloudFnError(e) || '调整失败', icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  },

  async confirmClear() {
    const target = this.data.clearTarget;
    if (!target) return;
    if (!String(this.data.clearPassword || '').trim()) {
      wx.showToast({ title: '请输入授权密码', icon: 'none' });
      return;
    }
    if (this.data.submitting) return;
    this.setData({ submitting: true });
    try {
      const res = await this.callFn({
        action: 'clearOverride',
        userId: target._id,
        openid: target.openid,
        confirmPassword: this.data.clearPassword
      });
      wx.showToast({ title: res.msg || '已清除', icon: 'success' });
      this.closeModals();
      await Promise.all([this.doSearch(), this.loadOps()]);
    } catch (e) {
      wx.showToast({ title: formatCloudFnError(e) || '清除失败', icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  }
});
