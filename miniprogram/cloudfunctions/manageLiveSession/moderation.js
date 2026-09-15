/**
 * 留言粗滤：限长 + 常见引流/违禁词（非完整审核）
 */
const MSG_MAX = 40
const MSG_LIST_LIMIT = 36
const { MSG_RATE_MS } = require('./abuse')

const BLOCK_PATTERNS = [
  /加\s*微/,
  /微\s*信\s*号?/,
  /\bv\s*x\b/i,
  /\bwechat\b/i,
  /qq\s*[:：]/i,
  /群\s*号/,
  /色情|裸聊|约炮|赌博|博彩|代孕|代开.*发票|办证/,
  /习近平|法轮功/,
  /http[s]?:\/\//i,
  /www\./i
]

function normalizeMessage(raw) {
  return String(raw == null ? '' : raw)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MSG_MAX)
}

function isBlockedText(text) {
  const t = String(text || '')
  if (!t) return true
  return BLOCK_PATTERNS.some((re) => re.test(t))
}

function presenceKey(openid) {
  const id = String(openid || '')
  if (!id) return 'anon'
  return id.length <= 12 ? id : id.slice(-12)
}

function maskAuthor(openid) {
  const key = presenceKey(openid)
  if (key === 'anon') return '访客'
  return `访客 · ${key.slice(-4)}`
}

module.exports = {
  MSG_MAX,
  MSG_RATE_MS,
  MSG_LIST_LIMIT,
  normalizeMessage,
  isBlockedText,
  presenceKey,
  maskAuthor
}
