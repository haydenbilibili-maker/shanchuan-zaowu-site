/**
 * 数据报表 · 单日视图（昨日 / 选某一天）的纯函数。
 *
 * 口径：营业日 = 北京时间（UTC+8）自然日 00:00–24:00，与 getAnalyticsDashboard 的 toBizDate 同构。
 * 不能用 `new Date().getDate()` / `toISOString()`：前者跟随设备时区，后者是 UTC ——
 * 北京时间 00:00–08:00 之间 UTC 日期仍是「前一天」，会把昨日算成前天（日报曾踩过同类坑）。
 *
 * 单日取数只用云函数既有的 startDate + endDate（显式营业日闭区间），不新增入参。
 */
const TZ_SHANGHAI = 8 * 60 * 60 * 1000
const MS_DAY = 24 * 60 * 60 * 1000
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function pad2(n) {
  return String(n).padStart(2, '0')
}

function isDateKey(key) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(key || ''))
}

/** 任意时刻 → 北京时间营业日 YYYY-MM-DD */
function bizDateKey(ms) {
  const t = Number(ms)
  if (!Number.isFinite(t)) return ''
  const s = new Date(t + TZ_SHANGHAI)
  return `${s.getUTCFullYear()}-${pad2(s.getUTCMonth() + 1)}-${pad2(s.getUTCDate())}`
}

function keyToUtcNoon(key) {
  const [y, m, d] = String(key).split('-').map((x) => parseInt(x, 10))
  return Date.UTC(y, m - 1, d, 12, 0, 0, 0)
}

/** 营业日加减 N 天（按日历，不受设备时区影响） */
function addDays(key, delta) {
  if (!isDateKey(key)) return ''
  const s = new Date(keyToUtcNoon(key) + (Number(delta) || 0) * MS_DAY)
  return `${s.getUTCFullYear()}-${pad2(s.getUTCMonth() + 1)}-${pad2(s.getUTCDate())}`
}

function todayKey(nowMs) {
  return bizDateKey(nowMs == null ? Date.now() : nowMs)
}

function yesterdayKey(nowMs) {
  return addDays(todayKey(nowMs), -1)
}

/** 北京时间营业日的起止毫秒（闭区间，与云函数 bizDateStartMs / bizDateEndMs 同口径） */
function dayBounds(key) {
  if (!isDateKey(key)) return { startTs: 0, endTs: 0 }
  const [y, m, d] = key.split('-').map((x) => parseInt(x, 10))
  const startTs = Date.UTC(y, m - 1, d, 0, 0, 0, 0) - TZ_SHANGHAI
  return { startTs, endTs: startTs + MS_DAY - 1 }
}

function weekdayOf(key) {
  if (!isDateKey(key)) return ''
  return WEEKDAYS[new Date(keyToUtcNoon(key)).getUTCDay()]
}

/** 「9月27日 周日」；跨年时带年份（「2025年12月31日 周三」） */
function formatDayLabel(key, nowMs) {
  if (!isDateKey(key)) return ''
  const [y, m, d] = key.split('-').map((x) => parseInt(x, 10))
  const curYear = parseInt(todayKey(nowMs).slice(0, 4), 10)
  const head = y === curYear ? `${m}月${d}日` : `${y}年${m}月${d}日`
  return `${head} ${weekdayOf(key)}`
}

/** 单日 → 云函数入参（只用既有 startDate/endDate） */
function buildDayPayload(key) {
  return { action: 'report', startDate: key, endDate: key }
}

/** 对比窗口：上周同日 ～ 当日（8 个营业日），一次取回前一日与上周同日 */
function buildCompareWindow(key) {
  return { startDate: addDays(key, -7), endDate: key }
}

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * 与基准日比较。基准为 0 时不算百分比（避免「+∞%」这种假精确）。
 * tone：up | down | flat | none
 */
function compareTo(cur, base, hasBase) {
  if (!hasBase) return { text: '无数据', tone: 'none' }
  const c = num(cur)
  const b = num(base)
  if (c === b) return { text: '持平', tone: 'flat' }
  if (b === 0) return { text: '前值为 0', tone: c > 0 ? 'up' : 'down' }
  const pct = Math.round(((c - b) / Math.abs(b)) * 1000) / 10
  return { text: `${pct > 0 ? '↑' : '↓'} ${Math.abs(pct)}%`, tone: pct > 0 ? 'up' : 'down' }
}

const COMPARE_METRICS = [
  { key: 'grandDay', label: '综合营收', money: true, from: 'orders' },
  { key: 'netOnline', label: '线上净额', money: true, from: 'orders' },
  { key: 'offlineLedger', label: '门店账本', money: true, from: 'orders' },
  { key: 'paid', label: '已付单', money: false, from: 'orders' },
  { key: 'orders', label: '下单', money: false, from: 'orders' },
  { key: 'newUsers', label: '新增用户', money: false, from: 'users' },
  { key: 'dau', label: 'DAU', money: false, from: 'users' }
]

function indexBy(rows, valueKey) {
  const map = {}
  ;(rows || []).forEach((r) => {
    if (r && r.dateKey) map[r.dateKey] = r[valueKey]
  })
  return map
}

/**
 * 组装「较前一日 / 较上周同日」对比行。
 * ordersDaily 来自 action=orders 的 daily；newUsersByDay / dauByDay 来自 action=users。
 * 某一侧没取到（失败或窗口外）时对应列标「无数据」，不编 0。
 */
function buildDayCompare(key, pack, fmtMoney) {
  const p = pack || {}
  const prevKey = addDays(key, -1)
  const weekKey = addDays(key, -7)
  const ordersByDay = {}
  ;(p.ordersDaily || []).forEach((r) => {
    if (r && r.dateKey) ordersByDay[r.dateKey] = r
  })
  const newUsers = indexBy(p.newUsersByDay, 'count')
  const dau = indexBy(p.dauByDay, 'dau')
  const valueOf = (m, dk) => {
    if (m.from === 'orders') {
      const row = ordersByDay[dk]
      return row ? { has: true, v: num(row[m.key]) } : { has: false, v: 0 }
    }
    const src = m.key === 'newUsers' ? newUsers : dau
    return Object.prototype.hasOwnProperty.call(src, dk) ? { has: true, v: num(src[dk]) } : { has: false, v: 0 }
  }
  const fmt = (m, v) => (m.money ? `¥${typeof fmtMoney === 'function' ? fmtMoney(v) : v.toFixed(2)}` : String(v))
  const rows = COMPARE_METRICS.map((m) => {
    const cur = valueOf(m, key)
    const prev = valueOf(m, prevKey)
    const week = valueOf(m, weekKey)
    return {
      key: m.key,
      label: m.label,
      valueText: cur.has ? fmt(m, cur.v) : '—',
      prev: compareTo(cur.v, prev.v, cur.has && prev.has),
      week: compareTo(cur.v, week.v, cur.has && week.has)
    }
  })
  return {
    rows,
    prevLabel: formatDayLabel(prevKey),
    weekLabel: formatDayLabel(weekKey),
    hasAny: rows.some((r) => r.prev.tone !== 'none' || r.week.tone !== 'none')
  }
}

/** 对比窗口 8 天的综合营收走势，当日高亮 */
function buildWindowSeries(key, ordersDaily) {
  return (ordersDaily || [])
    .filter((r) => r && isDateKey(r.dateKey) && r.dateKey <= key && r.dateKey >= addDays(key, -7))
    .sort((a, b) => (a.dateKey < b.dateKey ? -1 : 1))
    .map((r) => {
      const online = Math.max(0, num(r.netOnline != null ? r.netOnline : r.gmvPaid))
      const offline = Math.max(0, num(r.offlineLedger))
      return {
        dateKey: r.dateKey,
        day: r.dateKey === key ? '当日' : weekdayOf(r.dateKey),
        online,
        offline,
        total: online + offline,
        isFocus: r.dateKey === key
      }
    })
}

module.exports = {
  TZ_SHANGHAI,
  bizDateKey,
  addDays,
  todayKey,
  yesterdayKey,
  dayBounds,
  weekdayOf,
  formatDayLabel,
  buildDayPayload,
  buildCompareWindow,
  compareTo,
  buildDayCompare,
  buildWindowSeries,
  COMPARE_METRICS
}
