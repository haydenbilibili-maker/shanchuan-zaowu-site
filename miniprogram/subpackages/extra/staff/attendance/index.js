const { formatCloudFnError } = require('../../utils/storePoints')
const { initStaffStores, applyStoreChange, formatTime, statusTextAttendance, resolveStoreFromQuery } = require('../utils/pageSetup')
const { buildWeek, weekSummary, mergeRecords } = require('./punchCard')

Page({
  data: {
    ready: false,
    storeOptions: [],
    storeNames: [],
    storeIndex: 0,
    storeId: '',
    storeName: '',
    today: [],
    todayStatus: 'none',
    todayStatusLabel: '今日尚未打卡',
    todayStatusHint: '',
    lastClock: '',
    canClockIn: true,
    canClockOut: false,
    onLeave: false,
    leaveHint: '',
    recent: [],
    loading: false,
    clocking: false,
    week: buildWeek([], new Date()),
    weekSummary: '',
    justPunched: ''
  },

  async onLoad(options) {
    try {
      const setup = await initStaffStores('staff')
      if (!setup) return
      const store = resolveStoreFromQuery(options, setup)
      this.setData({
        ready: true,
        storeOptions: setup.storeOptions,
        storeNames: setup.storeNames,
        storeIndex: store.storeIndex,
        storeId: store.storeId,
        storeName: store.storeName
      })
      this.refresh()
    } catch (e) {
      console.warn('attendance onLoad', e)
      wx.showToast({ title: '考勤页加载失败', icon: 'none' })
    }
  },

  onShow() {
    if (this.data.ready) this.refresh()
  },

  onPullDownRefresh() {
    this.refresh().then(() => wx.stopPullDownRefresh())
  },

  onStoreChange(e) {
    applyStoreChange(this, parseInt(e.detail.value, 10) || 0)
    this.refresh()
  },

  goLeave() {
    const qs = `storeId=${encodeURIComponent(this.data.storeId || '')}&storeName=${encodeURIComponent(this.data.storeName || '')}`
    wx.navigateTo({
      url: `/subpackages/extra/staff/leave/index?${qs}`,
      fail: () => wx.showToast({ title: '请假页暂不可用', icon: 'none' })
    })
  },

  async refresh() {
    this.setData({ loading: true })
    try {
      const [todayRes, listRes] = await Promise.all([
        wx.cloud.callFunction({
          name: 'manageStaffWorkspace',
          data: { action: 'attendanceToday', storeId: this.data.storeId }
        }),
        wx.cloud.callFunction({
          name: 'manageStaffWorkspace',
          data: { action: 'attendanceList', limit: 15 }
        })
      ])
      const todayR = (todayRes && todayRes.result) || {}
      const listR = (listRes && listRes.result) || {}
      const onLeave = !!todayR.onLeave
      const leave = todayR.leave || null
      const today = (todayR.today || []).map((row) => ({
        ...row,
        timeText: formatTime(row.clockAt),
        statusLabel: statusTextAttendance(row.status),
        typeLabel: row.type === 'out' ? '下班' : '上班'
      }))
      const recent = (listR.list || []).map((row) => ({
        ...row,
        timeText: formatTime(row.clockAt),
        statusLabel: statusTextAttendance(row.status),
        typeLabel: row.type === 'out' ? '下班' : '上班'
      }))

      let todayStatus = !today.length ? 'none' : (todayR.canClockOut ? 'in' : 'done')
      let todayStatusLabel = !today.length
        ? '今日尚未打卡'
        : (todayR.canClockOut ? '已上班，待下班' : '今日已完成上下班')
      let todayStatusHint = today.length
        ? today.map((row) => `${row.typeLabel} ${row.timeText} · ${row.statusLabel}`).join('  /  ')
        : `${this.data.storeName || '当前门店'} · 上班 09:30 前为准时`

      if (onLeave && leave) {
        todayStatus = 'leave'
        todayStatusLabel = `今日请假 · ${leave.leaveTypeLabel || '请假'}`
        todayStatusHint = `${leave.startKey || ''} ~ ${leave.endKey || ''} · ${leave.durationLabel || ''} · 不计异常缺勤`
      }

      const week = buildWeek(mergeRecords(today, recent), new Date())
      this.setData({
        loading: false,
        today,
        recent,
        week,
        weekSummary: weekSummary(week),
        canClockIn: todayR.canClockIn !== false,
        canClockOut: !!todayR.canClockOut,
        onLeave,
        leaveHint: onLeave && leave ? (leave.reason || '') : '',
        todayStatus,
        todayStatusLabel,
        todayStatusHint
      })
    } catch (e) {
      this.setData({ loading: false })
      wx.showToast({ title: formatCloudFnError(e, '加载失败'), icon: 'none' })
    }
  },

  clock(e) {
    if (this.data.clocking) return
    const type = e.currentTarget.dataset.type === 'out' ? 'out' : 'in'
    this.setData({ clocking: true })
    wx.showLoading({ title: '打卡中…', mask: true })
    wx.cloud.callFunction({
      name: 'manageStaffWorkspace',
      data: {
        action: 'attendanceClock',
        type,
        storeId: this.data.storeId,
        storeName: this.data.storeName
      }
    }).then((res) => {
      wx.hideLoading()
      this.setData({ clocking: false })
      const result = (res && res.result) || {}
      if (!result.success) {
        wx.showToast({ title: formatCloudFnError(result, result.msg || '打卡失败'), icon: 'none' })
        return
      }
      const label = type === 'in' ? '上班' : '下班'
      const statusText = result.statusText || '已记录'
      // 仪式感：今天那一格「咔哒」打出一个孔 + 一下轻震（震动失败不影响打卡）
      this.setData({ lastClock: `${label}打卡成功 · ${statusText}`, justPunched: type })
      try { wx.vibrateShort({ type: 'medium' }) } catch (err) { /* 低版本基础库无 type 参数 */ }
      clearTimeout(this._punchTimer)
      this._punchTimer = setTimeout(() => this.setData({ justPunched: '' }), 1400)
      wx.showToast({ title: `${label} · ${statusText}`, icon: 'success' })
      this.refresh()
    }).catch((err) => {
      wx.hideLoading()
      this.setData({ clocking: false })
      wx.showToast({ title: formatCloudFnError(err, '打卡失败'), icon: 'none' })
    })
  }
})
