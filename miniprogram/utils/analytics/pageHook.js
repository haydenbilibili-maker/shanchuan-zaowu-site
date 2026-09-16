/**
 * 全局 Page 生命周期埋点 — 须在 app.js 最早期 require
 */
const analytics = require('./index')

const _Page = Page
const pageEnterTimes = {}

/**
 * 上报一次离开事件并清理计时。
 *
 * 修复（真实统计缺陷）：onHide 与 onUnload 原本都读 `pageEnterTimes[route]`，
 * 但 onHide **没有清理**，于是「hide → unload」序列（跳转/返回最常见的路径）
 * 会对同一段停留时间写两条 page_leave → 停留时长与退出次数系统性翻倍。
 * 现在统一由此函数消费并删除计时，两个生命周期各只能上报一次。
 */
function flushPageLeave(route) {
  if (!route) return
  const start = pageEnterTimes[route]
  if (!start) return
  delete pageEnterTimes[route]
  analytics.trackPageLeave(route, { durationMs: Date.now() - start })
}

Page = function (pageOptions) {
  const userOnShow = pageOptions.onShow
  const userOnHide = pageOptions.onHide
  const userOnUnload = pageOptions.onUnload

  pageOptions.onShow = function (...args) {
    const route = this.route || ''
    // 同一页面 onShow 可能多次触发（返回前台）：以最后一次进入计时
    pageEnterTimes[route] = Date.now()
    analytics.trackPageView(route)
    if (typeof userOnShow === 'function') userOnShow.apply(this, args)
  }

  pageOptions.onHide = function (...args) {
    flushPageLeave(this.route || '')
    if (typeof userOnHide === 'function') userOnHide.apply(this, args)
  }

  pageOptions.onUnload = function (...args) {
    flushPageLeave(this.route || '')
    if (typeof userOnUnload === 'function') userOnUnload.apply(this, args)
  }

  return _Page(pageOptions)
}

module.exports = {}
