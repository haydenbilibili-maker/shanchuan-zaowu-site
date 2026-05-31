/**
 * 山海有信 — 后台管理（记录 / 留言回复 / 模板）
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event) => {
  const { action } = event
  const wxContext = cloud.getWXContext()
  const operatorOpenid = wxContext.OPENID

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
  return { success: true, list: res.data || [] }
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
