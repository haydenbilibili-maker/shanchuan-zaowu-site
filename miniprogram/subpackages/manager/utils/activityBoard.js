/**
 * 超管工作台「活动课程」看板纯函数（无 wx/db 依赖）。说明：miniprogram/docs/超管工作台_活动课程_升级_2026-09-28.md
 * 契约不变：status 只用 open/closed/full；storeId 是 C 端预约页/门店页早已在读的字段。
 * 「今天」按北京时间：设备时区或 UTC 会在凌晨把今天算成昨天。
 */
const { DEFAULT_STORES } = require('../../../utils/storeDefaults')

const TZ = 8 * 3600 * 1000
const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const FILTERS = [['live', '报名中'], ['paused', '已截止'], ['ended', '已结束'], ['all', '全部']]
const STORES = DEFAULT_STORES.map((s) => ({ storeId: s.storeId, name: s.name, location: s.role === 'main' ? '本店' : s.name }))
const BOOKED_STATUSES = ['confirmed', 'pending', 'used']
const pad = (n) => String(n).padStart(2, '0')

function todayKey(now) {
  const d = new Date(Number(now) + TZ)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}
function normDate(raw) {
  const m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(String(raw || '').trim())
  return m ? `${m[1]}-${pad(m[2])}-${pad(m[3])}` : ''
}
const dayDiff = (a, b) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 864e5)
const weekOf = (key) => (key ? WEEK[new Date(`${key}T00:00:00Z`).getUTCDay()] : '')

/** 日期过了就是已结束，不看 status（历史数据里过期仍 open 很常见） */
function phaseOf(item, today) {
  const date = normDate(item && item.date)
  if (date && date < today) return 'ended'
  return item && item.status === 'open' ? 'live' : 'paused'
}
function parseTime(raw) {
  const m = String(raw || '').match(/\d{1,2}:\d{2}/g) || []
  return { start: (m[0] || '').padStart(m[0] ? 5 : 0, '0'), end: (m[1] || '').padStart(m[1] ? 5 : 0, '0') }
}

/** 一条活动 → 卡片；stat = { booked, verified } 来自 bookings 计数，缺省 = 未知（显示「—」） */
function decorate(item, today, stat) {
  const date = normDate(item.date)
  const phase = phaseOf(item, today)
  const max = Math.max(0, parseInt(item.maxPeople, 10) || 0)
  const known = !!stat && Number.isFinite(stat.booked)
  const booked = known ? stat.booked : 0
  const price = Number(item.price) || 0
  const diff = date ? dayDiff(date, today) : null
  const store = STORES.find((s) => s.storeId === item.storeId)
  const stillVisible = phase === 'ended' && item.status === 'open'
  let toggle = null
  if (phase === 'live') toggle = { to: 'closed', label: '截止报名' }
  else if (phase === 'paused') toggle = { to: 'open', label: '重新开放' }
  else if (stillVisible) toggle = { to: 'closed', label: '下架' }
  const typeLabel = { course: '手作课程', handcraft_course: '手作课程', special_activity: '特别活动' }[item.type] || '未分类'
  return {
    _id: item._id,
    title: item.title || '未命名活动',
    cover: item.image || '',
    typeLabel,
    monthDay: date ? date.slice(5).replace('-', '/') : '--/--',
    week: weekOf(date),
    year: date && date.slice(0, 4) !== today.slice(0, 4) ? date.slice(0, 4) : '',
    when: diff === null ? '未定日期' : diff === 0 ? '今天' : diff === 1 ? '明天' : diff > 0 ? `${diff} 天后` : `已过 ${-diff} 天`,
    isToday: diff === 0,
    time: item.time || '',
    place: [store && store.name, item.location].filter(Boolean).join(' · ') || '未填地点',
    priceText: price > 0 ? `¥${price % 1 ? price.toFixed(2) : price}` : '免费',
    phase,
    statusLabel: phase === 'ended' ? '已结束' : phase === 'live' ? '报名中' : item.status === 'full' ? '已满员' : '已截止',
    stillVisible,
    noStore: !item.storeId && phase !== 'ended',
    toggle,
    statKnown: known,
    booked,
    verified: known ? stat.verified || 0 : 0,
    capText: max ? `${booked}/${max}` : `${booked}`,
    remainText: !known ? '—' : max ? (max > booked ? String(max - booked) : '已满') : '不限',
    fillPct: known && max ? Math.min(100, Math.round((booked / max) * 100)) : 0
  }
}

/** 看板：分组计数 + 当前组卡片（未结束按日期近→远，已结束远→近倒序且排最后） */
function buildBoard(list, { now = Date.now(), stats = {}, filter = 'live' } = {}) {
  const today = todayKey(now)
  const rows = (Array.isArray(list) ? list : []).filter((x) => x && x._id)
  const counts = { live: 0, paused: 0, ended: 0, all: rows.length }
  let stale = 0
  let upcomingBooked = 0
  rows.forEach((r) => {
    const p = phaseOf(r, today)
    counts[p] += 1
    if (p === 'ended' && r.status === 'open') stale += 1
    if (p !== 'ended' && stats[r._id] && Number.isFinite(stats[r._id].booked)) upcomingBooked += stats[r._id].booked
  })
  const key = FILTERS.some((f) => f[0] === filter) ? filter : 'live'
  const items = rows
    .filter((r) => key === 'all' || phaseOf(r, today) === key)
    .sort((a, b) => {
      const ea = phaseOf(a, today) === 'ended'
      if (ea !== (phaseOf(b, today) === 'ended')) return ea ? 1 : -1
      const c = (normDate(a.date) || '0').localeCompare(normDate(b.date) || '0')
      return ea ? -c : c
    })
    .map((r) => decorate(r, today, stats[r._id]))
  return { today, filter: key, filters: FILTERS.map(([k, label]) => ({ key: k, label, count: counts[k] })), counts, stale, upcomingBooked, items }
}

/** 要去 bookings 计数的：未结束 + 结束 30 天内，最多 20 条 */
function statTargets(list, now = Date.now()) {
  const today = todayKey(now)
  return (Array.isArray(list) ? list : []).filter((r) => r && r._id && r.title && normDate(r.date) && dayDiff(normDate(r.date), today) >= -30).slice(0, 20)
}

/** 预约归属：新预约带 activityId；历史预约没有 activityId，回退「标题 + 日期」（读时兼容，不迁移） */
const bookingMatch = (cmd, a) => cmd.or([{ activityId: a._id }, { activityId: cmd.exists(false), title: a.title, date: a.date }])

function dateText(key) {
  const k = normDate(key)
  return k ? `${Number(k.slice(5, 7))}月${Number(k.slice(8))}日 ${weekOf(k)}` : ''
}

/** 编辑表单：新建 / 编辑 / 再办一场（清空日期，其余照搬） */
function formFromItem(item, { copy = false } = {}) {
  const src = item || {}
  const t = parseTime(src.time)
  const idx = STORES.findIndex((s) => s.storeId === src.storeId)
  const date = copy ? '' : normDate(src.date)
  const str = (v) => (v != null && v !== '' ? String(v) : '')
  return {
    title: src.title || '',
    type: src.type === 'special_activity' ? 'special_activity' : 'course',
    date,
    dateText: dateText(date),
    timeStart: t.start,
    timeEnd: t.end,
    price: str(src.price),
    maxPeople: str(src.maxPeople),
    location: src.location || (item ? '' : STORES[0].location),
    storeIndex: idx >= 0 ? idx : 0,
    image: src.image || ''
  }
}

/**
 * 表单 → 写库 data。新建：status=open、remain=名额（与 ERP 同口径）。
 * 编辑不回写 status（旧版每次保存都把已截止/满员改回 open）；名额变了才按差值平移 remain。
 */
function buildPayload(form, { original = null, today = '' } = {}) {
  const f = form || {}
  const title = String(f.title || '').trim()
  if (!title) return { ok: false, field: 'title', msg: '请填写活动标题' }
  if (title.length > 30) return { ok: false, field: 'title', msg: '标题最多 30 个字' }
  const date = normDate(f.date)
  if (!date) return { ok: false, field: 'date', msg: '请选择活动日期' }
  if (!original && today && date < today) return { ok: false, field: 'date', msg: '新活动的日期不能早于今天' }
  const price = String(f.price || '').trim() === '' ? 0 : Number(f.price)
  if (!Number.isFinite(price) || price < 0) return { ok: false, field: 'price', msg: '价格填数字，免费填 0' }
  const maxPeople = String(f.maxPeople || '').trim() === '' ? 0 : Number(f.maxPeople)
  if (!Number.isInteger(maxPeople) || maxPeople < 0) return { ok: false, field: 'maxPeople', msg: '名额填整数，不限填 0' }
  const store = STORES[Number(f.storeIndex)] || STORES[0]
  const data = {
    title,
    type: f.type === 'special_activity' ? 'special_activity' : 'course',
    date,
    time: f.timeStart ? (f.timeEnd > f.timeStart ? `${f.timeStart} - ${f.timeEnd}` : f.timeStart) : '',
    price: Math.round(price * 100) / 100,
    maxPeople,
    location: String(f.location || '').trim() || store.location,
    storeId: store.storeId
  }
  if (!original) {
    data.status = 'open'
    data.remain = maxPeople
  } else {
    const oldMax = parseInt(original.maxPeople, 10) || 0
    const oldRemain = Number.isFinite(Number(original.remain)) ? Number(original.remain) : oldMax
    if (maxPeople !== oldMax) data.remain = Math.max(0, oldRemain + maxPeople - oldMax)
  }
  return { ok: true, data }
}

module.exports = { STORES, BOOKED_STATUSES, todayKey, phaseOf, decorate, buildBoard, statTargets, bookingMatch, dateText, formFromItem, buildPayload }
