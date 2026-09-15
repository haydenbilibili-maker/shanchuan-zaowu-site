/**
 * 获取评价列表云函数
 * 支持按时间、热度排序，筛选有图、好评等
 */

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

/**
 * 兼容历史脏数据：likes 可能是 number 或 openid array
 * @param {object} comment
 * @param {string} [openid]
 */
function normalizeCommentLikes(comment = {}, openid = '') {
  const rawLikedBy = Array.isArray(comment.likedBy) ? comment.likedBy.filter(Boolean) : []
  let likedBy = [...rawLikedBy]
  let likes = 0

  if (Array.isArray(comment.likes)) {
    likedBy = Array.from(new Set([...likedBy, ...comment.likes.filter(Boolean)]))
    likes = likedBy.length
  } else if (typeof comment.likes === 'number' && Number.isFinite(comment.likes)) {
    likes = Math.max(0, Math.floor(comment.likes))
    if (likedBy.length > 0) likes = likedBy.length
  } else {
    likes = likedBy.length
  }

  return {
    likes,
    likedBy,
    userLiked: !!(openid && likedBy.includes(openid))
  }
}

function likeCountForSort(comment = {}) {
  if (Array.isArray(comment.likes)) return comment.likes.length
  if (typeof comment.likes === 'number' && Number.isFinite(comment.likes)) {
    return Math.max(0, comment.likes)
  }
  if (Array.isArray(comment.likedBy)) return comment.likedBy.length
  return 0
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID || ''
  const { targetType, targetId, sortBy = 'time', filter = 'all', limit = 20, skip = 0 } = event

  if (!targetType || !targetId) {
    return {
      success: false,
      msg: '参数不完整'
    }
  }

  try {
    // 构建查询条件
    let query = db.collection('comments')
      .where({
        targetType,
        targetId,
        status: 'approved' // 只返回已审核通过的评价
      })

    // 筛选条件
    if (filter === 'withImages') {
      query = query.where({
        images: _.exists(true).and(_.neq([]))
      })
    } else if (filter === 'highRating') {
      query = query.where({
        rating: _.gte(4)
      })
    }

    // 排序（热度含脏数据 likes=array，统一拉回内存排序）
    let orderBy = 'createdAt'
    let order = 'desc'
    
    if (sortBy === 'time') {
      orderBy = 'createdAt'
      order = 'desc'
    } else if (sortBy === 'rating') {
      orderBy = 'rating'
      order = 'desc'
    } else {
      // hot / 默认：先按时间取，再内存按 likes
      orderBy = 'createdAt'
      order = 'desc'
    }

    // 执行查询
    const result = await query
      .orderBy(orderBy, order)
      .limit(limit)
      .skip(skip)
      .get()

    // 置顶优先；热度按规范化点赞数；其余按时间
    const sortedRows = (result.data || []).slice().sort((a, b) => {
      const pinDiff = (b.isPinned ? 1 : 0) - (a.isPinned ? 1 : 0)
      if (pinDiff !== 0) return pinDiff
      if (sortBy === 'hot') {
        const likeDiff = likeCountForSort(b) - likeCountForSort(a)
        if (likeDiff !== 0) return likeDiff
      } else if (sortBy === 'rating') {
        const ratingDiff = (b.rating || 0) - (a.rating || 0)
        if (ratingDiff !== 0) return ratingDiff
      }
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0
      return tb - ta
    })

    // 获取用户信息（可选，如果需要显示昵称和头像）
    const comments = await Promise.all(
      sortedRows.map(async (comment) => {
        const likeFields = normalizeCommentLikes(comment, openid)
        try {
          // 尝试获取用户信息（如果存储在users集合中）
          const userRes = await db.collection('users')
            .where({ _openid: comment.userId })
            .field({ nickName: true, avatarUrl: true })
            .get()
            .catch(() => ({ data: [] }))
          const rawUser = (userRes.data && userRes.data[0]) || null
          // 隐私：只下发昵称与头像；此前直接把整条 users 文档回传，
          // 含明文手机号、_openid、角色与积分等敏感字段
          const userInfo = rawUser
            ? { nickName: rawUser.nickName || '', avatarUrl: rawUser.avatarUrl || '' }
            : null

          const { likedBy: _omitLikedBy, ...safeComment } = comment
          return {
            ...safeComment,
            likes: likeFields.likes,
            userLiked: likeFields.userLiked,
            userInfo,
            // 格式化时间
            timeText: formatTime(comment.createdAt)
          }
        } catch (e) {
          const { likedBy: _omitLikedBy, ...safeComment } = comment
          return {
            ...safeComment,
            likes: likeFields.likes,
            userLiked: likeFields.userLiked,
            userInfo: null,
            timeText: formatTime(comment.createdAt)
          }
        }
      })
    )

    // 获取评价统计
    const statsRes = await db.collection('comments')
      .where({
        targetType,
        targetId,
        status: 'approved'
      })
      .get()

    const stats = {
      total: statsRes.data.length,
      averageRating: 0,
      ratingDistribution: {
        5: 0,
        4: 0,
        3: 0,
        2: 0,
        1: 0
      },
      withImages: 0
    }

    if (statsRes.data.length > 0) {
      let totalRating = 0
      statsRes.data.forEach(comment => {
        totalRating += comment.rating
        stats.ratingDistribution[comment.rating]++
        if (comment.images && comment.images.length > 0) {
          stats.withImages++
        }
      })
      stats.averageRating = (totalRating / statsRes.data.length).toFixed(1)
    }

    return {
      success: true,
      data: comments,
      stats,
      count: comments.length,
      hasMore: comments.length === limit
    }
  } catch (e) {
    console.error('获取评价列表失败:', e)
    return {
      success: false,
      msg: e.message || '获取评价列表失败',
      data: [],
      stats: {
        total: 0,
        averageRating: 0,
        ratingDistribution: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 },
        withImages: 0
      }
    }
  }
}

// 格式化时间
function formatTime(date) {
  if (!date) return ''
  
  const now = new Date()
  const commentDate = date instanceof Date ? date : new Date(date)
  const diff = now - commentDate
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 7) {
    return `${commentDate.getMonth() + 1}-${commentDate.getDate()}`
  } else if (days > 0) {
    return `${days}天前`
  } else if (hours > 0) {
    return `${hours}小时前`
  } else if (minutes > 0) {
    return `${minutes}分钟前`
  } else {
    return '刚刚'
  }
}






