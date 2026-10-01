/**
 * 门店后台权限配置（仅超管）
 * manageStaff list / lookupByPhone / upsert / remove
 */
const { guardStaffPage, clearStaffRoleCache } = require('../utils/staffAuth');
const { formatCloudFnError } = require('../utils/memberScan');
const { fetchStoreCatalog, mapStoreOptions } = require('../../../utils/storeCatalog');
const {
  buildWorkbenchFeatureUI,
  permissionsFromFeatureGroups,
  featureKeysForRoles
} = require('../utils/workspaceFeatures');

Page({
  data: {
    ready: false,
    loading: false,
    listError: false,
    tipTone: 'info',
    tipText: '',
    formTip: '',
    disablePendingId: '',
    enablePendingId: '',
    storeOptions: [],

    staffList: [],
    showStaffModal: false,
    staffForm: {
      openid: '',
      openidTail: '',
      phone: '',
      name: '',
      staffNo: '',
      role: 'staff',
      roles: ['staff'],
      storeIds: [],
      dailyGrantCap: '',
      shareholderStoreId: '',
      ownershipRatio: '',
      dividendRatio: '',
      dividendRatioBeforePayback: '',
      dividendRatioAfterPayback: '',
      capitalContribution: '',
      effectiveDate: ''
    },
    staffStoreChecks: [],
    shareholderStoreChecks: [],
    staffLookingUp: false,
    staffMatchHint: '',
    staffMatched: null,
    staffCandidates: [],
    staffMemberNoInput: '',
    staffRoleLabels: ['店员', '店长', '标本师', '直播主播', '投资人', '股东', '采购商', '加盟商', '渠道商', '供货方', '超管'],
    staffRoleValues: ['staff', 'manager', 'specimen_artisan', 'live_host', 'investor', 'shareholder', 'buyer', 'franchisee', 'channel', 'supplier', 'super_admin'],
    staffRoleSelected: { staff: true, manager: false, specimen_artisan: false, live_host: false, investor: false, shareholder: false, buyer: false, franchisee: false, channel: false, supplier: false, super_admin: false },
    staffSaving: false,
    featureGroups: [],
    showStoreScope: true,
    showShareholderConfig: false
  },

  /** 门店范围与积分上限仅对店员/店长（不含单独超管、标本师、主播） */
  rolesNeedStoreScope(roles) {
    const list = Array.isArray(roles) ? roles : [];
    return list.indexOf('staff') !== -1 || list.indexOf('manager') !== -1;
  },

  rolesNeedShareholderConfig(roles) {
    const list = Array.isArray(roles) ? roles : [];
    return list.indexOf('shareholder') !== -1;
  },

  async onLoad() {
    const role = await guardStaffPage('super_admin');
    if (!role) return;

    const catalog = await fetchStoreCatalog();
    const options = mapStoreOptions(catalog);
    this.setData({ ready: true, storeOptions: options });
    this.loadStaff();
  },

  onPullDownRefresh() {
    this.loadStaff().finally(() => wx.stopPullDownRefresh());
  },

  async loadStaff() {
    this.setData({
      loading: true,
      listError: false,
      tipText: this.data.staffList && this.data.staffList.length ? this.data.tipText : '',
      disablePendingId: '',
      enablePendingId: ''
    });
    try {
      const res = await wx.cloud.callFunction({ name: 'manageStaff', data: { action: 'list' } });
      const result = (res && res.result) || {};
      if (!result.success) {
        this.setData({
          loading: false,
          listError: true,
          tipTone: 'warn',
          tipText: formatCloudFnError(result, result.msg || '店员列表加载失败')
        });
        return;
      }
      const staffList = (result.list || []).map((row) => ({
        ...row,
        showStoreScope: this.rolesNeedStoreScope(
          Array.isArray(row.roles) && row.roles.length ? row.roles : [row.role]
        )
      }));
      this.setData({ staffList, loading: false, listError: false });
    } catch (e) {
      this.setData({
        loading: false,
        listError: true,
        tipTone: 'warn',
        tipText: formatCloudFnError(e, '店员列表加载失败')
      });
    }
  },

  onRetryList() {
    this.loadStaff();
  },

  buildStaffRoleSelected(values, selectedRoles) {
    const map = {};
    (values || []).forEach((v) => { map[v] = false; });
    (selectedRoles || []).forEach((r) => { map[r] = true; });
    return map;
  },

  buildStaffStoreChecks(selectedIds) {
    const ids = Array.isArray(selectedIds)
      ? selectedIds.map((id) => String(id || '').trim()).filter(Boolean)
      : [];
    const all = ids.length === 0;
    const options = this.data.storeOptions || [];
    return [
      { key: '__all__', storeId: '', name: '全部门店', isAll: true, selected: all },
      ...options.map((s) => ({
        key: s.storeId,
        storeId: s.storeId,
        name: s.name,
        isAll: false,
        selected: !all && ids.indexOf(s.storeId) !== -1
      }))
    ];
  },

  buildShareholderStoreChecks(selectedId) {
    const sid = String(selectedId || '').trim();
    const options = this.data.storeOptions || [];
    const preferred = options.filter((s) =>
      s.storeId === 'store_shanhaizaowu' || s.storeId === 'store_xingchen' || /山川|星宸/.test(s.name || '')
    );
    const list = preferred.length ? preferred : options;
    return list.map((s) => ({
      key: s.storeId,
      storeId: s.storeId,
      name: s.name,
      selected: sid === s.storeId
    }));
  },

  rebuildFeatureGroups(roles, permissions) {
    const roleList = Array.isArray(roles) ? roles.filter(Boolean) : [];
    const selected = Array.isArray(permissions) && permissions.length
      ? permissions
      : featureKeysForRoles(roleList);
    return buildWorkbenchFeatureUI(roleList, selected);
  },

  openStaffModal(e) {
    const id = String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) || '').trim();
    const item = id
      ? (this.data.staffList || []).find((row) => row._id === id) || null
      : null;
    const role = (item && item.role) || 'staff';
    const roles = item && Array.isArray(item.roles) && item.roles.length ? item.roles.slice() : [role];
    const storeIds = item && Array.isArray(item.storeIds) ? item.storeIds.slice() : [];
    const openid = (item && item.openid) || '';
    const sp = (item && item.shareholderProfile) || {};
    const shareholderStoreId = sp.storeId || '';
    const before =
      sp.dividendRatioBeforePayback != null && sp.dividendRatioBeforePayback !== ''
        ? sp.dividendRatioBeforePayback
        : sp.dividendRatio;
    const after =
      sp.dividendRatioAfterPayback != null && sp.dividendRatioAfterPayback !== ''
        ? sp.dividendRatioAfterPayback
        : before;
    this.setData({
      showStaffModal: true,
      formTip: '',
      staffRoleSelected: this.buildStaffRoleSelected(this.data.staffRoleValues, roles),
      staffLookingUp: false,
      staffMatchHint: '',
      staffMemberNoInput: '',
      staffMatched: item
        ? {
            openid,
            openidTail: String(openid).slice(-8),
            nickName: item.name || '已登记店员',
            phoneMasked: ''
          }
        : null,
      staffCandidates: [],
      staffForm: item
        ? {
            openid,
            openidTail: String(openid).slice(-8),
            phone: '',
            name: item.name || '',
            staffNo: item.staffNo || '',
            role,
            roles,
            storeIds,
            dailyGrantCap: item.dailyGrantCap ? String(item.dailyGrantCap) : '',
            shareholderStoreId,
            ownershipRatio: sp.ownershipRatio != null ? String(sp.ownershipRatio) : '',
            dividendRatio: before != null ? String(before) : '',
            dividendRatioBeforePayback: before != null ? String(before) : '',
            dividendRatioAfterPayback: after != null ? String(after) : '',
            capitalContribution: sp.capitalContribution != null ? String(sp.capitalContribution) : '',
            effectiveDate: sp.effectiveDate || ''
          }
        : {
            openid: '',
            openidTail: '',
            phone: '',
            name: '',
            staffNo: '',
            role: 'staff',
            roles: ['staff'],
            storeIds: [],
            dailyGrantCap: '',
            shareholderStoreId: '',
            ownershipRatio: '',
            dividendRatio: '',
            dividendRatioBeforePayback: '',
            dividendRatioAfterPayback: '',
            capitalContribution: '',
            effectiveDate: ''
          },
      staffStoreChecks: this.buildStaffStoreChecks(storeIds),
      shareholderStoreChecks: this.buildShareholderStoreChecks(shareholderStoreId),
      featureGroups: this.rebuildFeatureGroups(roles, item && item.permissions),
      showStoreScope: this.rolesNeedStoreScope(roles),
      showShareholderConfig: this.rolesNeedShareholderConfig(roles)
    });
  },

  closeStaffModal() {
    this.setData({ showStaffModal: false });
  },

  onStaffInput(e) {
    const field = e.currentTarget.dataset.field;
    if (!field || field === 'storeIds') return;
    const value = e.detail.value;
    if (field === 'openid') {
      this.setData({
        'staffForm.openid': value,
        'staffForm.openidTail': String(value || '').slice(-8)
      });
      return;
    }
    this.setData({ [`staffForm.${field}`]: value });
  },

  applyStaffCandidate(candidate) {
    if (!candidate || !candidate.openid) return;
    const patch = {
      staffMatched: candidate,
      staffMatchHint: `已匹配 ${candidate.nickName || '藏家'}（${candidate.phoneMasked || candidate.memberNo || ''}）`,
      'staffForm.openid': candidate.openid,
      'staffForm.openidTail': candidate.openidTail || String(candidate.openid).slice(-8)
    };
    if (!this.data.staffForm.name && (candidate.name || candidate.nickName)) {
      patch['staffForm.name'] = candidate.name || candidate.nickName;
    }
    this.setData(patch);
  },

  selectStaffCandidate(e) {
    const openid = String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.openid) || '').trim();
    const item = openid
      ? (this.data.staffCandidates || []).find((c) => c.openid === openid) || null
      : null;
    this.applyStaffCandidate(item);
  },

  onStaffMemberNoInput(e) {
    this.setData({ staffMemberNoInput: String((e && e.detail && e.detail.value) || '') });
  },

  async lookupStaffByPhone() {
    if (this.data.staffLookingUp) return;
    const phone = String(this.data.staffForm.phone || '').replace(/\D/g, '');
    if (!/^1\d{10}$/.test(phone)) {
      this.setData({ formTip: '请输入 11 位手机号' });
      return;
    }
    await this.runStaffLookup({ action: 'lookupByPhone', phone }, '未找到该手机号用户，请让对方先登录小程序并授权手机号');
  },

  /** 会员号查人：manageStaff 的 lookupByPhone 只新增可选 memberNo，不带手机号时生效 */
  async lookupStaffByMemberNo() {
    if (this.data.staffLookingUp) return;
    const memberNo = String(this.data.staffMemberNoInput || '').replace(/\s+/g, '').toUpperCase();
    if (memberNo.length < 9) {
      this.setData({ formTip: '请输入会员号，如 MT-AB12-CD34' });
      return;
    }
    await this.runStaffLookup({ action: 'lookupByPhone', memberNo }, '未找到该会员号，请核对顾客会员卡上的编号');
  },

  async runStaffLookup(data, notFoundMsg) {
    this.setData({
      staffLookingUp: true,
      staffMatchHint: '',
      staffMatched: null,
      staffCandidates: [],
      formTip: ''
    });
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageStaff',
        data
      });
      const result = (res && res.result) || {};
      this.setData({ staffLookingUp: false });
      if (!result.success) {
        this.setData({ formTip: formatCloudFnError(result, result.msg || '查找失败') });
        return;
      }
      const candidates = result.candidates || [];
      if (!candidates.length) {
        this.setData({
          staffCandidates: [],
          staffMatched: null,
          staffMatchHint: result.msg || notFoundMsg,
          'staffForm.openid': '',
          'staffForm.openidTail': ''
        });
        return;
      }
      if (candidates.length === 1) {
        this.setData({ staffCandidates: [] });
        this.applyStaffCandidate(candidates[0]);
        return;
      }
      this.setData({
        staffCandidates: candidates,
        staffMatched: null,
        staffMatchHint: `找到 ${candidates.length} 个账号，请选择`
      });
    } catch (e) {
      this.setData({
        staffLookingUp: false,
        formTip: formatCloudFnError(e, '查找失败')
      });
    }
  },

  toggleStaffStore(e) {
    const isAll = !!(e.currentTarget.dataset.all);
    const id = String(e.currentTarget.dataset.id || '');
    let nextIds = [];
    if (isAll) {
      nextIds = [];
    } else {
      const cur = Array.isArray(this.data.staffForm.storeIds) ? this.data.staffForm.storeIds.slice() : [];
      const idx = cur.indexOf(id);
      if (idx >= 0) cur.splice(idx, 1);
      else if (id) cur.push(id);
      nextIds = cur;
    }
    this.setData({
      'staffForm.storeIds': nextIds,
      staffStoreChecks: this.buildStaffStoreChecks(nextIds)
    });
  },

  onStaffRoleTap(e) {
    const index = parseInt(e.currentTarget.dataset.idx, 10);
    const value = this.data.staffRoleValues[index];
    if (Number.isNaN(index) || !value) return;
    const selected = { ...(this.data.staffRoleSelected || {}) };
    const wasOn = !!selected[value];
    selected[value] = !wasOn;
    const roles = this.data.staffRoleValues.filter((v) => selected[v]);
    // 新勾选角色：并入该角色默认能力，避免「店长+标本师」只剩店长勾选项而漏掉档案/薪酬
    let picked = permissionsFromFeatureGroups(this.data.featureGroups);
    if (!wasOn && selected[value]) {
      const defaults = featureKeysForRoles([value]);
      const set = {};
      picked.forEach((k) => { set[k] = true; });
      defaults.forEach((k) => { set[k] = true; });
      picked = Object.keys(set);
    }
    this.setData({
      staffRoleSelected: selected,
      'staffForm.roles': roles,
      'staffForm.role': roles[0] || 'staff',
      featureGroups: this.rebuildFeatureGroups(roles, picked),
      showStoreScope: this.rolesNeedStoreScope(roles),
      showShareholderConfig: this.rolesNeedShareholderConfig(roles),
      shareholderStoreChecks: this.buildShareholderStoreChecks(this.data.staffForm.shareholderStoreId)
    });
  },

  toggleShareholderStore(e) {
    const storeId = String((e.currentTarget.dataset || {}).id || '').trim();
    if (!storeId) return;
    this.setData({
      'staffForm.shareholderStoreId': storeId,
      shareholderStoreChecks: this.buildShareholderStoreChecks(storeId)
    });
  },

  onShareholderDateChange(e) {
    this.setData({ 'staffForm.effectiveDate': (e.detail && e.detail.value) || '' });
  },

  toggleFeature(e) {
    const gIdx = parseInt(e.currentTarget.dataset.gidx, 10);
    const iIdx = parseInt(e.currentTarget.dataset.iidx, 10);
    const groups = (this.data.featureGroups || []).slice();
    const group = groups[gIdx];
    if (!group || group.readOnly) return;
    const items = (group.items || []).slice();
    const item = items[iIdx];
    if (!item || item.disabled) return;
    items[iIdx] = { ...item, checked: !item.checked };
    groups[gIdx] = { ...group, items };
    this.setData({ featureGroups: groups });
  },

  async saveStaff() {
    if (this.data.staffSaving) return;
    const form = this.data.staffForm;
    if (!form.openid || form.openid.trim().length < 20) {
      this.setData({ formTip: '请先用手机号查找并确认 openid' });
      return;
    }
    const roles = Array.isArray(form.roles) ? form.roles.filter(Boolean) : [];
    if (!roles.length) {
      this.setData({ formTip: '请至少选择一个角色' });
      return;
    }
    const showStoreScope = this.rolesNeedStoreScope(roles);
    const showShareholderConfig = this.rolesNeedShareholderConfig(roles);
    const storeIds = showStoreScope && Array.isArray(form.storeIds)
      ? form.storeIds.map((id) => String(id || '').trim()).filter(Boolean)
      : [];
    const dailyGrantCap = showStoreScope ? form.dailyGrantCap : 0;
    if (showShareholderConfig && !String(form.shareholderStoreId || '').trim()) {
      this.setData({ formTip: '请绑定股东门店' });
      return;
    }
    this.setData({ staffSaving: true, formTip: '保存中…' });
    try {
      const payload = {
        action: 'upsert',
        openid: form.openid.trim(),
        name: form.name,
        staffNo: form.staffNo,
        roles,
        role: roles[0],
        permissions: permissionsFromFeatureGroups(this.data.featureGroups),
        permissionsExplicit: true
      };
      if (showStoreScope) {
        payload.storeIds = storeIds;
        payload.dailyGrantCap = dailyGrantCap;
      } else {
        payload.storeIds = [];
        payload.dailyGrantCap = 0;
      }
      if (showShareholderConfig) {
        const before = String(form.dividendRatioBeforePayback || form.dividendRatio || '').trim();
        const afterRaw = String(form.dividendRatioAfterPayback || '').trim();
        const after = afterRaw !== '' ? afterRaw : before;
        payload.shareholderProfile = {
          storeId: String(form.shareholderStoreId || '').trim(),
          ownershipRatio: form.ownershipRatio,
          dividendRatio: before,
          dividendRatioBeforePayback: before,
          dividendRatioAfterPayback: after,
          capitalContribution: form.capitalContribution,
          effectiveDate: form.effectiveDate
        };
      } else {
        payload.shareholderProfile = null;
      }
      const res = await wx.cloud.callFunction({
        name: 'manageStaff',
        data: payload
      });
      this.setData({ staffSaving: false });
      const result = (res && res.result) || {};
      if (!result.success) {
        this.setData({ formTip: formatCloudFnError(result, result.msg || '请稍后重试') });
        return;
      }
      clearStaffRoleCache();
      this.closeStaffModal();
      this.setData({ tipTone: 'info', tipText: result.msg || '已保存' });
      this.loadStaff();
    } catch (e) {
      this.setData({
        staffSaving: false,
        formTip: formatCloudFnError(e, '保存失败')
      });
    }
  },

  async disableStaff(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    if (this.data.disablePendingId !== id) {
      this.setData({
        disablePendingId: id,
        enablePendingId: '',
        tipTone: 'warn',
        tipText: '再点一次「停用」：该账号将无法进入门店后台（可再次启用）'
      });
      return;
    }
    this.setData({ disablePendingId: '', tipTone: 'info', tipText: '正在停用…' });
    try {
      const call = await wx.cloud.callFunction({ name: 'manageStaff', data: { action: 'remove', staffId: id } });
      const result = (call && call.result) || {};
      if (!result.success) {
        this.setData({
          tipTone: 'warn',
          tipText: formatCloudFnError(result, result.msg || '停用失败')
        });
        return;
      }
      clearStaffRoleCache();
      this.setData({ tipTone: 'info', tipText: result.msg || '已停用' });
      this.loadStaff();
    } catch (err) {
      this.setData({ tipTone: 'warn', tipText: formatCloudFnError(err, '停用失败') });
    }
  },

  async enableStaff(e) {
    const id = String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) || '').trim();
    if (!id) return;
    const item = (this.data.staffList || []).find((row) => row._id === id);
    if (!item || !item.openid) {
      this.setData({ tipTone: 'warn', tipText: '账号信息缺失' });
      return;
    }
    if (this.data.enablePendingId !== id) {
      this.setData({
        enablePendingId: id,
        disablePendingId: '',
        tipTone: 'warn',
        tipText: `再点一次「启用」即将恢复「${item.name || '未命名'} · ${item.roleText || ''}」`
      });
      return;
    }
    this.setData({ enablePendingId: '', tipTone: 'info', tipText: '正在启用…' });
    try {
      const roles = Array.isArray(item.roles) && item.roles.length
        ? item.roles
        : [item.role || 'staff'];
      const showStoreScope = this.rolesNeedStoreScope(roles);
      const enablePayload = {
        action: 'upsert',
        openid: item.openid,
        name: item.name || '',
        staffNo: item.staffNo || '',
        roles,
        role: item.role || 'staff',
        permissions: Array.isArray(item.permissions) ? item.permissions : undefined,
        permissionsExplicit: !!item.permissionsExplicit,
        status: 'active'
      };
      if (showStoreScope) {
        enablePayload.storeIds = Array.isArray(item.storeIds) ? item.storeIds : [];
        enablePayload.dailyGrantCap = item.dailyGrantCap || 0;
      } else {
        enablePayload.storeIds = [];
        enablePayload.dailyGrantCap = 0;
      }
      const call = await wx.cloud.callFunction({
        name: 'manageStaff',
        data: enablePayload
      });
      const result = (call && call.result) || {};
      if (!result.success) {
        this.setData({
          tipTone: 'warn',
          tipText: formatCloudFnError(result, result.msg || '启用失败')
        });
        return;
      }
      clearStaffRoleCache();
      this.setData({ tipTone: 'info', tipText: result.msg || '已恢复生效' });
      this.loadStaff();
    } catch (err) {
      this.setData({ tipTone: 'warn', tipText: formatCloudFnError(err, '启用失败') });
    }
  },

  copyOpenidHint() {
    this.setData({
      tipTone: 'info',
      tipText: 'openid：让对方先登录小程序并授权手机号，再用上方「手机号查找」匹配；或在云开发 users 按昵称复制 _openid。'
    });
  },

  noop() {}
});
