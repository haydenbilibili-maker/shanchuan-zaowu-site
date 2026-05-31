/**
 * 获取热门搜索关键词云函数
 * 从 user_behaviors 集合统计搜索关键词的热度
 */

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const { limit = 10, timeRange = 7 } = event // 默认获取最近7天的热门搜索

  try {
    // 计算时间范围（最近N天）
    const now = Date.now()
    const timeStart = now - (timeRange * 24 * 60 * 60 * 1000)

    // 查询最近的搜索行为
    const searchBehaviors = await db.collection('user_behaviors')
      .where({
        action: 'search',
        timestamp: _.gte(timeStart)
      })
      .get()

    if (searchBehaviors.data.length === 0) {
      // 如果没有搜索记录，返回默认热门关键词
      return {
        success: true,
        data: ['Morpho', '水晶', '独角仙', 'Gold', '镇店'],
        count: 5
      }
    }

    // 统计关键词出现次数
    const keywordMap = new Map()
    
    searchBehaviors.data.forEach(behavior => {
      const keyword = behavior.keyword || behavior.targetId || ''
      if (keyword && keyword.trim()) {
        const normalizedKeyword = keyword.trim()
        const count = keywordMap.get(normalizedKeyword) || 0
        keywordMap.set(normalizedKeyword, count + 1)
      }
    })

    // 转换为数组并按热度排序
    const hotKeywords = Array.from(keywordMap.entries())
      .map(([keyword, count]) => ({ keyword, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit)
      .map(item => item.keyword)

    // 如果热门关键词不足，补充默认关键词
    const defaultKeywords = ['Morpho', '水晶', '独角仙', 'Gold', '镇店']
    const finalKeywords = [...new Set([...hotKeywords, ...defaultKeywords])].slice(0, limit)

    return {
      success: true,
      data: finalKeywords,
      count: finalKeywords.length
    }
  } catch (e) {
    console.error('获取热门搜索失败:', e)
    // 降级：返回默认关键词
    return {
      success: true,
      data: ['Morpho', '水晶', '独角仙', 'Gold', '镇店'],
      count: 5,
      fallback: true
    }
  }
}






