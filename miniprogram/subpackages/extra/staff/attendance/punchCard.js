/**
 * 考勤「打孔卡」（2026-10-18 仪式感创新）：把今天 + 最近记录排成本周一张打孔卡。
 * 纯前端派生：只读 attendanceToday / attendanceList 已返回的 clockAt / type / status，不改云函数。
 * 每天两孔：上孔 = 上班、下孔 = 下班；'ok' 准时、'warn' 迟到 / 早退、'' 未打。
 */

const DOW = ['一', '二', '三', '四', '五', '六', '日']

function toDate(value) {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

function dayKey(d) {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

/** 周一起算的本周 7 格；同一孔多条记录时，准时优先（补打的那次不该把整天染成异常） */
function buildWeek(records, now) {
  const today = toDate(now) || new Date()
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7))
  const todayKey = dayKey(today)
  const cells = DOW.map((dow, i) => {
    const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i)
    const key = dayKey(d)
    return { key, dow, day: d.getDate(), isToday: key === todayKey, isFuture: d > today && key !== todayKey, in: '', out: '' }
  })
  const byKey = {}
  cells.forEach((c) => { byKey[c.key] = c })
  ;(Array.isArray(records) ? records : []).forEach((row) => {
    const d = toDate(row && row.clockAt)
    const cell = d && byKey[dayKey(d)]
    if (!cell) return
    const slot = row.type === 'out' ? 'out' : 'in'
    const tone = row.status === 'late' || row.status === 'early' ? 'warn' : 'ok'
    if (cell[slot] !== 'ok') cell[slot] = tone
  })
  return cells
}

/** 「本周出勤 3 天 · 迟到早退 1 次」；一孔都没有时返回空串 */
function weekSummary(cells) {
  const list = Array.isArray(cells) ? cells : []
  const days = list.filter((c) => c.in || c.out).length
  const warns = list.reduce((n, c) => n + (c.in === 'warn' ? 1 : 0) + (c.out === 'warn' ? 1 : 0), 0)
  if (!days) return ''
  return warns ? `本周出勤 ${days} 天 · 迟到早退 ${warns} 次` : `本周出勤 ${days} 天 · 全勤准时`
}

/** today 与 recent 有重叠：按 _id 去重合并 */
function mergeRecords(today, recent) {
  const seen = {}
  const out = []
  ;[].concat(today || [], recent || []).forEach((row) => {
    const id = row && (row._id || `${row.type}-${row.clockAt}`)
    if (!row || seen[id]) return
    seen[id] = true
    out.push(row)
  })
  return out
}

module.exports = { buildWeek, weekSummary, mergeRecords, DOW }
