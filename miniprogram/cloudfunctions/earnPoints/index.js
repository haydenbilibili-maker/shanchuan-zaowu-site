/**
 * 通用行为积分：签到 / 浏览 / 分享 / 评价
 *
 * 奖励开关与数额读取 store_point_rules.modules / moduleRewards（代码 defaults 兜底）。
 * 关闭对应模块时直接拒绝，不发分。
 */
const cloud = require('wx-server-sdk')
const { normalizeConfig, isModuleEnabled } = require('./defaults')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const RULES = 'store_point_rules'

const ACTION_MODULE = {
  check_in: 'checkIn',
  browse: 'browse',
  share: 'share',
  review: 'review',
  comment: 'review'
}

async function loadRuleConfig() {
  try {
    const res = await db.collection(RULES)
      .where({ status: 'active' })
      .orderBy('priority', 'desc')
      .limit(20)
      .get()
    const rows = res.data || []
    const global = rows.find((row) => !Array.isArray(row.storeIds) || !row.storeIds.length)
    return normalizeConfig(global || rows[0] || {})
  } catch (e) {
    return normalizeConfig({})
  }
}

function todayStr() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function resolveAction(event) {
  const raw = String((event && (event.action || event.source)) || '').trim()
  if (raw === 'comment') return 'review'
  if (ACTION_MODULE[raw]) return raw
  return ''
}

exports.main = async (event) => {
  const openid = cloud.getWXContext().OPENID
  if (!openid) return { success: false, msg: '请先登录' }

  const action = resolveAction(event)
  const moduleKey = ACTION_MODULE[action]
  if (!moduleKey) return { success: false, msg: '未知动作' }

  const productId = (event && event.productId) || (event && event.sourceId) || null
  const config = await loadRuleConfig()

  if (!isModuleEnabled(config, moduleKey)) {
    return { success: false, code: 'MODULE_DISABLED', msg: '该积分奖励已关闭' }
  }

  // 合规硬闸：分享奖励属「诱导分享」，无论线上配置如何一律拒绝
  // （微信《小程序平台运营规范》禁止以利益诱导分享；如需恢复必须先改为非诱导形态）
  if (moduleKey === 'share') {
    return { success: false, code: 'SHARE_REWARD_DISABLED', msg: '分享奖励已停用' }
  }

  const reward = (config.moduleRewards && config.moduleRewards[moduleKey]) || {}
  const points = Math.max(0, Math.floor(Number(reward.points) || 0))
  // 语义收紧：dailyLimit 未配置或为 0 视为**不发放**（原先 0 = 不限次数，容易被配成刷分通道）
  const rawLimit = Number(reward && reward.dailyLimit)
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : 0
  if (limit === 0) {
    return { success: false, msg: '该奖励未配置每日上限，已停用' }
  }
  if (points <= 0) return { success: false, msg: '该奖励积分为 0' }

  const dateStr = todayStr()

  try {
    const recordQuery = {
      _openid: openid,
      action,
      dateStr
    }
    if (action === 'browse' && productId) {
      recordQuery.productId = productId
    }
    if (action === 'review' && productId) {
      recordQuery.productId = String(productId)
    }

    const records = await db.collection('point_records').where(recordQuery).count()

    if ((action === 'browse' || action === 'review') && productId && records.total > 0) {
      return { success: false, msg: action === 'review' ? '该内容已评价奖励' : '今日已阅' }
    }

    if (limit > 0) {
      const totalToday = await db.collection('point_records').where({
        _openid: openid,
        action,
        dateStr
      }).count()
      if (totalToday.total >= limit) {
        return { success: false, msg: action === 'check_in' ? '今日已签' : '今日次数已用完' }
      }
    }

    const titleMap = {
      check_in: '每日签到',
      browse: '鉴赏藏品',
      share: '分享藏品',
      review: '评价奖励'
    }

    await db.collection('point_records').add({
      data: {
        _openid: openid,
        userOpenid: openid,
        type: 'earn',
        source: action,
        action,
        points,
        title: titleMap[action] || '积分奖励',
        productId: productId || null,
        status: 'done',
        dateStr,
        createTime: db.serverDate()
      }
    })

    const userRes = await db.collection('users').where({ _openid: openid }).get()
    if (userRes.data.length > 0) {
      await db.collection('users').doc(userRes.data[0]._id).update({
        data: { bonusPoints: _.inc(points) }
      })
    } else {
      await db.collection('users').add({
        data: {
          _openid: openid,
          bonusPoints: points,
          usedPoints: 0,
          createTime: db.serverDate()
        }
      })
    }

    return { success: true, points, msg: `+${points} 积分` }
  } catch (err) {
    console.error('earnPoints', err)
    return { success: false, msg: '系统繁忙' }
  }
}
