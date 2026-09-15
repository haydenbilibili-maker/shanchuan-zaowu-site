/**
 * 标本师本人 — 销售提成汇总与明细
 */
const { guardArtisanWorkspace, hasPermission, roleHasStored } = require('../../utils/staffAuth')
const { formatCloudFnError } = require('../../utils/memberScan')

const FN = 'manageArtisanCommission'

Page({
  data: {
    ready: false,
    loading: false,
    ruleText: '',
    ratePercent: 10,
    enabled: true,
    summary: {
      netAmount: 0,
      earnAmount: 0,
      reverseAmount: 0,
      salesAmount: 0,
      earnCount: 0
    },
    list: []
  },

  async onLoad() {
    const role = await guardArtisanWorkspace()
    if (!role) return
    if (
      !hasPermission(role, 'viewPayslip') &&
      !hasPermission(role, 'manageArtisanWorks') &&
      !roleHasStored(role, 'specimen_artisan') &&
      !roleHasStored(role, 'super_admin')
    ) {
      wx.showToast({ title: '暂无提成查看权限', icon: 'none' })
      setTimeout(() => wx.navigateBack({ fail: () => {} }), 800)
      return
    }
    this.setData({ ready: true })
    this.refresh()
  },

  onPullDownRefresh() {
    this.refresh().finally(() => wx.stopPullDownRefresh())
  },

  async callFn(data) {
    const res = await wx.cloud.callFunction({ name: FN, data: data || {} })
    const result = (res && res.result) || {}
    if (!result.success) {
      const err = new Error(result.msg || '操作失败')
      err.code = result.code
      throw err
    }
    return result
  },

  async refresh() {
    if (this.data.loading) return
    this.setData({ loading: true })
    try {
      const [summaryRes, ledgerRes] = await Promise.all([
        this.callFn({ action: 'getSummary' }),
        this.callFn({ action: 'listLedger', page: 1, pageSize: 40 })
      ])
      this.setData({
        loading: false,
        ruleText: summaryRes.ruleText || '',
        ratePercent: summaryRes.ratePercent || 10,
        enabled: summaryRes.enabled !== false,
        summary: summaryRes.summary || this.data.summary,
        list: ledgerRes.list || []
      })
    } catch (e) {
      this.setData({ loading: false })
      wx.showToast({ title: formatCloudFnError(e, '加载失败'), icon: 'none' })
    }
  }
})
