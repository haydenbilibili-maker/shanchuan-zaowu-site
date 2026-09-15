const { getSession, setReferrerPage } = require('./session')
const { resolveModule } = require('./eventSchema')

const QUEUE_MAX = 20
const FLUSH_INTERVAL_MS = 8000
const queue = []
let flushTimer = null
let flushing = false
let systemInfoCache = null

function getAppSafe() {
  try {
    return getApp()
  } catch (e) {
    return null
  }
}

function getUserId() {
  const app = getAppSafe()
  return (app && app.globalData && app.globalData.openid) || ''
}

function getCurrentPageRoute() {
  try {
    const pages = getCurrentPages()
    if (!pages.length) return ''
    const p = pages[pages.length - 1]
    return p.route || ''
  } catch (e) {
    return ''
  }
}

function getSystemSnapshot() {
  if (systemInfoCache) return systemInfoCache
  try {
    const { getSystemSnapshot: snap } = require('../systemInfo')
    systemInfoCache = snap()
  } catch (e) {
    systemInfoCache = { platform: '', model: '', version: '', SDKVersion: '' }
  }
  return systemInfoCache
}

function buildPayload(action, targetType, targetId, extra = {}) {
  const session = getSession()
  const { module: extraModule, properties, ...restExtra } = extra
  const module = resolveModule(action, extraModule)
  const page = extra.page || getCurrentPageRoute()
  const timestamp = extra.timestamp || Date.now()

  return {
    userId: getUserId(),
    action,
    targetType,
    targetId: String(targetId),
    module,
    sessionId: session.id,
    page,
    scene: session.scene,
    referrerPage: session.referrerPage || '',
    timestamp,
    properties: properties || restExtra,
    ...restExtra,
    platform: getSystemSnapshot().platform
  }
}

function enqueue(payload) {
  if (!payload.action || !payload.targetType || !payload.targetId) return
  queue.push(payload)
  if (queue.length >= QUEUE_MAX) {
    flush()
    return
  }
  scheduleFlush()
}

function scheduleFlush() {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    flush()
  }, FLUSH_INTERVAL_MS)
}

function flush() {
  if (flushing || !queue.length) return Promise.resolve()
  if (!getUserId()) {
    scheduleFlush()
    return Promise.resolve()
  }

  flushing = true
  const batch = queue.splice(0, QUEUE_MAX)

  return wx.cloud
    .callFunction({
      name: 'trackUserBehavior',
      data: { events: batch }
    })
    .catch(() => {})
    .finally(() => {
      flushing = false
      if (queue.length) scheduleFlush()
    })
}

/**
 * 核心埋点 API
 * @param {string} action
 * @param {string} targetType
 * @param {string|number} targetId
 * @param {Object} [extra]
 */
function track(action, targetType, targetId, extra = {}) {
  const payload = buildPayload(action, targetType, targetId, extra)
  if (!payload.userId) {
    scheduleFlush()
    return Promise.resolve()
  }
  enqueue(payload)
  return Promise.resolve()
}

function trackPageView(route, extra = {}) {
  const r = route || getCurrentPageRoute()
  if (!r) return Promise.resolve()
  setReferrerPage(r)
  return track('page_view', 'page', r, { ...extra, page: r })
}

function trackPageLeave(route, extra = {}) {
  const r = route || getCurrentPageRoute()
  if (!r) return Promise.resolve()
  const duration = extra.durationMs || 0
  return track('page_leave', 'page', r, {
    ...extra,
    page: r,
    properties: { ...(extra.properties || {}), durationMs: duration }
  })
}

function trackTabSwitch(tabKey, extra = {}) {
  return track('tab_switch', 'tab', tabKey, extra)
}

/** 兼容旧 API */
function trackBehavior(action, targetType, targetId, extra = {}) {
  return track(action, targetType, targetId, extra)
}

module.exports = {
  track,
  trackBehavior,
  trackPageView,
  trackPageLeave,
  trackTabSwitch,
  flush,
  buildPayload,
  getCurrentPageRoute
}
