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
      if (!reply || !String(reply).trim()) {
        return fail('回复内容不能为空')
      }
      await db.collection('comments').doc(commentId).update({
        data: {
          merchantReply: String(reply).trim(),
          merchantReplyAt: now,
          updatedAt: now
        }
      })
      return { success: true, msg: '回复成功' }
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
