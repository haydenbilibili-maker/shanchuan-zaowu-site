/**
 * 门店出货单 — 主录入 + 出货观测台
 * manageStoreShipment → ops_shipments
 */
const { guardStaffPage } = require('../utils/staffAuth')
const { formatCloudFnError } = require('../utils/memberScan')

const FN = 'manageStoreShipment'

const STATUS_TONE = {
  draft: 'muted',
  confirmed: 'brass',
  shipped: 'ok',
  cancelled: 'muted'
}

const SOURCE_TONE = {
  feishu: 'feishu',
  erp: 'erp',
  manual: 'muted'
}

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

Page({
  data: {
    ready: false,
    loading: false,
    dashLoading: false,
    saving: false,
    parsing: false,
    canWrite: true,
    isSuper: false,
    activeTab: 'overview',

    keyword: '',
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
    stores: [],
    list: [],
    summary: {
      count: 0,
      totalQty: 0,
      itemCount: 0,
      byStore: []
    },
    showPaste: false,
    entryMode: 'single',
    pasteText: '',
    parsePreview: null,
    parseErrors: [],
    parseWarnings: [],
    failedLines: [],
    writebackMsg: '',
    showDetail: false,
    detail: null,

    // 单条录入
    form: {
      storeId: '',
      shipmentDate: '',
      itemName: '',
      spec: '',
      category: '',
      qty: '1',
      unitPrice: '',
      buyerName: '',
      customerName: '',
      status: 'confirmed',
      expressCompany: '',
      trackingNo: '',
      note: '',
      productId: '',
      skuId: '',
      inventoryRecordId: '',
      linkedLabel: ''
    },
    formStoreIndex: 0,
    formStoreNames: [],
    formStoreIds: [],
    formCategoryIndex: 0,
    formCategoryNames: ['不选', '工具', '藏品'],
    formCategoryValues: ['', '工具', '藏品'],
    formStatusIndex: 0,
    formStatusNames: ['已确认'],
    formStatusValues: ['confirmed'],
    formAmountPreview: '',
    skuKeyword: '',
    skuHits: [],
    skuSearching: false,

    // dashboard
    sourceOpen: false,
    legendOpen: false,
    detailOpen: false,
    sectionOpen: {
      customers: true,
      stores: false,
      status: false
    },
    listMore: {
      customers: false
    },
    sourceNote: '',
    verdict: null,
    signalBoard: {
      items: [],
      summary: { ok: 0, warn: 0, danger: 0 },
      rulesNote: ''
    },
    kpis: null,
    completeness: null,
    structure: [],
    trend: [],
    trendCount: [],
    trendMode: 'empty',
    trendSingle: null,
    trendNote: '',
    charts: {
      byCustomer: [],
      byCustomerView: [],
      byCustomerMore: 0,
      byStore: [],
      byStatus: []
    },
    dashLoaded: false
  },

  _keywordTimer: null,

  async onLoad() {
    const role = await guardStaffPage('manager')
    if (!role) return
    this.setData({ ready: true, isSuper: !!(role.superAdmin || role.isSuperAdmin) })
    await this.loadMeta()
    await Promise.all([this.loadDashboard(), this.loadList()])
  },

  onUnload() {
    if (this._keywordTimer) clearTimeout(this._keywordTimer)
  },

  onPullDownRefresh() {
    const tasks =
      this.data.activeTab === 'overview'
        ? [this.loadDashboard(), this.loadList()]
        : [this.loadList()]
    Promise.all(tasks).finally(() => wx.stopPullDownRefresh())
  },

  switchTab(e) {
    const tab = String((e.currentTarget.dataset || {}).tab || '')
    if (!tab || tab === this.data.activeTab) return
    this.setData({ activeTab: tab })
    if (tab === 'overview' && !this.data.dashLoaded) {
      this.loadDashboard()
    }
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

  formatTime(ts) {
    const n = Number(ts)
    if (!Number.isFinite(n) || n <= 0) return '—'
    const d = new Date(n)
    const pad = (x) => String(x).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  },

  decorateParsed(parsed) {
    if (!parsed) return null
    const shipments = (parsed.shipments || []).map((b) => ({
      ...b,
      collapsed: !!b.collapsed
    }))
    return {
      ...parsed,
      canWrite: !!(parsed.canWrite || (parsed.ok && shipments.length && parsed.shipmentDate)),
      shipments,
      summary: parsed.summary || {
        storeCount: shipments.length,
        itemCount: shipments.reduce((n, b) => n + (b.items || []).length, 0),
        totalQty: shipments.reduce((n, b) => n + (Number(b.totalQty) || 0), 0)
      }
    }
  },

  recomputePreviewTotals(parsePreview) {
    if (!parsePreview || !parsePreview.shipments) return parsePreview
    const shipments = parsePreview.shipments.map((b) => {
      const items = b.items || []
      const totalQty = items.reduce((n, it) => n + (Number(it.qty) || 0), 0)
      return {
        ...b,
        itemCount: items.length,
        totalQty
      }
    })
    return {
      ...parsePreview,
      shipments,
      canWrite: shipments.length > 0 && !!parsePreview.shipmentDate,
      summary: {
        shipmentDate: parsePreview.shipmentDate || '',
        storeCount: shipments.length,
        itemCount: shipments.reduce((n, b) => n + b.itemCount, 0),
        totalQty: shipments.reduce((n, b) => n + b.totalQty, 0)
      }
    }
  },

  async loadMeta() {
    try {
      const result = await this.callFn({ action: 'meta' })
      const stores = result.stores || []
      const statuses = result.statuses || []
      const sources = result.sources || []
      const categories = result.categories || [
        { value: '工具', label: '工具' },
        { value: '藏品', label: '藏品' }
      ]
      const isSuper = !!result.isSuper || this.data.isSuper
      const entryStatuses = (statuses.length
        ? statuses
        : [{ value: 'confirmed', label: '已确认' }]
      ).filter((s) => s.value !== 'cancelled')
      const confirmedIdx = Math.max(
        0,
        entryStatuses.findIndex((s) => s.value === 'confirmed')
      )
      this.setData({
        stores,
        statuses,
        sources,
        canWrite: result.canWrite !== false,
        isSuper,
        storeFilterNames: ['全部门店'].concat(stores.map((s) => s.name)),
        storeFilterIds: [''].concat(stores.map((s) => s.id)),
        statusFilterNames: ['全部状态'].concat(statuses.map((s) => s.label)),
        statusFilterValues: ['all'].concat(statuses.map((s) => s.value)),
        sourceFilterNames: ['全部来源'].concat(sources.map((s) => s.label)),
        sourceFilterValues: ['all'].concat(sources.map((s) => s.value)),
        formStoreNames: stores.map((s) => s.name),
        formStoreIds: stores.map((s) => s.id),
        formCategoryNames: ['不选'].concat(categories.map((c) => c.label || c.value)),
        formCategoryValues: [''].concat(categories.map((c) => c.value)),
        formStatusNames: entryStatuses.map((s) => s.label),
        formStatusValues: entryStatuses.map((s) => s.value),
        formStatusIndex: confirmedIdx >= 0 ? confirmedIdx : 0
      })
    } catch (e) {
      wx.showToast({ title: formatCloudFnError(e, '元数据未能取回'), icon: 'none' })
    }
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
      this.setData({
        'charts.byCustomerView': list,
        'charts.byCustomerMore': 0
      })
    } else {
      this.setData({
        'charts.byCustomerView': list.slice(0, 5),
        'charts.byCustomerMore': list.length - 5
      })
    }
  },

  async loadDashboard() {
    this.setData({ dashLoading: true })
    try {
      const result = await this.callFn({
        action: 'dashboard',
        storeId: this.data.storeFilter || undefined
      })
      const k = result.kpis || {}
      const charts = result.charts || {}
      const signalsPack = result.signals || {}
      const items = Array.isArray(signalsPack.items) ? signalsPack.items : []
      const verdictRaw = result.verdict || signalsPack.verdict || {}
      const completeness = charts.completeness || {}
      const okPct = Number(completeness.okPct)
      const okBar = Number.isFinite(okPct) ? Math.max(0, Math.min(100, Math.round(okPct))) : 0

      const trendRows = charts.shipmentTrend || []
      const trendAmount = withPct(trendRows)
      const trendCount = withPct(trendRows, 'count')

      this.setData({
        dashLoaded: true,
        sourceNote: result.sourceNote || '',
        canWrite: result.canWrite !== false,
        isSuper: result.isSuper != null ? !!result.isSuper : this.data.isSuper,
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
          monthDeltaTone:
            k.monthDeltaPct == null ? 'flat' : Number(k.monthDeltaPct) < 0 ? 'down' : Number(k.monthDeltaPct) > 0 ? 'up' : 'flat',
          amountDeltaText: deltaText(k.amountDeltaPct),
          amountDeltaTone:
            k.amountDeltaPct == null
              ? 'flat'
              : Number(k.amountDeltaPct) < 0
                ? 'down'
                : Number(k.amountDeltaPct) > 0
                  ? 'up'
                  : 'flat',
          netProfitText: moneySigned(k.netProfit),
          netProfitTone: Number(k.netProfit) < 0 ? 'down' : Number(k.netProfit) > 0 ? 'up' : 'flat',
          purchaseTotalText: money(k.purchaseTotal),
          hasPurchaseSample: !!k.hasPurchaseSample,
          topCustomerName: k.topCustomerName || '',
          topShareText: k.topSharePct != null ? `${k.topSharePct}%` : '—'
        },
        completeness: {
          okPctText: Number.isFinite(okPct) ? `${okPct}%` : '—',
          okBar,
          tone:
            okPct == null
              ? 'flat'
              : okPct < 60
                ? 'down'
                : okPct < 85
                  ? 'warn'
                  : 'up',
          incompleteText:
            completeness.incompleteCount != null
              ? `${completeness.incompleteCount}/${completeness.total || 0}`
              : '—',
          zeroAmountPctText:
            completeness.zeroAmountPct != null ? `${completeness.zeroAmountPct}%` : '—'
        },
        structure: (charts.categoryStructure || []).map((s) => ({
          key: s.key,
          label: s.label,
          amountText: money(s.amount),
          pct: s.pct,
          widthPct: s.widthPct || Math.max(2, Math.round(s.pct || 0)),
          tone: s.tone || 'used'
        })),
        trend: trendAmount,
        trendCount,
        trendMode: !trendRows.length ? 'empty' : trendRows.length === 1 ? 'single' : 'multi',
        trendNote: charts.trendNote || '',
        trendSingle: (() => {
          if (trendRows.length !== 1) return null
          const r = trendRows[0]
          return {
            label: r.label || r.key || '',
            amountText: money(r.amount),
            count: Number(r.count) || 0
          }
        })(),
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
      wx.showToast({ title: formatCloudFnError(e, '观测台未能展开'), icon: 'none' })
    } finally {
      this.setData({ dashLoading: false })
    }
  },

  async loadList() {
    this.setData({ loading: true })
    try {
      const result = await this.callFn({
        action: 'list',
        storeId: this.data.storeFilter || undefined,
        status: this.data.statusFilter,
        source: this.data.sourceFilter,
        keyword: this.data.keyword || undefined,
        dateFrom: this.data.dateFrom || undefined,
        dateTo: this.data.dateTo || undefined,
        limit: 80
      })
      const list = (result.list || []).map((row) => {
        const next = ((this.data.statuses || []).find((s) => s.value === row.status) || {}).next || []
        return {
          ...row,
          statusTone: STATUS_TONE[row.status] || 'muted',
          sourceTone: SOURCE_TONE[row.source] || 'muted',
          amountText: row.totalAmount ? money(row.totalAmount) : '',
          customerLine: row.customerName || row.storeName || '',
          itemsPreview: (row.items || [])
            .slice(0, 3)
            .map((it) => `${it.itemName}-${it.qty}`)
            .join('、'),
          moreItems: Math.max(0, (row.items || []).length - 3),
          updatedAtText: this.formatTime(row.updatedAt),
          canTransit: next.length > 0
        }
      })
      this.setData({
        list,
        summary: result.summary || { count: 0, totalQty: 0, itemCount: 0, byStore: [] },
        canWrite: result.canWrite !== false
      })
    } catch (e) {
      this.setData({
        list: [],
        summary: { count: 0, totalQty: 0, itemCount: 0, byStore: [] }
      })
      wx.showToast({ title: formatCloudFnError(e, '出货单未能展开'), icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  onStoreFilter(e) {
    const idx = parseInt(e.detail.value, 10) || 0
    this.setData({
      storeFilterIndex: idx,
      storeFilter: this.data.storeFilterIds[idx] || ''
    })
    this.loadList()
    if (this.data.activeTab === 'overview') this.loadDashboard()
  },

  onStatusFilter(e) {
    const idx = parseInt(e.detail.value, 10) || 0
    this.setData({
      statusFilterIndex: idx,
      statusFilter: this.data.statusFilterValues[idx] || 'all'
    })
    this.loadList()
  },

  onSourceFilter(e) {
    const idx = parseInt(e.detail.value, 10) || 0
    this.setData({
      sourceFilterIndex: idx,
      sourceFilter: this.data.sourceFilterValues[idx] || 'all'
    })
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

  openPaste() {
    if (!this.data.canWrite) {
      wx.showToast({ title: '当前账号仅可查看', icon: 'none' })
      return
    }
    this.setData({
      showPaste: true,
      entryMode: 'single',
      pasteText: '',
      parsePreview: null,
      parseErrors: [],
      parseWarnings: [],
      failedLines: [],
      writebackMsg: '',
      skuKeyword: '',
      skuHits: [],
      formAmountPreview: ''
    })
    this.resetSingleForm()
  },

  closePaste() {
    if (this.data.saving) return
    this.setData({ showPaste: false })
  },

  switchEntryMode(e) {
    const mode = String((e.currentTarget.dataset || {}).mode || '')
    if (!mode || mode === this.data.entryMode) return
    this.setData({ entryMode: mode })
  },

  todayStr() {
    const d = new Date()
    const pad = (x) => String(x).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  },

  blankSingleForm() {
    const storeIds = this.data.formStoreIds || []
    const storeNames = this.data.formStoreNames || []
    const statusValues = this.data.formStatusValues || ['confirmed']
    const statusIdx = Math.max(0, statusValues.indexOf('confirmed'))
    const storeId = storeIds[0] || ''
    return {
      form: {
        storeId,
        shipmentDate: this.todayStr(),
        itemName: '',
        spec: '',
        category: '',
        qty: '1',
        unitPrice: '',
        buyerName: '',
        customerName: storeNames[0] || '',
        status: statusValues[statusIdx] || 'confirmed',
        expressCompany: '',
        trackingNo: '',
        note: '',
        productId: '',
        skuId: '',
        inventoryRecordId: '',
        linkedLabel: ''
      },
      formStoreIndex: 0,
      formCategoryIndex: 0,
      formStatusIndex: statusIdx >= 0 ? statusIdx : 0,
      formAmountPreview: '',
      skuKeyword: '',
      skuHits: []
    }
  },

  resetSingleForm() {
    this.setData(this.blankSingleForm())
  },

  refreshFormAmountPreview() {
    const form = this.data.form || {}
    const qty = Number(form.qty)
    const price = Number(form.unitPrice)
    if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price) || price < 0) {
      this.setData({ formAmountPreview: '' })
      return
    }
    const total = Math.round(qty * price * 100) / 100
    this.setData({ formAmountPreview: money(total) })
  },

  onFormInput(e) {
    const field = String((e.currentTarget.dataset || {}).field || '')
    if (!field) return
    this.setData({ [`form.${field}`]: e.detail.value || '' }, () => {
      if (field === 'qty' || field === 'unitPrice') this.refreshFormAmountPreview()
    })
  },

  onFormStore(e) {
    const idx = parseInt(e.detail.value, 10) || 0
    const storeId = (this.data.formStoreIds || [])[idx] || ''
    const storeName = (this.data.formStoreNames || [])[idx] || ''
    const patch = {
      formStoreIndex: idx,
      'form.storeId': storeId
    }
    const curCustomer = String((this.data.form && this.data.form.customerName) || '').trim()
    const prevName = (this.data.formStoreNames || [])[this.data.formStoreIndex] || ''
    if (!curCustomer || curCustomer === prevName) {
      patch['form.customerName'] = storeName
    }
    this.setData(patch)
  },

  onFormDate(e) {
    this.setData({ 'form.shipmentDate': e.detail.value || '' })
  },

  onFormCategory(e) {
    const idx = parseInt(e.detail.value, 10) || 0
    this.setData({
      formCategoryIndex: idx,
      'form.category': (this.data.formCategoryValues || [])[idx] || ''
    })
  },

  onFormStatus(e) {
    const idx = parseInt(e.detail.value, 10) || 0
    this.setData({
      formStatusIndex: idx,
      'form.status': (this.data.formStatusValues || [])[idx] || 'confirmed'
    })
  },

  onSkuKeyword(e) {
    this.setData({ skuKeyword: String((e.detail && e.detail.value) || '') })
  },

  async searchSku() {
    const keyword = String(this.data.skuKeyword || '').trim()
    if (!keyword) {
      wx.showToast({ title: '请输入品名关键词', icon: 'none' })
      return
    }
    if (this.data.skuSearching) return
    this.setData({ skuSearching: true })
    try {
      const result = await this.callFn({
        action: 'searchSku',
        keyword,
        limit: 16
      })
      const list = result.list || []
      this.setData({ skuHits: list, skuSearching: false })
      if (!list.length) {
        wx.showToast({ title: '未找到匹配藏品', icon: 'none' })
      }
    } catch (e) {
      this.setData({ skuSearching: false })
      wx.showToast({ title: formatCloudFnError(e, '搜索失败'), icon: 'none' })
    }
  },

  selectSkuHit(e) {
    const idx = Number((e.currentTarget.dataset || {}).idx)
    const hit = (this.data.skuHits || [])[idx]
    if (!hit) return
    const price =
      hit.unitPrice != null && Number(hit.unitPrice) > 0 ? String(hit.unitPrice) : ''
    const linkedBits = [hit.sourceLabel, hit.spec, hit.skuId].filter(Boolean)
    this.setData(
      {
        'form.itemName': hit.itemName || '',
        'form.spec': hit.spec || '',
        'form.unitPrice': price || this.data.form.unitPrice || '',
        'form.productId': hit.productId || '',
        'form.skuId': hit.skuId || '',
        'form.inventoryRecordId': hit.inventoryRecordId || '',
        'form.linkedLabel': linkedBits.join(' · ') || hit.itemName || ''
      },
      () => this.refreshFormAmountPreview()
    )
    wx.showToast({ title: '已带入品名', icon: 'none' })
  },

  async confirmSingle() {
    if (this.data.saving) return
    const form = this.data.form || {}
    const storeId = String(form.storeId || '').trim()
    if (!storeId) {
      wx.showToast({ title: '请选择门店', icon: 'none' })
      return
    }
    const shipmentDate = String(form.shipmentDate || '').trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(shipmentDate)) {
      wx.showToast({ title: '请选择出货日期', icon: 'none' })
      return
    }
    const itemName = String(form.itemName || '').trim()
    if (!itemName) {
      wx.showToast({ title: '请填写或选择品名', icon: 'none' })
      return
    }
    const qty = Number(form.qty)
    if (!Number.isFinite(qty) || qty <= 0) {
      wx.showToast({ title: '数量须大于 0', icon: 'none' })
      return
    }
    const unitPrice = Number(form.unitPrice)
    const price = Number.isFinite(unitPrice) && unitPrice >= 0 ? unitPrice : 0
    const totalPrice = Math.round(qty * price * 100) / 100
    const storeName =
      (this.data.formStoreNames || [])[this.data.formStoreIndex] || ''

    this.setData({ saving: true })
    try {
      await this.callFn({
        action: 'create',
        item: {
          storeId,
          shipmentDate,
          customerName: String(form.customerName || '').trim() || storeName,
          buyerName: String(form.buyerName || '').trim(),
          category: String(form.category || '').trim(),
          items: [
            {
              itemName,
              spec: String(form.spec || '').trim(),
              category: String(form.category || '').trim(),
              qty,
              unitPrice: price,
              totalPrice,
              productId: String(form.productId || '').trim(),
              skuId: String(form.skuId || '').trim(),
              inventoryRecordId: String(form.inventoryRecordId || '').trim()
            }
          ],
          unitPrice: price,
          inventoryRecordId: String(form.inventoryRecordId || '').trim(),
          productId: String(form.productId || '').trim(),
          skuId: String(form.skuId || '').trim(),
          expressCompany: String(form.expressCompany || '').trim(),
          trackingNo: String(form.trackingNo || '').trim(),
          note: String(form.note || '').trim(),
          status: String(form.status || 'confirmed').trim() || 'confirmed',
          source: 'manual'
        }
      })
      wx.showToast({ title: '已写入出货单', icon: 'success' })
      this.setData({ showPaste: false })
      await Promise.all([this.loadList(), this.loadDashboard()])
    } catch (e) {
      wx.showToast({ title: formatCloudFnError(e, '写入失败'), icon: 'none' })
    } finally {
      this.setData({ saving: false })
    }
  },

  onPasteInput(e) {
    this.setData({ pasteText: e.detail.value || '', writebackMsg: '' })
  },

  async runParse() {
    const text = String(this.data.pasteText || '').trim()
    if (!text) {
      wx.showToast({ title: '请先粘贴出货文本', icon: 'none' })
      return
    }
    this.setData({ parsing: true, writebackMsg: '' })
    try {
      const result = await this.callFn({ action: 'parseText', text })
      const parsed = this.decorateParsed(result.parsed || null)
      const failedLines = (parsed && parsed.failedLines) || []
      this.setData({
        parsePreview: parsed,
        parseErrors: (parsed && parsed.errors) || [],
        parseWarnings: (parsed && parsed.warnings) || [],
        failedLines
      })
      if (!parsed || !parsed.canWrite) {
        wx.showToast({
          title:
            (failedLines[0] && failedLines[0].msg) ||
            (parsed && parsed.errors && parsed.errors[0] && parsed.errors[0].msg) ||
            '解析失败',
          icon: 'none'
        })
      } else if (failedLines.length) {
        wx.showToast({ title: `可写，仍有 ${failedLines.length} 处问题行`, icon: 'none' })
      }
    } catch (e) {
      wx.showToast({ title: formatCloudFnError(e, '解析失败'), icon: 'none' })
    } finally {
      this.setData({ parsing: false })
    }
  },

  onIssueLineInput(e) {
    const idx = Number(e.currentTarget.dataset.idx)
    const failedLines = (this.data.failedLines || []).slice()
    if (!failedLines[idx]) return
    failedLines[idx] = Object.assign({}, failedLines[idx], { text: e.detail.value || '' })
    this.setData({ failedLines })
  },

  applyIssueLine(e) {
    const idx = Number(e.currentTarget.dataset.idx)
    const issue = (this.data.failedLines || [])[idx]
    if (!issue || !issue.line) {
      wx.showToast({ title: '无法定位原行', icon: 'none' })
      return
    }
    const lines = String(this.data.pasteText || '').replace(/\r\n/g, '\n').split('\n')
    const lineIdx = Number(issue.line) - 1
    if (lineIdx < 0 || lineIdx >= lines.length) {
      wx.showToast({ title: '行号已失效，请整段重贴', icon: 'none' })
      return
    }
    lines[lineIdx] = String(issue.text || '').trim()
    this.setData({ pasteText: lines.join('\n') })
    this.runParse()
  },

  onPreviewDate(e) {
    const parsePreview = this.recomputePreviewTotals(
      Object.assign({}, this.data.parsePreview || {}, {
        shipmentDate: e.detail.value || ''
      })
    )
    this.setData({ parsePreview })
  },

  toggleStoreCollapse(e) {
    const idx = Number(e.currentTarget.dataset.idx)
    const parsePreview = JSON.parse(JSON.stringify(this.data.parsePreview || {}))
    if (!parsePreview.shipments || !parsePreview.shipments[idx]) return
    parsePreview.shipments[idx].collapsed = !parsePreview.shipments[idx].collapsed
    this.setData({ parsePreview })
  },

  onPreviewItemName(e) {
    const storeIdx = Number(e.currentTarget.dataset.storeIdx)
    const itemIdx = Number(e.currentTarget.dataset.itemIdx)
    const parsePreview = JSON.parse(JSON.stringify(this.data.parsePreview || {}))
    if (!parsePreview.shipments || !parsePreview.shipments[storeIdx]) return
    if (!parsePreview.shipments[storeIdx].items[itemIdx]) return
    parsePreview.shipments[storeIdx].items[itemIdx].itemName = e.detail.value || ''
    this.setData({ parsePreview: this.recomputePreviewTotals(parsePreview) })
  },

  onPreviewItemQty(e) {
    const storeIdx = Number(e.currentTarget.dataset.storeIdx)
    const itemIdx = Number(e.currentTarget.dataset.itemIdx)
    const parsePreview = JSON.parse(JSON.stringify(this.data.parsePreview || {}))
    if (!parsePreview.shipments || !parsePreview.shipments[storeIdx]) return
    if (!parsePreview.shipments[storeIdx].items[itemIdx]) return
    const qty = parseInt(e.detail.value, 10)
    parsePreview.shipments[storeIdx].items[itemIdx].qty =
      Number.isFinite(qty) && qty > 0 ? qty : 1
    this.setData({ parsePreview: this.recomputePreviewTotals(parsePreview) })
  },

  async confirmPaste() {
    const parsePreview = this.data.parsePreview
    if (!parsePreview || !parsePreview.canWrite) {
      wx.showToast({ title: '请先成功解析可写明细', icon: 'none' })
      return
    }
    this.setData({ saving: true, writebackMsg: '' })
    try {
      const result = await this.callFn({
        action: 'createFromParsed',
        parsed: {
          ok: true,
          canWrite: true,
          shipmentDate: parsePreview.shipmentDate,
          shipments: parsePreview.shipments,
          rawText: this.data.pasteText
        },
        shipmentDate: parsePreview.shipmentDate,
        rawText: this.data.pasteText,
        status: 'confirmed',
        source: 'manual'
      })
      const created = (result.list || []).length
      const failed = (result.stats && result.stats.failed) || 0
      const writebackMsg =
        result.msg ||
        `已写入 ${created} 单（状态：已确认 · 来源：手工录入）` +
          (failed ? `，失败 ${failed}` : '')
      wx.showToast({ title: result.msg || '已录入', icon: 'success' })
      this.setData({
        writebackMsg,
        showPaste: false,
        pasteText: '',
        parsePreview: null,
        failedLines: []
      })
      await Promise.all([this.loadList(), this.loadDashboard()])
    } catch (e) {
      this.setData({
        writebackMsg: formatCloudFnError(e, '写入失败')
      })
      wx.showToast({ title: formatCloudFnError(e, '写入失败'), icon: 'none' })
    } finally {
      this.setData({ saving: false })
    }
  },

  openDetail(e) {
    const id = e.currentTarget.dataset.id
    const row = (this.data.list || []).find((x) => x._id === id)
    if (!row) return
    this.setData({ showDetail: true, detail: row })
  },

  closeDetail() {
    this.setData({ showDetail: false, detail: null })
  },

  async onTransit(e) {
    const id = e.currentTarget.dataset.id
    const row = (this.data.list || []).find((x) => x._id === id)
    if (!row) return
    const next = ((this.data.statuses || []).find((s) => s.value === row.status) || {}).next || []
    if (!next.length) return
    const labels = next.map((v) => {
      const s = (this.data.statuses || []).find((x) => x.value === v)
      return s ? s.label : v
    })
    try {
      const pick = await new Promise((resolve, reject) => {
        wx.showActionSheet({
          itemList: labels,
          success: (res) => resolve(next[res.tapIndex]),
          fail: reject
        })
      })
      await this.callFn({ action: 'setStatus', id, status: pick })
      wx.showToast({ title: '已流转', icon: 'success' })
      await Promise.all([this.loadList(), this.loadDashboard()])
    } catch (err) {
      if (err && err.errMsg && /cancel/i.test(err.errMsg)) return
      wx.showToast({ title: formatCloudFnError(err, '流转失败'), icon: 'none' })
    }
  },

  async onRemove(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    const ok = await new Promise((resolve) => {
      wx.showModal({
        title: '删除出货单',
        content: '确认删除？删除后列表不再展示（软删）。',
        success: (res) => resolve(!!res.confirm)
      })
    })
    if (!ok) return
    try {
      await this.callFn({ action: 'remove', id })
      wx.showToast({ title: '已删除', icon: 'success' })
      this.closeDetail()
      await Promise.all([this.loadList(), this.loadDashboard()])
    } catch (err) {
      wx.showToast({ title: formatCloudFnError(err, '删除失败'), icon: 'none' })
    }
  },

  noop() {}
})
