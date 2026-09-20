const SESSION_KEY = 'analytics_session_v1'
const SESSION_TTL_MS = 30 * 60 * 1000

function genId() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function readSession() {
  try {
    return wx.getStorageSync(SESSION_KEY) || null
  } catch (e) {
    return null
  }
}

function writeSession(data) {
  try {
    wx.setStorageSync(SESSION_KEY, data)
  } catch (e) {}
}

function getLaunchScene() {
  try {
    const opts = wx.getLaunchOptionsSync()
    return opts.scene || 0
  } catch (e) {
    return 0
  }
}

/**
 * 取「本次进入」的码 scene 串（不是数字场景值）。
 *
 * 为什么两个 API 都要问：`getLaunchOptionsSync()` 只反映**冷启动**那一次；
 * 小程序在后台时扫码（热启动）只有 `getEnterOptionsSync()`（基础库 2.20.1+）会更新。
 * 数字场景值对三张码完全相同（都是扫码），所以归因只能靠这里的 scene 串
 * （见 `./qrMaterial.js`）。
 */
function getEnterSceneText() {
  const pick = (opts) => {
    const q = (opts && opts.query) || {}
    const raw = q.scene != null ? q.scene : (opts && opts.scene)
    return raw == null ? '' : String(raw)
  }
  try {
    if (typeof wx.getEnterOptionsSync === 'function') {
      const t = pick(wx.getEnterOptionsSync())
      if (t) return t
    }
  } catch (e) { /* 拿不到就问下一个 */ }
  try {
    return pick(wx.getLaunchOptionsSync())
  } catch (e) {
    return ''
  }
}

/** 从进入 scene 解析物料归因值（`qr:<key>`），非登记物料返回 '' */
function resolveLaunchEntrySource() {
  try {
    const { parseQrMaterial, entrySourceOf } = require('./qrMaterial')
    return entrySourceOf(parseQrMaterial(getEnterSceneText()))
  } catch (e) {
    return ''
  }
}

function getSession() {
  const now = Date.now()
  let s = readSession()
  if (s && s.id && now - s.startedAt < SESSION_TTL_MS) {
    s.lastActiveAt = now
    writeSession(s)
    return s
  }
  s = {
    id: genId(),
    startedAt: now,
    lastActiveAt: now,
    scene: getLaunchScene(),
    referrerPage: '',
    // 物料码归因（`qr:<key>`）：本次会话内所有事件都会带上它（见 ../index.js#buildPayload）
    entrySource: resolveLaunchEntrySource()
  }
  writeSession(s)
  return s
}

function setReferrerPage(page) {
  const s = getSession()
  s.referrerPage = page || ''
  writeSession(s)
}

/**
 * 写入/覆盖本会话的物料归因值。
 *
 * 为什么不能只在 `getSession()` 建会话时算一次：会话 TTL 30 分钟，用户完全可能
 * 在**同一个会话里**先逛首页、再扫立牌 —— 那时会话已存在，若不覆盖，扫码这段的
 * 转化会被算进"无来源"。故 app 级入口每次识别到物料码都显式覆盖一次。
 */
function setEntrySource(src) {
  const s = getSession()
  s.entrySource = src || ''
  writeSession(s)
  return s.entrySource
}

function touchSession() {
  return getSession()
}

module.exports = {
  getSession,
  setReferrerPage,
  setEntrySource,
  getEnterSceneText,
  touchSession,
  SESSION_TTL_MS
}
