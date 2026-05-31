/**
 * 用户行为追踪云函数 v2
 * - 支持单条 / 批量上报
 * - 标准化 module / sessionId / page 字段
 * - 写入 user_behaviors；同步增量更新 analytics_daily 汇总
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

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
    ...legacyExtra
  }
}

async function writeBehavior(event) {
  const { properties, dateKey, ...doc } = event
  await db.collection('user_behaviors').add({
    data: {
      ...doc,
      properties: properties || {},
      ...flattenProperties(properties)
    }
  })
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
  const list = Array.isArray(event.events)
    ? event.events
    : [event]

  const normalized = list.map(normalizeEvent).filter(Boolean)
  if (!normalized.length) {
    return { success: false, msg: '无有效事件' }
  }

  let ok = 0
  const errors = []

  for (const item of normalized) {
    try {
      await writeBehavior(item)
      await bumpDailyRollup(item)
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
