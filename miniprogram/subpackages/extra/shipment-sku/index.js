/**
 * 出货开单（SKU 化）—— 超管工作台入口
 *
 * 产品负责人 2026-09-19 改造：出货**不再粘贴文本解析**，改为**选「出货 SKU」开单**。
 * 本页与老入口（`shipment-ops` 的粘贴解析 + `shipment-edit` 逐行核对）**并存、不合并**。
 *
 * 动线：
 *   选客户 + 出货时间 → 加行（**选已有 SKU**，或**现场新建 SKU**）→ 填数量 → 看单价/小计
 *   → 底部常驻合计 → 保存（`manageStoreShipment.createFromSkus`）
 *
 * 三条与 `shipment-edit` 一致的硬约束：
 *   ① **客户端不算钱**：单价一律来自云函数（`sku.list` 现算 / `quotePrice` 试算）；
 *      取不到就显示"待核价"，**不给假数字**。
 *   ② **不用原生弹窗**：`check:dialog-ratchet` 冻结了 `wx.showToast`/`showModal` 数量（只许降），
 *      反馈一律走页内提示条 `tipText`。
 *   ③ 保存时**只送 skuId + 数量**：材料/包装由服务端从 SKU 集合查，前端伪造不了组合。
 */
const { guardStaffPage } = require('../utils/staffAuth')
const { formatCloudFnError } = require('../utils/memberScan')

const SHIPMENT_FN = 'manageStoreShipment'
const SETTLEMENT_FN = 'manageStudioSettlement'

function yuan(cents) {
  const n = Number(cents)
  if (!Number.isFinite(n)) return '—'
  return (Math.round(n) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function today() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

Page({
  data: {
    ready: false,
    busy: false,
    isSuper: false,

    stores: [],
    storeIndex: 0,
    storeName: '',
    shipmentDate: '',
    note: '',

    globalRatePct: 30,
    pricingEnabled: false,

    lines: [],
    totalText: '—',
    totalQty: 0,

    tipText: '',
    tipTone: 'info',

    /** 选已有 SKU */
    skuPicker: { show: false, keyword: '', loading: false, list: [], total: 0 },

    /** 现场新建 SKU */
    skuForm: {
      show: false,
      saving: false,
      materialId: '', materialName: '', materialGrade: '',
      packagingId: '', packagingName: '', packagingSize: '',
      useGlobalRate: true, laborRatePct: 30,
      name: '', nameTouched: false,
      unitPriceText: '—', pricingStatus: '', pricingNote: '', problems: []
    },

    /** 材料/包装选择器（供 skuForm 用） */
    picker: { show: false, kind: 'material', keyword: '', loading: false, list: [], expandedKey: '' }
  },

  onLoad() {
    guardStaffPage('manager').then((role) => {
      if (!role) return
      this.setData({ ready: true, shipmentDate: today() }, () => this.loadMeta())
    })
  },

  callFn(name, data) {
    return wx.cloud.callFunction({ name, data }).then((res) => {
      const r = (res && res.result) || {}
      if (r.success === false) throw new Error(r.msg || '请求失败')
      return r
    })
  },

  loadMeta() {
    this.setData({ busy: true })
    Promise.all([
      this.callFn(SHIPMENT_FN, { action: 'meta' }),
      this.callFn(SETTLEMENT_FN, { action: 'meta' })
    ])
      .then(([ship, settle]) => {
        const stores = ship.stores || []
        const config = (settle && settle.config) || {}
        this.setData({
          busy: false,
          stores,
          storeIndex: 0,
          storeName: (stores[0] && stores[0].name) || '',
          globalRatePct: Number(config.laborRatePct) || 30,
          pricingEnabled: config.enabled === true,
          tipTone: config.enabled === true ? 'info' : 'warn',
          tipText: config.enabled === true ? '' : '算价未启用：请先在 ERP「价目表配置 → 费率与规则」里打开',
          'skuForm.laborRatePct': Number(config.laborRatePct) || 30
        })
      })
      .catch((e) => this.setData({ busy: false, tipTone: 'warn', tipText: formatCloudFnError(e, '初始化失败') }))
  },

  onStoreChange(e) {
    const i = Number(e.detail.value) || 0
    const s = this.data.stores[i] || {}
    this.setData({ storeIndex: i, storeName: s.name || '' })
  },

  onDateChange(e) {
    this.setData({ shipmentDate: e.detail.value })
  },

  onNoteInput(e) {
    this.setData({ note: String(e.detail.value || '') })
  },

  // ───────────────── 选已有 SKU ─────────────────

  openSkuPicker() {
    this.setData({ 'skuPicker.show': true, 'skuPicker.keyword': '', 'skuPicker.list': [] }, () => this.searchSku(''))
  },

  closeSkuPicker() {
    this.setData({ 'skuPicker.show': false })
  },

  onSkuKeyword(e) {
    const keyword = String(e.detail.value || '')
    this.setData({ 'skuPicker.keyword': keyword })
    if (this._skuTimer) clearTimeout(this._skuTimer)
    this._skuTimer = setTimeout(() => this.searchSku(keyword), 320)
  },

  searchSku(keyword) {
    this.setData({ 'skuPicker.loading': true })
    return this.callFn(SETTLEMENT_FN, { action: 'sku.list', keyword: keyword || '', status: 'active', limit: 100 })
      .then((r) => {
        const list = (r.list || []).map((s) => ({
          _id: s._id,
          skuName: s.skuName,
          // ⚠️ 必须带上组合标识：加进明细后要交给 quotePrice 算价，
          //    只带 skuName 的话引擎只能拿 `大蓝闪蝶 A1 · 玻璃罩 20*10` 这串文本去猜 → 必然算不出
          materialId: s.materialId,
          materialName: s.materialName,
          materialGrade: s.materialGrade,
          packagingId: s.packagingId,
          packagingName: s.packagingName,
          packagingSize: s.packagingSize,
          unitPrice: s.unitPrice,
          unitPriceText: s.unitPrice === null || s.unitPrice === undefined ? '待核价' : '¥' + yuan(Math.round(s.unitPrice * 100)),
          rateText: s.useGlobalRate ? `用全局 ${r.globalRatePct}%` : `${s.laborRatePct}%`,
          pricingStatus: s.pricingStatus,
          pricingNote: s.pricingNote || ''
        }))
        this.setData({ 'skuPicker.loading': false, 'skuPicker.list': list, 'skuPicker.total': r.total || list.length })
      })
      .catch((e) => {
        this.setData({ 'skuPicker.loading': false, 'skuPicker.list': [], tipTone: 'warn', tipText: formatCloudFnError(e, 'SKU 加载失败') })
      })
  },

  onPickSku(e) {
    const id = String(e.currentTarget.dataset.id || '')
    const sku = (this.data.skuPicker.list || []).find((s) => s._id === id)
    if (!sku) return
    const lines = this.data.lines.slice()
    const exist = lines.find((l) => l.skuId === id)
    if (exist) {
      exist.qty += 1
    } else {
      lines.push({
        skuId: sku._id,
        skuName: sku.skuName,
        materialId: sku.materialId,
        materialName: sku.materialName,
        materialGrade: sku.materialGrade,
        packagingId: sku.packagingId,
        packagingName: sku.packagingName,
        packagingSize: sku.packagingSize,
        qty: 1,
        unitPrice: sku.unitPrice,
        unitPriceText: sku.unitPriceText,
        pricingStatus: sku.pricingStatus,
        pricingNote: sku.pricingNote,
        useLineRate: false,
        laborRatePct: this.data.globalRatePct,
        rateSource: sku.useGlobalRate ? 'shipment' : 'sku',
        effectiveRatePct: sku.useGlobalRate ? null : sku.laborRatePct
      })
    }
    this.setData({ 'skuPicker.show': false, lines }, () => this.refreshLinePrices())
  },

  onQtyStep(e) {
    const i = Number(e.currentTarget.dataset.index)
    const d = Number(e.currentTarget.dataset.delta) || 0
    const lines = this.data.lines.slice()
    lines[i].qty = Math.max(1, Number(lines[i].qty) + d)
    this.setData({ lines }, () => this.recomputeTotals())
  },

  onQtyInput(e) {
    const i = Number(e.currentTarget.dataset.index)
    const v = Number(e.detail.value)
    const lines = this.data.lines.slice()
    lines[i].qty = Number.isFinite(v) && v > 0 ? Math.floor(v) : 1
    this.setData({ lines }, () => this.recomputeTotals())
  },

  onRemoveLine(e) {
    const i = Number(e.currentTarget.dataset.index)
    const lines = this.data.lines.slice()
    lines.splice(i, 1)
    this.setData({ lines }, () => this.recomputeTotals())
  },

  onToggleLineRate(e) {
    const i = Number(e.currentTarget.dataset.index)
    const lines = this.data.lines.slice()
    lines[i].useLineRate = !!e.detail.value
    this.setData({ lines }, () => this.refreshLinePrices())
  },

  onLineRateInput(e) {
    const i = Number(e.currentTarget.dataset.index)
    const v = Number(e.detail.value)
    const lines = this.data.lines.slice()
    lines[i].laborRatePct = Number.isFinite(v) ? v : 0
    this.setData({ lines }, () => this.refreshLinePrices())
  },

  /**
   * 行价重算：把「当前选了什么」交给服务端算（客户端不算钱）。
   * 只送定价线索（skuId + 显式费率），不送价 —— 落库时服务端还会再算一遍。
   */
  refreshLinePrices() {
    const lines = this.data.lines
    if (!lines.length) {
      this.setData({ totalText: '¥0.00', totalQty: 0 })
      return Promise.resolve()
    }
    this.setData({ busy: true })
    return this.callFn(SHIPMENT_FN, {
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
          packagingSize: l.packagingSize
        }
        if (l.useLineRate) out.laborRatePct = Number(l.laborRatePct) || 0
        return out
      })
    })
      .then((r) => {
        if (r.enabled === false) {
          this.setData({ busy: false, tipTone: 'warn', tipText: r.msg || '算价未启用' })
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
        this.setData({
          busy: false,
          lines: next,
          totalText: '¥' + yuan(r.totalCents),
          totalQty: Number(r.totalQty) || 0,
          tipTone: issueCount ? 'warn' : 'info',
          tipText: issueCount ? `有 ${issueCount} 行待核价（这些行取不到价，不会计入合计）` : ''
        })
      })
      .catch((e) => {
        // 宁可空白也不给假数字
        this.setData({ busy: false, totalText: '—', tipTone: 'warn', tipText: formatCloudFnError(e, '算价失败') })
      })
  },

  recomputeTotals() {
    return this.refreshLinePrices()
  },

  // ───────────────── 现场新建 SKU ─────────────────

  openSkuForm() {
    this.setData({
      'skuForm.show': true,
      'skuForm.saving': false,
      'skuForm.materialId': '', 'skuForm.materialName': '', 'skuForm.materialGrade': '',
      'skuForm.packagingId': '', 'skuForm.packagingName': '', 'skuForm.packagingSize': '',
      'skuForm.useGlobalRate': true,
      'skuForm.laborRatePct': this.data.globalRatePct,
      'skuForm.name': '', 'skuForm.nameTouched': false,
      'skuForm.unitPriceText': '—', 'skuForm.pricingStatus': '', 'skuForm.pricingNote': '', 'skuForm.problems': []
    })
  },

  closeSkuForm() {
    this.setData({ 'skuForm.show': false })
  },

  onFormName(e) {
    this.setData({ 'skuForm.name': String(e.detail.value || ''), 'skuForm.nameTouched': true })
  },

  onFormRateToggle(e) {
    const useGlobal = !!e.detail.value
    this.setData({ 'skuForm.useGlobalRate': useGlobal })
    if (!useGlobal) this.previewSku()
  },

  onFormRate(e) {
    const v = Number(e.detail.value)
    this.setData({ 'skuForm.laborRatePct': Number.isFinite(v) ? v : 0 }, () => this.previewSku())
  },

  /** 打开材料/包装选择器（供新建 SKU 用） */
  openPicker(e) {
    const kind = e.currentTarget.dataset.kind === 'packaging' ? 'packaging' : 'material'
    this.setData({ picker: { show: true, kind, keyword: '', loading: true, list: [], expandedKey: '' } }, () =>
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
    return this.callFn(SETTLEMENT_FN, { action: 'searchPriceBook', kind, keyword: keyword || '', limit: 30 })
      .then((r) => {
        const list = (r.list || []).map((g) => ({
          key: g.normName || g.name,
          name: g.name,
          displayName: g.displayName || g.name,
          aliases: g.aliases || [],
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
        this.setData({
          'picker.loading': false,
          'picker.list': list,
          'picker.expandedKey': list.length === 1 ? list[0].key : ''
        })
      })
      .catch((e) => {
        this.setData({ 'picker.loading': false, 'picker.list': [], tipTone: 'warn', tipText: formatCloudFnError(e, '价目表加载失败') })
      })
  },

  onToggleGroup(e) {
    const key = String(e.currentTarget.dataset.key || '')
    this.setData({ 'picker.expandedKey': this.data.picker.expandedKey === key ? '' : key })
  },

  onPickOption(e) {
    const kind = this.data.picker.kind
    const key = String(e.currentTarget.dataset.key || '')
    const option = String(e.currentTarget.dataset.option || '')
    const id = String(e.currentTarget.dataset.id || '')
    const group = (this.data.picker.list || []).find((g) => g.key === key)
    if (!group) return
    const patch = { 'picker.show': false }
    if (kind === 'material') {
      patch['skuForm.materialId'] = id
      patch['skuForm.materialName'] = group.name
      patch['skuForm.materialGrade'] = option
    } else {
      patch['skuForm.packagingId'] = id
      patch['skuForm.packagingName'] = group.name
      patch['skuForm.packagingSize'] = option
    }
    this.setData(patch, () => this.previewSku())
  },

  /** 试算：把当前组合交给服务端算单价（客户端不算），并给出未核价原因 */
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
      packagingId: f.packagingId, packagingName: f.packagingName, packagingSize: f.packagingSize
    }
    if (!f.useGlobalRate) line.laborRatePct = Number(f.laborRatePct) || 0
    return this.callFn(SHIPMENT_FN, {
      action: 'quotePrice',
      laborRatePct: this.data.globalRatePct,
      lines: [line]
    })
      .then((r) => {
        const q = (r.lines || [])[0] || {}
        const priced = q.pricingStatus === 'priced'
        this.setData({
          'skuForm.pricingStatus': q.pricingStatus || 'unmatched',
          'skuForm.pricingNote': q.pricingNote || '',
          'skuForm.unitPriceText': priced ? '¥' + yuan(Math.round(q.unitPrice * 100)) : '待核价',
          'skuForm.effectiveRatePct': q.laborRatePct === null || q.laborRatePct === undefined ? null : q.laborRatePct
        })
      })
      .catch((e) => this.setData({ 'skuForm.pricingNote': formatCloudFnError(e, '试算失败') }))
  },

  submitSkuForm() {
    const f = this.data.skuForm
    if (!f.materialName) {
      this.setData({ 'skuForm.problems': ['请选择原材料'] })
      return
    }
    if (!f.packagingName) {
      this.setData({ 'skuForm.problems': ['请选择包装方式'] })
      return
    }
    const item = {
      materialId: f.materialId, materialName: f.materialName, materialGrade: f.materialGrade,
      packagingId: f.packagingId, packagingName: f.packagingName, packagingSize: f.packagingSize
    }
    if (!f.useGlobalRate) item.laborRatePct = Number(f.laborRatePct) || 0
    if (f.nameTouched && f.name) item.skuName = f.name
    this.setData({ 'skuForm.saving': true, 'skuForm.problems': [] })
    this.callFn(SETTLEMENT_FN, { action: 'sku.create', item })
      .then((r) => {
        if (r.ok === false) {
          // 服务端把"已存在的那个 SKU"带回来了 → 直接提示改它，不新建
          const dup = r.duplicate
          this.setData({
            'skuForm.saving': false,
            'skuForm.problems': [r.msg || '创建失败'].concat(dup ? [`已在目录里：${dup.skuName}`] : [])
          })
          return
        }
        const created = r.item || {}
        const lines = this.data.lines.slice()
        lines.push({
          skuId: created._id,
          skuName: created.skuName,
          materialId: created.materialId,
          materialName: created.materialName,
          materialGrade: created.materialGrade,
          packagingId: created.packagingId,
          packagingName: created.packagingName,
          packagingSize: created.packagingSize,
          qty: 1,
          unitPrice: null,
          unitPriceText: '待核价',
          pricingStatus: '',
          pricingNote: '',
          useLineRate: false,
          laborRatePct: this.data.globalRatePct
        })
        this.setData({ 'skuForm.saving': false, 'skuForm.show': false, lines }, () => this.refreshLinePrices())
      })
      .catch((e) => {
        this.setData({ 'skuForm.saving': false, 'skuForm.problems': [formatCloudFnError(e, '创建 SKU 失败')] })
      })
  },

  // ───────────────── 保存 ─────────────────

  onSave() {
    if (this.data.busy) return
    const lines = this.data.lines
    if (!lines.length) {
      this.setData({ tipTone: 'warn', tipText: '请至少添加一个 SKU' })
      return
    }
    const store = this.data.stores[this.data.storeIndex]
    if (!store) {
      this.setData({ tipTone: 'warn', tipText: '请选择客户' })
      return
    }
    this.setData({ busy: true, tipText: '正在保存…' })
    this.callFn(SHIPMENT_FN, {
      action: 'createFromSkus',
      storeId: store.id,
      shipmentDate: this.data.shipmentDate,
      note: this.data.note,
      lines: lines.map((l) => {
        const out = { skuId: l.skuId, qty: Number(l.qty) || 1 }
        if (l.useLineRate) out.laborRatePct = Number(l.laborRatePct) || 0
        return out
      })
    })
      .then((r) => {
        this.setData({ busy: false, tipTone: 'info', tipText: r.msg || '已开单' })
        setTimeout(() => wx.navigateBack({ delta: 1 }), 700)
      })
      .catch((e) => this.setData({ busy: false, tipTone: 'warn', tipText: formatCloudFnError(e, '保存失败，请重试') }))
  }
})
