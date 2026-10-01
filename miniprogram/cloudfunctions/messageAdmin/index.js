/**
 * 山海有信 — 后台管理（记录 / 留言回复 / 模板）
 * 鉴权：staffGuard — manager + pushMessage
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


cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event) => {
  globalThis.__adminOpsKey = (event && event.adminOpsKey) || ''
  const { action } = event
  const wxContext = cloud.getWXContext()
  const operatorOpenid = wxContext.OPENID

  const guard = await assertStaff(db, operatorOpenid, {
    role: ROLE_MANAGER,
    permission: 'pushMessage'
  })
  if (!guard.ok) {
    return { success: false, code: guard.code, msg: guard.msg }
  }

  try {
    switch (action) {
      case 'getCampaigns':
        return await getCampaigns(event)
      case 'getRecentLogs':
        return await getRecentLogs(event)
      case 'getTemplates':
        return await getTemplates()
      case 'updateTemplate':
        return await updateTemplate(event, operatorOpenid)
      case 'listSupportTickets':
        return await listSupportTickets(event)
      case 'replySupportTicket':
        return await replySupportTicket(event, operatorOpenid)
      case 'setSupportTicketStatus':
        return await setSupportTicketStatus(event, operatorOpenid)
      default:
        return { success: false, msg: '未知 action' }
    }
  } catch (err) {
    console.error('messageAdmin error:', err)
    return { success: false, msg: err.message || '操作失败' }
  }
}

async function getCampaigns(event) {
  const limit = Math.min(event.limit || 30, 50)
  try {
    const res = await db.collection('push_campaigns')
      .orderBy('createTime', 'desc')
      .limit(limit)
      .get()
    return { success: true, list: res.data || [] }
  } catch (e) {
    return { success: true, list: [] }
  }
}

async function getRecentLogs(event) {
  const limit = Math.min(event.limit || 30, 50)
  try {
    const res = await db.collection('notification_logs')
      .orderBy('sentAt', 'desc')
      .limit(limit)
      .get()
    return { success: true, list: res.data || [] }
  } catch (e) {
    try {
      const res = await db.collection('notification_logs').limit(limit).get()
      const sorted = (res.data || []).sort((a, b) => {
        const ta = new Date(a.sentAt || 0).getTime()
        const tb = new Date(b.sentAt || 0).getTime()
        return tb - ta
      })
      return { success: true, list: sorted }
    } catch (e2) {
      return { success: true, list: [] }
    }
  }
}

async function getTemplates() {
  try {
    const res = await db.collection('message_templates').limit(100).get()
    if (res.data && res.data.length) {
      return { success: true, list: res.data }
    }
  } catch (e) {
    // fall through
  }
  return { success: true, list: [], needSeed: true }
}

async function updateTemplate(event, operatorOpenid) {
  const { templateCode, titleTemplate, contentTemplate, enabled } = event
  if (!templateCode) return { success: false, msg: '缺少 templateCode' }

  const res = await db.collection('message_templates').where({ templateCode }).limit(1).get()
  const patch = {
    updatedAt: db.serverDate(),
    updatedBy: operatorOpenid
  }
  if (titleTemplate !== undefined) patch.titleTemplate = titleTemplate
  if (contentTemplate !== undefined) patch.contentTemplate = contentTemplate
  if (enabled !== undefined) patch.enabled = !!enabled

  if (res.data && res.data[0]) {
    await db.collection('message_templates').doc(res.data[0]._id).update({ data: patch })
  } else {
    await db.collection('message_templates').add({
      data: {
        templateCode,
        category: 'system',
        priority: 'P1',
        titleTemplate: titleTemplate || '',
        contentTemplate: contentTemplate || '',
        enabled: enabled !== false,
        ...patch
      }
    })
  }
  return { success: true }
}

async function listSupportTickets(event) {
  const status = event.status || 'pending'
  const res = await db.collection('support_tickets')
    .where({ status })
    .orderBy('createTime', 'desc')
    .limit(50)
    .get()
  return { success: true, list: await attachMemberLabels(res.data || []) }
}

/** 与积分 / 储值 / 定金同算法：openid 末 8 位 → MT-XXXX-XXXX */
function buildMemberNo(openid) {
  if (!openid || openid.length < 8) return ''
  const shortId = openid.substr(openid.length - 8).toUpperCase()
  return `MT-${shortId.substr(0, 4)}-${shortId.substr(4, 4)}`
}

/**
 * 工单卡右上角用昵称 / 会员号代替 openid 片段（2026-10-01 产品负责人真机反馈）：
 * 只在原行上新增 memberNickName / memberNo 两个出参字段，只读 users 的 nickName / memberNo（不读手机号）；
 * 读 users 失败不影响列表，会员号回退同算法。
 */
async function attachMemberLabels(list) {
  const rows = Array.isArray(list) ? list : []
  const _ = db.command
  const openids = Array.from(new Set(rows.map((r) => r._openid).filter(Boolean)))
  const users = {}
  for (let i = 0; i < openids.length; i += 20) {
    const slice = openids.slice(i, i + 20)
    try {
      const res = await db.collection('users').where({ _openid: _.in(slice) })
        .field({ _openid: true, nickName: true, memberNo: true }).limit(slice.length).get()
      ;(res.data || []).forEach((u) => { if (u && u._openid) users[u._openid] = u })
    } catch (e) { /* 只影响展示，回退会员号 */ }
  }
  return rows.map((r) => {
    const u = r._openid ? users[r._openid] : null
    return {
      ...r,
      memberNickName: (u && u.nickName) ? String(u.nickName) : '',
      memberNo: (u && u.memberNo) ? String(u.memberNo) : buildMemberNo(r._openid)
    }
  })
}

/** ERP 工单页：标记已处理 / 归档（support_tickets 客户端 write:false） */
const TICKET_STATUS_STAMP = { resolved: 'resolveTime', archived: 'archivedAt' }

async function setSupportTicketStatus(event, operatorOpenid) {
  const ticketId = String((event && event.ticketId) || '').trim()
  const status = String((event && event.status) || '').trim()
  if (!ticketId) return { success: false, msg: '缺少工单 id' }
  if (!TICKET_STATUS_STAMP[status]) return { success: false, msg: '不支持的工单状态' }
  const res = await db.collection('support_tickets').where({ _id: ticketId }).update({
    data: {
      status,
      [TICKET_STATUS_STAMP[status]]: db.serverDate(),
      statusUpdatedBy: operatorOpenid || 'admin_web'
    }
  })
  if (!res || !res.stats || res.stats.updated !== 1) return { success: false, msg: '工单不存在' }
  return { success: true, ticketId, status }
}

async function replySupportTicket(event, operatorOpenid) {
  const { ticketId, replyContent } = event
  const content = String(replyContent || '').trim()
  if (!ticketId || content.length < 2) {
    return { success: false, msg: '请填写回复内容' }
  }
  if (content.length > 500) {
    return { success: false, msg: '回复不超过 500 字' }
  }

  const ticketRes = await db.collection('support_tickets').doc(ticketId).get()
  const ticket = ticketRes.data
  if (!ticket) return { success: false, msg: '工单不存在' }

  await db.collection('support_tickets').doc(ticketId).update({
    data: {
      status: 'replied',
      replyContent: content,
      repliedAt: db.serverDate(),
      repliedBy: operatorOpenid
    }
  })

  const preview = content.length > 120 ? content.slice(0, 120) + '…' : content
  await cloud.callFunction({
    name: 'dispatchMessage',
    data: {
      action: 'dispatch',
      eventType: 'support_ticket_replied',
      openid: ticket._openid,
      relatedId: ticketId,
      vars: { replyContent: preview, topicLabel: ticket.topicLabel || '咨询' }
    }
  })

  return { success: true }
}
