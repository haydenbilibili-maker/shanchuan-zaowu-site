/**
 * 山海有信 — 运营推送（单人 / 全局）
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const BATCH_SIZE = 100
const GLOBAL_PUSH_WINDOW_MS = 24 * 60 * 60 * 1000
const GLOBAL_PUSH_DAILY_LIMIT = 20

function getAdminOpenids() {
  const env = process.env.MESSAGE_ADMIN_OPENIDS || ''
  return env.split(',').map((s) => s.trim()).filter(Boolean)
}

function isAdmin(openid) {
  const admins = getAdminOpenids()
  if (!admins.length) return true
  return admins.includes(openid)
}

async function countAllUsers() {
  try {
    const res = await db.collection('users').count()
    return res.total || 0
  } catch (e) {
    const msgRes = await db.collection('user_messages').field({ _openid: true }).limit(1000).get()
    const set = new Set((msgRes.data || []).map((m) => m._openid).filter(Boolean))
    return set.size
  }
}

async function checkGlobalPushLimit(operatorOpenid) {
  const since = new Date(Date.now() - GLOBAL_PUSH_WINDOW_MS)
  const res = await db.collection('push_campaigns')
    .where({
      scope: 'all',
      createdBy: operatorOpenid,
      createTime: _.gte(since)
    })
    .count()
  const used = res.total || 0
  return {
    allowed: used < GLOBAL_PUSH_DAILY_LIMIT,
    used,
    limit: GLOBAL_PUSH_DAILY_LIMIT,
    remaining: Math.max(GLOBAL_PUSH_DAILY_LIMIT - used, 0)
  }
}

async function sendOne(openid, payload) {
  const res = await cloud.callFunction({
    name: 'dispatchMessage',
    data: {
      action: 'dispatch',
      eventType: 'activity_notice',
      openid,
      relatedId: payload.campaignId,
      vars: {
        title: payload.title,
        content: payload.content,
        actionUrl: payload.actionUrl
      },
      category: payload.category,
      campaignId: payload.campaignId,
      skipDedupe: true
    }
  })
  const result = res.result || {}
  return result.success && !result.skipped
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const operatorOpenid = wxContext.OPENID
  const { action = 'send' } = event

  if (action === 'estimate') {
    const { scope, targetOpenid } = event
    if (scope === 'single') {
      return { success: true, count: targetOpenid ? 1 : 0 }
    }
    const count = await countAllUsers()
    return { success: true, count }
  }

  if (action === 'send') {
    const {
      title,
      content,
      category = 'activity',
      actionUrl = '',
      scope = 'single',
      targetOpenid = '',
      scheduledAt = null
    } = event

    const trimmedTitle = String(title || '').trim()
    const trimmedContent = String(content || '').trim()

    if (!trimmedTitle || trimmedTitle.length > 30) {
      return { success: false, msg: '标题必填且不超过 30 字' }
    }
    if (!trimmedContent || trimmedContent.length > 200) {
      return { success: false, msg: '正文必填且不超过 200 字' }
    }
    if (!['activity', 'system'].includes(category)) {
      return { success: false, msg: '运营推送仅支持活动或系统分类' }
    }
    if (/您的订单|待支付|已发货|预约已/.test(trimmedTitle + trimmedContent)) {
      return { success: false, msg: '运营推送不可使用交易类文案' }
    }

    if (scope === 'all') {
      if (!isAdmin(operatorOpenid)) {
        return { success: false, msg: '全局推送需要管理员权限' }
      }
      const quota = await checkGlobalPushLimit(operatorOpenid)
      if (!quota.allowed) {
        return {
          success: false,
          msg: `24 小时内全局推送已达上限（${quota.limit} 次/天）`
        }
      }
    } else if (!targetOpenid) {
      return { success: false, msg: '请指定接收用户' }
    }

    const campaignRes = await db.collection('push_campaigns').add({
      data: {
        title: trimmedTitle,
        content: trimmedContent,
        category,
        actionUrl: actionUrl || '',
        scope,
        targetOpenid: scope === 'single' ? targetOpenid : '',
        scheduledAt: scheduledAt || null,
        status: 'sending',
        stats: { target: 0, sent: 0, failed: 0 },
        createdBy: operatorOpenid,
        createTime: db.serverDate()
      }
    })
    const campaignId = campaignRes._id
    const payload = { title: trimmedTitle, content: trimmedContent, actionUrl, category, campaignId }

    try {
      if (scope === 'single') {
        const ok = await sendOne(targetOpenid, payload)
        const sent = ok ? 1 : 0
        await db.collection('push_campaigns').doc(campaignId).update({
          data: {
            status: 'completed',
            stats: { target: 1, sent, failed: sent ? 0 : 1 },
            completedAt: db.serverDate()
          }
        })
        return { success: true, campaignId, stats: { target: 1, sent, failed: sent ? 0 : 1 } }
      }

      let skip = 0
      let sent = 0
      let failed = 0
      let hasMore = true
      const targetEstimate = await countAllUsers()

      while (hasMore) {
        const usersRes = await db.collection('users')
          .field({ _openid: true })
          .skip(skip)
          .limit(BATCH_SIZE)
          .get()
        const batch = (usersRes.data || []).map((u) => u._openid).filter(Boolean)
        if (!batch.length) {
          hasMore = false
          break
        }
        for (const openid of batch) {
          try {
            const ok = await sendOne(openid, payload)
            if (ok) sent += 1
            else failed += 1
          } catch (e) {
            failed += 1
          }
        }
        skip += batch.length
        if (batch.length < BATCH_SIZE) hasMore = false
      }

      await db.collection('push_campaigns').doc(campaignId).update({
        data: {
          status: 'completed',
          stats: { target: targetEstimate, sent, failed },
          completedAt: db.serverDate()
        }
      })
      return { success: true, campaignId, stats: { target: targetEstimate, sent, failed } }
    } catch (err) {
      await db.collection('push_campaigns').doc(campaignId).update({
        data: { status: 'failed', error: err.message || '发送失败' }
      })
      return { success: false, msg: err.message || '发送失败', campaignId }
    }
  }

  return { success: false, msg: '未知 action' }
}
