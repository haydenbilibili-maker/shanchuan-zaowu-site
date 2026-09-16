/**
 * 获取热门搜索关键词云函数
 * 从 user_behaviors 集合统计搜索关键词的热度
 *
 * #26 修复：此前这里读 `user_behaviors` **完全没有写 limit** →
 * 落云数据库服务端默认 **100 条**，而 ERP「搜索关键词管理」用 2000 条采样
 * → 同一个「热门搜索」两个口径，且云函数侧是**静默截断**（无人察觉）。
 * 现统一到真源常量，并在响应里标注是否采样（不静默）。
 */

const cloud = require('wx-server-sdk')
const { KEYWORD_SAMPLE_LIMIT, describeSample } = require('./analyticsLimits')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

/** 与 ERP SearchKeywordsManager 同源的默认采样天数 */
const DEFAULT_TIME_RANGE_DAYS = 7

exports.main = async (event, context) => {
  const { limit = 10, timeRange = DEFAULT_TIME_RANGE_DAYS } = event

  try {
    // 计算时间范围（最近N天）
    const now = Date.now()
    const timeStart = now - (timeRange * 24 * 60 * 60 * 1000)

    // 查询最近的搜索行为（上限来自真源，绝不省略 limit）
    const searchBehaviors = await db.collection('user_behaviors')
      .where({
        action: 'search',
        timestamp: _.gte(timeStart)
      })
      .orderBy('timestamp', 'desc')
      .limit(KEYWORD_SAMPLE_LIMIT)
      .get()
    const rows = searchBehaviors.data || []
    const sampleNote = describeSample(rows.length, KEYWORD_SAMPLE_LIMIT)

    if (rows.length === 0) {
      // 如果没有搜索记录，返回默认热门关键词
      return {
        success: true,
        data: ['Morpho', '水晶', '独角仙', 'Gold', '镇店'],
        count: 5
      }
    }

    // 统计关键词出现次数
    const keywordMap = new Map()
    rows.forEach(behavior => {
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
      count: finalKeywords.length,
      // 触顶时显式标注采样，不把采样值当全量（与 ERP 同口径）
      sampled: !!sampleNote,
      note: sampleNote,
      sampleLimit: KEYWORD_SAMPLE_LIMIT
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






