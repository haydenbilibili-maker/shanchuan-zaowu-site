/**
 * 出货中心 · 开单：选 SKU（仅超管）/ 粘贴识别 / 单条补录。
 * ① 客户端不算钱（单价只来自云函数，取不到显示「待核价」）② 无原生弹窗 ③ SKU 开单只送 skuId + 数量。
 * 成功后交给核心 revealAfterWrite。
 */
const { formatCloudFnError } = require('../../utils/memberScan')
const { SHIPMENT_FN, SETTLEMENT_FN, callCloud, money, yuan, todayStr } = require('./shared')
const { railUrl } = require('../../../../utils/imageUrl')

const EDIT_DRAFT_KEY = 'shipment_edit_draft_v1'
const EDIT_PAGE = '/subpackages/extra/shipment-edit/index'

function mapSkuForPicker(s, globalRatePct) {
  const useGlobal = s.useGlobalRate !== false && (s.laborRatePct === null || s.laborRatePct === undefined)
  const rateLabel = useGlobal ? `用全局 ${globalRatePct}%` : `${s.laborRatePct}%`
  const priced = s.pricingStatus === 'priced' && s.unitPrice !== null && s.unitPrice !== undefined
  return {
    _id: s._id,
    skuName: s.skuName,
    materialId: s.materialId,
    materialName: s.materialName,
    materialGrade: s.materialGrade,
    packagingId: s.packagingId,
    packagingName: s.packagingName,
    packagingSize: s.packagingSize,
    hasScene: s.hasScene === true,
    sceneCost: Number(s.sceneCost) || 0,
    useGlobalRate: useGlobal,
    laborRatePct: useGlobal ? null : (Number(s.laborRatePct) || 0),
    unitPrice: priced ? s.unitPrice : null,
    unitPriceText: priced ? '¥' + yuan(Math.round(s.unitPrice * 100)) : '待核价',
    rateText: rateLabel + (s.hasScene === true ? ' · 造景' : ''),
    pricingStatus: s.pricingStatus,
    pricingNote: s.pricingNote || '',
    needsReview: s.needsReview === true
  }
}

function skuLineFrom(sku, globalRatePct) {
  return {
    skuId: sku._id,
    skuName: sku.skuName,
    materialId: sku.materialId,
    materialName: sku.materialName,
    materialGrade: sku.materialGrade,
    packagingId: sku.packagingId,
    packagingName: sku.packagingName,
    packagingSize: sku.packagingSize,
    hasScene: sku.hasScene === true,
    sceneCost: Number(sku.sceneCost) || 0,
    skuSceneCost: Number(sku.sceneCost) || 0,
    qty: 1,
    unitPrice: sku.unitPrice === undefined ? null : sku.unitPrice,
    unitPriceText: sku.unitPriceText || '待核价',
    pricingStatus: sku.pricingStatus || '',
    pricingNote: sku.pricingNote || '',
    useLineRate: false,
    laborRatePct: globalRatePct,
    rateSource: sku.useGlobalRate === false ? 'sku' : 'shipment',
    effectiveRatePct: sku.useGlobalRate === false ? sku.laborRatePct : null
  }
}

function blankSingle() {
  return {
    itemName: '',
    spec: '',
    category: '',
    qty: '1',
    unitPrice: '',
    buyerName: '',
    customerName: '',
    expressCompany: '',
    trackingNo: '',
    note: '',
    productId: '',
    skuId: '',
    inventoryRecordId: '',
    linkedLabel: '',
    materialId: '',
    materialName: '',
    materialGrade: '',
    packagingId: '',
    packagingName: '',
    packagingSize: ''
  }
}

function blankSkuForm(globalRatePct) {
  return {
    show: false,
    saving: false,
    materialId: '', materialName: '', materialGrade: '',
    packagingId: '', packagingName: '', packagingSize: '',
    useGlobalRate: true, laborRatePct: globalRatePct,
    hasScene: false, sceneCost: '',
    name: '', nameTouched: false,
    unitPriceText: '—', pricingStatus: '', pricingNote: '', problems: []
  }
}

const data = {
  createMode: '',
  createTip: '',
  createTipTone: 'info',
  createBusy: false,
  saving: false,

  /** 客户 + 出货日：SKU 与单条共用一份（原来两页各录一遍） */
  draft: { storeIndex: 0, shipmentDate: '', note: '' },

  settleLoaded: false,
  pricingEnabled: false,
  globalRatePct: 30,

  lines: [],
  totalText: '¥0.00',
  totalQty: 0,
  pendingCount: 0,
  canSave: false,
  saveHint: '',

  skuPicker: { show: false, target: '', keyword: '', loading: false, list: [], total: 0, reviewOnly: false, reviewCount: 0 },
  skuForm: blankSkuForm(30),
  /** 原材料 / 包装选择器：target = skuForm（新建 SKU）| single（单条补录的可选字段） */
  picker: { show: false, kind: 'material', target: 'skuForm', keyword: '', loading: false, list: [], expandedKey: '' },

  pasteText: '',
  parsing: false,
  parsePreview: null,
  failedLines: [],

  single: blankSingle(),
  singleMoreOpen: false,
  formCategoryIndex: 0,
  formCategoryNames: ['不选', '工具', '藏品'],
  formCategoryValues: ['', '工具', '藏品'],
  formStatusIndex: 0,
  formStatusNames: ['已确认'],
  formStatusValues: ['confirmed'],
  formAmountPreview: '',
  itemKeyword: '',
  itemHits: [],
  itemSearching: false
}

const methods = {
  /** 进入开单页签：定模式（店长没有 SKU 模式），SKU 模式首次拉算价开关 */
  enterCreate(mode) {
    const want = String(mode || this.data.createMode || (this.data.isSuper ? 'sku' : 'paste'))
    const next = ['sku', 'paste', 'single'].indexOf(want) !== -1 ? want : 'paste'
    const safe = next === 'sku' && !this.data.isSuper ? 'paste' : next
    const patch = { createMode: safe }
    if (!this.data.draft.shipmentDate) patch['draft.shipmentDate'] = todayStr()
    this.setData(patch)
    if (safe === 'sku' && !this.data.settleLoaded) this.loadSettleMeta()
  },

  switchCreateMode(e) {
    const mode = String((e.currentTarget.dataset || {}).mode || '')
    if (!mode || mode === this.data.createMode) return
    this.setData({ createTip: '', createTipTone: 'info' })
    this.enterCreate(mode)
  },

  loadSettleMeta() {
    return callCloud(SETTLEMENT_FN, { action: 'meta' })
      .then((settle) => {
        const config = (settle && settle.config) || {}
        const pricingEnabled = config.enabled === true
        const globalRatePct = Number(config.laborRatePct) || 30
        this.syncDerived({
          settleLoaded: true,
          pricingEnabled,
          globalRatePct,
          'skuForm.laborRatePct': globalRatePct,
          createTipTone: pricingEnabled ? 'info' : 'warn',
          createTip: pricingEnabled
            ? ''
            : '算价未启用：请先在 ERP「价目表配置 → 费率与规则」里打开开关（打开前单价都会是「待核价」）；可先用「粘贴识别」或「单条补录」'
        })
      })
      .catch((e) => {
        this.setData({ createTipTone: 'warn', createTip: formatCloudFnError(e, '算价配置未能取回') })
      })
  },

  onDraftStore(e) {
    this.syncDerived({ 'draft.storeIndex': Number(e.detail.value) || 0 })
  },

  onDraftDate(e) {
    this.setData({ 'draft.shipmentDate': e.detail.value || '' })
  },

  onDraftNote(e) {
    this.setData({ 'draft.note': String(e.detail.value || '') })
  },

  currentStore() {
    return (this.data.stores || [])[this.data.draft.storeIndex] || null
  },

  // SKU 模式（仅超管）

  syncDerived(extra) {
    const pick = (k, fallback) => (extra && extra[k] !== undefined ? extra[k] : fallback)
    const lines = pick('lines', this.data.lines)
    const pricingEnabled = pick('pricingEnabled', this.data.pricingEnabled)
    const busy = pick('createBusy', this.data.createBusy)
    const storeIndex = pick('draft.storeIndex', this.data.draft.storeIndex)
    const store = (this.data.stores || [])[storeIndex]
    const pendingCount = lines.filter((l) => l.pricingStatus !== 'priced').length
    let saveHint = ''
    let canSave = false
    if (busy) saveHint = '处理中…'
    else if (!pricingEnabled) saveHint = '算价未启用，无法按 SKU 开单'
    else if (!store) saveHint = '请先选择客户'
    else if (!lines.length) saveHint = '请至少添加一个 SKU'
    else if (pendingCount > 0) saveHint = `还有 ${pendingCount} 行待核价`
    else canSave = true
    this.setData(Object.assign({}, extra || {}, { pendingCount, canSave, saveHint }))
  },

  openSkuPicker() {
    if (!this.data.pricingEnabled) {
      this.setData({ createTipTone: 'warn', createTip: '算价未启用，先打开 ERP 价目表开关再选 SKU' })
      return
    }
    this.setData({ 'skuPicker.show': true, 'skuPicker.target': '', 'skuPicker.keyword': '', 'skuPicker.list': [], 'skuPicker.reviewOnly': false }, () => this.searchSkuCatalog(''))
  },

  toggleSkuReviewOnly() {
    this.setData({ 'skuPicker.reviewOnly': !this.data.skuPicker.reviewOnly }, () => this.searchSkuCatalog(this.data.skuPicker.keyword))
  },

  closeSkuPicker() {
    this.setData({ 'skuPicker.show': false, 'skuPicker.target': '' })
  },

  onSkuKeyword(e) {
    const keyword = String(e.detail.value || '')
    this.setData({ 'skuPicker.keyword': keyword })
    if (this._skuTimer) clearTimeout(this._skuTimer)
    this._skuTimer = setTimeout(() => this.searchSkuCatalog(keyword), 320)
  },

  searchSkuCatalog(keyword) {
    this.setData({ 'skuPicker.loading': true })
    const reviewOnly = this.data.skuPicker.reviewOnly === true
    return callCloud(SETTLEMENT_FN, { action: 'sku.list', keyword: keyword || '', status: 'active', limit: 100, reviewOnly })
      .then((r) => {
        const globalRatePct = Number(r.globalRatePct) || this.data.globalRatePct
        const list = (r.list || []).map((s) => mapSkuForPicker(s, globalRatePct))
        this.setData({
          'skuPicker.loading': false,
          'skuPicker.list': list,
          'skuPicker.total': r.total || list.length,
          'skuPicker.reviewCount': Number(r.reviewCount) || 0
        })
      })
      .catch((e) => {
        this.setData({ 'skuPicker.loading': false, 'skuPicker.list': [], createTipTone: 'warn', createTip: formatCloudFnError(e, 'SKU 加载失败') })
      })
  },

  onPickSku(e) {
    const id = String(e.currentTarget.dataset.id || '')
    if (this.data.skuPicker.target === 'memo') return this.onMemoSkuPicked(id)
    const sku = (this.data.skuPicker.list || []).find((s) => s._id === id)
    if (!sku) return
    const lines = this.data.lines.slice()
    const exist = lines.find((l) => l.skuId === id)
    if (exist) exist.qty += 1
    else lines.push(skuLineFrom(sku, this.data.globalRatePct))
    this.setData({ 'skuPicker.show': false, lines }, () => this.refreshLinePrices())
  },

  onQtyStep(e) {
    const i = Number(e.currentTarget.dataset.index)
    const d = Number(e.currentTarget.dataset.delta) || 0
    const lines = this.data.lines.slice()
    if (!lines[i]) return
    lines[i].qty = Math.max(1, Number(lines[i].qty) + d)
    this.setData({ lines }, () => this.refreshLinePrices())
  },

  onQtyInput(e) {
    const i = Number(e.currentTarget.dataset.index)
    const v = Number(e.detail.value)
    const lines = this.data.lines.slice()
    if (!lines[i]) return
    lines[i].qty = Number.isFinite(v) && v > 0 ? Math.floor(v) : 1
    this.setData({ lines }, () => this.refreshLinePrices())
  },

  onRemoveLine(e) {
    const i = Number(e.currentTarget.dataset.index)
    const lines = this.data.lines.slice()
    lines.splice(i, 1)
    this.setData({ lines }, () => this.refreshLinePrices())
  },

  onToggleLineRate(e) {
    const i = Number(e.currentTarget.dataset.index)
    const lines = this.data.lines.slice()
    if (!lines[i]) return
    lines[i].useLineRate = !!e.detail.value
    this.setData({ lines }, () => this.refreshLinePrices())
  },

  onLineRateInput(e) {
    const i = Number(e.currentTarget.dataset.index)
    const v = Number(e.detail.value)
    const lines = this.data.lines.slice()
    if (!lines[i]) return
    lines[i].laborRatePct = Number.isFinite(v) ? v : 0
    this.setData({ lines }, () => this.refreshLinePrices())
  },

  onLineSceneCost(e) {
    const i = Number(e.currentTarget.dataset.index)
    const lines = this.data.lines.slice()
    if (!lines[i]) return
    lines[i].sceneCost = String((e.detail && e.detail.value) || '')
    this.setData({ lines }, () => this.refreshLinePrices())
  },

  /** 行价重算：只送定价线索，落库时服务端再算一遍 */
  refreshLinePrices() {
    const lines = this.data.lines
    if (!lines.length) {
      this.syncDerived({ totalText: '¥0.00', totalQty: 0, lines: [] })
      return Promise.resolve()
    }
    this.setData({ createBusy: true })
    return callCloud(SHIPMENT_FN, {
      action: 'quotePrice',
      laborRatePct: this.data.globalRatePct,
      lines: lines.map((l) => {
        const out = {
          itemName: l.skuName,
          qty: Number(l.qty) || 1,
          materialId: l.materialId,
          materialName: l.materialName,
          materialGrade: l.materialGrade,
          packagingId: l.packagingId,
          packagingName: l.packagingName,
          packagingSize: l.packagingSize,
          sceneCost: l.hasScene === true ? (Number(l.sceneCost) || 0) : 0
        }
        if (l.useLineRate) out.laborRatePct = Number(l.laborRatePct) || 0
        return out
      })
    })
      .then((r) => {
        if (r.enabled === false) {
          this.syncDerived({ createBusy: false, pricingEnabled: false, createTipTone: 'warn', createTip: r.msg || '算价未启用' })
          return
        }
        const quoted = r.lines || []
        const next = lines.map((l, i) => {
          const q = quoted[i] || {}
          const priced = q.pricingStatus === 'priced'
          return Object.assign({}, l, {
            unitPrice: priced ? q.unitPrice : null,
            unitPriceText: priced ? '¥' + yuan(Math.round(q.unitPrice * 100)) : '待核价',
            lineTotalText: priced ? '¥' + yuan(q.lineTotalCents) : '—',
            lineTotalCents: priced ? q.lineTotalCents : null,
            pricingStatus: q.pricingStatus || 'unmatched',
            pricingNote: q.pricingNote || '',
            effectiveRatePct: q.laborRatePct === null || q.laborRatePct === undefined ? null : q.laborRatePct,
            rateSource: q.laborRateSource || ''
          })
        })
        const issueCount = next.filter((l) => l.pricingStatus !== 'priced').length
        this.syncDerived({
          createBusy: false,
          lines: next,
          totalText: '¥' + yuan(r.totalCents),
          totalQty: Number(r.totalQty) || 0,
          createTipTone: issueCount ? 'warn' : 'info',
          createTip: issueCount ? `有 ${issueCount} 行待核价（取不到价，不计入合计，也不能提交）` : ''
        })
      })
      .catch((e) => {
        this.syncDerived({ createBusy: false, totalText: '—', createTipTone: 'warn', createTip: formatCloudFnError(e, '算价失败') })
      })
  },

  openSkuForm() {
    if (!this.data.pricingEnabled) {
      this.setData({ createTipTone: 'warn', createTip: '算价未启用，先打开 ERP 价目表开关再建 SKU' })
      return
    }
    this.setData({ skuForm: Object.assign(blankSkuForm(this.data.globalRatePct), { show: true }) })
  },

  closeSkuForm() {
    this.setData({ 'skuForm.show': false })
  },

  onFormName(e) {
    this.setData({ 'skuForm.name': String(e.detail.value || ''), 'skuForm.nameTouched': true })
  },

  onFormRateToggle(e) {
    const useGlobal = !!e.detail.value
    this.setData({ 'skuForm.useGlobalRate': useGlobal }, () => this.previewSku())
  },

  onFormRate(e) {
    const v = Number(e.detail.value)
    this.setData({ 'skuForm.laborRatePct': Number.isFinite(v) ? v : 0 }, () => this.previewSku())
  },

  onFormSceneToggle(e) {
    const hasScene = !!(e.detail && e.detail.value)
    this.setData(
      { 'skuForm.hasScene': hasScene, 'skuForm.sceneCost': hasScene ? this.data.skuForm.sceneCost : '' },
      () => this.previewSku()
    )
  },

  onFormSceneCost(e) {
    this.setData({ 'skuForm.sceneCost': String((e.detail && e.detail.value) || '') }, () => this.previewSku())
  },

  previewSku() {
    const f = this.data.skuForm
    if (!f.materialName || !f.packagingName) {
      this.setData({ 'skuForm.unitPriceText': '—', 'skuForm.pricingStatus': '', 'skuForm.pricingNote': '请先选原材料与包装方式' })
      return Promise.resolve()
    }
    const line = {
      itemName: f.name || `${f.materialName} · ${f.packagingName}`,
      qty: 1,
      materialId: f.materialId, materialName: f.materialName, materialGrade: f.materialGrade,
      packagingId: f.packagingId, packagingName: f.packagingName, packagingSize: f.packagingSize,
      sceneCost: f.hasScene ? (Number(f.sceneCost) || 0) : 0
    }
    if (!f.useGlobalRate) line.laborRatePct = Number(f.laborRatePct) || 0
    return callCloud(SHIPMENT_FN, { action: 'quotePrice', laborRatePct: this.data.globalRatePct, lines: [line] })
      .then((r) => {
        const q = (r.lines || [])[0] || {}
        const priced = q.pricingStatus === 'priced'
        this.setData({
          'skuForm.pricingStatus': q.pricingStatus || 'unmatched',
          'skuForm.pricingNote': q.pricingNote || '',
          'skuForm.unitPriceText': priced ? '¥' + yuan(Math.round(q.unitPrice * 100)) : '待核价'
        })
      })
      .catch((e) => this.setData({ 'skuForm.pricingNote': formatCloudFnError(e, '试算失败') }))
  },

  submitSkuForm() {
    const f = this.data.skuForm
    if (f.saving) return
    if (!f.materialName) return this.setData({ 'skuForm.problems': ['请选择原材料'] })
    if (!f.packagingName) return this.setData({ 'skuForm.problems': ['请选择包装方式'] })
    const sceneRaw = String(f.sceneCost == null ? '' : f.sceneCost).trim()
    if (f.hasScene && (sceneRaw === '' || !Number.isFinite(Number(sceneRaw)) || Number(sceneRaw) < 0)) {
      return this.setData({ 'skuForm.problems': ['勾了造景就必须填「造景成本」（元/件；不额外计价可填 0）'] })
    }
    const item = {
      materialId: f.materialId, materialName: f.materialName, materialGrade: f.materialGrade,
      packagingId: f.packagingId, packagingName: f.packagingName, packagingSize: f.packagingSize,
      hasScene: f.hasScene === true,
      sceneCost: f.hasScene ? Number(sceneRaw) : 0
    }
    if (!f.useGlobalRate) item.laborRatePct = Number(f.laborRatePct) || 0
    if (f.nameTouched && f.name) item.skuName = f.name
    this.setData({ 'skuForm.saving': true, 'skuForm.problems': [] })
    callCloud(SETTLEMENT_FN, { action: 'sku.create', item })
      .then((r) => {
        if (r.ok === false) {
          const dup = r.duplicate
          this.setData({
            'skuForm.saving': false,
            'skuForm.problems': [r.msg || '创建失败'].concat(dup ? [`已在目录里：${dup.skuName}`] : [])
          })
          return
        }
        const created = r.item || {}
        const lines = this.data.lines.slice()
        lines.push(skuLineFrom(Object.assign({}, created, { unitPrice: null, unitPriceText: '待核价', pricingStatus: '' }), this.data.globalRatePct))
        this.setData({ 'skuForm.saving': false, 'skuForm.show': false, lines }, () => this.refreshLinePrices())
      })
      .catch((e) => {
        this.setData({ 'skuForm.saving': false, 'skuForm.problems': [formatCloudFnError(e, '创建 SKU 失败')] })
      })
  },

  onSaveSku() {
    if (this.data.createBusy) return
    if (!this.data.canSave) {
      this.setData({ createTipTone: 'warn', createTip: this.data.saveHint || '当前不可提交' })
      return
    }
    const store = this.currentStore()
    if (!store) {
      this.setData({ createTipTone: 'warn', createTip: '请选择客户' })
      return
    }
    const lines = this.data.lines
    const shipmentDate = this.data.draft.shipmentDate
    this.setData({ createBusy: true, createTipTone: 'info', createTip: '正在开单…' })
    callCloud(SHIPMENT_FN, {
      action: 'createFromSkus',
      storeId: store.id,
      shipmentDate,
      note: this.data.draft.note,
      lines: lines.map((l) => {
        const out = { skuId: l.skuId, qty: Number(l.qty) || 1 }
        if (l.useLineRate) out.laborRatePct = Number(l.laborRatePct) || 0
        if (l.hasScene && String(l.sceneCost) !== String(l.skuSceneCost == null ? '' : l.skuSceneCost)) {
          out.sceneCost = Number(l.sceneCost) || 0
        }
        return out
      })
    })
      .then((r) => {
        const item = r.item || {}
        const no = item.shipmentNo || r.id || ''
        this.syncDerived({
          createBusy: false,
          createTip: '',
          lines: [],
          totalText: '¥0.00',
          totalQty: 0,
          'draft.note': ''
        })
        return this.revealAfterWrite({
          msg: `已开单 ${no}` + (item.totalAmount !== undefined && item.totalAmount !== null ? ` · ¥${money(item.totalAmount)}` : ''),
          shipmentDate: item.shipmentDate || shipmentDate,
          created: r.item ? [r.item] : []
        })
      })
      .catch((e) => this.syncDerived({ createBusy: false, createTipTone: 'warn', createTip: formatCloudFnError(e, '保存失败，请重试') }))
  },

  // 原材料 / 包装选择器（新建 SKU 与单条补录共用）

  openPicker(e) {
    const ds = e.currentTarget.dataset || {}
    const kind = ds.kind === 'packaging' ? 'packaging' : 'material'
    const target = ds.target === 'single' ? 'single' : 'skuForm'
    this.setData({ picker: { show: true, kind, target, keyword: '', loading: true, list: [], expandedKey: '' } }, () =>
      this.searchPriceBook('')
    )
  },

  closePicker() {
    this.setData({ 'picker.show': false })
  },

  onPickerKeyword(e) {
    const keyword = String(e.detail.value || '')
    this.setData({ 'picker.keyword': keyword })
    if (this._pTimer) clearTimeout(this._pTimer)
    this._pTimer = setTimeout(() => this.searchPriceBook(keyword), 320)
  },

  searchPriceBook(keyword) {
    const kind = this.data.picker.kind
    this.setData({ 'picker.loading': true })
    return callCloud(SETTLEMENT_FN, { action: 'searchPriceBook', kind, keyword: keyword || '', limit: 30, orderBy: 'sort' })
      .then((r) => {
        const list = (r.list || []).map((g) => ({
          key: g.normName || g.name,
          name: g.name,
          displayName: g.displayName || g.name,
          thumb: g.image ? railUrl(g.image) : '',
          aliasesText: (g.aliases || []).join('、'),
          optionField: g.optionField,
          options: (g.options || []).map((o) => ({
            _id: o._id,
            option: o.option,
            unitPriceText: '¥' + yuan((Number(o.unitPrice) || 0) * 100),
            isDefault: !!o.isDefault
          })),
          optionCount: (g.options || []).length,
          singleOption: (g.options || []).length === 1
        }))
        this.setData({ 'picker.loading': false, 'picker.list': list, 'picker.expandedKey': list.length === 1 ? list[0].key : '' })
      })
      .catch((e) => {
        this.setData({ 'picker.loading': false, 'picker.list': [], createTipTone: 'warn', createTip: formatCloudFnError(e, '价目表加载失败') })
      })
  },

  onToggleGroup(e) {
    const key = String(e.currentTarget.dataset.key || '')
    this.setData({ 'picker.expandedKey': this.data.picker.expandedKey === key ? '' : key })
  },

  onPickOption(e) {
    const { kind, target } = this.data.picker
    const key = String(e.currentTarget.dataset.key || '')
    const option = String(e.currentTarget.dataset.option || '')
    const id = String(e.currentTarget.dataset.id || '')
    const group = (this.data.picker.list || []).find((g) => g.key === key)
    if (!group) return
    const patch = { 'picker.show': false }
    if (kind === 'material') {
      patch[`${target}.materialId`] = id
      patch[`${target}.materialName`] = group.name
      patch[`${target}.materialGrade`] = option
    } else {
      patch[`${target}.packagingId`] = id
      patch[`${target}.packagingName`] = group.name
      patch[`${target}.packagingSize`] = option
    }
    this.setData(patch, () => {
      if (target === 'skuForm') this.previewSku()
    })
  },

  clearSingleMaterial() {
    this.setData({ 'single.materialId': '', 'single.materialName': '', 'single.materialGrade': '' })
  },

  clearSinglePackaging() {
    this.setData({ 'single.packagingId': '', 'single.packagingName': '', 'single.packagingSize': '' })
  },

  // 粘贴识别

  decorateParsed(parsed) {
    if (!parsed) return null
    const shipments = (parsed.shipments || []).map((b) => Object.assign({}, b, { collapsed: !!b.collapsed }))
    return Object.assign({}, parsed, {
      canWrite: !!(parsed.canWrite || (parsed.ok && shipments.length && parsed.shipmentDate)),
      shipments,
      summary: parsed.summary || {
        storeCount: shipments.length,
        itemCount: shipments.reduce((n, b) => n + (b.items || []).length, 0),
        totalQty: shipments.reduce((n, b) => n + (Number(b.totalQty) || 0), 0)
      }
    })
  },

  recomputePreviewTotals(parsePreview) {
    if (!parsePreview || !parsePreview.shipments) return parsePreview
    const shipments = parsePreview.shipments.map((b) => {
      const items = b.items || []
      return Object.assign({}, b, { itemCount: items.length, totalQty: items.reduce((n, it) => n + (Number(it.qty) || 0), 0) })
    })
    return Object.assign({}, parsePreview, {
      shipments,
      canWrite: shipments.length > 0 && !!parsePreview.shipmentDate,
      summary: {
        shipmentDate: parsePreview.shipmentDate || '',
        storeCount: shipments.length,
        itemCount: shipments.reduce((n, b) => n + b.itemCount, 0),
        totalQty: shipments.reduce((n, b) => n + b.totalQty, 0)
      }
    })
  },

  onPasteInput(e) {
    this.setData({ pasteText: e.detail.value || '' })
  },

  clearPaste() {
    this.setData({ pasteText: '', parsePreview: null, failedLines: [], createTip: '' })
  },

  async runParse() {
    const text = String(this.data.pasteText || '').trim()
    if (!text) {
      this.setData({ createTipTone: 'warn', createTip: '请先粘贴出货文本' })
      return
    }
    this.setData({ parsing: true })
    try {
      const result = await callCloud(SHIPMENT_FN, { action: 'parseText', text })
      const parsed = this.decorateParsed(result.parsed || null)
      const failedLines = (parsed && parsed.failedLines) || []
      this.setData({ parsePreview: parsed, failedLines })
      if (!parsed || !parsed.canWrite) {
        this.setData({
          createTipTone: 'warn',
          createTip:
            (failedLines[0] && failedLines[0].msg) ||
            (parsed && parsed.errors && parsed.errors[0] && parsed.errors[0].msg) ||
            '识别失败'
        })
      } else {
        this.setData({
          createTipTone: failedLines.length ? 'warn' : 'info',
          createTip: failedLines.length ? `可写，仍有 ${failedLines.length} 处问题行` : '识别成功：核对下方预览后点「确认写入」'
        })
      }
    } catch (e) {
      this.setData({ createTipTone: 'warn', createTip: formatCloudFnError(e, '识别失败') })
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
      this.setData({ createTipTone: 'warn', createTip: '无法定位原行' })
      return
    }
    const lines = String(this.data.pasteText || '').replace(/\r\n/g, '\n').split('\n')
    const lineIdx = Number(issue.line) - 1
    if (lineIdx < 0 || lineIdx >= lines.length) {
      this.setData({ createTipTone: 'warn', createTip: '行号已失效，请整段重贴' })
      return
    }
    lines[lineIdx] = String(issue.text || '').trim()
    this.setData({ pasteText: lines.join('\n') })
    this.runParse()
  },

  onPreviewDate(e) {
    const parsePreview = this.recomputePreviewTotals(
      Object.assign({}, this.data.parsePreview || {}, { shipmentDate: e.detail.value || '' })
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
    const block = parsePreview.shipments && parsePreview.shipments[storeIdx]
    if (!block || !block.items[itemIdx]) return
    block.items[itemIdx].itemName = e.detail.value || ''
    this.setData({ parsePreview: this.recomputePreviewTotals(parsePreview) })
  },

  onPreviewItemQty(e) {
    const storeIdx = Number(e.currentTarget.dataset.storeIdx)
    const itemIdx = Number(e.currentTarget.dataset.itemIdx)
    const parsePreview = JSON.parse(JSON.stringify(this.data.parsePreview || {}))
    const block = parsePreview.shipments && parsePreview.shipments[storeIdx]
    if (!block || !block.items[itemIdx]) return
    const qty = parseInt(e.detail.value, 10)
    block.items[itemIdx].qty = Number.isFinite(qty) && qty > 0 ? qty : 1
    this.setData({ parsePreview: this.recomputePreviewTotals(parsePreview) })
  },

  /**
   * 逐行核对页 shipment-edit：草稿走 Storage（长 JSON 放 query 会截断）；那边保存后删草稿，onShow 据此收口。
   */
  openEditPage() {
    const preview = this.data.parsePreview
    if (!preview || !preview.canWrite) return
    const shipments = Array.isArray(preview.shipments) ? preview.shipments : []
    const lines = []
    for (const block of shipments) {
      for (const it of block.items || []) {
        lines.push({
          itemName: it.itemName,
          qty: Number(it.qty) || 1,
          pricingHint: {},
          storeId: block.storeId,
          storeName: block.storeName
        })
      }
    }
    if (!lines.length) return
    try {
      wx.setStorageSync(EDIT_DRAFT_KEY, {
        shipmentDate: preview.shipmentDate || '',
        storeId: shipments[0].storeId || '',
        storeName: shipments[0].storeName || '',
        laborRatePct: 30,
        rawText: preview.rawText || '',
        batchId: '',
        lines
      })
    } catch (e) {
      this.setData({ createTipTone: 'warn', createTip: '草稿写入失败，请重试' })
      return
    }
    this._awaitEdit = { shipmentDate: preview.shipmentDate || '' }
    wx.navigateTo({ url: EDIT_PAGE })
  },

  /** 从逐行核对页返回：草稿已被消费 = 那边保存成功 */
  consumeEditReturn() {
    const pending = this._awaitEdit
    if (!pending) return
    this._awaitEdit = null
    let draft = null
    try {
      draft = wx.getStorageSync(EDIT_DRAFT_KEY)
    } catch (e) {
      draft = null
    }
    if (draft) return
    this.setData({ pasteText: '', parsePreview: null, failedLines: [] })
    this.revealAfterWrite({ msg: '已按逐行核对写入出货单', shipmentDate: pending.shipmentDate, created: [] })
  },

  async confirmPaste() {
    const parsePreview = this.data.parsePreview
    if (this.data.saving) return
    if (!parsePreview || !parsePreview.canWrite) {
      this.setData({ createTipTone: 'warn', createTip: '请先识别出可写明细' })
      return
    }
    this.setData({ saving: true })
    try {
      const result = await callCloud(SHIPMENT_FN, {
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
      this.setData({ pasteText: '', parsePreview: null, failedLines: [], createTip: '' })
      await this.revealAfterWrite({
        msg: result.msg || `已写入 ${created} 单（粘贴识别）` + (failed ? `，失败 ${failed}` : ''),
        shipmentDate: parsePreview.shipmentDate,
        created: result.list || []
      })
    } catch (e) {
      this.setData({ createTipTone: 'warn', createTip: formatCloudFnError(e, '写入失败') })
    } finally {
      this.setData({ saving: false })
    }
  },

  // 单条补录

  resetSingle() {
    const statusValues = this.data.formStatusValues || ['confirmed']
    this.setData({
      single: blankSingle(),
      formCategoryIndex: 0,
      formStatusIndex: Math.max(0, statusValues.indexOf('confirmed')),
      formAmountPreview: '',
      itemKeyword: '',
      itemHits: []
    })
  },

  toggleSingleMore() {
    this.setData({ singleMoreOpen: !this.data.singleMoreOpen })
  },

  refreshFormAmountPreview() {
    const f = this.data.single || {}
    const qty = Number(f.qty)
    const price = Number(f.unitPrice)
    if (!f.unitPrice || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price) || price < 0) {
      this.setData({ formAmountPreview: '' })
      return
    }
    this.setData({ formAmountPreview: money(Math.round(qty * price * 100) / 100) })
  },

  onSingleInput(e) {
    const field = String((e.currentTarget.dataset || {}).field || '')
    if (!field) return
    this.setData({ [`single.${field}`]: e.detail.value || '' }, () => {
      if (field === 'qty' || field === 'unitPrice') this.refreshFormAmountPreview()
    })
  },

  onSingleCategory(e) {
    const idx = parseInt(e.detail.value, 10) || 0
    this.setData({ formCategoryIndex: idx, 'single.category': (this.data.formCategoryValues || [])[idx] || '' })
  },

  onSingleStatus(e) {
    this.setData({ formStatusIndex: parseInt(e.detail.value, 10) || 0 })
  },

  onItemKeyword(e) {
    this.setData({ itemKeyword: String((e.detail && e.detail.value) || '') })
  },

  async searchItem() {
    const keyword = String(this.data.itemKeyword || '').trim()
    if (!keyword) {
      this.setData({ createTipTone: 'warn', createTip: '请输入品名关键词' })
      return
    }
    if (this.data.itemSearching) return
    this.setData({ itemSearching: true })
    try {
      const result = await callCloud(SHIPMENT_FN, { action: 'searchSku', keyword, limit: 16 })
      const list = result.list || []
      this.setData({ itemHits: list, itemSearching: false })
      if (!list.length) this.setData({ createTipTone: 'warn', createTip: '未找到匹配藏品' })
    } catch (e) {
      this.setData({ itemSearching: false, createTipTone: 'warn', createTip: formatCloudFnError(e, '搜索失败') })
    }
  },

  selectItemHit(e) {
    const idx = Number((e.currentTarget.dataset || {}).idx)
    const hit = (this.data.itemHits || [])[idx]
    if (!hit) return
    const price = hit.unitPrice != null && Number(hit.unitPrice) > 0 ? String(hit.unitPrice) : ''
    const linkedBits = [hit.sourceLabel, hit.spec, hit.skuId].filter(Boolean)
    this.setData(
      {
        'single.itemName': hit.itemName || '',
        'single.spec': hit.spec || '',
        'single.unitPrice': price || this.data.single.unitPrice || '',
        'single.productId': hit.productId || '',
        'single.skuId': hit.skuId || '',
        'single.inventoryRecordId': hit.inventoryRecordId || '',
        'single.linkedLabel': linkedBits.join(' · ') || hit.itemName || '',
        itemHits: [],
        createTipTone: 'info',
        createTip: '已带入品名'
      },
      () => this.refreshFormAmountPreview()
    )
  },

  async confirmSingle() {
    if (this.data.saving) return
    const f = this.data.single || {}
    const store = this.currentStore()
    if (!store) return this.setData({ createTipTone: 'warn', createTip: '请选择门店' })
    const shipmentDate = String(this.data.draft.shipmentDate || '').trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(shipmentDate)) return this.setData({ createTipTone: 'warn', createTip: '请选择出货日期' })
    const itemName = String(f.itemName || '').trim()
    if (!itemName) return this.setData({ createTipTone: 'warn', createTip: '请填写或选择品名' })
    const qty = Number(f.qty)
    if (!Number.isFinite(qty) || qty <= 0) return this.setData({ createTipTone: 'warn', createTip: '数量须大于 0' })
    const unitPrice = Number(f.unitPrice)
    const price = Number.isFinite(unitPrice) && unitPrice >= 0 ? unitPrice : 0
    const statusValue = (this.data.formStatusValues || [])[this.data.formStatusIndex] || 'confirmed'
    const trim = (v) => String(v || '').trim()
    const line = {
      itemName,
      spec: trim(f.spec),
      category: trim(f.category),
      qty,
      unitPrice: price,
      totalPrice: Math.round(qty * price * 100) / 100,
      productId: trim(f.productId),
      skuId: trim(f.skuId),
      inventoryRecordId: trim(f.inventoryRecordId)
    }
    // 可选原材料 / 包装（服务端按价目表核价）
    if (f.materialName) {
      line.materialId = f.materialId
      line.materialName = f.materialName
      line.materialGrade = f.materialGrade
    }
    if (f.packagingName) {
      line.packagingId = f.packagingId
      line.packagingName = f.packagingName
      line.packagingSize = f.packagingSize
    }
    this.setData({ saving: true })
    try {
      const createdRes = await callCloud(SHIPMENT_FN, {
        action: 'create',
        item: {
          storeId: store.id,
          shipmentDate,
          customerName: trim(f.customerName) || store.name,
          buyerName: trim(f.buyerName),
          category: trim(f.category),
          items: [line],
          unitPrice: price,
          inventoryRecordId: line.inventoryRecordId,
          productId: line.productId,
          skuId: line.skuId,
          expressCompany: trim(f.expressCompany),
          trackingNo: trim(f.trackingNo),
          note: trim(f.note) || trim(this.data.draft.note),
          status: statusValue,
          source: 'manual'
        }
      })
      this.resetSingle()
      this.setData({ createTip: '' })
      await this.revealAfterWrite({
        msg: '已写入 1 张出货单（单条补录）',
        shipmentDate,
        created: createdRes.item ? [createdRes.item] : []
      })
    } catch (e) {
      this.setData({ createTipTone: 'warn', createTip: formatCloudFnError(e, '写入失败') })
    } finally {
      this.setData({ saving: false })
    }
  }
}

module.exports = { data, methods }
