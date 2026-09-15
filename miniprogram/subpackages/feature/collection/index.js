const { trackBehavior } = require('../../../utils/trackBehavior')
const {
  callAtlas,
  withMarks,
  enrichCardSpots,
  localCatalogPack,
  parseEnterSpot,
  formatRecentLogs,
  emptyUnlockSheet
} = require('../utils/atlas')

const FILTERS = [
  { id: 'all', label: '全部' },
  { id: '昆虫', label: '昆虫' },
  { id: '植物', label: '植物' },
  { id: '矿石', label: '矿石' },
  { id: '海洋', label: '海洋' }
]

const RARITY_FILTERS = [
  { id: 'all', label: '不限' },
  { id: 'common', label: '普通' },
  { id: 'rare', label: '稀有' },
  { id: 'legendary', label: '传奇' }
]

Page({
  data: {
    loading: true,
    loadError: false,
    offline: false,
    cards: [],
    filtered: [],
    leftCol: [],
    rightCol: [],
    stats: { total: 0, unlocked: 0, percent: 0, series: [] },
    filters: FILTERS,
    rarityFilters: RARITY_FILTERS,
    filter: 'all',
    rarityFilter: 'all',
    showAiIdentify: true,
    seriesFilter: '',
    seriesBlurb: '',
    recentNotes: [],
    unlockSheet: emptyUnlockSheet(),
    filterEmpty: false,
    catalogEmpty: false,
    skelLeft: [1, 2, 3],
    skelRight: [4, 5, 6]
  },

  onLoad(options) {
    this._pendingSpot = parseEnterSpot(options)
    trackBehavior('atlas_view', 'atlas', 'index', {})
    this.loadDisplayFlags()
  },

  onShow() {
    const app = getApp()
    if (app.globalData && app.globalData.pendingAtlasSpot) {
      this._pendingSpot = this._pendingSpot || app.globalData.pendingAtlasSpot
      app.globalData.pendingAtlasSpot = ''
    }
    this.loadCatalog()
  },

  async loadDisplayFlags() {
    try {
      const { fetchContentDisplayFlags } = require('../../../utils/contentDisplayFlags')
      const { flags } = await fetchContentDisplayFlags()
      this.setData({ showAiIdentify: flags.showAiIdentify !== false })
    } catch (e) {
      this.setData({ showAiIdentify: true })
    }
  },

  applyPack(pack, extra) {
    const cards = (pack.cards || []).map((raw) => {
      const card = enrichCardSpots(withMarks(raw))
      card.toneClass = card.unlocked && card.categoryTone ? `tone-${card.categoryTone}` : ''
      return card
    })
    cards.sort((a, b) => {
      if (!!a.unlocked !== !!b.unlocked) return a.unlocked ? -1 : 1
      return String(a.no).localeCompare(String(b.no), 'en', { numeric: true })
    })
    const stats = pack.stats || this.data.stats
    const recentNotes = formatRecentLogs(pack.recentLogs || [])
    this.setData(
      Object.assign(
        {
          cards,
          stats,
          recentNotes,
          loading: false,
          loadError: false,
          catalogEmpty: !cards.length
        },
        extra || {}
      )
    )
    this.applyFilter()
  },

  async loadCatalog() {
    this.setData({ loading: true, loadError: false })
    try {
      const res = await callAtlas('catalog')
      if (!res.success || !res.data) {
        throw new Error(res.msg || '图鉴装订中')
      }
      this.applyPack(res.data, { offline: false })
      if (this._pendingSpot) {
        const code = this._pendingSpot
        this._pendingSpot = ''
        this.collectSpot(code)
      }
    } catch (e) {
      console.error(e)
      this.applyPack(localCatalogPack(), { offline: true, loadError: false })
      if (this._pendingSpot) {
        wx.showToast({ title: '点亮需要连上云端', icon: 'none' })
        this._pendingSpot = ''
      }
    }
  },

  applyFilter() {
    const { cards, filter, rarityFilter, seriesFilter, stats } = this.data
    const filtered = cards.filter((c) => {
      if (filter !== 'all' && c.category !== filter) return false
      if (rarityFilter !== 'all' && c.rarity !== rarityFilter) return false
      if (seriesFilter && (c.seriesIds || []).indexOf(seriesFilter) === -1) return false
      return true
    })
    const leftCol = []
    const rightCol = []
    filtered.forEach((c, i) => {
      if (i % 2 === 0) leftCol.push(c)
      else rightCol.push(c)
    })
    let seriesBlurb = ''
    if (seriesFilter && stats.series && stats.series.length) {
      const hit = stats.series.find((s) => s.id === seriesFilter)
      seriesBlurb = (hit && hit.blurb) || ''
    }
    this.setData({
      filtered,
      leftCol,
      rightCol,
      seriesBlurb,
      filterEmpty: !filtered.length && !!cards.length
    })
  },

  onFilter(e) {
    this.setData({ filter: e.currentTarget.dataset.id }, () => this.applyFilter())
  },

  onRarity(e) {
    this.setData({ rarityFilter: e.currentTarget.dataset.id }, () => this.applyFilter())
  },

  onSeries(e) {
    const id = e.currentTarget.dataset.id
    const next = this.data.seriesFilter === id ? '' : id
    this.setData({ seriesFilter: next }, () => this.applyFilter())
  },

  onOpen(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    trackBehavior('atlas_card_open', 'atlas', id, {})
    wx.navigateTo({
      url: `/subpackages/feature/collection/detail/index?id=${id}`,
      fail: () => wx.showToast({ title: '这一页暂时打不开', icon: 'none' })
    })
  },

  onOpenNote(e) {
    const id = e.currentTarget.dataset.id
    if (!id) {
      this.goLogs()
      return
    }
    this.onOpen({ currentTarget: { dataset: { id } } })
  },

  goIdentify() {
    if (!this.data.showAiIdentify) {
      const { toastAiIdentifyClosed } = require('../../../utils/contentDisplayFlags')
      toastAiIdentifyClosed()
      return
    }
    wx.navigateTo({ url: '/subpackages/feature/identify/index?from=atlas' })
  },

  goLogs() {
    trackBehavior('atlas_log_view', 'atlas', 'journal', {})
    wx.navigateTo({ url: '/subpackages/feature/collection/log/index' })
  },

  goNotes() {
    trackBehavior('atlas_log_view', 'atlas', 'journal', { tab: 'notes' })
    wx.navigateTo({ url: '/subpackages/feature/collection/log/index?tab=notes' })
  },

  clearFilters() {
    this.setData(
      { filter: 'all', rarityFilter: 'all', seriesFilter: '', seriesBlurb: '' },
      () => this.applyFilter()
    )
  },

  onScan() {
    trackBehavior('atlas_scan', 'atlas', 'scan', {})
    wx.scanCode({
      onlyFromCamera: false,
      scanType: ['qrCode', 'barCode'],
      success: (res) => {
        this.collectSpot(res.result || res.path || '')
      },
      fail: (err) => {
        const msg = (err && err.errMsg) || ''
        if (msg.indexOf('cancel') === -1) {
          wx.showToast({ title: '没有读到印记', icon: 'none' })
        }
      }
    })
  },

  showUnlock(res) {
    const sp = (res && res.species) || {}
    this.setData({
      unlockSheet: {
        show: true,
        nameZh: sp.nameZh || '',
        nameLatin: sp.nameLatin || '',
        id: sp.id || '',
        msg: (res && res.msg) || '这一页被翻开了'
      }
    })
  },

  onUnlockOpen() {
    const id = this.data.unlockSheet.id
    this.setData({ unlockSheet: emptyUnlockSheet() })
    if (!id) return
    wx.navigateTo({
      url: `/subpackages/feature/collection/detail/index?id=${id}&first=1`
    })
  },

  onUnlockStay() {
    this.setData({ unlockSheet: emptyUnlockSheet() })
  },

  async collectSpot(code) {
    wx.showLoading({ title: '翻开这一页…', mask: true })
    try {
      const res = await callAtlas('collect', { method: 'discover', code })
      wx.hideLoading()
      if (res && res.success && res.first && res.species && res.species.id) {
        this.showUnlock(res)
      } else if (res && res.success && res.species && res.species.id && res.already) {
        wx.showToast({
          title: (res && res.msg) || '这一页已经在你的本子上了',
          icon: 'none',
          duration: 1800
        })
        setTimeout(() => {
          wx.navigateTo({
            url: `/subpackages/feature/collection/detail/index?id=${res.species.id}`
          })
        }, 400)
      } else {
        wx.showToast({
          title: (res && res.msg) || (res.success ? '记下了' : '没有对应的一页'),
          icon: 'none',
          duration: 2600
        })
      }
      this.loadCatalog()
      trackBehavior('atlas_collect', 'atlas', (res.species && res.species.id) || 'spot', {
        method: 'discover',
        first: !!(res && res.first)
      })
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: '印记没有被读懂', icon: 'none' })
    }
  },

  onPullDownRefresh() {
    this.loadCatalog().then(() => wx.stopPullDownRefresh())
  },

  onShareAppMessage() {
    const { unlocked, total } = this.data.stats || {}
    const title =
      total > 0
        ? `山海图鉴 · 已点亮 ${unlocked || 0}/${total}`
        : '山海图鉴 · 把山海带回家'
    return {
      title,
      path: '/subpackages/feature/collection/index'
    }
  },

  onShareTimeline() {
    return {
      title: '山海图鉴 · 把山海带回家',
      query: ''
    }
  }
})
