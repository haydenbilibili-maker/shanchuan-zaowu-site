const { neighbors, readOrder, readAll, chapterOf } = require('../atlasPager')
const { trackBehavior } = require('../../../../utils/trackBehavior')
const {
  callAtlas,
  withMarks,
  enrichCardSpots,
  formatLogTime,
  methodLabel,
  formatPrice,
  galleryCategoryOf,
  buildSpecimenFacts
} = require('../../utils/atlas')
const { plateOf, ghostOf } = require('../../utils/atlasPlates')
const { GUIDE_AVATAR } = require('../../../../utils/guideAvatar')

const RARE_MARK = { rare: '稀有', legendary: '传奇' }


/**
 * 未点亮页的补充（2026-11-23）：门类剪影（同门类统一线描，不剧透物种）+「怎样翻开」路径。
 * 馆内印记只在真有印记时出；收藏路径写「如有」—— 受保护物种没有对应藏品。
 */
function unlockWaysOf(card) {
  if (!card || card.unlocked) return []
  return [
    { k: '拍照采集', v: '对准实物或馆内藏品拍一张，认出它就翻开' },
    card.hasSpot ? { k: '馆内印记', v: '馆里有它的印记，扫到就翻开' } : null,
    { k: '收藏藏品', v: '收藏馆内对应的藏品（如有），会自动落进这一页' }
  ].filter(Boolean)
}
Page({
  data: {
    guideAvatar: GUIDE_AVATAR,
    guideOpen: true,
    loading: true,
    loadError: false,
    locked: true,
    justUnlocked: false,
    methodText: '',
    seriesText: '',
    card: {},
    logs: [],
    relatedProducts: [],
    facts: [],
    hasLogs: false,
    shareImage: '',
    /** 已解析成 https 的分享封面（微信分享卡片不支持 cloud://） */
    shareImageUrl: ''
  },

  /**
   * 博物君开关（2026-11-25 审核驳回）：关掉后 C 端不得残留任何 AI 问答入口 ——
   * 图鉴详情这枚「问问博物君」也要一起隐藏。缓存先水合（避免闪烁），再后台取最新。
   */
  loadGuideOpen() {
    try {
      const { getCachedContentDisplayFlags, fetchContentDisplayFlags } = require('../../../../utils/contentDisplayFlags')
      const cached = getCachedContentDisplayFlags()
      if (cached && cached.flags) this.setData({ guideOpen: cached.flags.museumGuideOpen !== false })
      fetchContentDisplayFlags().then((payload) => {
        if (payload && payload.flags) this.setData({ guideOpen: payload.flags.museumGuideOpen !== false })
      }).catch(() => {})
    } catch (e) { /* 取不到就按默认开启 */ }
  },

  onLoad(options) {
    this.loadGuideOpen();
    this.speciesId = options.id || options.speciesId || ''
    // 翻页条（2026-11-22）：首页记下的标本册顺序里找邻页；分享直达没有顺序 → 不出
    const nb = neighbors(readOrder(getApp()), this.speciesId)
    this.setData({ pagerPrev: nb.prev, pagerNext: nb.next, pagerPos: nb.pos })
    this.justUnlocked = options.first === '1'
    if (!this.speciesId) {
      this.setData({ loading: false, loadError: true })
      return
    }
    this.loadCard()
  },

  applyCardPack(pack) {
    const card = enrichCardSpots(withMarks(pack.card))
    card.toneClass = card.unlocked && card.categoryTone ? `tone-${card.categoryTone}` : ''
    card.plate = plateOf(card)
    card.rareMark = card.unlocked ? RARE_MARK[card.rarity] || '' : ''
    card.ghost = ghostOf(card)
    const logs = (pack.logs || []).map((row, i) => ({
      id: row._id || `l-${row.createdAt || i}`,
      methodLabel: methodLabel(row.method),
      place: row.place || '',
      timeText: formatLogTime(row.createdAt) || '—',
      wild: !!row.wild,
      speciesName: row.speciesName || card.nameZh
    }))
    const relatedProducts = (pack.relatedProducts || []).map((p) => ({
      _id: p._id,
      title: p.title || '馆藏',
      latinName: p.latinName || '',
      image: p.image || '',
      priceText: formatPrice(p.price)
    }))
    const shareImage =
      (relatedProducts.find((p) => p.image) && relatedProducts.find((p) => p.image).image) || ''
    this.setData({
      card,
      logs,
      relatedProducts,
      facts: buildSpecimenFacts(card),
      hasLogs: !!logs.length,
      locked: !card.unlocked,
      loading: false,
      loadError: false,
      justUnlocked: !!this.justUnlocked && !!card.unlocked,
      methodText: card.methodLabel || methodLabel(card.method) || '',
      seriesText: (card.seriesNames || []).join(' · '),
      chapter: chapterOf(readAll(getApp()), card),
      unlockWays: unlockWaysOf(card),
      shareImage
    })
    // 商品图是 cloud:// fileID → 预解析成 https，分享卡片才有封面（否则黑块）
    this.hydrateShareImage(shareImage)
    this.justUnlocked = false
    wx.setNavigationBarTitle({
      title: card.unlocked && card.nameZh ? card.nameZh : '图鉴卡片'
    })
  },

  /** 翻到邻页：redirectTo 替换当前页，翻多少页返回键都只回图鉴一次 */
  onTurnPage(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    // 不加原生 toast 兜底（弹窗棘轮）：同包内已注册页的 redirectTo 失败概率极低，失败则停在本页
    wx.redirectTo({ url: `/subpackages/feature/collection/detail/index?id=${id}` })
  },

  async loadCard() {
    this.setData({ loading: true, loadError: false })
    try {
      const res = await callAtlas('card', { speciesId: this.speciesId })
      if (!res.success || !res.data || !res.data.card) {
        throw new Error(res.msg || '这一页不在册上')
      }
      this.applyCardPack(res.data)
      trackBehavior('atlas_card_open', 'atlas', this.speciesId, {
        unlocked: !!res.data.card.unlocked
      })
    } catch (e) {
      console.error(e)
      try {
        const { getSpeciesById, publicSpecies } = require('../../config/atlasCatalog')
        const sp = getSpeciesById(this.speciesId)
        if (sp) {
          const card = enrichCardSpots(withMarks(publicSpecies(sp, false)))
          card.toneClass = ''
          card.ghost = ghostOf(card)
          this.setData({
            card,
            logs: [],
            relatedProducts: [],
            facts: [],
            hasLogs: false,
            locked: true,
            loading: false,
            loadError: false,
            methodText: '',
            seriesText: (card.seriesNames || []).join(' · '),
            chapter: chapterOf(readAll(getApp()), card),
            unlockWays: unlockWaysOf(card),
            shareImage: ''
          })
          wx.setNavigationBarTitle({ title: '图鉴卡片' })
          return
        }
      } catch (err) {}
      this.setData({ loading: false, loadError: true })
    }
  },

  /** 问问博物君（2026-11-23）：带着这一页的物种名过去，自动发问；未翻开的页不给入口 */
  askGuide() {
    const card = this.data.card || {}
    if (this.data.locked || !card.nameZh) return
    const q = `${card.nameZh}有什么有意思的地方？`
    wx.navigateTo({ url: `/subpackages/feature/museum-guide/index?from=atlas&auto=1&q=${encodeURIComponent(q)}` })
  },

  goIdentify() {
    wx.navigateTo({ url: '/subpackages/feature/identify/index?from=atlas_card' })
  },

  goLogs() {
    trackBehavior('atlas_log_view', 'atlas', 'journal', { from: 'card' })
    wx.navigateTo({ url: '/subpackages/feature/collection/log/index?tab=notes' })
  },

  onScan() {
    trackBehavior('atlas_scan', 'atlas', 'scan', { from: 'card' })
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

  async collectSpot(code) {
    wx.showLoading({ title: '翻开这一页…', mask: true })
    try {
      const res = await callAtlas('collect', { method: 'discover', code })
      wx.hideLoading()
      if (res && res.success && res.species && res.species.id) {
        if (String(res.species.id) === String(this.speciesId) && res.first) {
          this.justUnlocked = true
          await this.loadCard()
          return
        }
        // 同路由（本页=图鉴详情）叠加 navigateTo 会耗尽页面栈，统一用 redirectTo
        const goSpecies = (sid, extra) => {
          wx.redirectTo({
            url: `/subpackages/feature/collection/detail/index?id=${sid}${extra || ''}`,
            fail: () => wx.showToast({ title: '无法打开这一页', icon: 'none' })
          })
        }
        if (res.first && res.species.id) {
          goSpecies(res.species.id, '&first=1')
          return
        }
        if (String(res.species.id) !== String(this.speciesId)) {
          goSpecies(res.species.id)
          return
        }
      }
      wx.showToast({
        title: (res && res.msg) || (res.success ? '记下了' : '没有对应的一页'),
        icon: 'none',
        duration: 2600
      })
      if (res && res.success) this.loadCard()
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: '印记没有被读懂', icon: 'none' })
    }
  },

  goAtlas() {
    wx.navigateBack({
      fail: () => wx.redirectTo({ url: '/subpackages/feature/collection/index' })
    })
  },

  goGallery() {
    const cat = galleryCategoryOf(this.data.card && this.data.card.category)
    const app = getApp()
    if (cat && app.globalData) {
      app.globalData.targetCategory = cat
    }
    trackBehavior('atlas_to_gallery', 'category', cat || 'all', {
      speciesId: this.speciesId
    })
    wx.switchTab({
      url: '/pages/category/index',
      fail: () => wx.showToast({ title: '无法打开馆藏', icon: 'none' })
    })
  },

  goProduct(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    trackBehavior('atlas_to_product', 'product', id, { speciesId: this.speciesId })
    wx.navigateTo({
      url: `/subpackages/feature/detail/index?id=${id}&from=atlas&speciesId=${this.speciesId}`,
      fail: () => wx.showToast({ title: '无法打开藏品', icon: 'none' })
    })
  },

  copyImprint() {
    const card = this.data.card || {}
    const code =
      (card.imprintCodes && card.imprintCodes[0]) || card.imprintCode || ''
    if (!code) {
      wx.showToast({ title: '这一页暂无馆内印记', icon: 'none' })
      return
    }
    wx.setClipboardData({
      data: code,
      success: () => wx.showToast({ title: '已复制印记码', icon: 'none' })
    })
  },

  closeCeremony() {
    this.setData({ justUnlocked: false })
  },

  onPullDownRefresh() {
    this.loadCard().then(() => wx.stopPullDownRefresh())
  },

  /** 分享封面预解析：cloud:// → https；失败留空，让微信截图而不是显示黑块 */
  async hydrateShareImage(src) {
    const { resolveShareImage } = require('../../../../utils/util')
    const url = await resolveShareImage(src)
    if (url) this.setData({ shareImageUrl: url })
  },

  onShareAppMessage() {
    const card = this.data.card || {}
    let title = '山海图鉴里，还有没被翻开的一页'
    if (card.unlocked && card.nameZh) {
      title = card.nameLatin
        ? `山海图鉴 · ${card.nameZh} · ${card.nameLatin}`
        : `山海图鉴 · ${card.nameZh}`
    }
    const payload = {
      title,
      path: `/subpackages/feature/collection/detail/index?id=${this.speciesId}`
    }
    if (this.data.shareImage) payload.imageUrl = this.data.shareImage
    return payload
  },

  onShareTimeline() {
    const card = this.data.card || {}
    const title =
      card.unlocked && card.nameZh
        ? `山海图鉴 · ${card.nameZh}`
        : '山海图鉴 · 把山海带回家'
    return {
      title,
      query: `id=${this.speciesId}`,
      // shareImage 来自商品图（cloud:// fileID），分享卡片渲染不了 → 用已解析的
      imageUrl: this.data.shareImageUrl || undefined
    }
  }
})
