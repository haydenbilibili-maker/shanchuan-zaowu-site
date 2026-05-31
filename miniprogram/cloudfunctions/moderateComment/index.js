/**
 * 评价审核：置顶 / 回复 / 隐藏 / 删除 / 通过
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event) => {
  const { action, commentId, reply, listFilter = 'all', limit = 50, skip = 0 } = event

  if (action === 'list') {
    try {
      let query = db.collection('comments')
      if (listFilter === 'pending') {
        query = query.where({ status: 'pending' })
      } else if (listFilter === 'approved') {
        query = query.where({ status: 'approved' })
      } else if (listFilter === 'hidden') {
        query = query.where({ status: 'hidden' })
      }
      const res = await query
        .orderBy('createdAt', 'desc')
        .skip(skip)
        .limit(limit)
        .get()
      return { success: true, data: res.data }
    } catch (e) {
      return { success: false, msg: e.message, data: [] }
    }
  }

  if (!commentId) {
    return { success: false, msg: '缺少 commentId' }
  }

  const now = new Date()

  try {
    if (action === 'approve') {
      await db.collection('comments').doc(commentId).update({
        data: { status: 'approved', updatedAt: now }
      })
      return { success: true, msg: '已通过' }
    }

    if (action === 'hide') {
      await db.collection('comments').doc(commentId).update({
        data: { status: 'hidden', updatedAt: now }
      })
      return { success: true, msg: '已隐藏' }
    }

    if (action === 'pin') {
      const doc = await db.collection('comments').doc(commentId).get()
      const isPinned = !!(doc.data && doc.data.isPinned)
      await db.collection('comments').doc(commentId).update({
        data: { isPinned: !isPinned, updatedAt: now }
      })
      return { success: true, msg: isPinned ? '已取消置顶' : '已置顶' }
    }

    if (action === 'reply') {
      if (!reply || !String(reply).trim()) {
        return { success: false, msg: '回复内容不能为空' }
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

    if (action === 'delete') {
      await db.collection('comments').doc(commentId).remove()
      return { success: true, msg: '已删除' }
    }

    return { success: false, msg: '未知操作' }
  } catch (e) {
    console.error('moderateComment error:', e)
    return { success: false, msg: e.message || '操作失败' }
  }
}
