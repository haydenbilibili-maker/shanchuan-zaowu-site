/**
 * 出货中心 · SKU 模块（仅超管）：SKU 目录 + 详情 / 编辑弹层。蓝图 miniprogram/docs/出货中心SKU模块_蓝图_2026-10-10.md
 * 编辑弹层与开单里的「新建 SKU」共用（origin = 'create' 时建好后加进本单）。
 * 新建 / 编辑 / 停用走 manageStudioSettlement 的 sku.*；引用 / 删除 / 复核走 manageStoreShipment 的 skuAdmin.*（删除只走 removeIfUnused）。
 * 客户端不算钱：单价与构成只来自 quotePrice / sku.list。
 */
const { formatCloudFnError } = require('../../utils/memberScan')
const { SHIPMENT_FN, SETTLEMENT_FN, callCloud, yuan } = require('./shared')

const DEFAULT_OPT = '默认'
const STATUS_FILTERS = ['all', 'active', 'inactive', 'review']

function normKey(s) {
  return String(s || '').replace(/\s+/g, '').toLowerCase()
}

function optOf(v) {
  return String(v || '').trim() || DEFAULT_OPT
}

/** 与云函数 settlementDefaults.autoSkuName 同规则：只用来判断「名字是不是自动生成的」与占位提示 */
function autoNameOf(f) {
  const grade = optOf(f.materialGrade)
  const size = optOf(f.packagingSize)
  const left = String(f.materialName || '').trim() + (grade !== DEFAULT_OPT ? ' ' + grade : '')
  const right = String(f.packagingName || '').trim() + (size !== DEFAULT_OPT ? ' ' + size : '')
  return [left, right, f.hasScene === true ? '造景' : ''].filter(Boolean).join(' · ')
}

function centsText(c) {
  return '¥' + yuan(Number(c) || 0)
}

function formatTs(ts) {
  const n = Number(ts) || 0
  if (!n) return ''
  const d = new Date(n)
  const p = (x) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 资料行被哪些 SKU 用到（编辑资料时提示影响面；按 id，或名称 + 等级 / 尺寸） */
function skuImpactOf(kind, row, skus) {
  const r = row || {}
  const isMat = kind === 'material'
  const hits = (Array.isArray(skus) ? skus : []).filter((s) => {
    const id = isMat ? s.materialId : s.packagingId
    if (id && r._id && id === r._id) return true
    const name = isMat ? s.materialName : s.packagingName
    const opt = isMat ? s.materialGrade : s.packagingSize
    return normKey(name) === normKey(r.name) && optOf(opt) === optOf(r.option)
  })
  return { total: hits.length, active: hits.filter((s) => s.status !== 'inactive').length }
}

function impactText(impact) {
  if (!impact || !impact.total) return ''
  return `影响 ${impact.total} 个 SKU 的算价（其中启用 ${impact.active} 个）；已开的单据不受影响`
}

function viewSku(s, globalRatePct) {
  const useGlobal = s.useGlobalRate !== false && (s.laborRatePct === null || s.laborRatePct === undefined)
  const priced = s.pricingStatus === 'priced' && s.unitPrice !== null && s.unitPrice !== undefined
  const grade = optOf(s.materialGrade)
  const size = optOf(s.packagingSize)
  return Object.assign({}, s, {
    inactive: s.status === 'inactive',
    matText: `${s.materialName || '—'}${grade !== DEFAULT_OPT ? '（' + grade + '）' : ''}`,
    pkgText: `${s.packagingName || '—'}${size !== DEFAULT_OPT ? ' ' + size : ''}`,
    rateText: useGlobal ? `手工费 全局 ${globalRatePct}%` : `手工费 ${s.laborRatePct}%`,
    sceneText: s.hasScene === true ? `造景 ¥${yuan(Math.round((Number(s.sceneCost) || 0) * 100))}` : '',
    priceText: priced ? '¥' + yuan(Math.round(s.unitPrice * 100)) : '待核价',
    priced
  })
}

function refsLine(r) {
  if (!r) return ''
  const bits = [`正式单 ${r.shipments} 张`, `草稿 ${r.drafts} 张`]
  if (r.otherMemos) bits.push(`历史备忘 ${r.otherMemos} 张`)
  if (r.cancelledShipments) bits.push(`已作废单 ${r.cancelledShipments} 张`)
  if (r.deletedShipments) bits.push(`已删除单 ${r.deletedShipments} 张`)
  return bits.join(' · ')
}

function blankSkuEdit(globalRatePct) {
  return {
    show: false,
    mode: 'create',
    origin: 'catalog',
    saving: false,
    busy: false,
    id: '',
    name: '',
    nameTouched: false,
    namePlaceholder: '留空即自动生成',
    materialId: '', materialName: '', materialGrade: '',
    packagingId: '', packagingName: '', packagingSize: '',
    useGlobalRate: true,
    laborRatePct: globalRatePct,
    hasScene: false,
    sceneCost: '',
    note: '',
    status: 'active',
    needsReview: false,
    importBatch: '',
    unitPriceText: '—',
    pricingStatus: '',
    pricingNote: '',
    breakdown: '',
    problems: [],
    tip: '',
    tipTone: 'info',
    refs: null,
    refsText: '',
    refsLoading: false,
    refsError: '',
    metaText: '',
    removeStep: '',
    blockedText: ''
  }
}

const data = {
  skuCat: {
    loading: false,
    error: '',
    list: [],
    total: 0,
    truncated: false,
    keyword: '',
    filter: 'all',
    counts: { all: 0, active: 0, inactive: 0, review: 0 },
    categoryNames: ['全部分类'],
    categoryValues: [''],
    categoryIndex: 0,
    tip: '',
    tipTone: 'info'
  },
  skuEdit: blankSkuEdit(30)
}

const methods = {
  enterSkuCatalog() {
    if (!this.data.isSuper) return
    if (!this._skuAll) this.loadSkuCatalog()
  },

  /** 全量取（含停用；≤ 200 条）在本地筛选：数量小，切筛选不用每次等云函数 */
  loadSkuCatalog() {
    if (!this.data.isSuper) return Promise.resolve(null)
    this.setData({ 'skuCat.loading': true, 'skuCat.error': '' })
    return callCloud(SETTLEMENT_FN, { action: 'sku.list', status: '', limit: 200 })
      .then((r) => {
        const all = r.list || []
        this._skuAll = all
        this._skuRate = Number(r.globalRatePct) || this.data.globalRatePct || 30
        const cats = Array.isArray(r.categories) ? r.categories : []
        const prevCat = this.data.skuCat.categoryValues[this.data.skuCat.categoryIndex] || ''
        const categoryValues = [''].concat(cats)
        this.setData({
          'skuCat.loading': false,
          'skuCat.total': Number(r.total) || all.length,
          'skuCat.truncated': !!r.truncated,
          'skuCat.counts': {
            all: all.length,
            active: all.filter((s) => s.status !== 'inactive').length,
            inactive: all.filter((s) => s.status === 'inactive').length,
            review: all.filter((s) => s.needsReview === true).length
          },
          'skuCat.categoryNames': ['全部分类'].concat(cats),
          'skuCat.categoryValues': categoryValues,
          'skuCat.categoryIndex': Math.max(0, categoryValues.indexOf(prevCat))
        })
        this.applySkuFilter()
        return all
      })
      .catch((e) => {
        this.setData({ 'skuCat.loading': false, 'skuCat.error': formatCloudFnError(e, 'SKU 目录未能取回') })
        return null
      })
  },

  /** 资料页编辑时要用 SKU 列表算影响面：已有就直接用 */
  ensureSkuCatalog() {
    if (this._skuAll) return Promise.resolve(this._skuAll)
    return this.loadSkuCatalog()
  },

  applySkuFilter() {
    const c = this.data.skuCat
    const kw = normKey(c.keyword)
    const cat = c.categoryValues[c.categoryIndex] || ''
    const rate = this._skuRate || this.data.globalRatePct || 30
    const list = (this._skuAll || []).filter((s) => {
      if (c.filter === 'active' && s.status === 'inactive') return false
      if (c.filter === 'inactive' && s.status !== 'inactive') return false
      if (c.filter === 'review' && s.needsReview !== true) return false
      if (cat && s.materialCategory !== cat) return false
      if (!kw) return true
      return [s.skuName, s.materialName, s.packagingName, s.note].some((t) => normKey(t).indexOf(kw) !== -1)
    })
    this.setData({ 'skuCat.list': list.map((s) => viewSku(s, rate)) })
  },

  onSkuCatKeyword(e) {
    this.setData({ 'skuCat.keyword': String(e.detail.value || '') }, () => this.applySkuFilter())
  },

  setSkuCatFilter(e) {
    const f = String((e.currentTarget.dataset || {}).filter || '')
    if (STATUS_FILTERS.indexOf(f) === -1 || f === this.data.skuCat.filter) return
    this.setData({ 'skuCat.filter': f }, () => this.applySkuFilter())
  },

  onSkuCatCategory(e) {
    this.setData({ 'skuCat.categoryIndex': parseInt(e.detail.value, 10) || 0 }, () => this.applySkuFilter())
  },

  // 详情 / 编辑弹层

  /** 打开编辑器：mode create（新建 / 复制）| edit；origin create = 开单里新建，建好加进本单 */
  openSkuEditor(opts) {
    if (!this.data.isSuper) return
    const o = opts || {}
    const rate = this.data.globalRatePct || 30
    const form = Object.assign(blankSkuEdit(rate), { show: true, mode: o.mode || 'create', origin: o.origin || 'catalog' })
    const src = o.source || null
    if (src) {
      const useGlobal = src.laborRatePct === null || src.laborRatePct === undefined
      Object.assign(form, {
        materialId: src.materialId || '', materialName: src.materialName || '', materialGrade: src.materialGrade || '',
        packagingId: src.packagingId || '', packagingName: src.packagingName || '', packagingSize: src.packagingSize || '',
        useGlobalRate: useGlobal,
        laborRatePct: useGlobal ? rate : Number(src.laborRatePct) || 0,
        hasScene: src.hasScene === true,
        sceneCost: src.hasScene === true ? String(Number(src.sceneCost) || 0) : ''
      })
    }
    if (src && form.mode === 'edit') {
      const name = String(src.skuName || '')
      Object.assign(form, {
        id: src._id,
        name,
        nameTouched: name !== autoNameOf(src),
        note: src.note || '',
        status: src.status === 'inactive' ? 'inactive' : 'active',
        needsReview: src.needsReview === true,
        importBatch: src.importBatch || '',
        refsLoading: true
      })
    }
    form.namePlaceholder = form.materialName && form.packagingName ? autoNameOf(form) : '留空即自动生成'
    this.setData({ skuEdit: form }, () => {
      if (form.materialName && form.packagingName) this.previewSkuEdit()
      if (form.mode === 'edit') this.loadSkuRefs()
    })
  },

  openSkuCreate() {
    if (!this.data.pricingEnabled && this.data.settleLoaded) {
      this.setData({ 'skuCat.tipTone': 'warn', 'skuCat.tip': '算价未启用：SKU 可以先建，单价会显示「待核价」' })
    }
    this.openSkuEditor({ mode: 'create', origin: 'catalog' })
  },

  openSkuDetail(e) {
    const id = String((e.currentTarget.dataset || {}).id || '')
    const row = (this._skuAll || []).find((s) => s._id === id)
    if (!row) return
    this.openSkuEditor({ mode: 'edit', origin: 'catalog', source: row })
  },

  copySkuEdit() {
    const f = this.data.skuEdit
    if (f.saving || f.busy) return
    this.openSkuEditor({ mode: 'create', origin: 'catalog', source: Object.assign({}, f, { laborRatePct: f.useGlobalRate ? null : f.laborRatePct }) })
    this.setData({ 'skuEdit.tip': '已复制组成：改一下原材料 / 包装 / 造景再保存（同一组合不能重复）', 'skuEdit.tipTone': 'info' })
  },

  closeSkuEdit() {
    if (this.data.skuEdit.saving || this.data.skuEdit.busy) return
    this.setData({ 'skuEdit.show': false })
  },

  loadSkuRefs() {
    const id = this.data.skuEdit.id
    if (!id) return Promise.resolve()
    this.setData({ 'skuEdit.refsLoading': true, 'skuEdit.refsError': '' })
    return callCloud(SHIPMENT_FN, { action: 'skuAdmin.refs', id })
      .then((r) => {
        if (this.data.skuEdit.id !== id) return
        const refs = (r.refs || {})[id] || null
        const m = r.meta || {}
        const bits = []
        if (m.updatedAt) bits.push(`最近修改 ${formatTs(m.updatedAt)}${m.updatedBy ? ' · ' + m.updatedBy : ''}`)
        if (m.reviewedAt) bits.push(`复核 ${formatTs(m.reviewedAt)}${m.reviewedBy ? ' · ' + m.reviewedBy : ''}`)
        this.setData({ 'skuEdit.refsLoading': false, 'skuEdit.refs': refs, 'skuEdit.refsText': refsLine(refs), 'skuEdit.metaText': bits.join('；') })
      })
      .catch((e) => {
        this.setData({ 'skuEdit.refsLoading': false, 'skuEdit.refsError': formatCloudFnError(e, '引用情况未能取回') })
      })
  },

  onSkuEditName(e) {
    const name = String(e.detail.value || '')
    this.setData({ 'skuEdit.name': name, 'skuEdit.nameTouched': !!name.trim() })
  },

  onSkuEditNote(e) {
    this.setData({ 'skuEdit.note': String(e.detail.value || '') })
  },

  onSkuEditRateToggle(e) {
    this.setData({ 'skuEdit.useGlobalRate': !!e.detail.value }, () => this.previewSkuEdit())
  },

  onSkuEditRate(e) {
    const v = Number(e.detail.value)
    this.setData({ 'skuEdit.laborRatePct': Number.isFinite(v) ? v : 0 }, () => this.previewSkuEdit())
  },

  onSkuEditSceneToggle(e) {
    const hasScene = !!(e.detail && e.detail.value)
    this.setData({ 'skuEdit.hasScene': hasScene, 'skuEdit.sceneCost': hasScene ? this.data.skuEdit.sceneCost : '' }, () => this.previewSkuEdit())
  },

  onSkuEditSceneCost(e) {
    this.setData({ 'skuEdit.sceneCost': String((e.detail && e.detail.value) || '') }, () => this.previewSkuEdit())
  },

  /** 实时算价：与开单同一个 quotePrice；只显示，不落库 */
  previewSkuEdit() {
    const f = this.data.skuEdit
    const patch = { 'skuEdit.namePlaceholder': f.materialName && f.packagingName ? autoNameOf(f) : '留空即自动生成' }
    if (!f.materialName || !f.packagingName) {
      this.setData(Object.assign(patch, { 'skuEdit.unitPriceText': '—', 'skuEdit.pricingStatus': '', 'skuEdit.pricingNote': '请先选原材料与包装方式', 'skuEdit.breakdown': '' }))
      return Promise.resolve()
    }
    this.setData(patch)
    const line = {
      itemName: f.name || autoNameOf(f),
      qty: 1,
      materialId: f.materialId, materialName: f.materialName, materialGrade: f.materialGrade,
      packagingId: f.packagingId, packagingName: f.packagingName, packagingSize: f.packagingSize,
      sceneCost: f.hasScene ? (Number(f.sceneCost) || 0) : 0
    }
    if (!f.useGlobalRate) line.laborRatePct = Number(f.laborRatePct) || 0
    return callCloud(SHIPMENT_FN, { action: 'quotePrice', laborRatePct: this.data.globalRatePct, lines: [line] })
      .then((r) => {
        if (r.enabled === false) {
          this.setData({ 'skuEdit.unitPriceText': '待核价', 'skuEdit.pricingStatus': 'disabled', 'skuEdit.pricingNote': r.msg || '算价未启用', 'skuEdit.breakdown': '' })
          return
        }
        const q = (r.lines || [])[0] || {}
        const priced = q.pricingStatus === 'priced'
        const bits = priced
          ? [
              `原材料 ${centsText(q.unitMaterialCostCents)}`,
              `包装 ${centsText(q.unitPackagingCostCents)}`,
              `手工费 ${centsText(q.unitLaborCostCents)}（${q.laborRatePct}%）`
            ].concat(Number(q.unitSceneCostCents) ? [`造景 ${centsText(q.unitSceneCostCents)}`] : [])
          : []
        this.setData({
          'skuEdit.pricingStatus': q.pricingStatus || 'unmatched',
          'skuEdit.pricingNote': q.pricingNote || '',
          'skuEdit.unitPriceText': priced ? '¥' + yuan(Math.round(q.unitPrice * 100)) : '待核价',
          'skuEdit.breakdown': bits.join(' · ')
        })
      })
      .catch((e) => this.setData({ 'skuEdit.pricingNote': formatCloudFnError(e, '试算失败') }))
  },

  submitSkuEdit() {
    const f = this.data.skuEdit
    if (!this.data.isSuper || f.saving || f.busy) return
    if (!f.materialName) return this.setData({ 'skuEdit.problems': ['请选择原材料'] })
    if (!f.packagingName) return this.setData({ 'skuEdit.problems': ['请选择包装方式'] })
    const sceneRaw = String(f.sceneCost == null ? '' : f.sceneCost).trim()
    if (f.hasScene && (sceneRaw === '' || !Number.isFinite(Number(sceneRaw)) || Number(sceneRaw) < 0)) {
      return this.setData({ 'skuEdit.problems': ['勾了造景就必须填「造景成本」（元/件；不额外计价可填 0）'] })
    }
    const isEdit = f.mode === 'edit' && !!f.id
    const item = {
      materialId: f.materialId, materialName: f.materialName, materialGrade: f.materialGrade,
      packagingId: f.packagingId, packagingName: f.packagingName, packagingSize: f.packagingSize,
      hasScene: f.hasScene === true,
      sceneCost: f.hasScene ? Number(sceneRaw) : 0,
      note: String(f.note || '').trim(),
      skuName: f.nameTouched ? String(f.name || '').trim() : ''
    }
    // 编辑是部分更新：要回到全局费率必须显式送 null
    if (!f.useGlobalRate) item.laborRatePct = Number(f.laborRatePct) || 0
    else if (isEdit) item.laborRatePct = null
    this.setData({ 'skuEdit.saving': true, 'skuEdit.problems': [] })
    const req = isEdit
      ? callCloud(SETTLEMENT_FN, { action: 'sku.update', id: f.id, item })
      : callCloud(SETTLEMENT_FN, { action: 'sku.create', item })
    return req
      .then((r) => {
        if (r.ok === false) {
          const dup = r.duplicate
          this.setData({
            'skuEdit.saving': false,
            'skuEdit.problems': [r.msg || '保存失败'].concat(dup ? [`已在目录里：${dup.skuName}`] : [])
          })
          return
        }
        this._skuAll = null
        if (!isEdit && f.origin === 'create') {
          const created = r.item || {}
          const lines = this.data.lines.slice()
          lines.push(this.skuLineFromCreated(created))
          this.setData({ 'skuEdit.saving': false, 'skuEdit.show': false, lines }, () => this.refreshLinePrices())
          return
        }
        const label = r.item && r.item.skuName ? `「${r.item.skuName}」` : ''
        this.setData({
          'skuEdit.saving': false,
          'skuEdit.show': false,
          'skuCat.tipTone': 'ok',
          'skuCat.tip': isEdit ? 'SKU 已保存：新开的单按新组成算价，已开的单不受影响' : `SKU 已创建${label}`
        })
        return this.loadSkuCatalog()
      })
      .catch((e) => {
        this.setData({ 'skuEdit.saving': false, 'skuEdit.problems': [formatCloudFnError(e, isEdit ? '保存 SKU 失败' : '创建 SKU 失败')] })
      })
  },

  /** 停用 / 启用：sku.update 只送 status（部分更新，不冲掉待复核标记） */
  toggleSkuEditStatus() {
    const f = this.data.skuEdit
    if (!this.data.isSuper || f.mode !== 'edit' || !f.id || f.busy || f.saving) return
    const next = f.status === 'inactive' ? 'active' : 'inactive'
    this.setData({ 'skuEdit.busy': true, 'skuEdit.tip': '', 'skuEdit.removeStep': '' })
    return callCloud(SETTLEMENT_FN, { action: 'sku.update', id: f.id, item: { status: next } })
      .then((r) => {
        if (r.ok === false) {
          this.setData({ 'skuEdit.busy': false, 'skuEdit.tipTone': 'warn', 'skuEdit.tip': r.msg || '操作失败' })
          return
        }
        this._skuAll = null
        this.setData({
          'skuEdit.busy': false,
          'skuEdit.status': next,
          'skuEdit.tipTone': 'ok',
          'skuEdit.tip': next === 'inactive' ? '已停用：开单选择器不再列出，已开的单据不受影响' : '已启用：开单时可以选到它'
        })
        return this.loadSkuCatalog()
      })
      .catch((e) => this.setData({ 'skuEdit.busy': false, 'skuEdit.tipTone': 'warn', 'skuEdit.tip': formatCloudFnError(e, '操作失败') }))
  },

  markSkuEditReviewed() {
    const f = this.data.skuEdit
    if (!this.data.isSuper || !f.id || !f.needsReview || f.busy || f.saving) return
    this.setData({ 'skuEdit.busy': true, 'skuEdit.tip': '' })
    return callCloud(SHIPMENT_FN, { action: 'skuAdmin.markReviewed', id: f.id })
      .then((r) => {
        this._skuAll = null
        this.setData({ 'skuEdit.busy': false, 'skuEdit.needsReview': false, 'skuEdit.tipTone': 'ok', 'skuEdit.tip': r.msg || '已标记为复核通过' })
        this.loadSkuRefs()
        return this.loadSkuCatalog()
      })
      .catch((e) => this.setData({ 'skuEdit.busy': false, 'skuEdit.tipTone': 'warn', 'skuEdit.tip': formatCloudFnError(e, '标记失败') }))
  },

  /** 删除第一步：行内确认（不用原生弹窗）；有引用直接说明只能停用 */
  askRemoveSkuEdit() {
    const f = this.data.skuEdit
    if (!this.data.isSuper || !f.id || f.busy) return
    if (f.refs && f.refs.total > 0) {
      this.setData({ 'skuEdit.removeStep': 'blocked', 'skuEdit.blockedText': `已被引用（${f.refsText}），不能删除；可以改为停用` })
      return
    }
    this.setData({ 'skuEdit.removeStep': f.removeStep === 'confirm' ? '' : 'confirm' })
  },

  cancelRemoveSkuEdit() {
    this.setData({ 'skuEdit.removeStep': '' })
  },

  confirmRemoveSkuEdit() {
    const f = this.data.skuEdit
    if (!this.data.isSuper || !f.id || f.busy) return
    this.setData({ 'skuEdit.busy': true })
    return callCloud(SHIPMENT_FN, { action: 'skuAdmin.removeIfUnused', id: f.id })
      .then(() => {
        this._skuAll = null
        this.setData({ 'skuEdit.busy': false, 'skuEdit.show': false, 'skuCat.tipTone': 'ok', 'skuCat.tip': '已删除（没有任何单据或草稿引用它）' })
        return this.loadSkuCatalog()
      })
      .catch((e) => {
        if (e && e.code === 'IN_USE') {
          const refs = (e.result && e.result.refs) || f.refs
          this.setData({ 'skuEdit.busy': false, 'skuEdit.refs': refs, 'skuEdit.refsText': refsLine(refs), 'skuEdit.removeStep': 'blocked', 'skuEdit.blockedText': e.message })
          return
        }
        this.setData({ 'skuEdit.busy': false, 'skuEdit.removeStep': '', 'skuEdit.tipTone': 'warn', 'skuEdit.tip': formatCloudFnError(e, '删除失败') })
      })
  },

  deactivateBlockedSku() {
    this.setData({ 'skuEdit.removeStep': '' })
    if (this.data.skuEdit.status !== 'inactive') this.toggleSkuEditStatus()
  }
}

module.exports = { data, methods, skuImpactOf, impactText }
