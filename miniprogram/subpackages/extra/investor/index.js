/**
 * 投资观测台 · 对齐超管数据报表口径
 * 综合营收 = 线上净额 + 双店账本；信号灯最大集合 8 盏；周期含近7/30/90 + 自然月
 */
const { guardManagerPage } = require('../../../utils/managerAuth')
const {
  guardInvestorWorkspace,
  hasPermission
} = require('../utils/staffAuth')
const { SIGNAL, LAMP } = require('../utils/signalLamp')
const storeLedger = require('../utils/storeLedger')

const DEFAULT_STORE_ID = 'store_shanhaizaowu'
const XINGCHEN_STORE_ID = 'store_xingchen'

function money(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return '0.00'
  return v.toFixed(2)
}

function shortMoney(n) {
  const v = Number(n) || 0
  if (v >= 10000) return `${(v / 10000).toFixed(1).replace(/\.0$/, '')}万`
  if (v >= 1000) return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return String(Math.round(v))
}

function shortCount(n) {
  const v = Number(n) || 0
  if (v >= 10000) return `${Math.round(v / 1000)}k`
  if (v >= 1000) return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return String(Math.round(v))
}

function pct(part, whole) {
  const p = Number(part) || 0
  const w = Number(whole) || 0
  if (w <= 0) return 0
  return Math.round((p / w) * 1000) / 10
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

function formatClock(d) {
  const t = d instanceof Date ? d : new Date()
  return `${pad2(t.getHours())}:${pad2(t.getMinutes())}`
}

function windowWidth() {
  try {
    return (wx.getWindowInfo && wx.getWindowInfo().windowWidth) || wx.getSystemInfoSync().windowWidth || 375
  } catch (e) {
    return 375
  }
}

function computeChartLayout(barCount) {
  const win = windowWidth()
  const rpx = win / 750
  const pagePad = 64 * rpx
  const cardPad = 40 * rpx
  const trendW = Math.max(160, win - pagePad - cardPad)
  const narrow = win < 340
  const count = Math.max(1, barCount || 7)
  const colW = trendW / count
  const barTrackPx = Math.max(narrow ? 8 : 10, Math.min(narrow ? 26 : 32, Math.round(colW * 0.42)))
  const trendH = narrow ? 120 : 148
  return {
    narrow,
    trendBarsStyle: `height: ${trendH}px; padding-top: 4px;`,
    barTrackStyle: `width: ${barTrackPx}px;`,
    valFontStyle: `font-size: ${narrow ? 9 : 10}px;`,
    lblFontStyle: `font-size: ${narrow ? 9 : 10}px;`
  }
}

function pickLabelIndices(values, narrow) {
  const n = values.length
  const indices = new Set()
  if (!n) return indices
  let peakIdx = 0
  let peak = -1
  values.forEach((v, i) => {
    const num = Number(v) || 0
    if (num >= peak) {
      peak = num
      peakIdx = i
    }
  })
  indices.add(0)
  indices.add(n - 1)
  indices.add(peakIdx)
  if (!narrow) {
    for (let i = 0; i < n; i += Math.max(2, Math.floor(n / 5))) indices.add(i)
  }
  return indices
}

function downsampleSeries(series, maxPoints) {
  const list = Array.isArray(series) ? series.slice() : []
  const cap = Math.max(4, maxPoints || 14)
  if (list.length <= cap) return list
  const bucketSize = Math.ceil(list.length / cap)
  const out = []
  for (let i = 0; i < list.length; i += bucketSize) {
    const slice = list.slice(i, i + bucketSize)
    const first = slice[0] || {}
    const last = slice[slice.length - 1] || first
    const sumKeys = ['count', 'dau', 'orders', 'gmvPaid', 'netOnline', 'offlineLedger', 'total', 'online', 'offline']
    const merged = { ...first, dateKey: last.dateKey || first.dateKey }
    sumKeys.forEach((k) => {
      merged[k] = slice.reduce((s, row) => s + (Number(row[k]) || 0), 0)
    })
    const startLbl = (first.label || (first.dateKey || '').slice(5) || '').slice(0, 5)
    const endLbl = (last.label || (last.dateKey || '').slice(5) || '').slice(0, 5)
    merged.label = startLbl && endLbl && startLbl !== endLbl ? `${startLbl}~${endLbl}` : endLbl || startLbl
    out.push(merged)
  }
  return out
}

function buildShareMix(items, tones) {
  const list = (items || []).filter((x) => Number(x.value) > 0)
  const total = list.reduce((s, x) => s + (Number(x.value) || 0), 0)
  return list.map((x, i) => {
    const value = Number(x.value) || 0
    const p = total > 0 ? Math.round((value / total) * 1000) / 10 : 0
    return {
      key: x.key || x.label || String(i),
      label: x.label || x.key || '',
      value,
      valueFmt: x.valueFmt || money(value),
      count: x.count || 0,
      pct: p,
      tone: (tones && tones[i % tones.length]) || 'brass',
      barStyle: `width:${Math.max(p > 0 ? 4 : 0, Math.min(100, p))}%`
    }
  })
}

function buildBars(series, valueKey, formatFn) {
  const rows = Array.isArray(series) ? series : []
  const values = rows.map((r) => Math.max(0, Number(r[valueKey]) || 0))
  const peak = Math.max(0, ...values, 0)
  const scale = peak > 0 ? peak : 1
  const layout = computeChartLayout(rows.length)
  const labels = pickLabelIndices(values, layout.narrow)
  const bars = rows.map((r, i) => {
    const total = values[i]
    const h = total > 0 ? Math.max(6, Math.round((total / scale) * 100)) : peak > 0 ? 0 : 2
    const rawLabel = r.label || r.day || (r.dateKey || r.date || '').slice(5) || ''
    return {
      key: r.dateKey || r.date || String(i),
      day: rawLabel,
      styleOnline: `height: 0%`,
      styleOnlineTarget: `height: ${h}%`,
      styleOffline: 'height: 0%',
      styleOfflineTarget: 'height: 0%',
      heightPct: h,
      showVal: labels.has(i) && total > 0,
      valShort: formatFn(total)
    }
  })
  return { bars, layout, empty: !rows.length || peak <= 0 }
}

function buildStackedBars(series, formatFn) {
  const rows = Array.isArray(series) ? series : []
  const totals = rows.map((r) => Math.max(0, Number(r.total) || 0))
  const peak = Math.max(0, ...totals, 0)
  const scale = peak > 0 ? peak : 1
  const layout = computeChartLayout(rows.length)
  const labels = pickLabelIndices(totals, layout.narrow)
  const bars = rows.map((r, i) => {
    const online = Math.max(0, Number(r.online) || 0)
    const offline = Math.max(0, Number(r.offline) || 0)
    const total = Math.max(0, Number(r.total) || online + offline)
    let onlineH = total > 0 ? Math.max(4, Math.round((online / scale) * 100)) : 0
    let offlineH = total > 0 ? Math.max(offline > 0 ? 4 : 0, Math.round((offline / scale) * 100)) : peak > 0 ? 0 : 2
    if (onlineH + offlineH > 100) {
      const t = onlineH + offlineH
      onlineH = Math.round((onlineH / t) * 100)
      offlineH = 100 - onlineH
    }
    const rawLabel = r.label || r.day || (r.dateKey || '').slice(5) || ''
    return {
      key: r.dateKey || String(i),
      day: rawLabel,
      styleOnline: 'height: 0%',
      styleOffline: 'height: 0%',
      styleOnlineTarget: `height: ${onlineH}%`,
      styleOfflineTarget: `height: ${offlineH}%`,
      showVal: labels.has(i) && total > 0,
      valShort: formatFn(total)
    }
  })
  return { bars, layout, empty: !rows.length || peak <= 0 }
}

function animateBars(page, path, bars, stacked) {
  const zeroed = (bars || []).map((b) => ({
    ...b,
    styleOnline: 'height: 0%',
    styleOffline: stacked ? 'height: 0%' : b.styleOffline
  }))
  page.setData({ [path]: zeroed })
  setTimeout(() => {
    if (page._refreshSeq !== page._animSeq) return
    const raised = (bars || []).map((b) => ({
      ...b,
      styleOnline: b.styleOnlineTarget || `height: ${b.heightPct || 0}%`,
      styleOffline: stacked ? b.styleOfflineTarget || 'height: 0%' : b.styleOffline
    }))
    page.setData({ [path]: raised })
  }, 40)
}

function statusTone(status) {
  if (status === 'ok') return 'up'
  if (status === 'warn') return 'warn'
  if (status === 'danger') return 'down'
  return 'flat'
}

function mapSignalItem(item) {
  const status = item.status || 'muted'
  return {
    id: item.id || '',
    name: item.name || '',
    value: item.value != null ? String(item.value) : '—',
    status,
    statusLabel: item.statusLabel || (status === 'ok' ? '正常' : status === 'warn' ? '关注' : status === 'danger' ? '告警' : '持平'),
    reason: item.reason || '',
    lampClass: item.lampClass || (status === 'ok' ? SIGNAL.successPulse : status === 'warn' ? SIGNAL.warn : status === 'danger' ? SIGNAL.error : LAMP.muted),
    tone: statusTone(status),
    target: signalTarget(item.id)
  }
}

function signalTarget(id) {
  const map = {
    revenue_mom: 'revenue',
    refund_rate: 'structure',
    new_users_mom: 'users',
    store_ledger: 'stores',
    deposit_backlog: 'funnel',
    commission_reverse: 'funnel',
    low_stock: 'stock',
    pledge_1pct: 'revenue'
  }
  return map[id] || 'revenue'
}

function buildVerdictFromSignals(items, meta) {
  const list = Array.isArray(items) ? items : []
  let danger = 0
  let warn = 0
  let ok = 0
  list.forEach((s) => {
    if (s.status === 'danger') danger += 1
    else if (s.status === 'warn') warn += 1
    else if (s.status === 'ok') ok += 1
  })

  let tone = 'flat'
  let label = '平稳'
  let className = LAMP.muted
  let title = '经营大致平稳'
  if (danger > 0) {
    tone = 'down'
    label = '偏弱'
    className = SIGNAL.errorPulse
    title = '健康度偏弱，优先看告警项'
  } else if (warn > 0) {
    tone = 'warn'
    label = '需关注'
    className = SIGNAL.warnPulse
    title = '整体尚可，有指标需留意'
  } else if (ok >= 4) {
    tone = 'up'
    label = '健康'
    className = SIGNAL.successPulse
    title = '经营健康向好'
  } else if (ok > 0) {
    tone = 'up'
    label = '良好'
    className = SIGNAL.successPulse
    title = '关键信号良好'
  }

  const highlights = list
    .filter((s) => s.status === 'danger' || s.status === 'warn' || (s.status === 'ok' && s.id === 'revenue_mom'))
    .slice(0, 4)
    .map((s) => `${s.name} ${s.value}${s.reason ? `（${s.reason}）` : ''}`)

  return {
    tone,
    label,
    className,
    title,
    insight: highlights.length
      ? `${highlights.join('；')}。`
      : meta.grandFmt
        ? `本期综合营收 ¥${meta.grandFmt}。`
        : '数据加载后将生成健康度摘要。',
    updatedAt: meta.updatedAt || ''
  }
}

function currentYearMonth() {
  return storeLedger.getCurrentYearMonth ? storeLedger.getCurrentYearMonth() : (() => {
    const n = new Date()
    return `${n.getFullYear()}-${pad2(n.getMonth() + 1)}`
  })()
}

function prevYearMonth(ym) {
  const parts = String(ym || currentYearMonth()).split('-').map((x) => parseInt(x, 10))
  const y = parts[0] || new Date().getFullYear()
  const m = parts[1] || new Date().getMonth() + 1
  const d = new Date(y, m - 2, 1)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`
}

function monthLabel(ym) {
  if (storeLedger.formatMonthLabel) return storeLedger.formatMonthLabel(ym)
  const m = String(ym || '').match(/^(\d{4})-(\d{2})$/)
  return m ? `${m[1]}年${parseInt(m[2], 10)}月` : String(ym || '')
}

Page({
  data: {
    ready: false,
    entered: false,
    numPulse: false,
    loading: false,
    bootHint: '校验权限中…',
    staffName: '',
    canFinance: false,
    canAnalytics: false,
    rangeType: 'days',
    rangeDays: 30,
    rangeKey: '30',
    rangeLabel: '近30日',
    rangeTabs: [
      { key: '7', label: '近7日' },
      { key: '30', label: '近30日' },
      { key: '90', label: '近90日' },
      { key: 'month', label: '自然月' }
    ],
    monthKey: '',
    monthLabel: '',
    monthCurrent: '',
    monthPrev: '',
    monthMax: '',
    monthPickerOpen: false,
    legendOpen: false,
    notesOpen: false,
    sectionOpen: {
      trend: true,
      structure: true,
      funnel: true,
      users: false,
      stock: false
    },
    verdict: {
      tone: 'flat',
      label: '—',
      className: 'lamp-muted',
      title: '研判准备中',
      insight: '正在汇总经营健康度…',
      updatedAt: ''
    },
    signalBoard: {
      items: [],
      summary: { ok: 0, warn: 0, danger: 0, muted: 0 },
      rulesNote: ''
    },
    headline: {
      grandFmt: '—',
      netOnlineFmt: '—',
      offlineFmt: '—',
      refundFmt: '—',
      gmvPaidFmt: '—',
      paidOrders: '—',
      aovFmt: '—',
      newUsers: '—',
      avgDau: '—',
      empty: false
    },
    channelMix: [],
    ledgerByStore: [],
    sourceMix: [],
    categoryMix: [],
    charts: {
      revenue: [],
      revenueEmpty: true,
      newUsers: [],
      newUsersEmpty: true,
      hint: ''
    },
    chartLayout: computeChartLayout(7),
    deposit: {
      available: false,
      depositPaid: 0,
      awaiting: 0,
      settled: 0,
      forfeited: 0,
      paidAmtFmt: '—',
      forfeitedAmtFmt: '—'
    },
    commission: {
      available: false,
      earnFmt: '—',
      reverseFmt: '—',
      netFmt: '—',
      earnCount: 0,
      topArtisans: []
    },
    users: {
      newUsers: 0,
      uv: 0,
      pv: 0,
      d1: '—',
      d7: '—',
      dauSource: ''
    },
    stock: {
      onShelf: 0,
      offShelf: 0,
      stockTotal: 0,
      lowStock: 0
    },
    notes: [],
    /** 仅财务权限时的账本兜底视图 */
    financeOnly: false,
    finance: {
      netFmt: '—',
      byStore: [],
      empty: false
    }
  },

  onLoad() {
    if (!guardManagerPage()) return
    this._refreshSeq = 0
    this._animSeq = 0
    this.bootstrap()
  },

  onUnload() {
    clearTimeout(this._numPulseTimer)
  },

  onPullDownRefresh() {
    Promise.resolve(this.refreshAll({ force: true })).finally(() => wx.stopPullDownRefresh())
  },

  pulseNumbers() {
    this.setData({ numPulse: true })
    clearTimeout(this._numPulseTimer)
    this._numPulseTimer = setTimeout(() => this.setData({ numPulse: false }), 420)
  },

  toggleLegend() {
    this.setData({ legendOpen: !this.data.legendOpen })
  },

  toggleNotes() {
    this.setData({ notesOpen: !this.data.notesOpen })
  },

  toggleSection(e) {
    const key = String((e.currentTarget.dataset || {}).key || '')
    if (!key || !Object.prototype.hasOwnProperty.call(this.data.sectionOpen, key)) return
    this.setData({ [`sectionOpen.${key}`]: !this.data.sectionOpen[key] })
  },

  onSignalTap(e) {
    const target = String((e.currentTarget.dataset || {}).target || '')
    const map = {
      revenue: { id: 'anchor-revenue', open: null },
      stores: { id: 'anchor-stores', open: null },
      structure: { id: 'anchor-structure', open: 'structure' },
      funnel: { id: 'anchor-funnel', open: 'funnel' },
      users: { id: 'anchor-users', open: 'users' },
      stock: { id: 'anchor-stock', open: 'stock' }
    }
    const spec = map[target]
    if (!spec) return
    if (spec.open && !this.data.sectionOpen[spec.open]) {
      this.setData({ [`sectionOpen.${spec.open}`]: true })
    }
    const runScroll = () => {
      wx.createSelectorQuery()
        .in(this)
        .select(`#${spec.id}`)
        .boundingClientRect()
        .selectViewport()
        .scrollOffset()
        .exec((res) => {
          const rect = res && res[0]
          const viewport = res && res[1]
          if (!rect || !viewport) return
          const top = Math.max(0, viewport.scrollTop + rect.top - 24)
          wx.pageScrollTo({ scrollTop: top, duration: 280 })
        })
    }
    setTimeout(runScroll, spec.open ? 60 : 0)
  },

  async bootstrap() {
    const role = await guardInvestorWorkspace()
    if (!role) return
    const canFinance = hasPermission(role, 'viewInvestorFinance') || !!role.isSuperAdmin
    const canAnalytics = hasPermission(role, 'viewInvestorAnalytics') || !!role.isSuperAdmin
    const cur = currentYearMonth()
    this.setData({
      ready: true,
      staffName: role.name || '',
      canFinance,
      canAnalytics,
      financeOnly: canFinance && !canAnalytics,
      monthKey: cur,
      monthLabel: monthLabel(cur),
      monthCurrent: cur,
      monthPrev: prevYearMonth(cur),
      monthMax: cur,
      rangeLabel: '近30日',
      bootHint: '加载经营数据…'
    })
    setTimeout(() => this.setData({ entered: true }), 30)
    this.refreshAll()
  },

  setRange(e) {
    const key = String((e.currentTarget.dataset || {}).key || '30')
    if (key === 'month') {
      const cur = this.data.monthKey || currentYearMonth()
      this.setData({
        rangeType: 'month',
        rangeKey: 'month',
        rangeLabel: monthLabel(cur),
        monthKey: cur,
        monthLabel: monthLabel(cur),
        monthPickerOpen: true,
        entered: false,
        legendOpen: false
      })
      setTimeout(() => this.setData({ entered: true }), 20)
      this.refreshAll({ force: true })
      return
    }
    const days = key === '7' ? 7 : key === '90' ? 90 : 30
    if (this.data.rangeType === 'days' && this.data.rangeDays === days) return
    this.setData({
      rangeType: 'days',
      rangeKey: String(days),
      rangeDays: days,
      rangeLabel: `近${days}日`,
      monthPickerOpen: false,
      entered: false,
      legendOpen: false
    })
    setTimeout(() => this.setData({ entered: true }), 20)
    this.refreshAll({ force: true })
  },

  setMonthPreset(e) {
    const preset = String((e.currentTarget.dataset || {}).preset || 'current')
    const ym = preset === 'prev' ? this.data.monthPrev : this.data.monthCurrent
    if (this.data.rangeType === 'month' && this.data.monthKey === ym) return
    this.setData({
      rangeType: 'month',
      rangeKey: 'month',
      monthKey: ym,
      monthLabel: monthLabel(ym),
      rangeLabel: monthLabel(ym),
      monthPickerOpen: true
    })
    this.refreshAll({ force: true })
  },

  onMonthPick(e) {
    const raw = (e.detail && e.detail.value) || ''
    const ym = String(raw).slice(0, 7)
    if (!/^\d{4}-\d{2}$/.test(ym)) return
    if (this.data.rangeType === 'month' && this.data.monthKey === ym) return
    this.setData({
      rangeType: 'month',
      rangeKey: 'month',
      monthKey: ym,
      monthLabel: monthLabel(ym),
      rangeLabel: monthLabel(ym),
      monthPickerOpen: true
    })
    this.refreshAll({ force: true })
  },

  buildRangePayload() {
    if (this.data.rangeType === 'month') {
      return {
        action: 'report',
        rangeType: 'month',
        yearMonth: this.data.monthKey || currentYearMonth()
      }
    }
    return {
      action: 'report',
      rangeType: 'days',
      days: this.data.rangeDays || 30
    }
  },

  async refreshAll(opts) {
    const force = !!(opts && opts.force)
    if (this._refreshing && !force) return this._refreshPromise
    const seq = ++this._refreshSeq
    this._animSeq = seq
    this._refreshing = true
    this.setData({ loading: true })
    const run = async () => {
      try {
        if (this.data.canAnalytics) {
          await this.loadDashboard(seq)
        } else if (this.data.canFinance) {
          await this.loadFinanceOnly(seq)
        }
        if (seq !== this._refreshSeq) return
        this.pulseNumbers()
      } finally {
        if (seq === this._refreshSeq) {
          this._refreshing = false
          this.setData({ loading: false })
        }
      }
    }
    this._refreshPromise = run()
    return this._refreshPromise
  },

  async loadDashboard(seq) {
    try {
      const res = await wx.cloud.callFunction({
        name: 'getAnalyticsDashboard',
        data: this.buildRangePayload()
      })
      if (seq !== this._refreshSeq) return
      const result = (res && res.result) || {}
      if (!result.success) {
        // 大盘失败：有财务权限则降级账本
        if (this.data.canFinance) {
          await this.loadFinanceOnly(seq)
          wx.showToast({ title: '大盘暂不可用，已显示账本', icon: 'none' })
        } else {
          wx.showToast({ title: result.msg || '加载失败', icon: 'none' })
        }
        return
      }
      const d = result.data || {}
      const headline = d.headline || {}
      const orders = d.orders || {}
      const totals = orders.totals || {}
      const mix = totals.mix || {}
      const users = d.users || {}
      const catalog = d.catalog || {}
      const deposit = d.deposit || {}
      const commission = d.commission || {}
      const category = d.category || {}
      const range = d.range || users.range || {}
      const signalsPack = d.signals || d.trafficLights || {}
      const signalItems = (Array.isArray(signalsPack.items) ? signalsPack.items : Array.isArray(signalsPack) ? signalsPack : []).map(mapSignalItem)

      const ledgerRaw = d.ledgerByStore || orders.ledgerByStore || headline.ledgerByStore || []
      const ledgerByStore = (ledgerRaw || []).map((row, i) => {
        const p = Number(row.pct) || 0
        return {
          storeId: row.storeId || row.key || String(i),
          name: row.name || row.label || row.storeId || '',
          valueFmt: row.valueFmt || money(row.value || 0),
          pct: p,
          barStyle: row.barStyle || `width:${Math.max(0, Math.min(100, p))}%`,
          tone: i === 0 ? 'brass' : 'forest'
        }
      })

      const channelMix = buildShareMix(
        [
          { key: 'online', label: '线上净额', value: Number(headline.netOnline != null ? headline.netOnline : totals.netOnline) || 0, valueFmt: headline.netOnlineFmt || totals.netOnlineFmt },
          { key: 'offline', label: '双店账本', value: Number(headline.offlineLedger != null ? headline.offlineLedger : totals.offlineLedger) || 0, valueFmt: headline.offlineLedgerFmt || totals.offlineLedgerFmt }
        ],
        ['brass', 'forest']
      )
      const sourceMix = buildShareMix(
        [
          { key: 'commerce', label: '普通零售', value: Number(mix.commerce) || 0, valueFmt: mix.commerceFmt },
          { key: 'gift', label: '礼赠', value: Number(mix.gift) || 0, valueFmt: mix.giftFmt },
          { key: 'deposit', label: '定金单', value: Number(mix.deposit) || 0, valueFmt: mix.depositFmt },
          { key: 'deposit_balance', label: '尾款', value: Number(mix.depositBalance) || 0, valueFmt: mix.depositBalanceFmt },
          { key: 'custom', label: '定制', value: Number(mix.custom) || 0, valueFmt: mix.customFmt }
        ],
        ['brass', 'gold', 'forest']
      )
      const categoryMix = (category.byType || []).map((row, i) => {
        const p = Number(row.pct) || 0
        return {
          key: row.key || row.label || String(i),
          label: row.label || row.key || '',
          valueFmt: row.valueFmt || money(row.value || 0),
          pct: p,
          barStyle: row.barStyle || `width:${Math.max(0, Math.min(100, p))}%`,
          tone: 'brass'
        }
      })

      const spanDays = Number(range.days) || (this.data.rangeType === 'month' ? 31 : this.data.rangeDays) || 7
      const maxBars = spanDays > 30 ? 12 : spanDays > 7 ? 14 : 7
      const daily = downsampleSeries(orders.daily || [], maxBars)
      const revenueSeries = daily.map((row) => {
        const online = Math.max(0, Number(row.netOnline != null ? row.netOnline : row.gmvPaid) || 0)
        const offline = Math.max(0, Number(row.offlineLedger) || 0)
        return {
          dateKey: row.dateKey,
          label: row.label || (row.dateKey || '').slice(5),
          online,
          offline,
          total: online + offline
        }
      })
      const revBuilt = buildStackedBars(revenueSeries, shortMoney)
      const nuSeries = downsampleSeries(users.newUsersByDay || [], maxBars).map((row) => ({
        dateKey: row.dateKey,
        label: row.label || (row.dateKey || '').slice(5),
        count: Number(row.count) || 0
      }))
      const nuBuilt = buildBars(nuSeries, 'count', shortCount)

      const grandFmt = headline.grandTotalFmt || totals.grandTotalFmt || money(headline.grandTotal || totals.grandTotal || 0)
      const empty = !(Number(headline.grandTotal) || Number(totals.grandTotal) || Number(totals.gmvPaid) || Number(totals.offlineLedger))

      const rangeLabel =
        range.startDate && range.endDate
          ? `${String(range.startDate).slice(5)} → ${String(range.endDate).slice(5)}`
          : this.data.rangeType === 'month'
            ? this.data.monthLabel
            : `近${this.data.rangeDays}日`

      const verdict = buildVerdictFromSignals(signalItems, {
        grandFmt,
        updatedAt: formatClock(new Date())
      })

      const topArtisans = (commission.topArtisans || []).map((row, i) => {
        const p = Number(row.pct) || 0
        return {
          key: row.key || row.label || String(i),
          label: row.label || row.key || '',
          valueFmt: row.valueFmt || money(row.value || 0),
          pct: p,
          barStyle: row.barStyle || `width:${Math.max(0, Math.min(100, p))}%`
        }
      })

      const depCounts = deposit.counts || {}
      this.setData({
        financeOnly: false,
        rangeLabel,
        chartLayout: revBuilt.layout,
        verdict,
        signalBoard: {
          items: signalItems,
          summary: signalsPack.summary || { ok: 0, warn: 0, danger: 0, muted: 0 },
          rulesNote: signalsPack.rulesNote || '环比为周期前后半日均；退款≥8%黄/≥15%红；定金待尾款≥40%/60%；提成冲回≥20%/40%；低库存≥1/≥8；双店空账或单店≥90%关注'
        },
        headline: {
          grandFmt,
          netOnlineFmt: headline.netOnlineFmt || totals.netOnlineFmt || money(0),
          offlineFmt: headline.offlineLedgerFmt || totals.offlineLedgerFmt || money(0),
          refundFmt: headline.refundAmountFmt || totals.refundAmountFmt || money(0),
          gmvPaidFmt: headline.gmvPaidFmt || totals.gmvPaidFmt || money(0),
          paidOrders: String(headline.paidOrders != null ? headline.paidOrders : totals.paid || 0),
          aovFmt: headline.aovFmt || totals.aovFmt || '—',
          newUsers: String(headline.newUsers != null ? headline.newUsers : users.totalNewUsers || 0),
          avgDau: String(headline.avgDau != null ? headline.avgDau : users.avgDau || 0),
          empty
        },
        channelMix,
        ledgerByStore,
        sourceMix,
        categoryMix,
        charts: {
          revenue: revBuilt.bars.map((b) => ({ ...b, styleOnline: 'height: 0%', styleOffline: 'height: 0%' })),
          revenueEmpty: revBuilt.empty,
          newUsers: nuBuilt.bars.map((b) => ({ ...b, styleOnline: 'height: 0%' })),
          newUsersEmpty: nuBuilt.empty,
          hint: (orders.daily || []).length > maxBars ? `趋势已按约 ${maxBars} 段聚合，合计仍为全日明细` : ''
        },
        deposit: {
          available: deposit.available !== false,
          depositPaid: Number(depCounts.deposit_paid) || 0,
          awaiting: Number(depCounts.awaiting_balance) || 0,
          settled: Number(deposit.settledCount != null ? deposit.settledCount : depCounts.settled) || 0,
          forfeited: Number(depCounts.forfeited_open) || 0,
          paidAmtFmt: deposit.paidDepositAmountFmt || money(0),
          forfeitedAmtFmt: deposit.forfeitedAmountFmt || money(0)
        },
        commission: {
          available: commission.available !== false,
          earnFmt: commission.earnTotalFmt || money(0),
          reverseFmt: commission.reverseTotalFmt || money(0),
          netFmt: commission.netTotalFmt || money(0),
          earnCount: commission.earnCount || 0,
          topArtisans
        },
        users: {
          newUsers: users.totalNewUsers || 0,
          uv: (users.behaviorSummary && users.behaviorSummary.uniqueUsers) || 0,
          pv: (users.behaviorSummary && users.behaviorSummary.pageViews) || 0,
          d1: users.retention && users.retention.d1Rate != null ? `${users.retention.d1Rate}%` : '—',
          d7: users.retention && users.retention.d7Rate != null ? `${users.retention.d7Rate}%` : '—',
          dauSource: users.dauSource || ''
        },
        stock: {
          onShelf: (catalog.counts && catalog.counts.onShelf) || 0,
          offShelf: (catalog.counts && catalog.counts.offShelf) || 0,
          stockTotal: (catalog.counts && catalog.counts.stockTotal) || 0,
          lowStock: (catalog.counts && catalog.counts.lowStockSkus) || 0
        },
        notes: Array.isArray(d.notes) ? d.notes.slice(0, 8) : []
      })

      if (!revBuilt.empty) animateBars(this, 'charts.revenue', revBuilt.bars, true)
      if (!nuBuilt.empty) setTimeout(() => animateBars(this, 'charts.newUsers', nuBuilt.bars, false), 80)
    } catch (e) {
      if (seq !== this._refreshSeq) return
      console.warn('investor dashboard', e)
      if (this.data.canFinance) {
        await this.loadFinanceOnly(seq)
      } else {
        wx.showToast({ title: '加载失败', icon: 'none' })
      }
    }
  },

  async loadFinanceOnly(seq) {
    const range = this._financeDateRange()
    try {
      const res = await wx.cloud.callFunction({
        name: 'syncFinanceData',
        data: {
          action: 'sum_month_store_ledger',
          storeId: 'all',
          dualStore: true,
          startDate: range.startDate,
          endDate: range.endDate,
          persist: false
        }
      })
      if (seq !== this._refreshSeq) return
      let r = (res && res.result) || {}
      if (!r.success) {
        const ym = range.startDate.slice(0, 7)
        const [fbMain, fbXc] = await Promise.all([
          storeLedger.sumMonthOffline(DEFAULT_STORE_ID, ym),
          storeLedger.sumMonthOffline(XINGCHEN_STORE_ID, ym).catch(() => ({ total: 0 }))
        ])
        const mainVal = Number(fbMain.total) || 0
        const xcVal = Number(fbXc.total) || 0
        const total = mainVal + xcVal
        r = {
          success: true,
          netAmount: total,
          byStore: [
            { storeId: DEFAULT_STORE_ID, name: '山川造物', value: mainVal, pct: pct(mainVal, total) },
            { storeId: XINGCHEN_STORE_ID, name: '星宸标本', value: xcVal, pct: pct(xcVal, total) }
          ]
        }
      }
      const net = Number(r.netAmount != null ? r.netAmount : r.total) || 0
      const byStore = (r.byStore || []).map((s, i) => {
        const p = Number(s.pct) || 0
        return {
          storeId: s.storeId,
          name: s.name || s.storeId,
          valueFmt: s.valueFmt || money(s.value),
          pct: p,
          barStyle: `width:${Math.max(p > 0 ? 4 : 0, Math.min(100, p))}%`,
          tone: i === 0 ? 'brass' : 'forest'
        }
      })
      this.setData({
        financeOnly: true,
        rangeLabel: this.data.rangeType === 'month' ? this.data.monthLabel : `近${this.data.rangeDays}日`,
        verdict: {
          tone: net > 0 ? 'up' : 'flat',
          label: net > 0 ? '有数' : '空账',
          className: net > 0 ? SIGNAL.successPulse : LAMP.muted,
          title: '仅账本权限视图',
          insight: `双店账本净额 ¥${money(net)}。开通大盘权限后可看综合营收与信号灯。`,
          updatedAt: formatClock(new Date())
        },
        signalBoard: { items: [], summary: { ok: 0, warn: 0, danger: 0, muted: 0 }, rulesNote: '' },
        headline: {
          grandFmt: money(net),
          netOnlineFmt: '—',
          offlineFmt: money(net),
          refundFmt: money(r.refundAmount || 0),
          gmvPaidFmt: '—',
          paidOrders: String(r.totalOrderCount || 0),
          aovFmt: r.avgOrderPrice ? `¥${money(r.avgOrderPrice)}` : '—',
          newUsers: '—',
          avgDau: '—',
          empty: net <= 0
        },
        channelMix: [],
        ledgerByStore: byStore,
        sourceMix: [],
        categoryMix: [],
        charts: { revenue: [], revenueEmpty: true, newUsers: [], newUsersEmpty: true, hint: '' },
        deposit: { available: false, depositPaid: 0, awaiting: 0, settled: 0, forfeited: 0, paidAmtFmt: '—', forfeitedAmtFmt: '—' },
        commission: { available: false, earnFmt: '—', reverseFmt: '—', netFmt: '—', earnCount: 0, topArtisans: [] },
        notes: ['当前为账本只读视图：综合营收暂等于双店账本净额。', '综合营收完整口径 = 线上净额 + 双店账本（需大盘权限）。'],
        finance: { netFmt: money(net), byStore, empty: net <= 0 }
      })
    } catch (e) {
      if (seq !== this._refreshSeq) return
      console.warn('investor finance only', e)
      wx.showToast({ title: '账本加载失败', icon: 'none' })
    }
  },

  _financeDateRange() {
    if (this.data.rangeType === 'month') {
      const ym = this.data.monthKey || currentYearMonth()
      return storeLedger.getMonthDateRange(ym)
    }
    const days = this.data.rangeDays || 30
    const end = new Date()
    const endDate = `${end.getFullYear()}-${pad2(end.getMonth() + 1)}-${pad2(end.getDate())}`
    const start = new Date(end.getTime())
    start.setDate(start.getDate() - (days - 1))
    const startDate = `${start.getFullYear()}-${pad2(start.getMonth() + 1)}-${pad2(start.getDate())}`
    return { startDate, endDate }
  }
})
