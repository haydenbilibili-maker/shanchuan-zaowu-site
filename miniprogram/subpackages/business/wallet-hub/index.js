/**
 * 钱包枢纽（宿主页）—— 钱包 / 礼券夹 / 积分 三面板，页内切 tab（不做页面跳转，因此丝滑无感）
 *
 * 三批已全部并入：批 1 积分、批 2 礼券夹、批 3 钱包。旧三页均保留为薄跳转壳（站内信/收藏/历史链接不失效）。
 * 页面级能力由本页统一承接并按当前 tab 转发给面板（组件里没有 onPullDownRefresh / onHide）。
 */
const PANELS = {
  points: { id: 'panel-points', title: '我的积分', overline: 'POINTS' },
  coupons: { id: 'panel-coupons', title: '我的礼券夹', overline: 'COUPONS' },
  wallet: { id: 'panel-wallet', title: '我的钱包', overline: 'WALLET' }
}

Page({
  data: {
    curTab: 'points',
    barTitle: '我的积分',
    barOverline: 'POINTS',
    /** 顶栏「礼券夹」角标：由礼券夹/钱包面板回传（面板加载过之后才有值；与旧积分页一样不预取） */
    couponCount: 0,
    /** 入口渠道（如短信 from=sms1111），透传给礼券夹面板做可领取区块埋点；只收短标识 */
    from: ''
  },

  onLoad(options) {
    // 页生命周期是 onLoad → onShow → onReady，首屏那次 onShow 早于面板 ready：
    // 首屏取数交给面板自己的 lifetimes.ready，这里把第一次 onShow 丢掉，避免重复取数。
    this._skipFirstShow = true
    const from = String((options && options.from) || '')
    if (/^[A-Za-z0-9_-]{1,32}$/.test(from)) this.setData({ from })
    this.applyTab(options && options.tab)
  },

  /** 切到某个**已登记**面板；未登记（含深链里写错的 tab）一律落回积分，curTab 恒为 PANELS 的键 */
  applyTab(tab) {
    const key = PANELS[tab] ? tab : 'points'
    const meta = PANELS[key]
    this.setData({ curTab: key, barTitle: meta.title, barOverline: meta.overline })
    try { wx.setNavigationBarTitle({ title: meta.title }) } catch (e) { /* ignore */ }
  },

  /** hub 条派发的切 tab：页内切面板（无转场） */
  onTabChange(e) {
    const tab = (e.detail && e.detail.tab) || 'points'
    if (tab === this.data.curTab) return
    if (!PANELS[tab]) return   // 未登记的 tab（不该出现）：不动，避免把页面切空
    this.applyTab(tab)
  },

  /** 面板回传可用券数 → 喂给顶栏角标（顶栏是本页唯一一份，三个 tab 共用） */
  onCouponCount(e) {
    const count = (e.detail && Number(e.detail.count)) || 0
    if (count !== this.data.couponCount) this.setData({ couponCount: count })
  },

  activePanel() {
    const meta = PANELS[this.data.curTab]
    return meta ? this.selectComponent('#' + meta.id) : null
  },

  /** 页面级能力转发给当前面板（面板内部实现原样保留） */
  onPullDownRefresh() {
    const p = this.activePanel()
    if (p && typeof p.onPullDownRefresh === 'function') { p.onPullDownRefresh(); return }
    wx.stopPullDownRefresh()
  },
  onReachBottom() {
    const p = this.activePanel()
    if (p && typeof p.onReachBottom === 'function') p.onReachBottom()
  },
  onShow() {
    if (this._skipFirstShow) { this._skipFirstShow = false; return }
    const p = this.activePanel()
    if (p && typeof p.onShow === 'function') p.onShow()
  },
  /** 切后台/息屏：必须转发 —— 礼券夹面板要停核销轮询与倒计时（但保留亮码弹层状态） */
  onHide() {
    const p = this.activePanel()
    if (p && typeof p.onHide === 'function') p.onHide()
  }
})
