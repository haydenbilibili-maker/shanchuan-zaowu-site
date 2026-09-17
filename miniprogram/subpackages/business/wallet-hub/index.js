/**
 * 钱包枢纽（宿主页）—— 钱包 / 礼券夹 / 积分 三面板，页内切 tab（不做页面跳转，因此丝滑无感）
 *
 * 本轮（批 1）先接积分面板；礼券夹（批 2）、钱包（批 3）陆续并入。
 * 页面级能力由本页统一承接并按当前 tab 转发给面板（组件里没有 onPullDownRefresh）。
 */
const PANELS = { points: { id: 'panel-points', title: '我的积分', overline: 'POINTS' } }

Page({
  data: {
    curTab: 'points',
    barTitle: '我的积分',
    barOverline: 'POINTS'
  },

  onLoad(options) {
    // 页生命周期是 onLoad → onShow → onReady，首屏那次 onShow 早于面板 ready：
    // 首屏取数交给面板自己的 lifetimes.ready，这里把第一次 onShow 丢掉，避免重复取数。
    this._skipFirstShow = true
    const tab = (options && options.tab) || 'points'
    this.applyTab(PANELS[tab] ? tab : 'points')
  },

  applyTab(tab) {
    const meta = PANELS[tab] || PANELS.points
    this.setData({ curTab: tab, barTitle: meta.title, barOverline: meta.overline })
    try { wx.setNavigationBarTitle({ title: meta.title }) } catch (e) { /* ignore */ }
  },

  /** hub 条派发的切 tab（页内切换，无转场） */
  onTabChange(e) {
    const tab = (e.detail && e.detail.tab) || 'points'
    if (tab === this.data.curTab) return
    if (!PANELS[tab]) return   // 未并入的面板：hub 条自身会退回跳转（见 WalletHubBar.onTap）
    this.applyTab(tab)
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
  }
})
