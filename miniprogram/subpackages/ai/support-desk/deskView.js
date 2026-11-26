/**
 * 客服工作台展示口径（2026-11-27 交互视觉对齐与升级）—— 纯函数，不依赖 wx。
 * - 时间一律按北京时间（原来把云端 UTC ISO 串直接截取，显示早 8 小时）；
 * - 待回复按「等得最久的在最上面」排（客服先处理老的），其余档按最新在前；
 * - 待回复超过 12 小时标「已等 N 小时」（与云端 remindOverdue 同一阈值）；
 * - 详情把顾客原留言与历次回复排成一条对话（左顾客、右专员）。
 */
const OVERDUE_HOURS = 12
const pad = (n) => String(n).padStart(2, '0')

function toMs(v) {
  if (!v) return 0
  if (typeof v === 'number') return v
  if (v instanceof Date) return v.getTime()
  if (typeof v === 'object' && v.$date) return Date.parse(v.$date) || 0
  const t = Date.parse(v)
  return Number.isFinite(t) ? t : 0
}

/** 北京时间 MM-DD HH:mm */
function bjText(ms) {
  const t = toMs(ms)
  if (!t) return ''
  const d = new Date(t + 8 * 3600 * 1000)
  return `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

/** 相对时间：刚刚 / N 分钟前 / N 小时前 / N 天前 / 超过 7 天给日期 */
function agoText(ms, nowMs) {
  const t = toMs(ms)
  if (!t) return ''
  const diff = Math.max(0, (Number(nowMs) || Date.now()) - t)
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} 小时前`
  const d = Math.floor(h / 24)
  if (d <= 7) return `${d} 天前`
  return bjText(t).slice(0, 5)
}

const STATUS = {
  pending: { text: '待回复', tone: 'wait' },
  replied: { text: '已回复', tone: 'done' },
  resolved: { text: '已解决', tone: 'ok' },
  archived: { text: '已归档', tone: 'done' }
}

function decorateTicket(t, nowMs) {
  const created = toMs(t && (t.createTime || t._createTime))
  const status = (t && t.status) || 'pending'
  const waitedH = status === 'pending' && created ? Math.floor(((Number(nowMs) || Date.now()) - created) / 3600000) : 0
  const replies = Array.isArray(t && t.replies) ? t.replies : []
  return {
    id: t._id,
    topicLabel: t.topicLabel || '留言',
    message: String(t.message || '').replace(/\s+/g, ' ').slice(0, 80),
    orderNo: t.orderNo || '',
    status,
    statusText: (STATUS[status] || STATUS.pending).text,
    tone: (STATUS[status] || STATUS.pending).tone,
    whoKey: t._openid || '',
    customer: t.memberNickName || t.memberNo || '',
    replyCount: replies.length || (t.replyContent ? 1 : 0),
    created,
    time: bjText(created),
    ago: agoText(created, nowMs),
    overdue: waitedH >= OVERDUE_HOURS,
    waitedText: waitedH >= OVERDUE_HOURS ? (waitedH >= 48 ? `已等 ${Math.floor(waitedH / 24)} 天` : `已等 ${waitedH} 小时`) : '',
    hasImages: Array.isArray(t.images) && t.images.length > 0
  }
}

/** 待回复：等得最久的在前；其余：最新在前 */
function sortRows(rows, tab) {
  const list = (rows || []).slice()
  list.sort((a, b) => (tab === 'pending' ? a.created - b.created : b.created - a.created))
  return list
}

/** 同一顾客在已加载列表里第几次来问（按 openid 计数） */
function markRepeat(rows) {
  const counts = {}
  rows.forEach((r) => { if (r.whoKey) counts[r.whoKey] = (counts[r.whoKey] || 0) + 1 })
  rows.forEach((r) => { r.customerCount = r.whoKey ? counts[r.whoKey] : 0 })
  return rows
}

function filterRows(rows, query) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return rows || []
  return (rows || []).filter((r) => `${r.topicLabel} ${r.message} ${r.orderNo} ${r.customer}`.toLowerCase().indexOf(q) !== -1)
}

/** 详情对话：顾客原留言 + 历次回复（按时间） */
function buildThread(t) {
  const out = []
  const created = toMs(t && (t.createTime || t._createTime))
  out.push({ key: 'c0', side: 'customer', text: String((t && t.message) || '').trim() || '（顾客没有写正文）', time: bjText(created), images: (t && t.images) || [] })
  const replies = Array.isArray(t && t.replies) ? t.replies : (t && t.replyContent ? [{ content: t.replyContent, at: t.replyTime }] : [])
  replies.forEach((r, i) => out.push({ key: `r${i}`, side: 'staff', text: String(r.content || ''), time: bjText(r.at), images: [] }))
  return out
}

function notesView(notes) {
  return (Array.isArray(notes) ? notes : []).map((n, i) => ({ key: `n${i}`, text: String(n.text || ''), time: bjText(n.at) }))
}

module.exports = { OVERDUE_HOURS, toMs, bjText, agoText, decorateTicket, sortRows, markRepeat, filterRows, buildThread, notesView }
