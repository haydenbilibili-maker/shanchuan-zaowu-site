/**
 * 点赞评价云函数
 * 数据模型：likes(number 计数) + likedBy(openid 数组)
 * 兼容历史脏数据：likes 曾被写成 array（用户列表）
 */

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/**
 * 将文档中的 likes / likedBy 规范为数字计数 + openid 数组
 * @param {object} doc
 * @returns {{ likes: number, likedBy: string[], needsMigrate: boolean }}
 */
function normalizeLikeFields(doc = {}) {
  const rawLikedBy = Array.isArray(doc.likedBy) ? doc.likedBy.filter(Boolean) : []
  let likes = 0
  let likedBy = [...rawLikedBy]
  let needsMigrate = false

  if (Array.isArray(doc.likes)) {
    // 历史脏数据：likes 存的是用户 openid 列表
    needsMigrate = true
    const fromLikes = doc.likes.filter(Boolean)
    likedBy = Array.from(new Set([...likedBy, ...fromLikes]))
    likes = likedBy.length
  } else if (typeof doc.likes === 'number' && Number.isFinite(doc.likes)) {
    likes = Math.max(0, Math.floor(doc.likes))
    if (likedBy.length > 0 && likedBy.length !== likes) {
      // 有 likedBy 时以名单长度为准，避免计数漂移
      likes = likedBy.length
      needsMigrate = true
    }
  } else {
    needsMigrate = doc.likes != null || likedBy.length > 0
    likes = likedBy.length
  }

  if (!Array.isArray(doc.likedBy) && likedBy.length > 0) {
    needsMigrate = true
  }

  return { likes, likedBy, needsMigrate }
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const { commentId, isLike } = event
  const userId = wxContext.OPENID

  if (!commentId) {
    return {
      success: false,
      msg: '参数不完整'
    }
  }

  if (!userId) {
    return {
      success: false,
      msg: '请先登录'
    }
  }

  try {
    const commentRef = db.collection('comments').doc(commentId)
    const comment = await commentRef.get()

    if (!comment.data) {
      return {
        success: false,
        msg: '评价不存在'
      }
    }

    const { likes, likedBy, needsMigrate } = normalizeLikeFields(comment.data)
    const alreadyLiked = likedBy.includes(userId)
    const wantLike = !!isLike

    let nextLikes = likes
    let nextLikedBy = likedBy
    let changed = false

    if (wantLike && !alreadyLiked) {
      nextLikedBy = [...likedBy, userId]
      nextLikes = nextLikedBy.length
      changed = true
    } else if (!wantLike && alreadyLiked) {
      nextLikedBy = likedBy.filter((id) => id !== userId)
      nextLikes = nextLikedBy.length
      changed = true
    }

    // 脏数据或状态变更时整字段写回，避免对 array 类型 likes 执行 $inc
    if (changed || needsMigrate) {
      await commentRef.update({
        data: {
          likes: nextLikes,
          likedBy: nextLikedBy,
          updatedAt: new Date()
        }
      })
    }

    return {
      success: true,
      likes: nextLikes,
      userLiked: nextLikedBy.includes(userId)
    }
  } catch (e) {
    console.error('点赞评价失败:', e)
    return {
      success: false,
      msg: e.message || '操作失败'
    }
  }
}
