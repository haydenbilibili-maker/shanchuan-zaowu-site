const {
  CHANNEL_OPTIONS,
  CRAFT_TYPE_OPTIONS,
  CRAFT_PROCESS_OPTIONS,
  PRICE_PRESETS,
  isChannelEligibleRoot,
  isCraftEligibleRoot
} = require('../../config/productTaxonomy')

Component({
  properties: {
    visible: { type: Boolean, value: false },
    /** 当前一级馆短名/全名，用于显隐渠道与装裱/工艺 */
    rootName: { type: String, value: '' },
    /** 品类 chips：[{ value, label }] */
    categoryOptions: { type: Array, value: [] },
    /** 已生效筛选（确定后回写） */
    applied: {
      type: Object,
      value: {
        categoryValue: '',
        categoryId: '',
        channel: '',
        craftType: '',
        craftProcess: '',
        pricePresetId: '',
        priceMin: '',
        priceMax: ''
      }
    }
  },

  data: {
    dims: [],
    activeDim: 'category',
    draft: {
      categoryValue: '',
      categoryId: '',
      channel: '',
      craftType: '',
      craftProcess: '',
      pricePresetId: '',
      priceMin: '',
      priceMax: ''
    },
    channelOptions: CHANNEL_OPTIONS,
    craftOptions: CRAFT_TYPE_OPTIONS,
    craftProcessOptions: CRAFT_PROCESS_OPTIONS,
    pricePresets: PRICE_PRESETS,
    showChannel: false,
    showCraft: false
  },

  observers: {
    visible(v) {
      if (v) this.openDraft()
    },
    'rootName, categoryOptions'() {
      this.refreshDims()
    }
  },

  methods: {
    refreshDims() {
      const root = this.properties.rootName || ''
      const showChannel = !root || root === '全部' || isChannelEligibleRoot(root)
      const showCraft = !root || root === '全部' || isCraftEligibleRoot(root)
      const dims = [{ key: 'category', label: '品类' }]
      if (showChannel) dims.push({ key: 'channel', label: '渠道' })
      if (showCraft) dims.push({ key: 'craft', label: '装裱方式' })
      if (showCraft) dims.push({ key: 'craftProcess', label: '制作工艺' })
      dims.push({ key: 'price', label: '价格区间' })

      let activeDim = this.data.activeDim
      if (!dims.some((d) => d.key === activeDim)) activeDim = dims[0].key

      this.setData({ showChannel, showCraft, dims, activeDim })
    },

    openDraft() {
      const a = this.properties.applied || {}
      this.setData({
        draft: {
          categoryValue: a.categoryValue || '',
          categoryId: a.categoryId || '',
          channel: a.channel || '',
          craftType: a.craftType || '',
          craftProcess: a.craftProcess || '',
          pricePresetId: a.pricePresetId || '',
          priceMin: a.priceMin != null && a.priceMin !== '' ? String(a.priceMin) : '',
          priceMax: a.priceMax != null && a.priceMax !== '' ? String(a.priceMax) : ''
        }
      })
      this.refreshDims()
      let activeDim = 'category'
      if (a.channel) activeDim = 'channel'
      else if (a.craftType) activeDim = 'craft'
      else if (a.craftProcess) activeDim = 'craftProcess'
      else if (
        a.pricePresetId ||
        (a.priceMin != null && a.priceMin !== '') ||
        (a.priceMax != null && a.priceMax !== '')
      ) {
        activeDim = 'price'
      } else if (a.categoryValue) {
        activeDim = 'category'
      }
      const dims = this.data.dims || []
      if (!dims.some((d) => d.key === activeDim)) activeDim = dims[0] ? dims[0].key : 'category'
      if (activeDim !== this.data.activeDim) this.setData({ activeDim })
    },

    onMaskTap() {
      this.triggerEvent('close')
    },

    onClose() {
      this.triggerEvent('close')
    },

    stopMove() {},

    selectDim(e) {
      const key = e.currentTarget.dataset.key
      if (key) this.setData({ activeDim: key })
    },

    selectCategory(e) {
      const value = e.currentTarget.dataset.value || ''
      const categoryId = e.currentTarget.dataset.id || ''
      const cur = this.data.draft.categoryValue
      if (cur === value) {
        this.setData({ 'draft.categoryValue': '', 'draft.categoryId': '' })
      } else {
        this.setData({ 'draft.categoryValue': value, 'draft.categoryId': categoryId })
      }
    },

    selectChannel(e) {
      const value = e.currentTarget.dataset.value || ''
      const cur = this.data.draft.channel
      this.setData({ 'draft.channel': cur === value ? '' : value })
    },

    selectCraft(e) {
      const value = e.currentTarget.dataset.value || ''
      const cur = this.data.draft.craftType
      this.setData({ 'draft.craftType': cur === value ? '' : value })
    },

    selectCraftProcess(e) {
      const value = e.currentTarget.dataset.value || ''
      const cur = this.data.draft.craftProcess
      this.setData({ 'draft.craftProcess': cur === value ? '' : value })
    },

    selectPricePreset(e) {
      const id = e.currentTarget.dataset.id || ''
      const preset = PRICE_PRESETS.find((p) => p.id === id)
      if (!preset) return
      const same = this.data.draft.pricePresetId === id
      if (same) {
        this.setData({
          'draft.pricePresetId': '',
          'draft.priceMin': '',
          'draft.priceMax': ''
        })
        return
      }
      this.setData({
        'draft.pricePresetId': id,
        'draft.priceMin': preset.min != null ? String(preset.min) : '',
        'draft.priceMax': preset.max != null ? String(preset.max) : ''
      })
    },

    onPriceMinInput(e) {
      this.setData({
        'draft.priceMin': e.detail.value,
        'draft.pricePresetId': ''
      })
    },

    onPriceMaxInput(e) {
      this.setData({
        'draft.priceMax': e.detail.value,
        'draft.pricePresetId': ''
      })
    },

    onClear() {
      this.setData({
        draft: {
          categoryValue: '',
          categoryId: '',
          channel: '',
          craftType: '',
          craftProcess: '',
          pricePresetId: '',
          priceMin: '',
          priceMax: ''
        }
      })
    },

    onConfirm() {
      const d = this.data.draft || {}
      let priceMin = d.priceMin === '' || d.priceMin == null ? null : Number(d.priceMin)
      let priceMax = d.priceMax === '' || d.priceMax == null ? null : Number(d.priceMax)
      if (priceMin != null && Number.isNaN(priceMin)) priceMin = null
      if (priceMax != null && Number.isNaN(priceMax)) priceMax = null
      if (priceMin != null && priceMax != null && priceMin > priceMax) {
        const t = priceMin
        priceMin = priceMax
        priceMax = t
      }

      let channel = d.channel || ''
      if (!this.data.showChannel) channel = ''
      let craftType = d.craftType || ''
      let craftProcess = d.craftProcess || ''
      if (!this.data.showCraft) {
        craftType = ''
        craftProcess = ''
      }

      const payload = {
        categoryValue: d.categoryValue || '',
        categoryId: d.categoryId || '',
        channel,
        craftType,
        craftProcess,
        pricePresetId: d.pricePresetId || '',
        priceMin,
        priceMax
      }
      // 先关面板再抛事件，避免父页 setData 与面板态打架
      this.triggerEvent('confirm', payload)
    }
  }
})
