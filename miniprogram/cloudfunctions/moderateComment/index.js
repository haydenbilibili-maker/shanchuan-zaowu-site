/**
 * 评价审核：列表 / 通过 / 隐藏 / 置顶 / 回复 / 删除
 * 鉴权：staffGuard — manager；Admin Web 可用 ADMIN_OPS_KEY
 */
const cloud = require('wx-server-sdk')
const { assertStaff, ROLE_MANAGER } = require('./staffGuard')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const PAGE_SIZE_MAX = 200

function fail(msg, extra) {
  return { success: false, msg, data: [], ...(extra || {}) }
}

function toMs(value) {
  if (!value) return 0
  if (typeof value === 'number') return value
  if (value instanceof Date) return value.getTime()
  if (typeof value.getTime === 'function') return value.getTime()
  if (typeof value === 'object' && value.$date) return new Date(value.$date).getTime()
  const n = Date.parse(value)
  return Number.isFinite(n) ? n : 0
}

function normalizeRow(doc) {
  if (!doc) return null
  const createTime = toMs(doc.createTime || doc.createdAt || doc._createTime)
  const targetLabel = doc.productTitle
    ? String(doc.productTitle)
    : [doc.targetType, doc.targetId].filter(Boolean).join(' · ')
  return {
    ...doc,
    createTime,
    createdAt: createTime || doc.createdAt,
    status: doc.status || 'pending',
    targetLabel,
    orderId: doc.orderId || ''
  }
}

/**
 * 商家回复后，给评价作者写一封「山海有信」（2026-11-25 核查补：原来只写 comments.merchantReply，
 * 用户端没有任何提醒，只能自己回商品详情里翻）。
 * 直接写 user_messages（与 dispatchMessage 的直写分支同字段），失败不阻断回复本身。
 */
async function notifyCommentReplied(comment, reply) {
  try {
    const openid = String((comment && comment.userId) || '').trim()
    if (!openid) return { success: false, msg: '评价缺少作者 openid' }
    const targetType = String((comment && comment.targetType) || 'product').trim() || 'product'
    const targetId = String((comment && comment.targetId) || '').trim()
    const orderId = String((comment && comment.orderId) || '').trim()
    const qs = [`targetType=${encodeURIComponent(targetType)}`, `targetId=${encodeURIComponent(targetId)}`]
    if (orderId) qs.push(`orderId=${encodeURIComponent(orderId)}`)
    const actionUrl = `subpackages/content/comment/index?${qs.join('&')}`
    const excerpt = String(reply || '').replace(/\s+/g, ' ').trim()
    const content = excerpt.length > 60 ? `${excerpt.slice(0, 60)}…` : excerpt
    await db.collection('user_messages').add({
      data: {
        _openid: openid,
        openid,
        recipient: openid,
        category: 'customer',
        queue: 'customer',
        type: 'comment_replied',
        title: '馆员回复了你的评价',
        content,
        relatedId: String((comment && comment._id) || ''),
        actionUrl,
        templateCode: 'comment_replied',
        dedupeKey: `comment_replied:${String((comment && comment._id) || '')}:${openid}:${Date.now()}`,
        read: false,
        createTime: db.serverDate(),
        _createTime: db.serverDate()
      }
    })
    return { success: true }
  } catch (e) {
    console.warn('notifyCommentReplied failed:', e && e.message)
    return { success: false, msg: (e && e.message) || '消息写入失败' }
  }
}


/**
 * 全局看板（2026-11-26 产品负责人）：待审核为 0 时进页面不该是一片空白。
 * 口径与 listComments 完全一致：status 缺省按 pending 处理（normalizeRow 同口径）。
 * 只读，不写审计；一次最多扫 500 条近况算均分 / 回复率 / 近 7 天走势（超出截断，前端标注）。
 */
async function commentStats() {
  const STATUSES = ['pending', 'approved', 'hidden']
  const counts = { all: 0, pending: 0, approved: 0, hidden: 0 }
  const totalRes = await db.collection('comments').count()
  counts.all = Number((totalRes && totalRes.total) || 0)
  for (const st of STATUSES) {
    const r = await db.collection('comments').where({ status: st }).count()
    counts[st] = Number((r && r.total) || 0)
  }
  // status 缺省的那些按 pending 计（listComments 里 normalizeRow 也是 pending）
  counts.pending += Math.max(0, counts.all - counts.pending - counts.approved - counts.hidden)

  let rows = []
  try {
    const res = await db.collection('comments')
      .field({ rating: true, merchantReply: true, status: true, createTime: true, createdAt: true, _createTime: true })
      .orderBy('createTime', 'desc')
      .limit(500)
      .get()
    rows = (res.data || []).map(normalizeRow)
  } catch (e) {
    try {
      const res = await db.collection('comments').limit(500).get()
      rows = (res.data || []).map(normalizeRow).sort((a, b) => (b.createTime || 0) - (a.createTime || 0))
    } catch (e2) { rows = [] }
  }

  const rated = rows.filter((r) => Number(r.rating) >= 1)
  const avg = rated.length ? Math.round((rated.reduce((n, r) => n + Number(r.rating), 0) / rated.length) * 10) / 10 : 0
  const replied = rows.filter((r) => String(r.merchantReply || '').trim()).length
  const replyRate = rows.length ? Math.round((replied / rows.length) * 100) : 0
  const pinned = rows.filter((r) => r.isPinned).length

  // 近 7 天（北京时间）新评价数
  const days = []
  const dayKey = (ms) => {
    const d = new Date(ms + 8 * 3600 * 1000)
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  }
  const now = Date.now()
  for (let i = 6; i >= 0; i -= 1) {
    const key = dayKey(now - i * 86400000)
    days.push({ date: key, label: key.slice(5).replace('-', '/'), count: 0 })
  }
  const idx = new Map(days.map((d) => [d.date, d]))
  rows.forEach((r) => {
    if (!r.createTime) return
    const d = idx.get(dayKey(r.createTime))
    if (d) d.count += 1
  })
  return {
    success: true,
    counts,
    avgRating: avg,
    replyRate,
    replied,
    pinned,
    sampled: rows.length,
    truncated: counts.all > rows.length,
    days
  }
}

async function listComments(event) {
  const listFilter = String((event && event.listFilter) || 'all').trim() || 'all'
  const limit = Math.min(Math.max(Number(event && event.limit) || 50, 1), PAGE_SIZE_MAX)
  const skip = Math.max(Number(event && event.skip) || 0, 0)

  let query = db.collection('comments')
  if (listFilter === 'pending') {
    query = query.where({ status: 'pending' })
  } else if (listFilter === 'approved') {
    query = query.where({ status: 'approved' })
  } else if (listFilter === 'hidden') {
    query = query.where({ status: 'hidden' })
  }

  // 不用 orderBy，避免缺索引；内存按时间倒序
  const res = await query.skip(skip).limit(limit).get()
  const rows = (res.data || []).map(normalizeRow)
  rows.sort((a, b) => (b.createTime || 0) - (a.createTime || 0))

  let pendingCount = 0
  try {
    const countRes = await db.collection('comments').where({ status: 'pending' }).count()
    pendingCount = countRes.total || 0
  } catch (e) {
    pendingCount = listFilter === 'pending' ? rows.length : 0
  }

  return { success: true, data: rows, list: rows, pendingCount, total: rows.length }
}

exports.main = async (event = {}) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const action = String(event.action || '').trim()
  const adminOpsKey = event.adminOpsKey
  const commentId = event.commentId || event.id

  if (!action) return fail('缺少 action')

  // Admin Web 可无 OPENID，改用 ADMIN_OPS_KEY
  if (!openid && !adminOpsKey) return fail('未登录')

  const guard = await assertStaff(db, openid, {
    role: ROLE_MANAGER,
    permission: 'moderateContent',
    requireSuperAdmin: true,
    adminOpsKey
  })
  if (!guard.ok) {
    return { success: false, code: guard.code, msg: guard.msg, data: [] }
  }

  try {
    if (action === 'list') {
      return await listComments(event)
    }

    if (action === 'stats') {
      return await commentStats()
    }

    if (!commentId) return fail('缺少 commentId')

    const now = Date.now()

    if (action === 'approve' || action === 'approved') {
      await db.collection('comments').doc(commentId).update({
        data: { status: 'approved', updatedAt: now }
      })
      return { success: true, msg: '已通过', status: 'approved' }
    }

    if (action === 'hide' || action === 'hidden') {
      await db.collection('comments').doc(commentId).update({
        data: { status: 'hidden', updatedAt: now }
      })
      return { success: true, msg: '已隐藏', status: 'hidden' }
    }

    if (action === 'pin') {
      const doc = await db.collection('comments').doc(commentId).get()
      const data = (doc.data && (Array.isArray(doc.data) ? doc.data[0] : doc.data)) || {}
      const isPinned = !!data.isPinned
      await db.collection('comments').doc(commentId).update({
        data: { isPinned: !isPinned, updatedAt: now }
      })
      return { success: true, msg: isPinned ? '已取消置顶' : '已置顶', isPinned: !isPinned }
    }

    if (action === 'reply') {
      const reply = event.reply
      const replyText = String(reply || '').trim()
      if (!replyText) {
        return fail('回复内容不能为空')
      }
      // 先读一次评价：要拿作者 openid 与目标（用于发「山海有信」并让用户点进自己的评价）
      let comment = null
      try {
        const one = await db.collection('comments').doc(commentId).get()
        comment = (one && one.data) || null
      } catch (e) {
        comment = null
      }
      if (!comment) return fail('评价不存在')
      await db.collection('comments').doc(commentId).update({
        data: {
          merchantReply: replyText,
          merchantReplyAt: now,
          updatedAt: now
        }
      })
      const notified = await notifyCommentReplied(comment, replyText)
      return {
        success: true,
        msg: notified.success ? '回复成功，已发信通知顾客' : '回复成功（消息通知未送达）',
        notified: !!notified.success
      }
    }

    if (action === 'delete' || action === 'remove') {
      await db.collection('comments').doc(commentId).remove()
      return { success: true, msg: '已删除' }
    }

    return fail('未知操作')
  } catch (e) {
    console.error('moderateComment error:', action, e)
    return fail(e.message || '操作失败')
  }
}
