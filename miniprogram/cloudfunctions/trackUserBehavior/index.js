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

/**
 * 日汇总写入：dateKey + action 维度。
 *
 * 修复（真实报表缺陷 2026-09-16）：原实现是「先 where().limit(1).get() 再 add/update」的
 * **无锁读改写**。并发首次写入时两个调用都读不到、都执行 add → 同一 `dateKey+action`
 * 产生**多份文档**，而看板/Dashboard 对该维度求和或取 uv 并集 → **重复计数**。
 *
 * 现在用确定性 `_id`（`<dateKey>::<action>`）：
 *   - 首次 add 由主键唯一性保证只有一份文档落库；
 *   - 并发下第二个 add 抛 duplicate → 回落到原子 `update`（count/uv 都是原子算子）；
 *   - 与既有「先查后写」相比去掉了竞态窗口，且不再需要预读。
 *
 * ⚠️ 历史数据：修复前可能已存在重复文档，需一次性归并（见
 * `miniprogram/scripts/dedupe-analytics-daily.mjs`），否则历史口径仍偏大。
 */
function dailyRollupId(dateKey, action) {
  // 云库 _id 不允许 '/' 等特殊字符；'::' 安全且可读
  return `${String(dateKey)}::${String(action)}`
}

function isDuplicateKeyError(e) {
  const msg = String((e && (e.message || e.errMsg || e.errCode)) || '')
  return /duplicate|E11000|already exist|_id.*exist/i.test(msg)
}

async function bumpDailyRollup(event) {
  const { dateKey, action, module, userId } = event
  if (!dateKey || !action) return

  const coll = db.collection('analytics_daily')
  const docId = dailyRollupId(dateKey, action)
  const now = new Date()

  try {
    await coll.add({
      data: {
        _id: docId,
        dateKey,
        action,
        module: module || 'system',
        count: 1,
        uv: userId ? [userId] : [],
        uvCount: userId ? 1 : 0,
        createdAt: now,
        updatedAt: now
      }
    })
    return
  } catch (e) {
    if (!isDuplicateKeyError(e)) {
      console.warn('analytics_daily rollup add skip', e && e.message)
      return
    }
  }

  // 文档已存在：count 用原子算子；uv 用 addToSet 保证幂等。
  // uvCount 需「确认该用户此前不在 uv 中」才自增——这会多一次读，但与 count 不同：
  // 重复上报同一用户若用 _.inc 会持续放大，反而制造新的口径错误。
  // 残余风险：同一用户的**首次并发**两条上报可能都读到「不在」，使 uvCount 偏大 ≤1；
  // 已有读方（Dashboard/RealtimeMonitor）都直接对 uv 去重，故不影响现有报表。
  try {
    const patch = { count: _.inc(1), updatedAt: now }
    if (userId) {
      let isNewUser = false
      try {
        const seen = await coll.doc(docId).field({ uv: true }).get()
        const arr = (seen && seen.data && seen.data.uv) || []
        isNewUser = !arr.includes(userId)
      } catch (e) {
        isNewUser = false
      }
      patch.uv = _.addToSet(userId)
      patch.uvCount = isNewUser ? _.inc(1) : _.inc(0)
    }
    await coll.doc(docId).update({ data: patch })
  } catch (e) {
    console.warn('analytics_daily rollup update skip', e && e.message)
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
