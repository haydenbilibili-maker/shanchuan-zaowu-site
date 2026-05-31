/**
 * 获取首页配置云函数
 * 支持模块顺序、显示/隐藏、数量等配置
 */

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  try {
    // 获取首页配置，优先获取激活的配置
    const configRes = await db.collection('home_configs')
      .where({ status: 'active' })
      .orderBy('priority', 'desc')
      .limit(1)
      .get()

    if (configRes.data && configRes.data.length > 0) {
      const config = configRes.data[0]
      return {
        success: true,
        data: config.modules || getDefaultModules(),
        version: config.version || '1.0.0',
        updatedAt: config.updatedAt || config._updateTime
      }
    }

    // 如果没有配置，返回默认配置
    return {
      success: true,
      data: getDefaultModules(),
      version: '1.0.0',
      default: true
    }
  } catch (e) {
    console.error('获取首页配置失败:', e)
    // 降级：返回默认配置
    return {
      success: true,
      data: getDefaultModules(),
      version: '1.0.0',
      default: true,
      fallback: true
    }
  }
}

/**
 * 获取默认模块配置
 * 顺序：Hero → 灵动球 → 为你推荐 → 最新入库 → 标本工坊 → 这有店 → 专题展览 → 名师手作 → 近期活动
 */
function getDefaultModules() {
  return [
    {
      id: 'banners',
      name: '轮播图',
      enabled: true,
      order: 1,
      config: {
        limit: 5,
        autoplay: true,
        interval: 6000
      }
    },
    {
      id: 'categories',
      name: '灵动球',
      enabled: true,
      order: 2,
      config: {
        limit: 4,
        showAll: false
      }
    },
    {
      id: 'recommendations',
      name: '为你推荐',
      enabled: true,
      order: 3,
      config: {
        limit: 8,
        algorithm: 'mixed'
      }
    },
    {
      id: 'newArrivals',
      name: '最新入库',
      enabled: true,
      order: 4,
      config: {
        limit: 10,
        sortBy: 'createTime',
        sortOrder: 'desc'
      }
    },
    {
      id: 'atelier',
      name: '标本工坊',
      enabled: true,
      order: 5,
      config: {}
    },
    {
      id: 'exploreStore',
      name: '走进这有店',
      enabled: true,
      order: 6,
      config: {}
    },
    {
      id: 'collections',
      name: '专题展览',
      enabled: true,
      order: 7,
      config: {
        limit: 10,
        sortBy: 'createTime',
        sortOrder: 'desc'
      }
    },
    {
      id: 'framers',
      name: '名师手作',
      enabled: true,
      order: 8,
      config: {
        limit: 6,
        sortBy: 'createTime',
        sortOrder: 'desc'
      }
    },
    {
      id: 'activities',
      name: '近期活动',
      enabled: true,
      order: 9,
      config: {
        limit: 5,
        status: 'open',
        sortBy: 'date',
        sortOrder: 'asc'
      }
    },
    {
      id: 'quickGrid',
      name: '金刚位',
      enabled: false,
      order: 99,
      config: {}
    }
  ]
}
