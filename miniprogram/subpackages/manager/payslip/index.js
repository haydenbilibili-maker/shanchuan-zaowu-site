const { formatCloudFnError } = require('../utils/storePoints')
const { initStaffStores } = require('../staff/utils/pageSetup')
const {
  guardArtisanWorkspace,
  guardManagerWorkspace,
  guardLiveHostWorkspace,
  hasPermission,
  roleHasStored
} = require('../utils/staffAuth')

function enrichDetail(raw) {
  if (!raw) return null
  const detail = { ...raw }
  const items = Array.isArray(detail.items) ? detail.items : []
  detail.hasItems = items.length > 0
  if (detail.hasItems) {
    let earn = 0
    let deduct = 0
    items.forEach((it) => {
      if (it && it.kind === 'deduct') deduct += Number(it.amount) || 0
      else earn += Number(it.amount) || 0
    })
    detail.grossDisplay = Math.round(earn * 100) / 100
    detail.deductDisplay = Math.round(deduct * 100) / 100
  } else {
    const base = Number(detail.base) || 0
    const bonus = Number(detail.bonus) || 0
    detail.grossDisplay =
      Number.isFinite(Number(detail.gross)) && detail.gross != null
        ? Number(detail.gross)
        : Math.round((base + bonus) * 100) / 100
    detail.deductDisplay = Number(detail.deduction) || 0
  }
  return detail
}

function emptySalesShare() {
  return {
    yearMonth: '',
    monthRevenueFmt: '—',
    mallFeeFmt: '',
    mallByStore: [],
    shareBaseFmt: '',
    rateLabel: '1%',
    shareAmountFmt: '—',
    storeScopeLabel: '',
    revenueScopeLabel: '',
    scopeNote: '',
    formulaNote: '',
    loading: false,
    error: ''
  }
}

async function guardWorkspace(workspace) {
  const ws = String(workspace || 'staff').trim()
  if (ws === 'artisan') {
    const role = await guardArtisanWorkspace()
    const ok =
      role &&
      (hasPermission(role, 'viewPayslip') ||
        roleHasStored(role, 'specimen_artisan') ||
        roleHasStored(role, 'super_admin'))
    if (!ok) {
      if (role) wx.showToast({ title: '暂无工资条权限', icon: 'none' })
      return null
    }
    return { workspace: ws, roleText: role.name ? `${role.name}` : '标本师' }
  }
  if (ws === 'manager') {
    const role = await guardManagerWorkspace()
    if (!role || !hasPermission(role, 'viewPayslip')) {
      if (role) wx.showToast({ title: '暂无工资条权限', icon: 'none' })
      return null
    }
    const label = role.isSuperAdmin ? '超管' : '店长'
    return { workspace: ws, roleText: role.name ? `${role.name} · ${label}` : label }
  }
  if (ws === 'live') {
    const role = await guardLiveHostWorkspace()
    if (!role || !hasPermission(role, 'viewPayslip')) {
      if (role) wx.showToast({ title: '暂无工资条权限', icon: 'none' })
      return null
    }
    return { workspace: ws, roleText: role.name ? `${role.name}` : '主播' }
  }
  const setup = await initStaffStores('staff')
  if (!setup) return null
  if (!hasPermission(setup.role, 'viewPayslip')) {
    wx.showToast({ title: '暂无工资条权限', icon: 'none' })
    return null
  }
  return { workspace: 'staff', roleText: setup.roleText, staffName: setup.staffName }
}

Page({
  data: {
    ready: false,
    workspace: 'staff',
    roleHint: '',
    list: [],
    detail: null,
    showDetail: false,
    loading: false,
    listError: false,
    tipTone: 'info',
    tipText: '',
    salesShare: emptySalesShare(),
    showSalesShare: false
  },

  async onLoad(options) {
    try {
      const workspace = String((options && options.workspace) || 'staff').trim()
      const ctx = await guardWorkspace(workspace)
      if (!ctx) return
      this.setData({
        ready: true,
        workspace: ctx.workspace,
        roleHint: ctx.roleText || '',
        showSalesShare: ctx.workspace === 'staff' || ctx.workspace === 'manager'
      })
      this.loadList()
      if (ctx.workspace === 'staff' || ctx.workspace === 'manager') {
        this.loadSalesShare()
      }
    } catch (e) {
      console.warn('payslip onLoad', e)
      this.setData({
        ready: true,
        tipTone: 'warn',
        tipText: '工资条加载失败',
        listError: true
      })
    }
  },

  onPullDownRefresh() {
    const tasks = [this.loadList()]
    if (this.data.showSalesShare) tasks.push(this.loadSalesShare())
    Promise.all(tasks).then(() => wx.stopPullDownRefresh())
  },

  async loadList() {
    this.setData({ loading: true, listError: false })
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageStaffWorkspace',
        data: { action: 'payslipList' }
      })
      const result = (res && res.result) || {}
      this.setData({
        loading: false,
        listError: false,
        list: result.list || []
      })
    } catch (e) {
      this.setData({
        loading: false,
        listError: true,
        tipTone: 'warn',
        tipText: formatCloudFnError(e, '加载失败')
      })
    }
  },

  onRetryList() {
    this.loadList()
  },

  async loadSalesShare() {
    this.setData({
      'salesShare.loading': true,
      'salesShare.error': ''
    })
    try {
      const res = await wx.cloud.callFunction({
        name: 'manageStaffWorkspace',
        data: { action: 'payslipSalesShare' }
      })
      const result = (res && res.result) || {}
      if (!result.success || !result.salesShare) {
        this.setData({
          salesShare: {
            ...emptySalesShare(),
            loading: false,
            error: result.msg || '销售分成暂不可用'
          }
        })
        return
      }
      const s = result.salesShare
      this.setData({
        salesShare: {
          yearMonth: s.yearMonth || '',
          monthRevenueFmt: s.monthRevenueFmt || '0.00',
          mallFeeFmt: s.mallFeeFmt || '0.00',
          mallByStore:
            Array.isArray(s.mallByStore) && s.mallByStore.length > 1
              ? s.mallByStore.map((m) => ({
                  storeId: m.storeId || m.name,
                  name: m.name || '',
                  mallFeeFmt: m.mallFeeFmt || '0.00',
                  detailText: m.detailText || ''
                }))
              : [],
          shareBaseFmt: s.shareBaseFmt || s.monthRevenueFmt || '0.00',
          rateLabel: s.rateLabel || '1%',
          shareAmountFmt: s.shareAmountFmt || '0.00',
          storeScopeLabel: s.storeScopeLabel || '',
          revenueScopeLabel: s.revenueScopeLabel || '',
          scopeNote: s.scopeNote || '',
          formulaNote: s.formulaNote || '',
          loading: false,
          error: ''
        }
      })
    } catch (e) {
      this.setData({
        salesShare: {
          ...emptySalesShare(),
          loading: false,
          error: formatCloudFnError(e, '销售分成加载失败')
        }
      })
    }
  },

  openDetail(e) {
    const id = String((e.currentTarget.dataset && e.currentTarget.dataset.id) || '')
    if (!id) return
    wx.showLoading({ title: '加载中…' })
    wx.cloud.callFunction({
      name: 'manageStaffWorkspace',
      data: { action: 'payslipDetail', id }
    }).then((res) => {
      wx.hideLoading()
      const result = (res && res.result) || {}
      if (!result.success) {
        this.setData({ tipTone: 'warn', tipText: formatCloudFnError(result, result.msg || '无法查看') })
        return
      }
      this.setData({ showDetail: true, detail: enrichDetail(result.detail) })
    }).catch((err) => {
      wx.hideLoading()
      this.setData({ tipTone: 'warn', tipText: formatCloudFnError(err, '无法查看') })
    })
  },

  closeDetail() {
    this.setData({ showDetail: false, detail: null })
  },

  noop() {}
})
