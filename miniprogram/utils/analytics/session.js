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
    referrerPage: ''
  }
  writeSession(s)
  return s
}

function setReferrerPage(page) {
  const s = getSession()
  s.referrerPage = page || ''
  writeSession(s)
}

function touchSession() {
  return getSession()
}

module.exports = { getSession, setReferrerPage, touchSession, SESSION_TTL_MS }
