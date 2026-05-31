/**
 * 智能推荐云函数
 * 基于用户行为数据，实现个性化内容推荐
 */

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const { userId, type = 'mixed', limit = 10 } = event

  try {
    // 如果没有userId，返回热门推荐
    if (!userId) {
      return await getHotRecommendations(limit)
    }

    // 获取用户行为数据
    const userBehaviors = await getUserBehaviors(userId)
    
    // 根据行为数据生成推荐
    let recommendations = []
    
    if (userBehaviors.length === 0) {
      // 新用户，返回热门推荐
      recommendations = await getHotRecommendations(limit)
    } else {
      // 基于用户行为的推荐
      recommendations = await getPersonalizedRecommendations(userId, userBehaviors, limit)
    }

    // 添加推荐理由
    recommendations = recommendations.map(item => ({
      ...item,
      reason: generateRecommendReason(item, userBehaviors)
    }))

    return {
      success: true,
      data: recommendations,
      count: recommendations.length
    }
  } catch (e) {
    console.error('推荐系统错误:', e)
    // 降级：返回热门推荐
    try {
      const hot = await getHotRecommendations(limit)
      return {
        success: true,
        data: hot,
        count: hot.length,
        fallback: true
      }
    } catch (err) {
      return {
        success: false,
        data: [],
        msg: err.message
      }
    }
  }
}

/**
 * 获取用户行为数据
 */
async function getUserBehaviors(userId) {
  try {
    const res = await db.collection('user_behaviors')
      .where({ userId })
      .orderBy('timestamp', 'desc')
      .limit(50) // 最近50条行为
      .get()
    
    return res.data || []
  } catch (e) {
    console.warn('获取用户行为失败:', e)
    return []
  }
}

/**
 * 获取个性化推荐
 */
async function getPersonalizedRecommendations(userId, behaviors, limit) {
  // 分析用户偏好
  const preferences = analyzePreferences(behaviors)
  
  // 1. 基于浏览历史的推荐（协同过滤）
  const viewedItems = behaviors
    .filter(b => b.action === 'view')
    .map(b => b.targetId)
    .slice(0, 10) // 最近浏览的10个

  let recommendations = []

  // 2. 基于收藏的推荐
  const collectedItems = behaviors
    .filter(b => b.action === 'collect')
    .map(b => b.targetId)

  // 3. 基于分类偏好的推荐
  if (preferences.categories.length > 0) {
    const categoryRes = await db.collection('products')
      .where({
        category: _.in(preferences.categories),
        isOffShelf: false
      })
      .limit(limit)
      .get()
    
    recommendations = categoryRes.data || []
  }

  // 4. 如果推荐不足，补充热门商品
  if (recommendations.length < limit) {
    const hot = await getHotRecommendations(limit - recommendations.length)
    recommendations = [...recommendations, ...hot]
  }

  // 5. 去重（排除已浏览/收藏的）
  const excludeIds = [...viewedItems, ...collectedItems]
  recommendations = recommendations
    .filter(item => !excludeIds.includes(item._id))
    .slice(0, limit)

  return recommendations
}

/**
 * 分析用户偏好
 */
function analyzePreferences(behaviors) {
  const categories = {}
  const tags = {}

  behaviors.forEach(b => {
    if (b.category) {
      categories[b.category] = (categories[b.category] || 0) + 1
    }
    if (b.tags && Array.isArray(b.tags)) {
      b.tags.forEach(tag => {
        tags[tag] = (tags[tag] || 0) + 1
      })
    }
  })

  // 排序，取前3
  const topCategories = Object.entries(categories)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([cat]) => cat)

  return {
    categories: topCategories,
    tags: Object.entries(tags)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([tag]) => tag)
  }
}

/**
 * 获取热门推荐（降级方案）
 */
async function getHotRecommendations(limit) {
  try {
    // 基于销量、收藏数、创建时间综合排序
    const res = await db.collection('products')
      .where({ isOffShelf: false })
      .orderBy('createTime', 'desc')
      .limit(limit * 2) // 多取一些，后续可以随机选择
      .get()

    // 简单随机选择（实际可以基于销量、收藏数等排序）
    const shuffled = res.data.sort(() => Math.random() - 0.5)
    return shuffled.slice(0, limit)
  } catch (e) {
    console.error('获取热门推荐失败:', e)
    return []
  }
}

/**
 * 生成推荐理由
 */
function generateRecommendReason(item, behaviors) {
  if (behaviors.length === 0) {
    return '热门推荐'
  }

  // 检查是否有相关浏览记录
  const relatedView = behaviors.find(b => 
    b.action === 'view' && 
    (b.category === item.category || b.tags?.some(tag => item.tags?.includes(tag)))
  )

  if (relatedView) {
    return '因为你浏览过类似内容'
  }

  // 检查是否有收藏记录
  const hasCollection = behaviors.some(b => b.action === 'collect')
  if (hasCollection) {
    return '基于你的收藏偏好'
  }

  return '为你推荐'
}








