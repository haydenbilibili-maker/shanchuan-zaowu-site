/**
 * 我的捐赠（2026-11-22 产品负责人：钱包新增「我的捐赠」，把 1% 公益做重点展示）
 *
 * 规则：顾客在小程序的累计实付 × 1%，由山海万物公益基金代为捐赠（文案见 donationCopy.js）。
 * 数据：只读云函数 getMyDonations（只查本人；口径同店内账本 pledgeDue）。没部署 / 查失败时，
 *       规则、流向、去向与问答照常展示，只有金额区给出可重试的说明 —— 不拿 0 冒充「您还没捐」。
 * 本页只读：不写库、不改订单 / 钱包任何字段。
 */
const copy = require('./donationCopy')
const { buildView, pickRows, PAGE_ROWS } = require('./donationView')
const { isLocalLoggedOut } = require('../../../utils/userSession')

const CACHE_KEY = 'my_donation_view_v1'
const COUNT_MS = 900
const COUNT_STEPS = 24

function openidOf() {
  try {
    const app = getApp()
    return (app && app.globalData && app.globalData.openid) || ''
  } catch (e) {
    return ''
  }
}

Page({
  data: {
    copy,
    /** guest 未登录 / loading 首次加载 / ready 有数 / error 查不到 */
    phase: 'loading',
    hero: null,
    heroAmount: '0.00',
    years: [],
    yearTabs: [],
    yearKey: 'all',
    rows: [],
    shownRows: [],
    rowsMore: false,
    rowLimit: PAGE_ROWS,
    notes: [],
    faqOpen: -1,
    flowLit: false
  },

  onLoad() {
    this._rows = []
    if (isLocalLoggedOut()) {
      this.setData({ phase: 'guest', flowLit: true })
      return
    }
    // 本机快照先画（同账号），云端回来后再以云端为准
    const snap = this.readCache()
    if (snap) this.applyView(snap, { animate: false })
    this.load()
  },

  onUnload() {
    this._unloaded = true
    this.stopCount()
  },

  onPullDownRefresh() {
    if (isLocalLoggedOut()) {
      this.setData({ phase: 'guest' })
      wx.stopPullDownRefresh()
      return
    }
    this.load().finally(() => wx.stopPullDownRefresh())
  },

  onShareAppMessage() {
    // 分享不带个人金额：对方打开看到的是规则与去向
    return { title: copy.SHARE_TITLE, path: '/subpackages/business/donations/index' }
  },

  async load() {
    try {
      const res = await wx.cloud.callFunction({ name: 'getMyDonations', data: {} })
      const r = (res && res.result) || {}
      if (this._unloaded) return
      if (!r.success || !r.data) throw new Error(r.msg || 'no data')
      const view = buildView(r.data, copy.FUND_NAME)
      this.writeCache(view)
      this.applyView(view, { animate: true })
    } catch (e) {
      if (this._unloaded) return
      console.warn('[donations] 查询失败', e)
      // 已有快照就保留快照，只在完全没数时进 error 态
      if (this.data.phase !== 'ready') this.setData({ phase: 'error', flowLit: true })
    }
  },

  applyView(view, { animate }) {
    this._rows = view.rows
    const pick = pickRows(view.rows, 'all', PAGE_ROWS)
    this.setData({
      phase: 'ready',
      hero: view.hero,
      years: view.years,
      yearTabs: view.yearTabs,
      yearKey: 'all',
      rowLimit: PAGE_ROWS,
      shownRows: pick.shown,
      rowsMore: pick.more,
      notes: view.notes,
      flowLit: true
    })
    if (animate && view.pledgeFen > 0) this.countUp(view.pledgeFen, view.hero.amount)
    else this.setData({ heroAmount: view.hero.amount })
  },

  /** 金额从 0 数到目标（只在云端新数据到达时播一次；快照直接落定值） */
  countUp(targetFen, finalText) {
    this.stopCount()
    let step = 0
    this._countTimer = setInterval(() => {
      step += 1
      if (this._unloaded || step >= COUNT_STEPS) {
        this.stopCount()
        if (!this._unloaded) this.setData({ heroAmount: finalText })
        return
      }
      const t = step / COUNT_STEPS
      const eased = 1 - Math.pow(1 - t, 3)
      const fen = Math.round(targetFen * eased)
      this.setData({ heroAmount: (fen / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',') })
    }, Math.round(COUNT_MS / COUNT_STEPS))
  },

  stopCount() {
    if (this._countTimer) clearInterval(this._countTimer)
    this._countTimer = null
  },

  onYearTap(e) {
    const key = String(e.currentTarget.dataset.key || 'all')
    if (key === this.data.yearKey) return
    const pick = pickRows(this._rows, key, PAGE_ROWS)
    this.setData({ yearKey: key, rowLimit: PAGE_ROWS, shownRows: pick.shown, rowsMore: pick.more })
  },

  onMoreRows() {
    const limit = this.data.rowLimit + PAGE_ROWS
    const pick = pickRows(this._rows, this.data.yearKey, limit)
    this.setData({ rowLimit: limit, shownRows: pick.shown, rowsMore: pick.more })
  },

  onRowTap(e) {
    const id = String(e.currentTarget.dataset.id || '')
    if (!id) return
    wx.navigateTo({ url: `/subpackages/business/order-detail/index?id=${encodeURIComponent(id)}` })
  },

  onFaqTap(e) {
    const i = Number(e.currentTarget.dataset.index)
    this.setData({ faqOpen: this.data.faqOpen === i ? -1 : i })
  },

  onRetry() {
    this.setData({ phase: 'loading' })
    this.load()
  },

  goLogin() {
    wx.switchTab({ url: '/pages/user/index' })
  },

  goBrowse() {
    wx.switchTab({ url: '/pages/category/index' })
  },

  readCache() {
    try {
      const raw = wx.getStorageSync(CACHE_KEY)
      const id = openidOf()
      return raw && id && raw.openid === id && raw.view ? raw.view : null
    } catch (e) {
      return null
    }
  },

  writeCache(view) {
    const id = openidOf()
    if (!id) return
    try {
      wx.setStorageSync(CACHE_KEY, { openid: id, at: Date.now(), view })
    } catch (e) {
      console.warn('[donations] 快照写入失败', e)
    }
  }
})
