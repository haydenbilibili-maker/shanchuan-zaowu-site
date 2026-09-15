/**
 * 相关 / 个性化推荐
 * - 详情页传入 productId + category 时，优先同品类相关推荐
 * - 合并多路结果后按 _id 去重，并排除当前商品
 */

const cloud = require('wx-server-sdk')
const {
  sanitizeProductTags,
  topInterestTagNames,
  overlapTagScore
} = require('./productTags')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

function uniqById(list) {
  const seen = {}
  const out = []
  ;(list || []).forEach((item) => {
    if (!item || !item._id) return
    const id = String(item._id)
    if (seen[id]) return
    seen[id] = 1
    out.push(item)
  })
  return out
}

/** 同名同价重复上架时，只保留一条，避免相关推荐刷屏 */
function uniqBySkuFingerprint(list) {
  const seen = {}
  const out = []
  ;(list || []).forEach((item) => {
    if (!item) return
    const title = String(item.title || item.name || '').trim().toLowerCase()
    const price = Number(item.price)
    const priceKey = Number.isFinite(price) ? price.toFixed(2) : ''
    const key = title ? `${title}::${priceKey}` : String(item._id)
    if (seen[key]) return
    seen[key] = 1
    out.push(item)
  })
  return out
}

function finalize(list, limit, excludeId) {
  let rows = uniqById(list)
  if (excludeId) {
    const ex = String(excludeId)
    rows = rows.filter((item) => String(item._id) !== ex)
  }
  rows = uniqBySkuFingerprint(rows)
  return rows.slice(0, Math.max(1, limit || 6))
}


/** 内部字段（成本/毛利等）不得随商品文档外发 */
const INTERNAL_PRODUCT_FIELDS = [
  'costPrice', 'cost', 'costNote', 'purchasePrice', 'supplier', 'supplierName',
  'profit', 'margin', 'grossMargin', 'wholesalePrice', 'tradePrice'
]

function toPublicProduct(item) {
  const out = { ...(item || {}) }
  INTERNAL_PRODUCT_FIELDS.forEach((k) => {
    if (k in out) delete out[k]
  })
  return out
}

exports.main = async (event) => {
  const {
    productId = '',
    category = '',
    limit = 10
  } = event || {}
  // 安全：用户身份一律取服务端上下文，忽略客户端自报 userId
  // （原实现允许任意登录用户传他人 openid，读取其行为与兴趣标签）
  const userId = String((cloud.getWXContext() || {}).OPENID || '')

  const take = Math.min(20, Math.max(1, parseInt(limit, 10) || 10))

  try {
    let recommendations = []

    // 详情页「相关推荐」：优先同品类 / 同标签
    if (productId || category) {
      recommendations = await getRelatedByProduct(productId, category, take)
    } else if (!userId) {
      recommendations = await getHotRecommendations(take, productId)
    } else {
      const [userBehaviors, portraitTags] = await Promise.all([
        getUserBehaviors(userId),
        getUserInterestTags(userId)
      ])
      if (!userBehaviors.length && !portraitTags.length) {
        recommendations = await getHotRecommendations(take, productId)
      } else {
        recommendations = await getPersonalizedRecommendations(
          userBehaviors,
          take,
          productId,
          portraitTags
        )
      }
    }

    recommendations = finalize(recommendations, take, productId).map((item) => ({
      ...toPublicProduct(item),
      reason: generateRecommendReason(item)
    }))

    return {
      success: true,
      data: recommendations,
      count: recommendations.length
    }
  } catch (e) {
    console.error('推荐系统错误:', e)
    try {
      const hot = finalize(await getHotRecommendations(take, productId), take, productId)
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

async function getUserBehaviors(userId) {
  try {
    const res = await db.collection('user_behaviors')
      .where({ userId })
      .orderBy('timestamp', 'desc')
      .limit(50)
      .get()
    return res.data || []
  } catch (e) {
    console.warn('获取用户行为失败:', e)
    return []
  }
}

async function getRelatedByProduct(productId, category, limit) {
  let cat = String(category || '').trim()
  let sourceTags = []
  if (productId) {
    try {
      const doc = await db.collection('products').doc(productId).get()
      if (!cat) cat = (doc.data && (doc.data.category || doc.data.categoryName)) || ''
      sourceTags = sanitizeProductTags(doc.data && doc.data.tags)
    } catch (e) {
      console.warn('读取商品分类失败', e)
    }
  }

  let list = []
  if (cat) {
    try {
      const where = {
        category: cat,
        isOffShelf: _.neq(true)
      }
      if (productId) where._id = _.neq(productId)
      const res = await db.collection('products')
        .where(where)
        .limit(limit * 3)
        .get()
      list = res.data || []
    } catch (e) {
      // 兼容部分库无 isOffShelf 字段 / 查询失败
      try {
        const where = { category: cat }
        if (productId) where._id = _.neq(productId)
        const res = await db.collection('products').where(where).limit(limit * 3).get()
        list = (res.data || []).filter((p) => !p.isOffShelf)
      } catch (err) {
        console.warn('同品类推荐失败', err)
      }
    }
  }

  if (sourceTags.length) {
    const tagHits = await queryProductsByTags(sourceTags, limit * 2, productId)
    list = list.concat(tagHits)
  }

  if (list.length < limit) {
    const hot = await getHotRecommendations(limit * 2, productId)
    list = list.concat(hot)
  }

  return uniqById(list).map((item) => ({
    ...item,
    _tagScore: overlapTagScore(item.tags, sourceTags)
  })).sort((a, b) => (b._tagScore || 0) - (a._tagScore || 0))
}

async function getPersonalizedRecommendations(behaviors, limit, excludeProductId, portraitTags) {
  const preferences = analyzePreferences(behaviors)
  const mergedTags = uniqTags([
    ...(preferences.tags || []),
    ...(portraitTags || [])
  ]).slice(0, 8)
  const viewedItems = behaviors
    .filter((b) => b.action === 'view' || b.action === 'product_view')
    .map((b) => b.targetId)
    .filter(Boolean)
    .slice(0, 10)
  const collectedItems = behaviors
    .filter((b) => b.action === 'collect')
    .map((b) => b.targetId)
    .filter(Boolean)

  let recommendations = []

  if (mergedTags.length) {
    recommendations = await queryProductsByTags(mergedTags, limit * 3, excludeProductId)
  }

  if (preferences.categories.length > 0) {
    try {
      const categoryRes = await db.collection('products')
        .where({
          category: _.in(preferences.categories),
          isOffShelf: _.neq(true)
        })
        .limit(limit * 2)
        .get()
      recommendations = recommendations.concat(categoryRes.data || [])
    } catch (e) {
      const categoryRes = await db.collection('products')
        .where({ category: _.in(preferences.categories) })
        .limit(limit * 2)
        .get()
      recommendations = recommendations.concat((categoryRes.data || []).filter((p) => !p.isOffShelf))
    }
  }

  if (recommendations.length < limit) {
    const hot = await getHotRecommendations(limit * 2, excludeProductId)
    recommendations = recommendations.concat(hot)
  }

  const excludeIds = new Set(
    [...viewedItems, ...collectedItems, excludeProductId]
      .filter(Boolean)
      .map((id) => String(id))
  )

  return uniqById(recommendations)
    .filter((item) => !excludeIds.has(String(item._id)))
    .map((item) => ({
      ...item,
      _tagScore: overlapTagScore(item.tags, mergedTags)
    }))
    .sort((a, b) => (b._tagScore || 0) - (a._tagScore || 0))
}

function analyzePreferences(behaviors) {
  const categories = {}
  const tags = {}

  ;(behaviors || []).forEach((b) => {
    if (b.category) {
      categories[b.category] = (categories[b.category] || 0) + 1
    }
    const eventTags = sanitizeProductTags(b.tags || (b.properties && b.properties.tags))
    eventTags.forEach((tag) => {
      tags[tag] = (tags[tag] || 0) + 1
    })
  })

  return {
    categories: Object.entries(categories)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([cat]) => cat),
    tags: Object.entries(tags)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([tag]) => tag)
  }
}

async function getHotRecommendations(limit, excludeProductId) {
  try {
    const res = await db.collection('products')
      .where({ isOffShelf: _.neq(true) })
      .orderBy('createTime', 'desc')
      .limit(Math.max(limit * 3, 12))
      .get()

    let rows = res.data || []
    if (excludeProductId) {
      const ex = String(excludeProductId)
      rows = rows.filter((item) => String(item._id) !== ex)
    }
    // 稳定打散，避免每次完全随机导致调试困难
    for (let i = rows.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1))
      const tmp = rows[i]
      rows[i] = rows[j]
      rows[j] = tmp
    }
    return rows.slice(0, limit)
  } catch (e) {
    console.error('获取热门推荐失败:', e)
    try {
      const res = await db.collection('products').limit(Math.max(limit * 2, 8)).get()
      let rows = (res.data || []).filter((p) => !p.isOffShelf)
      if (excludeProductId) {
        const ex = String(excludeProductId)
        rows = rows.filter((item) => String(item._id) !== ex)
      }
      return rows.slice(0, limit)
    } catch (err) {
      return []
    }
  }
}

async function getUserInterestTags(userId) {
  if (!userId) return []
  try {
    const res = await db.collection('users').where({ _openid: userId }).limit(1).get()
    const row = res.data && res.data[0]
    return topInterestTagNames(row && row.interestTags, 8)
  } catch (e) {
    return []
  }
}

async function queryProductsByTags(tagList, limit, excludeProductId) {
  const tags = sanitizeProductTags(tagList).slice(0, 8)
  if (!tags.length) return []
  try {
    const where = {
      tags: _.in(tags),
      isOffShelf: _.neq(true)
    }
    if (excludeProductId) where._id = _.neq(excludeProductId)
    const res = await db.collection('products').where(where).limit(Math.max(limit, 8)).get()
    return res.data || []
  } catch (e) {
    try {
      const where = { tags: _.in(tags) }
      if (excludeProductId) where._id = _.neq(excludeProductId)
      const res = await db.collection('products').where(where).limit(Math.max(limit, 8)).get()
      return (res.data || []).filter((p) => !p.isOffShelf)
    } catch (err) {
      console.warn('按标签推荐失败', err)
      return []
    }
  }
}

function uniqTags(list) {
  return sanitizeProductTags(list)
}

function generateRecommendReason(item) {
  if (item && item._tagScore > 0) return '相近标签'
  if (item && item.category) return '同品类推荐'
  return '为你推荐'
}
