// subpackages/feature/care/guide/index.js
const app = getApp()
const { trackBehavior } = require('../../../../utils/trackBehavior')
const { denyOrderAccess } = require('../../../../utils/orderScope')
const {
  getGuideByCategory,
  getCategoryMeta,
  normalizeCategory
} = require('../../utils/careDefaults')
const { fetchCareGuide } = require('../../utils/careApi')
const { loadCareOrderContext } = require('../../utils/careSpecimens')
const { carePlateOf } = require('../../utils/atlasPlates')

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
  // 印刷礼笺上的小程序码（scene=from=gift_print）：说"关联藏品"是错的 —— 他手里那张纸上没写是哪件标本，
  // 扫进来就是**先看通用养护**。标成"来自礼笺"才对得上他刚才做的事（这也是归因能用的那一层）。
  if (from === 'gift_print' || from === 'gift') return 'gift'
  return 'related'
}

function contextCopy(kind) {
  if (kind === 'order') return { contextOverline: 'ORDER', contextLabelText: '来自订单' }
  if (kind === 'collection') return { contextOverline: 'COLLECTION', contextLabelText: '来自藏品' }
  if (kind === 'gift') return { contextOverline: 'GIFT NOTE', contextLabelText: '来自礼笺' }
  return { contextOverline: 'SPECIMEN', contextLabelText: '关联藏品' }
}

Page({
  data: {
    categoryPlate: '',
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
    activeSection: '',
    collapsedSections: {}
  },

  onLoad(options) {
    // 印刷礼笺上的小程序码走 `wxacode.getUnlimited`：页面收到的**不是** `from=xxx`，
    // 而是整串 `scene`（同 `subpackages/feature/identify/index.js` 与祈福墙的解析方式）。
    // 不解析它 → 扫礼笺进来会被当成"没有来源"，上下文标签与归因全丢。
    const sceneText = options && options.scene ? decodeURIComponent(String(options.scene)) : ''
    const sceneOf = (key) => {
      const m = new RegExp('(?:^|[&?])' + key + '=([^&]+)').exec(sceneText)
      return m ? m[1] : ''
    }
    const rawCategory = options.category || sceneOf('category') || ''
    const orderId = options.orderId || ''
    const category = normalizeCategory(rawCategory || 'GENERAL')
    const meta = getCategoryMeta(category)
    const from = options.from || sceneOf('from') || ''
    const kind = contextKind(from)

    this.setData({
      category,
      categoryPlate: carePlateOf(category),
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
    // 2026-10-17：改回页面滚动（原自绘页头 + 固定 scroll-view 退场），章节跳转用 pageScrollTo；留出章节目录的高度
    this.setData({ activeSection: key })
    wx.pageScrollTo({ selector: `#section-${key}`, offsetTop: -16, duration: 300, fail: () => {} })
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
