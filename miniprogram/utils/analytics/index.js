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
  // openid 到位时先把暖机缓冲并入队列（覆盖「暖机后再无 track 调用」的场景）
  if (getUserId()) drainWarmupQueue()
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
 * 启动暖机缓冲区。
 *
 * 真实缺陷（2026-09-16 修复）：`app.globalData.openid` 由 `app.js:241` **异步**调 `login`
 * 云函数后才回填，而 `app.js:97` 的 `app_launch` 与首个页面 onShow 都比它更早。
 * 原实现在 `!userId` 时直接丢弃 → **启动期事件（含 app_launch 与首个 PV）系统性丢失**，
 * 漏斗首环长期偏低。
 *
 * 且云端 `trackUserBehavior` 会**强制**用平台 openid 覆盖客户端 userId
 * （trackUserBehavior/index.js:257），故客户端本就不需要等 userId 才能上报 ——
 * 这里缓冲只是为了暖机完成后**补发**，不是因为鉴权。
 *
 * 与「用户主动退出登录」区分：退出态事件是真该丢的（见 track）。
 */
const WARMUP_MAX_EVENTS = 40
const WARMUP_MAX_AGE_MS = 60 * 1000
let warmupQueue = []

function isLoggedOut() {
  try {
    const { isLocalLoggedOut } = require('../userSession')
    return !!(isLocalLoggedOut && isLocalLoggedOut())
  } catch (e) {
    return false
  }
}

/** 登录态可用后补发暖机期缓冲事件（丢弃超龄项，避免把很久以前的事件写入今天） */
function drainWarmupQueue() {
  if (!warmupQueue.length || !getUserId()) return
  const now = Date.now()
  const fresh = warmupQueue.filter((p) => now - (p.timestamp || 0) <= WARMUP_MAX_AGE_MS)
  warmupQueue = []
  fresh.forEach((p) => enqueue(p))
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
    // 主动退出登录：事件不该入库
    if (isLoggedOut()) return Promise.resolve()
    // 暖机期：先缓冲，openid 到位后补发（避免丢弃启动期事件）
    warmupQueue.push(payload)
    if (warmupQueue.length > WARMUP_MAX_EVENTS) warmupQueue.shift()
    scheduleFlush()
    return Promise.resolve()
  }
  drainWarmupQueue()
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
