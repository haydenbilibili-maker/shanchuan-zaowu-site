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
const { plateOf } = require('../utils/atlasPlates')

/* 2026-10-17 重设计：一本「博物志 · 卷一」—— 卷首（大数字 + 每页一格的刻度）→ 卷章（三个系列）→ 图版（三列标本册，
   按编号固定位置，未点亮的页留空位只露编号）→ 近期足迹。旧的稀有度筛选行退场（稀有 / 传奇直接写在图版角上）。
   manageAtlas 契约、路由、埋点、分享路径全部不变。 */
const CATEGORIES = ['昆虫', '植物', '矿石', '海洋']

const RARE_MARK = { rare: '稀有', legendary: '传奇' }

/** 卷首那一句「下一步」：只说事实（还差几页 / 几页藏在馆内印记里），不催 */
function nextHintOf(cards, stats, offline) {
  if (offline) return '离线著录中，点亮需要连上云端。'
  const total = stats.total || cards.length
  const got = stats.unlocked || 0
  if (!total) return ''
  if (got >= total) return '卷一已全部翻开。下一卷装订中。'
  if (!got) return '去馆里扫一枚印记，或拍下一件标本，翻开第一页。'
  const inStore = cards.filter((c) => !c.unlocked && c.hasSpot).length
  return inStore
    ? `还差 ${total - got} 页，其中 ${inStore} 页藏在馆内印记里。`
    : `还差 ${total - got} 页。拍下一件标本，也许就是下一页。`
}

Page({
  data: {
    loading: true,
    loadError: false,
    offline: false,
    cards: [],
    filtered: [],
    stats: { total: 0, unlocked: 0, percent: 0, series: [] },
    ticks: [],
    nextHint: '',
    categories: [],
    filter: 'all',
    showAiIdentify: true,
    seriesFilter: '',
    seriesBlurb: '',
    recentNotes: [],
    unlockSheet: emptyUnlockSheet(),
    filterEmpty: false,
    catalogEmpty: false,
    skelPlates: [1, 2, 3, 4, 5, 6, 7, 8, 9]
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
      card.plate = plateOf(card)
      card.rareMark = card.unlocked ? RARE_MARK[card.rarity] || '' : ''
      return card
    })
    // 标本册按编号固定位置：点亮的页就地亮起，不往前挤（「缺的那几格」本身就是收集的动力）
    cards.sort((a, b) => String(a.no).localeCompare(String(b.no), 'en', { numeric: true }))
    const stats = pack.stats || this.data.stats
    const recentNotes = formatRecentLogs(pack.recentLogs || []).slice(0, 3)
    const categories = [{ id: 'all', label: '全部', got: stats.unlocked || 0, total: cards.length }].concat(
      CATEGORIES.map((c) => {
        const inCat = cards.filter((x) => x.category === c)
        return { id: c, label: c, got: inCat.filter((x) => x.unlocked).length, total: inCat.length }
      }).filter((c) => c.total > 0)
    )
    const offline = !!(extra && extra.offline)
    this.setData(
      Object.assign(
        {
          cards,
          stats,
          recentNotes,
          ticks: cards.map((c) => ({ no: c.no, lit: !!c.unlocked })),
          categories,
          nextHint: nextHintOf(cards, stats, offline),
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
    const { cards, filter, seriesFilter, stats } = this.data
    const filtered = cards.filter((c) => {
      if (filter !== 'all' && c.category !== filter) return false
      if (seriesFilter && (c.seriesIds || []).indexOf(seriesFilter) === -1) return false
      return true
    })
    let seriesBlurb = ''
    if (seriesFilter && stats.series && stats.series.length) {
      const hit = stats.series.find((s) => s.id === seriesFilter)
      seriesBlurb = (hit && hit.blurb) || ''
    }
    this.setData({
      filtered,
      seriesBlurb,
      filterEmpty: !filtered.length && !!cards.length
    })
  },

  // 门类与卷章互斥：选一个就清掉另一个（两层筛选叠在一起时，空页的原因说不清）
  onFilter(e) {
    this.setData({ filter: e.currentTarget.dataset.id, seriesFilter: '' }, () => this.applyFilter())
  },

  onSeries(e) {
    const id = e.currentTarget.dataset.id
    const next = this.data.seriesFilter === id ? '' : id
    this.setData({ seriesFilter: next, filter: 'all' }, () => this.applyFilter())
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
      { filter: 'all', seriesFilter: '', seriesBlurb: '' },
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
