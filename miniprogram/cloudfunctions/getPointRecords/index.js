/**
 * 用户积分明细
 *
 * point_records 里门店赠分的 _openid 是店员，账户归属看 userOpenid；
 * 历史记录（签到/浏览）没有 userOpenid，按 _openid + type='earn' 兼容。
 */
const cloud = require('wx-server-sdk')
const { loadBalance } = require('./pointsBalance')
const { normalizeConfig, describeRule, summarizeRule } = require('./defaults')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const POINT_RECORDS = 'point_records'

const ACTION_TITLES = {
  check_in: '每日签到',
  browse: '鉴赏藏品',
  share: '分享藏品',
  review: '评价奖励',
  store_purchase: '门店消费',
  store_purchase_revoke: '门店积分调整',
  coupon_exchange: '兑换代金券',
  platform_order: '外部订单绑定',
  register_gift: '新用户礼赠',
  profile_reward: '完善资料奖励',
  birthday_gift: '生日礼券 · 专属积分'
}

function toTitle(row) {
  if (row.title) return row.title
  return ACTION_TITLES[row.action] || ACTION_TITLES[row.source] || '积分变动'
}

/** 金额累计统一保留两位小数，消除浮点尾差 */
function round2(value) {
  const n = Number(value) || 0
  return Math.round(n * 100) / 100
}

function toType(row) {
  if (row.type) return row.type
  return (Number(row.points) || 0) < 0 ? 'spend' : 'earn'
}

async function loadRule(storeId) {
  try {
    const res = await db.collection('store_point_rules')
      .where({ status: 'active' })
      .orderBy('priority', 'desc')
      .limit(20)
      .get()
    const rows = res.data || []
    const scoped = storeId
      ? rows.find((row) => Array.isArray(row.storeIds) && row.storeIds.indexOf(storeId) !== -1)
      : null
    const global = rows.find((row) => !Array.isArray(row.storeIds) || !row.storeIds.length)
    const cfg = normalizeConfig(scoped || global || {})
    return { text: describeRule(cfg), rule: summarizeRule(cfg) }
  } catch (e) {
    const cfg = normalizeConfig({})
    return { text: describeRule(cfg), rule: summarizeRule(cfg) }
  }
}

exports.main = async (event) => {
  const openid = cloud.getWXContext().OPENID
  if (!openid) return { success: false, msg: '请先登录' }

  const page = Math.max(1, parseInt((event && event.page) || 1, 10) || 1)
  const pageSize = Math.min(50, Math.max(5, parseInt((event && event.pageSize) || 20, 10) || 20))
  const typeFilter = String((event && event.type) || '').trim()

  const balance = await loadBalance(db, openid)
  const user = balance.user || {}

  // 新记录按 userOpenid 归属；历史记录没有该字段，回退到 _openid
  const query = _.or([
    { userOpenid: openid },
    { userOpenid: _.exists(false), _openid: openid }
  ])

  let list = []
  let total = 0
  let unavailable = false
  try {
    const condition = typeFilter ? _.and([query, { type: typeFilter }]) : query
    const countRes = await db.collection(POINT_RECORDS).where(condition).count()
    total = countRes.total || 0
    const res = await db.collection(POINT_RECORDS)
      .where(condition)
      .orderBy('createTime', 'desc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get()

    list = (res.data || []).map((row) => ({
      _id: row._id,
      title: toTitle(row),
      type: toType(row),
      source: row.source || row.action || '',
      points: Number(row.points) || 0,
      status: row.status || 'done',
      storeId: row.storeId || '',
      balanceAfter: Number.isFinite(Number(row.balanceAfter)) ? Number(row.balanceAfter) : null,
      createTime: row.createTime || row._createTime || null
    }))
  } catch (e) {
    console.warn('getPointRecords list failed:', e.message)
    unavailable = true
  }

  const rulePack = await loadRule(event && event.storeId)

  return {
    success: true,
    list,
    total,
    page,
    pageSize,
    hasMore: page * pageSize < total,
    summary: {
      balance: balance.displayAvailable,
      growthValue: balance.growthValue,
      bonusPoints: balance.bonusPoints,
      usedPoints: balance.usedPoints,
      pointsDebt: balance.pointsDebt,
      // 金额累计取两位小数，避免浮点尾差（0.1+0.2 类）
      storeSpendTotal: round2(user.storeSpendTotal),
      storePointsTotal: Number(user.storePointsTotal || 0) || 0,
      /** 线上消费累计（确认收货赠分口径，与门店消费分列） */
      onlineSpendTotal: round2(user.onlineSpendTotal),
      /** 外部平台订单累计（绑定兑积分口径，不计入门店消费） */
      platformSpendTotal: round2(user.platformSpendTotal)
    },
    storeRuleText: rulePack.text,
    storeRule: rulePack.rule,
    ...(unavailable ? { fallback: true } : {})
  }
}
