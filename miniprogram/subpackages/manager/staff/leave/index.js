const { formatCloudFnError } = require('../../utils/storePoints')
const {
  initStaffStores,
  applyStoreChange,
  formatTime,
  statusTextLeave,
  resolveStoreFromQuery
} = require('../utils/pageSetup')

function todayKey() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function calcDurationHours(startDate, startTime, endDate, endTime) {
  const s = new Date(`${startDate}T${startTime || '00:00'}:00`)
  const e = new Date(`${endDate}T${endTime || '23:59'}:00`)
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e <= s) return 0
  return Math.round(((e - s) / 3600000) * 10) / 10
}

function durationLabel(hours) {
  const h = Number(hours) || 0
  if (h <= 0) return '—'
  const days = Math.floor(h / 24)
  const rem = Math.round((h - days * 24) * 10) / 10
  if (days > 0 && rem > 0) return `${days} 天 ${rem} 小时`
  if (days > 0) return `${days} 天`
  return `${h} 小时`
}

Page({
  data: {
    ready: false,
    storeOptions: [],
    storeNames: [],
    storeIndex: 0,
    storeId: '',
    storeName: '',
    leaveTypes: [],
    leaveTypeLabels: [],
    leaveTypeIndex: 0,
    form: {
      startDate: '',
      startTime: '09:00',
      endDate: '',
      endTime: '18:00',
      reason: ''
    },
    durationPreview: '—',
    list: [],
    submitting: false,
    cancellingId: ''
  },

  async onLoad(options) {
    try {
      const setup = await initStaffStores('staff')
      if (!setup) return
      const store = resolveStoreFromQuery(options, setup)
      const key = todayKey()
      this.setData({
        ready: true,
        storeOptions: setup.storeOptions,
        storeNames: setup.storeNames,
        storeIndex: store.storeIndex,
        storeId: store.storeId,
        storeName: store.storeName,
        form: {
          startDate: key,
          startTime: '09:00',
          endDate: key,
          endTime: '18:00',
          reason: ''
        }
      })
      this.updateDurationPreview()
      await this.loadMeta()
      this.loadList()
    } catch (e) {
      console.warn('leave onLoad', e)
      wx.showToast({ title: '请假页加载失败', icon: 'none' })
    }
  },

  async loadMeta() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageStaffWorkspace',
        data: { action: 'getMeta' }
      })
      const result = (res && res.result) || {}
      const leaveTypes = result.leaveTypes || [
        { key: 'personal', label: '事假' },
        { key: 'sick', label: '病假' },
        { key: 'annual', label: '年假' },
        { key: 'comp', label: '调休' },
        { key: 'other', label: '其他' }
      ]
      this.setData({
        leaveTypes,
        leaveTypeLabels: leaveTypes.map((t) => t.label),
        leaveTypeIndex: 0
      })
    } catch (e) {
      this.setData({
        leaveTypes: [{ key: 'personal', label: '事假' }],
        leaveTypeLabels: ['事假'],
        leaveTypeIndex: 0
      })
    }
  },

  onPullDownRefresh() {
    this.loadList().then(() => wx.stopPullDownRefresh())
  },

  onStoreChange(e) {
    applyStoreChange(this, parseInt(e.detail.value, 10) || 0)
  },

  onLeaveTypeChange(e) {
    this.setData({ leaveTypeIndex: parseInt(e.detail.value, 10) || 0 })
  },

  onDateChange(e) {
    const field = e.currentTarget.dataset.field
    if (!field) return
    this.setData({ [`form.${field}`]: e.detail.value })
    this.updateDurationPreview()
  },

  onTimeChange(e) {
    const field = e.currentTarget.dataset.field
    if (!field) return
    this.setData({ [`form.${field}`]: e.detail.value })
    this.updateDurationPreview()
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field
    if (!field) return
    this.setData({ [`form.${field}`]: e.detail.value })
  },

  updateDurationPreview() {
    const { startDate, startTime, endDate, endTime } = this.data.form
    const hours = calcDurationHours(startDate, startTime, endDate, endTime)
    this.setData({ durationPreview: durationLabel(hours) })
  },

  async loadList() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageStaffWorkspace',
        data: { action: 'leaveList', limit: 30 }
      })
      const result = (res && res.result) || {}
      const list = (result.list || []).map((row) => ({
        ...row,
        timeText: formatTime(row.createTime),
        rangeText: `${row.startKey || ''} ${String(row.startAt).slice(11, 16) || ''} ~ ${row.endKey || ''}`.trim(),
        statusLabel: row.statusLabel || statusTextLeave(row.status),
        lampClass:
          row.status === 'pending'
            ? 'lamp-warn'
            : row.status === 'approved'
              ? 'lamp-forest'
              : row.status === 'rejected'
                ? 'lamp-error'
                : 'lamp-muted'
      }))
      this.setData({ list })
    } catch (e) {
      wx.showToast({ title: formatCloudFnError(e, '列表加载失败'), icon: 'none' })
    }
  },

  submit() {
    if (this.data.submitting) return
    const form = this.data.form
    const hours = calcDurationHours(form.startDate, form.startTime, form.endDate, form.endTime)
    if (hours <= 0) {
      wx.showToast({ title: '请检查起止时间', icon: 'none' })
      return
    }
    if (!String(form.reason || '').trim()) {
      wx.showToast({ title: '请填写请假事由', icon: 'none' })
      return
    }
    const type = (this.data.leaveTypes || [])[this.data.leaveTypeIndex] || { key: 'personal' }
    this.setData({ submitting: true })
    wx.showLoading({ title: '提交中…', mask: true })
    wx.cloud.callFunction({
      name: 'manageStaffWorkspace',
      data: {
        action: 'leaveSubmit',
        leaveType: type.key,
        startDate: form.startDate,
        startTime: form.startTime,
        endDate: form.endDate,
        endTime: form.endTime,
        reason: form.reason,
        storeId: this.data.storeId,
        storeName: this.data.storeName
      }
    }).then((res) => {
      wx.hideLoading()
      const result = (res && res.result) || {}
      if (!result.success) {
        this.setData({ submitting: false })
        wx.showToast({ title: formatCloudFnError(result, result.msg || '提交失败'), icon: 'none' })
        return
      }
      this.setData({
        submitting: false,
        form: {
          ...this.data.form,
          reason: ''
        }
      })
      wx.showToast({
        title: result.autoApproved ? '已通过（超管直通）' : '已提交，待审批',
        icon: 'success'
      })
      this.loadList()
    }).catch((err) => {
      wx.hideLoading()
      this.setData({ submitting: false })
      wx.showToast({ title: formatCloudFnError(err, '提交失败'), icon: 'none' })
    })
  },

  cancelLeave(e) {
    const id = String((e.currentTarget.dataset && e.currentTarget.dataset.id) || '').trim()
    if (!id || this.data.cancellingId) return
    wx.showModal({
      title: '撤销请假？',
      content: '仅待审批的申请可撤销',
      confirmColor: '#C4A76C',
      success: (r) => {
        if (!r.confirm) return
        this.setData({ cancellingId: id })
        wx.showLoading({ title: '撤销中…', mask: true })
        wx.cloud.callFunction({
          name: 'manageStaffWorkspace',
          data: { action: 'leaveCancel', id }
        }).then((res) => {
          wx.hideLoading()
          const result = (res && res.result) || {}
          this.setData({ cancellingId: '' })
          if (!result.success) {
            wx.showToast({ title: formatCloudFnError(result, result.msg || '撤销失败'), icon: 'none' })
            return
          }
          wx.showToast({ title: '已撤销', icon: 'success' })
          this.loadList()
        }).catch((err) => {
          wx.hideLoading()
          this.setData({ cancellingId: '' })
          wx.showToast({ title: formatCloudFnError(err, '撤销失败'), icon: 'none' })
        })
      }
    })
  }
})
