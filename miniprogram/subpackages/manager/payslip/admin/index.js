const { formatCloudFnError } = require('../../utils/storePoints')
const { guardStaffPage } = require('../../utils/staffAuth')
const { openAppModal } = require('../../../../utils/appModal')

function currentYearMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const YM_RE = /^\d{4}-\d{2}$/

function emptySiPreview() {
  return { loading: false, snapshot: null, lines: [], infos: [], standardLabel: '', msg: '', personalTotalFmt: '', companyTotalFmt: '', netFmt: '' }
}

function siFormDefaults() {
  return { siOn: false, siIncludeAnnual: null, siLegacyDeduction: false }
}

function siPreviewLines(snap) {
  const row = (who) => (r) => ({
    key: `${who}-${r.key}`,
    label: `${who === 'p' ? '扣' : '公司'} ${r.name}${r.annual ? '（全年一次）' : ''}`,
    amountFmt: `${who === 'p' ? '-' : ''}¥${Number(r.amount).toFixed(2)}`
  })
  return (snap.personal || []).map(row('p')).concat((snap.company || []).map(row('c')))
}

function estimateNet(form, personalTotal) {
  const v = (Number(form.base) || 0) + (Number(form.bonus) || 0) - (Number(form.deduction) || 0) - (Number(personalTotal) || 0)
  return (Math.round(v * 100) / 100).toFixed(2)
}

Page({
  data: {
    ready: false,
    list: [],
    loading: false,
    staffOptions: [],
    staffNames: [],
    staffIndex: 0,
    filterOpenid: '',
    showEditor: false,
    saving: false,
    form: {
      id: '',
      staffOpenid: '',
      staffName: '',
      month: currentYearMonth(),
      base: '',
      bonus: '',
      deduction: '',
      remark: '',
      ...siFormDefaults()
    },
    siPreview: emptySiPreview()
  },

  async onLoad() {
    const role = await guardStaffPage('super_admin')
    if (!role) return
    this.setData({ ready: true })
    this.loadStaffOptions()
    this.loadList()
  },

  onPullDownRefresh() {
    Promise.all([this.loadStaffOptions(), this.loadList()]).then(() => wx.stopPullDownRefresh())
  },

  async loadStaffOptions() {
    try {
      const res = await wx.cloud.callFunction({ name: 'manageStaff', data: { action: 'list' } })
      const result = (res && res.result) || {}
      const rows = (result.list || []).filter((r) => r && r.status === 'active' && r.openid)
      const staffOptions = rows.map((r) => ({
        openid: r.openid,
        name: r.name || '未命名',
        label: `${r.name || '未命名'} · …${String(r.openid).slice(-6)}`
      }))
      this.setData({
        staffOptions,
        staffNames: staffOptions.map((s) => s.label)
      })
    } catch (e) {
      console.warn('loadStaffOptions', e)
    }
  },

  async loadList() {
    this.setData({ loading: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageStaffWorkspace',
        data: {
          action: 'payslipAdminList',
          staffOpenid: this.data.filterOpenid,
          limit: 80
        }
      })
      const result = (res && res.result) || {}
      this.setData({
        loading: false,
        list: result.list || []
      })
    } catch (e) {
      this.setData({ loading: false, list: [] })
      wx.showToast({ title: formatCloudFnError(e, '加载失败'), icon: 'none' })
    }
  },

  onStaffFilterChange(e) {
    const index = parseInt(e.detail.value, 10) || 0
    const row = this.data.staffOptions[index]
    this.setData({
      staffIndex: index,
      filterOpenid: row ? row.openid : ''
    })
    this.loadList()
  },

  clearFilter() {
    this.setData({ staffIndex: 0, filterOpenid: '' })
    this.loadList()
  },

  openCreate() {
    const first = this.data.staffOptions[0]
    this.setData({
      showEditor: true,
      form: {
        id: '',
        staffOpenid: first ? first.openid : '',
        staffName: first ? first.name : '',
        month: currentYearMonth(),
        base: '',
        bonus: '',
        deduction: '',
        remark: '',
        ...siFormDefaults()
      },
      siPreview: emptySiPreview()
    })
  },

  openEdit(e) {
    const id = String((e.currentTarget.dataset && e.currentTarget.dataset.id) || '')
    const row = (this.data.list || []).find((r) => r._id === id)
    if (!row) return
    const si = row.socialInsurance || null
    const deduction = si ? row.otherDeduction : row.deduction
    this.setData({
      showEditor: true,
      form: {
        id: row._id,
        staffOpenid: row.staffOpenid || '',
        staffName: row.staffName || '',
        month: row.month || currentYearMonth(),
        base: row.base != null ? String(row.base) : '',
        bonus: row.bonus != null ? String(row.bonus) : '',
        deduction: deduction != null ? String(deduction) : '',
        remark: row.remark || '',
        siOn: !!si,
        siIncludeAnnual: si ? !!si.annualIncluded : null,
        siLegacyDeduction: !si && Number(row.deduction) > 0
      },
      siPreview: emptySiPreview()
    })
    if (si) this.refreshSiPreview()
  },

  onSiToggle(e) {
    const on = !!(e.detail && e.detail.value)
    this.setData({
      'form.siOn': on,
      'form.siIncludeAnnual': null,
      siPreview: emptySiPreview()
    })
    if (on) this.refreshSiPreview()
  },

  onSiAnnualToggle(e) {
    this.setData({ 'form.siIncludeAnnual': !!(e.detail && e.detail.value) })
    this.refreshSiPreview()
  },

  async refreshSiPreview() {
    const f = this.data.form
    if (!f.siOn || !f.staffOpenid || !YM_RE.test(String(f.month || ''))) return
    this.setData({ 'siPreview.loading': true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageStaffWorkspace',
        data: {
          action: 'payslipSiPreview',
          staffOpenid: f.staffOpenid,
          month: f.month,
          socialInsurance: { includeAnnual: f.siIncludeAnnual }
        }
      })
      const result = (res && res.result) || {}
      const snap = result.snapshot || null
      const patch = {
        siPreview: {
          loading: false,
          snapshot: snap,
          lines: snap ? siPreviewLines(snap) : [],
          infos: snap ? (snap.info || []).map((x) => x.text) : [],
          standardLabel: snap ? snap.standardLabel || '' : '',
          msg: result.success === false || !snap ? (result.msg || '暂时算不出社保明细') : '',
          personalTotalFmt: snap ? Number(snap.personalTotal).toFixed(2) : '',
          companyTotalFmt: snap ? Number(snap.companyTotal).toFixed(2) : '',
          netFmt: snap ? estimateNet(f, snap.personalTotal) : ''
        }
      }
      if (snap) patch['form.siIncludeAnnual'] = !!snap.annualIncluded
      this.setData(patch)
    } catch (e) {
      this.setData({ siPreview: { ...emptySiPreview(), msg: formatCloudFnError(e, '社保明细加载失败') } })
    }
  },

  closeEditor() {
    this.setData({ showEditor: false })
  },

  onFormInput(e) {
    const field = e.currentTarget.dataset.field
    if (!field) return
    const patch = { [`form.${field}`]: e.detail.value }
    if (field === 'month') patch['form.siIncludeAnnual'] = null
    this.setData(patch)
    if (!this.data.form.siOn) return
    if (field === 'month') {
      if (YM_RE.test(String(e.detail.value || ''))) this.refreshSiPreview()
    } else if (this.data.siPreview.snapshot) {
      this.setData({ 'siPreview.netFmt': estimateNet(this.data.form, this.data.siPreview.snapshot.personalTotal) })
    }
  },

  onFormStaffPick(e) {
    const index = parseInt(e.detail.value, 10) || 0
    const row = this.data.staffOptions[index]
    if (!row) return
    this.setData({
      'form.staffOpenid': row.openid,
      'form.staffName': row.name,
      'form.siIncludeAnnual': null
    })
    if (this.data.form.siOn) this.refreshSiPreview()
  },

  async saveForm() {
    if (this.data.saving) return
    const f = this.data.form
    const staffOpenid = String(f.staffOpenid || '').trim()
    const month = String(f.month || '').trim()
    if (!staffOpenid || !/^\d{4}-\d{2}$/.test(month)) {
      wx.showToast({ title: '请填写员工与月份 YYYY-MM', icon: 'none' })
      return
    }
    if (f.siOn && !this.data.siPreview.snapshot) {
      if (!this.data.siPreview.msg) this.setData({ 'siPreview.msg': '社保明细还没算出来，请稍候再保存' })
      return
    }
    this.setData({ saving: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageStaffWorkspace',
        data: {
          action: 'payslipUpsert',
          staffOpenid,
          staffName: f.staffName,
          month,
          base: Number(f.base),
          bonus: Number(f.bonus) || 0,
          deduction: Number(f.deduction) || 0,
          remark: f.remark,
          socialInsurance: f.siOn
            ? { apply: true, includeAnnual: f.siIncludeAnnual }
            : null
        }
      })
      const result = (res && res.result) || {}
      if (!result.success) {
        wx.showToast({ title: formatCloudFnError(result, result.msg || '保存失败'), icon: 'none' })
        return
      }
      wx.showToast({ title: '已保存', icon: 'success' })
      this.setData({ showEditor: false, saving: false })
      this.loadList()
    } catch (e) {
      wx.showToast({ title: formatCloudFnError(e, '保存失败'), icon: 'none' })
    } finally {
      this.setData({ saving: false })
    }
  },

  removeRow(e) {
    const id = String((e.currentTarget.dataset && e.currentTarget.dataset.id) || '')
    if (!id) return
    openAppModal({
      title: '删除工资条',
      content: '删除后员工端将不再可见该月记录，确定继续？',
      confirmColor: '#C4A76C',
      success: (r) => {
        if (!r.confirm) return
        wx.cloud.callFunction({
          name: 'manageStaffWorkspace',
          data: { action: 'payslipRemove', id }
        }).then((res) => {
          const result = (res && res.result) || {}
          if (!result.success) {
            wx.showToast({ title: formatCloudFnError(result, result.msg || '删除失败'), icon: 'none' })
            return
          }
          wx.showToast({ title: '已删除', icon: 'success' })
          this.loadList()
        }).catch((err) => {
          wx.showToast({ title: formatCloudFnError(err, '删除失败'), icon: 'none' })
        })
      }
    }, this)
  },

  noop() {}
})
