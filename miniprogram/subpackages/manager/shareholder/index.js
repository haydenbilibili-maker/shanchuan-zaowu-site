/**
 * 股东观测台 · SHAREHOLDER OBSERVATORY
 * 信息架构：信号灯 → 核心分成/回本 → 图表 → 明细/口径
 */
const { guardManagerPage } = require('../../../utils/managerAuth')
const { guardShareholderWorkspace } = require('../utils/staffAuth')
const { SIGNAL, LAMP } = require('../utils/signalLamp')

function pad2(n) {
  return String(n).padStart(2, '0')
}

function currentYearMonth() {
  const n = new Date()
  return `${n.getFullYear()}-${pad2(n.getMonth() + 1)}`
}

function prevYearMonth(ym) {
  const parts = String(ym || currentYearMonth()).split('-').map((x) => parseInt(x, 10))
  const y = parts[0] || new Date().getFullYear()
  const m = parts[1] || new Date().getMonth() + 1
  const d = new Date(y, m - 2, 1)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`
}

function monthLabel(ym) {
  const m = String(ym || '').match(/^(\d{4})-(\d{2})$/)
  return m ? `${m[1]}年${parseInt(m[2], 10)}月` : String(ym || '')
}

function formatClock(d) {
  const t = d instanceof Date ? d : new Date()
  return `${pad2(t.getHours())}:${pad2(t.getMinutes())}`
}

function shortMoney(n) {
  const v = Number(n) || 0
  const abs = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  if (abs >= 10000) return `${sign}${(abs / 10000).toFixed(1).replace(/\.0$/, '')}万`
  if (abs >= 1000) return `${sign}${(abs / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return `${sign}${Math.round(abs)}`
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
    const num = Math.abs(Number(v) || 0)
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

function buildBars(series, valueKey, formatFn) {
  const rows = Array.isArray(series) ? series : []
  const values = rows.map((r) => Number(r[valueKey] != null ? r[valueKey] : r.value) || 0)
  const peak = Math.max(0, ...values.map((v) => Math.abs(v)), 0)
  const scale = peak > 0 ? peak : 1
  const layout = computeChartLayout(rows.length)
  const labels = pickLabelIndices(values, layout.narrow)
  const bars = rows.map((r, i) => {
    const total = values[i]
    const abs = Math.abs(total)
    const h = abs > 0 ? Math.max(6, Math.round((abs / scale) * 100)) : peak > 0 ? 0 : 2
    const rawLabel = r.label || r.day || (r.dateKey || r.date || '').slice(5) || ''
    return {
      key: r.dateKey || r.date || String(i),
      day: rawLabel,
      styleOnline: 'height: 0%',
      styleOnlineTarget: `height: ${h}%`,
      heightPct: h,
      negative: total < 0,
      showVal: labels.has(i) && abs > 0,
      valShort: formatFn(total)
    }
  })
  return { bars, layout, empty: !rows.length || peak <= 0 }
}

function buildShareMix(items) {
  const list = (items || []).filter((x) => Number(x.value) > 0)
  const total = list.reduce((s, x) => s + (Number(x.value) || 0), 0)
  const tones = ['brass', 'forest']
  return list.map((x, i) => {
    const value = Number(x.value) || 0
    const p = total > 0 ? Math.round((value / total) * 1000) / 10 : 0
    return {
      key: x.key || x.label || String(i),
      label: x.label || x.key || '',
      value,
      valueFmt: x.valueFmt || shortMoney(value),
      pct: p,
      tone: tones[i % tones.length],
      barStyle: `width:${Math.max(p > 0 ? 4 : 0, Math.min(100, p))}%`
    }
  })
}

function animateBars(page, path, bars) {
  const zeroed = (bars || []).map((b) => ({
    ...b,
    styleOnline: 'height: 0%'
  }))
  page.setData({ [path]: zeroed })
  setTimeout(() => {
    if (page._refreshSeq !== page._animSeq) return
    const raised = (bars || []).map((b) => ({
      ...b,
      styleOnline: b.styleOnlineTarget || `height: ${b.heightPct || 0}%`
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
    target: item.target || signalTarget(item.id)
  }
}

function signalTarget(id) {
  const map = {
    payback_progress: 'equity',
    period_dividend: 'equity',
    margin_health: 'period',
    target_attain: 'period',
    mall_pressure: 'mall',
    store_revenue: 'charts'
  }
  return map[id] || 'equity'
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
  let title = '权益大致平稳'
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
    title = '股东权益信号向好'
  } else if (ok > 0) {
    tone = 'up'
    label = '良好'
    className = SIGNAL.successPulse
    title = '关键信号良好'
  }

  const highlights = list
    .filter((s) => s.status === 'danger' || s.status === 'warn' || (s.status === 'ok' && s.id === 'payback_progress'))
    .slice(0, 4)
    .map((s) => `${s.name} ${s.value}${s.reason ? `（${s.reason}）` : ''}`)

  return {
    tone,
    label,
    className,
    title,
    insight: highlights.length
      ? `${highlights.join('；')}。`
      : meta.personalFmt
        ? `累计应得分成 ¥${meta.personalFmt}。`
        : '数据加载后将生成健康度摘要。',
    updatedAt: meta.updatedAt || ''
  }
}

Page({
  data: {
    ready: false,
    entered: false,
    loading: false,
    numPulse: false,
    bootHint: '校验权限中…',
    staffName: '',
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
    legendOpen: false,
    notesOpen: false,
    chartTab: 'revenue',
    chartTabs: [
      { key: 'revenue', label: '营收' },
      { key: 'profit', label: '净利' },
      { key: 'personal', label: '个人分成' }
    ],
    profile: {
      storeName: '—',
      ownershipRatio: 0,
      dividendRatio: 0,
      dividendRatioBeforePayback: 0,
      dividendRatioAfterPayback: 0,
      capitalContributionFmt: '—',
      effectiveDate: ''
    },
    equity: {
      statusLabel: '计算中',
      statusTone: 'warn',
      personalDividendFmt: '—',
      personalRoiPct: 0,
      personalRoiBar: 'width:0%',
      poolRoiPct: 0,
      poolRoiBar: 'width:0%',
      leftPersonalFmt: '—',
      paybackDate: '—',
      poolDividendFmt: '—',
      opDividendFmt: '—',
      currentInvestorSharePct: 0,
      currentOpSharePct: 0,
      personalPoolSharePct: 0,
      personalPoolShareBeforePct: 0,
      personalPoolShareAfterPct: 0,
      earlySharePct: 0,
      lateSharePct: 0
    },
    period: {
      revenueFmt: '—',
      profitFmt: '—',
      marginPct: 0,
      targetPct: 0,
      personalDividendFmt: '—',
      mallShareFmt: '—',
      mall: null
    },
    health: { grade: '—', text: '—', suggestion: '' },
    reportTitle: '股东汇报摘要',
    purchases: {
      count: 0,
      amountFmt: '—',
      recent: []
    },
    signalBoard: {
      items: [],
      summary: { ok: 0, warn: 0, danger: 0, muted: 0 },
      rulesNote: ''
    },
    verdict: {
      tone: 'flat',
      label: '—',
      className: 'lamp-muted',
      title: '研判准备中',
      insight: '',
      updatedAt: ''
    },
    charts: {
      revenue: [],
      profit: [],
      personal: [],
      revenueEmpty: true,
      profitEmpty: true,
      personalEmpty: true,
      structure: [],
      payback: {
        personalPct: 0,
        poolPct: 0,
        personalBar: 'width:0%',
        poolBar: 'width:0%'
      },
      hint: '',
      empty: true
    },
    chartLayout: computeChartLayout(7),
    notes: [],
    empty: false
  },

  onLoad() {
    if (!guardManagerPage()) return
    const ym = currentYearMonth()
    this.setData({
      monthKey: ym,
      monthLabel: monthLabel(ym),
      monthCurrent: ym,
      monthPrev: prevYearMonth(ym),
      monthMax: ym
    })
    this.bootstrap()
  },

  onUnload() {
    clearTimeout(this._numPulseTimer)
  },

  onPullDownRefresh() {
    Promise.resolve(this.refresh()).finally(() => wx.stopPullDownRefresh())
  },

  async bootstrap() {
    const role = await guardShareholderWorkspace()
    if (!role) return
    this.setData({
      ready: true,
      bootHint: '汇总股东权益…',
      staffName: role.name || ''
    })
    setTimeout(() => this.setData({ entered: true }), 40)
    await this.refresh()
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

  setChartTab(e) {
    const key = String((e.currentTarget.dataset || {}).key || '')
    if (!key || key === this.data.chartTab) return
    this.setData({ chartTab: key })
    const path = `charts.${key}`
    const bars = this.data.charts[key] || []
    if (bars.length) {
      this._animSeq = (this._refreshSeq || 0)
      animateBars(this, path, bars.map((b) => ({
        ...b,
        styleOnlineTarget: b.styleOnlineTarget || `height: ${b.heightPct || 0}%`
      })))
    }
  },

  setRange(e) {
    const key = String((e.currentTarget.dataset || {}).key || '')
    if (!key || key === this.data.rangeKey) return
    if (key === 'month') {
      this.setData({
        rangeKey: 'month',
        rangeType: 'month',
        rangeLabel: this.data.monthLabel || '自然月'
      })
    } else {
      const days = parseInt(key, 10) || 30
      this.setData({
        rangeKey: key,
        rangeType: 'days',
        rangeDays: days,
        rangeLabel: `近${days}日`
      })
    }
    this.refresh()
  },

  setMonthPreset(e) {
    const preset = String((e.currentTarget.dataset || {}).preset || '')
    const ym = preset === 'prev' ? this.data.monthPrev : this.data.monthCurrent
    this.setData({
      monthKey: ym,
      monthLabel: monthLabel(ym),
      rangeKey: 'month',
      rangeType: 'month',
      rangeLabel: monthLabel(ym)
    })
    this.refresh()
  },

  onMonthPick(e) {
    const ym = String((e.detail && e.detail.value) || '')
    if (!ym) return
    this.setData({
      monthKey: ym,
      monthLabel: monthLabel(ym),
      rangeKey: 'month',
      rangeType: 'month',
      rangeLabel: monthLabel(ym)
    })
    this.refresh()
  },

  onSignalTap(e) {
    const target = String((e.currentTarget.dataset || {}).target || '')
    const map = {
      equity: 'anchor-equity',
      period: 'anchor-period',
      mall: 'anchor-mall',
      charts: 'anchor-charts'
    }
    const id = map[target]
    if (!id) return
    wx.createSelectorQuery()
      .in(this)
      .select(`#${id}`)
      .boundingClientRect()
      .selectViewport()
      .scrollOffset()
      .exec((res) => {
        const rect = res && res[0]
        const scroll = res && res[1]
        if (!rect || !scroll) return
        wx.pageScrollTo({
          scrollTop: Math.max(0, scroll.scrollTop + rect.top - 24),
          duration: 280
        })
      })
  },

  async refresh() {
    if (this._loading) return
    this._loading = true
    this._refreshSeq = (this._refreshSeq || 0) + 1
    const seq = this._refreshSeq
    this.setData({ loading: true })
    try {
      const payload = {
        action: 'dashboard',
        rangeType: this.data.rangeType
      }
      if (this.data.rangeType === 'month') {
        payload.monthKey = this.data.monthKey
      } else {
        payload.rangeDays = this.data.rangeDays
      }
      const res = await wx.cloud.callFunction({
        name: 'getShareholderObservatory',
        data: payload
      })
      if (seq !== this._refreshSeq) return
      const result = (res && res.result) || {}
      if (!result.success) {
        wx.showToast({ title: result.msg || '加载失败', icon: 'none' })
        this.setData({ empty: true })
        return
      }
      this.applyDashboard(result)
    } catch (e) {
      console.warn('shareholder refresh', e)
      wx.showToast({ title: '股东观测台加载失败', icon: 'none' })
    } finally {
      this._loading = false
      this.setData({ loading: false })
    }
  },

  applyDashboard(result) {
    const profile = result.profile || {}
    const equity = result.equity || {}
    const period = result.period || {}
    const settings = result.settings || {}
    const health = result.health || {}
    const range = result.range || {}
    const purchases = result.purchases || {}
    const chartsRaw = result.charts || {}
    const personalRoi = Number(equity.personalRoiPct) || 0
    const poolRoi = Number(equity.poolRoiPct) || 0

    const signalsPack = result.signals || result.trafficLights || {}
    const signalItems = (Array.isArray(signalsPack.items)
      ? signalsPack.items
      : Array.isArray(signalsPack) ? signalsPack : []
    ).map(mapSignalItem)

    const verdict = buildVerdictFromSignals(signalItems, {
      personalFmt: equity.personalDividendFmt,
      updatedAt: formatClock(new Date())
    })

    const legacySeries = Array.isArray(result.series) ? result.series : []
    const revSeries = (chartsRaw.revenue && chartsRaw.revenue.length)
      ? chartsRaw.revenue
      : legacySeries.map((r) => ({ dateKey: r.date, date: r.date, label: r.label, value: r.revenue }))
    const profitSeries = (chartsRaw.profit && chartsRaw.profit.length)
      ? chartsRaw.profit
      : legacySeries.map((r) => ({ dateKey: r.date, date: r.date, label: r.label, value: r.profit }))
    const personalSeries = (chartsRaw.personal && chartsRaw.personal.length)
      ? chartsRaw.personal
      : legacySeries.map((r) => ({ dateKey: r.date, date: r.date, label: r.label, value: r.personal }))
    const revBuilt = buildBars(revSeries, 'value', shortMoney)
    const profitBuilt = buildBars(profitSeries, 'value', shortMoney)
    const personalBuilt = buildBars(personalSeries, 'value', shortMoney)
    const structure = buildShareMix(chartsRaw.structure || [])
    const payback = chartsRaw.payback || {}
    const personalPct = Math.min(100, Math.max(0, Number(payback.personalPct != null ? payback.personalPct : personalRoi) || 0))
    const poolPct = Math.min(100, Math.max(0, Number(payback.poolPct != null ? payback.poolPct : poolRoi) || 0))

    const layout = revBuilt.layout.narrow
      ? revBuilt.layout
      : (profitBuilt.bars.length >= revBuilt.bars.length ? profitBuilt.layout : revBuilt.layout)

    this._animSeq = this._refreshSeq
    this.setData({
      empty: !!(chartsRaw.empty) && !(Number(period.revenue) > 0),
      staffName: profile.name || this.data.staffName,
      rangeLabel: range.label || this.data.rangeLabel,
      profile: {
        storeName: profile.storeName || '—',
        ownershipRatio: profile.ownershipRatio || 0,
        dividendRatio: profile.dividendRatio || profile.dividendRatioBeforePayback || 0,
        dividendRatioBeforePayback: profile.dividendRatioBeforePayback != null
          ? profile.dividendRatioBeforePayback
          : (profile.dividendRatio || 0),
        dividendRatioAfterPayback: profile.dividendRatioAfterPayback != null
          ? profile.dividendRatioAfterPayback
          : (profile.dividendRatioBeforePayback != null
            ? profile.dividendRatioBeforePayback
            : (profile.dividendRatio || 0)),
        capitalContributionFmt: equity.personalCapitalFmt || '—',
        effectiveDate: profile.effectiveDate || ''
      },
      equity: {
        statusLabel: equity.statusLabel || '—',
        statusTone: equity.status === 'paid_back' ? 'ok' : 'warn',
        personalDividendFmt: equity.personalDividendFmt || '—',
        personalRoiPct: personalRoi,
        personalRoiBar: `width:${Math.min(100, Math.max(0, personalRoi))}%`,
        poolRoiPct: poolRoi,
        poolRoiBar: `width:${Math.min(100, Math.max(0, poolRoi))}%`,
        leftPersonalFmt: equity.leftPersonalFmt || '—',
        paybackDate: equity.paybackDate || '—',
        poolDividendFmt: equity.poolDividendFmt || '—',
        opDividendFmt: equity.opDividendFmt || '—',
        currentInvestorSharePct: equity.currentInvestorSharePct || 0,
        currentOpSharePct: equity.currentOpSharePct || 0,
        personalPoolSharePct: equity.personalPoolSharePct || 0,
        personalPoolShareBeforePct: equity.personalPoolShareBeforePct || 0,
        personalPoolShareAfterPct: equity.personalPoolShareAfterPct || 0,
        earlySharePct: settings.earlySharePct || 0,
        lateSharePct: settings.lateSharePct || 0
      },
      period: {
        revenueFmt: period.revenueFmt || '—',
        profitFmt: period.profitFmt || '—',
        marginPct: period.marginPct || 0,
        targetPct: period.targetPct || 0,
        personalDividendFmt: period.personalDividendFmt || '—',
        mallShareFmt: period.mallShareFmt || '—',
        mall: period.mall || null
      },
      purchases: {
        count: Number(purchases.count) || 0,
        amountFmt: purchases.amountFmt || '0.00',
        recent: Array.isArray(purchases.recent) ? purchases.recent : []
      },
      health: {
        grade: health.grade || '—',
        text: health.text || '—',
        suggestion: health.suggestion || ''
      },
      reportTitle: (result.report && result.report.title) || '股东汇报摘要',
      signalBoard: {
        items: signalItems,
        summary: signalsPack.summary || { ok: 0, warn: 0, danger: 0, muted: 0 },
        rulesNote: signalsPack.rulesNote || '回本/分成/净利率/目标/商场抽成/门店营收 · 绿正常 · 黄关注 · 红告警'
      },
      verdict,
      charts: {
        revenue: revBuilt.bars,
        profit: profitBuilt.bars,
        personal: personalBuilt.bars,
        revenueEmpty: revBuilt.empty,
        profitEmpty: profitBuilt.empty,
        personalEmpty: personalBuilt.empty,
        structure,
        payback: {
          personalPct,
          poolPct,
          personalBar: `width:${personalPct}%`,
          poolBar: `width:${poolPct}%`,
          personalDividendFmt: payback.personalDividendFmt || equity.personalDividendFmt || '—',
          personalCapitalFmt: payback.personalCapitalFmt || equity.personalCapitalFmt || '—',
          leftPersonalFmt: payback.leftPersonalFmt || equity.leftPersonalFmt || '—'
        },
        hint: chartsRaw.hint || '',
        empty: !!chartsRaw.empty
      },
      chartLayout: layout,
      notes: Array.isArray(result.notes) ? result.notes : []
    })

    this.pulseNumbers()
    if (!revBuilt.empty) animateBars(this, 'charts.revenue', revBuilt.bars)
    if (!profitBuilt.empty) setTimeout(() => animateBars(this, 'charts.profit', profitBuilt.bars), 60)
    if (!personalBuilt.empty) setTimeout(() => animateBars(this, 'charts.personal', personalBuilt.bars), 120)
  }
})
