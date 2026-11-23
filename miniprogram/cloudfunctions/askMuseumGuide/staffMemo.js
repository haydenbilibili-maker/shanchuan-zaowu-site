/**
 * AI 智能中心 · 团队备忘（2026-11-23 第八轮）
 *
 * 库里查不到、但同事们给建议时必须知道的事：近期安排与已经拍板的决定（「周六下午有标本体验课」「双十二不打折，送礼券」）。
 * 只有超管能写（museum_guide_config/staff_memo），所有同事的上下文都带上；到期的自动不带。
 *
 * 口径：最多 MEMO_MAX 条、每条 ≤ MEMO_LEN 字；可选到期日（YYYY-MM-DD，北京时间，含当天）；
 * 超管写入时过内容安全（index.js），这里只做纯归一与拼块，不碰 wx / db。
 */
const MEMO_MAX = 6
const MEMO_LEN = 60
const MEMO_DOC = 'staff_memo'

function bjToday(now) {
  return new Date((Number(now) || Date.now()) + 8 * 3600000).toISOString().slice(0, 10)
}

function cleanText(v) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
}

/** 一条备忘：文字必填、≤ MEMO_LEN（超了拒，不偷偷截）；到期日只认合法 YYYY-MM-DD */
function cleanItem(raw) {
  const text = cleanText(raw && raw.text)
  if (!text) return { skip: true }
  if (text.length > MEMO_LEN) return { error: `每条备忘不超过 ${MEMO_LEN} 字` }
  const u = String((raw && raw.until) || '').trim()
  const until = /^\d{4}-\d{2}-\d{2}$/.test(u) && !Number.isNaN(Date.parse(u)) ? u : ''
  return { item: { id: String((raw && raw.id) || '').slice(0, 24) || `m${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`, text, until, at: Number(raw && raw.at) || Date.now() } }
}

/** 超管写入：逐条清洗、空的丢掉、超条数 / 超字数拒绝 */
function normalizeMemoInput(list) {
  if (!Array.isArray(list)) return { error: '备忘格式不对' }
  const items = []
  for (const raw of list) {
    const r = cleanItem(raw)
    if (r.error) return { error: r.error }
    if (!r.skip) items.push(r.item)
  }
  if (items.length > MEMO_MAX) return { error: `团队备忘最多 ${MEMO_MAX} 条` }
  return { items }
}

/** 读出来给模型 / 页面：脏数据丢掉、到期的不带（到期日当天仍有效） */
function activeMemo(list, now) {
  const today = bjToday(now)
  return (Array.isArray(list) ? list : [])
    .map((raw) => cleanItem(raw))
    .filter((r) => r.item && r.item.text.length <= MEMO_LEN)
    .map((r) => r.item)
    .filter((m) => !m.until || m.until >= today)
    .slice(0, MEMO_MAX)
}

/** 拼进 system 的一段（超管写的，可信）；没有就空串 */
function memoBlock(items) {
  const list = Array.isArray(items) ? items : []
  if (!list.length) return ''
  return `【团队备忘（超管写的近期安排与已定的事，给建议时按这些来，不要提出与之冲突的方案；如有不同看法可以说明理由）】\n` +
    list.map((m) => `- ${m.text}${m.until ? `（到 ${m.until}）` : ''}`).join('\n')
}

module.exports = { MEMO_MAX, MEMO_LEN, MEMO_DOC, bjToday, normalizeMemoInput, activeMemo, memoBlock }
