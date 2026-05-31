/**
 * 获取评价列表云函数
 * 支持按时间、热度排序，筛选有图、好评等
 */

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
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

    // 排序
    let orderBy = 'createdAt'
    let order = 'desc'
    
    if (sortBy === 'time') {
      orderBy = 'createdAt'
      order = 'desc'
    } else if (sortBy === 'hot') {
      orderBy = 'likes'
      order = 'desc'
    } else if (sortBy === 'rating') {
      orderBy = 'rating'
      order = 'desc'
    }

    // 执行查询
    const result = await query
      .orderBy(orderBy, order)
      .limit(limit)
      .skip(skip)
      .get()

    // 置顶评价优先（内存排序，避免复合索引）
    const sortedRows = (result.data || []).slice().sort((a, b) => {
      const pinDiff = (b.isPinned ? 1 : 0) - (a.isPinned ? 1 : 0)
      if (pinDiff !== 0) return pinDiff
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0
      return tb - ta
    })

    // 获取用户信息（可选，如果需要显示昵称和头像）
    const comments = await Promise.all(
      sortedRows.map(async (comment) => {
        try {
          // 尝试获取用户信息（如果存储在users集合中）
          const userRes = await db.collection('users')
            .where({ _openid: comment.userId })
            .get()
            .catch(() => ({ data: [] }))
          
          return {
            ...comment,
            userInfo: userRes.data[0] || null,
            // 格式化时间
            timeText: formatTime(comment.createdAt)
          }
        } catch (e) {
          return {
            ...comment,
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






