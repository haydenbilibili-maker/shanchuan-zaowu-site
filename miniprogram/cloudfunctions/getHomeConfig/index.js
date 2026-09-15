/**
 * 获取首页配置云函数
 * 支持模块顺序、显示/隐藏、数量等配置
 * 顺带幂等写入「标本师招募」banner 种子（可关，不强制覆盖运营配置）
 */

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const CLOUD_ENV = 'cloud1-8gnkty5bfff9f0bf'
const CLOUD_FILE_ID_PREFIX = `cloud://${CLOUD_ENV}.636c-cloud1-8gnkty5bfff9f0bf-1387508856`
const RECRUIT_BANNER_SEED_KEY = 'banner_framer_recruit'
const RECRUIT_PATH = '/subpackages/business/framer-recruit/index?from=home_banner'

function recruitBannerSeedDoc() {
  const now = Date.now()
  return {
    _seedKey: RECRUIT_BANNER_SEED_KEY,
    id: 'framer-recruit',
    title: '标本师招募',
    subtitle: '把手艺带到更多柜门前',
    badge: '合作',
    image: `${CLOUD_FILE_ID_PREFIX}/banners/d225de57986a74fc592cc876cd09a4df-2524a3ca-bb99-481.png`,
    type: 'scheme',
    target: RECRUIT_PATH,
    link: RECRUIT_PATH,
    sort: 80,
    enabled: true,
    createTime: now,
    updateTime: now
  }
}

function looksLikeRecruitBanner(row) {
  if (!row) return false
  if (row._seedKey === RECRUIT_BANNER_SEED_KEY) return true
  if (row.id === 'framer-recruit') return true
  const link = String(row.link || row.target || row.url || row.path || '')
  return link.indexOf('framer-recruit') >= 0
}

/**
 * 若库中尚无招募轮播，则写入一条可关（enabled）示例；已有运营配置则不覆盖、不重复插入。
 */
async function ensureRecruitBannerSeed() {
  try {
    const col = db.collection('banners')
    const seeded = await col.where({ _seedKey: RECRUIT_BANNER_SEED_KEY }).limit(1).get()
    if (seeded.data && seeded.data.length > 0) return { seeded: false, reason: 'seed_exists' }

    const listed = await col.orderBy('sort', 'desc').limit(100).get()
    const rows = listed.data || []
    if (rows.some(looksLikeRecruitBanner)) return { seeded: false, reason: 'recruit_exists' }

    await col.add({ data: recruitBannerSeedDoc() })
    return { seeded: true }
  } catch (e) {
    console.warn('ensureRecruitBannerSeed failed:', e)
    return { seeded: false, reason: 'error', error: String(e && e.message || e) }
  }
}

exports.main = async (event, context) => {
  // 幂等种子：不阻塞配置返回语义；失败仅打日志
  const seedResult = await ensureRecruitBannerSeed()

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
        updatedAt: config.updatedAt || config._updateTime,
        bannerSeed: seedResult
      }
    }

    // 如果没有配置，返回默认配置
    return {
      success: true,
      data: getDefaultModules(),
      version: '1.0.0',
      default: true,
      bannerSeed: seedResult
    }
  } catch (e) {
    console.error('获取首页配置失败:', e)
    // 降级：返回默认配置
    return {
      success: true,
      data: getDefaultModules(),
      version: '1.0.0',
      default: true,
      fallback: true,
      bannerSeed: seedResult
    }
  }
}

/**
 * 获取默认模块配置
 * 顺序：Hero → 灵动球 → 为你推荐 → 最新入库 → 标本工坊（定制）→ 这有店（默认关闭）→ 专题展览（默认关闭）→ 名师手作 → 近期活动（默认关闭）
 * 专题展览 / 近期活动：缺省 enabled:false，小程序仅在 enabled === true 时渲染
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
      enabled: false,
      order: 6,
      config: {}
    },
    {
      id: 'collections',
      name: '专题展览',
      // 缺省关闭：仅 Admin 显式 enabled === true 时小程序才展示
      enabled: false,
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
      // 缺省关闭：仅 Admin 显式 enabled === true 时小程序才展示
      enabled: false,
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
