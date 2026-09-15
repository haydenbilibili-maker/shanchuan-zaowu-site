const { formatCloudFnError } = require('../../utils/storePoints')
const { guardStaffPage } = require('../../utils/staffAuth')

function currentYearMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
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
      remark: ''
    }
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
        remark: ''
      }
    })
  },

  openEdit(e) {
    const id = String((e.currentTarget.dataset && e.currentTarget.dataset.id) || '')
    const row = (this.data.list || []).find((r) => r._id === id)
    if (!row) return
    this.setData({
      showEditor: true,
      form: {
        id: row._id,
        staffOpenid: row.staffOpenid || '',
        staffName: row.staffName || '',
        month: row.month || currentYearMonth(),
        base: row.base != null ? String(row.base) : '',
        bonus: row.bonus != null ? String(row.bonus) : '',
        deduction: row.deduction != null ? String(row.deduction) : '',
        remark: row.remark || ''
      }
    })
  },

  closeEditor() {
    this.setData({ showEditor: false })
  },

  onFormInput(e) {
    const field = e.currentTarget.dataset.field
    if (!field) return
    this.setData({ [`form.${field}`]: e.detail.value })
  },

  onFormStaffPick(e) {
    const index = parseInt(e.detail.value, 10) || 0
    const row = this.data.staffOptions[index]
    if (!row) return
    this.setData({
      'form.staffOpenid': row.openid,
      'form.staffName': row.name
    })
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
          remark: f.remark
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
    wx.showModal({
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
    })
  },

  noop() {}
})
