/**
 * 直播防刷与场次粗统计
 */
const MSG_RATE_MS = 5000
const MSG_USER_MAX_PER_SESSION = 40
const HB_MIN_MS = 12000
/** presence 心跳过期窗口（与 docs/live-streaming.md「TTL ~45s」一致） */
const PRESENCE_TTL_MS = 45 * 1000
const LIKE_ONCE = true
const AUDIT_MAX = 40
/** 单场公告字数上限（与 docs/live-streaming.md、C 端 maxlength=80 一致） */
const NOTICE_MAX = 80
/** 封面 cloud:// 或 https 地址最大存储长度 */
const COVER_MAX = 512

function buildStats(doc) {
  const d = doc || {}
  return {
    likeCount: Math.max(0, Number(d.likeCount) || 0),
    messageCount: Math.max(0, Number(d.statsMessageCount) || 0),
    joinCount: Math.max(0, Number(d.statsJoinCount) || 0),
    peakViewers: Math.max(0, Number(d.statsPeakViewers) || 0),
    reminderCount: Math.max(0, Number(d.statsReminderCount) || 0)
  }
}

function shelfAuditEntry(actor, action, extra) {
  const a = actor || {}
  return {
    at: Date.now(),
    actorKey: String(a.key || '').slice(0, 16),
    actorName: String(a.name || '').slice(0, 24),
    action: String(action || '').slice(0, 24),
    productIds: Array.isArray(extra && extra.productIds)
      ? extra.productIds.slice(0, 20).map((id) => String(id))
      : [],
    spotlightProductId: String((extra && extra.spotlightProductId) || '').slice(0, 64)
  }
}

module.exports = {
  MSG_RATE_MS,
  MSG_USER_MAX_PER_SESSION,
  HB_MIN_MS,
  PRESENCE_TTL_MS,
  LIKE_ONCE,
  AUDIT_MAX,
  NOTICE_MAX,
  COVER_MAX,
  buildStats,
  shelfAuditEntry
}
