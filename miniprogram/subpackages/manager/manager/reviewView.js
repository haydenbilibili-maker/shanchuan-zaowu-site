/**
 * 评价审核页（工作台 Tab 17）展示口径，纯函数（check:reviews-tab 在 Node 里直接跑）。
 * 2026-11-26：看板四格即筛选 + 待回复；默认落在有活干的一队；卡片主动作随状态。说明见 miniprogram/docs/超管工作台_功能归并_2026-11-25.md §S7。
 */

const FILTERS = ['pending', 'unreplied', 'approved', 'hidden', 'all']

const STATUS_LABEL = { pending: '待审核', approved: '已通过', hidden: '已隐藏', rejected: '已拒绝' }

/** 商家回复常用说法（点一下填入，可再改） */
const REPLY_PHRASES = [
  '谢谢喜欢，收到您的晒图很开心！',
  '感谢认可，标本师看到会很高兴。',
  '记得避开阳光直射，干燥通风保存更久。',
  '有任何问题随时在「山海有信」找我们。'
]

const pad = (n) => String(n).padStart(2, '0')

/** 北京时间 MM-DD HH:mm（toLocaleString 在真机上格式不统一） */
function timeText(ms) {
  const t = Number(ms) || 0
  if (!t) return ''
  const d = new Date(t + 8 * 3600 * 1000)
  return `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

function stars(rating) {
  const r = Math.max(0, Math.min(5, Math.round(Number(rating) || 0)))
  return '★★★★★'.slice(0, r) + '☆☆☆☆☆'.slice(0, 5 - r)
}

/** 评价是哪件东西：商品名优先；没有商品名时只说类型，不把原始 id 摆给人看 */
function targetText(c) {
  if (c && c.productTitle) return String(c.productTitle)
  const lbl = String((c && c.targetLabel) || '')
  if (lbl && !/·/.test(lbl)) return lbl
  return c && c.targetType === 'article' ? '文章评论' : '商品评价'
}

function primaryAction(c) {
  const st = (c && c.status) || 'pending'
  if (st === 'pending') return { action: 'approve', label: '通过' }
  if (st === 'hidden') return { action: 'approve', label: '恢复' }
  if (!String((c && c.merchantReply) || '').trim()) return { action: 'reply', label: '回复' }
  return { action: 'reply', label: '改回复' }
}

function decorateComment(c) {
  const status = (c && c.status) || 'pending'
  const imgs = Array.isArray(c && c.images) ? c.images.filter(Boolean) : []
  const order = String((c && c.orderId) || '')
  return {
    ...c,
    status,
    statusLabel: STATUS_LABEL[status] || '待审核',
    stars: stars(c && c.rating),
    timeText: timeText(c && (c.createTime || c.createdAt)),
    targetText: targetText(c),
    imageCount: imgs.length,
    orderShort: order.length > 12 ? `…${order.slice(-10)}` : order,
    replied: !!String((c && c.merchantReply) || '').trim(),
    primary: primaryAction(c)
  }
}

/** 列表按筛选兜底过滤（云端没部署「待回复」筛选前，拉已通过再在本地筛） */
function filterRows(rows, filter) {
  const list = Array.isArray(rows) ? rows : []
  if (filter === 'unreplied') return list.filter((c) => (c.status || 'pending') === 'approved' && !String(c.merchantReply || '').trim())
  return list
}

/** 列表请求参数：待回复先按「已通过」拉宽一点，再本地筛 */
function listQuery(filter) {
  const f = FILTERS.indexOf(filter) === -1 ? 'all' : filter
  return f === 'unreplied' ? { listFilter: 'unreplied', limit: 200 } : { listFilter: f, limit: 50 }
}

/** 看板：柱高、近 7 天合计、待回复数（云端没给时为 null，不编数） */
function statsView(out) {
  const days = (out && Array.isArray(out.days) ? out.days : []).map((d) => ({ ...d, count: Number(d.count) || 0 }))
  const max = days.reduce((n, d) => Math.max(n, d.count), 0)
  const weekTotal = days.reduce((n, d) => n + d.count, 0)
  const unreplied = out && Number.isFinite(Number(out.unreplied)) && out.unreplied !== undefined ? Number(out.unreplied) : null
  return {
    ...out,
    weekTotal,
    unreplied,
    unrepliedText: unreplied === null ? '–' : String(unreplied),
    days: days.map((d) => ({ ...d, h: max ? Math.max(d.count ? 8 : 0, Math.round((d.count / max) * 100)) : 0 }))
  }
}

/** 进页默认筛选：只在用户还没手动选过、且当前停在「待审核」时改一次 */
function pickDefaultFilter(stats, current) {
  if (current !== 'pending' || !stats || !stats.counts) return current
  if (Number(stats.counts.pending) > 0) return 'pending'
  if (Number(stats.unreplied) > 0) return 'unreplied'
  return 'all'
}

/** 各筛选的空态：说清楚「这一队没有活了」并给下一步 */
function emptyCopy(filter, stats) {
  const s = stats || {}
  const c = s.counts || {}
  const next = []
  if (filter !== 'unreplied' && Number(s.unreplied) > 0) next.push({ filter: 'unreplied', label: `去回复 ${s.unreplied} 条` })
  if (filter !== 'pending' && Number(c.pending) > 0) next.push({ filter: 'pending', label: `去审核 ${c.pending} 条` })
  if (filter !== 'all' && Number(c.all) > 0) next.push({ filter: 'all', label: '看全部评价' })
  const map = {
    pending: ['待审核已清空', '新评价进来会先出现在这里'],
    unreplied: ['评价都回复过了', '顾客收到回复会在「山海有信」里看到'],
    approved: ['还没有已通过的评价', '审核通过的评价会展示在商品详情页'],
    hidden: ['没有隐藏的评价', '隐藏的评价不在商品页展示'],
    all: ['还没有评价', '顾客签收后晒单会出现在这里']
  }
  const [title, sub] = map[filter] || map.all
  return { title, sub, next: next.slice(0, 2) }
}

module.exports = {
  FILTERS,
  REPLY_PHRASES,
  timeText,
  stars,
  targetText,
  primaryAction,
  decorateComment,
  filterRows,
  listQuery,
  statsView,
  pickDefaultFilter,
  emptyCopy
}
