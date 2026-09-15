/**
 * 用户行为追踪云函数 v2
 * - 支持单条 / 批量上报
 * - 标准化 module / sessionId / page 字段
 * - 写入 user_behaviors；同步增量更新 analytics_daily 汇总
 */
const cloud = require('wx-server-sdk')
const { sanitizeProductTags } = require('./productTags')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const INTEREST_WEIGHT = {
  product_view: 1,
  product_add_cart: 3,
  search: 1
}
const INTEREST_ACTIONS = new Set(Object.keys(INTEREST_WEIGHT))
const INTEREST_TAG_CAP = 24

function getDateKey(ts) {
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function normalizeEvent(raw) {
  const {
    userId,
    action,
    targetType,
    targetId,
    timestamp,
    module,
    sessionId,
    page,
    scene,
    referrerPage,
    platform,
    properties,
    ...legacyExtra
  } = raw

  if (!userId || !action || !targetType || targetId === undefined || targetId === null || targetId === '') {
    return null
  }

  const ts = timestamp || Date.now()
  const props = properties && typeof properties === 'object' ? properties : {}
  const tags = sanitizeProductTags(raw.tags || props.tags || legacyExtra.tags)

  return {
    userId,
    action,
    targetType,
    targetId: String(targetId),
    module: module || 'system',
    sessionId: sessionId || '',
    page: page || '',
    scene: scene || 0,
    referrerPage: referrerPage || '',
    platform: platform || '',
    properties: props,
    timestamp: ts,
    dateKey: getDateKey(ts),
    createdAt: new Date(ts),
    ...legacyExtra,
    tags
  }
}

/**
 * 允许写入 user_behaviors 的字段白名单。
 * 原实现用 `const { properties, dateKey, ...doc } = event` 展开，
 * 调用方可写入**任意字段名**（数据投毒 + 越权写字段），改为显式白名单。
 */
const BEHAVIOR_ALLOWED_FIELDS = [
  'action', 'targetType', 'targetId', 'targetName', 'page', 'from',
  'keyword', 'categoryId', 'collectionId', 'orderId', 'productId',
  'shareType', 'source', 'channel', 'duration', 'position', 'referrer',
  'sessionId', 'platform', 'entrySource', 'extra'
]

async function writeBehavior(event) {
  const properties = (event && event.properties) || {}
  const doc = { _openid: String((cloud.getWXContext() || {}).OPENID || '') }
  BEHAVIOR_ALLOWED_FIELDS.forEach((k) => {
    const v = event && event[k]
    if (v !== undefined && v !== null && v !== '') doc[k] = v
  })
  // 行为时间与日期由服务端生成，避免调用方伪造（客户端只读字段）
  doc.serverTime = db.serverDate()
  doc.dateKey = String((event && event.dateKey) || '').slice(0, 10) || new Date().toISOString().slice(0, 10)
  await db.collection('user_behaviors').add({
    data: {
      ...doc,
      properties,
      ...flattenProperties(properties),
      tags: sanitizeProductTags(event && event.tags)
    }
  })
}

async function resolveEventTags(event) {
  const fromExtra = sanitizeProductTags(event.tags || (event.properties && event.properties.tags))
  if (fromExtra.length) return fromExtra
  if (event.targetType === 'product' && event.targetId && INTEREST_ACTIONS.has(event.action)) {
    try {
      const doc = await db.collection('products').doc(event.targetId).get()
      return sanitizeProductTags(doc.data && doc.data.tags)
    } catch (e) {
      return []
    }
  }
  return []
}

async function accumulateInterestTags(userId, tags, action) {
  const clean = sanitizeProductTags(tags)
  if (!userId || !clean.length) return
  const weight = INTEREST_WEIGHT[action] || 1
  try {
    const res = await db.collection('users').where({ _openid: userId }).limit(1).get()
    const row = res.data && res.data[0]
    if (!row) return
    const current = (row.interestTags && typeof row.interestTags === 'object' && !Array.isArray(row.interestTags))
      ? { ...row.interestTags }
      : {}
    clean.forEach((tag) => {
      current[tag] = (Number(current[tag]) || 0) + weight
    })
    const pruned = {}
    Object.entries(current)
      .sort((a, b) => Number(b[1]) - Number(a[1]))
      .slice(0, INTEREST_TAG_CAP)
      .forEach(([key, value]) => {
        pruned[key] = value
      })
    await db.collection('users').doc(row._id).update({
      data: {
        interestTags: pruned,
        interestTagsUpdatedAt: Date.now()
      }
    })
  } catch (e) {
    console.warn('accumulateInterestTags skip', e.message)
  }
}

/** 常用 properties 扁平化，便于旧版查询兼容 */
function flattenProperties(properties) {
  if (!properties || typeof properties !== 'object') return {}
  const flat = {}
  Object.keys(properties).forEach((k) => {
    const v = properties[k]
    if (v !== null && typeof v !== 'object') flat[k] = v
  })
  return flat
}

async function bumpDailyRollup(event) {
  const { dateKey, action, module, userId } = event
  if (!dateKey || !action) return

  try {
    const coll = db.collection('analytics_daily')
    const found = await coll.where({ dateKey, action }).limit(1).get()

    if (found.data && found.data.length) {
      await coll.doc(found.data[0]._id).update({
        data: {
          count: _.inc(1),
          uv: _.addToSet(userId),
          updatedAt: new Date()
        }
      })
    } else {
      await coll.add({
        data: {
          dateKey,
          action,
          module: module || 'system',
          count: 1,
          uv: [userId],
          createdAt: new Date(),
          updatedAt: new Date()
        }
      })
    }
  } catch (e) {
    console.warn('analytics_daily rollup skip', e.message)
  }
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext() || {}
  const openid = wxContext.OPENID || ''
  if (!openid) {
    return { success: false, msg: '未登录' }
  }

  const list = Array.isArray(event.events)
    ? event.events
    : [event]

  // 强制绑定调用方 openid，禁止伪造他人 userId 污染画像 / 汇总
  const normalized = list
    .map((raw) => normalizeEvent({ ...raw, userId: openid }))
    .filter(Boolean)
  if (!normalized.length) {
    return { success: false, msg: '无有效事件' }
  }

  let ok = 0
  const errors = []

  for (const item of normalized) {
    try {
      if (INTEREST_ACTIONS.has(item.action)) {
        const resolved = await resolveEventTags(item)
        if (resolved.length) item.tags = resolved
      }
      await writeBehavior(item)
      await bumpDailyRollup(item)
      if (INTEREST_ACTIONS.has(item.action) && item.tags && item.tags.length) {
        await accumulateInterestTags(item.userId, item.tags, item.action)
      }
      ok++
    } catch (e) {
      errors.push(e.message)
    }
  }

  return {
    success: ok > 0,
    msg: ok === normalized.length ? '记录成功' : `部分成功 ${ok}/${normalized.length}`,
    count: ok,
    errors: errors.length ? errors : undefined
  }
}
