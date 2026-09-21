/**
 * 每日日报 · 落库层
 *
 * 为什么直写 user_messages 而不是走 dispatchMessage：
 *   1. dispatchMessage 的模板/override 路径只认 title/content/actionUrl 三件套，
 *      日报还要带**结构化 payload**（每个数字的口径与来源），模板管线没有它的位置；
 *   2. dispatchMessage 的 `checkDedupe` 是 24h 窗口（core.js:39-55），
 *      日报要的是「同一天同一人永不重复」，需要自己的确定性 dedupeKey；
 *   3. 直写是仓库既有形态（sweepExpiredOrders/inAppMessage.js:75-139、managerShipOrder/messageWrite.js）。
 *   代价：字段形状必须与读侧 getUserMessages 对齐 —— 见下方 doc 里的逐字段注释。
 *
 * 集合权限（实测 cloudbase/rules/*.json）：user_messages 是 `{read:false,write:false}`，
 * notification_logs 是 `{read:"auth != null",write:false}` —— 只有云函数（管理员 SDK）能写，
 * 所以本层只在云函数里跑，不会被客户端调用。
 */
const { MESSAGE_TYPE, MESSAGE_CATEGORY, MESSAGE_QUEUE, RETENTION_DAYS } = require('./reportCatalog')
const { digestDedupeKey } = require('./dailyDigestCore')

/** 超管日报详情页动作：打开门店工作台的「数据报表」 */
const ACTION_URL = 'subpackages/manager/manager/index?tab=13&title=%E6%95%B0%E6%8D%AE%E6%8A%A5%E8%A1%A8'

/**
 * 幂等检查：同一 (type, dayKey, role, openid) 是否已经写过。
 * 不依赖读侧的 24h 窗口 —— 日报的幂等键是**确定性的日期**。
 */
async function findExisting (db, dayKey, role, openid) {
  const dedupeKey = digestDedupeKey(dayKey, role, openid)
  try {
    const res = await db.collection('user_messages')
      .where({ dedupeKey })
      .limit(1)
      .get()
    return { dedupeKey, existing: (res.data && res.data[0]) || null }
  } catch (e) {
    console.warn('dailyDigest findExisting failed:', e && e.message)
    return { dedupeKey, existing: null, error: (e && e.message) || 'query failed' }
  }
}

/**
 * 写一条日报。返回 { success, skipped?, messageId? }。
 * `payload` 会原样落进 user_messages 的 `payload` 字段；读侧 getUserMessages 已放行该字段
 * （见 getUserMessages/index.js normalizeMessage 的 payload 透传）。
 */
async function writeDigestMessage (db, { openid, dayKey, role, title, content, payload, dedupeKey }) {
  if (!openid) return { success: false, msg: '缺少 openid' }
  if (!title) return { success: false, msg: '缺少 title' }

  const key = dedupeKey || digestDedupeKey(dayKey, role, openid)
  const existing = await findExisting(db, dayKey, role, openid)
  if (existing.existing) {
    return { success: true, skipped: true, reason: 'dedupe', messageId: existing.existing._id }
  }

  const doc = {
    _openid: String(openid),
    openid: String(openid),
    recipient: String(openid),
    // 读侧 resolveMessageQueue 只看 queue/audience/category/type 前缀：
    // 三个都写死到 workflow，任何一条生效都会落进「工作信息」队列（getUserMessages/index.js:58-67）
    queue: MESSAGE_QUEUE,
    audience: 'workflow',
    category: MESSAGE_CATEGORY,
    type: MESSAGE_TYPE,
    templateCode: MESSAGE_TYPE,
    title,
    content: content || '',
    icon: '',
    relatedId: dayKey,
    actionUrl: ACTION_URL,
    dedupeKey: key,
    read: false,
    createTime: db.serverDate(),
    _createTime: db.serverDate(),
    payload: payload || null
  }

  let messageId = ''
  try {
    const added = await db.collection('user_messages').add({ data: doc })
    messageId = (added && (added._id || added.id)) || ''
  } catch (e) {
    console.warn('dailyDigest user_messages add failed:', e && e.message)
    return { success: false, msg: (e && e.message) || '日报写入失败' }
  }

  // 镜像日志：与仓库既有形态一致（读侧会按 dedupeKey 把两表合并成一条）
  try {
    await db.collection('notification_logs').add({
      data: {
        recipient: String(openid),
        channel: 'inapp',
        queue: MESSAGE_QUEUE,
        category: MESSAGE_CATEGORY,
        type: MESSAGE_TYPE,
        templateCode: MESSAGE_TYPE,
        title,
        content: content || '',
        relatedId: dayKey,
        actionUrl: ACTION_URL,
        dedupeKey: key,
        status: 'success',
        sentAt: db.serverDate(),
        read: false
      }
    })
  } catch (e) {
    console.warn('dailyDigest notification_logs add failed:', e && e.message)
  }

  return { success: true, messageId }
}

/**
 * 保留策略：日报要「可回看」，但不是无限堆。
 * 删掉 `keepDays` 之前的**日报**消息（只删 type === daily_digest 的），
 * 且必须带 openid 归属判断，绝不碰别人的消息。
 */
async function pruneOldDigests (db, { openid, beforeDayKey, dryRun = false }) {
  if (!openid || !beforeDayKey) return { removed: 0, scanned: 0, dryRun: !!dryRun }
  let scanned = 0
  let removed = 0
  try {
    const res = await db.collection('user_messages')
      .where({ type: MESSAGE_TYPE, openid: String(openid) })
      .limit(200)
      .get()
    const rows = res.data || []
    scanned = rows.length
    for (const row of rows) {
      const day = String(row.relatedId || '').slice(0, 10)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue
      if (day >= beforeDayKey) continue
      if (dryRun) { removed += 1; continue }
      try {
        await db.collection('user_messages').doc(row._id).remove()
        removed += 1
      } catch (e) {
        console.warn('dailyDigest prune remove failed:', e && e.message)
      }
      if (row.dedupeKey) {
        try {
          const mirrors = await db.collection('notification_logs').where({ dedupeKey: row.dedupeKey }).limit(5).get()
          for (const m of (mirrors.data || [])) {
            await db.collection('notification_logs').doc(m._id).remove()
          }
        } catch (e) { /* 镜像缺失不影响主路径 */ }
      }
    }
  } catch (e) {
    console.warn('dailyDigest prune query failed:', e && e.message)
    return { removed, scanned, dryRun: !!dryRun, error: (e && e.message) || 'prune failed' }
  }
  return { removed, scanned, dryRun: !!dryRun }
}

/** 保留窗口起点日键 */
function retentionCutoffDayKey (todayDayKey) {
  const t = Date.parse(`${String(todayDayKey).slice(0, 10)}T00:00:00.000Z`)
  if (!Number.isFinite(t)) return ''
  return new Date(t - RETENTION_DAYS * 86400000).toISOString().slice(0, 10)
}

module.exports = {
  ACTION_URL,
  findExisting,
  writeDigestMessage,
  pruneOldDigests,
  retentionCutoffDayKey
}
