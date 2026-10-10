/** 首页「为你推荐」（docs/首页为你推荐_全面升级_2026-09-27.md）。不改云函数契约。 */
const logic = require('./logic')
const { trackBehavior } = require('../../utils/trackBehavior')
const { getFirstImage } = require('../../utils/util')
const { midUrl, thumbUrl } = require('../../utils/imageUrl')

const VIEW_KEYS = ['_id', 'title', 'theme', 'note', 'latin', 'rawImage', 'priceText', 'priceFrom', 'soldOut', 'sensitiveBlur', 'protectionType', 'mark', 'cat', 'no', 'pos', 'tier', 'bw', 'cm', 'mt']
const GEO_KEYS = ['tier', 'bw', 'cm', 'mt']
/** 封面 686rpx ≈ 3 倍屏 1070px，480 档会糊 */
const HERO_W = 960
const { wallDefaultBlessTags, blessLabel } = require('../../config/blessTags')
const { shanghaiDayKey } = require('../../utils/wishWall')

const SELF_BOOT_MS = 1500

function withImage(rows) {
  return (Array.isArray(rows) ? rows : []).map((r) => {
    const first = getFirstImage(r && r.images) || (r && (r.httpImage || r.cover)) || ''
    return Object.assign({}, r, { images: first ? [first] : [] })
  })
}

/** 比例缓存 rawImage → h/w；4s 未到按 wide 亮字 */
const RATIO_KEY = 'hr_img_ratio_v1'
const PENDING_MS = 4000

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
    pages: [],
    whyText: '',
    whyMode: '',
    pageIndex: 0,
    pageTotal: 1,
    /** 图只挂到看过的页 + 下一页（swiper 里 lazy-load 不生效） */
    shownUpTo: 1,
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
      try { this._ratios = wx.getStorageSync(RATIO_KEY) || {} } catch (e) { this._ratios = {} }
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
      clearTimeout(this._ratioT)
      clearTimeout(this._pendT)
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
        this._pageIndex = 0
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
        pageIndex: this._pageIndex || 0,
        signals: this._signals,
        ratios: this._ratios,
        errorMsg: this._errorMsg
      })
      const slim = (c, hero) => {
        const o = { image: midUrl(c.rawImage) }
        VIEW_KEYS.forEach((k) => { if (c[k] !== undefined) o[k] = c[k] })
        if (hero) o.image = thumbUrl(c.rawImage, HERO_W)
        return o
      }
      view.pages = view.pages.map((p) => Object.assign(p, { lead: p.lead && slim(p.lead, 1), row: p.row.map((c) => slim(c)) }))
      return view
    },

    _render() {
      this._pool = logic.buildPool(this._recoRows, this._blessRows, this._signals)
      const view = this._view()
      view.shownUpTo = Math.max(this.data.shownUpTo, view.pageIndex + 1)
      this.setData(view)
      this._expose()
      this._armPending(view.pages)
    },

    _armPending(pages) {
      clearTimeout(this._pendT)
      if (pages.some((p) => p.lead && !p.lead.tier)) this._pendT = setTimeout(() => this._settlePending(), PENDING_MS)
    },

    /** 比例到达只按路径改几何字段 */
    _patchGeo() {
      const pages = this._view().pages
      const patch = {}
      pages.forEach((pg, p) => {
        const old = this.data.pages[p]
        if (!old) return
        ;[['lead', pg.lead, old.lead]].concat(pg.row.map((c, i) => [`row[${i}]`, c, old.row[i]])).forEach(([k, c, o]) => {
          if (c && o) GEO_KEYS.forEach((g) => { if (c[g] !== o[g]) patch[`pages[${p}].${k}.${g}`] = c[g] })
        })
      })
      if (Object.keys(patch).length) this.setData(patch)
      this._armPending(pages)
    },

    onImgLoad(e) {
      const { width, height } = e.detail || {}
      if (width > 0 && height > 0) this._setRatio(e.currentTarget.dataset.key, Math.round((height / width) * 100) / 100)
    },

    onImgError(e) {
      this._setRatio(e.currentTarget.dataset.key, -1)
    },

    _setRatio(key, r) {
      if (!key || this._ratios[key] === r || (r < 0 && this._ratios[key] > 0)) return
      this._ratios[key] = r
      clearTimeout(this._ratioT)
      this._ratioT = setTimeout(() => {
        this._patchGeo()
        const keep = {}
        Object.keys(this._ratios).filter((k) => this._ratios[k] > 0).slice(-300).forEach((k) => { keep[k] = this._ratios[k] })
        try { wx.setStorageSync(RATIO_KEY, keep) } catch (err) { /* 存不下只是下次多闪一次 */ }
      }, 60)
    },

    _settlePending() {
      let hit = false
      this.data.pages.forEach((p, i) => {
        if (i <= this.data.shownUpTo && p.lead && !p.lead.tier && p.lead.rawImage && !(this._ratios[p.lead.rawImage] > 0)) {
          this._ratios[p.lead.rawImage] = -1
          hit = true
        }
      })
      if (hit) this._patchGeo()
    },

    onRetry() {
      this.load()
    },

    onSwap() {
      if (!this.data.canSwap) return
      clearTimeout(this._swapT)
      this.setData({ swapping: true })
      this._swapT = setTimeout(() => this.setData({ swapping: false }), 480)
      this._goPage((this.data.pageIndex + 1) % this.data.pageTotal)
    },

    onPageChange(e) {
      const i = Number(e.detail.current) || 0
      if (i !== this.data.pageIndex) this._goPage(i)
    },

    _goPage(i) {
      const page = this.data.pages[i]
      if (!page) return
      this._pageIndex = i
      this.setData({
        pageIndex: i,
        whyText: page.whyText,
        whyMode: page.whyMode,
        shownUpTo: Math.max(this.data.shownUpTo, i + 1)
      })
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

    /** 曝光：每页一次；ids 只列本次加载首次露出的件（补位件不重复计） */
    _expose() {
      if (this.data.phase !== 'ready' || !this._inViewNow) return
      const key = `${this._seq}:${this.data.pageIndex}`
      if (this._exposed[key]) return
      this._exposed[key] = 1
      const page = this.data.pages[this.data.pageIndex]
      if (!page) return
      const ids = [page.lead].concat(page.row).filter((c) => c && !this._exposed[`${this._seq}#${c._id}`]).map((c) => c._id)
      ids.forEach((id) => { this._exposed[`${this._seq}#${id}`] = 1 })
      trackBehavior('home_reco_expose', 'reco', this.data.whyMode || 'cold', {
        page: this.data.pageIndex,
        ids: ids.join(',')
      })
    }
  }
})
