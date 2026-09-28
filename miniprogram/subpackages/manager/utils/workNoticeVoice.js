/**
 * 工作通知声音 —— 播放引擎（需求 #29）
 *
 * 职责：把「工作台待办计数快照」变成「该不该出声、出哪一句」，并把音频播出去。
 * 语料与信号清单在 `workNoticeCatalog.js`（唯一真源），本文件不写死任何文案。
 *
 * 设计要点（每条都对应一次踩坑预判）：
 *  1. **只播新增**：首次进入工作台只建立基线，不播（否则一登录就五六条连播）。
 *     之后按「计数上涨」判断；订单类额外用**消息 id 差集**（读了 1 条又来 1 条时计数不变，但确实是新单）。
 *  2. **静音不囤积**：声音关掉期间照样推进基线 —— 否则重新打开时会一次性把攒下的全播出来。
 *  3. **节流不丢消息**：两次播报间隔 < `MIN_ANNOUNCE_INTERVAL_MS` 时**不推进基线**，
 *     这批新增留到下一轮再播（推进了就等于吞掉）。
 *  4. **一次最多 3 条**：其余只留角标（`MAX_ANNOUNCE_PER_CYCLE`）。
 *  5. **任何一步都不许抛**：工作台是主业，播不出声最多是没提示，
 *     所以 wx API 全部 try/catch，音频失败退化为一次轻震动。
 *  6. **纯逻辑与 wx 分离**：`diffNoticeSnapshot` 不碰任何平台 API，可直接单测（守卫里有断言）。
 */

const catalog = require('./workNoticeCatalog')

const STORAGE_ENABLED = 'work_notice_voice_enabled_v1'
const STORAGE_SEEN = 'work_notice_voice_seen_v1'
const STORAGE_LAST_AT = 'work_notice_voice_last_at_v1'
const SEEN_VERSION = 1

const PRIORITY = {}
catalog.listAudioEntries().forEach((t) => {
  PRIORITY[t.type] = Number(t.priority) || 999
})

function hasWx() {
  return typeof wx !== 'undefined' && wx && typeof wx.getStorageSync === 'function'
}

function safeGet(key, fallback) {
  if (!hasWx()) return fallback
  try {
    const v = wx.getStorageSync(key)
    return v === '' || v == null ? fallback : v
  } catch (e) {
    return fallback
  }
}

function safeSet(key, value) {
  if (!hasWx()) return
  try {
    wx.setStorageSync(key, value)
  } catch (e) {
    /* 存不下就不存：下次最多重播一次，不影响功能 */
  }
}

// ─────────────────────────── 纯逻辑（可单测） ───────────────────────────

function normalizeSnapshot(snapshot) {
  const out = {}
  const src = snapshot && typeof snapshot === 'object' ? snapshot : {}
  Object.keys(src).forEach((type) => {
    const row = src[type] || {}
    const entry = { count: Number(row.count) > 0 ? Math.floor(Number(row.count)) : 0 }
    if (Array.isArray(row.ids)) entry.ids = row.ids.map(String)
    out[type] = entry
  })
  return out
}

function sortByPriority(types) {
  return types.slice().sort((a, b) => (PRIORITY[a] || 999) - (PRIORITY[b] || 999))
}

/**
 * 对比两次快照，得出本轮该播的类型。
 *
 * @param {object|null} prev 上次快照（null = 还没有基线）
 * @param {object} next      本次快照
 * @param {{allowed?:string[], max?:number}} [opts]
 * @returns {{announce:string[], next:object, baseline:boolean}}
 */
function diffNoticeSnapshot(prev, next, opts) {
  const options = opts || {}
  const nextSnap = normalizeSnapshot(next)
  const prevSnap = prev ? normalizeSnapshot(prev) : null
  const allowed = Array.isArray(options.allowed) && options.allowed.length
    ? options.allowed
    : Object.keys(nextSnap)
  const max = Number(options.max) > 0 ? Math.floor(Number(options.max)) : catalog.MAX_ANNOUNCE_PER_CYCLE

  if (!prevSnap) return { announce: [], next: nextSnap, baseline: true }

  const hits = []
  allowed.forEach((type) => {
    const n = nextSnap[type]
    if (!n) return
    const p = prevSnap[type]
    if (!p) return // 清单新增的类型：先建基线，下一轮起才播
    // ① id 级（更精确）：读了 1 条又来 1 条时计数不变，但确实是新单
    if (Array.isArray(n.ids) && Array.isArray(p.ids)) {
      const seen = {}
      p.ids.forEach((id) => { seen[id] = true })
      if (n.ids.some((id) => !seen[id])) hits.push(type)
      return
    }
    // ② 计数级：上涨即新
    if (n.count > p.count) hits.push(type)
  })

  return { announce: sortByPriority(hits).slice(0, max), next: nextSnap, baseline: false }
}

// ─────────────────────────── 开关 ───────────────────────────

/** 默认开启（产品口径：工作台需要有新工作信息时出声） */
function isEnabled() {
  const v = safeGet(STORAGE_ENABLED, true)
  return v !== false && v !== 'false' && v !== 0
}

function setEnabled(on) {
  const next = !!on
  safeSet(STORAGE_ENABLED, next)
  if (!next) stop()
  return next
}

function toggleEnabled() {
  return setEnabled(!isEnabled())
}

// ─────────────────────────── 基线存储 ───────────────────────────

function loadSeen() {
  const raw = safeGet(STORAGE_SEEN, null)
  if (!raw || typeof raw !== 'object' || raw.version !== SEEN_VERSION) return { version: SEEN_VERSION, roles: {} }
  return { version: SEEN_VERSION, roles: raw.roles || {} }
}

function saveSeen(store) {
  safeSet(STORAGE_SEEN, store)
}

function resetBaseline(role) {
  const store = loadSeen()
  if (role) delete store.roles[String(role)]
  else store.roles = {}
  saveSeen(store)
}

// ─────────────────────────── 播放 ───────────────────────────

let _ctx = null
let _playing = false
let _lastAnnounceAt = 0
let _optionApplied = false

function isSupported() {
  return typeof wx !== 'undefined' && wx && typeof wx.createInnerAudioContext === 'function'
}

/** 让提示音在 iOS 静音键打开时也尽量出声（真机仍需验证，见 docs） */
function applyAudioOption() {
  if (_optionApplied || typeof wx === 'undefined' || !wx.setInnerAudioOption) return
  _optionApplied = true
  try {
    wx.setInnerAudioOption({ obeyMuteSwitch: false, mixWithOther: true })
  } catch (e) {
    /* 老版本基础库不支持，忽略 */
  }
}

function vibrate() {
  try {
    if (typeof wx !== 'undefined' && wx.vibrateShort) wx.vibrateShort({ type: 'light' })
  } catch (e) {
    /* ignore */
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 播一个文件；返回是否真的播完（失败/超时都算 false） */
function playFile(src, timeoutMs) {
  return new Promise((resolve) => {
    if (!isSupported() || !src) return resolve(false)
    applyAudioOption()
    let settled = false
    let timer = null
    const finish = (ok) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve(ok)
    }
    try {
      if (!_ctx) _ctx = wx.createInnerAudioContext()
      if (typeof _ctx.offEnded === 'function') _ctx.offEnded()
      if (typeof _ctx.offError === 'function') _ctx.offError()
      _ctx.onEnded(() => finish(true))
      _ctx.onError(() => finish(false))
      _ctx.src = src
      _ctx.play()
      timer = setTimeout(() => finish(false), Number(timeoutMs) > 0 ? Number(timeoutMs) : 8000)
    } catch (e) {
      finish(false)
    }
  })
}

async function playTypes(types) {
  const list = (types || []).filter(Boolean)
  if (!list.length) return []
  if (_playing) return [] // 正在播就跳过本轮，不排队堆积
  _playing = true
  const played = []
  try {
    for (let i = 0; i < list.length; i += 1) {
      const path = catalog.audioPath(list[i])
      const ok = await playFile(path)
      if (ok) played.push(list[i])
      else vibrate() // 播不出声（静音键/资源缺失/被系统拦截）至少给一次轻震动
      if (i < list.length - 1) await sleep(240)
    }
  } finally {
    _playing = false
  }
  return played
}

function stop() {
  try {
    if (_ctx && typeof _ctx.stop === 'function') _ctx.stop()
  } catch (e) {
    /* ignore */
  }
}

function destroy() {
  stop()
  try {
    if (_ctx && typeof _ctx.destroy === 'function') _ctx.destroy()
  } catch (e) {
    /* ignore */
  }
  _ctx = null
}

// ─────────────────────────── 对外主入口 ───────────────────────────

/**
 * 根据快照判断并播报「新增的工作信息」。
 *
 * @param {object} snapshot  `catalog.buildSnapshot(pageData, role)` 的结果
 * @param {string} role      工作台角色（用于二次过滤）
 * @param {{force?:boolean}} [opts]
 * @returns {{announced:string[], reason:string, baseline?:boolean}}
 */
function announce(snapshot, role, opts) {
  const options = opts || {}
  let allowed = null
  try {
    allowed = catalog.typesForRole(role).map((t) => t.type)
  } catch (e) {
    allowed = null
  }
  // 角色取不到（未就绪）时只建基线，不出声：宁可少响，不可越权响
  if (!allowed) return { announced: [], reason: 'no-role', baseline: true }

  const store = loadSeen()
  const key = String(role || 'unknown')
  const prev = store.roles[key] || null

  let diff
  try {
    diff = diffNoticeSnapshot(prev, snapshot, { allowed })
  } catch (e) {
    return { announced: [], reason: 'bad-snapshot' }
  }

  if (diff.baseline) {
    store.roles[key] = diff.next
    saveSeen(store)
    return { announced: [], reason: 'baseline', baseline: true }
  }

  const list = diff.announce
  if (!list.length) {
    store.roles[key] = diff.next
    saveSeen(store)
    return { announced: [], reason: 'no-change' }
  }

  // 静音：推进基线，但不攒债
  if (!isEnabled()) {
    store.roles[key] = diff.next
    saveSeen(store)
    return { announced: [], reason: 'muted' }
  }

  const now = Date.now()
  const last = Number(safeGet(STORAGE_LAST_AT, 0)) || 0
  if (!options.force && now - last < catalog.MIN_ANNOUNCE_INTERVAL_MS) {
    // 节流：**不**推进基线，这批新增留到下一轮播
    return { announced: [], reason: 'throttled' }
  }

  // 带宽限，先把基线推进（未播的那几条不再重播，避免同一批反复提示）
  store.roles[key] = diff.next
  saveSeen(store)
  safeSet(STORAGE_LAST_AT, now)

  if (!isSupported()) {
    vibrate()
    return { announced: list, reason: 'no-audio-ctx' }
  }

  playTypes(list).catch(() => { /* playTypes 内部已兜底 */ })
  return { announced: list, reason: 'playing' }
}

/** 试听（忽略开关与节流，单条） */
function preview(type) {
  const entry = catalog.getType(type) || catalog.PREVIEW_TYPE
  playTypes([entry.type]).catch(() => {})
  return entry.type
}

module.exports = {
  // 纯逻辑 / 常量（便于单测与守卫）
  diffNoticeSnapshot,
  normalizeSnapshot,
  sortByPriority,
  STORAGE_ENABLED,
  STORAGE_SEEN,
  STORAGE_LAST_AT,
  // 开关
  isEnabled,
  setEnabled,
  toggleEnabled,
  isSupported,
  // 基线
  loadSeen,
  resetBaseline,
  // 播放
  announce,
  preview,
  stop,
  destroy
}
