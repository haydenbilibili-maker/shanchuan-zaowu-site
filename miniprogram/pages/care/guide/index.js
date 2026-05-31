// pages/care/guide/index.js
const app = getApp()
const { getWindowInfo } = require('../../../utils/systemInfo')
const { trackBehavior } = require('../../../utils/trackBehavior')
const { denyOrderAccess } = require('../../../utils/orderScope')
const {
  getGuideByCategory,
  getCategoryMeta,
  normalizeCategory
} = require('../../../utils/careDefaults')
const { fetchCareGuide } = require('../../../utils/careApi')
const { loadCareOrderContext } = require('../../../utils/careSpecimens')
const { measureFixedScroll } = require('../../../utils/scrollArea')

Page({
  data: {
    statusBarHeight: 0,
    scrollTopPx: 100,
    scrollHeightPx: 500,
    category: 'GENERAL',
    categoryColor: '#C4A76C',
    orderId: '',
    productId: '',
    guide: {},
    contentSections: [],
    warningSection: null,
    contextTitle: '',
    framingName: '',
    framingTips: [],
    loading: true,
    pageReady: false,
    scrollIntoView: '',
    activeSection: '',
    collapsedSections: {}
  },

  onLoad(options) {
    const win = getWindowInfo()
    const category = normalizeCategory(options.category || 'GENERAL')
    const meta = getCategoryMeta(category)

    this.setData({
      statusBarHeight: win.statusBarHeight || 0,
      category,
      categoryColor: meta.color,
      orderId: options.orderId || '',
      productId: options.productId || ''
    })

    trackBehavior('care_guide_view', 'category', category)
    if (options.from === 'message' || options.from === 'care_tip') {
      trackBehavior('care_tip_message_open', 'orderId', options.orderId || '')
    }
    this._initPage(options, category)
  },

  onReady() {
    this.remeasureScroll()
  },

  async remeasureScroll() {
    const area = await measureFixedScroll(this, {
      topSelector: '.care-header',
      fallbackTop: 100
    })
    this.setData(area)
  },

  async _initPage(options, category) {
    await this.loadGuide(category)
    if (options.orderId) {
      await this.loadOrderContext(options.orderId, options.productId)
    }
  },

  async loadGuide(category) {
    this.setData({ loading: true })
    try {
      const { guide } = await fetchCareGuide(category)
      const sections = guide.sections || []
      const warningSection = sections.find((s) => s.key === 'warning') || null
      const contentSections = sections.filter((s) => s.key !== 'warning')

      this.setData({
        guide,
        contentSections,
        warningSection,
        activeSection: contentSections[0] ? contentSections[0].key : ''
      })
    } catch (e) {
      const fallback = getGuideByCategory(category)
      const sections = fallback.sections || []
      this.setData({
        guide: fallback,
        contentSections: sections.filter((s) => s.key !== 'warning'),
        warningSection: sections.find((s) => s.key === 'warning') || null,
        activeSection: sections[0] ? sections[0].key : ''
      })
    } finally {
      this.setData({ loading: false })
      this.remeasureScroll()
      setTimeout(() => this.setData({ pageReady: true }), 50)
    }
  },

  jumpToSection(e) {
    const key = e.currentTarget.dataset.key
    wx.vibrateShort({ type: 'light' })
    this.setData({ scrollIntoView: `section-${key}`, activeSection: key })
  },

  toggleSection(e) {
    const key = e.currentTarget.dataset.key
    wx.vibrateShort({ type: 'light' })
    const collapsed = { ...this.data.collapsedSections }
    collapsed[key] = !collapsed[key]
    this.setData({ collapsedSections: collapsed, activeSection: key })
  },

  async loadOrderContext(orderId, productId) {
    try {
      const ctx = await loadCareOrderContext(app, orderId, productId)
      if (!ctx.success) {
        if (ctx.msg === '无权查看') denyOrderAccess()
        return
      }

      const contextTitle = ctx.contextTitle || ''
      const framingName = ctx.framingName || ''
      const framingTips = []
      const guide = this.data.guide && this.data.guide.sections
        ? this.data.guide
        : getGuideByCategory(this.data.category)

      if (framingName && guide.framingAddons && guide.framingAddons.length) {
        guide.framingAddons.forEach((addon) => {
          if (addon.extraTips) framingTips.push(...addon.extraTips)
        })
        framingTips.unshift(`您本次装裱为「${framingName}」，请注意框体防潮与挂置稳固。`)
      } else if (framingName) {
        framingTips.push(`您本次装裱为「${framingName}」，请注意框体防潮与挂置稳固。`)
      }

      if (ctx.isCustom && this.data.category !== 'FRAMING') {
        const framingGuide = getGuideByCategory('FRAMING')
        if (framingGuide.sections && framingGuide.sections[0]) {
          framingTips.push(
            framingGuide.sections[0].tips && framingGuide.sections[0].tips[0]
              ? framingGuide.sections[0].tips[0]
              : '定制框体如有异常请联系工坊专员。'
          )
        }
      }

      this.setData({ contextTitle, framingName, framingTips })
    } catch (e) {
      console.warn('loadOrderContext', e)
    }
  },

  goToCertificate() {
    const orderId = this.data.orderId
    if (!orderId) return
    wx.navigateTo({
      url: `/subpackages/business/certificate/index?id=${orderId}`,
      fail: () => wx.showToast({ title: '证书暂不可用', icon: 'none' })
    })
  },

  goToSupport() {
    const q = ['topic=specimen_care']
    if (this.data.orderId) q.push(`orderId=${this.data.orderId}`)
    wx.navigateTo({ url: `/pages/user/support/index?${q.join('&')}` })
    trackBehavior('care_escalation_support', 'category', this.data.category)
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.redirectTo({ url: '/pages/care/index' }) })
  }
})
