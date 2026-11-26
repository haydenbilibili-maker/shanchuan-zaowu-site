/**
 * 评价审核页（工作台 Tab 17）展示口径，纯函数（check:reviews-tab 在 Node 里直接跑）。
 * 2026-11-26：看板四格即筛选 + 待回复；默认落在有活干的一队；卡片主动作随状态。说明见 miniprogram/docs/超管工作台_功能归并_2026-11-25.md §S7。
 */

const FILTERS = ['pending', 'unreplied', 'approved', 'hidden', 'all']

const STATUS_LABEL = { pending: '待审核', approved: '已通过', hidden: '已隐藏', rejected: '已拒绝' }

/**
 * 商家回复参考文案（2026-11-26 产品负责人：要更多、更丰富、更有人情味）。
 * 按评价情境分组：好评 / 中评 / 差评售后 / 养护答疑 / 定制伴宠 / 老客会员。
 * 原则：先接住情绪，再给一句具体的（标本 / 标本师 / 养护 / 山海有信），不写"感谢您的评价"这类空话。
 */
const REPLY_PHRASE_GROUPS = [
  {
    id: 'praise', label: '好评', hint: '有晒图 / 夸手艺时用',
    phrases: [
      '谢谢您喜欢，标本师看到这条评价会很开心。',
      '收到晒图啦，标本在您家里很好看，谢谢您特意拍给我们。',
      '感谢信任，这只小生命在我们手里被好好安顿，现在交到您手上了。',
      '每一件都是手工做的，难免有点小差别，您喜欢就好。',
      '喜欢的话常来馆里坐坐，新到的标本先给您留着看。'
    ]
  },
  {
    id: 'neutral', label: '中评', hint: '还行但有遗憾时用',
    phrases: [
      '谢谢您的反馈，您说的这一点我们记下了，会认真改。',
      '可能照片和实物有点色差，标本是天然的，颜色会有细微不同；不满意随时找我们。',
      '尺寸和想象有出入的话，把照片发我们，看看能不能换一件更合适的。',
      '您的建议对我们是提醒，下次会做得更细，谢谢您还愿意告诉我们。'
    ]
  },
  {
    id: 'negative', label: '差评售后', hint: '不满意 / 破损 / 退款时用',
    phrases: [
      '很抱歉没让您满意，这是我们的问题，请把情况发我们，一定处理好。',
      '已经给您留言啦，破损、发霉、异味都请拍给我们，我们负责到底。',
      '这件让您失望了，先给您退换，别让一件标本坏了对我们的印象。',
      '谢谢您直接说出来，比默默离开更让我们有机会改好。'
    ]
  },
  {
    id: 'care', label: '养护答疑', hint: '问怎么保存 / 落灰时用',
    phrases: [
      '记得避开阳光直射，干燥通风处保存更久；木框别用湿布擦。',
      '标本怕潮，梅雨季可以放一小包干燥剂在旁边。',
      '落了灰用软毛刷轻轻扫，别用手直接摸翅膀和花瓣。',
      '有任何养护问题随时在「山海有信」找我们，看到就回。'
    ]
  },
  {
    id: 'custom', label: '定制伴宠', hint: '定制 / 伴宠记忆时用',
    phrases: [
      '谢谢您把这么重要的家人交给我们，标本师做的时候也很郑重。',
      '定制周期长是我们想做得更好，任何进度问题直接在「山海有信」问，会及时回您。',
      '照片和毛发都替您保存好了，取件时再跟您一起确认细节。',
      '做好了会先拍给您看，确认满意再寄出。'
    ]
  },
  {
    id: 'regular', label: '老客会员', hint: '回头客 / 会员时用',
    phrases: [
      '又见到您啦，谢谢一直照顾我们的馆，欢迎下次再来。',
      '会员的心意我们记得，新到的藏品会先给您留着。',
      '谢谢您把朋友也带来，馆里的茶一直热着。',
      '老客的心意我们记着，下次来提前说一声，给您留个清净位。'
    ]
  }
]

/** 打平时用哪一组：按星级默认选中，专员仍可随手切换 */
function replyGroupForRating(rating) {
  const r = Number(rating) || 0
  if (r >= 4) return 'praise'
  if (r === 3) return 'neutral'
  if (r > 0) return 'negative'
  return 'praise'
}

const REPLY_PHRASES = [].concat(...REPLY_PHRASE_GROUPS.map((g) => g.phrases))

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
  REPLY_PHRASE_GROUPS,
  replyGroupForRating,
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
