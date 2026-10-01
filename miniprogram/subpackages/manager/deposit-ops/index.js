/**
 * 售罄孤品定金 — 超管规则 + 意向列表
 */
const { guardStaffPage } = require('../utils/staffAuth')
const { formatCloudFnError } = require('../utils/memberScan')

const FN = 'manageDeposit'

const STATUS_TONE = {
  intent: 'muted',
  pending_pay: 'brass',
  deposit_paid: 'ok',
  awaiting_balance: 'warn',
  settled: 'ok',
  forfeited_open: 'danger',
  cancelled: 'muted'
}

const FILTER_EMPTY = {
  all: '暂无定金意向',
  intent: '暂无「仅意向」记录',
  pending_pay: '暂无待付定金',
  deposit_paid: '暂无已付定金、等上架',
  awaiting_balance: '暂无待付尾款',
  forfeited_open: '暂无逾期开放记录',
  settled: '暂无已付清记录'
}

function formatDue(raw) {
  if (!raw) return ''
  try {
    let d
    if (raw instanceof Date) d = raw
    else if (typeof raw === 'object' && raw.seconds) d = new Date(raw.seconds * 1000)
    else d = new Date(raw)
    if (Number.isNaN(d.getTime())) return ''
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    return `${y}-${m}-${day} ${hh}:${mm}`
  } catch (e) {
    return ''
  }
}

function isOverdue(raw) {
  if (!raw) return false
  try {
    const t = typeof raw === 'object' && raw.seconds
      ? raw.seconds * 1000
      : new Date(raw).getTime()
    return Number.isFinite(t) && t < Date.now()
  } catch (e) {
    return false
  }
}

Page({
  data: {
    ready: false,
    canEdit: false,
    loading: false,
    loadingList: false,
    listError: false,
    tipTone: 'info',
    tipText: '',
    formTip: '',
    forfeitPendingId: '',
    saving: false,
    sweeping: false,
    ruleText: '',
    fromDefault: true,
    statusFilter: 'all',
    emptyHint: FILTER_EMPTY.all,
    form: {
      enabled: true,
      depositRatioPct: 10,
      balanceWindowDays: 7,
      minDepositAmount: 50,
      maxDepositAmount: 500
    },
    list: [],
    counts: {},
    countsTotal: 0
  },

  async onLoad() {
    const role = await guardStaffPage('super_admin')
    if (!role) return
    this.setData({ ready: true, canEdit: true })
    await Promise.all([this.loadRules(), this.loadList()])
  },

  onPullDownRefresh() {
    Promise.all([this.loadRules(), this.loadList()]).finally(() => wx.stopPullDownRefresh())
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

  onSwitch(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [`form.${field}`]: !!e.detail.value })
  },

  onNumber(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [`form.${field}`]: e.detail.value })
  },

  async loadRules() {
    try {
      const result = await this.callFn({ action: 'getRules' })
      const rules = result.rules || {}
      this.setData({
        form: {
          enabled: rules.enabled !== false,
          depositRatioPct: Math.round((Number(rules.depositRatio) || 0.1) * 100),
          balanceWindowDays: Number(rules.balanceWindowDays) || 7,
          minDepositAmount: Number(rules.minDepositAmount) || 50,
          maxDepositAmount: Number(rules.maxDepositAmount) || 500
        },
        ruleText: result.ruleText || '',
        fromDefault: !!result.fromDefault,
        canEdit: result.canEdit !== false
      })
    } catch (e) {
      this.setData({ tipTone: 'warn', tipText: formatCloudFnError(e, '规则加载失败') })
    }
  },

  async saveRules() {
    if (!this.data.canEdit || this.data.saving) return
    const f = this.data.form
    const pct = Number(f.depositRatioPct)
    if (!(pct > 0 && pct <= 90)) {
      this.setData({ formTip: '比例请填 1–90' })
      return
    }
    this.setData({ saving: true, formTip: '保存中…' })
    try {
      const result = await this.callFn({
        action: 'saveRules',
        rules: {
          enabled: f.enabled !== false,
          depositRatio: pct / 100,
          balanceWindowDays: Number(f.balanceWindowDays) || 7,
          minDepositAmount: Number(f.minDepositAmount) || 50,
          maxDepositAmount: Number(f.maxDepositAmount) || 500,
          depositNonRefundableOnExpire: true
        }
      })
      this.setData({
        saving: false,
        ruleText: result.ruleText || '',
        fromDefault: false,
        formTip: '',
        tipTone: 'info',
        tipText: '已保存'
      })
    } catch (e) {
      this.setData({
        saving: false,
        formTip: formatCloudFnError(e, '保存失败')
      })
    }
  },

  setStatusFilter(e) {
    const status = e.currentTarget.dataset.status || 'all'
    if (status === this.data.statusFilter) return
    this.setData({
      statusFilter: status,
      emptyHint: FILTER_EMPTY[status] || FILTER_EMPTY.all
    })
    this.loadList()
  },

  async loadList() {
    this.setData({ loadingList: true, listError: false, forfeitPendingId: '' })
    try {
      const result = await this.callFn({
        action: 'listIntents',
        status: this.data.statusFilter,
        limit: 80
      })
      const list = (result.list || []).map((row) => {
        const overdue = row.status === 'awaiting_balance' && isOverdue(row.balanceDueAt)
        return {
          ...row,
          balanceDueAtText: formatDue(row.balanceDueAt),
          openidShort: row.openid ? `${String(row.openid).slice(0, 6)}…` : '',
          // 会员昵称 / 会员号由 listIntents 新增字段提供；旧版云函数没有时回退 openid 片段
          memberLabel: [row.memberNickName, row.memberNo].filter(Boolean).join(' · ') || (row.openid ? `${String(row.openid).slice(0, 6)}…` : '—'),
          statusTone: STATUS_TONE[row.status] || 'muted',
          overdue,
          canForfeit: row.status === 'awaiting_balance' || row.status === 'intent' || row.status === 'pending_pay',
          showProduct: !!row.productId
        }
      })
      const counts = result.counts || {}
      const countsTotal = Object.keys(counts).reduce((s, k) => s + (Number(counts[k]) || 0), 0)
      this.setData({
        list,
        counts,
        countsTotal: result.total != null ? result.total : countsTotal,
        loadingList: false,
        listError: false,
        emptyHint: FILTER_EMPTY[this.data.statusFilter] || FILTER_EMPTY.all
      })
    } catch (e) {
      this.setData({
        loadingList: false,
        listError: true,
        tipTone: 'warn',
        tipText: formatCloudFnError(e, '列表加载失败')
      })
    }
  },

  onRetryList() {
    this.loadList()
  },

  async openExpired(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    if (this.data.forfeitPendingId !== id) {
      this.setData({
        forfeitPendingId: id,
        tipTone: 'warn',
        tipText: '再点一次「逾期开放」：藏品对所有人可购，定金不退'
      })
      return
    }
    this.setData({ forfeitPendingId: '', tipTone: 'info', tipText: '处理中…' })
    try {
      await this.callFn({ action: 'openExpired', intentId: id })
      this.setData({ tipTone: 'info', tipText: '已开放' })
      this.loadList()
    } catch (err) {
      this.setData({ tipTone: 'warn', tipText: formatCloudFnError(err, '操作失败') })
    }
  },

  async sweepNow() {
    if (this.data.sweeping) return
    this.setData({ sweeping: true, tipTone: 'info', tipText: '清扫中…' })
    try {
      const result = await this.callFn({ action: 'sweepBalanceDue' })
      const n = Number(result.forfeited) || 0
      this.setData({ tipTone: 'info', tipText: n > 0 ? `已清扫 ${n} 条逾期` : '没有逾期项' })
      this.loadList()
    } catch (e) {
      this.setData({ tipTone: 'warn', tipText: formatCloudFnError(e, '清扫失败') })
    } finally {
      this.setData({ sweeping: false })
    }
  },

  goProduct(e) {
    const pid = e.currentTarget.dataset.pid
    if (!pid) return
    wx.navigateTo({
      url: `/subpackages/manager/manager/workspace/index?tab=1&productTab=list&productId=${pid}`,
      fail: () => this.setData({ tipTone: 'warn', tipText: '无法打开藏品库' })
    })
  }
})
