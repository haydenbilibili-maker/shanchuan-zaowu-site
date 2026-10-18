/**
 * 视频续播（2026-10-18「少一步」）：本机记住每个视频看到哪，回来一键续播。
 * 纯前端：只写本机缓存，不改云端字段。影像列表（content/videos）读同一个 KEY 画进度，
 * 那边跨分包不能 require，按同一结构内联读取（守卫 R41-3 钉住两边 KEY 一致）。
 */
const KEY = 'video_resume_v1'
const MAX = 60
const MIN_SEC = 5 // 看不到 5 秒不算「看过」
const TAIL_SEC = 5 // 离结尾 5 秒内视为看完

function load(storage) {
  try {
    const raw = storage.getStorageSync(KEY)
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  } catch (e) {
    return {}
  }
}

function save(storage, map) {
  const ids = Object.keys(map).sort((a, b) => (map[b].at || 0) - (map[a].at || 0))
  const trimmed = {}
  ids.slice(0, MAX).forEach((id) => { trimmed[id] = map[id] })
  try { storage.setStorageSync(KEY, trimmed) } catch (e) { /* 存不下就不续播 */ }
}

/** 02:14 / 1:02:14 */
function fmtClock(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const pad = (n) => String(n).padStart(2, '0')
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`
}

/** 值得记的位置：看过 5 秒以上、且还没到结尾 */
function worthKeeping(t, d) {
  const time = Number(t) || 0
  const dur = Number(d) || 0
  if (time < MIN_SEC) return false
  return !(dur > 0 && time >= dur - TAIL_SEC)
}

/** 记一次位置；看完 / 没看几秒则清掉 */
function record(storage, id, t, d, now) {
  if (!id) return
  const map = load(storage)
  if (worthKeeping(t, d)) map[id] = { t: Math.floor(t), d: Math.floor(Number(d) || 0), at: now || Date.now() }
  else delete map[id]
  save(storage, map)
}

function clear(storage, id) {
  const map = load(storage)
  if (!map[id]) return
  delete map[id]
  save(storage, map)
}

/** { t, label: '02:14', pct: 0–100 }；没有可续的返回 null */
function resumeOf(storage, id) {
  const hit = id && load(storage)[id]
  if (!hit || !worthKeeping(hit.t, hit.d)) return null
  return { t: hit.t, label: fmtClock(hit.t), pct: hit.d > 0 ? Math.round((hit.t / hit.d) * 100) : 0 }
}

module.exports = { KEY, fmtClock, worthKeeping, record, clear, resumeOf }
