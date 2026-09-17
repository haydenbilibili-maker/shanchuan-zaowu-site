/**
 * 钱包枢纽（宿主页）—— 钱包 / 礼券夹 / 积分 三面板，页内切 tab（不做页面跳转，因此丝滑无感）
 *
 * 进度：批 1 已并入积分、批 2 已并入礼券夹；钱包（批 3）随后。
 * 页面级能力由本页统一承接并按当前 tab 转发给面板（组件里没有 onPullDownRefresh / onHide）。
 */
const PANELS = {
  points: { id: 'panel-points', title: '我的积分', overline: 'POINTS' },
  coupons: { id: 'panel-coupons', title: '我的礼券夹', overline: 'COUPONS' }
}

/**
 * 尚未并入枢纽的面板 → 仍按**原页面跳转**处理（就是这批之前三页互相跳的行为）。
 * 这样任何一批单独验收时，三个 tab 都不会「点了没反应」；并入后本条自动失效。
 * 已并入 PANELS 的 tab 不在此表中。
 */
const PENDING_TAB_URL = {
  wallet: '/subpackages/extra/user/stored-value/index'
}

Page({
  data: {
    curTab: 'points',
    barTitle: '我的积分',
    barOverline: 'POINTS',
    /** 顶栏「礼券夹」角标：由礼券夹面板回传（面板加载过之后才有值；与旧积分页一样不预取） */
    couponCount: 0
  },

  onLoad(options) {
    // 页生命周期是 onLoad → onShow → onReady，首屏那次 onShow 早于面板 ready：
    // 首屏取数交给面板自己的 lifetimes.ready，这里把第一次 onShow 丢掉，避免重复取数。
    this._skipFirstShow = true
    this.applyTab(options && options.tab)
  },

  /** 切到某个**已登记**面板；未登记（含深链里写错的 tab）一律落回积分，curTab 恒为 PANELS 的键 */
  applyTab(tab) {
    const key = PANELS[tab] ? tab : 'points'
    const meta = PANELS[key]
    this.setData({ curTab: key, barTitle: meta.title, barOverline: meta.overline })
    try { wx.setNavigationBarTitle({ title: meta.title }) } catch (e) { /* ignore */ }
  },

  /** hub 条派发的切 tab：已并入的页内切面板，未并入的退回原页面跳转 */
  onTabChange(e) {
    const tab = (e.detail && e.detail.tab) || 'points'
    if (tab === this.data.curTab) return
    if (!PANELS[tab]) {
      const url = PENDING_TAB_URL[tab]
      if (url) {
        wx.redirectTo({ url, fail: () => wx.showToast({ title: '页面暂不可用', icon: 'none' }) })
      }
      return
    }
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
