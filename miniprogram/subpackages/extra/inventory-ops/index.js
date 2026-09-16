/**
 * 库存管理 — 观测台 + 明细
 *   总览：成品 + 原材料聚合信号灯
 *   明细 Tab1 成品：studio_inventory / 飞书「成品库存」
 *   明细 Tab2 原材料：studio_raw_inventory / 飞书「库存管理」
 */
const { guardStaffPage } = require('../utils/staffAuth')
const { formatCloudFnError } = require('../utils/memberScan')
const { parseStudioInventoryText } = require('../utils/studioInventoryParse')

const FN_FINISHED = 'manageStudioInventory'
const FN_RAW = 'manageStudioRawInventory'

const FINISHED_NOTE =
  '已做好的藏品成品台账。粘贴群公告盘点 → 按盘点日快照覆盖；对应飞书「成品库存」。'
const RAW_NOTE =
  '多平台进货的原材料台账。对应飞书「库存管理」，与成品库存分柜存放。'

function money(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return '0'
  return v.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}

function withPct(list, mode) {
  const rows = Array.isArray(list) ? list : []
  const max = Math.max(
    1,
    ...rows.map((r) => {
      if (mode === 'count') return Number(r.count) || 0
      if (mode === 'qty') return Number(r.qty) || 0
      return Number(r.amount) || Number(r.qty) || Number(r.count) || 0
    })
  )
  return rows.map((r) => {
    const amount = Number(r.amount) || 0
    const qty = Number(r.qty) || 0
    const count = Number(r.count) || 0
    const base = mode === 'count' ? count : mode === 'qty' ? qty : amount || qty || count
    return {
      key: r.key || r.label,
      label: r.label || r.key || '',
      amount,
      qty,
      count,
      amountText:
        mode === 'count'
          ? String(count)
          : mode === 'qty'
            ? String(qty)
            : amount
              ? money(amount)
              : String(qty || count),
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

function buildLocalGroups(list) {
  const map = Object.create(null)
  const order = []
  ;(list || []).forEach((row) => {
    const key = String((row && row.groupName) || '').trim() || '未分组'
    if (!map[key]) {
      map[key] = {
        key,
        name: key,
        items: [],
        totalQty: 0,
        skuCount: 0,
        collapsed: false
      }
      order.push(key)
    }
    map[key].items.push(row)
    map[key].totalQty += Number(row.qty) || 0
    map[key].skuCount += 1
  })
  return order.map((k) => map[k])
}

function normalizeTab(raw) {
  const s = String(raw || '').trim().toLowerCase()
  if (s === 'raw' || s === '原材料' || s === 'raw_materials') return 'raw'
  return 'finished'
}

Page({
  data: {
    ready: false,
    loading: false,
    dashLoading: false,
    committing: false,
    saving: false,
    viewMode: 'overview',
    activeTab: 'finished',
    finishedNote: FINISHED_NOTE,
    rawNote: RAW_NOTE,
    keyword: '',

    // 成品
    groupFilter: '',
    groupFilterIndex: 0,
    groupFilterNames: ['全部分组'],
    groupFilterValues: [''],
    dateFilter: '',
    dateFilterIndex: 0,
    dateFilterNames: ['当前台账'],
    dateFilterValues: [''],
    list: [],
    groups: [],
    summary: {
      count: 0,
      skuCount: 0,
      totalQty: 0,
      groupCount: 0,
      inventoryDate: '',
      fromSnapshot: false
    },
    metaNote: '',
    sourceLabel: '',
    snapshots: [],
    showPaste: false,
    pasteText: '',
    preview: null,
    previewError: '',

    // 原材料
    rawList: [],
    rawSummary: {
      count: 0,
      totalQty: 0,
      stockValue: 0,
      stockValueText: '0',
      lowStockCount: 0
    },
    rawCategoryIndex: 0,
    rawCategoryNames: ['全部分类', '工具', '藏品'],
    rawCategoryValues: ['', '工具', '藏品'],
    showRawForm: false,
    rawEditingId: '',
    formCategoryIndex: 0,
    formCategoryNames: ['工具', '藏品'],
    rawForm: {
      itemName: '',
      spec: '',
      category: '工具',
      qty: '0',
      unitPrice: '',
      locationText: '',
      note: ''
    },

    // dashboard
    sourceOpen: false,
    legendOpen: false,
    detailOpen: false,
    sectionOpen: {
      finished: true,
      raw: false,
      low: false
    },
    listMore: { finished: false, raw: false },
    sourceNote: '',
    verdict: null,
    signalBoard: {
      items: [],
      summary: { ok: 0, warn: 0, danger: 0 },
      rulesNote: ''
    },
    kpis: null,
    structure: [],
    charts: {
      byFinishedGroup: [],
      byRawCategory: [],
      topFinished: [],
      topFinishedView: [],
      topFinishedMore: 0,
      topRawByValue: [],
      topRawView: [],
      topRawMore: 0,
      lowStockItems: []
    },
    dashLoaded: false
  },

  _keywordTimer: null,
  _collapseMap: {},

  async onLoad(query) {
    const role = await guardStaffPage('manager')
    if (!role) return
    const tab = normalizeTab((query && (query.tab || query.type)) || 'finished')
    const openDetail = !!(query && (query.tab || query.type))
    this.setData({
      ready: true,
      activeTab: tab,
      viewMode: openDetail ? 'detail' : 'overview'
    })
    if (openDetail) {
      await this.reloadActive()
    } else {
      await Promise.all([this.loadDashboard(), this.reloadActive()])
    }
  },

  onUnload() {
    if (this._keywordTimer) clearTimeout(this._keywordTimer)
  },

  onPullDownRefresh() {
    const tasks =
      this.data.viewMode === 'overview'
        ? [this.loadDashboard(), this.reloadActive()]
        : [this.reloadActive()]
    Promise.all(tasks).finally(() => wx.stopPullDownRefresh())
  },

  switchView(e) {
    const mode = String((e.currentTarget.dataset || {}).mode || '')
    if (!mode || mode === this.data.viewMode) return
    this.setData({ viewMode: mode })
    if (mode === 'overview') this.loadDashboard()
    else this.reloadActive()
  },

  async reloadActive() {
    if (this.data.activeTab === 'raw') {
      await this.loadRawList()
      return
    }
    await this.loadFinishedMeta()
    await Promise.all([this.loadFinishedList(), this.loadSnapshots()])
  },

  switchTab(e) {
    const tab = normalizeTab(e && e.currentTarget && e.currentTarget.dataset.tab)
    if (tab === this.data.activeTab && this.data.viewMode === 'detail') return
    this.setData({
      viewMode: 'detail',
      activeTab: tab,
      keyword: '',
      loading: true,
      showPaste: false,
      showRawForm: false
    })
    this.reloadActive()
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
      patch.sectionOpen = { finished: true, raw: false, low: false }
      patch.listMore = { finished: false, raw: false }
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
    const fin = Array.isArray(charts.topFinished) ? charts.topFinished : []
    const raw = Array.isArray(charts.topRawByValue) ? charts.topRawByValue : []
    const patch = {}
    if (listMore.finished || fin.length <= 5) {
      patch['charts.topFinishedView'] = fin
      patch['charts.topFinishedMore'] = 0
    } else {
      patch['charts.topFinishedView'] = fin.slice(0, 5)
      patch['charts.topFinishedMore'] = fin.length - 5
    }
    if (listMore.raw || raw.length <= 5) {
      patch['charts.topRawView'] = raw
      patch['charts.topRawMore'] = 0
    } else {
      patch['charts.topRawView'] = raw.slice(0, 5)
      patch['charts.topRawMore'] = raw.length - 5
    }
    this.setData(patch)
  },

  async loadDashboard() {
    this.setData({ dashLoading: true })
    try {
      const result = await this.callFinished({ action: 'dashboard' })
      const k = result.kpis || {}
      const charts = result.charts || {}
      const signalsPack = result.signals || {}
      const items = Array.isArray(signalsPack.items) ? signalsPack.items : []
      const verdictRaw = result.verdict || signalsPack.verdict || {}

      this.setData({
        dashLoaded: true,
        sourceNote: result.sourceNote || '',
        verdict: {
          title: verdictRaw.title || '库存总览',
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
          finishedSku: k.finishedSku || 0,
          finishedQty: k.finishedQty || 0,
          rawSku: k.rawSku || 0,
          rawQty: k.rawQty || 0,
          rawStockValueText: money(k.rawStockValue),
          lowStockCount: k.lowStockCount || 0,
          zeroPctText: k.finishedZeroPct != null ? `${k.finishedZeroPct}%` : '—',
          inventoryDate: k.inventoryDate || '—',
          ageText: k.inventoryAgeDays != null ? `${k.inventoryAgeDays} 天前` : '—',
          finishedShareText: k.finishedSharePct != null ? `${k.finishedSharePct}%` : '—'
        },
        structure: (charts.mixStructure || []).map((s) => ({
          key: s.key,
          label: s.label,
          amountText: s.key === 'raw' ? money(s.amount) : `${s.qty}件`,
          pct: s.pct,
          widthPct: s.widthPct || Math.max(2, Math.round(s.pct || 0)),
          tone: s.tone || 'used'
        })),
        charts: {
          byFinishedGroup: withPct(charts.byFinishedGroup, 'qty'),
          byRawCategory: withPct(charts.byRawCategory),
          topFinished: withPct(charts.topFinished, 'qty'),
          topFinishedView: [],
          topFinishedMore: 0,
          topRawByValue: withPct(charts.topRawByValue),
          topRawView: [],
          topRawMore: 0,
          lowStockItems: charts.lowStockItems || []
        }
      })
      this.refreshListViews()
    } catch (e) {
      wx.showToast({ title: formatCloudFnError(e, '观测台未能展开'), icon: 'none' })
    } finally {
      this.setData({ dashLoading: false })
    }
  },

  async callFinished(data) {
    const res = await wx.cloud.callFunction({ name: FN_FINISHED, data: data || {} })
    const result = (res && res.result) || {}
    if (!result.success) {
      const err = new Error(result.msg || '操作失败')
      err.code = result.code
      throw err
    }
    return result
  },

  async callRaw(data) {
    const res = await wx.cloud.callFunction({ name: FN_RAW, data: data || {} })
    const result = (res && res.result) || {}
    if (result.success === false) {
      throw new Error(formatCloudFnError(result) || result.msg || '请求失败')
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

  applyCollapseState(groups) {
    const map = this._collapseMap || {}
    return (groups || []).map((g) => ({
      ...g,
      collapsed: map[g.key] != null ? !!map[g.key] : !!g.collapsed
    }))
  },

  // ——— 成品 ———

  async loadFinishedMeta() {
    try {
      const result = await this.callFinished({ action: 'meta' })
      const current = result.current || {}
      const rawGroups = current.groups || []
      const groupNames = ['全部分组']
      const groupValues = ['']
      rawGroups.forEach((g) => {
        if (!g || g === '未分组') {
          if (groupValues.indexOf('__ungrouped__') === -1) {
            groupNames.push('未分组')
            groupValues.push('__ungrouped__')
          }
          return
        }
        groupNames.push(g)
        groupValues.push(g)
      })
      const dates = [''].concat(result.snapshotDates || [])
      const dateNames = ['当前台账'].concat(
        (result.snapshotDates || []).map((d) => `盘点 ${d}`)
      )
      this.setData({
        groupFilterNames: groupNames,
        groupFilterValues: groupValues,
        dateFilterNames: dateNames,
        dateFilterValues: dates,
        metaNote: result.schemaNote || result.roleHint || '',
        sourceLabel: current.sourceLabel || ''
      })
    } catch (e) {
      /* 首次无集合 */
    }
  },

  async loadFinishedList() {
    this.setData({ loading: true })
    try {
      const result = await this.callFinished({
        action: 'list',
        keyword: this.data.keyword,
        groupName: this.data.groupFilter === '__ungrouped__' ? '' : this.data.groupFilter,
        ungrouped: this.data.groupFilter === '__ungrouped__',
        inventoryDate: this.data.dateFilter || ''
      })
      const list = result.list || []
      const groups = this.applyCollapseState(buildLocalGroups(list))
      const summary = result.summary || {}
      this.setData({
        list,
        groups,
        summary: {
          count: summary.count || list.length,
          skuCount: summary.skuCount || list.length,
          totalQty: summary.totalQty || 0,
          groupCount: groups.length,
          inventoryDate: summary.inventoryDate || '',
          fromSnapshot: !!this.data.dateFilter
        },
        sourceLabel: summary.sourceLabel || this.data.sourceLabel || ''
      })
    } catch (e) {
      this.setData({ list: [], groups: [] })
      wx.showToast({ title: formatCloudFnError(e, '列表加载失败'), icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  async loadSnapshots() {
    try {
      const result = await this.callFinished({ action: 'listSnapshots', limit: 12 })
      const snapshots = (result.list || []).map((s) => ({
        ...s,
        createdAtText: this.formatTime(s.createdAt)
      }))
      this.setData({ snapshots })
    } catch (e) {
      /* ignore */
    }
  },

  // ——— 原材料 ———

  async loadRawList() {
    this.setData({ loading: true })
    try {
      const category = this.data.rawCategoryValues[this.data.rawCategoryIndex] || ''
      const result = await this.callRaw({
        action: 'list',
        keyword: this.data.keyword,
        category
      })
      const summary = result.summary || {}
      this.setData({
        rawList: result.list || [],
        rawSummary: {
          count: summary.count || 0,
          totalQty: summary.totalQty || 0,
          stockValue: summary.stockValue || 0,
          stockValueText: String(summary.stockValue != null ? summary.stockValue : 0),
          lowStockCount: summary.lowStockCount || 0
        }
      })
    } catch (e) {
      this.setData({ rawList: [] })
      wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  onKeywordInput(e) {
    const keyword = (e.detail && e.detail.value) || ''
    this.setData({ keyword })
    if (this._keywordTimer) clearTimeout(this._keywordTimer)
    this._keywordTimer = setTimeout(() => {
      if (this.data.activeTab === 'raw') this.loadRawList()
      else this.loadFinishedList()
    }, 320)
  },

  clearKeyword() {
    this.setData({ keyword: '' })
    if (this.data.activeTab === 'raw') this.loadRawList()
    else this.loadFinishedList()
  },

  onGroupFilter(e) {
    const idx = parseInt(e.detail.value, 10) || 0
    const groupFilter = this.data.groupFilterValues[idx] || ''
    this.setData({ groupFilterIndex: idx, groupFilter })
    this.loadFinishedList()
  },

  onDateFilter(e) {
    const idx = parseInt(e.detail.value, 10) || 0
    const dateFilter = this.data.dateFilterValues[idx] || ''
    this.setData({ dateFilterIndex: idx, dateFilter })
    this.loadFinishedList()
  },

  onRawCategory(e) {
    this.setData({ rawCategoryIndex: Number(e.detail.value) || 0 })
    this.loadRawList()
  },

  toggleGroupCollapse(e) {
    const idx = Number(e.currentTarget.dataset.idx)
    const groups = (this.data.groups || []).slice()
    if (!groups[idx]) return
    groups[idx] = Object.assign({}, groups[idx], { collapsed: !groups[idx].collapsed })
    this._collapseMap = this._collapseMap || {}
    this._collapseMap[groups[idx].key] = groups[idx].collapsed
    this.setData({ groups })
  },

  openPaste() {
    this.setData({
      showPaste: true,
      pasteText: '',
      preview: null,
      previewError: ''
    })
  },

  closePaste() {
    if (this.data.committing) return
    this.setData({ showPaste: false })
  },

  onPasteInput(e) {
    this.setData({ pasteText: (e.detail && e.detail.value) || '' })
  },

  buildPreviewGroupBlocks(lines) {
    const map = Object.create(null)
    const order = []
    ;(lines || []).forEach((l) => {
      const key = String(l.groupName || '').trim() || '未分组'
      if (!map[key]) {
        map[key] = {
          key,
          name: key,
          items: [],
          totalQty: 0,
          skuCount: 0,
          collapsed: false
        }
        order.push(key)
      }
      map[key].items.push(l)
      map[key].totalQty += Number(l.qty) || 0
      map[key].skuCount += 1
    })
    return order.map((k) => map[k])
  },

  runPreview() {
    const parsed = parseStudioInventoryText(this.data.pasteText)
    if (!parsed.ok) {
      this.setData({ preview: null, previewError: parsed.error || '解析失败' })
      return
    }
    const lines = (parsed.lines || []).map((l) => ({
      ...l,
      groupLabel: l.groupName || '未分组'
    }))
    this.setData({
      previewError: '',
      preview: {
        inventoryDate: parsed.inventoryDate || '（未识别，提交时需补）',
        sourceLabel: parsed.sourceLabel,
        lineCount: parsed.stats.lineCount,
        totalQty: parsed.stats.totalQty,
        groupCount: parsed.stats.groupCount,
        groups: parsed.groups,
        groupBlocks: this.buildPreviewGroupBlocks(lines),
        skippedCount: (parsed.skipped || []).length
      }
    })
  },

  togglePreviewGroup(e) {
    const idx = Number(e.currentTarget.dataset.idx)
    const preview = JSON.parse(JSON.stringify(this.data.preview || {}))
    if (!preview.groupBlocks || !preview.groupBlocks[idx]) return
    preview.groupBlocks[idx].collapsed = !preview.groupBlocks[idx].collapsed
    this.setData({ preview })
  },

  async confirmCommit() {
    if (this.data.committing) return
    const parsed = parseStudioInventoryText(this.data.pasteText)
    if (!parsed.ok) {
      this.setData({ previewError: parsed.error || '解析失败' })
      return
    }
    if (!parsed.inventoryDate) {
      wx.showToast({ title: '文本需含盘点日期', icon: 'none' })
      return
    }

    const confirm = await new Promise((resolve) => {
      wx.showModal({
        title: '确认写入成品盘点',
        content: `将以 ${parsed.inventoryDate} 全量覆盖当前成品台账（${parsed.stats.lineCount} SKU / 共 ${parsed.stats.totalQty} 件），并保留历史快照。`,
        confirmText: '确认覆盖',
        confirmColor: '#C4A76C',
        success: (res) => resolve(!!res.confirm),
        fail: () => resolve(false)
      })
    })
    if (!confirm) return

    this.setData({ committing: true })
    wx.showLoading({ title: '写入中…', mask: true })
    try {
      const result = await this.callFinished({
        action: 'commitSnapshot',
        text: this.data.pasteText
      })
      wx.hideLoading()
      wx.showToast({ title: result.msg || '已写入', icon: 'none', duration: 2400 })
      this.setData({ showPaste: false, pasteText: '', preview: null })
      this._collapseMap = {}
      await Promise.all([this.loadFinishedMeta(), this.loadFinishedList(), this.loadSnapshots()])
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: formatCloudFnError(e, '写入失败'), icon: 'none' })
    } finally {
      this.setData({ committing: false })
    }
  },

  async openSnapshot(e) {
    const id = e.currentTarget.dataset.id
    const date = e.currentTarget.dataset.date
    if (!id) return

    if (date) {
      const idx = this.data.dateFilterValues.indexOf(date)
      this.setData({
        dateFilter: date,
        dateFilterIndex: idx >= 0 ? idx : 0
      })
      await this.loadFinishedList()
    }

    try {
      const result = await this.callFinished({ action: 'getSnapshot', snapshotId: id })
      const snap = result.snapshot || {}
      const lines = (snap.lines || [])
        .slice(0, 8)
        .map((l) => `${l.groupName ? l.groupName + '·' : ''}${l.skuName} ${l.qty}个`)
        .join('\n')
      wx.showModal({
        title: `快照 ${snap.inventoryDate || ''}`,
        content: `${snap.sourceLabel || ''}\n${snap.lineCount || 0} SKU · 共 ${snap.totalQty || 0} 件\n录入 ${this.formatTime(snap.createdAt)}\n\n${lines}${(snap.lines || []).length > 8 ? '\n…' : ''}`,
        showCancel: true,
        cancelText: '关闭',
        confirmText: '保持筛选',
        success: () => {}
      })
    } catch (err) {
      wx.showToast({ title: formatCloudFnError(err, '快照读取失败'), icon: 'none' })
    }
  },

  openRawForm() {
    this.setData({
      showRawForm: true,
      rawEditingId: '',
      formCategoryIndex: 0,
      rawForm: {
        itemName: '',
        spec: '',
        category: '工具',
        qty: '0',
        unitPrice: '',
        locationText: '',
        note: ''
      }
    })
  },

  openRawEdit(e) {
    const id = e.currentTarget.dataset.id
    const item = (this.data.rawList || []).find((x) => x._id === id)
    if (!item) return
    const catIdx = Math.max(0, this.data.formCategoryNames.indexOf(item.category || '工具'))
    this.setData({
      showRawForm: true,
      rawEditingId: id,
      formCategoryIndex: catIdx,
      rawForm: {
        itemName: item.itemName || '',
        spec: item.spec || '',
        category: item.category || '工具',
        qty: String(item.qty != null ? item.qty : 0),
        unitPrice: item.unitPrice != null ? String(item.unitPrice) : '',
        locationText: item.locationText || '',
        note: item.note || ''
      }
    })
  },

  closeRawForm() {
    if (this.data.saving) return
    this.setData({ showRawForm: false })
  },

  onRawForm(e) {
    const key = e.currentTarget.dataset.key
    const value = (e.detail && e.detail.value) || ''
    this.setData({ [`rawForm.${key}`]: value })
  },

  onFormCategory(e) {
    const idx = Number(e.detail.value) || 0
    this.setData({
      formCategoryIndex: idx,
      'rawForm.category': this.data.formCategoryNames[idx] || '工具'
    })
  },

  async saveRawForm() {
    if (this.data.saving) return
    const form = this.data.rawForm
    if (!String(form.itemName || '').trim()) {
      wx.showToast({ title: '请填写物品名称', icon: 'none' })
      return
    }
    this.setData({ saving: true })
    try {
      const payload = {
        itemName: form.itemName,
        spec: form.spec,
        category: form.category,
        qty: Number(form.qty) || 0,
        unitPrice: Number(form.unitPrice) || 0,
        locationText: form.locationText,
        note: form.note
      }
      if (this.data.rawEditingId) {
        await this.callRaw({ action: 'update', id: this.data.rawEditingId, item: payload })
      } else {
        await this.callRaw({ action: 'create', item: payload })
      }
      this.setData({ showRawForm: false })
      wx.showToast({ title: '已保存', icon: 'success' })
      await this.loadRawList()
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '保存失败', icon: 'none' })
    } finally {
      this.setData({ saving: false })
    }
  }
})
