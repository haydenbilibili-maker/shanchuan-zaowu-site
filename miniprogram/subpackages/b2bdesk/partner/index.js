/**
 * 供应商管理中心 · 伙伴权限（超管）
 * 功能项存 staff_members.b2bDesk.features；启停 = staff_members.status（resolveActor 只认 active，全部 B2B 接口即刻生效）。
 * 同时有门店角色的账号不在这里启停，避免误停门店权限。
 * 资料图（门头 / 标志 + 资质照）上传即经 adminSavePartnerProfile 保存；资质照直接用 cloud:// 显示（按云存储权限读，不转公开链接）。
 */
const { callDesk } = require('../utils/deskApi')
const { thumbOf, absUrl, bigOf, pickAndUpload, preview } = require('../utils/deskImage')

const LICENSE_MAX = 3

function sideOk(f, sides) {
  return f.side === 'both' || !!(sides && sides[f.side])
}

Page({
  data: {
    loading: true,
    error: '',
    partner: null,
    featureRows: [],
    supplierId: '',
    note: '',
    dirty: false,
    saving: false,
    statusArmed: false,
    statusBusy: false,
    initial: '',
    logo: '',
    logoThumb: '',
    licenses: [],
    licenseMax: LICENSE_MAX,
    busy: '',
    flash: '',
    flashErr: false
  },

  onLoad(query) {
    this._id = decodeURIComponent((query && query.id) || '')
    this.load()
  },

  onUnload() {
    clearTimeout(this._armTimer)
  },

  load() {
    if (!this._id) return this.setData({ loading: false, error: '缺少伙伴 ID' })
    this.setData({ loading: true, error: '' })
    return callDesk('adminListPartners', {}).then((res) => {
      if (!res.success) return this.setData({ loading: false, error: res.msg || '加载失败' })
      const p = (res.list || []).find((x) => x.staffId === this._id)
      if (!p) return this.setData({ loading: false, error: '伙伴不存在或已不是采购商 / 供货方' })
      const featureRows = (res.catalog || [])
        .filter((f) => sideOk(f, p.sides))
        .map((f) => ({ key: f.key, label: f.label, hint: f.hint, on: p.features[f.key] === true }))
      const sideText = [p.sides && p.sides.buyer ? '采购商' : '', p.sides && p.sides.supplier ? '供货方' : ''].filter(Boolean).join(' / ') || '—'
      const profile = p.profile || {}
      this.setData({
        loading: false,
        partner: { ...p, sideText },
        initial: String(p.name || '').trim().charAt(0) || '·',
        logo: profile.logo || '',
        logoThumb: thumbOf(profile.logo),
        licenses: (profile.licenses || []).slice(0, LICENSE_MAX),
        featureRows,
        supplierId: p.supplierId || '',
        note: p.note || '',
        dirty: false
      })
    })
  },

  showFlash(msg, err) {
    this.setData({ flash: msg || '', flashErr: !!err })
  },

  /** 只送这次改动的那一个键（logo 或 licenses），另一个键服务端原样不动 */
  saveProfile(patch, kind) {
    this.setData({ busy: kind })
    return callDesk('adminSavePartnerProfile', { staffId: this._id, ...patch }).then((res) => {
      this.setData({ busy: '' })
      if (!res.success) {
        this.showFlash(res.msg || '图片没保存上，请重试', true)
        return false
      }
      this.showFlash(res.msg || '图片已保存')
      return true
    })
  },

  onLogoTap() {
    if (this.data.logo) {
      const big = bigOf(this.data.logo)
      if (big) preview([big])
      return
    }
    this.chooseLogo()
  },

  async chooseLogo() {
    if (this.data.busy) return
    this.setData({ busy: 'logo' })
    const r = await pickAndUpload(`b2b-partner/${this._id}`)
    if (r.cancelled) return this.setData({ busy: '' })
    if (!r.ok) {
      this.setData({ busy: '' })
      return this.showFlash(r.msg, true)
    }
    if (await this.saveProfile({ logo: r.fileID }, 'logo')) {
      this.setData({ logo: r.fileID, logoThumb: thumbOf(r.fileID) })
    }
  },

  async removeLogo() {
    if (this.data.busy) return
    if (await this.saveProfile({ logo: '' }, 'logo')) this.setData({ logo: '', logoThumb: '' })
  },

  onLogoError() {
    const raw = absUrl(this.data.logo)
    this.setData({ logoThumb: this.data.logoThumb !== raw ? raw : '' })
  },

  async addLicense() {
    if (this.data.busy || this.data.licenses.length >= LICENSE_MAX) return
    this.setData({ busy: 'license' })
    const r = await pickAndUpload(`b2b-partner/${this._id}/license`)
    if (r.cancelled) return this.setData({ busy: '' })
    if (!r.ok) {
      this.setData({ busy: '' })
      return this.showFlash(r.msg, true)
    }
    const next = this.data.licenses.concat(r.fileID)
    if (await this.saveProfile({ licenses: next }, 'license')) this.setData({ licenses: next })
  },

  async removeLicense(e) {
    if (this.data.busy) return
    const i = Number(e.currentTarget.dataset.index)
    const next = this.data.licenses.filter((_, k) => k !== i)
    if (await this.saveProfile({ licenses: next }, 'license')) this.setData({ licenses: next })
  },

  previewLicense(e) {
    const i = Number(e.currentTarget.dataset.index) || 0
    preview(this.data.licenses, this.data.licenses[i])
  },

  toggleFeature(e) {
    const key = e.currentTarget.dataset.key
    const rows = this.data.featureRows.map((r) => (r.key === key ? { ...r, on: !r.on } : r))
    this.setData({ featureRows: rows, dirty: true, flash: '' })
  },

  onSupplierId(e) {
    this.setData({ supplierId: String(e.detail.value || '').trim(), dirty: true })
  },

  onNote(e) {
    this.setData({ note: String(e.detail.value || ''), dirty: true })
  },

  save() {
    if (this.data.saving || !this.data.partner) return
    const features = {}
    // 目录里其它侧的功能项保持原值，避免保存时被重置
    Object.keys(this.data.partner.features || {}).forEach((k) => { features[k] = this.data.partner.features[k] })
    this.data.featureRows.forEach((r) => { features[r.key] = r.on })
    const payload = { staffId: this._id, features, note: this.data.note }
    if (this.data.partner.sides && this.data.partner.sides.supplier) payload.supplierId = this.data.supplierId
    this.setData({ saving: true, flash: '' })
    callDesk('adminSavePartnerAccess', payload).then((res) => {
      this.setData({ saving: false })
      if (!res.success) return this.showFlash(res.msg || '保存失败', true)
      this.setData({ dirty: false, 'partner.features': res.features || features })
      this.showFlash('已保存：伙伴下次进入工作台即按新配置生效')
    })
  },

  toggleStatus() {
    const p = this.data.partner
    if (!p || this.data.statusBusy) return
    if (!p.b2bOnly) return this.showFlash('该账号同时有门店角色，请到店员花名册启停', true)
    if (!this.data.statusArmed) {
      this.setData({ statusArmed: true })
      clearTimeout(this._armTimer)
      this._armTimer = setTimeout(() => this.setData({ statusArmed: false }), 4000)
      return
    }
    clearTimeout(this._armTimer)
    const next = p.status === 'active' ? 'disabled' : 'active'
    this.setData({ statusBusy: true, statusArmed: false })
    callDesk('adminSetPartnerStatus', { staffId: this._id, status: next }).then((res) => {
      this.setData({ statusBusy: false })
      if (!res.success) return this.showFlash(res.msg || '操作失败', true)
      this.setData({ 'partner.status': res.status || next })
      this.showFlash(res.msg)
    })
  },

  previewStatement() {
    wx.navigateTo({ url: `/subpackages/b2bdesk/statement/index?partnerStaffId=${encodeURIComponent(this._id)}` })
  },

  openOrders() {
    const p = this.data.partner
    if (!p || !p.partnerKeys || !p.partnerKeys.length) return
    const pages = getCurrentPages()
    const center = pages.length > 1 ? pages[pages.length - 2] : null
    if (center && center.route === 'subpackages/b2bdesk/center/index' && typeof center.onDashPartner === 'function') {
      center.onDashPartner({ currentTarget: { dataset: { key: p.partnerKeys[0], name: p.name } } })
      wx.navigateBack()
      return
    }
    wx.redirectTo({ url: '/subpackages/b2bdesk/center/index?tab=orders' })
  }
})
