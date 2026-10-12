// subpackages/feature/wish-labels/index.js
/**
 * 马上有 · 心愿签（2026-10-13 重做，替代旧「祈福墙」前台；蓝图 docs/马上有心愿签_重设计蓝图_2026-10-13.md）
 *
 * 一页只讲一件事：展品首屏 → 写一张心愿签 → 心愿签墙。
 * 后台契约全部沿用 manageWishWall（list / post / mine），只新增 echo（「我也想要」）。
 * 闸门同旧页：content_display_flags.showMaShangYou，关闭时**不发起任何列表请求**；读失败与「馆方未开放」分开说。
 */
const {
  normalizeProductKey,
  parseWishWallScene,
  validateWishText,
  dailyQuota,
  decorateMineRows,
  mineSummary,
  LIST_LIMIT,
  DAILY_LIMIT,
  TEXT_MAX,
  PRODUCT_KEY,
  WISH_EXHIBIT_COVER
} = require('../../../utils/wishWall')
const { wishTextCount, wishTextTruncate } = require('../../../utils/wishTextCount')
const { pickWallProduct, buildExhibitView } = require('../utils/wallExhibitProduct')
const { getCustomNavLayout } = require('../utils/customNav')
const { trackBehavior } = require('../../../utils/trackBehavior')
const { fetchContentDisplayFlags, toastWishWallClosed } = require('../../../utils/contentDisplayFlags')
const L = require('./labels')

const FN = 'manageWishWall'
const INSPIRATION_MAX = 4
const QIAN_PATH = '/subpackages/plays/play-qian/index'

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    navTotal: 64,
    allowed: false,
    flagChecked: false,
    gateError: false,
    loading: true,
    loadError: '',
    productKey: PRODUCT_KEY,
    productId: '',
    exhibit: null,
    cover: '',
    peek: [],
    columns: [[], []],
    viewMode: 'latest',
    mineLabels: [],
    mineLoading: false,
    mineError: '',
    mineHidden: 0,
    capped: false,
    inspiration: [],
    quota: { used: 0, left: DAILY_LIMIT, cap: DAILY_LIMIT, exhausted: false, unknown: false },
    textMax: TEXT_MAX,
    listLimit: LIST_LIMIT,
    composeOpen: false,
    draft: '',
    draftCount: 0,
    posting: false,
    writer: '',
    today: '',
    freshId: '',
    card: null,
    echoBusy: false,
    showRegisterDialog: false,
    toastShow: false,
    toastTitle: ''
  },

  onLoad(options) {
    const opts = options || {}
    const fromScene = parseWishWallScene(opts.scene)
    const productKey = normalizeProductKey(opts.productKey || fromScene.productKey)
    const nav = getCustomNavLayout()
    const exhibit = buildExhibitView(productKey, null, '')
    this._echoed = L.readEchoed(wx)
    this.setData({
      statusBarHeight: nav.statusBarHeight,
      navBarHeight: nav.navBarHeight,
      navTotal: nav.statusBarHeight + nav.navBarHeight,
      productKey,
      productId: String(opts.productId || ''),
      entryFrom: String(opts.from || fromScene.from || 'direct'),
      exhibit,
      cover: productKey === PRODUCT_KEY ? WISH_EXHIBIT_COVER : '',
      today: L.labelDate(Date.now())
    })
    trackBehavior('wish_wall_enter', 'from', this.data.entryFrom)
    this.bootstrap()
  },

  onPullDownRefresh() {
    Promise.resolve(this.bootstrap({ force: true })).finally(() => wx.stopPullDownRefresh())
  },

  /* ------------------------------ 闸门 ------------------------------ */

  async bootstrap(opts) {
    const force = !!(opts && opts.force)
    try {
      const { flags } = await fetchContentDisplayFlags({
        force,
        onUpdate: (payload) => this.applyGate(payload && payload.flags)
      })
      await this.applyGate(flags, { force })
    } catch (e) {
      this.setData({ allowed: false, flagChecked: true, loading: false, gateError: true })
    }
  },

  async applyGate(flags, opts) {
    const allowed = !!(flags && flags.showMaShangYou === true)
    if (allowed === this.data.allowed && this.data.flagChecked) {
      if (this.data.gateError || this.data.loading) this.setData({ gateError: false, loading: false })
      if (opts && opts.force && allowed) await this.refresh()
      return
    }
    this.setData({ allowed, flagChecked: true, loading: allowed, gateError: false })
    if (!allowed) return
    void this.resolveExhibit()
    await this.refresh()
  },

  onGateRetry() {
    this.setData({ loading: true, gateError: false })
    this.bootstrap({ force: true })
  },

  /** 展品实拍：只读商品首图（读不到就用默认墙的实拍常量 / 不显示图，不编造） */
  async resolveExhibit() {
    if (!(wx.cloud && typeof wx.cloud.database === 'function')) return
    try {
      const db = wx.cloud.database()
      const coll = db.collection('products')
      let product = null
      if (this.data.productId) {
        const res = await coll.doc(this.data.productId).get()
        product = (res && res.data) || null
      } else {
        const ex = this.data.exhibit
        const where = this.data.productKey === PRODUCT_KEY && ex
          ? { title: db.RegExp({ regexp: ex.name, options: 'i' }) }
          : { wishWallKey: this.data.productKey }
        const res = await coll.where(where).limit(10).get()
        product = pickWallProduct(res && res.data, this.data.productKey)
      }
      if (!product || this._unloaded) return
      const imgs = Array.isArray(product.images) ? product.images : []
      // 默认墙沿用实拍常量（images[0] 是抠图，实拍更像「在店里」）；其它墙取首图
      const cover = this.data.productKey === PRODUCT_KEY ? WISH_EXHIBIT_COVER : String(imgs[0] || product.cover || '')
      this.setData({
        exhibit: buildExhibitView(this.data.productKey, product, cover),
        cover,
        productId: this.data.productId || String(product._id || '')
      })
    } catch (e) {
      console.warn('wish labels exhibit', e)
    }
  },

  /* ------------------------------ 列表 ------------------------------ */

  async callFn(data) {
    const res = await wx.cloud.callFunction({ name: FN, data: data || {} })
    return (res && res.result) || {}
  },

  listFailed(r) {
    const x = r || {}
    return x.fallback === true || x.success !== true || !Array.isArray(x.list)
  },

  async refresh() {
    if (!this.data.allowed) return
    this.setData({ loadError: '' })
    try {
      const result = await this.callFn({ action: 'list', productKey: this.data.productKey, limit: LIST_LIMIT })
      if (this.listFailed(result)) {
        this.setData({ loadError: (result && result.msg) || '墙面暂时没刷出来', loading: false })
        return
      }
      const now = Date.now()
      this._wall = result.list.map((row) => L.toLabel(row, now, this._echoed))
      this.setData({
        inspiration: (result.inspiration || []).filter(Boolean).slice(0, INSPIRATION_MAX),
        capped: this._wall.length >= LIST_LIMIT,
        loading: false
      })
      this.applyView()
      this.loadMine()
    } catch (e) {
      console.warn('wish labels list', e)
      this.setData({ loadError: '墙面暂时没刷出来', loading: false })
    }
  },

  async loadMine() {
    this.setData({ mineLoading: true, mineError: '' })
    try {
      const result = await this.callFn({ action: 'mine', productKey: this.data.productKey })
      if (this.listFailed(result)) {
        this.setData({ mineLoading: false, mineError: '我的心愿暂时没读到', quota: Object.assign({}, this.data.quota, { unknown: true }) })
        return
      }
      const raw = result.list
      const mineIds = new Set(raw.map((r) => String(r._id || '')))
      this._wall = (this._wall || []).map((l) => (mineIds.has(l._id) ? Object.assign({}, l, { isMine: true }) : l))
      this._mine = L.mineToLabels(decorateMineRows(raw, Date.now()), raw)
      this.setData({
        mineLabels: this._mine,
        mineHidden: mineSummary(raw).hidden,
        quota: Object.assign({ unknown: false }, dailyQuota(raw, Date.now())),
        mineLoading: false
      })
      this.applyView()
    } catch (e) {
      this.setData({ mineLoading: false, mineError: '我的心愿暂时没读到', quota: Object.assign({}, this.data.quota, { unknown: true }) })
    }
  },

  applyView() {
    const wall = this._wall || []
    const src = this.data.viewMode === 'mine' ? (this._mine || []) : wall
    const freshId = this.data.freshId
    const mark = (l) => (freshId && l._id === freshId ? Object.assign({}, l, { fresh: true }) : l)
    this.setData({
      peek: wall.slice(0, L.PEEK_COUNT),
      columns: L.splitColumns(src.map(mark))
    })
  },

  switchView(e) {
    const mode = e.currentTarget.dataset.mode === 'mine' ? 'mine' : 'latest'
    if (mode === this.data.viewMode) return
    this.setData({ viewMode: mode })
    this.applyView()
  },

  goWall() {
    wx.pageScrollTo({ selector: '#wall', duration: 280, offsetTop: -this.data.navTotal, fail: () => {} })
  },

  /* ------------------------------ 写签 ------------------------------ */

  async openCompose() {
    if (!this.data.allowed) { toastWishWallClosed(); return }
    if (this.data.quota.exhausted) {
      this.toast(`今天已写 ${this.data.quota.cap} 张，明天再来`)
      return
    }
    this.setData({ composeOpen: true })
    if (!this.data.writer) this.loadWriter()
  },

  closeCompose() {
    if (this.data.posting) return
    this.setData({ composeOpen: false })
  },

  async loadWriter() {
    try {
      const { ensureSession } = require('../../../utils/userSession')
      const s = await ensureSession()
      const u = (s && s.user) || {}
      this.setData({ writer: String(u.nickName || u.nickname || '') })
    } catch (e) { /* 写签人只是展示，读不到就不显示这一栏 */ }
  },

  onDraftInput(e) {
    const text = wishTextTruncate(String((e && e.detail && e.detail.value) || ''), TEXT_MAX)
    this.setData({ draft: text, draftCount: wishTextCount(text) })
    return text
  },

  useInspiration(e) {
    const text = wishTextTruncate(String(e.currentTarget.dataset.text || ''), TEXT_MAX)
    this.setData({ draft: text, draftCount: wishTextCount(text) })
  },

  async isGuestUser() {
    try {
      const { ensureSession } = require('../../../utils/userSession')
      const { resolveAuthState } = require('../../../utils/profileHelper')
      const session = await ensureSession()
      const state = (session && session.authState) || resolveAuthState(session && session.user)
      return state === 'guest'
    } catch (e) {
      return false
    }
  },

  async submitWish() {
    if (this.data.posting || this._submitting) return false
    if (!this.data.allowed) { toastWishWallClosed(); return false }
    if (this.data.quota.exhausted) {
      this.toast(`今天已写 ${this.data.quota.cap} 张，明天再来`)
      return false
    }
    const checked = validateWishText(this.data.draft)
    if (!checked.ok) {
      this.toast(checked.msg)
      return false
    }
    const resuming = !!this._resumeAfterRegister
    this._resumeAfterRegister = false
    this._submitting = true
    if (!resuming && await this.isGuestUser()) {
      this._submitting = false
      this._pendingWish = checked.text
      trackBehavior('wish_wall_register_gate', 'wish_wall', this.data.productKey, { step: 'show' })
      this.setData({ showRegisterDialog: true })
      return false
    }
    this._submitting = false
    this.setData({ posting: true })
    let result = null
    try {
      result = await this.callFn({
        action: 'post',
        productKey: this.data.productKey,
        productId: this.data.productId,
        text: checked.text
      })
    } catch (e) {
      result = { success: false }
    }
    if (!result || !result.success) {
      this.setData({ posting: false })
      this.toast((result && result.msg) || '没能别上墙，请稍后再试')
      return false
    }
    const id = String(result._id || `local-${Date.now()}`)
    const fresh = L.toLabel({ _id: id, text: checked.text, nickname: result.nickname || this.data.writer || '我', createTime: Date.now() }, Date.now(), this._echoed)
    fresh.isMine = true
    this._wall = [fresh].concat(this._wall || [])
    this._mine = [fresh].concat(this._mine || [])
    const q = this.data.quota
    this.setData({
      posting: false,
      composeOpen: false,
      draft: '',
      draftCount: 0,
      freshId: id,
      viewMode: 'latest',
      quota: Object.assign({}, q, { used: q.used + 1, left: Math.max(0, q.left - 1), exhausted: q.used + 1 >= q.cap })
    })
    this.applyView()
    try { wx.vibrateShort({ type: 'light' }) } catch (e) { /* ignore */ }
    trackBehavior('wish_wall_post', 'ok', 'ok')
    // 弹层收起后再滚到墙，让「刚别上」那张的落签动效在视野里；离页即取消
    this._wallTimer = setTimeout(() => { this._wallTimer = null; if (!this._unloaded) this.goWall() }, 320)
    return true
  },

  /* ------------------------------ 注册续写 ------------------------------ */

  async onRegisterSuccess() {
    this.setData({ showRegisterDialog: false })
    try {
      const { refreshSessionAfterAuth } = require('../../../utils/userSession')
      Promise.resolve(refreshSessionAfterAuth()).catch(() => {})
    } catch (e) { /* ignore */ }
    const text = this._pendingWish
    this._pendingWish = ''
    if (!text) return
    this._resumeAfterRegister = true
    this.setData({ draft: text, draftCount: wishTextCount(text) })
    const ok = await this.submitWish()
    trackBehavior('wish_wall_register_gate', 'wish_wall', this.data.productKey, { step: ok ? 'resume_success' : 'fail_resume' })
  },

  onRegisterDialogCta() {
    trackBehavior('wish_wall_register_gate', 'wish_wall', this.data.productKey, { step: 'go_register' })
  },

  onRegisterDialogClose() {
    this._pendingWish = ''
    if (this.data.showRegisterDialog) this.setData({ showRegisterDialog: false })
    trackBehavior('wish_wall_register_gate', 'wish_wall', this.data.productKey, { step: 'dismiss' })
  },

  onRegisterDialogFail(e) {
    const reason = (e && e.detail && e.detail.reason) || 'unknown'
    trackBehavior('wish_wall_register_gate', 'wish_wall', this.data.productKey, { step: `fail_${reason}` })
  },

  /* ------------------------------ 签详情 / 我也想要 ------------------------------ */

  findLabel(id) {
    const all = (this._wall || []).concat(this._mine || [])
    return all.find((l) => l && l._id === id) || null
  },

  openLabel(e) {
    const label = this.findLabel(String(e.currentTarget.dataset.id || ''))
    if (label) this.setData({ card: label })
  },

  closeLabel() {
    this.setData({ card: null })
  },

  patchLabel(id, patch) {
    const apply = (l) => (l && l._id === id ? Object.assign({}, l, patch) : l)
    this._wall = (this._wall || []).map(apply)
    this._mine = (this._mine || []).map(apply)
    if (this.data.card && this.data.card._id === id) this.setData({ card: Object.assign({}, this.data.card, patch) })
    this.applyView()
  },

  async toggleEcho() {
    const card = this.data.card
    if (!card || card.echoed || card.isMine || this.data.echoBusy) return
    if (card._id.indexOf('local-') === 0) return
    this.setData({ echoBusy: true })
    try {
      const r = await this.callFn({ action: 'echo', id: card._id })
      if (!r || !r.success) throw new Error((r && r.msg) || 'echo failed')
      this._echoed.add(card._id)
      L.writeEchoed(wx, this._echoed)
      this.patchLabel(card._id, { echoed: true, echoCount: Math.max(card.echoCount + (r.already ? 0 : 1), parseInt(r.echoCount, 10) || 0) })
      trackBehavior('wish_wall_echo', 'ok', card._id)
    } catch (e) {
      this.toast('暂时没记上，请稍后再试')
    } finally {
      this.setData({ echoBusy: false })
    }
  },

  /** 统一主视觉轻提示（AppToast）；本页不用原生 toast（check:dialog-ratchet） */
  toast(title) {
    if (!title) return
    this.setData({ toastTitle: String(title), toastShow: true })
  },

  onToastClose() {
    if (this.data.toastShow) this.setData({ toastShow: false })
  },

  /* ------------------------------ 其它入口 ------------------------------ */

  goQian() {
    wx.navigateTo({ url: `${QIAN_PATH}?from=wish_labels` })
  },

  onNavBack() {
    const pages = getCurrentPages()
    if (pages.length > 1) wx.navigateBack()
    else wx.switchTab({ url: '/pages/index/index' })
  },

  onShareAppMessage() {
    const path = `/subpackages/feature/wish-labels/index?productKey=${encodeURIComponent(this.data.productKey)}&from=share`
    const card = this.data.card
    if (card && card.text) return { title: `「${card.text}」· 马上有 · 心愿签`, path }
    const ex = this.data.exhibit
    // 不传 imageUrl：封面是 cloud:// fileID（分享卡不认），省略时微信截页面首屏 = 展品实拍
    return { title: (ex && ex.line) || '马上有 · 心愿签', path }
  },

  onUnload() {
    this._unloaded = true
    if (this._wallTimer) { clearTimeout(this._wallTimer); this._wallTimer = null }
  },

  noop() {}
})
