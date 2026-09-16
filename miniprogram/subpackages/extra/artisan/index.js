const { guardManagerPage } = require('../../../utils/managerAuth')
const {
  guardArtisanWorkspace,
  hasPermission,
  roleHasStored,
  goArtisanProductCreate,
  goArtisanConcept,
  WORKSPACE_SPECIMEN_ARTISAN
} = require('../utils/staffAuth')
const { LAMP } = require('../utils/signalLamp')
// 工作通知声音（#29）：标本师工作台的「新增待办」播报
const workNoticeCatalog = require('../../../utils/workNoticeCatalog')
const workNoticeVoice = require('../../../utils/workNoticeVoice')

function jobPreviewRows(list, limit) {
  const rows = Array.isArray(list) ? list : []
  const active = rows.filter((item) => item && item.productionStatus !== 'shipped')
  return active.slice(0, limit || 3)
}

function todoLamp(n, tone) {
  const v = Number(n) || 0
  if (v <= 0) return LAMP.muted
  if (tone === 'info') return LAMP.info
  if (tone === 'forest') return LAMP.forest
  return 'warn'
}

Page({
  data: {
    ready: false,
    roleText: '标本师',
    staffName: '',
    artisanDisplayName: '',
    canProducts: false,
    canProfile: false,
    canWorks: false,
    canPayslip: false,
    canAttendance: false,
    canConcept: false,
    // 需求 14：伴宠工单入口。可见性只看能力；实际列表由服务端按 openid 反查决定
    canPetOrders: false,
    petOrderTodo: 0,
    petOrderLamp: LAMP.muted,
    commissionNet: 0,
    commissionLoaded: false,
    statsLoading: false,
    workTotal: 0,
    workOnShelf: 0,
    workPendingShelf: 0,
    workRejected: 0,
    jobPendingMake: 0,
    jobInProgress: 0,
    jobPendingShip: 0,
    depositTodo: 0,
    depositPaidCount: 0,
    depositBalanceCount: 0,
    depositPreview: [],
    todoTotal: 0,
    jobPreview: [],
    todoLamps: {
      pending: LAMP.muted,
      make: LAMP.muted,
      ship: LAMP.muted,
      framing: LAMP.muted,
      display: LAMP.muted,
      deposit: LAMP.muted
    }
  },

  onLoad() {
    this.bootstrap()
  },

  onShow() {
    if (!this.data.ready) return
    this.applyCachedProfileName()
    this.refreshHomeStats()
  },

  onPullDownRefresh() {
    Promise.resolve(this.refreshHomeStats()).finally(() => wx.stopPullDownRefresh())
  },

  applyCachedProfileName() {
    try {
      const cached = String(wx.getStorageSync('artisan_profile_name') || '').trim()
      if (cached) this.setData({ artisanDisplayName: cached })
    } catch (e) { /* ignore */ }
  },

  async refreshProfileName() {
    this.applyCachedProfileName()
    try {
      const prof = await wx.cloud.callFunction({
        name: 'manageStaff',
        data: { action: 'getArtisanProfile' }
      })
      const p = (prof.result && prof.result.profile) || {}
      const displayName = String(p.name || '').trim()
      if (displayName) {
        this.setData({ artisanDisplayName: displayName })
        try { wx.setStorageSync('artisan_profile_name', displayName) } catch (e) { /* ignore */ }
      }
      if (p.framerId) {
        try { wx.setStorageSync('artisan_profile_id', p.framerId) } catch (e) { /* ignore */ }
      }
      return p
    } catch (e) {
      console.warn('artisan home profile', e)
      return {}
    }
  },

  async refreshHomeStats() {
    this.setData({ statsLoading: true })
    let statsOk = false
    try {
      const profile = await this.refreshProfileName()
      const framerId = (profile && profile.framerId) || ''
      if (this.data.canPayslip) {
        this.refreshCommissionSummary()
      }
      if (!this.data.canProducts && !this.data.canWorks && !this.data.canPetOrders) return

      const productCall = wx.cloud.callFunction({
        name: 'manageProducts',
        data: {
          action: 'list',
          mineOnly: true,
          framerId,
          linkBackfill: true,
          page: 1,
          pageSize: 1,
          sortBy: 'new'
        }
      })
      let jobRes = { result: { success: true, list: [], counts: {} } }
      let depositRes = { result: { success: true, list: [], counts: {}, todoTotal: 0 } }
      const [prodRes, jobSettled, depositSettled, petSettled] = await Promise.all([
        productCall,
        this.data.canWorks
          ? wx.cloud.callFunction({
              name: 'managerShipOrder',
              data: { action: 'listArtisanWorkOrders' }
            }).catch((err) => {
              console.warn('artisan jobs', err)
              return { result: { success: false, list: [], counts: {} } }
            })
          : Promise.resolve({ result: { success: true, list: [], counts: {} } }),
        wx.cloud.callFunction({
          name: 'manageDeposit',
          data: { action: 'listArtisanDeposits', framerId, limit: 20 }
        }).catch((err) => {
          console.warn('artisan deposits', err)
          return { result: { success: false, list: [], counts: {}, todoTotal: 0 } }
        }),
        // 需求 14：伴宠工单待确认数（服务端按 openid 反查指派给自己的工单）
        this.data.canPetOrders
          ? wx.cloud.callFunction({
              name: 'petMemorialOrder',
              data: { action: 'listArtisan' }
            }).catch((err) => {
              console.warn('artisan pet orders', err)
              return { result: { success: false, list: [] } }
            })
          : Promise.resolve({ result: { success: true, list: [] } })
      ])
      jobRes = jobSettled
      depositRes = depositSettled
      const petRes = (petSettled && petSettled.result) || {}
      const petList = Array.isArray(petRes.list) ? petRes.list : []
      const petOrderTodo = petList.filter((row) => row && !row.acceptedAt).length
      this.setData({ petOrderTodo, petOrderLamp: todoLamp(petOrderTodo) })
      const result = (prodRes && prodRes.result) || {}
      const shelf = result.shelfCounts || {}
      const rows = Array.isArray(result.list) ? result.list : []
      const totalFromList = Number(result.total)
      const workTotal = Number.isFinite(Number(shelf.all))
        ? Number(shelf.all)
        : (Number.isFinite(totalFromList) ? totalFromList : rows.length)
      let onShelf = Number(shelf.on)
      let pendingShelf = Number(shelf.pending)
      let rejected = Number(shelf.rejected)
      if (!result.shelfCounts) {
        onShelf = 0
        pendingShelf = 0
        rejected = 0
        rows.forEach((item) => {
          if (item && item.isOffShelf === false) onShelf += 1
          else if (item && item.shelfApprovalStatus === 'pending') pendingShelf += 1
          else if (item && item.shelfApprovalStatus === 'rejected') rejected += 1
        })
      }
      if (result.success) {
        pendingShelf = Number.isFinite(pendingShelf) ? pendingShelf : 0
        this.setData({
          workTotal,
          workOnShelf: Number.isFinite(onShelf) ? onShelf : 0,
          workPendingShelf: pendingShelf,
          workRejected: Number.isFinite(rejected) ? rejected : 0
        })
      } else {
        pendingShelf = Number(this.data.workPendingShelf) || 0
      }

      const jobs = (jobRes && jobRes.result) || {}
      const counts = jobs.counts || {}
      const pendingMake = Number(counts.pendingMake) || 0
      const inProgress = Number(counts.inProgress) || 0
      const pendingShip = Number(counts.pendingShip) || 0
      const jobList = Array.isArray(jobs.list) ? jobs.list : []

      const dep = (depositRes && depositRes.result) || {}
      const depCounts = dep.counts || {}
      const depositPaidCount = Number(depCounts.deposit_paid) || 0
      const depositBalanceCount = Number(depCounts.awaiting_balance) || 0
      const depositTodo = Number(dep.todoTotal) || (depositPaidCount + depositBalanceCount)
      const depositPreview = (Array.isArray(dep.list) ? dep.list : []).slice(0, 3).map((row) => ({
        ...row,
        previewMeta:
          row.status === 'awaiting_balance'
            ? (row.balanceDueLabel ? `待尾款 · 截止 ${row.balanceDueLabel}` : '待尾款')
            : '已付定金 · 待上架'
      }))

      const todoTotal = pendingShelf + pendingMake + pendingShip + inProgress + depositTodo
      const onShelfN = Number.isFinite(onShelf) ? onShelf : (Number(this.data.workOnShelf) || 0)
      this.setData({
        jobPendingMake: pendingMake,
        jobInProgress: inProgress,
        jobPendingShip: pendingShip,
        depositTodo,
        depositPaidCount,
        depositBalanceCount,
        depositPreview,
        todoTotal,
        jobPreview: jobPreviewRows(jobList, 3),
        todoLamps: {
          pending: todoLamp(pendingShelf),
          make: todoLamp(pendingMake),
          ship: todoLamp(pendingShip),
          framing: todoLamp(inProgress, 'info'),
          display: todoLamp(onShelfN, 'forest'),
          deposit: todoLamp(depositTodo, 'info')
        }
      })
      statsOk = true
    } catch (e) {
      console.warn('refreshHomeStats', e)
    } finally {
      this.setData({ statsLoading: false })
    }
    // 统计完整拿到后才判断声音：半截计数会被误判成「新增」（#29）
    if (statsOk) this.syncWorkNoticeVoice()
  },

  /**
   * 工作通知声音（#29）：标本师工作台的待办快照 → 只播新增。
   * 该页固定按标本师口径播报（页面上呈现的就是标本师的待办）。
   */
  syncWorkNoticeVoice() {
    try {
      const snapshot = workNoticeCatalog.buildSnapshot(this.data, workNoticeCatalog.ROLE.SPECIMEN_ARTISAN)
      const res = workNoticeVoice.announce(snapshot, workNoticeCatalog.ROLE.SPECIMEN_ARTISAN)
      if (res && res.announced && res.announced.length) this._lastVoiceAnnounced = res.announced
      return res
    } catch (e) {
      console.warn('artisan syncWorkNoticeVoice', e)
      return { announced: [], reason: 'error' }
    }
  },

  async bootstrap() {
    try {
      if (!guardManagerPage()) return
      const role = await guardArtisanWorkspace()
      if (!role) return

      const isArtisan = role.workspaceRole === WORKSPACE_SPECIMEN_ARTISAN
      const artisanRole = roleHasStored(role, 'specimen_artisan') || roleHasStored(role, 'super_admin')
      this.setData({
        ready: true,
        roleText: isArtisan ? '标本师' : (role.isSuperAdmin ? '超管' : '店长'),
        staffName: role.name || '',
        canProducts: hasPermission(role, 'manageProducts') || artisanRole,
        canProfile: hasPermission(role, 'manageArtisanProfile') || artisanRole,
        canWorks:
          hasPermission(role, 'manageArtisanWorks') ||
          hasPermission(role, 'manageProducts') ||
          artisanRole,
        canPayslip: hasPermission(role, 'viewPayslip') || artisanRole,
        canAttendance: hasPermission(role, 'staffAttendance') || artisanRole,
        canConcept:
          roleHasStored(role, 'super_admin') ||
          roleHasStored(role, 'specimen_artisan') ||
          hasPermission(role, 'manageProducts'),
        canPetOrders:
          artisanRole ||
          hasPermission(role, 'manageArtisanWorks') ||
          hasPermission(role, 'manageProducts')
      })
      this.applyCachedProfileName()
      this.refreshHomeStats()
    } catch (e) {
      console.warn('artisan bootstrap', e)
      wx.showToast({ title: '工作台加载失败', icon: 'none' })
      setTimeout(() => {
        wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/user/index' }) })
      }, 400)
    }
  },

  async refreshCommissionSummary() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageArtisanCommission',
        data: { action: 'getSummary' }
      })
      const result = (res && res.result) || {}
      if (!result.success) return
      const summary = result.summary || {}
      this.setData({
        commissionNet: Number(summary.netAmount) || 0,
        commissionLoaded: true
      })
    } catch (e) {
      console.warn('artisan commission summary', e)
    }
  },

  goUpload() {
    if (!this.data.canProducts) {
      wx.showToast({ title: '无上传藏品权限', icon: 'none' })
      return
    }
    wx.vibrateShort({ type: 'light' })
    goArtisanProductCreate()
  },

  goWorks(e) {
    if (!this.data.canWorks) {
      wx.showToast({ title: '无作品维护权限', icon: 'none' })
      return
    }
    wx.vibrateShort({ type: 'light' })
    const filter = String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.filter) || '')
    const q = filter ? `?filter=${encodeURIComponent(filter)}` : ''
    wx.navigateTo({
      url: `/subpackages/extra/artisan/works/index${q}`,
      fail: () => wx.showToast({ title: '页面暂不可用', icon: 'none' })
    })
  },

  goJobs(e) {
    if (!this.data.canWorks) {
      wx.showToast({ title: '无工单权限', icon: 'none' })
      return
    }
    wx.vibrateShort({ type: 'light' })
    const filter = String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.filter) || '')
    const q = filter
      ? `?mode=jobs&filter=${encodeURIComponent(filter)}`
      : '?mode=jobs'
    wx.navigateTo({
      url: `/subpackages/extra/artisan/works/index${q}`,
      fail: () => wx.showToast({ title: '页面暂不可用', icon: 'none' })
    })
  },

  /**
   * 需求 14：进入「伴宠工单」。入口本身也顺带攒一次工单类服务通知额度
   * （必须在用户点击的同步栈内调用，故放在这里而不是 onShow）。
   */
  goPetOrders() {
    if (!this.data.canPetOrders) {
      wx.showToast({ title: '无伴宠工单权限', icon: 'none' })
      return
    }
    wx.vibrateShort({ type: 'light' })
    try {
      const { requestStaffAllSubscribe } = require('../../../utils/staffOrderSubscribe')
      requestStaffAllSubscribe().catch(() => null)
    } catch (e) { /* 授权失败不影响跳转 */ }
    wx.navigateTo({
      url: '/subpackages/extra/artisan/pet/index',
      fail: () => wx.showToast({ title: '页面暂不可用', icon: 'none' })
    })
  },

  goDeposit(e) {
    wx.vibrateShort({ type: 'light' })
    const pid = String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.pid) || '')
    if (pid) {
      wx.navigateTo({
        url: `/subpackages/manager/manager/workspace/index?tab=1&productTab=list&productId=${pid}`,
        fail: () => {
          wx.navigateTo({
            url: '/subpackages/manager/deposit-ops/index',
            fail: () => wx.showToast({ title: '请到藏品库处理', icon: 'none' })
          })
        }
      })
      return
    }
    wx.navigateTo({
      url: '/subpackages/manager/deposit-ops/index',
      fail: () => this.goWorks({ currentTarget: { dataset: { filter: 'pending' } } })
    })
  },

  goProfile() {
    if (!this.data.canProfile) {
      wx.showToast({ title: '无个人主页权限', icon: 'none' })
      return
    }
    wx.vibrateShort({ type: 'light' })
    wx.navigateTo({
      url: '/subpackages/extra/artisan/profile/index',
      fail: () => wx.showToast({ title: '页面暂不可用', icon: 'none' })
    })
  },

  goPayslip() {
    if (!this.data.canPayslip) {
      wx.showToast({ title: '暂无工资条权限', icon: 'none' })
      return
    }
    wx.vibrateShort({ type: 'light' })
    wx.navigateTo({
      url: '/subpackages/manager/payslip/index?workspace=artisan',
      fail: () => wx.showToast({ title: '页面暂不可用', icon: 'none' })
    })
  },

  goCommission() {
    if (!this.data.canPayslip) {
      wx.showToast({ title: '暂无提成查看权限', icon: 'none' })
      return
    }
    wx.vibrateShort({ type: 'light' })
    wx.navigateTo({
      url: '/subpackages/extra/artisan/commission/index',
      fail: () => wx.showToast({ title: '页面暂不可用', icon: 'none' })
    })
  },

  goAttendance() {
    if (!this.data.canAttendance) {
      wx.showToast({ title: '暂无考勤权限', icon: 'none' })
      return
    }
    wx.vibrateShort({ type: 'light' })
    wx.navigateTo({
      url: '/subpackages/extra/staff/attendance/index',
      fail: () => wx.showToast({ title: '考勤页暂不可用', icon: 'none' })
    })
  },

  goConcept() {
    if (!this.data.canConcept) {
      wx.showToast({ title: '暂无概念生成权限', icon: 'none' })
      return
    }
    wx.vibrateShort({ type: 'light' })
    goArtisanConcept()
  }
})
