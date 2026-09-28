/**
 * 超管 · 门店股东配置
 * manageStaff list / lookupByPhone / upsert / remove
 * 双阶段分成：dividendRatioBeforePayback / dividendRatioAfterPayback
 * （旧字段 dividendRatio = 回本前，迁移兼容）
 */
const {
  guardStaffPage,
  clearStaffRoleCache,
  goShareholderObservatory
} = require('../utils/staffAuth')
const { formatCloudFnError } = require('../utils/memberScan')
const { fetchStoreCatalog, mapStoreOptions } = require('../../../utils/storeCatalog')

const FN = 'manageStaff'
const ROLE_SHAREHOLDER = 'shareholder'

function clampRatioInput(raw) {
  if (raw === '' || raw == null) return { ok: true, value: '' }
  const n = Number(raw)
  if (!Number.isFinite(n)) return { ok: false, msg: '比例须为数字' }
  if (n < 0 || n > 100) return { ok: false, msg: '比例须在 0–100' }
  return { ok: true, value: n }
}

function profileRatios(sp) {
  const p = sp || {}
  const before =
    p.dividendRatioBeforePayback != null && p.dividendRatioBeforePayback !== ''
      ? p.dividendRatioBeforePayback
      : p.dividendRatio
  const after =
    p.dividendRatioAfterPayback != null && p.dividendRatioAfterPayback !== ''
      ? p.dividendRatioAfterPayback
      : before
  return {
    before: before != null ? before : '',
    after: after != null ? after : ''
  }
}

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
    obsPending: false,
    storeOptions: [],
    list: [],
    filterStatus: 'all',
    filterLabels: ['全部', '生效', '停用'],
    filterValues: ['all', 'active', 'disabled'],
    filterIndex: 0,
    showForm: false,
    editingId: '',
    lookingUp: false,
    matchHint: '',
    matched: null,
    candidates: [],
    storeChecks: [],
    saving: false,
    form: {
      openid: '',
      openidTail: '',
      phone: '',
      name: '',
      staffNo: '',
      storeId: '',
      ownershipRatio: '',
      dividendRatioBeforePayback: '',
      dividendRatioAfterPayback: '',
      capitalContribution: '',
      effectiveDate: '',
      status: 'active',
      roles: [ROLE_SHAREHOLDER],
      permissions: null,
      permissionsExplicit: false
    }
  },

  async onLoad() {
    const role = await guardStaffPage('super_admin')
    if (!role) return
    const catalog = await fetchStoreCatalog()
    const options = mapStoreOptions(catalog)
    this.setData({ ready: true, storeOptions: options })
    await this.loadList()
  },

  onPullDownRefresh() {
    this.loadList().finally(() => wx.stopPullDownRefresh())
  },

  async callFn(data) {
    const res = await wx.cloud.callFunction({ name: FN, data: data || {} })
    const result = (res && res.result) || {}
    if (!result.success) {
      const err = new Error(result.msg || '操作失败')
      err.code = result.code
      err.result = result
      throw err
    }
    return result
  },

  isShareholderRow(row) {
    const roles = Array.isArray(row.roles) && row.roles.length ? row.roles : [row.role]
    return roles.indexOf(ROLE_SHAREHOLDER) !== -1 || !!(row.shareholderProfile && row.shareholderProfile.storeId)
  },

  mapRow(row) {
    const sp = row.shareholderProfile || {}
    const ratios = profileRatios(sp)
    const active = (row.status || 'active') === 'active'
    return {
      ...row,
      status: active ? 'active' : 'disabled',
      statusLabel: active ? '生效' : '停用',
      storeName: sp.storeName || sp.storeId || '未绑门店',
      ownershipRatioText: sp.ownershipRatio != null ? `${sp.ownershipRatio}%` : '—',
      beforeText: ratios.before !== '' && ratios.before != null ? `${ratios.before}%` : '—',
      afterText: ratios.after !== '' && ratios.after != null ? `${ratios.after}%` : '—',
      capitalText:
        sp.capitalContribution != null && sp.capitalContribution !== ''
          ? `¥${Number(sp.capitalContribution).toFixed(2).replace(/\.00$/, '')}`
          : '—',
      effectiveDate: sp.effectiveDate || '—'
    }
  },

  async loadList() {
    this.setData({
      loading: true,
      listError: false,
      tipText: this.data.list && this.data.list.length ? this.data.tipText : '',
      disablePendingId: '',
      enablePendingId: ''
    })
    try {
      const result = await this.callFn({ action: 'list', status: 'all' })
      let list = (result.list || [])
        .filter((row) => this.isShareholderRow(row))
        .map((row) => this.mapRow(row))
      const status = this.data.filterValues[this.data.filterIndex] || 'all'
      if (status === 'active' || status === 'disabled') {
        list = list.filter((row) => row.status === status)
      }
      this.setData({ list, loading: false, listError: false })
    } catch (e) {
      this.setData({
        loading: false,
        listError: true,
        tipTone: 'warn',
        tipText: formatCloudFnError(e, '股东列表加载失败')
      })
    }
  },

  onRetryList() {
    this.loadList()
  },

  onFilterChange(e) {
    const idx = parseInt(e.detail.value, 10) || 0
    this.setData({ filterIndex: idx })
    this.loadList()
  },

  buildStoreChecks(selectedId) {
    const sid = String(selectedId || '').trim()
    const options = this.data.storeOptions || []
    const preferred = options.filter(
      (s) =>
        s.storeId === 'store_shanhaizaowu' ||
        s.storeId === 'store_xingchen' ||
        /山川|星宸/.test(s.name || '')
    )
    const list = preferred.length ? preferred : options
    return list.map((s) => ({
      key: s.storeId,
      storeId: s.storeId,
      name: s.name,
      selected: sid === s.storeId
    }))
  },

  emptyForm() {
    return {
      openid: '',
      openidTail: '',
      phone: '',
      name: '',
      staffNo: '',
      storeId: '',
      ownershipRatio: '',
      dividendRatioBeforePayback: '',
      dividendRatioAfterPayback: '',
      capitalContribution: '',
      effectiveDate: '',
      status: 'active',
      roles: [ROLE_SHAREHOLDER],
      permissions: null,
      permissionsExplicit: false
    }
  },

  openCreate() {
    this.setData({
      showForm: true,
      editingId: '',
      formTip: '',
      lookingUp: false,
      matchHint: '',
      matched: null,
      candidates: [],
      form: this.emptyForm(),
      storeChecks: this.buildStoreChecks('')
    })
  },

  openEdit(e) {
    const id = String((e.currentTarget.dataset || {}).id || '').trim()
    const item = (this.data.list || []).find((row) => row._id === id)
    if (!item) return
    const sp = item.shareholderProfile || {}
    const ratios = profileRatios(sp)
    const roles =
      Array.isArray(item.roles) && item.roles.length
        ? item.roles.slice()
        : [item.role || ROLE_SHAREHOLDER]
    if (roles.indexOf(ROLE_SHAREHOLDER) === -1) roles.push(ROLE_SHAREHOLDER)
    this.setData({
      showForm: true,
      editingId: id,
      formTip: '',
      lookingUp: false,
      matchHint: '',
      matched: {
        openid: item.openid,
        openidTail: item.openidTail || String(item.openid || '').slice(-8),
        nickName: item.name || '已登记股东'
      },
      candidates: [],
      form: {
        openid: item.openid || '',
        openidTail: item.openidTail || String(item.openid || '').slice(-8),
        phone: '',
        name: item.name || '',
        staffNo: item.staffNo || '',
        storeId: sp.storeId || '',
        ownershipRatio: sp.ownershipRatio != null ? String(sp.ownershipRatio) : '',
        dividendRatioBeforePayback: ratios.before !== '' ? String(ratios.before) : '',
        dividendRatioAfterPayback: ratios.after !== '' ? String(ratios.after) : '',
        capitalContribution: sp.capitalContribution != null ? String(sp.capitalContribution) : '',
        effectiveDate: sp.effectiveDate || '',
        status: item.status || 'active',
        roles,
        permissions: Array.isArray(item.permissions) ? item.permissions : null,
        permissionsExplicit: !!item.permissionsExplicit
      },
      storeChecks: this.buildStoreChecks(sp.storeId || '')
    })
  },

  closeForm() {
    this.setData({ showForm: false })
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field
    if (!field) return
    const value = e.detail.value
    if (field === 'openid') {
      this.setData({
        'form.openid': value,
        'form.openidTail': String(value || '').slice(-8)
      })
      return
    }
    this.setData({ [`form.${field}`]: value })
  },

  onDateChange(e) {
    this.setData({ 'form.effectiveDate': (e.detail && e.detail.value) || '' })
  },

  toggleStore(e) {
    const storeId = String((e.currentTarget.dataset || {}).id || '').trim()
    if (!storeId) return
    this.setData({
      'form.storeId': storeId,
      storeChecks: this.buildStoreChecks(storeId)
    })
  },

  applyCandidate(candidate) {
    if (!candidate || !candidate.openid) return
    const patch = {
      matched: candidate,
      matchHint: `已匹配 ${candidate.nickName || '藏家'}（${candidate.phoneMasked || ''}）`,
      'form.openid': candidate.openid,
      'form.openidTail': candidate.openidTail || String(candidate.openid).slice(-8)
    }
    if (!this.data.form.name && (candidate.name || candidate.nickName)) {
      patch['form.name'] = candidate.name || candidate.nickName
    }
    this.setData(patch)
  },

  selectCandidate(e) {
    const openid = String((e.currentTarget.dataset || {}).openid || '').trim()
    const item = openid
      ? (this.data.candidates || []).find((c) => c.openid === openid) || null
      : null
    this.applyCandidate(item)
  },

  async lookupByPhone() {
    if (this.data.lookingUp) return
    const phone = String(this.data.form.phone || '').replace(/\D/g, '')
    if (!/^1\d{10}$/.test(phone)) {
      this.setData({ formTip: '请输入 11 位手机号' })
      return
    }
    this.setData({ lookingUp: true, matchHint: '', matched: null, candidates: [], formTip: '' })
    try {
      const result = await this.callFn({ action: 'lookupByPhone', phone })
      this.setData({ lookingUp: false })
      const candidates = result.candidates || []
      if (!candidates.length) {
        this.setData({
          candidates: [],
          matched: null,
          matchHint: result.msg || '未找到该手机号用户，请让对方先登录小程序并授权手机号',
          'form.openid': '',
          'form.openidTail': ''
        })
        return
      }
      if (candidates.length === 1) {
        this.setData({ candidates: [] })
        this.applyCandidate(candidates[0])
        return
      }
      this.setData({
        candidates,
        matched: null,
        matchHint: `找到 ${candidates.length} 个账号，请选择`
      })
    } catch (e) {
      this.setData({
        lookingUp: false,
        formTip: formatCloudFnError(e, '查找失败')
      })
    }
  },

  validateForm() {
    const form = this.data.form
    if (!form.openid || String(form.openid).trim().length < 20) {
      return '请先用手机号查找并确认 openid'
    }
    if (!String(form.storeId || '').trim()) {
      return '请绑定股东门店（山川造物 / 星宸）'
    }
    const checks = [
      { key: 'ownershipRatio', label: '占股比例' },
      { key: 'dividendRatioBeforePayback', label: '回本前分成' },
      { key: 'dividendRatioAfterPayback', label: '回本后分成' }
    ]
    for (let i = 0; i < checks.length; i += 1) {
      const c = checks[i]
      const r = clampRatioInput(form[c.key])
      if (!r.ok) return `${c.label}${r.msg}`
    }
    const cap = form.capitalContribution
    if (cap !== '' && cap != null) {
      const n = Number(cap)
      if (!Number.isFinite(n) || n < 0) return '出资额须为非负数字'
    }
    return ''
  },

  async saveForm() {
    if (this.data.saving) return
    const errMsg = this.validateForm()
    if (errMsg) {
      this.setData({ formTip: errMsg })
      return
    }
    const form = this.data.form
    const roles = Array.isArray(form.roles) && form.roles.length
      ? form.roles.filter(Boolean)
      : [ROLE_SHAREHOLDER]
    if (roles.indexOf(ROLE_SHAREHOLDER) === -1) roles.push(ROLE_SHAREHOLDER)

    const before = String(form.dividendRatioBeforePayback || '').trim()
    const afterRaw = String(form.dividendRatioAfterPayback || '').trim()
    const after = afterRaw !== '' ? afterRaw : before

    this.setData({ saving: true, formTip: '保存中…' })
    try {
      const payload = {
        action: 'upsert',
        openid: String(form.openid).trim(),
        name: form.name,
        staffNo: form.staffNo,
        roles,
        role: roles[0],
        status: form.status === 'disabled' ? 'disabled' : 'active',
        shareholderProfile: {
          storeId: String(form.storeId || '').trim(),
          ownershipRatio: form.ownershipRatio,
          dividendRatio: before,
          dividendRatioBeforePayback: before,
          dividendRatioAfterPayback: after,
          capitalContribution: form.capitalContribution,
          effectiveDate: form.effectiveDate
        }
      }
      // 编辑时保留既有细粒度权限，避免冲掉其它工作台勾选
      if (form.permissionsExplicit && Array.isArray(form.permissions)) {
        payload.permissions = form.permissions
        payload.permissionsExplicit = true
      }
      await this.callFn(payload)
      this.setData({ saving: false, showForm: false })
      clearStaffRoleCache()
      this.setData({ tipTone: 'info', tipText: '已保存' })
      this.loadList()
    } catch (e) {
      this.setData({
        saving: false,
        formTip: formatCloudFnError(e, (e && e.message) || '请稍后重试')
      })
    }
  },

  async disableRow(e) {
    const id = String((e.currentTarget.dataset || {}).id || '').trim()
    if (!id) return
    if (this.data.disablePendingId !== id) {
      this.setData({
        disablePendingId: id,
        enablePendingId: '',
        tipTone: 'warn',
        tipText: '再点一次「停用」：该账号将无法进入股东观测台（可再次启用）'
      })
      return
    }
    this.setData({ disablePendingId: '', tipTone: 'info', tipText: '正在停用…' })
    try {
      await this.callFn({ action: 'remove', staffId: id })
      clearStaffRoleCache()
      this.setData({ tipTone: 'info', tipText: '已停用' })
      this.loadList()
    } catch (err) {
      this.setData({ tipTone: 'warn', tipText: formatCloudFnError(err, '停用失败') })
    }
  },

  async enableRow(e) {
    const id = String((e.currentTarget.dataset || {}).id || '').trim()
    const item = (this.data.list || []).find((row) => row._id === id)
    if (!item || !item.openid) {
      this.setData({ tipTone: 'warn', tipText: '账号信息缺失' })
      return
    }
    const sp = item.shareholderProfile || {}
    if (!sp.storeId) {
      this.setData({ tipTone: 'warn', tipText: '请先编辑并绑定门店' })
      return
    }
    if (this.data.enablePendingId !== id) {
      this.setData({
        enablePendingId: id,
        disablePendingId: '',
        tipTone: 'warn',
        tipText: `再点一次「启用」即将恢复「${item.name || '未命名'}」的股东权限`
      })
      return
    }
    this.setData({ enablePendingId: '', tipTone: 'info', tipText: '正在启用…' })
    try {
      const roles =
        Array.isArray(item.roles) && item.roles.length
          ? item.roles
          : [item.role || ROLE_SHAREHOLDER]
      if (roles.indexOf(ROLE_SHAREHOLDER) === -1) roles.push(ROLE_SHAREHOLDER)
      const ratios = profileRatios(sp)
      const payload = {
        action: 'upsert',
        openid: item.openid,
        name: item.name || '',
        staffNo: item.staffNo || '',
        roles,
        role: item.role || ROLE_SHAREHOLDER,
        status: 'active',
        shareholderProfile: {
          storeId: sp.storeId,
          ownershipRatio: sp.ownershipRatio,
          dividendRatio: ratios.before,
          dividendRatioBeforePayback: ratios.before,
          dividendRatioAfterPayback: ratios.after,
          capitalContribution: sp.capitalContribution,
          effectiveDate: sp.effectiveDate
        }
      }
      if (item.permissionsExplicit && Array.isArray(item.permissions)) {
        payload.permissions = item.permissions
        payload.permissionsExplicit = true
      }
      await this.callFn(payload)
      clearStaffRoleCache()
      this.setData({ tipTone: 'info', tipText: '已恢复生效' })
      this.loadList()
    } catch (err) {
      this.setData({ tipTone: 'warn', tipText: formatCloudFnError(err, '启用失败') })
    }
  },

  goObservatoryPreview() {
    if (this.data.obsPending) {
      this.setData({ obsPending: false, tipTone: 'info', tipText: '' })
      goShareholderObservatory()
      return
    }
    this.setData({
      obsPending: true,
      tipTone: 'info',
      tipText: '再点一次「股东观测台」打开只读看板（按绑定门店双阶段分成）'
    })
  },

  noop() {}
})
