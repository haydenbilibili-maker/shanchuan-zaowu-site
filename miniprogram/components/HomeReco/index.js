/** 首页「为你推荐」（docs/首页为你推荐_全面升级_2026-09-27.md）。不改云函数契约。 */
const logic = require('./logic')
const { trackBehavior } = require('../../utils/trackBehavior')
const { getFirstImage } = require('../../utils/util')
const { midUrl } = require('../../utils/imageUrl')

/** 横滑展柜卡只带渲染字段（2026-10-13 重做：统一 3:4 竖卡，不再按图片比例分档） */
const VIEW_KEYS = ['_id', 'title', 'name', 'sub', 'priceText', 'priceFrom', 'soldOut', 'sensitiveBlur', 'protectionType', 'mark', 'pos']

function slim(c) {
  const o = { image: midUrl(c.rawImage) }
  VIEW_KEYS.forEach((k) => { if (c[k] !== undefined) o[k] = c[k] })
  return o
}
const { wallDefaultBlessTags, blessLabel } = require('../../config/blessTags')
const { shanghaiDayKey } = require('../../utils/wishWall')

const SELF_BOOT_MS = 1500

function withImage(rows) {
  return (Array.isArray(rows) ? rows : []).map((r) => {
    const first = getFirstImage(r && r.images) || (r && (r.httpImage || r.cover)) || ''
    return Object.assign({}, r, { images: first ? [first] : [] })
  })
}

function readPlayArchive() {
  try {
    return wx.getStorageSync(logic.RITUAL_PLAY_STORAGE_KEY) || null
  } catch (e) {
    return null
  }
}

Component({
  options: { addGlobalClass: true },
  properties: {
    /** 祈福墙开关（首页 showMaShangYou）：关着就不拿祈福墙当推荐理由 */
    wallOn: { type: Boolean, value: false }
  },
  data: {
    phase: 'loading',
    cards: [],
    whyText: '',
    whyMode: '',
    batchIndex: 0,
    batchTotal: 1,
    scrollTo: '',
    canSwap: false,
    refreshing: false,
    swapping: false,
    errorMsg: ''
  },
  observers: {
    wallOn(on) {
      if (on && this._loadedOnce && !this._blessTried) this._loadBless().then(() => this._render())
    }
  },
  lifetimes: {
    attached() {
      this._pool = []
      this._recoRows = []
      this._blessRows = []
      this._signals = { interestTags: null, wall: null }
      this._exposed = {}
      this._bootTimer = setTimeout(() => { if (!this._loadStarted) this.load() }, SELF_BOOT_MS)
    },
    ready() {
      try {
        this._io = this.createIntersectionObserver()
        this._io.relativeToViewport({ bottom: 0 }).observe('.hr-body', (res) => {
          this._inViewNow = !!(res && res.intersectionRatio > 0)
          this._expose()
        })
      } catch (e) { /* 基础库过老：只是没有曝光埋点 */ }
    },
    detached() {
      clearTimeout(this._bootTimer)
      clearTimeout(this._swapT)
      if (this._io) this._io.disconnect()
    }
  },
  methods: {
    async load(opts) {
      this._loadStarted = true
      clearTimeout(this._bootTimer)
      const o = opts || {}
      if (o.limit > 0) this._limit = Math.min(20, Math.max(1, o.limit | 0))
      const seq = (this._seq = (this._seq || 0) + 1)
      const hasContent = this._pool.length > 0
      this.setData(hasContent ? { refreshing: true } : { phase: 'loading', errorMsg: '' })
      this._blessTried = false
      const [reco] = await Promise.all([this._fetchReco(), this._loadInterest(), this._loadBless()])
      if (seq !== this._seq) return
      this._loadedOnce = true
      if (reco.ok) {
        this._recoRows = reco.rows
        this._batchIndex = 0
        this._exposed = {}
        this._phase = 'ready'
      } else if (!hasContent) {
        this._phase = 'error'
        this._errorMsg = reco.msg
      }
      this._render()
    },

    async _fetchReco() {
      const limit = this._limit || logic.FETCH_LIMIT
      for (let i = 0; i < 2; i += 1) {
        try {
          const res = await wx.cloud.callFunction({ name: 'getRecommendations', data: { limit } })
          const r = (res && res.result) || {}
          if (r.success) return { ok: true, rows: withImage(r.data) }
        } catch (e) {
          console.warn('getRecommendations', e)
        }
        if (i === 0) await new Promise((done) => setTimeout(done, 800))
      }
      return { ok: false, rows: [], msg: '网络开小差了' }
    },

    async _loadInterest() {
      try {
        const res = await wx.cloud.database().collection('users')
          .where({ _openid: '{openid}' })
          .field({ interestTags: true })
          .limit(1)
          .get()
        const row = res && res.data && res.data[0]
        this._signals.interestTags = (row && row.interestTags) || null
      } catch (e) {
        this._signals.interestTags = null
      }
    },

    async _loadBless() {
      this._blessRows = []
      this._signals.wall = null
      if (!this.properties.wallOn) return
      this._blessTried = true
      if (!logic.playedWallRecently(readPlayArchive(), Date.now())) return
      const tag = wallDefaultBlessTags('mashangyou')[0]
      if (!tag) return
      try {
        const res = await wx.cloud.callFunction({
          name: 'getBlessProducts',
          data: { tag, limit: logic.BLESS_LIMIT + 2, dayKey: shanghaiDayKey(Date.now()) }
        })
        const list = ((res && res.result) || {}).list
        this._blessRows = withImage(list)
        if (this._blessRows.length) this._signals.wall = { blessLabel: blessLabel(tag) }
      } catch (e) {
        this._blessRows = []
      }
    },

    /** 视图卡只带渲染字段；点击 / 埋点读 this._pool 全量 */
    _view() {
      const view = logic.buildView({
        phase: this._phase || 'loading',
        pool: this._pool,
        batchIndex: this._batchIndex || 0,
        signals: this._signals,
        errorMsg: this._errorMsg
      })
      this._batches = view.batches
      delete view.batches
      view.cards = view.cards.map(slim)
      return view
    },

    _render() {
      this._pool = logic.buildPool(this._recoRows, this._blessRows, this._signals)
      this.setData(this._view())
      this._expose()
    },

    onRetry() {
      this.load()
    },

    onSwap() {
      if (!this.data.canSwap) return
      clearTimeout(this._swapT)
      this.setData({ swapping: true })
      this._swapT = setTimeout(() => this.setData({ swapping: false }), 480)
      this._goBatch((this.data.batchIndex + 1) % this.data.batchTotal)
    },

    _goBatch(i) {
      const batch = this._batches && this._batches[i]
      if (!batch) return
      this._batchIndex = i
      this.setData({
        batchIndex: i,
        cards: batch.cards.map(slim),
        whyText: batch.whyText,
        whyMode: batch.whyMode,
        scrollTo: 'hr-c0'
      }, () => this.setData({ scrollTo: '' }))
      this._expose()
    },

    onMore() {
      this.triggerEvent('more')
    },

    onCardTap(e) {
      const pos = Number(e.currentTarget.dataset.pos)
      const card = this._pool[pos]
      if (!card) return
      trackBehavior('home_reco_click', 'product', card._id, {
        pos,
        mode: this.data.whyMode,
        chip: (card.mark && card.mark.kind) || ''
      })
      this.triggerEvent('itemtap', {
        _id: card._id,
        id: card._id,
        title: card.title,
        images: card.rawImage ? [card.rawImage] : [],
        price: card.price,
        latinName: card.latin,
        category: card.category,
        tags: card.tags,
        protectionType: card.protectionType
      })
    },

    /** 曝光：每批一次；ids 只列本次加载首次露出的件（补位件不重复计）；埋点字段 page 沿用（= 批序号） */
    _expose() {
      if (this.data.phase !== 'ready' || !this._inViewNow) return
      const key = `${this._seq}:${this.data.batchIndex}`
      if (this._exposed[key]) return
      this._exposed[key] = 1
      const cards = this.data.cards
      if (!cards.length) return
      const ids = cards.filter((c) => c && !this._exposed[`${this._seq}#${c._id}`]).map((c) => c._id)
      ids.forEach((id) => { this._exposed[`${this._seq}#${id}`] = 1 })
      trackBehavior('home_reco_expose', 'reco', this.data.whyMode || 'cold', {
        page: this.data.batchIndex,
        ids: ids.join(',')
      })
    }
  }
})
