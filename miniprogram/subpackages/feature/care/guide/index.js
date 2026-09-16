// subpackages/feature/care/guide/index.js
const app = getApp()
const { getPageNavInsets } = require('../../utils/pageNav')
const { trackBehavior } = require('../../../../utils/trackBehavior')
const { denyOrderAccess } = require('../../../../utils/orderScope')
const {
  getGuideByCategory,
  getCategoryMeta,
  normalizeCategory
} = require('../../utils/careDefaults')
const { fetchCareGuide } = require('../../utils/careApi')
const { loadCareOrderContext } = require('../../utils/careSpecimens')
const { measureFixedScroll } = require('../../../../utils/scrollArea')

const SECTION_OVERLINE = {
  environment: 'ENVIRONMENT',
  placement: 'PLACEMENT',
  cleaning: 'CLEANING',
  transport: 'TRANSPORT',
  warning: 'CAUTION'
}

function splitGuideHeading(guide, meta) {
  const raw = (guide && guide.title) || (meta && meta.label) || '养护指南'
  const idx = raw.indexOf('·')
  if (idx > 0) {
    return {
      heading: raw.slice(0, idx).trim() || meta.label,
      lead: raw.slice(idx + 1).trim()
    }
  }
  return { heading: meta.label || raw, lead: '' }
}

function decorateSections(sections) {
  return (sections || []).map((s, i) => ({
    ...s,
    overline: SECTION_OVERLINE[s.key] || `0${i + 1}`,
    indexLabel: String(i + 1).padStart(2, '0')
  }))
}

function contextKind(from) {
  if (from === 'order' || from === 'receipt' || from === 'certificate' || from === 'message' || from === 'care_tip') {
    return 'order'
  }
  if (from === 'my' || from === 'hub_my') return 'collection'
  return 'related'
}

function contextCopy(kind) {
  if (kind === 'order') return { contextOverline: 'ORDER', contextLabelText: '来自订单' }
  if (kind === 'collection') return { contextOverline: 'COLLECTION', contextLabelText: '来自藏品' }
  return { contextOverline: 'SPECIMEN', contextLabelText: '关联藏品' }
}

Page({
  data: {
    statusBarHeight: 0,
    navPaddingRight: 96,
    navBarHeight: 44,
    scrollTopPx: 100,
    scrollHeightPx: 500,
    category: 'GENERAL',
    categoryColor: '#C4A76C',
    categoryLabel: '通用安放',
    categoryOverline: 'GENERAL',
    categoryHeading: '通用安放',
    categoryLead: '',
    from: '',
    contextKind: '',
    contextOverline: 'SPECIMEN',
    contextLabelText: '关联藏品',
    orderId: '',
    productId: '',
    guide: {},
    contentSections: [],
    warningSection: null,
    contextTitle: '',
    framingName: '',
    framingTips: [],
    isCustom: false,
    hasGuide: false,
    loading: true,
    loadError: false,
    pageReady: false,
    scrollIntoView: '',
    activeSection: '',
    collapsedSections: {}
  },

  onLoad(options) {
    const nav = getPageNavInsets({ nativeNav: true })
    const rawCategory = options.category || ''
    const orderId = options.orderId || ''
    const category = normalizeCategory(rawCategory || 'GENERAL')
    const meta = getCategoryMeta(category)
    const from = options.from || ''
    const kind = contextKind(from)

    this.setData({
      statusBarHeight: nav.statusBarHeight || 0,
      navPaddingRight: nav.navPaddingRight,
      navBarHeight: nav.navBarHeight,
      category,
      categoryColor: meta.color,
      categoryLabel: meta.label,
      categoryOverline: meta.overline,
      from,
      contextKind: kind,
      ...contextCopy(kind),
      orderId,
      productId: options.productId || ''
    })

    trackBehavior('care_guide_view', 'category', category)
    if (from === 'message' || from === 'care_tip') {
      trackBehavior('care_tip_message_open', 'orderId', orderId)
    }

    this._options = options
    this._initPage(options, category)
  },

  onReady() {
    this.remeasureScroll()
  },

  async remeasureScroll() {
    const area = await measureFixedScroll(this, {
      topSelector: '.care-header',
      bottomSelector: '.guide-footer',
      fallbackTop: 100,
      fallbackBottom: 120
    })
    this.setData(area)
  },

  async _initPage(options, category) {
    await this.loadGuide(category)
    if (options.orderId) {
      await this.loadOrderContext(options.orderId, options.productId)
    }
  },

  applyGuide(guide, extras = {}) {
    const doc = guide || {}
    const meta = getCategoryMeta(this.data.category)
    const heading = splitGuideHeading(doc, meta)
    const sections = doc.sections || []
    const warningRaw = sections.find((s) => s.key === 'warning') || null
    const contentRaw = sections.filter((s) => s.key !== 'warning')
    const contentSections = decorateSections(contentRaw)
    const warningSection = warningRaw
      ? { ...warningRaw, overline: SECTION_OVERLINE.warning }
      : null
    const hasGuide = contentSections.length > 0 || !!warningSection || !!(doc.summary)

    this.setData({
      guide: doc,
      contentSections,
      warningSection,
      categoryHeading: heading.heading,
      categoryLead: heading.lead,
      hasGuide,
      activeSection: contentSections[0] ? contentSections[0].key : '',
      ...extras
    })
  },

  async loadGuide(category) {
    this.setData({ loading: true, loadError: false, pageReady: false })
    try {
      const { guide, ok } = await fetchCareGuide(category)
      const usable = guide && ((guide.sections && guide.sections.length) || guide.summary)
      this.applyGuide(usable ? guide : getGuideByCategory(category), {
        loadError: !ok || !usable
      })
    } catch (e) {
      this.applyGuide(getGuideByCategory(category), { loadError: true })
    } finally {
      this.setData({ loading: false })
      this.remeasureScroll()
      setTimeout(() => this.setData({ pageReady: true }), 50)
    }
  },

  retryLoad() {
    wx.vibrateShort({ type: 'light' })
    const options = this._options || {}
    this._initPage(options, this.data.category)
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
      const isCustom = !!ctx.isCustom
      const framingTips = []
      const guide = this.data.guide && this.data.guide.sections
        ? this.data.guide
        : getGuideByCategory(this.data.category)

      if (framingName && guide.framingAddons && guide.framingAddons.length) {
        guide.framingAddons.forEach((addon) => {
          if (addon.extraTips) framingTips.push(...addon.extraTips)
        })
        framingTips.unshift(`本次装裱为「${framingName}」，框体请防潮、挂置请稳固。`)
      } else if (framingName) {
        framingTips.push(`本次装裱为「${framingName}」，框体请防潮、挂置请稳固。`)
      }

      if (isCustom && this.data.category !== 'FRAMING') {
        const framingGuide = getGuideByCategory('FRAMING')
        const first = framingGuide.sections && framingGuide.sections[0]
        framingTips.push(
          first && first.tips && first.tips[0]
            ? first.tips[0]
            : '定制框体如有异常，请联系工坊专员查看，不建议自行拆框。'
        )
      }

      this.setData({
        contextTitle,
        framingName,
        isCustom,
        framingTips,
        contextKind: this.data.contextKind || (contextTitle ? 'related' : ''),
        ...contextCopy(this.data.contextKind || (contextTitle ? 'related' : ''))
      })
    } catch (e) {
      console.warn('loadOrderContext', e)
    }
  },

  goToCertificate() {
    const orderId = this.data.orderId
    if (!orderId) {
      wx.showToast({ title: '订单信息缺失', icon: 'none' })
      return
    }
    wx.navigateTo({
      url: `/subpackages/business/certificate/index?id=${orderId}`,
      fail: () => wx.showToast({ title: '证书暂不可用', icon: 'none' })
    })
  },

  goToSupport() {
    const q = ['topic=specimen_care']
    if (this.data.orderId) q.push(`orderId=${this.data.orderId}`)
    wx.navigateTo({
      url: `/subpackages/extra/user/support/index?${q.join('&')}`,
      fail: () => wx.showToast({ title: '客服页暂不可用', icon: 'none' })
    })
    trackBehavior('care_escalation_support', 'category', this.data.category)
  },

  goToHub() {
    wx.vibrateShort({ type: 'light' })
    const pages = getCurrentPages()
    const prev = pages.length > 1 ? pages[pages.length - 2] : null
    if (prev && prev.route === 'subpackages/feature/care/index') {
      wx.navigateBack()
      return
    }
    wx.redirectTo({
      url: '/subpackages/feature/care/index?from=guide',
      fail: () => wx.navigateTo({
        url: '/subpackages/feature/care/index?from=guide',
        fail: () => wx.showToast({ title: '无法打开养护页', icon: 'none' })
      })
    })
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.redirectTo({ url: '/subpackages/feature/care/index' }) })
  }
})
