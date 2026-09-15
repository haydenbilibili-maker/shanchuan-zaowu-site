/**
 * 山海有信 — 运营推送（单人 / 全局 / RFM 分群）
 */
const cloud = require('wx-server-sdk')
const { assertStaff: _assertStaff, ROLE_MANAGER } = require('./staffGuard')

/**
 * 鉴权包装（2026-09-15 修复）：Admin Web 经 /api/cloud-fn 调用时，代理会把密钥注入
 * event.adminOpsKey，而 staffGuard 只比较 options.adminOpsKey —— 原实现从不透传，
 * 导致 ERP 调用本函数一律 NOT_LOGGED_IN。此处统一从 globalThis 取用。
 *
 * 注意：入口对 globalThis.__adminOpsKey 必须**无条件赋值**（无密钥时置空）。
 * 预热容器会跨请求复用 globalThis，若只在有密钥时赋值，上一个请求的超管身份
 * 会泄漏给下一个无密钥请求。
 */
function assertStaff(db, openid, options = {}) {
  const opts = { ...(options || {}) }
  if (opts.adminOpsKey == null) opts.adminOpsKey = globalThis.__adminOpsKey || ''
  return _assertStaff(db, openid, opts)
}

const {
  normalizeFilters,
  segmentAllowedForCampaign,
  resolveAudienceOpenids,
  PREVIEW_CAP
} = require('./audience')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const BATCH_SIZE = 100
const SEND_PER_INVOCATION = 45
const GLOBAL_PUSH_WINDOW_MS = 24 * 60 * 60 * 1000
const GLOBAL_PUSH_DAILY_LIMIT = 20
const SEGMENT_PUSH_DAILY_LIMIT = 30

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

async function checkSegmentPushLimit(operatorOpenid) {
  const since = new Date(Date.now() - GLOBAL_PUSH_WINDOW_MS)
  const res = await db.collection('push_campaigns')
    .where({
      scope: 'segment',
      createdBy: operatorOpenid,
      createTime: _.gte(since)
    })
    .count()
  const used = res.total || 0
  return {
    allowed: used < SEGMENT_PUSH_DAILY_LIMIT,
    used,
    limit: SEGMENT_PUSH_DAILY_LIMIT,
    remaining: Math.max(SEGMENT_PUSH_DAILY_LIMIT - used, 0)
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

async function sendBatchOpenids(openids, payload) {
  let sent = 0
  let failed = 0
  for (const openid of openids) {
    try {
      const ok = await sendOne(openid, payload)
      if (ok) sent += 1
      else failed += 1
    } catch (e) {
      failed += 1
    }
  }
  return { sent, failed }
}

function buildAudiencePayload(event) {
  return normalizeFilters({
    segment: event.segment,
    campaignType: event.campaignType,
    honoraryOnly: event.honoraryOnly,
    activeOnly: event.activeOnly,
    highValueOnly: event.highValueOnly,
    minLevel: event.minLevel
  })
}

exports.main = async (event) => {
  globalThis.__adminOpsKey = (event && event.adminOpsKey) || ''
  const wxContext = cloud.getWXContext()
  const operatorOpenid = wxContext.OPENID
  const { action = 'send' } = event

  const guard = await assertStaff(db, operatorOpenid, { role: ROLE_MANAGER, permission: 'pushMessage' })
  if (!guard.ok) return { success: false, code: guard.code, msg: guard.msg }

  if (action === 'listSegments') {
    const { SEGMENTS, CAMPAIGN_RECALL_SEGMENTS, CAMPAIGN_CONVERSION_SEGMENTS } = require('./audience')
    const all = Object.keys(SEGMENTS).map((key) => ({
      key,
      name: SEGMENTS[key].name,
      desc: SEGMENTS[key].desc,
      recall: CAMPAIGN_RECALL_SEGMENTS.has(key),
      conversion: CAMPAIGN_CONVERSION_SEGMENTS.has(key)
    }))
    return { success: true, segments: all }
  }

  if (action === 'estimate') {
    const { scope, targetOpenid } = event
    if (scope === 'single') {
      return { success: true, count: targetOpenid ? 1 : 0 }
    }
    if (scope === 'all') {
      const count = await countAllUsers()
      return { success: true, count }
    }
    if (scope === 'segment') {
      const filters = buildAudiencePayload(event)
      if (filters.segment && !segmentAllowedForCampaign(filters.campaignType, filters.segment)) {
        return { success: false, msg: '该分群与活动类型不匹配' }
      }
      const aud = await resolveAudienceOpenids(db, filters)
      return {
        success: true,
        count: aud.count,
        previewNote:
          aud.count > PREVIEW_CAP
            ? `单次发送最多 ${PREVIEW_CAP} 人（采样窗口 ${aud.fetchCap} 条）`
            : aud.dataCapped
              ? `基于最近 ${aud.fetchCap} 条用户/订单采样估算`
              : '',
        dataCapped: aud.dataCapped,
        segmentMeta: aud.segmentMeta
      }
    }
    return { success: false, msg: '未知 scope' }
  }

  if (action === 'send') {
    const {
      title,
      content,
      category = 'activity',
      actionUrl = '',
      scope = 'single',
      targetOpenid = '',
      scheduledAt = null,
      campaignType = 'general',
      segment = '',
      honoraryOnly = false,
      activeOnly = false,
      highValueOnly = false,
      minLevel = 0,
      campaignId: continueCampaignId = '',
      sendOffset = 0
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

    const audienceFilters = buildAudiencePayload({
      segment,
      campaignType,
      honoraryOnly,
      activeOnly,
      highValueOnly,
      minLevel
    })

    if (scope === 'segment') {
      if (!audienceFilters.segment && !audienceFilters.campaignType) {
        return { success: false, msg: '请选择 RFM 分群或活动类型' }
      }
      if (
        audienceFilters.segment &&
        !segmentAllowedForCampaign(audienceFilters.campaignType, audienceFilters.segment)
      ) {
        return { success: false, msg: '该分群与活动类型不匹配' }
      }
    }

    if (scope === 'all') {
      const quota = await checkGlobalPushLimit(operatorOpenid)
      if (!quota.allowed) {
        return {
          success: false,
          msg: `24 小时内全局推送已达上限（${quota.limit} 次/天）`
        }
      }
    } else if (scope === 'single' && !targetOpenid) {
      return { success: false, msg: '请指定接收用户' }
    } else if (scope === 'segment' && !continueCampaignId) {
      const quota = await checkSegmentPushLimit(operatorOpenid)
      if (!quota.allowed) {
        return {
          success: false,
          msg: `24 小时内分群推送已达上限（${quota.limit} 次/天）`
        }
      }
    }

    let campaignId = continueCampaignId
    let targetOpenids = []
    let targetEstimate = 0

    if (scope === 'segment') {
      if (!campaignId) {
        const aud = await resolveAudienceOpenids(db, audienceFilters)
        targetOpenids = aud.openids.slice(0, PREVIEW_CAP)
        targetEstimate = aud.count
        if (!targetOpenids.length) {
          return { success: false, msg: '当前筛选下暂无触达用户' }
        }
        const campaignRes = await db.collection('push_campaigns').add({
          data: {
            title: trimmedTitle,
            content: trimmedContent,
            category,
            actionUrl: actionUrl || '',
            scope: 'segment',
            campaignType: campaignType || 'general',
            segment: audienceFilters.segment || '',
            audienceFilters: {
              honoraryOnly: !!honoraryOnly,
              activeOnly: !!activeOnly,
              highValueOnly: !!highValueOnly,
              minLevel: audienceFilters.minLevel || 0
            },
            targetOpenid: '',
            openidList: targetOpenids,
            scheduledAt: scheduledAt || null,
            status: 'sending',
            stats: { target: targetEstimate, sent: 0, failed: 0, cappedAt: PREVIEW_CAP },
            createdBy: operatorOpenid,
            createTime: db.serverDate()
          }
        })
        campaignId = campaignRes._id
      } else {
        const doc = await db.collection('push_campaigns').doc(campaignId).get()
        const row = doc.data
        if (!row || row.createdBy !== operatorOpenid) {
          return { success: false, msg: '活动不存在或无权限' }
        }
        targetOpenids = Array.isArray(row.openidList) ? row.openidList : []
        targetEstimate = (row.stats && row.stats.target) || targetOpenids.length
      }
    }

    if (!campaignId && scope !== 'segment') {
      const campaignRes = await db.collection('push_campaigns').add({
        data: {
          title: trimmedTitle,
          content: trimmedContent,
          category,
          actionUrl: actionUrl || '',
          scope,
          campaignType: scope === 'segment' ? campaignType : '',
          segment: scope === 'segment' ? audienceFilters.segment : '',
          targetOpenid: scope === 'single' ? targetOpenid : '',
          scheduledAt: scheduledAt || null,
          status: 'sending',
          stats: { target: 0, sent: 0, failed: 0 },
          createdBy: operatorOpenid,
          createTime: db.serverDate()
        }
      })
      campaignId = campaignRes._id
    }

    const payload = {
      title: trimmedTitle,
      content: trimmedContent,
      actionUrl,
      category,
      campaignId
    }

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

      if (scope === 'segment') {
        const offset = Math.max(0, parseInt(sendOffset, 10) || 0)
        const slice = targetOpenids.slice(offset, offset + SEND_PER_INVOCATION)
        const batchStats = await sendBatchOpenids(slice, payload)
        const prev = await db.collection('push_campaigns').doc(campaignId).get()
        const prevStats = (prev.data && prev.data.stats) || { target: targetEstimate, sent: 0, failed: 0 }
        const sent = (prevStats.sent || 0) + batchStats.sent
        const failed = (prevStats.failed || 0) + batchStats.failed
        const nextOffset = offset + slice.length
        const hasMore = nextOffset < targetOpenids.length

        const campaignPatch = {
          status: hasMore ? 'sending' : 'completed',
          stats: {
            target: targetEstimate,
            sent,
            failed,
            cappedAt: PREVIEW_CAP,
            deliveredOpenids: nextOffset
          }
        }
        if (!hasMore) campaignPatch.completedAt = db.serverDate()
        await db.collection('push_campaigns').doc(campaignId).update({ data: campaignPatch })

        return {
          success: true,
          campaignId,
          stats: { target: targetEstimate, sent, failed },
          hasMore,
          nextOffset: hasMore ? nextOffset : null
        }
      }

      let skip = 0
      let sent = 0
      let failed = 0
      let hasMore = true
      targetEstimate = await countAllUsers()

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
        const part = await sendBatchOpenids(batch, payload)
        sent += part.sent
        failed += part.failed
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
      if (campaignId) {
        await db.collection('push_campaigns').doc(campaignId).update({
          data: { status: 'failed', error: err.message || '发送失败' }
        })
      }
      return { success: false, msg: err.message || '发送失败', campaignId }
    }
  }

  return { success: false, msg: '未知 action' }
}
