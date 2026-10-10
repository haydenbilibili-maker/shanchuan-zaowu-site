/**
 * 出货中心：开单 · 单据 · 总览 · 资料（店长只读）。蓝图 admin/docs/出货中心_融合_2026-09-28.md
 * 账本 ops_shipments（manageStoreShipment）；旧 shipment-sku 为重定向壳。开单 / 资料见 ./parts。
 */
const { guardStaffPage } = require('../utils/staffAuth')
const { formatCloudFnError } = require('../utils/memberScan')
const { SHIPMENT_FN, callCloud, money, sheetBodyPx, materialLine } = require('./parts/shared')
const createPart = require('./parts/create')
const libraryPart = require('./parts/library')
const skusPart = require('./parts/skus')
const memosPart = require('./parts/memos')

const TAB_STORAGE_KEY = 'shipment_center_tab_v1'
const TAB_ALIAS = { sku: 'create', create: 'create', entry: 'create', list: 'list', overview: 'overview', library: 'library', master: 'library', skus: 'library' }

const STATUS_TONE = {
  draft: 'muted',
  confirmed: 'brass',
  pending: 'brass',
  shipped: 'ok',
  received: 'ok',
  completed: 'ok',
  cancelled: 'muted'
}

const SETTLE_TONE = {
  unsettled: 'warn',
  paid_pending: 'brass',
  settled: 'ok'
}

const ENTRY_PATH_LABEL = {
  sku: 'SKU开单',
  paste: '粘贴解析',
  single: '单条录入'
}

const SOURCE_TONE = {
  feishu: 'feishu',
  erp: 'erp',
  manual: 'muted'
}

function moneySigned(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return '0'
  const t = Math.abs(v).toLocaleString('zh-CN', { maximumFractionDigits: 2 })
  return v < 0 ? `-${t}` : t
}

function withPct(list, mode) {
  const rows = Array.isArray(list) ? list : []
  const max = Math.max(
    1,
    ...rows.map((r) => (mode === 'count' ? Number(r.count) || 0 : Number(r.amount) || Number(r.count) || 0))
  )
  return rows.map((r) => {
    const amount = Number(r.amount) || 0
    const count = Number(r.count) || 0
    const base = mode === 'count' ? count : amount || count
    return {
      key: r.key || r.label,
      label: r.label || r.key || '',
      amount,
      count,
      amountText: mode === 'count' ? String(count) : amount ? money(amount) : String(count),
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

function deltaText(pct) {
  if (pct == null || !Number.isFinite(Number(pct))) return ''
  const v = Number(pct)
  const sign = v > 0 ? '+' : ''
  return `${sign}${v}%`
}

function toneOf(v) {
  if (v == null) return 'flat'
  const n = Number(v)
  return n < 0 ? 'down' : n > 0 ? 'up' : 'flat'
}

const baseData = {
  ready: false,
  isSuper: false,
  canWrite: true,
  activeTab: 'list',
  tabs: [],
  tipTone: 'info',
  tipText: '',
  sheetBodyPx: 420,

  loading: false,
  dashLoading: false,
  dashError: false,
  listError: false,
  removePendingId: '',

  stores: [],
  storeNames: [],
  keyword: '',
  filterOpen: false,
  storeFilter: '',
  storeFilterIndex: 0,
  storeFilterNames: ['全部门店'],
  storeFilterIds: [''],
  statusFilter: 'all',
  statusFilterIndex: 0,
  statusFilterNames: ['全部状态'],
  statusFilterValues: ['all'],
  sourceFilter: 'all',
  sourceFilterIndex: 0,
  sourceFilterNames: ['全部来源'],
  sourceFilterValues: ['all'],
  dateFrom: '',
  dateTo: '',
  statuses: [],
  sources: [],
  list: [],
  summary: { count: 0, totalQty: 0, itemCount: 0, byStore: [] },
  statusQuick: '',
  listTip: '',
  listTipTone: 'info',
  /** 写入后高亮的新单 id（金边 + 「新」角标，置顶） */
  highlightIds: {},
  showAgain: false,

  showDetail: false,
  detail: null,
  detailBusy: false,
  detailTip: '',
  detailTipTone: 'info',
  shipForm: { expressCompany: '', trackingNo: '' },
  nextActions: [],

  sourceOpen: false,
  legendOpen: false,
  detailOpen: false,
  sectionOpen: { customers: true, stores: false, status: false },
  listMore: { customers: false },
  sourceNote: '',
  verdict: null,
  signalBoard: { items: [], summary: { ok: 0, warn: 0, danger: 0 }, rulesNote: '' },
  kpis: null,
  completeness: null,
  structure: [],
  trend: [],
  trendCount: [],
  trendMode: 'empty',
  trendSingle: null,
  trendNote: '',
  charts: { byCustomer: [], byCustomerView: [], byCustomerMore: 0, byStore: [], byStatus: [] },
  dashLoaded: false
}

const coreMethods = {
  _keywordTimer: null,

  async onLoad(options) {
    const opts = options || {}
    const role = await guardStaffPage('manager')
    if (!role) return
    this.setData({ ready: true, isSuper: !!(role.superAdmin || role.isSuperAdmin), sheetBodyPx: sheetBodyPx() })
    await this.loadMeta()
    this.applyTab(this.pickInitialTab(opts), { mode: opts.mode, view: opts.tab === 'skus' ? 'sku' : opts.view, persist: false })
    if (this.data.activeTab !== 'list') this.loadList()
  },

  onShow() {
    if (this.consumeEditReturn) this.consumeEditReturn()
  },

  onUnload() {
    if (this._keywordTimer) clearTimeout(this._keywordTimer)
  },

  onPullDownRefresh() {
    const tab = this.data.activeTab
    const tasks = []
    if (tab === 'overview') tasks.push(this.loadDashboard(), this.loadList())
    else if (tab === 'library') tasks.push(this.data.libView === 'sku' ? this.loadSkuCatalog() : this.loadLibrary())
    else tasks.push(this.loadList())
    Promise.all(tasks).finally(() => wx.stopPullDownRefresh())
  },

  /** 页签可见性：开单需可写 */
  visibleTabs() {
    const tabs = []
    if (this.data.canWrite) tabs.push({ key: 'create', label: '开单' })
    tabs.push({ key: 'list', label: '单据' }, { key: 'overview', label: '总览' }, { key: 'library', label: this.data.isSuper ? 'SKU' : '资料' })
    return tabs
  },

  /** ?tab= 优先 → 上次停留 → 超管默认开单 / 店长默认单据；无权的页签回落到单据 */
  pickInitialTab(opts) {
    let tab = TAB_ALIAS[String((opts && opts.tab) || '').trim()] || ''
    if (!tab) {
      try {
        tab = TAB_ALIAS[String(wx.getStorageSync(TAB_STORAGE_KEY) || '')] || ''
      } catch (e) {
        tab = ''
      }
    }
    if (!tab) tab = this.data.isSuper && this.data.canWrite ? 'create' : 'list'
    const keys = this.visibleTabs().map((t) => t.key)
    return keys.indexOf(tab) !== -1 ? tab : 'list'
  },

  applyTab(want, opts) {
    const o = opts || {}
    const tab = this.visibleTabs().some((t) => t.key === want) ? want : 'list'
    this.setData({ activeTab: tab })
    if (o.persist !== false) {
      try {
        wx.setStorageSync(TAB_STORAGE_KEY, tab)
      } catch (e) {
        /* 记不住上次页签不影响使用 */
      }
    }
    if (tab === 'list') this.loadList()
    else if (tab === 'overview' && !this.data.dashLoaded) this.loadDashboard()
    else if (tab === 'create') this.enterCreate(o.mode)
    else if (tab === 'library') this.enterLibrary(o.view)
  },

  switchTab(e) {
    const tab = String((e.currentTarget.dataset || {}).tab || '')
    if (!tab || tab === this.data.activeTab) return
    const mode = String((e.currentTarget.dataset || {}).mode || '')
    this.applyTab(tab, { mode })
  },

  formatTime(ts) {
    const n = Number(ts)
    if (!Number.isFinite(n) || n <= 0) return '—'
    const d = new Date(n)
    const pad = (x) => String(x).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  },

  async loadMeta() {
    try {
      const result = await callCloud(SHIPMENT_FN, { action: 'meta' })
      const stores = result.stores || []
      const statuses = result.statuses || []
      const sources = result.sources || []
      const categories = result.categories || [
        { value: '工具', label: '工具' },
        { value: '藏品', label: '藏品' }
      ]
      const entryStatuses = (statuses.length ? statuses : [{ value: 'confirmed', label: '已确认' }]).filter(
        (s) => s.value !== 'cancelled'
      )
      const confirmedIdx = Math.max(0, entryStatuses.findIndex((s) => s.value === 'confirmed'))
      this.setData({
        stores,
        storeNames: stores.map((s) => s.name),
        statuses,
        sources,
        canWrite: result.canWrite !== false,
        isSuper: !!result.isSuper || this.data.isSuper,
        storeFilterNames: ['全部门店'].concat(stores.map((s) => s.name)),
        storeFilterIds: [''].concat(stores.map((s) => s.id)),
        statusFilterNames: ['全部状态'].concat(statuses.map((s) => s.label)),
        statusFilterValues: ['all'].concat(statuses.map((s) => s.value)),
        sourceFilterNames: ['全部来源'].concat(sources.map((s) => s.label)),
        sourceFilterValues: ['all'].concat(sources.map((s) => s.value)),
        formCategoryNames: ['不选'].concat(categories.map((c) => c.label || c.value)),
        formCategoryValues: [''].concat(categories.map((c) => c.value)),
        formStatusNames: entryStatuses.map((s) => s.label),
        formStatusValues: entryStatuses.map((s) => s.value),
        formStatusIndex: confirmedIdx
      })
    } catch (e) {
      this.setData({ tipTone: 'warn', tipText: formatCloudFnError(e, '元数据未能取回') })
    }
    this.setData({ tabs: this.visibleTabs() })
  },

  // 总览（观测台，原样保留）

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
      patch.sectionOpen = { customers: true, stores: false, status: false }
      patch.listMore = { customers: false }
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
    const list = Array.isArray(charts.byCustomer) ? charts.byCustomer : []
    if (listMore.customers || list.length <= 5) {
      this.setData({ 'charts.byCustomerView': list, 'charts.byCustomerMore': 0 })
    } else {
      this.setData({ 'charts.byCustomerView': list.slice(0, 5), 'charts.byCustomerMore': list.length - 5 })
    }
  },

  async loadDashboard() {
    this.setData({ dashLoading: true, dashError: false })
    try {
      const result = await callCloud(SHIPMENT_FN, { action: 'dashboard', storeId: this.data.storeFilter || undefined })
      const k = result.kpis || {}
      const charts = result.charts || {}
      const signalsPack = result.signals || {}
      const items = Array.isArray(signalsPack.items) ? signalsPack.items : []
      const verdictRaw = result.verdict || signalsPack.verdict || {}
      const completeness = charts.completeness || {}
      const okPct = Number(completeness.okPct)
      const okBar = Number.isFinite(okPct) ? Math.max(0, Math.min(100, Math.round(okPct))) : 0
      const trendRows = charts.shipmentTrend || []

      this.setData({
        dashLoaded: true,
        dashError: false,
        sourceNote: result.sourceNote || '',
        verdict: {
          title: verdictRaw.title || '出货总览',
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
        kpis: {
          shipmentCount: k.shipmentCount || 0,
          revenueText: money(k.revenueTotal),
          customerCount: k.customerCount || 0,
          monthCount: k.monthCount || 0,
          monthAmountText: money(k.monthAmount),
          monthDeltaText: deltaText(k.monthDeltaPct),
          monthDeltaTone: toneOf(k.monthDeltaPct),
          netProfitText: moneySigned(k.netProfit),
          netProfitTone: Number(k.netProfit) < 0 ? 'down' : Number(k.netProfit) > 0 ? 'up' : 'flat',
          purchaseTotalText: money(k.purchaseTotal),
          hasPurchaseSample: !!k.hasPurchaseSample,
          topShareText: k.topSharePct != null ? `${k.topSharePct}%` : '—'
        },
        completeness: {
          okPctText: Number.isFinite(okPct) ? `${okPct}%` : '—',
          okBar,
          tone: !Number.isFinite(okPct) ? 'flat' : okPct < 60 ? 'down' : okPct < 85 ? 'warn' : 'up',
          incompleteText:
            completeness.incompleteCount != null ? `${completeness.incompleteCount}/${completeness.total || 0}` : '—',
          zeroAmountPctText: completeness.zeroAmountPct != null ? `${completeness.zeroAmountPct}%` : '—'
        },
        structure: (charts.categoryStructure || []).map((s) => ({
          key: s.key,
          label: s.label,
          amountText: money(s.amount),
          pct: s.pct,
          widthPct: s.widthPct || Math.max(2, Math.round(s.pct || 0)),
          tone: s.tone || 'used'
        })),
        trend: withPct(trendRows),
        trendCount: withPct(trendRows, 'count'),
        trendMode: !trendRows.length ? 'empty' : trendRows.length === 1 ? 'single' : 'multi',
        trendNote: charts.trendNote || '',
        trendSingle:
          trendRows.length === 1
            ? {
                label: trendRows[0].label || trendRows[0].key || '',
                amountText: money(trendRows[0].amount),
                count: Number(trendRows[0].count) || 0
              }
            : null,
        charts: {
          byCustomer: withPct(charts.byCustomer),
          byCustomerView: [],
          byCustomerMore: 0,
          byStore: withPct(charts.byStore),
          byStatus: withPct(charts.byStatus, 'count')
        }
      })
      this.refreshListViews()
    } catch (e) {
      // 失败保留上次 KPI，勿伪装空盘
      this.setData({ dashError: true, tipTone: 'warn', tipText: formatCloudFnError(e, '观测台未能展开') })
    } finally {
      this.setData({ dashLoading: false })
    }
  },

  onRetryDash() {
    this.loadDashboard()
  },

  // 单据

  decorateRow(row) {
    const next = ((this.data.statuses || []).find((s) => s.value === row.status) || {}).next || []
    const nextActions = next.map((v) => {
      const s = (this.data.statuses || []).find((x) => x.value === v)
      return { value: v, label: s ? s.label : v }
    })
    return Object.assign({}, row, {
      statusTone: STATUS_TONE[row.status] || 'muted',
      sourceTone: SOURCE_TONE[row.source] || 'muted',
      settleTone: SETTLE_TONE[row.settleStatus] || 'muted',
      settleLabel: row.settleLabel || '',
      pricingIncomplete: row.pricingStatus === 'incomplete',
      amountText: row.totalAmount ? money(row.totalAmount) : '',
      customerLine: row.customerName || row.storeName || '',
      items: (row.items || []).map((it) => Object.assign({}, it, { matLine: materialLine(it) })),
      itemsPreview: (row.items || [])
        .slice(0, 3)
        .map((it) => `${it.itemName}-${it.qty}`)
        .join('、'),
      moreItems: Math.max(0, (row.items || []).length - 3),
      updatedAtText: this.formatTime(row.updatedAt),
      canTransit: next.length > 0,
      nextActions,
      entryPathLabel: ENTRY_PATH_LABEL[row.entryPath] || '',
      logisticsText:
        row.expressCompany || row.trackingNo ? `${row.expressCompany || '快递'} ${row.trackingNo || ''}`.trim() : ''
    })
  },

  /** 新单置顶（稳定分区，其余顺序不变） */
  pinHighlighted(list) {
    const hl = this.data.highlightIds || {}
    if (!Object.keys(hl).length) return list
    return list.filter((r) => hl[r._id]).concat(list.filter((r) => !hl[r._id]))
  },

  async loadList() {
    // 不清空 ok 成功条：写入后要靠它告诉用户「已进单据列表」
    const keepOkTip = this.data.listTipTone === 'ok' && this.data.listTip
    this.setData({ loading: true, listError: false, removePendingId: '' })
    try {
      const result = await callCloud(SHIPMENT_FN, {
        action: 'list',
        storeId: this.data.storeFilter || undefined,
        status: this.data.statusFilter,
        source: this.data.sourceFilter,
        keyword: this.data.keyword || undefined,
        dateFrom: this.data.dateFrom || undefined,
        dateTo: this.data.dateTo || undefined,
        limit: 80
      })
      const list = this.pinHighlighted((result.list || []).map((row) => this.decorateRow(row)))
      const patch = {
        list,
        listError: false,
        summary: result.summary || { count: 0, totalQty: 0, itemCount: 0, byStore: [] },
        canWrite: result.canWrite !== false
      }
      if (!keepOkTip) {
        patch.listTip = ''
        patch.listTipTone = 'info'
      }
      this.setData(patch)
      this.loadMemoCounts()
      return { ok: true, list, summary: patch.summary }
    } catch (e) {
      // 失败保留上次列表，勿伪装空柜
      const msg = formatCloudFnError(e, '出货单未能展开')
      this.setData({ listError: true, listTip: msg, listTipTone: 'warn' })
      return { ok: false, msg, list: this.data.list || [] }
    } finally {
      this.setData({ loading: false })
    }
  },

  onRetryList() {
    this.loadList()
  },

  summarizeRows(rows) {
    const list = Array.isArray(rows) ? rows : []
    const byStoreMap = {}
    let totalQty = 0
    let itemCount = 0
    for (const row of list) {
      totalQty += Number(row.totalQty) || 0
      itemCount += (row.items || []).length || Number(row.itemCount) || 0
      const sid = row.storeId || row.storeName || ''
      if (!byStoreMap[sid]) {
        byStoreMap[sid] = { storeId: sid, storeName: row.storeName || row.customerName || sid, totalQty: 0 }
      }
      byStoreMap[sid].totalQty += Number(row.totalQty) || 0
    }
    return { count: list.length, totalQty, itemCount, byStore: Object.keys(byStoreMap).map((k) => byStoreMap[k]) }
  },

  /**
   * 写入成功统一收口：切单据 → 放开筛选 → 刷新 → 新单高亮置顶 + 成功条。
   * 不回退（2026-09-24）：先 limit 再滤日期会藏新单；空态勿把成功 tip 显示成加载失败。
   */
  async revealAfterWrite(opts) {
    const o = opts || {}
    const tip = String(o.msg || '已写入出货单').trim() || '已写入出货单'
    const shipmentDate = String(o.shipmentDate || '').trim()
    const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(shipmentDate)
    const created = Array.isArray(o.created) ? o.created : []
    const highlightIds = {}
    created.forEach((row) => {
      if (row && row._id) highlightIds[row._id] = true
    })
    this.setData({
      activeTab: 'list',
      highlightIds,
      showAgain: this.data.canWrite,
      filterOpen: false,
      statusQuick: '',
      statusFilter: 'all',
      statusFilterIndex: 0,
      sourceFilter: 'all',
      sourceFilterIndex: 0,
      keyword: '',
      dateFrom: dateOk ? shipmentDate : '',
      dateTo: dateOk ? shipmentDate : '',
      listTip: tip,
      listTipTone: 'ok'
    })
    let loaded = await this.loadList()
    // 若按出货日筛仍空：放开日期再刷（兼容旧云函数「limit 后滤日期」）
    if (loaded && loaded.ok && !(loaded.list || []).length && created.length && dateOk) {
      this.setData({ dateFrom: '', dateTo: '' })
      loaded = await this.loadList()
    }
    if (loaded && !loaded.ok) {
      // 真失败：保留 warn；有刚写入的单则乐观展示
      if (created.length) {
        const seeded = created.map((row) => this.decorateRow(row))
        this.setData({
          list: seeded,
          summary: this.summarizeRows(seeded),
          listTip: `${tip}（列表刷新失败：${loaded.msg || '未知错误'}；已展示刚写入单据）`,
          listTipTone: 'warn'
        })
      }
    } else if (!(this.data.list || []).length && created.length) {
      const seeded = created.map((row) => this.decorateRow(row))
      this.setData({ list: seeded, summary: this.summarizeRows(seeded), listTip: `${tip}（已展示刚写入单据）`, listTipTone: 'ok' })
    } else {
      this.setData({ listTip: tip, listTipTone: 'ok' })
    }
    this.setData({ dashLoaded: false })
    try {
      wx.pageScrollTo({ scrollTop: 0, duration: 180 })
    } catch (e) {
      /* ignore */
    }
  },

  /** 成功条上的「再开一单」：回开单页签（保持原模式） */
  onCreateAgain() {
    this.setData({ showAgain: false, listTip: '', highlightIds: {} })
    this.applyTab('create')
  },

  toggleFilter() {
    this.setData({ filterOpen: !this.data.filterOpen })
  },

  onStoreFilter(e) {
    const idx = parseInt(e.detail.value, 10) || 0
    this.setData({ storeFilterIndex: idx, storeFilter: this.data.storeFilterIds[idx] || '' })
    this.loadList()
    if (this.data.activeTab === 'overview') this.loadDashboard()
    else this.setData({ dashLoaded: false })
  },

  onStatusFilter(e) {
    const idx = parseInt(e.detail.value, 10) || 0
    const value = this.data.statusFilterValues[idx] || 'all'
    this.setData({ statusFilterIndex: idx, statusFilter: value, statusQuick: value === 'all' ? '' : value })
    this.loadList()
  },

  onSourceFilter(e) {
    const idx = parseInt(e.detail.value, 10) || 0
    this.setData({ sourceFilterIndex: idx, sourceFilter: this.data.sourceFilterValues[idx] || 'all' })
    this.loadList()
  },

  onKeywordInput(e) {
    const keyword = e.detail.value || ''
    this.setData({ keyword })
    if (this._keywordTimer) clearTimeout(this._keywordTimer)
    this._keywordTimer = setTimeout(() => this.loadList(), 360)
  },

  clearKeyword() {
    this.setData({ keyword: '' })
    this.loadList()
  },

  onDateFrom(e) {
    this.setData({ dateFrom: e.detail.value || '' })
    this.loadList()
  },

  onDateTo(e) {
    this.setData({ dateTo: e.detail.value || '' })
    this.loadList()
  },

  clearDates() {
    this.setData({ dateFrom: '', dateTo: '' })
    this.loadList()
  },

  onStatusQuick(e) {
    const status = String((e.currentTarget.dataset || {}).status || '')
    const values = this.data.statusFilterValues || []
    const idx = values.indexOf(status || 'all')
    this.setData({
      statusQuick: status === 'all' ? '' : status,
      statusFilter: status || 'all',
      statusFilterIndex: idx >= 0 ? idx : 0
    })
    this.loadList()
  },

  // 详情：物流 + 状态流转（契约：setStatus / update；结算只读）

  openDetail(e) {
    const id = e.currentTarget.dataset.id
    const row = (this.data.list || []).find((x) => x._id === id)
    if (!row) return
    const decorated = this.decorateRow(row)
    this.setData({
      showDetail: true,
      detail: decorated,
      nextActions: decorated.nextActions || [],
      shipForm: { expressCompany: row.expressCompany || '', trackingNo: row.trackingNo || '' },
      detailTip: '',
      detailTipTone: 'info',
      detailBusy: false
    })
  },

  closeDetail() {
    if (this.data.detailBusy) return
    this.setData({ showDetail: false, detail: null, nextActions: [], detailTip: '' })
  },

  onShipFormInput(e) {
    const field = String((e.currentTarget.dataset || {}).field || '')
    if (!field) return
    this.setData({ [`shipForm.${field}`]: e.detail.value || '' })
  },

  async applyStatus(e) {
    if (!this.data.canWrite || this.data.detailBusy) return
    const status = String((e.currentTarget.dataset || {}).status || '')
    const id = this.data.detail && this.data.detail._id
    if (!id || !status) return
    this.setData({ detailBusy: true, detailTip: '正在流转…', detailTipTone: 'info' })
    try {
      // 发货前若填了运单，先写入物流字段（既有 update 契约）
      if (status === 'shipped') {
        const expressCompany = String(this.data.shipForm.expressCompany || '').trim()
        const trackingNo = String(this.data.shipForm.trackingNo || '').trim()
        if (expressCompany || trackingNo) {
          await callCloud(SHIPMENT_FN, {
            action: 'update',
            id,
            item: {
              expressCompany,
              trackingNo,
              storeId: this.data.detail.storeId,
              shipmentDate: this.data.detail.shipmentDate,
              status: this.data.detail.status
            }
          })
        }
      }
      const res = await callCloud(SHIPMENT_FN, { action: 'setStatus', id, status })
      const item = this.decorateRow(res.item || Object.assign({}, this.data.detail, { status }))
      this.setData({
        detail: item,
        nextActions: item.nextActions || [],
        shipForm: { expressCompany: item.expressCompany || '', trackingNo: item.trackingNo || '' },
        detailTip: `已流转为「${item.statusLabel}」`,
        detailTipTone: 'info',
        detailBusy: false,
        dashLoaded: false
      })
      await this.loadList()
    } catch (err) {
      this.setData({ detailBusy: false, detailTip: formatCloudFnError(err, '流转失败'), detailTipTone: 'warn' })
    }
  },

  async saveLogistics() {
    if (!this.data.canWrite || this.data.detailBusy || !this.data.detail) return
    const id = this.data.detail._id
    const expressCompany = String(this.data.shipForm.expressCompany || '').trim()
    const trackingNo = String(this.data.shipForm.trackingNo || '').trim()
    this.setData({ detailBusy: true, detailTip: '保存物流…', detailTipTone: 'info' })
    try {
      const res = await callCloud(SHIPMENT_FN, {
        action: 'update',
        id,
        item: {
          expressCompany,
          trackingNo,
          storeId: this.data.detail.storeId,
          shipmentDate: this.data.detail.shipmentDate,
          status: this.data.detail.status,
          note: this.data.detail.note || ''
        }
      })
      const item = this.decorateRow(res.item || this.data.detail)
      this.setData({ detail: item, nextActions: item.nextActions || [], detailTip: '物流信息已保存', detailTipTone: 'info', detailBusy: false })
      await this.loadList()
    } catch (err) {
      this.setData({ detailBusy: false, detailTip: formatCloudFnError(err, '保存物流失败'), detailTipTone: 'warn' })
    }
  },

  async onRemove(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    const confirmTip = '再点一次「删除」：删除后列表不再展示（软删）'
    if (this.data.removePendingId !== id) {
      this.setData({ removePendingId: id, listTip: confirmTip, listTipTone: 'warn', detailTip: confirmTip, detailTipTone: 'warn' })
      return
    }
    this.setData({ removePendingId: '' })
    try {
      await callCloud(SHIPMENT_FN, { action: 'remove', id })
      this.setData({ listTip: '已删除', listTipTone: 'ok', detailTip: '', dashLoaded: false })
      this.closeDetail()
      await this.loadList()
    } catch (err) {
      const msg = formatCloudFnError(err, '删除失败')
      this.setData({ listTip: msg, listTipTone: 'warn', detailTip: msg, detailTipTone: 'warn' })
    }
  },

  noop() {}
}

Page(
  Object.assign(
    { data: Object.assign({}, baseData, createPart.data, libraryPart.data, skusPart.data, memosPart.data) },
    coreMethods,
    createPart.methods,
    libraryPart.methods,
    skusPart.methods,
    memosPart.methods
  )
)
