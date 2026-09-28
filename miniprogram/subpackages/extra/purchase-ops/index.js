/**
 * 采购管理 — 观测台 + 单据（managePurchaseOrder → ops_purchases）
 * 超管可写；店长只读本店相关主体
 */
const { guardStaffPage } = require('../utils/staffAuth')
const { formatCloudFnError } = require('../utils/memberScan')

const FN = 'managePurchaseOrder'

const STATUS_TONE = {
  draft: 'muted',
  pending_pay: 'warn',
  paid: 'brass',
  ordered: 'brass',
  pending_ship: 'warn',
  shipped: 'warn',
  received: 'ok',
  arrived: 'ok',
  stocked: 'ok',
  completed: 'ok',
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
    tipTone: 'info',
    tipText: '',
    formTip: '',
    dashError: '',
    listError: false,
    pendingRemoveId: '',
    saving: false,
    syncing: false,
    selecting: false,
    selectedIds: [],
    selectedMap: {},
    canWrite: true,
    isSuper: false,
    readOnly: false,
    activeTab: 'overview',
    scope: 'store',
    keyword: '',
    entityFilter: '',
    entityFilterIndex: 0,
    entityFilterNames: ['全部主体'],
    entityFilterIds: [''],
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
    entities: [],
    list: [],
    summary: {
      totalAmount: 0,
      totalAmountText: '0',
      count: 0,
      byEntity: []
    },
    syncMeta: {
      lastPullText: '',
      lastPullMsg: '',
      lastPullOk: null
    },
    showSyncPanel: false,
    showForm: false,
    editingId: '',
    formEntityIndex: 0,
    formEntityNames: [],
    formStatusIndex: 0,
    formStatusNames: [],
    formAmountPreview: '0',
    form: {
      entityId: '',
      itemName: '',
      spec: '',
      qty: '1',
      unit: '件',
      unitPrice: '',
      supplier: '',
      purchaseDate: '',
      status: 'draft',
      note: ''
    },

    sourceOpen: false,
    legendOpen: false,
    detailOpen: false,
    sectionOpen: {
      entity: true,
      status: false,
      items: false
    },
    listMore: { items: false },
    sourceNote: '',
    verdict: null,
    signalBoard: {
      items: [],
      summary: { ok: 0, warn: 0, danger: 0 },
      rulesNote: ''
    },
    kpis: null,
    progress: null,
    structure: [],
    trend: [],
    trendCount: [],
    trendMode: 'empty',
    trendSingle: null,
    trendNote: '',
    charts: {
      byBudgetType: [],
      byCategory: [],
      byEntity: [],
      byStatus: [],
      byItem: [],
      byItemView: [],
      byItemMore: 0
    },
    dashLoaded: false
  },

  _keywordTimer: null,

  async onLoad() {
    const role = await guardStaffPage('manager')
    if (!role) return
    this.setData({
      ready: true,
      isSuper: !!(role.superAdmin || role.isSuperAdmin),
      canWrite: !!(role.superAdmin || role.isSuperAdmin)
    })
    await this.loadMeta()
    await Promise.all([this.loadDashboard(), this.loadList(), this.loadSyncStatus(true)])
  },

  onUnload() {
    if (this._keywordTimer) clearTimeout(this._keywordTimer)
  },

  onPullDownRefresh() {
    const tasks =
      this.data.activeTab === 'overview'
        ? [this.loadDashboard(), this.loadList(), this.loadSyncStatus(true)]
        : [this.loadList(), this.loadSyncStatus(true)]
    Promise.all(tasks).finally(() => wx.stopPullDownRefresh())
  },

  switchTab(e) {
    const tab = String((e.currentTarget.dataset || {}).tab || '')
    if (!tab || tab === this.data.activeTab) return
    this.setData({ activeTab: tab })
    if (tab === 'overview' && !this.data.dashLoaded) this.loadDashboard()
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

  money(n) {
    return money(n)
  },

  formatTime(ts) {
    const n = Number(ts)
    if (!Number.isFinite(n) || n <= 0) return '—'
    const d = new Date(n)
    const pad = (x) => String(x).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
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
      patch.sectionOpen = { entity: true, status: false, items: false }
      patch.listMore = { items: false }
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
    const list = Array.isArray(charts.byItem) ? charts.byItem : []
    if (listMore.items || list.length <= 5) {
      this.setData({ 'charts.byItemView': list, 'charts.byItemMore': 0 })
    } else {
      this.setData({
        'charts.byItemView': list.slice(0, 5),
        'charts.byItemMore': list.length - 5
      })
    }
  },

  async loadDashboard() {
    this.setData({ dashLoading: true, dashError: '' })
    try {
      const result = await this.callFn({
        action: 'dashboard',
        scope: this.data.scope || undefined,
        entityId: this.data.entityFilter || undefined
      })
      const k = result.kpis || {}
      const charts = result.charts || {}
      const signalsPack = result.signals || {}
      const items = Array.isArray(signalsPack.items) ? signalsPack.items : []
      const verdictRaw = result.verdict || signalsPack.verdict || {}
      const progressRaw = charts.progress || {}
      const usagePct = Number(progressRaw.usagePct)
      const usageBar = Number.isFinite(usagePct) ? Math.max(0, Math.min(100, Math.round(usagePct))) : 0
      const trendRows = charts.purchaseTrend || []

      this.setData({
        dashLoaded: true,
        sourceNote: result.sourceNote || '',
        readOnly: !!result.readOnly,
        canWrite: !result.readOnly,
        isSuper: result.isSuper != null ? !!result.isSuper : this.data.isSuper,
        verdict: {
          title: verdictRaw.title || '采购总览',
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
          purchaseCount: k.purchaseCount || 0,
          purchaseTotalText: money(k.purchaseTotal),
          monthCount: k.monthCount || 0,
          monthAmountText: money(k.monthAmount),
          monthDeltaText: deltaText(k.monthDeltaPct),
          monthDeltaTone:
            k.monthDeltaPct == null ? 'flat' : Number(k.monthDeltaPct) < 0 ? 'down' : Number(k.monthDeltaPct) > 0 ? 'up' : 'flat',
          purchasableText: moneySigned(k.purchasableRemaining),
          purchasableTone: Number(k.purchasableRemaining) < 0 ? 'down' : 'flat',
          unlabeledPctText: k.unlabeledPct != null ? `${k.unlabeledPct}%` : '—',
          openPctText: k.openPct != null ? `${k.openPct}%` : '—',
          hasBudget: !!k.hasBudget,
          overspendText: k.overspendAmount > 0 ? money(k.overspendAmount) : ''
        },
        progress: k.hasBudget
          ? {
              usedText: money(progressRaw.used),
              totalText: money(progressRaw.total),
              remainingText: moneySigned(progressRaw.remaining),
              usagePctText: Number.isFinite(usagePct) ? `${usagePct}%` : '—',
              usageBar,
              tone:
                progressRaw.remaining < 0
                  ? 'down'
                  : usagePct >= 85
                    ? 'down'
                    : usagePct >= 70
                      ? 'warn'
                      : 'up',
              overspendText: progressRaw.overspend > 0 ? money(progressRaw.overspend) : ''
            }
          : null,
        structure: (charts.typeStructure || []).map((s) => ({
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
          byBudgetType: withPct(charts.byBudgetType),
          byCategory: withPct(charts.byCategory),
          byEntity: withPct(charts.byEntity),
          byStatus: withPct(charts.byStatus, 'count'),
          byItem: withPct(charts.byItem),
          byItemView: [],
          byItemMore: 0
        }
      })
      this.refreshListViews()
    } catch (e) {
      this.setData({
        dashError: formatCloudFnError(e, '观测台未能展开'),
        tipTone: 'warn',
        tipText: formatCloudFnError(e, '观测台未能展开')
      })
    } finally {
      this.setData({ dashLoading: false })
    }
  },

  async loadMeta() {
    try {
      const result = await this.callFn({ action: 'meta' })
      const entities = result.entities || []
      const statuses = result.statuses || []
      const sources = result.sources || [
        { value: 'feishu', label: '飞书' },
        { value: 'erp', label: 'ERP' },
        { value: 'manual', label: '手工' }
      ]
      this.setData({
        entities,
        statuses,
        sources,
        statusFilterNames: ['全部状态'].concat(statuses.map((s) => s.label)),
        statusFilterValues: ['all'].concat(statuses.map((s) => s.value)),
        sourceFilterNames: ['全部来源'].concat(sources.map((s) => s.label)),
        sourceFilterValues: ['all'].concat(sources.map((s) => s.value)),
        formStatusNames: statuses.map((s) => s.label)
      })
      this.refreshEntityFilter()
    } catch (e) {
      this.setData({
        tipTone: 'warn',
        tipText: formatCloudFnError(e, '元数据未能取回')
      })
    }
  },

  refreshEntityFilter() {
    const scope = this.data.scope
    const scoped = (this.data.entities || []).filter((e) => e.scope === scope)
    this.setData({
      entityFilterNames: ['全部主体'].concat(scoped.map((e) => e.name)),
      entityFilterIds: [''].concat(scoped.map((e) => e.id)),
      entityFilterIndex: 0,
      entityFilter: '',
      formEntityNames: scoped.map((e) => e.name),
      selectedIds: [],
      selectedMap: {},
      selecting: false
    })
  },

  async loadList() {
    this.setData({ loading: true, listError: false, tipText: '', pendingRemoveId: '' })
    try {
      const result = await this.callFn({
        action: 'list',
        scope: this.data.scope,
        entityId: this.data.entityFilter || undefined,
        status: this.data.statusFilter,
        source: this.data.sourceFilter,
        keyword: this.data.keyword || undefined,
        dateFrom: this.data.dateFrom || undefined,
        dateTo: this.data.dateTo || undefined,
        limit: 80
      })
      const selectedMap = this.data.selectedMap || {}
      const list = (result.list || []).map((row) => {
        const next = this.nextStatuses(row)
        return {
          ...row,
          statusTone: STATUS_TONE[row.status] || 'muted',
          sourceTone: SOURCE_TONE[row.source] || 'muted',
          amountText: this.money(row.amount),
          unitPriceText: this.money(row.unitPrice),
          updatedAtText: this.formatTime(row.updatedAt),
          selected: !!selectedMap[row._id],
          canTransit: next.length > 0,
          nextLabels: next.map((v) => {
            const s = (this.data.statuses || []).find((x) => x.value === v)
            return s ? s.label : v
          })
        }
      })
      const summaryRaw = result.summary || { totalAmount: 0, count: 0, byEntity: [] }
      const summary = {
        totalAmount: summaryRaw.totalAmount || 0,
        totalAmountText: this.money(summaryRaw.totalAmount),
        count: summaryRaw.count || 0,
        byEntity: (summaryRaw.byEntity || []).map((e) => ({
          ...e,
          amountText: this.money(e.amount)
        }))
      }
      this.setData({
        listError: false,
        list,
        summary,
        readOnly: !!result.readOnly,
        canWrite: !result.readOnly
      })
    } catch (e) {
      this.setData({
        listError: true,
        tipTone: 'warn',
        tipText: formatCloudFnError(e, '清单未能展开')
      })
    } finally {
      this.setData({ loading: false })
    }
  },

  async loadSyncStatus(silent) {
    try {
      const result = await this.callFn({ action: 'syncStatus' })
      const lastPullAt = result.lastPullAt
      this.setData({
        syncMeta: {
          lastPullText: lastPullAt ? this.formatTime(lastPullAt) : '尚未拉取',
          lastPullMsg: result.lastPullMsg || '飞书多维表经 ERP 同步管理写入本柜',
          lastPullOk: result.lastPullOk
        }
      })
    } catch (e) {
      if (!silent) {
        this.setData({
          tipTone: 'warn',
          tipText: formatCloudFnError(e, '同步状态未能取回')
        })
      }
    }
  },

  setScope(e) {
    const scope = e.currentTarget.dataset.scope
    if (!scope || scope === this.data.scope) return
    this.setData({ scope, dashLoaded: false })
    this.refreshEntityFilter()
    this.loadList()
    if (this.data.activeTab === 'overview') this.loadDashboard()
  },

  onEntityFilter(e) {
    const idx = parseInt(e.detail.value, 10) || 0
    this.setData({
      entityFilterIndex: idx,
      entityFilter: this.data.entityFilterIds[idx] || ''
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

  toggleSelectMode() {
    const selecting = !this.data.selecting
    this.setData({
      selecting,
      selectedIds: [],
      selectedMap: {},
      list: (this.data.list || []).map((row) => ({ ...row, selected: false }))
    })
  },

  toggleSelect(e) {
    if (!this.data.selecting) return
    const id = e.currentTarget.dataset.id
    if (!id) return
    const selectedMap = Object.assign({}, this.data.selectedMap || {})
    if (selectedMap[id]) delete selectedMap[id]
    else selectedMap[id] = true
    const selectedIds = Object.keys(selectedMap)
    this.setData({
      selectedMap,
      selectedIds,
      list: (this.data.list || []).map((row) => ({
        ...row,
        selected: !!selectedMap[row._id]
      }))
    })
  },

  openCreate() {
    if (!this.data.canWrite) {
      this.setData({ tipTone: 'warn', tipText: '当前为只读，无法新增' })
      return
    }
    const scoped = (this.data.entities || []).filter((e) => e.scope === this.data.scope)
    const first = scoped[0]
    this.setData({
      showForm: true,
      editingId: '',
      formTip: '',
      formEntityIndex: 0,
      formEntityNames: scoped.map((e) => e.name),
      formStatusIndex: 0,
      formAmountPreview: '0',
      form: {
        entityId: first ? first.id : '',
        itemName: '',
        spec: '',
        qty: '1',
        unit: '件',
        unitPrice: '',
        supplier: '',
        purchaseDate: new Date().toISOString().slice(0, 10),
        status: 'draft',
        note: ''
      }
    })
  },

  openEdit(e) {
    const id = e.currentTarget.dataset.id
    const row = (this.data.list || []).find((x) => x._id === id)
    if (!row) return
    const scoped = (this.data.entities || []).filter((x) => x.scope === this.data.scope)
    const formEntityIndex = Math.max(0, scoped.findIndex((x) => x.id === row.entityId))
    const formStatusIndex = Math.max(0, (this.data.statuses || []).findIndex((s) => s.value === row.status))
    const qty = Number(row.qty) || 0
    const unitPrice = Number(row.unitPrice) || 0
    this.setData({
      showForm: true,
      editingId: id,
      formTip: '',
      formEntityIndex,
      formEntityNames: scoped.map((x) => x.name),
      formStatusIndex,
      formAmountPreview: this.money(qty * unitPrice),
      form: {
        entityId: row.entityId,
        itemName: row.itemName || '',
        spec: row.spec || '',
        qty: String(row.qty != null ? row.qty : 1),
        unit: row.unit || '件',
        unitPrice: String(row.unitPrice != null ? row.unitPrice : ''),
        supplier: row.supplier || '',
        purchaseDate: row.purchaseDate || '',
        status: row.status || 'draft',
        note: row.note || ''
      }
    })
  },

  closeForm() {
    this.setData({ showForm: false })
  },

  refreshAmountPreview() {
    const form = this.data.form || {}
    const qty = Number(form.qty) || 0
    const unitPrice = Number(form.unitPrice) || 0
    this.setData({ formAmountPreview: this.money(qty * unitPrice) })
  },

  onFormInput(e) {
    const field = e.currentTarget.dataset.field
    if (!field) return
    this.setData({ [`form.${field}`]: e.detail.value }, () => {
      if (field === 'qty' || field === 'unitPrice') this.refreshAmountPreview()
    })
  },

  onFormEntity(e) {
    const idx = parseInt(e.detail.value, 10) || 0
    const scoped = (this.data.entities || []).filter((x) => x.scope === this.data.scope)
    const ent = scoped[idx]
    this.setData({
      formEntityIndex: idx,
      'form.entityId': ent ? ent.id : ''
    })
  },

  onFormStatus(e) {
    const idx = parseInt(e.detail.value, 10) || 0
    const st = (this.data.statuses || [])[idx]
    this.setData({
      formStatusIndex: idx,
      'form.status': st ? st.value : 'draft'
    })
  },

  onFormDate(e) {
    this.setData({ 'form.purchaseDate': e.detail.value })
  },

  async saveForm() {
    if (this.data.saving) return
    const form = this.data.form || {}
    if (!String(form.itemName || '').trim()) {
      this.setData({ formTip: '请填写品名' })
      return
    }
    if (!form.entityId) {
      this.setData({ formTip: '请选择归属主体' })
      return
    }
    const qty = Number(form.qty)
    if (!Number.isFinite(qty) || qty <= 0) {
      this.setData({ formTip: '数量须大于 0' })
      return
    }
    this.setData({ saving: true, formTip: '正在保存…' })
    try {
      await this.callFn({
        action: this.data.editingId ? 'update' : 'create',
        id: this.data.editingId || undefined,
        item: {
          entityId: form.entityId,
          itemName: String(form.itemName || '').trim(),
          spec: String(form.spec || '').trim(),
          qty,
          unit: String(form.unit || '件').trim() || '件',
          unitPrice: Number(form.unitPrice) || 0,
          supplier: String(form.supplier || '').trim(),
          purchaseDate: form.purchaseDate || '',
          status: form.status || 'draft',
          note: String(form.note || '').trim(),
          source: 'erp'
        }
      })
      this.setData({
        showForm: false,
        tipTone: 'info',
        tipText: '已收入柜中'
      })
      await this.loadList()
    } catch (e) {
      this.setData({ formTip: formatCloudFnError(e, '未能保存') })
    } finally {
      this.setData({ saving: false })
    }
  },

  nextStatuses(row) {
    const hit = (this.data.statuses || []).find((s) => s.value === (row && row.status))
    return (hit && hit.next) || []
  },

  onTransit(e) {
    const id = e.currentTarget.dataset.id
    const row = (this.data.list || []).find((x) => x._id === id)
    if (!row) return
    const next = this.nextStatuses(row)
    if (!next.length) {
      this.setData({ tipTone: 'info', tipText: '此件已至终点，无可流转状态' })
      return
    }
    const labels = next.map((v) => {
      const s = (this.data.statuses || []).find((x) => x.value === v)
      return s ? s.label : v
    })
    wx.showActionSheet({
      itemList: labels,
      success: async (res) => {
        const status = next[res.tapIndex]
        try {
          await this.callFn({ action: 'setStatus', id, status })
          this.setData({ tipTone: 'info', tipText: '状态已更迭' })
          this.loadList()
        } catch (err) {
          this.setData({
            tipTone: 'warn',
            tipText: formatCloudFnError(err, '流转未成')
          })
        }
      }
    })
  },

  onBatchTransit() {
    const ids = this.data.selectedIds || []
    if (!ids.length) {
      this.setData({ tipTone: 'warn', tipText: '请先勾选采购单' })
      return
    }
    const statuses = (this.data.statuses || []).filter((s) => s.value !== 'draft')
    if (!statuses.length) return
    wx.showActionSheet({
      itemList: statuses.map((s) => s.label),
      success: async (res) => {
        const status = statuses[res.tapIndex] && statuses[res.tapIndex].value
        if (!status) return
        try {
          const result = await this.callFn({ action: 'batchSetStatus', ids, status })
          this.setData({
            selecting: false,
            selectedIds: [],
            selectedMap: {},
            tipTone: 'info',
            tipText: result.msg || '已批量流转'
          })
          this.loadList()
        } catch (err) {
          this.setData({
            tipTone: 'warn',
            tipText: formatCloudFnError(err, '批量流转未成')
          })
        }
      }
    })
  },

  onRemove(e) {
    const id = e.currentTarget.dataset.id
    const row = (this.data.list || []).find((x) => x._id === id)
    if (!row) return
    if (this.data.pendingRemoveId === id) {
      this.setData({ pendingRemoveId: '', tipTone: 'info', tipText: '正在删除…' })
      this.callFn({ action: 'remove', id })
        .then(() => {
          this.setData({ tipTone: 'info', tipText: '已移出' })
          return this.loadList()
        })
        .catch((err) => {
          this.setData({
            tipTone: 'warn',
            tipText: formatCloudFnError(err, '删除未成')
          })
        })
      return
    }
    this.setData({
      pendingRemoveId: id,
      tipTone: 'warn',
      tipText: `再点一次「删除」即移出「${row.orderNo} / ${row.itemName}」`
    })
  },

  openSyncPanel() {
    this.setData({ showSyncPanel: true })
    this.loadSyncStatus(false)
  },

  closeSyncPanel() {
    this.setData({ showSyncPanel: false })
  },

  async refreshSyncAndList() {
    if (this.data.syncing) return
    this.setData({ syncing: true, tipTone: 'info', tipText: '正在刷新同步状态…' })
    try {
      await this.loadSyncStatus(false)
      await this.loadList()
      this.setData({
        tipTone: 'info',
        tipText: '已刷新同步状态。飞书拉取请在 ERP「同步管理」执行。'
      })
    } finally {
      this.setData({ syncing: false })
    }
  },

  noop() {}
})
