const { guardStaffPage, hasPermission } = require('../../utils/staffAuth')
const { formatCloudFnError } = require('../../utils/storePoints')
const { openAppModal } = require('../../../../utils/appModal')

function formatTime(raw) {
  if (!raw) return ''
  const d = raw instanceof Date ? raw : new Date(raw)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

Page({
  data: {
    ready: false,
    loading: false,
    reviewingId: '',
    lastReview: '',
    list: []
  },

  async onLoad() {
    try {
      const role = await guardStaffPage('manager')
      if (!role) return
      if (!hasPermission(role, 'leaveReview')) {
        wx.showToast({ title: '无请假审批权限', icon: 'none' })
        setTimeout(() => wx.navigateBack(), 800)
        return
      }
      this.setData({ ready: true })
      this.reload()
    } catch (e) {
      console.warn('leave-review onLoad', e)
      wx.showToast({ title: '审批页加载失败', icon: 'none' })
    }
  },

  onPullDownRefresh() {
    this.reload().finally(() => wx.stopPullDownRefresh())
  },

  async reload() {
    this.setData({ loading: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageStaffWorkspace',
        data: { action: 'leavePendingList' }
      })
      const result = (res && res.result) || {}
      const list = (result.list || []).map((row) => ({
        ...row,
        createTimeText: formatTime(row.createTime),
        rangeText: `${row.startKey || ''} ~ ${row.endKey || ''}`,
        durationLabel: row.durationLabel || '',
        lampClass: 'lamp-warn'
      }))
      this.setData({ list, loading: false })
    } catch (e) {
      this.setData({ loading: false, list: [] })
      wx.showToast({ title: formatCloudFnError(e, '加载失败'), icon: 'none' })
    }
  },

  review(e) {
    const id = String((e.currentTarget.dataset && e.currentTarget.dataset.id) || '').trim()
    const decision = String((e.currentTarget.dataset && e.currentTarget.dataset.decision) || '').trim()
    if (!id || !decision || this.data.reviewingId) return
    const label = decision === 'approved' ? '通过' : '驳回'
    openAppModal({
      title: `确认${label}？`,
      confirmColor: decision === 'approved' ? '#C4A76C' : '#D64045',
      success: async (r) => {
        if (!r.confirm) return
        this.setData({ reviewingId: id })
        wx.showLoading({ title: `${label}中…`, mask: true })
        try {
          const call = await wx.cloud.callFunction({
            name: 'manageStaffWorkspace',
            data: { action: 'leaveReview', id, decision }
          })
          const result = (call && call.result) || {}
          wx.hideLoading()
          if (!result.success) {
            this.setData({ reviewingId: '' })
            wx.showToast({ title: formatCloudFnError(result, result.msg || '操作失败'), icon: 'none' })
            return
          }
          const remain = (this.data.list || []).filter((row) => row._id !== id)
          this.setData({
            reviewingId: '',
            list: remain,
            lastReview: `已${label}，列表已更新`
          })
          wx.showToast({ title: `已${label}`, icon: 'success' })
          this.reload()
        } catch (err) {
          wx.hideLoading()
          this.setData({ reviewingId: '' })
          wx.showToast({ title: formatCloudFnError(err, '操作失败'), icon: 'none' })
        }
      }
    }, this)
  }
})
