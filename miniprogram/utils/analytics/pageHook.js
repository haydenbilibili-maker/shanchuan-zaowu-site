/**
 * 全局 Page 生命周期埋点 — 须在 app.js 最早期 require
 */
const analytics = require('./index')

const _Page = Page
const pageEnterTimes = {}

Page = function (pageOptions) {
  const userOnShow = pageOptions.onShow
  const userOnHide = pageOptions.onHide
  const userOnUnload = pageOptions.onUnload

  pageOptions.onShow = function (...args) {
    const route = this.route || ''
    pageEnterTimes[route] = Date.now()
    analytics.trackPageView(route)
    if (typeof userOnShow === 'function') userOnShow.apply(this, args)
  }

  pageOptions.onHide = function (...args) {
    const route = this.route || ''
    const start = pageEnterTimes[route]
    const durationMs = start ? Date.now() - start : 0
    analytics.trackPageLeave(route, { durationMs })
    if (typeof userOnHide === 'function') userOnHide.apply(this, args)
  }

  pageOptions.onUnload = function (...args) {
    const route = this.route || ''
    if (pageEnterTimes[route]) {
      const durationMs = Date.now() - pageEnterTimes[route]
      analytics.trackPageLeave(route, { durationMs })
      delete pageEnterTimes[route]
    }
    if (typeof userOnUnload === 'function') userOnUnload.apply(this, args)
  }

  return _Page(pageOptions)
}

module.exports = {}
