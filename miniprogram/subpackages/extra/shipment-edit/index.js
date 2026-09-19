/**
 * 出货单 · 逐行核对与算价（蓝图裁决 24）
 *
 * 为什么单开一页而不是在 `shipment-ops` 的弹层里做：
 *   一单实测 21 行（真实样本），每行要放「材料 / 等级 / 包装 / 尺寸 / 手工费」5 个控件。
 *   弹层里屏幕不够，也没法滚动核对整单。
 *
 * 动线：`shipment-ops` 粘贴解析 → 把草稿写进 Storage → 本页逐行核对/修正 → 保存 → 返回。
 *
 * 三条硬约束（都不是随手定的）：
 *   ① **客户端不算钱**：任何金额都来自云函数 `quotePrice`（服务端用共享内核算）。
 *      断网/报错时**宁可空白也不给假数字**。
 *   ② **不用原生弹窗**：`check:dialog-ratchet` 冻结了 `wx.showToast`/`showModal` 数量（只许降），
 *      反馈一律走页内提示条（`tipText`）。
 *   ③ 草稿走 **Storage 而不是 URL**：21 行的 JSON 放进 `navigateTo` 的 query 会被长度限制截断。
 */
const { guardStaffPage } = require('../utils/staffAuth')
const { formatCloudFnError } = require('../utils/memberScan')

const SHIPMENT_FN = 'manageStoreShipment'
const SETTLEMENT_FN = 'manageStudioSettlement'
const DRAFT_KEY = 'shipment_edit_draft_v1'

const EMPTY_TOTALS = {
  materialCostCents: 0,
  packagingCostCents: 0,
  laborCostCents: 0,
  totalCents: 0,
  totalAmount: 0,
  issueCount: 0,
  pricedCount: 0,
  totalQty: 0,
  lineCount: 0
}

function yuan(cents) {
  const n = Number(cents)
  if (!Number.isFinite(n)) return '—'
  return (Math.round(n) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** 行上要送给云函数的定价线索（**只送"选了什么"，不送价**） */
function toQuoteLine(line) {
  const out = {
    itemName: line.itemName,
    qty: Number(line.qty) || 0
  }
  if (line.materialId || line.materialName) {
    out.materialId = line.materialId || ''
    out.materialName = line.materialName || ''
    if (line.materialGrade) out.materialGrade = line.materialGrade
  }
  if (line.packagingId || line.packagingName) {
    out.packagingId = line.packagingId || ''
    out.packagingName = line.packagingName || ''
    if (line.packagingSize) out.packagingSize = line.packagingSize
  }
  // 行级费率：只在用户真的勾了「本行单独设」时才送（0 是合法值，必须显式送）
  if (line.useLineRate) out.laborRatePct = Number(line.laborRatePct) || 0
  return out
}

/** 把引擎结果与"用户的选择 / 展示用派生字段"合成可渲染的行 */
function mergeQuoted(line, quoted) {
  const q = quoted || {}
  const next = Object.assign({}, line)
  next.pricingStatus = q.pricingStatus || 'unmatched'
  next.pricingNote = q.pricingNote || ''
  // 只在引擎给出结果时回填，避免把用户已选的线索抹掉（例如选了材料但还没选包装）
  if (q.materialId || q.materialName) {
    next.materialId = q.materialId || line.materialId || ''
    next.materialName = q.materialName || line.materialName || ''
    next.materialGrade = q.materialGrade || ''
  }
  if (q.packagingId || q.packagingName) {
    next.packagingId = q.packagingId || line.packagingId || ''
    next.packagingName = q.packagingName || line.packagingName || ''
    next.packagingSize = q.packagingSize || ''
  }
  next.materialCostCents = q.unitMaterialCostCents === null || q.unitMaterialCostCents === undefined ? null : q.unitMaterialCostCents
  next.packagingCostCents = q.unitPackagingCostCents === null || q.unitPackagingCostCents === undefined ? null : q.unitPackagingCostCents
  next.laborCostCents = q.unitLaborCostCents === null || q.unitLaborCostCents === undefined ? null : q.unitLaborCostCents
  next.lineTotalCents = q.lineTotalCents === null || q.lineTotalCents === undefined ? null : q.lineTotalCents
  next.unitPrice = q.unitPrice === null || q.unitPrice === undefined ? null : q.unitPrice
  next.totalPrice = q.totalPrice === null || q.totalPrice === undefined ? null : q.totalPrice
  next.effectiveRatePct = q.laborRatePct === null || q.laborRatePct === undefined ? null : q.laborRatePct
  next.rateSource = q.laborRateSource || ''
  // 展示用文案（客户端只做格式化，不做计算）
  next.materialCostText = next.materialCostCents === null ? '—' : '¥' + yuan(next.materialCostCents)
  next.packagingCostText = next.packagingCostCents === null ? '—' : '¥' + yuan(next.packagingCostCents)
  next.laborCostText = next.laborCostCents === null ? '—' : '¥' + yuan(next.laborCostCents)
  next.lineTotalText = next.lineTotalCents === null ? '待核价' : '¥' + yuan(next.lineTotalCents)
  next.materialLabel = next.materialName
    ? next.materialName + (next.materialGrade ? '（' + next.materialGrade + '）' : '')
    : '未选原材料'
  next.packagingLabel = next.packagingName
    ? next.packagingName + (next.packagingSize ? ' ' + next.packagingSize : '')
    : '未选包装方式'
  next.unmatched = next.pricingStatus !== 'priced'
  return next
}

Page({
  data: {
    ready: false,
    busy: false,
    shipmentDate: '',
    storeId: '',
    storeName: '',
    laborRatePct: 30,
    rawText: '',
    batchId: '',
    lines: [],
    totals: Object.assign({}, EMPTY_TOTALS),
    totalText: '—',
    materialText: '—',
    packagingText: '—',
    laborText: '—',
    tipText: '',
    tipTone: 'info',
    allPriced: false,
    /** 选择器弹层 */
    picker: {
      show: false,
      kind: 'material',
      lineIndex: -1,
      title: '',
      keyword: '',
      loading: false,
      list: [],
      expandedKey: ''
    }
  },

  onLoad() {
    guardStaffPage('manager').then((ok) => {
      if (!ok) return
      this.readDraft()
    })
  },

  onUnload() {
    // 离开即清草稿：避免下次进来看到上一单的残留
    try {
      wx.removeStorageSync(DRAFT_KEY)
    } catch (e) {
      /* 清不掉也不影响业务 */
    }
  },

  readDraft() {
    let draft = null
    try {
      draft = wx.getStorageSync(DRAFT_KEY)
    } catch (e) {
      draft = null
    }
    if (!draft || !Array.isArray(draft.lines) || !draft.lines.length) {
      this.setData({ ready: true, tipTone: 'warn', tipText: '没有待核对的出货单，请回到出货单页粘贴解析后再进来' })
      return
    }
    const lines = draft.lines.map((l, i) =>
      mergeQuoted(
        Object.assign(
          {
            index: i + 1,
            itemName: l.itemName,
            qty: Number(l.qty) || 1,
            materialId: '',
            materialName: '',
            materialGrade: '',
            packagingId: '',
            packagingName: '',
            packagingSize: '',
            useLineRate: false,
            laborRatePct: 30
          },
          l.pricingHint || {}
        ),
        l.quoted || null
      )
    )
    this.setData(
      {
        ready: true,
        shipmentDate: draft.shipmentDate || '',
        storeId: draft.storeId || '',
        storeName: draft.storeName || '',
        laborRatePct: Number(draft.laborRatePct) || 30,
        rawText: draft.rawText || '',
        batchId: draft.batchId || '',
        lines
      },
      () => this.runQuote()
    )
  },

  /** 唯一的取价入口：客户端一律不算钱 */
  runQuote() {
    if (this.data.busy) return Promise.resolve()
    const lines = this.data.lines
    if (!lines.length) return Promise.resolve()
    this.setData({ busy: true })
    return wx.cloud
      .callFunction({
        name: SHIPMENT_FN,
        data: {
          action: 'quotePrice',
          laborRatePct: this.data.laborRatePct,
          lines: lines.map(toQuoteLine)
        }
      })
      .then((res) => {
        const r = (res && res.result) || {}
        if (r.success === false) throw new Error(r.msg || '算价失败')
        if (r.enabled === false) {
          this.setData({ busy: false, allPriced: false, tipTone: 'warn', tipText: r.msg || '算价未启用' })
          return
        }
        this.applyQuote(r)
      })
      .catch((e) => {
        // 宁可空白也不给假数字
        this.setData({
          busy: false,
          allPriced: false,
          materialText: '—',
          packagingText: '—',
          laborText: '—',
          totalText: '—',
          tipTone: 'warn',
          tipText: formatCloudFnError(e, '算价失败，请检查网络后重试')
        })
      })
  },

  applyQuote(r) {
    const quoted = Array.isArray(r.lines) ? r.lines : []
    const lines = this.data.lines.map((line, i) => mergeQuoted(line, quoted[i]))
    const totals = {
      materialCostCents: Number(r.materialCostCents) || 0,
      packagingCostCents: Number(r.packagingCostCents) || 0,
      laborCostCents: Number(r.laborCostCents) || 0,
      totalCents: Number(r.totalCents) || 0,
      totalAmount: Number(r.totalAmount) || 0,
      issueCount: Number(r.issueCount) || 0,
      pricedCount: Number(r.pricedCount) || 0,
      totalQty: Number(r.totalQty) || 0,
      lineCount: Number(r.lineCount) || 0
    }
    const allPriced = totals.issueCount === 0 && totals.lineCount > 0
    const tip =
      totals.issueCount > 0
        ? `还有 ${totals.issueCount} 行待处理（点行内的「选原材料 / 选包装方式」补齐）`
        : `已全部核价 · ${totals.pricedCount} 行 · ${totals.totalQty} 件`
    this.setData({
      busy: false,
      lines,
      totals,
      allPriced,
      materialText: '¥' + yuan(totals.materialCostCents),
      packagingText: '¥' + yuan(totals.packagingCostCents),
      laborText: '¥' + yuan(totals.laborCostCents),
      totalText: '¥' + yuan(totals.totalCents),
      tipTone: totals.issueCount > 0 ? 'warn' : 'info',
      tipText: tip
    })
  },

  onShipmentRateInput(e) {
    const v = Number(e.detail.value)
    this.setData({ laborRatePct: Number.isFinite(v) ? v : 0, tipText: '' }, () => this.runQuote())
  },

  onQtyChange(e) {
    const i = Number(e.currentTarget.dataset.index)
    const v = Number(e.detail.value)
    const qty = Number.isFinite(v) && v > 0 ? Math.floor(v) : 1
    const key = 'lines[' + i + '].qty'
    this.setData({ [key]: qty }, () => this.runQuote())
  },

  onQtyStep(e) {
    const i = Number(e.currentTarget.dataset.index)
    const delta = Number(e.currentTarget.dataset.delta) || 0
    const cur = Number(this.data.lines[i].qty) || 1
    const next = Math.max(1, cur + delta)
    this.setData({ ['lines[' + i + '].qty']: next }, () => this.runQuote())
  },

  onToggleLineRate(e) {
    const i = Number(e.currentTarget.dataset.index)
    const on = !!e.detail.value
    const patch = { ['lines[' + i + '].useLineRate']: on }
    if (on && !Number.isFinite(Number(this.data.lines[i].laborRatePct))) {
      patch['lines[' + i + '].laborRatePct'] = this.data.laborRatePct
    }
    this.setData(patch, () => this.runQuote())
  },

  onLineRateInput(e) {
    const i = Number(e.currentTarget.dataset.index)
    const v = Number(e.detail.value)
    this.setData({ ['lines[' + i + '].laborRatePct']: Number.isFinite(v) ? v : 0 }, () => this.runQuote())
  },

  onRemoveLine(e) {
    const i = Number(e.currentTarget.dataset.index)
    const lines = this.data.lines.slice()
    lines.splice(i, 1)
    // 重排行号，避免展示序号乱掉
    lines.forEach((l, idx) => {
      l.index = idx + 1
    })
    if (!lines.length) {
      this.setData({ lines, allPriced: false, totalText: '—', tipTone: 'warn', tipText: '已删光所有明细，请返回重新粘贴' })
      return
    }
    this.setData({ lines }, () => this.runQuote())
  },

  // ───────────────── 选择器 ─────────────────

  openPicker(e) {
    const i = Number(e.currentTarget.dataset.index)
    const kind = e.currentTarget.dataset.kind === 'packaging' ? 'packaging' : 'material'
    const line = this.data.lines[i] || {}
    this.setData(
      {
        picker: {
          show: true,
          kind,
          lineIndex: i,
          title: (kind === 'material' ? '选择原材料' : '选择包装方式') + ' · 第 ' + (line.index || i + 1) + ' 行',
          keyword: '',
          loading: true,
          list: [],
          expandedKey: ''
        }
      },
      () => this.searchPriceBook('')
    )
  },

  closePicker() {
    this.setData({ 'picker.show': false })
  },

  onPickerInput(e) {
    const keyword = String(e.detail.value || '')
    this.setData({ 'picker.keyword': keyword })
    if (this._pickerTimer) clearTimeout(this._pickerTimer)
    // 防抖：搜索是服务端查询，输入每个字都打一次没必要
    this._pickerTimer = setTimeout(() => this.searchPriceBook(keyword), 320)
  },

  searchPriceBook(keyword) {
    const kind = this.data.picker.kind
    this.setData({ 'picker.loading': true })
    return wx.cloud
      .callFunction({
        name: SETTLEMENT_FN,
        data: { action: 'searchPriceBook', kind, keyword: keyword || '', limit: 30 }
      })
      .then((res) => {
        const r = (res && res.result) || {}
        if (r.success === false) throw new Error(r.msg || '搜索失败')
        const list = (r.list || []).map((g) => ({
          key: g.normName || g.name,
          name: g.name,
          displayName: g.displayName || g.name,
          aliases: g.aliases || [],
          optionField: g.optionField,
          optionLabel: g.optionLabel,
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
        this.setData({
          'picker.loading': false,
          'picker.list': [],
          tipTone: 'warn',
          tipText: formatCloudFnError(e, '价目表加载失败')
        })
      })
  },

  onToggleGroup(e) {
    const key = String(e.currentTarget.dataset.key || '')
    this.setData({ 'picker.expandedKey': this.data.picker.expandedKey === key ? '' : key })
  },

  /** 选中一条规格（材料=等级行 / 包装=尺寸行） */
  onPickOption(e) {
    const i = this.data.picker.lineIndex
    const kind = this.data.picker.kind
    const key = String(e.currentTarget.dataset.key || '')
    const option = String(e.currentTarget.dataset.option || '')
    const id = String(e.currentTarget.dataset.id || '')
    const group = (this.data.picker.list || []).find((g) => g.key === key)
    if (!group || i < 0) return
    const patch = { 'picker.show': false }
    if (kind === 'material') {
      patch['lines[' + i + '].materialId'] = id
      patch['lines[' + i + '].materialName'] = group.name
      patch['lines[' + i + '].materialGrade'] = option
    } else {
      patch['lines[' + i + '].packagingId'] = id
      patch['lines[' + i + '].packagingName'] = group.name
      patch['lines[' + i + '].packagingSize'] = option
    }
    this.setData(patch, () => this.runQuote())
  },

  // ───────────────── 保存 ─────────────────

  onSave() {
    if (this.data.busy) return
    const lines = this.data.lines
    if (!lines.length) {
      this.setData({ tipTone: 'warn', tipText: '没有明细可保存' })
      return
    }
    this.setData({ busy: true, tipText: '正在保存…' })
    wx.cloud
      .callFunction({
        name: SHIPMENT_FN,
        data: {
          action: 'createFromParsed',
          parsed: {
            shipmentDate: this.data.shipmentDate,
            shipments: [
              {
                storeId: this.data.storeId,
                storeName: this.data.storeName,
                items: lines.map((l) =>
                  Object.assign(
                    {
                      itemName: l.itemName,
                      qty: Number(l.qty) || 1,
                      spec: '',
                      category: ''
                    },
                    toQuoteLine(l)
                  )
                )
              }
            ]
          },
          rawText: this.data.rawText,
          batchId: this.data.batchId,
          source: 'manual'
        }
      })
      .then((res) => {
        const r = (res && res.result) || {}
        if (r.success === false) throw new Error(r.msg || '保存失败')
        const stats = (r.stats || {})
        if (!stats.created) throw new Error((r.errors && r.errors[0] && r.errors[0].msg) || '未能写入出货单')
        try {
          wx.removeStorageSync(DRAFT_KEY)
        } catch (e) {
          /* 忽略 */
        }
        this.setData({ busy: false, tipTone: 'info', tipText: r.msg || '已保存' })
        // 保存成功后返回；带上提示让上一页刷新
        setTimeout(() => {
          wx.navigateBack({ delta: 1 })
        }, 600)
      })
      .catch((e) => {
        this.setData({ busy: false, tipTone: 'warn', tipText: formatCloudFnError(e, '保存失败，请重试') })
      })
  },
})
