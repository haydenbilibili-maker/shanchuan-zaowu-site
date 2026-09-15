/**
 * 标本师销售提成（仅超管）— 多规则 list / save / toggle / archive
 */
const { guardStaffPage } = require('../utils/staffAuth')
const { formatCloudFnError } = require('../utils/memberScan')

const FN = 'manageArtisanCommission'

const TYPE_OPTIONS = [
  { value: '', label: '全部类型' },
  { value: 'earn', label: '入账' },
  { value: 'reverse', label: '冲正' }
]

const CRAFT_LABELS = {
  wing_art: '蝶翅画',
  frame: '相框',
  cloche: '方形玻璃罩',
  cloche_round: '圆形玻璃罩',
  cloche_cylinder: '圆柱形玻璃罩',
  diorama: '造景',
  immersion: '浸制',
  plastination: '塑化',
  taxidermy: '剥制',
  other: '其它'
}

function emptyForm() {
  return {
    enabled: true,
    name: '',
    ratePercent: 10,
    priority: 100,
    isDefault: false,
    craftTypes: [],
    productIds: [],
    categoryIds: [],
    artisanIds: [],
    categoryIdsText: '',
    productIdsText: ''
  }
}

function flattenCategoryTree(roots, subMap) {
  const out = []
  ;(roots || []).forEach((root) => {
    const rootId = String((root && root._id) || '').trim()
    const rootName = String((root && root.name) || '').trim() || '未命名类目'
    if (!rootId) return
    out.push({ _id: rootId, title: rootName, level: 1 })
    const subs = (subMap && subMap[rootId]) || []
    subs.forEach((sub) => {
      const subId = String((sub && sub._id) || '').trim()
      if (!subId) return
      const subName = String((sub && sub.name) || '').trim() || '未命名'
      out.push({ _id: subId, title: `${rootName} / ${subName}`, level: 2 })
    })
  })
  return out
}

Page({
  data: {
    ready: false,
    loading: false,
    saving: false,
    tab: 'rule',
    matchPriorityNote: '藏品级 > 类目/工艺/标本师级 > 默认规则',
    rules: [],
    enabledCount: 0,
    editing: false,
    editDocId: '',
    craftTypeOptions: [],
    form: emptyForm(),
    productKeyword: '',
    productHits: [],
    productSearching: false,
    selectedProducts: [],
    categoryOptions: [],
    categoryKeyword: '',
    categoryHits: [],
    selectedCategories: [],
    selectedArtisans: [],
    showAdvancedIds: false,
    ratePresets: [5, 10, 15],
    ledger: [],
    ledgerLoading: false,
    ledgerSummary: {
      netAmount: 0,
      earnAmount: 0,
      reverseAmount: 0,
      earnCount: 0
    },
    filterArtisanId: '',
    filterArtisanName: '',
    filterType: '',
    filterTypeIndex: 0,
    filterTypeLabel: '全部类型',
    typeOptions: TYPE_OPTIONS,
    typeLabels: TYPE_OPTIONS.map((o) => o.label),
    filterFrom: '',
    filterTo: '',
    artisanList: [],
    artisanFiltered: [],
    artisanKeyword: '',
    showArtisanSheet: false,
    artisanSheetMode: 'filter'
  },

  async onLoad() {
    const role = await guardStaffPage('super_admin')
    if (!role) return
    this.setData({ ready: true })
    await Promise.all([this.loadArtisans(), this.loadCategories()])
    await this.loadRules()
  },

  onPullDownRefresh() {
    const run = async () => {
      await Promise.all([this.loadArtisans(), this.loadCategories()])
      if (this.data.tab === 'ledger') await this.loadLedger()
      else if (this.data.editing) await this.reloadEditingRule()
      else await this.loadRules()
    }
    run().finally(() => wx.stopPullDownRefresh())
  },

  setTab(e) {
    const tab = String((e.currentTarget.dataset && e.currentTarget.dataset.tab) || 'rule')
    this.setData({ tab, showArtisanSheet: false })
    if (tab === 'ledger') this.loadLedger()
    else if (!this.data.editing) this.loadRules()
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

  resolveSelectedCategories(ids, options) {
    const map = {}
    ;(options || this.data.categoryOptions || []).forEach((c) => {
      map[c._id] = c.title
    })
    return (ids || []).map((id) => ({
      _id: id,
      title: map[id] || id
    }))
  },

  resolveSelectedArtisans(ids) {
    const map = {}
    ;(this.data.artisanList || []).forEach((a) => {
      map[a._id] = a.name
    })
    return (ids || []).map((id) => ({
      _id: id,
      name: map[id] || id
    }))
  },

  decorateRules(list) {
    return (list || []).map((r) => {
      const craftLabels = (r.craftTypes || [])
        .map((c) => CRAFT_LABELS[c] || c)
        .slice(0, 3)
      const scopeParts = []
      if (r.isDefault) scopeParts.push('默认')
      if ((r.productIds || []).length) scopeParts.push(`${r.productIds.length} 藏品`)
      if (craftLabels.length) scopeParts.push(craftLabels.join('/'))
      if ((r.categoryIds || []).length) scopeParts.push(`${r.categoryIds.length} 类目`)
      if ((r.artisanIds || []).length) scopeParts.push(`${r.artisanIds.length} 标本师`)
      return {
        ...r,
        ratePercentText: `${Math.round((Number(r.rate) || 0) * 1000) / 10}%`,
        statusLabel: r.enabled ? '启用' : '停用',
        scopeSummary: scopeParts.join(' · ') || r.scopeBrief || '未配置范围',
        tierHint: r.isDefault
          ? '默认档'
          : (r.productIds || []).length
            ? '藏品档'
            : '范围档'
      }
    })
  },

  applyForm(config, extra) {
    const cfg = config || {}
    const productIds = Array.isArray(cfg.productIds) ? cfg.productIds.slice() : []
    const categoryIds = Array.isArray(cfg.categoryIds) ? cfg.categoryIds.slice() : []
    const artisanIds = Array.isArray(cfg.artisanIds) ? cfg.artisanIds.slice() : []
    const craftTypes = Array.isArray(cfg.craftTypes) ? cfg.craftTypes.slice() : []
    const optionSource =
      (extra && extra.craftTypeOptions) ||
      this.data.craftTypeOptions ||
      []
    const craftTypeOptions = optionSource.map((o) => ({
      value: o.value,
      label: o.label,
      selected: craftTypes.indexOf(o.value) !== -1
    }))
    const patch = {
      form: {
        enabled: cfg.enabled !== false,
        name: cfg.name || '',
        ratePercent: Math.round((Number(cfg.rate) || 0.1) * 1000) / 10,
        priority: Number(cfg.priority) || (cfg.isDefault ? 10 : 100),
        isDefault: !!cfg.isDefault,
        craftTypes,
        productIds,
        categoryIds,
        artisanIds,
        categoryIdsText: categoryIds.join(','),
        productIdsText: productIds.join(',')
      },
      selectedProducts: productIds.map((id) => {
        const prev = (this.data.selectedProducts || []).find((p) => p._id === id)
        return { _id: id, title: (prev && prev.title) || id }
      }),
      selectedCategories: this.resolveSelectedCategories(categoryIds),
      selectedArtisans: this.resolveSelectedArtisans(artisanIds),
      craftTypeOptions
    }
    if (extra) {
      Object.keys(extra).forEach((k) => {
        if (k === 'craftTypeOptions') return
        patch[k] = extra[k]
      })
    }
    this.setData(patch)
  },

  async loadRules() {
    if (this.data.loading) return
    this.setData({ loading: true })
    try {
      const result = await this.callFn({ action: 'listRules' })
      this.setData({
        loading: false,
        rules: this.decorateRules(result.list || []),
        enabledCount: result.enabledCount || 0,
        matchPriorityNote: result.matchPriorityNote || this.data.matchPriorityNote,
        craftTypeOptions: (result.craftTypeOptions || []).map((o) => ({
          value: o.value,
          label: o.label,
          selected: false
        }))
      })
    } catch (e) {
      this.setData({ loading: false })
      wx.showToast({ title: formatCloudFnError(e, '加载失败'), icon: 'none' })
    }
  },

  async reloadEditingRule() {
    if (!this.data.editDocId) return
    try {
      const result = await this.callFn({ action: 'getRule', docId: this.data.editDocId })
      this.applyForm(result.config, {
        craftTypeOptions: result.craftTypeOptions || this.data.craftTypeOptions
      })
      this.refreshCategoryHits()
    } catch (e) {
      wx.showToast({ title: formatCloudFnError(e, '刷新失败'), icon: 'none' })
    }
  },

  async loadArtisans() {
    try {
      const result = await this.callFn({ action: 'listArtisans', pageSize: 200 })
      const list = result.list || []
      this.setData({
        artisanList: list,
        artisanFiltered: this.filterArtisanList(list, this.data.artisanKeyword)
      })
      if (this.data.filterArtisanId) {
        const hit = list.find((a) => a._id === this.data.filterArtisanId)
        if (hit) this.setData({ filterArtisanName: hit.name })
      }
      if ((this.data.form.artisanIds || []).length) {
        this.setData({
          selectedArtisans: this.resolveSelectedArtisans(this.data.form.artisanIds)
        })
      }
    } catch (e) {
      console.warn('loadArtisans', e)
      this.setData({ artisanList: [], artisanFiltered: [] })
    }
  },

  async loadCategories() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'listCategories',
        data: { canonicalOnly: true }
      })
      const result = (res && res.result) || {}
      if (!result.success) throw new Error(result.msg || '类目加载失败')
      const options = flattenCategoryTree(result.categoryRoots, result.categorySubMap)
      const selected = this.resolveSelectedCategories(
        this.data.form.categoryIds || [],
        options
      )
      this.setData({
        categoryOptions: options,
        selectedCategories: selected,
        categoryHits: this.filterCategoryList(options, this.data.categoryKeyword)
      })
    } catch (e) {
      console.warn('loadCategories', e)
      this.setData({ categoryOptions: [], categoryHits: [] })
    }
  },

  filterArtisanList(list, keyword) {
    const kw = String(keyword || '').trim().toLowerCase()
    if (!kw) return list || []
    return (list || []).filter((a) => String(a.name || '').toLowerCase().indexOf(kw) !== -1)
  },

  filterCategoryList(list, keyword) {
    const kw = String(keyword || '').trim().toLowerCase()
    const selected = new Set(this.data.form.categoryIds || [])
    const source = list || []
    const filtered = !kw
      ? source.slice(0, 24)
      : source
          .filter((c) => String(c.title || '').toLowerCase().indexOf(kw) !== -1)
          .slice(0, 40)
    return filtered.map((c) => ({
      ...c,
      added: selected.has(c._id)
    }))
  },

  refreshCategoryHits() {
    this.setData({
      categoryHits: this.filterCategoryList(this.data.categoryOptions, this.data.categoryKeyword)
    })
  },

  markProductHits(list, productIds) {
    const selected = new Set(productIds || this.data.form.productIds || [])
    return (list || []).map((item) => ({
      ...item,
      added: selected.has(item._id),
      metaText: [
        item.framerName ? `标本师 ${item.framerName}` : '',
        item.craftType ? CRAFT_LABELS[item.craftType] || item.craftType : '',
        item.isOffShelf ? '已下架' : ''
      ]
        .filter(Boolean)
        .join(' · ')
    }))
  },

  clampRate(v) {
    const n = Math.round(Number(v) * 10) / 10
    if (!Number.isFinite(n) || n < 0) return 0
    if (n > 100) return 100
    return n
  },

  openCreate() {
    const options = (this.data.craftTypeOptions || []).map((o) => ({
      ...o,
      selected: false
    }))
    this.applyForm(
      {
        ...emptyForm(),
        name: '新建提成规则',
        craftTypes: [],
        priority: 100,
        isDefault: false
      },
      {
        editing: true,
        editDocId: '',
        showAdvancedIds: false,
        productHits: [],
        productKeyword: '',
        categoryKeyword: '',
        craftTypeOptions: options
      }
    )
    this.refreshCategoryHits()
  },

  openEdit(e) {
    const id = String(e.currentTarget.dataset.id || '')
    const rule = (this.data.rules || []).find((r) => r._id === id || r.docId === id)
    if (!rule) return
    this.applyForm(rule, {
      editing: true,
      editDocId: id,
      showAdvancedIds: false,
      productHits: [],
      productKeyword: '',
      categoryKeyword: '',
      craftTypeOptions: this.data.craftTypeOptions
    })
    this.refreshCategoryHits()
  },

  closeEditor() {
    this.setData({
      editing: false,
      editDocId: '',
      showAdvancedIds: false,
      productHits: [],
      form: emptyForm()
    })
    this.loadRules()
  },

  onSwitch(e) {
    const field = e.currentTarget.dataset.field
    const next = !!(e.detail && e.detail.value)
    if (field === 'enabled' && !next && this.data.form.enabled) {
      wx.showModal({
        title: '停用本条规则',
        content: '停用后新订单不再命中本规则，已入账流水不受影响。确定停用？',
        confirmText: '停用',
        confirmColor: '#D64045',
        success: (res) => {
          if (res.confirm) this.setData({ 'form.enabled': false })
          else this.setData({ 'form.enabled': true })
        }
      })
      return
    }
    if (field === 'isDefault') {
      this.setData({ 'form.isDefault': next })
      return
    }
    this.setData({ [`form.${field}`]: next })
  },

  onText(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [`form.${field}`]: String((e.detail && e.detail.value) || '') })
  },

  onNumber(e) {
    const field = e.currentTarget.dataset.field
    const raw = Number(e.detail.value)
    if (field === 'ratePercent') {
      this.setData({ 'form.ratePercent': this.clampRate(raw) })
      return
    }
    if (field === 'priority') {
      const n = parseInt(raw, 10)
      this.setData({
        'form.priority': Number.isFinite(n) ? Math.max(0, Math.min(9999, n)) : 100
      })
      return
    }
    this.setData({ [`form.${field}`]: Number.isFinite(raw) ? raw : 0 })
  },

  nudgeRate(e) {
    const delta = Number(e.currentTarget.dataset.delta) || 0
    const next = this.clampRate((Number(this.data.form.ratePercent) || 0) + delta)
    this.setData({ 'form.ratePercent': next })
  },

  setRatePreset(e) {
    const v = this.clampRate(e.currentTarget.dataset.value)
    this.setData({ 'form.ratePercent': v })
  },

  toggleAdvancedIds() {
    this.setData({ showAdvancedIds: !this.data.showAdvancedIds })
  },

  toggleCraft(e) {
    const value = String(e.currentTarget.dataset.value || '')
    if (!value) return
    const list = (this.data.form.craftTypes || []).slice()
    const idx = list.indexOf(value)
    if (idx >= 0) list.splice(idx, 1)
    else list.push(value)
    const craftTypeOptions = (this.data.craftTypeOptions || []).map((o) => ({
      ...o,
      selected: list.indexOf(o.value) !== -1
    }))
    this.setData({
      'form.craftTypes': list,
      craftTypeOptions
    })
  },

  onProductKeyword(e) {
    this.setData({ productKeyword: String((e.detail && e.detail.value) || '') })
  },

  async searchProducts() {
    if (this.data.productSearching) return
    this.setData({ productSearching: true })
    try {
      const result = await this.callFn({
        action: 'searchProducts',
        keyword: this.data.productKeyword,
        pageSize: 20
      })
      const list = this.markProductHits(result.list || [])
      this.setData({ productHits: list, productSearching: false })
      if (!list.length) {
        wx.showToast({ title: '未找到藏品', icon: 'none' })
      }
    } catch (e) {
      this.setData({ productSearching: false })
      wx.showToast({ title: formatCloudFnError(e, '搜索失败'), icon: 'none' })
    }
  },

  addProduct(e) {
    if (String(e.currentTarget.dataset.added) === 'true') return
    const id = String(e.currentTarget.dataset.id || '')
    const title = String(e.currentTarget.dataset.title || id)
    if (!id) return
    const ids = (this.data.form.productIds || []).slice()
    if (ids.indexOf(id) !== -1) {
      wx.showToast({ title: '已添加', icon: 'none' })
      return
    }
    ids.push(id)
    const selected = (this.data.selectedProducts || []).concat([{ _id: id, title }])
    this.setData({
      'form.productIds': ids,
      'form.productIdsText': ids.join(','),
      selectedProducts: selected,
      productHits: this.markProductHits(this.data.productHits, ids)
    })
  },

  removeProduct(e) {
    const id = String(e.currentTarget.dataset.id || '')
    const ids = (this.data.form.productIds || []).filter((x) => x !== id)
    const selected = (this.data.selectedProducts || []).filter((x) => x._id !== id)
    this.setData({
      'form.productIds': ids,
      'form.productIdsText': ids.join(','),
      selectedProducts: selected,
      productHits: this.markProductHits(this.data.productHits, ids)
    })
  },

  onCategoryKeyword(e) {
    const keyword = String((e.detail && e.detail.value) || '')
    this.setData({
      categoryKeyword: keyword,
      categoryHits: this.filterCategoryList(this.data.categoryOptions, keyword)
    })
  },

  searchCategories() {
    this.refreshCategoryHits()
  },

  addCategory(e) {
    if (String(e.currentTarget.dataset.added) === 'true') return
    const id = String(e.currentTarget.dataset.id || '')
    const title = String(e.currentTarget.dataset.title || id)
    if (!id) return
    const ids = (this.data.form.categoryIds || []).slice()
    if (ids.indexOf(id) !== -1) {
      wx.showToast({ title: '已添加', icon: 'none' })
      return
    }
    ids.push(id)
    const selected = (this.data.selectedCategories || []).concat([{ _id: id, title }])
    this.setData({
      'form.categoryIds': ids,
      'form.categoryIdsText': ids.join(','),
      selectedCategories: selected
    })
    this.refreshCategoryHits()
  },

  removeCategory(e) {
    const id = String(e.currentTarget.dataset.id || '')
    const ids = (this.data.form.categoryIds || []).filter((x) => x !== id)
    const selected = (this.data.selectedCategories || []).filter((x) => x._id !== id)
    this.setData({
      'form.categoryIds': ids,
      'form.categoryIdsText': ids.join(','),
      selectedCategories: selected
    })
    this.refreshCategoryHits()
  },

  onCategoryIdsText(e) {
    const text = String((e.detail && e.detail.value) || '')
    const ids = text
      .split(/[,，\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
    this.setData({
      'form.categoryIdsText': text,
      'form.categoryIds': ids,
      selectedCategories: this.resolveSelectedCategories(ids)
    })
    this.refreshCategoryHits()
  },

  onProductIdsText(e) {
    const text = String((e.detail && e.detail.value) || '')
    const ids = text
      .split(/[,，\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
    const prevMap = {}
    ;(this.data.selectedProducts || []).forEach((p) => {
      prevMap[p._id] = p.title
    })
    this.setData({
      'form.productIdsText': text,
      'form.productIds': ids,
      selectedProducts: ids.map((id) => ({ _id: id, title: prevMap[id] || id })),
      productHits: this.markProductHits(this.data.productHits, ids)
    })
  },

  openArtisanPickerForRule() {
    this.setData({
      showArtisanSheet: true,
      artisanSheetMode: 'rule',
      artisanKeyword: '',
      artisanFiltered: this.data.artisanList || []
    })
  },

  removeRuleArtisan(e) {
    const id = String(e.currentTarget.dataset.id || '')
    const ids = (this.data.form.artisanIds || []).filter((x) => x !== id)
    this.setData({
      'form.artisanIds': ids,
      selectedArtisans: this.resolveSelectedArtisans(ids)
    })
  },

  buildConfigPayload() {
    const f = this.data.form
    let categoryIds = (f.categoryIds || []).slice()
    if (!categoryIds.length && f.categoryIdsText) {
      categoryIds = String(f.categoryIdsText)
        .split(/[,，\s]+/)
        .map((s) => s.trim())
        .filter(Boolean)
    }
    let productIds = (f.productIds || []).slice()
    if (!productIds.length && f.productIdsText) {
      productIds = String(f.productIdsText)
        .split(/[,，\s]+/)
        .map((s) => s.trim())
        .filter(Boolean)
    }
    const ratePercent = Number(f.ratePercent) || 10
    return {
      enabled: !!f.enabled,
      name: f.name || '标本师销售提成',
      rate: ratePercent / 100,
      priority: Number(f.priority) || 100,
      isDefault: !!f.isDefault,
      craftTypes: f.craftTypes || [],
      categoryIds,
      categoryTypes: [],
      productIds,
      artisanIds: f.artisanIds || []
    }
  },

  async saveRule() {
    if (this.data.saving) return
    const craftCount = (this.data.form.craftTypes || []).length
    const catCount = (this.data.form.categoryIds || []).length
    const prodCount = (this.data.form.productIds || []).length
    const artCount = (this.data.form.artisanIds || []).length
    if (!craftCount && !catCount && !prodCount && !artCount) {
      wx.showToast({ title: '请至少选择工艺、类目、藏品或标本师', icon: 'none' })
      return
    }
    if (!String(this.data.form.name || '').trim()) {
      wx.showToast({ title: '请填写规则名称', icon: 'none' })
      return
    }
    const enabled = !!this.data.form.enabled
    const rate = this.clampRate(this.data.form.ratePercent)
    const doSave = async () => {
      this.setData({ saving: true, 'form.ratePercent': rate })
      try {
        const result = await this.callFn({
          action: 'saveRule',
          docId: this.data.editDocId,
          config: this.buildConfigPayload()
        })
        this.applyForm(result.config, {
          saving: false,
          editDocId: result.docId || this.data.editDocId,
          editing: false
        })
        wx.showToast({ title: result.msg || '规则已保存', icon: 'success' })
        await this.loadRules()
      } catch (e) {
        this.setData({ saving: false })
        wx.showToast({ title: formatCloudFnError(e, '保存失败'), icon: 'none' })
      }
    }
    wx.showModal({
      title: this.data.editDocId ? '保存规则' : '新建规则',
      content: enabled
        ? `将按 ${rate}% 保存本条规则。确认？`
        : `规则将保存为停用（${rate}%）。确认？`,
      confirmText: '保存',
      success: (res) => {
        if (res.confirm) doSave()
      }
    })
  },

  async toggleRuleFromList(e) {
    const id = String(e.currentTarget.dataset.id || '')
    const enabled = String(e.currentTarget.dataset.enabled) === 'true'
    if (!id) return
    const next = !enabled
    const run = async () => {
      try {
        await this.callFn({ action: 'toggleRule', docId: id, enabled: next })
        wx.showToast({ title: next ? '已启用' : '已停用', icon: 'success' })
        await this.loadRules()
      } catch (err) {
        wx.showToast({ title: formatCloudFnError(err, '操作失败'), icon: 'none' })
      }
    }
    if (!next) {
      wx.showModal({
        title: '停用规则',
        content: '停用后新订单不再命中本规则。确定？',
        confirmText: '停用',
        confirmColor: '#D64045',
        success: (res) => {
          if (res.confirm) run()
        }
      })
      return
    }
    run()
  },

  async archiveRule(e) {
    const id = String(e.currentTarget.dataset.id || '')
    const isDefault = String(e.currentTarget.dataset.default) === 'true'
    if (!id) return
    if (isDefault) {
      wx.showToast({ title: '默认规则不可删除', icon: 'none' })
      return
    }
    wx.showModal({
      title: '归档规则',
      content: '归档后不再参与匹配，可视为删除。已入账流水保留。确定归档？',
      confirmText: '归档',
      confirmColor: '#D64045',
      success: async (res) => {
        if (!res.confirm) return
        try {
          await this.callFn({ action: 'deleteRule', docId: id })
          wx.showToast({ title: '已归档', icon: 'success' })
          if (this.data.editDocId === id) this.closeEditor()
          else await this.loadRules()
        } catch (err) {
          wx.showToast({ title: formatCloudFnError(err, '归档失败'), icon: 'none' })
        }
      }
    })
  },

  async resetDefaults() {
    if (this.data.saving) return
    wx.showModal({
      title: '恢复默认规则',
      content: '将默认规则重置为：启用 · 蝶翅画 · 10%。其它自定义规则不受影响。',
      confirmText: '恢复',
      confirmColor: '#C4A76C',
      success: async (res) => {
        if (!res.confirm) return
        try {
          this.setData({ saving: true })
          await this.callFn({ action: 'resetDefaults' })
          this.setData({ saving: false, editing: false })
          await this.loadRules()
          wx.showToast({ title: '默认已恢复', icon: 'success' })
        } catch (e) {
          this.setData({ saving: false })
          wx.showToast({ title: formatCloudFnError(e, '操作失败'), icon: 'none' })
        }
      }
    })
  },

  openArtisanSheet() {
    this.setData({
      showArtisanSheet: true,
      artisanSheetMode: 'filter',
      artisanKeyword: '',
      artisanFiltered: this.data.artisanList || []
    })
  },

  closeArtisanSheet() {
    this.setData({ showArtisanSheet: false })
  },

  onArtisanKeyword(e) {
    const keyword = String((e.detail && e.detail.value) || '')
    this.setData({
      artisanKeyword: keyword,
      artisanFiltered: this.filterArtisanList(this.data.artisanList, keyword)
    })
  },

  selectArtisan(e) {
    const id = String(e.currentTarget.dataset.id || '')
    const name = String(e.currentTarget.dataset.name || '')
    if (this.data.artisanSheetMode === 'rule') {
      if (!id) {
        this.setData({ showArtisanSheet: false })
        return
      }
      const ids = (this.data.form.artisanIds || []).slice()
      if (ids.indexOf(id) === -1) ids.push(id)
      this.setData({
        'form.artisanIds': ids,
        selectedArtisans: this.resolveSelectedArtisans(ids),
        showArtisanSheet: false,
        artisanKeyword: ''
      })
      return
    }
    this.setData({
      filterArtisanId: id,
      filterArtisanName: id ? name : '',
      showArtisanSheet: false,
      artisanKeyword: ''
    })
  },

  clearArtisan() {
    this.setData({
      filterArtisanId: '',
      filterArtisanName: '',
      showArtisanSheet: false
    })
  },

  onTypePick(e) {
    const idx = Number(e.detail.value) || 0
    const opt = TYPE_OPTIONS[idx] || TYPE_OPTIONS[0]
    this.setData({
      filterTypeIndex: idx,
      filterType: opt.value,
      filterTypeLabel: opt.label
    })
  },

  onDatePick(e) {
    const field = e.currentTarget.dataset.field
    const value = String((e.detail && e.detail.value) || '')
    this.setData({ [field]: value })
  },

  clearDate(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [field]: '' })
  },

  async loadLedger() {
    if (this.data.ledgerLoading) return
    this.setData({ ledgerLoading: true, showArtisanSheet: false })
    try {
      const result = await this.callFn({
        action: 'listLedger',
        page: 1,
        pageSize: 40,
        artisanId: this.data.filterArtisanId,
        type: this.data.filterType,
        from: this.data.filterFrom,
        to: this.data.filterTo
      })
      this.setData({
        ledgerLoading: false,
        ledger: result.list || [],
        ledgerSummary: result.summary || {
          netAmount: 0,
          earnAmount: 0,
          reverseAmount: 0,
          earnCount: 0
        }
      })
    } catch (e) {
      this.setData({ ledgerLoading: false })
      wx.showToast({ title: formatCloudFnError(e, '账目加载失败'), icon: 'none' })
    }
  }
})
