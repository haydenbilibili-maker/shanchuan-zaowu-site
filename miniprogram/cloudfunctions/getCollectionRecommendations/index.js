/**
 * 基于收藏的推荐云函数
 * 根据用户收藏内容推荐相似内容
 */

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const { userId, limit = 8 } = event

  try {
    if (!userId) {
      return {
        success: false,
        msg: '用户ID不能为空',
        data: []
      }
    }

    // 1. 获取用户收藏列表
    const collectionsRes = await db.collection('collections')
      .where({ _openid: userId })
      .orderBy('createTime', 'desc')
      .limit(20) // 最近20个收藏
      .get()

    if (collectionsRes.data.length === 0) {
      // 没有收藏，返回热门推荐
      return await getHotRecommendations(limit)
    }

    const collections = collectionsRes.data
    const collectedProductIds = collections.map(c => c.productId).filter(Boolean)

    // 2. 获取收藏商品的详细信息
    const productsRes = await db.collection('products')
      .where({
        _id: _.in(collectedProductIds),
        isOffShelf: false
      })
      .get()

    const collectedProducts = productsRes.data || []

    // 3. 分析收藏偏好（分类、标签）
    const preferences = analyzeCollectionPreferences(collectedProducts)

    // 4. 基于偏好推荐相似商品
    let recommendations = []

    // 4.1 基于分类推荐
    if (preferences.categories.length > 0) {
      const categoryRes = await db.collection('products')
        .where({
          category: _.in(preferences.categories),
          isOffShelf: false,
          _id: _.nin(collectedProductIds) // 排除已收藏的
        })
        .limit(limit * 2)
        .get()
      
      recommendations = categoryRes.data || []
    }

    // 4.2 基于标签推荐
    if (preferences.tags.length > 0 && recommendations.length < limit) {
      const tagRes = await db.collection('products')
        .where({
          tags: _.in(preferences.tags),
          isOffShelf: false,
          _id: _.nin([...collectedProductIds, ...recommendations.map(r => r._id)])
        })
        .limit(limit - recommendations.length)
        .get()
      
      recommendations = [...recommendations, ...tagRes.data]
    }

    // 4.3 如果推荐不足，补充热门商品
    if (recommendations.length < limit) {
      const hot = await getHotRecommendations(limit - recommendations.length, [
        ...collectedProductIds,
        ...recommendations.map(r => r._id)
      ])
      recommendations = [...recommendations, ...hot]
    }

    // 5. 去重并限制数量
    const uniqueRecommendations = []
    const seenIds = new Set()
    for (const item of recommendations) {
      if (!seenIds.has(item._id)) {
        seenIds.add(item._id)
        uniqueRecommendations.push(item)
        if (uniqueRecommendations.length >= limit) break
      }
    }

    // 6. 添加推荐理由
    const recommendationsWithReason = uniqueRecommendations.map(item => ({
      ...item,
      reason: generateCollectionReason(item, preferences)
    }))

    return {
      success: true,
      data: recommendationsWithReason,
      count: recommendationsWithReason.length,
      // 收藏趋势数据
      trend: {
        recentCollections: collections.slice(0, 5).map(c => ({
          productId: c.productId,
          createTime: c.createTime
        })),
        topCategories: preferences.categories.slice(0, 3),
        totalCollections: collections.length
      }
    }
  } catch (e) {
    console.error('收藏推荐错误:', e)
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
 * 分析收藏偏好
 */
function analyzeCollectionPreferences(products) {
  const categories = {}
  const tags = {}

  products.forEach(product => {
    // 统计分类
    if (product.category) {
      categories[product.category] = (categories[product.category] || 0) + 1
    }

    // 统计标签
    if (product.tags && Array.isArray(product.tags)) {
      product.tags.forEach(tag => {
        tags[tag] = (tags[tag] || 0) + 1
      })
    }
  })

  // 排序并取前几个
  const topCategories = Object.entries(categories)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([category]) => category)

  const topTags = Object.entries(tags)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tag]) => tag)

  return {
    categories: topCategories,
    tags: topTags
  }
}

/**
 * 获取热门推荐（降级方案）
 */
async function getHotRecommendations(limit, excludeIds = []) {
  try {
    let query = db.collection('products')
      .where({ isOffShelf: false })
    
    if (excludeIds.length > 0) {
      query = query.where({ _id: _.nin(excludeIds) })
    }

    const res = await query
      .orderBy('createTime', 'desc')
      .limit(limit * 2)
      .get()

    // 简单随机选择
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
function generateCollectionReason(item, preferences) {
  if (preferences.categories.includes(item.category)) {
    return '基于你的收藏偏好'
  }
  
  if (item.tags && item.tags.some(tag => preferences.tags.includes(tag))) {
    return '与你收藏的内容相似'
  }

  return '为你推荐'
}







