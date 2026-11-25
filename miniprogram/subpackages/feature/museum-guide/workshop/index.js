/**
 * 博物君 · 标本工坊（2026-11-23）：制作体验 / 陈列体验 / 标本灵感 → 馆里真的在卖的藏品 → 详情页（原有购买链路）。
 * 纯函数在 ../workshopKit.js；推荐只读既有云函数 getEncyclopediaFeed（馆藏 Tab 同一个），不新增接口。
 */
const W = require('../workshopKit')
const { ATLAS_SPECIES } = require('../../config/atlasCatalog')
const { thumbUrl } = require('../../../../utils/imageUrl')

const GUIDE = '/subpackages/feature/museum-guide/index'
const MAX_QUERIES = 3

Page({
  data: {
    tab: 'make',
    // 制作
    phase: 'pick',
    choices: [],
    species: null,
    stepIdx: 0,
    steps: W.STEPS,
    stepResult: null,
    results: [],
    holdSec: '0.0',
    holding: false,
    spreadDeg: 70,
    pinPos: 0,
    pinStopped: false,
    dryDays: 3,
    crafts: W.CRAFTS,
    backdrops: W.BACKDROPS,
    craftKey: '',
    backdropKey: 'linen',
    work: null,
    workGraphic: '',
    // 陈列
    spaces: W.SPACES,
    moods: W.MOODS,
    budgets: W.BUDGETS,
    spaceKey: '',
    moodKey: '',
    budgetKey: 'b4',
    plan: null,
    // 灵感
    insp: null,
    // 推荐
    products: [],
    productsLoading: false,
    productsEmpty: false
  },

  onLoad(options) {
    const tab = ['make', 'display', 'idea'].indexOf(options && options.tab) >= 0 ? options.tab : 'make'
    this.setData({ tab })
    this.newChoices()
  },

  onUnload() {
    this.stopTimers()
  },

  stopTimers() {
    clearInterval(this._holdTimer)
    clearInterval(this._pinTimer)
    this._holdTimer = null
    this._pinTimer = null
  },

  onShareAppMessage() {
    const w = this.data.work
    return { title: w ? `我在山海造物做了一只${w.nameZh}标本 · ${w.grade.label}` : '博物君 · 标本工坊：亲手做一只标本', path: '/subpackages/feature/museum-guide/workshop/index' }
  },

  onTab(e) {
    const tab = e.currentTarget.dataset.tab
    if (!tab || tab === this.data.tab) return
    this.stopTimers()
    this.setData({ tab, products: [], productsEmpty: false })
    if (tab === 'make' && this.data.work) this.loadProducts(this.data.work.intent)
    if (tab === 'display' && this.data.plan) this.loadProducts(this.data.plan.intent)
    if (tab === 'idea' && this.data.insp) this.loadProducts(this.data.insp.intent)
  },

  /* ------------------------------ 制作体验 ------------------------------ */

  newChoices() {
    const pool = W.makeableSpecies(ATLAS_SPECIES)
    const picked = []
    while (picked.length < Math.min(3, pool.length)) {
      const sp = pool[Math.floor(Math.random() * pool.length)]
      if (picked.indexOf(sp) < 0) picked.push(sp)
    }
    this.setData({ choices: picked.map((s) => ({ no: s.no, nameZh: s.nameZh, nameLatin: s.nameLatin, origin: s.origin })) })
  },

  onPickSpecies(e) {
    const sp = ATLAS_SPECIES.find((s) => s.no === e.currentTarget.dataset.no)
    if (!sp) return
    this._species = sp
    this.setData({ species: { no: sp.no, nameZh: sp.nameZh, nameLatin: sp.nameLatin }, phase: 'step', stepIdx: 0, results: [], stepResult: null, work: null, workGraphic: '', products: [], holdSec: '0.0', spreadDeg: 70, dryDays: 3, craftKey: '', pinStopped: false })
  },

  /** 回软：按住计时，松手判分 */
  onHoldStart() {
    if (this.data.stepResult) return
    this._holdAt = Date.now()
    this.setData({ holding: true })
    clearInterval(this._holdTimer)
    this._holdTimer = setInterval(() => this.setData({ holdSec: ((Date.now() - this._holdAt) / 1000).toFixed(1) }), 100)
  },

  onHoldEnd() {
    if (!this._holdAt || this.data.stepResult) return
    clearInterval(this._holdTimer)
    const ms = Date.now() - this._holdAt
    this._holdAt = 0
    this.setData({ holding: false, holdSec: (ms / 1000).toFixed(1) })
    this.finishStep(W.scoreRelax(ms))
  },

  onSpread(e) {
    this.setData({ spreadDeg: e.detail.value })
  },

  onSpreadDone() {
    this.finishStep(W.scoreSpread(this.data.spreadDeg))
  },

  /**
   * 下针：针左右来回，点「下针」时停住判分。
   * 2026-11-25 产品负责人：原来的速度太快（40ms × 4% = 一趟 1 秒），根本来不及对准 —
   * 改成约 2.4 秒一趟，并按余弦做缓入缓出：两端慢、中间快，判分窗口更好掐。
   */
  startPin() {
    clearInterval(this._pinTimer)
    this._pinT = 0
    this._pinDir = 1
    const TICK_MS = 48
    const TICKS_PER_PASS = 50           // 一趟（0→100）约 2.4 秒；两端因缓动会明显放慢
    const toPos = (t) => {
      // 三角波 0→1→0，再过一次缓动：两端停得久，判断时间更从容
      const tri = t % 2 < 1 ? t % 2 : 2 - (t % 2)
      const eased = (1 - Math.cos(Math.PI * tri)) / 2
      return Math.round(eased * 100)
    }
    this._pinTimer = setInterval(() => {
      this._pinT += 1 / TICKS_PER_PASS
      this.setData({ pinPos: toPos(this._pinT) })
    }, TICK_MS)
  },

  /** 图形解码失败就收起（保持卡片排版不塌），别在真机上留一块破图 */
  onWorkGraphicError() {
    this.setData({ workGraphic: '' })
  },

  onPinTap() {
    if (this.data.pinStopped) return
    clearInterval(this._pinTimer)
    this.setData({ pinStopped: true })
    this.finishStep(W.scorePin(this.data.pinPos))
  },

  onDry(e) {
    this.setData({ dryDays: e.detail.value })
  },

  onDryDone() {
    this.finishStep(W.scoreDry(this.data.dryDays))
  },

  onCraft(e) { this.setData({ craftKey: e.currentTarget.dataset.key }) },
  onBackdrop(e) { this.setData({ backdropKey: e.currentTarget.dataset.key }) },

  onFrameDone() {
    if (!this.data.craftKey) return
    this.finishStep(W.scoreFrame(this.data.craftKey))
  },

  finishStep(r) {
    this.setData({ stepResult: r, results: this.data.results.concat(r) })
  },

  onNextStep() {
    const next = this.data.stepIdx + 1
    if (next < W.STEPS.length) {
      this.setData({ stepIdx: next, stepResult: null })
      if (W.STEPS[next].key === 'pin') { this.setData({ pinStopped: false, pinPos: 0 }); this.startPin() }
      return
    }
    const work = W.buildWork(this._species, this.data.results, this.data.craftKey, this.data.backdropKey, Date.now())
    // 2026-11-25：作品卡加一张图形（衬底取 backdrop、外框取 craft，内联 SVG，无位图资源）
    const workGraphic = W.workGraphic(work)
    this.setData({ phase: 'done', workGraphic, work })
    this.loadProducts(work.intent)
  },

  onRemake() {
    this.stopTimers()
    this.newChoices()
    this.setData({ phase: 'pick', species: null, work: null, workGraphic: '', products: [], productsEmpty: false })
  },

  /* ------------------------------ 陈列体验 ------------------------------ */

  onSpace(e) { this.setData({ spaceKey: e.currentTarget.dataset.key }) },
  onMood(e) { this.setData({ moodKey: e.currentTarget.dataset.key }) },
  onBudget(e) { this.setData({ budgetKey: e.currentTarget.dataset.key }) },

  onPlan() {
    const plan = W.buildDisplayPlan(this.data.spaceKey, this.data.moodKey, this.data.budgetKey)
    if (!plan) return
    this.setData({ plan })
    this.loadProducts(plan.intent)
  },

  /* ------------------------------ 标本灵感 ------------------------------ */

  onDraw() {
    const insp = W.drawInspiration(ATLAS_SPECIES)
    this.setData({ insp })
    this.loadProducts(insp.intent)
  },

  /* ------------------------------ 推荐 / 去处 ------------------------------ */

  /** 按放宽顺序查，凑够 4 件或查满 3 次为止；查不到就明说，不编 */
  async loadProducts(intent) {
    const token = (this._productToken = (this._productToken || 0) + 1)
    this.setData({ productsLoading: true, products: [], productsEmpty: false })
    const queries = W.productQueries(intent).slice(0, MAX_QUERIES)
    const batches = []
    for (const q of queries) {
      try {
        const res = await wx.cloud.callFunction({ name: 'getEncyclopediaFeed', data: q })
        batches.push((res && res.result && res.result.orphanProducts) || [])
      } catch (e) { batches.push([]) }
      if (W.mergeProducts(batches).length >= 4) break
    }
    if (token !== this._productToken) return
    const products = W.mergeProducts(batches, (u) => (u ? thumbUrl(u) : ''))
    this.setData({ products, productsLoading: false, productsEmpty: !products.length })
  },

  onProductTap(e) {
    const id = e && e.detail && e.detail.id
    if (id) wx.navigateTo({ url: `/subpackages/feature/detail/index?id=${encodeURIComponent(id)}` })
  },

  onShopAll() {
    wx.switchTab({ url: '/pages/category/index' })
  },

  onAsk(e) {
    const q = e.currentTarget.dataset.q
    if (q) wx.navigateTo({ url: `${GUIDE}?from=workshop&auto=1&q=${encodeURIComponent(q)}` })
  }
})
