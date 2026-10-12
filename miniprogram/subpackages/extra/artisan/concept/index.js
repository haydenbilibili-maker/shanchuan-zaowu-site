const { guardManagerPage } = require('../../../../utils/managerAuth')
const { openAppModal } = require('../../../../utils/appModal')
const {
  guardArtisanWorkspace,
  hasPermission,
  roleHasStored,
  goArtisanProductCreate
} = require('../../utils/staffAuth')
const {
  PRODUCT_TYPES,
  CATEGORY_OPTIONS,
  INNOVATION_OPTIONS,
  CHANNEL_OPTIONS,
  AUDIENCE_OPTIONS,
  CONCEPT_EXAMPLES,
  PREFILL_KEY,
  labelOf,
  randomFilterCombo,
  filterOptionTags,
  conceptToPlainText,
  buildPrefillDraft,
  filterHistoryList,
  friendlyClientError
} = require('../../utils/productConcept')
const {
  loadConcepts,
  upsertConcept,
  removeConcept,
  toggleFavorite
} = require('../../utils/conceptStorage')

function pickerIndex(options, value) {
  const i = (options || []).findIndex((o) => o.value === value)
  return i >= 0 ? i : 0
}

function shortName(name) {
  const s = String(name || '').trim()
  return s.length > 8 ? `${s.slice(0, 8)}…` : s || '未命名'
}

function enrichConceptView(concept) {
  if (!concept) return null
  if (concept.pending) {
    return {
      ...concept,
      shortName: concept.name || '构思中',
      filterTags: [],
      hasChannels: false,
      hasRisks: false,
      hasNextActions: false
    }
  }
  return {
    ...concept,
    shortName: shortName(concept.name),
    filterTags: filterOptionTags(concept),
    hasChannels: !!(concept.channels && concept.channels.length),
    hasRisks: !!(concept.risks && concept.risks.length),
    hasNextActions: !!(concept.nextActions && concept.nextActions.length)
  }
}

Page({
  data: {
    ready: false,
    productTypes: PRODUCT_TYPES,
    categoryOptions: CATEGORY_OPTIONS,
    innovationOptions: INNOVATION_OPTIONS,
    channelOptions: CHANNEL_OPTIONS,
    audienceOptions: AUDIENCE_OPTIONS,
    examples: CONCEPT_EXAMPLES,
    selectedProductType: 'profit',
    typeScrollInto: 'type-profit',
    categoryIndex: 0,
    innovationIndex: 0,
    channelIndex: 0,
    audienceIndex: 0,
    notes: '',
    notesOpen: false,
    generating: false,
    genMode: '',
    lastGenMode: 'single',
    batchTotal: 0,
    batchDone: 0,
    progressPct: 0,
    statusText: '',
    concept: null,
    batchResults: [],
    batchTab: 0,
    history: [],
    historyView: [],
    historyFilter: 'all',
    historyQuery: '',
    historyOpen: false,
    lastError: ''
  },

  _genToken: 0,

  onLoad() {
    this.bootstrap()
  },

  onShow() {
    if (this.data.ready) this.refreshHistory()
  },

  async bootstrap() {
    if (!guardManagerPage()) return
    const role = await guardArtisanWorkspace()
    if (!role) return

    const canConcept =
      roleHasStored(role, 'super_admin') ||
      roleHasStored(role, 'specimen_artisan') ||
      hasPermission(role, 'manageProducts')
    if (!canConcept) {
      wx.showToast({ title: '暂无概念生成权限', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 1200)
      return
    }

    this.setData({ ready: true, typeScrollInto: 'type-profit' })
    this.refreshHistory()
  },

  refreshHistory() {
    const history = loadConcepts()
    this.setData({
      history,
      historyView: filterHistoryList(history, {
        filter: this.data.historyFilter,
        query: this.data.historyQuery
      })
    })
  },

  applyHistoryFilters() {
    this.setData({
      historyView: filterHistoryList(this.data.history, {
        filter: this.data.historyFilter,
        query: this.data.historyQuery
      })
    })
  },

  scrollToResult() {
    setTimeout(() => {
      wx.pageScrollTo({ selector: '#result-anchor', duration: 280 })
    }, 80)
  },

  setProgress(done, total, text) {
    const t = Math.max(1, total || 1)
    const pct = Math.min(100, Math.round((Number(done) || 0) / t * 100))
    this.setData({
      batchDone: done,
      batchTotal: total,
      progressPct: pct || (this.data.generating ? 8 : 0),
      statusText: text || ''
    })
  },

  selectProductType(e) {
    const value = String((e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.value) || '')
    if (!value || value === this.data.selectedProductType) return
    wx.vibrateShort({ type: 'light' })
    this.setData({
      selectedProductType: value,
      typeScrollInto: `type-${value}`
    })
  },

  toggleNotes() {
    this.setData({ notesOpen: !this.data.notesOpen })
  },

  toggleHistory() {
    this.setData({ historyOpen: !this.data.historyOpen })
  },

  onNotesInput(e) {
    this.setData({ notes: (e.detail && e.detail.value) || '' })
  },

  onCategoryPick(e) {
    this.setData({ categoryIndex: Number(e.detail.value) || 0 })
  },

  onInnovationPick(e) {
    this.setData({ innovationIndex: Number(e.detail.value) || 0 })
  },

  onChannelPick(e) {
    this.setData({ channelIndex: Number(e.detail.value) || 0 })
  },

  onAudiencePick(e) {
    this.setData({ audienceIndex: Number(e.detail.value) || 0 })
  },

  snapshotPayload(extra) {
    const d = this.data
    return {
      productType: d.selectedProductType,
      category: CATEGORY_OPTIONS[d.categoryIndex].value,
      innovation: INNOVATION_OPTIONS[d.innovationIndex].value,
      channel: CHANNEL_OPTIONS[d.channelIndex].value,
      audience: AUDIENCE_OPTIONS[d.audienceIndex].value,
      notes: String(d.notes || '').trim(),
      ...(extra || {})
    }
  },

  applyOptionsSnapshot(options) {
    const o = options || {}
    const patch = {}
    if (o.productType) {
      patch.selectedProductType = o.productType
      patch.typeScrollInto = `type-${o.productType}`
    }
    if (o.category) patch.categoryIndex = pickerIndex(CATEGORY_OPTIONS, o.category)
    if (o.innovation) patch.innovationIndex = pickerIndex(INNOVATION_OPTIONS, o.innovation)
    if (o.channel) patch.channelIndex = pickerIndex(CHANNEL_OPTIONS, o.channel)
    if (o.audience) patch.audienceIndex = pickerIndex(AUDIENCE_OPTIONS, o.audience)
    if (o.notes != null) patch.notes = o.notes
    if (Object.keys(patch).length) this.setData(patch)
  },

  applyExample(e) {
    if (this.data.generating) return
    const id = String((e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) || '')
    const ex = CONCEPT_EXAMPLES.find((item) => item.id === id)
    if (!ex) return
    wx.vibrateShort({ type: 'light' })
    this.setData({
      selectedProductType: ex.productType,
      typeScrollInto: `type-${ex.productType}`,
      categoryIndex: pickerIndex(CATEGORY_OPTIONS, ex.category),
      innovationIndex: pickerIndex(INNOVATION_OPTIONS, ex.innovation),
      channelIndex: pickerIndex(CHANNEL_OPTIONS, ex.channel || 'store'),
      audienceIndex: pickerIndex(AUDIENCE_OPTIONS, ex.audience || 'family'),
      notes: ex.notes || '',
      notesOpen: !!ex.notes,
      lastError: ''
    })
  },

  rollDice() {
    const combo = randomFilterCombo()
    this.setData({
      selectedProductType: combo.productType,
      typeScrollInto: `type-${combo.productType}`,
      categoryIndex: pickerIndex(CATEGORY_OPTIONS, combo.category),
      innovationIndex: pickerIndex(INNOVATION_OPTIONS, combo.innovation),
      channelIndex: pickerIndex(CHANNEL_OPTIONS, combo.channel),
      audienceIndex: pickerIndex(AUDIENCE_OPTIONS, combo.audience),
      notes: '',
      notesOpen: false,
      lastError: ''
    })
    return combo
  },

  /** 灵感骰子 → 立刻生成（一步） */
  async rollDiceAndGenerate() {
    if (this.data.generating) return
    wx.vibrateShort({ type: 'medium' })
    const combo = this.rollDice()
    const type = PRODUCT_TYPES.find((t) => t.value === combo.productType)
    wx.showToast({
      title: `${(type && type.name) || '定位'} · ${labelOf(CATEGORY_OPTIONS, combo.category)}`,
      icon: 'none',
      duration: 900
    })
    await this.onGenerate()
  },

  async callConceptCloud(payload) {
    const res = await wx.cloud.callFunction({
      name: 'assistProductConcept',
      data: payload
    })
    const result = (res && res.result) || {}
    if (!result.success) {
      throw new Error(result.msg || '生成失败')
    }
    return result.data
  },

  syncHistory(history) {
    this.setData({
      history,
      historyView: filterHistoryList(history, {
        filter: this.data.historyFilter,
        query: this.data.historyQuery
      })
    })
  },

  setConceptResult(concept, batchResults, batchTab) {
    this.setData({
      concept: enrichConceptView(concept),
      batchResults: (batchResults || []).map((c) => enrichConceptView(c)),
      batchTab: batchTab || 0,
      lastError: ''
    })
  },

  beginGenerate(mode, total) {
    this._genToken += 1
    const token = this._genToken
    this.setData({
      generating: true,
      genMode: mode,
      lastGenMode: mode,
      lastError: '',
      progressPct: 6
    })
    this.setProgress(0, total, mode === 'batch' ? '并行构思变体…' : '正在构思概念…')
    this.scrollToResult()
    return token
  },

  endGenerate(token) {
    if (token !== this._genToken) return
    this.setData({
      generating: false,
      genMode: '',
      progressPct: 0,
      statusText: '',
      batchTotal: 0
    })
  },

  async onGenerate() {
    if (this.data.generating) return
    const token = this.beginGenerate('single', 1)
    try {
      const concept = await this.callConceptCloud(this.snapshotPayload())
      if (token !== this._genToken) return
      const history = upsertConcept(concept)
      this.setConceptResult(concept, [concept], 0)
      this.setProgress(1, 1, '')
      this.syncHistory(history)
      wx.vibrateShort({ type: 'light' })
    } catch (e) {
      if (token !== this._genToken) return
      const msg = friendlyClientError(e)
      this.setData({ lastError: msg })
      wx.showToast({ title: msg, icon: 'none' })
    } finally {
      this.endGenerate(token)
    }
  },

  /** 并行批量 3 变体，槽位渐进填入 */
  async onBatchGenerate() {
    if (this.data.generating) return
    const n = 3
    const token = this.beginGenerate('batch', n)
    const snap = this.snapshotPayload()
    const slots = [0, 1, 2].map((i) => ({
      id: `pending_${token}_${i}`,
      pending: true,
      name: `变体 ${i + 1}`
    }))
    this.setData({
      concept: null,
      batchResults: slots.map((c) => enrichConceptView(c)),
      batchTab: 0
    })

    let history = this.data.history
    let firstReady = false
    const errors = []

    await Promise.all(
      [0, 1, 2].map(async (i) => {
        try {
          const concept = await this.callConceptCloud({ ...snap, batchIndex: i })
          if (token !== this._genToken) return
          slots[i] = concept
          history = upsertConcept(concept, history)
          const filled = slots.filter((c) => c && !c.pending).length
          const patch = {
            batchResults: slots.map((c) => enrichConceptView(c)),
            history,
            historyView: filterHistoryList(history, {
              filter: this.data.historyFilter,
              query: this.data.historyQuery
            })
          }
          if (!firstReady) {
            firstReady = true
            patch.concept = enrichConceptView(concept)
            patch.batchTab = i
          } else if (this.data.batchTab === i || !this.data.concept || this.data.concept.pending) {
            patch.concept = enrichConceptView(concept)
            patch.batchTab = i
          }
          this.setData(patch)
          this.setProgress(filled, n, `已完成 ${filled}/${n}`)
        } catch (e) {
          errors.push(friendlyClientError(e))
        }
      })
    )

    if (token !== this._genToken) return
    const ready = slots.filter((c) => c && !c.pending)
    if (ready.length) {
      if (!this.data.concept || this.data.concept.pending) {
        this.setConceptResult(ready[0], slots.map((c) => (c && !c.pending ? c : {
          id: c.id,
          pending: true,
          name: c.name
        })), 0)
      }
      wx.vibrateShort({ type: 'light' })
    }
    if (errors.length && !ready.length) {
      this.setData({ lastError: errors[0] })
      wx.showToast({ title: errors[0], icon: 'none' })
    } else if (errors.length) {
      this.setData({ lastError: `完成 ${ready.length}/${n}，部分失败可重试` })
    }
    this.endGenerate(token)
  },

  async onRegenerate() {
    if (this.data.generating) return
    if (this.data.concept && this.data.concept.options) {
      this.applyOptionsSnapshot(this.data.concept.options)
    }
    await this.onGenerate()
  },

  async onVariant() {
    if (this.data.generating) return
    const current = this.data.concept
    if (!current || current.pending) {
      wx.showToast({ title: '请先生成概念', icon: 'none' })
      return
    }
    if (current.options) this.applyOptionsSnapshot(current.options)
    const token = this.beginGenerate('variant', 1)
    try {
      const concept = await this.callConceptCloud(
        this.snapshotPayload({ variantOfName: current.name })
      )
      if (token !== this._genToken) return
      const history = upsertConcept(concept)
      const prev = (this.data.batchResults || []).filter((c) => c && !c.pending)
      const batch = [enrichConceptView(concept), ...prev].slice(0, 4)
      this.setData({
        concept: enrichConceptView(concept),
        batchResults: batch,
        batchTab: 0
      })
      this.syncHistory(history)
      wx.vibrateShort({ type: 'light' })
    } catch (e) {
      if (token !== this._genToken) return
      const msg = friendlyClientError(e)
      this.setData({ lastError: msg })
      wx.showToast({ title: msg, icon: 'none' })
    } finally {
      this.endGenerate(token)
    }
  },

  selectBatchTab(e) {
    const idx = Number((e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.idx) || 0)
    const list = this.data.batchResults || []
    const concept = list[idx]
    if (!concept || concept.pending) return
    this.setData({ batchTab: idx, concept: enrichConceptView(concept) })
  },

  loadHistoryItem(e) {
    const id = String((e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) || '')
    const item = (this.data.history || []).find((c) => c.id === id)
    if (!item) return
    this.applyOptionsSnapshot(item.options || {})
    this.setConceptResult(item, [item], 0)
    this.setData({ historyOpen: false })
    this.scrollToResult()
  },

  toggleFav(e) {
    const id = String((e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) || '')
    if (!id) return
    const history = toggleFavorite(id)
    let concept = this.data.concept
    if (concept && concept.id === id) {
      concept = enrichConceptView(history.find((c) => c.id === id) || concept)
    }
    this.setData({ concept })
    this.syncHistory(history)
  },

  deleteHistory(e) {
    const id = String((e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) || '')
    if (!id) return
    openAppModal({
      title: '删除概念',
      content: '从本机历史中移除？',
      confirmText: '删除',
      confirmColor: '#D64045',
      success: (res) => {
        if (!res.confirm) return
        const history = removeConcept(id)
        let concept = this.data.concept
        if (concept && concept.id === id) concept = null
        this.setData({ concept })
        this.syncHistory(history)
      }
    }, this)
  },

  copyConceptText() {
    const text = conceptToPlainText(this.data.concept)
    if (!text) {
      wx.showToast({ title: '暂无概念', icon: 'none' })
      return
    }
    wx.setClipboardData({
      data: text,
      success: () => wx.showToast({ title: '已复制', icon: 'none' })
    })
  },

  applyToUpload() {
    const concept = this.data.concept
    if (!concept || concept.pending) {
      wx.showToast({ title: '请先生成概念', icon: 'none' })
      return
    }
    const draft = buildPrefillDraft(concept)
    if (!draft || !draft.title) {
      wx.showToast({ title: '概念缺少品名', icon: 'none' })
      return
    }
    try {
      wx.setStorageSync(PREFILL_KEY, draft)
    } catch (e) {
      wx.showToast({ title: '暂存失败', icon: 'none' })
      return
    }
    wx.vibrateShort({ type: 'light' })
    goArtisanProductCreate()
  },

  setHistoryFilter(e) {
    const f = String((e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.filter) || 'all')
    this.setData({ historyFilter: f }, () => this.applyHistoryFilters())
  },

  onHistoryQuery(e) {
    this.setData({ historyQuery: (e.detail && e.detail.value) || '' }, () => this.applyHistoryFilters())
  },

  clearHistoryQuery() {
    this.setData({ historyQuery: '' }, () => this.applyHistoryFilters())
  },

  retryLast() {
    if (this.data.generating) return
    const mode = this.data.lastGenMode || 'single'
    if (mode === 'batch') this.onBatchGenerate()
    else if (mode === 'variant') this.onVariant()
    else this.onGenerate()
  }
})
