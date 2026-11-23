/**
 * 博物君 · 今日一物（2026-11-23）：每天从山海图鉴里取一件，做成一张文字标本签。
 * 不出图版（图版是「翻开那一页」的奖励）；只读本地图鉴目录，不调云函数。
 */
const N = require('../naturalist')
const { ATLAS_SPECIES, ATLAS_SERIES } = require('../../config/atlasCatalog')

const GUIDE = '/subpackages/feature/museum-guide/index'

Page({
  data: { card: null, past: [] },

  onLoad() {
    const now = Date.now()
    this.setData({ card: N.dailyCard(ATLAS_SPECIES, ATLAS_SERIES, now), past: N.pastDaily(ATLAS_SPECIES, now, 6) })
  },

  onShareAppMessage() {
    const c = this.data.card
    return { title: c ? `今日一物 · ${c.nameZh}` : '博物君 · 今日一物', path: '/subpackages/feature/museum-guide/daily/index' }
  },

  /** 问博物君关于它：带着问题过去自动发问 */
  onAsk() {
    const c = this.data.card
    if (!c) return
    wx.navigateTo({ url: `${GUIDE}?from=daily&auto=1&q=${encodeURIComponent(c.askQ)}` })
  },

  /** 去图鉴看看：没翻开的页由图鉴详情自己显示空页（不剧透图版） */
  onAtlas(e) {
    const no = (e && e.currentTarget && e.currentTarget.dataset.no) || (this.data.card && this.data.card.no)
    if (!no) return
    wx.navigateTo({ url: `/subpackages/feature/collection/detail/index?id=${encodeURIComponent(no)}` })
  }
})
