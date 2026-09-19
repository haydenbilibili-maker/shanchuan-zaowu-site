/**
 * 工作室仪表盘 — 超管（getStudioDashboard）
 * 信号灯 + 预算进度 / 结构占比 / 采购趋势
 */
const { guardStaffPage } = require('../utils/staffAuth')
const { formatCloudFnError } = require('../utils/memberScan')

const FN = 'getStudioDashboard'

function money(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return '0'
  return v.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}

function moneySigned(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return '0'
  const t = Math.abs(v).toLocaleString('zh-CN', { maximumFractionDigits: 2 })
  return v < 0 ? `-${t}` : t
}

function withPct(list) {
  const rows = Array.isArray(list) ? list : []
  const max = Math.max(1, ...rows.map((r) => Number(r.amount) || Number(r.count) || 0))
  return rows.map((r) => {
    const amount = Number(r.amount) || 0
    const count = Number(r.count) || 0
    const base = amount || count
    return {
      key: r.key || r.label,
      label: r.label || r.key || '',
      amount,
      count,
      amountText: amount ? money(amount) : String(count),
      pct: Math.round((base / max) * 100)
    }
  })
}

function formatUpdatedAt(ts) {
  const n = Number(ts) || 0
  if (!n) return ''
  const d = new Date(n)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (x) => (x < 10 ? `0${x}` : String(x))
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

Page({
  data: {
    ready: false,
    loading: false,
    sourceOpen: false,
    legendOpen: false,
    detailOpen: false,
    sectionOpen: {
      purchase: true,
      stock: true,
      share: true,
      customers: false,
      pools: false
    },
    listMore: {
      budgetType: false,
      category: false,
      customers: false,
      pools: false
    },
    sourceNote: '',
    namingLines: [],
    verdict: null,
    signalBoard: {
      items: [],
      summary: { ok: 0, warn: 0, danger: 0 },
      rulesNote: ''
    },
    progress: null,
    structure: [],
    trend: [],
    trendMode: 'empty',
    trendSingle: null,
    trendNote: '',
    kpis: null,
    purchaseRows: [],
    stockRows: [],
    charts: {
      budgetTypeShare: [],
      budgetTypeShareView: [],
      budgetTypeShareMore: 0,
      purchaseByCategory: [],
      purchaseByCategoryView: [],
      purchaseByCategoryMore: 0,
      shipmentByCustomer: [],
      shipmentByCustomerView: [],
      shipmentByCustomerMore: 0
    },
    pools: [],
    poolsView: [],
    poolsMore: 0
  },

  async onLoad() {
    const role = await guardStaffPage('super_admin')
    if (!role) return
    this.setData({ ready: true })
    await this.load()
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh())
  },

  toggleSource() {
    this.setData({ sourceOpen: !this.data.sourceOpen })
  },

  toggleLegend() {
    this.setData({ legendOpen: !this.data.legendOpen })
  },

  toggleDetail() {
    const next = !this.data.detailOpen
    const patch = { detailOpen: next }
    if (next) {
      patch.sectionOpen = {
        purchase: true,
        stock: true,
        share: true,
        customers: false,
        pools: false
      }
      patch.listMore = {
        budgetType: false,
        category: false,
        customers: false,
        pools: false
      }
    }
    this.setData(patch, () => {
      if (next) this.refreshListViews()
    })
  },

  toggleSection(e) {
    const key = String((e.currentTarget.dataset || {}).key || '')
    if (!key) return
    const sectionOpen = Object.assign({}, this.data.sectionOpen)
    sectionOpen[key] = !sectionOpen[key]
    this.setData({ sectionOpen })
  },

  toggleListMore(e) {
    const key = String((e.currentTarget.dataset || {}).key || '')
    if (!key) return
    const listMore = Object.assign({}, this.data.listMore)
    listMore[key] = !listMore[key]
    this.setData({ listMore }, () => this.refreshListViews())
  },

  refreshListViews() {
    const charts = this.data.charts || {}
    const listMore = this.data.listMore || {}
    const pools = this.data.pools || []
    const take = (rows, open, n) => {
      const list = Array.isArray(rows) ? rows : []
      if (open || list.length <= n) {
        return { view: list, more: 0 }
      }
      return { view: list.slice(0, n), more: list.length - n }
    }
    const bt = take(charts.budgetTypeShare, listMore.budgetType, 5)
    const cat = take(charts.purchaseByCategory, listMore.category, 5)
    const cust = take(charts.shipmentByCustomer, listMore.customers, 5)
    const pl = take(pools, listMore.pools, 4)
    this.setData({
      'charts.budgetTypeShareView': bt.view,
      'charts.budgetTypeShareMore': bt.more,
      'charts.purchaseByCategoryView': cat.view,
      'charts.purchaseByCategoryMore': cat.more,
      'charts.shipmentByCustomerView': cust.view,
      'charts.shipmentByCustomerMore': cust.more,
      poolsView: pl.view,
      poolsMore: pl.more
    })
  },

  async load() {
    this.setData({ loading: true })
    try {
      const res = await wx.cloud.callFunction({ name: FN, data: {} })
      const result = (res && res.result) || {}
      if (result.success === false) {
        throw new Error(formatCloudFnError(result) || result.msg || '加载失败')
      }
      const k = result.kpis || {}
      const charts = result.charts || {}
      const signalsPack = result.signals || result.trafficLights || {}
      const items = Array.isArray(signalsPack.items) ? signalsPack.items : []
      const verdictRaw = result.verdict || signalsPack.verdict || {}
      const naming = result.naming || {}
      const namingLines = []
      if (naming.finished) {
        namingLines.push(
          `成品库存 · ${naming.finished.collection} ← 飞书「${naming.finished.feishuTable}」`
        )
      }
      if (naming.raw) {
        namingLines.push(
          `原材料 · ${naming.raw.collection} ← 飞书「${naming.raw.feishuTable}」`
        )
      }
      if (naming.purchases) {
        namingLines.push(
          `采购 · ${naming.purchases.collection} ← 飞书「${naming.purchases.feishuTable || '采购记录'}」`
        )
      }
      if (naming.property) {
        namingLines.push(
          `物业成本 · 预算池口径（${naming.property.feishuTable || '物业成本'}）`
        )
      }

      const usagePct = Number(k.usagePct)
      const usageBar = Number.isFinite(usagePct)
        ? Math.max(0, Math.min(100, Math.round(usagePct)))
        : 0
      const purchNeg = Number(k.purchasableRemaining) < 0
      const remNeg = Number(k.remainingBudget) < 0

      this.setData({
        sourceNote: result.sourceNote || '',
        namingLines,
        verdict: {
          title: verdictRaw.title || '预算总览',
          label: verdictRaw.label || '—',
          tone: verdictRaw.tone || 'flat',
          className: verdictRaw.className || 'lamp-muted',
          insight: verdictRaw.insight || '',
          updatedAt: formatUpdatedAt(result.generatedAt)
        },
        signalBoard: {
          items,
          summary: signalsPack.summary || { ok: 0, warn: 0, danger: 0 },
          rulesNote: signalsPack.rulesNote || ''
        },
        progress: {
          usagePctText: Number.isFinite(usagePct) ? `${usagePct}%` : '—',
          usageBar,
          tone: k.progressTone || (purchNeg ? 'down' : 'flat'),
          usedText: money(k.usedBudget),
          totalText: money(k.totalBudget),
          remainingText: moneySigned(k.remainingBudget),
          remainingTone: remNeg ? 'down' : 'flat',
          purchasableText: moneySigned(k.purchasableRemaining),
          purchasableTone: purchNeg ? 'down' : Number(k.purchasableRemaining) <= 0 ? 'warn' : 'up',
          safetyText: money(k.safetyReserve),
          safetyTouched: !!k.safetyTouched,
          overspendText: Number(k.overspendAmount) > 0 ? money(k.overspendAmount) : ''
        },
        structure: (charts.budgetStructure || []).map((s) => ({
          key: s.key,
          label: s.label,
          amountText: money(s.amount),
          pct: s.pct,
          widthPct: s.widthPct || Math.max(2, Math.round(s.pct || 0)),
          tone: s.tone || 'used',
          isDanger: s.tone === 'danger' || s.key === 'overspend'
        })),
        trend: withPct(charts.purchaseTrend || []),
        trendMode:
          !(charts.purchaseTrend || []).length
            ? 'empty'
            : (charts.purchaseTrend || []).length === 1
              ? 'single'
              : 'multi',
        trendNote: charts.trendNote || '',
        trendSingle: (() => {
          const rows = charts.purchaseTrend || []
          if (rows.length !== 1) return null
          const r = rows[0]
          return {
            label: r.label || r.key || '',
            amountText: money(r.amount),
            count: Number(r.count) || 0
          }
        })(),
        kpis: {
          totalBudgetText: money(k.totalBudget),
          usedBudgetText: money(k.usedBudget),
          remainingBudgetText: moneySigned(k.remainingBudget),
          remainingTone: remNeg ? 'down' : 'flat',
          purchasableRemainingText: moneySigned(k.purchasableRemaining),
          purchasableTone: purchNeg ? 'down' : 'flat',
          safetyReserveText: money(k.safetyReserve),
          rentBudgetText: money(k.rentBudget),
          monthlyOpsCostText: money(k.monthlyOpsCost),
          purchaseCount: k.purchaseCount || 0,
          purchaseTotalText: money(k.purchaseTotal),
          hardwareSpendText: money(k.hardwareSpend),
          specimenSpendText: money(k.specimenMaterialsSpend),
          rawStockValueText: money(k.rawStockValue),
          finishedSkuCount: k.finishedSkuCount || 0,
          finishedQty: k.finishedQty || 0,
          revenueTotalText: money(k.revenueTotal),
          shipmentCount: k.shipmentCount || 0,
          netProfitText: moneySigned(k.netProfit),
          // 结算口径**不加在这里**：`kpis` 的这些 *Text 字段在 WXML 里没有被逐个渲染
          // （只有 totalBudgetText 等少数几个被点名使用）。加了就是没人读的死数据。
          // 结算口径统一由下面的 `stockRows` 渲染（那是通用循环，加行即显示）。
          netProfitTone: Number(k.netProfit) < 0 ? 'down' : Number(k.netProfit) > 0 ? 'up' : 'flat'
        },
        purchaseRows: [
          { label: '采购总笔数', value: String(k.purchaseCount || 0), tone: 'flat' },
          { label: '采购总额', value: money(k.purchaseTotal), tone: 'flat' },
          { label: '基础硬件（含工具）', value: money(k.hardwareSpend), tone: 'flat' },
          { label: '藏品原材料与耗材', value: money(k.specimenMaterialsSpend), tone: 'flat' },
          { label: '房租预算', value: money(k.rentBudget), tone: 'flat' },
          { label: '月度基础运营', value: money(k.monthlyOpsCost), tone: 'flat' }
        ],
        stockRows: [
          { label: '原材料库存总价值', value: money(k.rawStockValue), tone: 'flat' },
          {
            label: '成品 SKU / 件数',
            value: `${k.finishedSkuCount || 0} / ${k.finishedQty || 0}`,
            tone: 'flat'
          },
          /**
           * ⚠️ 口径改名（P0-6 的落地）：原来这里叫「总营收（出货）」。
           * 上了收款之后同一个词会被读出两种意思（发了多少货 vs 收回了多少钱），
           * 所以拆成四个数并**把口径写进标签**，不让人猜。
           */
          { label: '出货额（全部有效单据）', value: money(k.revenueTotal), tone: 'brass' },
          { label: '已结清（超管已确认收款）', value: money(k.settledAmount), tone: 'up' },
          {
            label: '未收款（未结 + 待确认）',
            value: money(k.outstandingAmount),
            tone: Number(k.outstandingAmount) > 0 ? 'brass' : 'flat'
          },
          {
            label: '待确认收款',
            value: `${k.paidPendingCount || 0} 笔 · ${money(k.paidPendingAmount)}`,
            tone: Number(k.paidPendingCount) > 0 ? 'brass' : 'flat'
          },
          { label: '出货总笔数', value: String(k.shipmentCount || 0), tone: 'flat' },
          {
            // 真毛利：出货额 −（材料费 + 包装费）。**手工费算工作室收入、不减**（裁决 20）
            label: '真毛利（出货额 − 材料 − 包装）',
            value: moneySigned(k.grossProfit) + (k.grossMarginPct === null || k.grossMarginPct === undefined ? '' : ` · ${k.grossMarginPct}%`),
            tone: Number(k.grossProfit) < 0 ? 'down' : Number(k.grossProfit) > 0 ? 'up' : 'flat'
          },
          {
            label: '净收益（出货额 − 采购，旧口径）',
            value: moneySigned(k.netProfit),
            tone: Number(k.netProfit) < 0 ? 'down' : Number(k.netProfit) > 0 ? 'up' : 'flat'
          }
        ],
        charts: {
          budgetTypeShare: withPct(charts.budgetTypeShare),
          budgetTypeShareView: [],
          budgetTypeShareMore: 0,
          purchaseByCategory: withPct(charts.purchaseByCategory),
          purchaseByCategoryView: [],
          purchaseByCategoryMore: 0,
          shipmentByCustomer: withPct(charts.shipmentByCustomer),
          shipmentByCustomerView: [],
          shipmentByCustomerMore: 0
        },
        pools: (result.pools || []).map((p) => ({
          name: p.name,
          annualText: money(p.annualAmount),
          usedText: money(p.usedAmount),
          remainingText: moneySigned(p.remainingAmount),
          remainingTone: Number(p.remainingAmount) < 0 ? 'down' : 'flat'
        })),
        poolsView: [],
        poolsMore: 0
      })
      this.refreshListViews()
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  }
})
