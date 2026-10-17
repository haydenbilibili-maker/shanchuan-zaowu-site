// subpackages/feature/care/index.js
const app = getApp()
const { trackBehavior } = require('../../../utils/trackBehavior')
const { buildGuideUrl, CATEGORY_CARDS, GENERAL_TIPS } = require('../utils/careDefaults')
const { loadUserSpecimens } = require('../utils/careSpecimens')
const { fetchCareHub, getSeasonalTip } = require('../utils/careApi')
const { carePlateOf } = require('../utils/atlasPlates')
const easterEggHost = require('../../../utils/easterEggHost')

/** 品类卡配刻版线描（与山海图鉴同一套；未登记的品类不配图，卡片照常） */
function withPlates(cards) {
  return (cards || []).map((c) => Object.assign({}, c, { plate: carePlateOf(c.category) }))
}

Page({
  behaviors: [easterEggHost],
  data: {
    categoryCards: [],
    generalTips: [],
    recentSpecimens: [],
    specimenTotal: 0,
    seasonalTip: null,
    loading: true,
    pageReady: false,
    expandedTip: 'light',
    seasonEyebrow: ''
  },

  onLoad(options) {
    /* 2026-10-17「养护手册」重构：原生导航栏已写「标本养护」，页内不再叠一条自绘页头 + 固定 scroll-view，改回页面滚动 */
    const SEASON_EN = { spring: 'SPRING', summer: 'SUMMER', autumn: 'AUTUMN', winter: 'WINTER' }
    const tip = getSeasonalTip()
    this.setData({
      seasonalTip: tip,
      seasonEyebrow: tip ? `${SEASON_EN[tip.key] || 'SEASON'} · ${new Date().getMonth() + 1} 月` : ''
    })
    trackBehavior('care_hub_enter', 'from', options.from || 'direct')
    this.bootstrap()
  },

  onShow() {
    this.refreshSpecimens()
  },

  async bootstrap() {
    this.setData({ loading: true })
    try {
      const hub = await fetchCareHub()
      this.setData({
        categoryCards: withPlates((hub.categoryCards && hub.categoryCards.length) ? hub.categoryCards : CATEGORY_CARDS),
        generalTips: (hub.generalTips && hub.generalTips.length) ? hub.generalTips : GENERAL_TIPS
      })
    } catch (e) {
      console.warn('care hub bootstrap', e)
      this.setData({ categoryCards: withPlates(CATEGORY_CARDS), generalTips: GENERAL_TIPS })
    }
    await this.refreshSpecimens()
    this.setData({ loading: false })
    setTimeout(() => this.setData({ pageReady: true }), 50)
  },

  async refreshSpecimens() {
    try {
      const all = await loadUserSpecimens(app, { limit: 50 })
      this.setData({
        recentSpecimens: all.slice(0, 3),
        specimenTotal: all.length
      })
    } catch (e) {
      console.warn('refreshSpecimens', e)
      this.setData({ recentSpecimens: [], specimenTotal: 0 })
    }
  },

  openCategory(e) {
    wx.vibrateShort({ type: 'light' })
    const category = e.currentTarget.dataset.category
    if (!category) {
      wx.showToast({ title: '品类信息缺失', icon: 'none' })
      return
    }
    wx.navigateTo({
      url: buildGuideUrl({ category, from: 'hub' }),
      fail: () => wx.showToast({ title: '指南暂不可用', icon: 'none' })
    })
  },

  openSpecimenCare(e) {
    wx.vibrateShort({ type: 'light' })
    const { category, orderId, productId } = e.currentTarget.dataset
    wx.navigateTo({
      url: buildGuideUrl({ category, orderId, productId, from: 'hub_my' }),
      fail: () => wx.showToast({ title: '指南暂不可用', icon: 'none' })
    })
  },

  toggleTip(e) {
    const key = e.currentTarget.dataset.key
    wx.vibrateShort({ type: 'light' })
    this.setData({ expandedTip: this.data.expandedTip === key ? '' : key })
  },

  scrollToCategories() {
    wx.vibrateShort({ type: 'light' })
    wx.pageScrollTo({ selector: '#care-categories', duration: 300, fail: () => {} })
  },

  goToMySpecimens() {
    wx.vibrateShort({ type: 'light' })
    trackBehavior('care_my_specimen_tap', 'from', 'hub')
    wx.navigateTo({
      url: '/subpackages/feature/care/my/index?from=hub',
      fail: () => wx.showToast({ title: '无法打开藏品列表', icon: 'none' })
    })
  },

  goToSupport() {
    wx.navigateTo({
      url: '/subpackages/extra/user/support/index?topic=specimen_care',
      fail: () => wx.showToast({ title: '客服页暂不可用', icon: 'none' })
    })
  },

  goBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/user/index' }) })
  }
})
