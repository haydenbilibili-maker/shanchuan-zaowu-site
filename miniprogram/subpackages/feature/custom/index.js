// subpackages/feature/custom/index.js
const db = wx.cloud.database()
const _ = db.command
const { STEPS, CATEGORY_PILLS } = require('../utils/customDefaults')
const {
  pickConfigOption,
  calcCustomExtra,
  calcEstimatedDays,
  buildCustomMeta,
  buildPreviewSummary,
  serializeWizardState,
  buildDraftTitle
} = require('../utils/customHelper')
const { navigateToCustomCheckout } = require('../../../utils/checkout')
const {
  hasSkus,
  getSkuDimensions,
  getDimensionValues,
  resolveSkuFromSpecs,
  initSelectedSpecs,
  isDimensionValueAvailable,
  getDisplayPrice
} = require('../utils/sku')
const { trackBehavior } = require('../../../utils/trackBehavior')
const { getCustomNavLayout } = require('../utils/customNav')
const {
  fetchContentDisplayFlags,
  toastSpecimenCustomClosed
} = require('../../../utils/contentDisplayFlags')

Page({
  data: {
    statusBarHeight: 0,
    navPaddingRight: 32,
    headerHeight: 88,
    steps: STEPS,
    currentStep: 1,
    currentStepMeta: STEPS[0],
    selectedFrameName: '',
    selectedPackagingName: '',
    loading: true,
    categoryPills: CATEGORY_PILLS,
    activeCategory: '',
    searchKeyword: '',
    products: [],
    filteredProducts: [],
    frames: [],
    packaging: [],
    framers: [],
    drafts: [],
    estimatedDays: 7,
    displayEstimatedDays: 7,
    selectedProduct: null,
    selectedSku: null,
    selectedSpecs: {},
    dimensionOptions: [],
    selectedFrameId: 'frame_wood_classic',
    selectedPackagingId: 'pkg_standard',
    selectedFramerId: '',
    brandCard: true,
    greetingEnabled: false,
    greeting: '',
    ritualCard: false,
    anonymous: false,
    customExtraPrice: 0,
    unitPrice: 0,
    totalPreview: '0.00',
    previewLines: [],
    theme: '',
    draftId: '',
    shareToken: '',
    isDirty: false,
    savingDraft: false,
    entryBlocked: false
  },

  onLoad(options) {
    const nav = getCustomNavLayout()
    let selectedPackagingId = 'pkg_standard'
    if (options.theme === 'birthday') {
      selectedPackagingId = 'pkg_birthday'
    }

    this.setData({
      statusBarHeight: nav.statusBarHeight,
      navPaddingRight: nav.navPaddingRight,
      headerHeight: nav.headerHeight,
      activeCategory: options.category || '',
      theme: options.theme || '',
      selectedPackagingId,
      greetingEnabled: options.theme === 'birthday',
      draftId: options.draftId || ''
    })

    this.guardAndBootstrap(options)
  },

  async guardAndBootstrap(options) {
    const { flags } = await fetchContentDisplayFlags()
    if (!flags.showSpecimenCustom) {
      this.setData({ loading: false, entryBlocked: true })
      toastSpecimenCustomClosed()
      setTimeout(() => {
        wx.navigateBack({
          fail: () => wx.switchTab({ url: '/pages/atelier/index' })
        })
      }, 400)
      return
    }
    trackBehavior('custom_enter', 'source', (options && options.from) || 'direct')
    this.updateStepUi(1)
    this.bootstrap(options)
  },

  onShow() {
    this.loadDrafts()
    this.syncLeaveGuard()
  },

  onHide() {
    this.disableLeaveGuard()
  },

  onUnload() {
    this.disableLeaveGuard()
  },

  syncLeaveGuard() {
    if (this.data.isDirty && wx.enableAlertBeforeUnload) {
      wx.enableAlertBeforeUnload({ message: '定制方案尚未保存，确定离开？' })
    }
  },

  disableLeaveGuard() {
    if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload()
  },

  markDirty() {
    if (!this.data.isDirty) {
      this.setData({ isDirty: true })
      this.syncLeaveGuard()
    }
  },

  updateStepUi(step) {
    const s = step || this.data.currentStep
    const meta = STEPS.find((x) => x.id === s) || STEPS[0]
    const frame = pickConfigOption(this.data.frames, this.data.selectedFrameId)
    const packaging = pickConfigOption(this.data.packaging, this.data.selectedPackagingId)
    this.setData({
      currentStepMeta: meta,
      selectedFrameName: frame ? frame.name : '待选择框型',
      selectedPackagingName: packaging ? packaging.name : '待选择包装'
    })
  },

  clearDirty() {
    this.setData({ isDirty: false })
    this.disableLeaveGuard()
  },

  async bootstrap(options) {
    this.setData({ loading: true })
    try {
      await Promise.all([this.loadConfig(), this.loadProducts()])
      if (options.draftId) {
        await this.applyDraftById(options.draftId)
      } else if (options.productId) {
        await this.prefillProduct(options.productId, parseInt(options.step, 10) || 2)
      }
    } finally {
      this.setData({ loading: false })
    }
  },

  async loadConfig() {
    try {
      const res = await wx.cloud.callFunction({ name: 'getCustomConfig' })
      const config = (res.result && res.result.config) || {}
      this.setData({
        frames: config.frames || [],
        packaging: config.packaging || [],
        framers: config.framers || [],
        estimatedDays: config.estimatedDays || 7,
        selectedFrameId: (config.frames && config.frames[0] && config.frames[0].id) || 'frame_wood_classic'
      })
      this.recalcPrice()
    } catch (e) {
      console.error('loadConfig', e)
    }
  },

  async loadDrafts() {
    try {
      const res = await wx.cloud.callFunction({ name: 'customDraft', data: { action: 'list' } })
      const list = (res.result && res.result.list) || []
      this.setData({
        drafts: list.map((d) => ({
          _id: d._id,
          title: d.title,
          updateTime: d.updateTime,
          specimenTitle: d.customMeta && d.customMeta.specimen ? d.customMeta.specimen.title : ''
        }))
      })
    } catch (e) {
      console.error('loadDrafts', e)
    }
  },

  async applyDraftById(draftId) {
    try {
      const res = await wx.cloud.callFunction({
        name: 'customDraft',
        data: { action: 'get', draftId }
      })
      if (!res.result || !res.result.success || !res.result.draft) return
      await this.applyDraftPayload(res.result.draft)
    } catch (e) {
      console.error('applyDraftById', e)
    }
  },

  async applyDraftPayload(draft) {
    const payload = draft.payload || {}
    let product = null
    if (payload.productId) {
      try {
        const res = await db.collection('products').doc(payload.productId).get()
        product = res.data
      } catch (e) {
        console.error(e)
      }
    }
    if (product) {
      this.selectProductInternal(product, payload.selectedSpecs || {})
    }
    this.setData({
      draftId: draft._id || '',
      shareToken: draft.shareToken || '',
      selectedFrameId: payload.selectedFrameId || this.data.selectedFrameId,
      selectedPackagingId: payload.selectedPackagingId || this.data.selectedPackagingId,
      selectedFramerId: payload.selectedFramerId || '',
      brandCard: payload.brandCard !== false,
      greetingEnabled: !!payload.greetingEnabled,
      greeting: payload.greeting || '',
      ritualCard: !!payload.ritualCard,
      anonymous: !!payload.anonymous,
      theme: payload.theme || this.data.theme,
      currentStep: Math.min(Math.max(payload.currentStep || 1, 1), 5)
    })
    this.recalcPrice()
    this.updateStepUi(this.data.currentStep)
    this.clearDirty()
  },

  applyProductFilter(products, keyword) {
    const kw = (keyword || '').trim().toLowerCase()
    if (!kw) return products || []
    return (products || []).filter((p) => {
      const title = (p.title || '').toLowerCase()
      const latin = (p.latinName || '').toLowerCase()
      const category = (p.category || '').toLowerCase()
      return title.includes(kw) || latin.includes(kw) || category.includes(kw)
    })
  },

  refreshProductFilter() {
    this.setData({
      filteredProducts: this.applyProductFilter(this.data.products, this.data.searchKeyword)
    })
  },

  async loadProducts() {
    try {
      const where = { isOffShelf: _.neq(true) }
      if (this.data.activeCategory) {
        where.category = this.data.activeCategory
      }
      const res = await db.collection('products')
        .where(where)
        .orderBy('createTime', 'desc')
        .limit(40)
        .get()
      const products = res.data || []
      this.setData({
        products,
        filteredProducts: this.applyProductFilter(products, this.data.searchKeyword)
      })
    } catch (e) {
      console.error('loadProducts', e)
      this.setData({ products: [], filteredProducts: [] })
    }
  },

  async prefillProduct(productId, step) {
    try {
      const res = await db.collection('products').doc(productId).get()
      const product = res.data
      if (!product) return
      if (product.supportsCustom === false) {
        wx.showModal({
          title: '暂不支持定制',
          content: '该件为成品藏品，暂不提供工坊定制服务。',
          showCancel: false,
          confirmText: '返回',
          confirmColor: '#C4A76C',
          success: () => wx.navigateBack()
        })
        return
      }
      this.selectProductInternal(product)
      const stepNum = Math.min(Math.max(step, 2), 5)
      this.setData({ currentStep: stepNum })
      this.updateStepUi(stepNum)
    } catch (e) {
      console.error('prefillProduct', e)
    }
  },

  switchCategory(e) {
    const id = e.currentTarget.dataset.id
    this.setData({ activeCategory: id, searchKeyword: '' })
    this.loadProducts()
  },

  onSearchInput(e) {
    const searchKeyword = e.detail.value || ''
    this.setData({
      searchKeyword,
      filteredProducts: this.applyProductFilter(this.data.products, searchKeyword)
    })
  },

  onSearchConfirm(e) {
    const searchKeyword = (e.detail.value || '').trim()
    this.setData({
      searchKeyword,
      filteredProducts: this.applyProductFilter(this.data.products, searchKeyword)
    })
  },

  clearSearch() {
    this.setData({ searchKeyword: '' })
    this.refreshProductFilter()
  },

  selectProductById(e) {
    const id = e.currentTarget.dataset.id
    const product = this.data.products.find((p) => p._id === id)
    if (!product) return
    this.selectProductInternal(product)
    this.markDirty()
    this.goNext()
  },

  loadDraft(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.showLoading({ title: '加载方案…' })
    this.applyDraftById(id).finally(() => wx.hideLoading())
  },

  deleteDraft(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.showModal({
      title: '删除方案',
      content: '确定删除这条定制方案？',
      success: async (res) => {
        if (!res.confirm) return
        await wx.cloud.callFunction({ name: 'customDraft', data: { action: 'delete', draftId: id } })
        if (this.data.draftId === id) this.setData({ draftId: '', shareToken: '' })
        this.loadDrafts()
        wx.showToast({ title: '已删除' })
      }
    })
  },

  selectProductInternal(product, presetSpecs) {
    let selectedSpecs = presetSpecs || {}
    let selectedSku = null
    if (hasSkus(product)) {
      if (!Object.keys(selectedSpecs).length) {
        selectedSpecs = initSelectedSpecs(product)
      }
      selectedSku = resolveSkuFromSpecs(product, selectedSpecs)
    }
    const unitPrice = selectedSku
      ? (parseFloat(selectedSku.price) || 0)
      : getDisplayPrice(product)

    this.setData({
      selectedProduct: product,
      selectedSpecs,
      selectedSku,
      unitPrice,
      dimensionOptions: this.buildDimensionOptions(product, selectedSpecs)
    })
    this.recalcPrice()
  },

  buildDimensionOptions(product, selectedSpecs) {
    if (!hasSkus(product)) return []
    const dims = getSkuDimensions(product)
    return dims.map((name) => ({
      name,
      values: getDimensionValues(product, name, selectedSpecs).map((value) => ({
        value,
        disabled: !isDimensionValueAvailable(product, name, value, selectedSpecs)
      }))
    }))
  },

  selectDimension(e) {
    const dim = e.currentTarget.dataset.dim
    const value = e.currentTarget.dataset.value
    const product = this.data.selectedProduct
    if (!product || !dim || !value) return
    if (!isDimensionValueAvailable(product, dim, value, this.data.selectedSpecs)) return

    const selectedSpecs = { ...this.data.selectedSpecs, [dim]: value }
    const selectedSku = resolveSkuFromSpecs(product, selectedSpecs)
    const unitPrice = selectedSku
      ? (parseFloat(selectedSku.price) || 0)
      : getDisplayPrice(product)

    this.setData({
      selectedSpecs,
      selectedSku,
      unitPrice,
      dimensionOptions: this.buildDimensionOptions(product, selectedSpecs)
    })
    this.markDirty()
    this.recalcPrice()
  },

  selectFrame(e) {
    this.setData({ selectedFrameId: e.currentTarget.dataset.id })
    this.markDirty()
    this.recalcPrice()
  },

  selectPackaging(e) {
    this.setData({ selectedPackagingId: e.currentTarget.dataset.id })
    this.markDirty()
    this.recalcPrice()
  },

  selectFramer(e) {
    const id = e.currentTarget.dataset.id
    this.setData({ selectedFramerId: id === this.data.selectedFramerId ? '' : id })
    this.markDirty()
    this.recalcPrice()
  },

  onGreetingSwitch(e) {
    this.setData({ greetingEnabled: e.detail.value })
    this.markDirty()
    this.recalcPrice()
  },

  onGreetingInput(e) {
    this.setData({ greeting: (e.detail.value || '').slice(0, 60) })
    this.markDirty()
  },

  onRitualSwitch(e) {
    this.setData({ ritualCard: e.detail.value })
    this.markDirty()
  },

  onAnonymousSwitch(e) {
    this.setData({ anonymous: e.detail.value })
    this.markDirty()
  },

  recalcPrice() {
    const frame = pickConfigOption(this.data.frames, this.data.selectedFrameId)
    const packaging = pickConfigOption(this.data.packaging, this.data.selectedPackagingId)
    const framer = pickConfigOption(this.data.framers, this.data.selectedFramerId)
    const customExtraPrice = calcCustomExtra(frame, packaging, framer)
    const unitPrice = this.data.unitPrice || 0
    const totalPreview = (unitPrice + customExtraPrice).toFixed(2)
    const displayEstimatedDays = calcEstimatedDays(this.data.estimatedDays, framer)

    const customMeta = this.buildCurrentMeta()
    this.setData({
      customExtraPrice,
      totalPreview,
      displayEstimatedDays,
      previewLines: buildPreviewSummary(customMeta)
    })
    this.updateStepUi()
  },

  buildCurrentMeta() {
    const frame = pickConfigOption(this.data.frames, this.data.selectedFrameId)
    const packaging = pickConfigOption(this.data.packaging, this.data.selectedPackagingId)
    const framer = pickConfigOption(this.data.framers, this.data.selectedFramerId)
    return buildCustomMeta({
      product: this.data.selectedProduct || {},
      sku: this.data.selectedSku,
      frame,
      packaging,
      framer: framer || null,
      cards: {
        brandCard: this.data.brandCard,
        greetingEnabled: this.data.greetingEnabled,
        greeting: this.data.greeting,
        ritualCard: this.data.ritualCard,
        anonymous: this.data.anonymous
      },
      estimatedDays: this.data.estimatedDays
    })
  },

  goNext() {
    if (!this.validateStep(this.data.currentStep)) return
    const next = Math.min(this.data.currentStep + 1, 5)
    this.setData({ currentStep: next })
    this.updateStepUi(next)
    if (next === 5) this.recalcPrice()
    trackBehavior('custom_step_view', 'step', String(next))
  },

  goPrev() {
    const prev = Math.max(this.data.currentStep - 1, 1)
    this.setData({ currentStep: prev })
    this.updateStepUi(prev)
  },

  validateStep(step) {
    if (step === 1 && !this.data.selectedProduct) {
      wx.showToast({ title: '请选择藏品', icon: 'none' })
      return false
    }
    if (step === 2 && this.data.selectedProduct && hasSkus(this.data.selectedProduct) && !this.data.selectedSku) {
      wx.showToast({ title: '请选择规格', icon: 'none' })
      return false
    }
    if (step === 4 && this.data.greetingEnabled && String(this.data.greeting || '').trim().length < 2) {
      wx.showToast({ title: '请填写祝福内容', icon: 'none' })
      return false
    }
    return true
  },

  async saveDraft(forShare) {
    if (!this.data.selectedProduct) {
      wx.showToast({ title: '请先选择藏品', icon: 'none' })
      return null
    }
    this.setData({ savingDraft: true })
    try {
      const customMeta = this.buildCurrentMeta()
      const payload = serializeWizardState(this.data)
      const res = await wx.cloud.callFunction({
        name: 'customDraft',
        data: {
          action: 'save',
          draftId: this.data.draftId || '',
          title: buildDraftTitle(customMeta),
          payload,
          customMeta,
          forShare: !!forShare
        }
      })
      const result = res.result || {}
      if (!result.success) {
        wx.showToast({ title: result.msg || '保存失败', icon: 'none' })
        return null
      }
      this.setData({
        draftId: result.draftId || this.data.draftId,
        shareToken: result.shareToken || this.data.shareToken
      })
      this.clearDirty()
      this.loadDrafts()
      return result
    } catch (e) {
      console.error(e)
      wx.showToast({ title: '保存失败', icon: 'none' })
      return null
    } finally {
      this.setData({ savingDraft: false })
    }
  },

  promptSaveDraft(onLeave) {
    wx.showModal({
      title: '保存草稿？',
      content: '是否保存当前定制方案，方便下次继续？',
      confirmText: '保存',
      cancelText: '不保存',
      success: async (res) => {
        if (res.confirm) {
          const saved = await this.saveDraft(false)
          if (saved) wx.showToast({ title: '已保存' })
        } else {
          this.clearDirty()
        }
        if (typeof onLeave === 'function') onLeave()
      }
    })
  },

  goToSupport() {
    wx.navigateTo({ url: '/subpackages/feature/user/support/index?topic=custom' })
  },

  goARPreview(e) {
    const product = this.data.selectedProduct
    if (!product) {
      wx.showToast({ title: '请先选择藏品', icon: 'none' })
      return
    }
    const frame = pickConfigOption(this.data.frames, this.data.selectedFrameId)
    const image = (this.data.selectedSku && this.data.selectedSku.image)
      || (product.images && product.images[0])
      || ''
    if (!image) {
      wx.showToast({ title: '暂无藏品图片', icon: 'none' })
      return
    }
    const staticPreview = e && e.currentTarget.dataset.static === '1'
    const q = [
      'mode=custom',
      `frameId=${encodeURIComponent(this.data.selectedFrameId || 'frame_wood_classic')}`,
      `frameName=${encodeURIComponent(frame ? frame.name : '装裱预览')}`,
      `img=${encodeURIComponent(image)}`,
      `title=${encodeURIComponent(product.title || '')}`
    ]
    if (staticPreview) q.push('preview=static')
    trackBehavior('custom_ar_preview', 'mode', staticPreview ? 'static' : 'camera')
    wx.navigateTo({ url: `/subpackages/business/ar/index?${q.join('&')}` })
  },

  async goBookStoreVisit() {
    if (!this.data.selectedProduct) {
      wx.showToast({ title: '请先完成定制方案', icon: 'none' })
      return
    }
    if (!this.validateStep(4)) return
    wx.showLoading({ title: '保存方案…' })
    const saved = await this.saveDraft(false)
    wx.hideLoading()
    const draftId = (saved && saved.draftId) || this.data.draftId
    if (!draftId) {
      wx.showToast({ title: '保存失败', icon: 'none' })
      return
    }
    trackBehavior('custom_book_store', 'draft', draftId)
    wx.navigateTo({
      url: `/subpackages/business/booking/index?from=custom&draftId=${draftId}&tab=0`
    })
  },

  async goEnterpriseInquiry() {
    if (!this.data.selectedProduct) {
      wx.showToast({ title: '请先完成定制方案', icon: 'none' })
      return
    }
    if (!this.validateStep(4)) return
    wx.showLoading({ title: '保存方案…' })
    const saved = await this.saveDraft(false)
    wx.hideLoading()
    const draftId = (saved && saved.draftId) || this.data.draftId
    if (!draftId) {
      wx.showToast({ title: '保存失败', icon: 'none' })
      return
    }
    trackBehavior('custom_inquiry_enter', 'type', 'enterprise')
    wx.navigateTo({
      url: `/subpackages/feature/custom/inquiry/index?type=enterprise&draftId=${draftId}`
    })
  },

  async sharePlan() {
    if (!this.validateStep(4)) return
    wx.showLoading({ title: '生成分享…' })
    const result = await this.saveDraft(true)
    wx.hideLoading()
    if (!result || !result.shareToken) {
      wx.showToast({ title: '分享准备失败', icon: 'none' })
      return
    }
    wx.navigateTo({
      url: `/subpackages/feature/custom/share/index?token=${result.shareToken}`
    })
  },

  submitCustomOrder() {
    if (!this.validateStep(4)) return
    const product = this.data.selectedProduct
    if (!product) {
      wx.showToast({ title: '请先选择藏品', icon: 'none' })
      return
    }

    const customMeta = this.buildCurrentMeta()
    const unitPrice = customMeta.specimen.unitPrice
    const checkoutItem = {
      productId: product._id,
      skuId: customMeta.specimen.skuId || '',
      count: 1,
      price: unitPrice,
      title: product.title,
      latinName: product.latinName || '',
      image: customMeta.specimen.image,
      skuLabel: customMeta.specimen.skuLabel
    }

    this.clearDirty()
    trackBehavior('custom_order_submit', 'product', product._id)
    navigateToCustomCheckout(customMeta, checkoutItem)
  },

  goBack() {
    if (this.data.currentStep > 1) {
      this.goPrev()
      return
    }
    if (this.data.isDirty && this.data.selectedProduct) {
      this.promptSaveDraft(() => wx.navigateBack())
      return
    }
    wx.navigateBack()
  },

  onShareAppMessage() {
    const customMeta = this.buildCurrentMeta()
    const title = buildDraftTitle(customMeta)
    if (this.data.shareToken) {
      return {
        title: `${title} · 山海造物`,
        path: `/subpackages/feature/custom/share/index?token=${this.data.shareToken}`
      }
    }
    return {
      title: '山海造物 · 标本工坊',
      path: '/subpackages/feature/custom/index'
    }
  }
})
